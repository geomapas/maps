// ════════════════════════════════════════════════════════
// MÓDULO: js/consulta-wms.js
// CONSULTA WMS + BÚSQUEDA + GEOLOC
// ════════════════════════════════════════════════════════
// 7. CONSULTA WMS
// ═══════════════════════════════════════════════════════════════
const tooltip       = document.getElementById('parcel-tooltip');
const queryPopupEl  = document.getElementById('query-popup');
const qpIdEl        = document.getElementById('qp-id');
const qpDetailEl    = document.getElementById('qp-detail');
let   highlightPoly = null;
let   hoverHighlight= null;
let   hoverDebounce = null;
let   lastHoverKey  = null;

function closeQueryPopup() {
  queryPopupEl.style.display = 'none';
  document.getElementById('qp-extra').style.display      = 'none';
  document.getElementById('qp-expand-btn').style.display = 'none';
  document.getElementById('qp-expand-btn').classList.remove('open');
  clearHighlight();
}
document.getElementById('qp-close-btn').addEventListener('click', closeQueryPopup);

document.getElementById('qp-expand-btn').addEventListener('click', () => {
  const extraEl   = document.getElementById('qp-extra');
  const expandBtn = document.getElementById('qp-expand-btn');
  const isOpen    = expandBtn.classList.contains('open');
  extraEl.style.display = isOpen ? 'none' : 'flex';
  expandBtn.classList.toggle('open', !isOpen);
});

function positionQueryPopup(latlng) {
  const el = queryPopupEl;
  el.style.display = 'block';

  const mapEl   = document.getElementById('map');
  const mapRect = mapEl.getBoundingClientRect();

  const cp = map.latLngToContainerPoint(latlng);
  const screenX = mapRect.left + cp.x;
  const screenY = mapRect.top  + cp.y;

  el.style.visibility = 'hidden';
  const W = el.offsetWidth  || 260;
  const H = el.offsetHeight || 160;
  el.style.visibility = '';

  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = screenX - W / 2;
  let y = screenY - H - 48;

  if (y < mapRect.top + margin) y = screenY + 20;

  if (x < margin) x = margin;
  if (x + W > vw - margin) x = vw - W - margin;
  if (y + H > vh - margin) y = vh - H - margin;

  el.style.left = x + 'px';
  el.style.top  = y + 'px';
}

function buildGFIParams(mode, point, size, bounds, infoFormat) {
  const sw = map.options.crs.project(bounds.getSouthWest());
  const ne = map.options.crs.project(bounds.getNorthEast());
  if (mode === 'recinto') {
    return new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo',
      LAYERS: '0', QUERY_LAYERS: '0', INFO_FORMAT: infoFormat,
      X: Math.round(point.x), Y: Math.round(point.y),
      WIDTH: size.x, HEIGHT: size.y, SRS: 'EPSG:3857',
      BBOX: `${sw.x},${sw.y},${ne.x},${ne.y}`,
    });
  } else {
    const bboxStr = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    return new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
      LAYERS: CULTIVO_LAYER, QUERY_LAYERS: CULTIVO_LAYER, INFO_FORMAT: infoFormat,
      I: Math.round(point.x), J: Math.round(point.y),
      WIDTH: size.x, HEIGHT: size.y, CRS: 'EPSG:4326',
      BBOX: bboxStr,
    });
  }
}

map.on('click', async e => {
  if (queryMode === 'none') return;
  const size   = map.getSize();
  const point  = map.latLngToContainerPoint(e.latlng);
  const bounds = map.getBounds();
  const wmsUrl = queryMode === 'recinto' ? WMS_URL : CULTIVO_WMS;

  const params = buildGFIParams(queryMode, point, size, bounds, 'text/html');

  try {
    const res  = await fetch(`${wmsUrl}?${params}`);
    const html = await res.text();
    const data = extractData(html);
    if (!data) { closeQueryPopup(); return; }

    if (queryMode === 'recinto') showQueryPopupRecinto(data, e.latlng);
    else                         showQueryPopupCultivo(data, e.latlng);

    // Para cultivo: el servidor prohíbe GML, pero sí permite JSON (GeoServer)
    // Para recinto: GML tampoco funciona, usamos ArcGIS REST identify
    if (queryMode === 'cultivo') {
      try {
        const jsonParams = buildGFIParams(queryMode, point, size, bounds, 'application/json');
        const jsonRes  = await fetch(`${wmsUrl}?${jsonParams}`);
        const jsonData = await jsonRes.json();
        const feature  = jsonData?.features?.[0];
        if (feature?.geometry) {
          const coords = geojsonGeomToLatLngs(feature.geometry);
          if (coords && coords.length >= 3) drawHighlight(coords);
        }
      } catch(_) {}
    } else {
      // Recinto: ArcGIS REST identify
      try {
        const coords = await fetchRecintoGeom(e.latlng, size, bounds);
        if (coords && coords.length >= 3) drawHighlight(coords);
      } catch(_) {}
    }
  } catch(err) { closeQueryPopup(); }
});

