// ════════════════════════════════════════════════════════
// MÓDULO: js/capas-shp.js
// CAPAS SHP + CLOUD SYNC
// ════════════════════════════════════════════════════════
// 8. CAPAS SHP / CLOUD SYNC
// ═══════════════════════════════════════════════════════════════
const shpLayers = [];
const SHP_PALETTE = ['#e06c00','#9b27c8','#c8270e','#0e8ec8','#2f6fde','#d4a017','#b05a00','#666'];

const shpFileInput  = document.getElementById('shpFileInput');
const shpDropzone   = document.getElementById('shp-dropzone');
const shpLoading    = document.getElementById('shp-loading');

shpFileInput.addEventListener('change', e => { handleShpFiles([...e.target.files]); e.target.value = ''; });
shpDropzone.addEventListener('dragover',  e => { e.preventDefault(); shpDropzone.classList.add('drag-over'); });
shpDropzone.addEventListener('dragleave', () => shpDropzone.classList.remove('drag-over'));
shpDropzone.addEventListener('drop', e => { e.preventDefault(); shpDropzone.classList.remove('drag-over'); handleShpFiles([...e.dataTransfer.files]); });

// Función principal corregida para el procesamiento de SHP (evitamos colisiones por elevación de variables)
async function processGenericShpFiles(files) {
  if (!files.length) return;
  shpLoading.style.display = 'flex';
  try {
    let geojson, layerName = 'Capa SHP';
    const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      const buf = await zipFile.arrayBuffer();
      geojson = await shp(buf);
      layerName = zipFile.name.replace(/\.zip$/i, '');
    } else {
      const shpFile = files.find(f => f.name.toLowerCase().endsWith('.shp'));
      const dbfFile = files.find(f => f.name.toLowerCase().endsWith('.dbf'));
      if (!shpFile || !dbfFile) { toast('Selecciona .shp + .dbf (y opcionalmente .shx y .prj)', 'err'); return; }
      layerName = shpFile.name.replace(/\.shp$/i, '');
      const loaded = await Promise.all(files.map(async f => ({
        ext: f.name.split('.').pop().toLowerCase(),
        buffer: await f.arrayBuffer()
      })));
      const shpBuf = loaded.find(r => r.ext === 'shp').buffer;
      const dbfBuf = loaded.find(r => r.ext === 'dbf').buffer;
      const prjEntry = loaded.find(r => r.ext === 'prj');
      // Si no hay .prj, proyectar automáticamente a WGS84 (la proyección del mapa)
      const prjStr = prjEntry
        ? new TextDecoder().decode(prjEntry.buffer)
        : SHP_PRJ_WGS84;
      if (!prjEntry) console.info('SHP sin .prj — se asume WGS84 automáticamente.');
      geojson = await shp.combine([
        shp.parseShp(shpBuf, prjStr),
        shp.parseDbf(dbfBuf)
      ]);
    }
    // Añadimos y sincronizamos (el flag 'true' guardará automáticamente en Firebase si hay sesión activa)
    addShpLayer(geojson, layerName, null, true);
    toast(`Capa "${layerName}" cargada`, 'ok');
  } catch(err) {
    console.error(err);
    toast('Error al cargar SHP: ' + err.message, 'err');
  } finally {
    shpLoading.style.display = 'none';
  }
}

const SHP_ZOOM_THRESHOLD = 14;
const VISITED_COLOR = '#2e7d32'; // Verde para geometrías marcadas como visitadas

// Configuración de campos personalizados por capa (hasta 5 etiquetas), persistida en localStorage/Firestore
const layerCustomFields = {};
function getCustomFields(layerId) {
  if (layerCustomFields[layerId]) {
    console.log('[CF] getCustomFields (memoria)', layerId, layerCustomFields[layerId]);
    return layerCustomFields[layerId];
  }
  try {
    const raw = JSON.parse(localStorage.getItem(`cf_${layerId}`) || 'null');
    if (Array.isArray(raw)) {
      layerCustomFields[layerId] = raw;
      console.log('[CF] getCustomFields (localStorage)', layerId, raw);
      return raw;
    }
  } catch(_) {}
  console.log('[CF] getCustomFields (default vacío)', layerId);
  return ['','','','',''];
}
function setCustomFields(layerId, fields) {
  const arr = [0,1,2,3,4].map(i => fields[i] || '');
  layerCustomFields[layerId] = arr;
  try { localStorage.setItem(`cf_${layerId}`, JSON.stringify(arr)); } catch(_) {}
}

