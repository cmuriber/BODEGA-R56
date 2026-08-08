// Bodega R-56 — Módulo 3: Manifiesto de Carro — Lógica de la app
//
// La usan José, Fernando y Pablo (almacén) todos los días para registrar
// lo que trae cada camión, más los administradores cuando lo necesiten.
// Tiene que funcionar SIN internet en el andén: todo se guarda primero en
// IndexedDB y se sincroniza solo cuando hay señal (misma filosofía que el
// Dashboard, pero aquí también se puede ESCRIBIR sin conexión, no solo leer).

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzcXtBzWwZqWpBw7OdA-tLWYxR6g6RmSWUzCb9HQwFQK4yG9VnYtIHdipS3p7SIA7poLg/exec';

// Mismo nombre de base de datos que el Dashboard — así comparten sesión.
// DB_VERSION sube a 3 aquí y en app.js para agregar los stores nuevos.
const DB_NAME = 'r56-dashboard';
const DB_VERSION = 3;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_SESION = 'sesion';
const STORE_MANIFIESTOS = 'manifiestosCache';
const STORE_PENDIENTES = 'pendientes';

// Los 10 tamaños que se capturan por nave. "param" es el nombre que se usa
// tanto al mandar la petición al backend como en las respuestas — tiene que
// coincidir exactamente con CAMPOS_TAMANO del lado de Apps Script.
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

// ---------- Estado en memoria ----------

let tokenActual = null;
let usuarioRol = null;
let usuarioNombre = null;
let catalogos = null;
let estadoDia = null;       // { fecha, manifiestos: [...] }
let vistaActualId = null;   // id del manifiesto abierto en la vista de detalle
let manifiestoModalId = null;
let naveEditandoId = null;
let sincronizando = false;

// ---------- IndexedDB ----------

// Dashboard (app.js) y esta pantalla comparten la misma base IndexedDB. Si
// se deja una pestaña vieja abierta con una versión anterior de la base
// (ej. el Dashboard cacheado por el Service Worker antes de esta
// actualización), un intento de abrir una versión más nueva se queda
// "bloqueado" en silencio para siempre — eso es lo que hacía que el botón
// de guardar pareciera no hacer nada. dbPromise se cachea para no abrir una
// conexión nueva cada vez, y se cierra sola si otra pestaña necesita subir
// de versión, y truena con un mensaje claro después de 6s en vez de
// quedarse colgado.
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
      // Si OTRA pestaña necesita subir de versión después, esta conexión se
      // cierra sola en vez de bloquearla a ella.
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