function showQueryPopupRecinto(d, latlng) {
  const g = k => (d[k] && d[k] !== '—') ? d[k] : '—';

  qpIdEl.className = 'qp-id recinto-id';
  qpIdEl.textContent = [g('PROVINCIA'),g('MUNICIPIO'),g('AGREGADO'),g('ZONA'),g('POLIGONO'),g('PARCELA'),g('RECINTO')].join(':');

  const rawSurface = parseFloat(g('DN_SURFACE'));
  const surface = !isNaN(rawSurface) ? (rawSurface / 10000).toFixed(4).replace('.', ',') + ' ha' : '';
  const uso = d['USO_SIGPAC'] && d['USO_SIGPAC'] !== '—' ? d['USO_SIGPAC'] : '';

  qpDetailEl.innerHTML = [
    surface ? `<div class="qp-row"><span class="qp-label">Superficie</span><span>${surface}</span></div>` : '',
    uso     ? `<div class="qp-row"><span class="qp-label">Uso SIGPAC</span><span>${esc(uso)}</span></div>` : '',
  ].filter(Boolean).join('') || '—';

  // Rellenar campos extra
  document.getElementById('qp-ext-csp').textContent  = g('CAP_RESU01');
  document.getElementById('qp-ext-coef').textContent = g('COEF_REGAD');
  document.getElementById('qp-ext-inc').textContent  = g('INCIDENCIA');
  document.getElementById('qp-ext-parc').textContent = g('PARCELA_AG');
  document.getElementById('qp-ext-mun').textContent  = g('TM');

  // Resetear estado del acordeón al abrir un nuevo recinto
  const extraEl  = document.getElementById('qp-extra');
  const expandBtn = document.getElementById('qp-expand-btn');
  extraEl.style.display  = 'none';
  expandBtn.style.display = 'flex';
  expandBtn.classList.remove('open');

  positionQueryPopup(latlng);
}

function showQueryPopupCultivo(d, latlng) {
  const raw = k => {
    const v = d[k];
    return (v && v !== '—' && v !== '' && v !== 'null') ? String(v).trim() : null;
  };

  const firstDigits = (v, n) => {
    if (!v) return '?';
    const m = String(v).replace(/\D/g, '');
    return m.slice(0, n) || '?';
  };

  const prov = firstDigits(raw('ZONA'), 2).padStart(2, '0');
  const mun  = firstDigits(raw('POLIGONO'), 3);
  const ag   = raw('PARCELA') || '0';
  const zona = raw('RECINTO') || '0';
  const pol  = raw('C_A__GESTORA') || raw('CA_GESTORA') || raw('C_A_GESTORA') || raw('GESTORA') || '?';
  const par  = raw('NO_EXPEDIENTE') || raw('NOEXPEDIENTE') || raw('N_EXPEDIENTE') || '?';
  const rec  = raw('LINEADECLARACION') || raw('LINEA_DECLARACION') || raw('LINEA') || '?';

  const idStr = `${prov}:${mun}:${ag}:${zona}:${pol}:${par}:${rec}`;

  const ldg = raw('AYUDA_DIRECTAC_PRINCIPAL') || raw('AYUDA_DIRECTA_C_PRINCIPAL') ||
              raw('AYUDA_DIRECTA_CPRINCIPAL') || raw('AYUDA_DIRECTA') || null;

  const supRaw = raw('AYUDA_PDR') || raw('AYUDAPDR') || raw('PDR') || null;
  let supStr = null;
  if (supRaw) {
    const v = parseFloat(String(supRaw).replace(',', '.'));
    if (!isNaN(v)) supStr = (v > 100 ? v / 10000 : v).toFixed(4).replace('.', ',') + ' ha';
    else supStr = supRaw;
  }

  const cultivo = raw('APROVECHAMIENTO') || raw('CULTIVO') || raw('USO') || null;

  qpIdEl.className = 'qp-id cultivo-id';
  qpIdEl.textContent = idStr;
  qpDetailEl.innerHTML = [
    ldg     ? `<div class="qp-row"><span class="qp-label">LDG</span><span>${esc(ldg)}</span></div>`         : '',
    supStr  ? `<div class="qp-row"><span class="qp-label">Superficie</span><span>${esc(String(supStr))}</span></div>` : '',
    cultivo ? `<div class="qp-row"><span class="qp-label">Cultivo</span><span>${esc(cultivo)}</span></div>` : '',
  ].filter(Boolean).join('') ||
    '<span style="color:var(--muted);font-size:10px;">Sin datos adicionales</span>';

  positionQueryPopup(latlng);
}

