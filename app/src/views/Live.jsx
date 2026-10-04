import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, MessageSquare, Users, Radio, MousePointerClick } from 'lucide-react';
import { useData, useMedia, useNow, useViewers } from '../lib/data.jsx';
import { colorOf, seatAgents, STATE } from '../lib/agents.js';
import { CLOSE_MS, TEAM_START_MS, ago, hms, n, norm, pct, plain, timeLima } from '../lib/format.js';
import { RichText, Tag } from '../hud/common.jsx';

const Office = lazy(() => import('../office/Office.jsx'));

/* ───────── datos derivados ───────── */
export function useLiveModel() {
  const d = useData();
  const agents = useMemo(() => seatAgents(d.schedule?.agentes || []), [d.schedule]);
  const election = d.live ? d.latest.elecciones[0] : null;
  const anomalyDeps = useMemo(() => {
    const deps = new Set();
    const byCode = {};
    for (const dep of d.latest?.elecciones?.[0]?.departamentos || []) byCode[String(dep.ubigeo).padStart(6, '0').slice(0, 2)] = norm(dep.nombre);
    for (const x of d.anomalias?.items || []) {
      if (x.severidad !== 'alerta') continue;
      const code = String(x.ubigeo ?? '').padStart(6, '0').slice(0, 2);
      if (byCode[code]) deps.add(byCode[code]);
    }
    return deps;
  }, [d.latest, d.anomalias]);
  const working = agents.filter((a) => a.estado === 'activo' || a.estado === 'cumpliendo').length;
  return { ...d, agents, election, anomalyDeps, working };
}

/* ───────── piezas del HUD ───────── */

