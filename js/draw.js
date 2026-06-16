// ════════════════════════════════════════════════════════
// MÓDULO: js/draw.js
// HERRAMIENTA DIBUJO
// ════════════════════════════════════════════════════════
// DRAW TOOL
// ═══════════════════════════════════════════════════════════════
const drawBtn      = document.getElementById('draw-btn');
const drawSubArea  = document.getElementById('draw-sub-area'); // legacy, oculto vía CSS
const drawSubLine  = document.getElementById('draw-sub-line'); // legacy, oculto vía CSS
const drawHint     = document.getElementById('draw-hint');
let drawActive       = false;
let drawMode         = 'area'; // 'area' | 'line' | 'point'
let drawPoints       = [];
let drawMarkers      = [];
let drawPoly         = null;
let drawPreview      = null;
let drawCount        = 0;

function setDrawMode(mode) {
  if (drawActive && drawPoints.length > 0) return;
  drawMode = mode;
  const a = document.getElementById('mob-draw-bar-area');
  const l = document.getElementById('mob-draw-bar-line');
  const p = document.getElementById('mob-draw-bar-point');
  if (a) a.classList.toggle('active', mode === 'area');
  if (l) l.classList.toggle('active', mode === 'line');
  if (p) p.classList.toggle('active', mode === 'point');
}

function startDraw() {
  if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
  if (measureMode) stopMeasure();
  if (queryMode !== 'none') applyQueryMode('none');
  drawActive = true;
  drawPoints = []; drawMarkers = []; drawPoly = null; drawPreview = null;
  drawBtn.classList.add('active');
  drawHint.textContent = drawMode === 'area'
    ? 'Clic para añadir vértices · Doble clic para cerrar · Retroceso = borrar último'
    : drawMode === 'line'
    ? 'Clic para añadir puntos · Doble clic para finalizar · Retroceso = borrar último'
    : 'Clic para añadir puntos · Pulsa Guardar para finalizar';
  drawHint.classList.add('show');
  map.getContainer().style.cursor = 'crosshair';
  map.on('click',     onDrawClick);
  map.on('mousemove', onDrawMove);
  if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    map.on('dblclick', onDrawFinish);
  }
}

function stopDraw(save) {
  drawActive = false;
  drawBtn.classList.remove('active');
  drawHint.classList.remove('show');
  map.getContainer().style.cursor = '';
  map.off('click',     onDrawClick);
  map.off('mousemove', onDrawMove);
  map.off('dblclick',  onDrawFinish);
  if (drawPoly)    { map.removeLayer(drawPoly);    drawPoly    = null; }
  if (drawPreview) { map.removeLayer(drawPreview); drawPreview = null; }
  drawMarkers.forEach(m => map.removeLayer(m));
  drawMarkers = [];
  hideMeasurePopup();
  // Cerrar barra unificada si está abierta
  const bar = document.getElementById('mob-draw-bar');
  if (bar && !save) bar.classList.remove('open');

  if (save) {
    if (drawMode === 'area' && drawPoints.length >= 3) {
      drawCount++;
      const name = `Área dibujada ${drawCount}`;
      const ring = [...drawPoints.map(p => [p.lng, p.lat]), [drawPoints[0].lng, drawPoints[0].lat]];
      const areaM2  = ringAreaSqM(drawPoints);
      const areaHa  = (areaM2 / 10000).toFixed(4);
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: 'Polygon', coordinates: [ring]
        }, properties: { nombre: name, area_m2: Math.round(areaM2), area_ha: areaHa } }]
      };
      showSaveLayerModal(geojson, name);
    } else if (drawMode === 'line' && drawPoints.length >= 2) {
      drawCount++;
      const name = `Línea dibujada ${drawCount}`;
      const coords = drawPoints.map(p => [p.lng, p.lat]);
      let totalM = 0;
      for (let i = 1; i < drawPoints.length; i++) totalM += haversineM(drawPoints[i-1], drawPoints[i]);
      const geojson = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: {
          type: 'LineString', coordinates: coords
        }, properties: { nombre: name, distancia_m: Math.round(totalM), distancia: fmtDist(totalM) } }]
      };
      showSaveLayerModal(geojson, name);
    } else if (drawMode === 'point' && drawPoints.length >= 1) {
      drawCount++;
      const name = `Puntos ${drawCount}`;
      const features = drawPoints.map((p, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { nombre: `Punto ${i + 1}`, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }
      }));
      const geojson = { type: 'FeatureCollection', features };
      showSaveLayerModal(geojson, name);
    }
  }
  drawPoints = [];
}

