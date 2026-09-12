// Bodega R-56 — Service Worker
// Cachea el shell de la app (Dashboard + Manifiesto de Carro + Vale +
// Créditos/Pagos) para que abra sin internet. Los datos se manejan aparte
// con IndexedDB (ver app.js, app-manifiesto.js, app-vale.js y
// app-creditos.js).

const CACHE_NAME = 'r56-dashboard-v47';
const SHELL_FILES = [
  './index.html',
  './app.js',
  './manifiesto.html',
  './app-manifiesto.js',
  './vale.html',
  './app-vale.js',
  './creditos.html',
  './app-creditos.js',
  './cuentas.html',
  './app-cuentas.js',
  './pagos.html',
  './app-pagos.js',
  './facturacion.html',
  './app-facturacion.js',
  './reportes.html',
  './app-reportes.js',
  './manifest.json',
  './icon.svg'
];

// OJO — bug real que causaba que después de actualizar, unas pantallas se
// vieran con el diseño nuevo y otras con el viejo (según cuál se hubiera
// recargado con Ctrl+Shift+R): cache.addAll() pedía cada archivo con el
// caching normal del navegador, así que si el HTML de una página ya
// estaba en el caché HTTP del navegador (no el nuestro, el de Chrome), el
// Service Worker guardaba esa copia vieja dentro del cache NUEVO sin
// darse cuenta. O sea: aunque subiéramos la versión, algunas páginas
// quedaban "congeladas" en la versión de antes. Por eso cada archivo del
// shell se pide ahora con { cache: 'reload' } — eso obliga a ir siempre a
// la red de verdad, nunca al caché HTTP del navegador, para que el
// contenido que guardamos SIEMPRE sea el más nuevo.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_FILES.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))
      ))
    )
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
