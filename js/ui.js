// ════════════════════════════════════════════════════════
// MÓDULO: js/ui.js
// INIT GLOBAL + DRAW BAR + DRAG&DROP + GANADERÍA + ETIQUETAS + MODAL EDICIÓN
// ════════════════════════════════════════════════════════
// INIT GLOBAL: barra de dibujo unificada + modal eliminar capa
// (Funciona en escritorio y móvil)
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // ── Modal eliminar capa ─────────────────────────────────────
  const delModal   = document.getElementById('mob-delete-confirm');
  const delCancel  = document.getElementById('mob-confirm-cancel');
  const delConfirm = document.getElementById('mob-confirm-delete');
  let _delCb = null;
  if (delModal && delCancel && delConfirm) {
    delCancel.addEventListener('click', () => { delModal.classList.remove('open'); _delCb = null; });
    delConfirm.addEventListener('click', () => { delModal.classList.remove('open'); const cb = _delCb; _delCb = null; if (cb) cb(); });
    delModal.addEventListener('click', e => { if (e.target === delModal) { delModal.classList.remove('open'); _delCb = null; } });
    window.showDeleteConfirm = function(name, cb) {
      const sub = document.getElementById('mob-confirm-sub');
      if (sub) sub.textContent = `¿Eliminar la capa "${name}"? Esta acción no se puede deshacer y la capa también se borrará de la nube si está sincronizada.`;
      _delCb = cb;
      delModal.classList.add('open');
    };
  }

  // ── Barra de dibujo unificada ───────────────────────────────
  const drawBar = document.getElementById('mob-draw-bar');
  const dbArea  = document.getElementById('mob-draw-bar-area');
  const dbLine  = document.getElementById('mob-draw-bar-line');
  const dbBack  = document.getElementById('mob-draw-bar-back');
  const dbClose = document.getElementById('mob-draw-bar-close');
  const dbSave  = document.getElementById('mob-draw-bar-save');
  const dbPoint = document.getElementById('mob-draw-bar-point');
  if (!drawBar || !dbArea || !dbLine || !dbPoint) return;

  function updateBarUI() {
    dbArea.classList.toggle('active', drawMode === 'area');
    dbLine.classList.toggle('active', drawMode === 'line');
    dbPoint.classList.toggle('active', drawMode === 'point');
    const locked = drawActive && drawPoints.length > 0;
    dbArea.disabled = locked;
    dbLine.disabled = locked;
    dbPoint.disabled = locked;
    // El botón de deshacer no aplica en modo punto (se guarda de inmediato)
    dbBack.disabled = drawMode === 'point';
  }

  window.openDrawBar = function() {
    if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
    if (measureMode) stopMeasure();
    if (queryMode !== 'none') applyQueryMode('none');
    // Close GPS bar if open
    const _gpsBar = document.getElementById('desktop-gps-bar');
    const _gpsBtn = document.getElementById('desktop-gps-btn');
    const _mobGps = document.getElementById('mob-gpsmeasure-toggle');
    if (_gpsBar && _gpsBar.classList.contains('open')) {
      _gpsBar.classList.remove('open');
      if (_gpsBtn) _gpsBtn.classList.remove('active');
      if (_mobGps) _mobGps.classList.remove('active');
    }
    drawBar.classList.add('open');
    if (!drawActive) startDraw();
    updateBarUI();
    // Sync mobile draw button
    const mdd = document.getElementById('mob-draw-direct-btn');
    if (mdd) mdd.classList.add('active');
  };
  window.closeDrawBar = function() {
    drawBar.classList.remove('open');
    if (drawActive) stopDraw(false);
    // Sync mobile draw button
    const mdd = document.getElementById('mob-draw-direct-btn');
    if (mdd) mdd.classList.remove('active');
  };

  dbArea.addEventListener('click', e => {
    e.stopPropagation();
    if (drawActive && drawPoints.length > 0) return;
    drawMode = 'area';
    if (!drawActive) startDraw();
    updateBarUI();
  });
  dbLine.addEventListener('click', e => {
    e.stopPropagation();
    if (drawActive && drawPoints.length > 0) return;
    drawMode = 'line';
    if (!drawActive) startDraw();
    updateBarUI();
  });
  dbPoint.addEventListener('click', e => {
    e.stopPropagation();
    if (drawActive && drawPoints.length > 0) return;
    drawMode = 'point';
    if (!drawActive) startDraw();
    updateBarUI();
  });
  dbBack.addEventListener('click', e => {
    e.stopPropagation();
    drawUndoLastPoint();
    updateBarUI();
  });
  dbClose.addEventListener('click', e => {
    e.stopPropagation();
    // Reset measurement but keep bar open
    if (drawActive) {
      // Remove all points and markers
      drawMarkers.forEach(m => map.removeLayer(m));
      drawMarkers = [];
      drawPoints = [];
      if (drawPoly) { map.removeLayer(drawPoly); drawPoly = null; }
      if (drawPreview) { map.removeLayer(drawPreview); drawPreview = null; }
      hideMeasurePopup();
      const mobMeasure = document.getElementById('mob-draw-measure');
      if (mobMeasure) mobMeasure.textContent = '';
      updateBarUI();
    }
  });
  dbSave.addEventListener('click', e => {
    e.stopPropagation();
    drawBar.classList.remove('open');
    stopDraw(true);
    if (typeof syncMobProjectLayers === 'function') syncMobProjectLayers();
  });

  // Tras refrescar la barra cada vez que cambia el dibujo
  const _origRefresh = window.refreshDrawMeasure;
  if (typeof _origRefresh === 'function') {
    window.refreshDrawMeasure = function() { _origRefresh(); updateBarUI(); };
  }
});

