// ════════════════════════════════════════════════════════
// MÓDULO: js/firebase.js
// FIREBASE AUTH + FIRESTORE
// ════════════════════════════════════════════════════════
// 10. CONTROLADOR Y CONFIGURACIÓN FIREBASE (SANDBOX DE FALLO SEGURO)
// ═══════════════════════════════════════════════════════════════
// Las claves están inicialmente vacías para que el usuario las asigne.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyCoNgpA1XNQoY1mI4l80pQtGvQ3fChNPpw",
  authDomain: "geacam-maps.firebaseapp.com",
  projectId: "geacam-maps",
  storageBucket: "geacam-maps.firebasestorage.app",
  messagingSenderId: "508179845697",
  appId: "1:508179845697:web:d53ee01c3b4580a324acc0"
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Referencias de servicios de Firebase vacías por defecto (Modo local)
let appFirebase = null;
let auth = null;
let db = null;
let shpUnsubscribe = null;

// Verifica si la base de datos y la conexión a Firebase están activas
function isFirebaseActive() {
  return (appFirebase !== null && auth !== null && db !== null && auth.currentUser !== null);
}

// Inicialización de Firebase encapsulada en bloque seguro (para evitar que rompa el visor)
try {
  // Comprobar que la configuración no sea la vacía por defecto
  if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "" && !firebaseConfig.apiKey.startsWith("TU_")) {
    appFirebase = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    // Habilitar la persistencia offline nativa de Firestore (Caché local en IndexedDB)
    db.enablePersistence({ synchronizeTabs: true })
      .catch((err) => {
        if (err.code == 'failed-precondition') {
          console.warn("Soporte multi-pestaña offline no disponible.");
        } else if (err.code == 'unimplemented') {
          console.warn("Este navegador no admite persistencia offline.");
        }
      });
      
    console.log("Firebase & Firestore Offline inicializados con éxito.");
  } else {
    setupModoLocalNoConfigured();
  }
} catch (e) {
  console.error("Firebase no se pudo conectar o inicializar:", e);
  setupModoLocalNoConfigured();
}

// Configura la UI para avisar que Firebase está en modo local
function setupModoLocalNoConfigured() {
  appFirebase = null;
  auth = null;
  db = null;
  console.log("Corriendo GEOmapas en Modo Local (Sincronización Cloud desactivada).");
  
  // Modificar el botón de cabecera de cuenta para avisar de forma nativa
  document.addEventListener("DOMContentLoaded", () => {
    const cloudBtn = document.getElementById('cloud-auth-btn');
    if (cloudBtn) {
      cloudBtn.classList.add('disabled-cloud');
      cloudBtn.title = "Sincronización inactiva. Configura Firebase en el código HTML de tu visor para activar esta función.";
      cloudBtn.querySelector('span').textContent = "Cuenta (Modo Local)";
      
      // Mostrar toast en lugar de abrir modal vacío
      cloudBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toast("Firebase sin configurar. Edita el HTML de tu visor y añade tu apiKey de Google Firebase.", "err");
      });
    }
  });
}

// ── Sincronización en la Nube con Firestore (Conforme a las reglas de rutas) ──
async function saveShpToCloud(layer) {
  if (!isFirebaseActive()) return;
  const user = auth.currentUser;
  if (!user) return;

  // RULE 1: Ruta exacta para datos de usuario privado
  const docRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layer.id}`);

  try {
    const serializedGeoJson = JSON.stringify(layer.geojson);
    // Firestore limita cada documento a ~1MB; si la capa es demasiado grande, marcamos como no sincronizada
    if (serializedGeoJson.length > 950000) {
      throw new Error('Capa demasiado grande para sincronizar en la nube');
    }
    const lblCfg = typeof layerLabels !== 'undefined' && layerLabels[layer.id]
      ? JSON.stringify({ fields: layerLabels[layer.id].fields, visible: layerLabels[layer.id].visible })
      : null;
    const cfCfg = JSON.stringify(getCustomFields(layer.id));
    await docRef.set({
      id: layer.id,
      name: layer.name,
      geojson: serializedGeoJson,
      color: layer.color,
      featureCount: layer.featureCount,
      ...(lblCfg ? { labels: lblCfg } : {}),
      customFields: cfCfg,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    layer.synced = true;
    updateLayerSyncIcon(layer);
    console.log(`Capa "${layer.name}" respaldada en la nube.`);
  } catch (error) {
    layer.synced = false;
    updateLayerSyncIcon(layer);
    console.error("Error al sincronizar con Firestore:", error);
    toast(`"${layer.name}": disponible sólo en local (no sincronizada)`, 'err');
  }
}

function updateLayerSyncIcon(layer) {
  const el = document.querySelector(`.list-item[data-id="${layer.id}"] .layer-cloud-off`);
  if (el) el.style.display = (layer.synced === false) ? 'flex' : 'none';
}

async function updateShpColorInCloud(layerId, color) {
  if (!isFirebaseActive()) return;
  const user = auth.currentUser;
  if (!user) return;
  const docRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layerId}`);
  try {
    await docRef.update({ color });
  } catch (_) {}
}

