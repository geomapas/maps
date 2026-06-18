// ════════════════════════════════════════════════════════
// MÓDULO: js/checklist.js
// CHECKLIST + VISITADO
// ════════════════════════════════════════════════════════
  // ── Checklist: tabs y guardado via event delegation en popups de Leaflet ──
  document.addEventListener('click', function(e) {
    // Tab switching
    const tab = e.target.closest('.popup-tab');
    if (tab) {
      const wrap = tab.closest('div');
      wrap.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.tab;
      tab.closest('[style]').querySelectorAll('.popup-tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === panel);
      });
      return;
    }
    // Save button (checklist)
    const btn = e.target.closest('.cl-save-btn');
    if (btn) {
      const key = btn.id.replace('cl-btn-', '');
      const keyParts = key.replace(/^cl_/, '').match(/^(.+)_(\d+)$/);
      const layerIdForKey = keyParts ? keyParts[1] : null;

      const visitado = document.getElementById('cl-cb-' + key)?.checked || false;
      const comentario = document.getElementById('cl-ta-' + key)?.value || '';
      const prev = (() => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(_) { return null; } })();

      // Campos personalizados (sólo los configurados para esta capa)
      const customLabels = layerIdForKey ? getCustomFields(layerIdForKey) : ['','','','',''];
      const custom = (prev?.custom || ['','','','','']).slice();
      customLabels.forEach((label, i) => {
        if (!label || !label.trim()) return;
        const input = document.getElementById(`cl-cf-${key}-${i}`);
        if (input) custom[i] = input.value;
      });

      // Técnico y fecha/hora de visita: se autorrellenan al marcar y se borran al desmarcar
      let tecnico = prev?.tecnico || '';
      let visitDate = prev?.visitDate || null;
      if (visitado && !prev?.visitado) {
        tecnico = (typeof auth !== 'undefined' && auth?.currentUser?.email) || tecnico || 'Usuario';
        visitDate = Date.now();
      } else if (!visitado) {
        tecnico = '';
        visitDate = null;
      }

      const data = { visitado, comentario, ts: Date.now(), tecnico, visitDate, custom };
      localStorage.setItem(key, JSON.stringify(data));
      // Actualizar color del feature en el mapa inmediatamente
      // key tiene formato: cl_${layerId}_${featureIdx}
      if (keyParts) {
        updateFeatureVisitedStyle(keyParts[1], parseInt(keyParts[2]), visitado);
      }
      // Si la capa es colaborativa, sincronizar el checklist en Firestore para todos los usuarios
      if (keyParts && typeof shpLayers !== 'undefined') {
        const collabLayer = shpLayers.find(l => l.id === keyParts[1] && (l._isCollab || l._hasCollaborators));
        if (collabLayer) {
          saveCollabChecklist(keyParts[1], keyParts[2], data);
        }
      }
      // Si Firebase activo, guardar también en Firestore
      if (typeof isFirebaseActive === 'function' && isFirebaseActive() && typeof db !== 'undefined' && typeof appId !== 'undefined') {
        const uid = auth?.currentUser?.uid;
        if (uid) db.doc(`artifacts/${appId}/users/${uid}/checklists/${key}`).set(data).catch(() => {});
      }
      // Mostrar confirmación
      const msg = document.getElementById('cl-msg-' + key);
      if (msg) { msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 1800); }
      // Actualizar badge en la pestaña
      const tabEl = btn.closest('[style]')?.querySelector('.popup-tab[data-tab="checklist"]');
      if (tabEl) {
        const badge = tabEl.querySelector('.cl-badge');
        if (visitado && !badge) tabEl.insertAdjacentHTML('beforeend', '<span class="cl-badge"></span>');
        else if (!visitado && badge) badge.remove();
      }
      return;
    }
  });

  // Cargar checklists desde Firestore al iniciar sesión (complementa localStorage)
  document.addEventListener('cl-sync-firestore', async (e) => {
    const uid = e.detail?.uid;
    if (!uid || typeof db === 'undefined') return;
    try {
      const snap = await db.collection(`artifacts/${appId}/users/${uid}/checklists`).get();
      snap.forEach(doc => {
        const existing = localStorage.getItem(doc.id);
        const remote = doc.data();
        // Gana el más reciente
        if (!existing || (JSON.parse(existing).ts || 0) < (remote.ts || 0)) {
          localStorage.setItem(doc.id, JSON.stringify(remote));
        }
      });
      // Reaplicar estilos de visitados en todas las capas ya cargadas,
      // ya que pueden haberse renderizado antes de que los checklists llegaran de la nube
      if (typeof shpLayers !== 'undefined' && typeof updateFeatureVisitedStyle !== 'undefined') {
        shpLayers.forEach(layer => {
          const _allF = [];
          const _colF = g => {
            if (!g) return;
            if (Array.isArray(g)) { g.forEach(_colF); return; }
            if (g.type === 'FeatureCollection') g.features?.forEach(f => _allF.push(f));
            else if (g.type === 'Feature') _allF.push(g);
          };
          _colF(layer.geojson);
          _allF.forEach((f, fIdx) => {
            const saved = getChecklistData(layer.id, fIdx);
            if (saved?.visitado) {
              updateFeatureVisitedStyle(layer.id, fIdx, true);
            }
          });
        });
      }
    } catch(err) { console.warn('Checklist sync error:', err); }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(r => console.log('[PWA] SW registrado:', r.scope))
        .catch(e => console.warn('[PWA] SW error:', e));
    });
  }

