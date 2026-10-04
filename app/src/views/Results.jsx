import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, LineChart, Map as MapIcon, MapPin, Star } from 'lucide-react';
import { getText, useData, useNow, useRouteParam } from '../lib/data.jsx';
import { CLOSE_MS, ago, hms, n, norm, partyColor, pct, timeLima, title } from '../lib/format.js';
import { leaderOf, setZone, usePlaces, useZone, useZoneRaces } from '../lib/zona.js';
import { Empty, PageHeader } from '../hud/common.jsx';
import { RaceCard, Verdict, ZonePicker } from '../hud/race.jsx';

const DAY = [
  ['06:00', 'Se instalan las mesas'],
  ['07:00', 'Empieza la votación'],
  ['17:00', 'Termina la votación y se cuenta en cada mesa'],
  ['17:30', 'La ONPE publica resultados a medida que llegan las actas'],
];

export function Waiting() {
  const now = useNow(1000);
  const d = useData();
  const left = CLOSE_MS - now;
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <div className="panel corners p-7">
        <span className="tag tag-warn">Sin resultados oficiales todavía</span>
        <h2 className="text-[26px] font-bold tracking-tight mt-4">Los resultados aparecen aquí apenas la ONPE los publique</h2>
        <p className="text-ink-2 mt-2 max-w-xl">{d.status?.estado === 'bloqueado' ? 'El portal de la ONPE está rechazando nuestras consultas. No usamos trucos para saltar sus protecciones: el tablero se actualiza solo cuando vuelva a responder.' : 'Revisamos el portal oficial cada 2 minutos. Este tablero no muestra estimaciones, encuestas ni proyecciones: solo cifras oficiales.'}</p>
        <div className="mt-6 flex items-end gap-6 flex-wrap">
          <div>
            <div className="eyebrow">{left > 0 ? 'Cierre de la votación en' : 'La votación ya cerró'}</div>
            <div className="num text-[44px] font-semibold leading-none mt-2">{left > 0 ? hms(left) : '—'}</div>
          </div>
          <div className="text-[13px] text-dim pb-1">Hora de Lima · {timeLima(now, { seconds: true })}</div>
        </div>
        <p className="text-[13.5px] text-ink-2 mt-6 max-w-xl">Cuando haya resultados podrás <b className="text-ink">buscar tu distrito, tu provincia o tu región</b>, ver quién va primero y si ese primer lugar todavía puede cambiar.</p>
      </div>
      <div className="panel p-6">
        <div className="flex items-center gap-2 font-semibold"><CalendarClock size={16} className="text-accent" /> El día de hoy</div>
        <ol className="mt-4 space-y-0">
          {DAY.map(([h, t], i) => {
            const at = Date.parse(`2026-10-04T${h}:00-05:00`);
            const next = DAY[i + 1] ? Date.parse(`2026-10-04T${DAY[i + 1][0]}:00-05:00`) : Infinity;
            const st = now >= next ? 'past' : now >= at ? 'now' : 'next';
            return (
              <li key={h} className="flex gap-4 py-3 border-t border-line first:border-0">
                <span className={`num text-[13px] w-12 flex-none ${st === 'now' ? 'text-accent' : 'text-dim'} ${st === 'past' ? 'line-through' : ''}`}>{h}</span>
                <span className={`text-[14px] ${st === 'past' ? 'text-dim' : 'text-ink'}`}>{t}{st === 'now' && <span className="tag tag-info ml-2">ahora</span>}</span>
              </li>
            );
          })}
        </ol>
        <p className="text-[12px] text-dim mt-3">Horario oficial: erm2026.onpe.gob.pe</p>
      </div>
    </div>
  );
}

/* ───────── Regiones: mapa y tabla de la elección de gobernador ───────── */

