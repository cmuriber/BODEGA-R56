// Bodega R-56 — Módulo Pagos — Lógica de la app
//
// Comparte sesión (login) e IndexedDB con los demás módulos — un solo
// inicio de sesión sirve en toda la app. Pantalla propia, tipo
// "spreadsheet", con TODOS los pagos (cualquier Forma) — independiente de
// la herramienta "Registrar pago de cliente" que ya vive en Créditos. Usa
// las acciones nuevas de Code.gs: pagos_listado, factura_calcular_partidas,
// factura_solicitar.

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
const FORMA_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque' };

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let clientesCatalogo = [];  // acción "clientes"
let pagosListado = [];      // acción "pagos_listado"
let clienteFiltroActivo = null;

// Contexto del modal "Solicitar factura"
let facturaPagoActual = null;      // { pagoId, monto }
let facturaPartidasAuto = [];      // lo que regresó factura_calcular_partidas
let facturaPartidasActuales = [];  // lo que se está mostrando/editando ahora
let facturaModoEdicion = false;

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

  // Mismo patrón "local primero, Sheets en segundo plano" que ya usan los
  // demás módulos: se pinta de inmediato con el último listado guardado en
  // este dispositivo, sin esperar a la red.
  try {
    const guardado = localStorage.getItem('r56-pagos-listado');
    if (guardado) { pagosListado = JSON.parse(guardado); renderPagos(); }
  } catch (err) {}

  cargarClientes();
  cargarPagos();
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

// ---------- Catálogo de clientes (para el autocompletar del filtro) ----------

async function cargarClientes() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=clientes&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      clientesCatalogo = data.clientes || [];
      localStorage.setItem('r56-clientes-pagos', JSON.stringify(clientesCatalogo));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-clientes-pagos');
    if (guardado) { try { clientesCatalogo = JSON.parse(guardado); } catch (e) {} }
  }
}

// ---------- Filtro de cliente ----------

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
  clienteFiltroActivo = nombre;
  document.getElementById('btn-ver-todos-clientes').hidden = false;
  document.getElementById('pagos-titulo').textContent = `Pagos de ${nombre}`;
  document.getElementById('pagos-lista').innerHTML = '<div class="pagos-vacio">Cargando…</div>';
  await cargarPagos();
}

document.getElementById('btn-ver-todos-clientes').addEventListener('click', () => {
  clienteFiltroActivo = null;
  filtroClienteInput.value = '';
  document.getElementById('btn-ver-todos-clientes').hidden = true;
  document.getElementById('pagos-titulo').textContent = 'Todos los pagos';
  cargarPagos();
});

// ---------- Listado de pagos ----------