// Lee el estado del checklist desde localStorage
function getChecklistData(layerId, fIdx) {
  try { return JSON.parse(localStorage.getItem(`cl_${layerId}_${fIdx}`) || 'null'); }
  catch(e) { return null; }
}

// Formatea una fecha de visita (timestamp numérico o string ya formateado) a "YYYY-MM-DD HH:MM"
function formatVisitDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return String(v);
}

// Devuelve un clon del geojson con _visitado / _tecnico / _fecha / _cN / _comentari / _visit_ts en cada feature
function enrichGeojsonWithChecklist(layerId, geojson) {
  const clone = JSON.parse(JSON.stringify(geojson));
  const feats = [];
  const collect = g => {
    if (!g) return;
    if (Array.isArray(g)) { g.forEach(collect); return; }
    if (g.type === 'FeatureCollection') g.features?.forEach(f => feats.push(f));
    else if (g.type === 'Feature') feats.push(g);
  };
  collect(clone);
  const customLabels = getCustomFields(layerId);
  feats.forEach((f, idx) => {
    f.properties = f.properties || {};
    const saved = getChecklistData(layerId, idx);
    f.properties._visitado  = saved?.visitado ? 1 : 0;
    f.properties._tecnico   = saved?.tecnico || '';
    f.properties._fecha     = formatVisitDate(saved?.visitDate);
    customLabels.forEach((label, i) => {
      if (!label || !label.trim()) return;
      f.properties['_c' + (i+1)] = (saved?.custom?.[i] || '').toString().slice(0, 50);
    });
    f.properties._comentari = (saved?.comentario || '').toString().slice(0, 250);
    f.properties._visit_ts  = saved?.ts || '';
  });
  return clone;
}

// Al importar una capa con campos _visitado / _tecnico / _fecha / _cN / _comentari, vuelca al localStorage
function importChecklistFromFeatures(layerId, features) {
  features.forEach((f, idx) => {
    const p = f.properties || {};
    const hasFlag = ('_visitado' in p) || ('_VISITADO' in p) || ('_comentari' in p) || ('_COMENTARI' in p)
      || ('_tecnico' in p) || ('_TECNICO' in p) || ('_fecha' in p) || ('_FECHA' in p)
      || ['1','2','3','4','5'].some(n => (`_c${n}` in p) || (`_C${n}` in p));
    if (!hasFlag) return;
    const key = `cl_${layerId}_${idx}`;
    if (localStorage.getItem(key)) return; // no pisar lo existente
    const visitadoRaw = p._visitado ?? p._VISITADO ?? 0;
    const visitado = (visitadoRaw === 1 || visitadoRaw === '1' || visitadoRaw === true || visitadoRaw === 'true');
    const comentario = (p._comentari ?? p._COMENTARI ?? '').toString();
    const tecnico = (p._tecnico ?? p._TECNICO ?? '').toString();
    const visitDate = (p._fecha ?? p._FECHA) || null;
    const custom = [1,2,3,4,5].map(n => (p['_c'+n] ?? p['_C'+n] ?? '').toString());
    const ts = Number(p._visit_ts ?? p._VISIT_TS) || Date.now();
    if (!visitado && !comentario && !tecnico && !custom.some(Boolean)) return;
    try { localStorage.setItem(key, JSON.stringify({ visitado, comentario, ts, tecnico, visitDate, custom })); } catch(_) {}
    // Limpia las props internas para no contaminar la UI
    delete p._visitado; delete p._VISITADO;
    delete p._comentari; delete p._COMENTARI;
    delete p._tecnico; delete p._TECNICO;
    delete p._fecha; delete p._FECHA;
    [1,2,3,4,5].forEach(n => { delete p['_c'+n]; delete p['_C'+n]; });
    delete p._visit_ts; delete p._VISIT_TS;
  });
}

