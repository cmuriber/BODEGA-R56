// Bodega R-56 — Módulo 1: Dashboard — Service Worker
// Cachea el shell de la app para que abra sin internet. Los datos del
// dashboard se manejan aparte con IndexedDB (ver app.js).

const CACHE_NAME = 'r56-dashboard-v1';
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

  // Nunca cachear llamadas a la API de Apps Script: esas se manejan con
  // IndexedDB en app.js para lógica de "último dato bueno conocido".
  if (req.url.includes('script.google.com')) return;

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
