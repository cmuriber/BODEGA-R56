// Bodega R-56 — Módulo Cuentas — Lógica de la app
//
// Comparte sesión (login) e IndexedDB con los demás módulos — un solo
// inicio de sesión sirve en toda la app. Usa las acciones nuevas de
// Code.gs: cuentas_arbol, cuenta_guardar, cuenta_ronda_guardar,
// cuenta_ronda_cerrar, cuenta_ronda_reabrir.
//
// Árbol Agricultor -> Cuentas -> Rondas. Una "ronda" es un periodo de uso
// de una cuenta bancaria (tope + fecha de inicio); solo puede haber una
// abierta a la vez por cuenta. Mientras está abierta, Ingresado/
// Asignado/Resta se calculan en vivo en el backend; al cerrarla quedan
// congelados. Crear/editar rondas y cuentas, y ver el número de
// cuenta/CLABE completos, es solo para admin.

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
function fechaHoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let arbolActual = [];      // acción "cuentas_arbol"
let esAdminActual = false;
let cuentasIndice = {};    // id -> cuenta (para abrir modales sin recorrer el árbol)

// Contexto de los modales (qué cuenta/ronda se está editando)
let cuentaEnEdicion = null; // id de la cuenta que se está editando, o null si es alta
let rondaContextoCuentaId = null; // cuenta a la que le estamos dando "nuevo monto"

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
  document.getElementById('btn-nueva-cuenta').hidden = usuarioRol !== 'admin';
  const usuarioChip = document.getElementById('usuario-chip');
  if (usuarioChip) usuarioChip.textContent = usuarioNombre || '';

  // Mismo patrón "local primero, Sheets en segundo plano" que ya usan los
  // demás módulos: se pinta de inmediato con el último árbol guardado en
  // este dispositivo, sin esperar a la red.
  try {
    const guardado = localStorage.getItem('r56-cuentas-arbol');
    if (guardado) {
      const data = JSON.parse(guardado);
      arbolActual = data.arbol || [];
      esAdminActual = !!data.esAdmin;
      renderArbol();
    }
  } catch (err) {}

  cargarArbol();
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

// ---------- Cargar y pintar el árbol ----------

async function cargarArbol() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=cuentas_arbol&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar Cuentas.', 'error'); return; }
    arbolActual = data.arbol || [];
    esAdminActual = !!data.esAdmin;
    try { localStorage.setItem('r56-cuentas-arbol', JSON.stringify({ arbol: arbolActual, esAdmin: esAdminActual })); } catch (err) {}
    renderArbol();
  } catch (err) {
    mostrarToast('Sin conexión — mostrando lo último guardado.', 'warn');
  }
}

// Guarda qué cuentas estaban expandidas para no cerrarlas de golpe cada
// vez que se refresca el árbol después de guardar algo.
const cuentasExpandidas = new Set();

function renderArbol() {
  const cont = document.getElementById('cuentas-lista');
  cuentasIndice = {};
  arbolActual.forEach(grupo => grupo.cuentas.forEach(c => { cuentasIndice[c.id] = c; }));

  if (arbolActual.length === 0) {
    cont.innerHTML = '<div class="cuentas-vacio">Todavía no hay cuentas registradas.</div>';
    return;
  }

  cont.innerHTML = arbolActual.map(grupo => `
    <div class="agricultor-grupo">
      <div class="agricultor-titulo">${grupo.agricultor}</div>
      ${grupo.cuentas.map(c => renderCuentaCard(c)).join('')}
    </div>
  `).join('');
}

function renderCuentaCard(c) {
  const expandida = cuentasExpandidas.has(c.id);
  const rondaAbierta = c.rondas.find(r => r.abierta);

  let resumenHtml;
  if (rondaAbierta) {
    resumenHtml = `
      <div class="cuenta-resumen-dato">Ingresado<br><b>$${fmt(rondaAbierta.ingresado)}</b></div>
      <div class="cuenta-resumen-dato">Asignado<br><b>$${fmt(rondaAbierta.asignado)}</b></div>
      ${rondaAbierta.sobreTope ? '<span class="badge-alerta">⚠ Sobre el tope</span>' : '<span class="badge-abierta">Ronda abierta</span>'}
    `;
  } else if (c.sinRonda) {
    resumenHtml = `
      <div class="cuenta-resumen-dato">Ingresado<br><b>$${fmt(c.sinRonda.ingresado)}</b></div>
      <div class="cuenta-resumen-dato">Asignado<br><b>$${fmt(c.sinRonda.asignado)}</b></div>
      <span class="badge-pagos">Pagos entrantes</span>
    `;
  } else {
    resumenHtml = '<span class="cuenta-sin-ronda">Sin asignación activa</span>';
  }

  return `
    <div class="cuenta-card ${expandida ? 'expandida' : ''} ${c.activa ? '' : 'inactiva'}" data-cuenta-id="${c.id}">
      <div class="cuenta-cabecera" data-toggle="${c.id}">
        <div class="cuenta-nombre">${c.nombreCuenta}${!c.activa ? '<span class="inactiva-tag">Inactiva</span>' : ''}</div>
        <div class="cuenta-resumen">${resumenHtml}<span class="chevron">▶</span></div>
      </div>
      <div class="cuenta-detalle">${renderCuentaDetalle(c)}</div>
    </div>
  `;
}

