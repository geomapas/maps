// ════════════════════════════════════════════════════════
// MÓDULO: js/movil.js
// UX MÓVIL
// ════════════════════════════════════════════════════════
// MÓVIL — Lógica exclusiva de la UX móvil
// No modifica nada de la lógica de escritorio.
// ═══════════════════════════════════════════════════════════════
(function() {
  'use strict';

  function isMobile() { return window.innerWidth <= 700; }
  if (!isMobile()) return; // Solo ejecutar en móvil

  // ── Sincronizar toggles SIGPAC ──────────────────────────────
  const mobTogRecinto = document.getElementById('mob-tog-recinto');
  const mobTogCultivo = document.getElementById('mob-tog-cultivo');
  if (mobTogRecinto) {
    mobTogRecinto.addEventListener('change', e => {
      document.getElementById('tog-recinto').checked = e.target.checked;
      document.getElementById('tog-recinto').dispatchEvent(new Event('change'));
    });
  }
  if (mobTogCultivo) {
    mobTogCultivo.addEventListener('change', e => {
      document.getElementById('tog-cultivo').checked = e.target.checked;
      document.getElementById('tog-cultivo').dispatchEvent(new Event('change'));
    });
  }

  // Sincronizar selector año recintos
  const mobRecintoYear = document.getElementById('mob-recinto-year-sel');
  if (mobRecintoYear) {
    const sel = document.getElementById('recinto-year-sel');
    if (sel) mobRecintoYear.value = sel.value;
    mobRecintoYear.addEventListener('change', e => {
      if (mobRecintoYear.value !== sel.value) {
        setRecintoYear(mobRecintoYear.value);
      }
      const lbl = document.getElementById('mob-recinto-year-label');
      if (lbl) lbl.textContent = 'Recintos ' + mobRecintoYear.value;
    });
  }

  // ── GPS flotante ────────────────────────────────────────────
  const mobGpsBtn = document.getElementById('mob-gps-btn');
  if (mobGpsBtn) {
    // Proxy al botón de geolocalización de escritorio
    mobGpsBtn.addEventListener('click', () => {
      document.getElementById('geolocate-btn').click();
      // Reflejar estado visual
      setTimeout(() => {
        if (document.getElementById('geolocate-btn').classList.contains('active')) {
          mobGpsBtn.classList.add('active');
        } else {
          mobGpsBtn.classList.remove('active');
        }
      }, 100);
    });
    // Observar estado
    const geoDesktop = document.getElementById('geolocate-btn');
    if (geoDesktop) {
      const observer = new MutationObserver(() => {
        mobGpsBtn.classList.toggle('active', geoDesktop.classList.contains('active'));
      });
      observer.observe(geoDesktop, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ── Panel de capas móvil ────────────────────────────────────
  const mobLayersBtn   = document.getElementById('mob-layers-btn');
  const mobLayersPanel = document.getElementById('mob-layers-panel');
  const mobLayersClose = document.getElementById('mob-layers-close');

  function openMobLayers() {
    mobLayersPanel.classList.add('open');
    mobLayersBtn.classList.add('active');
    syncMobProjectLayers();
  }
  function closeMobLayers() {
    mobLayersPanel.classList.remove('open');
    mobLayersBtn.classList.remove('active');
  }

  if (mobLayersBtn)   mobLayersBtn.addEventListener('click', () => mobLayersPanel.classList.contains('open') ? closeMobLayers() : openMobLayers());
  if (mobLayersClose) mobLayersClose.addEventListener('click', closeMobLayers);

  // Cerrar al hacer clic en el mapa
  document.getElementById('map').addEventListener('click', () => {
    if (isMobile()) { closeMobLayers(); closeAllToolSubmenus(); closeMobRaster(); }
  });

  // ── Sincronizar capas de proyecto en panel móvil ────────────
  function syncMobProjectLayers() {
    const list = document.getElementById('mob-project-list');
    const empty = document.getElementById('mob-project-empty');
    if (!list) return;

    // Limpiar solo items (no el empty)
    [...list.querySelectorAll('.mob-layer-item')].forEach(el => el.remove());

    const total = (typeof shpLayers !== 'undefined' ? shpLayers.length : 0);
    const countEl = document.getElementById('mob-layers-count');
    if (countEl) countEl.textContent = total;
    if (empty) empty.style.display = total === 0 ? '' : 'none';

    if (typeof shpLayers === 'undefined') return;
    shpLayers.forEach(layer => {
      const item = document.createElement('div');
      item.className = 'mob-layer-item';
      item.dataset.id = layer.id;
      item.innerHTML = `
        <div class="mob-toggle-wrap">
          <input type="checkbox" id="mob-vis-${layer.id}" ${layer.visible ? 'checked' : ''}>
          <label for="mob-vis-${layer.id}"></label>
        </div>
        <div class="mob-layer-dot" title="Editar nombre y color">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <input type="color" value="${layer.color}">
        </div>
        <div class="mob-layer-info">
          <div class="mob-layer-item-name" title="${layer.name}">${layer.name}</div>
          <div class="mob-layer-item-sub">${layer.featureCount} recintos</div>
        </div>
        <div class="mob-layer-actions">
          <button class="mob-layer-share" title="Compartir capa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
          </button>
          <button class="mob-layer-del" title="Eliminar capa">✕</button>
        </div>`;

      // Toggle visibilidad
      item.querySelector(`#mob-vis-${layer.id}`).addEventListener('change', e => {
        e.stopPropagation();
        layer.visible = e.target.checked;
        if (e.target.checked) layer.leafletLayer.addTo(map);
        else { map.removeLayer(layer.polyLayer); map.removeLayer(layer.pinLayer); }
        // Sincronizar con el toggle de escritorio
        const desktopVis = document.querySelector(`.list-item[data-id="${layer.id}"] .shp-vis`);
        if (desktopVis) { desktopVis.checked = e.target.checked; }
      });

      // Editar nombre y color
      const dot = item.querySelector('.mob-layer-dot');
      dot.addEventListener('click', e => { e.stopPropagation(); openLayerEditModal(layer, item); });

      // Nombre click = fitBounds
      item.querySelector('.mob-layer-item-name').addEventListener('click', e => {
        e.stopPropagation();
        try { map.fitBounds(layer.polyLayer.getBounds(), { padding: [60, 60] }); closeMobLayers(); } catch(_) {}
      });

      // Compartir
      item.querySelector('.mob-layer-share').addEventListener('click', e => {
        e.stopPropagation();
        if (typeof openShareModal === 'function') openShareModal(layer);
      });
      if (layer._isCollab || layer._hasCollaborators) {
        item.querySelector('.mob-layer-share')?.classList.add('collab-active');
      }

      // Eliminar con confirmación
      item.querySelector('.mob-layer-del').addEventListener('click', e => {
        e.stopPropagation();
        showMobDeleteConfirm(layer.name, () => {
          map.removeLayer(layer.polyLayer);
          map.removeLayer(layer.pinLayer);
          if (layer.leafletLayer._onZoom) map.off('zoomend', layer.leafletLayer._onZoom);
          shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);
          // Eliminar del panel de escritorio
          document.querySelector(`.list-item[data-id="${layer.id}"]`)?.remove();
          if (typeof isFirebaseActive === 'function' && isFirebaseActive()) {
            if (typeof deleteShpFromCloud === 'function') deleteShpFromCloud(layer.id);
          }
          if (typeof toast === 'function') toast(`Capa "${layer.name}" eliminada`);
          if (typeof updateCounter === 'function') updateCounter();
          syncMobProjectLayers();
        });
      });

      list.appendChild(item);
    });
  }

  // Observar cambios en shpLayers para actualizar contador
  // (Se llama desde addShpLayer via updateCounter)
  const _origUpdateCounter = typeof updateCounter !== 'undefined' ? updateCounter : null;
  // Parchear updateCounter para también actualizar el contador móvil
  if (typeof window !== 'undefined') {
    const _prevCount = window.updateCounter;
    window.updateCounterMobile = function() {
      const total = (typeof shpLayers !== 'undefined' ? shpLayers.length : 0) + (typeof photos !== 'undefined' ? photos.length : 0);
      const countEl = document.getElementById('mob-layers-count');
      if (countEl) countEl.textContent = typeof shpLayers !== 'undefined' ? shpLayers.length : 0;
    };
  }

  // Monitorear addShpLayer para actualizar el panel móvil cuando se añade una capa
  const _origAddShpLayer = window.addShpLayer;
  window.addShpLayerOrig = _origAddShpLayer;
  // Parchear indirectamente via MutationObserver del unifiedList
  const unifiedList = document.getElementById('unifiedList');
  if (unifiedList) {
    const mo = new MutationObserver(() => {
      const countEl = document.getElementById('mob-layers-count');
      if (countEl && typeof shpLayers !== 'undefined') countEl.textContent = shpLayers.length;
      // Si el panel está abierto, refrescar
      if (mobLayersPanel && mobLayersPanel.classList.contains('open')) syncMobProjectLayers();
    });
    mo.observe(unifiedList, { childList: true });
  }

  // ── Modal eliminar capa: delega al sistema global ─────────────
  function showMobDeleteConfirm(name, cb) {
    if (typeof window.showDeleteConfirm === 'function') window.showDeleteConfirm(name, cb);
  }

  // ── Selector raster ─────────────────────────────────────────
  const mobRasterBtn   = document.getElementById('mob-raster-btn');
  const mobRasterPanel = document.getElementById('mob-raster-panel');
  const mobRasterLabel = document.getElementById('mob-raster-label');

  const RASTER_LABELS = { earth: 'Earth', osm: 'Calles', sat: 'Satélite', sigpac: 'SIGPAC' };

  function closeMobRaster() {
    mobRasterPanel.classList.remove('open');
    mobRasterBtn.classList.remove('active');
  }

  function mobSetBasemap(type) {
    setBasemap(type);
    mobRasterLabel.textContent = type === 'sigpac' ? 'SIGPAC ' + activeOrtoYear : RASTER_LABELS[type];
    document.querySelectorAll('.mob-raster-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.bm === type);
    });
    mobRasterBtn.classList.remove('active');
    mobRasterPanel.classList.remove('open');
  }
  window.mobSetBasemap = mobSetBasemap;

  if (mobRasterBtn) {
    mobRasterBtn.addEventListener('click', e => {
      e.stopPropagation();
      mobRasterPanel.classList.toggle('open');
      mobRasterBtn.classList.toggle('active', mobRasterPanel.classList.contains('open'));
    });
  }
  // Marcar active inicial
  document.querySelectorAll('.mob-raster-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.bm === 'earth');
  });

  // Sync año ortofoto
  const mobOrtoYear = document.getElementById('mob-orto-year-sel');
  if (mobOrtoYear) {
    mobOrtoYear.value = typeof activeOrtoYear !== 'undefined' ? activeOrtoYear : '2024';
  }

  // ── Herramientas inferiores (comportamiento idéntico al escritorio) ──
  const mobWrenchBtn   = document.getElementById('mob-wrench-btn');
  const mobToolsMenu   = document.getElementById('mob-tools-submenu');
  const mobGpsMeasBtn  = document.getElementById('mob-gpsmeasure-toggle');
  const mobGpsMenu     = document.getElementById('mob-gpsmeasure-submenu');
  const mobQueryToggle = document.getElementById('mob-query-toggle');
  const mobQueryMenu   = document.getElementById('mob-query-submenu');
  const mobDrawBtn     = document.getElementById('mob-draw-direct-btn');
  const mobGlobeBtn    = document.getElementById('mob-globe-direct-btn');

  // Helper: close GPS bar
  function closeMobGpsBar() {
    const b = document.getElementById('desktop-gps-bar');
    const bt = document.getElementById('desktop-gps-btn');
    if (b) b.classList.remove('open');
    if (bt) bt.classList.remove('active');
    if (mobGpsMeasBtn) mobGpsMeasBtn.classList.remove('active');
  }

  // Helper: sync all button active states
  function syncMobToolBtns() {
    // draw
    if (mobDrawBtn) mobDrawBtn.classList.toggle('active', !!drawActive);
    // globe
    if (mobGlobeBtn) mobGlobeBtn.classList.toggle('active', !!globeActive);
    // gps bar
    const gpsOpen = document.getElementById('desktop-gps-bar')?.classList.contains('open');
    if (mobGpsMeasBtn) mobGpsMeasBtn.classList.toggle('active', !!gpsOpen);
    // query
    if (mobQueryToggle) mobQueryToggle.classList.toggle('active', queryMode !== 'none');
    if (mobQueryMenu)   mobQueryMenu.classList.toggle('open', queryMode !== 'none');
  }

  function closeAllToolSubmenus() {
    // close everything except query when query active (keep submenu open)
    if (mobToolsMenu) mobToolsMenu.classList.remove('open');
    if (mobGpsMenu)   mobGpsMenu.classList.remove('open');
    if (queryMode === 'none') {
      if (mobQueryMenu)   mobQueryMenu.classList.remove('open');
      if (mobQueryToggle) mobQueryToggle.classList.remove('active');
    }
    if (mobWrenchBtn) mobWrenchBtn.classList.remove('active');
  }

  // ── Botón 1: Medir/Dibujar (cota) ─ mismo comportamiento que draw-btn desktop
  if (mobDrawBtn) {
    mobDrawBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (queryMode !== 'none') window.applyQueryMode('none');
      if (globeActive) stopGlobeTool();
      closeMobGpsBar();
      if (typeof window.closeSelBar === 'function') window.closeSelBar();
      if (drawActive) {
        if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
      } else {
        if (typeof window.openDrawBar === 'function') window.openDrawBar();
      }
    });
  }

  // ── Botón 2: Medición GPS ─ abre unified desktop-gps-bar
  if (mobGpsMeasBtn) {
    mobGpsMeasBtn.addEventListener('click', e => {
      e.stopPropagation();
      const dskGpsBar = document.getElementById('desktop-gps-bar');
      const dskGpsBtn = document.getElementById('desktop-gps-btn');
      const isOpen = dskGpsBar && dskGpsBar.classList.contains('open');
      if (isOpen) {
        closeMobGpsBar();
      } else {
        // Close other tools
        if (drawActive) { if (typeof window.closeDrawBar === 'function') window.closeDrawBar(); }
        if (globeActive) stopGlobeTool();
        if (queryMode !== 'none') window.applyQueryMode('none');
        if (typeof window.closeSelBar === 'function') window.closeSelBar();
        // Open GPS bar
        if (dskGpsBar) dskGpsBar.classList.add('open');
        if (dskGpsBtn) dskGpsBtn.classList.add('active');
        mobGpsMeasBtn.classList.add('active');
        // Auto-activate GPS location button
        const geoBtn = document.getElementById('mob-gps-btn');
        if (geoBtn && !geoBtn.classList.contains('active')) geoBtn.click();
      }
    });
  }

  // ── Botón 3: Coordenadas (globo) ─ mismo que globe-btn desktop
  if (mobGlobeBtn) {
    mobGlobeBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (drawActive) { if (typeof window.closeDrawBar === 'function') window.closeDrawBar(); }
      closeMobGpsBar();
      if (queryMode !== 'none') window.applyQueryMode('none');
      if (typeof window.closeSelBar === 'function') window.closeSelBar();
      document.getElementById('globe-btn').click();
    });
  }

  // Compat stubs for removed submenu items
  ['mob-sub-globe','mob-sub-area','mob-sub-line','mob-sub-draw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => e.stopPropagation());
  });

  // Selector tipo área / línea
  let gpsTrackType = 'area'; // 'area' | 'line'
  const gpsTypeBtnArea = document.getElementById('mob-gps-type-area');
  const gpsTypeBtnLine = document.getElementById('mob-gps-type-line');

  function applyGpsTypeUI() {
    const isArea = gpsTrackType === 'area';
    gpsTypeBtnArea.style.background = isArea ? 'var(--blue)' : 'transparent';
    gpsTypeBtnArea.style.color      = isArea ? '#fff' : 'var(--muted)';
    gpsTypeBtnLine.style.background = !isArea ? 'var(--blue)' : 'transparent';
    gpsTypeBtnLine.style.color      = !isArea ? '#fff' : 'var(--muted)';
  }

  gpsTypeBtnArea.addEventListener('click', e => {
    e.stopPropagation();
    if (gpsTrackState !== 'idle') return; // no cambiar tipo mientras graba
    gpsTrackType = 'area';
    applyGpsTypeUI();
  });
  gpsTypeBtnLine.addEventListener('click', e => {
    e.stopPropagation();
    if (gpsTrackState !== 'idle') return;
    gpsTrackType = 'line';
    applyGpsTypeUI();
  });
  applyGpsTypeUI();

  // Estado GPS medición
  let gpsTrackState = 'idle'; // idle | recording | paused
  let gpsTrackWatchId = null;
  let gpsTrackPoints = [];
  let gpsTrackLastTime = null;
  let gpsTrackPolyline = null;
  let gpsTrackCount = 0;

  const gpsPlayBtn  = document.getElementById('mob-gps-play-btn');
  const gpsPauseBtn = document.getElementById('mob-gps-pause-btn');
  const gpsStopBtn  = document.getElementById('mob-gps-stop-btn');
  const gpsStateEl  = document.getElementById('mob-gps-state');
  const gpsPtsLabel = document.getElementById('mob-gps-pts-label');

  function gpsUpdateUI() {
    gpsStateEl.className = 'mob-gps-state';
    // Selector de tipo: desactivar durante grabación/pausa
    const canChangeType = gpsTrackState === 'idle';
    gpsTypeBtnArea.style.opacity = canChangeType ? '1' : '.45';
    gpsTypeBtnArea.style.cursor  = canChangeType ? 'pointer' : 'default';
    gpsTypeBtnLine.style.opacity = canChangeType ? '1' : '.45';
    gpsTypeBtnLine.style.cursor  = canChangeType ? 'pointer' : 'default';

    if (gpsTrackState === 'idle') {
      gpsStateEl.textContent = 'Sin iniciar';
      gpsPlayBtn.disabled  = false;
      gpsPauseBtn.disabled = true;
      gpsStopBtn.disabled  = true;
      gpsPtsLabel.textContent = '';
    } else if (gpsTrackState === 'recording') {
      gpsStateEl.textContent = '● Grabando…';
      gpsStateEl.classList.add('recording');
      gpsPlayBtn.disabled  = true;
      gpsPauseBtn.disabled = false;
      gpsStopBtn.disabled  = false;
    } else if (gpsTrackState === 'paused') {
      gpsStateEl.textContent = '⏸ Pausado';
      gpsStateEl.classList.add('paused');
      gpsPlayBtn.disabled  = false;
      gpsPauseBtn.disabled = true;
      gpsStopBtn.disabled  = false;
    }
    gpsPtsLabel.textContent = gpsTrackPoints.length > 0 ? gpsTrackPoints.length + ' puntos' : '';
  }

  function gpsStartWatch() {
    if (!navigator.geolocation) { toast('Geolocalización no disponible', 'err'); return; }
    if (gpsTrackWatchId !== null) return; // evitar duplicados
    gpsTrackWatchId = navigator.geolocation.watchPosition(pos => {
      if (gpsTrackState !== 'recording') return;
      const { latitude: lat, longitude: lng } = pos.coords;

      // Filtro: mínimo 1 segundo entre puntos
      const now = Date.now();
      if (gpsTrackLastTime && now - gpsTrackLastTime < 1000) return;

      // Filtro: mínimo 2 metros desde el último punto
      if (gpsTrackPoints.length > 0) {
        const last = gpsTrackPoints[gpsTrackPoints.length - 1];
        const dLat = (lat - last[0]) * Math.PI / 180;
        const dLng = (lng - last[1]) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(last[0]*Math.PI/180) * Math.cos(lat*Math.PI/180) * Math.sin(dLng/2)**2;
        const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist < 2) return;
      }

      gpsTrackLastTime = now;
      gpsTrackPoints.push([lat, lng]);
      if (gpsTrackPolyline) {
        gpsTrackPolyline.setLatLngs(gpsTrackPoints);
      } else {
        gpsTrackPolyline = L.polyline(gpsTrackPoints, {
          color: '#2f6fde', weight: 3, opacity: 0.9
        }).addTo(map);
      }
      gpsUpdateUI();
    }, err => {
      const msgs = { 1:'Permiso denegado', 2:'Posición no disponible', 3:'Sin señal GPS' };
      toast('GPS: ' + (msgs[err.code] || err.message), 'err');
      gpsTrackState = 'idle';
      gpsStopWatch();
      gpsUpdateUI();
    }, { enableHighAccuracy: true, maximumAge: 2000 });
  }

  function gpsStopWatch() {
    if (gpsTrackWatchId !== null) {
      navigator.geolocation.clearWatch(gpsTrackWatchId);
      gpsTrackWatchId = null;
    }
  }

  gpsPlayBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (gpsTrackState === 'idle') {
      gpsTrackPoints = [];
      gpsTrackLastTime = null;
      if (gpsTrackPolyline) { map.removeLayer(gpsTrackPolyline); gpsTrackPolyline = null; }
      gpsTrackState = 'recording';
      gpsStartWatch();
      // Auto-activate GPS location button
      const geoBtn = document.getElementById('mob-gps-btn');
      if (geoBtn && !geoBtn.classList.contains('active')) geoBtn.click();
      toast('Medición GPS iniciada (' + (gpsTrackType === 'area' ? 'área' : 'línea') + ')');
    } else if (gpsTrackState === 'paused') {
      gpsTrackState = 'recording';
      gpsStartWatch();
      toast('Medición GPS reanudada');
    }
    gpsUpdateUI();
  });

  gpsPauseBtn.addEventListener('click', e => {
    e.stopPropagation();
    gpsTrackState = 'paused';
    gpsStopWatch();
    gpsUpdateUI();
    toast('Medición GPS pausada');
  });

  gpsStopBtn.addEventListener('click', e => {
    e.stopPropagation();
    gpsStopWatch();

    if (gpsTrackType === 'area') {
      // Modo área: necesita ≥ 3 puntos, cierra polígono
      if (gpsTrackPoints.length < 3) {
        toast('Se necesitan al menos 3 puntos para crear un área', 'err');
        gpsTrackState = 'idle';
        if (gpsTrackPolyline) { map.removeLayer(gpsTrackPolyline); gpsTrackPolyline = null; }
        gpsUpdateUI();
        return;
      }
      const ring = [...gpsTrackPoints, gpsTrackPoints[0]];
      const ringCoords = ring.map(([lat, lng]) => [lng, lat]);
      gpsTrackCount++;
      const name = `GPS Área ${gpsTrackCount}`;
      const ringLL = gpsTrackPoints.map(([lat, lng]) => L.latLng(lat, lng));
      const areaM2 = typeof ringAreaSqM === 'function' ? ringAreaSqM(ringLL) : 0;
      const areaHa = (areaM2 / 10000).toFixed(4);
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: 'Polygon', coordinates: [ringCoords]
        }, properties: { nombre: name, area_m2: Math.round(areaM2), area_ha: areaHa } }]
      };
      if (gpsTrackPolyline) { map.removeLayer(gpsTrackPolyline); gpsTrackPolyline = null; }
      if (typeof addShpLayer === 'function') showSaveLayerModal(geojson, name);
      else toast('Error al guardar', 'err');

    } else {
      // Modo línea: necesita ≥ 2 puntos, NO cierra el polígono
      if (gpsTrackPoints.length < 2) {
        toast('Se necesitan al menos 2 puntos para crear una línea', 'err');
        gpsTrackState = 'idle';
        if (gpsTrackPolyline) { map.removeLayer(gpsTrackPolyline); gpsTrackPolyline = null; }
        gpsUpdateUI();
        return;
      }
      const lineCoords = gpsTrackPoints.map(([lat, lng]) => [lng, lat]);
      gpsTrackCount++;
      const name = `GPS Línea ${gpsTrackCount}`;
      // Calcular longitud total
      let totalM = 0;
      for (let i = 1; i < gpsTrackPoints.length; i++) {
        if (typeof haversineM === 'function') {
          totalM += haversineM(
            { lat: gpsTrackPoints[i-1][0], lng: gpsTrackPoints[i-1][1] },
            { lat: gpsTrackPoints[i][0],   lng: gpsTrackPoints[i][1] }
          );
        }
      }
      const distLabel = typeof fmtDist === 'function' ? fmtDist(totalM) : totalM.toFixed(0) + ' m';
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: 'LineString', coordinates: lineCoords
        }, properties: { nombre: name, distancia_m: Math.round(totalM), distancia: distLabel } }]
      };
      if (gpsTrackPolyline) { map.removeLayer(gpsTrackPolyline); gpsTrackPolyline = null; }
      if (typeof showSaveLayerModal === 'function') showSaveLayerModal(geojson, name);
      else if (typeof addShpLayer === 'function') addShpLayer(geojson, name, null, true);
    }

    gpsTrackPoints = [];
    gpsTrackState = 'idle';
    gpsUpdateUI();
    syncMobProjectLayers();
  });

  gpsUpdateUI();

  // ── Botón 4: Consultas (lupa) ─ mismo comportamiento que desktop-query-btn ──
  let lastQueryModeMob = (queryMode && queryMode !== 'none') ? queryMode : 'recinto';

  if (mobQueryToggle) {
    mobQueryToggle.addEventListener('click', e => {
      e.stopPropagation();
      if (queryMode !== 'none') {
        window.applyQueryMode('none');
      } else {
        if (drawActive) { if (typeof window.closeDrawBar === 'function') window.closeDrawBar(); }
        closeMobGpsBar();
        if (globeActive) stopGlobeTool();
        if (typeof window.closeSelBar === 'function') window.closeSelBar();
        window.applyQueryMode(lastQueryModeMob || 'recinto');
      }
    });
  }

  function syncQueryBtns() {
    document.querySelectorAll('.mob-query-opt').forEach(b => {
      b.className = 'mob-query-opt';
      if (b.dataset.mode === queryMode) b.classList.add('active-' + queryMode);
    });
    if (mobQueryToggle) mobQueryToggle.classList.toggle('active', queryMode !== 'none');
    if (mobQueryMenu)   mobQueryMenu.classList.toggle('open', queryMode !== 'none');
  }

  document.querySelectorAll('.mob-query-opt').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (b.dataset.mode === 'none') { window.applyQueryMode('none'); return; }
      window.applyQueryMode(b.dataset.mode);
      lastQueryModeMob = b.dataset.mode;
    });
  });

  // Patch applyQueryMode para sincronizar botones móvil
  const _origApplyQueryModeMob = window.applyQueryMode;
  window.applyQueryMode = function(mode) {
    _origApplyQueryModeMob(mode);
    syncQueryBtns();
    syncMobToolBtns();
  };

  syncQueryBtns();
  syncMobToolBtns();

  // Patch openDrawBar/closeDrawBar to also sync mobile draw btn
  const _origOpenDrawBar = window.openDrawBar;
  window.openDrawBar = function() {
    _origOpenDrawBar();
    syncMobToolBtns();
  };
  const _origCloseDrawBar = window.closeDrawBar;
  window.closeDrawBar = function() {
    _origCloseDrawBar();
    syncMobToolBtns();
  };

  // Patch stopGlobeTool to sync mobile globe btn
  const _origStopGlobeMob = window.stopGlobeTool;
  window.stopGlobeTool = function() {
    _origStopGlobeMob();
    if (mobGlobeBtn) mobGlobeBtn.classList.remove('active');
    syncMobToolBtns();
  };

  // ── Barra de dibujo: delega al sistema global ──
  function openMobDrawBar() { if (typeof window.openDrawBar === 'function') window.openDrawBar(); }
  function closeMobDrawBar() { if (typeof window.closeDrawBar === 'function') window.closeDrawBar(); }
  window.closeMobDrawBar = closeMobDrawBar;

  // ── Cerrar submenús al clic exterior (query submenu stays if active) ──
  document.addEventListener('click', () => {
    if (isMobile()) {
      closeMobRaster();
      // Query submenu stays open while active
      if (queryMode === 'none') {
        if (mobQueryMenu)   mobQueryMenu.classList.remove('open');
        if (mobQueryToggle) mobQueryToggle.classList.remove('active');
      }
    }
  });
  const _qSub = document.getElementById('mob-query-submenu');
  if (_qSub) _qSub.addEventListener('click', e => e.stopPropagation());
  if (mobRasterPanel) mobRasterPanel.addEventListener('click', e => e.stopPropagation());
  if (mobLayersPanel) mobLayersPanel.addEventListener('click', e => e.stopPropagation());

  // ── Init ─────────────────────────────────────────────────────
  if (mobOrtoYear && typeof activeOrtoYear !== 'undefined') {
    mobOrtoYear.value = activeOrtoYear;
  }

})(); // fin IIFE móvil
document.addEventListener('click', () => {
  document.querySelectorAll('.shp-dl-menu.open').forEach(m => m.classList.remove('open'));
});
document.addEventListener('DOMContentLoaded', () => {
  const sm = document.getElementById('shareModal');
  document.getElementById('shareCancel').addEventListener('click', () => sm.classList.remove('open'));
  document.getElementById('shareSend').addEventListener('click', sendShareRequest);
  document.getElementById('shareLinkBtn').addEventListener('click', () => {
    sm.classList.remove('open');
    openShareLinkModal(currentShareLayer);
  });

  // Botones de descarga integrados en el modal de compartir
  document.getElementById('shareDlKml').addEventListener('click', () => {
    if (currentShareLayer) { sm.classList.remove('open'); exportShpKML(currentShareLayer.id); }
  });
  document.getElementById('shareDlShp').addEventListener('click', () => {
    if (currentShareLayer) { sm.classList.remove('open'); exportShpZip(currentShareLayer.id); }
  });
  document.getElementById('shareDlXlsx').addEventListener('click', () => {
    if (currentShareLayer) { sm.classList.remove('open'); exportShpExcel(currentShareLayer.id); }
  });
  document.getElementById('shareLinkClose').addEventListener('click', () => {
    document.getElementById('shareLinkModal').classList.remove('open');
  });
  document.getElementById('shareLinkCopy').addEventListener('click', () => {
    const url = document.getElementById('shareLinkBox').textContent;
    navigator.clipboard.writeText(url).then(() => toast('Enlace copiado')).catch(() => toast('No se pudo copiar', 'err'));
  });
  document.getElementById('shareLinkWhatsApp').addEventListener('click', () => {
    const url = encodeURIComponent(document.getElementById('shareLinkBox').textContent);
    window.open('https://wa.me/?text=' + url, '_blank');
  });
  document.getElementById('shareLinkEmail').addEventListener('click', () => {
    const url = document.getElementById('shareLinkBox').textContent;
    const layer = currentShareLayer;
    const subject = encodeURIComponent('Capa compartida: ' + (layer ? layer.name : ''));
        const body = encodeURIComponent('Te comparto esta capa en GEOmapas:\n\n' + url);
    window.open('mailto:?subject=' + subject + '&body=' + body, '_blank');
  });
  sm.addEventListener('click', e => { if (e.target === sm) sm.classList.remove('open'); });
  document.getElementById('shareEmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendShareRequest(); });
  document.getElementById('incomingClose').addEventListener('click', () => document.getElementById('incomingModal').classList.remove('open'));
});


// Sincronización en tiempo real de Firestore (Modo Colaborativo)
function setupRealtimeCloudSync(user) {
  if (shpUnsubscribe) shpUnsubscribe();
  if (!db || !user) return;

  // RULE 1 & RULE 2: Colección privada de usuario sin queries complejas
  const colRef = db.collection(`artifacts/${appId}/users/${user.uid}/capas_vectoriales`);

  // Escuchador de Firestore en tiempo real con callback de error obligatorio
  shpUnsubscribe = colRef.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const data = change.doc.data();
      if (change.type === "added") {
        try {
          const geojson = JSON.parse(data.geojson);
          console.log('[CF] snapshot ADDED', data.id, 'customFields=', data.customFields, 'keys=', Object.keys(data));
          // Restaurar color guardado en Firestore; si no hay, la paleta asignará uno
          addShpLayer(geojson, data.name, data.id, false, false, data.color || null);
          // Sincronizar color en el dot de la UI (por si la capa ya existía en lista)
          if (data.color) {
            const layer = shpLayers.find(l => l.id === data.id);
            if (layer) {
              layer.color = data.color;
              const dot = document.querySelector(`[data-id="${data.id}"] .shp-color-dot`);
              if (dot) dot.style.background = data.color;
              const inp = document.querySelector(`[data-id="${data.id}"] .shp-color-input`);
              if (inp) inp.value = data.color;
            }
          }
          // Restaurar etiquetas si las hay
          if (data.labels) {
            const layer = shpLayers.find(l => l.id === data.id);
            if (layer && typeof restoreLayerLabels === 'function') restoreLayerLabels(layer, data.labels);
          }
          // Restaurar campos personalizados si los hay
          if (data.customFields) {
            try { setCustomFields(data.id, JSON.parse(data.customFields)); } catch(_) {}
          }
          // Marcar como colaborativa si tiene colaboradores (propietario)
          if (data.collaborators && data.collaborators.length) {
            const layer = shpLayers.find(l => l.id === data.id);
            if (layer) {
              layer._hasCollaborators = true;
              setCollabActive(data.id);
            }
          }
          // Sincronizar checklist colaborativo si existe
          if (data.checklist_data) {
            syncCollabChecklistToLocal(data.id, data.checklist_data);
          }
        } catch (e) {
          console.error("Error al procesar capa sincronizada:", e);
        }
      } else if (change.type === "modified") {
        const layer = shpLayers.find(l => l.id === data.id);
        console.log('[CF] snapshot MODIFIED', data.id, 'customFields=', data.customFields, 'layerEncontrada=', !!layer);
        if (layer) {
          if (layer.color !== data.color) {
            layer.color = data.color;
            layer.leafletLayer.setStyle({ color: data.color, fillColor: data.color });
            const dot = document.querySelector(`[data-id="${data.id}"] .shp-color-dot`);
            if (dot) dot.style.background = data.color;
          }
          if (data.labels && typeof restoreLayerLabels === 'function') {
            restoreLayerLabels(layer, data.labels);
          }
          if (data.customFields) {
            try { setCustomFields(data.id, JSON.parse(data.customFields)); } catch(_) {}
          }
          // Sincronizar checklist colaborativo si se modificó
          if (data.checklist_data) {
            syncCollabChecklistToLocal(data.id, data.checklist_data);
          }
          if (data.collaborators && data.collaborators.length) {
            layer._hasCollaborators = true;
            setCollabActive(data.id);
          }
        }
      } else if (change.type === "removed") {
        const layerIdx = shpLayers.findIndex(l => l.id === data.id);
        if (layerIdx >= 0) {
          const layer = shpLayers[layerIdx];
          map.removeLayer(layer.polyLayer);
          map.removeLayer(layer.pinLayer);
          if (layer.leafletLayer._onZoom) map.off('zoomend', layer.leafletLayer._onZoom);
          if (typeof removeLayerLabels === 'function') removeLayerLabels(data.id);
          shpLayers.splice(layerIdx, 1);
          document.querySelector(`.list-item[data-id="${data.id}"]`)?.remove();
          updateCounter();
        }
      }
    });
  }, (error) => {
    console.error("Error en conexión en tiempo real Firestore:", error);
  });
}