async function deleteShpFromCloud(layerId) {
  if (!isFirebaseActive()) return;
  const user = auth.currentUser;
  if (!user) return;
  const docRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layerId}`);
  try {
    await docRef.delete();
    console.log(`Capa eliminada del espacio Cloud.`);
  } catch (_) {}
}

// ── SISTEMA DE COMPARTIR CAPAS ──
let shareUnsubscribe = null;
let currentShareLayer = null;

// Registrar el correo del usuario actual para que otros puedan encontrarlo al compartir
async function registerUserEmail(user) {
  if (!isFirebaseActive() || !user || !user.email) return;
  try {
    await db.doc(`artifacts/${appId}/users_index/${user.email.toLowerCase()}`)
      .set({ uid: user.uid, email: user.email.toLowerCase() }, { merge: true });
  } catch (e) { console.warn('No se pudo registrar el índice de correo:', e); }
}

function openShareModal(layer) {
  if (!isFirebaseActive()) {
    toast('Inicia sesión para compartir capas', 'err');
    return;
  }
  currentShareLayer = layer;
  document.getElementById('shareSub').textContent = layer.name;
  document.getElementById('shareEmail').value = '';
  document.getElementById('shareCollabToggle').checked = false;
  document.getElementById('shareModal').classList.add('open');
  setTimeout(() => document.getElementById('shareEmail').focus(), 50);
}

async function sendShareRequest() {
  const layer = currentShareLayer;
  if (!layer) return;

  // Parsear múltiples emails separados por coma o punto y coma
  const rawInput = document.getElementById('shareEmail').value;
  const emails = rawInput.split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
  if (!emails.length) { toast('Introduce al menos un correo válido', 'err'); return; }

  const isCollab = document.getElementById('shareCollabToggle').checked;
  const user = auth.currentUser;
  const myEmail = user.email.toLowerCase();

  const selfIdx = emails.indexOf(myEmail);
  if (selfIdx !== -1) {
    toast('No puedes compartirte una capa a ti mismo', 'err'); return;
  }

  toast(`Buscando ${emails.length > 1 ? 'usuarios' : 'usuario'}…`);

  try {
    // Buscar todos los UIDs en paralelo
    const lookups = await Promise.all(emails.map(email =>
      db.doc(`artifacts/${appId}/users_index/${email}`).get()
        .then(snap => ({ email, exists: snap.exists, uid: snap.exists ? snap.data().uid : null }))
    ));

    const notFound = lookups.filter(r => !r.exists).map(r => r.email);
    if (notFound.length) {
      toast(`Usuario(s) no encontrado(s): ${notFound.join(', ')}`, 'err'); return;
    }

    const serialized = JSON.stringify(enrichGeojsonWithChecklist(layer.id, layer.geojson));
    if (serialized.length > 950000) {
      toast('La capa es demasiado grande para compartirla', 'err'); return;
    }

    // Si es colaborativo, actualizar el doc de la capa con los collaboratorUids
    if (isCollab) {
      const collabUids = lookups.map(r => r.uid);
      const ownerDocRef = db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${layer.id}`);
      // Fusionar con los collaborators ya existentes
      const currentSnap = await ownerDocRef.get();
      const existing = currentSnap.exists && currentSnap.data().collaborators ? currentSnap.data().collaborators : [];
      const merged = [...new Set([...existing, ...collabUids])];
      await ownerDocRef.update({ collaborators: merged, ownerEmail: myEmail });
    }

    // Enviar share_request a cada destinatario
    const batch = db.batch();
    const reqId = `share_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    lookups.forEach(({ uid }) => {
      const ref = db.doc(`artifacts/${appId}/users/${uid}/share_requests/${reqId}`);
      batch.set(ref, {
        id: reqId,
        fromUid: user.uid,
        fromEmail: user.email,
        layerId: layer.id,
        layerName: layer.name,
        color: layer.color,
        featureCount: layer.featureCount,
        geojson: serialized,
        isCollab: isCollab,
        ownerUid: user.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();

    document.getElementById('shareModal').classList.remove('open');
    const destStr = emails.length === 1 ? emails[0] : `${emails.length} usuarios`;
    toast(`Invitación enviada a ${destStr}${isCollab ? ' (colaborativa)' : ''}`, 'ok');
  } catch (e) {
    console.error(e);
    toast('Error al compartir: ' + e.message, 'err');
  }
}

function setupIncomingShareListener(user) {
  if (shareUnsubscribe) shareUnsubscribe();
  if (!db || !user) return;
  const colRef = db.collection(`artifacts/${appId}/users/${user.uid}/share_requests`);
  shareUnsubscribe = colRef.onSnapshot((snap) => {
    const list = document.getElementById('incomingList');
    const modal = document.getElementById('incomingModal');
    if (snap.empty) { modal.classList.remove('open'); list.innerHTML = ''; return; }
    list.innerHTML = '';
    snap.forEach(doc => {
      const r = doc.data();
      const div = document.createElement('div');
      div.className = 'incoming-item';
      div.innerHTML = `
        <div class="incoming-from">De: ${esc(r.fromEmail || '—')}</div>
        <div class="incoming-layer">${esc(r.layerName)} · ${r.featureCount || 0} recintos${r.isCollab ? ' · <b style="color:var(--blue)">Colaborativa</b>' : ''}</div>
        <div class="share-actions">
          <button class="share-btn danger" data-reject>Rechazar</button>
          <button class="share-btn primary" data-accept>Aceptar</button>
        </div>`;
      div.querySelector('[data-accept]').addEventListener('click', () => acceptShare(r, doc.id));
      div.querySelector('[data-reject]').addEventListener('click', () => rejectShare(doc.id));
      list.appendChild(div);
    });
    modal.classList.add('open');
  }, (err) => console.error('Error listener share_requests:', err));
}

// Listener de capas colaborativas recibidas (referencia al doc del propietario)
let collabUnsubscribes = [];
function setupCollabLayersListener(user) {
  collabUnsubscribes.forEach(u => u());
  collabUnsubscribes = [];
  if (!db || !user) return;

  // Buscar todas las capas donde este usuario es collaborator
  const collabRef = db.collectionGroup ? null : null; // collectionGroup puede no estar disponible
  // Alternativa: guardar refs en /users/{uid}/collab_refs/{layerId}
  const refCol = db.collection(`artifacts/${appId}/users/${user.uid}/collab_refs`);
  refCol.onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      const refData = change.doc.data();
      if (change.type === 'added') {
        const ownerUid = refData.ownerUid;
        const layerId  = refData.layerId;
        // Escuchar el doc de la capa del propietario en tiempo real
        const unsub = db.doc(`artifacts/${appId}/users/${ownerUid}/capas_vectoriales/${layerId}`)
          .onSnapshot(docSnap => {
            if (!docSnap.exists) return;
            const data = docSnap.data();
            // Sincronizar campos personalizados del propietario
            if (data.customFields) {
              try { setCustomFields(layerId, JSON.parse(data.customFields)); } catch(_) {}
            }
            // Sincronizar checklist_data en tiempo real
            if (data.checklist_data) {
              syncCollabChecklistToLocal(layerId, data.checklist_data);
            }
            // Añadir la capa si no existe aún
            if (!shpLayers.find(l => l.id === layerId)) {
              try {
                const geojson = JSON.parse(data.geojson);
                addShpLayer(geojson, data.name, layerId, false, false, data.color || null);
                const layer = shpLayers.find(l => l.id === layerId);
                if (layer) {
                  layer._isCollab = true;
                  layer._ownerUid = ownerUid;
                  setCollabActive(layerId);
                  // Añadir badge collab en la lista
                }
              } catch(e) { console.error('Error capa collab:', e); }
            }
          });
        collabUnsubscribes.push(unsub);
      } else if (change.type === 'removed') {
        // Capa eliminada de collab_refs → quitar del mapa
        const layerId = refData.layerId;
        const idx = shpLayers.findIndex(l => l.id === layerId);
        if (idx >= 0) {
          const l = shpLayers[idx];
          map.removeLayer(l.polyLayer);
          map.removeLayer(l.pinLayer);
          shpLayers.splice(idx, 1);
          document.querySelector(`.list-item[data-id="${layerId}"]`)?.remove();
        }
      }
    });
  });
}

// Vuelca el checklist_data de Firestore al localStorage local
function syncCollabChecklistToLocal(layerId, checklistData) {
  Object.entries(checklistData).forEach(([fIdx, data]) => {
    const key = `cl_${layerId}_${fIdx}`;
    try { localStorage.setItem(key, JSON.stringify(data)); } catch(_) {}
  });
  // Refrescar colores en el mapa
  const layer = shpLayers.find(l => l.id === layerId);
  if (layer && layer.leafletLayer && typeof layer.leafletLayer.setStyle === 'function') {
    layer.leafletLayer.setStyle({ color: layer.color });
  }
}

// Marca el botón compartir de una capa en verde cuando tiene modo colaborativo
function setCollabActive(layerId) {
  document.querySelectorAll(
    `.list-item[data-id="${layerId}"] .shp-share,
     .mob-layer-item[data-id="${layerId}"] .mob-layer-share`
  ).forEach(btn => btn.classList.add('collab-active'));
}

// Guardar checklist en Firestore cuando la capa es colaborativa
async function saveCollabChecklist(layerId, fIdx, data) {
  const layer = shpLayers.find(l => l.id === layerId);
  if (!layer) return;
  const ownerUid = layer._ownerUid || auth.currentUser?.uid;
  const docRef = db.doc(`artifacts/${appId}/users/${ownerUid}/capas_vectoriales/${layerId}`);
  try {
    await docRef.update({ [`checklist_data.${fIdx}`]: data });
  } catch(e) {
    console.warn('No se pudo guardar checklist collab:', e);
  }
}

async function acceptShare(req, reqId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    if (req.isCollab) {
      // Modo colaborativo: guardar referencia al doc del propietario
      const refDocId = `${req.ownerUid}_${req.layerId}`;
      await db.doc(`artifacts/${appId}/users/${user.uid}/collab_refs/${refDocId}`).set({
        ownerUid: req.ownerUid,
        layerId: req.layerId,
        layerName: req.layerName,
        fromEmail: req.fromEmail,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Modo normal: clonar la capa en las capas propias del usuario
      const newId = `shared_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      await db.doc(`artifacts/${appId}/users/${user.uid}/capas_vectoriales/${newId}`).set({
        id: newId,
        name: req.layerName + ' (compartida)',
        geojson: req.geojson,
        color: req.color || '#2f6fde',
        featureCount: req.featureCount || 0,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await db.doc(`artifacts/${appId}/users/${user.uid}/share_requests/${reqId}`).delete();
    toast(`Capa "${req.layerName}" añadida a tu proyecto`, 'ok');
  } catch (e) { toast('Error al aceptar: ' + e.message, 'err'); }
}

async function rejectShare(reqId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await db.doc(`artifacts/${appId}/users/${user.uid}/share_requests/${reqId}`).delete();
    toast('Invitación rechazada');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ═══════════════════════════════════════════════════════════════