function mobSetRecintoYear(year) {
  setRecintoYear(year);
  document.querySelectorAll('#mob-recinto-year-pills .mob-year-pill').forEach(function(b) {
    b.classList.toggle('active', b.dataset.year === year);
  });
  var label = document.getElementById('mob-recinto-year-label');
  if (label) label.textContent = 'Recintos ' + year;
}
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('#mob-recinto-year-pills .mob-year-pill').forEach(function(b) {
    b.addEventListener('click', function() { mobSetRecintoYear(b.dataset.year); });
  });
});


// ═══════════════════════════════════════════════════════════════
// DRAG & DROP UNIVERSAL EN EL PANEL DE CAPAS
// ═══════════════════════════════════════════════════════════════
(function () {
  const card    = document.getElementById('layers-card-drop');
  const overlay = document.getElementById('layers-drop-overlay');
  const label   = document.getElementById('layers-drop-label');
  const hint    = document.getElementById('layers-drop-hint');
  if (!card || !overlay) return;

  // Clasificar archivos soltados para dar feedback antes de procesar
  function classifyFiles(files) {
    const isPhoto = f => /\.(jpe?g|tiff?)$/i.test(f.name);
    const isVec   = f => /\.(shp|dbf|shx|prj|zip|kml|kmz|xml)$/i.test(f.name);
    const isTxt   = f => /\.(txt|csv)$/i.test(f.name);
    const photos = files.filter(isPhoto);
    const vecs   = files.filter(isVec);
    const txts   = files.filter(isTxt);
    return { photos, vecs, txts };
  }

  function describeFiles(files) {
    const { photos, vecs, txts } = classifyFiles(files);
    const parts = [];
    if (photos.length) parts.push(`${photos.length} foto${photos.length > 1 ? 's' : ''}`);
    if (vecs.length)   parts.push(`${vecs.length} capa${vecs.length > 1 ? 's' : ''} vectorial${vecs.length > 1 ? 'es' : ''}`);
    if (txts.length)   parts.push(`${txts.length} archivo${txts.length > 1 ? 's' : ''} de recintos`);
    return parts.length ? parts.join(' · ') : 'Suelta aquí para cargar';
  }

  let _dragCounter = 0; // counter para ignorar drag enter/leave de hijos

  card.addEventListener('dragenter', e => {
    e.preventDefault();
    _dragCounter++;
    if (_dragCounter === 1) {
      const files = [...(e.dataTransfer?.items || [])].map(i => ({ name: i.getAsFile()?.name || '' }));
      label.textContent = describeFiles(files) || 'Suelta aquí para cargar';
      overlay.classList.add('active');
    }
  });

  card.addEventListener('dragleave', e => {
    _dragCounter--;
    if (_dragCounter === 0) overlay.classList.remove('active');
  });

  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  card.addEventListener('drop', async e => {
    e.preventDefault();
    _dragCounter = 0;
    overlay.classList.remove('active');

    const files = [...e.dataTransfer.files];
    if (!files.length) return;

    const { photos, vecs, txts } = classifyFiles(files);
    const unknown = files.filter(f => !photos.includes(f) && !vecs.includes(f) && !txts.includes(f));

    if (unknown.length) {
      const names = unknown.map(f => f.name).join(', ');
      toast(`Tipo no soportado: ${names}`, 'err');
    }

    // Procesar cada grupo con su handler existente
    if (photos.length) {
      await processFiles(photos);
    }
    if (vecs.length) {
      await handleShpFiles(vecs);
    }
    for (const f of txts) {
      await handleTxtFile(f);
    }
  });
})();

