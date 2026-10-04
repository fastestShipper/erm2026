#!/usr/bin/env node
// Exporta la bitácora pública del squad electoral de Grok Bot y revisa que cada bot
// cumpla su horario. Corre en el PC donde está abierta la app de Grok Bot (Windows),
// cada 5 minutos, y sube el resultado al servidor por scp.
//
//   node export_grok.mjs            exporta + sube + avisa por Telegram si alguien se atrasa
//   node export_grok.mjs --dry      solo imprime, no sube ni avisa
//
// Privacidad: solo se exportan los agentes electorales listados en AGENTS. Se borran
// correos, teléfonos y montos, y se descarta cualquier mensaje que mencione temas
// privados (PRIVATE_RE). Nunca se exporta el nombre del dueño de la cuenta.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const PERSIST = path.join(os.homedir(), 'AppData', 'Roaming', 'Grok Bot', 'sand-client-persistence');
const OUT = process.env.ERM_OUT || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'out');
const REMOTE = process.env.ERM_REMOTE || 'lima:/srv/erm2026/inbox/bots/';
const STATE = path.join(OUT, 'alert-state.json');
const DAY = '2026-10-04';
const SINCE = Date.parse('2026-10-04T00:30:00-05:00');

// Rol público y horario comprometido (plan publicado por el coordinador a las 00:41).
// window = horas Perú en que el bot debe dar señales; maxQuietMin = silencio máximo tolerado.
const AGENTS = {
  '1bc377ab-1704-416c-b668-c69327dc72a2': { name: 'Datos ONPE', role: 'Consulta el portal y la API de la ONPE y guarda snapshots.', window: [5.67, 23.99], maxQuietMin: 90 },
  'f5b8b86c-0716-4d8a-885e-f277a9bbbfe3': { name: 'Pulso X', role: 'Sigue cuentas oficiales verificadas (ONPE, JNE, medios) en X.', window: [6, 23.99], maxQuietMin: 90 },
  'bf035441-d6bd-4015-8247-addd6008b921': { name: 'Verifica', role: 'Contrasta cada afirmación con la ONPE o el JNE.', window: [7, 23.99], maxQuietMin: 120 },
  'aaebb43a-e60d-4700-8b2d-aca09a603682': { name: 'Desinfo', role: 'Detecta piezas virales falsas (capturas, audios, actas trucadas).', window: [6, 23.99], maxQuietMin: 120 },
  '8335ac4a-3667-4e4a-a081-ef28f6afc852': { name: 'Tablero ERM', role: 'Prepara el tablero público, separado de la data de abril.', window: [5.67, 23.99], maxQuietMin: 180 },
  '5dd0d022-a841-4631-b524-64636e8b5f49': { name: 'Coordinador', role: 'Coordina al squad. Guardia horaria desde las 7:40.', window: [7.67, 23.99], maxQuietMin: 75, electionOnly: true },
};

const PLAN = [
  { hora: '05:40', que: 'Arranque: probar el portal, cerrar la lista de cuentas y separar el tablero de la data de abril.', quien: ['Datos ONPE', 'Pulso X', 'Tablero ERM'] },
  { hora: '06:00', que: 'Instalación de mesas: Pulso X y Desinfo cubren lo que se publica.', quien: ['Pulso X', 'Desinfo'] },
  { hora: '07:00–17:00', que: 'Verifica y Pulso X siguen incidentes y afirmaciones; Datos ONPE consulta el portal.', quien: ['Verifica', 'Pulso X', 'Datos ONPE'] },
  { hora: '07:40 c/hora', que: 'Guardia horaria del coordinador.', quien: ['Coordinador'] },
  { hora: '17:00', que: 'Cierre de locales de votación; empieza el conteo.', quien: ['Datos ONPE', 'Verifica', 'Pulso X', 'Desinfo'] },
];

const PRIVATE_RE = /eureka|lone ?star|del ?huerto|fuego ?inka|control ?a\b|controla|nuna|pulsegest|cobro|factura|invoice|deposit|US\$|S\/\s?\d|cliente|deal|crm|gmail|google cloud|ewald|mahr|zpw/i;
const ELECTION_RE = /onpe|jne|elecci|mesa|acta|voto|erm|regional|municipal|gobernador|alcald|desinfo|verific|squad|portal|tablero|pulso|padr[oó]n|resultados|personer/i;

const b32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.toUpperCase()) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out).toString('utf8');
};

const redact = (t) => t
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
  .replace(/(\+?\d[\d\s-]{7,}\d)/g, '[número]')
  .replace(/grokbot:\/\/\S+?\)/g, ')')
  .replace(/\[([^\]]+)\]\(\)/g, '$1');