function PeruMap({ election, selected, onSelect }) {
  const [geo, setGeo] = useState(null);
  useEffect(() => { fetch('geo/peru.json').then((r) => r.json()).then(setGeo).catch(() => {}); }, []);
  const byName = useMemo(() => Object.fromEntries((election.departamentos || []).map((d) => [norm(d.nombre), d])), [election]);
  if (!geo) return <div className="skeleton h-[420px]" />;
  const W = 420, H = 560, lon0 = -81.4, lat0 = 0.1, k = Math.cos((9 * Math.PI) / 180), s = Math.min(W / (12.8 * k), H / 18.5);
  const P = ([x, y]) => `${((x - lon0) * k * s).toFixed(1)},${((lat0 - y) * s).toFixed(1)}`;
  const legend = new Map();
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[520px]" role="img" aria-label="Mapa del Perú por región">
        {geo.features.map((f) => {
          const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
          const dpath = rings.map((r) => 'M' + r.map(P).join('L') + 'Z').join('');
          if (/titicaca/i.test(f.properties.name)) return <path key="lago" d={dpath} fill="#cfe0f5" />;
          const d = byName[norm(f.properties.name)];
          const lead = leaderOf(d?.participantes);
          const col = lead ? partyColor(lead.codPartido, lead.partido) : '#dfe5ee';
          if (lead) legend.set(title(lead.partido), col);
          const sel = d && d.ubigeo === selected;
          return (
            <path key={f.properties.id || f.properties.name} d={dpath} fill={col} fillOpacity={lead ? 0.85 : 1} stroke={sel ? '#0b1220' : '#ffffff'} strokeWidth={sel ? 2 : 0.8}
              className="cursor-pointer transition-opacity hover:opacity-80" onClick={() => d && onSelect(d.ubigeo)}>
              <title>{lead ? `${title(d.nombre)}: va primero ${lead.candidato ? title(lead.candidato) + ', ' : ''}${title(lead.partido)} con ${pct(lead.pctValidos)} · ${pct(d.totales?.actasContabilizadas)} de actas contadas` : `${f.properties.name}: sin datos todavía`}</title>
            </path>
          );
        })}
      </svg>
      {legend.size > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[12px] text-ink-2">
          <span className="text-dim">Quién va primero en cada región:</span>
          {[...legend].map(([k2, c]) => <span key={k2} className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{k2}</span>)}
        </div>
      )}
    </div>
  );
}

function Regions({ election, onOpen }) {
  const [sel, setSel] = useState(null);
  const rows = useMemo(() => (election.departamentos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)), [election]);
  return (
    <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4 items-start">
      <div className="panel p-5">
        <div className="eyebrow mb-3">{election.menu || election.nombre}</div>
        <PeruMap election={election} selected={sel} onSelect={(code) => { setSel(code); onOpen(`1:${code}`); }} />
      </div>
      <div className="panel p-5 overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-dim text-[11.5px] uppercase tracking-wider"><th className="py-2 font-medium">Región</th><th className="py-2 font-medium">Va primero</th><th className="py-2 font-medium text-right">%</th><th className="py-2 font-medium text-right">Actas</th><th className="py-2 font-medium text-right hidden sm:table-cell">¿Puede cambiar?</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const l = leaderOf(r.participantes);
              return (
                <tr key={r.ubigeo} className="border-t border-line align-top cursor-pointer hover:bg-bg-2" onClick={() => onOpen(`1:${r.ubigeo}`)}>
                  <td className="py-2.5 pr-2 font-medium">{title(r.nombre)}</td>
                  <td className="py-2.5 pr-2">{l ? <>{title(l.candidato || l.partido)}{l.candidato && <div className="text-[12px] text-dim">{title(l.partido)}</div>}</> : <span className="text-dim">—</span>}</td>
                  <td className="py-2.5 text-right num">{l ? pct(l.pctValidos, 1) : '—'}</td>
                  <td className="py-2.5 text-right num">{pct(r.totales?.actasContabilizadas, 1)}</td>
                  <td className="py-2.5 text-right hidden sm:table-cell"><Verdict c={r.contienda} compact /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[12px] text-dim mt-3">Toca una región para ver todos sus candidatos. Lima Metropolitana no elige gobernador regional. Para alcaldes, busca tu provincia o distrito en «Mi zona».</p>
      </div>
    </div>
  );
}

/* ───────── Avance: curva del conteo y boletín de cada corte ───────── */

