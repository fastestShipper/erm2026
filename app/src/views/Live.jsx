import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Database, MessageSquare, Radio, Users, X } from 'lucide-react';
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
  const actas = d.actas?.actualizado ? d.actas : null;
  return { ...d, actas, agents, election, anomalyDeps, working };
}

/** Recorta un mensaje sin dejar marcas de formato a medias (**negrita**, `código`, [enlace](url)). */
function clip(t, max) {
  if (t.length <= max) return t;
  let s = t.slice(0, max);
  const cut = Math.max(s.lastIndexOf('. '), s.lastIndexOf('\n'));
  if (cut > max * 0.5) s = s.slice(0, cut + 1);
  if ((s.match(/\*\*/g) || []).length % 2) s = s.slice(0, s.lastIndexOf('**'));
  if ((s.match(/`/g) || []).length % 2) s = s.slice(0, s.lastIndexOf('`'));
  const open = s.lastIndexOf('['); if (open > s.lastIndexOf(')')) s = s.slice(0, open);
  return s.trimEnd() + ' …';
}

/** Color de texto legible para el nombre de cada agente (más oscuro que su color de polo). */
const ink = (name) => `color-mix(in srgb, ${colorOf(name)} 82%, #0b1220)`;

export function Avatar({ name, size = 32, dim = false, ring = false }) {
  return (
    <span className="rounded-full grid place-items-center font-bold text-white flex-none select-none"
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorOf(name), opacity: dim ? 0.4 : 1, boxShadow: ring ? '0 0 0 2px #fff' : undefined }}>
      {name === 'Don Pepe' ? 'P' : name[0]}
    </span>
  );
}

/* ───────── piezas del reproductor ───────── */

export function LowerThird({ m, big }) {
  const pubs = useMemo(() => (m.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 6), [m.feed]);
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((v) => v + 1), 8000); return () => clearInterval(t); }, []);
  const x = pubs.length ? pubs[i % pubs.length] : null;
  if (!x) return null;
  const a = m.agents.find((y) => y.agente === x.agente);
  return (
    <div key={x.ts} className={`flex overflow-hidden rise ${big ? 'rounded-[14px] shadow-[0_14px_30px_-14px_rgba(11,31,75,.55)]' : 'rounded-lg shadow-[0_12px_30px_-14px_rgba(11,31,75,.5)]'}`}>
      <div className={`flex-none flex flex-col justify-center text-white ${big ? 'px-[22px] py-4' : 'px-4 py-2.5'}`} style={{ background: colorOf(x.agente) }}>
        <b className={`display !text-white leading-tight ${big ? 'text-[32px]' : 'text-[17px]'}`}>{x.agente}</b>
        <span className={`opacity-90 ${big ? 'text-[19px]' : 'text-[12px]'}`}>{a?.puesto || 'Agente'} · IA</span>
      </div>
      <p className={`m-0 flex-1 min-w-0 flex items-center bg-white text-ink ${big ? 'px-[22px] py-4 text-[26px] leading-[1.3]' : 'px-4 py-2.5 text-[14.5px] leading-[1.35]'}`}>
        <span className={big ? 'line-clamp-3' : 'line-clamp-2'}>{plain(x.texto, 220)}</span>
      </p>
    </div>
  );
}

export function Ticker({ m, big, card }) {
  const e = m.election;
  const r = m.actas;
  const parts = [
    m.status?.estado === 'en-vivo' ? 'ONPE: resultados oficiales publicados' : m.status?.estado === 'bloqueado' ? 'ONPE: el portal está rechazando nuestras consultas' : 'ONPE: el portal aún no publica resultados',
    e && `${e.menu || e.nombre}: ${pct(e.totales?.actasContabilizadas, 1)} de actas contadas (corte ${timeLima(e.totales?.fechaActualizacion)})`,
    r ? `Acta por acta: ${n(r.actasLeidas)} actas revisadas · ${n(r.avisos?.alerta)} alertas` : 'Acta por acta: empieza con las primeras actas',
    m.evStats && `Evidencias ciudadanas: ${n(m.evStats.recibidos)} recibidas`,
    `${m.working} de ${m.agents.length} agentes trabajando`,
    'Proyecto independiente, sin financiamiento de partidos ni empresas',
    'peruvian.dev/dataonpe',
  ].filter(Boolean);
  const row = parts.map((p, i) => <span key={i} className="flex items-center gap-7">{p}<i className={`inline-block rotate-45 ${card ? 'bg-navy/40' : 'bg-white/50'} ${big ? 'w-2 h-2' : 'w-1.5 h-1.5'}`} /></span>);
  return (
    <div className={`flex items-center overflow-hidden ${card ? 'bg-white text-navy border border-line rounded-[14px]' : 'bg-navy text-white'} ${big ? 'h-16 text-[24px]' : 'h-9 text-[14px]'} font-semibold`}>
      <span className={`flex-none h-full flex items-center bg-live text-white num tracking-[0.14em] font-bold ${big ? 'px-[22px] text-[20px]' : 'px-3.5 text-[11.5px]'}`}>ÚLTIMO</span>
      <div className="flex-1 overflow-hidden"><div className="crawl-track pl-5">{row}{row}</div></div>
    </div>
  );
}

