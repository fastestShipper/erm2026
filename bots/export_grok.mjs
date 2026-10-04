#!/usr/bin/env node
// Exporta la actividad pública del equipo electoral de Grok Bot y revisa que cada bot
// cumpla su horario. Corre en el PC donde está abierta la app de Grok Bot (Windows).
//
//   node export_grok.mjs          escribe feed.json y schedule.json en ERM_OUT (o bots/out)
//   node export_grok.mjs --dry    solo imprime
//   ERM_ALERT=1                   avisa por Telegram (hermes) si un bot se atrasa
//
// El roster se lee de la app: si se suma un bot nuevo al equipo electoral, aparece solo.
// Cada bot tiene un apodo (Norma, Luchito…) para que se entienda quién hace qué, pero el
// sitio siempre dice que son agentes de IA.
// Privacidad: se descartan mensajes con temas privados (PRIVATE_RE), se borran correos,
// teléfonos y rutas internas, y nunca se exporta el nombre del dueño de la cuenta.
// Veda electoral: hasta el cierre de la votación se retienen los mensajes que mencionan candidatos,
// organizaciones políticas, encuestas o tendencias (ver veda.mjs). Se publican solos a las 17:00.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { retener, VEDA_FIN } from './veda.mjs';

const DRY = process.argv.includes('--dry');
const PERSIST = path.join(os.homedir(), 'AppData', 'Roaming', 'Grok Bot', 'sand-client-persistence');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = process.env.ERM_OUT || path.join(HERE, 'out');
const STATE = path.join(HERE, 'out', 'alert-state.json');
const DAY = '2026-10-04';
const SINCE = Date.parse('2026-10-04T01:34:00-05:00');   // la bitácora pública empieza con el brief de las 01:34
const COORD = '5dd0d022-a841-4631-b524-64636e8b5f49';

// Apodo, puesto, qué hace y horario comprometido (lo que cada bot anunció en su bitácora).
// window = horas de Lima en que debe dar señales; maxQuietMin = silencio máximo tolerado.
const KNOWN = {
  [COORD]: { apodo: 'Norma', bot: 'Coordinación', puesto: 'Jefa de la oficina', role: 'Reparte el trabajo, junta lo que encuentra cada uno y decide qué se publica.', window: [0, 24], maxQuietMin: 75 },
  '1bc377ab-1704-416c-b668-c69327dc72a2': { apodo: 'Luchito', bot: 'Datos ONPE', puesto: 'Analista de datos', role: 'Vigila el portal de la ONPE: cada corte oficial, con su hora y el % de actas.', window: [6, 24], maxQuietMin: 45 },
  'f5b8b86c-0716-4d8a-885e-f277a9bbbfe3': { apodo: 'Maritza', bot: 'Pulso X', puesto: 'Redes sociales', role: 'Sigue en X a la ONPE, al JNE y a los medios nacionales.', window: [6.08, 22.75], maxQuietMin: 60 },
  'bf035441-d6bd-4015-8247-addd6008b921': { apodo: 'Rosita', bot: 'Verifica', puesto: 'Verificadora', role: 'Contrasta cada afirmación con la ONPE o el JNE antes de darla por cierta.', window: [6.45, 22.95], maxQuietMin: 75 },
  'aaebb43a-e60d-4700-8b2d-aca09a603682': { apodo: 'Kike', bot: 'Desinfo', puesto: 'Cazador de bulos', role: 'Detecta piezas falsas que se vuelven virales: capturas, audios, actas trucadas.', window: [6, 24], maxQuietMin: 60 },
  '8335ac4a-3667-4e4a-a081-ef28f6afc852': { apodo: 'Charo', bot: 'Tablero', puesto: 'Diseñadora del tablero', role: 'Revisa el tablero cada 2 horas: que las cifras coincidan con la ONPE y todo se entienda.', window: [5.67, 24], maxQuietMin: 150 },
  '0eafb8e0-574d-4e42-9dbe-13a886c7ca53': { apodo: 'Jorge', bot: 'Medios', puesto: 'Monitor de medios', role: 'Mira la televisión, escucha la radio y lee los portales de noticias.', window: [6, 24], maxQuietMin: 45 },
  '51f59259-fc4a-4f4c-853b-4fd7e49fea10': { apodo: 'Don Pepe', bot: 'Cronista', puesto: 'Cronista', role: 'Lleva la bitácora: qué hizo cada uno, a qué hora y con qué fuente.', window: [1, 24], maxQuietMin: 75 },
  '08536d58-51e5-4659-b3aa-9e49ad1c4eab': { apodo: 'Beto', bot: 'Poste', puesto: 'Editor gráfico', role: 'Prepara el resumen de cada hora con imagen, solo con datos verificados.', window: [1, 24], maxQuietMin: 75 },
};
// Perfiles que se crean por nombre (aún sin id conocido).
const BY_NAME = [
  [/acta/i, { apodo: 'Toño', bot: 'Actas', puesto: 'Contrastador de actas', role: 'Revisa acta por acta: compara lo que publica la ONPE con el acta escaneada y con la suma de cada distrito.', window: [17, 24], maxQuietMin: 30 }],
];
const SPARE = ['Mari', 'Pocho', 'Yoli', 'Toño', 'Chabuca', 'Lalo'];