// Obtiene la geometría de un recinto SIGPAC via ArcGIS REST identify
// (el WMS de ArcGIS CLM no devuelve coordenadas en GetFeatureInfo GML)
async function fetchRecintoGeom(latlng, size, bounds) {
  const mapPt = map.options.crs.project(latlng);
  const sw    = map.options.crs.project(bounds.getSouthWest());
  const ne    = map.options.crs.project(bounds.getNorthEast());
  const tol   = Math.max(1, (ne.x - sw.x) / size.x * 6);
  const identifyUrl = WMS_URL.replace('/WMSServer', '/identify').replace('/services/', '/rest/services/');
  const rp = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: mapPt.x, y: mapPt.y, spatialReference: { wkid: 102100 } }),
    geometryType: 'esriGeometryPoint', inSR: '102100',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*', returnGeometry: 'true',
    tolerance: tol,
    mapExtent: `${sw.x},${sw.y},${ne.x},${ne.y}`,
    imageDisplay: `${size.x},${size.y},96`,
    layers: 'all:0',
  });
  const rj  = await (await fetch(`${identifyUrl}?${rp}`)).json();
  const r0  = (rj.results || [])[0];
  if (!r0?.geometry?.rings?.[0]) return null;
  return r0.geometry.rings[0].map(p => {
    const x = p[0], y = p[1];
    return Math.abs(x) > 180 || Math.abs(y) > 90
      ? L.CRS.EPSG3857.unproject(L.point(x, y))
      : L.latLng(y, x);
  });
}

map.on('mousemove', e => {
  const selToolActive = (typeof window._selActive !== 'undefined' && window._selActive);
  const hoverMode = queryMode !== 'none' ? queryMode
    : (selToolActive && typeof window._selSource !== 'undefined' && (window._selSource === 'recinto' || window._selSource === 'cultivo')) ? window._selSource
    : null;
  if (!hoverMode) return;
  if (map.getZoom() < 12) return;
  clearTimeout(hoverDebounce);
  hoverDebounce = setTimeout(async () => {
    const size   = map.getSize();
    const point  = map.latLngToContainerPoint(e.latlng);
    const bounds = map.getBounds();

    const key = Math.round(point.x / 6) + '_' + Math.round(point.y / 6);
    if (key === lastHoverKey) return;
    lastHoverKey = key;

    try {
      let coords = null;

      if (hoverMode === 'recinto') {
        // Recintos: el WMS no devuelve GML, usar ArcGIS REST identify
        coords = await fetchRecintoGeom(e.latlng, size, bounds);
      } else {
        // Cultivos: el servidor prohíbe GML, usar JSON (GeoServer)
        const wmsUrl   = CULTIVO_WMS;
        const params   = buildGFIParams(hoverMode, point, size, bounds, 'application/json');
        const res      = await fetch(`${wmsUrl}?${params}`);
        const jsonData = await res.json();
        const feature  = jsonData?.features?.[0];
        if (feature?.geometry) coords = geojsonGeomToLatLngs(feature.geometry);
      }

      if (coords && coords.length >= 3) drawHoverHighlight(coords, hoverMode);
      else clearHoverHighlight();
    } catch(_) { clearHoverHighlight(); }
  }, 80);
});

map.on('mouseout', () => { clearHoverHighlight(); lastHoverKey = null; });

function drawHoverHighlight(coords, mode) {
  clearHoverHighlight();
  const color = mode === 'cultivo' ? 'rgba(30,138,76,0.18)' : 'rgba(47,111,222,0.14)';
  const stroke= mode === 'cultivo' ? 'rgba(30,138,76,0.5)'  : 'rgba(47,111,222,0.4)';
  // No pintar hover si las coords corresponden a un recinto ya seleccionado
  const _sf = window._selFeatures;
  if (_sf && _sf.length) {
    const center = coords.reduce((acc, p) => ({ lat: acc.lat + p.lat / coords.length, lng: acc.lng + p.lng / coords.length }), { lat: 0, lng: 0 });
    const alreadySel = _sf.some(s => {
      try {
        const b = s.hl.getBounds();
        return b && b.contains(L.latLng(center.lat, center.lng));
      } catch(_) { return false; }
    });
    if (alreadySel) return;
  }
  hoverHighlight = L.polygon(coords, {
    color: stroke, weight: 1.5, dashArray: '4,3',
    fillColor: color, fillOpacity: 1, interactive: false,
  }).addTo(map);
}
function clearHoverHighlight() {
  if (hoverHighlight) { map.removeLayer(hoverHighlight); hoverHighlight = null; }
}

