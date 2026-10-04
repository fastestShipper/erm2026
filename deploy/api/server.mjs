// ERM 2026 · API de solo lectura sobre NUESTRA copia de los resultados (no oficial).
// Node >= 20, sin dependencias. Solo lee archivos del disco: NUNCA consulta a la ONPE ni a internet.
// Regla de oro: toda respuesta es HTTP 200 (los 4xx hacen que CrowdSec banee IPs que comparten
// muchos agentes en la nube). Los errores salen como {"ok":false,"error":"..."}.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = 'https://peruvian.dev/dataonpe/api/v1';
const PREFIJOS = ['/dataonpe/api/v1', '/api/v1'];             // nginx puede dejarlos o quitarlos
const FUENTE = 'ONPE (resultadoelectoral.onpe.gob.pe)';
const COPIA = 'peruvian.dev/dataonpe — copia no oficial, tomada cada minuto desde una conexión peruana';
const AVISO = 'Sitio no oficial. Los resultados oficiales son los que publica la ONPE.';
const HORA = 3600e3;
const REVISAR_CADA_MS = 5e3;        // cada archivo se mira (mtime) como mucho una vez cada 5 s
const MESA_VIEJA_MS = 20 * 60e3;    // una mesa más vieja que esto se pide de nuevo al colector
const LIM = { pendientes: 300, global: 120, cliente: 20, vidaMs: 2 * HORA };
const LIMA_METRO = '140100';        // Lima Metropolitana no tiene gobierno regional
const CARGOS = { gobernador: 'Gobernador Regional', provincial: 'Alcalde Provincial', distrital: 'Alcalde Distrital' };
const RE = {                        // toda entrada se valida con esto antes de usarla
  mesa: /^\d{6}$/, ubigeo: /^\d{6}$/, nivel: /^[123]$/, eleccion: /^\d{1,4}$/, severidad: /^(alerta|revisar)$/,
  q: /^[\p{L}\p{M}\p{N} .,'’()-]{1,40}$/u, limite: /^([1-9]|[1-4]\d|50)$/,
};

class ErrorUsuario extends Error {}
function exigir(re, valor, mensaje) {
  if (typeof valor !== 'string' || !re.test(valor)) throw new ErrorUsuario(mensaje);
  return valor;
}

/* ───────── utilidades puras ───────── */
const lista = (x) => (Array.isArray(x) ? x : []);
const redondear = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);
const normalizar = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Lima es UTC-5 todo el año (sin horario de verano).
const horaLima = (ms) => (Number.isFinite(ms) ? new Date(ms - 5 * HORA).toISOString().slice(11, 16) : null);
const isoLima = (ms) => new Date(ms - 5 * HORA).toISOString().slice(0, 19) + '-05:00';

const org = (p) => (p ? { partido: p.partido, ...(p.candidato ? { candidato: p.candidato } : {}), votos: p.votos, pctValidos: p.pctValidos } : null);
const validos = (ps) => lista(ps).filter((p) => p && !p.especial);          // sin blancos ni nulos
const topN = (ps, n) => validos(ps).sort((a, b) => b.votos - a.votos).slice(0, n).map(org);
const especiales = (ps) => lista(ps).filter((p) => p && p.especial).map((p) => ({ partido: p.partido, votos: p.votos, pctEmitidos: p.pctEmitidos }));
const elegir = (o, claves) => Object.fromEntries(claves.map((k) => [k, redondear(o?.[k] ?? null)]));
const resumenTotales = (t) => elegir(t, ['actasContabilizadas', 'contabilizadas', 'totalActas', 'enviadasJee', 'pendientesJee', 'participacionCiudadana', 'totalVotosEmitidos', 'totalVotosValidos']);
function contienda(x) {
  const c = x?.contienda;
  if (!c) {   // sin cálculo de contienda: primero y segundo salen de la lista
    const [a, b] = topN(x?.participantes, 2);
    return { primero: a ?? null, segundo: b ?? null, diferencia: a && b ? a.votos - b.votos : null, puedeCambiar: null };
  }
  return { primero: org(c.primero), segundo: org(c.segundo), diferencia: c.diferencia, actasFaltan: c.actasFaltan, votosMaxFaltan: c.votosMaxFaltan, puedeCambiar: c.puedeCambiar };
}
function limiteDe(q, porDefecto) {
  const v = q.get('limite');
  if (v === null) return porDefecto;
  return +exigir(RE.limite, v, 'limite: número entero de 1 a 50');
}