const PLAN = [
  { hora: '00:40', que: 'Se arma el equipo y se revisa el portal de la ONPE.', quien: ['Norma', 'Luchito'] },
  { hora: '06:00', que: 'Instalación de mesas: X, medios y desinformación en vigilancia.', quien: ['Maritza', 'Jorge', 'Kike'] },
  { hora: '07:00–17:00', que: 'Votación: se verifican incidentes y afirmaciones contra fuentes oficiales.', quien: ['Rosita', 'Maritza', 'Jorge', 'Kike'] },
  { hora: 'Cada hora', que: 'Resumen horario con imagen y guardia de la coordinación.', quien: ['Beto', 'Norma'] },
  { hora: '17:00 en adelante', que: 'Cierre y conteo: se siguen los cortes oficiales de la ONPE.', quien: ['Luchito', 'Rosita', 'Don Pepe'] },
];

const PRIVATE_RE = /eureka|lone ?star|del ?huerto|fuego ?inka|control ?a\b|controla|nuna|pulsegest|cobro|factura|invoice|deposit|US\$|S\/\s?\d|cliente|\bdeals?\b|crm|gmail|google cloud|ewald|mahr|zpw|password|contraseña|token/i;
const ELECTION_RE = /onpe|jne|elecci|mesa|acta|voto|erm|regional|municipal|gobernador|alcald|desinfo|verific|squad|equipo|portal|tablero|pulso|padr[oó]n|resultados|personer|bitácora|post|medios|cronista|jornada/i;
// Coordinación interna (reparto de roles, apodos, horarios, cambios de brief): queda en feed.json con
// «interno», pero el chat público no la muestra salvo que el visitante lo pida.
const INTERNO_RE = /\bbrief\b|\bme llaman\b|en el equipo soy|quedo en espera|me asign[oó]|cambio el ritmo|ajust[eé] la vigilancia|\bapodos?\b|^\s*qued[oó]\b/i;
const VEREDICTO_RE = /\[(CONFIRMADO|FALSO|ENGAÑOSO|SIN PRUEBA|REVISAR)\]/i;
/** Qué tipo de mensaje es, para rotularlo en el chat. */
const clase = (txt, a) => (VEREDICTO_RE.test(txt) ? 'verificacion'
  : /^\s*\*{0,2}\d{1,2}:\d{2}\.?\*{0,2}/.test(txt) && a.apodo === 'Don Pepe' ? 'bitacora'
  : a.apodo === 'Luchito' && /\bcorte\b|actas contad|% de actas/i.test(txt) ? 'dato' : undefined);
const GREETING_RE =/^(hey|hola)\b.{0,90}(good to meet|what do you want|qué quieres|en qué me pongo|listo para sumarme|me sumo|quedé listo)/i;

const b32 = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.toUpperCase()) { const v = A.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out).toString('utf8');
};