function drawHighlight(coords) {
  clearHighlight();
  highlightPoly = L.polygon(coords, {
    color:       'rgba(255,255,255,0)',
    weight:      0,
    fillColor:   '#ffffff',
    fillOpacity: 0.28,
    interactive: false,
  }).addTo(map);
}
function clearHighlight() {
  if (highlightPoly) { map.removeLayer(highlightPoly); highlightPoly = null; }
}

// Convierte geometría GeoJSON (Polygon/MultiPolygon) al anillo exterior como LatLng[]
function geojsonGeomToLatLngs(geom) {
  if (!geom) return null;
  let ring = null;
  if (geom.type === 'Polygon') {
    ring = geom.coordinates?.[0];
  } else if (geom.type === 'MultiPolygon') {
    // Usar el anillo del polígono más grande
    let maxLen = 0;
    (geom.coordinates || []).forEach(poly => {
      if ((poly[0]?.length || 0) > maxLen) { maxLen = poly[0].length; ring = poly[0]; }
    });
  }
  if (!ring || ring.length < 3) return null;
  return ring.map(c => {
    // GeoJSON siempre es [lon, lat]
    const ll = Math.abs(c[0]) > 180
      ? L.CRS.EPSG3857.unproject(L.point(c[0], c[1]))
      : L.latLng(c[1], c[0]);
    return ll;
  });
}

function parseGmlCoords(gml) {
  try {
    const doc = new DOMParser().parseFromString(gml, 'text/xml');

    // Detectar si el CRS del GML es EPSG:4326 con WMS 1.3.0 (eje lat primero)
    // En ese caso las coordenadas vienen como "lat lon" en lugar de "lon lat"
    const srsNodes = doc.querySelectorAll('[srsName]');
    let axisLatFirst = false;
    if (srsNodes.length) {
      const srs = srsNodes[0].getAttribute('srsName') || '';
      // WMS 1.3.0 con EPSG:4326 usa eje lat/lon
      axisLatFirst = /EPSG.*4326|urn.*EPSG.*4326/i.test(srs) && !/CRS84/i.test(srs);
    }

    // Helper: convierte array plano de números en LatLng[]
    function flatToLatLngs(nums) {
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        let x = nums[i], y = nums[i + 1];
        if (isNaN(x) || isNaN(y)) continue;
        let ll;
        if (Math.abs(x) > 180 || Math.abs(y) > 180) {
          // Coordenadas métricas EPSG:3857
          ll = L.CRS.EPSG3857.unproject(L.point(x, y));
        } else if (axisLatFirst) {
          // WMS 1.3.0 EPSG:4326: primer valor es latitud, segundo longitud
          ll = L.latLng(x, y);
        } else {
          // WMS 1.1.1: primer valor es longitud, segundo latitud
          ll = L.latLng(y, x);
        }
        pts.push(ll);
      }
      return pts;
    }

    // 1) <coordinates> (GML 2) y <posList> (GML 3)
    const nodes = doc.querySelectorAll('coordinates, posList');
    for (const node of nodes) {
      const raw  = node.textContent.trim().replace(/,/g, ' ').split(/\s+/).map(Number);
      if (raw.length < 6) continue;
      const pts = flatToLatLngs(raw);
      if (pts.length >= 3) return pts;
    }

    // 2) <pos> individuales (GML 3 — algunos WMS devuelven un <pos> por vértice)
    const posNodes = doc.querySelectorAll('pos');
    if (posNodes.length >= 3) {
      const nums = [];
      posNodes.forEach(n => {
        n.textContent.trim().split(/\s+/).forEach(v => nums.push(Number(v)));
      });
      const pts = flatToLatLngs(nums);
      if (pts.length >= 3) return pts;
    }

  } catch(_) {}
  return null;
}

function extractData(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.querySelector('table')) return null;

  const normKey = s => String(s).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^A-Z0-9]+/g,'_')
    .replace(/^_|_$/g,'');

  const dataMap = {};

  const allTh = [...doc.querySelectorAll('th')];
  const allTd = [...doc.querySelectorAll('td')];
  if (allTh.length && allTd.length) {
    allTh.forEach((th, i) => {
      const k = normKey(th.textContent);
      if (k) dataMap[k] = allTd[i]?.textContent.trim() || '—';
    });
  }

  if (!Object.keys(dataMap).length) {
    doc.querySelectorAll('tr').forEach(row => {
      const cells = [...row.querySelectorAll('td,th')];
      if (cells.length >= 2) {
        const k = normKey(cells[0].textContent);
        if (k) dataMap[k] = cells[1].textContent.trim();
      }
    });
  }

  return Object.keys(dataMap).length ? dataMap : null;
}

