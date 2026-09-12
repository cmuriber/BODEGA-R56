// Bodega R-56 — Módulo Reporte de Ventas — Lógica de la app
//
// Comparte sesión (login) e IndexedDB con los demás módulos — un solo
// inicio de sesión sirve en toda la app. Pantalla propia con 5 vistas:
// Ventas del día (default), Rango de fechas, Por proveedor + rango, Por
// camión (cualquier fecha) y Top clientes. Usa acciones ya existentes
// (ventas_dia, manifiestos_buscar, agricultores_con_carros) más la acción
// nueva reporte_ventas (líneas de "Ventas" filtradas por fecha/proveedor/
// camión, sin agrupar — cada vista agrupa/suma lo que necesita).
//
// Regla de edición (confirmada por Mauricio, 2026-09-11): un vale de HOY lo
// edita cualquier usuario con sesión, igual que siempre desde Vale. Un vale
// de un día anterior solo lo puede editar un administrador — el backend
// (accionVentaGuardar) ya lo exige de todos modos, esto aquí solo evita
// ofrecer el botón "Editar" cuando de entrada no va a dejar guardar.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Misma base de datos que los demás módulos — mismos 4 stores, misma versión.
const DB_NAME = 'r56-dashboard';
const DB_VERSION = 3;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESION = 'sesion';
const STORE_MANIFIESTOS = 'manifiestosCache';
const STORE_PENDIENTES = 'pendientes';

// ---------- IndexedDB (idéntico a los demás módulos) ----------

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

async function leerSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readonly');
    const req = tx.objectStore(STORE_SESION).get('actual');
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
async function borrarSesion() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESION, 'readwrite');
    tx.objectStore(STORE_SESION).delete('actual');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- JSONP (idéntico a los otros módulos) ----------

let jsonpContador = 0;
function llamarJSONP(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    jsonpContador += 1;
    const callbackName = 'r56cb_' + Date.now() + '_' + jsonpContador;
    const script = document.createElement('script');
    let timer;
    function limpiar() { clearTimeout(timer); delete window[callbackName]; script.remove(); }
    window[callbackName] = (data) => { limpiar(); resolve(data); };
    script.onerror = () => { limpiar(); reject(new Error('No se pudo contactar al servidor (sin internet o URL incorrecta).')); };
    timer = setTimeout(() => { limpiar(); reject(new Error('El servidor tardó demasiado en responder.')); }, timeoutMs);
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

// ---------- Formato ----------

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('es-MX');
function fechaCorta(f) {
  if (!f) return '—';
  const partes = String(f).split('-');
  if (partes.length !== 3) return f;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}
function fechaHoyCDMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function folioStr(n) { return '#' + String(n).padStart(5, '0'); }

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let agricultoresCatalogo = []; // acción "agricultores_con_carros"
let camionSeleccionado = null; // { id, carro, agricultor, fecha } — de "Por camión"

// ---------- Sesión / Login (idéntico patrón a los demás módulos) ----------

function mostrarLogin() {
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
}
function mostrarApp() {
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
}
async function volverALogin() {
  await borrarSesion();
  tokenActual = null;
  mostrarLogin();
}

async function iniciarSesionConToken(token, rol, nombre) {
  tokenActual = token;
  usuarioRol = rol;
  usuarioNombre = nombre;
  mostrarApp();
  document.getElementById('admin-chip').hidden = usuarioRol !== 'admin';
  const usuarioChip = document.getElementById('usuario-chip');
  if (usuarioChip) usuarioChip.textContent = usuarioNombre || '';

  const hoy = fechaHoyCDMX();
  document.getElementById('dia-fecha').value = hoy;
  document.getElementById('rango-desde').value = hoy;
  document.getElementById('rango-hasta').value = hoy;
  document.getElementById('proveedor-desde').value = hoy;
  document.getElementById('proveedor-hasta').value = hoy;
  document.getElementById('clientes-desde').value = hoy;
  document.getElementById('clientes-hasta').value = hoy;

  cargarAgricultores();
  cargarVentasDia(hoy);
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
    if (!data.ok) { errorBox.textContent = data.error || 'No se pudo iniciar sesión.'; return; }
    await guardarSesion(data.token, data.nombre, data.rol);
    await iniciarSesionConToken(data.token, data.rol, data.nombre);
  } catch (err) {
    errorBox.textContent = 'Sin conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await borrarSesion();
  tokenActual = null;
  mostrarLogin();
});

