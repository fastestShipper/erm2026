// Contador de personas con la página abierta (ERM 2026). Node ≥ 20, sin dependencias.
//   POST|GET /ping?s=ID  →  { viendo }
// No lee cuerpos, no escribe en disco y no guarda IPs: solo un id aleatorio de sesión, en memoria.
import http from 'node:http';

const PORT = +(process.env.PORT || 8833);
const TTL_MS = 75e3;        // un visitante cuenta mientras avise cada 30 s
const MAX = 200000;         // tope de memoria

const viewers = new Map();  // id de sesión → último aviso
function ping(rawUrl) {
  const id = (new URL(rawUrl, 'http://x').searchParams.get('s') || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const now = Date.now();
  if (id && (viewers.has(id) || viewers.size < MAX)) viewers.set(id, now);
  return viewers.size;
}
setInterval(() => { const now = Date.now(); for (const [k, t] of viewers) if (now - t > TTL_MS) viewers.delete(k); }, 15e3).unref();

const server = http.createServer((req, res) => {
  req.resume();             // se descarta cualquier cuerpo
  const p = req.url.split('?')[0].replace(/^\/dataonpe\/api/, '');
  if (p === '/ping' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ viendo: ping(req.url) }));
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end('{"error":"no encontrado"}');
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 60;
server.listen(PORT, '127.0.0.1', () => console.log('viewers en 127.0.0.1:' + PORT));
