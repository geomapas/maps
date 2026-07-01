const CACHE = 'geomapas-v6';

const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/styles.css',
  './js/config.js',
  './js/mapa.js',
  './js/capas-sigpac.js',
  './js/fotos.js',
  './js/sidebar.js',
  './js/consulta-wms.js',
  './js/capas-shp.js',
  './js/shp-writer.js',
  './js/txt-import.js',
  './js/draw.js',
  './js/firebase.js',
  './js/movil.js',
  './js/gps-desktop.js',
  './js/ui.js',
  './js/seleccion.js',
  './js/checklist.js',
  './js/mapa3d.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Siempre desde red: tiles, WMS, Firebase, CDNs externos
  if (
    url.includes('tile') || url.includes('wms') || url.includes('WMS') ||
    url.includes('arcgis') || url.includes('googleapis') || url.includes('gstatic') ||
    url.includes('firestore') || url.includes('firebase') ||
    url.includes('cdnjs') || url.includes('unpkg') || url.includes('jsdelivr') ||
    url.includes('gstatic')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // App shell y módulos JS: cache-first, fallback a red
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(response => {
      // Cachear dinámicamente archivos locales no precacheados
      if (response.ok && e.request.url.startsWith(self.location.origin)) {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return response;
    }))
  );
});