function Curve({ election }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getText(`data/series/eleccion-${election.id}.csv`).then((csv) => setRows((csv || '').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[0]).map((r) => ({ t: +r[0], v: +r[2] }))));
  }, [election.id, election.totales?.fechaActualizacion]);
  if (!rows) return <div className="skeleton h-[240px]" />;
  if (rows.length < 2) return <Empty icon={LineChart} title="La curva aparece desde el segundo corte oficial" />;
  const W = 900, H = 240, L = 46, B = 28, T = 12, R = 14;
  const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => T + (1 - v / 100) * (H - T - B);
  const pts = rows.map((r) => `${X(r.t).toFixed(1)},${Y(r.v).toFixed(1)}`);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[240px]" preserveAspectRatio="none">
        <defs><linearGradient id="ar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2563eb" stopOpacity="0.22" /><stop offset="1" stopColor="#2563eb" stopOpacity="0" /></linearGradient></defs>
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e4e9f0" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" fill="#6f7d91" fontSize="11" fontFamily="Geist Mono">{v}%</text></g>)}
        <path d={`M${X(t0)},${Y(0)}L${pts.join('L')}L${X(t1)},${Y(0)}Z`} fill="url(#ar)" />
        <polyline points={pts.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {[rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].map((r, i) => <text key={i} x={X(r.t)} y={H - 6} textAnchor="middle" fill="#6f7d91" fontSize="11" fontFamily="Geist Mono">{timeLima(r.t)}</text>)}
      </svg>
      <p className="text-[12.5px] text-dim mt-2">{n(rows.length)} cortes oficiales · último: {pct(rows[rows.length - 1].v, 2)} de actas contadas a las {timeLima(t1)} · <a className="text-accent-2 hover:underline" href={`data/series/eleccion-${election.id}.csv`} download>descargar CSV</a></p>
    </div>
  );
}

/** Un boletín de corte: lo que cambió entre un corte de la ONPE y el anterior. Lo genera el programa, sin IA. */
export function Bulletin({ b, isNew = false, dense = false }) {
  return (
    <div className={dense ? '' : 'py-4 border-t border-line first:border-0'}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="num font-bold text-[15px] text-navy">Corte {b.hora}</span>
        {isNew && <span className="tag tag-info">nuevo para ti</span>}
        {b.cambiosTotal > 0 && <span className="tag tag-warn">{b.cambiosTotal} {b.cambiosTotal === 1 ? 'cambio de primer lugar' : 'cambios de primer lugar'}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {(b.avance || []).filter((a) => a.actasPct !== null && a.actasPct !== undefined).map((a) => (
          <span key={a.id} className="chip">{a.eleccion}: <b className="num text-ink">{pct(a.actasPct, 1)}</b>{a.antesPct !== null && a.antesPct !== undefined && a.antesPct !== a.actasPct && <span className="num text-dim">(+{(a.actasPct - a.antesPct).toFixed(1)})</span>}</span>
        ))}
      </div>
      {!dense && b.cambios?.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-[13.5px] text-ink-2">
          {b.cambios.map((c, i) => <li key={i}><b className="text-ink">{c.lugar}</b> · {c.eleccion.toLowerCase()}: pasa a primer lugar {title(c.candidato || c.ahora)}{c.candidato ? ` (${title(c.ahora)})` : ''}; antes iba {title(c.antes)}.</li>)}
          {b.cambiosTotal > b.cambios.length && <li className="text-dim">Y {b.cambiosTotal - b.cambios.length} más.</li>}
        </ul>
      )}
      {(b.firmes || []).some((f) => f.firmes > 0) && (
        <p className="text-[13px] text-ink-2 mt-2">El primer lugar ya no puede cambiar con las actas que faltan en {b.firmes.filter((f) => f.firmes > 0).map((f) => `${n(f.firmes)} de ${n(f.conDatos)} ${{ 1: 'regiones', 2: 'provincias', 3: 'distritos' }[f.nivel] || 'lugares'}`).join(', ')}.</p>
      )}
      <p className="text-[12.5px] text-dim mt-1.5">Revisión: {b.observaciones?.totales ? `${n(b.observaciones.totales)} ${b.observaciones.totales === 1 ? 'diferencia' : 'diferencias'} en los totales` : 'los totales cuadran'}{b.observaciones?.actasRevisadas ? ` · ${n(b.observaciones.actasRevisadas)} actas revisadas, ${n((b.observaciones.actasImportantes || 0) + (b.observaciones.actasRevisar || 0))} con observaciones` : ''}.</p>
    </div>
  );
}

