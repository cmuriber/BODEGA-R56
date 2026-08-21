// Bodega R-56 — Módulo 1: Dashboard — Lógica de la app
//
// CONFIGURACIÓN: pega aquí la URL de tu Apps Script publicado como app web
// (Implementar > Nueva implementación > Aplicación web).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Mismo nombre de base de datos que usa app-manifiesto.js (Módulo 3) — así
// comparten la sesión entre pantallas: inicias sesión una vez y sirve en
// todas. DB_VERSION subió de 2 a 3 para agregar los stores del Módulo 3
// (manifiestosCache y pendientes) — ambos archivos declaran los mismos 4
// stores para que no importe cuál abra la base primero.
const DB_NAME = 'r56-dashboard';
const DB_VERSION = 3;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESION = 'sesion';
const STORE_MANIFIESTOS = 'manifiestosCache';
const STORE_PENDIENTES = 'pendientes';

// ---------- IndexedDB ----------

// Comparte la base IndexedDB con app-manifiesto.js (Módulo 3). Si se deja
// una pestaña vieja abierta con una versión anterior de la base, un
// intento de abrir una versión más nueva se queda "bloqueado" en silencio
// para siempre — por eso esta conexión se cierra sola cuando otra pestaña
// necesita subir de versión, y truena con un mensaje claro después de 6s
// en vez de quedarse colgada.
let dbPromise = null;

function abrirDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let resuelto = false;

    const timer = setTimeout(() => {
      if (!resuelto) {
        dbPromise = null;
        reject(new Error('No se pudo abrir la base de datos local (bloqueada por otra pestaña de la app). Cierra todas las demás pestañas/ventanas de Bodega R-56 y vuelve a intentar.'));
      }
    }, 6000);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'fecha' });
      }
      if (!db.objectStoreNames.contains(STORE_SESION)) {
        db.createObjectStore(STORE_SESION, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MANIFIESTOS)) {
        db.createObjectStore(STORE_MANIFIESTOS, { keyPath: 'fecha' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDIENTES)) {
        db.createObjectStore(STORE_PENDIENTES, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onblocked = () => {
      console.warn('Apertura de IndexedDB bloqueada por otra pestaña con una versión anterior abierta.');
    };
    req.onsuccess = () => {
      resuelto = true;
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      resuelto = true;
      clearTimeout(timer);
      dbPromise = null;
      reject(req.error);
    };
  });

  return dbPromise;
}

async function guardarSnapshot(data) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    tx.objectStore(STORE_SNAPSHOTS).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function leerUltimoSnapshot(fecha) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const req = tx.objectStore(STORE_SNAPSHOTS).get(fecha);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function guardarSesion(token, nombre, rol) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readwrite');
    tx.objectStore(STORE_SESION).put({ id: 'actual', token, nombre, rol });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function leerSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readonly');
    const req = tx.objectStore(STORE_SESION).get('actual');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function borrarSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readwrite');
    tx.objectStore(STORE_SESION).delete('actual');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Formato ----------

const fmtDinero = (n) => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtCajas = (n) => Math.round(n || 0).toLocaleString('es-MX');

function fechaHoyCDMX() {
  const f = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  return f; // yyyy-MM-dd
}

// ---------- Render del dashboard ----------

function pintarDashboard(data, { offline } = {}) {
  document.getElementById('fecha-label').textContent = formateaFechaLarga(data.fecha);
  document.getElementById('hero-cajas').textContent = fmtCajas(data.ventas.totalCajas);
  document.getElementById('hero-sub').textContent =
    `${data.ventas.numVentas} vale${data.ventas.numVentas === 1 ? '' : 's'} · ${fmtDinero(data.ventas.totalDinero)}`;

  document.getElementById('stat-contado').textContent = fmtDinero(data.ventas.contado);
  document.getElementById('stat-credito').textContent = fmtDinero(data.ventas.credito);
  document.getElementById('stat-cobranza').textContent = fmtDinero(data.cobranza.total);
  document.getElementById('stat-gastos').textContent = fmtDinero(data.gastos.total);
  document.getElementById('stat-efectivo').textContent = fmtDinero(data.efectivoEstimado);

  const lista = document.getElementById('manifiestos-lista');
  lista.innerHTML = '';
  if (data.manifiestos.abiertos.length === 0) {
    lista.innerHTML = '<li class="vacio">No hay camiones abiertos ahorita.</li>';
  } else {
    data.manifiestos.abiertos.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'ticket';
      li.innerHTML = `
        <span class="ticket-carro">Carro ${m.carro}</span>
        <span class="ticket-agricultor">${m.agricultor}</span>
      `;
      lista.appendChild(li);
    });
  }
  document.getElementById('manifiestos-count').textContent =
    `${data.manifiestos.llegaronHoy} camión${data.manifiestos.llegaronHoy === 1 ? '' : 'es'} hoy`;

  const sello = document.getElementById('sello');
  sello.textContent = offline ? 'SIN CONEXIÓN' : 'AL DÍA';
  sello.classList.toggle('sello--offline', !!offline);

  document.getElementById('actualizado').textContent = offline
    ? `Último dato guardado: ${horaCorta(data.generadoEn)}`
    : `Actualizado ${horaCorta(data.generadoEn)}`;
}