/* ───────── lector de archivos con caché (ruta + mtime) ───────── */
function crearLector(ahora, max) {
  const cache = new Map();   // ruta → { mtime, revisado, datos }
  const revisar = (ruta, previo, t) => {
    let mtime;
    try { mtime = fs.statSync(ruta).mtimeMs; } catch { return { mtime: null, revisado: t, datos: null }; }   // no existe → vacío
    if (previo && previo.mtime === mtime) return { ...previo, revisado: t };
    try { return { mtime, revisado: t, datos: JSON.parse(fs.readFileSync(ruta, 'utf8')) }; }
    catch { return { mtime: -1, revisado: t, datos: previo ? previo.datos : null }; }                           // ilegible → lo último bueno
  };
  return (ruta) => {
    const t = ahora();
    let c = cache.get(ruta);
    if (!c || t - c.revisado >= REVISAR_CADA_MS) c = revisar(ruta, c, t);
    cache.delete(ruta); cache.set(ruta, c);                        // el más usado queda al final
    if (cache.size > max) cache.delete(cache.keys().next().value); // y se bota el menos usado
    return c.datos;
  };
}

/* ───────── cola de mesas prioritarias ───────── */
function crearCola({ archivo, ahora, sal }) {
  let pedidas = [];                  // [{ c: '000123', t: ms }] de la más vieja a la más nueva
  let cambio = ahora();
  let globales = [];                 // instantes de los códigos nuevos aceptados (última hora)
  const porCliente = new Map();      // hash(sal + ip) → instantes. Nunca se guarda la IP.
  try {                              // si el servicio se reinició, seguimos con lo que había
    const j = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    const ok = lista(j.detalle).filter((e) => e && RE.mesa.test(e.mesa) && Number.isFinite(e.t)).map((e) => [e.mesa, { c: e.mesa, t: e.t }]);
    pedidas = [...new Map(ok).values()].slice(-LIM.pendientes);
  } catch { /* primera vez */ }
  const recientes = (xs, t) => (xs || []).filter((x) => t - x < HORA);
  function guardar() {               // escritura atómica: archivo temporal y rename
    cambio = ahora();
    try {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      const tmp = archivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ actualizado: isoLima(cambio), pedidas: pedidas.map((e) => e.c), detalle: pedidas.map((e) => ({ mesa: e.c, t: e.t })) }));
      fs.renameSync(tmp, archivo);
    } catch (e) { console.error('cola: no se pudo guardar:', e.code || e.message); }   // sin disco seguimos en memoria
  }
  function purgar() {                // las pedidas hace más de 2 h caducan
    const t = ahora(), antes = pedidas.length;
    pedidas = pedidas.filter((e) => t - e.t < LIM.vidaMs);
    if (pedidas.length !== antes) guardar();
  }
  return {
    lista() { purgar(); return { pedidas: pedidas.map((e) => e.c), actualizado: isoLima(cambio) }; },
    quitar(codigo) { if (pedidas.some((e) => e.c === codigo)) { pedidas = pedidas.filter((e) => e.c !== codigo); guardar(); } },
    pedir(codigo, ip) {              // → { enCola, motivo? }
      purgar();
      if (pedidas.some((e) => e.c === codigo)) return { enCola: true };    // ya estaba: no cuenta
      const t = ahora();
      const cliente = crypto.createHash('sha256').update(sal).update('|').update(String(ip)).digest('hex');
      const suyos = recientes(porCliente.get(cliente), t);
      if (suyos.length >= LIM.cliente) return { enCola: false, motivo: 'cliente' };
      globales = recientes(globales, t);
      if (globales.length >= LIM.global) return { enCola: false, motivo: 'global' };
      suyos.push(t); globales.push(t); porCliente.set(cliente, suyos);
      if (porCliente.size > 500) for (const [k, v] of porCliente) if (!recientes(v, t).length) porCliente.delete(k);
      pedidas.push({ c: codigo, t });
      if (pedidas.length > LIM.pendientes) pedidas.shift();                // se bota la más vieja
      guardar();
      return { enCola: true };
    },
  };
}