// ═══════════════════════════════════════════════════════════════
// SISTEMA GANADERÍA
// ═══════════════════════════════════════════════════════════════
(function () {
  const GAN_COLLECTION = `artifacts/${appId}/ganaderia`;

  // Estado compartido de resultados (desktop + móvil)
  let _ganCurrentItems = [];
  function setGanResults(items) {
    _ganCurrentItems = items;
    const hasItems = items.length > 0;
    const desktopBtn = document.getElementById('gan-load-map-btn');
    const mobBtn     = document.getElementById('mob-gan-load-btn');
    if (desktopBtn) { desktopBtn.disabled = !hasItems; desktopBtn.style.opacity = hasItems ? '1' : '.4'; }
    if (mobBtn)     { mobBtn.disabled = !hasItems;     mobBtn.style.opacity     = hasItems ? '1' : '.4'; }
  }

  const ganPanel     = document.getElementById('gan-search-panel');
  const ganPanelBtn  = document.getElementById('search-ganaderia-btn');
  const ganPanelClose= document.getElementById('gan-panel-close');
  const ganProv      = document.getElementById('gan-prov');
  const ganMun       = document.getElementById('gan-mun');
  const ganExp       = document.getElementById('gan-exp');
  const ganPreview   = document.getElementById('gan-cod-preview');
  const ganSearchBtn = document.getElementById('gan-search-btn');
  const ganResults   = document.getElementById('gan-results');

  // ── Abrir / cerrar panel ────────────────────────────────────
  function openGanPanel() {
    // Cerrar otros paneles si están abiertos
    document.getElementById('search-panel')?.classList.remove('open');
    document.getElementById('search-recinto-btn')?.classList.remove('active-search');
    ganPanel.classList.add('open');
    ganPanelBtn.classList.add('active-search');
    ganProv.focus();
  }
  function closeGanPanel() {
    ganPanel.classList.remove('open');
    ganPanelBtn.classList.remove('active-search');
    setGanResults([]);
    ganResults.innerHTML = '';
    ganProv.value = '';
    ganMun.value = '';
    ganExp.value = '';
    ganPreview.classList.remove('visible');
    // Limpiar tab por lote
    const batchInput = document.getElementById('gan-batch-input');
    const batchResults = document.getElementById('gan-batch-results');
    if (batchInput)   batchInput.value   = '';
    if (batchResults) batchResults.innerHTML = '';
    // Resetear tab activa a individual
    switchGanTab('single', false);
  }
  ganPanelBtn.addEventListener('click', () => {
    ganPanel.classList.contains('open') ? closeGanPanel() : openGanPanel();
  });
  ganPanelClose.addEventListener('click', closeGanPanel);

  // ── Preview del COD_REGA en tiempo real ─────────────────────
  function buildCodRega(prov, mun, exp) {
    if (!prov || !mun || !exp) return null;
    return 'ES'
      + String(prov).padStart(2, '0')
      + String(mun).padStart(3, '0')
      + String(exp).padStart(7, '0');
  }
  function updatePreview() {
    const cod = buildCodRega(ganProv.value, ganMun.value, ganExp.value);
    if (cod) { ganPreview.textContent = cod; ganPreview.classList.add('visible'); }
    else      { ganPreview.classList.remove('visible'); }
  }
  ganProv.addEventListener('change', updatePreview);
  ganMun.addEventListener('input', updatePreview);
  ganExp.addEventListener('input', updatePreview);

  // ── Búsqueda ────────────────────────────────────────────────
  async function doSearch() {
    const cod = buildCodRega(ganProv.value, ganMun.value, ganExp.value);
    if (!cod) { toast('Rellena provincia, municipio y explotación', 'err'); return; }
    if (!isFirebaseActive()) { toast('Se requiere conexión a Firebase', 'err'); return; }

    ganResults.innerHTML = `<div class="gan-progress"><div class="shp-spin"></div>Buscando ${cod}…</div>`;
    setGanResults([]);

    try {
      // Query por campo cod_rega (devuelve todos los docs de ese código,
      // sean de una o varias ubicaciones)
      const snap = await db.collection(GAN_COLLECTION)
        .where('cod_rega', '==', cod)
        .get();

      if (snap.empty) {
        ganResults.innerHTML = `<div class="gan-msg">No se encontró <b>${cod}</b></div>`;
        return;
      }

      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderResults(items);
    } catch(err) {
      ganResults.innerHTML = `<div class="gan-msg">Error: ${err.message}</div>`;
      console.error('GAN SEARCH ERROR:', err);
    }
  }

  // El botón de búsqueda actúa según el modo activo
  ganSearchBtn.addEventListener('click', () => {
    if (_ganMode === 'batch') doSearchBatch('gan-batch-input', 'gan-batch-results');
    else doSearch();
  });
  [ganMun, ganExp].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && _ganMode === 'single') doSearch(); }));
  let _ganMode = 'single'; // 'single' | 'batch'

  function switchGanTab(mode, isMob) {
    _ganMode = mode;
    const prefix = isMob ? 'mob-' : '';
    document.querySelectorAll(`#${prefix}gan-tab-single, #${prefix}gan-tab-batch`).forEach(t => {
      t.classList.toggle('active', t.dataset.tab === mode);
    });
    const singlePanel = document.getElementById(`${prefix}gan-panel-single`);
    const batchPanel  = document.getElementById(`${prefix}gan-panel-batch`);
    if (singlePanel) singlePanel.style.display = mode === 'single' ? '' : 'none';
    if (batchPanel)  batchPanel.style.display  = mode === 'batch'  ? '' : 'none';
    // Cambiar texto del botón de búsqueda
    const btn = document.getElementById(`${prefix}gan-search-btn`);
    if (btn) btn.textContent = mode === 'batch' ? 'Buscar todas' : 'Buscar explotación';
    setGanResults([]);
    if (document.getElementById(`${prefix}gan-results`)) document.getElementById(`${prefix}gan-results`).innerHTML = '';
    if (document.getElementById(`${prefix}gan-batch-results`)) document.getElementById(`${prefix}gan-batch-results`).innerHTML = '';
  }

  document.getElementById('gan-tab-single')?.addEventListener('click', () => switchGanTab('single', false));
  document.getElementById('gan-tab-batch')?.addEventListener('click',  () => switchGanTab('batch',  false));
  document.getElementById('mob-gan-tab-single')?.addEventListener('click', () => switchGanTab('single', true));
  document.getElementById('mob-gan-tab-batch')?.addEventListener('click',  () => switchGanTab('batch',  true));

  // ── Parseo de códigos en lote ─────────────────────────────────
  // Formatos aceptados:
  //   ES020030000030  (formato REGA completo)
  //   2-3-30 / 2/3/30 / 02.003.30 / 02 003 30  (prov-mun-exp con separador)
  function parseCodRega(raw) {
    raw = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!raw) return null;
    // Formato completo REGA: ES + 2 + 3 + 7 = 14 chars
    const fullMatch = raw.match(/^ES(\d{2})(\d{3})(\d{7})$/);
    if (fullMatch) return 'ES' + fullMatch[1] + fullMatch[2] + fullMatch[3];
    // Formato con separador: prov SEP mun SEP exp
    const sepMatch = raw.replace(/^ES/i,'').match(/^(\d{1,2})[\-\/\.\s](\d{1,3})[\-\/\.\s](\d{1,7})$/);
    if (sepMatch) {
      return 'ES'
        + String(sepMatch[1]).padStart(2,'0')
        + String(sepMatch[2]).padStart(3,'0')
        + String(sepMatch[3]).padStart(7,'0');
    }
    return null;
  }

  function parseBatchInput(text) {
    // Dividir por saltos de línea, comas y punto y coma
    return text.split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => ({ raw: s, cod: parseCodRega(s) }));
  }

  // ── Búsqueda por lote ─────────────────────────────────────────
  async function doSearchBatch(inputId, resultsId) {
    const textarea = document.getElementById(inputId);
    const resultsEl = document.getElementById(resultsId);
    if (!textarea || !resultsEl) return;

    const entries = parseBatchInput(textarea.value);
    if (!entries.length) { toast('Introduce al menos un código', 'err'); return; }

    const invalid = entries.filter(e => !e.cod);
    if (invalid.length) {
      toast(`No se pudo parsear: ${invalid.map(e => e.raw).join(', ')}`, 'err');
      return;
    }
    if (!isFirebaseActive()) { toast('Se requiere conexión a Firebase', 'err'); return; }

    const uniqueCodes = [...new Set(entries.map(e => e.cod))];
    resultsEl.innerHTML = `<div class="gan-progress"><div class="shp-spin"></div>Buscando ${uniqueCodes.length} código${uniqueCodes.length > 1 ? 's' : ''}…</div>`;
    setGanResults([]);

    try {
      // Firestore permite "in" con hasta 30 valores; si hay más, lo trocemos
      const CHUNK = 30;
      let allItems = [];
      for (let i = 0; i < uniqueCodes.length; i += CHUNK) {
        const chunk = uniqueCodes.slice(i, i + CHUNK);
        const snap = await db.collection(GAN_COLLECTION).where('cod_rega', 'in', chunk).get();
        snap.docs.forEach(d => allItems.push({ id: d.id, ...d.data() }));
      }

      const found = new Set(allItems.map(it => it.cod_rega));
      const notFound = uniqueCodes.filter(c => !found.has(c));

      resultsEl.innerHTML = '';

      if (!allItems.length) {
        resultsEl.innerHTML = `<div class="gan-msg">No se encontró ningún código</div>`;
        return;
      }

      // Resumen
      const summary = document.createElement('div');
      summary.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:10px;color:var(--muted);margin-bottom:4px;';
      summary.innerHTML = `<b style="color:var(--text)">${allItems.length}</b> ubicacion${allItems.length !== 1 ? 'es' : ''} encontrada${allItems.length !== 1 ? 's' : ''}` +
        (notFound.length ? ` · <span style="color:var(--danger)">${notFound.length} no encontrado${notFound.length !== 1 ? 's' : ''}: ${notFound.join(', ')}</span>` : '');
      resultsEl.appendChild(summary);

      // Agrupar por cod_rega para mostrar
      const grouped = {};
      allItems.forEach(it => { (grouped[it.cod_rega] = grouped[it.cod_rega] || []).push(it); });
      Object.entries(grouped).forEach(([cod, items]) => {
        const div = document.createElement('div');
        div.className = 'gan-result-item';
        div.innerHTML = `
          <div class="gan-result-cod">${cod} <span style="color:var(--muted);font-weight:400;">(${items.length} ubic.)</span></div>
          <div class="gan-result-especie">${[...new Set(items.map(i => i.especie).filter(Boolean))].join(', ') || '—'}</div>
          <div class="gan-result-coords">📍 ${items.map(i => `${Number(i.lat).toFixed(5)}, ${Number(i.lng).toFixed(5)}`).join(' / ')}</div>
        `;
        resultsEl.appendChild(div);
      });

      setGanResults(allItems);
    } catch(err) {
      resultsEl.innerHTML = `<div class="gan-msg">Error: ${err.message}</div>`;
      console.error('GAN BATCH ERROR:', err);
    }
  }

  // ── Botón "Añadir al mapa" fijo en footer — se activa al tener resultados ──
  const ganLoadMapBtn = document.getElementById('gan-load-map-btn');
  if (ganLoadMapBtn) {
    ganLoadMapBtn.addEventListener('click', () => {
      if (!_ganCurrentItems.length) return;
      loadGanToMap(_ganCurrentItems);
      closeGanPanel();
    });
  }

  // ── Bottom sheets móviles ────────────────────────────────────
  const mobSearchRecintoBtn   = document.getElementById('mob-search-recinto-btn');
  const mobSearchGanBtn       = document.getElementById('mob-search-gan-btn');
  const mobRecintoPanel       = document.getElementById('mob-search-recinto-panel');
  const mobGanPanel           = document.getElementById('mob-gan-panel');
  const mobRecintoClose       = document.getElementById('mob-search-recinto-close');
  const mobGanClose           = document.getElementById('mob-gan-close');

  function openMobSheet(panel) {
    // Cerrar otros bottom sheets y el panel de capas
    [mobRecintoPanel, mobGanPanel].forEach(p => {
      if (p && p !== panel && p.classList.contains('open')) closeMobSheet(p);
    });
    document.getElementById('mob-layers-panel')?.classList.remove('open');
    panel?.classList.add('open');
  }
  function closeMobSheet(panel) {
    panel?.classList.remove('open');
    if (panel === mobGanPanel) {
      setGanResults([]);
      const mobGanResultsEl = document.getElementById('mob-gan-results');
      if (mobGanResultsEl) mobGanResultsEl.innerHTML = '';
      if (mobGanProv) mobGanProv.value = '';
      if (mobGanMun)  mobGanMun.value = '';
      if (mobGanExp)  mobGanExp.value = '';
      if (mobGanPreview) mobGanPreview.classList.remove('visible');
      // Limpiar tab por lote
      const mobBatchInput   = document.getElementById('mob-gan-batch-input');
      const mobBatchResults = document.getElementById('mob-gan-batch-results');
      if (mobBatchInput)   mobBatchInput.value   = '';
      if (mobBatchResults) mobBatchResults.innerHTML = '';
      // Resetear tab activa a individual
      switchGanTab('single', true);
    }
  }

  mobSearchRecintoBtn?.addEventListener('click', () => {
    openMobSheet(mobRecintoPanel);
    // Generar campos si aún no están
    const mobFields = document.getElementById('mob-recinto-fields');
    if (mobFields && !mobFields.querySelector('.sf-input')) {
      mobFields.innerHTML = RECINTO_FIELDS.map(f => `
        <div class="sf-row">
          <div class="sf-label">${f.label}${f.required ? ' *' : ''}</div>
          <input class="sf-input" id="mob_${f.id}" type="text" placeholder="${f.required ? 'Obligatorio' : 'Opcional'}">
        </div>`).join('');
    }
  });
  mobSearchGanBtn?.addEventListener('click', () => openMobSheet(mobGanPanel));
  mobRecintoClose?.addEventListener('click', () => closeMobSheet(mobRecintoPanel));
  mobGanClose?.addEventListener('click', () => closeMobSheet(mobGanPanel));

  // ── Ganadería móvil — preview y búsqueda ─────────────────────
  const mobGanProv    = document.getElementById('mob-gan-prov');
  const mobGanMun     = document.getElementById('mob-gan-mun');
  const mobGanExp     = document.getElementById('mob-gan-exp');
  const mobGanPreview = document.getElementById('mob-gan-preview');
  const mobGanResults = document.getElementById('mob-gan-results');
  const mobGanSearch  = document.getElementById('mob-gan-search-btn');
  const mobGanLoad    = document.getElementById('mob-gan-load-btn');

  function updateMobGanPreview() {
    const cod = buildCodRega(mobGanProv?.value, mobGanMun?.value, mobGanExp?.value);
    if (mobGanPreview) {
      if (cod) { mobGanPreview.textContent = cod; mobGanPreview.classList.add('visible'); }
      else      { mobGanPreview.classList.remove('visible'); }
    }
  }
  mobGanProv?.addEventListener('change', updateMobGanPreview);
  mobGanMun?.addEventListener('input', updateMobGanPreview);
  mobGanExp?.addEventListener('input', updateMobGanPreview);

  async function doMobGanSearch() {
    const cod = buildCodRega(mobGanProv?.value, mobGanMun?.value, mobGanExp?.value);
    if (!cod) { toast('Rellena provincia, municipio y explotación', 'err'); return; }
    if (!isFirebaseActive()) { toast('Se requiere conexión a Firebase', 'err'); return; }
    if (mobGanResults) mobGanResults.innerHTML = `<div class="gan-progress"><div class="shp-spin"></div>Buscando ${cod}…</div>`;
    setGanResults([]);
    try {
      const snap = await db.collection(GAN_COLLECTION).where('cod_rega', '==', cod).get();
      if (snap.empty) {
        if (mobGanResults) mobGanResults.innerHTML = `<div class="gan-msg">No se encontró <b>${cod}</b></div>`;
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (mobGanResults) {
        mobGanResults.innerHTML = '';
        items.forEach((item, i) => {
          const div = document.createElement('div');
          div.className = 'gan-result-item';
          div.innerHTML = `
            <div class="gan-result-cod">${item.cod_rega}${items.length > 1 ? ` <span style="color:var(--muted);font-weight:400;">(${i+1}/${items.length})</span>` : ''}</div>
            <div class="gan-result-especie">${item.especie || '—'}</div>
            <div class="gan-result-coords">📍 ${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}</div>
          `;
          mobGanResults.appendChild(div);
        });
      }
      setGanResults(items);
    } catch(err) {
      if (mobGanResults) mobGanResults.innerHTML = `<div class="gan-msg">Error en la búsqueda</div>`;
    }
  }

  mobGanSearch?.addEventListener('click', () => {
    if (_ganMode === 'batch') doSearchBatch('mob-gan-batch-input', 'mob-gan-batch-results');
    else doMobGanSearch();
  });
  mobGanLoad?.addEventListener('click', () => {
    if (!_ganCurrentItems.length) return;
    loadGanToMap(_ganCurrentItems);
    closeMobSheet(mobGanPanel);
  });
  [mobGanMun, mobGanExp].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') doMobGanSearch(); }));

  // ── Botón búsqueda recintos móvil ──────────────────────────
  document.getElementById('mob-recinto-search-exec')?.addEventListener('click', async () => {
    // Copiar valores de los campos móviles a los campos desktop antes de ejecutar
    RECINTO_FIELDS.forEach(f => {
      const mobVal = document.getElementById('mob_' + f.id)?.value.trim();
      let desktopField = document.getElementById(f.id);
      // Si el panel desktop no tiene los campos aún, inicializarlos
      if (!desktopField) {
        openSearchPanel('recinto');
        desktopField = document.getElementById(f.id);
      }
      if (desktopField && mobVal) desktopField.value = mobVal;
    });
    // Sincronizar toggle
    const desktop = document.getElementById('search-add-toggle');
    const mob = document.getElementById('mob-search-add-toggle');
    if (desktop && mob) desktop.checked = mob.checked;
    // Ejecutar búsqueda
    await execSearchRecinto();
    closeMobSheet(mobRecintoPanel);
  });
  document.getElementById('mob-search-add-toggle')?.addEventListener('change', e => {
    const desktop = document.getElementById('search-add-toggle');
    if (desktop) desktop.checked = e.target.checked;
  });

  // ── Renderizar resultados ────────────────────────────────────
  function renderResults(items) {
    ganResults.innerHTML = '';
    setGanResults(items);

    const header = document.createElement('div');
    header.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:10px;color:var(--muted);margin-bottom:2px;';
    header.textContent = items.length === 1 ? '1 ubicación encontrada' : `${items.length} ubicaciones encontradas`;
    ganResults.appendChild(header);

    items.forEach((item, i) => {
      const extra = Object.entries(item.extra || {})
        .filter(([,v]) => v && v !== 'undefined' && v !== '')
        .map(([k,v]) => `${k.replace(/_/g,' ')}: <b>${v}</b>`)
        .join(' · ');

      const div = document.createElement('div');
      div.className = 'gan-result-item';
      div.innerHTML = `
        <div class="gan-result-cod">${item.cod_rega}${items.length > 1 ? ` <span style="color:var(--muted);font-weight:400;">(ubicación ${i+1}/${items.length})</span>` : ''}</div>
        <div class="gan-result-especie">${item.especie || '—'}</div>
        <div class="gan-result-coords">📍 ${Number(item.lat).toFixed(6)}, ${Number(item.lng).toFixed(6)}</div>
        ${extra ? `<div class="gan-result-coords" style="margin-top:2px;font-size:9px;">${extra}</div>` : ''}
      `;
      ganResults.appendChild(div);
    });
  }

  // ── Cargar explotaciones como capa de puntos ─────────────────
  function loadGanToMap(items) {
    const features = items.map(item => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(item.lng), Number(item.lat)] },
      properties: {
        COD_REGA: item.cod_rega,
        ESPECIE:  item.especie,
        LAT:      item.lat,
        LNG:      item.lng,
        ...item.extra
      }
    }));

    const geojson = { type: 'FeatureCollection', features };
    const uniqueCods = [...new Set(items.map(i => i.cod_rega))];
    const label = uniqueCods.length === 1
      ? `Ganadería ${uniqueCods[0]}`
      : `Ganadería (${uniqueCods.length} explotaciones)`;

    addShpLayer(geojson, label, null, true, true);

    // Centrar mapa en el centroide del conjunto de puntos
    const lats = items.map(i => Number(i.lat));
    const lngs = items.map(i => Number(i.lng));
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    map.setView([centerLat, centerLng], Math.max(map.getZoom(), 15));
    toast(`${features.length} punto${features.length > 1 ? 's' : ''} de explotación añadido${features.length > 1 ? 's' : ''} al mapa`, 'ok');
  }

})();

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE ETIQUETAS DE CAPA
// ═══════════════════════════════════════════════════════════════
const layerLabels = {}; // { [layerId]: { fields: [], visible: bool } }

