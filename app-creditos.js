// Bodega R-56 — Módulo Créditos / Pagos — Lógica de la app
//
// Comparte sesión (login) e IndexedDB con los demás módulos — un solo
// inicio de sesión sirve en toda la app. Usa las mismas 6 acciones nuevas
// de Code.gs: creditos_cliente, pagos_pendientes_cliente, cuentas_lista,
// pago_guardar, pago_aplicar, pago_eliminar.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Misma base de datos que los demás módulos — mismos 4 stores, misma
// versión. El pago de cliente usa el store genérico "pendientes" (igual
// que venta_guardar en el Módulo 4), así no hace falta subir DB_VERSION.
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

// ---------- Cola de pendientes (idéntico patrón a los demás módulos) ----------

async function encolar(tipo, payload) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    const req = tx.objectStore(STORE_PENDIENTES).add({ tipo, payload, creadoEn: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
async function listarPendientes() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readonly');
    const req = tx.objectStore(STORE_PENDIENTES).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}
async function borrarPendiente(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    tx.objectStore(STORE_PENDIENTES).delete(id);
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
function fmtDinero(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaHoyCDMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function folioStr(n) { return '#' + String(n).padStart(5, '0'); }
function fechaCorta(f) {
  if (!f) return '—';
  const partes = String(f).split('-');
  if (partes.length !== 3) return f;
  return `${partes[2]}/${partes[1]}`;
}
const FORMA_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque' };

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let clientesCatalogo = [];   // acción "clientes"
let cuentasCatalogo = [];    // acción "cuentas_lista"
let clienteActivo = null;    // cliente elegido en el filtro de la izquierda
let todosVales = [];         // acción "creditos_todos" — vista por default (sin cliente filtrado)
let valesCliente = [];       // acción "creditos_cliente"
let pagosPendientesCliente = []; // acción "pagos_pendientes_cliente"
let foliosSeleccionados = []; // orden en que se fueron marcando las casillas
let pagoClienteSeleccionado = null; // cliente elegido dentro del modal "Pago de cliente" (independiente del filtro)
let sincronizando = false;
let ultimoPagoGuardado = null; // para el botón "Imprimir comprobante" del modal de confirmación

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

  cargarClientes();
  cargarCuentas();
  cargarTodosLosVales();
  sincronizar();
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

// ---------- Catálogos: clientes y cuentas ----------

async function cargarClientes() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=clientes&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      clientesCatalogo = data.clientes || [];
      localStorage.setItem('r56-clientes-creditos', JSON.stringify(clientesCatalogo));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-clientes-creditos');
    if (guardado) { try { clientesCatalogo = JSON.parse(guardado); } catch (e) {} }
    mostrarError('Sin conexión — mostrando el último catálogo de clientes guardado.');
  }
}

async function cargarCuentas() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=cuentas_lista&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      cuentasCatalogo = data.cuentas || [];
      localStorage.setItem('r56-cuentas-creditos', JSON.stringify(cuentasCatalogo));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-cuentas-creditos');
    if (guardado) { try { cuentasCatalogo = JSON.parse(guardado); } catch (e) {} }
  }
  poblarSelectCuentas('pago-cuenta-select');
  poblarSelectCuentas('estado-cuenta-cuenta-select');
}

function poblarSelectCuentas(selectId = 'pago-cuenta-select') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">Seleccionar…</option>' +
    cuentasCatalogo.map(c => `<option value="${c.id}">${c.agricultor} — ${c.nombreCuenta}</option>`).join('');
  if (actual) sel.value = actual;
}

// ---------- Filtro de cliente (columna izquierda) ----------

const filtroClienteInput = document.getElementById('filtro-cliente-input');
const filtroClienteSug = document.getElementById('filtro-cliente-suggerencias');

filtroClienteInput.addEventListener('input', () => {
  const q = filtroClienteInput.value.trim().toUpperCase();
  if (!q) { filtroClienteSug.classList.remove('show'); return; }
  const opciones = clientesCatalogo.filter(c => c.nombre.toUpperCase().includes(q)).slice(0, 8);
  if (opciones.length === 0) { filtroClienteSug.classList.remove('show'); return; }
  filtroClienteSug.innerHTML = opciones.map(c => `<div class="opt" data-name="${c.nombre}">${c.nombre}</div>`).join('');
  filtroClienteSug.classList.add('show');
});
filtroClienteInput.addEventListener('blur', () => setTimeout(() => filtroClienteSug.classList.remove('show'), 150));
filtroClienteSug.addEventListener('mousedown', (e) => {
  const name = e.target.closest('.opt')?.dataset.name;
  if (name) {
    filtroClienteInput.value = name;
    filtroClienteSug.classList.remove('show');
    seleccionarClienteFiltro(name);
  }
});

