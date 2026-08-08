// Bodega R-56 — Módulo 1: Dashboard — Service Worker
// Cachea el shell de la app para que abra sin internet. Los datos del
// dashboard se manejan aparte con IndexedDB (ver app.js).

const CACHE_NAME = 'r56-dashboard-v2';
const SHELL_FILES = [
  './index.html',
  './app.js',
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
  // (mismo origen: index.html, app.js, manifest.json, icon.svg). Cualquier
  // llamada externa —Apps Script, su redirect a googleusercontent.com,
  // fuentes de Google, lo que sea— se deja pasar directo a la red sin
  // tocarla. Antes solo excluíamos 'script.google.com', pero el redirect
  // real ocurre hacia 'script.googleusercontent.com', y esa sí se estaba
  // quedando atrapada por el Service Worker — por eso fallaba con F5 normal
  // pero no con recarga forzada (que ignora al Service Worker por completo).
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