function mostrarError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}
function mostrarToast(msg, tipo) {
  const el = document.getElementById('toast');
  el.textContent = (tipo === 'ok' ? '✓ ' : tipo === 'error' ? '✕ ' : tipo === 'warn' ? '⚠ ' : 'ℹ ') + msg;
  el.className = tipo === 'error' ? 'toast--error' : (tipo === 'ok' ? '' : 'toast--pendiente');
  el.hidden = false;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

// ---------- Editar un vale desde cualquier reporte ----------
// Un vale de HOY lo puede editar cualquiera; uno de un día anterior solo un
// admin — el backend lo exige de todos modos (defensa real), esto solo
// decide si se muestra o no el botón para no llevar a un callejón sin
// salida.
function puedeEditar(fecha) {
  return fecha === fechaHoyCDMX() || usuarioRol === 'admin';
}
function botonEditarHtml(folio, fecha) {
  if (!puedeEditar(fecha)) return '';
  return `<button class="fila-editar-btn" data-editar-folio="${folio}" type="button">✏️ Editar</button>`;
}
function irAEditarFolio(folio) {
  location.href = './vale.html?folio=' + encodeURIComponent(folio);
}

// ---------- Exportar CSV (Excel lo abre directo) ----------

function exportarCSV(nombreArchivo, encabezados, filas) {
  const escapar = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [encabezados.map(escapar).join(',')]
    .concat(filas.map(fila => fila.map(escapar).join(',')));
  // BOM al inicio para que Excel detecte UTF-8 y no arruine acentos/eñes.
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Tabs ----------

document.querySelectorAll('.reportes-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reportes-tab').forEach(b => b.classList.remove('activo'));
    document.querySelectorAll('.reportes-panel').forEach(p => { p.hidden = true; });
    btn.classList.add('activo');
    document.getElementById('panel-' + btn.dataset.tab).hidden = false;
  });
});

// ---------- Catálogo de proveedores (para el autocompletar) ----------

async function cargarAgricultores() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=agricultores_con_carros&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) agricultoresCatalogo = data.agricultores || [];
  } catch (err) { /* el autocompletar simplemente queda vacío sin conexión */ }
}

const proveedorInput = document.getElementById('proveedor-input');
const proveedorSug = document.getElementById('proveedor-suggerencias');
proveedorInput.addEventListener('input', () => {
  const q = proveedorInput.value.trim().toUpperCase();
  if (!q) { proveedorSug.classList.remove('show'); return; }
  const opciones = agricultoresCatalogo.filter(n => n.toUpperCase().includes(q)).slice(0, 8);
  if (opciones.length === 0) { proveedorSug.classList.remove('show'); return; }
  proveedorSug.innerHTML = opciones.map(n => `<div class="opt" data-name="${n}">${n}</div>`).join('');
  proveedorSug.classList.add('show');
});
proveedorInput.addEventListener('blur', () => setTimeout(() => proveedorSug.classList.remove('show'), 150));
proveedorSug.addEventListener('mousedown', (e) => {
  const name = e.target.closest('.opt')?.dataset.name;
  if (name) { proveedorInput.value = name; proveedorSug.classList.remove('show'); }
});

// ================= Ventas del día =================

document.getElementById('dia-fecha').addEventListener('change', (e) => cargarVentasDia(e.target.value || fechaHoyCDMX()));
document.getElementById('dia-hoy-btn').addEventListener('click', () => {
  const hoy = fechaHoyCDMX();
  document.getElementById('dia-fecha').value = hoy;
  cargarVentasDia(hoy);
});

let diaVentasActuales = [];
let diaFechaActual = '';

async function cargarVentasDia(fecha) {
  diaFechaActual = fecha;
  document.getElementById('dia-lista').innerHTML = '<tr><td colspan="5" class="reportes-vacio">Cargando…</td></tr>';
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=ventas_dia&token=${encodeURIComponent(tokenActual)}&fecha=${encodeURIComponent(fecha)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar la venta del día.', 'error'); diaVentasActuales = []; }
    else diaVentasActuales = data.ventas || [];
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar la venta del día.', 'warn');
    diaVentasActuales = [];
  }
  renderVentasDia();
}

