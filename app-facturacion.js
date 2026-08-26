// Bodega R-56 — Módulo Facturación — Lógica de la app
//
// Comparte sesión (login) e IndexedDB con los demás módulos — un solo
// inicio de sesión sirve en toda la app. Dos pestañas: "En construcción"
// (compendios ABIERTOS del día, uno por agricultor, armados desde el botón
// "Solicitar factura" del módulo Pagos) y "Registro" (historial de
// compendios ya CERRADOS + reporte por mes/cuenta). Usa las acciones nuevas
// de Code.gs: compendios_abiertos, compendio_preview, compendio_cerrar,
// compendio_reabrir, factura_bloque_actualizar, factura_bloque_eliminar,
// facturas_registro.

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
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function mesLegible(m) {
  if (!m) return '—';
  const partes = String(m).split('-');
  if (partes.length !== 2) return m;
  const mes = MESES_LARGOS[Number(partes[1]) - 1] || partes[1];
  return `${mes} ${partes[0]}`;
}
const FORMA_LABELS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque' };

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let tabActual = 'construccion';
let registroCargado = false;
let agricultorQuery = null;   // ?agricultor= de la URL (viene de "Solicitar factura" en Pagos)
let agricultorQueryUsado = false;

let compendiosAbiertos = [];  // acción "compendios_abiertos"
let registroResumen = [];     // acción "facturas_registro" -> resumen
let registroDetalle = [];     // acción "facturas_registro" -> detalle

// Contexto del modal de vista previa / cierre de un compendio
let previewCompendioActual = null;

// Contexto del modal de edición de un bloque (factura) dentro de un compendio abierto
let bloqueEnEdicionId = null;
let bloquePartidasActuales = [];

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
  document.getElementById('reabrir-panel').hidden = usuarioRol !== 'admin';
  const usuarioChip = document.getElementById('usuario-chip');
  if (usuarioChip) usuarioChip.textContent = usuarioNombre || '';

  try {
    agricultorQuery = new URLSearchParams(location.search).get('agricultor') || null;
  } catch (err) { agricultorQuery = null; }

  cargarCompendiosAbiertos();
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

// ---------- Pestañas ----------

function cambiarTab(tab) {
  tabActual = tab;
  document.getElementById('tab-btn-construccion').classList.toggle('activo', tab === 'construccion');
  document.getElementById('tab-btn-registro').classList.toggle('activo', tab === 'registro');
  document.getElementById('tab-construccion').hidden = tab !== 'construccion';
  document.getElementById('tab-registro').hidden = tab !== 'registro';
  if (tab === 'registro' && !registroCargado) { registroCargado = true; cargarRegistro(); }
}
document.getElementById('tab-btn-construccion').addEventListener('click', () => cambiarTab('construccion'));
document.getElementById('tab-btn-registro').addEventListener('click', () => cambiarTab('registro'));

// ---------- Tab "En construcción" ----------

