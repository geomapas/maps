// ════════════════════════════════════════════════════════
// MÓDULO: js/wms-externos.js
// SERVICIOS WMS EXTERNOS
//   · "Fondo"        → WMS opaco (ortofotos, mapas topográficos): aparece como una opción
//                       más junto a Earth / Calles / SIGPAC (escritorio y móvil).
//   · "Superposición" → WMS transparente (catastro, límites, zonas protegidas…): se dibuja
//                       encima del fondo y SIEMPRE por debajo de las capas vectoriales del
//                       proyecto (pane propio), con interruptor y control de opacidad.
// Se gestionan desde "Configurar Capas Iniciales" y se guardan por usuario (localStorage
// + Firestore) para que acompañen al iniciar sesión en otro dispositivo.
// ════════════════════════════════════════════════════════
(function () {
  'use strict';

  const LS_KEY       = 'geomapas_external_wms';
  const OVERLAY_PANE = 'extWmsOverlayPane';
  const MAX_ITEMS    = 20;

  // Pane propio entre los tiles (200) y las capas vectoriales (overlayPane, 400): así una
  // superposición WMS nunca tapa las geometrías del proyecto, sin tener que reordenar nada.
  map.createPane(OVERLAY_PANE);
  map.getPane(OVERLAY_PANE).style.zIndex = 250;

  let items = [];               // [{id,name,url,layers,version,format,type,opacity,visible}]
  const layerObjs   = {};       // id -> L.TileLayer.WMS
  const lastErrToast = {};      // id -> timestamp del último aviso de error de tiles
  let caps = null;              // resultado del último GetCapabilities leído en el formulario
  let autoName = '';            // último nombre autorrellenado desde el título de la capa

  const $ = id => document.getElementById(id);

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.forEach(c => c && n.appendChild(c));
    return n;
  }

  // ── Validación / persistencia ───────────────────────────────
  function validItem(it) {
    if (!it || typeof it !== 'object') return false;
    if (typeof it.id !== 'string' || !/^[a-z0-9]{3,20}$/i.test(it.id)) return false;
    if (typeof it.layers !== 'string' || !it.layers.trim()) return false;
    if (it.type !== 'base' && it.type !== 'overlay') return false;
    try { if (!/^https?:$/.test(new URL(it.url).protocol)) return false; } catch (_) { return false; }
    return true;
  }
  function sanitize(it) {
    return {
      id: it.id,
      name: String(it.name || it.layers).slice(0, 40),
      url: it.url,
      layers: it.layers.trim(),
      version: it.version === '1.1.1' ? '1.1.1' : '1.3.0',
      format: typeof it.format === 'string' && /^image\//.test(it.format) ? it.format : (it.type === 'overlay' ? 'image/png' : 'image/jpeg'),
      type: it.type,
      opacity: Math.min(1, Math.max(0.1, Number(it.opacity) || 1)),
      visible: it.visible !== false,
    };
  }
  function loadLocal() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      return Array.isArray(a) ? a.filter(validItem).map(sanitize) : [];
    } catch (_) { return []; }
  }
  function saveItems() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_) {}
    if (typeof isFirebaseActive === 'function' && isFirebaseActive()) {
      const user = auth.currentUser;
      if (user) {
        db.doc(`artifacts/${appId}/users/${user.uid}/preferences/externalWms`)
          .set({ items, updatedAt: Date.now() })
          .catch(() => {});
      }
    }
  }

  // ── Capas Leaflet ───────────────────────────────────────────
  function makeLayer(it) {
    const overlay = it.type === 'overlay';
    const opts = {
      layers: it.layers, format: it.format, transparent: overlay,
      version: it.version, uppercase: true,
      maxNativeZoom: 20, maxZoom: 21, attribution: it.name,
    };
    if (overlay) { opts.pane = OVERLAY_PANE; opts.opacity = it.opacity; }
    const lyr = L.tileLayer.wms(it.url, opts);
    lyr._extName = it.name;
    lyr.on('tileerror', () => {
      const now = Date.now();
      if (now - (lastErrToast[it.id] || 0) < 20000) return;
      lastErrToast[it.id] = now;
      toast(`WMS "${it.name}": no se cargan las imágenes (revisa URL, capa o conexión)`, 'err');
    });
    return lyr;
  }

  function setup(it) {
    const lyr = makeLayer(it);
    layerObjs[it.id] = lyr;
    if (it.type === 'base') {
      const key = 'wms_' + it.id;
      baseLayers[key] = lyr;
      IMAGERY_DATES[key] = it.name;
      const sw = $('basemap-switcher');
      if (sw) {
        sw.insertBefore(
          el('button', { class: 'bm-btn bm-ext', id: 'bm-' + key, title: it.name, text: it.name,
                         onclick: () => setBasemap(key) }),
          $('bm-3d') || null);
      }
      const mp = $('mob-raster-panel');
      if (mp) {
        mp.appendChild(el('button', { class: 'mob-raster-opt', 'data-bm': key, text: it.name,
          onclick: () => (typeof window.mobSetBasemap === 'function' ? window.mobSetBasemap(key) : setBasemap(key)) }));
      }
    } else if (it.visible) {
      lyr.addTo(map);
    }
  }

  function teardown(it) {
    const lyr = layerObjs[it.id];
    if (it.type === 'base') {
      const key = 'wms_' + it.id;
      if (typeof activeBasemap !== 'undefined' && activeBasemap === key) {
        if (typeof window.mobSetBasemap === 'function') window.mobSetBasemap('earth');
        else setBasemap('earth');
      }
      delete baseLayers[key];
      delete IMAGERY_DATES[key];
      $('bm-' + key)?.remove();
      document.querySelector(`.mob-raster-opt[data-bm="${key}"]`)?.remove();
    }
    if (lyr && map.hasLayer(lyr)) map.removeLayer(lyr);
    delete layerObjs[it.id];
  }

  function replaceAll(newItems) {
    items.slice().forEach(teardown);
    items = newItems;
    items.forEach(setup);
    renderRows();
    renderModalList();
  }

  // ── Visibilidad / opacidad ──────────────────────────────────
  function setVisible(id, v) {
    const it = items.find(i => i.id === id); if (!it) return;
    it.visible = v;
    const lyr = layerObjs[id];
    if (lyr) { if (v) lyr.addTo(map); else map.removeLayer(lyr); }
    document.querySelectorAll(`input[data-ext="${id}"][type="checkbox"]`).forEach(c => { c.checked = v; });
    saveItems();
  }
  function setOpacity(id, o) {
    const it = items.find(i => i.id === id); if (!it) return;
    it.opacity = o;
    layerObjs[id]?.setOpacity(o);
    document.querySelectorAll(`input.ext-wms-opacity[data-ext="${id}"]`).forEach(s => { s.value = String(Math.round(o * 100)); });
  }

  // ── Filas en los paneles (escritorio y móvil) ───────────────
  function opacitySlider(it) {
    const s = el('input', { type: 'range', class: 'ext-wms-opacity', min: '10', max: '100', step: '5',
                            'data-ext': it.id, title: 'Opacidad' });
    s.value = String(Math.round(it.opacity * 100));
    s.addEventListener('input', () => setOpacity(it.id, s.value / 100));
    s.addEventListener('change', saveItems);
    return s;
  }
  function deskRow(it) {
    const tid = 'ext-tog-' + it.id;
    const chk = el('input', { type: 'checkbox', id: tid, 'data-ext': it.id });
    chk.checked = it.visible;
    chk.addEventListener('change', () => setVisible(it.id, chk.checked));
    return el('div', { class: 'layer-row', 'data-ext-id': it.id, style: 'margin-top:4px;' },
      el('div', { class: 'layer-color', style: 'background:var(--blue);' }),
      el('div', { class: 'layer-texts' },
        el('div', { class: 'layer-name', title: it.name, text: it.name }),
        opacitySlider(it)),
      el('div', { class: 'toggle-wrap' }, chk, el('label', { for: tid })));
  }
  function mobRow(it) {
    const tid = 'mob-ext-tog-' + it.id;
    const chk = el('input', { type: 'checkbox', id: tid, 'data-ext': it.id });
    chk.checked = it.visible;
    chk.addEventListener('change', () => setVisible(it.id, chk.checked));
    return el('div', { class: 'mob-layer-row', 'data-ext-id': it.id, style: 'margin-top:6px;' },
      el('div', { class: 'mob-layer-color', style: 'background:var(--blue);' }),
      el('div', { class: 'mob-layer-name' },
        el('div', { text: it.name }),
        opacitySlider(it)),
      el('div', { class: 'mob-toggle-wrap' }, chk, el('label', { for: tid })));
  }
  function renderRows() {
    const overlays = items.filter(i => i.type === 'overlay');
    const d = $('ext-wms-overlay-rows'), m = $('mob-ext-wms-rows');
    if (d) d.replaceChildren(...overlays.map(deskRow));
    if (m) m.replaceChildren(...overlays.map(mobRow));
  }

  // ── Lista en el modal de configuración ──────────────────────
  function renderModalList() {
    const list = $('ext-wms-list'); if (!list) return;
    if (!items.length) {
      list.replaceChildren(el('div', { class: 'ext-wms-empty', text: 'Ningún servicio añadido.' }));
      return;
    }
    list.replaceChildren(...items.map(it => el('div', { class: 'ext-wms-item' },
      el('span', { class: 'ext-wms-name', title: it.url + '\n' + it.layers, text: it.name }),
      el('span', { class: 'ext-wms-tag', text: it.type === 'base' ? 'Fondo' : 'Superpos.' }),
      el('button', { class: 'ext-wms-del', type: 'button', title: 'Eliminar', text: '✕',
                     onclick: () => removeItem(it.id) }))));
  }
  function removeItem(id) {
    const it = items.find(i => i.id === id); if (!it) return;
    if (!confirm(`¿Eliminar el servicio WMS "${it.name}"?`)) return;
    teardown(it);
    items = items.filter(i => i.id !== id);
    renderRows(); renderModalList(); saveItems();
  }

  // ── Alta de un servicio ─────────────────────────────────────
  function normalizeUrl(raw) {
    let u;
    try { u = new URL((raw || '').trim()); } catch (_) { return { error: 'La URL no es válida.' }; }
    if (!/^https?:$/.test(u.protocol)) return { error: 'La URL debe empezar por http:// o https://' };
    if (location.protocol === 'https:' && u.protocol === 'http:') {
      return { error: 'Este servicio usa http:// y la app va por https://: el navegador lo bloquearía. Busca su versión https://.' };
    }
    // Si se pegó una URL completa de GetCapabilities/GetMap, quitar los parámetros propios de WMS
    const drop = ['service', 'request', 'version', 'layers', 'format', 'transparent', 'styles',
                  'crs', 'srs', 'bbox', 'width', 'height', 'exceptions'];
    [...u.searchParams.keys()].forEach(k => { if (drop.includes(k.toLowerCase())) u.searchParams.delete(k); });
    u.hash = '';
    return { url: u.toString() };
  }

  function parseCapabilities(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML no válido');
    const ver = doc.documentElement.getAttribute('version') || '';
    const version = (ver === '1.3.0' || ver === '1.1.1') ? ver : '1.1.1';
    const txt = n => (n ? n.textContent.trim() : '');
    const child = (node, name) => [...node.children].find(c => c.localName === name);
    const layers = [];
    [...doc.getElementsByTagNameNS('*', 'Layer')].forEach(l => {
      const name = txt(child(l, 'Name'));
      if (name) layers.push({ name, title: txt(child(l, 'Title')) || name });
    });
    if (!layers.length) throw new Error('El servicio no devolvió ninguna capa');
    const formats = [];
    const getMap = [...doc.getElementsByTagNameNS('*', 'GetMap')][0];
    if (getMap) [...getMap.children].filter(c => c.localName === 'Format').forEach(f => formats.push(txt(f)));
    const crsAll = [...doc.getElementsByTagNameNS('*', 'CRS'), ...doc.getElementsByTagNameNS('*', 'SRS')]
      .map(n => txt(n).toUpperCase()).join(' ');
    const hasMercator = /EPSG:3857|EPSG:900913|EPSG:102100|EPSG:102113/.test(crsAll);
    return { version, layers, formats, hasMercator };
  }

  function pickFormat(formats, type) {
    const low = formats.map(f => f.toLowerCase());
    const find = re => formats.find((_, i) => re.test(low[i]));
    if (type === 'overlay') return find(/^image\/png$/) || find(/png/) || find(/gif/) || formats[0] || 'image/png';
    return find(/^image\/jpeg$/) || find(/jpe?g/) || find(/^image\/png$/) || find(/png/) || formats[0] || 'image/jpeg';
  }

  function msg(text, kind) {
    const m = $('ext-wms-msg'); if (!m) return;
    m.textContent = text || '';
    m.className = 'ext-wms-msg' + (kind ? ' ' + kind : '');
  }

  async function readCapabilities() {
    const norm = normalizeUrl($('ext-wms-url').value);
    if (norm.error) { msg(norm.error, 'err'); return; }
    const btn = $('ext-wms-read');
    btn.disabled = true; msg('Leyendo capas del servicio…');
    try {
      const sep = norm.url.includes('?') ? '&' : '?';
      const res = await fetch(norm.url + sep + 'SERVICE=WMS&REQUEST=GetCapabilities');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      caps = parseCapabilities(await res.text());
      const sel = $('ext-wms-layer-sel');
      sel.replaceChildren(...caps.layers.map(l => el('option', { value: l.name, text: `${l.title} (${l.name})` })));
      sel.style.display = '';
      $('ext-wms-version').value = caps.version;
      onLayerSelChange();
      msg(`${caps.layers.length} capa${caps.layers.length > 1 ? 's' : ''} encontrada${caps.layers.length > 1 ? 's' : ''}.` +
          (caps.hasMercator ? '' : ' Aviso: el servicio no declara EPSG:3857 y podría no verse bien.'),
          caps.hasMercator ? 'ok' : 'err');
    } catch (e) {
      caps = null;
      $('ext-wms-layer-sel').style.display = 'none';
      msg('No se pudieron leer las capas (el servicio puede no permitir consultas desde el navegador, o la URL no es correcta). Escribe el nombre de la capa a mano.', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function onLayerSelChange() {
    const sel = $('ext-wms-layer-sel');
    const l = caps?.layers.find(x => x.name === sel.value);
    const nameInp = $('ext-wms-name');
    if (l && (!nameInp.value || nameInp.value === autoName)) { nameInp.value = l.title.slice(0, 40); autoName = nameInp.value; }
  }

  function resetForm() {
    ['ext-wms-url', 'ext-wms-layer-manual', 'ext-wms-name'].forEach(id => { $(id).value = ''; });
    $('ext-wms-layer-sel').replaceChildren();
    $('ext-wms-layer-sel').style.display = 'none';
    $('ext-wms-type').value = 'overlay';
    $('ext-wms-version').value = '1.3.0';
    caps = null; autoName = ''; msg('');
    $('ext-wms-form').style.display = 'none';
    $('ext-wms-add-toggle').style.display = '';
  }

  function genId() {
    let id;
    do { id = Math.random().toString(36).slice(2, 10); } while (items.some(i => i.id === id) || id.length < 3);
    return id;
  }

  function addFromForm() {
    const norm = normalizeUrl($('ext-wms-url').value);
    if (norm.error) { msg(norm.error, 'err'); return; }
    const manual = $('ext-wms-layer-manual').value.trim();
    const sel = $('ext-wms-layer-sel');
    const layers = manual || (sel.style.display !== 'none' ? sel.value : '');
    if (!layers) { msg('Elige una capa de la lista o escribe su nombre.', 'err'); return; }
    if (items.length >= MAX_ITEMS) { msg(`Máximo ${MAX_ITEMS} servicios.`, 'err'); return; }
    const type = $('ext-wms-type').value === 'base' ? 'base' : 'overlay';
    const it = sanitize({
      id: genId(),
      name: $('ext-wms-name').value.trim() || layers,
      url: norm.url, layers,
      version: $('ext-wms-version').value,
      format: pickFormat(caps ? caps.formats : [], type),
      type, opacity: 1, visible: true,
    });
    items.push(it);
    setup(it);
    renderRows(); renderModalList(); saveItems();
    resetForm();
    toast(`WMS "${it.name}" añadido`, 'ok');
    if (type === 'base') setBasemap('wms_' + it.id);
  }

  function wireForm() {
    const toggle = $('ext-wms-add-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      $('ext-wms-form').style.display = 'flex';
      toggle.style.display = 'none';
      $('ext-wms-url').focus();
    });
    $('ext-wms-cancel').addEventListener('click', resetForm);
    $('ext-wms-read').addEventListener('click', readCapabilities);
    $('ext-wms-url').addEventListener('keydown', e => { if (e.key === 'Enter') readCapabilities(); });
    $('ext-wms-layer-sel').addEventListener('change', onLayerSelChange);
    $('ext-wms-save').addEventListener('click', addFromForm);
  }

  // ── Sincronización con Firestore al iniciar sesión ──────────
  document.addEventListener('initial-layers-sync-firestore', async e => {
    const uid = e.detail?.uid;
    if (!uid || typeof db === 'undefined') return;
    try {
      const snap = await db.doc(`artifacts/${appId}/users/${uid}/preferences/externalWms`).get();
      const remote = snap.exists ? snap.data()?.items : null;
      if (Array.isArray(remote)) {
        replaceAll(remote.filter(validItem).map(sanitize));
        try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_) {}
      } else if (items.length) {
        saveItems(); // no hay copia en la nube todavía: subir la local
      }
    } catch (err) { console.warn('WMS externos: error de sincronización', err); }
  });

  // ── Arranque ────────────────────────────────────────────────
  items = loadLocal();
  items.forEach(setup);
  renderRows();
  renderModalList();
  wireForm();
})();