function renderVentasDia() {
  const cont = document.getElementById('dia-lista');
  const resumen = document.getElementById('dia-resumen');
  if (diaVentasActuales.length === 0) {
    cont.innerHTML = '<tr><td colspan="5" class="reportes-vacio">No hay ventas guardadas para esta fecha.</td></tr>';
    resumen.innerHTML = '';
    return;
  }
  const total = diaVentasActuales.reduce((a, v) => a + v.total, 0);
  resumen.innerHTML = `
    <div class="stat"><span class="k">Vales</span><span class="v">${diaVentasActuales.length}</span></div>
    <div class="stat"><span class="k">Total del día</span><span class="v">$${fmt(total)}</span></div>
  `;
  cont.innerHTML = diaVentasActuales.map(v => `
    <tr>
      <td>${folioStr(v.folio)}</td>
      <td>${v.cliente}</td>
      <td><span class="badge-forma ${v.tipo === 'CRÉDITO' ? 'credito' : 'efectivo'}">${v.tipo}</span></td>
      <td class="num">$${fmt(v.total)}</td>
      <td>${botonEditarHtml(v.folio, diaFechaActual)}</td>
    </tr>
  `).join('');
}

document.getElementById('dia-exportar').addEventListener('click', () => {
  if (diaVentasActuales.length === 0) { mostrarToast('No hay nada que exportar.', 'warn'); return; }
  exportarCSV(`ventas_${diaFechaActual}.csv`, ['Folio', 'Cliente', 'Tipo', 'Total'],
    diaVentasActuales.map(v => [folioStr(v.folio), v.cliente, v.tipo, v.total]));
});

// ================= Rango de fechas =================

let rangoFilasActuales = [];

document.getElementById('rango-buscar').addEventListener('click', async () => {
  const desde = document.getElementById('rango-desde').value;
  const hasta = document.getElementById('rango-hasta').value;
  if (!desde || !hasta) { mostrarToast('Elige fecha de inicio y de fin.', 'warn'); return; }
  if (desde > hasta) { mostrarToast('La fecha "desde" no puede ser después de "hasta".', 'warn'); return; }

  const boton = document.getElementById('rango-buscar');
  boton.disabled = true; boton.textContent = 'Buscando…';
  document.getElementById('rango-lista').innerHTML = '<tr><td colspan="6" class="reportes-vacio">Cargando…</td></tr>';
  try {
    const url = `${APPS_SCRIPT_URL}?action=reporte_ventas&token=${encodeURIComponent(tokenActual)}&desde=${desde}&hasta=${hasta}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el reporte.', 'error'); rangoFilasActuales = []; }
    else rangoFilasActuales = agruparPorFolio(data.lineas || []);
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el reporte.', 'warn');
    rangoFilasActuales = [];
  } finally {
    boton.disabled = false; boton.textContent = 'Buscar';
  }
  renderRango();
});

function agruparPorFolio(lineas) {
  const porFolio = {};
  lineas.forEach(l => {
    if (!porFolio[l.folio]) porFolio[l.folio] = { folio: l.folio, fecha: l.fecha, cliente: l.cliente, tipo: l.tipo, total: 0, cajas: 0 };
    porFolio[l.folio].total += l.total;
    porFolio[l.folio].cajas += l.cajas;
  });
  return Object.values(porFolio).sort((a, b) => a.fecha === b.fecha ? a.folio - b.folio : a.fecha.localeCompare(b.fecha));
}

function renderRango() {
  const cont = document.getElementById('rango-lista');
  const resumen = document.getElementById('rango-resumen');
  if (rangoFilasActuales.length === 0) {
    cont.innerHTML = '<tr><td colspan="6" class="reportes-vacio">No hay ventas en ese rango de fechas.</td></tr>';
    resumen.hidden = true;
    return;
  }
  const total = rangoFilasActuales.reduce((a, v) => a + v.total, 0);
  const cajas = rangoFilasActuales.reduce((a, v) => a + v.cajas, 0);
  resumen.hidden = false;
  resumen.innerHTML = `
    <div class="stat"><span class="k">Vales</span><span class="v">${rangoFilasActuales.length}</span></div>
    <div class="stat"><span class="k">Cajas</span><span class="v">${fmt(cajas)}</span></div>
    <div class="stat"><span class="k">Total</span><span class="v">$${fmt(total)}</span></div>
  `;
  cont.innerHTML = rangoFilasActuales.map(v => `
    <tr>
      <td>${folioStr(v.folio)}</td>
      <td>${fechaCorta(v.fecha)}</td>
      <td>${v.cliente}</td>
      <td><span class="badge-forma ${v.tipo === 'CRÉDITO' ? 'credito' : 'efectivo'}">${v.tipo}</span></td>
      <td class="num">$${fmt(v.total)}</td>
      <td>${botonEditarHtml(v.folio, v.fecha)}</td>
    </tr>
  `).join('');
}

document.getElementById('rango-exportar').addEventListener('click', () => {
  if (rangoFilasActuales.length === 0) { mostrarToast('No hay nada que exportar.', 'warn'); return; }
  const desde = document.getElementById('rango-desde').value;
  const hasta = document.getElementById('rango-hasta').value;
  exportarCSV(`ventas_${desde}_a_${hasta}.csv`, ['Folio', 'Fecha', 'Cliente', 'Tipo', 'Total'],
    rangoFilasActuales.map(v => [folioStr(v.folio), v.fecha, v.cliente, v.tipo, v.total]));
});

// ================= Por proveedor y rango de fechas =================

let proveedorLineasActuales = [];

document.getElementById('proveedor-buscar').addEventListener('click', async () => {
  const agricultor = proveedorInput.value.trim();
  const desde = document.getElementById('proveedor-desde').value;
  const hasta = document.getElementById('proveedor-hasta').value;
  if (!agricultor) { mostrarToast('Escribe o elige un proveedor.', 'warn'); return; }
  if (!desde || !hasta) { mostrarToast('Elige fecha de inicio y de fin.', 'warn'); return; }
  if (desde > hasta) { mostrarToast('La fecha "desde" no puede ser después de "hasta".', 'warn'); return; }

  const boton = document.getElementById('proveedor-buscar');
  boton.disabled = true; boton.textContent = 'Buscando…';
  document.getElementById('proveedor-lista').innerHTML = '<tr><td colspan="8" class="reportes-vacio">Cargando…</td></tr>';
  try {
    const url = `${APPS_SCRIPT_URL}?action=reporte_ventas&token=${encodeURIComponent(tokenActual)}&agricultor=${encodeURIComponent(agricultor)}&desde=${desde}&hasta=${hasta}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el reporte.', 'error'); proveedorLineasActuales = []; }
    else proveedorLineasActuales = data.lineas || [];
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el reporte.', 'warn');
    proveedorLineasActuales = [];
  } finally {
    boton.disabled = false; boton.textContent = 'Buscar';
  }
  renderProveedor();
});