const LABEL_ZOOM_THRESHOLD = 17; // zoom mínimo para mostrar etiquetas (línea editable)

function buildLabelHtml(properties, fields, color, size) {
  const style = `color:${color||'#fff'};font-size:${size||14}px;`;
  const lines = fields
    .filter(f => f && properties && properties[f] !== undefined && properties[f] !== null && String(properties[f]).trim() !== '')
    .map(f => `<div class="layer-label-line" style="${style}">${esc(String(properties[f]))}</div>`);
  if (!lines.length) return null;
  return lines.join('');
}

// Elimina todos los tooltips de etiqueta de la polyLayer de una capa
function _clearLabelTooltips(layerId) {
  const shpLayer = shpLayers.find(l => l.id === layerId);
  if (!shpLayer) return;
  shpLayer.polyLayer.eachLayer(sub => {
    if (sub.getTooltip && sub.getTooltip()) sub.unbindTooltip();
  });
}

// Reconstruye tooltips en la polyLayer según los campos elegidos
function rebuildLabelGroup(layer) {
  _clearLabelTooltips(layer.id);
  const cfg = layerLabels[layer.id];
  if (!cfg) return;
  const activeFields = cfg.fields.filter(Boolean);
  if (!activeFields.length) return;

  // Iterar sobre los sub-layers de polyLayer (uno por feature)
  let idx = 0;
  layer.polyLayer.eachLayer(sub => {
    const feature = sub.feature;
    if (!feature) { idx++; return; }
    const html = buildLabelHtml(feature.properties, cfg.fields, cfg.color, cfg.size);
    if (!html) { idx++; return; }
    sub.bindTooltip(html, {
      permanent: true,
      direction: 'center',
      className: 'layer-label-tooltip',
      opacity: 1
    });
    idx++;
  });

  // Aplicar visibilidad inicial
  syncLabelGroupVisibility(layer.id);
}