function load() {
  const transcripts = {};
  for (const f of fs.readdirSync(PERSIST)) {
    if (!f.endsWith('.blob')) continue;
    const key = b32(f.slice(0, -5));
    const m = key.match(/\.transcript\.replicas\.([0-9a-f-]{36})$/);
    if (!m || !AGENTS[m[1]]) continue;
    try { transcripts[m[1]] = JSON.parse(fs.readFileSync(path.join(PERSIST, f), 'utf8')).value.entries || []; } catch { /* blob a medio escribir */ }
  }
  return transcripts;
}

function peruHour(ms) {
  const d = new Date(ms - 5 * 3600e3);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function build() {
  const now = Date.now();
  const tr = load();
  const feed = [];
  const schedule = [];
  for (const [id, a] of Object.entries(AGENTS)) {
    const entries = (tr[id] || []).filter((e) => (e.timestampMs || 0) >= SINCE);
    let lastActivity = 0, lastPost = 0, posts = 0;
    for (const e of entries) {
      lastActivity = Math.max(lastActivity, e.timestampMs || 0);
      if (e.kind !== 'send-message') continue;
      const c = e.message?.content;
      if (typeof c !== 'string' || !c.trim()) continue;          // widgets/botones no son hallazgos
      if (PRIVATE_RE.test(c)) continue;
      if (a.electionOnly && !ELECTION_RE.test(c)) continue;
      if (/^hey|^hola\.? qued|good to meet you|what do you want me/i.test(c.trim())) continue;
      lastPost = Math.max(lastPost, e.timestampMs);
      posts++;
      feed.push({ agente: a.name, ts: new Date(e.timestampMs).toISOString(), texto: redact(c).slice(0, 4000) });
    }
    const h = peruHour(now);
    const inWindow = h >= a.window[0] && h <= a.window[1];
    const quietMin = lastActivity ? Math.round((now - lastActivity) / 60000) : null;
    let estado = 'fuera-de-horario';
    if (inWindow) estado = quietMin !== null && quietMin <= a.maxQuietMin ? 'cumpliendo' : 'atrasado';
    else if (h < a.window[0]) estado = 'programado';
    const start = `${String(Math.floor(a.window[0])).padStart(2, '0')}:${String(Math.round((a.window[0] % 1) * 60)).padStart(2, '0')}`;
    schedule.push({
      agente: a.name, rol: a.role, inicio: start, estado, publicaciones: posts,
      ultimaActividad: lastActivity ? new Date(lastActivity).toISOString() : null,
      ultimaPublicacion: lastPost ? new Date(lastPost).toISOString() : null,
      silencioMin: quietMin, silencioMaximoMin: a.maxQuietMin,
    });
  }
  feed.sort((x, y) => y.ts.localeCompare(x.ts));
  return {
    feed: { actualizado: new Date(now).toISOString(), nota: 'Mensajes publicados por bots de IA. Son trabajo en curso: verifica siempre contra la fuente oficial que citan.', items: feed.slice(0, 500) },
    schedule: { actualizado: new Date(now).toISOString(), dia: DAY, plan: PLAN, agentes: schedule },
  };
}

function alert(schedule) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* primera vez */ }
  const late = schedule.agentes.filter((a) => a.estado === 'atrasado');
  const fresh = late.filter((a) => !st[a.agente] || Date.now() - st[a.agente] > 2 * 3600e3);
  if (!fresh.length) return;
  const msg = 'ERM 2026 · bots atrasados: ' + fresh.map((a) => `${a.agente} (${a.silencioMin ?? '∞'} min sin actividad)`).join(', ');
  try {
    execFileSync('hermes', ['send', '-t', 'telegram', msg], { stdio: 'ignore', timeout: 30000 });
    for (const a of fresh) st[a.agente] = Date.now();
    fs.writeFileSync(STATE, JSON.stringify(st));
  } catch (e) { console.error('telegram falló:', e.message); }
}

const { feed, schedule } = build();
if (DRY) {
  console.log(JSON.stringify(schedule, null, 1));
  console.log(feed.items.slice(0, 15).map((x) => `${x.ts} ${x.agente}: ${x.texto.slice(0, 160)}`).join('\n'));
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'feed.json'), JSON.stringify(feed, null, 1));
fs.writeFileSync(path.join(OUT, 'schedule.json'), JSON.stringify(schedule, null, 1));
if (REMOTE !== 'none') execFileSync('scp', ['-q', '-o', 'ConnectTimeout=15', path.join(OUT, 'feed.json'), path.join(OUT, 'schedule.json'), REMOTE], { stdio: 'inherit', timeout: 60000 });
if (REMOTE !== 'none') alert(schedule);
console.log(new Date().toISOString(), 'ok', feed.items.length, 'mensajes;', schedule.agentes.map((a) => `${a.agente}=${a.estado}`).join(' '));