/** Recuerda el último corte que vio este navegador, para marcar lo nuevo. */
export function useLastSeen(corte) {
  const [seen] = useState(() => { try { return +localStorage.getItem('erm-visto') || 0; } catch { return 0; } });
  useEffect(() => {
    if (!corte) return undefined;
    const t = setTimeout(() => { try { localStorage.setItem('erm-visto', String(corte)); } catch { /* sin almacenamiento */ } }, 4000);
    return () => clearTimeout(t);
  }, [corte]);
  return seen;
}

function Progress({ els }) {
  const d = useData();
  const [eid, setEid] = useState(null);
  const e = els.find((x) => x.id === eid) || els[0];
  const items = d.boletines?.items || [];
  const seen = useLastSeen(items[0]?.corte);
  const [more, setMore] = useState(false);
  const fresh = seen ? items.filter((b) => b.corte > seen) : [];
  const shown = more ? items : items.slice(0, 6);
  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="font-semibold">Actas contadas, corte por corte</div>
          {els.length > 1 && <div className="seg flex-wrap">{els.map((x) => <button key={x.id} aria-pressed={x.id === e.id} onClick={() => setEid(x.id)}>{x.menu || x.nombre}</button>)}</div>}
        </div>
        <Curve election={e} />
      </section>
      <section className="panel p-5">
        <div className="font-semibold">Boletín de cada corte</div>
        <p className="text-[12.5px] text-dim mt-1">Lo arma el programa con los datos de la ONPE, sin inteligencia artificial.</p>
        {seen > 0 && fresh.length > 0 && (
          <div className="mt-3 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-[#2b3a5c]">Desde tu última visita (corte de las {timeLima(seen)}) hubo <b>{fresh.length}</b> {fresh.length === 1 ? 'corte nuevo' : 'cortes nuevos'} y <b>{n(fresh.reduce((a, b) => a + (b.cambiosTotal || 0), 0))}</b> cambios de primer lugar.</div>
        )}
        {items.length === 0 ? <p className="text-[13.5px] text-dim mt-4">El primer boletín sale con el primer corte.</p> : <div className="mt-1">{shown.map((b) => <Bulletin key={b.corte} b={b} isNew={seen > 0 && b.corte > seen} />)}</div>}
        {items.length > 6 && <button type="button" className="btn-ghost w-full justify-center mt-2" onClick={() => setMore(!more)}>{more ? 'Ver solo los últimos' : `Ver los ${items.length} cortes`}</button>}
      </section>
    </div>
  );
}

/* ───────── vista ───────── */

