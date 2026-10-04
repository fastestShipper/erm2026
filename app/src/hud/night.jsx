// «Resultados de esta noche»: bocas de urna de las encuestadoras y parciales oficiales de la ONPE,
// contienda por contienda, empezando por las más grandes. Con buscador y filtro por cargo.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { getJson } from '../lib/data.jsx';
import { norm, partyColor, pct, timeLima } from '../lib/format.js';
import { Pager, usePaged } from './common.jsx';

const CARGO = { gobernador: 'Gobernador regional', provincial: 'Alcalde provincial', distrital: 'Alcalde distrital', otra: 'Otra' };
const NIVEL = { gobernador: 1, provincial: 2, distrital: 3 };
const ORDEN = { provincial: 1, gobernador: 2, distrital: 3, otra: 4 };
const LIMA_METRO = '140100';

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

function Bars({ filas }) {
  const max = Math.max(1, ...filas.map((f) => f.pct || 0));
  return (
    <ul className="mt-2 space-y-1.5">
      {filas.slice(0, 3).map((f, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="min-w-0 truncate text-[13.5px]"><b className="font-semibold">{f.nombre || f.partido}</b>{f.nombre && f.partido && <span className="text-dim"> · {f.partido}</span>}</span>
          <span className="num text-[14px] font-semibold">{pct(f.pct, 1)}</span>
          <span className="col-span-2 bar !h-[5px]"><i style={{ width: `${(100 * (f.pct || 0)) / max}%`, background: partyColor(f.partido, f.nombre) }} /></span>
        </li>
      ))}
    </ul>
  );
}

function Row({ r, mode }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`tag ${r.tipo === 'gobernador' ? 'tag-info' : 'tag-dim'}`}>{CARGO[r.tipo] || r.tipo}</span>
        <b className="text-[15px] leading-tight">{r.lugar}</b>
        {r.ruta && r.ruta !== r.lugar && <span className="text-[12px] text-dim truncate">{r.ruta}</span>}
      </div>
      {r.filas.length ? <Bars filas={r.filas} /> : <p className="text-[13px] text-dim mt-1.5">{mode === 'onpe' ? 'Aún sin votos contados en esta contienda.' : 'Sin cifras.'}</p>}
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-2 text-[12px] text-dim">
        {mode === 'onpe' ? (
          <>
            <span><b className="num text-ink-2">{pct(r.actas, 1)}</b> de actas</span>
            {r.corte ? <span>· corte <span className="num">{timeLima(r.corte)}</span></span> : null}
            {r.puedeCambiar === false && <span className="tag tag-ok">ya no puede cambiar</span>}
          </>
        ) : (
          <>
            <span className="tag tag-warn">{r.estudio}</span>
            <span><b className="text-ink-2">{r.encuestadora}</b>{r.medio ? ` · ${r.medio}` : ''}{r.hora ? ` · ${r.hora}` : ''}</span>
            {(r.muestra || r.margen) && <span>· {r.muestra ? `muestra ${r.muestra}` : ''}{r.muestra && r.margen ? ', ' : ''}{r.margen ? `margen ±${String(r.margen).replace(/%$/, '')}%` : ''}</span>}
            {r.registro && <span>· registro {r.registro}</span>}
            {r.enlace && <a href={r.enlace} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent-2 hover:underline">fuente <ExternalLink size={11} /></a>}
          </>
        )}
      </div>
    </>
  );
  const cls = 'block py-3 border-t border-line first:border-0';
  return mode === 'onpe' && NIVEL[r.tipo]
    ? <li><a className={`${cls} hover:bg-bg-2 -mx-2 px-2 rounded-lg`} href={`#resultados/${NIVEL[r.tipo]}-${r.ubigeo}`}>{inner}</a></li>
    : <li className={cls}>{inner}</li>;
}

/** Bocas de urna publicadas (las comparte la marquesina de arriba y el panel). */
export function useBocas() {
  const bu = usePoll('canal/bocaurna', 30000);
  return bu?.items || null;
}