function formateaFechaLarga(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function horaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function mostrarError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}

// ---------- Llamada al backend vía JSONP ----------
//
// Apps Script, cuando se le llama con fetch() desde otro dominio (como
// GitHub Pages), hace un redirect interno que los navegadores bloquean por
// CORS. JSONP esquiva ese problema por completo: en vez de fetch(), se
// inserta una etiqueta <script> — las etiquetas <script> no están sujetas
// a la política de CORS.

let jsonpContador = 0;

function llamarJSONP(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    jsonpContador += 1;
    const callbackName = 'r56cb_' + Date.now() + '_' + jsonpContador;
    const script = document.createElement('script');
    let timer;

    function limpiar() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      limpiar();
      resolve(data);
    };

    script.onerror = () => {
      limpiar();
      reject(new Error('No se pudo contactar al servidor (sin internet o URL incorrecta).'));
    };

    timer = setTimeout(() => {
      limpiar();
      reject(new Error('El servidor tardó demasiado en responder.'));
    }, timeoutMs);

    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

// ---------- Sesión / Login ----------
//
// Sin token válido, el backend no entrega ningún dato (ver Code.gs). Aquí
// solo manejamos: mostrar login, guardar el token que nos regresa el
// backend al autenticarnos, y mandarlo en cada consulta.

let tokenActual = null;
let usuarioNombre = null;
let temporizadorRefresco = null;

function mostrarLogin() {
  document.getElementById('login-view').hidden = false;
  document.getElementById('dashboard-view').hidden = true;
  if (temporizadorRefresco) clearInterval(temporizadorRefresco);
}

function mostrarDashboard() {
  document.getElementById('login-view').hidden = true;
  document.getElementById('dashboard-view').hidden = false;
}

async function iniciarSesionConToken(token, nombre) {
  tokenActual = token;
  usuarioNombre = nombre || usuarioNombre;
  mostrarDashboard();
  const usuarioChip = document.getElementById('usuario-chip');
  if (usuarioChip) usuarioChip.textContent = usuarioNombre || '';
  await cargarDashboard();

  if (temporizadorRefresco) clearInterval(temporizadorRefresco);
  // Refresca solo cada 20 segundos en automático — se siente casi en
  // tiempo real sin exagerar las llamadas al backend.
  temporizadorRefresco = setInterval(cargarDashboard, 20000);
}

document.getElementById('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const boton = document.getElementById('login-submit');
  const errorBox = document.getElementById('login-error');

  errorBox.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Entrando...';

  try {
    const url = `${APPS_SCRIPT_URL}?action=login&usuario=${encodeURIComponent(usuario)}&password=${encodeURIComponent(password)}`;
    const data = await llamarJSONP(url);

    if (!data.ok) {
      errorBox.textContent = data.error || 'No se pudo iniciar sesión.';
      return;
    }

    await guardarSesion(data.token, data.nombre, data.rol);
    await iniciarSesionConToken(data.token, data.nombre);
  } catch (err) {
    errorBox.textContent = 'Sin conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});

// ---------- Carga principal del dashboard ----------

async function cargarDashboard() {
  const fecha = fechaHoyCDMX();

  if (APPS_SCRIPT_URL.includes('PEGA_AQUI')) {
    mostrarError('Falta configurar la URL de Apps Script en app.js (APPS_SCRIPT_URL).');
    return;
  }

  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=dashboard&fecha=${fecha}&token=${encodeURIComponent(tokenActual)}`);

    if (data.error === 'no_autorizado') {
      // La sesión ya no es válida (expiró o se borró) — regresamos al login.
      await borrarSesion();
      tokenActual = null;
      mostrarLogin();
      return;
    }
    if (data.error) throw new Error(data.error);

    await guardarSnapshot(data);
    pintarDashboard(data, { offline: false });
    document.getElementById('error-box').hidden = true;
  } catch (err) {
    const previo = await leerUltimoSnapshot(fecha).catch(() => null);
    if (previo) {
      pintarDashboard(previo, { offline: true });
    } else {
      mostrarError('Sin internet y sin datos guardados todavía para hoy.');
    }
  }
}

document.getElementById('refrescar').addEventListener('click', () => {
  document.getElementById('refrescar').classList.add('girando');
  cargarDashboard().finally(() => {
    setTimeout(() => document.getElementById('refrescar').classList.remove('girando'), 400);
  });
});

// Refresca al instante cada vez que la pantalla vuelve a estar visible
// (ej. el usuario cambió de app o de pestaña y regresa) — así no hay que
// esperar al temporizador si alguien acaba de registrar algo en otra
// pantalla y regresa al Dashboard a revisar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenActual) {
    cargarDashboard();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Arranque ----------
// Si ya había una sesión guardada en este dispositivo, entra directo al
// Dashboard. Si no, muestra el login.
(async function arrancar() {
  const sesion = await leerSesion().catch(() => null);
  if (sesion && sesion.token) {
    await iniciarSesionConToken(sesion.token, sesion.nombre);
  } else {
    mostrarLogin();
  }
})();
