// ════════════════════════════════════════════════════════
// MÓDULO: js/fotos.js
// FOTOS + CLUSTERS + ENLACE PÚBLICO
// ════════════════════════════════════════════════════════
// 3. LECTURA EXIF
// ═══════════════════════════════════════════════════════════════
const photoGroup = L.layerGroup().addTo(map);
const photos = [];

const MAX_PHOTOS_PER_BATCH = 50;
async function processFiles(files) {
  let imgFiles = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|tiff?)$/i.test(f.name));
  if (!imgFiles.length) { updateCounter(); return; }
  if (imgFiles.length > MAX_PHOTOS_PER_BATCH) {
    showToast(`Máximo ${MAX_PHOTOS_PER_BATCH} fotos por lote. Se cargarán las primeras ${MAX_PHOTOS_PER_BATCH} de ${imgFiles.length}.`, 'warn');
    imgFiles = imgFiles.slice(0, MAX_PHOTOS_PER_BATCH);
  }
  const groupId = imgFiles.length >= 2 ? 'g_' + Math.random().toString(36).slice(2,9) : null;
  let groupEl = null;
  if (groupId) groupEl = createPhotoGroup(groupId, imgFiles.length);
  for (const file of imgFiles) {
    try {
      const photo = await readPhotoData(file);
      photo.groupId = groupId;
      photos.push(photo);
      addPhotoToSidebar(photo, groupEl);
      if (photo.lat !== null) addPhotoMarker(photo);
    } catch(e) { console.error(e); }
  }
  updateCounter();
}