function renderProveedor() {
  const cont = document.getElementById('proveedor-lista');
  const resumen = document.getElementById('proveedor-resumen');
  if (proveedorLineasActuales.length === 0) {
    cont.innerHTML = '<tr><td colspan="8" class="reportes-vacio">Ese proveedor no tiene ventas en ese rango de fechas.</td></tr>';
    resumen.hidden = true;
    return;
  }
  const total = proveedorLineasActuales.reduce((a, l) => a + l.total, 0);
  const cajas = proveedorLineasActuales.reduce((a, l) => a + l.cajas, 0);
  resumen.hidden = false;
  resumen.innerHTML = `
    <div class="stat"><span class="k">Partidas</span><span class="v">${proveedorLineasActuales.length}</span></div>
    <div class="stat"><span class="k">Cajas</span><span class="v">${fmt(cajas)}</span></div>
    <div class="stat"><span class="k">Total</span><span class="v">$${fmt(total)}</span></div>
  `;
  cont.innerHTML = proveedorLineasActuales.map(l => `
    <tr>
      <td>${fechaCorta(l.fecha)}</td>
      <td>${folioStr(l.folio)}</td>
      <td>${l.cliente}</td>
      <td>${l.carro || '—'}</td>
      <td>${l.tamano}</td>
      <td class="num">${fmt(l.cajas)}</td>
      <td class="num">$${fmt(l.precio)}</td>
      <td class="num">$${fmt(l.total)}</td>
    </tr>
  `).join('');
}

document.getElementById('proveedor-exportar').addEventListener('click', () => {
  if (proveedorLineasActuales.length === 0) { mostrarToast('No hay nada que exportar.', 'warn'); return; }
  const agricultor = proveedorInput.value.trim() || 'proveedor';
  exportarCSV(`ventas_${agricultor}.csv`, ['Fecha', 'Folio', 'Cliente', 'Carro', 'Tamaño', 'Cajas', 'Precio', 'Total'],
    proveedorLineasActuales.map(l => [l.fecha, folioStr(l.folio), l.cliente, l.carro, l.tamano, l.cajas, l.precio, l.total]));
});