// Actualiza el color de un feature concreto al marcar/desmarcar como visitado
function updateFeatureVisitedStyle(layerId, featureIdx, visitado) {
  const layer = shpLayers.find(l => l.id === layerId);
  if (!layer) return;
  const newColor = visitado ? VISITED_COLOR : layer.color;

  // Actualizar polígono/línea/punto en polyLayer
  let fCount = 0;
  layer.polyLayer.eachLayer(sub => {
    if (fCount === featureIdx) {
      if (typeof sub.setStyle === 'function') {
        sub.setStyle({ color: newColor, fillColor: newColor, weight: 2, fillOpacity: 0.25 });
      } else if (sub.setIcon) {
        // Es un marker de punto — actualizar icono directamente
        sub.setIcon(buildPinIcon(newColor));
      }
    }
    fCount++;
  });

  // Actualizar pin en pinLayer
  const allFeatures = [];
  const collect = g => {
    if (!g) return;
    if (Array.isArray(g)) { g.forEach(collect); return; }
    if (g.type === 'FeatureCollection') g.features?.forEach(f => allFeatures.push(f));
    else if (g.type === 'Feature') allFeatures.push(g);
  };
  collect(layer.geojson);

  const pins = [];
  layer.pinLayer.eachLayer(m => pins.push(m));
  if (pins[featureIdx]) {
    const f = allFeatures[featureIdx];
    const c = featureCentroid(f);
    if (c) {
      layer.pinLayer.removeLayer(pins[featureIdx]);
      L.marker(c, { icon: buildPinIcon(newColor) })
        .bindPopup(buildPopupHtml(f.properties, layerId, featureIdx))
        .addTo(layer.pinLayer);
    }
  }
}

function buildPinIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
    <path d="M11 0C4.925 0 0 4.925 0 11c0 7.333 11 19 11 19s11-11.667 11-19C22 4.925 17.075 0 11 0z"
      fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="11" cy="11" r="4.5" fill="white" opacity="0.85"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 30], iconAnchor: [11, 30], popupAnchor: [0, -30] });
}

function featureCentroid(feature) {
  const geom = feature.geometry;
  if (!geom) return null;
  const collect = coords => {
    if (typeof coords[0] === 'number') return [coords];
    return coords.flatMap(collect);
  };
  let pts;
  if (geom.type === 'Point') pts = [geom.coordinates];
  else if (geom.type === 'MultiPoint') pts = geom.coordinates;
  else if (geom.type === 'LineString') pts = geom.coordinates;
  else if (geom.type === 'MultiLineString') pts = geom.coordinates.flat();
  else if (geom.type === 'Polygon') pts = geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') pts = geom.coordinates.flat(2);
  else pts = collect(geom.coordinates ?? []);
  if (!pts?.length) return null;
  const sumLng = pts.reduce((s, p) => s + p[0], 0);
  const sumLat = pts.reduce((s, p) => s + p[1], 0);
  return [sumLat / pts.length, sumLng / pts.length];
}