async function cargarPagos() {
  try {
    let url = `${APPS_SCRIPT_URL}?action=pagos_listado&token=${encodeURIComponent(tokenActual)}`;
    if (clienteFiltroActivo) url += `&cliente=${encodeURIComponent(clienteFiltroActivo)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el listado de pagos.', 'error'); }
    else {
      pagosListado = data.pagos || [];
      if (!clienteFiltroActivo) { try { localStorage.setItem('r56-pagos-listado', JSON.stringify(pagosListado)); } catch (err) {} }
    }
  } catch (err) {
    mostrarToast('Sin conexión — mostrando lo último guardado.', 'warn');
  }
  renderPagos();
}

function renderPagos() {
  const cont = document.getElementById('pagos-lista');
  if (pagosListado.length === 0) {
    cont.innerHTML = '<div class="pagos-vacio">No hay pagos para mostrar.</div>';
    return;
  }
  cont.innerHTML = pagosListado.map(p => renderPagoCard(p)).join('');
}

function renderPagoCard(p) {
  let estadoHtml;
  if (p.statusPago === 'pendiente') {
    estadoHtml = '<span class="badge-pendiente">Pendiente por aplicar</span>';
  } else if (p.statusFactura === 'pedida') {
    estadoHtml = `<span class="badge-factura-pedida">Factura pedida el ${fechaCorta(p.facturaSolicitada)}</span>`;
  } else if (p.cuentaId) {
    estadoHtml = `<span class="badge-aplicado">Aplicado</span><button class="btn-chico dorado" data-solicitar-factura="${p.id}" type="button">Solicitar factura →</button>`;
  } else {
    estadoHtml = '<span class="badge-aplicado">Aplicado — pago en efectivo</span>';
  }

  return `
    <div class="pago-card" data-pago-id="${p.id}">
      <div class="pago-card-top">
        <div>
          <div class="pago-cliente">${p.cliente}</div>
          <div class="pago-meta">${fechaCorta(p.fecha)}${p.cuentaNombre ? ' · ' + p.cuentaNombre : ''}${p.agricultor ? ' · ' + p.agricultor : ''}</div>
        </div>
        <div class="pago-monto-wrap">
          <div class="pago-monto">$${fmt(p.monto)}</div>
          <span class="badge-forma ${p.forma}">${FORMA_LABELS[p.forma] || p.forma}</span>
        </div>
      </div>
      <div class="pago-status-row">${estadoHtml}</div>
    </div>
  `;
}

document.getElementById('pagos-lista').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-solicitar-factura]');
  if (btn) { abrirModalFactura(btn.dataset.solicitarFactura); }
});

// ---------- Modal: Solicitar factura ----------

async function abrirModalFactura(pagoId) {
  document.getElementById('factura-cliente-input').value = '';
  document.getElementById('factura-error').textContent = '';
  document.getElementById('factura-warning').hidden = true;
  document.getElementById('factura-partidas-tabla').innerHTML = '<div class="pagos-vacio">Cargando…</div>';
  document.getElementById('modal-factura').hidden = false;
  facturaPagoActual = { pagoId };
  facturaModoEdicion = false;

  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=factura_calcular_partidas&token=${encodeURIComponent(tokenActual)}&pagoId=${encodeURIComponent(pagoId)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) {
      mostrarToast(data.error || 'No se pudieron calcular las partidas de este pago.', 'error');
      document.getElementById('modal-factura').hidden = true;
      return;
    }
    facturaPagoActual = { pagoId, monto: data.monto };
    facturaPartidasAuto = data.partidas || [];
    facturaPartidasActuales = JSON.parse(JSON.stringify(facturaPartidasAuto));
    document.getElementById('factura-warning').hidden = !!data.cuadra;
    renderPartidasFactura();
  } catch (err) {
    mostrarToast('Sin conexión — no se pudieron calcular las partidas.', 'error');
    document.getElementById('modal-factura').hidden = true;
  }
}

document.getElementById('factura-cancelar').addEventListener('click', () => { document.getElementById('modal-factura').hidden = true; });

document.getElementById('factura-editar-toggle').addEventListener('click', () => {
  facturaModoEdicion = !facturaModoEdicion;
  renderPartidasFactura();
});

function renderPartidasFactura() {
  const cont = document.getElementById('factura-partidas-tabla');
  document.getElementById('factura-editar-toggle').textContent = facturaModoEdicion ? 'Ver solo lectura' : '✏️ Editar partidas a mano';

  let filas;
  if (facturaModoEdicion) {
    filas = facturaPartidasActuales.map((p, i) => `
      <div class="partidas-fila editable" data-idx="${i}">
        <input type="text" data-campo="tamano" value="${p.tamano || ''}" placeholder="Tamaño">
        <input type="number" data-campo="cantidad" value="${Number(p.cantidad) || 0}" min="0" step="1">
        <input type="number" data-campo="precio" value="${Number(p.precio) || 0}" min="0" step="0.01">
        <span class="num">$${fmt((Number(p.cantidad) || 0) * (Number(p.precio) || 0))}</span>
        <button type="button" class="quitar-partida-btn" data-quitar-partida="${i}" title="Quitar partida">🗑</button>
      </div>
    `).join('');
  } else {
    filas = facturaPartidasActuales.map(p => `
      <div class="partidas-fila">
        <span>${p.tamano || ''}</span>
        <span class="num">${fmt(p.cantidad)} X</span>
        <span class="num">$${fmt(p.precio)}</span>
        <span class="num">$${fmt(p.total != null ? p.total : (Number(p.cantidad) || 0) * (Number(p.precio) || 0))}</span>
      </div>
    `).join('');
  }
  if (!filas) filas = '<div class="partidas-fila"><span style="color:var(--text-dim);">Sin partidas — este pago no cubre ningún vale detectable.</span></div>';

  cont.innerHTML = `
    <div class="partidas-tabla">
      <div class="partidas-fila head ${facturaModoEdicion ? 'editable' : ''}">
        <span>Tamaño</span><span>Cantidad</span><span>Precio</span><span>Total</span>${facturaModoEdicion ? '<span></span>' : ''}
      </div>
      ${filas}
    </div>
    ${facturaModoEdicion ? '<button type="button" class="btn-texto btn-agregar-partida" id="factura-agregar-partida">+ Agregar partida</button>' : ''}
  `;
  actualizarSumaPartidasFactura();
}

function actualizarSumaPartidasFactura() {
  let sumaEl = document.getElementById('factura-suma-fila');
  const suma = facturaPartidasActuales.reduce((acc, p) => acc + (Number(p.cantidad) || 0) * (Number(p.precio) || 0), 0);
  const monto = (facturaPagoActual && facturaPagoActual.monto) || 0;
  const cuadra = Math.abs(suma - monto) <= 0.5;
  if (!sumaEl) {
    sumaEl = document.createElement('div');
    sumaEl.id = 'factura-suma-fila';
    document.getElementById('factura-partidas-tabla').appendChild(sumaEl);
  }
  sumaEl.className = 'partidas-suma-fila ' + (cuadra ? 'cuadra' : 'descuadra');
  sumaEl.innerHTML = `<span>Suma de partidas</span><span>$${fmt(suma)} de $${fmt(monto)} del pago</span>`;
}

document.getElementById('factura-partidas-tabla').addEventListener('input', (e) => {
  const fila = e.target.closest('.partidas-fila[data-idx]');
  if (!fila) return;
  const idx = Number(fila.dataset.idx);
  const campo = e.target.dataset.campo;
  if (!campo || !facturaPartidasActuales[idx]) return;
  if (campo === 'tamano') facturaPartidasActuales[idx].tamano = e.target.value;
  else facturaPartidasActuales[idx][campo] = Number(e.target.value) || 0;
  const p = facturaPartidasActuales[idx];
  const totalSpan = fila.querySelector('.num');
  if (totalSpan) totalSpan.textContent = '$' + fmt((Number(p.cantidad) || 0) * (Number(p.precio) || 0));
  actualizarSumaPartidasFactura();
});

document.getElementById('factura-partidas-tabla').addEventListener('click', (e) => {
  const quitar = e.target.closest('[data-quitar-partida]');
  if (quitar) { facturaPartidasActuales.splice(Number(quitar.dataset.quitarPartida), 1); renderPartidasFactura(); return; }
  if (e.target.id === 'factura-agregar-partida') { facturaPartidasActuales.push({ tamano: '', cantidad: 0, precio: 0, total: 0 }); renderPartidasFactura(); }
});

// Compara solo tamano/cantidad/precio (redondeados) para saber si el
// usuario de verdad cambió algo respecto al cálculo automático — así se
// puede omitir "partidasJSON" y dejar que el servidor recalcule solo,
// evitando duplicar/desalinear la lógica de agrupación.
function huellaPartidas(lista) {
  return JSON.stringify((lista || []).map(p => ({
    tamano: String(p.tamano || ''),
    cantidad: Math.round((Number(p.cantidad) || 0) * 100) / 100,
    precio: Math.round((Number(p.precio) || 0) * 100) / 100
  })));
}

document.getElementById('factura-confirmar-btn').addEventListener('click', async () => {
  const errorBox = document.getElementById('factura-error');
  const cliente = document.getElementById('factura-cliente-input').value.trim();
  if (!cliente) { errorBox.textContent = 'Falta el cliente de la factura.'; return; }
  if (!facturaPagoActual || !facturaPagoActual.pagoId) { errorBox.textContent = 'Ocurrió un error — cierra y vuelve a intentar.'; return; }
  errorBox.textContent = '';

  const editado = huellaPartidas(facturaPartidasActuales) !== huellaPartidas(facturaPartidasAuto);

  const boton = document.getElementById('factura-confirmar-btn');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Solicitando…';
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const params = new URLSearchParams({ action: 'factura_solicitar', token: tokenActual, pagoId: facturaPagoActual.pagoId, clienteFactura: cliente });
    if (editado) {
      const partidasFinal = facturaPartidasActuales.map(p => ({
        tamano: p.tamano || '', cantidad: Number(p.cantidad) || 0, precio: Number(p.precio) || 0,
        total: (Number(p.cantidad) || 0) * (Number(p.precio) || 0)
      }));
      params.set('partidasJSON', JSON.stringify(partidasFinal));
    }
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { errorBox.textContent = data.error || 'No se pudo solicitar la factura.'; return; }

    document.getElementById('modal-factura').hidden = true;
    mostrarConfirmacionFactura(data);
    await cargarPagos();
  } catch (err) {
    errorBox.textContent = navigator.onLine ? (err.message || 'No se pudo solicitar la factura.') : 'Sin conexión — no se puede solicitar una factura sin conexión.';
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

function renderPartidasSoloLectura(partidas) {
  const filas = (partidas || []).map(p => `
    <div class="partidas-fila">
      <span>${p.tamano || ''}</span>
      <span class="num">${fmt(p.cantidad)} X</span>
      <span class="num">$${fmt(p.precio)}</span>
      <span class="num">$${fmt(p.total != null ? p.total : (Number(p.cantidad) || 0) * (Number(p.precio) || 0))}</span>
    </div>
  `).join('');
  return `
    <div class="partidas-tabla">
      <div class="partidas-fila head"><span>Tamaño</span><span>Cantidad</span><span>Precio</span><span>Total</span></div>
      ${filas || '<div class="partidas-fila"><span style="color:var(--text-dim);">Sin partidas.</span></div>'}
    </div>
  `;
}

function mostrarConfirmacionFactura(data) {
  const titulo = document.getElementById('factura-confirmacion-titulo');
  const sub = document.getElementById('factura-confirmacion-sub');
  const partidasCont = document.getElementById('factura-confirmacion-partidas');
  const irBtn = document.getElementById('factura-confirmacion-ir');

  partidasCont.innerHTML = renderPartidasSoloLectura(data.partidas || []);

  if (data.directo) {
    titulo.textContent = 'Resuelto directamente';
    sub.textContent = `${data.agricultor} se factura directamente — no hay documento que enviar. Revisa el desglose para continuar a mano.`;
    irBtn.style.display = 'none';
    mostrarToast('Resuelto directamente — sin documento que enviar.', 'ok');
  } else {
    titulo.textContent = 'Agregada al compendio';
    sub.textContent = `Se agregó al compendio de ${data.agricultor} de hoy.`;
    irBtn.style.display = 'inline-block';
    irBtn.href = `./facturacion.html?agricultor=${encodeURIComponent(data.agricultor)}`;
    mostrarToast(`Agregada al compendio de ${data.agricultor} de hoy.`, 'ok');
  }
  document.getElementById('modal-factura-confirmacion').hidden = false;
}

document.getElementById('factura-confirmacion-cerrar').addEventListener('click', () => {
  document.getElementById('modal-factura-confirmacion').hidden = true;
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
