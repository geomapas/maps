// ════════════════════════════════════════════════════════
// MÓDULO: js/foto-geo.js
// FOTOS GEORREFERENCIADAS CON RECINTO SIGPAC
//   1) Pulsas el icono de cámara y luego un recinto SIGPAC en el mapa.
//   2) Se abre el modal de cámara (cámara trasera, GPS y brújula en vivo).
//   3) Cada foto lleva impreso:
//        · abajo-izquierda: minimapa con la ortofoto, el recinto, tu posición y una flecha de rumbo
//        · abajo-derecha: referencia SIGPAC, coordenadas (lat/lon + UTM), fecha y hora
//   4) Se guarda como JPG con EXIF (GPS + azimut) y se añade a la lista de fotos del mapa.
// Depende de: map, WMS_URL, buildGFIParams, extractData, fetchRecintoGeom, utmLabel,
//             baseLayers, processFiles, toast (todos ya definidos en los otros módulos).
// ════════════════════════════════════════════════════════
(function () {
  'use strict';

  const PIEXIF_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/piexifjs/1.0.6/piexif.min.js';
  const MM_HALF_M    = 100;   // semialto/ancho del minimapa en metros sobre el terreno
  const MM_FETCH_PX  = 400;   // resolución de la imagen de ortofoto que se pide
  const MM_REFETCH_M = 25;    // distancia a la que se vuelve a pedir la ortofoto
  const CLM_ORTO_FALLBACK = 'https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2024/MapServer/WMSServer';

  // ── Estado ──────────────────────────────────────────────
  let armed = false;          // esperando que el usuario pulse un recinto
  let sel = null;             // { ref, parts:[…], ring:[LatLng] }
  let pos = null;             // { lat, lng, acc }
  let heading = null;         // grados respecto al norte (0-360) o null
  let compassSeen = false;
  let stream = null, watchId = null, camOk = false;
  let mm = null, mmBusy = false;  // caché de minimapa: { img, cx, cy, half }
  let lastCanvas = null, lastSnap = null;
  let hlPoly = null;

  // ── Estilos ─────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  /* Ajusta aquí la posición del botón en escritorio si choca con otros */
  #photo-geo-btn{position:absolute;z-index:997;right:12px;bottom:350px;width:34px;height:34px;border-radius:8px;cursor:pointer;
    background:var(--glass);border:1px solid var(--glass-border);box-shadow:var(--shadow);backdrop-filter:blur(14px);
    display:flex;align-items:center;justify-content:center;color:var(--text2);transition:all .2s;}
  #photo-geo-btn.active{background:var(--blue);color:#fff;border-color:var(--blue);box-shadow:0 0 0 3px rgba(47,111,222,.25),var(--shadow);}
  #photo-geo-btn:hover{border-color:var(--blue,#2f6fde);color:var(--blue,#2f6fde);}
  #photo-geo-btn.active,#mob-photo-geo-btn.active{background:var(--blue,#2f6fde);color:#fff;border-color:var(--blue,#2f6fde);}
  @media (max-width:700px){#photo-geo-btn{display:none;}}
  #pg-modal{position:fixed;inset:0;z-index:20000;background:#000;display:none;flex-direction:column;font-family:'DM Sans',sans-serif;color:#fff;}
  #pg-modal.open{display:flex;}
  .pg-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;padding-top:max(10px,env(safe-area-inset-top));background:rgba(0,0,0,.6);}
  .pg-ref{font-size:12px;font-weight:700;letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .pg-x{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px 8px;}
  .pg-stage{flex:1;position:relative;min-height:0;display:flex;align-items:center;justify-content:center;background:#000;}
  .pg-stage video,.pg-stage img{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;}
  .pg-stage img{display:none;}
  .pg-status{position:absolute;left:0;right:0;top:0;padding:6px 12px;font-size:11px;background:rgba(0,0,0,.45);text-align:center;}
  .pg-bar{display:flex;align-items:center;justify-content:center;gap:18px;padding:14px;padding-bottom:max(14px,env(safe-area-inset-bottom));background:rgba(0,0,0,.6);}
  .pg-btn{border:none;border-radius:10px;padding:10px 16px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;background:#333;color:#fff;}
  .pg-btn.primary{background:var(--blue,#2f6fde);}
  .pg-btn[disabled]{opacity:.4;cursor:not-allowed;}
  .pg-stage{touch-action:none;overflow:hidden;}
  .pg-stage video{transform-origin:center center;}
  .pg-zoom{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px;background:rgba(0,0,0,.5);}
  .pg-zoom input{width:140px;accent-color:#fff;}
  .pg-zoom span{font-size:12px;font-weight:700;min-width:34px;text-align:center;cursor:pointer;}
  .pg-shutter{width:68px;height:68px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.25);cursor:pointer;padding:0;}
  .pg-shutter:active{background:#fff;}
  .pg-shutter[disabled]{opacity:.35;cursor:not-allowed;}
  `;
  document.head.appendChild(css);

  // ── Botones de entrada (escritorio + móvil) ─────────────
  const camSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

  const deskBtn = document.createElement('button');
  deskBtn.id = 'photo-geo-btn';
  deskBtn.title = 'Foto georreferenciada (elige un recinto)';
  deskBtn.innerHTML = camSvg;
  (document.querySelector('.main') || document.body).appendChild(deskBtn);

  const mobZone = document.getElementById('mob-tools-zone');
  let mobBtn = null;
  if (mobZone) {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    mobBtn = document.createElement('button');
    mobBtn.id = 'mob-photo-geo-btn';
    mobBtn.className = 'mob-tool-btn';
    mobBtn.title = 'Foto georreferenciada';
    mobBtn.setAttribute('aria-label', 'Foto georreferenciada');
    mobBtn.innerHTML = camSvg;
    wrap.appendChild(mobBtn);
    mobZone.appendChild(wrap);
  }
  const setBtnActive = on => {
    deskBtn.classList.toggle('active', on);
    mobBtn?.classList.toggle('active', on);
  };

  // ── Modal ───────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'pg-modal';
  modal.innerHTML = `
    <div class="pg-top"><div class="pg-ref" id="pg-ref"></div><button class="pg-x" id="pg-close" aria-label="Cerrar">✕</button></div>
    <div class="pg-stage">
      <video id="pg-video" playsinline muted autoplay></video>
      <img id="pg-preview" alt="Vista previa">
      <div class="pg-status" id="pg-status">Iniciando…</div>
      <div class="pg-zoom" id="pg-zoom"><span id="pg-zoom-val" title="Restablecer zoom">1.0×</span><input type="range" id="pg-zoom-range" min="1" max="5" step="0.1" value="1"></div>
    </div>
    <div class="pg-bar" id="pg-bar-live">
      <button class="pg-btn" id="pg-file" title="Usar la cámara del sistema" style="visibility:hidden;">Cámara del sistema</button>
      <button class="pg-shutter" id="pg-shutter" disabled aria-label="Hacer foto"></button>
      <span style="width:44px;"></span>
    </div>
    <div class="pg-bar" id="pg-bar-prev" style="display:none;">
      <button class="pg-btn" id="pg-retake">Repetir</button>
      <button class="pg-btn primary" id="pg-save">Guardar</button>
    </div>
    <input type="file" id="pg-file-input" accept="image/*" capture="environment" style="display:none;">`;
  document.body.appendChild(modal);

  const $ = id => document.getElementById(id);
  const video = $('pg-video'), preview = $('pg-preview'), statusEl = $('pg-status');
  const shutter = $('pg-shutter'), barLive = $('pg-bar-live'), barPrev = $('pg-bar-prev');

  // ── Selección de recinto ────────────────────────────────
  function stopOtherTools() {
    if (typeof window.applyQueryMode === 'function') window.applyQueryMode('none');
    if (typeof window.closeDrawBar === 'function' && typeof drawActive !== 'undefined' && drawActive) window.closeDrawBar();
    if (typeof window.closeSelBar === 'function') window.closeSelBar();
    if (typeof window.closeDskGpsBar === 'function') window.closeDskGpsBar();
    if (typeof globeActive !== 'undefined' && globeActive && typeof stopGlobeTool === 'function') stopGlobeTool();
    if (typeof measureMode !== 'undefined' && measureMode && typeof stopMeasure === 'function') stopMeasure();
  }

  function restorePopups() {
    const other = (typeof queryMode !== 'undefined' && queryMode !== 'none') ||
                  (typeof drawActive !== 'undefined' && drawActive) ||
                  (typeof globeActive !== 'undefined' && globeActive) ||
                  window._selActive;
    if (!other && typeof setShpPopupsForQuery === 'function') setShpPopupsForQuery(false);
  }

  function arm() {
    // En iOS el permiso de brújula debe pedirse dentro de un gesto del usuario (este clic)
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
    } catch (_) {}
    stopOtherTools();
    armed = true;
    setBtnActive(true);
    map.getContainer().style.cursor = 'crosshair';
    if (typeof setShpPopupsForQuery === 'function') setShpPopupsForQuery(true);
    map.on('click', onPickRecinto);
    toast('Pulsa sobre el recinto SIGPAC donde vas a hacer fotos');
  }

  function disarm() {
    armed = false;
    setBtnActive(false);
    map.getContainer().style.cursor = '';
    map.off('click', onPickRecinto);
    restorePopups();
  }

  async function onPickRecinto(e) {
    if (!armed) return;
    toast('Consultando recinto…');
    try {
      const size = map.getSize();
      const point = map.latLngToContainerPoint(e.latlng);
      const bounds = map.getBounds();
      const params = buildGFIParams('recinto', point, size, bounds, 'text/html');
      const html = await (await fetch(`${WMS_URL}?${params}`)).text();
      const d = extractData(html);
      const g = k => (d && d[k] && d[k] !== '—') ? String(d[k]).trim() : null;
      const parts = ['PROVINCIA', 'MUNICIPIO', 'AGREGADO', 'ZONA', 'POLIGONO', 'PARCELA', 'RECINTO'].map(g);
      if (!d || parts.some(p => p === null)) { toast('No hay recinto SIGPAC en ese punto', 'err'); return; }

      let ring = null;
      try { ring = await fetchRecintoGeom(e.latlng, size, bounds); } catch (_) {}

      disarm();
      sel = { ref: parts.join(':'), parts, ring: (ring && ring.length >= 3) ? ring : null };
      if (hlPoly) { map.removeLayer(hlPoly); hlPoly = null; }
      if (sel.ring) {
        hlPoly = L.polygon(sel.ring, { color: '#ff9800', weight: 3, fillOpacity: 0.12, interactive: false }).addTo(map);
      }
      openModal();
    } catch (err) {
      console.error('foto-geo: error al consultar recinto', err);
      toast('Error al consultar el recinto', 'err');
    }
  }

  function toggleArm() { armed ? (disarm(), toast('Selección cancelada')) : arm(); }
  deskBtn.addEventListener('click', e => { e.stopPropagation(); toggleArm(); });
  mobBtn?.addEventListener('click', e => { e.stopPropagation(); toggleArm(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('open')) closeModal();
    else if (armed) { disarm(); toast('Selección cancelada'); }
  });

  // ── Brújula ─────────────────────────────────────────────
  // Rumbo hacia el que apunta la parte trasera del dispositivo (cámara trasera).
  function compassHeading(alpha, beta, gamma) {
    const d = Math.PI / 180;
    const z = alpha * d, x = beta * d, y = gamma * d;
    const cA = Math.cos(z), sA = Math.sin(z), sB = Math.sin(x), cB = Math.cos(x), sG = Math.sin(y), cG = Math.cos(y);
    const vx = -cA * sG - sA * sB * cG;
    const vy = -sA * sG + cA * sB * cG;
    let h = Math.atan2(vx, vy) / d;
    if (h < 0) h += 360;
    return h;
  }
  function setHeading(h) {
    if (heading === null) heading = h;
    else {
      let diff = ((h - heading + 540) % 360) - 180;
      heading = (heading + diff * 0.25 + 360) % 360;
    }
    refreshStatus();
  }
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha != null && e.beta != null && e.gamma != null && (e.absolute || e.type === 'deviceorientationabsolute')) {
      h = compassHeading(e.alpha, e.beta, e.gamma);
    }
    if (h === null || isNaN(h)) return;
    compassSeen = true;
    setHeading(h);
  }

  // ── GPS ─────────────────────────────────────────────────
  function startGps() {
    if (!navigator.geolocation) { statusEl.textContent = 'Geolocalización no disponible'; return; }
    watchId = navigator.geolocation.watchPosition(p => {
      pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!compassSeen && typeof p.coords.heading === 'number' && !isNaN(p.coords.heading) && (p.coords.speed || 0) > 1) {
        setHeading(p.coords.heading);
      }
      maybeRefreshMinimap();
      refreshStatus();
    }, err => {
      const msgs = { 1: 'Permiso de ubicación denegado', 2: 'Posición no disponible', 3: 'Sin señal GPS' };
      statusEl.textContent = 'GPS: ' + (msgs[err.code] || err.message);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  function stopGps() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }

  function refreshStatus() {
    if (!modal.classList.contains('open')) return;
    if (!pos) { statusEl.textContent = 'Esperando señal GPS…'; shutter.disabled = true; return; }
    statusEl.textContent = `GPS ±${Math.round(pos.acc)} m · ` + (heading !== null ? `Rumbo ${Math.round(heading)}°` : 'Sin brújula');
    shutter.disabled = !(camOk || true) ? true : false;
  }

  // ── Minimapa (ortofoto) ─────────────────────────────────
  function loadImg(url) {
    return new Promise(res => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = url;
    });
  }

  async function fetchMinimap(lat, lng) {
    const m = map.options.crs.project(L.latLng(lat, lng));
    const half = MM_HALF_M / Math.cos(lat * Math.PI / 180);
    const bbox = [m.x - half, m.y - half, m.x + half, m.y + half].join(',');
    const base = (baseLayers.sigpac && baseLayers.sigpac._url) || CLM_ORTO_FALLBACK;
    let img = await loadImg(`${base}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=0&STYLES=&FORMAT=image/jpeg&SRS=EPSG:3857&BBOX=${bbox}&WIDTH=${MM_FETCH_PX}&HEIGHT=${MM_FETCH_PX}`);
    if (!img) {
      img = await loadImg(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${MM_FETCH_PX},${MM_FETCH_PX}&format=jpg&f=image`);
    }
    return img ? { img, cx: m.x, cy: m.y, half } : null;
  }

  function mmCovers(p, margin) {
    if (!mm) return false;
    const m = map.options.crs.project(L.latLng(p.lat, p.lng));
    return Math.abs(m.x - mm.cx) < mm.half * margin && Math.abs(m.y - mm.cy) < mm.half * margin;
  }

  async function maybeRefreshMinimap(force) {
    if (!pos || mmBusy) return;
    if (!force && mmCovers(pos, 0.35)) return; // todavía centrado: no hace falta pedir otra
    mmBusy = true;
    try {
      const r = await fetchMinimap(pos.lat, pos.lng);
      if (r) mm = r;
    } finally { mmBusy = false; }
  }

  // ── Composición de la foto ──────────────────────────────
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawMinimap(g, x, y, size, snap, u) {
    g.save();
    roundRect(g, x, y, size, size, 10 * u);
    g.clip();
    g.fillStyle = '#2b2b2b';
    g.fillRect(x, y, size, size);

    const ok = snap.mm && Math.abs(map.options.crs.project(L.latLng(snap.lat, snap.lng)).x - snap.mm.cx) < snap.mm.half
                       && Math.abs(map.options.crs.project(L.latLng(snap.lat, snap.lng)).y - snap.mm.cy) < snap.mm.half;
    // Si no hay ortofoto se centra el mapa en la posición y se dibuja solo el recinto
    const view = ok ? snap.mm : (() => {
      const c = map.options.crs.project(L.latLng(snap.lat, snap.lng));
      return { img: null, cx: c.x, cy: c.y, half: MM_HALF_M / Math.cos(snap.lat * Math.PI / 180) };
    })();
    if (view.img) g.drawImage(view.img, x, y, size, size);

    const toPx = (lat, lng) => {
      const p = map.options.crs.project(L.latLng(lat, lng));
      return [x + (p.x - (view.cx - view.half)) / (2 * view.half) * size,
              y + (view.cy + view.half - p.y) / (2 * view.half) * size];
    };

    // Contorno del recinto
    if (snap.ring) {
      g.beginPath();
      snap.ring.forEach((ll, i) => { const [px, py] = toPx(ll.lat, ll.lng); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath();
      g.fillStyle = 'rgba(255,152,0,0.18)';
      g.fill();
      g.lineWidth = 2.5 * u;
      g.strokeStyle = '#ff9800';
      g.stroke();
    }

    // Posición + dirección
    const [px, py] = toPx(snap.lat, snap.lng);
    if (snap.heading !== null) {
      const th = (snap.heading - 90) * Math.PI / 180;
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py, size * 0.42, th - Math.PI / 6, th + Math.PI / 6);
      g.closePath();
      g.fillStyle = 'rgba(255,235,59,0.35)';
      g.fill();
      g.save();
      g.translate(px, py);
      g.rotate(snap.heading * Math.PI / 180);
      g.beginPath();
      g.moveTo(0, -17 * u); g.lineTo(11 * u, 12 * u); g.lineTo(0, 6 * u); g.lineTo(-11 * u, 12 * u);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 2.5 * u;
      g.strokeStyle = '#2f6fde';
      g.stroke();
      g.restore();
    } else {
      g.beginPath();
      g.arc(px, py, 8 * u, 0, Math.PI * 2);
      g.fillStyle = '#2f6fde';
      g.fill();
      g.lineWidth = 3 * u;
      g.strokeStyle = '#fff';
      g.stroke();
    }

    // Indicador de norte
    g.font = `bold ${16 * u}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 3 * u;
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.fillStyle = '#fff';
    g.strokeText('N', x + size - 16 * u, y + 6 * u);
    g.fillText('N', x + size - 16 * u, y + 6 * u);
    g.restore();

    roundRect(g, x, y, size, size, 10 * u);
    g.lineWidth = 3 * u;
    g.strokeStyle = '#ffffff';
    g.stroke();
  }

  function composePhoto(source, w, h, snap) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(source, 0, 0, w, h);

    const u = Math.min(w, h) / 720;
    const margin = 18 * u;
    const mmSize = 260 * u;
    const mmX = margin, mmY = h - margin - mmSize;
    drawMinimap(g, mmX, mmY, mmSize, snap, u);

    // Bloque de texto (abajo-derecha)
    const pad2 = n => String(n).padStart(2, '0');
    const d = snap.date;
    const lines = [
      `SIGPAC ${snap.ref}`,
      `${snap.lat.toFixed(6)}, ${snap.lng.toFixed(6)}`,
      typeof utmLabel === 'function' ? utmLabel(snap.lat, snap.lng) : '',
      `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    ].filter(Boolean);

    const maxW = w - mmX - mmSize - margin * 3;
    let fs = 24 * u;
    g.font = `bold ${fs}px sans-serif`;
    let widest = Math.max(...lines.map(t => g.measureText(t).width));
    if (widest > maxW) {
      fs = fs * maxW / widest;
      g.font = `bold ${fs}px sans-serif`;
      widest = Math.max(...lines.map(t => g.measureText(t).width));
    }
    const lh = fs * 1.3;
    const padB = 10 * u;
    const boxW = widest + padB * 2;
    const boxH = lines.length * lh + padB * 2 - (lh - fs);
    const boxX = w - margin - boxW;
    const boxY = h - margin - boxH;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(g, boxX, boxY, boxW, boxH, 8 * u);
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'right';
    g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, boxX + boxW - padB, boxY + padB + i * lh));
    return c;
  }

  // ── Captura ─────────────────────────────────────────────
  async function takePhoto(source, w, h) {
    if (!pos) { toast('Aún no hay posición GPS', 'err'); return; }
    shutter.disabled = true;
    // Asegurar que el minimapa cubre la posición actual (espera breve si hace falta)
    if (!mmCovers(pos, 0.8)) {
      statusEl.textContent = 'Cargando ortofoto del minimapa…';
      await maybeRefreshMinimap(true);
    }
    const snap = {
      lat: pos.lat, lng: pos.lng, acc: pos.acc, heading,
      ref: sel.ref, ring: sel.ring, mm, date: new Date()
    };
    lastSnap = snap;
    lastCanvas = composePhoto(source, w, h, snap);
    preview.src = lastCanvas.toDataURL('image/jpeg', 0.85);
    preview.style.display = 'block';
    video.style.display = 'none';
    barLive.style.display = 'none';
    barPrev.style.display = 'flex';
    zoomWrap.style.display = 'none';
    statusEl.textContent = 'Revisa la foto y pulsa Guardar';
    shutter.disabled = false;
  }

  // ── Zoom (óptico/sensor si el dispositivo lo permite; si no, recorte digital) ──
  const zoomWrap = $('pg-zoom'), zoomRange = $('pg-zoom-range'), zoomVal = $('pg-zoom-val');
  let zoom = 1, hwZoom = null; // hwZoom = {min,max,step} si el track lo soporta
  function setupZoom() {
    zoom = 1; hwZoom = null;
    video.style.transform = '';
    const track = stream && stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      hwZoom = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
      zoom = Math.max(hwZoom.min, Math.min(1, hwZoom.max));
      zoomRange.min = hwZoom.min; zoomRange.max = Math.min(hwZoom.max, 10); zoomRange.step = 'any';
    } else {
      zoomRange.min = 1; zoomRange.max = 5; zoomRange.step = 'any';
      // Sin zoom por sensor: pedir más resolución para que el recorte digital conserve detalle
      if (track) track.applyConstraints({ width: { ideal: 4096 }, height: { ideal: 3072 } }).catch(() => {});
    }
    applyZoom(zoom);
  }
  function applyZoom(z) {
    const lo = hwZoom ? hwZoom.min : 1;
    const hi = hwZoom ? Math.min(hwZoom.max, 10) : 5;
    zoom = Math.max(lo, Math.min(hi, z));
    zoomRange.value = zoom;
    zoomVal.textContent = zoom.toFixed(1) + '×';
    if (hwZoom) {
      const track = stream && stream.getVideoTracks()[0];
      if (track) track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    } else {
      video.style.transform = zoom > 1 ? `scale(${zoom})` : '';
    }
  }
  zoomRange.addEventListener('input', () => applyZoom(parseFloat(zoomRange.value)));
  zoomVal.addEventListener('click', () => applyZoom(hwZoom ? Math.max(hwZoom.min, Math.min(1, hwZoom.max)) : 1));
  // Pellizcar sobre el visor
  let pinchD0 = 0, pinchZ0 = 1;
  const dist2 = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const stage = modal.querySelector('.pg-stage');
  stage.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinchD0 = dist2(e.touches); pinchZ0 = zoom; }
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchD0) { e.preventDefault(); applyZoom(pinchZ0 * dist2(e.touches) / pinchD0); }
  }, { passive: false });
  stage.addEventListener('touchend', e => { if (e.touches.length < 2) pinchD0 = 0; });
  stage.addEventListener('wheel', e => { if (camOk) { e.preventDefault(); applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });

  shutter.addEventListener('click', () => {
    if (!camOk || !video.videoWidth) { toast('La cámara no está lista', 'err'); return; }
    let src = video, w = video.videoWidth, h = video.videoHeight;
    if (!hwZoom && zoom > 1.001) { // recorte digital central
      const cw = Math.round(w / zoom), ch = Math.round(h / zoom);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
      src = c; w = cw; h = ch;
    }
    const MAXW = 2560, k = Math.min(1, MAXW / Math.max(w, h)); // salida ~1-1,5 MB
    takePhoto(src, Math.round(w * k), Math.round(h * k));
  });

  $('pg-file').addEventListener('click', () => $('pg-file-input').click());
  $('pg-file-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    if (!img) { toast('No se pudo leer la imagen', 'err'); return; }
    takePhoto(img, img.naturalWidth, img.naturalHeight);
  });

  $('pg-retake').addEventListener('click', backToLive);
  function backToLive() {
    preview.style.display = 'none';
    preview.removeAttribute('src');
    video.style.display = '';
    barPrev.style.display = 'none';
    barLive.style.display = 'flex';
    zoomWrap.style.display = '';
    lastCanvas = null; lastSnap = null;
    refreshStatus();
  }

  // ── Guardado (EXIF + descarga + añadir al mapa) ─────────
  function loadPiexif() {
    if (window.piexif) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PIEXIF_CDN; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function withExif(dataUrl, snap) {
    try {
      await loadPiexif();
      const P = window.piexif;
      const d = snap.date;
      const pad2 = n => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
      const gps = {};
      gps[P.GPSIFD.GPSLatitudeRef]  = snap.lat >= 0 ? 'N' : 'S';
      gps[P.GPSIFD.GPSLatitude]     = P.GPSHelper.degToDmsRational(Math.abs(snap.lat));
      gps[P.GPSIFD.GPSLongitudeRef] = snap.lng >= 0 ? 'E' : 'W';
      gps[P.GPSIFD.GPSLongitude]    = P.GPSHelper.degToDmsRational(Math.abs(snap.lng));
      if (snap.heading !== null) {
        gps[P.GPSIFD.GPSImgDirectionRef] = 'M';
        gps[P.GPSIFD.GPSImgDirection]    = [Math.round(snap.heading * 100), 100];
      }
      const zeroth = {}; zeroth[P.ImageIFD.ImageDescription] = 'SIGPAC ' + snap.ref;
      const exif = {}; exif[P.ExifIFD.DateTimeOriginal] = stamp;
      return P.insert(P.dump({ '0th': zeroth, 'Exif': exif, 'GPS': gps }), dataUrl);
    } catch (err) {
      console.warn('foto-geo: no se pudo escribir EXIF', err);
      return dataUrl;
    }
  }

  $('pg-save').addEventListener('click', async () => {
    if (!lastCanvas || !lastSnap) return;
    const btn = $('pg-save');
    btn.disabled = true;
    try {
      const dataUrl = await withExif(lastCanvas.toDataURL('image/jpeg', 0.92), lastSnap);
      const blob = await (await fetch(dataUrl)).blob();
      const d = lastSnap.date;
      const pad2 = n => String(n).padStart(2, '0');
      const name = `SIGPAC_${sel.parts.join('-')}_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.jpg`;
      const file = new File([blob], name, { type: 'image/jpeg' });

      // Guardar en la galería: en móvil, hoja «Compartir» → «Guardar imagen» (el navegador
      // no puede escribir directamente en la galería). En escritorio, descarga normal.
      let saved = false;
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      // iOS no permite descargar a Fotos sin la hoja Compartir; en Android/escritorio se guarda directo.
      if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); saved = true; }
        catch (e) { if (e && e.name !== 'AbortError') console.warn('foto-geo: share falló', e); }
      }
      if (!saved && !ios) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        saved = true;
      }

      // Añadir a la lista de fotos del mapa (la lee por EXIF, con su azimut)
      if (typeof processFiles === 'function') processFiles([file]);
      toast(saved ? 'Foto guardada' : 'Foto añadida a la app (no guardada en galería)', saved ? 'ok' : 'err');
      backToLive();
    } catch (err) {
      console.error('foto-geo: error al guardar', err);
      toast('Error al guardar la foto', 'err');
    } finally { btn.disabled = false; }
  });

  // ── Abrir / cerrar modal ────────────────────────────────
  async function openModal() {
    $('pg-ref').textContent = 'SIGPAC ' + sel.ref;
    pos = null; heading = null; compassSeen = false; mm = null;
    backToLive();
    shutter.disabled = true;
    $('pg-file').style.visibility = 'hidden';
    statusEl.textContent = 'Iniciando cámara y GPS…';
    modal.classList.add('open');
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    startGps();
    try {
      const RES = { width: { ideal: 2560 }, height: { ideal: 1440 } };
      stream = await navigator.mediaDevices.getUserMedia({
        video: Object.assign({ facingMode: { ideal: 'environment' } }, RES), audio: false
      });
      // Cámara principal: si hay varias traseras (ultra gran angular, tele…), elegir la principal
      // (en Android la principal suele ser «camera2 0, facing back»).
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        const backs = devs.filter(d => /back|trasera|rear|environment/i.test(d.label));
        const cur = stream.getVideoTracks()[0].getSettings().deviceId;
        const main = backs.find(d => /\b0,\s*facing back/i.test(d.label)) ||
                     (backs.length > 1 ? backs.find(d => !/wide|ultra|tele|macro|depth/i.test(d.label)) : null);
        if (main && main.deviceId !== cur) {
          const s2 = await navigator.mediaDevices.getUserMedia({
            video: Object.assign({ deviceId: { exact: main.deviceId } }, RES), audio: false
          });
          stream.getTracks().forEach(t => t.stop());
          stream = s2;
        }
      } catch (e) { console.warn('foto-geo: selección de cámara principal no disponible', e); }
      video.srcObject = stream;
      await video.play();
      camOk = true;
      setupZoom();
    } catch (err) {
      camOk = false;
      zoomWrap.style.display = 'none';
      $('pg-file').style.visibility = 'visible';
      console.warn('foto-geo: cámara no disponible', err);
      toast('No se pudo abrir la cámara. Usa «Cámara del sistema» para hacer la foto', 'err');
    }
    refreshStatus();
    if (pos) shutter.disabled = false;
  }

  // El botón de disparo se habilita en cuanto hay posición (cámara o cámara del sistema)
  setInterval(() => {
    if (modal.classList.contains('open') && barLive.style.display !== 'none') shutter.disabled = !pos || !camOk;
  }, 500);

  function closeModal() {
    modal.classList.remove('open');
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    window.removeEventListener('deviceorientation', onOrient, true);
    stopGps();
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    video.srcObject = null;
    camOk = false;
    if (hlPoly) { map.removeLayer(hlPoly); hlPoly = null; }
    lastCanvas = null; lastSnap = null;
  }
  $('pg-close').addEventListener('click', closeModal);
})();
