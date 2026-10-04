import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChartColumn, LineChart, MapPin } from 'lucide-react';
import { getText, useData, useNow } from '../lib/data.jsx';
import { CLOSE_MS, hms, n, norm, partyColor, pct, timeLima, title } from '../lib/format.js';
import { Empty, PageHeader, Stat } from '../hud/common.jsx';

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

function PeruMap({ election, scope, onScope }) {
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
          const lead = d?.participantes?.find((p) => p.votos);
          const col = lead ? partyColor(lead.codPartido, lead.partido) : '#dfe5ee';
          if (lead) legend.set(title(lead.partido), col);
          const sel = d && d.ubigeo === scope;
          return (
            <path key={f.properties.id} d={dpath} fill={col} fillOpacity={lead ? 0.85 : 1} stroke={sel ? '#0b1220' : '#ffffff'} strokeWidth={sel ? 2 : 0.8}
              className="cursor-pointer transition-opacity hover:opacity-80" onClick={() => d && onScope(sel ? 'nacional' : d.ubigeo)}>
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

function Ranking({ rows, national }) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [rows]);
  const list = rows.filter((p) => p.votos !== null && p.votos !== undefined);
  const shown = all ? list : list.slice(0, 6);
  const max = Math.max(1, ...list.map((p) => p.votos || 0));
  if (!list.length) return <Empty icon={ChartColumn} title="Todavía no hay votos publicados aquí" />;
  return (
    <div>
      <ul>
        {shown.map((p, i) => {
          const c = partyColor(p.codPartido, p.partido);
          return (
            <li key={`${p.codPartido}-${p.candidato}-${i}`} className="py-3 border-t border-line first:border-0">
              <div className="flex items-center gap-3">
                <span className={`num w-7 h-7 rounded-lg grid place-items-center text-[12.5px] flex-none ${i === 0 ? 'bg-ink text-white font-bold' : 'bg-panel-2 text-ink-2'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14.5px] truncate">{p.candidato && !national ? title(p.candidato) : title(p.partido)}</div>
                  {p.candidato && !national && <div className="text-[12.5px] text-dim truncate">{title(p.partido)} · <a className="text-accent hover:underline" href="https://votoinformado.jne.gob.pe/" target="_blank" rel="noopener">hoja de vida</a></div>}
                </div>
                <div className="text-right flex-none">
                  <div className="num text-[17px] font-semibold">{pct(p.pctValidos, 2)}</div>
                  <div className="num text-[12px] text-dim">{n(p.votos)} votos</div>
                </div>
              </div>
              <div className="bar mt-2.5 ml-10"><i style={{ width: `${(100 * (p.votos || 0)) / max}%`, background: c }} /></div>
            </li>
          );
        })}
      </ul>
      {list.length > 6 && <button className="btn-ghost w-full justify-center mt-3" onClick={() => setAll(!all)}>{all ? 'Ver solo los 6 primeros' : `Ver los ${list.length}`}</button>}
    </div>
  );
}

function Progress({ election }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getText(`data/series/eleccion-${election.id}.csv`).then((csv) => setRows((csv || '').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[0]).map((r) => ({ t: +r[0], v: +r[2] }))));
  }, [election.id, election.totales?.fechaActualizacion]);
  if (!rows) return <div className="skeleton h-[260px]" />;
  if (rows.length < 2) return <Empty icon={LineChart} title="La curva aparece desde la segunda actualización oficial" />;
  const W = 900, H = 280, L = 46, B = 28, T = 12, R = 14;
  const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => T + (1 - v / 100) * (H - T - B);
  const pts = rows.map((r) => `${X(r.t).toFixed(1)},${Y(r.v).toFixed(1)}`);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[280px]" preserveAspectRatio="none">
        <defs><linearGradient id="ar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2563eb" stopOpacity="0.22" /><stop offset="1" stopColor="#2563eb" stopOpacity="0" /></linearGradient></defs>
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e4e9f0" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" fill="#6f7d91" fontSize="11" fontFamily="Geist Mono">{v}%</text></g>)}
        <path d={`M${X(t0)},${Y(0)}L${pts.join('L')}L${X(t1)},${Y(0)}Z`} fill="url(#ar)" />
        <polyline points={pts.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {[rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].map((r, i) => <text key={i} x={X(r.t)} y={H - 6} textAnchor="middle" fill="#6f7d91" fontSize="11" fontFamily="Geist Mono">{timeLima(r.t)}</text>)}
      </svg>
      <p className="text-[12.5px] text-dim mt-2">{n(rows.length)} actualizaciones oficiales · última: {pct(rows[rows.length - 1].v, 2)} a las {timeLima(t1)} · <a className="text-accent hover:underline" href={`data/series/eleccion-${election.id}.csv`} download>descargar CSV</a></p>
    </div>
  );
}

export default function Results() {
  const d = useData();
  const [eid, setEid] = useState(null);
  const [scope, setScope] = useState('nacional');
  const [mode, setMode] = useState('region');
  const els = d.latest?.elecciones || [];
  const e = els.find((x) => x.id === eid) || els[0];
  useEffect(() => setScope('nacional'), [eid]);

  if (!d.live || !e) return (
    <>
      <PageHeader eyebrow="Resultados oficiales · ONPE" title="Resultados">Cifras oficiales de la ONPE, sin estimaciones ni proyecciones.</PageHeader>
      <Waiting />
    </>
  );

  const dep = scope !== 'nacional' && (e.departamentos || []).find((x) => x.ubigeo === scope);
  const t = (dep ? dep.totales : e.totales) || {};
  return (
    <>
      <PageHeader eyebrow={`Resultados oficiales · corte ONPE ${timeLima(e.totales?.fechaActualizacion)}`} title="Resultados"
        right={<div className="seg flex-wrap">{els.map((x) => <button key={x.id} aria-pressed={x.id === e.id} onClick={() => setEid(x.id)}>{x.menu || x.nombre}</button>)}</div>}>
        {e.nombre}. Cada región y cada municipio eligen por separado: elige tu región en el mapa.
      </PageHeader>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Actas contadas" value={pct(t.actasContabilizadas, 2)} sub={`${n(t.contabilizadas)} de ${n(t.totalActas)}`} />
        <Stat label="Participación" value={pct(t.participacionCiudadana, 1)} sub="de electores hábiles" />
        <Stat label="Votos válidos" value={n(t.totalVotosValidos)} sub={`de ${n(t.totalVotosEmitidos)} emitidos`} />
        <Stat label="Actas en el JEE" value={n(t.enviadasJee)} sub="en revisión del Jurado" />
      </div>
      <div className="seg mb-4">
        <button aria-pressed={mode === 'region'} onClick={() => setMode('region')}><MapPin size={13} className="inline mr-1" />Por región</button>
        <button aria-pressed={mode === 'avance'} onClick={() => setMode('avance')}><LineChart size={13} className="inline mr-1" />Avance del conteo</button>
      </div>
      {mode === 'region' ? (
        <div className="grid lg:grid-cols-[1fr_1.15fr] gap-4">
          <div className="panel p-5"><PeruMap election={e} scope={scope} onScope={setScope} /></div>
          <div className="panel p-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <div className="eyebrow">{dep ? 'Región' : 'Todo el país (suma por organización)'}</div>
                <div className="font-semibold text-[18px] mt-1">{dep ? title(dep.nombre) : 'Perú'}</div>
              </div>
              <select className="field h-10 w-auto max-w-[200px]" value={scope} onChange={(ev) => setScope(ev.target.value)} aria-label="Región">
                <option value="nacional">Todo el país</option>
                {(e.departamentos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((x) => <option key={x.ubigeo} value={x.ubigeo}>{title(x.nombre)}</option>)}
              </select>
            </div>
            <Ranking rows={(dep ? dep.participantes : e.participantes) || []} national={!dep} />
            {e.nivel >= 2 && <p className="text-[12.5px] text-dim mt-4">Para alcaldes, busca tu provincia o distrito en la pestaña Buscar.</p>}
          </div>
        </div>
      ) : (
        <div className="panel p-5"><Progress election={e} /></div>
      )}
    </>
  );
}