// ═══════════════════════════════════════════════════════════════
// 7b. SEARCH PANEL
// ═══════════════════════════════════════════════════════════════
let searchMode = null;
let searchHighlight = null;

const RECINTO_FIELDS = [
  { id:'s_prov',  label:'PROVINCIA',  required:true  },
  { id:'s_mun',   label:'MUNICIPIO',  required:true  },
  { id:'s_ag',    label:'AGREGADO',   required:true  },
  { id:'s_zona',  label:'ZONA',       required:true  },
  { id:'s_pol',   label:'POLÍGONO',   required:true  },
  { id:'s_par',   label:'PARCELA',    required:true  },
  { id:'s_rec',   label:'RECINTO',    required:true  },
];

function openSearchPanel(mode) {
  if (searchMode === mode) { closeSearchPanel(); return; }
  searchMode = mode;
  document.getElementById('search-panel-title').textContent = 'Buscar recinto';
  document.getElementById('search-btn-exec').className = 'search-btn';
  document.getElementById('search-recinto-btn').classList.toggle('active-search', true);
  const fields = RECINTO_FIELDS;
  const container = document.getElementById('search-fields');
  container.innerHTML = fields.map(f => `
    <div class="sf-row">
      <div class="sf-label">${f.label}${f.required ? ' *' : ''}</div>
      <input class="sf-input" id="${f.id}" type="text" placeholder="${f.required ? 'Obligatorio' : 'Opcional'}">
    </div>`).join('');
  document.getElementById('search-panel').classList.add('open');
}

function closeSearchPanel() {
  searchMode = null;
  document.getElementById('search-panel').classList.remove('open');
  document.getElementById('search-recinto-btn').classList.remove('active-search');
  if (searchHighlight) { map.removeLayer(searchHighlight); searchHighlight = null; }
}

document.getElementById('search-panel-close').addEventListener('click', closeSearchPanel);
document.getElementById('search-recinto-btn').addEventListener('click', () => openSearchPanel('recinto'));

document.getElementById('search-btn-exec').addEventListener('click', async () => {
  if (!searchMode) return;
  await execSearchRecinto();
});

async function execSearchRecinto() {
  const vals = RECINTO_FIELDS.reduce((o, f) => { o[f.id] = document.getElementById(f.id)?.value.trim(); return o; }, {});
  if (RECINTO_FIELDS.filter(f=>f.required).some(f => !vals[f.id])) {
    toast('Rellena todos los campos obligatorios (*)', 'err'); return;
  }
  const c = {
    prov: +vals.s_prov, mun: +vals.s_mun, ag: +vals.s_ag, zona: +vals.s_zona,
    pol: +vals.s_pol, par: +vals.s_par, rec: +vals.s_rec,
    code: [vals.s_prov,vals.s_mun,vals.s_ag,vals.s_zona,vals.s_pol,vals.s_par,vals.s_rec].join('-')
  };
  toast('Buscando recinto…');
  try {
    const result = await fetchSigpacGeometry(c);
    if (!result) { toast('Recinto no encontrado', 'err'); return; }
    if (searchHighlight) map.removeLayer(searchHighlight);
    searchHighlight = L.geoJSON({ type:'Feature', geometry: result.geometry }, {
      style: { color: '#2f6fde', weight: 2.5, fillColor: '#2f6fde', fillOpacity: 0.22 }
    }).addTo(map);
    map.fitBounds(searchHighlight.getBounds(), { padding: [60, 60] });
    toast('Recinto encontrado', 'ok');
    if (document.getElementById('search-add-toggle').checked) {
      const geojson = { type:'FeatureCollection', features: [{ type:'Feature', geometry: result.geometry,
        properties: { CODIGO: c.code, PROVINCIA: c.prov, MUNICIPIO: c.mun, AGREGADO: c.ag,
          ZONA: c.zona, POLIGONO: c.pol, PARCELA: c.par, RECINTO: c.rec, ...result.extraProps } }] };
      addShpLayer(geojson, 'Recinto ' + c.code);
    }
  } catch(err) { toast('Error en la búsqueda: ' + err.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════════
// 7c. GEOLOCALIZACIÓN
// ═══════════════════════════════════════════════════════════════
let geoActive    = false;
let geoWatchId   = null;
let geoMarker    = null;
let geoAccCircle = null;
let geoFollowing = true;

const geoBtn = document.getElementById('geolocate-btn');

function buildGeoIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="5" fill="#2f6fde" stroke="white" stroke-width="2"/>
    <circle cx="10" cy="10" r="9" fill="none" stroke="#2f6fde" stroke-width="1" opacity="0.4"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [20, 20], iconAnchor: [10, 10] });
}

