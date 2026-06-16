// ════════════════════════════════════════════════════════
// MÓDULO: js/shp-writer.js
// SHP WRITER BINARIO
// ════════════════════════════════════════════════════════
// SHP WRITER — generador SHP binario embebido
// ═══════════════════════════════════════════════════════════════
const SHP_PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

function makeWriter(size) {
  const buf = new ArrayBuffer(size);
  const dv  = new DataView(buf);
  let pos = 0;
  return {
    i16be: v  => { dv.setInt16(pos, v, false);    pos += 2; },
    i32be: v  => { dv.setInt32(pos, v, false);    pos += 4; },
    i32le: v  => { dv.setInt32(pos, v, true);     pos += 4; },
    f64le: v  => { dv.setFloat64(pos, v, true);   pos += 8; },
    bytes: (b,n) => { new Uint8Array(buf, pos, n).set(b.subarray ? b.subarray(0,n) : b); pos += n; },
    pos:   ()    => pos,
    seek:  p     => { pos = p; },
    buf:   ()    => buf
  };
}

function ringBbox(ring) {
  let xMin=Infinity,yMin=Infinity,xMax=-Infinity,yMax=-Infinity;
  for (const [x,y] of ring) {
    if (x<xMin)xMin=x; if (x>xMax)xMax=x;
    if (y<yMin)yMin=y; if (y>yMax)yMax=y;
  }
  return {xMin,yMin,xMax,yMax};
}
function mergeBbox(a,b) {
  return {
    xMin:Math.min(a.xMin,b.xMin), yMin:Math.min(a.yMin,b.yMin),
    xMax:Math.max(a.xMax,b.xMax), yMax:Math.max(a.yMax,b.yMax)
  };
}

function flatRing(ring) { return ring.map(p => [p[0], p[1]]); }

function shpType(fc) {
  const types = new Set(fc.features.map(f => f.geometry?.type).filter(Boolean));
  if ([...types].every(t => t==='Point'||t==='MultiPoint'))        return 1;
  if ([...types].every(t => t==='LineString'||t==='MultiLineString')) return 3;
  return 5;
}

function featureRings(geom, type) {
  if (!geom) return [];
  if (type === 1) {
    const pts = geom.type==='MultiPoint' ? geom.coordinates : [geom.coordinates];
    return pts.map(p => [p]);
  }
  if (type === 3) {
    const lines = geom.type==='MultiLineString' ? geom.coordinates : [geom.coordinates];
    return lines;
  }
  const polys = geom.type==='MultiPolygon' ? geom.coordinates : [geom.coordinates];
  return polys.flatMap(p => p);
}

function writePolyRecord(rings) {
  const flat = rings.map(flatRing);
  const numParts  = flat.length;
  const numPoints = flat.reduce((s,r) => s+r.length, 0);
  const contentLen = (4 + 32 + 4 + 4 + numParts*4 + numPoints*16) / 2;
  const w = makeWriter(8 + contentLen*2);
  let bbox = ringBbox(flat[0]);
  flat.slice(1).forEach(r => { bbox = mergeBbox(bbox, ringBbox(r)); });

  w.i32be(0);
  w.i32be(contentLen);
  w.i32le(5);
  w.f64le(bbox.xMin); w.f64le(bbox.yMin);
  w.f64le(bbox.xMax); w.f64le(bbox.yMax);
  w.i32le(numParts);
  w.i32le(numPoints);
  let off = 0;
  for (const r of flat) { w.i32le(off); off += r.length; }
  for (const r of flat) for (const [x,y] of r) { w.f64le(x); w.f64le(y); }
  return { buf: w.buf(), contentLen, bbox };
}

function writePointRecord(pt) {
  const contentLen = (4 + 16) / 2;
  const w = makeWriter(8 + 20);
  w.i32be(0);
  w.i32be(contentLen);
  w.i32le(1);
  w.f64le(pt[0]); w.f64le(pt[1]);
  return { buf: w.buf(), contentLen, bbox:{xMin:pt[0],yMin:pt[1],xMax:pt[0],yMax:pt[1]} };
}