function drawUndoLastPoint() {
  if (!drawActive || drawPoints.length === 0) return;
  map.removeLayer(drawMarkers.pop());
  drawPoints.pop();
  refreshDrawLine();
  refreshDrawMeasure();
}

function refreshDrawMeasure() {
  if (!drawActive) return;
  let label = '';
  if (drawMode === 'area' && drawPoints.length >= 3) {
    const m2 = ringAreaSqM(drawPoints);
    label = fmtArea(m2);
    showMeasurePopup(label, drawPoints.length + ' vértices');
  } else if (drawMode === 'line' && drawPoints.length >= 2) {
    let total = 0;
    for (let i=1; i<drawPoints.length; i++) total += haversineM(drawPoints[i-1], drawPoints[i]);
    label = fmtDist(total);
    showMeasurePopup(label, drawPoints.length - 1 + ' segmento' + (drawPoints.length > 2 ? 's' : ''));
  } else if (drawMode === 'point') {
    hideMeasurePopup();
  } else {
    hideMeasurePopup();
  }
  const mobMeasure = document.getElementById('mob-draw-measure');
  if (mobMeasure) mobMeasure.textContent = label;
}

function onDrawClick(e) {
  if (e.originalEvent._drawSkip) return;
  drawPoints.push(e.latlng);

  // Colocar marker visible para todos los modos
  const marker = L.circleMarker(e.latlng, {
    radius: drawMode === 'point' ? 7 : 5,
    color: '#2f6fde', fillColor: '#2f6fde',
    fillOpacity: 1, weight: 2, interactive: false
  }).addTo(map);
  drawMarkers.push(marker);

  if (drawMode !== 'point') {
    refreshDrawLine();
    refreshDrawMeasure();
  } else {
    // Mostrar contador de puntos en la barra
    const mobMeasure = document.getElementById('mob-draw-measure');
    if (mobMeasure) mobMeasure.textContent = `${drawPoints.length} punto${drawPoints.length > 1 ? 's' : ''}`;
    showMeasurePopup(`${drawPoints.length} punto${drawPoints.length > 1 ? 's' : ''}`, 'Pulsa Guardar para finalizar');
  }
}

function onDrawMove(e) {
  if (!drawActive || drawPoints.length === 0) return;
  if (drawPreview) map.removeLayer(drawPreview);
  const pts = [...drawPoints, e.latlng];
  if (drawMode === 'area' && drawPoints.length >= 2) pts.push(drawPoints[0]);
  drawPreview = L.polyline(pts, {
    color: '#2f6fde', weight: 1.5, dashArray: '5,4', opacity: 0.7, interactive: false
  }).addTo(map);
}

function onDrawFinish(e) {
  e.originalEvent._drawSkip = true;
  // Cerrar la barra unificada igual que el botón Guardar
  const bar = document.getElementById('mob-draw-bar');
  if (bar) bar.classList.remove('open');
  const mdd = document.getElementById('mob-draw-direct-btn');
  if (mdd) mdd.classList.remove('active');
  stopDraw(true);
  if (typeof syncMobProjectLayers === 'function') syncMobProjectLayers();
}

function refreshDrawLine() {
  if (drawPoly) map.removeLayer(drawPoly);
  if (drawPoints.length < 2) return;
  const pts = (drawMode === 'area' && drawPoints.length >= 3)
    ? [...drawPoints, drawPoints[0]]
    : drawPoints;
  drawPoly = L.polyline(pts, {
    color: '#2f6fde', weight: 2.5, opacity: 0.9, interactive: false
  }).addTo(map);
}