// ── Controladores de la interfaz modal de login ──
if (auth !== null) {
  const cloudBtn          = document.getElementById('cloud-auth-btn');
  const authModal         = document.getElementById('authModal');
  const authModalClose    = document.getElementById('authModalClose');
  const authModalTitle    = document.getElementById('authModalTitle');
  const authForm          = document.getElementById('authForm');
  const authEmail         = document.getElementById('authEmail');
  const authPassword      = document.getElementById('authPassword');
  const authPrimaryBtn    = document.getElementById('authPrimaryBtn');
  const authResetPassword = document.getElementById('authResetPassword');
  const authViewUser      = document.getElementById('authViewUser');
  const authViewForm      = document.getElementById('authViewForm');
  const authActiveEmail   = document.getElementById('authActiveEmail');
  const authLogoutBtn     = document.getElementById('authLogoutBtn');

  // Mostrar / Ocultar modal de forma nativa
  cloudBtn.addEventListener('click', () => authModal.classList.add('open'));
  authModalClose.addEventListener('click', () => authModal.classList.remove('open'));
  authModal.addEventListener('click', e => { if (e.target === authModal) authModal.classList.remove('open'); });

  // Enviar correo de restablecimiento de contraseña
  authResetPassword.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    if (!email) {
      toast('Escribe tu correo en el campo correspondiente para restablecer la contraseña', 'err');
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      toast('Correo de restablecimiento enviado correctamente', 'ok');
    } catch (error) {
      toast(`Error: ${error.message}`, 'err');
    }
  });

  // Procesar Login (registro deshabilitado: las altas las gestiona el administrador)
  authPrimaryBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPassword.value;

    if (!email || password.length < 6) {
      toast('Por favor, ingresa un correo y contraseña (mínimo 6 caracteres)', 'err');
      return;
    }

    toast('Procesando datos...');
    try {
      await auth.signInWithEmailAndPassword(email, password);
      toast('Sesión iniciada correctamente', 'ok');
      authModal.classList.remove('open');
    } catch (error) {
      toast(`Error: ${error.message}`, 'err');
    }
  });

  // Salir de la cuenta
  authLogoutBtn.addEventListener('click', async () => {
    try {
      await auth.signOut();
      toast('Sesión cerrada de forma segura');
      authModal.classList.remove('open');
    } catch (error) {
      toast(`Error al desconectar: ${error.message}`, 'err');
    }
  });

  // Escuchador de estado de sesión de Firebase (RULE 3)
  auth.onAuthStateChanged((user) => {
    if (user) {
      cloudBtn.classList.add('logged-in');
      cloudBtn.querySelector('span').textContent = 'Sincronizado';
      authActiveEmail.textContent = user.email;
      authViewForm.style.display = 'none';
      authViewUser.style.display = 'block';
      
      // Registrar este correo en el índice global para que otros usuarios puedan compartir conmigo
      registerUserEmail(user);
      // Escuchar invitaciones de capas compartidas entrantes
      setupIncomingShareListener(user);
      setupCollabLayersListener(user);

      // Sincronizar capas locales actuales que se hayan cargado antes de loguearse
      shpLayers.forEach(layer => saveShpToCloud(layer));

      // Sincronizar configuración de "Capas Iniciales" desde Firestore
      document.dispatchEvent(new CustomEvent('initial-layers-sync-firestore', { detail: { uid: user.uid } }));

      // Sincronizar checklists desde Firestore PRIMERO, y después iniciar el listener de capas.
      // Así, cuando addShpLayer se ejecute para las capas que llegan de la nube,
      // ya encontrará los datos de visitado en localStorage y pintará los colores correctos.
      const _clSyncEvent = new CustomEvent('cl-sync-firestore', { detail: { uid: user.uid } });
      const _clSyncPromise = new Promise(resolve => {
        document.addEventListener('cl-sync-firestore', async function _handler(ev) {
          document.removeEventListener('cl-sync-firestore', _handler);
          // Dejar que el handler real se ejecute primero, luego resolver
          await new Promise(r => setTimeout(r, 0));
          resolve();
        }, { once: false, capture: true });
        document.dispatchEvent(_clSyncEvent);
      });
      _clSyncPromise.then(() => {
        // Iniciar el listener de Firestore en tiempo real para traer datos de la nube
        // (después de que los checklists ya estén en localStorage)
        setupRealtimeCloudSync(user);
      });
      // Cargar capa desde enlace público si hay ?share= en la URL
      const _sp = new URLSearchParams(window.location.search);
      const _shareId = _sp.get('share');
      if (_shareId && !window._shareLoaded) { window._shareLoaded = true; setTimeout(() => loadSharedLayer(_shareId), 800); }
    } else {
      cloudBtn.classList.remove('logged-in');
      cloudBtn.querySelector('span').textContent = 'Mi Cuenta';
      authViewForm.style.display = 'block';
      authViewUser.style.display = 'none';

      if (shpUnsubscribe) { shpUnsubscribe(); shpUnsubscribe = null; }
      if (shareUnsubscribe) { shareUnsubscribe(); shareUnsubscribe = null; }
      // Cargar capa desde enlace público si hay ?share= en la URL (usuario no logueado)
      const _sp2 = new URLSearchParams(window.location.search);
      const _shareId2 = _sp2.get('share');
      if (_shareId2 && !window._shareLoaded) { window._shareLoaded = true; setTimeout(() => loadSharedLayer(_shareId2), 600); }    }
  });
}


// ═══════════════════════════════════════════════════════════════