function createPhotoGroup(groupId, count) {
  const list = document.getElementById('unifiedList');
  document.getElementById('unified-empty').style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'photo-group';
  wrap.dataset.groupId = groupId;
  wrap.innerHTML = `
    <div class="photo-group-header">
      <input type="checkbox" class="photo-vis group-vis" checked title="Mostrar/ocultar todas" style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer;flex-shrink:0;">
      <button class="group-toggle-btn" title="Desplegar/contraer">▼</button>
      <span class="group-icon">📷</span>
      <div class="group-label">${count} fotos</div>
      <div class="item-actions">
        <button class="item-del" title="Eliminar todas">✕</button>
      </div>
    </div>
    <div class="photo-group-children"></div>`;
  const header = wrap.querySelector('.photo-group-header');
  const children = wrap.querySelector('.photo-group-children');
  const toggle = wrap.querySelector('.group-toggle-btn');
  const groupVis = wrap.querySelector('.group-vis');
  const collapse = () => { children.classList.add('collapsed'); toggle.classList.add('collapsed'); };
  const expand = () => { children.classList.remove('collapsed'); toggle.classList.remove('collapsed'); };
  toggle.onclick = e => { e.stopPropagation(); children.classList.contains('collapsed') ? expand() : collapse(); };
  header.onclick = e => {
    if (e.target.closest('.item-del') || e.target.closest('.group-vis') || e.target.closest('.group-toggle-btn')) return;
    children.classList.contains('collapsed') ? expand() : collapse();
  };
  groupVis.addEventListener('change', e => {
    e.stopPropagation();
    const checked = groupVis.checked;
    children.querySelectorAll('.list-item[data-type="photo"] .photo-vis').forEach(chk => {
      if (chk.checked !== checked) { chk.checked = checked; chk.dispatchEvent(new Event('change')); }
    });
  });
  wrap.querySelector('.item-del').onclick = e => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar las ${children.children.length} fotos del grupo?`)) return;
    const ids = [...children.querySelectorAll('.list-item[data-type="photo"]')].map(el => el.dataset.id);
    ids.forEach(id => removePhoto(id));
    wrap.remove();
    updateCounter();
  };
  const firstShp = list.querySelector('.list-item[data-type="shp"]');
  list.insertBefore(wrap, firstShp || document.getElementById('unified-empty'));
  return wrap;
}


function readPhotoData(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const thumb = ev.target.result;
      const img = new Image();
      img.onload = () => {
        EXIF.getData(img, function() {
          const lat = EXIF.getTag(this, 'GPSLatitude');
          const lon = EXIF.getTag(this, 'GPSLongitude');
          let latDec = null, lonDec = null;
          if (lat && lon) {
            latDec = lat[0] + lat[1]/60 + lat[2]/3600;
            lonDec = lon[0] + lon[1]/60 + lon[2]/3600;
            if (EXIF.getTag(this, 'GPSLatitudeRef') === 'S') latDec = -latDec;
            if (EXIF.getTag(this, 'GPSLongitudeRef') === 'W') lonDec = -lonDec;
          }
          let azimuth = null;
          const raw = EXIF.getTag(this, 'GPSImgDirection');
          if (raw != null) {
            azimuth = (typeof raw === 'object' && raw.numerator !== undefined)
              ? raw.numerator / raw.denominator : parseFloat(raw);
            if (isNaN(azimuth)) azimuth = null;
          }
          resolve({ id: Math.random().toString(36).slice(2,11), name: file.name, thumb, lat: latDec, lng: lonDec, azimuth });
        });
      };
      img.src = thumb;
    };
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. MARCADORES SVG
// ═══════════════════════════════════════════════════════════════
const clusterMap  = {};
const CLUSTER_TOL = 0.00005;

const CAM_BLUE   = '#2f6fde';
const CAM_ORANGE = '#c96800';
const ARROW_BLUE_FAINT = 'rgba(47,111,222,0.45)';

function clusterKey(lat, lng) {
  return Math.round(lat / CLUSTER_TOL) + '_' + Math.round(lng / CLUSTER_TOL);
}

let activeClusterKey = null;

function clearActiveCluster() {
  if (activeClusterKey && clusterMap[activeClusterKey]) {
    refreshClusterMarker(activeClusterKey, null);
  }
  activeClusterKey = null;
  highlightPhotoInSidebar(null);
}

function buildCamIcon(photoList, selectedIdx) {
  const CX = 40, CY = 42;
  const multi = photoList.length > 1;
  const BADGE_R = 7;

  const isSelected = selectedIdx !== null && selectedIdx >= 0;
  const camFill = isSelected ? CAM_ORANGE : CAM_BLUE;

  const bx = CX - 12, by = CY - 7;
  const camSvg = `
    <rect x="${bx}" y="${by+4}" width="24" height="14" rx="3" fill="${camFill}"/>
    <rect x="${bx+7}" y="${by}" width="10" height="6" rx="2" fill="${camFill}"/>
    <circle cx="${CX}" cy="${CY+4}" r="5.5" fill="white" opacity="0.22"/>
    <circle cx="${CX}" cy="${CY+4}" r="3.2" fill="white" opacity="0.50"/>
    <rect x="${bx+2}" y="${by+6}" width="4" height="3" rx="1" fill="white" opacity="0.6"/>
    <rect x="${bx+17}" y="${by+1}" width="5" height="3.5" rx="1" fill="white" opacity="0.5"/>`;

  const ARROW_DIST = 19;
  const SHAFT_LEN  = 8;
  const SHAFT_W    = 3;
  const HEAD_LEN   = 9;
  const HEAD_W     = 8;

  let arrows = '';
  photoList.forEach((p, i) => {
    if (p.azimuth === null) return;
    const isSel = selectedIdx === i;
    let arrowColor, arrowOpacity;
    if (!multi) {
      arrowColor   = isSelected ? CAM_ORANGE : CAM_BLUE;
      arrowOpacity = 1;
    } else {
      arrowColor   = isSel ? CAM_ORANGE : ARROW_BLUE_FAINT;
      arrowOpacity = isSel ? 1 : 0.85;
    }

    const az = p.azimuth * Math.PI / 180;
    const dx = Math.sin(az);
    const dy = -Math.cos(az);
    const px = -dy, py = dx;

    const s1x = CX + dx*ARROW_DIST + px*(SHAFT_W/2);
    const s1y = CY + dy*ARROW_DIST + py*(SHAFT_W/2);
    const s2x = CX + dx*ARROW_DIST - px*(SHAFT_W/2);
    const s2y = CY + dy*ARROW_DIST - py*(SHAFT_W/2);
    const s3x = CX + dx*(ARROW_DIST+SHAFT_LEN) - px*(SHAFT_W/2);
    const s3y = CY + dy*(ARROW_DIST+SHAFT_LEN) - py*(SHAFT_W/2);
    const s4x = CX + dx*(ARROW_DIST+SHAFT_LEN) + px*(SHAFT_W/2);
    const s4y = CY + dy*(ARROW_DIST+SHAFT_LEN) + py*(SHAFT_W/2);
    const tipX = CX + dx*(ARROW_DIST+SHAFT_LEN+HEAD_LEN);
    const tipY = CY + dy*(ARROW_DIST+SHAFT_LEN+HEAD_LEN);
    const h1x  = CX + dx*(ARROW_DIST+SHAFT_LEN) + px*(HEAD_W/2);
    const h1y  = CY + dy*(ARROW_DIST+SHAFT_LEN) + py*(HEAD_W/2);
    const h2x  = CX + dx*(ARROW_DIST+SHAFT_LEN) - px*(HEAD_W/2);
    const h2y  = CY + dy*(ARROW_DIST+SHAFT_LEN) - py*(HEAD_W/2);

    arrows += `
      <polygon points="${s1x},${s1y} ${s2x},${s2y} ${s3x},${s3y} ${s4x},${s4y}"
        fill="${arrowColor}" opacity="${arrowOpacity}"/>
      <polygon points="${tipX},${tipY} ${h1x},${h1y} ${h2x},${h2y}"
        fill="${arrowColor}" opacity="${arrowOpacity}"/>`;
  });

  const badge = multi ? `
    <circle cx="${CX+13}" cy="${CY-14}" r="${BADGE_R}"
      fill="${isSelected ? CAM_ORANGE : CAM_BLUE}" stroke="white" stroke-width="1.2"/>
    <text x="${CX+13}" y="${CY-14}" text-anchor="middle" dominant-baseline="central"
      font-family="DM Sans, sans-serif" font-size="8" font-weight="bold" fill="white">${photoList.length}</text>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
    width="80" height="80" viewBox="0 0 80 80"
    style="overflow:visible;display:block;pointer-events:none;">
    ${arrows}
    ${camSvg}
    ${badge}
  </svg>
  <div style="
    position:absolute;
    left:${bx}px; top:${by}px;
    width:24px; height:18px;
    cursor:pointer;
    pointer-events:all;
  "></div>`;

  return L.divIcon({
    html: svg,
    className: 'cam-wrap',
    iconSize:   [80, 80],
    iconAnchor: [CX, CY],
    popupAnchor:[0, -(CY - by)],
  });
}