function buildDbf(features) {
  if (!features.length) return new Uint8Array(32+1).buffer;
  const props = features[0].properties || {};
  const fieldNames = Object.keys(props).map(k => k.slice(0,10).toUpperCase());
  const numFields  = fieldNames.length;
  const fieldLen   = 50;
  const recSize    = 1 + numFields * fieldLen;
  const headerSize = 32 + numFields * 32 + 1;
  const buf = new ArrayBuffer(headerSize + features.length * recSize + 1);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  let p = 0;

  u8[p++] = 3;
  const now = new Date();
  u8[p++] = now.getFullYear()-1900; u8[p++] = now.getMonth()+1; u8[p++] = now.getDate();
  dv.setUint32(4, features.length, true);
  dv.setUint16(8, headerSize, true);
  dv.setUint16(10, recSize, true);
  p = 32;

  const enc = new TextEncoder();
  for (let i=0; i<fieldNames.length; i++) {
    const nameBytes = enc.encode(fieldNames[i]);
    u8.set(nameBytes.subarray(0,Math.min(11,nameBytes.length)), p);
    p += 11;
    u8[p++] = 67;
    p += 4;
    u8[p++] = fieldLen;
    p += 15;
  }
  u8[p++] = 0x0D;

  const keys = Object.keys(props);
  for (const f of features) {
    u8[p++] = 0x20;
    for (const k of keys) {
      const val = String(f.properties?.[k] ?? '').slice(0, fieldLen);
      const vb  = enc.encode(val);
      u8.fill(0x20, p, p+fieldLen);
      u8.set(vb.subarray(0, Math.min(fieldLen, vb.length)), p);
      p += fieldLen;
    }
  }
  u8[p] = 0x1A;
  return buf;
}

function buildShpShx(fc, type) {
  const records = [];
  let totalContentWords = 0;

  for (const f of fc.features) {
    const rings = featureRings(f.geometry, type);
    if (!rings.length) continue;

    let rec;
    if (type === 1) {
      const pts = f.geometry.type==='MultiPoint' ? f.geometry.coordinates : [f.geometry.coordinates];
      for (const pt of pts) {
        rec = writePointRecord(pt);
        records.push(rec);
        totalContentWords += 4 + rec.contentLen;
      }
    } else {
      rec = writePolyRecord(rings);
      const dv = new DataView(rec.buf);
      dv.setInt32(12, type, true);
      records.push(rec);
      totalContentWords += 4 + rec.contentLen;
    }
  }

  const fileLen   = 50 + totalContentWords;
  const shpSize   = fileLen * 2;
  const shxSize   = (50 + records.length * 4) * 2;

  const shpBuf = new ArrayBuffer(shpSize);
  const shxBuf = new ArrayBuffer(shxSize);
  const shpDv  = new DataView(shpBuf);
  const shxDv  = new DataView(shxBuf);

  let bbox = {xMin:Infinity,yMin:Infinity,xMax:-Infinity,yMax:-Infinity};
  for (const r of records) bbox = mergeBbox(bbox, r.bbox);
  if (!isFinite(bbox.xMin)) bbox = {xMin:0,yMin:0,xMax:0,yMax:0};

  function writeHeader(dv, fileLen, type, bbox) {
    dv.setInt32(0,  9994,    false);
    dv.setInt32(24, fileLen, false);
    dv.setInt32(28, 1000,    true);
    dv.setInt32(32, type,    true);
    dv.setFloat64(36, bbox.xMin, true); dv.setFloat64(44, bbox.yMin, true);
    dv.setFloat64(52, bbox.xMax, true); dv.setFloat64(60, bbox.yMax, true);
  }
  writeHeader(shpDv, fileLen, type, bbox);
  writeHeader(shxDv, 50 + records.length*4, type, bbox);

  let shpOff = 100, shxOff = 100;
  for (let i=0; i<records.length; i++) {
    const r   = records[i];
    const src = new Uint8Array(r.buf);
    shpDv.setInt32(shpOff,   i+1,           false);
    shpDv.setInt32(shpOff+4, r.contentLen,  false);
    new Uint8Array(shpBuf, shpOff+8).set(src.subarray(8, 8+r.contentLen*2));
    shxDv.setInt32(shxOff,   shpOff/2,      false);
    shxDv.setInt32(shxOff+4, r.contentLen,  false);
    shpOff += 8 + r.contentLen*2;
    shxOff += 8;
  }

  return { shpBuf, shxBuf, dbfBuf: buildDbf(fc.features) };
}

