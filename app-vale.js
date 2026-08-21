// Bodega R-56 — Módulo 4: Nueva Venta / Vale — Lógica de la app
//
// Sigue exactamente la misma filosofía que el Módulo 3 (Manifiesto): tiene
// que funcionar SIN internet — el vale se guarda primero en IndexedDB
// (cola de "pendientes") y se sincroniza solo cuando hay señal. Comparte
// sesión (login) e IndexedDB con los Módulos 1 y 3 — un solo inicio de
// sesión sirve en toda la app.
//
// IMPORTANTE — acciones nuevas de backend que este archivo necesita y que
// TODAVÍA NO EXISTEN en Code.gs (ver code-gs-modulo4.txt para el código a
// pegar):
//   - action=disponible_venta   (lee carros abiertos + disponible por nave/tamaño)
//   - action=clientes           (lee catálogo de clientes para el autocompletado)
//   - action=venta_guardar      (guarda un vale, descuenta inventario)
//   - action=ventas_dia         (lista los vales guardados de una fecha, solo lectura)
// Mientras no estén en el backend, esta pantalla se ve y se siente completa
// pero fallará al intentar cargar disponible/clientes o guardar un vale de
// verdad — no es un bug de este archivo.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Misma base de datos que Módulos 1 y 3 — mismos 4 stores, misma versión.
// No se agrega ningún store nuevo: el vale usa el store genérico
// "pendientes" (igual que nave_guardar/manifiesto_crear en el Módulo 3),
// así no hace falta subir DB_VERSION ni tocar los otros dos archivos.
const DB_NAME = 'r56-dashboard';
const DB_VERSION = 3;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESION = 'sesion';
const STORE_MANIFIESTOS = 'manifiestosCache';
const STORE_PENDIENTES = 'pendientes';

// Los mismos 10 tamaños y el mismo orden/param que ya usa el Módulo 3
// (CAMPOS_TAMANO en app-manifiesto.js) — tiene que coincidir EXACTO para
// que "disponible" y "venta_guardar" hablen el mismo idioma que el
// manifiesto real.
const CAMPOS_TAMANO = [
  { param: 'cajasXL',      label: 'XL' },
  { param: 'cajasLG',      label: 'LG' },
  { param: 'cajasMD',      label: 'MD' },
  { param: 'cajasSM',      label: 'Small' },
  { param: 'cajasBola',    label: 'Bola' },
  { param: 'cajas2da',     label: 'Segunda' },
  { param: 'cajasGen',     label: 'Genérico' },
  { param: 'cajasPinto',   label: 'Pinto' },
  { param: 'cajasCan',     label: 'Canica' },
  { param: 'cajasAplical', label: 'Aplical' }
];
// Catálogo fijo de colores (no existe en el manifiesto — es propio de la
// venta, viene del vale de papel original).
const COLORES = ['Rojo', 'Naranja', '3/4', 'Rayado', 'Verde'];

// ---------- IndexedDB (idéntico a app.js / app-manifiesto.js) ----------

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

// ---------- Cola de pendientes (idéntico patrón al Módulo 3) ----------

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

function generarIdTemporal() {
  if (window.crypto && crypto.randomUUID) return 'tmp-' + crypto.randomUUID();
  return 'tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ---------- JSONP (idéntico a los otros módulos) ----------

let jsonpContador = 0;
function llamarJSONP(url, timeoutMs = 10000) {
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
function fechaHoyCDMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function folioStr(n) { return '#' + String(n).padStart(5, '0'); }

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let carrosDisponibles = [];   // respuesta de action=disponible_venta
let clientesCatalogo = [];    // respuesta de action=clientes
let vendidoEnEstaSesion = {}; // reserva local: key -> cajas ya asignadas en partidas de ESTE vale (para no sobrevender contra sí mismo antes de guardar)
let partidas = [];
let partidaAutoId = 1;
let pendingWarningResolve = null;
let ventasHoy = []; // acción ventas_dia — solo lectura, para el panel de "Vales guardados"
let sincronizando = false;
let folioEditando = null; // null = vale nuevo · número = editando ese vale ya guardado
let proximoFolio = null; // solo de referencia visual — el real lo asigna venta_guardar

// ---------- Sesión / Login (idéntico patrón al Módulo 3) ----------

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
  // El formulario se muestra de inmediato, vacío, sin esperar nada del
  // servidor — antes se esperaban 3 llamadas seguidas (disponible,
  // clientes, ventas del día), una detrás de otra, antes de dejar ver la
  // pantalla para capturar; eso era la tardanza de varios segundos al
  // entrar al módulo.
  partidas = [nuevaPartida()];
  renderPartidas();

  // Los catálogos se piden los 4 en paralelo (no uno tras otro) y cada
  // uno redibuja su parte en cuanto llega, sin bloquear a los demás.
  cargarDisponible().then(() => renderPartidas());
  cargarClientes();
  cargarVentasHoy();
  cargarSiguienteFolio();
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

// ---------- Catálogos: disponible (carros/naves) y clientes ----------

async function cargarDisponible() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=disponible_venta&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      carrosDisponibles = data.carros || [];
      localStorage.setItem('r56-disponible-venta', JSON.stringify(carrosDisponibles));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-disponible-venta');
    if (guardado) { try { carrosDisponibles = JSON.parse(guardado); } catch (e) {} }
    mostrarError('Sin conexión — mostrando el último disponible guardado. Puede no estar al día.');
  }
  renderManifiestoPanel();
}