// Muestra u oculta los tooltips según zoom y toggle
function syncLabelGroupVisibility(layerId) {
  const cfg = layerLabels[layerId];
  const shpLayer = shpLayers.find(l => l.id === layerId);
  if (!shpLayer) return;

  const layerVisible = shpLayer.visible !== false;
  const shouldShow = cfg && cfg.visible && layerVisible && map.getZoom() >= LABEL_ZOOM_THRESHOLD;

  shpLayer.polyLayer.eachLayer(sub => {
    if (!sub.getTooltip || !sub.getTooltip()) return;
    if (shouldShow) {
      if (!sub.isTooltipOpen()) sub.openTooltip();
    } else {
      if (sub.isTooltipOpen()) sub.closeTooltip();
    }
  });
}

map.on('zoomend', () => {
  Object.keys(layerLabels).forEach(id => syncLabelGroupVisibility(id));
});

function removeLayerLabels(layerId) {
  _clearLabelTooltips(layerId);
  delete layerLabels[layerId];
}

// Guardar configuración de etiquetas en cloud (patch de updateShpColorInCloud)
async function updateShpLabelsInCloud(layerId, labels) {
  if (!isFirebaseActive()) return;
  const user = auth.currentUser;
  if (!user) return;
  const docRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layerId}`);
  try { await docRef.update({ labels: JSON.stringify(labels) }); }
  catch (err) { console.warn('No se pudo sincronizar etiquetas en la nube:', err); }
}

// Guardar configuración de campos personalizados en cloud
async function updateShpCustomFieldsInCloud(layerId, customFields) {
  if (!isFirebaseActive()) { console.log('[CF] updateShpCustomFieldsInCloud: firebase no activo'); return; }
  const user = auth.currentUser;
  if (!user) { console.log('[CF] updateShpCustomFieldsInCloud: sin usuario'); return; }
  const docRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layerId}`);
  try {
    await docRef.update({ customFields: JSON.stringify(customFields) });
    console.log('[CF] update OK en Firestore', layerId, customFields);
  }
  catch (err) {
    console.warn('No se pudo sincronizar campos personalizados en la nube (update), reintentando con set:', err);
    // Fallback: algunas reglas de seguridad sólo permiten "set" del documento completo.
    try {
      await docRef.set({ customFields: JSON.stringify(customFields) }, { merge: true });
      console.log('[CF] set merge OK en Firestore', layerId, customFields);
    } catch (err2) {
      console.error('No se pudo sincronizar campos personalizados en la nube:', err2);
    }
  }
}

