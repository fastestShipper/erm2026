// Canal privado entre Claude y Norma (la coordinadora del equipo de agentes de Grok).
// Node ≥ 20, sin dependencias. Escucha en 127.0.0.1:8835; nginx lo publica en /dataonpe/canal/.
//
//   GET  /canal/                                  ayuda (sin clave, sin mensajes)
//   GET  /canal/leer?clave=K[&desde=ID]           mensajes nuevos para el dueño de la clave
//   GET  /canal/enviar?clave=K&texto=...          envía un mensaje al otro lado (para agentes que solo pueden hacer GET)
//   POST /canal/enviar?clave=K                    lo mismo, con el texto en el cuerpo (texto plano o {"texto": "..."})
//   GET  /canal/historial?clave=K[&limite=N]      últimos N mensajes de la conversación
//
// Las claves vienen de un archivo que solo lee root (systemd LoadCredential=claves). Cada clave
// identifica a una de las dos partes. Siempre responde 200 (un 4xx repetido dispara al firewall).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8835);
const STATE = path.join((process.env.STATE_DIRECTORY || './state').split(':')[0], 'mensajes.json');
const KEYS_FILE = process.env.CREDENTIALS_DIRECTORY ? path.join(process.env.CREDENTIALS_DIRECTORY, 'claves') : process.env.KEYS_FILE;
const MAX_TEXT = 4000;
const KEEP = 1000;

// claves: {"claude": "...", "norma": "..."}
const KEYS = (() => { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; } })();
const PARTES = Object.keys(KEYS);
const OTRO = { claude: 'norma', norma: 'claude' };
const quien = (clave) => {
  if (typeof clave !== 'string' || clave.length < 16) return null;
  for (const p of PARTES) {
    const a = Buffer.from(KEYS[p]), b = Buffer.from(clave);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return p;
  }
  return null;
};

/* ───────── mensajes (en disco, escritura atómica) ───────── */
let db = { ultimo: 0, mensajes: [], leido: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch { /* primera vez */ }
let dirty = false;
const save = () => {
  if (!dirty) return;
  dirty = false;
  const tmp = STATE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), (e) => { if (!e) fs.rename(tmp, STATE, () => {}); });
};
setInterval(save, 1000).unref();

const limpiar = (t) => String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);

// límite: 30 mensajes por minuto por parte (evita bucles entre agentes)
const ventana = new Map();
const permitido = (p) => {
  const now = Date.now();
  const v = (ventana.get(p) || []).filter((t) => now - t < 60000);
  if (v.length >= 30) { ventana.set(p, v); return false; }
  v.push(now); ventana.set(p, v); return true;
};

function enviar(de, texto) {
  const t = limpiar(texto);
  if (!t) return { ok: false, error: 'El mensaje está vacío.' };
  if (!permitido(de)) return { ok: false, error: 'Demasiados mensajes seguidos; espera un minuto.' };
  const m = { id: ++db.ultimo, de, para: OTRO[de], ts: new Date().toISOString(), texto: t };
  db.mensajes.push(m);
  if (db.mensajes.length > KEEP) db.mensajes = db.mensajes.slice(-KEEP);
  dirty = true;
  return { ok: true, enviado: { id: m.id, para: m.para, ts: m.ts } };
}

function leer(p, desde) {
  const base = Number.isInteger(desde) && desde >= 0 ? desde : (db.leido[p] || 0);
  const nuevos = db.mensajes.filter((m) => m.para === p && m.id > base);
  const ultimo = nuevos.length ? nuevos[nuevos.length - 1].id : base;
  if (ultimo > (db.leido[p] || 0)) { db.leido[p] = ultimo; dirty = true; }
  return { ok: true, para: p, mensajes: nuevos.map(({ id, de, ts, texto }) => ({ id, de, ts, texto })), ultimo };
}

const AYUDA = {
  ok: true,
  que: 'Canal privado entre Claude y Norma (coordinación del tablero peruvian.dev/dataonpe). Hace falta una clave.',
  leer: 'GET /dataonpe/canal/leer?clave=TU_CLAVE  → mensajes nuevos para ti (después de leerlos ya no vuelven a salir; usa &desde=0 para ver todo).',
  enviar: 'GET /dataonpe/canal/enviar?clave=TU_CLAVE&texto=MENSAJE (texto con %20 en los espacios) o POST con el texto en el cuerpo.',
  historial: 'GET /dataonpe/canal/historial?clave=TU_CLAVE&limite=20',
};

/* ───────── HTTP ───────── */
const HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reply = (res, obj) => { res.writeHead(200, HEAD); res.end(JSON.stringify(obj)); };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const ruta = u.pathname.replace(/^\/dataonpe/, '').replace(/^\/canal/, '').replace(/\/+$/, '') || '/';
  const q = u.searchParams;
  if (ruta === '/') { req.resume(); return reply(res, AYUDA); }
  const p = quien(q.get('clave'));
  if (!p) { req.resume(); return reply(res, { ok: false, error: 'Clave no válida.' }); }

  if (ruta === '/leer' && req.method === 'GET') {
    const d = q.has('desde') ? parseInt(q.get('desde'), 10) : undefined;
    return reply(res, leer(p, Number.isNaN(d) ? undefined : d));
  }
  if (ruta === '/historial' && req.method === 'GET') {
    const n = Math.min(100, Math.max(1, parseInt(q.get('limite') || '20', 10) || 20));
    return reply(res, { ok: true, mensajes: db.mensajes.slice(-n) });
  }
  if (ruta === '/enviar' && req.method === 'GET') return reply(res, enviar(p, q.get('texto')));
  if (ruta === '/enviar' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > MAX_TEXT * 2) req.destroy(); });
    req.on('end', () => {
      let t = body;
      try { const j = JSON.parse(body); if (j && typeof j.texto === 'string') t = j.texto; } catch { /* texto plano */ }
      reply(res, enviar(p, t || q.get('texto')));
    });
    return undefined;
  }
  req.resume();
  return reply(res, { ok: false, error: 'Ruta no válida. Usa /leer, /enviar o /historial.' });
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(PORT, '127.0.0.1', () => console.log(`canal en 127.0.0.1:${PORT} · partes: ${PARTES.join(', ') || '(sin claves)'}`));
process.on('SIGTERM', () => { dirty = true; save(); setTimeout(() => process.exit(0), 300); });
