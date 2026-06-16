// ════════════════════════════════════════════════════════
// MÓDULO: js/capas-sigpac.js
// CAPAS SIGPAC + CONFIG INICIAL
// ════════════════════════════════════════════════════════
// 2. WMS — RECINTOS (multi-año) + CULTIVO DECLARADO
// ═══════════════════════════════════════════════════════════════
const RECINTOS_WMS = {
  '2026': 'https://geoservicios.castillalamancha.es/arcgis/services/Vector/Recintos_sigpac/MapServer/WMSServer',
  // La Junta de CLM no mantiene un servicio WMS separado por año histórico;
  // el servicio "Recintos_sigpac" se actualiza cada campaña (actualmente 2026).
  // Se apunta al mismo endpoint para que la opción 2025 siga funcional.
  '2025': 'https://geoservicios.castillalamancha.es/arcgis/services/Vector/Recintos_sigpac/MapServer/WMSServer',
};
const CULTIVO_WMS   = 'https://sigpac-hubcloud.es/wms';
const CULTIVO_LAYER = 'cultivo_declarado';

const WMS_YEAR_KEY = 'geomapas_recintos_year';
let activeRecintoYear = '2026';
let WMS_URL        = RECINTOS_WMS[activeRecintoYear];
let ARCGIS_REST_URL = WMS_URL.replace('/WMSServer','/0/query').replace('/services/','/rest/services/');

const recintoLayers = {};
for (const [year, url] of Object.entries(RECINTOS_WMS)) {
  recintoLayers[year] = L.tileLayer.wms(url, {
    layers: '0', format: 'image/png', transparent: true,
    version: '1.1.1', crs: L.CRS.EPSG3857, uppercase: true,
    opacity: 1.0, className: 'wms-magenta-filter',
    maxZoom: 21, maxNativeZoom: 20
  });
}
let wmsRecinto = recintoLayers[activeRecintoYear];
wmsRecinto.addTo(map);

const wmsCultivo = L.tileLayer.wms(CULTIVO_WMS, {
  layers: CULTIVO_LAYER, format: 'image/png', transparent: true,
  version: '1.3.0', uppercase: false,
  opacity: 1.0, className: 'wms-cultivo-filter',
  maxZoom: 21, maxNativeZoom: 20
}).addTo(map);

function setRecintoYear(year) {
  if (!RECINTOS_WMS[year] || year === activeRecintoYear) return;
  const wasVisible = map.hasLayer(wmsRecinto);
  map.removeLayer(wmsRecinto);
  activeRecintoYear = year;
  localStorage.setItem(WMS_YEAR_KEY, year);
  WMS_URL         = RECINTOS_WMS[year];
  ARCGIS_REST_URL = WMS_URL.replace('/WMSServer','/0/query').replace('/services/','/rest/services/');
  wmsRecinto      = recintoLayers[year];
  if (wasVisible) wmsRecinto.addTo(map);
  const sel = document.getElementById('recinto-year-sel');
  if (sel) sel.value = year;
  const lbl = document.getElementById('recinto-year-label');
  if (lbl) lbl.textContent = `Recintos ${year}`;
  if (typeof closeQueryPopup === 'function') closeQueryPopup();
  toast(`Capa de recintos cambiada a ${year}`);
}

document.getElementById('tog-recinto').addEventListener('change', e => {
  e.target.checked ? wmsRecinto.addTo(map) : map.removeLayer(wmsRecinto);
});
document.getElementById('tog-cultivo').addEventListener('change', e => {
  e.target.checked ? wmsCultivo.addTo(map) : map.removeLayer(wmsCultivo);
});

// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN DE CAPAS INICIALES
// ═══════════════════════════════════════════════════════════
(function() {
  const STORAGE_KEY = 'geomapas_initial_layers_visibility';
  const configBtn   = document.getElementById('initial-layers-config-btn');
  const modal       = document.getElementById('initial-layers-modal');
  const closeBtn    = document.getElementById('initial-layers-close');
  const searchInput = document.getElementById('initial-layers-search');
  const ilmList     = document.getElementById('initial-layers-list');
  const ilmRows     = [...ilmList.querySelectorAll('.ilm-row')];

  // Cargar visibilidad guardada (localStorage como caché inmediata)
  function loadVisibility() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      applyAll(saved);
    } catch(_) {}
  }

  function applyAll(state) {
    ilmRows.forEach(row => {
      const key = row.dataset.layerKey;
      const visible = state[key] !== false; // por defecto visible
      row.querySelector('.ilm-toggle').checked = visible;
      applyRowVisibility(key, visible);
    });
  }

  function getCurrentState() {
    const state = {};
    ilmRows.forEach(row => { state[row.dataset.layerKey] = row.querySelector('.ilm-toggle').checked; });
    return state;
  }

  function saveVisibility() {
    const state = getCurrentState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Sincronizar con Firestore si hay sesión activa
    if (typeof isFirebaseActive === 'function' && isFirebaseActive()) {
      const user = auth.currentUser;
      db.doc(`artifacts/${appId}/users/${user.uid}/preferences/initialLayers`)
        .set({ visibility: state, updatedAt: Date.now() }, { merge: true })
        .catch(() => {});
    }
  }

  // Cargar configuración desde Firestore al iniciar sesión (tiene prioridad sobre localStorage)
  document.addEventListener('initial-layers-sync-firestore', async (e) => {
    const uid = e.detail?.uid;
    if (!uid || typeof db === 'undefined') return;
    try {
      const docSnap = await db.doc(`artifacts/${appId}/users/${uid}/preferences/initialLayers`).get();
      if (docSnap.exists) {
        const remote = docSnap.data();
        if (remote?.visibility) {
          applyAll(remote.visibility);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remote.visibility));
        }
      } else {
        // No hay preferencia remota aún: subir la actual (local o por defecto)
        saveVisibility();
      }
    } catch(err) { console.warn('Initial layers sync error:', err); }
  });

  // Mostrar/ocultar la fila correspondiente en el panel "Capas Iniciales"
  function applyRowVisibility(key, visible) {
    const row = document.querySelector(`#initial-layers-card .layer-row[data-layer-key="${key}"]`);
    if (row) row.style.display = visible ? '' : 'none';
  }

  // Toggle individual
  ilmRows.forEach(row => {
    row.querySelector('.ilm-toggle').addEventListener('change', e => {
      applyRowVisibility(row.dataset.layerKey, e.target.checked);
      saveVisibility();
    });
    // El label del toggle no tiene atributo for, así que el toggle nativo
    // no funciona por sí solo: gestionamos el cambio desde el clic en la fila
    row.addEventListener('click', () => {
      const cb = row.querySelector('.ilm-toggle');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });

  // Buscador
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    let anyVisible = false;
    ilmRows.forEach(row => {
      const match = row.dataset.layerName.includes(q);
      row.classList.toggle('ilm-hidden', !match);
      if (match) anyVisible = true;
    });
    let emptyMsg = ilmList.querySelector('.ilm-empty');
    if (!anyVisible) {
      if (!emptyMsg) {
        emptyMsg = document.createElement('div');
        emptyMsg.className = 'ilm-empty';
        emptyMsg.textContent = 'Sin resultados';
        ilmList.appendChild(emptyMsg);
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  });

  // Abrir / cerrar modal
  configBtn.addEventListener('click', () => {
    modal.classList.add('open');
    searchInput.value = '';
    ilmRows.forEach(row => row.classList.remove('ilm-hidden'));
    ilmList.querySelector('.ilm-empty')?.remove();
    setTimeout(() => searchInput.focus(), 80);
  });
  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  loadVisibility();
})();
(function() {
  const sel = document.getElementById('recinto-year-sel');
  if (sel) sel.value = activeRecintoYear;
  const lbl = document.getElementById('recinto-year-label');
  if (lbl) lbl.textContent = `Recintos ${activeRecintoYear}`;
})();

// ── TRIPLE QUERY SWITCHER ──
const QS_KEY = 'geomapas_querymode';
let queryMode = localStorage.getItem(QS_KEY) || 'none';

function applyQueryMode(mode) {
  queryMode = mode;
  localStorage.setItem(QS_KEY, mode);
  document.querySelectorAll('.qs-btn').forEach(b => {
    b.classList.remove('active-none','active-recinto','active-cultivo','active');
  });
  const btn = document.getElementById('qs-' + mode);
  if (btn) btn.classList.add('active-' + mode);
  if (typeof closeQueryPopup === 'function') closeQueryPopup();
  if (typeof clearHighlight  === 'function') clearHighlight();
}
document.querySelectorAll('.qs-btn').forEach(b => {
  b.addEventListener('click', () => applyQueryMode(b.dataset.mode));
});

// ═══════════════════════════════════════════════════════════════