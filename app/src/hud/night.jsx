// «Resultados de esta noche»: bocas de urna de las encuestadoras y parciales oficiales de la ONPE,
// contienda por contienda, empezando por las más grandes. Con buscador y filtro por cargo.
import { useEffect, useMemo, useState } from 'react';
import { ChartColumn, ExternalLink, Megaphone, Search, Trophy } from 'lucide-react';
import { getJson } from '../lib/data.jsx';
import { norm, timeLima } from '../lib/format.js';
import { Pager, usePaged } from './common.jsx';

const CARGO = { gobernador: 'Gobernador regional', provincial: 'Alcalde provincial', distrital: 'Alcalde distrital', otra: 'Otra' };
const NIVEL = { gobernador: 1, provincial: 2, distrital: 3 };
const ORDEN = { provincial: 1, gobernador: 2, distrital: 3, otra: 4 };
const LIMA_METRO = '140100';
const OTROS = '#cbd5e1';

// El color sigue a la organización (igual en todas las tarjetas), nunca al puesto que ocupa.
// Paleta categórica validada (8 tonos, en orden fijo) para las organizaciones que más aparecen;
// el resto va en pizarra con su nombre al lado, y «otros» en gris.
const FIJOS = {
  'RENOVACION POPULAR': '#2a78d6', 'AVANZA PAIS': '#eb6834', 'SOMOS PERU': '#1baf7a', 'PODEMOS PERU': '#eda100',
  'ALIANZA PARA EL PROGRESO': '#e87ba4', 'ACCION POPULAR': '#008300', 'FUERZA POPULAR': '#4a3aa7', 'JUNTOS POR EL PERU': '#e34948',
};
const PIZARRA = ['#64748b', '#8b8fa3'];
const colorDe = (partido) => {
  const k = norm(partido);
  if (FIJOS[k]) return FIJOS[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PIZARRA[h % 2];
};
const pctEs = (v, d = 1) => (v === null || v === undefined || Number.isNaN(+v) ? '—' : `${Number(v).toFixed(d).replace('.', ',')} %`);

/** Pide un archivo cada `ms` mientras el componente esté a la vista. */
function usePoll(path, ms) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => getJson(path).then((j) => { if (alive && j) setD(j); });
    load();
    const t = setInterval(load, ms);
    return () => { alive = false; clearInterval(t); };
  }, [path, ms]);
  return d;
}

/** Bocas de urna publicadas (las comparte la marquesina de arriba y el panel). */
export function useBocas() {
  const bu = usePoll('canal/bocaurna', 30000);
  return bu?.items || null;
}

/** Barra apilada al 100 %: cada organización con su color, «otros» en gris, 2 px de aire entre tramos. */
function StackBar({ filas, alto = 12 }) {
  const suma = filas.reduce((s, f) => s + (f.pct || 0), 0);
  const otros = Math.max(0, 100 - suma);
  const tramos = [...filas.map((f) => ({ w: f.pct || 0, c: colorDe(f.partido, f.nombre), t: `${f.nombre || f.partido}${f.partido && f.nombre ? ` (${f.partido})` : ''}: ${pctEs(f.pct)}` })),
    ...(otros > 0.5 ? [{ w: otros, c: OTROS, t: `Otros: ${pctEs(otros)}` }] : [])];
  return (
    <div className="flex w-full gap-[2px] rounded-full overflow-hidden bg-bg-2" style={{ height: alto }} role="img" aria-label={tramos.map((x) => x.t).join('; ')}>
      {tramos.map((x, i) => <span key={i} title={x.t} className="h-full transition-[width] duration-500 hover:brightness-110" style={{ width: `${x.w}%`, background: x.c }} />)}
    </div>
  );
}

