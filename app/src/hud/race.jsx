// Piezas para mostrar una contienda (un cargo en un lugar): buscador de zona, tarjeta, veredicto y compartir.
import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Search, Share2, X } from 'lucide-react';
import { CARGO, searchPlaces, setZone, share, shareText, splitRows, whatsappUrl, zoneUrl } from '../lib/zona.js';
import { ago, n, partyColor, pct, timeLima, title } from '../lib/format.js';

const NIVEL = { 1: 'Región', 2: 'Provincia', 3: 'Distrito' };

/** Buscador de lugar: escribe y elige tu región, provincia o distrito. */
export function ZonePicker({ places, zone, onPick, autoFocus = false, compact = false }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);
  const res = searchPlaces(places, q, compact ? 6 : 8);
  const place = zone && places?.byId[zone];
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    const f = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  }, []);
  const pick = (x) => { setQ(''); setOpen(false); onPick(x.id); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((v) => Math.min(res.length - 1, v + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((v) => Math.max(0, v - 1)); }
    else if (e.key === 'Enter' && res[hi]) { e.preventDefault(); pick(res[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
        <input className={`field !pl-10 ${compact ? '!h-10 text-[14px]' : ''}`} value={q} autoFocus={autoFocus} disabled={!places} role="combobox" aria-expanded={open && res.length > 0} aria-controls="zona-opciones" aria-autocomplete="list"
          placeholder={!places ? 'Preparando la lista de lugares…' : place ? `Cambiar de lugar (ahora: ${place.ruta})` : 'Escribe tu distrito, provincia o región'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} aria-label="Buscar lugar" />
      </div>
      {open && q.trim().length >= 2 && (
        <ul id="zona-opciones" role="listbox" className="absolute z-30 left-0 right-0 mt-1.5 rounded-xl border border-line bg-white shadow-[0_18px_40px_-18px_rgba(15,23,42,.35)] overflow-hidden">
          {res.length === 0 && (
            <li className="px-4 py-3 text-[13.5px] text-dim">
              {places.list.some((x) => x.nivel === 3) ? 'No encontramos ese lugar. Prueba con otro nombre.'
                : 'Todavía estamos armando la lista de distritos con lo que publica la ONPE (unos minutos). Mientras tanto, busca tu provincia o tu región.'}
            </li>
          )}
          {res.map((x, i) => (
            <li key={x.id} role="option" aria-selected={i === hi}>
              <button type="button" onClick={() => pick(x)} onMouseEnter={() => setHi(i)} className={`w-full text-left px-4 py-2.5 flex items-center gap-3 ${i === hi ? 'bg-accent-soft' : ''}`}>
                <MapPin size={15} className="text-dim flex-none" />
                <span className="min-w-0 flex-1 truncate text-[14px]">{x.ruta}</span>
                <span className="tag tag-dim flex-none">{NIVEL[x.nivel]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ¿Puede cambiar el primer lugar? Es una cuenta con las cifras de la ONPE, no una proyección. */
export function Verdict({ c, tipo, compact = false }) {
  if (!c || c.puedeCambiar === undefined || !c.segundo) return null;
  const firme = !c.puedeCambiar;
  const head = c.actasFaltan === 0 ? 'Se contaron todas las actas' : firme ? 'El primer lugar ya no puede cambiar con las actas que faltan' : 'El primer lugar todavía puede cambiar';
  if (compact) return <span className={`tag ${firme ? 'tag-ok' : 'tag-warn'}`}>{firme ? 'Ya no puede cambiar' : 'Puede cambiar'}</span>;
  return (
    <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: `color-mix(in srgb, var(${firme ? '--color-ok' : '--color-warn'}) 30%, transparent)`, background: `color-mix(in srgb, var(${firme ? '--color-ok' : '--color-warn'}) 6%, transparent)` }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow">¿Puede cambiar el primer lugar?</span>
        <b className={`text-[14px] ${firme ? 'text-ok' : 'text-warn'}`}>{head}</b>
      </div>
      <p className="text-[13px] text-ink-2 mt-1.5 leading-relaxed">
        Diferencia entre el 1.º y el 2.º: <b className="num">{n(c.diferencia)}</b> votos. {c.actasFaltan > 0
          ? <>Faltan <b className="num">{n(c.actasFaltan)}</b> actas: en ellas puede haber como máximo <b className="num">{n(c.votosMaxFaltan)}</b> votos (300 electores por mesa).</>
          : 'No quedan actas por contar.'}
      </p>
      <p className="text-[12px] text-dim mt-1.5">Es una cuenta con las cifras de la ONPE, no una proyección ni una proclamación: al ganador lo proclama el Jurado Electoral.{tipo === 'gobernador' ? ' En la elección regional hay segunda vuelta si nadie pasa el 30% de los votos válidos.' : ''}</p>
    </div>
  );
}

export function ShareButtons({ race }) {
  const [state, setState] = useState(null);
  if (!race.data) return null;
  const text = shareText(race);
  const url = zoneUrl(race.zone);
  const go = async () => { const r = await share(text, url); if (r === 'copiado') { setState('copiado'); setTimeout(() => setState(null), 1800); } };
  return (
    <div className="flex items-center gap-1.5 flex-none">
      <a className="btn-ghost !h-8 !px-2.5 !text-[12.5px]" href={whatsappUrl(text, url)} target="_blank" rel="noopener noreferrer" aria-label="Compartir por WhatsApp">WhatsApp</a>
      <button type="button" className="btn-ghost !h-8 !px-2.5 !text-[12.5px]" onClick={go} aria-label="Compartir o copiar">{state === 'copiado' ? <><Check size={13} />Copiado</> : <><Share2 size={13} />Compartir</>}</button>
    </div>
  );
}

function Row({ p, i, max, showParty }) {
  const c = partyColor(p.codPartido, p.partido);
  return (
    <li className="py-2.5 border-t border-line first:border-0">
      <div className="flex items-center gap-3">
        <span className={`num w-7 h-7 rounded-lg grid place-items-center text-[12.5px] flex-none ${i === 0 ? 'bg-navy text-white font-bold' : 'bg-panel-2 text-ink-2'}`}>{i + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14.5px] truncate">{title(p.candidato || p.partido)}</div>
          {p.candidato && showParty && <div className="text-[12.5px] text-dim truncate">{title(p.partido)}</div>}
        </div>
        <div className="text-right flex-none">
          <div className="num text-[16px] font-semibold">{pct(p.pctValidos, 2)}</div>
          <div className="num text-[11.5px] text-dim">{n(p.votos)} votos</div>
        </div>
      </div>
      <div className="bar mt-2 ml-10"><i style={{ width: `${(100 * (p.votos || 0)) / max}%`, background: c }} /></div>
    </li>
  );
}

/** Tarjeta de una contienda: avance, ranking, blancos y nulos, y si el primer lugar puede cambiar. */
export function RaceCard({ race, onRemove }) {
  const [all, setAll] = useState(false);
  const t = race.data?.totales || {};
  const { orgs, especiales } = splitRows(race.data?.participantes);
  const shown = all ? orgs : orgs.slice(0, 5);
  const max = Math.max(1, ...orgs.map((p) => p.votos || 0));
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="eyebrow">{CARGO[race.tipo]}</div>
          <h2 className="display text-[22px] leading-tight mt-1.5">{race.donde}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <ShareButtons race={race} />
          {onRemove && <button type="button" className="btn-ghost !h-8 !px-2" onClick={onRemove} aria-label="Quitar"><X size={14} /></button>}
        </div>
      </div>
      {!race.data ? (
        <p className="text-[13.5px] text-dim mt-4">{race.cargando ? 'Cargando…' : 'Todavía no tenemos este lugar. Los pedimos de a pocos para no saturar a la ONPE: aparece solo en unos minutos.'}</p>
      ) : (
        <>
          <div className="mt-3">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span><b className="num text-[15px] mr-1">{pct(t.actasContabilizadas, 2)}</b><span className="text-ink-2">de actas contadas</span> <span className="text-dim num">({n(t.contabilizadas)} de {n(t.totalActas)})</span></span>
              <span className="text-dim sm:text-right">corte ONPE <span className="num">{timeLima(t.fechaActualizacion)}</span>{race.data.visto ? ` · consultado ${ago(Date.parse(race.data.visto))}` : ''}</span>
            </div>
            <div className="bar mt-2"><i style={{ width: `${Math.min(100, t.actasContabilizadas || 0)}%` }} /></div>
          </div>
          {orgs.length === 0 ? <p className="text-[13.5px] text-dim mt-4">Todavía no hay votos publicados aquí.</p> : (
            <>
              <ul className="mt-3">{shown.map((p, i) => <Row key={`${p.codPartido}-${i}`} p={p} i={i} max={max} showParty />)}</ul>
              {orgs.length > 5 && <button type="button" className="btn-ghost w-full justify-center mt-2" onClick={() => setAll(!all)}>{all ? 'Ver solo los 5 primeros' : `Ver los ${orgs.length}`}</button>}
            </>
          )}
          {especiales.length > 0 && <p className="text-[12.5px] text-dim mt-3">{especiales.map((p) => `${String(p.partido).charAt(0)}${String(p.partido).slice(1).toLowerCase()}: ${n(p.votos)}`).join(' · ')}. No cuentan para el porcentaje de votos válidos.</p>}
          <Verdict c={race.data.contienda} tipo={race.tipo} />
          <p className="text-[12px] text-dim mt-3">Hojas de vida de los candidatos: <a className="text-accent-2 hover:underline" href="https://votoinformado.jne.gob.pe/" target="_blank" rel="noopener noreferrer">votoinformado.jne.gob.pe</a></p>
        </>
      )}
    </section>
  );
}

/** Versión corta para la portada: los dos primeros de una contienda. */
export function RaceMini({ race }) {
  const t = race.data?.totales || {};
  const { orgs } = splitRows(race.data?.participantes);
  return (
    <a href={`#resultados/${race.zone.replace(':', '-')}`} className="block min-w-0 rounded-xl border border-line bg-white p-3.5 transition-colors hover:border-line-2">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="eyebrow truncate min-w-0">{CARGO[race.tipo]}</span>
        {race.data && <Verdict c={race.data.contienda} compact />}
      </div>
      <div className="font-semibold text-[14.5px] leading-tight truncate mt-1.5">{race.donde}</div>
      {!race.data || orgs.length === 0 ? <p className="text-[13px] text-dim mt-2">{race.cargando ? 'Cargando…' : 'Aún sin datos de este lugar.'}</p> : (
        <>
          <ul className="mt-2 space-y-1.5">
            {orgs.slice(0, 2).map((p, i) => (
              <li key={i} className="flex items-center gap-2.5 text-[14px]">
                <i className="w-2.5 h-2.5 rounded-sm flex-none" style={{ background: partyColor(p.codPartido, p.partido) }} />
                <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{title(p.candidato || p.partido)}</b>{p.candidato && <span className="text-dim"> · {title(p.partido)}</span>}</span>
                <span className="num font-semibold flex-none">{pct(p.pctValidos, 1)}</span>
              </li>
            ))}
          </ul>
          <div className="text-[12px] text-dim mt-2 num">{pct(t.actasContabilizadas, 1)} de actas · corte {timeLima(t.fechaActualizacion)}</div>
        </>
      )}
    </a>
  );
}

/** Guarda la zona elegida y lleva a sus resultados. */
export function pickZone(zone) {
  setZone(zone);
  location.hash = `#resultados/${zone.replace(':', '-')}`;
}