// Restaurar etiquetas al cargar una capa (llamar desde addShpLayer o sync)
function restoreLayerLabels(layer, labelsData) {
  if (!labelsData) return;
  try {
    const cfg = typeof labelsData === 'string' ? JSON.parse(labelsData) : labelsData;
    layerLabels[layer.id] = { fields: cfg.fields || ['','',''], visible: !!cfg.visible, color: cfg.color || '#ffffff', size: cfg.size || '14' };
    rebuildLabelGroup(layer);
  } catch(_) {}
}

// ═══════════════════════════════════════════════════════════════
// MODAL EDICIÓN DE CAPA (nombre + color)
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  const modal       = document.getElementById('layer-edit-modal');
  const nameInput   = document.getElementById('layer-edit-name');
  const colorPreview= document.getElementById('layer-edit-color-preview');
  const colorInput  = document.getElementById('layer-edit-color-input');
  const cancelBtn   = document.getElementById('layer-edit-cancel');
  const saveBtn     = document.getElementById('layer-edit-save');

  let _editLayer = null;

  // ─── Popover paleta de colores ───────────────────────────────
  const colorPop      = document.getElementById('layer-edit-color-pop');
  const swatchesEl    = document.getElementById('lec-swatches');
  const hexInputEl    = document.getElementById('lec-hex');
  const moreBtn       = document.getElementById('lec-more');
  const okColorBtn    = document.getElementById('lec-ok');
  const PRESET_COLORS = [
    '#2f6fde','#1e8a4c','#d93025','#ff8c00','#ffcc00','#9b27c8',
    '#ff00ff','#00bcd4','#795548','#607d8b','#000000','#ffffff'
  ];
  function renderSwatches(active) {
    swatchesEl.innerHTML = '';
    PRESET_COLORS.forEach(c => {
      const sw = document.createElement('div');
      sw.className = 'lec-swatch' + (c.toLowerCase() === (active||'').toLowerCase() ? ' selected' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        hexInputEl.value = c.toUpperCase();
        colorPreview.style.background = c;
        colorInput.value = c;
        renderSwatches(c);
      });
      swatchesEl.appendChild(sw);
    });
  }
  function openColorPop() {
    hexInputEl.value = (colorInput.value || '#000000').toUpperCase();
    renderSwatches(colorInput.value);
    colorPop.classList.add('open');
  }
  function closeColorPop() { colorPop.classList.remove('open'); }
  colorPreview.addEventListener('click', e => { e.stopPropagation(); openColorPop(); });
  hexInputEl.addEventListener('input', () => {
    const v = hexInputEl.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      colorInput.value = v;
      colorPreview.style.background = v;
      renderSwatches(v);
    }
  });
  moreBtn.addEventListener('click', e => { e.stopPropagation(); colorInput.click(); });
  colorInput.addEventListener('input', () => {
    colorPreview.style.background = colorInput.value;
    hexInputEl.value = colorInput.value.toUpperCase();
    renderSwatches(colorInput.value);
  });
  okColorBtn.addEventListener('click', e => { e.stopPropagation(); closeColorPop(); });
  document.addEventListener('click', e => {
    if (!colorPop.classList.contains('open')) return;
    if (colorPop.contains(e.target) || colorPreview.contains(e.target)) return;
    closeColorPop();
  });


  // ─── Popover color de etiquetas ──────────────────────────────
  const lblColorPop     = document.getElementById('lbl-color-pop');
  const lblColorPreview = document.getElementById('lbl-color-preview');
  const lblColorInput   = document.getElementById('lbl-color-input');
  const lblSwatchesEl   = document.getElementById('lbl-swatches');
  const lblMoreBtn      = document.getElementById('lbl-more');
  const lblOkBtn        = document.getElementById('lbl-ok');
  const LBL_PRESET_COLORS = [
    '#ffffff','#000000','#ffcc00','#ff8c00','#d93025','#2f6fde',
    '#1e8a4c','#9b27c8','#00bcd4','#795548','#607d8b','#ff00ff'
  ];
  function renderLblSwatches(active) {
    lblSwatchesEl.innerHTML = '';
    LBL_PRESET_COLORS.forEach(c => {
      const sw = document.createElement('div');
      sw.className = 'lec-swatch' + (c.toLowerCase() === (active||'').toLowerCase() ? ' selected' : '');
      sw.style.background = c;
      if (c === '#ffffff') sw.style.border = '1.5px solid #ccc';
      sw.addEventListener('click', () => {
        lblColorPreview.style.background = c;
        lblColorInput.value = c;
        renderLblSwatches(c);
      });
      lblSwatchesEl.appendChild(sw);
    });
  }
  function openLblColorPop() {
    renderLblSwatches(lblColorInput.value);
    lblColorPop.classList.add('open');
  }
  function closeLblColorPop() { lblColorPop.classList.remove('open'); }
  lblColorPreview.addEventListener('click', e => { e.stopPropagation(); openLblColorPop(); });
  lblMoreBtn.addEventListener('click', e => { e.stopPropagation(); lblColorInput.click(); });
  lblColorInput.addEventListener('input', () => {
    lblColorPreview.style.background = lblColorInput.value;
    renderLblSwatches(lblColorInput.value);
  });
  lblOkBtn.addEventListener('click', e => { e.stopPropagation(); closeLblColorPop(); });
  document.addEventListener('click', e => {
    if (!lblColorPop.classList.contains('open')) return;
    if (lblColorPop.contains(e.target) || lblColorPreview.contains(e.target)) return;
    closeLblColorPop();
  });


  modal.addEventListener('click', e => { if (e.target === modal) { closeColorPop(); closeLblColorPop(); modal.classList.remove('open'); _editLayer = null; } });
  cancelBtn.addEventListener('click', () => { closeColorPop(); closeLblColorPop(); modal.classList.remove('open'); _editLayer = null; });

  saveBtn.addEventListener('click', () => {
    if (!_editLayer) return;
    const newName  = nameInput.value.trim() || _editLayer.name;
    const newColor = colorInput.value;

    if (newName !== _editLayer.name) {
      _editLayer.name = newName;
      const dskName = document.querySelector(`.list-item[data-id="${_editLayer.id}"] .item-name`);
      if (dskName) { dskName.textContent = newName; dskName.title = newName; }
      const mobName = document.querySelector(`.mob-layer-item[data-id="${_editLayer.id}"] .mob-layer-item-name`);
      if (mobName) { mobName.textContent = newName; mobName.title = newName; }
    }

    if (newColor !== _editLayer.color) {
      _editLayer.color = newColor;
      _editLayer.leafletLayer.setStyle({ color: newColor, fillColor: newColor });
      const dskDot = document.querySelector(`.list-item[data-id="${_editLayer.id}"] .shp-color-dot`);
      if (dskDot) dskDot.style.background = newColor;
      if (typeof isFirebaseActive === 'function' && isFirebaseActive()) {
        if (typeof updateShpColorInCloud === 'function') updateShpColorInCloud(_editLayer.id, newColor);
      }
    }

    // ── Guardar etiquetas ────────────────────────────────────
    if (typeof layerLabels !== 'undefined') {
      const newFields  = [0,1,2].map(i => document.getElementById('lbl-field-' + i)?.value || '');
      const newVisible = document.getElementById('lbl-visible-toggle')?.checked || false;
      const newColor   = lblColorInput?.value || '#ffffff';
      const newSize    = document.getElementById('lbl-size')?.value || '14';
      const hasAnyField = newFields.some(Boolean);

      if (!hasAnyField) {
        removeLayerLabels(_editLayer.id);
      } else {
        layerLabels[_editLayer.id] = { fields: newFields, visible: newVisible, color: newColor, size: newSize };
        rebuildLabelGroup(_editLayer);
      }
      if (typeof isFirebaseActive === 'function' && isFirebaseActive()) {
        updateShpLabelsInCloud(_editLayer.id, { fields: newFields, visible: newVisible, color: newColor, size: newSize });
      }
    }

    // ── Guardar campos personalizados ──────────────────────────
    {
      const newCustomFields = [0,1,2,3,4].map(i => (document.getElementById('cf-field-' + i)?.value || '').trim());
      setCustomFields(_editLayer.id, newCustomFields);
      const fbActive = typeof isFirebaseActive === 'function' && isFirebaseActive();
      console.log('[CF] guardando campos personalizados', { layerId: _editLayer.id, newCustomFields, firebaseActive: fbActive, uid: auth?.currentUser?.uid });
      if (fbActive) {
        updateShpCustomFieldsInCloud(_editLayer.id, newCustomFields);
      }
    }

    toast(`Capa "${_editLayer.name}" actualizada`, 'ok');
    closeColorPop();
    modal.classList.remove('open');
    _editLayer = null;
  });

  // ── Helpers etiquetas en el modal ──────────────────────────
  function getLayerFields(layer) {
    const fields = new Set();
    const collect = g => {
      if (!g) return;
      if (Array.isArray(g)) { g.forEach(collect); return; }
      if (g.type === 'FeatureCollection') g.features?.forEach(f => { Object.keys(f.properties || {}).forEach(k => fields.add(k)); });
      else if (g.type === 'Feature') Object.keys(layer.geojson.properties || {}).forEach(k => fields.add(k));
    };
    collect(layer.geojson);
    return [...fields];
  }

  function populateLblSelects(layer) {
    const fields = getLayerFields(layer);
    const cfg = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
      ? layerLabels[layer.id]
      : { fields: ['','',''], visible: false };
    [0,1,2].forEach(i => {
      const sel = document.getElementById('lbl-field-' + i);
      sel.innerHTML = '<option value="">— Sin etiqueta —</option>';
      fields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        if (f === cfg.fields[i]) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!fields.includes(cfg.fields[i])) sel.value = '';
    });
    document.getElementById('lbl-visible-toggle').checked = cfg.visible;
    // Restaurar color y tamaño
    const lblColor = cfg.color || '#ffffff';
    const lblSize  = cfg.size  || '14';
    lblColorInput.value = lblColor;
    lblColorPreview.style.background = lblColor;
    document.getElementById('lbl-size').value = lblSize;
  }

  window.openLayerEditModal = function(layer) {
    _editLayer = layer;
    nameInput.value = layer.name;
    colorInput.value = layer.color;
    colorPreview.style.background = layer.color;
    populateLblSelects(layer);
    const cf = getCustomFields(layer.id);
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById('cf-field-' + i);
      if (el) el.value = cf[i] || '';
    }
    modal.classList.add('open');
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 80);
  };
});

// ═══════════════════════════════════════════════════════════════