async function guardarCache(fecha, manifiestos) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MANIFIESTOS, 'readwrite');
    tx.objectStore(STORE_MANIFIESTOS).put({ fecha, manifiestos, guardadoEn: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function leerCache(fecha) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MANIFIESTOS, 'readonly');
    const req = tx.objectStore(STORE_MANIFIESTOS).get(fecha);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Cola de pendientes (para capturar sin internet) ----------

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

async function actualizarPendiente(id, cambios) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    const store = tx.objectStore(STORE_PENDIENTES);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      if (item) {
        Object.assign(item, cambios);
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

// Cuando se sincroniza un manifiesto creado offline, todas las naves que se
// hayan encolado apuntando a su ID temporal necesitan que se les corrija el
// manifiestoId antes de que les toque su turno en la cola.
async function reescribirManifiestoIdEnPendientes(tempId, realId, listaEnMemoria) {
  const db = await abrirDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDIENTES, 'readwrite');
    const store = tx.objectStore(STORE_PENDIENTES);
    const req = store.getAll();
    req.onsuccess = () => {
      (req.result || []).forEach(item => {
        if (item.payload && item.payload.manifiestoId === tempId) {
          item.payload.manifiestoId = realId;
          store.put(item);
        }
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  (listaEnMemoria || []).forEach(item => {
    if (item.payload && item.payload.manifiestoId === tempId) {
      item.payload.manifiestoId = realId;
    }
  });
}

function generarIdTemporal() {
  if (window.crypto && crypto.randomUUID) return 'tmp-' + crypto.randomUUID();
  return 'tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ---------- Formato / utilidades ----------

function fechaHoyCDMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function mostrarError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.hidden = false;
}

function marcarEstadoConexion(ok) {
  const chip = document.getElementById('sello-chip');
  if (!chip) return;
  chip.textContent = ok ? 'AL DÍA' : 'SIN CONEXIÓN';
  chip.classList.toggle('offline', !ok);
}

// ---------- Llamada al backend vía JSONP (idéntico al Dashboard) ----------

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
  await cargarCatalogos();
  await cargarYRenderizarDia();
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

    if (!data.ok) {
      errorBox.textContent = data.error || 'No se pudo iniciar sesión.';
      return;
    }

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

// ---------- Catálogos (Invernadero / Letra / Semilla / Tamaños / Agricultores) ----------

async function cargarCatalogos() {
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=catalogos&token=${encodeURIComponent(tokenActual)}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (data.ok) {
      catalogos = data;
      localStorage.setItem('r56-catalogos-manifiesto', JSON.stringify(data));
    }
  } catch (err) {
    const guardado = localStorage.getItem('r56-catalogos-manifiesto');
    if (guardado) {
      try { catalogos = JSON.parse(guardado); } catch (e) { /* ignora */ }
    }
  }
  llenarSelectsCatalogo();
}

function llenarSelect(select, valores, { conVacio = true, textoVacio = '—' } = {}) {
  if (!select) return;
  const valorPrevio = select.value;
  select.innerHTML = '';
  if (conVacio) select.appendChild(new Option(textoVacio, ''));
  (valores || []).forEach(v => select.appendChild(new Option(String(v), String(v))));
  if (valorPrevio) select.value = valorPrevio;
}

function llenarSelectsCatalogo() {
  if (!catalogos) return;
  llenarSelect(document.getElementById('nave-invernadero'), catalogos.invernaderos);
  llenarSelect(document.getElementById('nave-letra'), catalogos.letras);
  llenarSelect(document.getElementById('nave-semilla'), catalogos.semillas);

  const selAgricultor = document.getElementById('carro-agricultor');
  if (selAgricultor) {
    selAgricultor.innerHTML = '';
    selAgricultor.appendChild(new Option('Selecciona...', ''));
    (catalogos.agricultores || []).forEach(a => selAgricultor.appendChild(new Option(a.nombre, a.nombre)));
  }
}

// ---------- Construcción de la grilla de 10 tamaños en el modal de nave ----------

function construirGridTamanos() {
  const grid = document.getElementById('grid-tamanos');
  grid.innerHTML = '';
  CAMPOS_TAMANO.forEach(c => {
    const div = document.createElement('div');
    div.className = 'campo-tamano';
    div.innerHTML = `<label for="campo-${c.param}">${c.label}</label>` +
      `<input type="number" min="0" inputmode="numeric" id="campo-${c.param}" data-campo="${c.param}">`;
    grid.appendChild(div);
  });
}

// ---------- Render: lista de camiones del día ----------

function claseBadge(m) {
  if (m.pendiente) return 'badge--pendiente';
  if (m.estado === 'captura') return 'badge--captura';
  if (m.estado === 'cerrado') return 'badge--cerrado';
  return 'badge--abierto';
}

function textoBadge(m) {
  if (m.pendiente) return 'Sin sincronizar';
  if (m.estado === 'captura') return 'En captura';
  if (m.estado === 'cerrado') return 'Cerrado';
  return 'Abierto';
}

function renderizarListaCarros() {
  const ul = document.getElementById('lista-carros');
  const manifiestos = (estadoDia && estadoDia.manifiestos) || [];

  if (manifiestos.length === 0) {
    ul.innerHTML = '<li class="vacio">Todavía no hay camiones capturados hoy.</li>';
    return;
  }

  ul.innerHTML = '';
  manifiestos.forEach(m => {
    const li = document.createElement('li');
    li.className = 'carro-card';
    const numNaves = (m.naves || []).length;
    li.innerHTML = `
      <div class="carro-card-top">
        <span class="carro-carro">Carro ${escapeHtml(m.carro)}</span>
        <span class="badge ${claseBadge(m)}">${textoBadge(m)}</span>
      </div>
      <div class="carro-agricultor">${escapeHtml(m.agricultor)}</div>
      <div class="carro-meta">${numNaves} nave${numNaves === 1 ? '' : 's'} · ${m.cajasTotales || 0} cajas</div>
    `;
    li.addEventListener('click', () => abrirDetalle(m.id));
    ul.appendChild(li);
  });
}

// ---------- Render: detalle de un manifiesto ----------

function desgloseNave(n) {
  const partes = CAMPOS_TAMANO
    .filter(c => Number(n[c.param]) > 0)
    .map(c => `${c.label}: ${n[c.param]}`);
  return partes.length ? partes.join(' · ') : 'Sin cajas capturadas todavía';
}

function renderizarDetalle(m) {
  document.getElementById('detalle-carro').textContent = 'Carro ' + m.carro;
  document.getElementById('detalle-agricultor').textContent = m.agricultor;
  document.getElementById('detalle-estado').textContent = textoBadge(m);
  document.getElementById('detalle-cajas').textContent = m.cajasTotales || 0;

  const ul = document.getElementById('lista-naves');
  const naves = m.naves || [];

  if (naves.length === 0) {
    ul.innerHTML = '<li class="vacio">Todavía no hay naves capturadas.</li>';
  } else {
    ul.innerHTML = '';
    naves.forEach(n => {
      const total = CAMPOS_TAMANO.reduce((acc, c) => acc + (Number(n[c.param]) || 0), 0);
      const idPartes = [n.invernadero, n.letra, n.semilla].filter(Boolean).join(' · ');
      const li = document.createElement('li');
      li.className = 'nave-card';
      li.innerHTML = `
        <div class="nave-card-top">
          <span class="nave-titulo">${escapeHtml(idPartes || 'Nave')}</span>
          <span class="nave-total">${total} cajas</span>
        </div>
        <div class="nave-desglose">${desgloseNave(n)}</div>
        <button class="btn-texto" type="button">Modificar</button>
      `;
      li.querySelector('button').addEventListener('click', () => abrirModalNave(m.id, n));
      ul.appendChild(li);
    });
  }

  document.getElementById('btn-finalizar').hidden = m.estado !== 'captura';
  document.getElementById('btn-reabrir').hidden = !(m.estado === 'cerrado' && usuarioRol === 'admin');
}

function abrirDetalle(id) {
  vistaActualId = id;
  const m = obtenerManifiestoLocal(id);
  if (!m) return;
  document.getElementById('vista-lista').hidden = true;
  document.getElementById('vista-detalle').hidden = false;
  renderizarDetalle(m);
}

document.getElementById('btn-volver-lista').addEventListener('click', () => {
  vistaActualId = null;
  document.getElementById('vista-detalle').hidden = true;
  document.getElementById('vista-lista').hidden = false;
});

// ---------- Estado local (fuente de verdad para el render) ----------

function obtenerManifiestoLocal(id) {
  return estadoDia && estadoDia.manifiestos ? estadoDia.manifiestos.find(m => m.id === id) : null;
}

async function guardarCacheDia() {
  if (estadoDia) await guardarCache(estadoDia.fecha, estadoDia.manifiestos);
}

function recalcularCajasTotales(m) {
  m.cajasTotales = (m.naves || []).reduce((acc, n) =>
    acc + CAMPOS_TAMANO.reduce((a, c) => a + (Number(n[c.param]) || 0), 0), 0);
}

// ---------- Traer datos del backend ----------

async function refrescarDesdeBackend() {
  const fecha = (estadoDia && estadoDia.fecha) || fechaHoyCDMX();
  try {
    const data = await llamarJSONP(`${APPS_SCRIPT_URL}?action=manifiestos_dia&token=${encodeURIComponent(tokenActual)}&fecha=${fecha}`);
    if (data.error === 'no_autorizado') { await volverALogin(); return; }
    if (!data.ok) return;

    estadoDia = { fecha, manifiestos: data.manifiestos };
    await guardarCache(fecha, data.manifiestos);
    renderizarListaCarros();

    if (vistaActualId) {
      const m = obtenerManifiestoLocal(vistaActualId);
      if (m) renderizarDetalle(m);
    }
    marcarEstadoConexion(true);
    document.getElementById('error-box').hidden = true;
  } catch (err) {
    marcarEstadoConexion(false);
  }
}

async function cargarYRenderizarDia() {
  const fecha = fechaHoyCDMX();
  const cache = await leerCache(fecha);
  if (cache) {
    estadoDia = { fecha, manifiestos: cache.manifiestos };
    renderizarListaCarros();
  } else {
    estadoDia = { fecha, manifiestos: [] };
    renderizarListaCarros();
  }
  await refrescarDesdeBackend();
  if (!cache && (!estadoDia.manifiestos || estadoDia.manifiestos.length === 0)) {
    // Sin caché y sin poder contactar al servidor: no hay nada que mostrar.
  }
}

// ---------- Acción: nuevo carro / manifiesto ----------

document.getElementById('btn-nuevo-carro').addEventListener('click', () => {
  document.getElementById('carro-numero').value = '';
  const sel = document.getElementById('carro-agricultor');
  if (sel) sel.value = '';
  document.getElementById('carro-error').textContent = '';
  document.getElementById('modal-carro').hidden = false;
});

document.getElementById('btn-cancelar-carro').addEventListener('click', () => {
  document.getElementById('modal-carro').hidden = true;
});

document.getElementById('btn-crear-carro').addEventListener('click', async () => {
  const agricultor = document.getElementById('carro-agricultor').value;
  const carro = document.getElementById('carro-numero').value.trim();
  if (!agricultor || !carro) {
    document.getElementById('carro-error').textContent = 'Selecciona agricultor y captura el número de carro.';
    return;
  }
  document.getElementById('modal-carro').hidden = true;
  await crearManifiesto(agricultor, carro);
});

async function crearManifiesto(agricultor, carro) {
  const fecha = (estadoDia && estadoDia.fecha) || fechaHoyCDMX();

  if (navigator.onLine) {
    try {
      const url = `${APPS_SCRIPT_URL}?action=manifiesto_crear&token=${encodeURIComponent(tokenActual)}&agricultor=${encodeURIComponent(agricultor)}&carro=${encodeURIComponent(carro)}&fecha=${fecha}`;
      const data = await llamarJSONP(url);
      if (data.error === 'no_autorizado') { await volverALogin(); return; }
      if (!data.ok) { alert(data.error || 'No se pudo crear el manifiesto.'); return; }
      await refrescarDesdeBackend();
      abrirDetalle(data.manifiestoId);
      return;
    } catch (err) {
      // sin conexión a media llamada — cae al camino offline de abajo
    }
  }

  const idLocal = generarIdTemporal();
  const payload = { tempId: idLocal, agricultor, carro, fecha };
  const pendienteId = await encolar('manifiesto_crear', payload);
  const nuevo = {
    id: idLocal, fecha, agricultor, carro, estado: 'captura',
    cajasTotales: 0, cajasVendidas: 0, naves: [],
    pendiente: true, pendienteId, _payloadPendiente: payload
  };
  estadoDia = estadoDia || { fecha, manifiestos: [] };
  estadoDia.manifiestos.unshift(nuevo);
  await guardarCacheDia();
  renderizarListaCarros();
  abrirDetalle(idLocal);
}

// ---------- Acción: nave (crear / modificar) ----------

function abrirModalNave(manifiestoId, nave) {
  manifiestoModalId = manifiestoId;
  naveEditandoId = nave ? nave.id : null;

  document.getElementById('modal-nave-titulo').textContent = nave ? 'Modificar Nave' : 'Nave Nueva';
  document.getElementById('nave-invernadero').value = nave ? (nave.invernadero || '') : '';
  document.getElementById('nave-letra').value = nave ? (nave.letra || '') : '';
  document.getElementById('nave-semilla').value = nave ? (nave.semilla || '') : '';

  CAMPOS_TAMANO.forEach(c => {
    const input = document.getElementById('campo-' + c.param);
    input.value = nave && nave[c.param] ? nave[c.param] : '';
  });

  document.getElementById('nave-error').textContent = '';
  document.getElementById('modal-nave').hidden = false;
}

function cerrarModalNave() {
  document.getElementById('modal-nave').hidden = true;
  manifiestoModalId = null;
  naveEditandoId = null;
}

document.getElementById('btn-nave-nueva').addEventListener('click', () => {
  if (!vistaActualId) return;
  abrirModalNave(vistaActualId, null);
});

document.getElementById('btn-cancelar-nave').addEventListener('click', cerrarModalNave);

document.getElementById('btn-guardar-nave').addEventListener('click', async () => {
  const invernadero = document.getElementById('nave-invernadero').value.trim();
  const letra = document.getElementById('nave-letra').value.trim();
  const semilla = document.getElementById('nave-semilla').value.trim();
  const errorBox = document.getElementById('nave-error');
  const boton = document.getElementById('btn-guardar-nave');

  if (!invernadero && !letra && !semilla) {
    errorBox.textContent = 'Captura al menos invernadero, letra o semilla.';
    return;
  }

  const datos = { invernadero, letra, semilla };
  CAMPOS_TAMANO.forEach(c => {
    datos[c.param] = Number(document.getElementById('campo-' + c.param).value) || 0;
  });

  errorBox.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Guardando...';
  try {
    await guardarNave(manifiestoModalId, naveEditandoId, datos);
  } catch (err) {
    // Cualquier error inesperado se ve aquí en vez de que el botón se
    // quede sin hacer nada — así sabemos exactamente qué falló.
    console.error('Error al guardar la nave:', err);
    errorBox.textContent = 'No se pudo guardar: ' + (err && err.message ? err.message : String(err));
  } finally {
    boton.disabled = false;
    boton.textContent = 'OK / Ingresar';
  }
});

async function enviarNaveAlBackend(manifiestoId, naveId, datos) {
  const params = new URLSearchParams({ action: 'nave_guardar', token: tokenActual, manifiestoId });
  if (naveId) params.set('naveId', naveId);
  if (datos.invernadero) params.set('invernadero', datos.invernadero);
  if (datos.letra) params.set('letra', datos.letra);
  if (datos.semilla) params.set('semilla', datos.semilla);
  CAMPOS_TAMANO.forEach(c => params.set(c.param, datos[c.param] || 0));

  const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
  if (data.error === 'no_autorizado') { await volverALogin(); throw new Error('no_autorizado'); }
  if (!data.ok) throw new Error(data.error || 'No se pudo guardar la nave.');
  return data;
}

async function guardarNave(manifiestoId, naveLocalId, datos) {
  const manifiesto = obtenerManifiestoLocal(manifiestoId);
  if (!manifiesto) {
    document.getElementById('nave-error').textContent =
      'No encontré este manifiesto en memoria. Cierra este formulario, regresa a "Camiones de hoy" y vuelve a entrar al carro.';
    return;
  }

  const naveExistente = naveLocalId ? (manifiesto.naves || []).find(n => n.id === naveLocalId) : null;
  const manifiestoTemp = String(manifiestoId).startsWith('tmp-');

  if (navigator.onLine && !manifiestoTemp) {
    try {
      const idReal = naveExistente && !String(naveExistente.id).startsWith('tmp-') ? naveExistente.id : null;
      await enviarNaveAlBackend(manifiestoId, idReal, datos);
      await refrescarDesdeBackend();
      cerrarModalNave();
      return;
    } catch (err) {
      if (err.message === 'no_autorizado') {
        // La sesión ya no es válida — volverALogin() ya cambió de pantalla,
        // pero el modal vive fuera de #app-view y hay que cerrarlo a mano
        // para que no se quede pegado tapando el login.
        cerrarModalNave();
        return;
      }
      // Error real del backend (no de sesión): lo dejamos ver en consola y
      // caemos al camino offline de abajo, que encola la nave para
      // reintentar más tarde y sí le avisa al usuario que quedó pendiente.
      console.warn('nave_guardar en línea falló, se encola para reintentar:', err.message);
    }
  }

  manifiesto.naves = manifiesto.naves || [];

  if (naveExistente && naveExistente.pendienteId) {
    // Ya había una acción sin sincronizar para esta nave — la actualizamos
    // en vez de encolar una segunda.
    const nuevoPayload = Object.assign({}, naveExistente._payloadPendiente, datos);
    await actualizarPendiente(naveExistente.pendienteId, { payload: nuevoPayload });
    Object.assign(naveExistente, datos, { _payloadPendiente: nuevoPayload });
  } else if (naveExistente) {
    const payload = Object.assign({ manifiestoId, naveId: naveExistente.id }, datos);
    const pendienteId = await encolar('nave_guardar', payload);
    Object.assign(naveExistente, datos, { pendiente: true, pendienteId, _payloadPendiente: payload });
  } else {
    const idLocal = generarIdTemporal();
    const payload = Object.assign({ manifiestoId }, datos);
    const pendienteId = await encolar('nave_guardar', payload);
    manifiesto.naves.push(Object.assign(
      { id: idLocal, pendiente: true, pendienteId, _payloadPendiente: payload }, datos
    ));
  }

  recalcularCajasTotales(manifiesto);
  manifiesto.pendiente = true;
  await guardarCacheDia();
  renderizarDetalle(manifiesto);
  renderizarListaCarros();
  cerrarModalNave();
}

// ---------- Acción: finalizar manifiesto ----------

document.getElementById('btn-finalizar').addEventListener('click', async () => {
  if (!vistaActualId) return;
  if (!confirm('¿Ya terminaste de capturar todas las naves de este carro?')) return;
  await finalizarManifiesto(vistaActualId);
});

async function finalizarManifiesto(manifiestoId) {
  const manifiesto = obtenerManifiestoLocal(manifiestoId);
  if (!manifiesto) return;
  const esTemp = String(manifiestoId).startsWith('tmp-');

  if (navigator.onLine && !esTemp) {
    try {
      const url = `${APPS_SCRIPT_URL}?action=manifiesto_finalizar&token=${encodeURIComponent(tokenActual)}&manifiestoId=${manifiestoId}`;
      const data = await llamarJSONP(url);
      if (data.error === 'no_autorizado') { await volverALogin(); return; }
      if (!data.ok) { alert(data.error || 'No se pudo finalizar.'); return; }
      await refrescarDesdeBackend();
      mostrarCompendio(data.compendio);
      return;
    } catch (err) {
      // sin conexión a media llamada — cae al camino offline de abajo
    }
  }

  const payload = { manifiestoId };
  const pendienteId = await encolar('manifiesto_finalizar', payload);
  manifiesto.estado = 'abierto';
  manifiesto.pendiente = true;
  manifiesto._pendienteFinalizarId = pendienteId;
  await guardarCacheDia();
  renderizarListaCarros();
  renderizarDetalle(manifiesto);
  mostrarCompendio(calcularCompendioLocal(manifiesto));
}

function calcularCompendioLocal(m) {
  const porTamano = {};
  let totalCajas = 0;
  CAMPOS_TAMANO.forEach(c => {
    const suma = (m.naves || []).reduce((acc, n) => acc + (Number(n[c.param]) || 0), 0);
    porTamano[c.param] = suma;
    totalCajas += suma;
  });
  return { numNaves: (m.naves || []).length, porTamano, totalCajas };
}

function mostrarCompendio(compendio) {
  const tabla = document.getElementById('compendio-tabla');
  tabla.innerHTML = '';
  CAMPOS_TAMANO.forEach(c => {
    const val = (compendio.porTamano && compendio.porTamano[c.param]) || 0;
    if (val <= 0) return;
    const nombre = document.createElement('div');
    nombre.textContent = c.label;
    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = val;
    tabla.appendChild(nombre);
    tabla.appendChild(num);
  });
  document.getElementById('compendio-total').textContent = compendio.totalCajas || 0;
  document.getElementById('modal-compendio').hidden = false;
}

document.getElementById('btn-cerrar-compendio').addEventListener('click', () => {
  document.getElementById('modal-compendio').hidden = true;
});

// ---------- Acción: reabrir (solo administradores) ----------

document.getElementById('btn-reabrir').addEventListener('click', async () => {
  if (!vistaActualId) return;
  if (!confirm('¿Reabrir este manifiesto para seguir vendiendo o corregirlo?')) return;
  await reabrirManifiesto(vistaActualId);
});

async function reabrirManifiesto(manifiestoId) {
  if (!navigator.onLine) {
    alert('Necesitas internet para reabrir un manifiesto.');
    return;
  }
  try {
    const url = `${APPS_SCRIPT_URL}?action=manifiesto_reabrir&token=${encodeURIComponent(tokenActual)}&manifiestoId=${manifiestoId}`;
    const data = await llamarJSONP(url);
    if (data.error === 'no_autorizado') { alert('No tienes permiso para reabrir manifiestos.'); return; }
    if (!data.ok) { alert(data.error || 'No se pudo reabrir.'); return; }
    await refrescarDesdeBackend();
  } catch (err) {
    alert('Sin conexión. Intenta de nuevo.');
  }
}

// ---------- Sincronización de la cola cuando regresa la señal ----------

async function sincronizar() {
  if (sincronizando || !navigator.onLine || !tokenActual) return;
  sincronizando = true;

  try {
    const pendientes = await listarPendientes();

    for (const item of pendientes) {
      try {
        if (item.tipo === 'manifiesto_crear') {
          const p = item.payload;
          const url = `${APPS_SCRIPT_URL}?action=manifiesto_crear&token=${encodeURIComponent(tokenActual)}&agricultor=${encodeURIComponent(p.agricultor)}&carro=${encodeURIComponent(p.carro)}&fecha=${p.fecha}`;
          const data = await llamarJSONP(url);
          if (!data.ok) throw new Error(data.error || 'error');

          const m = obtenerManifiestoLocal(p.tempId);
          if (m) { m.id = data.manifiestoId; m.pendiente = false; delete m.pendienteId; delete m._payloadPendiente; }
          if (vistaActualId === p.tempId) vistaActualId = data.manifiestoId;

          await reescribirManifiestoIdEnPendientes(p.tempId, data.manifiestoId, pendientes);
          await borrarPendiente(item.id);

        } else if (item.tipo === 'nave_guardar') {
          const p = item.payload;
          if (String(p.manifiestoId).startsWith('tmp-')) continue; // se resuelve en el siguiente intento

          const params = new URLSearchParams({ action: 'nave_guardar', token: tokenActual, manifiestoId: p.manifiestoId });
          if (p.naveId) params.set('naveId', p.naveId);
          if (p.invernadero) params.set('invernadero', p.invernadero);
          if (p.letra) params.set('letra', p.letra);
          if (p.semilla) params.set('semilla', p.semilla);
          CAMPOS_TAMANO.forEach(c => params.set(c.param, p[c.param] || 0));

          const data = await llamarJSONP(`${APPS_SCRIPT_URL}?${params.toString()}`);
          if (!data.ok) throw new Error(data.error || 'error');
          await borrarPendiente(item.id);

        } else if (item.tipo === 'manifiesto_finalizar') {
          const p = item.payload;
          if (String(p.manifiestoId).startsWith('tmp-')) continue;

          const url = `${APPS_SCRIPT_URL}?action=manifiesto_finalizar&token=${encodeURIComponent(tokenActual)}&manifiestoId=${p.manifiestoId}`;
          const data = await llamarJSONP(url);
          if (!data.ok) throw new Error(data.error || 'error');
          await borrarPendiente(item.id);
        }
      } catch (err) {
        // Un elemento falló (se cortó la conexión a media sincronización,
        // etc.) — paramos aquí y lo reintentamos en la siguiente pasada,
        // sin saltarnos el orden de la cola.
        break;
      }
    }

    await refrescarDesdeBackend();
  } finally {
    sincronizando = false;
  }
}

window.addEventListener('online', sincronizar);
setInterval(sincronizar, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && tokenActual) {
    sincronizar();
    refrescarDesdeBackend();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Arranque ----------

(async function arrancar() {
  construirGridTamanos();
  const sesion = await leerSesion().catch(() => null);
  if (sesion && sesion.token) {
    await iniciarSesionConToken(sesion.token, sesion.rol, sesion.nombre);
  } else {
    mostrarLogin();
  }
})();