drawBtn.addEventListener('click', () => {
  if (drawActive) {
    if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
    else stopDraw(false);
  } else {
    if (typeof window.closeDskGpsBar === 'function') window.closeDskGpsBar();
    if (typeof window.closeSelBar === 'function') window.closeSelBar();
    if (typeof window.openDrawBar === 'function') window.openDrawBar();
    else startDraw();
  }
});

// ── ÁREA DE UN POLÍGONO ──
function ringAreaSqM(latlngs) {
  const R = 6378137;
  const n = latlngs.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = latlngs[i].lng * Math.PI / 180;
    const xj = latlngs[j].lng * Math.PI / 180;
    const yi = Math.log(Math.tan(Math.PI / 4 + latlngs[i].lat * Math.PI / 360));
    const yj = Math.log(Math.tan(Math.PI / 4 + latlngs[j].lat * Math.PI / 360));
    area += (xj - xi) * (yj + yi);
  }
  return Math.abs(area / 2) * R * R;
}

function haversineM(a, b) {
  const R = 6378137, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function fmtArea(m2) {
  if (m2 >= 10000) return (m2/10000).toFixed(4) + ' ha';
  return m2.toFixed(1) + ' m²';
}
function fmtDist(m) {
  if (m >= 1000) return (m/1000).toFixed(3) + ' km';
  return m.toFixed(1) + ' m';
}

// ── MEASURE TOOLS ──
const measureAreaBtn = document.getElementById('measure-area-btn'); // removed from HTML
const measureLineBtn = document.getElementById('measure-line-btn'); // removed from HTML
const measurePopup   = document.getElementById('measure-popup');
const measureValue   = document.getElementById('measure-value');
const measureSub     = document.getElementById('measure-sub');

let measureMode    = null;
let measurePoints  = [];
let measureMarkers = [];
let measureLine    = null;
let measurePreview = null;
let measureSavedQM = null;

function showMeasurePopup(main, sub) {
  measureValue.textContent = main;
  measureSub.textContent   = sub || '';
  measurePopup.classList.add('visible');
}
function hideMeasurePopup() { measurePopup.classList.remove('visible'); }

function startMeasure(mode) {
  if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
  if (drawActive) {
    if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
    else stopDraw(false);
  }
  if (measureMode === mode) { stopMeasure(); return; }
  stopMeasure();
  if (queryMode !== 'none') applyQueryMode('none');
  measureMode = mode;
  measurePoints = []; measureMarkers = [];
  measureAreaBtn?.classList.toggle('active', mode === 'area');
  measureLineBtn?.classList.toggle('active', mode === 'line');
  map.getContainer().style.cursor = 'crosshair';
  const hint = mode === 'area'
    ? 'Clic para medir área · Doble clic para finalizar'
    : 'Clic para medir distancia · Doble clic para finalizar';
  drawHint.textContent = hint;
  drawHint.classList.add('show');
  map.on('click',    onMeasureClick);
  map.on('mousemove',onMeasureMove);
  if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    map.on('dblclick', onMeasureFinish);
  }
}

function stopMeasure() {
  if (!measureMode) return;
  measureMode = null;
  if (measureAreaBtn) measureAreaBtn.classList.remove('active');
  if (measureLineBtn) measureLineBtn.classList.remove('active');
  map.getContainer().style.cursor = '';
  drawHint.textContent = 'Clic para añadir vértices · Doble clic para cerrar';
  drawHint.classList.remove('show');
  map.off('click',    onMeasureClick);
  map.off('mousemove',onMeasureMove);
  map.off('dblclick', onMeasureFinish);
  if (measureLine)    { map.removeLayer(measureLine);    measureLine    = null; }
  if (measurePreview) { map.removeLayer(measurePreview); measurePreview = null; }
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = []; measurePoints = [];
  hideMeasurePopup();
}

function onMeasureClick(e) {
  if (e.originalEvent._drawSkip) return;
  measurePoints.push(e.latlng);
  const mk = L.circleMarker(e.latlng, {
    radius:5, color:'#9b27c8', fillColor:'#9b27c8', fillOpacity:1, weight:2, interactive:false
  }).addTo(map);
  measureMarkers.push(mk);
  refreshMeasureLine();
  updateMeasureResult(e.latlng);
}

