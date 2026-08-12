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
  const polyBtn   = document.getElementById('sel-tool-poly');
  const drawHintEl = document.getElementById('draw-hint');
  const moveRow    = document.getElementById('sel-move-row');
  const moveToggle = document.getElementById('sel-move-toggle');

  // ── Estado del modo "seleccionar dibujando un polígono" ──
  let selPolyMode    = false;
  let selDrawPoints  = [];
  let selDrawMarkers = [];
  let selDrawPreview = null;
  let selDrawPoly    = null;

  function refreshCount() {
    const n = selFeatures.length;
    const txt = n + (n === 1 ? ' seleccionada' : ' seleccionadas');
    countEl.textContent = txt;
    if (countElMob) countElMob.textContent = txt;
  }
  function updateDeleteBtnVisibility() {
    const isOwnLayer = selSource !== 'recinto' && selSource !== 'cultivo';
    deleteBtn.style.display = isOwnLayer ? '' : 'none';
    if (moveRow) moveRow.style.display = isOwnLayer ? '' : 'none';
  }
  function updatePolyBtnVisibility() {
    const disabled = selSource === 'cultivo';
    polyBtn.disabled = disabled;
    polyBtn.style.opacity = disabled ? '0.35' : '1';
    polyBtn.style.cursor  = disabled ? 'not-allowed' : 'pointer';
    polyBtn.title = disabled
      ? 'No disponible para Cultivo declarado (solo consulta puntual)'
      : 'Seleccionar recintos dentro de un polígono dibujado';
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
    updatePolyBtnVisibility();
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
    if (selPolyMode) cancelSelPoly();
    selActive = false; window._selActive = false;
    dskBtn.classList.remove('active');
    if (mobBtn) mobBtn.classList.remove('active');
    bar.classList.remove('open');
    map.getContainer().style.cursor = '';
    map.off('click', onSelClick);
    if (typeof shpLayers !== 'undefined') {
      shpLayers.forEach(l => l.polyLayer.eachLayer(sub => {
        if (sub.feature && !sub.getPopup()) { const _l = shpLayers.find(l => l.polyLayer.hasLayer(sub) || l.pinLayer?.hasLayer(sub)); sub.bindPopup(() => buildPopupHtml(sub.feature.properties, _l?.id)); }
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
    const key = layerId + ':' + (hit.feature.properties?.__gid || hit._leaflet_id || JSON.stringify(hit.feature.properties));

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
  layerSel.addEventListener('change', () => {
    if (selPolyMode) cancelSelPoly();
    selSource = layerSel.value; window._selSource = selSource;
    clearSelection(); updateDeleteBtnVisibility(); updatePolyBtnVisibility();
  });
  backBtn.addEventListener('click', () => {
    if (selPolyMode) {
      if (!selDrawPoints.length) return;
      const m = selDrawMarkers.pop();
      if (m) map.removeLayer(m);
      selDrawPoints.pop();
      refreshSelPolyLine();
      return;
    }
    const last = selFeatures.pop();
    if (last && last.hl) map.removeLayer(last.hl);
    refreshCount();
  });
  closeBtn.addEventListener('click', closeSelBar);
  saveBtn.addEventListener('click', () => {
    if (selFeatures.length === 0) { toast('No hay geometrías seleccionadas', 'err'); return; }
    let fc = { type: 'FeatureCollection', features: selFeatures.map(s => s.feature) };
    const isOwnLayer = selSource !== 'recinto' && selSource !== 'cultivo';

    // Trasladar el checklist (visitado/comentario/técnico/campos personalizados) de la capa
    // de origen a la selección, para que no se pierda al crear la nueva capa o al añadir
    // estas geometrías a una capa existente. Sólo aplica si la fuente es una capa propia
    // (Recintos SIGPAC / Cultivo declarado no tienen checklist).
    if (isOwnLayer && typeof transferChecklistToSelection === 'function') {
      fc = transferChecklistToSelection(selSource, fc);
    }
    const srcLabel = layerSel.options[layerSel.selectedIndex]?.text || 'Selección';
    const name = `Selección ${srcLabel} (${selFeatures.length})`;

    // Modo "Mover": si está activo y la fuente es una capa propia, tras guardar/añadir
    // la selección se eliminan esas mismas geometrías de la capa origen.
    const shouldMove    = isOwnLayer && !!moveToggle?.checked;
    const sourceLayerId = selSource;
    const featsToMove    = shouldMove ? selFeatures.slice() : null;

    showSaveLayerModal(fc, name, () => {
      if (shouldMove && featsToMove && featsToMove.length) {
        const removed = removeFeaturesFromLayer(sourceLayerId, featsToMove);
        if (removed > 0) {
          const srcLayer = shpLayers.find(l => l.id === sourceLayerId);
          toast(`${removed} geometría${removed > 1 ? 's' : ''} movida${removed > 1 ? 's' : ''} desde "${srcLayer ? srcLayer.name : srcLabel}"`, 'ok');
        }
      }
      closeSelBar();
    });
  });

  // Elimina del GeoJSON de la capa `layerId` las features presentes en `feats` (array de
  // objetos { feature, ... } como los que usa selFeatures) y reconstruye la capa en el mapa.
  // Devuelve el número de geometrías eliminadas. Usada tanto por el botón "Borrar" como
  // por el flujo de "Mover" al guardar/añadir la selección a otra capa.
  function removeFeaturesFromLayer(layerId, feats) {
    const layer = shpLayers.find(l => l.id === layerId);
    if (!layer) return 0;

    let removed = 0;
    feats.forEach(sel => {
      const fc = layer.geojson;
      if (!fc || !fc.features) return;
      const idx = fc.features.indexOf(sel.feature);
      if (idx !== -1) {
        fc.features.splice(idx, 1);
        removed++;
        // Limpiar el checklist local de la geometría eliminada
        const delGid = sel.feature.properties?.__gid;
        if (delGid) { try { localStorage.removeItem(`cl_${layer.id}_${delGid}`); } catch(_) {} }
      }
    });
    if (removed === 0) return 0;

    // Preservar color y etiquetas antes de reconstruir la capa
    const savedColor = layer.color;
    const savedPinMode = layer.pinMode;
    const savedVisible = layer.visible;
    const savedLabels = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
      ? { fields: [...layerLabels[layer.id].fields], visible: layerLabels[layer.id].visible, color: layerLabels[layer.id].color, size: layerLabels[layer.id].size }
      : null;
    // Preservar el estado de capa colaborativa (propietario, flags) al reconstruir la capa
    const savedCollab = { isCollab: layer._isCollab, ownerUid: layer._ownerUid, hasCollaborators: layer._hasCollaborators };
    if (typeof removeLayerLabels === 'function') removeLayerLabels(layer.id);

    // Eliminar la capa del mapa y reconstruirla con el GeoJSON actualizado
    map.removeLayer(layer.polyLayer);
    if (layer.pinLayer) map.removeLayer(layer.pinLayer);
    map.off('zoomend', layer.leafletLayer._onZoom);
    // Eliminar también el item del panel antes de reconstruir para evitar duplicados fantasma
    document.querySelector(`.list-item[data-id="${layer.id}"]`)?.remove();
    shpLayers.splice(shpLayers.findIndex(l => l.id === layer.id), 1);

    const updatedGeojson = { ...layer.geojson };
    addShpLayer(updatedGeojson, layer.name, layer.id, true, false, savedColor, savedPinMode, savedVisible);

    const rebuiltLayer = shpLayers.find(l => l.id === layer.id);
    if (rebuiltLayer) {
      rebuiltLayer._isCollab = savedCollab.isCollab;
      rebuiltLayer._ownerUid = savedCollab.ownerUid;
      rebuiltLayer._hasCollaborators = savedCollab.hasCollaborators;
    }
    // Restaurar etiquetas
    if (savedLabels) {
      if (rebuiltLayer && typeof restoreLayerLabels === 'function') restoreLayerLabels(rebuiltLayer, savedLabels);
    }

    // Persistir en cloud
    if (typeof isFirebaseActive === 'function' && isFirebaseActive() && typeof saveShpToCloud === 'function') {
      saveShpToCloud(shpLayers.find(l => l.id === layer.id));
    }

    return removed;
  }

  deleteBtn.addEventListener('click', () => {
    if (selFeatures.length === 0) { toast('No hay geometrías seleccionadas', 'err'); return; }
    const layer = shpLayers.find(l => l.id === selSource);
    if (!layer) { toast('Capa no encontrada', 'err'); return; }

    const removed = removeFeaturesFromLayer(selSource, selFeatures);
    if (removed === 0) { toast('No se pudo eliminar la geometría', 'err'); return; }

    // Limpiar highlights de la selección actual
    selFeatures.forEach(s => { if (s.hl) map.removeLayer(s.hl); });
    selFeatures = []; window._selFeatures = selFeatures;

    refreshCount();
    toast(`${removed} geometría${removed > 1 ? 's' : ''} eliminada${removed > 1 ? 's' : ''} de "${layer.name}"`, 'ok');
  });

  // ═══════════════════════════════════════════════════════════
  // SELECCIÓN POR POLÍGONO DIBUJADO
  // ═══════════════════════════════════════════════════════════
  polyBtn.addEventListener('click', () => {
    if (polyBtn.disabled) return;
    selPolyMode ? cancelSelPoly() : startSelPoly();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selPolyMode) { cancelSelPoly(); toast('Selección por polígono cancelada'); }
  });

  function startSelPoly() {
    if (selSource === 'cultivo') { toast('No disponible para Cultivo declarado', 'err'); return; }
    selPolyMode = true;
    selDrawPoints = []; selDrawMarkers = [];
    polyBtn.classList.add('active');
    map.off('click', onSelClick);
    map.getContainer().style.cursor = 'crosshair';
    if (drawHintEl) {
      drawHintEl.textContent = 'Clic para añadir vértices del polígono · Doble clic para seleccionar · Esc para cancelar';
      drawHintEl.classList.add('show');
    }
    map.on('click', onSelPolyClick);
    map.on('mousemove', onSelPolyMove);
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) map.on('dblclick', onSelPolyFinish);
  }

  function cancelSelPoly() {
    selPolyMode = false;
    polyBtn.classList.remove('active');
    map.off('click', onSelPolyClick);
    map.off('mousemove', onSelPolyMove);
    map.off('dblclick', onSelPolyFinish);
    if (drawHintEl) drawHintEl.classList.remove('show');
    if (selDrawPoly)    { map.removeLayer(selDrawPoly);    selDrawPoly    = null; }
    if (selDrawPreview) { map.removeLayer(selDrawPreview); selDrawPreview = null; }
    selDrawMarkers.forEach(m => map.removeLayer(m));
    selDrawMarkers = [];
    selDrawPoints  = [];
    if (selActive) {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', onSelClick);
    }
  }

  function onSelPolyClick(e) {
    if (e.originalEvent._drawSkip) return;
    selDrawPoints.push(e.latlng);
    const marker = L.circleMarker(e.latlng, {
      radius: 5, color: '#7b1fa2', fillColor: '#7b1fa2', fillOpacity: 1, weight: 2, interactive: false
    }).addTo(map);
    selDrawMarkers.push(marker);
    refreshSelPolyLine();
  }

  function onSelPolyMove(e) {
    if (!selPolyMode || selDrawPoints.length === 0) return;
    if (selDrawPreview) map.removeLayer(selDrawPreview);
    const pts = [...selDrawPoints, e.latlng];
    if (selDrawPoints.length >= 2) pts.push(selDrawPoints[0]);
    selDrawPreview = L.polyline(pts, { color: '#7b1fa2', weight: 1.5, dashArray: '5,4', opacity: 0.7, interactive: false }).addTo(map);
  }

  function refreshSelPolyLine() {
    if (selDrawPoly) { map.removeLayer(selDrawPoly); selDrawPoly = null; }
    if (selDrawPoints.length < 2) return;
    const pts = selDrawPoints.length >= 3 ? [...selDrawPoints, selDrawPoints[0]] : selDrawPoints;
    selDrawPoly = L.polyline(pts, { color: '#7b1fa2', weight: 2.5, opacity: 0.9, interactive: false }).addTo(map);
  }

  function onSelPolyFinish(e) {
    e.originalEvent._drawSkip = true;
    finishSelPoly();
  }

  async function finishSelPoly() {
    if (selDrawPoints.length < 3) { toast('Se necesitan al menos 3 vértices para el polígono', 'err'); cancelSelPoly(); return; }
    const ring = [...selDrawPoints];
    cancelSelPoly();
    toast('Buscando geometrías dentro del área…');
    let added = 0;
    try {
      added = selSource === 'recinto'
        ? await selectRecintosInPolygon(ring)
        : selectShpFeaturesInPolygon(ring, selSource);
    } catch (err) {
      console.error('finishSelPoly error:', err);
      toast('Error al buscar geometrías en el área', 'err');
      return;
    }
    refreshCount();
    toast(added
      ? `${added} geometría${added > 1 ? 's' : ''} añadida${added > 1 ? 's' : ''} a la selección`
      : 'No se encontraron geometrías dentro del área dibujada', added ? 'ok' : 'err');
  }

  // Consulta ArcGIS REST de recintos SIGPAC que intersectan el polígono dibujado
  async function selectRecintosInPolygon(ringLatLngs) {
    const closedRing = [...ringLatLngs, ringLatLngs[0]].map(ll => [ll.lng, ll.lat]);
    const geometry = JSON.stringify({ rings: [closedRing], spatialReference: { wkid: 4326 } });
    const params = new URLSearchParams({
      geometry, geometryType: 'esriGeometryPolygon', spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326', outSR: '4326', outFields: '*', returnGeometry: 'true', f: 'geojson'
    });
    const res  = await fetch(`${ARCGIS_REST_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    let added = 0;
    (json.features || []).forEach(f => {
      const p = f.properties || {};
      const key = [p.PROVINCIA, p.MUNICIPIO, p.AGREGADO, p.ZONA, p.POLIGONO, p.PARCELA, p.RECINTO].join(':');
      if (selFeatures.some(s => s.key === key)) return;
      const hl = L.geoJSON(f, { style: HL_STYLE, interactive: false }).addTo(map);
      selFeatures.push({ feature: f, hl, key });
      added++;
    });
    window._selFeatures = selFeatures;
    return added;
  }

  // Selección de features de una capa propia que intersectan el polígono dibujado
  function selectShpFeaturesInPolygon(ringLatLngs, layerId) {
    const layer = shpLayers.find(l => l.id === layerId);
    if (!layer) { toast('Capa no encontrada', 'err'); return 0; }

    const allFeats = [];
    const collect = g => {
      if (!g) return;
      if (Array.isArray(g)) { g.forEach(collect); return; }
      if (g.type === 'FeatureCollection') g.features?.forEach(collect);
      else if (g.type === 'Feature') allFeats.push(g);
    };
    collect(layer.geojson);

    const ring = [...ringLatLngs, ringLatLngs[0]].map(ll => [ll.lng, ll.lat]);
    const polyGeom = { type: 'Polygon', coordinates: [ring] };

    let added = 0;
    allFeats.forEach(f => {
      if (!f.geometry) return;
      const key = layerId + ':' + (f.properties?.__gid || JSON.stringify(f.properties));
      if (selFeatures.some(s => s.key === key)) return;
      if (!featureIntersectsPolygon(f.geometry, polyGeom)) return;
      const hl = L.geoJSON(f, {
        style: HL_STYLE,
        pointToLayer: (ff, ll) => L.circleMarker(ll, { radius: 10, ...HL_STYLE }),
        interactive: false
      }).addTo(map);
      selFeatures.push({ feature: f, hl, key });
      added++;
    });
    window._selFeatures = selFeatures;
    return added;
  }

  // ── Utilidades geométricas para la intersección capa-propia vs polígono dibujado ──
  function flattenCoords(geom) {
    const pts = [];
    const walk = c => { (typeof c[0] === 'number') ? pts.push(c) : c.forEach(walk); };
    if (geom && geom.coordinates) walk(geom.coordinates);
    return pts;
  }

  function pointInRing(pt, ring) {
    const x = pt[0], y = pt[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ¿La geometría de la feature intersecta (o está contenida en, o contiene a) el polígono dibujado?
  function featureIntersectsPolygon(featGeom, polyGeom) {
    const ring = polyGeom.coordinates[0];
    const featPts = flattenCoords(featGeom);
    if (featPts.some(p => pointInRing(p, ring))) return true;
    // Contención inversa: el polígono dibujado cae dentro de una geometría más grande (p. ej. un recinto)
    if (featGeom.type === 'Polygon' || featGeom.type === 'MultiPolygon') {
      const sampleLatLng = { lat: ring[0][1], lng: ring[0][0] };
      if (pointInGeoJSON(sampleLatLng, featGeom)) return true;
    }
    return false;
  }

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