// ================= Por camión y agricultor (cualquier fecha) =================

const camionInput = document.getElementById('camion-input');
let camionBuscarTimer = null;
camionInput.addEventListener('input', () => {
  clearTimeout(camionBuscarTimer);
  const q = camionInput.value.trim();
  if (q.length < 2) { document.getElementById('camion-resultados').innerHTML = ''; return; }
  camionBuscarTimer = setTimeout(() => buscarCamiones(q), 300);
});

async function buscarCamiones(q) {
  const cont = document.getElementById('camion-resultados');
  cont.innerHTML = '<div class="reportes-vacio">Buscando…</div>';
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=manifiestos_buscar&token=${encodeURIComponent(tokenActual)}&q=${encodeURIComponent(q)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok || (data.manifiestos || []).length === 0) { cont.innerHTML = '<div class="reportes-vacio">Sin resultados.</div>'; return; }
    cont.innerHTML = data.manifiestos.slice(0, 15).map(m => `
      <div class="camion-opt" data-manifiesto-id="${m.id}" data-carro="${m.carro}" data-agricultor="${m.agricultor}" data-fecha="${m.fecha}">
        <div><div class="carro">Carro ${m.carro} · ${m.agricultor}</div><div class="meta">${fechaCorta(m.fecha)} · ${m.estado}</div></div>
        <div class="meta">${fmt(m.cajasVendidas)}/${fmt(m.cajasTotales)} cajas</div>
      </div>
    `).join('');
  } catch (err) {
    cont.innerHTML = '<div class="reportes-vacio">Sin conexión — no se pudo buscar.</div>';
  }
}

document.getElementById('camion-resultados').addEventListener('click', (e) => {
  const opt = e.target.closest('[data-manifiesto-id]');
  if (!opt) return;
  document.querySelectorAll('#camion-resultados .camion-opt').forEach(o => o.classList.remove('activo'));
  opt.classList.add('activo');
  camionSeleccionado = { id: opt.dataset.manifiestoId, carro: opt.dataset.carro, agricultor: opt.dataset.agricultor, fecha: opt.dataset.fecha };
  cargarVentasCamion();
});

let camionLineasActuales = [];

async function cargarVentasCamion() {
  if (!camionSeleccionado) return;
  document.getElementById('camion-lista').innerHTML = '<tr><td colspan="7" class="reportes-vacio">Cargando…</td></tr>';
  try {
    const url = `${APPS_SCRIPT_URL}?action=reporte_ventas&token=${encodeURIComponent(tokenActual)}&manifiestoId=${encodeURIComponent(camionSeleccionado.id)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el reporte.', 'error'); camionLineasActuales = []; }
    else camionLineasActuales = data.lineas || [];
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el reporte.', 'warn');
    camionLineasActuales = [];
  }
  renderCamion();
}

function renderCamion() {
  const cont = document.getElementById('camion-lista');
  const resumen = document.getElementById('camion-resumen');
  const btnExportar = document.getElementById('camion-exportar');
  if (camionLineasActuales.length === 0) {
    cont.innerHTML = '<tr><td colspan="7" class="reportes-vacio">Ese camión todavía no tiene ventas registradas.</td></tr>';
    resumen.hidden = true;
    btnExportar.hidden = true;
    return;
  }
  const total = camionLineasActuales.reduce((a, l) => a + l.total, 0);
  const cajas = camionLineasActuales.reduce((a, l) => a + l.cajas, 0);
  resumen.hidden = false;
  btnExportar.hidden = false;
  resumen.innerHTML = `
    <div class="stat"><span class="k">Partidas</span><span class="v">${camionLineasActuales.length}</span></div>
    <div class="stat"><span class="k">Cajas vendidas</span><span class="v">${fmt(cajas)}</span></div>
    <div class="stat"><span class="k">Total</span><span class="v">$${fmt(total)}</span></div>
  `;
  cont.innerHTML = camionLineasActuales.map(l => `
    <tr>
      <td>${fechaCorta(l.fecha)}</td>
      <td>${folioStr(l.folio)}</td>
      <td>${l.cliente}</td>
      <td>${l.tamano}</td>
      <td class="num">${fmt(l.cajas)}</td>
      <td class="num">$${fmt(l.precio)}</td>
      <td class="num">$${fmt(l.total)}</td>
    </tr>
  `).join('');
}

document.getElementById('camion-exportar').addEventListener('click', () => {
  if (camionLineasActuales.length === 0) { mostrarToast('No hay nada que exportar.', 'warn'); return; }
  const nombre = camionSeleccionado ? `ventas_carro_${camionSeleccionado.carro}.csv` : 'ventas_camion.csv';
  exportarCSV(nombre, ['Fecha', 'Folio', 'Cliente', 'Tamaño', 'Cajas', 'Precio', 'Total'],
    camionLineasActuales.map(l => [l.fecha, folioStr(l.folio), l.cliente, l.tamano, l.cajas, l.precio, l.total]));
});

// ================= Top clientes =================
// No incluye "PÚBLICO GENERAL" a propósito — es la bolsa de ventas de
// mostrador sin cliente identificado, no un cliente real que rankear.

let clientesRankingActual = [];

document.getElementById('clientes-buscar').addEventListener('click', async () => {
  const desde = document.getElementById('clientes-desde').value;
  const hasta = document.getElementById('clientes-hasta').value;
  if (!desde || !hasta) { mostrarToast('Elige fecha de inicio y de fin.', 'warn'); return; }
  if (desde > hasta) { mostrarToast('La fecha "desde" no puede ser después de "hasta".', 'warn'); return; }

  const boton = document.getElementById('clientes-buscar');
  boton.disabled = true; boton.textContent = 'Buscando…';
  document.getElementById('clientes-lista').innerHTML = '<tr><td colspan="5" class="reportes-vacio">Cargando…</td></tr>';
  try {
    const url = `${APPS_SCRIPT_URL}?action=reporte_ventas&token=${encodeURIComponent(tokenActual)}&desde=${desde}&hasta=${hasta}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el reporte.', 'error'); clientesRankingActual = []; }
    else clientesRankingActual = rankingClientes(data.lineas || []);
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el reporte.', 'warn');
    clientesRankingActual = [];
  } finally {
    boton.disabled = false; boton.textContent = 'Buscar';
  }
  renderClientes();
});

