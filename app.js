// Bodega R-56 — Módulo 1: Dashboard — Lógica de la app
//
// CONFIGURACIÓN: pega aquí la URL de tu Apps Script publicado como app web
// (Implementar > Nueva implementación > Aplicación web).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwdpmSS7W5BC6wVRyLu6-NUbSoYYe33TjiTSw7I0rEZluyc7IvD1jyreRLr4m-JKZ-KJw/exec';

const DB_NAME = 'r56-dashboard';
const STORE_NAME = 'snapshots';

// ---------- IndexedDB: guarda el último dashboard bueno conocido ----------

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'fecha' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guardarSnapshot(data) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function leerUltimoSnapshot(fecha) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(fecha);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Formato ----------

const fmtDinero = (n) => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtCajas = (n) => Math.round(n || 0).toLocaleString('es-MX');

function fechaHoyCDMX() {
  const f = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  return f; // yyyy-MM-dd
}

// ---------- Render ----------

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

// ---------- Carga principal ----------

async function cargarDashboard() {
  const fecha = fechaHoyCDMX();

  if (APPS_SCRIPT_URL.includes('PEGA_AQUI')) {
    mostrarError('Falta configurar la URL de Apps Script en app.js (APPS_SCRIPT_URL).');
    const previo = await leerUltimoSnapshot(fecha).catch(() => null);
    if (previo) pintarDashboard(previo, { offline: true });
    return;
  }

  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=dashboard&fecha=${fecha}`);
    if (!res.ok) throw new Error('Respuesta no válida del servidor');
    const data = await res.json();
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

cargarDashboard();
setInterval(cargarDashboard, 60000);