function startGeo() {
  if (!navigator.geolocation) {
    toast('Geolocalización no disponible en este navegador', 'err'); return;
  }
  geoActive    = true;
  geoFollowing = true;
  geoBtn.classList.add('active');
  geoBtn.title = 'Desactivar localización';
  toast('Obteniendo ubicación…');

  const onPos = pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (!geoMarker) {
      geoMarker    = L.marker([lat, lng], { icon: buildGeoIcon(), zIndexOffset: 1000 }).addTo(map);
      geoAccCircle = L.circle([lat, lng], {
        radius: accuracy, color: '#2f6fde', weight: 1,
        fillColor: '#2f6fde', fillOpacity: 0.08, interactive: false
      }).addTo(map);
    } else {
      geoMarker.setLatLng([lat, lng]);
      geoAccCircle.setLatLng([lat, lng]);
      geoAccCircle.setRadius(accuracy);
    }
    if (geoFollowing) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  };

  const onWatchErr = err => {
    const msgs = { 1:'Permiso denegado', 2:'Posición no disponible', 3:'Sin señal GPS' };
    toast('GPS: ' + (msgs[err.code] || err.message), 'err');
    stopGeo();
  };

  const onInitErr = () => {};

  navigator.geolocation.getCurrentPosition(onPos, onInitErr,
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );

  geoWatchId = navigator.geolocation.watchPosition(onPos, onWatchErr,
    { enableHighAccuracy: true, maximumAge: 5000 }
  );

  map.once('dragstart', () => {
    geoFollowing = false;
    geoBtn.title = 'Recentrar (clic) · Desactivar (clic en azul)';
    toast('Seguimiento pausado — clic para recentrar');
  });
}