/** Panel principal de la noche. `live` = la ONPE ya publica. */
export function NightResults() {
  const onpe = usePoll('data/ambitos/contiendas.json', 60000);
  const bu = usePoll('canal/bocaurna', 30000);
  const buItems = bu?.items || [];
  const [modeSel, setMode] = useState(null);
  const mode = modeSel || (buItems.length ? 'bu' : 'onpe');
  const [tipo, setTipo] = useState('todas');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const k = norm(q);
    const list = mode === 'onpe'
      ? (onpe?.filas || []).map(([t, ubigeo, lugar, ruta, actas, corte, top, puedeCambiar]) => ({
        tipo: t, ubigeo, lugar, ruta, actas, corte, puedeCambiar, filas: (top || []).map(([nombre, partido, p]) => ({ nombre, partido, pct: p })),
      }))
      : buItems.map((b) => ({ ...b, lugar: b.lugar, ruta: b.contienda && b.contienda !== b.lugar ? b.contienda : '', filas: b.filas.map((f) => ({ nombre: f.candidato, partido: f.partido, pct: f.pct })) }));
    return list
      .filter((r) => tipo === 'todas' || r.tipo === tipo)
      .filter((r) => !k || norm(`${r.lugar} ${r.ruta}`).includes(k))
      .sort((a, b) => {
        // primero lo global: Lima Metropolitana, luego gobiernos regionales, provincias y distritos
        const la = a.ubigeo === LIMA_METRO && a.tipo === 'provincial' ? 0 : ORDEN[a.tipo] ?? 5;
        const lb = b.ubigeo === LIMA_METRO && b.tipo === 'provincial' ? 0 : ORDEN[b.tipo] ?? 5;
        if (la !== lb) return la - lb;
        if (mode === 'onpe' && (b.actas || 0) !== (a.actas || 0)) return (b.actas || 0) - (a.actas || 0);
        return String(a.lugar).localeCompare(String(b.lugar));
      });
  }, [mode, onpe, buItems, tipo, q]);
  const pg = usePaged(rows, 5, `${mode}|${tipo}|${q}`);

  return (
    <section className="flex-none rounded-2xl bg-white border-2 border-navy/80 shadow-[0_18px_40px_-24px_rgba(11,31,75,.55)] overflow-hidden">
      <div className="px-4 xl:px-5 pt-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow !text-live">Resultados de esta noche</div>
          <h2 className="display text-[20px] xl:text-[22px] leading-tight mt-1">Por contienda, de lo general a tu distrito</h2>
        </div>
        <div className="seg">
          <button aria-pressed={mode === 'bu'} onClick={() => setMode('bu')}>Boca de urna{buItems.length ? ` (${buItems.length})` : ''}</button>
          <button aria-pressed={mode === 'onpe'} onClick={() => setMode('onpe')}>Parciales ONPE</button>
        </div>
      </div>
      <div className="px-4 xl:px-5 mt-3 flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input className="field !h-10 !pl-9 text-[14px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra por distrito, provincia o región" aria-label="Filtrar por lugar" />
        </label>
        <div className="seg">
          {[['todas', 'Todas'], ['gobernador', 'Regional'], ['provincial', 'Provincial'], ['distrital', 'Distrital']].map(([k, l]) => (
            <button key={k} aria-pressed={tipo === k} onClick={() => setTipo(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="px-4 xl:px-5 pb-4">
        <p className={`mt-3 text-[12.5px] rounded-lg px-3 py-2 ${mode === 'bu' ? 'bg-[#fdf3e2] text-[#7c4a03]' : 'bg-accent-soft text-[#2b3a5c]'}`}>
          {mode === 'bu'
            ? <><b>Estimaciones de encuestadoras</b> difundidas por los medios después del cierre. No son resultados oficiales; los publica el equipo con su fuente y ficha técnica.</>
            : <><b>Cifras oficiales de la ONPE</b>, todavía parciales. {onpe?.pendientes ? `Faltan ${onpe.pendientes.toLocaleString('es-PE')} lugares por consultar; se van agregando solos.` : ''}</>}
        </p>
        {pg.slice.length ? <ul className="mt-1">{pg.slice.map((r, i) => <Row key={`${r.tipo}-${r.ubigeo || r.id || i}-${r.encuestadora || ''}`} r={r} mode={mode} />)}</ul>
          : <p className="text-[13.5px] text-dim py-6 text-center">{mode === 'bu' ? (q || tipo !== 'todas' ? 'No hay bocas de urna publicadas para ese filtro.' : 'Todavía no hay bocas de urna publicadas. Aparecen aquí apenas el equipo las confirme.') : 'Todavía no hay contiendas con ese filtro.'}</p>}
        <Pager {...pg} />
      </div>
    </section>
  );
}