function highlightPhotoInSidebar(photoId) {
  document.querySelectorAll('.list-item[data-type="photo"]').forEach(el => el.classList.remove('active'));
  if (!photoId) return;
  const el = document.querySelector(`.list-item[data-id="${photoId}"]`);
  if (!el) return;
  el.classList.add('active');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addPhotoMarker(photo) {
  const key = clusterKey(photo.lat, photo.lng);
  if (clusterMap[key]) {
    clusterMap[key].photos.push(photo);
    photo.clusterKey = key;
    photo.colorIndex = clusterMap[key].photos.length - 1;
    refreshClusterMarker(key, clusterMap[key].selectedIdx ?? null);
    bindClusterPopup(key);
  } else {
    const marker = L.marker([photo.lat, photo.lng], {
      icon: buildCamIcon([photo], null),
      zIndexOffset: 200
    }).addTo(photoGroup);

    clusterMap[key] = { marker, photos: [photo], selectedIdx: null };
    photo.clusterKey = key;
    photo.colorIndex = 0;
    bindClusterPopup(key);
  }
  photo.marker = clusterMap[photo.clusterKey].marker;
}

function refreshClusterMarker(key, selectedIdx) {
  const c = clusterMap[key];
  if (!c) return;
  c.selectedIdx = selectedIdx;
  c.marker.setIcon(buildCamIcon(c.photos, selectedIdx));
}

function bindClusterPopup(key) {
  const c = clusterMap[key];
  c.marker.off('click');
  c.marker.off('popupclose');
  c.marker.unbindPopup();

  const popup = L.popup({ maxWidth: 220, autoPan: false });
  const PX_ABOVE = 50;

  c.marker.on('click', function(e) {
    L.DomEvent.stopPropagation(e);
    if (activeClusterKey && activeClusterKey !== key) {
      refreshClusterMarker(activeClusterKey, null);
    }
    activeClusterKey = key;

    if (c.photos.length === 1) {
      refreshClusterMarker(key, 0);
      highlightPhotoInSidebar(c.photos[0].id);
    }

    const content = c.photos.length === 1
      ? buildSinglePopup(c.photos[0], key)
      : buildMultiPopup(key);

    const markerPx = map.latLngToContainerPoint(c.marker.getLatLng());
    const abovePx  = L.point(markerPx.x, markerPx.y - PX_ABOVE);
    const aboveLL  = map.containerPointToLatLng(abovePx);

    popup.setContent(content);
    popup.setLatLng(aboveLL);
    popup.openOn(map);
  });

  c.marker.on('popupclose', () => {
    refreshClusterMarker(key, null);
    if (activeClusterKey === key) {
      activeClusterKey = null;
      highlightPhotoInSidebar(null);
    }
  });
}

// ══════════════════════════════════════════════
// ENLACE PÚBLICO — generación y carga
// ══════════════════════════════════════════════

async function openShareLinkModal(layer) {
  if (!layer) return;
  const modal = document.getElementById('shareLinkModal');
  const sub   = document.getElementById('shareLinkSub');
  const box   = document.getElementById('shareLinkBox');
  const acts  = document.getElementById('shareLinkActions');
  sub.textContent = 'Generando enlace…';
  box.style.display = 'none';
  acts.style.display = 'none';
  modal.classList.add('open');

  try {
    const linkId = 'lnk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const serialized = JSON.stringify(enrichGeojsonWithChecklist(layer.id, layer.geojson));
    if (serialized.length > 950000) {
      sub.textContent = 'La capa es demasiado grande para generar un enlace público.';
      return;
    }
    await db.doc(`artifacts/${appId}/shared_links/${linkId}`).set({
      name: layer.name,
      geojson: serialized,
      color: layer.color || '#2f6fde',
      createdAt: Date.now(),
      createdBy: (auth.currentUser ? auth.currentUser.uid : 'anon')
    });
    const url = window.location.origin + window.location.pathname + '?share=' + linkId;
    box.textContent = url;
    box.style.display = 'block';
    acts.style.display = 'flex';
    sub.textContent = 'Enlace listo. Válido para cualquier persona.';
  } catch(e) {
    console.error('Error generando enlace:', e);
    sub.textContent = 'Error al generar el enlace. Inténtalo de nuevo.';
  }
}

async function loadSharedLayer(linkId) {
  try {
    const snap = await db.doc(`artifacts/${appId}/shared_links/${linkId}`).get();
    if (!snap.exists) {
      toast('El enlace no existe o ha caducado', 'err');
      history.replaceState(null, '', window.location.pathname);
      return;
    }
    const data = snap.data();
    const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
    // addShpLayer(geojson, name, cloudId, shouldSaveToCloud, shouldZoom)
    // Pass shouldSaveToCloud=false so it doesn't auto-save; user decides via banner
    const layer = addShpLayer(geojson, data.name, null, false, true, data.color || null);
    if (!layer) { toast('Error al cargar la capa compartida', 'err'); return; }
    // Mostrar banner para que el usuario decida si añadir a su proyecto
    const banner = document.getElementById('share-banner');
    document.getElementById('share-banner-title').textContent = '📍 ' + data.name;
    document.getElementById('share-banner-sub').textContent = 'Capa compartida. ¿Quieres añadirla a tu proyecto?';
    banner.style.display = 'block';
    window._pendingSharedLayer = layer;
    document.getElementById('share-banner-add').onclick = () => {
      banner.style.display = 'none';
      if (isFirebaseActive()) saveShpToCloud(window._pendingSharedLayer);
      toast('Capa "' + data.name + '" añadida al proyecto');
      window._pendingSharedLayer = null;
    };
    document.getElementById('share-banner-discard').onclick = () => {
      banner.style.display = 'none';
      map.removeLayer(layer.polyLayer);
      map.removeLayer(layer.pinLayer);
      shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);
      const el = document.querySelector('[data-layer-id="' + layer.id + '"]');
      if (el) el.remove();
      window._pendingSharedLayer = null;
    };
    history.replaceState(null, '', window.location.pathname);
  } catch(e) {
    console.error('Error cargando capa compartida:', e);
    toast('Error al cargar la capa compartida', 'err');
    history.replaceState(null, '', window.location.pathname);
  }
}