function renderCuentaDetalle(c) {
  const datosBanco = `
    <div class="cuenta-datos-banco">
      <div class="dato-fila"><b>Banco</b><span>${c.banco || '—'}</span></div>
      <div class="dato-fila"><b>Sucursal</b><span>${c.sucursal || '—'}</span></div>
      ${esAdminActual
        ? `<div class="dato-fila"><b>Cuenta</b><span>${c.numCuenta || '—'}</span></div>
           <div class="dato-fila"><b>CLABE</b><span>${c.clave || '—'}</span></div>`
        : `<div class="dato-oculto">Solo un administrador puede ver el número de cuenta y la CLABE completos.</div>`}
    </div>
  `;

  const accionesCuenta = esAdminActual ? `
    <div class="cuenta-acciones-fila">
      <button class="btn-chico" data-editar-cuenta="${c.id}" type="button">✏️ Editar cuenta</button>
    </div>
  ` : '';

  const avisoSinRonda = c.sinRonda ? `
    <div class="aviso-sin-ronda">
      🟠 Esta cuenta ya está recibiendo pagos (Ingresado $${fmt(c.sinRonda.ingresado)}${c.sinRonda.asignado ? ` · Asignado $${fmt(c.sinRonda.asignado)}` : ''}) aunque todavía no tiene tope. El dinero se sigue sumando solo — abre una ronda con "+ Nuevo monto" cuando quieras ponerle tope y fecha de inicio formal.
    </div>
  ` : '';

  const rondasHtml = c.rondas.length === 0
    ? '<div class="cuenta-sin-ronda" style="margin:8px 0;">Esta cuenta todavía no ha tenido ninguna asignación de monto.</div>'
    : c.rondas.map(r => renderRondaFila(r)).join('');

  const btnNuevoMonto = esAdminActual ? `
    <button class="btn-chico dorado btn-nuevo-monto" data-nuevo-monto="${c.id}" type="button">+ Nuevo monto</button>
  ` : '';

  return `
    ${datosBanco}
    ${accionesCuenta}
    ${avisoSinRonda}
    <div class="rondas-titulo">Historial de asignaciones</div>
    ${rondasHtml}
    ${btnNuevoMonto}
  `;
}

function renderRondaFila(r) {
  const restaClase = r.resta < 0 ? 'negativo' : (r.resta > 0 ? 'positivo' : '');
  const estadoBadge = r.abierta
    ? (r.sobreTope ? '<span class="badge-alerta">⚠ Sobre el tope</span>' : '<span class="badge-abierta">Abierta</span>')
    : `<span class="badge-cerrada">Cerrada ${fechaCorta(r.fechaCierre)}</span>`;

  const acciones = esAdminActual ? `
    <div class="ronda-acciones">
      ${r.abierta
        ? `<button class="btn-chico" data-cerrar-ronda="${r.id}" type="button">Cerrar ronda</button>`
        : `<button class="btn-chico" data-reabrir-ronda="${r.id}" data-reabrir-fecha="${r.fechaInicio}" type="button">Reabrir ronda</button>`}
    </div>
  ` : '';

  return `
    <div class="ronda-fila ${r.abierta ? 'abierta' : ''} ${r.sobreTope ? 'sobretope' : ''}">
      <div class="ronda-cabecera">
        <div class="ronda-fecha">Desde <b>${fechaCorta(r.fechaInicio)}</b> · Tope <b>$${fmt(r.tope)}</b></div>
        ${estadoBadge}
      </div>
      <div class="ronda-numeros">
        <div class="ronda-numero"><div class="etq">Ingresado</div><div class="val">$${fmt(r.ingresado)}</div></div>
        <div class="ronda-numero"><div class="etq">Asignado</div><div class="val">$${fmt(r.asignado)}</div></div>
        <div class="ronda-numero"><div class="etq">Resta</div><div class="val ${restaClase}">$${fmt(r.resta)}</div></div>
        <div class="ronda-numero"><div class="etq">Tope</div><div class="val">$${fmt(r.tope)}</div></div>
      </div>
      ${acciones}
    </div>
  `;
}