function buildPopupHtml(properties, layerId, featureIdx) {
  const hasChecklist = layerId != null;

  // ── Panel de atributos ──
  let attrsHtml = '<div style="font-family:DM Sans,sans-serif;font-size:10px;max-height:140px;overflow:auto;padding:2px 0;">';
  if (!properties) attrsHtml += '<i style="color:#aaa">Sin atributos</i>';
  else for (const k in properties) attrsHtml += `<b>${esc(k)}:</b> ${esc(String(properties[k] ?? ''))}<br>`;
  attrsHtml += '</div>';

  if (!hasChecklist) return attrsHtml;

  // ── Panel checklist ──
  const clKey = `cl_${layerId}_${featureIdx}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(clKey) || 'null'); } catch(e) { return null; } })();
  const visitado = saved?.visitado || false;
  const comentario = saved?.comentario || '';
  const customVals = saved?.custom || ['','','','',''];
  const badgeDot = visitado ? '<span class="cl-badge"></span>' : '';

  const customLabels = getCustomFields(layerId);
  let customFieldsHtml = '';
  customLabels.forEach((label, i) => {
    if (!label || !label.trim()) return;
    customFieldsHtml += `
    <div class="cl-field-row">
      <label class="cl-field-label" for="cl-cf-${clKey}-${i}">${esc(label)}</label>
      <input type="text" class="cl-field-input" id="cl-cf-${clKey}-${i}" value="${esc(customVals[i] || '')}">
    </div>`;
  });

  const clHtml = `
    <div class="cl-row">
      <input type="checkbox" class="cl-checkbox" id="cl-cb-${clKey}" ${visitado ? 'checked' : ''}>
      <label class="cl-label" for="cl-cb-${clKey}" style="cursor:pointer;">Marcado como visitado</label>
    </div>
    ${customFieldsHtml}
    <div style="margin-bottom:6px;">
      <div class="cl-label" style="margin-bottom:4px;">Observaciones</div>
      <textarea class="cl-textarea" id="cl-ta-${clKey}" placeholder="Añade una nota…">${esc(comentario)}</textarea>
    </div>
    <button class="cl-save-btn" id="cl-btn-${clKey}">Guardar</button>
    <div class="cl-saved-msg" id="cl-msg-${clKey}">✓ Guardado</div>`;



  return `<div style="width:280px;">
    <div class="popup-tabs">
      <div class="popup-tab active" data-tab="attrs">Atributos</div>
      <div class="popup-tab" data-tab="checklist">Checklist ${badgeDot}</div>
    </div>
    <div class="popup-tab-panel active" data-panel="attrs">${attrsHtml}</div>
    <div class="popup-tab-panel" data-panel="checklist">${clHtml}</div>
  </div>`;
}

// ── Agregar Capa Vectorial (Modificada con integración de base de datos) ──
function addShpLayer(geojson, name, cloudId = null, shouldSaveToCloud = false, shouldZoom = true, forceColor = null) {
  const id    = cloudId || Math.random().toString(36).slice(2, 11);
  
  if (shpLayers.some(l => l.id === id)) return;

  // Usar el color forzado (de nube/edición) o asignar uno nuevo de la paleta
  // Nunca asignar el color verde reservado para "Visitado"
  let paletteColor = SHP_PALETTE[shpLayers.length % SHP_PALETTE.length];
  while (paletteColor === VISITED_COLOR) {
    paletteColor = SHP_PALETTE[(shpLayers.length + 1) % SHP_PALETTE.length];
  }
  const color = (forceColor && forceColor !== VISITED_COLOR) ? forceColor : paletteColor;

  const countFeatures = g => {
    if (!g) return 0;
    if (Array.isArray(g)) return g.reduce((s, x) => s + countFeatures(x), 0);
    if (g.type === 'FeatureCollection') return g.features?.length || 0;
    if (g.type === 'Feature') return 1;
    return 0;
  };
  const featureCount = countFeatures(geojson);

  const allFeatures = [];
  const collect = g => {
    if (!g) return;
    if (Array.isArray(g)) { g.forEach(collect); return; }
    if (g.type === 'FeatureCollection') g.features?.forEach(f => allFeatures.push(f));
    else if (g.type === 'Feature') allFeatures.push(g);
  };
  collect(geojson);
  // Importa checklist embebido (si el SHP/GeoJSON viene de export/share)
  importChecklistFromFeatures(id, allFeatures);


  const polyLayer = L.geoJSON(geojson, {
    style: f => {
      const fIdx = allFeatures.indexOf(f);
      const clKey = `cl_${id}_${fIdx}`;
      const saved = (() => { try { return JSON.parse(localStorage.getItem(clKey) || 'null'); } catch(e) { return null; } })();
      const c = saved?.visitado ? VISITED_COLOR : color;
      return { color: c, weight: 2, fillOpacity: 0.25, fillColor: c };
    },
    pointToLayer: (f, latlng) => {
      const fIdx = allFeatures.indexOf(f);
      const clKey = `cl_${id}_${fIdx}`;
      const saved = (() => { try { return JSON.parse(localStorage.getItem(clKey) || 'null'); } catch(e) { return null; } })();
      const c = saved?.visitado ? VISITED_COLOR : color;
      return L.marker(latlng, { icon: buildPinIcon(c) });
    },
    onEachFeature: (f, l, fIdx = allFeatures.indexOf(f)) => { l.bindPopup(() => buildPopupHtml(f.properties, id, fIdx)); }
  });

  const pinLayer = L.layerGroup();
  allFeatures.forEach((f, fIdx) => {
    const c = featureCentroid(f);
    if (!c) return;
    const clKey = `cl_${id}_${fIdx}`;
    const saved = (() => { try { return JSON.parse(localStorage.getItem(clKey) || 'null'); } catch(e) { return null; } })();
    const pinColor = saved?.visitado ? VISITED_COLOR : color;
    L.marker(c, { icon: buildPinIcon(pinColor) })
      .bindPopup(buildPopupHtml(f.properties, id, fIdx))
      .addTo(pinLayer);
  });

  const zoom = map.getZoom();
  const showPins = zoom < SHP_ZOOM_THRESHOLD;
  if (showPins) pinLayer.addTo(map);
  else polyLayer.addTo(map);

  function onZoom() {
    if (!obj.visible) return;
    const z = map.getZoom();
    if (z < SHP_ZOOM_THRESHOLD) {
      if (map.hasLayer(polyLayer)) { map.removeLayer(polyLayer); pinLayer.addTo(map); }
    } else {
      if (map.hasLayer(pinLayer)) { map.removeLayer(pinLayer); polyLayer.addTo(map); }
    }
  }
  map.on('zoomend', onZoom);

  const leafletLayer = {
    _onZoom: onZoom,
    addTo(m) {
      const z = m.getZoom();
      if (z < SHP_ZOOM_THRESHOLD) pinLayer.addTo(m); else polyLayer.addTo(m);
    },
    remove() { map.removeLayer(polyLayer); map.removeLayer(pinLayer); },
    getBounds() { return polyLayer.getBounds(); },
    setStyle(s) {
      const newColor = s.color || color;
      // Actualizar polyLayer: polígonos/líneas con setStyle, puntos recreando el marker
      let i = 0;
      polyLayer.eachLayer(sub => {
        const saved = getChecklistData(id, i);
        const c = saved?.visitado ? VISITED_COLOR : newColor;
        if (typeof sub.setStyle === 'function') {
          sub.setStyle({ color: c, fillColor: c, weight: 2, fillOpacity: 0.25 });
        } else if (sub.setIcon) {
          // Es un marker (punto) — recrear icono con nuevo color
          sub.setIcon(buildPinIcon(c));
        }
        i++;
      });
      // Actualizar pinLayer (zoom alejado)
      pinLayer.clearLayers();
      allFeatures.forEach((f, fIdx) => {
        const c = featureCentroid(f);
        if (!c) return;
        const saved = getChecklistData(id, fIdx);
        const pc = saved?.visitado ? VISITED_COLOR : newColor;
        L.marker(c, { icon: buildPinIcon(pc) })
          .bindPopup(() => buildPopupHtml(f.properties, id, fIdx))
          .addTo(pinLayer);
      });
    }
  };

  const obj = { id, name, geojson, leafletLayer, polyLayer, pinLayer, color, visible: true, featureCount };
  shpLayers.push(obj);

  if (shouldZoom) {
    try {
      const bounds = polyLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });
    } catch(_) {}
  }

  addShpToUnifiedList(obj);
  updateCounter();

  // Guardar en la nube si Firebase está activo, el usuario está conectado y se solicita
  if (shouldSaveToCloud && isFirebaseActive()) {
    saveShpToCloud(obj);
  }
}

function addShpToUnifiedList(layer) {
  const list = document.getElementById('unifiedList');
  document.getElementById('unified-empty').style.display = 'none';

  const item = document.createElement('div');
  item.className = 'list-item';
  item.dataset.id   = layer.id;
  item.dataset.type = 'shp';
  item.innerHTML = `
    <input type="checkbox" class="photo-vis shp-vis" checked title="Mostrar capa"
      style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer;flex-shrink:0;">
    <div class="item-info">
      <div class="item-name" title="${esc(layer.name)}">${esc(layer.name)}</div>
      <div class="item-sub">${layer.featureCount} recintos · SHP</div>
    </div>
    <div class="item-actions">
      <button class="shp-tree-toggle collapsed" title="Ver geometrías">▼</button>
      <div class="layer-cloud-off" title="Capa no sincronizada (sólo local)" style="display:${layer.synced === false ? 'flex' : 'none'};">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.5-.27"/><path d="M9.5 6.5A7 7 0 0 1 22 13a4.5 4.5 0 0 1-1.5 3.5"/></svg>
      </div>
      <button class="shp-edit-btn" title="Editar nombre y color">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <div class="shp-color-dot" style="background:${layer.color}">
        <input class="shp-color-input" type="color" value="${layer.color}">
      </div>
      <button class="shp-icon-btn shp-share" title="Compartir / Descargar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
      </button>
      <button class="item-del" title="Eliminar">✕</button>
    </div>`;

  // Contenedor de hijos (árbol colapsado por defecto, se puebla en el primer expand)
  const childrenEl = document.createElement('div');
  childrenEl.className = 'shp-children collapsed';
  childrenEl.dataset.layerId   = layer.id;
  childrenEl.dataset.populated = 'false';

  item.querySelector('.shp-tree-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const isCollapsed = childrenEl.classList.contains('collapsed');
    childrenEl.classList.toggle('collapsed', !isCollapsed);
    item.querySelector('.shp-tree-toggle').classList.toggle('collapsed', !isCollapsed);
    if (isCollapsed && childrenEl.dataset.populated === 'false') {
      populateShpChildren(layer, childrenEl);
      childrenEl.dataset.populated = 'true';
    }
  });

  item.querySelector('.shp-edit-btn').addEventListener('click', e => {
    e.stopPropagation();
    openLayerEditModal(layer, item);
  });

  item.querySelector('.shp-vis').addEventListener('change', e => {
    e.stopPropagation();
    layer.visible = e.target.checked;
    if (e.target.checked) {
      layer.leafletLayer.addTo(map);
    } else {
      map.removeLayer(layer.polyLayer);
      map.removeLayer(layer.pinLayer);
    }
    item.classList.toggle('hidden-photo', !e.target.checked);
    if (typeof syncLabelGroupVisibility === 'function') syncLabelGroupVisibility(layer.id);
  });

  item.querySelector('.item-name').addEventListener('click', e => {
    e.stopPropagation();
    try { map.fitBounds(layer.polyLayer.getBounds(), { padding: [60, 60] }); } catch(_) {}
  });

  // Compartir / Descargar capa
  item.querySelector('.shp-share').addEventListener('click', e => {
    e.stopPropagation();
    openShareModal(layer);
  });

  // Marcar botón compartir si la capa ya es colaborativa al renderizarse
  if (layer._isCollab || layer._hasCollaborators) {
    item.querySelector('.shp-share')?.classList.add('collab-active');
  }

  item.querySelector('.item-del').addEventListener('click', e => {
    e.stopPropagation();
    const doDelete = () => {
      map.removeLayer(layer.polyLayer);
      map.removeLayer(layer.pinLayer);
      if (layer.leafletLayer._onZoom) map.off('zoomend', layer.leafletLayer._onZoom);
      shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);
      item.remove();
      document.querySelector(`.shp-children[data-layer-id="${layer.id}"]`)?.remove();
      if (isFirebaseActive()) deleteShpFromCloud(layer.id);
      if (typeof removeLayerLabels === 'function') removeLayerLabels(layer.id);
      toast(`Capa "${layer.name}" eliminada`);
      updateCounter();
    };
    if (typeof window.showDeleteConfirm === 'function') {
      window.showDeleteConfirm(layer.name, doDelete);
    } else if (confirm(`¿Eliminar la capa "${layer.name}"?\n\nEsta acción no se puede deshacer y la capa también se borrará de la nube si está sincronizada.`)) {
      doDelete();
    }
  });

  list.appendChild(item);
  list.appendChild(childrenEl);
  updateCounter();
}

// ── Nombre identificativo de una feature ────────────────────
function _featLabel(feature, idx) {
  const p = feature.properties || {};
  for (const k of ['Codigo','CODIGO','codigo','COD_REGA','cod_rega']) {
    if (p[k] !== undefined && p[k] !== null && String(p[k]).trim()) return String(p[k]).trim().slice(0, 60);
  }
  for (const v of Object.values(p)) {
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim().slice(0, 60);
  }
  const t = feature.geometry?.type;
  return `${t === 'Point' ? 'Punto' : t === 'LineString' ? 'Línea' : 'Polígono'} ${idx + 1}`;
}

// ── Poblar árbol de geometrías ───────────────────────────────
function populateShpChildren(layer, container) {
  container.innerHTML = '';
  const allFeats = [];
  const collect = g => {
    if (!g) return;
    if (Array.isArray(g)) { g.forEach(collect); return; }
    if (g.type === 'FeatureCollection') g.features?.forEach(f => allFeats.push(f));
    else if (g.type === 'Feature') allFeats.push(g);
  };
  collect(layer.geojson);

  allFeats.forEach((feat, idx) => {
    const label = _featLabel(feat, idx);
    const row = document.createElement('div');
    row.className = 'shp-feat-item';
    row.innerHTML = `<span class="shp-feat-name" title="${esc(label)}">${esc(label)}</span><button class="shp-feat-del" title="Eliminar esta geometría">✕</button>`;

    // Clic en nombre → zoom a la geometría
    row.querySelector('.shp-feat-name').addEventListener('click', e => {
      e.stopPropagation();
      try {
        const b = L.geoJSON(feat).getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [60, 60], maxZoom: 18 });
      } catch(_) {}
    });

    // ✕ → confirmar y eliminar
    row.querySelector('.shp-feat-del').addEventListener('click', e => {
      e.stopPropagation();
      const doDelete = () => {
        const fc = layer.geojson;
        if (fc?.features) { const i = fc.features.indexOf(feat); if (i !== -1) fc.features.splice(i, 1); }
        const savedColor  = layer.color;
        const savedLabels = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
          ? { fields:[...layerLabels[layer.id].fields], visible:layerLabels[layer.id].visible,
              color:layerLabels[layer.id].color, size:layerLabels[layer.id].size }
          : null;
        if (typeof removeLayerLabels === 'function') removeLayerLabels(layer.id);
        map.removeLayer(layer.polyLayer);
        if (layer.pinLayer) map.removeLayer(layer.pinLayer);
        map.off('zoomend', layer.leafletLayer?._onZoom);
        document.querySelector(`.list-item[data-id="${layer.id}"]`)?.remove();
        document.querySelector(`.shp-children[data-layer-id="${layer.id}"]`)?.remove();
        shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);
        addShpLayer({...layer.geojson}, layer.name, layer.id, true, false, savedColor);
        if (savedLabels) {
          const rebuilt = shpLayers.find(l => l.id === layer.id);
          if (rebuilt && typeof restoreLayerLabels === 'function') restoreLayerLabels(rebuilt, savedLabels);
        }
        // Reabrir árbol en el nuevo item
        const newC = document.querySelector(`.shp-children[data-layer-id="${layer.id}"]`);
        const newItem = document.querySelector(`.list-item[data-id="${layer.id}"]`);
        if (newC && newItem) {
          populateShpChildren(shpLayers.find(l => l.id === layer.id), newC);
          newC.dataset.populated = 'true';
          newC.classList.remove('collapsed');
          newItem.querySelector('.shp-tree-toggle')?.classList.remove('collapsed');
        }
        if (typeof isFirebaseActive === 'function' && isFirebaseActive()) saveShpToCloud(shpLayers.find(l => l.id === layer.id));
        updateCounter();
        toast(`Geometría "${label}" eliminada`, 'ok');
      };
      if (typeof window.showDeleteConfirm === 'function') {
        window.showDeleteConfirm(label, doDelete);
      } else if (confirm(`¿Eliminar "${label}"?\nEsta acción no se puede deshacer.`)) {
        doDelete();
      }
    });

    container.appendChild(row);
  });
}

function exportShpKML(id) {
  const layer = shpLayers.find(l => l.id === id);
  if (!layer) return;
  try {
    const kml = tokml(enrichGeojsonWithChecklist(layer.id, layer.geojson));
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = layer.name + '.kml'; a.click();
    URL.revokeObjectURL(url);
    toast(`KML "${layer.name}" descargado`, 'ok');
  } catch(err) { toast('Error al exportar KML: ' + err.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════════