function onMeasureMove(e) {
  if (!measureMode || measurePoints.length === 0) return;
  if (measurePreview) map.removeLayer(measurePreview);
  const pts = [...measurePoints, e.latlng];
  if (measureMode === 'area' && measurePoints.length >= 2) pts.push(measurePoints[0]);
  measurePreview = L.polyline(pts, {
    color:'#9b27c8', weight:1.5, dashArray:'4,3', opacity:0.6, interactive:false
  }).addTo(map);
  updateMeasureResult(e.latlng, true);
}

function onMeasureFinish(e) {
  e.originalEvent._drawSkip = true;
  updateMeasureResult(measurePoints[measurePoints.length-1] || e.latlng, false, true);
  map.off('click',    onMeasureClick);
  map.off('mousemove',onMeasureMove);
  map.off('dblclick', onMeasureFinish);
  if (measurePreview) { map.removeLayer(measurePreview); measurePreview = null; }
  map.getContainer().style.cursor = '';
  drawHint.classList.remove('show');
  // (queryMode no se restaura: el usuario activa otra herramienta manualmente)
  // popup stays visible until user clicks X or starts new action
}

function refreshMeasureLine() {
  if (measureLine) map.removeLayer(measureLine);
  if (measurePoints.length < 2) return;
  const pts = (measureMode === 'area' && measurePoints.length >= 3)
    ? [...measurePoints, measurePoints[0]] : measurePoints;
  measureLine = L.polyline(pts, { color:'#9b27c8', weight:2.5, opacity:0.9, interactive:false }).addTo(map);
}

function updateMeasureResult(latlng, isMove, isFinal) {
  if (measurePoints.length === 0) return;
  let main, sub;
  if (measureMode === 'line') {
    let total = 0;
    const pts = isMove ? [...measurePoints, latlng] : measurePoints;
    for (let i=1; i<pts.length; i++) total += haversineM(pts[i-1], pts[i]);
    main = fmtDist(total);
    sub  = isFinal ? 'Distancia total' : `${pts.length-1} segmento${pts.length>2?'s':''}`;
  } else {
    const pts = isMove ? [...measurePoints, latlng] : measurePoints;
    if (pts.length < 3) { main = '—'; sub = 'Necesitas ≥ 3 puntos'; }
    else {
      const llArr = pts.map(p => L.latLng(p.lat !== undefined ? p.lat : p[0], p.lng !== undefined ? p.lng : p[1]));
      const m2 = ringAreaSqM(llArr);
      main = fmtArea(m2);
      sub  = isFinal ? 'Área total' : `${pts.length} vértice${pts.length>1?'s':''}`;
    }
  }
  showMeasurePopup(main, sub);
}

// measure-area-btn and measure-line-btn removed; functionality merged into draw tool

document.getElementById('measure-popup-close').addEventListener('click', () => {
  if (drawActive) { resetDrawTool(); }
  else { stopMeasure(); }
});

function resetDrawTool() {
  // Reset measurement/drawing but keep the bar open
  if (!drawActive) return;
  drawMarkers.forEach(m => map.removeLayer(m));
  drawMarkers = [];
  drawPoints = [];
  if (drawPoly) { map.removeLayer(drawPoly); drawPoly = null; }
  if (drawPreview) { map.removeLayer(drawPreview); drawPreview = null; }
  hideMeasurePopup();
  const mobMeasure = document.getElementById('mob-draw-measure');
  if (mobMeasure) mobMeasure.textContent = '';
  // Refresh bar UI
  const a = document.getElementById('mob-draw-bar-area');
  const l = document.getElementById('mob-draw-bar-line');
  const p = document.getElementById('mob-draw-bar-point');
  if (a) a.classList.toggle('active', drawMode === 'area');
  if (l) l.classList.toggle('active', drawMode === 'line');
  if (p) p.classList.toggle('active', drawMode === 'point');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (typeof globeActive !== 'undefined' && globeActive) { stopGlobeTool(); toast('Coordenadas desactivadas'); }
    if (measureMode)  { stopMeasure(); }
    else if (drawActive) { resetDrawTool(); toast('Medición reiniciada'); }
  }
  if ((e.key === 'Backspace' || e.key === 'Delete') && drawActive) {
    e.preventDefault();
    drawUndoLastPoint();
  }
});

