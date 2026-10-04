export const TZ = 'America/Lima';
export const CLOSE_MS = Date.parse('2026-10-04T17:00:00-05:00');   // cierre de la votación
export const TEAM_START_MS = Date.parse('2026-10-04T00:38:00-05:00'); // se arma el equipo

const nf = new Intl.NumberFormat('es-PE');
export const n = (v) => (v === null || v === undefined || v === '' || Number.isNaN(v) ? '—' : nf.format(v));
export const pct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(+v) ? '—' : `${Number(v).toFixed(d)}%`);

export const timeLima = (ms, { seconds = false, date = false } = {}) =>
  ms ? new Date(ms).toLocaleString('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...(date ? { day: 'numeric', month: 'short' } : {}), hour12: false }) : '—';

export function ago(ms, now = Date.now()) {
  if (!ms) return '—';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'hace segundos';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

export const hms = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((v) => String(v).padStart(2, '0')).join(':');
};

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/^EL\s+/, '').trim();
export const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s/(«"-])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y|E|En|Por|Para)\b/g, (w, _w, i) => (i === 0 ? w : w.toLowerCase()));

/** Texto de un mensaje de agente → texto plano corto (para cintillos y rótulos). */
export const plain = (t, max = 999) => {
  const s = String(t || '').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
};

/** Paleta neutral para organizaciones políticas: el color sale de un hash del código, no de preferencias. */
const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0d9488', '#ea580c', '#65a30d', '#dc2626', '#475569', '#0284c7', '#c026d3'];
export const partyColor = (code, name) => {
  const k = String(code ?? name ?? '');
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
