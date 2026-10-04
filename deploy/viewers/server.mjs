// Público en vivo (ERM 2026): cuántas personas miran y sus reacciones a los mensajes de los agentes.
// Node ≥ 20, sin dependencias.
//
//   POST /ping?s=VID[&z=<nivel>-<ubigeo>]  →  { viendo, r: { <idMensaje>: [meGusta, meEncanta, importante] } }
//        z es el lugar que la persona está mirando en «Mi zona»: solo se usa para contar cuántos miran cada
//        lugar (zonas.json), y así el colector refresca primero los más consultados.
//   POST /react?m=<idMensaje>&r=<tipo>&s=VID&on=1|0  →  { ok, c: [..] }
//
// No lee cuerpos. No guarda IPs ni datos personales: el VID es un id aleatorio del navegador y la IP
// solo se usa en memoria, con hash y sal al azar, para frenar abusos. En disco quedan únicamente los contadores.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8833);
const SITE = process.env.SITE_ORIGIN || 'https://peruvian.dev';
const FEED = process.env.FEED_PATH || '/srv/erm2026/data/bots/feed.json';
const STATE = process.env.STATE_DIRECTORY ? path.join(process.env.STATE_DIRECTORY.split(':')[0], 'reacciones.json') : null;
const ZONES = STATE ? path.join(path.dirname(STATE), 'zonas.json') : null;
const DEV = process.env.ALLOW_ANY_ORIGIN === '1';     // solo para pruebas locales

const TYPES = ['like', 'love', 'star'];               // Me gusta, Me encanta, Importante
const TTL_MS = 75e3;            // un visitante cuenta mientras avise
const MAX_VIEWERS = 200000;
const MAX_SEEN = 400000;        // tope de memoria para «quién ya reaccionó a qué»
const PER_IP = 150;             // reacciones de un mismo tipo a un mismo mensaje desde una misma IP (CGNAT incluido)

/* ───────── visitantes ───────── */
const viewers = new Map();      // VID → último aviso
const cleanVid = (v) => { const s = String(v || '').replace(/[^a-z0-9]/gi, '').slice(0, 16); return s.length >= 6 ? s : ''; };
const zones = new Map();        // VID → lugar que está mirando (nivel-ubigeo)
const ZONE_RE = /^[123]-[0-9A-Za-z]{1,8}$/;
function touch(vid, zone) {
  if (!vid || !(viewers.has(vid) || viewers.size < MAX_VIEWERS)) return;
  viewers.set(vid, Date.now());
  if (zone && ZONE_RE.test(zone)) zones.set(vid, zone); else zones.delete(vid);
}
setInterval(() => { const now = Date.now(); for (const [k, t] of viewers) if (now - t > TTL_MS) { viewers.delete(k); zones.delete(k); } }, 15e3).unref();
// cada 20 s: cuántas personas miran cada lugar (los 400 más consultados). No se guarda quién.
if (ZONES) {
  let lastZones = '';
  setInterval(() => {
    const n = new Map();
    for (const z of zones.values()) n.set(z, (n.get(z) || 0) + 1);
    const top = Object.fromEntries([...n].sort((a, b) => b[1] - a[1]).slice(0, 400));
    const body = JSON.stringify(top);
    if (body === lastZones) return;
    lastZones = body;
    const tmp = ZONES + '.tmp';
    fs.writeFile(tmp, JSON.stringify({ actualizado: new Date().toISOString(), zonas: top }), (e) => { if (!e) fs.rename(tmp, ZONES, () => {}); });
  }, 20e3).unref();
}

/* ───────── mensajes válidos: solo se puede reaccionar a lo que está publicado ───────── */
let valid = new Set();
function loadFeed() {
  fs.readFile(FEED, 'utf8', (err, txt) => {
    if (err) return;
    try {
      const ids = new Set();
      for (const x of JSON.parse(txt).items || []) { const t = Date.parse(x.ts); if (t) ids.add(String(t)); }
      if (ids.size) { valid = ids; dirtySnapshot = true; }
    } catch { /* archivo a medio escribir: se reintenta */ }
  });
}
loadFeed();
setInterval(loadFeed, 20e3).unref();

