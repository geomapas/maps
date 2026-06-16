// ════════════════════════════════════════════════════════
// MÓDULO: js/seleccion.js
// HERRAMIENTA SELECCIÓN SHP
// ════════════════════════════════════════════════════════
// HERRAMIENTA DE SELECCIÓN PARA GENERAR NUEVO SHP
// ═══════════════════════════════════════════════════════════════
(function() {
  window._selActive = false;
  window._selSource = 'recinto';
  let selFeatures = [];

  // Proxy para que el código interno use las vars como locales
  let selActive = false;
  let selSource = 'recinto';

  const bar      = document.getElementById('sel-tool-bar');
  const dskBtn   = document.getElementById('select-tool-btn');
  const mobBtn   = document.getElementById('mob-select-btn');
  const layerSel = document.getElementById('sel-tool-layer');
  const countEl  = document.getElementById('sel-tool-count');
  const countElMob = document.querySelector('.sel-count-mobile-row .tool-count-label');
  const backBtn  = document.getElementById('sel-tool-back');
  const closeBtn = document.getElementById('sel-tool-close');
  const saveBtn  = document.getElementById('sel-tool-save');
  if (!bar || !dskBtn) return;

  const deleteBtn = document.getElementById('sel-tool-delete');

  function refreshCount() {
    const n = selFeatures.length;
    const txt = n + (n === 1 ? ' seleccionada' : ' seleccionadas');
    countEl.textContent = txt;
    if (countElMob) countElMob.textContent = txt;
  }
  function updateDeleteBtnVisibility() {
    const isOwnLayer = selSource !== 'recinto' && selSource !== 'cultivo';
    deleteBtn.style.display = isOwnLayer ? '' : 'none';
  }

  function buildLayerOptions() {
    const prev = layerSel.value;
    const opts = [
      { value: 'recinto', label: 'Recintos SIGPAC' },
    ];
    if (typeof shpLayers !== 'undefined') {
      shpLayers.forEach(l => { if (l.visible) opts.push({ value: l.id, label: l.name }); });
    }
    layerSel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    layerSel.value = opts.some(o => o.value === prev) ? prev : 'recinto';
    selSource = layerSel.value; window._selSource = selSource;
    updateDeleteBtnVisibility();
  }
  function clearSelection() {
    selFeatures.forEach(s => { if (s.hl) map.removeLayer(s.hl); });
    selFeatures = []; window._selFeatures = selFeatures;
    refreshCount();
  }
  const HL_STYLE = { color: '#7b1fa2', weight: 2.5, fillColor: '#9b27c8', fillOpacity: 0.55, interactive: false };

  function openSelBar() {
    if (selActive) return;
    if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
    if (typeof measureMode !== 'undefined' && measureMode) stopMeasure();
    if (typeof drawActive !== 'undefined' && drawActive) {
      if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
      else stopDraw(false);
    }
    if (typeof queryMode !== 'undefined' && queryMode !== 'none') applyQueryMode('none');
    if (typeof window.closeDskGpsBar === 'function') window.closeDskGpsBar();
    selActive = true; window._selActive = true;
    dskBtn.classList.add('active');
    if (mobBtn) mobBtn.classList.add('active');
    buildLayerOptions();
    clearSelection();
    bar.classList.add('open');
    map.getContainer().style.cursor = 'crosshair';
    clearHoverHighlight();
    lastHoverKey = null;
    if (typeof shpLayers !== 'undefined') {
      shpLayers.forEach(l => l.polyLayer.eachLayer(sub => { if (sub.getPopup()) sub.unbindPopup(); }));
    }
    map.on('click', onSelClick);
  }
  window.openSelBar = openSelBar;

  function closeSelBar() {
    selActive = false; window._selActive = false;
    dskBtn.classList.remove('active');
    if (mobBtn) mobBtn.classList.remove('active');
    bar.classList.remove('open');
    map.getContainer().style.cursor = '';
    map.off('click', onSelClick);
    if (typeof shpLayers !== 'undefined') {
      shpLayers.forEach(l => l.polyLayer.eachLayer(sub => {
        if (sub.feature && !sub.getPopup()) { const _l = shpLayers.find(l => l.polyLayer.hasLayer(sub) || l.pinLayer?.hasLayer(sub)); sub.bindPopup(() => buildPopupHtml(sub.feature.properties, _l?.id, _l ? _l.geojson?.features?.indexOf(sub.feature) : -1)); }
      }));
    }
    clearSelection();
  }
  window.closeSelBar = closeSelBar;

  async function onSelClick(e) {
    if (!selActive) return;
    // Cancelar cualquier hover pendiente y limpiar el highlight para que el violeta sea visible
    clearTimeout(hoverDebounce);
    clearHoverHighlight();
    lastHoverKey = null;
    map.closePopup();
    if (selSource === 'recinto' || selSource === 'cultivo') await pickFromSigpac(e.latlng, selSource);
    else pickFromShpLayer(e.latlng, selSource);
  }

  async function pickFromSigpac(latlng, mode) {
    try {
      const size   = map.getSize();
      const point  = map.latLngToContainerPoint(latlng);
      const bounds = map.getBounds();
      const wmsUrl = mode === 'recinto' ? WMS_URL : CULTIVO_WMS;

      // 1) Atributos via HTML
      const htmlParams = buildGFIParams(mode, point, size, bounds, 'text/html');
      const htmlRes = await fetch(`${wmsUrl}?${htmlParams}`);
      const props = extractData(await htmlRes.text()) || {};

      let coords = null;

      // 2a) Reutilizar geometría del hover si está activa y es reciente
      if (hoverHighlight) {
        try {
          const ll = hoverHighlight.getLatLngs();
          console.log('[SEL] hoverHighlight getLatLngs niveles:', JSON.stringify(ll).slice(0,200));
          const flat = (Array.isArray(ll[0]) && ll[0].length && typeof ll[0][0].lat === 'number')
            ? ll[0]
            : (Array.isArray(ll[0][0]) ? ll[0][0] : ll);
          console.log('[SEL] coords desde hover, n puntos:', flat.length, 'primer punto:', flat[0]);
          if (flat.length >= 3) coords = flat;
        } catch(e) { console.warn('[SEL] Error leyendo hoverHighlight:', e); }
      } else {
        console.log('[SEL] hoverHighlight es null, yendo a fallback GML');
      }

      // 2b) GML via WMS GetFeatureInfo (funciona para cultivos; recintos no lo soporta)
      if (!coords || coords.length < 3) {
        if (mode !== 'recinto') {
          try {
            const gmlParams = buildGFIParams(mode, point, size, bounds, 'application/vnd.ogc.gml');
            const gmlRes = await fetch(`${wmsUrl}?${gmlParams}`);
            const gmlText = await gmlRes.text();
            console.log('[SEL] GML response (primeros 500 chars):', gmlText.slice(0, 500));
            coords = parseGmlCoords(gmlText);
            console.log('[SEL] coords desde GML:', coords ? coords.length + ' puntos, primer punto: ' + JSON.stringify(coords[0]) : 'null');
          } catch(e) { console.warn('[SEL] Error en GML fetch:', e); }
        } else {
          console.log('[SEL] Modo recinto: saltando GML (no soportado), yendo a REST');
        }
      }

      // 2c) ArcGIS REST identify (solo recintos)
      if ((!coords || coords.length < 3) && mode === 'recinto') {
        try {
          coords = await fetchRecintoGeom(latlng, size, bounds);
          console.log('[SEL] coords desde REST (corregidas), n puntos:', coords ? coords.length : 0, 'primer punto:', coords?.[0]);
        } catch(e) { console.warn('[SEL] Error en REST identify:', e); }
      }

      if (!coords || coords.length < 3) { toast('Geometría no disponible', 'err'); return; }

      // Construir GeoJSON: coords son LatLng[] → convertir a [lng, lat][]
      const key = mode === 'recinto'
        ? [props.PROVINCIA, props.MUNICIPIO, props.AGREGADO, props.ZONA, props.POLIGONO, props.PARCELA, props.RECINTO].join(':')
        : JSON.stringify(props);

      // Toggle: si ya está seleccionado, deseleccionar
      const existingIdx = selFeatures.findIndex(s => s.key === key);
      if (existingIdx !== -1) {
        const removed = selFeatures.splice(existingIdx, 1)[0];
        if (removed.hl) map.removeLayer(removed.hl);
        window._selFeatures = selFeatures;
        refreshCount();
        return;
      }

      const ring = coords.map(p => [p.lng, p.lat]);
      if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
        ring.push([...ring[0]]);
      }
      console.log('[SEL] ring[0] (primer vértice GeoJSON):', ring[0], 'ring[-1]:', ring[ring.length-1]);
      const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props };
      const hl = L.polygon(coords, HL_STYLE).addTo(map);
      selFeatures.push({ feature, hl, key }); window._selFeatures = selFeatures;
      refreshCount();
    } catch (err) { console.error('pickFromSigpac error:', err); toast('Error al consultar geometría', 'err'); }
  }

  function pointInGeoJSON(latlng, geom) {
    const x = latlng.lng, y = latlng.lat;

    // Polígono: ray casting
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) {
        const ring = poly[0];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
          const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        if (inside) return true;
      }
      return false;
    }

    // Punto: tolerancia en grados (~15m)
    const TOL = 0.00015;
    if (geom.type === 'Point') {
      return Math.abs(geom.coordinates[0] - x) < TOL && Math.abs(geom.coordinates[1] - y) < TOL;
    }
    if (geom.type === 'MultiPoint') {
      return geom.coordinates.some(c => Math.abs(c[0] - x) < TOL && Math.abs(c[1] - y) < TOL);
    }

    // Línea: distancia al segmento más cercano
    const LINE_TOL = 0.00018;
    function distToSegment(ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      if (dx === 0 && dy === 0) return Math.hypot(x - ax, y - ay);
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    }
    function lineNear(coords) {
      for (let i = 1; i < coords.length; i++) {
        if (distToSegment(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]) < LINE_TOL) return true;
      }
      return false;
    }
    if (geom.type === 'LineString') return lineNear(geom.coordinates);
    if (geom.type === 'MultiLineString') return geom.coordinates.some(lineNear);

    return false;
  }

  function pickFromShpLayer(latlng, layerId) {
    const layer = shpLayers.find(l => l.id === layerId);
    if (!layer) { toast('Capa no encontrada', 'err'); return; }
    let hit = null;

    // Buscar en polyLayer (Polygon, LineString, etc.)
    layer.polyLayer.eachLayer(sub => {
      if (hit || !sub.feature) return;
      const g = sub.feature.geometry;
      if (g && pointInGeoJSON(latlng, g)) hit = sub;
    });

    // Si no hay hit, buscar en pinLayer (puntos individuales a zoom out)
    if (!hit && layer.pinLayer) {
      layer.pinLayer.eachLayer(sub => {
        if (hit || !sub.feature) return;
        const g = sub.feature.geometry;
        if (g && pointInGeoJSON(latlng, g)) hit = sub;
      });
    }

    if (!hit) return;
    const key = layerId + ':' + (hit._leaflet_id || JSON.stringify(hit.feature.properties));

    // Toggle: si ya está seleccionado, deseleccionar
    const existingIdx = selFeatures.findIndex(s => s.key === key);
    if (existingIdx !== -1) {
      const removed = selFeatures.splice(existingIdx, 1)[0];
      if (removed.hl) map.removeLayer(removed.hl);
      window._selFeatures = selFeatures;
      refreshCount();
      return;
    }

    const hl = L.geoJSON(hit.feature, { style: HL_STYLE, pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 10, ...HL_STYLE }), interactive: false }).addTo(map);
    selFeatures.push({ feature: hit.feature, hl, key }); window._selFeatures = selFeatures;
    refreshCount();
  }

  dskBtn.addEventListener('click', () => { selActive ? closeSelBar() : openSelBar(); });
  if (mobBtn) mobBtn.addEventListener('click', () => { selActive ? closeSelBar() : openSelBar(); });
  layerSel.addEventListener('change', () => { selSource = layerSel.value; window._selSource = selSource; clearSelection(); updateDeleteBtnVisibility(); });
  backBtn.addEventListener('click', () => {
    const last = selFeatures.pop();
    if (last && last.hl) map.removeLayer(last.hl);
    refreshCount();
  });
  closeBtn.addEventListener('click', closeSelBar);
  saveBtn.addEventListener('click', () => {
    if (selFeatures.length === 0) { toast('No hay geometrías seleccionadas', 'err'); return; }
    const fc = { type: 'FeatureCollection', features: selFeatures.map(s => s.feature) };
    const srcLabel = layerSel.options[layerSel.selectedIndex]?.text || 'Selección';
    const name = `Selección ${srcLabel} (${selFeatures.length})`;
    showSaveLayerModal(fc, name, () => closeSelBar());
  });

  deleteBtn.addEventListener('click', () => {
    if (selFeatures.length === 0) { toast('No hay geometrías seleccionadas', 'err'); return; }
    const layer = shpLayers.find(l => l.id === selSource);
    if (!layer) { toast('Capa no encontrada', 'err'); return; }

    // Eliminar cada feature seleccionada del GeoJSON de la capa
    let removed = 0;
    selFeatures.forEach(sel => {
      const fc = layer.geojson;
      if (!fc || !fc.features) return;
      const idx = fc.features.indexOf(sel.feature);
      if (idx !== -1) { fc.features.splice(idx, 1); removed++; }
    });
    if (removed === 0) { toast('No se pudo eliminar la geometría', 'err'); return; }

    // Limpiar highlights de la selección actual
    selFeatures.forEach(s => { if (s.hl) map.removeLayer(s.hl); });
    selFeatures = []; window._selFeatures = selFeatures;

    // Preservar color y etiquetas antes de reconstruir la capa
    const savedColor = layer.color;
    const savedLabels = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
      ? { fields: [...layerLabels[layer.id].fields], visible: layerLabels[layer.id].visible, color: layerLabels[layer.id].color, size: layerLabels[layer.id].size }
      : null;
    if (typeof removeLayerLabels === 'function') removeLayerLabels(layer.id);

    // Eliminar la capa del mapa y reconstruirla con el GeoJSON actualizado
    map.removeLayer(layer.polyLayer);
    if (layer.pinLayer) map.removeLayer(layer.pinLayer);
    map.off('zoomend', layer.leafletLayer._onZoom);
    // Eliminar también el item del panel antes de reconstruir para evitar duplicados fantasma
    document.querySelector(`.list-item[data-id="${layer.id}"]`)?.remove();
    shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);

    const updatedGeojson = { ...layer.geojson };
    addShpLayer(updatedGeojson, layer.name, layer.id, true, false, savedColor);

    // Restaurar etiquetas
    if (savedLabels) {
      const rebuiltLayer = shpLayers.find(l => l.id === layer.id);
      if (rebuiltLayer && typeof restoreLayerLabels === 'function') restoreLayerLabels(rebuiltLayer, savedLabels);
    }

    // Persistir en cloud
    if (typeof isFirebaseActive === 'function' && isFirebaseActive() && typeof saveShpToCloud === 'function') {
      saveShpToCloud(shpLayers.find(l => l.id === layer.id));
    }

    refreshCount();
    toast(`${removed} geometría${removed > 1 ? 's' : ''} eliminada${removed > 1 ? 's' : ''} de "${layer.name}"`, 'ok');
  });

  // Sincronización con otras herramientas
  const _origStartDraw = window.startDraw;
  if (typeof _origStartDraw === 'function') {
    window.startDraw = function() { if (selActive) closeSelBar(); return _origStartDraw.apply(this, arguments); };
  }
  const _origStartMeasure = window.startMeasure;
  if (typeof _origStartMeasure === 'function') {
    window.startMeasure = function() { if (selActive) closeSelBar(); return _origStartMeasure.apply(this, arguments); };
  }
  const _origApplyQM = window.applyQueryMode;
  if (typeof _origApplyQM === 'function') {
    window.applyQueryMode = function(mode) {
      if (selActive && mode !== 'none') closeSelBar();
      return _origApplyQM.apply(this, arguments);
    };
  }
})();