export default function Results() {
  const d = useData();
  const places = usePlaces();
  const saved = useZone();
  const param = useRouteParam();
  const fromUrl = param && /^[123]-\w+$/.test(param) ? param.replace('-', ':') : null;
  const zone = fromUrl || saved;
  const tabFromUrl = param === 'avance' || param === 'regiones' ? param : null;
  const [mode, setMode] = useState(tabFromUrl || (zone ? 'zona' : 'regiones'));
  useEffect(() => { if (fromUrl) setMode('zona'); else if (tabFromUrl) setMode(tabFromUrl); }, [fromUrl, tabFromUrl]);
  const races = useZoneRaces(zone, places);
  const els = d.latest?.elecciones || [];
  const eGob = els.find((e) => (e.tipo || (e.nivel === 1 ? 'gobernador' : '')) === 'gobernador') || els[0];

  if (!d.live || !els.length) return (
    <>
      <PageHeader eyebrow="Resultados oficiales · ONPE" title="Resultados">Cifras oficiales de la ONPE, sin estimaciones ni proyecciones.</PageHeader>
      <Waiting />
    </>
  );

  const corte = Math.max(0, ...els.map((e) => e.totales?.fechaActualizacion || 0));
  const place = zone && places?.byId[zone];
  const open = (z) => { location.hash = `#resultados/${z.replace(':', '-')}`; setMode('zona'); };
  const pick = (z) => { setZone(z); open(z); };
  return (
    <>
      <PageHeader eyebrow={`Resultados oficiales · corte ONPE ${timeLima(corte)}`} title="Resultados">
        Cifras oficiales de la ONPE. Cada región, cada provincia y cada distrito eligen por separado: busca tu lugar para ver quién va primero y si eso todavía puede cambiar.
      </PageHeader>

      {/* avance de cada elección: una franja compacta, para que tu zona quede a la vista */}
      <div className="panel px-4 py-3.5 mb-4 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        {els.slice(0, 4).map((e) => (
          <div key={e.id} className="min-w-0">
            <div className="eyebrow truncate">{e.menu || e.nombre}</div>
            <div className="flex items-baseline gap-2 mt-1.5"><span className="num text-[20px] font-semibold leading-none">{pct(e.totales?.actasContabilizadas, 1)}</span><span className="text-[12px] text-dim truncate">de actas<span className="hidden sm:inline"> · participación {pct(e.totales?.participacionCiudadana, 1)}</span></span></div>
          </div>
        ))}
      </div>

      <div className="seg mb-4 max-w-full overflow-x-auto">
        <button aria-pressed={mode === 'zona'} onClick={() => setMode('zona')}><MapPin size={13} className="inline mr-1" />Mi zona</button>
        <button aria-pressed={mode === 'regiones'} onClick={() => setMode('regiones')}><MapIcon size={13} className="inline mr-1" />Regiones</button>
        <button aria-pressed={mode === 'avance'} onClick={() => setMode('avance')}><LineChart size={13} className="inline mr-1" />Avance<span className="hidden sm:inline"> del conteo</span></button>
      </div>

      {mode === 'zona' && (
        <div className="max-w-3xl">
          <div className="panel p-5 mb-4">
            <div className="flex items-center gap-2 font-semibold mb-3"><MapPin size={16} className="text-accent" /> Busca tu distrito, tu provincia o tu región</div>
            <ZonePicker places={places} zone={zone} onPick={pick} />
            {place && (
              <div className="flex items-center gap-2 flex-wrap mt-3 text-[13px]">
                <span className="chip"><MapPin size={12} />{place.ruta}</span>
                {saved === zone ? <span className="text-dim flex items-center gap-1"><Star size={12} fill="currentColor" className="text-warn" />Es tu zona: la recordamos en este navegador.</span>
                  : <button type="button" className="text-accent-2 font-semibold hover:underline" onClick={() => setZone(zone)}>Guardar como mi zona</button>}
                {saved && <button type="button" className="text-dim hover:underline ml-auto" onClick={() => { setZone(null); location.hash = '#resultados'; }}>Olvidar mi zona</button>}
              </div>
            )}
            {!places && <p className="text-[12.5px] text-dim mt-2">La lista de lugares se arma con lo que publica la ONPE. Estará en unos minutos.</p>}
          </div>
          {zone && places && !place && <Empty icon={MapPin} title="No encontramos ese lugar">Búscalo por su nombre.</Empty>}
          {!zone && places && <Empty icon={MapPin} title="Elige un lugar">Verás la elección de alcalde de tu distrito y de tu provincia, y la de gobernador de tu región.</Empty>}
          <div className="flex flex-col gap-4">{races.map((r) => <RaceCard key={r.tipo + r.zone} race={r} />)}</div>
        </div>
      )}
      {mode === 'regiones' && eGob && <Regions election={eGob} onOpen={open} />}
      {mode === 'avance' && <Progress els={els} />}
      <p className="text-[12px] text-dim mt-6">Fuente: resultadoelectoral.onpe.gob.pe · consultado {ago(Date.parse(d.status?.consultado))}. Son resultados parciales hasta que el Jurado Electoral proclame a los ganadores.</p>
    </>
  );
}
