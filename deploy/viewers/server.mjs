// Contador de personas con la página abierta (ERM 2026). Node ≥ 20, sin dependencias.
//   POST /ping?s=ID  →  { viendo }
// No lee cuerpos, no escribe en disco y no guarda IPs: solo un id aleatorio de sesión, en memoria.
import http from 'node:http';

const PORT = +(process.env.PORT || 8833);
const SITE = process.env.SITE_ORIGIN || 'https://peruvian.dev';
const TTL_MS = 75e3;        // un visitante cuenta mientras avise cada 30 s
const MAX = 200000;         // tope de memoria

const viewers = new Map();  // id de sesión → último aviso
function ping(rawUrl) {
  const id = (new URL(rawUrl, 'http://x').searchParams.get('s') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  if (id && (viewers.has(id) || viewers.size < MAX)) viewers.set(id, Date.now());
}
// La limpieza corre aparte, cada 15 s: un aviso nunca recorre el mapa.
setInterval(() => { const now = Date.now(); for (const [k, t] of viewers) if (now - t > TTL_MS) viewers.delete(k); }, 15e3).unref();

// Solo cuentan los avisos que vienen de nuestra propia página (otro sitio no puede inflar el número con etiquetas o fetch).
function sameSite(req) {
  const sfs = req.headers['sec-fetch-site'];
  if (sfs) return sfs === 'same-origin';
  const origin = req.headers.origin;
  return !origin || origin === SITE;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer((req, res) => {
  req.resume();             // se descarta cualquier cuerpo
  const p = req.url.split('?')[0].replace(/^\/dataonpe\/api/, '');
  if (p !== '/ping') return json(res, 404, { error: 'no encontrado' });
  if (req.method !== 'POST') return json(res, 405, { error: 'solo POST' });
  if (sameSite(req)) ping(req.url);
  json(res, 200, { viendo: viewers.size });
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;
server.listen(PORT, '127.0.0.1', () => console.log('viewers en 127.0.0.1:' + PORT));