/* ───────── endpoints ───────── */
const ENDPOINTS = [
  ['/', 'Esta guía: lista de endpoints.', '/'],
  ['/estado', 'Estado de la copia (en-vivo, bloqueado, error...) y avance de actas por elección.', '/estado'],
  ['/resumen', 'Por elección: totales, los 5 primeros a nivel nacional y el último boletín.', '/resumen'],
  ['/eleccion/{id}', 'Una elección con sus departamentos: primero, segundo y si puede cambiar. Con ?detalle=1 agrega los 10 primeros por departamento.', '/eleccion/20'],
  ['/lugar?q={texto}', 'Busca regiones, provincias y distritos por nombre (sin importar tildes ni mayúsculas). Máximo 10.', '/lugar?q=miraflores'],
  ['/lugar/{nivel}/{ubigeo}', 'Todas las contiendas de un lugar. nivel: 1 región, 2 provincia, 3 distrito. ubigeo: 6 dígitos.', '/lugar/3/140102'],
  ['/mesa/{codigo}', 'Actas de una mesa (6 dígitos) y sus observaciones. Si falta o está vieja, se pide al colector.', '/mesa/000007'],
  ['/observaciones?severidad={alerta|revisar}&limite={1-50}', 'Observaciones de actas (las más nuevas primero) y de los totales, con conteos.', '/observaciones?severidad=alerta&limite=10'],
  ['/boletines?limite={1-50}', 'Últimos boletines generados por programa (por defecto 5).', '/boletines?limite=3'],
  ['/cola', 'Mesas pedidas que el colector debe priorizar (uso interno).', '/cola'],
].map(([ruta, descripcion, ejemplo]) => ({ ruta, descripcion, ejemplo: BASE + ejemplo }));