/** Barras horizontales con el valor al lado (para la contienda destacada). */
function HBars({ filas }) {
  const max = Math.max(1, ...filas.map((f) => f.pct || 0));
  return (
    <ul className="space-y-3">
      {filas.map((f, i) => (
        <li key={i} className="group" title={`${f.nombre || f.partido}: ${pctEs(f.pct)}`}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate"><b className={i === 0 ? 'font-bold' : 'font-semibold'}>{f.nombre || f.partido}</b>{f.nombre && f.partido && <span className="text-dim"> · {f.partido}</span>}</span>
            <span className="num font-bold text-[15px]">{pctEs(f.pct)}</span>
          </div>
          <div className="mt-1.5 h-[10px] rounded-full bg-bg-2 overflow-hidden">
            <span className="block h-full rounded-full transition-[width] duration-700 group-hover:brightness-110" style={{ width: `${(100 * (f.pct || 0)) / max}%`, background: colorDe(f.partido, f.nombre) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Fuente({ r, mode }) {
  if (mode === 'onpe') return (
    <span className="flex items-center gap-2 flex-wrap">
      <span><b className="num text-ink-2">{pctEs(r.actas)}</b> de actas</span>
      {r.corte ? <span>· corte <span className="num">{timeLima(r.corte)}</span></span> : null}
      {r.puedeCambiar === false && <span className="tag tag-ok">ya no puede cambiar</span>}
    </span>
  );
  return (
    <span className="flex items-center gap-x-2 gap-y-1 flex-wrap">
      <span className="tag tag-warn">{r.estudio}</span>
      <span><b className="text-ink-2">{r.encuestadora}</b>{r.medio ? ` · ${r.medio}` : ''}{r.hora ? ` · ${r.hora}` : ''}</span>
      {(r.muestra || r.margen) && <span>· {r.muestra ? `muestra ${r.muestra}` : ''}{r.muestra && r.margen ? ', ' : ''}{r.margen ? `margen ±${String(r.margen).replace(/%$/, '')} %` : ''}</span>}
      {r.enlace && <a href={r.enlace} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline">Ver fuente <ExternalLink size={11} /></a>}
    </span>
  );
}

const ventaja = (filas) => (filas.length > 1 ? (filas[0].pct || 0) - (filas[1].pct || 0) : null);

/** La contienda más grande, en grande: ganador parcial a la izquierda, todas las barras a la derecha. */
function Destacada({ r, mode }) {
  const lider = r.filas[0];
  const v = ventaja(r.filas);
  return (
    <article className="rounded-2xl border border-line bg-[linear-gradient(135deg,#f7f9fc_0%,#ffffff_60%)] p-4 xl:p-5 grid gap-5 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 flex-wrap"><span className="tag tag-info">{CARGO[r.tipo] || r.tipo}</span><span className="eyebrow">la contienda más grande</span></div>
        <h3 className="display text-[26px] xl:text-[30px] leading-tight mt-2">{r.lugar}</h3>
        {lider ? (
          <div className="mt-3 rounded-xl bg-white border border-line p-3.5 flex items-center gap-3">
            <span className="flex-none w-11 h-11 rounded-full grid place-items-center text-white" style={{ background: colorDe(lider.partido, lider.nombre) }}><Trophy size={20} /></span>
            <div className="min-w-0">
              <div className="text-[12px] text-dim">{mode === 'bu' ? 'Primero en la boca de urna' : 'Primero en el conteo'}</div>
              <div className="font-bold text-[16px] leading-tight truncate">{lider.nombre || lider.partido}</div>
              {lider.nombre && lider.partido && <div className="text-[12.5px] text-dim truncate">{lider.partido}</div>}
            </div>
            <div className="ml-auto text-right">
              <div className="num font-bold text-[30px] leading-none">{pctEs(lider.pct)}</div>
              {v !== null && <div className="text-[12px] text-dim mt-1">+{pctEs(v).replace(' %', '')} pts</div>}
            </div>
          </div>
        ) : <p className="mt-3 text-[14px] text-dim">Aún sin votos contados en esta contienda.</p>}
        <div className="mt-auto pt-3 text-[12px] text-dim"><Fuente r={r} mode={mode} /></div>
      </div>
      <div className="min-w-0">
        {r.filas.length ? <><StackBar filas={r.filas} alto={14} /><div className="mt-4"><HBars filas={r.filas.slice(0, 6)} /></div></>
          : <div className="h-full grid place-items-center text-dim text-[13px] py-6">Las barras aparecen apenas haya votos.</div>}
      </div>
    </article>
  );
}

function Tarjeta({ r, mode }) {
  const v = ventaja(r.filas);
  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`tag ${r.tipo === 'gobernador' ? 'tag-info' : 'tag-dim'}`}>{CARGO[r.tipo] || r.tipo}</span>
          <h3 className="font-bold text-[17px] leading-tight mt-1.5 truncate">{r.lugar}</h3>
          {r.ruta && r.ruta !== r.lugar && <div className="text-[12px] text-dim truncate">{r.ruta}</div>}
        </div>
        {r.filas[0] && (
          <div className="flex-none text-right">
            <div className="num font-bold text-[22px] leading-none" style={{ color: 'var(--color-ink)' }}>{pctEs(r.filas[0].pct)}</div>
            {v !== null && <div className="text-[11.5px] text-dim mt-1">ventaja {pctEs(v).replace(' %', '')} pts</div>}
          </div>
        )}
      </div>
      {r.filas.length ? (
        <>
          <div className="mt-3"><StackBar filas={r.filas} /></div>
          <ol className="mt-3 space-y-1.5">
            {r.filas.slice(0, 4).map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <span className="flex-none w-2.5 h-2.5 rounded-full" style={{ background: colorDe(f.partido, f.nombre) }} aria-hidden="true" />
                <span className="min-w-0 truncate"><span className={i === 0 ? 'font-bold' : 'font-medium'}>{f.nombre || f.partido}</span>{f.nombre && f.partido && <span className="text-dim"> · {f.partido}</span>}</span>
                <span className="ml-auto num font-semibold">{pctEs(f.pct)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="mt-3">
          <div className="h-3 rounded-full bg-bg-2 overflow-hidden"><span className="block h-full bg-navy/70" style={{ width: `${Math.min(100, r.actas || 0)}%` }} /></div>
          <p className="text-[12.5px] text-dim mt-2">Aún sin votos contados en esta contienda.</p>
        </div>
      )}
      <div className="mt-3 pt-2.5 border-t border-line text-[11.5px] text-dim"><Fuente r={r} mode={mode} /></div>
    </>
  );
  const cls = 'block h-full rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-[0_10px_24px_-14px_rgba(11,31,75,.45)]';
  return mode === 'onpe' && NIVEL[r.tipo]
    ? <li><a className={`${cls} hover:border-navy/40`} href={`#resultados/${NIVEL[r.tipo]}-${r.ubigeo}`}>{cuerpo}</a></li>
    : <li><article className={cls}>{cuerpo}</article></li>;
}

/** Panel principal de la noche. */
export function NightResults() {
  const onpe = usePoll('data/ambitos/contiendas.json', 60000);
  const buItems = useBocas() || [];
  const [modeSel, setMode] = useState(null);
  const mode = modeSel || (buItems.length ? 'bu' : 'onpe');
  const [tipo, setTipo] = useState('todas');
  const [q, setQ] = useState('');

  const base = useMemo(() => (mode === 'onpe'
    ? (onpe?.filas || []).map(([t, ubigeo, lugar, ruta, actas, corte, top, puedeCambiar]) => ({
      tipo: t, ubigeo, lugar, ruta, actas, corte, puedeCambiar, filas: (top || []).map(([nombre, partido, p]) => ({ nombre, partido, pct: p })),
    }))
    : buItems.map((b) => ({ ...b, ruta: '', filas: b.filas.map((f) => ({ nombre: f.candidato, partido: f.partido, pct: f.pct })) }))
  ), [mode, onpe, buItems]);

  const cuenta = useMemo(() => base.reduce((o, r) => ({ ...o, [r.tipo]: (o[r.tipo] || 0) + 1 }), {}), [base]);
  const rows = useMemo(() => {
    const k = norm(q);
    return base
      .filter((r) => tipo === 'todas' || r.tipo === tipo)
      .filter((r) => !k || norm(`${r.lugar} ${r.ruta}`).includes(k))
      .sort((a, b) => {
        // primero lo general: Lima Metropolitana, luego gobiernos regionales, provincias y distritos
        const la = a.ubigeo === LIMA_METRO && a.tipo === 'provincial' ? 0 : ORDEN[a.tipo] ?? 5;
        const lb = b.ubigeo === LIMA_METRO && b.tipo === 'provincial' ? 0 : ORDEN[b.tipo] ?? 5;
        if (la !== lb) return la - lb;
        if (mode === 'onpe' && (b.actas || 0) !== (a.actas || 0)) return (b.actas || 0) - (a.actas || 0);
        return String(a.lugar).localeCompare(String(b.lugar));
      });
  }, [base, tipo, q, mode]);

  // la contienda más grande va destacada arriba mientras no se filtre
  const destacada = !q && (tipo === 'todas' || tipo === rows[0]?.tipo) && rows[0] && (rows[0].ubigeo === LIMA_METRO || /lima metropolitana/i.test(rows[0].lugar)) ? rows[0] : null;
  const resto = destacada ? rows.slice(1) : rows;
  const pg = usePaged(resto, 8, `${mode}|${tipo}|${q}`);
  const actasMax = Math.max(0, ...(onpe?.filas || []).map((f) => f[4] || 0));

  const Modo = ({ id, icon: I, label, sub }) => (
    <button type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
      className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition-colors border ${mode === id ? 'bg-white text-navy border-white shadow-[0_8px_20px_-12px_rgba(0,0,0,.6)]' : 'bg-white/10 text-white border-white/20 hover:bg-white/15'}`}>
      <I size={18} className="flex-none" />
      <span className="leading-tight"><b className="block text-[14px]">{label}</b><span className={`text-[11.5px] ${mode === id ? 'text-dim' : 'text-white/70'}`}>{sub}</span></span>
    </button>
  );

  return (
    <section className="flex-none rounded-2xl bg-white border border-line shadow-[0_18px_40px_-26px_rgba(11,31,75,.55)] overflow-hidden">
      <div className="bg-[linear-gradient(120deg,#0b1f4b_0%,#13295e_65%,#1d3a7a_100%)] text-white px-4 xl:px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#fda4af] flex items-center gap-1.5"><i className="w-1.5 h-1.5 rounded-full bg-[#fb7185] animate-[blink_1.2s_steps(2)_infinite]" />En vivo · ERM 2026</div>
          <h2 className="display !text-white text-[22px] xl:text-[26px] leading-tight mt-1">Resultados de esta noche</h2>
          <p className="text-[12.5px] text-white/70 mt-0.5">Contienda por contienda, de lo general a tu distrito.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
          <Modo id="bu" icon={Megaphone} label="Boca de urna" sub={buItems.length ? `${buItems.length} contiendas · encuestadoras` : 'aún sin publicar'} />
          <Modo id="onpe" icon={ChartColumn} label="Conteo ONPE" sub={`oficial · hasta ${pctEs(actasMax)} de actas`} />
        </div>
      </div>

      <div className="px-4 xl:px-5 pt-4 flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input className="field !h-10 !pl-9 text-[14px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca tu distrito, provincia o región" aria-label="Filtrar por lugar" />
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {[['todas', 'Todas', base.length], ['gobernador', 'Regional', cuenta.gobernador || 0], ['provincial', 'Provincial', cuenta.provincial || 0], ['distrital', 'Distrital', cuenta.distrital || 0]].map(([k, l, c]) => (
            <button key={k} type="button" aria-pressed={tipo === k} onClick={() => setTipo(k)}
              className={`h-10 px-3.5 rounded-full text-[13px] font-semibold border transition-colors ${tipo === k ? 'bg-navy text-white border-navy' : 'bg-white text-ink-2 border-line hover:border-navy/40'}`}>
              {l} <span className={`num text-[11.5px] ${tipo === k ? 'text-white/70' : 'text-dim'}`}>{c}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 xl:px-5 pb-4">
        <p className={`mt-3 text-[12.5px] rounded-lg px-3 py-2 ${mode === 'bu' ? 'bg-[#fdf3e2] text-[#7c4a03]' : 'bg-accent-soft text-[#2b3a5c]'}`}>
          {mode === 'bu'
            ? <><b>Estimaciones de encuestadoras</b> difundidas por los medios después del cierre. No son resultados oficiales; cada una lleva su fuente.</>
            : <><b>Cifras oficiales de la ONPE</b>, todavía parciales. {onpe?.pendientes ? `Faltan ${onpe.pendientes.toLocaleString('es-PE')} lugares por consultar; se van agregando solos.` : ''}</>}
        </p>
        {destacada && <div className="mt-3"><Destacada r={destacada} mode={mode} /></div>}
        {pg.slice.length ? <ul className="mt-3 grid gap-3 md:grid-cols-2">{pg.slice.map((r, i) => <Tarjeta key={`${r.tipo}-${r.ubigeo || r.id || i}-${r.encuestadora || ''}`} r={r} mode={mode} />)}</ul>
          : !destacada && <p className="text-[13.5px] text-dim py-8 text-center">{mode === 'bu' ? (q || tipo !== 'todas' ? 'No hay bocas de urna publicadas para ese filtro.' : 'Todavía no hay bocas de urna publicadas. Aparecen aquí apenas las confirmemos.') : 'Todavía no hay contiendas con ese filtro.'}</p>}
        <Pager {...pg} />
      </div>
    </section>
  );
}