function stopGeo() {
  if (geoWatchId !== null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
  if (geoMarker)    { map.removeLayer(geoMarker);    geoMarker    = null; }
  if (geoAccCircle) { map.removeLayer(geoAccCircle); geoAccCircle = null; }
  geoActive    = false;
  geoFollowing = false;
  geoBtn.classList.remove('active');
  geoBtn.title = 'Mi ubicación';
}

geoBtn.addEventListener('click', () => {
  if (!geoActive) {
    startGeo();
  } else if (!geoFollowing) {
    geoFollowing = true;
    geoBtn.title = 'Desactivar localización';
    if (geoMarker) map.setView(geoMarker.getLatLng(), Math.max(map.getZoom(), 16));
    map.once('dragstart', () => {
      geoFollowing = false;
      geoBtn.title = 'Recentrar en mi posición (clic) / Desactivar (doble clic)';
    });
    toast('Recentrando…');
  } else {
    stopGeo();
    toast('Localización desactivada');
  }
});

applyQueryMode(queryMode);

// ═══════════════════════════════════════════════════════════════
// BÚSQUEDA CULTIVO DECLARADO — OGC API Features
// ═══════════════════════════════════════════════════════════════
(function () {
  const OGCAPI_BASE = 'https://sigpac-hubcloud.es/ogcapi/collections/cultivo_declarado/items';
  const HINTS = {
    ldg: 'Identificador único de la línea de declaración gráfica (DN_OID)',
    exp: 'Código de expediente — normalmente empieza por 08 (ej: 08-12345-0001)'
  };

  // ── Estado ─────────────────────────────────────────────────
  let cultivoMode       = 'ldg';   // 'ldg' | 'exp'
  let cultivoResults    = [];      // GeoJSON features encontrados
  let cultivoHighlight  = null;    // L.geoJSON layer en el mapa

  // ── Elementos desktop ──────────────────────────────────────
  const panel       = document.getElementById('cultivo-search-panel');
  const openBtn     = document.getElementById('search-cultivo-btn');
  const closeBtn    = document.getElementById('cultivo-panel-close');
  const searchBtn   = document.getElementById('cultivo-search-btn');
  const loadBtn     = document.getElementById('cultivo-load-btn');
  const inputEl     = document.getElementById('cultivo-search-input');
  const resultsEl   = document.getElementById('cultivo-results');
  const hintEl      = document.getElementById('cultivo-mode-hint');
  const modeLdgBtn  = document.getElementById('cultivo-mode-ldg');
  const modeExpBtn  = document.getElementById('cultivo-mode-exp');

  // ── Elementos móvil ────────────────────────────────────────
  const mobPanel      = document.getElementById('mob-cultivo-panel');
  const mobOpenBtn    = document.getElementById('mob-search-cultivo-btn');
  const mobCloseBtn   = document.getElementById('mob-cultivo-close');
  const mobSearchBtn  = document.getElementById('mob-cultivo-search-btn');
  const mobLoadBtn    = document.getElementById('mob-cultivo-load-btn');
  const mobInputEl    = document.getElementById('mob-cultivo-input');
  const mobResultsEl  = document.getElementById('mob-cultivo-results');
  const mobHintEl     = document.getElementById('mob-cultivo-hint');
  const mobModeLdg    = document.getElementById('mob-cultivo-mode-ldg');
  const mobModeExp    = document.getElementById('mob-cultivo-mode-exp');

  // ── Helpers ────────────────────────────────────────────────
  function setMode(mode, isMob) {
    cultivoMode = mode;
    const hint = HINTS[mode];
    // Desktop
    if (hintEl) hintEl.textContent = hint;
    if (modeLdgBtn) modeLdgBtn.classList.toggle('active', mode === 'ldg');
    if (modeExpBtn) modeExpBtn.classList.toggle('active', mode === 'exp');
    if (inputEl) { inputEl.value = ''; inputEl.placeholder = mode === 'ldg' ? 'Ej: 123456789' : 'Ej: 08-12345-0001'; }
    // Móvil
    if (mobHintEl) mobHintEl.textContent = hint;
    if (mobModeLdg) mobModeLdg.classList.toggle('active', mode === 'ldg');
    if (mobModeExp) mobModeExp.classList.toggle('active', mode === 'exp');
    if (mobInputEl) { mobInputEl.value = ''; mobInputEl.placeholder = mode === 'ldg' ? 'Ej: 123456789' : 'Ej: 08-12345-0001'; }
    resetResults();
  }

  function setResults(features) {
    cultivoResults = features;
    const has = features.length > 0;
    if (loadBtn)    { loadBtn.disabled = !has;    loadBtn.style.opacity    = has ? '1' : '.4'; }
    if (mobLoadBtn) { mobLoadBtn.disabled = !has; mobLoadBtn.style.opacity = has ? '1' : '.4'; }
  }

  function resetResults() {
    // Quitar highlight del mapa
    if (cultivoHighlight) { map.removeLayer(cultivoHighlight); cultivoHighlight = null; }
    setResults([]);
    if (resultsEl)    resultsEl.innerHTML    = '';
    if (mobResultsEl) mobResultsEl.innerHTML = '';
  }

  function openPanel() {
    // Cerrar otros paneles
    document.getElementById('search-panel')?.classList.remove('open');
    document.getElementById('gan-search-panel')?.classList.remove('open');
    document.getElementById('search-recinto-btn')?.classList.remove('active-search');
    document.getElementById('search-ganaderia-btn')?.classList.remove('active-search');
    panel.classList.add('open');
    openBtn.classList.add('active-search');
    setMode(cultivoMode);
    setTimeout(() => inputEl?.focus(), 80);
  }

  function closePanel() {
    panel.classList.remove('open');
    openBtn.classList.remove('active-search');
    resetResults();
  }

  function openMobPanel() {
    // Cerrar otros bottom sheets
    document.getElementById('mob-search-recinto-panel')?.classList.remove('open');
    document.getElementById('mob-gan-panel')?.classList.remove('open');
    document.getElementById('mob-layers-panel')?.classList.remove('open');
    mobPanel.classList.add('open');
    setMode(cultivoMode);
    setTimeout(() => mobInputEl?.focus(), 80);
  }

  function closeMobPanel() {
    mobPanel.classList.remove('open');
    resetResults();
    if (mobInputEl) mobInputEl.value = '';
  }

  // ── Consulta OGC API ───────────────────────────────────────
  async function doSearch(isMob) {
    const input  = isMob ? mobInputEl : inputEl;
    const resEl  = isMob ? mobResultsEl : resultsEl;
    const val    = input?.value?.trim();

    if (!val) { toast('Introduce un valor para buscar', 'err'); return; }

    resEl.innerHTML = `<div class="gan-progress"><div class="shp-spin"></div>Buscando…</div>`;
    resetResults();

    try {
      // Construir URL según modo
      const params = new URLSearchParams({ f: 'json', limit: 500 });
      if (cultivoMode === 'ldg') {
        params.set('DN_OID', val);
      } else {
        // Expediente: intentar con EXP_NUM primero
        params.set('EXP_NUM', val);
      }

      const url = `${OGCAPI_BASE}?${params}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();
      const features = geojson.features || [];

      if (!features.length) {
        // Segundo intento para expediente con campo alternativo
        if (cultivoMode === 'exp') {
          const params2 = new URLSearchParams({ f: 'json', limit: 500, DN_OID: val });
          const res2 = await fetch(`${OGCAPI_BASE}?${params2}`);
          const gj2  = await res2.json();
          if (gj2.features?.length) {
            renderResults(gj2.features, resEl, isMob);
            return;
          }
        }
        resEl.innerHTML = `<div class="gan-msg">Sin resultados para <b>${esc(val)}</b></div>`;
        return;
      }

      renderResults(features, resEl, isMob);

    } catch(err) {
      resEl.innerHTML = `<div class="gan-msg">Error: ${esc(err.message)}</div>`;
      console.error('Cultivo OGC API error:', err);
    }
  }

  function renderResults(features, resEl, isMob) {
    resEl.innerHTML = '';
    setResults(features);

    // Resumen
    const header = document.createElement('div');
    header.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:10px;color:var(--muted);margin-bottom:4px;';
    header.textContent = features.length === 1
      ? '1 resultado encontrado'
      : `${features.length} resultados encontrados`;
    resEl.appendChild(header);

    // Mostrar hasta 5 resultados en la lista
    features.slice(0, 5).forEach((f, i) => {
      const p   = f.properties || {};
      const div = document.createElement('div');
      div.className = 'gan-result-item';
      const ldg  = p.DN_OID  || p.dn_oid  || '—';
      const exp  = p.EXP_NUM || p.exp_num || '—';
      const cult = p.USO_SIGPAC || p.CULTIVO || p.cultivo || '—';
      div.innerHTML = `
        <div class="gan-result-cod">${esc(String(ldg))}</div>
        <div class="gan-result-especie">${esc(String(cult))}</div>
        <div class="gan-result-coords" style="font-size:9px;">Exp: ${esc(String(exp))}</div>`;
      resEl.appendChild(div);
    });

    if (features.length > 5) {
      const more = document.createElement('div');
      more.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:9px;color:var(--muted);text-align:center;padding:4px 0;';
      more.textContent = `… y ${features.length - 5} más`;
      resEl.appendChild(more);
    }

    // Dibujar highlight en el mapa
    drawCultivoHighlight(features);
  }

  function drawCultivoHighlight(features) {
    if (cultivoHighlight) { map.removeLayer(cultivoHighlight); cultivoHighlight = null; }
    const fc = { type: 'FeatureCollection', features };
    cultivoHighlight = L.geoJSON(fc, {
      style: { color: '#2e7d32', weight: 2.5, fillColor: '#2e7d32', fillOpacity: 0.25 },
      interactive: false
    }).addTo(map);
    const b = cultivoHighlight.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 17 });
  }

  function loadToMap() {
    if (!cultivoResults.length) return;
    const fc   = { type: 'FeatureCollection', features: cultivoResults };
    const val  = (inputEl?.value || mobInputEl?.value || '').trim();
    const name = `Cultivo ${cultivoMode === 'ldg' ? 'LDG' : 'Exp'} ${val}`;
    addShpLayer(fc, name, null, true, false);
    toast(`${cultivoResults.length} geometría${cultivoResults.length > 1 ? 's' : ''} añadida${cultivoResults.length > 1 ? 's' : ''} al mapa`, 'ok');
    closePanel();
    closeMobPanel();
  }

  // ── Event listeners desktop ────────────────────────────────
  openBtn?.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
  closeBtn?.addEventListener('click', closePanel);
  panel?.addEventListener('click', e => { if (e.target === panel) closePanel(); });
  modeLdgBtn?.addEventListener('click', () => setMode('ldg'));
  modeExpBtn?.addEventListener('click', () => setMode('exp'));
  searchBtn?.addEventListener('click', () => doSearch(false));
  inputEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(false); });
  loadBtn?.addEventListener('click', loadToMap);

  // ── Event listeners móvil ──────────────────────────────────
  mobOpenBtn?.addEventListener('click', () => mobPanel.classList.contains('open') ? closeMobPanel() : openMobPanel());
  mobCloseBtn?.addEventListener('click', closeMobPanel);
  mobModeLdg?.addEventListener('click', () => setMode('ldg', true));
  mobModeExp?.addEventListener('click', () => setMode('exp', true));
  mobSearchBtn?.addEventListener('click', () => doSearch(true));
  mobInputEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(true); });
  mobLoadBtn?.addEventListener('click', loadToMap);

  // Inicializar hint
  setMode('ldg');
})();

// ═══════════════════════════════════════════════════════════════