function crearApi({ dataDir, mesasDir, ahora, cola }) {
  const leerDatos = crearLector(ahora, 200);
  const leerMesas = crearLector(ahora, 24);         // los archivos de mesas son grandes: pocos en memoria
  const dato = (...partes) => leerDatos(path.join(dataDir, ...partes));
  const estado = () => dato('status.json') || {};
  const elecciones = () => lista(dato('latest.json')?.elecciones);

  // índice de lugares: se arma una vez por cada versión del archivo
  const indices = new WeakMap();
  function indiceLugares() {
    const ix = dato('ambitos', 'indice.json');
    if (!ix || !Array.isArray(ix.lugares)) return null;
    if (indices.has(ix)) return indices.get(ix);
    const nombre = new Map(ix.lugares.map((l) => [`${l[0]}-${l[1]}`, l[4]]));
    const filas = ix.lugares.map(([nivel, ubigeo, dep, prov, nom]) => {
      const ruta = [nom, nivel === 3 ? nombre.get(`2-${prov}`) : null, nivel >= 2 ? nombre.get(`1-${dep}`) : null].filter(Boolean).join(', ');
      return { nivel, ubigeo, dep, prov, nombre: nom, ruta, n: normalizar(nom), todo: normalizar(ruta) };
    });
    const r = { ix, filas, por: new Map(filas.map((l) => [`${l.nivel}-${l.ubigeo}`, l])) };
    indices.set(ix, r);
    return r;
  }

  function guia() {
    return {
      nombre: 'API de la copia no oficial de resultados ERM 2026 (Perú)',
      base: BASE,
      reglas: [
        'Todas las respuestas son HTTP 200. Si algo falla verás {"ok":false,"error":"..."}.',
        'Solo lectura (GET). Esta API nunca consulta a la ONPE: lee nuestra copia, tomada cada minuto.',
        'Mira siempre "estado" y "consultado": si estado no es "en-vivo", los datos pueden estar atrasados.',
        'Las listas largas se recortan y llevan "truncado": true. Pide solo lo que necesites.',
      ],
      endpoints: ENDPOINTS,
    };
  }

  function paginaEstado() {
    const st = estado(), vivo = st.estado === 'en-vivo';
    return {
      estado: st.estado ?? 'esperando', detalle: st.detalle ?? null, consultado: st.consultado ?? null,
      ultimaActualizacionOnpe: st.ultimaActualizacionOnpe ?? null,
      resultados: vivo,
      ...(vivo ? {} : { nota: 'Ahora no hay lectura en vivo: los datos son los últimos que se copiaron.' }),
      elecciones: elecciones().map((e) => ({ id: e.id, nombre: e.menu, actasContabilizadas: e.totales?.actasContabilizadas ?? null, corte: horaLima(e.totales?.fechaActualizacion) })),
    };
  }

  const cabecera = (e, n) => ({   // lo común de /resumen y /eleccion
    id: e.id, nombre: e.nombre, cargo: e.menu, nivel: e.nivel, tipo: e.tipo, totales: resumenTotales(e.totales),
    corte: horaLima(e.totales?.fechaActualizacion), top: topN(e.participantes, n), ...(validos(e.participantes).length > n ? { truncado: true } : {}),
  });

  function resumen() {
    const b = lista(dato('boletines.json')?.items)[0];
    return { elecciones: elecciones().map((e) => cabecera(e, 5)), boletin: b ? { hora: b.hora, texto: b.texto } : null };
  }

  function eleccion(id, q) {
    exigir(RE.eleccion, id, 'id de elección: solo dígitos, hasta 4');
    const todas = elecciones();
    const e = todas.find((x) => String(x.id) === id);
    if (!e) throw new ErrorUsuario(`No existe esa elección. Disponibles: ${todas.map((x) => x.id).join(', ') || 'ninguna todavía'}.`);
    const detalle = q.get('detalle') === '1', r = cabecera(e, detalle ? 10 : 5);
    r.departamentos = lista(e.departamentos).map((d) => {
      const c = contienda(d);
      const fila = { ubigeo: d.ubigeo, nombre: d.nombre, actasContabilizadas: d.totales?.actasContabilizadas ?? null, primero: c.primero, segundo: c.segundo, puedeCambiar: c.puedeCambiar };
      if (detalle) { fila.participantes = topN(d.participantes, 10); if (validos(d.participantes).length > 10) r.truncado = true; }
      return fila;
    });
    return r;
  }

  function buscar(q) {
    const crudo = q.get('q');
    if (crudo === null) throw new ErrorUsuario('Falta q: el texto a buscar (ejemplo /lugar?q=miraflores)');
    const texto = crudo.replace(/\s+/g, ' ').trim();
    exigir(RE.q, texto, 'q: entre 1 y 40 letras, números o espacios');
    const ix = indiceLugares();
    if (!ix) return { consulta: texto, total: 0, lugares: [], mensaje: 'Todavía no tenemos el índice de lugares.' };
    const n = normalizar(texto), toks = n.split(' '), soloDigitos = /^\d+$/.test(n);
    const hallados = [];
    for (const l of ix.filas) {          // rango 0: empieza igual · 1: lo contiene · 2: todas las palabras en la ruta
      const rango = soloDigitos ? (l.ubigeo.startsWith(n) ? 0 : -1)
        : l.n.startsWith(n) ? 0 : l.n.includes(n) ? 1 : toks.every((t) => l.todo.includes(t)) ? 2 : -1;
      if (rango >= 0) hallados.push({ l, orden: `${rango}${l.nivel}${l.n}${l.ubigeo}` });
    }
    hallados.sort((a, b) => (a.orden < b.orden ? -1 : 1));    // por rango, luego nivel, luego nombre
    return {
      consulta: texto, total: hallados.length, ...(hallados.length > 10 ? { truncado: true } : {}),
      lugares: hallados.slice(0, 10).map(({ l }) => ({ nivel: l.nivel, ubigeo: l.ubigeo, nombre: l.nombre, ruta: l.ruta, ver: `/lugar/${l.nivel}/${l.ubigeo}` })),
    };
  }

  function armar(cargo, lugarTxt, eleccionId, x, visto) {
    if (!x) return { cargo, lugar: lugarTxt, eleccion: eleccionId ?? null, pendiente: true, mensaje: 'Todavía no tenemos los resultados de este lugar.' };
    return {
      cargo, lugar: lugarTxt, eleccion: eleccionId, totales: resumenTotales(x.totales), corte: horaLima(x.totales?.fechaActualizacion),
      top: topN(x.participantes, 5), ...(validos(x.participantes).length > 5 ? { truncado: true } : {}),
      especiales: especiales(x.participantes), contienda: contienda(x), visto: visto ?? null,
    };
  }

  function lugar(nivel, ubigeo) {
    exigir(RE.nivel, nivel, 'nivel: 1 región, 2 provincia o 3 distrito');
    exigir(RE.ubigeo, ubigeo, 'ubigeo: deben ser 6 dígitos (ejemplo 140102)');
    const ix = indiceLugares();
    const l = ix?.por.get(`${nivel}-${ubigeo}`);
    if (!l) return { nivel: +nivel, ubigeo, pendiente: true, contiendas: [], mensaje: 'Ese lugar no está en nuestra copia: todavía no se recoge o el código no existe. Búscalo por nombre con /lugar?q=' };
    const idDe = (nv, tipo) => ix.ix.elecciones?.[nv] ?? elecciones().find((e) => e.tipo === tipo)?.id;
    const ambito = (tipo, etiqueta, nv, ubi, dep) => {   // provincial o distrital, desde ambitos/eleccion-<id>/<dep>.json
      const id = idDe(nv, tipo);
      const f = RE.eleccion.test(String(id)) && RE.ubigeo.test(dep) ? dato('ambitos', `eleccion-${id}`, `${dep}.json`) : null;
      const grupo = f?.[nv === 3 ? 'distritos' : 'provincias'];
      const x = grupo && Object.hasOwn(grupo, ubi) ? grupo[ubi] : null;
      return armar(CARGOS[tipo], etiqueta, id, x, x?.visto);
    };
    const gobernador = (dep) => {                        // desde latest.json (el visto no es por lugar)
      const e = elecciones().find((x) => x.tipo === 'gobernador');
      return armar(CARGOS.gobernador, ix.por.get(`1-${dep}`)?.nombre ?? dep, e?.id, lista(e?.departamentos).find((d) => d.ubigeo === dep), null);
    };
    const cs = [];
    if (l.nivel === 3) {
      cs.push(ambito('distrital', l.ruta, 3, l.ubigeo, l.dep));
      cs.push(ambito('provincial', ix.por.get(`2-${l.prov}`)?.ruta ?? l.prov, 2, l.prov, l.dep));
      if (l.prov !== LIMA_METRO) cs.push(gobernador(l.dep));
    } else if (l.nivel === 2) {
      cs.push(ambito('provincial', l.ruta, 2, l.ubigeo, l.dep));
      if (l.ubigeo !== LIMA_METRO) cs.push(gobernador(l.dep));
    } else cs.push(gobernador(l.ubigeo));
    return { nivel: l.nivel, ubigeo: l.ubigeo, nombre: l.nombre, ruta: l.ruta, contiendas: cs };
  }

  function mesa(codigo, ip) {
    exigir(RE.mesa, codigo, 'mesa: debe tener exactamente 6 dígitos (ejemplo 000123)');
    const archivo = leerMesas(path.join(mesasDir, codigo.slice(0, 3) + '.json'));
    const reg = archivo && Object.hasOwn(archivo, codigo) ? archivo[codigo] : null;
    const obs = lista(dato('actas', 'anomalias.json')?.items).filter((i) => i && i.mesa === codigo);
    const r = { codigo, encontrada: !!reg, enCola: false };
    if (reg) { r.mesa = reg; r.observaciones = obs.slice(0, 20); if (obs.length > 20) r.truncado = true; }
    const vieja = !reg || !(ahora() - Date.parse(reg.consultado) <= MESA_VIEJA_MS);
    if (!vieja) { cola.quitar(codigo); return r; }                      // ya está al día
    if (estado().estado !== 'en-vivo') {
      r.mensaje = reg ? 'Los datos de esta mesa tienen más de 20 minutos y ahora no hay lectura en vivo.' : 'No tenemos esta mesa y ahora no hay lectura en vivo, así que no se pidió.';
      return r;
    }
    const p = cola.pedir(codigo, ip);
    r.enCola = p.enCola;
    r.mensaje = p.enCola ? 'Se pidió; vuelve a consultar en unos minutos'
      : p.motivo === 'cliente' ? 'Pediste muchas mesas en la última hora (máximo 20). Intenta más tarde.'
      : 'Hay muchas mesas pedidas en este momento. Intenta de nuevo en un rato.';
    return r;
  }

  function observaciones(q) {
    const sev = q.get('severidad');
    if (sev !== null) exigir(RE.severidad, sev, 'severidad: alerta o revisar');
    const n = limiteDe(q, 20), pasa = (i) => i && (!sev || i.severidad === sev);
    const actas = lista(dato('actas', 'anomalias.json')?.items).filter(pasa).sort((a, b) => (Date.parse(b.visto) || 0) - (Date.parse(a.visto) || 0));
    const checks = lista(dato('checks.json')?.items).filter(pasa);
    const conteos = elegir(dato('actas', 'resumen.json'), ['mesasEncontradas', 'numerosExplorados', 'exploracionCompleta', 'actasLeidas', 'actasContabilizadas', 'mesasConTodoContabilizado', 'avisos', 'actualizado']);
    return {
      actas: { total: actas.length, items: actas.slice(0, n) }, totales: { total: checks.length, items: checks.slice(0, n) }, resumen: conteos,
      ...(actas.length > n || checks.length > n ? { truncado: true } : {}),
    };
  }

  function boletines(q) {
    const n = limiteDe(q, 5), todos = lista(dato('boletines.json')?.items);
    return {
      total: todos.length, ...(todos.length > n ? { truncado: true } : {}),
      items: todos.slice(0, n).map(({ generado, ...b }) => ({ ...b, cambios: lista(b.cambios).slice(0, 5) })),   // "cambiosTotal" dice cuántos hubo
    };
  }

  function responder(segs, q, ip) {
    switch (`${segs.length}:${segs[0] || ''}`) {
      case '0:': return guia();
      case '1:estado': return paginaEstado();
      case '1:resumen': return resumen();
      case '2:eleccion': return eleccion(segs[1], q);
      case '1:lugar': return buscar(q);
      case '3:lugar': return lugar(segs[1], segs[2]);
      case '2:mesa': return mesa(segs[1], ip);
      case '1:observaciones': return observaciones(q);
      case '1:boletines': return boletines(q);
      case '1:cola': return cola.lista();
      default: throw new ErrorUsuario('Ruta no encontrada. Mira la guía en / para ver los endpoints.');
    }
  }
  return { responder, estado };
}

