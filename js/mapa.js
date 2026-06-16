// ════════════════════════════════════════════════════════
// MÓDULO: js/mapa.js
// MAPA
// ════════════════════════════════════════════════════════
// 1. MAPA (Inicializado primero de forma independiente y segura)
// ═══════════════════════════════════════════════════════════════
const map = L.map('map', {
  center: [39.5, -3.0], zoom: 8,
  zoomControl: false,
  maxZoom: 21
});

// Botones de zoom independientes (funcionan en 2D y 3D)
document.getElementById('zoom-in-btn').addEventListener('click', function() {
  if (typeof map3DInstance !== 'undefined' && map3DInstance && document.getElementById('map3d').style.display === 'block') {
    map3DInstance.zoomIn();
  } else {
    map.zoomIn();
  }
});
document.getElementById('zoom-out-btn').addEventListener('click', function() {
  if (typeof map3DInstance !== 'undefined' && map3DInstance && document.getElementById('map3d').style.display === 'block') {
    map3DInstance.zoomOut();
  } else {
    map.zoomOut();
  }
});

// ── Configuración de ortofotos SIGPAC por año ──────────────────
const ORTOFOTO_CONFIGS = {
  '2024': () => L.tileLayer.wms('https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2024/MapServer/WMSServer', {
    layers: '0', format: 'image/jpeg', transparent: false,
    version: '1.1.1', uppercase: true,
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'CLM Ortofoto 2024'
  }),
  '2022': () => L.tileLayer.wms('https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2021/MapServer/WMSServer', {
    layers: '0', format: 'image/jpeg', transparent: false,
    version: '1.1.1', uppercase: true,
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'CLM Ortofoto 2022'
  }),
  '2018': () => L.tileLayer.wms('https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2018/MapServer/WMSServer', {
    layers: '0', format: 'image/jpeg', transparent: false,
    version: '1.1.1', uppercase: true,
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'CLM Ortofoto 2018'
  }),
  '2015': () => L.tileLayer.wms('https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2015/MapServer/WMSServer', {
    layers: '0', format: 'image/jpeg', transparent: false,
    version: '1.1.1', uppercase: true,
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'CLM Ortofoto 2015'
  }),
  '2012': () => L.tileLayer.wms('https://geoservicios.castillalamancha.es/arcgis/services/Raster/ortofoto_2012/MapServer/WMSServer', {
    layers: '0', format: 'image/jpeg', transparent: false,
    version: '1.1.1', uppercase: true,
    maxNativeZoom: 19, maxZoom: 21,
    attribution: 'CLM Ortofoto 2012'
  }),
};

const ORTOFOTO_YEAR_KEY = 'geomapas_ortofoto_year';
let activeOrtoYear = localStorage.getItem(ORTOFOTO_YEAR_KEY) || '2024';

// Crear el tile layer de la ortofoto activa
let sigpacLayer = ORTOFOTO_CONFIGS[activeOrtoYear]();

const baseLayers = {
  sat:   L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
           { attribution: 'Esri', maxNativeZoom: 19, maxZoom: 21 }),
  osm:   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
           { attribution: '© OSM', maxNativeZoom: 19, maxZoom: 21 }),
  earth: L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
           { attribution: '© Google', maxNativeZoom: 20, maxZoom: 21, crossOrigin: true }),
  sigpac: sigpacLayer,
};

// Por defecto: Earth activo
baseLayers.earth.addTo(map);
let activeBasemap = 'earth';

// ── Watermark ──────────────────────────────────────────────────
const IMAGERY_DATES = {
  sat:    'Esri World Imagery',
  earth:  'Google Earth',
  sigpac: null,
};
const dateWatermark = document.getElementById('imagery-date');

function updateDateWatermark(type) {
  if (!dateWatermark) return;
  let label = IMAGERY_DATES[type] || null;
  if (type === 'sigpac') label = `SIGPAC Ortofoto ${activeOrtoYear}`;
  if (label) { dateWatermark.textContent = label; dateWatermark.style.display = ''; }
  else        { dateWatermark.style.display = 'none'; }
}

// ── Cambiar año de ortofoto SIGPAC ────────────────────────────
function setOrtoYear(year) {
  if (!ORTOFOTO_CONFIGS[year]) return;
  activeOrtoYear = year;
  localStorage.setItem(ORTOFOTO_YEAR_KEY, year);

  const wasActive = activeBasemap === 'sigpac';
  if (wasActive) map.removeLayer(baseLayers.sigpac);
  baseLayers.sigpac.remove?.();

  sigpacLayer = ORTOFOTO_CONFIGS[year]();
  baseLayers.sigpac = sigpacLayer;

  if (wasActive) {
    sigpacLayer.addTo(map);
    reraiseOverlays();
    updateDateWatermark('sigpac');
  }

  const sel = document.getElementById('orto-year-sel');
  if (sel) sel.value = year;
}

function reraiseOverlays() {
  if (typeof wmsRecinto !== 'undefined' && map.hasLayer(wmsRecinto)) { map.removeLayer(wmsRecinto); wmsRecinto.addTo(map); }
  if (typeof wmsCultivo !== 'undefined' && map.hasLayer(wmsCultivo)) { map.removeLayer(wmsCultivo); wmsCultivo.addTo(map); }
  if (typeof shpLayers !== 'undefined') shpLayers.forEach(l => {
    if (!l.visible) return;
    map.removeLayer(l.polyLayer); map.removeLayer(l.pinLayer);
    l.leafletLayer.addTo(map);
  });
  if (typeof photoGroup !== 'undefined' && map.hasLayer(photoGroup)) { map.removeLayer(photoGroup); photoGroup.addTo(map); }
}

function setBasemap(type) {
  if (type === activeBasemap) return;
  if (activeBasemap === 'sigpac') map.removeLayer(baseLayers.sigpac);
  else map.removeLayer(baseLayers[activeBasemap]);
  if (type === 'sigpac') baseLayers.sigpac.addTo(map);
  else baseLayers[type].addTo(map);
  reraiseOverlays();
  activeBasemap = type;
  document.querySelectorAll('.bm-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('bm-' + type)?.classList.add('active');
  const ortoSel = document.getElementById('orto-year-wrap');
  if (ortoSel) ortoSel.style.display = (type === 'sigpac') ? 'flex' : 'none';
  updateDateWatermark(type);
}

// Inicializar watermark con Earth
updateDateWatermark('earth');
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('orto-year-sel');
  if (sel) sel.value = activeOrtoYear;
});
(function() { const sel = document.getElementById('orto-year-sel'); if (sel) sel.value = activeOrtoYear; })();

// ═══════════════════════════════════════════════════════════════