// ── DESKTOP QUERY BUTTON (lupa) ──
// UX: clic en lupa => activa el último modo usado (por defecto 'recinto') y abre el selector.
//      El selector permanece abierto hasta que el usuario vuelva a hacer clic en la lupa
//      o active otra herramienta. Las opciones del menú sólo cambian el modo (no lo desactivan).
const desktopQueryBtn  = document.getElementById('desktop-query-btn');
const desktopQueryMenu = document.getElementById('desktop-query-submenu');
let lastQueryMode = (queryMode && queryMode !== 'none') ? queryMode : 'recinto';

function updateDesktopQueryUI() {
  desktopQueryBtn.className = '';
  if (queryMode === 'recinto') desktopQueryBtn.classList.add('active-recinto');
  else if (queryMode === 'cultivo') desktopQueryBtn.classList.add('active-cultivo');
  document.querySelectorAll('.dqs-btn').forEach(b => {
    b.className = 'dqs-btn';
    if (b.dataset.mode === queryMode) b.classList.add('active-' + queryMode);
  });
  // Menú visible mientras haya un modo activo
  desktopQueryMenu.classList.toggle('open', queryMode !== 'none');
}

desktopQueryBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (queryMode !== 'none') {
    applyQueryMode('none');
  } else {
    if (typeof window.closeDskGpsBar === 'function') window.closeDskGpsBar();
    if (typeof window.closeSelBar === 'function') window.closeSelBar();
    applyQueryMode(lastQueryMode || 'recinto');
  }
});

document.querySelectorAll('.dqs-btn').forEach(b => {
  b.addEventListener('click', e => {
    e.stopPropagation();
    applyQueryMode(b.dataset.mode);
  });
});

desktopQueryMenu.addEventListener('click', e => e.stopPropagation());

// Patch applyQueryMode: desactiva otras herramientas al activar consulta y sincroniza UI
const _origApplyQueryModeDesktop = window.applyQueryMode;
window.applyQueryMode = function(mode) {
  _origApplyQueryModeDesktop(mode);
  if (mode !== 'none') {
    lastQueryMode = mode;
    if (drawActive) {
      if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
      else stopDraw(false);
    }
    if (measureMode) stopMeasure();
    if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
    // Close GPS bar
    const _gpsBar2 = document.getElementById('desktop-gps-bar');
    const _gpsBtn2 = document.getElementById('desktop-gps-btn');
    const _mobGps2 = document.getElementById('mob-gpsmeasure-toggle');
    if (_gpsBar2 && _gpsBar2.classList.contains('open')) {
      _gpsBar2.classList.remove('open');
      if (_gpsBtn2) _gpsBtn2.classList.remove('active');
      if (_mobGps2) _mobGps2.classList.remove('active');
    }
  }
  updateDesktopQueryUI();
};

updateDesktopQueryUI();
function parseWkt(wkt) {
  if (!wkt || !wkt.trim()) return null;
  const s = wkt.trim();
  const m = s.match(/^POLYGON\s*\(\((.+)\)\)$/i);
  if (!m) return null;
  const coords = m[1].split(',').map(pair => {
    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
    return [lng, lat];
  });
  if (coords.length < 3) return null;
  if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])
    coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

// xml data extractor helper
function getXmlText(el, tag) {
  const node = el.querySelector(tag);
  return node ? node.textContent.trim() : null;
}

