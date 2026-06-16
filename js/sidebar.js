// ════════════════════════════════════════════════════════
// MÓDULO: js/sidebar.js
// SIDEBAR + LIGHTBOX
// ════════════════════════════════════════════════════════
// 5. SIDEBAR UNIFICADO
// ═══════════════════════════════════════════════════════════════
function addPhotoToSidebar(photo, groupEl) {
  const list = document.getElementById('unifiedList');
  document.getElementById('unified-empty').style.display = 'none';

  const card = document.createElement('div');
  card.className = 'list-item' + (photo.lat ? '' : ' no-gps');
  card.dataset.id = photo.id;
  card.dataset.type = 'photo';
  const azSpan = photo.azimuth !== null
    ? ` <span class="az-badge">↗${Math.round(photo.azimuth)}°</span>` : '';
  card.innerHTML = `
    <input type="checkbox" class="photo-vis" checked title="Mostrar en mapa" style="width:14px;height:14px;accent-color:var(--blue);cursor:pointer;flex-shrink:0;">
    <img src="${photo.thumb}" class="photo-thumb" title="Ver imagen">
    <div class="item-info">
      <div class="item-name">${esc(photo.name)}</div>
      <div class="item-sub">${photo.lat ? `${photo.lat.toFixed(4)}, ${photo.lng.toFixed(4)}${azSpan}` : 'Sin datos GPS'}</div>
    </div>
    <div class="item-actions">
      <button class="item-del" title="Eliminar">✕</button>
    </div>`;

  card.querySelector('.photo-thumb').onclick = e => { e.stopPropagation(); openLightbox(photo.thumb, photo.name); };

  const visChk = card.querySelector('.photo-vis');
  visChk.addEventListener('change', e => {
    e.stopPropagation();
    if (photo.lat === null) return;
    const key = clusterKey(photo.lat, photo.lng);
    const c = clusterMap[key];
    if (!c) return;
    photo.visible = visChk.checked;
    card.classList.toggle('hidden-photo', !visChk.checked);
    const anyVisible = c.photos.some(p => p.visible !== false);
    if (anyVisible) {
      if (!map.hasLayer(photoGroup)) return;
      if (!photoGroup.hasLayer(c.marker)) c.marker.addTo(photoGroup);
    } else {
      photoGroup.removeLayer(c.marker);
    }
  });

  card.onclick = () => {
    if (photo.lat) {
      if (activeClusterKey && activeClusterKey !== photo.clusterKey) {
        refreshClusterMarker(activeClusterKey, null);
      }
      map.setView([photo.lat, photo.lng], 18);
      const key = clusterKey(photo.lat, photo.lng);
      const c = clusterMap[key];
      if (c) c.marker.fire('click');
      document.querySelectorAll('.list-item').forEach(x => x.classList.remove('active'));
      card.classList.add('active');
    }
  };
  card.querySelector('.item-del').onclick = e => { e.stopPropagation(); removePhoto(photo.id); };
  if (groupEl) {
    groupEl.querySelector('.photo-group-children').appendChild(card);
  } else {
    const firstShp = list.querySelector('.list-item[data-type="shp"]');
    list.insertBefore(card, firstShp || document.getElementById('unified-empty'));
  }
  updateCounter();
}


function removePhoto(id) {
  const idx = photos.findIndex(p => p.id === id);
  if (idx < 0) return;
  const p = photos[idx];
  if (p.lat !== null) {
    const key = clusterKey(p.lat, p.lng);
    const c = clusterMap[key];
    if (c) {
      c.photos.splice(c.photos.findIndex(x => x.id === id), 1);
      if (c.photos.length === 0) {
        photoGroup.removeLayer(c.marker);
        delete clusterMap[key];
      } else {
        c.photos.forEach((x, i) => x.colorIndex = i);
        refreshClusterMarker(key, null);
        bindClusterPopup(key);
      }
    }
  }
  photos.splice(idx, 1);
  const itemEl = document.querySelector(`.list-item[data-id="${id}"]`);
  const groupWrap = itemEl?.closest('.photo-group');
  itemEl?.remove();
  if (groupWrap) {
    const children = groupWrap.querySelector('.photo-group-children');
    if (!children.children.length) {
      groupWrap.remove();
    } else {
      const label = groupWrap.querySelector('.group-label');
      if (label) label.textContent = `${children.children.length} fotos`;
    }
  }
  updateCounter();
}


function updateCounter() {
  const total = photos.length + shpLayers.length;
  document.getElementById('layers-count').textContent = total;
  document.getElementById('unified-empty').style.display = total === 0 ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// 6. LIGHTBOX
// ═══════════════════════════════════════════════════════════════
function openLightbox(src, name) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-name').textContent = name;
  document.getElementById('lightbox').classList.add('open');
}
document.getElementById('lightbox-close').onclick = () => document.getElementById('lightbox').classList.remove('open');
document.getElementById('lightbox').onclick = e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('lightbox').classList.remove('open'); });

// ═══════════════════════════════════════════════════════════════