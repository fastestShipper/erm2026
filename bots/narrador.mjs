// Narrador de la mesa de datos: cada 3 minutos (o apenas haya algo nuevo) publica en el chat un mensaje
// hecho con datos: bocas de urna que entran, avance de la ONPE, contiendas con más actas y los reportes
// verificados que deja el agregador en local/reportes.jsonl. Sin IA: solo arma frases con cifras y fuentes.
//   node narrador.mjs      escribe narrador.json en ERM_OUT (o bots/out); export_grok lo mezcla con el chat
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.join(HERE, '..');
const OUT = process.env.ERM_OUT || path.join(HERE, 'out');
const FILE = path.join(OUT, 'narrador.json');
const STATE = path.join(ROOT, 'local', 'narrador-state.json');
const REPORTES = path.join(ROOT, 'local', 'reportes.jsonl');
const BOCAS_URL = 'https://peruvian.dev/dataonpe/canal/bocaurna';
const CADA_MS = 3 * 60e3;
const AGENTE = 'Mesa de datos';
const CIERRE = Date.parse('2026-10-04T22:00:00Z');   // 17:00 en Lima: antes, nada de cifras por candidato

const now = Date.now();
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const st = read(STATE, { ultimo: 0, bocas: [], reportes: 0, corte: 0, giro: 0, onpeGiro: 0 });
const out = read(FILE, { items: [] });
const pct = (v) => `${Number(v).toFixed(1).replace('.', ',')} %`;
const hora = (ms) => new Date(ms).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });

function publicar(texto, etiqueta) {
  out.items.unshift({ agente: AGENTE, bot: 'Narrador', tipo: 'publica', etiqueta, ts: new Date(now).toISOString(), texto });
  out.items = out.items.slice(0, 300);
  st.ultimo = now;
}

function frasesBoca(b) {
  const top = b.filas.slice(0, 3).map((f) => `${f.candidato}${f.partido ? ` (${f.partido})` : ''} ${pct(f.pct)}`).join(', ');
  return `${b.lugar}: ${top}`;
}
const cargo = { provincial: 'alcaldía provincial', distrital: 'alcaldía distrital', gobernador: 'gobierno regional' };

async function bocas() {
  try {
    const r = await fetch(`${BOCAS_URL}?t=${now}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    return j.items || [];
  } catch { return null; }
}

const items = now < CIERRE ? [] : (await bocas()) || [];
const latest = read(path.join(ROOT, 'data', 'latest.json'), {});
const els = latest.elecciones || [];
const corte = Math.max(0, ...els.map((e) => e.totales?.fechaActualizacion || 0));
const sinPublicar = items.filter((b) => !st.bocas.includes(b.id));
const reportes = fs.existsSync(REPORTES) ? fs.readFileSync(REPORTES, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const toca = now - st.ultimo >= CADA_MS;
const minuto = now - st.ultimo >= 55e3;

if (minuto && reportes.length > st.reportes) {
  // 1) reporte verificado nuevo (incidencias, comunicados del JNE o la ONPE, etc.)
  const r = reportes[st.reportes];
  publicar(`${r.texto}${r.fuente ? `\nFuente: ${r.fuente}` : ''}`, r.etiqueta || 'reporte');
  st.reportes++;
} else if (minuto && sinPublicar.length) {
  // 2) bocas de urna nuevas: hasta tres lugares por mensaje, primero lo más general
  const orden = { provincial: 0, gobernador: 1, distrital: 2 };
  const lote = sinPublicar.sort((a, b) => (orden[a.tipo] ?? 3) - (orden[b.tipo] ?? 3)).slice(0, 3);
  const enc = [...new Set(lote.map((b) => b.encuestadora))].join(' y ');
  const tipo = new Set(lote.map((b) => b.tipo)).size === 1 ? cargo[lote[0].tipo] : 'varias contiendas';
  publicar(`Boca de urna de ${enc}, ${tipo}. ${lote.map(frasesBoca).join('. ')}.\nSon estimaciones difundidas por los medios, no resultados oficiales. Todas en la pestaña Resultados.`, 'bocaurna');
  st.bocas.push(...lote.map((b) => b.id));
} else if (minuto && corte && corte !== st.corte && now >= CIERRE) {
  // 3) corte nuevo de la ONPE
  const linea = els.map((e) => `${e.menu || e.nombre}: ${pct(e.totales?.actasContabilizadas || 0)} de actas`).join(' · ');
  const nada = els.every((e) => !(e.totales?.actasContabilizadas > 0));
  publicar(`Corte ONPE de las ${hora(corte)}. ${linea}.${nada ? ' La ONPE todavía no publica actas contadas; las mesas recién terminan el conteo y envían sus actas.' : ''}`, 'dato');
  st.corte = corte;
} else if (toca && now >= CIERRE) {
  // 4) nada nuevo: se repasa un lugar distinto cada vez, para que se vea el país entero
  const cont = read(path.join(ROOT, 'data', 'ambitos', 'contiendas.json'), { filas: [] });
  const conActas = (cont.filas || []).filter((f) => f[4] > 0 && f[6]?.length).sort((a, b) => b[4] - a[4]);
  if (conActas.length && st.onpeGiro % 2 === 0) {
    const f = conActas[st.giro % conActas.length];
    const top = f[6].slice(0, 3).map(([c, p, v]) => `${c || p}${c && p ? ` (${p})` : ''} ${pct(v)}`).join(', ');
    publicar(`ONPE en ${f[2]}${f[3] && f[3] !== f[2] ? `, ${f[3]}` : ''} (${cargo[f[0]] || f[0]}), con ${pct(f[4])} de actas: ${top}.${f[7] === false ? ' Ese primer lugar ya no puede cambiar.' : ' Todavía puede cambiar.'}`, 'dato');
  } else if (items.length) {
    const b = items[st.giro % items.length];
    publicar(`Repaso de bocas de urna. ${cargo[b.tipo] ? `${cargo[b.tipo][0].toUpperCase()}${cargo[b.tipo].slice(1)} de ` : ''}${frasesBoca(b)} (${b.encuestadora}${b.medio ? `, ${b.medio}` : ''}). Estimación, no resultado oficial.`, 'bocaurna');
  } else {
    const nada = els.every((e) => !(e.totales?.actasContabilizadas > 0));
    publicar(nada ? `Sin actas contadas todavía en la ONPE (corte ${hora(corte || now)}). Seguimos consultando cada minuto.` : `Seguimos consultando a la ONPE cada minuto (corte ${hora(corte)}).`, 'dato');
  }
  st.giro++; st.onpeGiro++;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(out, null, 1));
fs.writeFileSync(STATE, JSON.stringify(st));
console.log(new Date(now).toISOString(), 'narrador', out.items[0]?.ts === new Date(now).toISOString() ? `publicó: ${out.items[0].texto.slice(0, 90)}` : 'sin novedad');