function load() {
  const transcripts = {};
  let roster = [];
  for (const f of fs.readdirSync(PERSIST)) {
    if (!f.endsWith('.blob')) continue;
    const key = b32(f.slice(0, -5));
    try {
      if (key.endsWith('.roster.last-roster')) roster = JSON.parse(fs.readFileSync(path.join(PERSIST, f), 'utf8')).value.rows || [];
      const m = key.match(/\.transcript\.replicas\.([0-9a-f-]{36})$/);
      if (m) transcripts[m[1]] = JSON.parse(fs.readFileSync(path.join(PERSIST, f), 'utf8')).value.entries || [];
    } catch { /* blob a medio escribir: se toma en la próxima vuelta */ }
  }
  return { roster, transcripts };
}

// Equipo electoral: los conocidos + cualquiera nuevo cuya descripción sea de estas elecciones.
function team(roster) {
  const out = [];
  let spare = 0;
  for (const r of roster) {
    const k = KNOWN[r.id] || BY_NAME.find(([re]) => re.test(r.name || ''))?.[1];
    if (!k && !(ELECTION_RE.test(r.description || '') && /2026|elecci/i.test(r.description || ''))) continue;
    out.push({
      id: r.id,
      apodo: k?.apodo || SPARE[spare++ % SPARE.length],
      bot: k?.bot || r.name,
      puesto: k?.puesto || 'Recién llegado',
      role: k?.role || 'Se acaba de sumar al equipo. Su tarea se publica cuando empiece a trabajar.',
      window: k?.window || [0, 24],
      maxQuietMin: k?.maxQuietMin || 120,
      rosterActivity: r.lastActivityAt || 0,
      electionOnly: r.id === COORD,
      nuevo: !k,
    });
  }
  return out;
}