function rankingClientes(lineas) {
  const porCliente = {};
  lineas.forEach(l => {
    if (String(l.cliente || '').toUpperCase() === 'PÚBLICO GENERAL') return;
    if (!porCliente[l.cliente]) porCliente[l.cliente] = { cliente: l.cliente, folios: new Set(), cajas: 0, total: 0 };
    porCliente[l.cliente].folios.add(l.folio);
    porCliente[l.cliente].cajas += l.cajas;
    porCliente[l.cliente].total += l.total;
  });
  return Object.values(porCliente)
    .map(c => ({ cliente: c.cliente, vales: c.folios.size, cajas: c.cajas, total: c.total }))
    .sort((a, b) => b.total - a.total);
}

function renderClientes() {
  const cont = document.getElementById('clientes-lista');
  if (clientesRankingActual.length === 0) {
    cont.innerHTML = '<tr><td colspan="5" class="reportes-vacio">No hay ventas a clientes (con nombre) en ese rango.</td></tr>';
    return;
  }
  cont.innerHTML = clientesRankingActual.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${c.cliente}</td>
      <td class="num">${c.vales}</td>
      <td class="num">${fmt(c.cajas)}</td>
      <td class="num">$${fmt(c.total)}</td>
    </tr>
  `).join('');
}

document.getElementById('clientes-exportar').addEventListener('click', () => {
  if (clientesRankingActual.length === 0) { mostrarToast('No hay nada que exportar.', 'warn'); return; }
  const desde = document.getElementById('clientes-desde').value;
  const hasta = document.getElementById('clientes-hasta').value;
  exportarCSV(`top_clientes_${desde}_a_${hasta}.csv`, ['#', 'Cliente', 'Vales', 'Cajas', 'Total'],
    clientesRankingActual.map((c, i) => [i + 1, c.cliente, c.vales, c.cajas, c.total]));
});

// ================= Clic en "Editar" de cualquier tabla =================

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-editar-folio]');
  if (btn) irAEditarFolio(btn.dataset.editarFolio);
});

// ---------- Service worker + arranque ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

(async function arrancar() {
  const sesion = await leerSesion().catch(() => null);
  if (sesion && sesion.token) {
    await iniciarSesionConToken(sesion.token, sesion.rol, sesion.nombre);
  } else {
    mostrarLogin();
  }
})();
