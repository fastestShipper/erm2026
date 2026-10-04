// Recepción de evidencias y denuncias ciudadanas (ERM 2026). Node ≥ 20, sin dependencias.
//   POST /evidencia   JSON { tipo, lugar, mesa, descripcion, enlace, contacto, web, archivos:[{nombre,tipo,datos(base64)}] }
//   GET  /stats       { recibidos, enRevision, verificados }
//   POST /ping?s=ID   { viendo }  personas con la página abierta (id aleatorio de sesión, sin IP)
// Todo queda en una bandeja privada (INBOX). Nada se publica sin revisión humana/editorial.
// No se guarda la IP: solo un hash con sal diaria, para frenar abusos.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8833);
const INBOX = process.env.INBOX || '/var/lib/erm2026-intake';
const MAX_BODY = 15 * 1024 * 1024;          // base64 de 10 MB + texto
const MAX_FILES_BYTES = 10 * 1024 * 1024;
const TIPOS = new Set(['Problema en una mesa o local de votación', 'Acta o cifra que no cuadra', 'Compra de votos o presión a electores',
  'Propaganda prohibida el día de la elección', 'Noticia, audio o imagen falsa', 'Otro']);
// Tipos de archivo permitidos, comprobados por sus primeros bytes (no por lo que diga el navegador).
const MAGIC = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'],
  ['pdf', (b) => b.slice(0, 5).toString() === '%PDF-'],
  ['mp4', (b) => b.slice(4, 8).toString() === 'ftyp'],
  ['mp3', (b) => b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  ['ogg', (b) => b.slice(0, 4).toString() === 'OggS'],
];

fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 });
const SALT = () => crypto.createHash('sha256').update((process.env.SALT || 'erm2026') + new Date().toISOString().slice(0, 10)).digest();
const hits = new Map(); // ipHash -> [timestamps]

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

function stats() {
  let recibidos = 0, revisados = 0, verificados = 0;
  for (const day of fs.readdirSync(INBOX)) {
    const d = path.join(INBOX, day);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const id of fs.readdirSync(d)) {
      recibidos++;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(d, id, 'revision.json'), 'utf8'));
        revisados++;
        if (r.estado === 'confirmado' || r.estado === 'falso') verificados++;
      } catch { /* sin revisar todavía */ }
    }
  }
  return { recibidos, enRevision: recibidos - revisados, verificados };
}
let cache = { t: 0, v: null };
const viewers = new Map(); // id de sesión -> último aviso
function ping(url) {
  const id = (new URL(url, 'http://x').searchParams.get('s') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const now = Date.now();
  if (id && viewers.size < 200000) viewers.set(id, now);
  for (const [k, t] of viewers) if (now - t > 75e3) viewers.delete(k);
  return { viendo: viewers.size };
}

async function readBody(req) {
  return new Promise((ok, ko) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { ko(Object.assign(new Error('muy grande'), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', ko);
  });
}

async function evidencia(req, res) {
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  const ipHash = crypto.createHmac('sha256', SALT()).update(ip).digest('hex').slice(0, 16);
  const now = Date.now();
  const recent = (hits.get(ipHash) || []).filter((t) => now - t < 10 * 60e3);
  if (recent.length >= 5) return send(res, 429, { error: 'Recibimos varios envíos desde tu conexión. Espera unos minutos e intenta de nuevo.' });

  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) {
    return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'El envío es muy pesado (máximo 10 MB en archivos).' : 'No pudimos leer el envío.' });
  }
  if (body.web) return send(res, 200, { ok: true, codigo: 'ERM-OK' }); // trampa para bots: se finge éxito
  const tipo = clean(body.tipo, 80);
  const descripcion = clean(body.descripcion, 3000);
  if (!TIPOS.has(tipo)) return send(res, 400, { error: 'Elige qué pasó.' });
  if (descripcion.length < 20) return send(res, 400, { error: 'Cuéntanos un poco más (al menos 20 caracteres).' });
  const enlace = clean(body.enlace, 500);
  if (enlace && !/^https?:\/\/[^\s]+$/i.test(enlace)) return send(res, 400, { error: 'El enlace no es válido.' });

  const files = Array.isArray(body.archivos) ? body.archivos.slice(0, 4) : [];
  if (files.length > 3) return send(res, 400, { error: 'Puedes subir hasta 3 archivos.' });
  const decoded = [];
  let total = 0;
  for (const f of files) {
    const buf = Buffer.from(String(f?.datos || ''), 'base64');
    total += buf.length;
    if (total > MAX_FILES_BYTES) return send(res, 413, { error: 'Los archivos pasan de 10 MB.' });
    const kind = MAGIC.find(([, test]) => buf.length > 12 && test(buf));
    if (!kind) return send(res, 400, { error: `El archivo «${clean(f?.nombre, 60)}» no es una foto, video, audio o PDF válido.` });
    decoded.push({ buf, ext: kind[0], nombreOriginal: clean(f?.nombre, 120) });
  }

  const codigo = 'ERM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(INBOX, day, codigo);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const archivos = decoded.map((d, i) => {
    const name = `archivo${i + 1}.${d.ext}`;
    fs.writeFileSync(path.join(dir, name), d.buf, { mode: 0o600 });
    return { archivo: name, nombreOriginal: d.nombreOriginal, bytes: d.buf.length, sha256: crypto.createHash('sha256').update(d.buf).digest('hex') };
  });
  const meta = { codigo, recibido: new Date().toISOString(), tipo, lugar: clean(body.lugar, 160), mesa: clean(body.mesa, 120), descripcion, enlace, contacto: clean(body.contacto, 160), archivos, origen: ipHash };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1), { mode: 0o600 });
  recent.push(now); hits.set(ipHash, recent);
  cache.t = 0;
  console.log(new Date().toISOString(), 'nuevo', codigo, tipo, archivos.length, 'archivos');
  return send(res, 201, { ok: true, codigo });
}

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0].replace(/^\/dataonpe\/api/, '');
    if (req.method === 'POST' && url === '/evidencia') return await evidencia(req, res);
    if (url === '/ping' && (req.method === 'POST' || req.method === 'GET')) return send(res, 200, ping(req.url));
    if (req.method === 'GET' && url === '/stats') {
      if (Date.now() - cache.t > 30e3) cache = { t: Date.now(), v: stats() };
      return send(res, 200, cache.v);
    }
    send(res, 404, { error: 'no encontrado' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Error del servidor. Intenta de nuevo en un rato.' });
  }
}).listen(PORT, '127.0.0.1', () => console.log('intake en 127.0.0.1:' + PORT));