const peruHour = (ms) => { const d = new Date(ms - 5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const hhmm = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function build() {
  const now = Date.now();
  const { roster, transcripts } = load();
  const members = team(roster);
  // Los nombres internos de los bots se reemplazan por sus apodos en los textos públicos.
  const renames = members.map((m) => [m.id === COORD ? /EL ASESOR/g : new RegExp(`\\b${m.bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), m.apodo]);
  const redact = (t) => {
    let s = t
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
      .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[número]')
      .replace(/\/workspace\/\S+/g, '[archivo interno]')
      .replace(/grokbot:\/\/\S+?\)/g, ')')
      .replace(/\[([^\]]+)\]\(\)/g, '$1')
      .replace(/\bsquad\b/gi, 'equipo');
    for (const [re, name] of renames) s = s.replace(re, name);
    return s.replace(/(\p{L}+) \(\1\)/gu, '$1');   // «Norma (Norma)» → «Norma»
  };
  const retenidos = { veda: 0, nunca: 0 };
  const publicText = (c, a) => {
    if (typeof c !== 'string' || !c.trim()) return null;
    if (PRIVATE_RE.test(c) || GREETING_RE.test(c.trim())) return null;
    if (a.electionOnly && !ELECTION_RE.test(c)) return null;
    const motivo = retener(c, now);
    if (motivo) { retenidos[motivo]++; return null; }
    return redact(c).slice(0, 4000);
  };

  const feed = [];
  const agents = [];
  for (const a of members) {
    const entries = (transcripts[a.id] || []).filter((e) => (e.timestampMs || 0) >= SINCE);
    let last = a.rosterActivity >= SINCE ? a.rosterActivity : 0, lastPost = 0, posts = 0, work = 0, doing = null;
    for (const e of entries) {
      last = Math.max(last, e.timestampMs || 0);
      let tipo = null, c = null;
      if (e.kind === 'send-message') { tipo = 'publica'; c = e.message?.content; }
      else if (e.kind === 'message' && e.message?.role === 'assistant') { tipo = 'trabaja'; c = e.message?.content; }
      else if (e.kind === 'message' && e.message?.role === 'user') { tipo = 'recibe'; c = e.message?.content; }
      const txt = tipo && publicText(c, a);
      if (!txt) continue;
      if (tipo === 'publica') { posts++; lastPost = Math.max(lastPost, e.timestampMs); }
      if (tipo === 'trabaja') work++;
      if (tipo !== 'recibe') doing = { ts: e.timestampMs, texto: txt.slice(0, 220) };
      feed.push({ agente: a.apodo, bot: a.bot, tipo, clase: INTERNO_RE.test(txt) ? undefined : clase(txt, a), interno: INTERNO_RE.test(txt) || undefined, ts: new Date(e.timestampMs).toISOString(), texto: txt });
    }
    const h = peruHour(now);
    const inWindow = h >= a.window[0] && h < a.window[1];
    const quietMin = last ? Math.round((now - last) / 60000) : null;
    let estado;
    if (quietMin !== null && quietMin <= 3) estado = 'activo';               // trabajando en este momento
    else if (inWindow) estado = quietMin !== null && quietMin <= a.maxQuietMin ? 'cumpliendo' : 'atrasado';
    else estado = h < a.window[0] ? 'programado' : 'fuera-de-horario';
    agents.push({
      agente: a.apodo, bot: a.bot, puesto: a.puesto, rol: a.role, nuevo: a.nuevo, inicio: hhmm(a.window[0]), estado,
      publicaciones: posts, tareas: work,
      ultimaActividad: last ? new Date(last).toISOString() : null,
      ultimaPublicacion: lastPost ? new Date(lastPost).toISOString() : null,
      haciendo: doing ? { ts: new Date(doing.ts).toISOString(), texto: doing.texto } : null,
      silencioMaximoMin: a.maxQuietMin, _quiet: quietMin,
    });
  }
  feed.sort((x, y) => y.ts.localeCompare(x.ts));
  return {
    feed: {
      nota: 'Mensajes de agentes de IA. Son trabajo en curso: verifica siempre contra la fuente oficial que citan.',
      // durante la veda: cuántos mensajes esperan al cierre de la votación para publicarse
      veda: now < VEDA_FIN ? { hasta: new Date(VEDA_FIN).toISOString(), retenidos: retenidos.veda } : undefined,
      items: feed.slice(0, 800),
    },
    schedule: { dia: DAY, plan: PLAN, agentes: agents },
  };
}

function alert(schedule) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* primera vez */ }
  const late = schedule.agentes.filter((a) => a.estado === 'atrasado');
  const fresh = late.filter((a) => !st[a.agente] || Date.now() - st[a.agente] > 2 * 3600e3);
  if (!fresh.length) return;
  const msg = 'ERM 2026 · bots atrasados: ' + fresh.map((a) => `${a.agente}/${a.bot} (${a._quiet ?? '∞'} min sin actividad)`).join(', ');
  try {
    execFileSync('hermes', ['send', '-t', 'telegram', msg], { stdio: 'ignore', timeout: 30000 });
    for (const a of fresh) st[a.agente] = Date.now();
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(st));
  } catch (e) { console.error('telegram falló:', e.message); }
}

const { feed, schedule } = build();
if (DRY) {
  console.log(schedule.agentes.map((a) => `${a.agente.padEnd(9)} ${a.bot.padEnd(12)} ${a.estado.padEnd(16)} pub=${a.publicaciones} tareas=${a.tareas} quiet=${a._quiet}`).join('\n'));
  console.log('en espera por veda:', feed.veda?.retenidos ?? 0);
  console.log(feed.items.slice(0, 12).map((x) => `${x.ts} ${x.agente} [${x.tipo}]: ${x.texto.slice(0, 140).replace(/\n/g, ' ')}`).join('\n'));
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
// Solo se reescribe si cambió algo: así el repo no acumula commits vacíos.
const writeIfChanged = (f, obj) => {
  const p = path.join(OUT, f), txt = JSON.stringify(obj, (k, v) => (k === '_quiet' ? undefined : v), 1);
  let old = null; try { old = fs.readFileSync(p, 'utf8'); } catch { /* nuevo */ }
  if (old !== txt) fs.writeFileSync(p, txt);
};
writeIfChanged('feed.json', feed);
writeIfChanged('schedule.json', schedule);
if (process.env.ERM_ALERT === '1') alert(schedule);
console.log(new Date().toISOString(), 'ok', feed.items.length, 'mensajes;', feed.veda ? `${feed.veda.retenidos} en espera por veda;` : '', schedule.agentes.map((a) => `${a.agente}=${a.estado}`).join(' '));
