// ════════════════════════════════════════════════════════
// MÓDULO: js/gps-desktop.js
// GPS MEASURE DESKTOP
// ════════════════════════════════════════════════════════
// DESKTOP GPS MEASURE TOOL
// ═══════════════════════════════════════════════════════════════
(function() {
  const dskGpsBtn      = document.getElementById('desktop-gps-btn');
  const dskGpsBar      = document.getElementById('desktop-gps-bar');
  if (!dskGpsBtn || !dskGpsBar) return;

  const dskGpsTypeArea = document.getElementById('dsk-gps-type-area');
  const dskGpsTypeLine = document.getElementById('dsk-gps-type-line');
  const dskGpsState    = document.getElementById('desktop-gps-state-label');
  const dskGpsMeasure  = document.getElementById('desktop-gps-measure');
  const dskGpsPtsLabel = document.getElementById('dsk-gps-pts-label');
  const dskPlayBtn     = document.getElementById('dsk-gps-play-btn');
  const dskPauseBtn    = document.getElementById('dsk-gps-pause-btn');
  const dskStopBtn     = document.getElementById('dsk-gps-stop-btn');
  const dskResetBtn    = document.getElementById('dsk-gps-reset-btn');
  const dskClearBtn    = document.getElementById('dsk-gps-clear-btn');

  let dskGpsTrackType  = 'area';
  let dskGpsState_v    = 'idle'; // idle | recording | paused
  let dskGpsWatchId    = null;
  let dskGpsPoints     = [];
  let dskGpsLastTime   = null;
  let dskGpsPolyline   = null;
  let dskGpsCount      = 0;

  function openDskGpsBar() {
    // Stop other tools
    if (typeof globeActive !== 'undefined' && globeActive) stopGlobeTool();
    if (typeof measureMode !== 'undefined' && measureMode) stopMeasure();
    if (typeof drawActive !== 'undefined' && drawActive) { if (typeof window.closeDrawBar === 'function') window.closeDrawBar(); else stopDraw(false); }
    if (typeof queryMode !== 'undefined' && queryMode !== 'none') applyQueryMode('none');
    if (typeof window._selActive !== 'undefined' && window._selActive) { if (typeof window.closeSelBar === 'function') window.closeSelBar(); }
    dskGpsBar.classList.add('open');
    dskGpsBtn.classList.add('active');
    // Sync mobile GPS btn
    const _mobGpsMeas = document.getElementById('mob-gpsmeasure-toggle');
    if (_mobGpsMeas) _mobGpsMeas.classList.add('active');
    // Auto-activate GPS location button (desktop uses geolocate-btn, mobile uses mob-gps-btn)
    const geoBtn = document.getElementById('geolocate-btn') || document.getElementById('mob-gps-btn');
    if (geoBtn && !geoBtn.classList.contains('active')) geoBtn.click();
    updateDskGpsUI();
  }
  window.openDskGpsBar  = openDskGpsBar;

  function closeDskGpsBar() {
    dskGpsBar.classList.remove('open');
    dskGpsBtn.classList.remove('active');
    // Sync mobile GPS btn
    const _mobGpsMeas = document.getElementById('mob-gpsmeasure-toggle');
    if (_mobGpsMeas) _mobGpsMeas.classList.remove('active');
    if (dskGpsState_v !== 'idle') {
      dskGpsStopWatch();
      dskGpsState_v = 'idle';
    }
  }
  window.closeDskGpsBar = closeDskGpsBar;



  function resetDskGps() {
    dskGpsStopWatch();
    if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; }
    dskGpsPoints = [];
    dskGpsState_v = 'idle';
    updateDskGpsUI();
  }

  function updateDskGpsUI() {
    const canChange = dskGpsState_v === 'idle';
    dskGpsTypeArea.classList.toggle('active', dskGpsTrackType === 'area');
    dskGpsTypeLine.classList.toggle('active', dskGpsTrackType === 'line');
    dskGpsTypeArea.disabled = !canChange;
    dskGpsTypeLine.disabled = !canChange;

    dskGpsState.className = '';
    // Highlight persistente en play/pause
    dskPlayBtn.classList.remove('gps-active-state');
    dskPauseBtn.classList.remove('gps-active-state');

    if (dskGpsState_v === 'idle') {
      dskGpsState.textContent = 'Sin iniciar';
      dskPlayBtn.disabled  = false;
      dskPauseBtn.disabled = true;
      dskStopBtn.disabled  = true;
    } else if (dskGpsState_v === 'recording') {
      dskGpsState.textContent = '● Grabando…';
      dskGpsState.classList.add('recording');
      dskPlayBtn.disabled  = true;
      dskPauseBtn.disabled = false;
      dskStopBtn.disabled  = false;
      // Play activo: resaltar pause (que es el botón "en curso")
      dskPauseBtn.classList.add('gps-active-state');
    } else if (dskGpsState_v === 'paused') {
      dskGpsState.textContent = '⏸ Pausado';
      dskPlayBtn.disabled  = false;
      dskPauseBtn.disabled = true;
      dskStopBtn.disabled  = false;
      // Pause activo: resaltar play (listo para reanudar)
      dskPlayBtn.classList.add('gps-active-state');
    }
    dskGpsPtsLabel.textContent = dskGpsPoints.length > 0 ? dskGpsPoints.length + ' pts' : '';

    // Botón back (deshacer último punto): solo activo en pausa con puntos
    dskResetBtn.disabled = !(dskGpsState_v === 'paused' && dskGpsPoints.length > 0);
    dskResetBtn.style.opacity = dskResetBtn.disabled ? '0.35' : '1';
    dskResetBtn.style.cursor  = dskResetBtn.disabled ? 'not-allowed' : 'pointer';

    // Botón clear (resetear todo): activo solo en pausa o idle con puntos, nunca durante play
    const clearActive = dskGpsState_v !== 'recording' && dskGpsPoints.length > 0;
    if (dskClearBtn) {
      dskClearBtn.disabled = !clearActive;
      dskClearBtn.style.opacity = clearActive ? '1' : '0.35';
      dskClearBtn.style.cursor  = clearActive ? 'pointer' : 'not-allowed';
    }
    const mobInfo = document.getElementById('dsk-gps-mob-info');
    if (mobInfo) {
      const ptsStr = dskGpsPoints.length > 0 ? ' · ' + dskGpsPoints.length + ' pts' : '';
      mobInfo.textContent = dskGpsState.textContent + ptsStr;
      mobInfo.style.color = dskGpsState_v === 'recording' ? 'var(--blue)' : 'var(--muted)';
    }

    // Update measure display
    if (dskGpsPoints.length >= 2) {
      if (dskGpsTrackType === 'line') {
        let totalM = 0;
        for (let i=1; i<dskGpsPoints.length; i++) totalM += haversineM({lat:dskGpsPoints[i-1][0],lng:dskGpsPoints[i-1][1]},{lat:dskGpsPoints[i][0],lng:dskGpsPoints[i][1]});
        dskGpsMeasure.textContent = fmtDist(totalM);
      } else if (dskGpsPoints.length >= 3) {
        const lls = dskGpsPoints.map(([lat,lng])=>L.latLng(lat,lng));
        dskGpsMeasure.textContent = fmtArea(ringAreaSqM(lls));
      } else {
        dskGpsMeasure.textContent = dskGpsPoints.length + ' / 3 pts mínimos para área';
      }
    } else if (dskGpsPoints.length === 1) {
      dskGpsMeasure.textContent = '1 / ' + (dskGpsTrackType === 'line' ? '2' : '3') + ' pts mínimos';
    } else {
      dskGpsMeasure.textContent = '';
    }
  }

  function dskGpsStartWatch() {
    if (!navigator.geolocation) { toast('Geolocalización no disponible', 'err'); return; }
    if (dskGpsWatchId !== null) return;
    dskGpsWatchId = navigator.geolocation.watchPosition(pos => {
      if (dskGpsState_v !== 'recording') return;
      const { latitude: lat, longitude: lng } = pos.coords;

      // Filtro: mínimo 1 segundo entre puntos
      const now = Date.now();
      if (dskGpsLastTime && now - dskGpsLastTime < 1000) return;

      // Filtro: mínimo 2 metros desde el último punto
      if (dskGpsPoints.length > 0) {
        const last = dskGpsPoints[dskGpsPoints.length - 1];
        const dLat = (lat - last[0]) * Math.PI / 180;
        const dLng = (lng - last[1]) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(last[0]*Math.PI/180) * Math.cos(lat*Math.PI/180) * Math.sin(dLng/2)**2;
        const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist < 2) return;
      }

      dskGpsLastTime = now;
      dskGpsPoints.push([lat, lng]);
      if (dskGpsPolyline) dskGpsPolyline.setLatLngs(dskGpsPoints);
      else dskGpsPolyline = L.polyline(dskGpsPoints, { color: '#2f6fde', weight: 3, opacity: 0.9 }).addTo(map);
      updateDskGpsUI();
    }, err => {
      const msgs = { 1:'Permiso denegado', 2:'Posición no disponible', 3:'Sin señal GPS' };
      toast('GPS: ' + (msgs[err.code] || err.message), 'err');
      dskGpsState_v = 'idle';
      dskGpsStopWatch();
      updateDskGpsUI();
    }, { enableHighAccuracy: true, maximumAge: 2000 });
  }

  function dskGpsStopWatch() {
    if (dskGpsWatchId !== null) { navigator.geolocation.clearWatch(dskGpsWatchId); dskGpsWatchId = null; }
  }

  dskGpsBtn.addEventListener('click', () => {
    if (dskGpsBar.classList.contains('open')) closeDskGpsBar();
    else openDskGpsBar();
  });

  dskGpsTypeArea.addEventListener('click', e => {
    e.stopPropagation();
    if (dskGpsState_v !== 'idle') return;
    dskGpsTrackType = 'area'; updateDskGpsUI();
  });
  dskGpsTypeLine.addEventListener('click', e => {
    e.stopPropagation();
    if (dskGpsState_v !== 'idle') return;
    dskGpsTrackType = 'line'; updateDskGpsUI();
  });

  dskPlayBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (dskGpsState_v === 'idle') {
      dskGpsPoints = [];
      dskGpsLastTime = null;
      if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; }
      dskGpsState_v = 'recording';
      dskGpsStartWatch();
      toast('Medición GPS iniciada (' + (dskGpsTrackType === 'area' ? 'área' : 'línea') + ')');
    } else if (dskGpsState_v === 'paused') {
      dskGpsState_v = 'recording';
      dskGpsStartWatch();
      toast('Medición GPS reanudada');
    }
    updateDskGpsUI();
  });

  dskPauseBtn.addEventListener('click', e => {
    e.stopPropagation();
    dskGpsState_v = 'paused'; dskGpsStopWatch(); updateDskGpsUI();
    toast('Medición GPS pausada');
  });

  dskStopBtn.addEventListener('click', e => {
    e.stopPropagation();
    dskGpsStopWatch();
    if (dskGpsTrackType === 'area') {
      if (dskGpsPoints.length < 3) { toast('Se necesitan al menos 3 puntos para crear un área', 'err'); dskGpsState_v = 'idle'; if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; } updateDskGpsUI(); return; }
      const ring = [...dskGpsPoints, dskGpsPoints[0]];
      const ringCoords = ring.map(([lat,lng]) => [lng,lat]);
      dskGpsCount++;
      const name = 'GPS Área ' + dskGpsCount;
      const ringLL = dskGpsPoints.map(([lat,lng]) => L.latLng(lat,lng));
      const areaM2 = ringAreaSqM(ringLL);
      const areaHa = (areaM2/10000).toFixed(4);
      const geojson = { type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'Polygon', coordinates:[ringCoords] }, properties:{ nombre:name, area_m2:Math.round(areaM2), area_ha:areaHa } }] };
      if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; }
      showSaveLayerModal(geojson, name, () => { dskGpsPoints = []; dskGpsState_v = 'idle'; updateDskGpsUI(); });
      return;
    } else {
      if (dskGpsPoints.length < 2) { toast('Se necesitan al menos 2 puntos para crear una línea', 'err'); dskGpsState_v = 'idle'; if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; } updateDskGpsUI(); return; }
      const lineCoords = dskGpsPoints.map(([lat,lng]) => [lng,lat]);
      let totalM = 0;
      for (let i=1;i<dskGpsPoints.length;i++) totalM += haversineM({lat:dskGpsPoints[i-1][0],lng:dskGpsPoints[i-1][1]},{lat:dskGpsPoints[i][0],lng:dskGpsPoints[i][1]});
      dskGpsCount++;
      const name = 'GPS Línea ' + dskGpsCount;
      const distLabel = fmtDist(totalM);
      const geojson = { type:'FeatureCollection', features:[{ type:'Feature', geometry:{ type:'LineString', coordinates:lineCoords }, properties:{ nombre:name, distancia_m:Math.round(totalM), distancia:distLabel } }] };
      if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; }
      showSaveLayerModal(geojson, name, () => { dskGpsPoints = []; dskGpsState_v = 'idle'; updateDskGpsUI(); });
      return;
    }
    dskGpsPoints = []; dskGpsState_v = 'idle'; updateDskGpsUI();
  });

  dskResetBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (dskGpsState_v !== 'paused' || dskGpsPoints.length === 0) return;
    dskGpsPoints.pop();
    if (dskGpsPolyline) {
      if (dskGpsPoints.length >= 2) {
        dskGpsPolyline.setLatLngs(dskGpsPoints);
      } else {
        map.removeLayer(dskGpsPolyline);
        dskGpsPolyline = null;
      }
    }
    toast('Último punto eliminado');
    updateDskGpsUI();
  });

  if (dskClearBtn) {
    dskClearBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (dskGpsState_v === 'recording') return;
      dskGpsPoints = [];
      dskGpsLastTime = null;
      dskGpsState_v = 'idle';
      dskGpsStopWatch();
      if (dskGpsPolyline) { map.removeLayer(dskGpsPolyline); dskGpsPolyline = null; }
      updateDskGpsUI();
      toast('Medición reseteada');
    });
  }

  updateDskGpsUI();
})();

// ═══════════════════════════════════════════════════════════════