/* ───────── contadores ───────── */
const counts = new Map();       // idMensaje → [n, n, n]
if (STATE) {
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(STATE, 'utf8')))) if (/^\d{13}$/.test(k) && Array.isArray(v)) counts.set(k, TYPES.map((_, i) => Math.max(0, v[i] | 0))); } catch { /* primera vez */ }
}
let dirtyDisk = false, dirtySnapshot = true, snapshot = '{}';
function buildSnapshot() {
  if (!dirtySnapshot) return snapshot;
  const o = {};
  for (const [k, v] of counts) if (valid.has(k) && (v[0] || v[1] || v[2])) o[k] = v;
  snapshot = JSON.stringify(o);
  dirtySnapshot = false;
  return snapshot;
}
if (STATE) {
  setInterval(() => {
    if (!dirtyDisk) return;
    dirtyDisk = false;
    const tmp = STATE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(Object.fromEntries(counts)), (e) => { if (!e) fs.rename(tmp, STATE, () => {}); });
  }, 10e3).unref();
}

/* ───────── anti-abuso (solo en memoria) ───────── */
const SALT = crypto.randomBytes(16);
const ipKey = (req) => {
  let ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  if (ip.includes(':') && !ip.startsWith('::ffff:')) ip = ip.split(':').slice(0, 4).join(':');   // IPv6: por /64
  return crypto.createHmac('sha256', SALT).update(ip).digest('base64url').slice(0, 10);
};
const seen = new Map();         // `${vid}|${id}|${tipo}` → true (orden de inserción = antigüedad)
const perIp = new Map();        // `${ip}|${id}|${tipo}` → cantidad
function remember(map, key, val) { map.set(key, val); if (map.size > MAX_SEEN) map.delete(map.keys().next().value); }

function react(req, q) {
  const id = String(q.get('m') || '');
  const t = TYPES.indexOf(String(q.get('r') || ''));
  const vid = cleanVid(q.get('s'));
  if (!/^\d{13}$/.test(id) || !valid.has(id) || t < 0 || !vid) return { ok: false };
  const on = q.get('on') !== '0';
  const key = `${vid}|${id}|${t}`;
  const c = counts.get(id) || [0, 0, 0];
  if (on) {
    if (!seen.has(key)) {
      const ik = `${ipKey(req)}|${id}|${t}`;
      const used = perIp.get(ik) || 0;
      if (used >= PER_IP) return { ok: true, c };            // tope por red: se acepta sin sumar
      remember(perIp, ik, used + 1);
      remember(seen, key, true);
      c[t] += 1;
    }
  } else if (seen.delete(key)) {
    c[t] = Math.max(0, c[t] - 1);
  }
  counts.set(id, c);
  dirtyDisk = dirtySnapshot = true;
  return { ok: true, c };   // reaccionar no cuenta como visitante: eso solo lo decide /ping
}

/* ───────── HTTP ───────── */
function sameSite(req) {
  if (DEV) return true;
  const sfs = req.headers['sec-fetch-site'];
  if (sfs) return sfs === 'same-origin';
  const origin = req.headers.origin;
  return !origin || origin === SITE;
}
const HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const server = http.createServer((req, res) => {
  req.resume();                 // se descarta cualquier cuerpo
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/dataonpe\/api/, '');
  if (p !== '/ping' && p !== '/react') { res.writeHead(404, HEAD); return res.end('{"error":"no encontrado"}'); }
  if (req.method !== 'POST') { res.writeHead(405, HEAD); return res.end('{"error":"solo POST"}'); }
  const own = sameSite(req);
  if (p === '/ping') {
    if (own) touch(cleanVid(u.searchParams.get('s')), u.searchParams.get('z'));
    res.writeHead(200, HEAD);
    return res.end(`{"viendo":${viewers.size},"r":${buildSnapshot()}}`);
  }
  // Los errores de validación responden 200 con ok:false: una respuesta 4xx repetida puede disparar al firewall.
  res.writeHead(200, HEAD);
  res.end(JSON.stringify(own ? react(req, u.searchParams) : { ok: false }));
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;
server.listen(PORT, '127.0.0.1', () => console.log(`público en 127.0.0.1:${PORT} · feed ${FEED} · estado ${STATE || '(solo memoria)'}`));