function Player({ m, now, sel, onSelect, autoRotate, onInteract, compact }) {
  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-[#dfe5ee] shadow-[0_24px_50px_-28px_rgba(11,31,75,.45)]" onPointerDown={onInteract}>
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-dim text-[13px]">Encendiendo la sala…</div>}>
        <Office agents={m.agents} feed={m.feed} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps}
          selected={sel} onSelect={onSelect} autoRotate={autoRotate} compact={compact} />
      </Suspense>
      <div className={`absolute flex gap-2 pointer-events-none ${compact ? 'left-2.5 top-2.5' : 'left-4 top-4'}`}>
        <span className="live-badge !h-7 !px-2.5 !text-[12px]"><i />EN VIVO</span>
        <span className="h-7 px-2.5 flex items-center rounded-md bg-navy/85 text-white num text-[12px] font-semibold">AL AIRE {hms(now - TEAM_START_MS)}</span>
      </div>
      {!compact && (
        <div className="absolute right-4 top-4 flex flex-col items-end gap-0.5 px-3 py-2 rounded-lg bg-white/90 pointer-events-none">
          <span className="num font-bold text-[20px] leading-none text-navy">{timeLima(now)}</span>
          <span className="num text-[10px] tracking-[0.14em] text-dim">HORA DE LIMA</span>
        </div>
      )}
      {!compact && <div className="absolute left-4 right-4 bottom-[50px] max-w-[720px] pointer-events-none"><LowerThird m={m} /></div>}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none"><Ticker m={m} /></div>
    </div>
  );
}

function StreamMeta({ m }) {
  const viewers = useViewers();
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="display m-0 text-[24px] xl:text-[28px] leading-[1.1]">Elecciones Regionales y Municipales 2026: auditoría en vivo</h1>
      <div className="flex items-center gap-x-3.5 gap-y-2 flex-wrap text-[13.5px] text-dim">
        <span><b className="num text-ink-2">{viewers ? n(viewers) : '—'}</b> viendo ahora</span>
        <span aria-hidden="true">·</span>
        <span>Al aire desde las 00:38</span>
        <span aria-hidden="true">·</span>
        <span>{m.agents.length} agentes de IA · datos oficiales de la ONPE</span>
        <span className="ml-auto flex gap-2">
          <a href="#evidencia" className="btn-live"><Camera size={15} />Envía evidencia</a>
          <a href="#datos" className="btn-pill"><Database size={15} />Datos abiertos</a>
        </span>
      </div>
    </div>
  );
}