async function cargarClientes() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=clientes&token=${encodeURIComponent(tokenActual)}`);
    if (data.ok) {
      clientesCatalogo = data.clientes || [];
      localStorage.setItem('r56-clientes-venta', JSON.stringify(clientesCatalogo));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-clientes-venta');
    if (guardado) { try { clientesCatalogo = JSON.parse(guardado); } catch (e) {} }
  }
}

async function cargarVentasHoy() {
  try {
    const fecha = fechaHoyCDMX();
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=ventas_dia&token=${encodeURIComponent(tokenActual)}&fecha=${fecha}`);
    if (data.ok) ventasHoy = data.ventas || [];
  } catch (err) { /* el panel de historial se queda con lo que ya tenía */ }
  renderHistorial();
}

// Solo de referencia — muestra en el recuadro de Folio, como marca de
// agua, el número que le tocaría al próximo vale. El número real y
// definitivo siempre lo asigna el servidor al guardar (venta_guardar).
async function cargarSiguienteFolio() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=siguiente_folio&token=${encodeURIComponent(tokenActual)}`);
    if (data.ok) proximoFolio = data.folio;
  } catch (err) { /* se queda con el último que traía */ }
  renderFolioChip();
}
function renderFolioChip() {
  const el = document.getElementById('folio-chip');
  if (el) el.textContent = proximoFolio ? folioStr(proximoFolio) : '—';
}

function mostrarError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}

// ---------- Disponible: lectura + reserva local mientras se arma el vale ----------

function getCarro(carroId) { return carrosDisponibles.find(c => c.id === carroId); }

// Cuando dos agricultores distintos tienen abierto el mismo número de carro
// (se repite cada temporada — "206 de Jesse" y "206 de Ramón" al mismo
// tiempo), elegir el carro por su número solo ya no alcanza para saber cuál
// de los dos es. Por eso la selección va en dos pasos: primero el número de
// carro (deduplicado — aparece una sola vez aunque lo tengan varios
// agricultores), y ese número decide qué agricultores ofrecer en el
// siguiente campo. Solo cuando también se elige el agricultor queda
// resuelto el manifiesto real (p.carroId).
// Siempre se compara como texto (String(...)) — la hoja de Google Sheets a
// veces guarda el número de carro como número real (206) y otras veces
// como texto ("206") según cómo se haya capturado, y el <select> del HTML
// siempre entrega su value como texto. Comparar 206 === "206" en
// JavaScript da false, así que sin este String(...) la lista de
// agricultores se quedaba vacía en cuanto el carro venía como número.
function carrosUnicosPorNumero() {
  const vistos = new Set();
  const resultado = [];
  carrosDisponibles.forEach(c => {
    const num = String(c.carro);
    if (!vistos.has(num)) { vistos.add(num); resultado.push(num); }
  });
  return resultado;
}
function carrosConNumero(numero) {
  return carrosDisponibles.filter(c => String(c.carro) === String(numero));
}

// El identificador real y único de cada nave es su NaveID (igual que en el
// Módulo 3 real) — el carro (ej. "205") es solo la etiqueta visible, y el
// invernadero/letra/semilla es texto que se repite entre naves distintas.
// Por eso las partidas guardan naveId, no el texto compuesto.
function getNave(carroId, naveId) {
  const carro = getCarro(carroId);
  if (!carro) return null;
  return (carro.naves || []).find(n => n.id === naveId) || null;
}

function disponibleBase(carroId, naveId, tamParam) {
  const nave = getNave(carroId, naveId);
  if (!nave) return 0;
  return Number(nave.disponible && nave.disponible[tamParam]) || 0;
}

// Ajusta "disponible" en memoria SIN esperar al servidor — el mismo truco
// que ya agilizó el Módulo 3 (aplicarNaveLocal): en vez de bloquear la
// pantalla hasta que Sheets confirme y volver a pedirle todo el catálogo,
// aplicamos aquí mismo el cambio que ya sabemos que va a pasar, y de todos
// modos se sincroniza solo con el servidor en segundo plano poco después.
// signo = -1 al vender (descuenta), +1 al restaurar (p.ej. al entrar a
// editar un vale ya guardado, se le regresa lo suyo mientras se edita).
function ajustarDisponibleLocal(filas, signo) {
  filas.forEach(f => {
    const carro = getCarro(f.manifiestoId);
    if (!carro) return;
    const nave = (carro.naves || []).find(n => n.id === f.naveId);
    if (!nave || !nave.disponible) return;
    const actual = Number(nave.disponible[f.tamano]) || 0;
    nave.disponible[f.tamano] = actual + signo * (Number(f.cajas) || 0);
  });
}

// Disponible real considerando lo que YA se apartó en otras partidas de este
// mismo vale (para no permitir, sin avisar, vender dos veces la misma caja
// dentro del mismo vale antes de guardarlo).
function disponibleParaTamano(p, tamParam) {
  if (!p.carroId || !p.naveId) return Infinity;
  const base = disponibleBase(p.carroId, p.naveId, tamParam);
  const reservadoOtras = partidas
    .filter(x => x.id !== p.id && x.carroId === p.carroId && x.naveId === p.naveId)
    .reduce((acc, x) => acc + (Number(x.cajasPorTamano[tamParam]) || 0), 0);
  return base - reservadoOtras;
}

// ---------- Partidas ----------

function nuevaPartida() {
  return {
    id: partidaAutoId++,
    carroNumero: '', carroId: '', naveId: '', precio: '',
    colores: new Set(),
    tamanos: new Set(),
    cajasPorTamano: {},
    cajasPendiente: '',
    overrideTamanos: new Set(),
    esMerma: false,
  };
}

function totalCajasPartida(p) {
  if (p.tamanos.size === 0) return Number(p.cajasPendiente) || 0;
  return Object.values(p.cajasPorTamano).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function addPartida() {
  if (partidas.length >= 5) return;
  partidas.push(nuevaPartida());
  renderPartidas();
}
function removePartida(id) {
  if (partidas.length <= 1) return;
  partidas = partidas.filter(p => p.id !== id);
  renderPartidas();
}
function getPartida(id) { return partidas.find(p => p.id === id); }

// ---------- Render: Partidas ----------

function renderPartidas() {
  const container = document.getElementById('partidas-container');
  container.innerHTML = '';
  partidas.forEach((p, idx) => container.appendChild(renderPartidaCard(p, idx)));
  document.getElementById('partidas-count').textContent = partidas.length + ' de 5';
  document.getElementById('btn-agregar-partida').disabled = partidas.length >= 5;
  computeTotales();
}

function renderPartidaCard(p, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'partida';
  const totalCajas = totalCajasPartida(p);
  const total = p.esMerma ? 0 : totalCajas * (Number(p.precio) || 0);
  const multiTamano = p.tamanos.size >= 2;
  const unicoTamano = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
  const cajasValue = unicoTamano ? (p.cajasPorTamano[unicoTamano] ?? '') : (multiTamano ? totalCajas : p.cajasPendiente);
  const carro = p.carroId ? getCarro(p.carroId) : null;
  // El número de carro puede tener varios agricultores abiertos a la vez
  // (se repite cada año) — el select de Agricultor solo ofrece los que de
  // verdad tienen ESE número abierto ahora mismo. Si nada más hay uno, no
  // hace falta que el usuario elija nada (se resuelve solo).
  const opcionesAgricultor = p.carroNumero ? carrosConNumero(p.carroNumero) : [];

  wrap.innerHTML = `
    <div class="partida-head">
      <span class="partida-tag">Partida ${idx + 1}</span>
      <div class="partida-head-derecha">
        <label class="chip-check merma ${p.esMerma ? 'checked' : ''}" title="Cierre de carro por merma/muestra/reposición — no se cobra">
          <input type="checkbox" data-merma="1" data-id="${p.id}" ${p.esMerma ? 'checked' : ''}>
          Merma
        </label>
        <span class="partida-total">$${fmt(total)}</span>
        <button class="partida-quitar" type="button" ${partidas.length <= 1 ? 'disabled' : ''} data-quitar="${p.id}">Quitar ✕</button>
      </div>
    </div>
    <div class="partida-body">
      <div class="row-campos">
        <div>
          <label>Carro</label>
          <select data-campo="carroNumero" data-id="${p.id}">
            <option value="">Seleccionar…</option>
            ${carrosUnicosPorNumero().map(num => `<option value="${num}" ${p.carroNumero === num ? 'selected' : ''}>${num}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Agricultor</label>
          <select data-campo="agricultor" data-id="${p.id}" ${!p.carroNumero ? 'disabled' : ''}>
            <option value="">${!p.carroNumero ? 'Elige un carro primero' : (opcionesAgricultor.length > 1 ? 'Seleccionar…' : '')}</option>
            ${opcionesAgricultor.map(c => `<option value="${c.id}" ${p.carroId === c.id ? 'selected' : ''}>${c.agricultor}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Invernadero</label>
          <select data-campo="invernadero" data-id="${p.id}" ${!p.carroId ? 'disabled' : ''}>
            <option value="">${p.carroId ? 'Seleccionar…' : 'Elige un carro primero'}</option>
            ${carro ? (carro.naves || []).map(n => {
              const compuesto = [n.invernadero, n.letra, n.semilla].filter(Boolean).join(' · ');
              return `<option value="${n.id}" ${p.naveId === n.id ? 'selected' : ''}>${compuesto}</option>`;
            }).join('') : ''}
          </select>
        </div>
        <div>
          <label>Cajas</label>
          <input type="number" min="0" step="1" data-campo="cajas" data-id="${p.id}" value="${cajasValue}" placeholder="0"
            ${multiTamano ? 'readonly title="Se calcula del desglose por tamaño de abajo"' : ''}>
        </div>
        <div>
          <label>Precio</label>
          <input type="number" min="0" step="1" data-campo="precio" data-id="${p.id}"
            value="${p.esMerma ? 0 : p.precio}" placeholder="0" ${p.esMerma ? 'disabled title="Merma: no se cobra"' : ''}>
        </div>
        <div>
          <label>Total</label>
          <div class="total-campo">$${fmt(total)}</div>
        </div>
      </div>

      ${p.esMerma ? `<div class="merma-nota">MERMA: esta partida no se cobra — solo descuenta inventario (cajas dañadas, muestra, reposición, etc.) para poder cerrar el carro.</div>` : ''}

      <div class="checks-fila">
        <div class="checks-grupo">
          <span class="g-label">Color (puedes elegir varios)</span>
          <div class="opciones">
            ${COLORES.map(col => `
              <label class="chip-check ${p.colores.has(col) ? 'checked' : ''}">
                <input type="checkbox" data-color="${col}" data-id="${p.id}" ${p.colores.has(col) ? 'checked' : ''}>
                ${col}
              </label>`).join('')}
          </div>
        </div>
        <div class="checks-grupo">
          <span class="g-label">Tamaño (puedes elegir varios)</span>
          <div class="opciones">
            ${CAMPOS_TAMANO.map(t => `
              <div class="size-unit">
                <label class="chip-check size ${p.tamanos.has(t.param) ? 'checked' : ''}">
                  <input type="checkbox" data-tamano-toggle="${t.param}" data-id="${p.id}" ${p.tamanos.has(t.param) ? 'checked' : ''}>
                  ${t.label}
                </label>
                ${multiTamano && p.tamanos.has(t.param) ? `
                  <input type="number" min="0" step="1" class="size-qty" data-tamano-cantidad="${t.param}" data-id="${p.id}"
                    value="${p.cajasPorTamano[t.param] ?? ''}" placeholder="0">` : ''}
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="agotado-aviso ${p.overrideTamanos.size > 0 ? 'show' : ''}" data-aviso="${p.id}">
        ⚠️ Vendiendo por encima del disponible en: ${[...p.overrideTamanos].map(param => (CAMPOS_TAMANO.find(t => t.param === param) || {}).label || param).join(', ')}
      </div>
    </div>
  `;
  return wrap;
}

function findCardEl(id) {
  return [...document.querySelectorAll('.partida')].find(el => el.querySelector(`[data-quitar="${id}"]`));
}
function rebuildCard(p) {
  const idx = partidas.findIndex(x => x.id === p.id);
  const old = findCardEl(p.id);
  if (old && idx !== -1) old.replaceWith(renderPartidaCard(p, idx));
  computeTotales();
}
function refreshCardNumbers(p) {
  const card = findCardEl(p.id);
  if (!card) return;
  const totalCajas = totalCajasPartida(p);
  const total = p.esMerma ? 0 : totalCajas * (Number(p.precio) || 0);
  card.querySelector('.partida-total').textContent = '$' + fmt(total);
  card.querySelector('.total-campo').textContent = '$' + fmt(total);
  const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
  const cajasInput = card.querySelector('[data-campo="cajas"]');
  if (cajasInput && document.activeElement !== cajasInput) {
    cajasInput.value = unico ? (p.cajasPorTamano[unico] ?? '') : (p.tamanos.size >= 2 ? totalCajas : p.cajasPendiente);
  }
  const aviso = card.querySelector(`[data-aviso="${p.id}"]`);
  if (aviso) {
    aviso.classList.toggle('show', p.overrideTamanos.size > 0);
    aviso.innerHTML = `⚠️ Vendiendo por encima del disponible en: ${[...p.overrideTamanos].map(param => (CAMPOS_TAMANO.find(t => t.param === param) || {}).label || param).join(', ')}`;
  }
  computeTotales();
}

function computeTotales() {
  const total = partidas.reduce((acc, p) => acc + (p.esMerma ? 0 : totalCajasPartida(p) * (Number(p.precio) || 0)), 0);
  document.getElementById('total-vale').textContent = '$' + fmt(total);
}

// ---------- Validación de inventario en tiempo real ----------

function mostrarModalAdvertencia(mensaje) {
  return new Promise((resolve) => {
    document.getElementById('modal-msg').textContent = mensaje;
    document.getElementById('modal-aviso').hidden = false;
    pendingWarningResolve = resolve;
  });
}
document.getElementById('modal-no-ajustar').addEventListener('click', () => {
  document.getElementById('modal-aviso').hidden = true;
  if (pendingWarningResolve) { pendingWarningResolve(false); pendingWarningResolve = null; }
});
document.getElementById('modal-si-continuar').addEventListener('click', () => {
  document.getElementById('modal-aviso').hidden = true;
  if (pendingWarningResolve) { pendingWarningResolve(true); pendingWarningResolve = null; }
});

async function validarInventarioTamano(p, tamParam) {
  const cajas = Number(p.cajasPorTamano[tamParam]) || 0;
  if (cajas <= 0) { p.overrideTamanos.delete(tamParam); return; }
  const disp = disponibleParaTamano(p, tamParam);
  if (cajas > disp) {
    const label = (CAMPOS_TAMANO.find(t => t.param === tamParam) || {}).label || tamParam;
    const continuar = await mostrarModalAdvertencia(`Ya vendiste todo el ${label} de esta partida. ¿Deseas continuar de todos modos?`);
    if (continuar) p.overrideTamanos.add(tamParam);
    else p.overrideTamanos.delete(tamParam);
  } else {
    p.overrideTamanos.delete(tamParam);
  }
}
async function validarTodosLosTamanos(p) {
  for (const t of p.tamanos) await validarInventarioTamano(p, t.param || t);
}

// ---------- Eventos delegados en partidas ----------

document.getElementById('partidas-container').addEventListener('change', async (e) => {
  const t = e.target;
  const id = Number(t.dataset.id);
  if (!id) return;
  const p = getPartida(id);
  if (!p) return;

  if (t.dataset.merma) {
    p.esMerma = t.checked;
    p.precio = p.esMerma ? '0' : '';
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'carroNumero') {
    p.carroNumero = t.value;
    // Si solo hay un agricultor con ese número de carro abierto, se
    // resuelve solo — no hace falta que el usuario elija nada en
    // Agricultor. Si hay varios (mismo número, distintos agricultores),
    // se queda sin resolver hasta que elija en el siguiente campo.
    const opciones = p.carroNumero ? carrosConNumero(p.carroNumero) : [];
    p.carroId = opciones.length === 1 ? opciones[0].id : '';
    p.naveId = '';
    p.overrideTamanos.clear();
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'agricultor') {
    p.carroId = t.value;
    p.naveId = '';
    p.overrideTamanos.clear();
    rebuildCard(p);
    return;
  }
  if (t.dataset.tamanoToggle) {
    const tam = t.dataset.tamanoToggle;
    if (t.checked) {
      p.tamanos.add(tam);
      if (p.tamanos.size === 1 && p.cajasPendiente) {
        p.cajasPorTamano[tam] = p.cajasPendiente;
        p.cajasPendiente = '';
      } else if (!(tam in p.cajasPorTamano)) {
        p.cajasPorTamano[tam] = '';
      }
      await validarInventarioTamano(p, tam);
    } else {
      if (p.tamanos.size === 1) p.cajasPendiente = p.cajasPorTamano[tam] ?? '';
      p.tamanos.delete(tam);
      delete p.cajasPorTamano[tam];
      p.overrideTamanos.delete(tam);
    }
    rebuildCard(p);
    return;
  }
  if (t.dataset.campo === 'invernadero') {
    p.naveId = t.value;
    p.overrideTamanos.clear();
    await validarTodosLosTamanos(p);
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.campo === 'cajas') {
    const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
    if (unico) { p.cajasPorTamano[unico] = t.value; await validarInventarioTamano(p, unico); }
    else if (p.tamanos.size === 0) { p.cajasPendiente = t.value; }
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.tamanoCantidad) {
    const tam = t.dataset.tamanoCantidad;
    p.cajasPorTamano[tam] = t.value;
    await validarInventarioTamano(p, tam);
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.campo === 'precio') {
    p.precio = t.value === '' ? '' : String(Math.round(Number(t.value)) || 0);
    t.value = p.precio;
    refreshCardNumbers(p);
    return;
  }
  if (t.dataset.color) {
    if (t.checked) p.colores.add(t.dataset.color); else p.colores.delete(t.dataset.color);
    t.closest('.chip-check').classList.toggle('checked', t.checked);
  }
});

document.getElementById('partidas-container').addEventListener('input', (e) => {
  const t = e.target;
  const id = Number(t.dataset.id);
  if (!id) return;
  const p = getPartida(id);
  if (!p) return;
  if (t.dataset.campo === 'precio') {
    p.precio = t.value;
    refreshCardNumbers(p);
  }
  if (t.dataset.campo === 'cajas') {
    const unico = p.tamanos.size === 1 ? [...p.tamanos][0] : null;
    if (unico) p.cajasPorTamano[unico] = t.value;
    else if (p.tamanos.size === 0) p.cajasPendiente = t.value;
    refreshCardNumbers(p);
  }
  if (t.dataset.tamanoCantidad) {
    p.cajasPorTamano[t.dataset.tamanoCantidad] = t.value;
    refreshCardNumbers(p);
  }
});

document.getElementById('partidas-container').addEventListener('click', (e) => {
  const id = e.target.dataset.quitar;
  if (id) removePartida(Number(id));
});
document.getElementById('btn-agregar-partida').addEventListener('click', addPartida);

// ---------- Cliente: autocompletado ----------

const clienteInput = document.getElementById('cliente-input');
const clienteSuggestions = document.getElementById('cliente-suggerencias');
clienteInput.addEventListener('input', () => {
  const q = clienteInput.value.trim().toUpperCase();
  if (!q) { clienteSuggestions.classList.remove('show'); return; }
  const opciones = clientesCatalogo.filter(c => c.nombre.toUpperCase().includes(q)).slice(0, 8);
  if (opciones.length === 0) { clienteSuggestions.classList.remove('show'); return; }
  clienteSuggestions.innerHTML = opciones.map(c => `<div class="opt" data-name="${c.nombre}">${c.nombre}</div>`).join('');
  clienteSuggestions.classList.add('show');
});
clienteInput.addEventListener('blur', () => setTimeout(() => clienteSuggestions.classList.remove('show'), 150));
clienteSuggestions.addEventListener('mousedown', (e) => {
  const name = e.target.closest('.opt')?.dataset.name;
  if (name) { clienteInput.value = name; clienteSuggestions.classList.remove('show'); }
});

// ---------- Panel de manifiesto (solo consulta) ----------

let manifiestoTabActivo = null;
function renderManifiestoPanel() {
  const tabsEl = document.getElementById('manifiesto-tabs');
  if (!manifiestoTabActivo || !getCarro(manifiestoTabActivo)) {
    manifiestoTabActivo = carrosDisponibles.length ? carrosDisponibles[0].id : null;
  }
  // Se le agrega el agricultor a la pestaña (no solo el número de carro) —
  // cuando dos agricultores distintos tienen abierto el mismo número
  // ("206" de Jesse y "206" de Ramón a la vez), con solo el número no se
  // sabía cuál pestaña era cuál.
  tabsEl.innerHTML = carrosDisponibles.map(c => `
    <button data-tab="${c.id}" class="${manifiestoTabActivo === c.id ? 'active' : ''} ${c.esDeHoy ? '' : 'tab-later'}"
      title="Carro ${c.carro} · ${c.agricultor}${c.esDeHoy ? '' : ' · abierto de días anteriores'}">${c.carro} · ${(c.agricultor || '').split(' ')[0]}${c.esDeHoy ? '' : ' ·'}</button>
  `).join('');

  const carro = getCarro(manifiestoTabActivo);
  const bodyEl = document.getElementById('manifiesto-body');
  if (!carro) { bodyEl.innerHTML = '<div class="manifiesto-vacio">Sin carros abiertos.</div>'; return; }

  let rows = '';
  (carro.naves || []).forEach(n => {
    const compuesto = [n.invernadero, n.letra, n.semilla].filter(Boolean).join(' · ');
    CAMPOS_TAMANO.forEach(t => {
      const actual = Number(n.disponible && n.disponible[t.param]) || 0;
      let cls = '';
      if (actual < 0) cls = 'negativo'; else if (actual === 0) cls = 'cero'; else if (actual <= 5) cls = 'bajo';
      rows += `<tr><td>${compuesto}</td><td>${t.label}</td><td style="text-align:right;"><span class="disp-badge ${cls}">${actual}</span></td></tr>`;
    });
  });
  if (!rows) rows = '<tr><td colspan="3" class="manifiesto-vacio-fila">Sin existencias registradas para este carro.</td></tr>';

  bodyEl.innerHTML = `
    <div class="manifiesto-meta">Carro <b>${carro.carro}</b> · Agricultor <b>${carro.agricultor}</b>${carro.esDeHoy ? '' : ' · <span class="badge-later">Abierto (no es de hoy)</span>'}</div>
    <table class="manifiesto-tabla">
      <thead><tr><th>Invernadero</th><th>Tamaño</th><th style="text-align:right;">Disponible</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
document.getElementById('manifiesto-tabs').addEventListener('click', (e) => {
  const id = e.target.dataset.tab;
  if (id) { manifiestoTabActivo = id; renderManifiestoPanel(); }
});

// ---------- Historial de vales del día (solo lectura por ahora) ----------

function renderHistorial() {
  const q = document.getElementById('historial-buscar').value.trim().toUpperCase();
  const listEl = document.getElementById('historial-lista');
  const items = [...ventasHoy].reverse().filter(v =>
    !q || folioStr(v.folio).toUpperCase().includes(q) || String(v.cliente).toUpperCase().includes(q)
  );
  if (items.length === 0) {
    listEl.innerHTML = `<div class="historial-vacio">${ventasHoy.length === 0 ? 'Todavía no hay vales guardados hoy.' : 'Sin resultados para esa búsqueda.'}</div>`;
    return;
  }
  const head = `<div class="historial-fila head"><span>Folio</span><span>Cliente</span><span>Tipo</span><span>Total</span><span></span></div>`;
  const rows = items.map(v => `
    <div class="historial-fila" data-folio="${v.folio}" role="button" tabindex="0" title="Tocar para editar este vale">
      <span>${folioStr(v.folio)}</span>
      <span>${v.cliente}</span>
      <span class="tipo-pill ${v.tipo === 'CRÉDITO' ? 'credito' : ''}">${v.tipo === 'CRÉDITO' ? 'Crédito' : 'Efectivo'}</span>
      <span class="monto">$${fmt(v.total)}</span>
      <span class="editar-icono" title="Modificar este vale">✏️</span>
    </div>`).join('');
  listEl.innerHTML = head + rows;
}
document.getElementById('historial-buscar').addEventListener('input', renderHistorial);
document.getElementById('btn-historial').addEventListener('click', () => {
  document.getElementById('historial-overlay').hidden = false;
});
document.getElementById('historial-lista').addEventListener('click', (e) => {
  const fila = e.target.closest('.historial-fila[data-folio]');
  if (fila) cargarValeParaEditar(Number(fila.dataset.folio));
});
document.getElementById('historial-cerrar').addEventListener('click', () => {
  document.getElementById('historial-overlay').hidden = true;
});
document.getElementById('historial-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'historial-overlay') document.getElementById('historial-overlay').hidden = true;
});

// ---------- Guardar / Imprimir / Limpiar (un solo botón) ----------

function partidasValidas() {
  return partidas.filter(p => p.carroId && p.naveId && p.tamanos.size > 0 && (p.esMerma || Number(p.precio) > 0) && totalCajasPartida(p) > 0);
}
function filasPorTamano(validas) {
  const filas = [];
  validas.forEach(p => {
    const carro = getCarro(p.carroId);
    const nave = getNave(p.carroId, p.naveId);
    p.tamanos.forEach(tamParam => {
      const cantidad = Number(p.cajasPorTamano[tamParam]) || 0;
      if (cantidad > 0) filas.push({
        manifiestoId: p.carroId, carro: carro ? carro.carro : '', agricultor: carro ? carro.agricultor : '',
        naveId: p.naveId, invernadero: nave ? nave.invernadero : '', letra: nave ? nave.letra : '', semilla: nave ? nave.semilla : '',
        tamano: tamParam, cajas: cantidad, precio: p.esMerma ? 0 : Number(p.precio), esMerma: !!p.esMerma
      });
    });
  });
  return filas;
}

function generarTicketHTML(folio, cliente, tipo, filas, totalVale) {
  const rows = filas.map(f => {
    const label = (CAMPOS_TAMANO.find(t => t.param === f.tamano) || {}).label || f.tamano;
    return `
    <tr>
      <td>${f.carro}</td>
      <td>${[f.invernadero, f.letra, f.semilla].filter(Boolean).join(' · ')}</td>
      <td>${label}${f.esMerma ? ' (MERMA)' : ''}</td>
      <td style="text-align:right;">${f.cajas}</td>
      <td style="text-align:right;">${f.esMerma ? '—' : '$' + fmt(f.precio)}</td>
      <td style="text-align:right;">${f.esMerma ? '—' : '$' + fmt(f.cajas * f.precio)}</td>
    </tr>`;
  }).join('');
  return `
    <h2>VALE DE VENTA</h2>
    <div class="center">Bodega R-56 · Tomates de Invernadero</div>
    <hr>
    <div><b>Folio:</b> ${folioStr(folio)} &nbsp; <b>Fecha:</b> ${fechaHoyCDMX()}</div>
    <div><b>Cliente:</b> ${cliente}</div>
    <div><b>Tipo:</b> ${tipo}</div>
    <hr>
    <table>
      <thead><tr><th>Carro</th><th>Invern.</th><th>Tam.</th><th>Cajas</th><th>Precio</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr>
    <div class="tot">TOTAL: $${fmt(totalVale)}</div>
    <div class="center" style="margin-top:10px;">___________________________<br>Firma / Sello</div>
  `;
}

function resetForm() {
  clienteInput.value = '';
  partidas = [nuevaPartida()];
  renderPartidas();
}

function actualizarBotonImprimirTexto() {
  const boton = document.getElementById('btn-imprimir');
  boton.textContent = folioEditando ? `💾 Guardar cambios (vale ${folioStr(folioEditando)})` : '🖨 Imprimir vale';
}

// Junta las filas planas de un vale guardado (una por tamaño) de vuelta en
// partidas (una por carro+nave+esMerma, como las arma el formulario) para
// poder recargarlo y editarlo. Si dos filas comparten carro+nave+esMerma
// se combinan en una sola partida (es lo que hubiera pasado si se hubieran
// capturado juntas desde el principio).
function reconstruirPartidasDesdeFilas(filas) {
  const grupos = {};
  const orden = [];
  filas.forEach(f => {
    const key = f.manifiestoId + '|' + f.naveId + '|' + (f.esMerma ? '1' : '0');
    if (!grupos[key]) {
      grupos[key] = {
        carroNumero: f.carro, carroId: f.manifiestoId, naveId: f.naveId, esMerma: !!f.esMerma,
        precio: f.esMerma ? '0' : String(f.precio || ''),
        tamanos: new Set(), cajasPorTamano: {}
      };
      orden.push(key);
    }
    grupos[key].tamanos.add(f.tamano);
    grupos[key].cajasPorTamano[f.tamano] = String(f.cajas);
  });
  return orden.slice(0, 5).map(key => Object.assign(nuevaPartida(), grupos[key]));
}

// ---------- Editar un vale ya guardado ----------

async function cargarValeParaEditar(folio) {
  try {
    const url = `${APPS_SCRIPT_URL}?action=venta_detalle&token=${encodeURIComponent(tokenActual)}&folio=${encodeURIComponent(folio)}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) { mostrarToast(data.error || 'No se pudo cargar ese vale.', 'warn'); return; }

    document.getElementById('historial-overlay').hidden = true;

    // Le regresamos localmente a "disponible" las cajas que ya tenía este
    // vale, para no toparnos con avisos de "ya no hay" al re-capturar sus
    // propias cajas mientras se edita.
    ajustarDisponibleLocal(data.filas, +1);
    renderManifiestoPanel();

    folioEditando = folio;
    clienteInput.value = data.cliente || '';
    partidas = reconstruirPartidasDesdeFilas(data.filas);
    if (partidas.length === 0) partidas = [nuevaPartida()];
    renderPartidas();
    actualizarBotonImprimirTexto();

    const banner = document.getElementById('editando-banner');
    banner.hidden = false;
    document.getElementById('editando-texto').textContent = `Editando vale ${folioStr(folio)} — al guardar se actualiza, no se crea uno nuevo.`;
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    mostrarToast('Sin conexión — no se pudo cargar ese vale para editar.', 'warn');
  }
}

document.getElementById('btn-cancelar-edicion').addEventListener('click', async () => {
  folioEditando = null;
  document.getElementById('editando-banner').hidden = true;
  resetForm();
  actualizarBotonImprimirTexto();
  await cargarDisponible(); // vuelve a traer del servidor el disponible real, sin el ajuste local temporal de arriba
});

document.getElementById('btn-imprimir').addEventListener('click', async () => {
  const validas = partidasValidas();
  if (validas.length === 0) {
    mostrarToast('Completa al menos una partida antes de guardar e imprimir', 'warn');
    return;
  }
  const filasNuevas = filasPorTamano(validas);
  const clienteRaw = clienteInput.value.trim();
  const cliente = clienteRaw || 'PÚBLICO GENERAL';
  const tipo = clienteRaw ? 'CRÉDITO' : 'EFECTIVO / PÚBLICO GENERAL';
  const totalVale = filasNuevas.reduce((a, f) => a + (f.esMerma ? 0 : f.cajas * f.precio), 0);
  const editandoAhora = folioEditando;
  const boton = document.getElementById('btn-imprimir');
  boton.disabled = true;
  boton.textContent = editandoAhora ? 'Guardando cambios...' : 'Guardando...';

  const payload = { cliente: clienteRaw, filas: filasNuevas, fecha: fechaHoyCDMX() };
  if (editandoAhora) payload.folioEditar = editandoAhora;

  try {
    let folioUsado = null;
    let ok = false;
    if (navigator.onLine) {
      try {
        const params = new URLSearchParams({ action: 'venta_guardar', token: tokenActual, cliente: clienteRaw, fecha: payload.fecha, filas: JSON.stringify(filasNuevas) });
        if (editandoAhora) params.set('folioEditar', editandoAhora);
        const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
        if (data.ok) { folioUsado = data.folio; ok = true; }
      } catch (err) { /* cae a la cola de pendientes abajo */ }
    }
    if (!ok) {
      await encolar('venta_guardar', payload);
      folioUsado = editandoAhora || 'PENDIENTE';
      mostrarToast('Sin conexión — el vale se guardó en este dispositivo y se sincronizará solo cuando regrese la señal.', 'info');
    } else {
      mostrarToast(`Vale ${folioStr(folioUsado)} ${editandoAhora ? 'actualizado' : 'guardado'} e impreso — ${cliente} — $${fmt(totalVale)}`, 'ok');
    }

    // Se aplica el descuento de inventario aquí mismo, sin esperar a que
    // Sheets confirme y sin volver a pedirle todo el catálogo — el mismo
    // truco que ya agilizó el Módulo 3. El folio y el ticket ya se pueden
    // mostrar/imprimir de inmediato.
    ajustarDisponibleLocal(filasNuevas, -1);
    renderManifiestoPanel();

    document.getElementById('print-area').innerHTML = generarTicketHTML(folioUsado === 'PENDIENTE' ? '?????' : folioUsado, cliente, tipo, filasNuevas, totalVale);
    window.print();

    folioEditando = null;
    document.getElementById('editando-banner').hidden = true;
    resetForm();
    actualizarBotonImprimirTexto();

    // El catálogo real y el historial se sincronizan en segundo plano —
    // esto ya NO bloquea que se pueda capturar el siguiente vale de
    // inmediato (antes eran dos idas y vueltas más antes de soltar la UI).
    cargarDisponible();
    cargarVentasHoy();
    // Solo si fue un vale NUEVO se consumió un folio — al editar uno ya
    // guardado, el próximo folio que le toca al siguiente vale no cambia.
    if (!editandoAhora) cargarSiguienteFolio();
  } finally {
    boton.disabled = false;
    actualizarBotonImprimirTexto();
  }
});

function mostrarToast(msg, tipo) {
  const el = document.getElementById('toast');
  el.textContent = (tipo === 'ok' ? '✓ ' : tipo === 'warn' ? '⚠ ' : 'ℹ ') + msg;
  el.className = tipo === 'ok' ? '' : 'toast--pendiente';
  el.hidden = false;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

// ---------- Sincronización de la cola cuando regresa la señal ----------

async function sincronizar() {
  if (sincronizando || !navigator.onLine || !tokenActual) return;
  sincronizando = true;
  try {
    const pendientes = await listarPendientes();
    for (const item of pendientes) {
      if (item.tipo !== 'venta_guardar') continue; // lo de otros módulos lo sincroniza su propia pantalla
      try {
        const p = item.payload;
        const params = new URLSearchParams({ action: 'venta_guardar', token: tokenActual, cliente: p.cliente, fecha: p.fecha, filas: JSON.stringify(p.filas) });
        if (p.folioEditar) params.set('folioEditar', p.folioEditar);
        const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
        if (!data.ok) throw new Error(data.error || 'error');
        await borrarPendiente(item.id);
      } catch (err) {
        break; // se corta la conexión a media pasada — se reintenta después, sin perder el orden
      }
    }
    await cargarDisponible();
    await cargarVentasHoy();
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