async function seleccionarClienteFiltro(nombre) {
  clienteActivo = nombre;
  document.getElementById('todos-clientes-panel').hidden = true;
  document.getElementById('cliente-panel').hidden = false;
  document.getElementById('cliente-nombre-titulo').textContent = nombre;
  foliosSeleccionados = [];
  document.getElementById('vales-lista').innerHTML = '<div class="vales-vacio">Cargando…</div>';
  document.getElementById('pagos-pendientes-lista').innerHTML = '<div class="pagos-pendientes-vacio">Cargando…</div>';
  await Promise.all([cargarCreditosCliente(), cargarPagosPendientesCliente()]);
}

document.getElementById('btn-limpiar-cliente').addEventListener('click', () => {
  clienteActivo = null;
  valesCliente = [];
  pagosPendientesCliente = [];
  foliosSeleccionados = [];
  filtroClienteInput.value = '';
  document.getElementById('cliente-panel').hidden = true;
  document.getElementById('todos-clientes-panel').hidden = false;
  document.getElementById('saldo-favor-total').textContent = '$0';
  document.getElementById('pagos-pendientes-lista').innerHTML = '<div class="pagos-pendientes-vacio">Selecciona un cliente para ver su saldo a favor.</div>';
  cargarTodosLosVales(); // refresca por si hubo cambios mientras se veía un cliente
});

// ---------- Vista "todos los clientes" (cuando no hay filtro activo) ----------
// Muestra, sin necesidad de filtrar, los vales a crédito de todos los
// clientes (misma regla de un mes que por cliente: no liquidados siempre,
// liquidados solo del último mes), en el orden en que se fueron
// ingresando. El nombre de cada cliente es un enlace: da clic ahí para
// filtrar de inmediato las cuentas de ese cliente.

async function cargarTodosLosVales() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=creditos_todos&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { todosVales = []; }
    else { todosVales = data.vales || []; }
  } catch (err) {
    todosVales = [];
    mostrarToast('Sin conexión — no se pudo cargar la lista de todos los clientes.', 'warn');
  }
  renderTodosVales();
}

function renderTodosVales() {
  const cont = document.getElementById('todos-vales-lista');
  if (todosVales.length === 0) {
    cont.innerHTML = '<div class="vales-vacio">No hay vales a crédito pendientes ni recientes.</div>';
    return;
  }
  cont.innerHTML = todosVales.map(v => {
    const pagado = String(v.status || '').toUpperCase() === 'PAGADO';
    return `
    <div class="vale-fila-todos ${pagado ? 'pagado' : ''}" data-folio="${v.folio}">
      <span><a class="cliente-link" data-cliente="${v.cliente}" title="Ver las cuentas de ${v.cliente}">${v.cliente}</a></span>
      <span>${folioStr(v.folio)}</span>
      <span>${fechaCorta(v.fecha)}</span>
      <span>${v.carro}</span>
      <span class="num">${fmt(v.cantidad)}</span>
      <span class="num">${v.precio === 'varios' || v.precio === 'VARIOS' ? 'varios' : '$' + fmt(v.precio)}</span>
      <span class="num">$${fmt(v.total)}</span>
      <span class="num">$${fmt(v.saldoPendiente)}</span>
      <span><span class="status-badge ${pagado ? 'pagado' : ''}">${pagado ? 'Pagado' : 'Pendiente'}</span></span>
      <span>${celdaAplicado(v, 'todos')}</span>
    </div>${detalleAplicaciones(v, 'todos')}`;
  }).join('');
}

document.getElementById('todos-vales-lista').addEventListener('click', (e) => {
  const quitarBtn = e.target.closest('[data-quitar-aplicacion]');
  if (quitarBtn) { quitarAplicacion(quitarBtn.dataset.quitarAplicacion, quitarBtn.dataset.folio); return; }
  const claveToggle = e.target.closest('[data-toggle-aplicado]')?.dataset.toggleAplicado;
  if (claveToggle) { alternarDetalleAplicaciones(claveToggle); return; }
  const nombre = e.target.closest('.cliente-link')?.dataset.cliente;
  if (!nombre) return;
  filtroClienteInput.value = nombre;
  seleccionarClienteFiltro(nombre);
});