async function exportShpZip(id) {
  const layer = shpLayers.find(l => l.id === id);
  if (!layer) return;
  toast('Generando SHP…');

  try {
    const enriched = enrichGeojsonWithChecklist(layer.id, layer.geojson);
    const fc = (() => {
      const g = enriched;
      if (!g) return { type:'FeatureCollection', features:[] };
      if (g.type === 'FeatureCollection') return g;
      if (Array.isArray(g)) return { type:'FeatureCollection',
        features: g.flatMap(x => x.type==='FeatureCollection' ? x.features : [x]) };
      return { type:'FeatureCollection', features:[g] };
    })();

    if (!fc.features.length) { toast('La capa no tiene features', 'err'); return; }

    const type = shpType(fc);
    const { shpBuf, shxBuf, dbfBuf } = buildShpShx(fc, type);

    if (!window.JSZip) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const zip  = new window.JSZip();
    const name = layer.name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\-]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'capa';
    zip.file(name + '.shp', shpBuf);
    zip.file(name + '.shx', shxBuf);
    zip.file(name + '.dbf', dbfBuf);
    zip.file(name + '.prj', SHP_PRJ_WGS84);

    const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE',
      compressionOptions:{ level:6 } });

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = name + '.zip'; a.click();
    URL.revokeObjectURL(url);
    toast(`SHP "${layer.name}" descargado`, 'ok');

  } catch(err) {
    console.error('exportShpZip:', err);
    toast('Error al exportar SHP: ' + err.message, 'err');
  }
}

// ── Exportar resultados de visitas (checklist) a Excel ──
async function exportShpExcel(id) {
  const layer = shpLayers.find(l => l.id === id);
  if (!layer) return;
  toast('Generando Excel…');

  try {
    const allFeatures = [];
    const collect = g => {
      if (!g) return;
      if (Array.isArray(g)) { g.forEach(collect); return; }
      if (g.type === 'FeatureCollection') g.features?.forEach(f => allFeatures.push(f));
      else if (g.type === 'Feature') allFeatures.push(g);
    };
    collect(layer.geojson);

    if (!allFeatures.length) { toast('La capa no tiene features', 'err'); return; }

    const customLabels = getCustomFields(layer.id);

    const rows = allFeatures.map((f, idx) => {
      const saved = getChecklistData(layer.id, idx);
      const row = {};
      const props = f.properties || {};
      for (const k in props) {
        if (k.startsWith('_')) continue;
        row[k] = props[k];
      }
      row['Visitado']     = saved?.visitado ? 'Sí' : 'No';
      row['Técnico']      = saved?.tecnico || '';
      row['Fecha visita'] = formatVisitDate(saved?.visitDate);
      customLabels.forEach((label, i) => {
        if (!label || !label.trim()) return;
        row[label] = saved?.custom?.[i] || '';
      });
      row['Observaciones'] = saved?.comentario || '';
      return row;
    });

    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Visitas');

    const name = layer.name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\-]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'capa';

    window.XLSX.writeFile(wb, name + '_visitas.xlsx');
    toast(`Excel "${layer.name}" descargado`, 'ok');

  } catch(err) {
    console.error('exportShpExcel:', err);
    toast('Error al exportar Excel: ' + err.message, 'err');
  }
}

// ── TRAMAS GPS ──
const trackGroup = L.layerGroup().addTo(map);
const tracks = [];

function decryptGPS(cadena) {
  try { for (let i = 0; i < 3; i++) cadena = atob(cadena.trim()); return cadena; }
  catch(_) { return null; }
}
function parseNMEA(text) {
  let lat = null, lng = null, fecha = null, hora = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('$GPGGA') || line.startsWith('$GNGGA')) {
      const p = line.split(',');
      if (p.length >= 6 && p[2] && p[4]) {
        const lt = parseNMEACoord(p[2], p[3]), ln = parseNMEACoord(p[4], p[5]);
        if (lt !== null && ln !== null) { lat = lt; lng = ln; }
        if (p[1]) hora = fmtNMEATime(p[1]);
      }
    }
    if (line.startsWith('$GPRMC') || line.startsWith('$GNRMC')) {
      const p = line.split(',');
      if (p.length >= 7 && p[3] && p[5]) {
        const lt = parseNMEACoord(p[3], p[4]), ln = parseNMEACoord(p[5], p[6]);
        if (lt !== null && ln !== null) { lat = lt; lng = ln; }
        if (p[1]) hora = fmtNMEATime(p[1]); if (p[9]) fecha = fmtNMEADate(p[9]);
      }
    }
    if (line.startsWith('$GPGLL') || line.startsWith('$GNGLL')) {
      const p = line.split(',');
      if (p.length >= 5 && p[1] && p[3]) {
        const lt = parseNMEACoord(p[1], p[2]), ln = parseNMEACoord(p[3], p[4]);
        if (lt !== null && ln !== null) { lat = lt; lng = ln; }
        if (p[5]) hora = fmtNMEATime(p[5]);
      }
    }
    if (lat !== null && lng !== null && fecha && hora) break;
  }
  return { lat, lng, fecha, hora };
}
function parseNMEACoord(val, hemi) {
  if (!val || !hemi) return null;
  const v = parseFloat(val); if (isNaN(v)) return null;
  const deg = Math.floor(v / 100), min = v - deg * 100;
  let dec = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') dec = -dec;
  return dec;
}
function fmtNMEATime(t) { return (!t || t.length < 6) ? null : t.slice(0,2)+':'+t.slice(2,4)+':'+t.slice(4,6); }
function fmtNMEADate(d) { return (!d || d.length < 6) ? null : d.slice(0,2)+'/'+d.slice(2,4)+'/20'+d.slice(4,6); }

function buildTrackIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28" style="overflow:visible;display:block;">
    <path d="M11 0C5 0 1 5 1 10c0 7 10 18 10 18S21 17 21 10C21 5 17 0 11 0z" fill="#e06c00" stroke="white" stroke-width="1.5"/>
    <circle cx="11" cy="10" r="4" fill="white" opacity="0.9"/>
    <text x="11" y="13" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="5.5" font-weight="bold" fill="#e06c00">GPS</text>
  </svg>`;
  return L.divIcon({ html: svg, className: 'cam-wrap', iconSize: [22, 28], iconAnchor: [11, 28], popupAnchor: [0, -30] });
}

function processTxtAsTrama(files) {
  let ok = 0, fail = 0;
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = ev => {
      const raw  = ev.target.result.trim();
      let nmea   = decryptGPS(raw); if (!nmea) nmea = raw;
      const info = parseNMEA(nmea);
      if (info.lat === null) { fail++; return; }
      info.id = Math.random().toString(36).slice(2,11);
      info.fileName = file.name; info.visible = true;
      const marker = L.marker([info.lat, info.lng], { icon: buildTrackIcon(), zIndexOffset: 100 }).addTo(trackGroup);
      info.marker = marker;
      const popup = L.popup({ maxWidth: 200, autoPan: false });
      marker.on('click', ev2 => {
        L.DomEvent.stopPropagation(ev2);
        const utm = utmLabel(info.lat, info.lng);
        popup.setContent(`<div style="font-family:DM Sans,sans-serif;font-size:11px;padding:8px;">
          <div style="font-weight:700;margin-bottom:4px;">📡 ${esc(info.fileName)}</div>
          <div>${[info.fecha,info.hora].filter(Boolean).join(' ')}</div>
          <div>${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}</div>
          <div style="color:var(--blue);">${utm}</div></div>`);
        popup.setLatLng([info.lat, info.lng]); popup.openOn(map);
      });
      tracks.push(info);
      addTrackToUnified(info);
      ok++;
      if (ok + fail === files.length && ok > 0) {
        toast(`${ok} punto${ok>1?'s':''} GPS añadido${ok>1?'s':''}`, 'ok');
        map.setView([info.lat, info.lng], 16);
        updateCounter();
      }
    };
    reader.readAsText(file);
  }
}

function addTrackToUnified(info) {
  const list = document.getElementById('unifiedList');
  document.getElementById('unified-empty').style.display = 'none';
  const card = document.createElement('div');
  card.className = 'list-item'; card.dataset.id = info.id; card.dataset.type = 'track';
  const utm = utmLabel(info.lat, info.lng);
  const dt  = [info.fecha, info.hora].filter(Boolean).join(' ') || '—';
  card.innerHTML = `
    <input type="checkbox" class="photo-vis" checked style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer;flex-shrink:0;">
    <div style="width:32px;height:32px;border-radius:5px;background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px;">📡</div>
    <div class="item-info">
      <div class="item-name">${esc(info.fileName)}</div>
      <div class="item-sub" style="color:var(--blue);">${dt} · ${utm}</div>
    </div>
    <div class="item-actions"><button class="item-del" title="Eliminar">✕</button></div>`;
  card.querySelector('.photo-vis').addEventListener('change', e => {
    e.stopPropagation(); info.visible = e.target.checked;
    card.classList.toggle('hidden-photo', !info.visible);
    info.visible ? info.marker.addTo(trackGroup) : trackGroup.removeLayer(info.marker);
  });
  card.onclick = () => { map.setView([info.lat, info.lng], 18); info.marker.fire('click'); };
  card.querySelector('.item-del').onclick = e => {
    e.stopPropagation(); trackGroup.removeLayer(info.marker);
    tracks.splice(tracks.findIndex(t => t.id === info.id), 1);
    card.remove(); updateCounter();
  };
  const firstShp = list.querySelector('.list-item[data-type="shp"]');
  list.insertBefore(card, firstShp || document.getElementById('unified-empty'));
}

// ═══════════════════════════════════════════════════════════════