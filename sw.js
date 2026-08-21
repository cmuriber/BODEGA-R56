// Bodega R-56 — Service Worker
// Cachea el shell de la app (Dashboard + Manifiesto de Carro + Vale) para
// que abra sin internet. Los datos se manejan aparte con IndexedDB (ver
// app.js, app-manifiesto.js y app-vale.js).

const CACHE_NAME = 'r56-dashboard-v9';
const SHELL_FILES = [
  './index.html',
  './app.js',
  './manifiesto.html',
  './app-manifiesto.js',
  './vale.html',
  './app-vale.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos peticiones a los archivos propios de esta PWA
  // (mismo origen). Cualquier llamada externa —Apps Script, su redirect a
  // googleusercontent.com, fuentes de Google, lo que sea— se deja pasar
  // directo a la red sin tocarla.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      }).catch(() => cached);
    })
  );
});
