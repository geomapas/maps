// ════════════════════════════════════════════════════════
// MÓDULO: js/mapa3d.js
// VISTA 3D MAPLIBRE
// ════════════════════════════════════════════════════════

(function () {
  var map3DInstance = null;

  // No se oculta ninguna herramienta al entrar/salir de 3D
  function setUIFor3D(entering) {}

  function getRasterTiles3D() {
    return [
      'https://mt0.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
      'https://mt1.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
    ];
  }

  // Construye fuentes y capas GeoJSON de las capas del proyecto
  function buildProjectLayers() {
    var sources = {};
    var layers  = [];
    if (typeof shpLayers === 'undefined') return { sources: sources, layers: layers };

    shpLayers.forEach(function(l) {
      if (!l.visible || !l.geojson) return;

      var feats = [];
      var collect = function(g) {
        if (!g) return;
        if (Array.isArray(g)) { g.forEach(collect); return; }
        if (g.type === 'FeatureCollection') (g.features || []).forEach(collect);
        else if (g.type === 'Feature') feats.push(g);
      };
      collect(l.geojson);
      if (!feats.length) return;

      var sid = 'prj-' + l.id;

      // Enriquecer features con color por estado visitado y metadatos para el clic
      var featuresColored = feats.map(function(f, fIdx) {
        var saved = getChecklistData(l.id, fIdx);
        var c = (saved && saved.visitado) ? VISITED_COLOR : l.color;
        return Object.assign({}, f, {
          properties: Object.assign({}, f.properties, {
            _ml_color: c, _ml_lid: l.id, _ml_fidx: fIdx
          })
        });
      });

      sources[sid] = {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: featuresColored }
      };

      layers.push({
        id: sid + '-fill', type: 'fill', source: sid,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['get', '_ml_color'], 'fill-opacity': 0.32 }
      });
      layers.push({
        id: sid + '-outline', type: 'line', source: sid,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': ['get', '_ml_color'], 'line-width': 1.8 }
      });
      layers.push({
        id: sid + '-line', type: 'line', source: sid,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': ['get', '_ml_color'], 'line-width': 2 }
      });
      layers.push({
        id: sid + '-circle', type: 'circle', source: sid,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': ['get', '_ml_color'], 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }
      });
    });

    return { sources: sources, layers: layers };
  }

  // IDs de capas de proyecto clickables
  function getClickableLayers() {
    if (typeof shpLayers === 'undefined') return [];
    var ids = [];
    shpLayers.forEach(function(l) {
      if (!l.visible || !l.geojson) return;
      ids.push('prj-' + l.id + '-fill', 'prj-' + l.id + '-outline',
               'prj-' + l.id + '-line', 'prj-' + l.id + '-circle');
    });
    return ids;
  }

  // Popup nativo de MapLibre con el mismo HTML que Leaflet
  var _popup3d = null;

  function setupClickPopup() {
    var canvas = map3DInstance.getCanvas();
    canvas.style.cursor = '';

    // Cursor pointer al pasar sobre geometrías
    map3DInstance.on('mousemove', function(e) {
      var cl = getClickableLayers();
      if (!cl.length) return;
      var hit = map3DInstance.queryRenderedFeatures(e.point, { layers: cl });
      canvas.style.cursor = hit.length ? 'pointer' : '';
    });

    // Clic → popup
    map3DInstance.on('click', function(e) {
      var cl = getClickableLayers();
      if (!cl.length) return;
      var features = map3DInstance.queryRenderedFeatures(e.point, { layers: cl });
      if (!features.length) return;

      var f    = features[0];
      var lid  = f.properties && f.properties._ml_lid;
      var fIdx = f.properties && f.properties._ml_fidx;
      if (!lid || fIdx == null) return;

      var lyr = (typeof shpLayers !== 'undefined')
        ? shpLayers.find(function(l) { return l.id === lid; })
        : null;
      if (!lyr) return;

      // Props originales sin los campos internos _ml_*
      var allFeats = [];
      var collect2 = function(g) {
        if (!g) return;
        if (Array.isArray(g)) { g.forEach(collect2); return; }
        if (g.type === 'FeatureCollection') (g.features || []).forEach(collect2);
        else if (g.type === 'Feature') allFeats.push(g);
      };
      collect2(lyr.geojson);
      var origFeature = allFeats[Number(fIdx)];
      var origProps   = origFeature ? Object.assign({}, origFeature.properties) : {};

      var html = buildPopupHtml(origProps, lid, Number(fIdx));

      if (_popup3d) { _popup3d.remove(); _popup3d = null; }

      _popup3d = new maplibregl.Popup({
        maxWidth: '260px',
        className: 'ml-popup-geomaps',
        closeButton: true,
        closeOnClick: false,
      })
        .setLngLat(e.lngLat)
        .setHTML('<div id="ml-popup-inner">' + html + '</div>')
        .addTo(map3DInstance);

      // Inyectar los estilos del popup Leaflet en el popup de MapLibre
      _popup3d.on('open', function() {
        var inner = document.getElementById('ml-popup-inner');
        if (!inner) return;
        // Activar tabs y lógica de checklist reutilizando el handler global de Leaflet
        // Los eventos de tab y save-btn ya están delegados en document, funcionan igual
        // Solo necesitamos que el DOM esté presente, lo cual ya está.
        inner.style.fontFamily = 'DM Sans, sans-serif';
        inner.style.fontSize   = '11px';
      });
    });
  }

  function enter3D() {
    var center = map.getCenter();
    var zoom   = map.getZoom();

    // Ocultar mapa Leaflet, mostrar canvas 3D
    document.getElementById('map').style.opacity = '0';
    document.getElementById('map3d').style.display = 'block';

    // Estado activo botones
    document.getElementById('bm-3d').classList.add('active');
    document.getElementById('mob-btn-3d').classList.add('active');
    document.getElementById('mob-3d-compass').style.display = 'flex';

    // Ocultar herramientas no relevantes
    setUIFor3D(true);

    if (map3DInstance) {
      map3DInstance.remove();
      map3DInstance = null;
    }

    var proj = buildProjectLayers();
    var allSources = Object.assign({
      'imagery': {
        type: 'raster', tileSize: 256, tiles: getRasterTiles3D()
      },
      'terrain': {
        type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14,
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']
      }
    }, proj.sources);

    var allLayers = [{ id: 'imagery-layer', type: 'raster', source: 'imagery' }]
      .concat(proj.layers);

    map3DInstance = new maplibregl.Map({
      container: 'map3d',
      style: {
        version: 8,
        sources: allSources,
        layers: allLayers,
        terrain: { source: 'terrain', exaggeration: 1.8 }
      },
      center: [center.lng, center.lat],
      zoom: zoom - 1,
      pitch: 65,
      bearing: -15,
      maxPitch: 85,
      attributionControl: false,
    });

      map3DInstance.on('load', function() {
      setupClickPopup();
    });

    // Rotar aguja de brújula
    map3DInstance.on('rotate', function() {
      var btn = document.getElementById('mob-3d-compass');
      if (btn) btn.style.transform = 'rotate(' + map3DInstance.getBearing() + 'deg)';
    });

    if (typeof toast === 'function') toast('Vista 3D activada');
  }

  function exit3D() {
    if (_popup3d) { _popup3d.remove(); _popup3d = null; }

    if (map3DInstance) {
      var c = map3DInstance.getCenter();
      var z = map3DInstance.getZoom();
      map3DInstance.remove();
      map3DInstance = null;
      map.setView([c.lat, c.lng], Math.round(z + 1), { animate: false });
    }

    document.getElementById('map3d').style.display = 'none';
    document.getElementById('map').style.opacity = '1';
    document.getElementById('bm-3d').classList.remove('active');
    document.getElementById('mob-btn-3d').classList.remove('active');
    document.getElementById('mob-3d-compass').style.display = 'none';
    document.getElementById('mob-3d-compass').style.transform = 'rotate(0deg)';

    // Restaurar UI
    setUIFor3D(false);

    if (typeof toast === 'function') toast('Vista 2D restaurada');
  }

  function toggle3D() {
    var is3D = document.getElementById('map3d').style.display === 'block';
    if (is3D) exit3D(); else enter3D();
  }

  // Brújula: resetear norte con animación suave
  document.getElementById('mob-3d-compass').addEventListener('click', function() {
    if (!map3DInstance) return;
    map3DInstance.easeTo({ bearing: 0, pitch: 65, duration: 400 });
  });

  document.getElementById('mob-btn-3d').addEventListener('click', toggle3D);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('map3d').style.display === 'block') exit3D();
  });

  window.toggle3D = toggle3D;
  window.exit3D   = exit3D;

})();