// ---------- Vales a crédito del cliente activo ----------

async function cargarCreditosCliente() {
  if (!clienteActivo) return;
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=creditos_cliente&token=${encodeURIComponent(tokenActual)}&cliente=${encodeURIComponent(clienteActivo)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudieron cargar los vales de este cliente.', 'warn'); valesCliente = []; }
    else { valesCliente = data.vales || []; }
  } catch (err) {
    mostrarToast('Sin conexión — no se pudieron cargar los vales de este cliente.', 'warn');
    valesCliente = [];
  }
  renderVales();
}

function renderVales() {
  const cont = document.getElementById('vales-lista');
  if (valesCliente.length === 0) {
    cont.innerHTML = '<div class="vales-vacio">Este cliente no tiene vales a crédito pendientes ni recientes.</div>';
    actualizarBarraAplicar();
    return;
  }
  cont.innerHTML = valesCliente.map(v => {
    const pagado = String(v.status || '').toUpperCase() === 'PAGADO';
    const marcado = foliosSeleccionados.includes(v.folio);
    return `
    <div class="vale-fila ${pagado ? 'pagado' : ''}" data-folio="${v.folio}">
      <span>${pagado ? '' : `<input type="checkbox" data-folio-check="${v.folio}" ${marcado ? 'checked' : ''}>`}</span>
      <span>${folioStr(v.folio)}</span>
      <span>${fechaCorta(v.fecha)}</span>
      <span>${v.carro}</span>
      <span class="num">${fmt(v.cantidad)}</span>
      <span class="num">${v.precio === 'varios' || v.precio === 'VARIOS' ? 'varios' : '$' + fmt(v.precio)}</span>
      <span class="num">$${fmt(v.total)}</span>
      <span class="num">$${fmt(v.saldoPendiente)}</span>
      <span><span class="status-badge ${pagado ? 'pagado' : ''}">${pagado ? 'Pagado' : 'Pendiente'}</span></span>
      <span>${celdaAplicado(v, 'cliente')}</span>
    </div>${detalleAplicaciones(v, 'cliente')}`;
  }).join('');
  actualizarBarraAplicar();
}

document.getElementById('vales-lista').addEventListener('change', (e) => {
  const folio = Number(e.target.dataset.folioCheck);
  if (!folio) return;
  if (e.target.checked) {
    if (!foliosSeleccionados.includes(folio)) foliosSeleccionados.push(folio);
  } else {
    foliosSeleccionados = foliosSeleccionados.filter(f => f !== folio);
  }
  actualizarBarraAplicar();
});

document.getElementById('vales-lista').addEventListener('click', (e) => {
  const quitarBtn = e.target.closest('[data-quitar-aplicacion]');
  if (quitarBtn) { quitarAplicacion(quitarBtn.dataset.quitarAplicacion, quitarBtn.dataset.folio); return; }
  const claveToggle = e.target.closest('[data-toggle-aplicado]')?.dataset.toggleAplicado;
  if (claveToggle) alternarDetalleAplicaciones(claveToggle);
});

// ---------- Columna "Aplicado" — trazabilidad de qué pago(s) cubrieron cada vale ----------
// Compartida entre la vista por cliente y la de "todos los clientes"
// (prefijoId distingue los IDs del DOM entre ambas, porque las dos tablas
// pueden tener filas en el mismo folio a la vez, aunque solo una esté
// visible). Viene de v.aplicaciones, que ya trae Code.gs armado (folio →
// lista de {monto, fecha, forma}) vía el action creditos_cliente/creditos_todos.

function celdaAplicado(v, prefijoId) {
  const n = (v.aplicaciones || []).length;
  if (n === 0) return '<span class="aplicado-vacio">—</span>';
  return `<button type="button" class="aplicado-btn" data-toggle-aplicado="${prefijoId}-${v.folio}">${n} pago${n === 1 ? '' : 's'} ▾</button>`;
}