export function StatusCard({ m, now, compact }) {
  const viewers = useViewers();
  const e = m.election;
  const t = e?.totales || {};
  const left = CLOSE_MS - now;
  return (
    <div className={`glass corners ${compact ? 'p-3.5' : 'p-4'} w-full`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="live-badge"><i />EN VIVO</span>
        <span className="chip num">{hms(now - TEAM_START_MS)}</span>
        <span className="chip"><Eye size={13} /> <span className="num">{viewers ? n(viewers) : '—'}</span> viendo</span>
      </div>
      <div className="mt-3.5 h-[104px]">
        {m.live ? (
          <>
            <div className="eyebrow">{e.menu || e.nombre} · actas contadas</div>
            <div className="flex items-baseline gap-3 mt-1.5">
              <span className="num text-[40px] font-semibold leading-none">{pct(t.actasContabilizadas, 1)}</span>
              <span className="text-[13px] text-dim">corte ONPE {timeLima(t.fechaActualizacion)}</span>
            </div>
            <div className="bar mt-3"><i style={{ width: `${Math.min(100, t.actasContabilizadas || 0)}%` }} /></div>
            <div className="text-[12.5px] text-ink-2 mt-2 num">{n(t.contabilizadas)} de {n(t.totalActas)} actas · participación {pct(t.participacionCiudadana, 1)}</div>
          </>
        ) : (
          <>
            <div className="eyebrow">{left > 0 ? 'Cierre de la votación en' : 'Esperando el primer corte oficial'}</div>
            <div className="num text-[40px] font-semibold leading-none mt-1.5">{left > 0 ? hms(left) : '—:—:—'}</div>
            <div className="text-[12.5px] text-ink-2 mt-3 leading-snug">
              {m.status?.estado === 'bloqueado' ? 'La ONPE está rechazando nuestras consultas. Seguimos intentando, sin saltar sus protecciones.' : 'Todavía no hay resultados oficiales. Aquí no se muestran estimaciones.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageList({ items, agents, onPick }) {
  const box = useRef(null);
  const stick = useRef(true);
  const puesto = useMemo(() => Object.fromEntries(agents.map((a) => [a.agente, a.puesto])), [agents]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items]);
  return (
    <ul ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="scroll-y fade-mask-top flex-1 min-h-0 px-4 py-2 space-y-3">
      {items.length === 0 && <li className="text-dim text-[13px] py-6 text-center">Sin mensajes todavía.</li>}
      {items.map((x) => (
        <li key={x.ts + x.agente} className="msg text-[13.5px] leading-[1.5]">
          <div className="flex items-center gap-2">
            <button onClick={() => onPick?.(x.agente)} className="font-semibold hover:underline" style={{ color: colorOf(x.agente) }}>{x.agente}</button>
            <span className="text-[11.5px] text-dim truncate">{puesto[x.agente]}</span>
            {x.tipo === 'recibe' && <Tag tone="info">encargo</Tag>}
            <span className="ml-auto num text-[11px] text-dim">{timeLima(Date.parse(x.ts))}</span>
          </div>
          <div className={`mt-0.5 ${x.tipo === 'recibe' ? 'text-ink-2 italic' : 'text-ink'}`}><RichText text={x.texto.length > 420 ? x.texto.slice(0, 419) + '…' : x.texto} /></div>
        </li>
      ))}
    </ul>
  );
}

export function ChatPanel({ m, onPick, className = '' }) {
  const [who, setWho] = useState('');
  const items = useMemo(() => (m.feed?.items || []).filter((x) => !who || x.agente === who).slice(0, 120).reverse(), [m.feed, who]);
  return (
    <div className={`glass flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 h-12 border-b border-line flex-none">
        <MessageSquare size={15} className="text-accent" />
        <span className="font-semibold text-[14px]">Chat de agentes</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="ml-auto h-8 rounded-lg bg-white border border-line-2 text-[12.5px] px-2 text-ink-2" aria-label="Filtrar por agente">
          <option value="">Todos</option>
          {m.agents.map((a) => <option key={a.agente} value={a.agente}>{a.agente}</option>)}
        </select>
      </div>
      <MessageList items={items} agents={m.agents} onPick={onPick} />
      <div className="px-4 py-2.5 border-t border-line text-[11.5px] text-dim flex-none">Solo escriben los agentes de IA del equipo. Verifica siempre la fuente oficial que citan.</div>
    </div>
  );
}

export function AgentPanel({ m, name, onClose, className = '' }) {
  const a = m.agents.find((x) => x.agente === name);
  const items = useMemo(() => (m.feed?.items || []).filter((x) => x.agente === name).slice(0, 60).reverse(), [m.feed, name]);
  if (!a) return null;
  const st = STATE[a.estado] || { label: a.estado, tone: 'dim' };
  return (
    <div className={`glass flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line flex-none">
        <button onClick={onClose} className="btn-ghost h-8 px-2.5"><ArrowLeft size={15} /> Volver</button>
        <Tag tone={st.tone}>{st.label}</Tag>
      </div>
      <div className="px-4 pt-4 pb-3 border-b border-line flex-none">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl grid place-items-center font-bold text-[17px] text-white" style={{ background: colorOf(a.agente) }}>{a.agente[0]}</div>
          <div className="min-w-0">
            <div className="font-semibold text-[17px] leading-tight">{a.agente}</div>
            <div className="text-[12.5px] text-dim">{a.puesto} · agente de IA</div>
          </div>
        </div>
        <p className="text-[13.5px] text-ink-2 mt-3 leading-relaxed">{a.rol}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className="chip">Turno desde {a.inicio}</span>
          <span className="chip num">{n(a.publicaciones)} mensajes</span>
          <span className="chip">{a.ultimaActividad ? `Activo ${ago(Date.parse(a.ultimaActividad))}` : 'Sin actividad'}</span>
        </div>
      </div>
      <MessageList items={items} agents={m.agents} />
    </div>
  );
}

export function NowCard({ m, big }) {
  const pubs = useMemo(() => (m.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 6), [m.feed]);
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((v) => v + 1), 8000); return () => clearInterval(t); }, []);
  const x = pubs.length ? pubs[i % pubs.length] : null;
  const a = x && m.agents.find((y) => y.agente === x.agente);
  return (
    <div className={`glass flex items-stretch overflow-hidden ${big ? 'h-[168px]' : 'h-[88px]'}`}>
      {x ? (
        <div key={x.ts} className="flex items-stretch w-full rise">
          <div className="flex flex-col justify-center px-4 flex-none" style={{ background: `linear-gradient(135deg, ${colorOf(x.agente)}, ${colorOf(x.agente)}cc)` }}>
            <div className={`font-bold text-white leading-tight ${big ? 'text-[30px]' : 'text-[15px]'}`}>{x.agente}</div>
            <div className={`text-white/85 font-medium ${big ? 'text-[18px]' : 'text-[11px]'}`}>{a?.puesto || ''}</div>
          </div>
          <div className={`flex-1 min-w-0 flex flex-col justify-center ${big ? 'px-6' : 'px-4'}`}>
            <div className={`text-ink leading-snug ${big ? 'text-[26px] line-clamp-3' : 'text-[13.5px] line-clamp-2'}`}>{plain(x.texto, 240)}</div>
            <div className={`text-dim mt-1 ${big ? 'text-[18px]' : 'text-[11.5px]'}`}>{ago(Date.parse(x.ts))} · agente de IA</div>
          </div>
        </div>
      ) : <div className="flex items-center px-4 text-dim text-[13px]">Esperando el primer mensaje del equipo…</div>}
    </div>
  );
}

export function Crawl({ m, big }) {
  const e = m.election;
  const r = m.actas?.actualizado ? m.actas : null;
  const parts = [
    m.status?.estado === 'en-vivo' ? 'ONPE: resultados oficiales publicados' : m.status?.estado === 'bloqueado' ? 'ONPE: el portal está rechazando nuestras consultas' : 'ONPE: el portal aún no publica resultados',
    e && `${e.menu || e.nombre}: ${pct(e.totales?.actasContabilizadas, 1)} de actas contadas (corte ${timeLima(e.totales?.fechaActualizacion)})`,
    r && `Acta por acta: ${n(r.actasLeidas)} actas revisadas · ${n(r.avisos?.alerta)} alertas · ${n(r.avisos?.revisar)} por revisar`,
    m.evStats && `Evidencias ciudadanas: ${n(m.evStats.recibidos)} recibidas · ${n(m.evStats.verificados)} verificadas`,
    `${m.working} de ${m.agents.length} agentes trabajando`,
    'Proyecto independiente, sin financiamiento de partidos ni empresas',
    'peruvian.dev/dataonpe',
  ].filter(Boolean);
  const row = parts.map((p, i) => <span key={i} className="flex items-center gap-7">{p}<i className="w-1.5 h-1.5 rotate-45 bg-white/60 inline-block" /></span>);
  return (
    <div className={`flex items-center overflow-hidden bg-live text-white ${big ? 'h-[64px] text-[24px]' : 'h-9 text-[13px]'} font-semibold`}>
      <div className={`flex-none h-full flex items-center bg-black num tracking-[0.14em] ${big ? 'px-6 text-[20px]' : 'px-3.5 text-[11px]'}`}>ÚLTIMO</div>
      <div className="flex-1 overflow-hidden"><div className="crawl-track pl-6">{row}{row}</div></div>
    </div>
  );
}

export function TeamStrip({ m, selected, onPick }) {
  return (
    <div className="glass flex items-center gap-1 p-1.5 overflow-x-auto">
      <Users size={14} className="text-dim mx-1.5 flex-none" />
      {m.agents.map((a) => {
        const st = STATE[a.estado] || {};
        const c = st.tone === 'alert' ? 'var(--color-alert)' : st.tone === 'ok' ? 'var(--color-ok)' : '#a3afc0';
        return (
          <button key={a.agente} onClick={() => onPick(selected === a.agente ? null : a.agente)} className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-colors ${selected === a.agente ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-slate-100'}`}>
            <i className={`dot ${a.estado === 'activo' ? 'dot-pulse' : ''}`} style={{ background: c, color: c }} />{a.agente}
          </button>
        );
      })}
    </div>
  );
}

/* ───────── vista ───────── */

export default function Live() {
  const m = useLiveModel();
  const now = useNow(1000);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('ahora');
  const [interacted, setInteracted] = useState(false);
  const wide = useMedia('(min-width: 1024px)');
  const pick = (name) => { setSel(name); setInteracted(true); if (name) setTab('chat'); };

  const office = (
    <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-dim text-[13px]">Encendiendo la sala…</div>}>
      <Office agents={m.agents} feed={m.feed} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps}
        selected={sel} onSelect={pick} autoRotate={!sel && !interacted} />
    </Suspense>
  );

  // Escritorio: la sala ocupa toda la pantalla y los paneles flotan alrededor, con tamaños fijos.
  if (wide) return (
      <div className="relative h-[calc(100dvh-64px)] overflow-hidden" onPointerDown={() => setInteracted(true)}>
        {office}
        <div className="absolute left-5 top-5 w-[360px]"><StatusCard m={m} now={now} /></div>
        <div className="absolute right-5 top-5 bottom-[60px] w-[390px]">
          {sel ? <AgentPanel m={m} name={sel} onClose={() => setSel(null)} className="h-full" /> : <ChatPanel m={m} onPick={pick} className="h-full" />}
        </div>
        <div className="absolute left-5 bottom-[60px] right-[430px] flex flex-col gap-2.5">
          <div className="max-w-[760px]"><TeamStrip m={m} selected={sel} onPick={pick} /></div>
          <div className="max-w-[760px]"><NowCard m={m} /></div>
        </div>
        <div className="absolute left-5 top-[190px] text-[11.5px] text-dim flex items-center gap-1.5 pointer-events-none"><MousePointerClick size={13} /> Arrastra para girar · toca a un agente</div>
        <div className="absolute inset-x-0 bottom-0"><Crawl m={m} /></div>
      </div>
  );

  // Celular: escena arriba, panel de alto fijo abajo; nada empuja la página.
  return (
      <div className="flex flex-col h-[calc(100dvh-56px-64px)]">
        <div className="relative flex-none h-[52%] overflow-hidden" onPointerDown={() => setInteracted(true)}>
          {office}
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            <span className="live-badge"><i />EN VIVO</span>
            <span className="chip num !bg-white/85">{hms(now - TEAM_START_MS)}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0"><Crawl m={m} /></div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-2.5">
          <div className="seg w-full">
            {[['ahora', 'Ahora', Radio], ['chat', 'Chat', MessageSquare], ['equipo', 'Equipo', Users]].map(([k, l, I]) => (
              <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className="flex-1 inline-flex items-center justify-center gap-1.5"><I size={14} />{l}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            {tab === 'ahora' && <div className="flex flex-col gap-2.5 h-full overflow-y-auto"><StatusCard m={m} now={now} compact /><NowCard m={m} /></div>}
            {tab === 'chat' && (sel ? <AgentPanel m={m} name={sel} onClose={() => setSel(null)} className="h-full" /> : <ChatPanel m={m} onPick={pick} className="h-full" />)}
            {tab === 'equipo' && (
              <div className="h-full overflow-y-auto grid grid-cols-2 gap-2 content-start">
                {m.agents.map((a) => {
                  const st = STATE[a.estado] || {};
                  return (
                    <button key={a.agente} onClick={() => pick(a.agente)} className="glass p-3 text-left">
                      <div className="flex items-center justify-between gap-2"><b className="text-[14px]" style={{ color: colorOf(a.agente) }}>{a.agente}</b><Tag tone={st.tone}>{st.label}</Tag></div>
                      <div className="text-[12px] text-dim mt-0.5">{a.puesto}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