async function handleXmlFile(file) {
  const text = await file.text();
  const doc  = new DOMParser().parseFromString(text, 'application/xml');
  const lineas = [...doc.querySelectorAll('LINEA_DECLARACION')];
  if (!lineas.length) { toast('No se encontraron LINEA_DECLARACION en el XML', 'err'); return; }

  const features = [];
  for (const linea of lineas) {
    const wktStr = getXmlText(linea, 'WKT');
    const geom   = parseWkt(wktStr);
    if (!geom) continue;

    const props = {};
    for (const child of linea.children) {
      const val = child.textContent.trim();
      if (val) props[child.tagName] = isNaN(val) ? val : Number(val);
    }
    const ring = geom.coordinates[0].map(([lng, lat]) => L.latLng(lat, lng));
    const m2   = ringAreaSqM(ring);
    props.area_ha  = (m2 / 10000).toFixed(4);
    props.area_m2  = Math.round(m2);

    features.push({ type: 'Feature', geometry: geom, properties: props });
  }

  if (!features.length) { toast('El XML no contiene geometrías WKT válidas', 'err'); return; }

  const layerName = file.name.replace(/\.xml$/i, '');
  const fc = { type: 'FeatureCollection', features };
  addShpLayer(fc, layerName, null, true);
  toast(`XML: ${features.length} recinto(s) importado(s)`, 'ok');
}

// ── IMPORTAR KML / KMZ ──
async function handleKmlFile(file) {
  let kmlText;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'kmz') {
    if (!window.JSZip) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const buf  = await file.arrayBuffer();
    const zip  = await window.JSZip.loadAsync(buf);
    const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
    if (!kmlFile) { toast('No se encontró .kml dentro del KMZ', 'err'); return; }
    kmlText = await kmlFile.async('string');
  } else {
    kmlText = await file.text();
  }

  const fc = kmlToGeoJson(kmlText);
  if (!fc.features.length) { toast('El KML no contiene geometrías válidas', 'err'); return; }

  const layerName = file.name.replace(/\.(kml|kmz)$/i, '');
  addShpLayer(fc, layerName, null, true);
  toast(`KML: ${fc.features.length} elemento(s) importado(s)`, 'ok');
}

function kmlToGeoJson(kmlText) {
  const doc   = new DOMParser().parseFromString(kmlText, 'application/xml');
  const feats = [];

  const parseKmlCoords = str => str.trim().split(/\s+/).map(t => {
    const [lng, lat] = t.split(',').map(Number);
    return [lng, lat];
  }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));

  const getName = pm => pm.querySelector('name')?.textContent.trim() || '';

  for (const pm of doc.querySelectorAll('Placemark')) {
    const name = getName(pm);
    const props = { name };

    for (const data of pm.querySelectorAll('Data')) {
      const k = data.getAttribute('name');
      const v = data.querySelector('value')?.textContent.trim();
      if (k && v) props[k] = v;
    }

    const point = pm.querySelector('Point coordinates');
    if (point) {
      const [lng, lat] = point.textContent.trim().split(',').map(Number);
      if (!isNaN(lng)) feats.push({ type:'Feature', geometry:{type:'Point',coordinates:[lng,lat]}, properties:props });
      continue;
    }

    const line = pm.querySelector('LineString coordinates');
    if (line) {
      const coords = parseKmlCoords(line.textContent);
      if (coords.length >= 2) feats.push({ type:'Feature', geometry:{type:'LineString',coordinates:coords}, properties:props });
      continue;
    }

    const polys = pm.querySelectorAll('Polygon');
    if (polys.length === 1) {
      const outer = polys[0].querySelector('outerBoundaryIs coordinates');
      if (outer) {
        const exterior = parseKmlCoords(outer.textContent);
        const holes    = [...polys[0].querySelectorAll('innerBoundaryIs coordinates')].map(n => parseKmlCoords(n.textContent));
        const rings    = [exterior, ...holes];
        feats.push({ type:'Feature', geometry:{type:'Polygon',coordinates:rings}, properties:props });
      }
    } else if (polys.length > 1) {
      const coordinates = [];
      for (const poly of polys) {
        const outer = poly.querySelector('outerBoundaryIs coordinates');
        if (!outer) continue;
        const exterior = parseKmlCoords(outer.textContent);
        const holes    = [...poly.querySelectorAll('innerBoundaryIs coordinates')].map(n => parseKmlCoords(n.textContent));
        coordinates.push([exterior, ...holes]);
      }
      if (coordinates.length) feats.push({ type:'Feature', geometry:{type:'MultiPolygon',coordinates}, properties:props });
    }
  }
  return { type:'FeatureCollection', features: feats };
}