// ═══════════════════════════════════════════════════════════════
// MODAL "AÑADIR CAPA A:" — función central usada por dibujo, GPS y selección
// ═══════════════════════════════════════════════════════════════
(function() {
  const modal    = document.getElementById('addToLayerModal');
  const select   = document.getElementById('addToLayerSelect');
  const btnSave  = document.getElementById('addToLayerSave');
  const btnCancel= document.getElementById('addToLayerCancel');

  let _pendingGeojson  = null;
  let _pendingName     = null;
  let _pendingCallback = null;

  // Exponer globalmente para que los tres flujos la llamen
  window.showSaveLayerModal = function(geojson, defaultName, onSave) {
    _pendingGeojson  = geojson;
    _pendingName     = defaultName;
    _pendingCallback = onSave || null;

    // Poblar el select con las capas existentes
    select.innerHTML = '<option value="__new__">— Nueva capa vectorial —</option>';
    if (typeof shpLayers !== 'undefined') {
      shpLayers.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name;
        select.appendChild(opt);
      });
    }
    select.value = '__new__';
    modal.classList.add('open');
  };

  btnCancel.addEventListener('click', () => {
    modal.classList.remove('open');
    _pendingGeojson = _pendingName = _pendingCallback = null;
  });

  btnSave.addEventListener('click', () => {
    modal.classList.remove('open');
    if (!_pendingGeojson) return;

    const targetId = select.value;

    if (targetId === '__new__') {
      // Nueva capa
      if (typeof addShpLayer === 'function') {
        addShpLayer(_pendingGeojson, _pendingName, null, true);
        toast(`"${_pendingName}" añadida`, 'ok');
      }
    } else {
      // Añadir a capa existente
      mergeIntoLayer(targetId, _pendingGeojson);
    }

    if (typeof _pendingCallback === 'function') _pendingCallback();
    _pendingGeojson = _pendingName = _pendingCallback = null;
  });

  // Mezcla las features del geojson nuevo en una capa existente
  function mergeIntoLayer(layerId, newGeojson) {
    const layer = shpLayers.find(l => l.id === layerId);
    if (!layer) { toast('Capa no encontrada', 'err'); return; }

    // Extraer features nuevas
    const newFeatures = [];
    const collect = g => {
      if (!g) return;
      if (Array.isArray(g)) { g.forEach(collect); return; }
      if (g.type === 'FeatureCollection') g.features?.forEach(f => newFeatures.push(f));
      else if (g.type === 'Feature') newFeatures.push(g);
    };
    collect(newGeojson);

    // Construir nuevo geojson combinado
    const existingFeatures = [];
    const collectExisting = g => {
      if (!g) return;
      if (Array.isArray(g)) { g.forEach(collectExisting); return; }
      if (g.type === 'FeatureCollection') g.features?.forEach(f => existingFeatures.push(f));
      else if (g.type === 'Feature') existingFeatures.push(g);
    };
    collectExisting(layer.geojson);

    const mergedGeojson = {
      type: 'FeatureCollection',
      features: [...existingFeatures, ...newFeatures]
    };

    // Eliminar la capa actual del mapa y del array
    map.removeLayer(layer.polyLayer);
    map.removeLayer(layer.pinLayer);
    map.off('zoomend', layer.leafletLayer._onZoom);
    const idx = shpLayers.findIndex(l => l.id === layerId);
    if (idx !== -1) shpLayers.splice(idx, 1);
    // Eliminar del panel de capas
    document.querySelector(`.list-item[data-id="${layerId}"]`)?.remove();

    // Preservar configuración de etiquetas y color antes de recrear la capa
    const _savedColor = layer.color;
    const _savedLabels = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
      ? { fields: [...layerLabels[layer.id].fields], visible: layerLabels[layer.id].visible }
      : null;
    if (typeof removeLayerLabels === 'function') removeLayerLabels(layer.id);
    // Recrear la capa con los datos combinados, manteniendo el mismo id, nombre y color
    addShpLayer(mergedGeojson, layer.name, layer.id, true, false, _savedColor);

    // Restaurar etiquetas en la capa recién recreada
    if (_savedLabels) {
      const _mergedLayer = shpLayers.find(l => l.id === layer.id);
      if (_mergedLayer && typeof restoreLayerLabels === 'function') {
        restoreLayerLabels(_mergedLayer, _savedLabels);
      }
    }
    toast(`${newFeatures.length} geometría${newFeatures.length > 1 ? 's' : ''} añadida${newFeatures.length > 1 ? 's' : ''} a "${layer.name}"`, 'ok');
  }

})();