function detalleAplicaciones(v, prefijoId) {
  if (!v.aplicaciones || v.aplicaciones.length === 0) return '';
  const filas = v.aplicaciones.map(a => `
    <div class="aplicacion-fila">
      <span class="meta">${fechaCorta(a.fecha)} · ${FORMA_LABELS[a.forma] || a.forma || '—'}</span>
      <span class="aplicacion-derecha">
        <span class="monto">$${fmt(a.monto)}</span>
        <button type="button" class="quitar-aplicacion-btn" data-quitar-aplicacion="${a.id}" data-folio="${v.folio}" title="Quitar este pago aplicado (no borra el pago, solo lo regresa a pendiente por aplicar)">Quitar pago</button>
      </span>
    </div>`).join('');
  return `
  <div class="vale-aplicaciones-detalle" id="aplic-detalle-${prefijoId}-${v.folio}" hidden>
    <div class="titulo-chico">Pagos aplicados a este vale</div>
    ${filas}
  </div>`;
}

function alternarDetalleAplicaciones(clave) {
  const detalle = document.getElementById('aplic-detalle-' + clave);
  if (detalle) detalle.hidden = !detalle.hidden;
}

// Quita UNA aplicación puntual (un pago aplicado a un vale), sin borrar el
// pago original: el monto regresa a "pendiente por aplicar" para ese
// cliente. Pensado para corregir un pago aplicado por error al vale
// equivocado — el usuario lo confirma explícitamente porque, aunque no es
// destructivo, sí cambia el estado (saldo/status) del vale.
async function quitarAplicacion(aplicacionId, folio) {
  const confirmado = confirm(`¿Quitar este pago aplicado al vale ${folioStr(Number(folio))}?\n\nEl pago NO se elimina — solo se regresa a "pendiente por aplicar" para poder aplicarlo al vale correcto.`);
  if (!confirmado) return;
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const url = `${APPS_SCRIPT_URL}?action=aplicacion_quitar&token=${encodeURIComponent(tokenActual)}&aplicacionId=${encodeURIComponent(aplicacionId)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo quitar la aplicación.');
    mostrarToast('Pago quitado del vale — regresó a pendiente por aplicar.', 'ok');
    await Promise.all([cargarCreditosCliente(), cargarPagosPendientesCliente(), cargarTodosLosVales()]);
  } catch (err) {
    mostrarToast(navigator.onLine ? `No se pudo quitar: ${err.message}` : 'Sin conexión — no se puede quitar una aplicación sin conexión. Intenta de nuevo cuando regrese la señal.', 'warn');
  }
}

function actualizarBarraAplicar() {
  const barra = document.getElementById('aplicar-bar');
  if (foliosSeleccionados.length === 0) { barra.hidden = true; return; }
  const totalSaldoVales = foliosSeleccionados.reduce((acc, folio) => {
    const v = valesCliente.find(x => x.folio === folio);
    return acc + (v ? v.saldoPendiente : 0);
  }, 0);
  const saldoFavor = pagosPendientesCliente.reduce((acc, p) => acc + p.saldoDisponible, 0);
  document.getElementById('aplicar-resumen').textContent =
    `${foliosSeleccionados.length} vale${foliosSeleccionados.length === 1 ? '' : 's'} seleccionado${foliosSeleccionados.length === 1 ? '' : 's'} · saldo pendiente $${fmt(totalSaldoVales)} · saldo a favor disponible $${fmt(saldoFavor)}`;
  barra.hidden = false;
}

document.getElementById('btn-aplicar-pagos').addEventListener('click', async () => {
  if (!clienteActivo || foliosSeleccionados.length === 0) return;
  const boton = document.getElementById('btn-aplicar-pagos');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Aplicando…';
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const url = `${APPS_SCRIPT_URL}?action=pago_aplicar&token=${encodeURIComponent(tokenActual)}&cliente=${encodeURIComponent(clienteActivo)}&folios=${encodeURIComponent(JSON.stringify(foliosSeleccionados))}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo aplicar el saldo.');
    mostrarToast('Saldo a favor aplicado correctamente.', 'ok');
    foliosSeleccionados = [];
    await Promise.all([cargarCreditosCliente(), cargarPagosPendientesCliente(), cargarTodosLosVales()]);
  } catch (err) {
    mostrarToast(navigator.onLine ? `No se pudo aplicar: ${err.message}` : 'Sin conexión — no se puede aplicar un pago sin conexión. Intenta de nuevo cuando regrese la señal.', 'warn');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

// ---------- Pagos pendientes por aplicar (columna derecha) ----------

async function cargarPagosPendientesCliente() {
  if (!clienteActivo) return;
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=pagos_pendientes_cliente&token=${encodeURIComponent(tokenActual)}&cliente=${encodeURIComponent(clienteActivo)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { pagosPendientesCliente = []; }
    else { pagosPendientesCliente = data.pagos || []; }
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el saldo a favor de este cliente.', 'warn');
    pagosPendientesCliente = [];
  }
  renderPagosPendientes();
}

function renderPagosPendientes() {
  const total = pagosPendientesCliente.reduce((acc, p) => acc + p.saldoDisponible, 0);
  document.getElementById('saldo-favor-total').textContent = '$' + fmt(total);

  const cont = document.getElementById('pagos-pendientes-lista');
  if (pagosPendientesCliente.length === 0) {
    cont.innerHTML = '<div class="pagos-pendientes-vacio">Este cliente no tiene saldo a favor por aplicar.</div>';
    actualizarBarraAplicar();
    return;
  }
  cont.innerHTML = pagosPendientesCliente.map(p => `
    <div class="pago-pendiente-fila">
      <div>
        <div class="monto">$${fmt(p.saldoDisponible)}</div>
        <div class="meta">${FORMA_LABELS[p.forma] || p.forma} · ${fechaCorta(p.fecha)}${p.aplicado > 0 ? ' · ya aplicado: $' + fmt(p.aplicado) : ''}</div>
      </div>
      ${usuarioRol === 'admin' ? `<button class="btn-eliminar-pago" data-pago-id="${p.id}" title="Eliminar este pago por completo">🗑</button>` : ''}
    </div>
  `).join('');
  actualizarBarraAplicar();
}

document.getElementById('pagos-pendientes-lista').addEventListener('click', async (e) => {
  const pagoId = e.target.closest('.btn-eliminar-pago')?.dataset.pagoId;
  if (!pagoId) return;
  const confirmado = window.confirm('¿Deseas eliminar definitivamente este pago?\n\nEsto deshace cualquier aplicación que tuviera hacia vales (les regresa su saldo pendiente) y revierte lo acumulado en la cuenta destino si aplica. No se puede deshacer.');
  if (!confirmado) return;
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const url = `${APPS_SCRIPT_URL}?action=pago_eliminar&token=${encodeURIComponent(tokenActual)}&pagoId=${encodeURIComponent(pagoId)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo eliminar el pago.');
    mostrarToast('Pago eliminado.', 'ok');
    await Promise.all([cargarCreditosCliente(), cargarPagosPendientesCliente(), cargarTodosLosVales()]);
  } catch (err) {
    mostrarToast(navigator.onLine ? `No se pudo eliminar: ${err.message}` : 'Sin conexión — no se puede eliminar un pago sin conexión. Intenta de nuevo cuando regrese la señal.', 'warn');
  }
});

// ---------- Modal: Registrar pago de cliente ----------
// El campo Cliente de este formulario tiene SU PROPIO buscador,
// independiente del filtro de la izquierda — igual que el buscador de
// cliente del Módulo de Vale — no hereda el cliente activo del filtro.

const pagoClienteInput = document.getElementById('pago-cliente-input');
const pagoClienteSug = document.getElementById('pago-cliente-suggerencias');

pagoClienteInput.addEventListener('input', () => {
  pagoClienteSeleccionado = null;
  const q = pagoClienteInput.value.trim().toUpperCase();
  if (!q) { pagoClienteSug.classList.remove('show'); return; }
  const opciones = clientesCatalogo.filter(c => c.nombre.toUpperCase().includes(q)).slice(0, 8);
  if (opciones.length === 0) { pagoClienteSug.classList.remove('show'); return; }
  pagoClienteSug.innerHTML = opciones.map(c => `<div class="opt" data-name="${c.nombre}">${c.nombre}</div>`).join('');
  pagoClienteSug.classList.add('show');
});
pagoClienteInput.addEventListener('blur', () => setTimeout(() => pagoClienteSug.classList.remove('show'), 150));
pagoClienteSug.addEventListener('mousedown', (e) => {
  const name = e.target.closest('.opt')?.dataset.name;
  if (name) {
    pagoClienteInput.value = name;
    pagoClienteSeleccionado = name;
    pagoClienteSug.classList.remove('show');
  }
});

function abrirModalPago() {
  pagoClienteInput.value = '';
  pagoClienteSeleccionado = null;
  document.getElementById('pago-monto-input').value = '';
  document.querySelectorAll('input[name="forma-pago"]').forEach(r => { r.checked = r.value === 'efectivo'; });
  document.getElementById('campo-cuenta-destino').hidden = true;
  document.getElementById('pago-cuenta-select').value = '';
  document.getElementById('pago-error').textContent = '';
  document.getElementById('modal-pago').hidden = false;
  pagoClienteInput.focus();
}
document.getElementById('btn-registrar-pago').addEventListener('click', abrirModalPago);
document.getElementById('pago-cancelar').addEventListener('click', () => { document.getElementById('modal-pago').hidden = true; });

document.querySelectorAll('input[name="forma-pago"]').forEach(r => {
  r.addEventListener('change', () => {
    const forma = document.querySelector('input[name="forma-pago"]:checked').value;
    document.getElementById('campo-cuenta-destino').hidden = forma === 'efectivo';
  });
});

document.getElementById('pago-guardar-btn').addEventListener('click', async () => {
  const errorBox = document.getElementById('pago-error');
  errorBox.textContent = '';

  const clienteTexto = pagoClienteInput.value.trim();
  const cliente = pagoClienteSeleccionado || clienteTexto;
  const monto = Number(document.getElementById('pago-monto-input').value);
  const forma = document.querySelector('input[name="forma-pago"]:checked').value;
  const cuentaId = document.getElementById('pago-cuenta-select').value;

  if (!cliente) { errorBox.textContent = 'Selecciona un cliente.'; return; }
  if (!monto || isNaN(monto) || monto <= 0) { errorBox.textContent = 'Ingresa un monto válido.'; return; }
  if ((forma === 'transferencia' || forma === 'cheque') && !cuentaId) {
    errorBox.textContent = 'Selecciona la cuenta destino.';
    return;
  }

  const boton = document.getElementById('pago-guardar-btn');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  const payload = { cliente, monto, forma, cuentaId: forma === 'efectivo' ? '' : cuentaId };
  const fechaHoy = fechaHoyCDMX();

  try {
    let idPago = null;
    if (navigator.onLine) {
      const params = new URLSearchParams({ action: 'pago_guardar', token: tokenActual, cliente: payload.cliente, monto: String(payload.monto), forma: payload.forma });
      if (payload.cuentaId) params.set('cuentaId', payload.cuentaId);
      const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
      if (data.error === 'no_autorizado') { await volverALogin(); return; }
      if (!data.ok) throw new Error(data.error || 'No se pudo guardar el pago.');
      idPago = data.id;
      mostrarToast(`Pago de ${cliente} guardado — $${fmt(monto)}.`, 'ok');
    } else {
      throw new Error('sin conexión');
    }

    document.getElementById('modal-pago').hidden = true;
    abrirModalPagoListo(cliente, monto, forma, cuentaId, fechaHoy, idPago);

    // Si el cliente del pago es el mismo que está filtrado a la izquierda,
    // refresca su saldo a favor de inmediato.
    if (clienteActivo && clienteActivo.toLowerCase() === cliente.toLowerCase()) {
      cargarPagosPendientesCliente();
    }
  } catch (err) {
    if (!navigator.onLine || /conexión/i.test(err.message)) {
      await encolar('pago_guardar', payload);
      mostrarToast('Sin conexión — el pago quedó guardado en este dispositivo y se sincronizará en cuanto regrese la señal.', 'info');
      document.getElementById('modal-pago').hidden = true;
      abrirModalPagoListo(cliente, monto, forma, cuentaId, fechaHoy, null);
      if (clienteActivo && clienteActivo.toLowerCase() === cliente.toLowerCase()) cargarPagosPendientesCliente();
    } else {
      errorBox.textContent = err.message;
    }
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

// ---------- Modal: confirmación + comprobante impreso (80mm) ----------

function nombreCuentaPorId(cuentaId) {
  const c = cuentasCatalogo.find(x => String(x.id) === String(cuentaId));
  return c ? `${c.agricultor} — ${c.nombreCuenta}` : '';
}

function abrirModalPagoListo(cliente, monto, forma, cuentaId, fecha, idPago) {
  ultimoPagoGuardado = { cliente, monto, forma, cuentaId, fecha, idPago };
  const resumen = document.getElementById('pago-listo-resumen');
  resumen.textContent = `${cliente} · ${FORMA_LABELS[forma] || forma} · $${fmt(monto)}`;
  document.getElementById('modal-pago-listo').hidden = false;
}

document.getElementById('pago-listo-cerrar').addEventListener('click', () => {
  document.getElementById('modal-pago-listo').hidden = true;
  ultimoPagoGuardado = null;
});

// Mismo mecanismo de impresión de 80mm que el vale del Módulo 4 (ver
// vale.html / app-vale.js) — el cliente necesita un comprobante físico de
// que su pago quedó registrado.
function generarComprobanteHTML(pago) {
  const cuentaTxt = pago.cuentaId ? nombreCuentaPorId(pago.cuentaId) : '';
  return `
    <h2>COMPROBANTE DE PAGO</h2>
    <div class="center">Bodega R-56 · Tomates de Invernadero</div>
    <div class="linea-punteada"></div>
    <div class="reng"><div class="reng-label">Cliente</div><div class="reng-valor">${pago.cliente}</div></div>
    <div class="reng"><div class="reng-label">Fecha</div><div class="reng-valor">${pago.fecha}</div></div>
    <div class="reng"><div class="reng-label">Forma de pago</div><div class="reng-valor">${FORMA_LABELS[pago.forma] || pago.forma}</div></div>
    ${cuentaTxt ? `<div class="reng"><div class="reng-label">Cuenta destino</div><div class="reng-valor">${cuentaTxt}</div></div>` : ''}
    <div class="linea-punteada"></div>
    <div class="reng-label center">Monto recibido</div>
    <div class="monto-grande">$${fmtDinero(pago.monto)}</div>
    <div class="linea-punteada"></div>
    <div class="center" style="margin-top:14px;">_____________________<br>Firma / Sello</div>
  `;
}

document.getElementById('pago-listo-imprimir').addEventListener('click', () => {
  if (!ultimoPagoGuardado) return;
  document.getElementById('print-area').innerHTML = generarComprobanteHTML(ultimoPagoGuardado);
  window.print();
});

// ---------- Estado de cuenta (compendio de notas pendientes por cliente) ----------
// Pedido explícito: junta TODAS las notas pendientes del cliente activo —
// incluidas las que ya tienen un abono parcial pero siguen con saldo — para
// que solo pague la diferencia. Antes de generar el PDF pide a qué cuenta
// bancaria se le va a decir al cliente que pague (accionEstadoCuenta ya
// regresa solo los datos bancarios de esa cuenta, nunca el agricultor
// dueño). El "PDF" es semi-automático: se arma como documento imprimible y
// el usuario lo guarda como PDF desde el diálogo de impresión de Chrome
// (mismo criterio "v1 simple" ya confirmado para este módulo).

document.getElementById('btn-estado-cuenta').addEventListener('click', () => {
  if (!clienteActivo) return;
  document.getElementById('estado-cuenta-cliente-nombre').textContent = clienteActivo;
  document.getElementById('estado-cuenta-error').textContent = '';
  document.getElementById('estado-cuenta-cuenta-select').value = '';
  document.getElementById('modal-estado-cuenta').hidden = false;
});

document.getElementById('estado-cuenta-cancelar').addEventListener('click', () => {
  document.getElementById('modal-estado-cuenta').hidden = true;
});

document.getElementById('estado-cuenta-generar').addEventListener('click', async () => {
  const cuentaId = document.getElementById('estado-cuenta-cuenta-select').value;
  const errorBox = document.getElementById('estado-cuenta-error');
  errorBox.textContent = '';
  if (!cuentaId) { errorBox.textContent = 'Selecciona a qué cuenta le va a hacer el pago el cliente.'; return; }
  if (!clienteActivo) return;
  const boton = document.getElementById('estado-cuenta-generar');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Generando…';
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const url = `${APPS_SCRIPT_URL}?action=estado_cuenta&token=${encodeURIComponent(tokenActual)}&cliente=${encodeURIComponent(clienteActivo)}&cuentaId=${encodeURIComponent(cuentaId)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo generar el estado de cuenta.');
    document.getElementById('modal-estado-cuenta').hidden = true;
    imprimirEstadoCuenta(data);
  } catch (err) {
    errorBox.textContent = navigator.onLine ? err.message : 'Sin conexión — no se puede generar el estado de cuenta sin conexión.';
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

function generarEstadoCuentaHTML(d) {
  const filas = d.partidas.map(p => `
    <tr>
      <td>${fechaCorta(p.fecha)}</td>
      <td>${p.carro || ''}</td>
      <td>${p.tamano || ''}</td>
      <td class="num">${fmt(p.cajas)}</td>
      <td class="num">$${fmt(p.precio)}</td>
      <td class="num">$${fmt(p.subtotal)}</td>
    </tr>`).join('');

  const hayFavor = d.saldoFavor > 0.001;
  const filasTotales = `
    <div class="fila${hayFavor ? '' : ' total'}"><span>Total</span><span>$${fmt(d.total)}</span></div>
    ${hayFavor ? `
    <div class="fila favor"><span>Saldo a favor</span><span>-$${fmt(d.saldoFavor)}</span></div>
    <div class="fila total"><span>Restante por liquidar</span><span>$${fmt(d.restante)}</span></div>` : ''}
  `;

  const cuentaHTML = d.cuenta ? `
    <div class="ec-cuenta">
      <div class="titulo">CUENTA BANCARIA PARA SU PAGO</div>
      <div class="nombre">${d.cuenta.nombreCuenta}</div>
      ${d.cuenta.banco ? `<div class="reng"><b>Banco:</b> ${d.cuenta.banco}</div>` : ''}
      ${d.cuenta.sucursal ? `<div class="reng"><b>Suc:</b> ${d.cuenta.sucursal}</div>` : ''}
      ${d.cuenta.numCuenta ? `<div class="reng"><b>Cuenta:</b> ${d.cuenta.numCuenta}</div>` : ''}
      ${d.cuenta.clave ? `<div class="reng"><b>Clave:</b> ${d.cuenta.clave}</div>` : ''}
    </div>` : '';

  return `
    <h2>ESTADO DE CUENTA</h2>
    <div class="ec-sub">Cliente: <b>${d.cliente}</b> · Bodega R-56 · ${fechaCorta(d.fecha)}</div>
    <table>
      <thead><tr><th>Fecha</th><th>Carro</th><th>Tamaño</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <div class="ec-totales">${filasTotales}</div>
    ${cuentaHTML}
  `;
}

// @page no se puede condicionar por clase CSS — se sobreescribe el tamaño
// de hoja inyectando un <style> temporal justo antes de imprimir (la hoja
// completa necesita tamaño normal, no los 80mm fijos del comprobante), y se
// quita al terminar en el evento "afterprint" (dispara también para el
// comprobante de 80mm; ahí simplemente no encuentra nada que quitar).
function imprimirEstadoCuenta(d) {
  document.getElementById('print-area-estado').innerHTML = generarEstadoCuentaHTML(d);
  const estiloPagina = document.createElement('style');
  estiloPagina.id = 'estilo-pagina-estado-cuenta';
  estiloPagina.textContent = '@page { size: auto; margin: 14mm; }';
  document.head.appendChild(estiloPagina);
  document.body.classList.add('imprimiendo-estado-cuenta');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('imprimiendo-estado-cuenta');
  const estiloPagina = document.getElementById('estilo-pagina-estado-cuenta');
  if (estiloPagina) estiloPagina.remove();
});

// ---------- Sincronización de la cola cuando regresa la señal ----------

async function sincronizar() {
  if (sincronizando || !navigator.onLine || !tokenActual) return;
  sincronizando = true;
  try {
    const pendientes = await listarPendientes();
    for (const item of pendientes) {
      if (item.tipo !== 'pago_guardar') continue; // lo de otros módulos lo sincroniza su propia pantalla
      try {
        const p = item.payload;
        const params = new URLSearchParams({ action: 'pago_guardar', token: tokenActual, cliente: p.cliente, monto: String(p.monto), forma: p.forma });
        if (p.cuentaId) params.set('cuentaId', p.cuentaId);
        const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
        if (!data.ok) throw new Error(data.error || 'error');
        await borrarPendiente(item.id);
      } catch (err) {
        break; // se corta la conexión a media pasada — se reintenta después, sin perder el orden
      }
    }
    if (clienteActivo) await cargarPagosPendientesCliente();
  } finally {
    sincronizando = false;
  }
}
window.addEventListener('online', sincronizar);
setInterval(sincronizar, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenActual) sincronizar();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Arranque ----------

(async function arrancar() {
  const sesion = await leerSesion().catch(() => null);
  if (sesion && sesion.token) {
    await iniciarSesionConToken(sesion.token, sesion.rol, sesion.nombre);
  } else {
    mostrarLogin();
  }
})();