function latLngToUTM(lat, lng) {
  const a  = 6378137.0;
  const f  = 1 / 298.257223563;
  const b  = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e  = Math.sqrt(e2);
  const k0 = 0.9996;

  const latR = lat * Math.PI / 180;
  const zone = Math.floor((lng + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const lngR = lng * Math.PI / 180;

  const N  = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T  = Math.tan(latR) ** 2;
  const C  = (e2 / (1 - e2)) * Math.cos(latR) ** 2;
  const A  = Math.cos(latR) * (lngR - lon0);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M  = a * (
    (1 - e2/4 - 3*e4/64 - 5*e6/256) * latR
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latR)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*latR)
    - (35*e6/3072) * Math.sin(6*latR)
  );
  const A2 = A*A, A3 = A2*A, A4 = A3*A, A5 = A4*A, A6 = A5*A;

  const easting = k0 * N * (
    A + (1-T+C)*A3/6 + (5-18*T+T*T+72*C-58*(e2/(1-e2)))*A5/120
  ) + 500000;

  const northing = k0 * (
    M + N * Math.tan(latR) * (
      A2/2 + (5-T+9*C+4*C*C)*A4/24
      + (61-58*T+T*T+600*C-330*(e2/(1-e2)))*A6/720
    )
  ) + (lat < 0 ? 10000000 : 0);

  const hemi = lat >= 0 ? 'N' : 'S';
  return { zone, hemi, easting: Math.round(easting), northing: Math.round(northing) };
}

