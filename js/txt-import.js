// ════════════════════════════════════════════════════════
// MÓDULO: js/txt-import.js
// IMPORTACIÓN TXT SIGPAC
// ════════════════════════════════════════════════════════
// 9. IMPORTACIÓN TXT CÓDIGOS SIGPAC
// ═══════════════════════════════════════════════════════════════
const txtFileInput = document.getElementById('txtFileInput');
const txtDropzone  = document.getElementById('txt-dropzone');

txtFileInput.addEventListener('change', e => { handleTxtFile(e.target.files[0]); e.target.value = ''; });
txtDropzone.addEventListener('dragover',  e => { e.preventDefault(); txtDropzone.classList.add('drag-over'); });
txtDropzone.addEventListener('dragleave', () => txtDropzone.classList.remove('drag-over'));
txtDropzone.addEventListener('drop', e => {
  e.preventDefault(); txtDropzone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleTxtFile(e.dataTransfer.files[0]);
});

function parseSigpacLine(line) {
  const normalized = line.trim().replace(/\s+/g, '').replace(/\//g, '-');
  if (!/^\d+-\d+-\d+-\d+-\d+-\d+-\d+$/.test(normalized)) return null;
  const parts = normalized.split('-').map(Number);
  if (parts.length !== 7 || parts.some(isNaN)) return null;
  const [prov, mun, ag, zona, pol, par, rec] = parts;
  return { code: normalized, prov, mun, ag, zona, pol, par, rec };
}

function parseSigpacCodes(text) {
  return text.split(/\r?\n/)
    .map(parseSigpacLine)
    .filter(Boolean);
}

async function handleTxtFile(file) {
  if (!file) return;
  const text = await file.text();

  const trimmed = text.trim();
  const decrypted = decryptGPS(trimmed);
  const isNMEA = str => /\$GP[A-Z]{3}|\$GN[A-Z]{3}/.test(str);
  if (isNMEA(trimmed) || (decrypted && isNMEA(decrypted))) {
    processTxtAsTrama([file]);
    return;
  }

  const codes = parseSigpacCodes(text);
  if (!codes.length) {
    processTxtAsTrama([file]);
    return;
  }

  const layerName = file.name.replace(/\.[^.]+$/, '');
  toast(`Consultando ${codes.length} recintos SIGPAC…`);

  const panel  = document.getElementById('sigpac-import-panel');
  const pbar   = document.getElementById('sigpac-pbar');
  const plabel = document.getElementById('sigpac-plabel');
  panel.style.display = '';

  const features = [];
  const failed   = [];

  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    plabel.textContent = `Consultando ${i+1} / ${codes.length} — ${c.code}`;
    pbar.style.width   = ((i + 1) / codes.length * 100) + '%';

    try {
      const geom = await fetchSigpacGeometry(c);
      if (geom) {
        features.push({
          type: 'Feature',
          geometry: geom.geometry,
          properties: {
            CODIGO:    c.code,
            PROVINCIA: c.prov, MUNICIPIO: c.mun,
            AGREGADO:  c.ag,   ZONA:      c.zona,
            POLIGONO:  c.pol,  PARCELA:   c.par, RECINTO: c.rec,
            ...geom.extraProps
          }
        });
      } else {
        failed.push(c.code);
      }
    } catch(err) {
      console.warn('Error recinto', c.code, err);
      failed.push(c.code);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  panel.style.display = 'none';
  pbar.style.width = '0%';

  if (!features.length) {
    toast('No se pudo obtener geometría de ningún recinto.', 'err');
    return;
  }

  const geojson = { type: 'FeatureCollection', features };
  addShpLayer(geojson, layerName, null, true);

  const msg = failed.length
    ? `${features.length} recintos importados (${failed.length} no encontrados: ${failed.slice(0,3).join(', ')}${failed.length>3?'…':''})`
    : `${features.length} recintos importados correctamente`;
  toast(msg, features.length ? 'ok' : 'err');
}

async function fetchSigpacGeometry(c) {
  const where = [
    `PROVINCIA=${c.prov}`,
    `MUNICIPIO=${c.mun}`,
    `AGREGADO=${c.ag}`,
    `ZONA=${c.zona}`,
    `POLIGONO=${c.pol}`,
    `PARCELA=${c.par}`,
    `RECINTO=${c.rec}`
  ].join(' AND ');

  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'true',
    outSR:          '4326',
    f:              'geojson',
  });

  const res  = await fetch(`${ARCGIS_REST_URL}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  if (json.error) {
    console.warn('ArcGIS error:', json.error.message);
    throw new Error(json.error.message);
  }

  const feat = json.features?.[0];
  if (!feat?.geometry) return null;

  const { geometry, properties } = feat;
  const extraProps = {};
  for (const k in properties) {
    if (!['PROVINCIA','MUNICIPIO','AGREGADO','ZONA','POLIGONO','PARCELA','RECINTO'].includes(k)) {
      extraProps[k] = properties[k];
    }
  }

  return { geometry, extraProps };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
let toastTimer;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show' + (type ? ' '+type : '');
  clearTimeout(toastTimer); const _dur = window.innerWidth <= 700 ? 1800 : 3200; toastTimer = setTimeout(() => el.className = '', _dur);
}

const fileInput = document.getElementById('fileInput');
const dropzone  = document.getElementById('dropzone');
fileInput.addEventListener('change', e => { processFiles([...e.target.files]); e.target.value=''; });

// Lectura recursiva de carpetas arrastradas
async function readEntryRecursive(entry, out) {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise(res => entry.file(f => { out.push(f); res(); }, () => res()));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    await new Promise(res => {
      const read = () => reader.readEntries(es => {
        if (!es.length) return res();
        all.push(...es); read();
      }, () => res());
      read();
    });
    for (const e of all) await readEntryRecursive(e, out);
  }
}
async function filesFromDataTransfer(dt) {
  const items = dt.items;
  if (items && items.length && items[0].webkitGetAsEntry) {
    const entries = [];
    for (const it of items) { const en = it.webkitGetAsEntry?.(); if (en) entries.push(en); }
    const out = [];
    for (const en of entries) await readEntryRecursive(en, out);
    return out;
  }
  return [...dt.files];
}

// Importante: el <input type=file> cubre el dropzone (inset:0) e intercepta el drop
// rechazando carpetas. Adjuntamos los handlers también al input para soportarlas.
function wirePhotoDrop(el) {
  el.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag-over'); });
  el.addEventListener('dragleave', e => { e.stopPropagation(); dropzone.classList.remove('drag-over'); });
  el.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('drag-over');
    const files = await filesFromDataTransfer(e.dataTransfer);
    processFiles(files);
  });
}
wirePhotoDrop(dropzone);
wirePhotoDrop(fileInput);


// ── HAMBURGER ──
const menuBtn   = document.getElementById('menu-btn');
const sidebarEl = document.querySelector('.sidebar');
menuBtn.addEventListener('click', () => {
  const open = sidebarEl.classList.toggle('mobile-open');
  menuBtn.classList.toggle('open', open);
});
document.getElementById('map').addEventListener('click', () => {
  if (window.innerWidth <= 700 && sidebarEl.classList.contains('mobile-open')) {
    sidebarEl.classList.remove('mobile-open');
    menuBtn.classList.remove('open');
  }
});

// ═══════════════════════════════════════════════════════════════