function Kpis({ m, now }) {
  const left = CLOSE_MS - now;
  const t = m.election?.totales;
  const items = [
    m.live ? ['ACTAS CONTADAS', pct(t?.actasContabilizadas, 1)] : [left > 0 ? 'CIERRE EN' : 'ESPERANDO A LA ONPE', left > 0 ? hms(left) : '—'],
    ['ACTAS REVISADAS', n(m.actas?.actasLeidas ?? 0)],
    ['ALERTAS', n(m.actas?.avisos?.alerta ?? 0), m.actas?.avisos?.alerta ? 'text-alert' : ''],
    ['AGENTES ACTIVOS', `${m.working}/${m.agents.length}`, 'text-ok'],
  ];
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map(([l, v, c]) => (
        <div key={l} className="px-3.5 py-3 rounded-xl bg-white border border-line flex flex-col gap-1.5">
          <span className="num text-[10.5px] tracking-[0.12em] text-dim font-semibold">{l}</span>
          <span className={`num font-bold text-[24px] leading-none text-navy ${c || ''}`}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────── chat de agentes (a la derecha) ───────── */

function Messages({ items, onPick }) {
  const box = useRef(null);
  const stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items]);
  return (
    <ul ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="scroll-y fade-mask-top flex-1 min-h-0 px-4 py-3 flex flex-col gap-3.5">
      {items.length === 0 && <li className="text-dim text-[13px] py-8 text-center">Sin mensajes todavía.</li>}
      <li className="flex-1" aria-hidden="true" />
      {items.map((x) => (
        <li key={x.ts + x.agente} className="msg grid grid-cols-[32px_minmax(0,1fr)] gap-2.5 items-start">
          <button onClick={() => onPick?.(x.agente)} aria-label={`Ver a ${x.agente}`} className="self-start mt-0.5"><Avatar name={x.agente} /></button>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <button onClick={() => onPick?.(x.agente)} className="font-bold text-[13.5px] hover:underline" style={{ color: ink(x.agente) }}>{x.agente}</button>
              {x.tipo === 'recibe' && <Tag tone="info">encargo de Norma</Tag>}
              <span className="num text-[11px] text-dim">{timeLima(Date.parse(x.ts))}</span>
            </div>
            <div className={`mt-0.5 text-[13.5px] leading-[1.45] ${x.tipo === 'recibe' ? 'text-ink-2 italic' : 'text-ink'}`}>
              <RichText text={clip(x.texto, 420)} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AgentCard({ a, onClose }) {
  const st = STATE[a.estado] || { label: a.estado, tone: 'dim' };
  return (
    <div className="mx-3 mt-3 p-3.5 rounded-xl border border-line bg-bg-2 rise">
      <div className="flex items-center gap-3">
        <Avatar name={a.agente} size={40} />
        <div className="min-w-0">
          <div className="display text-[18px] leading-tight">{a.agente}</div>
          <div className="text-[12.5px] text-dim">{a.puesto} · agente de IA</div>
        </div>
        <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-lg hover:bg-white" aria-label="Cerrar ficha"><X size={16} /></button>
      </div>
      <p className="text-[13px] text-ink-2 mt-2.5 leading-relaxed">{a.rol}</p>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Tag tone={st.tone}>{st.label}</Tag>
        <span className="chip">Turno desde {a.inicio}</span>
        <span className="chip">{a.ultimaActividad ? `Activo ${ago(Date.parse(a.ultimaActividad))}` : 'Sin actividad'}</span>
      </div>
    </div>
  );
}

export function AgentChat({ m, sel, onPick, className = '' }) {
  const items = useMemo(() => (m.feed?.items || []).filter((x) => !sel || x.agente === sel).slice(0, 120).reverse(), [m.feed, sel]);
  const a = sel && m.agents.find((x) => x.agente === sel);
  const inRoom = m.agents.filter((x) => x.estado === 'activo' || x.estado === 'cumpliendo');
  const next = m.agents.filter((x) => x.estado === 'programado').map((x) => x.inicio).sort()[0];
  return (
    <aside aria-label="Chat de agentes" className={`flex flex-col min-h-0 rounded-2xl bg-white border border-line overflow-hidden ${className}`}>
      <div className="h-[52px] flex-none flex items-center justify-between gap-2 px-4 border-b border-line">
        <span className="display text-[16px] !font-bold !tracking-normal flex items-center gap-2"><MessageSquare size={16} />Chat de agentes en vivo</span>
        {sel ? <button onClick={() => onPick(null)} className="text-[12.5px] text-accent-2 font-semibold hover:underline flex items-center gap-1"><ArrowLeft size={14} />Todos</button> : <span className="text-[12px] text-dim">solo IA</span>}
      </div>
      {a ? <AgentCard a={a} onClose={() => onPick(null)} />
        : <div className="flex-none mx-3 mt-3 px-3 py-2.5 rounded-[10px] bg-accent-soft text-[12.5px] leading-snug text-[#2b3a5c]">Aquí escriben los agentes del equipo. Las cifras del tablero vienen directo de la ONPE.</div>}
      <Messages items={items} onPick={onPick} />
      <div className="flex-none flex items-center gap-3 px-4 py-3 border-t border-line min-w-0">
        <div className="flex flex-none" role="group" aria-label="Agentes en la sala">
          {m.agents.map((x, i) => (
            <button key={x.agente} onClick={() => onPick(sel === x.agente ? null : x.agente)} title={`${x.agente} · ${x.puesto}`} aria-label={`Ver a ${x.agente}`} className={i ? '-ml-1.5' : ''}>
              <Avatar name={x.agente} size={24} ring dim={!(x.estado === 'activo' || x.estado === 'cumpliendo')} />
            </button>
          ))}
        </div>
        <span className="text-[12px] text-dim ml-auto text-right leading-tight min-w-0"><b className="text-ink-2">{inRoom.length}</b> trabajando<span className="hidden sm:inline">{next ? ` · entran desde ${next}` : ''}</span></span>
      </div>
    </aside>
  );
}

/* ───────── vista ───────── */

export default function Live() {
  const m = useLiveModel();
  const now = useNow(1000);
  const [sel, setSel] = useState(() => (typeof location !== 'undefined' && new URLSearchParams(location.search).get('agente')) || null);
  const [interacted, setInteracted] = useState(false);
  const [tab, setTab] = useState('chat');
  const wide = useMedia('(min-width: 1024px)');
  const pick = (name) => { setSel(name); setInteracted(true); if (name) setTab('chat'); };

  // ?escena: solo la sala, sin nada alrededor (capturas para diseño y prensa)
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('escena')) {
    return (
      <div className="fixed inset-0">
        <Suspense fallback={null}><Office agents={m.agents} feed={m.feed} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps} selected={sel} onSelect={pick} autoRotate={false} /></Suspense>
      </div>
    );
  }

  if (wide) return (
    <div className="h-[calc(100dvh-56px)] grid grid-cols-[minmax(0,1fr)_400px] gap-5 px-6 py-5 box-border">
      <section className="flex flex-col gap-3.5 min-w-0 min-h-0 overflow-y-auto pr-1">
        <Player m={m} now={now} sel={sel} onSelect={pick} autoRotate={false} onInteract={() => setInteracted(true)} />
        <StreamMeta m={m} />
        <Kpis m={m} now={now} />
      </section>
      <AgentChat m={m} sel={sel} onPick={pick} />
    </div>
  );

  // Celular: reproductor arriba; debajo, pestañas de alto fijo (nada empuja la página).
  return (
    <div className="flex flex-col h-[calc(100dvh-56px-64px)]">
      <div className="flex-none px-3 pt-3"><Player m={m} now={now} sel={sel} onSelect={pick} autoRotate={false} onInteract={() => setInteracted(true)} compact /></div>
      <div className="flex-none px-3 pt-2.5">
        <h1 className="display m-0 text-[19px] leading-[1.15]">ERM 2026: auditoría en vivo</h1>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-3 pt-2.5 pb-3 gap-2.5">
        <div className="seg w-full">
          {[['chat', 'Chat', MessageSquare], ['ahora', 'Resumen', Radio], ['equipo', 'Equipo', Users]].map(([k, l, I]) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} className="flex-1 inline-flex items-center justify-center gap-1.5"><I size={14} />{l}</button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {tab === 'chat' && <AgentChat m={m} sel={sel} onPick={pick} className="h-full" />}
          {tab === 'ahora' && (
            <div className="h-full overflow-y-auto flex flex-col gap-2.5">
              <LowerThird m={m} />
              <Kpis m={m} now={now} />
              <div className="flex gap-2"><a href="#evidencia" className="btn-live flex-1"><Camera size={15} />Envía evidencia</a><a href="#datos" className="btn-pill flex-1"><Database size={15} />Datos</a></div>
            </div>
          )}
          {tab === 'equipo' && (
            <div className="h-full overflow-y-auto grid grid-cols-2 gap-2 content-start">
              {m.agents.map((a) => {
                const st = STATE[a.estado] || {};
                return (
                  <button key={a.agente} onClick={() => pick(a.agente)} className="text-left p-3 rounded-xl bg-white border border-line">
                    <div className="flex items-center gap-2"><Avatar name={a.agente} size={28} /><b className="text-[14px]" style={{ color: ink(a.agente) }}>{a.agente}</b></div>
                    <div className="text-[12px] text-dim mt-1">{a.puesto}</div>
                    <div className="mt-1.5"><Tag tone={st.tone}>{st.label}</Tag></div>
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