async function cargarCompendiosAbiertos() {
  document.getElementById('compendios-lista').innerHTML = '<div class="compendios-vacio">Cargando…</div>';
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=compendios_abiertos&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { compendiosAbiertos = []; mostrarToast(data.error || 'No se pudieron cargar los compendios.', 'error'); }
    else compendiosAbiertos = data.compendios || [];
  } catch (err) {
    compendiosAbiertos = [];
    mostrarToast('Sin conexión — no se pudieron cargar los compendios abiertos.', 'warn');
  }
  renderCompendiosAbiertos();

  if (agricultorQuery && !agricultorQueryUsado) {
    agricultorQueryUsado = true;
    const compendio = compendiosAbiertos.find(c => c.agricultor === agricultorQuery);
    if (compendio) {
      const card = document.querySelector(`.compendio-card[data-compendio-id="${compendio.id}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function renderCompendiosAbiertos() {
  const cont = document.getElementById('compendios-lista');
  if (compendiosAbiertos.length === 0) {
    cont.innerHTML = '<div class="compendios-vacio">No hay compendios en construcción hoy — se crean solos al solicitar una factura desde el módulo Pagos.</div>';
    return;
  }
  cont.innerHTML = compendiosAbiertos.map(c => renderCompendioCard(c)).join('');
}

function renderCompendioCard(c) {
  const bloquesHtml = c.bloques.length === 0
    ? '<div class="bloque-vacio">Sin facturas todavía.</div>'
    : c.bloques.map(b => renderBloqueFila(b)).join('');
  return `
    <div class="compendio-card" data-compendio-id="${c.id}">
      <div class="compendio-header">
        <div class="compendio-agricultor">${c.agricultor}</div>
        <div class="compendio-total">$${fmt(c.total)}</div>
      </div>
      ${bloquesHtml}
      <div class="compendio-acciones">
        <button class="btn-chico dorado" data-preview-compendio="${c.id}" type="button">👁 Vista previa</button>
      </div>
    </div>
  `;
}

function miniPartidas(partidas) {
  if (!partidas || partidas.length === 0) return 'Sin partidas.';
  return partidas.map(p => `${p.tamano || '—'} · ${fmt(p.cantidad)} X $${fmt(p.precio)}`).join(' · ');
}

function renderBloqueFila(b) {
  return `
    <div class="bloque-fila" data-bloque-id="${b.id}">
      <div class="bloque-cliente">${b.cliente}</div>
      <div class="bloque-meta">${b.cuentaNombre || ''} · $${fmt(b.monto)} · ${FORMA_LABELS[b.forma] || b.forma}</div>
      <div class="bloque-partidas-mini">${miniPartidas(b.partidas)}</div>
      <div class="bloque-acciones">
        <button class="btn-chico" data-editar-bloque="${b.id}" type="button">✏️ Editar</button>
        <button class="btn-chico peligro" data-quitar-bloque="${b.id}" type="button">🗑 Quitar</button>
      </div>
    </div>
  `;
}

document.getElementById('compendios-lista').addEventListener('click', (e) => {
  const previewBtn = e.target.closest('[data-preview-compendio]');
  if (previewBtn) { abrirPreviewCompendio(previewBtn.dataset.previewCompendio); return; }
  const editarBtn = e.target.closest('[data-editar-bloque]');
  if (editarBtn) { abrirModalBloqueEditar(editarBtn.dataset.editarBloque); return; }
  const quitarBtn = e.target.closest('[data-quitar-bloque]');
  if (quitarBtn) { quitarBloque(quitarBtn.dataset.quitarBloque); }
});

async function quitarBloque(bloqueId) {
  if (!confirm('¿Quitar esta factura del compendio?')) return;
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=factura_bloque_eliminar&token=${encodeURIComponent(tokenActual)}&bloqueId=${encodeURIComponent(bloqueId)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo quitar la factura.');
    mostrarToast('Factura quitada del compendio.', 'ok');
    await cargarCompendiosAbiertos();
  } catch (err) {
    mostrarToast(navigator.onLine ? `No se pudo quitar: ${err.message}` : 'Sin conexión — no se puede quitar sin conexión.', 'error');
  }
}

// ---------- Documento FACTURAS — mismo generador para vista previa en pantalla e impresión ----------

function generarDocumentoFacturasHTML(compendio) {
  const bloques = (compendio && compendio.bloques) || [];
  const bloquesHtml = bloques.map(b => {
    const filasPartidas = (b.partidas || []).map(p => `
      <tr>
        <td>${p.tamano || ''}</td>
        <td class="num">${fmt(p.cantidad)} X</td>
        <td class="num">$${fmt(p.precio)}</td>
        <td class="num">$${fmt(p.total != null ? p.total : (Number(p.cantidad) || 0) * (Number(p.precio) || 0))}</td>
      </tr>`).join('');
    const sumaFila = (b.partidas || []).length > 1
      ? `<tr class="doc-suma-fila"><td colspan="3">TOTAL</td><td class="num">$${fmt(b.sumaPartidas)}</td></tr>`
      : '';
    let pagoConTexto;
    if (b.forma === 'transferencia') pagoConTexto = `TRANSFERENCIA A ${b.cuentaNombre}.`;
    else if (b.forma === 'cheque') pagoConTexto = `CHEQUE A ${b.cuentaNombre}.`;
    else pagoConTexto = `${FORMA_LABELS[b.forma] || b.forma}${b.cuentaNombre ? ' A ' + b.cuentaNombre + '.' : '.'}`;

    return `
      <div class="doc-bloque">
        <div><span class="doc-cliente-label">CLIENTE:</span> <span class="doc-cliente-nombre">${b.cliente}</span></div>
        <table>
          <thead><tr><th>Tamaño</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
          <tbody>${filasPartidas}${sumaFila}</tbody>
        </table>
        <div class="doc-pago-con">PAGO CON<br><b>${pagoConTexto}</b></div>
        <div class="doc-fecha">${b.fechaLarga || ''}</div>
      </div>
    `;
  }).join('');

  return `<div class="doc-titulo">FACTURAS</div>${bloquesHtml || '<div style="text-align:center;color:var(--text-dim);padding:24px 0;">Sin facturas en este compendio.</div>'}`;
}

// ---------- Modal: vista previa / cierre / impresión de un compendio ----------

function abrirPreviewCompendio(compendioId) {
  const compendio = compendiosAbiertos.find(c => c.id === compendioId);
  if (!compendio) return;
  previewCompendioActual = compendio;
  document.getElementById('preview-compendio-titulo').textContent = `Vista previa — ${compendio.agricultor}`;
  document.getElementById('preview-compendio-documento').innerHTML = generarDocumentoFacturasHTML(compendio);
  document.getElementById('preview-compendio-error').textContent = '';
  const btnCerrarCompendio = document.getElementById('preview-compendio-cerrar-compendio-btn');
  btnCerrarCompendio.hidden = false;
  btnCerrarCompendio.disabled = compendio.bloques.length === 0;
  btnCerrarCompendio.textContent = 'Cerrar compendio';
  document.getElementById('preview-compendio-imprimir-btn').hidden = true;
  document.getElementById('modal-preview-compendio').hidden = false;
}

document.getElementById('preview-compendio-cerrar-modal').addEventListener('click', () => {
  document.getElementById('modal-preview-compendio').hidden = true;
});

document.getElementById('preview-compendio-cerrar-compendio-btn').addEventListener('click', async () => {
  if (!previewCompendioActual) return;
  const boton = document.getElementById('preview-compendio-cerrar-compendio-btn');
  const errorBox = document.getElementById('preview-compendio-error');
  errorBox.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Cerrando…';
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=compendio_cerrar&token=${encodeURIComponent(tokenActual)}&compendioId=${encodeURIComponent(previewCompendioActual.id)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo cerrar el compendio.');
    mostrarToast('Compendio cerrado.', 'ok');
    document.getElementById('preview-compendio-titulo').textContent = `Compendio cerrado — ${previewCompendioActual.agricultor}`;
    boton.hidden = true;
    document.getElementById('preview-compendio-imprimir-btn').hidden = false;
    await cargarCompendiosAbiertos(); // este compendio ya no sale en "abiertos"
  } catch (err) {
    errorBox.textContent = navigator.onLine ? err.message : 'Sin conexión — no se puede cerrar sin conexión.';
  } finally {
    boton.disabled = false;
    boton.textContent = 'Cerrar compendio';
  }
});

document.getElementById('preview-compendio-imprimir-btn').addEventListener('click', () => {
  if (!previewCompendioActual) return;
  document.getElementById('print-area-facturas').innerHTML = generarDocumentoFacturasHTML(previewCompendioActual);
  const estiloPagina = document.createElement('style');
  estiloPagina.id = 'estilo-pagina-facturas';
  estiloPagina.textContent = '@page { size: auto; margin: 14mm; }';
  document.head.appendChild(estiloPagina);
  document.body.classList.add('imprimiendo-facturas');
  window.print();
});

window.addEventListener('afterprint', () => {
  document.body.classList.remove('imprimiendo-facturas');
  const estiloPagina = document.getElementById('estilo-pagina-facturas');
  if (estiloPagina) estiloPagina.remove();
});

// ---------- Modal: editar un bloque (factura) dentro de un compendio abierto ----------
// Mismo patrón visual de partidas editables que usa app-pagos.js al
// solicitar una factura, pero aquí SIEMPRE en modo edición (no hay
// alternar solo-lectura, porque entrar aquí ya es "voy a corregir algo").

function encontrarBloquePorId(bloqueId) {
  for (const c of compendiosAbiertos) {
    const b = c.bloques.find(x => x.id === bloqueId);
    if (b) return b;
  }
  return null;
}

function abrirModalBloqueEditar(bloqueId) {
  const bloque = encontrarBloquePorId(bloqueId);
  if (!bloque) { mostrarToast('No se encontró esa factura.', 'error'); return; }
  bloqueEnEdicionId = bloqueId;
  document.getElementById('bloque-cliente-input').value = bloque.cliente || '';
  bloquePartidasActuales = JSON.parse(JSON.stringify(bloque.partidas || []));
  document.getElementById('bloque-error').textContent = '';
  renderBloquePartidasTabla();
  document.getElementById('modal-bloque-editar').hidden = false;
}

document.getElementById('bloque-cancelar').addEventListener('click', () => { document.getElementById('modal-bloque-editar').hidden = true; });

function renderBloquePartidasTabla() {
  const cont = document.getElementById('bloque-partidas-tabla');
  const filas = bloquePartidasActuales.map((p, i) => `
    <div class="partidas-fila" data-idx="${i}">
      <input type="text" data-campo="tamano" value="${p.tamano || ''}" placeholder="Tamaño">
      <input type="number" data-campo="cantidad" value="${Number(p.cantidad) || 0}" min="0" step="1">
      <input type="number" data-campo="precio" value="${Number(p.precio) || 0}" min="0" step="0.01">
      <span class="num">$${fmt((Number(p.cantidad) || 0) * (Number(p.precio) || 0))}</span>
      <button type="button" class="quitar-partida-btn" data-quitar-partida="${i}" title="Quitar partida">🗑</button>
    </div>
  `).join('');

  const suma = bloquePartidasActuales.reduce((acc, p) => acc + (Number(p.cantidad) || 0) * (Number(p.precio) || 0), 0);

  cont.innerHTML = `
    <div class="partidas-tabla">
      <div class="partidas-fila head">
        <span>Tamaño</span><span>Cantidad</span><span>Precio</span><span>Total</span><span></span>
      </div>
      ${filas || '<div class="partidas-fila"><span style="color:var(--text-dim);">Sin partidas.</span></div>'}
    </div>
    <button type="button" class="btn-texto btn-agregar-partida" id="bloque-agregar-partida">+ Agregar partida</button>
    <div class="partidas-suma-fila"><span>Suma de partidas</span><span>$${fmt(suma)}</span></div>
  `;
}

document.getElementById('bloque-partidas-tabla').addEventListener('input', (e) => {
  const fila = e.target.closest('.partidas-fila[data-idx]');
  if (!fila) return;
  const idx = Number(fila.dataset.idx);
  const campo = e.target.dataset.campo;
  if (!campo || !bloquePartidasActuales[idx]) return;
  if (campo === 'tamano') bloquePartidasActuales[idx].tamano = e.target.value;
  else bloquePartidasActuales[idx][campo] = Number(e.target.value) || 0;
  const p = bloquePartidasActuales[idx];
  const totalSpan = fila.querySelector('.num');
  if (totalSpan) totalSpan.textContent = '$' + fmt((Number(p.cantidad) || 0) * (Number(p.precio) || 0));
  const sumaEl = document.querySelector('#bloque-partidas-tabla .partidas-suma-fila span:last-child');
  if (sumaEl) {
    const suma = bloquePartidasActuales.reduce((acc, x) => acc + (Number(x.cantidad) || 0) * (Number(x.precio) || 0), 0);
    sumaEl.textContent = '$' + fmt(suma);
  }
});

document.getElementById('bloque-partidas-tabla').addEventListener('click', (e) => {
  const quitar = e.target.closest('[data-quitar-partida]');
  if (quitar) { bloquePartidasActuales.splice(Number(quitar.dataset.quitarPartida), 1); renderBloquePartidasTabla(); return; }
  if (e.target.id === 'bloque-agregar-partida') { bloquePartidasActuales.push({ tamano: '', cantidad: 0, precio: 0, total: 0 }); renderBloquePartidasTabla(); }
});

document.getElementById('bloque-guardar-btn').addEventListener('click', async () => {
  const cliente = document.getElementById('bloque-cliente-input').value.trim();
  const errorBox = document.getElementById('bloque-error');
  if (!cliente) { errorBox.textContent = 'Falta el cliente de la factura.'; return; }
  errorBox.textContent = '';
  const boton = document.getElementById('bloque-guardar-btn');
  boton.disabled = true;
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const partidasFinal = bloquePartidasActuales.map(p => ({
      tamano: p.tamano || '', cantidad: Number(p.cantidad) || 0, precio: Number(p.precio) || 0,
      total: (Number(p.cantidad) || 0) * (Number(p.precio) || 0)
    }));
    const params = new URLSearchParams({
      action: 'factura_bloque_actualizar', token: tokenActual, bloqueId: bloqueEnEdicionId,
      clienteFactura: cliente, partidasJSON: JSON.stringify(partidasFinal)
    });
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo guardar.');
    document.getElementById('modal-bloque-editar').hidden = true;
    mostrarToast('Factura actualizada.', 'ok');
    await cargarCompendiosAbiertos();
  } catch (err) {
    errorBox.textContent = navigator.onLine ? err.message : 'Sin conexión — no se puede guardar sin conexión.';
  } finally {
    boton.disabled = false;
  }
});

// ---------- Tab "Registro" ----------

async function cargarRegistro() {
  document.getElementById('registro-resumen-lista').innerHTML = '<div class="vales-vacio">Cargando…</div>';
  document.getElementById('registro-detalle-lista').innerHTML = '<div class="vales-vacio">Cargando…</div>';
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=facturas_registro&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar el registro.', 'error'); registroResumen = []; registroDetalle = []; }
    else { registroResumen = data.resumen || []; registroDetalle = data.detalle || []; }
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar el registro.', 'warn');
    registroResumen = []; registroDetalle = [];
  }
  renderRegistro();
}

function renderRegistro() {
  const contResumen = document.getElementById('registro-resumen-lista');
  if (registroResumen.length === 0) {
    contResumen.innerHTML = '<div class="vales-vacio">Todavía no hay facturas registradas.</div>';
  } else {
    contResumen.innerHTML = `
      <div class="registro-fila head"><span>Mes</span><span>Agricultor</span><span>Cuenta</span><span>Cant.</span><span>Suma</span></div>
      ${registroResumen.map(r => `
        <div class="registro-fila">
          <span>${mesLegible(r.mes)}</span>
          <span>${r.agricultor || '—'}</span>
          <span>${r.cuentaNombre || '—'}</span>
          <span class="num">${fmt(r.cantidad)}</span>
          <span class="num">$${fmt(r.suma)}</span>
        </div>
      `).join('')}
    `;
  }

  const contDetalle = document.getElementById('registro-detalle-lista');
  if (registroDetalle.length === 0) {
    contDetalle.innerHTML = '<div class="vales-vacio">Todavía no hay facturas registradas.</div>';
  } else {
    const mostrarReabrir = usuarioRol === 'admin';
    contDetalle.innerHTML = `
      <div class="registro-fila-detalle head${mostrarReabrir ? ' con-reabrir' : ''}"><span>Cierre</span><span>Cliente</span><span>Agricultor</span><span>Cuenta</span><span>Monto</span><span>Total</span>${mostrarReabrir ? '<span></span>' : ''}</div>
      ${registroDetalle.map(d => `
        <div class="registro-fila-detalle${mostrarReabrir ? ' con-reabrir' : ''}">
          <span>${fechaCorta(d.fechaCierre)}</span>
          <span>${d.cliente}</span>
          <span>${d.agricultor || '—'}</span>
          <span>${d.cuentaNombre || '—'}</span>
          <span class="num">$${fmt(d.monto)}</span>
          <span class="num">$${fmt(d.total)}</span>
          ${mostrarReabrir ? `<span><button class="btn-chico" data-reabrir-fila="${d.compendioId}" type="button">🔓 Reabrir</button></span>` : ''}
        </div>
      `).join('')}
    `;
    if (mostrarReabrir) {
      contDetalle.querySelectorAll('[data-reabrir-fila]').forEach(btn => {
        btn.addEventListener('click', () => reabrirCompendio(btn.dataset.reabrirFila, btn));
      });
    }
  }
}

// ---------- Reabrir compendio cerrado (solo admin) ----------
// facturas_registro ya regresa compendioId en cada fila de "detalle" — el
// botón "🔓 Reabrir" de cada fila usa eso directamente. El campo de texto
// se deja como respaldo manual (por si algún día se necesita reabrir un
// compendio que ya no aparece en el detalle). Server-side ya es admin-only
// de cualquier forma (accionCompendioReabrir).

async function reabrirCompendio(compendioId, boton) {
  const errorBox = document.getElementById('reabrir-compendio-error');
  errorBox.textContent = '';
  if (!compendioId) { errorBox.textContent = 'Falta el ID del compendio.'; return; }
  const textoOriginal = boton ? boton.textContent : '';
  if (boton) { boton.disabled = true; boton.textContent = '…'; }
  try {
    if (!navigator.onLine) throw new Error('sin conexión');
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=compendio_reabrir&token=${encodeURIComponent(tokenActual)}&compendioId=${encodeURIComponent(compendioId)}`);
    if (data.error === 'no_autorizado') { errorBox.textContent = 'No autorizado.'; return; }
    if (!data.ok) throw new Error(data.error || 'No se pudo reabrir el compendio.');
    mostrarToast('Compendio reabierto — ve a "En construcción" para corregirlo.', 'ok');
    cambiarTab('construccion');
    await cargarCompendiosAbiertos();
  } catch (err) {
    errorBox.textContent = navigator.onLine ? err.message : 'Sin conexión. Intenta de nuevo.';
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = textoOriginal; }
  }
}

document.getElementById('reabrir-compendio-btn').addEventListener('click', () => {
  const idInput = document.getElementById('reabrir-compendio-id-input');
  const id = idInput.value.trim();
  reabrirCompendio(id, document.getElementById('reabrir-compendio-btn'));
  idInput.value = '';
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