function utmLabel(lat, lng) {
  const u = latLngToUTM(lat, lng);
  return `${u.zone}${u.hemi} X:${u.easting} Y:${u.northing}`;
}

function buildSinglePopup(photo, key) {
  const div = document.createElement('div');
  div.className = 'popup-inner';
  const azTxt = photo.azimuth !== null
    ? `<span class="popup-coord-row">↗ Azimut: ${Math.round(photo.azimuth)}°</span>` : '';
  const utm = utmLabel(photo.lat, photo.lng);
  div.innerHTML = `
    <img src="${photo.thumb}" class="popup-img">
    <div class="popup-name">${esc(photo.name)}</div>
    <div class="popup-coord">
      <span class="popup-coord-row">${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}</span>
      <span class="popup-coord-utm">${utm}</span>
      ${azTxt}
    </div>
    <button class="popup-open-btn">Ver en grande</button>`;
  div.querySelector('.popup-img').onclick      = () => openLightbox(photo.thumb, photo.name);
  div.querySelector('.popup-open-btn').onclick = () => openLightbox(photo.thumb, photo.name);
  return div;
}

function buildMultiPopup(key) {
  const c = clusterMap[key];
  const div = document.createElement('div');
  div.className = 'cluster-popup';
  div.innerHTML = `
    <div class="cluster-popup-title">📷 ${c.photos.length} fotos en este punto</div>
    <div class="cluster-grid" id="cg-${key}"></div>
    <div class="cluster-detail" id="cd-${key}">
      <div class="cluster-detail-name"></div>
      <div class="cluster-detail-coord"></div>
      <button class="cluster-detail-btn">Ver en grande</button>
    </div>`;

  const grid   = div.querySelector(`#cg-${key}`);
  const detail = div.querySelector(`#cd-${key}`);

  c.photos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'cluster-item';
    const azBadge = p.azimuth !== null
      ? `<div class="cluster-item-az">${Math.round(p.azimuth)}°</div>` : '';
    item.innerHTML = `<img src="${p.thumb}">${azBadge}`;

    item.onclick = () => {
      grid.querySelectorAll('.cluster-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      refreshClusterMarker(key, i);
      highlightPhotoInSidebar(p.id);
      const azTxt = p.azimuth !== null ? `↗ ${Math.round(p.azimuth)}°` : '';
      detail.querySelector('.cluster-detail-name').textContent = p.name;
      const utm = utmLabel(p.lat, p.lng);
      detail.querySelector('.cluster-detail-coord').innerHTML =
        `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}<br><span style="color:var(--blue);font-size:8px;">${utm}</span>` + (azTxt ? `<br>${azTxt}` : '');
      detail.querySelector('.cluster-detail-btn').onclick = () => openLightbox(p.thumb, p.name);
      detail.classList.add('visible');
    };
    grid.appendChild(item);
  });
  return div;
}

// ═══════════════════════════════════════════════════════════════