/* ───────── servidor HTTP ───────── */
const CABECERAS = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff',
};
function enviar(res, cuerpo) {
  const txt = JSON.stringify(cuerpo);
  res.writeHead(200, { ...CABECERAS, 'content-length': Buffer.byteLength(txt) });   // en HEAD Node no manda el cuerpo
  res.end(txt);
}

export function crearServidor(op = {}) {
  const ahora = op.ahora || Date.now;
  const dataDir = op.dataDir || process.env.DATA_DIR || '/srv/erm2026/data';
  const mesasDir = op.mesasDir || process.env.MESAS_DIR || '/srv/erm2026-mesas';
  const stateDir = op.stateDir || (process.env.STATE_DIRECTORY || './state').split(':')[0];
  const sal = op.sal || crypto.randomBytes(16).toString('hex');       // solo en memoria
  const cola = crearCola({ archivo: path.join(stateDir, 'cola.json'), ahora, sal });
  const api = crearApi({ dataDir, mesasDir, ahora, cola });

  const servidor = http.createServer((req, res) => {
    let cuerpo;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); throw new ErrorUsuario('solo GET'); }
      const url = String(req.url || '/');
      if (url.length > 2000) throw new ErrorUsuario('La dirección es demasiado larga.');
      const i = url.indexOf('?');
      let ruta = i < 0 ? url : url.slice(0, i);
      const q = new URLSearchParams(i < 0 ? '' : url.slice(i + 1));
      for (const pre of PREFIJOS) if (ruta === pre || ruta.startsWith(pre + '/')) { ruta = ruta.slice(pre.length); break; }
      const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '').slice(0, 64);
      const data = api.responder(ruta.split('/').filter(Boolean), q, ip);
      const st = api.estado();
      cuerpo = { ok: true, fuente: FUENTE, copia: COPIA, aviso: AVISO, consultado: st.consultado ?? null, estado: st.estado ?? 'esperando', data };
    } catch (e) {
      if (!(e instanceof ErrorUsuario)) console.error('error interno:', e);
      cuerpo = { ok: false, error: e instanceof ErrorUsuario ? e.message : 'Error interno; intenta de nuevo en un momento.' };
    }
    enviar(res, cuerpo);
  });

  // Peticiones mal formadas: Node respondería 400. Aquí también contestamos 200 con JSON.
  servidor.on('clientError', (_err, socket) => {
    if (!socket.writable || socket.destroyed) { socket.destroy(); return; }
    const txt = JSON.stringify({ ok: false, error: 'Petición mal formada. Si la dirección lleva tildes o ñ, codifícalas (ñ = %C3%B1).' });
    const cab = Object.entries({ ...CABECERAS, 'content-length': Buffer.byteLength(txt), connection: 'close' }).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 200 OK\r\n${cab}\r\n${txt}`);
  });
  return servidor;
}

// Arranque normal: node server.mjs  (los tests importan crearServidor y no pasan por aquí)
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
if (real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const puerto = +(process.env.PORT || 8834);
  const servidor = crearServidor();
  servidor.listen(puerto, '127.0.0.1', () => console.log(`erm2026-api escuchando en 127.0.0.1:${puerto}`));
}