// ---------- Expandir / colapsar + acciones dentro del árbol ----------

document.getElementById('cuentas-lista').addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const id = toggle.dataset.toggle;
    if (cuentasExpandidas.has(id)) cuentasExpandidas.delete(id); else cuentasExpandidas.add(id);
    renderArbol();
    return;
  }

  const editarBtn = e.target.closest('[data-editar-cuenta]');
  if (editarBtn) { abrirModalCuenta(editarBtn.dataset.editarCuenta); return; }

  const nuevoMontoBtn = e.target.closest('[data-nuevo-monto]');
  if (nuevoMontoBtn) { abrirModalRonda(nuevoMontoBtn.dataset.nuevoMonto); return; }

  const cerrarBtn = e.target.closest('[data-cerrar-ronda]');
  if (cerrarBtn) {
    const rondaId = cerrarBtn.dataset.cerrarRonda;
    if (!confirm('¿Cerrar esta ronda? Ingresado/Asignado/Resta quedan congelados como están ahora mismo. Se puede reabrir después si fue un error.')) return;
    cerrarBtn.disabled = true;
    try {
      const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=cuenta_ronda_cerrar&token=${encodeURIComponent(tokenActual)}&rondaId=${encodeURIComponent(rondaId)}`);
      if (!data.ok) { mostrarToast(data.error || 'No se pudo cerrar la ronda.', 'error'); return; }
      mostrarToast('Ronda cerrada.', 'ok');
      await cargarArbol();
    } catch (err) {
      mostrarToast('Sin conexión — no se pudo cerrar la ronda.', 'error');
    } finally {
      cerrarBtn.disabled = false;
    }
    return;
  }

  const reabrirBtn = e.target.closest('[data-reabrir-ronda]');
  if (reabrirBtn) {
    const rondaId = reabrirBtn.dataset.reabrirRonda;
    const fechaActual = reabrirBtn.dataset.reabrirFecha || '';
    // Permite ajustar la fecha de inicio al reabrir — por si la cuenta se
    // reactiva para un periodo nuevo en vez de continuar el anterior. Si
    // se deja igual, no cambia nada.
    const nuevaFecha = prompt('¿Reabrir esta ronda? Puedes ajustar su fecha de inicio (los pagos desde esa fecha se le sumarán). Déjala igual si no cambia.', fechaActual);
    if (nuevaFecha === null) return;
    reabrirBtn.disabled = true;
    try {
      let url = `${APPS_SCRIPT_URL}?action=cuenta_ronda_reabrir&token=${encodeURIComponent(tokenActual)}&rondaId=${encodeURIComponent(rondaId)}`;
      const fechaLimpia = nuevaFecha.trim();
      if (fechaLimpia && fechaLimpia !== fechaActual && /^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
        url += `&fechaInicio=${encodeURIComponent(fechaLimpia)}`;
      }
      const data = await llamarJSONP(url);
      if (!data.ok) { mostrarToast(data.error || 'No se pudo reabrir la ronda.', 'error'); return; }
      mostrarToast('Ronda reabierta.', 'ok');
      await cargarArbol();
    } catch (err) {
      mostrarToast('Sin conexión — no se pudo reabrir la ronda.', 'error');
    } finally {
      reabrirBtn.disabled = false;
    }
    return;
  }
});

// ---------- Modal: alta / edición de cuenta ----------

function abrirModalCuenta(id) {
  cuentaEnEdicion = id || null;
  const c = id ? cuentasIndice[id] : null;
  document.getElementById('modal-cuenta-titulo').textContent = c ? 'Editar cuenta' : 'Nueva cuenta';
  document.getElementById('cuenta-nombre-input').value = c ? c.nombreCuenta : '';
  document.getElementById('cuenta-agricultor-input').value = c ? c.agricultor : '';
  document.getElementById('cuenta-banco-input').value = c ? c.banco : '';
  document.getElementById('cuenta-sucursal-input').value = c ? c.sucursal : '';
  document.getElementById('cuenta-numcuenta-input').value = '';
  document.getElementById('cuenta-clave-input').value = '';
  document.getElementById('cuenta-activa-select').value = c && !c.activa ? 'no' : 'si';
  document.getElementById('cuenta-error').textContent = '';
  document.getElementById('modal-cuenta').hidden = false;
}

document.getElementById('btn-nueva-cuenta').addEventListener('click', () => abrirModalCuenta(null));
document.getElementById('cuenta-cancelar').addEventListener('click', () => { document.getElementById('modal-cuenta').hidden = true; });

document.getElementById('cuenta-guardar-btn').addEventListener('click', async () => {
  const nombreCuenta = document.getElementById('cuenta-nombre-input').value.trim();
  const errorBox = document.getElementById('cuenta-error');
  if (!nombreCuenta) { errorBox.textContent = 'Falta el nombre de la cuenta.'; return; }
  errorBox.textContent = '';

  const params = new URLSearchParams({
    action: 'cuenta_guardar',
    token: tokenActual,
    id: cuentaEnEdicion || '',
    nombreCuenta: nombreCuenta,
    agricultor: document.getElementById('cuenta-agricultor-input').value.trim(),
    banco: document.getElementById('cuenta-banco-input').value.trim(),
    sucursal: document.getElementById('cuenta-sucursal-input').value.trim(),
    numCuenta: document.getElementById('cuenta-numcuenta-input').value.trim(),
    clave: document.getElementById('cuenta-clave-input').value.trim(),
    activa: document.getElementById('cuenta-activa-select').value
  });

  const boton = document.getElementById('cuenta-guardar-btn');
  boton.disabled = true;
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
    if (!data.ok) { errorBox.textContent = data.error || 'No se pudo guardar la cuenta.'; return; }
    document.getElementById('modal-cuenta').hidden = true;
    mostrarToast('Cuenta guardada.', 'ok');
    await cargarArbol();
  } catch (err) {
    errorBox.textContent = 'Sin conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
  }
});

// ---------- Modal: nuevo monto (crea ronda, o solo actualiza el tope si ya hay una abierta) ----------

function abrirModalRonda(cuentaId) {
  rondaContextoCuentaId = cuentaId;
  const c = cuentasIndice[cuentaId];
  const rondaAbierta = c ? c.rondas.find(r => r.abierta) : null;

  document.getElementById('ronda-tope-input').value = '';
  document.getElementById('ronda-error').textContent = '';

  if (rondaAbierta) {
    document.getElementById('modal-ronda-titulo').textContent = 'Actualizar tope';
    document.getElementById('modal-ronda-sub').textContent = `Esta cuenta ya tiene una ronda abierta desde el ${fechaCorta(rondaAbierta.fechaInicio)} — esto solo le cambia el tope, sin afectar lo ya ingresado/asignado.`;
    document.getElementById('ronda-tope-input').value = rondaAbierta.tope || '';
    document.getElementById('campo-ronda-fecha').hidden = true;
  } else {
    document.getElementById('modal-ronda-titulo').textContent = 'Nuevo monto';
    document.getElementById('modal-ronda-sub').textContent = 'Esta cuenta no tiene ninguna ronda abierta — se crea una nueva.';
    document.getElementById('campo-ronda-fecha').hidden = false;
    document.getElementById('ronda-fecha-input').value = fechaHoyISO();
  }

  document.getElementById('modal-ronda').hidden = false;
}

document.getElementById('ronda-cancelar').addEventListener('click', () => { document.getElementById('modal-ronda').hidden = true; });

document.getElementById('ronda-guardar-btn').addEventListener('click', async () => {
  const errorBox = document.getElementById('ronda-error');
  const tope = Number(document.getElementById('ronda-tope-input').value);
  if (!tope || tope <= 0) { errorBox.textContent = 'El tope debe ser un monto mayor a cero.'; return; }
  errorBox.textContent = '';

  const params = new URLSearchParams({
    action: 'cuenta_ronda_guardar',
    token: tokenActual,
    cuentaId: rondaContextoCuentaId,
    tope: String(tope)
  });
  const fechaInput = document.getElementById('ronda-fecha-input');
  if (!document.getElementById('campo-ronda-fecha').hidden && fechaInput.value) {
    params.set('fechaInicio', fechaInput.value);
  }

  const boton = document.getElementById('ronda-guardar-btn');
  boton.disabled = true;
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
    if (!data.ok) { errorBox.textContent = data.error || 'No se pudo guardar.'; return; }
    document.getElementById('modal-ronda').hidden = true;
    cuentasExpandidas.add(rondaContextoCuentaId);
    mostrarToast(data.creada ? 'Ronda nueva creada.' : 'Tope actualizado.', 'ok');
    await cargarArbol();
  } catch (err) {
    errorBox.textContent = 'Sin conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
  }
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