// Función wrapper de enrutamiento principal (Modificada para llamar a processGenericShpFiles)
async function handleShpFiles(files) {
  const xmlFiles = files.filter(f => f.name.toLowerCase().endsWith('.xml'));
  const kmlFiles = files.filter(f => /\.(kml|kmz)$/i.test(f.name));
  const shpFiles = files.filter(f => !/\.(xml|kml|kmz)$/i.test(f.name));

  for (const f of xmlFiles) await handleXmlFile(f);
  for (const f of kmlFiles) await handleKmlFile(f);
  if (shpFiles.length) await processGenericShpFiles(shpFiles);
}

// ── GLOBE TOOL ──
const globeBtn    = document.getElementById('globe-btn');
const globePopup  = document.getElementById('globe-popup');
const gpCoords    = document.getElementById('gp-coords');
const gpEarthLink = document.getElementById('gp-earth-link');
const gpMapsLink  = document.getElementById('gp-maps-link');
let   globeActive  = false;
let   globeSavedQM = null;

function openGlobePopup(latlng) {
  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);
  const utm = utmLabel(latlng.lat, latlng.lng);
  gpCoords.innerHTML = `${lat}, ${lng}<br><span>UTM: ${esc(utm)}</span>`;
  gpEarthLink.href = `https://earth.google.com/web/@${lat},${lng},0a,1000d,35y,0h,0t,0r`;
  gpMapsLink.href  = `https://www.google.com/maps?q=${lat},${lng}&z=17`;

  const mapEl   = document.getElementById('map');
  const mapRect = mapEl.getBoundingClientRect();
  const cp      = map.latLngToContainerPoint(latlng);
  globePopup.style.display = 'block';
  const W = globePopup.offsetWidth  || 240;
  const H = globePopup.offsetHeight || 130;
  let x = mapRect.left + cp.x - W / 2;
  let y = mapRect.top  + cp.y - H - 48;
  if (y < mapRect.top + 8) y = mapRect.top + cp.y + 20;
  if (x < 8) x = 8;
  if (x + W > window.innerWidth - 8) x = window.innerWidth - W - 8;
  globePopup.style.left = x + 'px';
  globePopup.style.top  = y + 'px';
}

function startGlobeTool() {
  if (drawActive) {
    if (typeof window.closeDrawBar === 'function') window.closeDrawBar();
    else stopDraw(false);
  }
  if (measureMode) stopMeasure();
  if (queryMode !== 'none') applyQueryMode('none');
  if (typeof window.closeSelBar === 'function') window.closeSelBar();
  // Close GPS bar
  const _gpsBg = document.getElementById('desktop-gps-bar');
  const _gpsBt = document.getElementById('desktop-gps-btn');
  const _mobG  = document.getElementById('mob-gpsmeasure-toggle');
  if (_gpsBg && _gpsBg.classList.contains('open')) {
    _gpsBg.classList.remove('open');
    if (_gpsBt) _gpsBt.classList.remove('active');
    if (_mobG)  _mobG.classList.remove('active');
  }
  globeActive = true;
  globeBtn.classList.add('active');
  const _mgb = document.getElementById('mob-globe-direct-btn');
  if (_mgb) _mgb.classList.add('active');
  map.getContainer().style.cursor = 'crosshair';
  map.on('click', onGlobeClick);
}

function stopGlobeTool() {
  globeActive = false;
  globeBtn.classList.remove('active');
  // Sync mobile globe btn
  const _mgbs = document.getElementById('mob-globe-direct-btn');
  if (_mgbs) _mgbs.classList.remove('active');
  map.getContainer().style.cursor = '';
  map.off('click', onGlobeClick);
  globePopup.style.display = 'none';
}

function onGlobeClick(e) {
  if (e.originalEvent._drawSkip) return;
  openGlobePopup(e.latlng);
}

globeBtn.addEventListener('click', () => {
  if (globeActive) stopGlobeTool();
  else             startGlobeTool();
});
document.getElementById('gp-close-btn').addEventListener('click', () => {
  globePopup.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════