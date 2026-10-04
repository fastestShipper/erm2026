import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Box, ChartColumn, Database, Heart, MapPin, MessageSquare, Radio, ScrollText, Star, ThumbsUp, Users, X } from 'lucide-react';
import { msgId, useAudience, useData, useMedia, useNow, useViewers } from '../lib/data.jsx';
import { colorOf, seatAgents, STATE } from '../lib/agents.js';
import { CLOSE_MS, TEAM_START_MS, ago, hms, n, norm, pct, plain, timeLima } from '../lib/format.js';
import { setZone, usePlaces, useZone, useZoneRaces } from '../lib/zona.js';
import { RichText, Tag } from '../hud/common.jsx';
import { RaceMini } from '../hud/race.jsx';

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
  // sin la coordinación interna: es lo que se ve en la sala, el rótulo y el cintillo
  const feedPub = useMemo(() => d.feed && { ...d.feed, items: (d.feed.items || []).filter((x) => !x.interno) }, [d.feed]);
  const boletin = d.live ? d.boletines?.items?.[0] || null : null;
  const corte = d.live ? Math.max(0, ...d.latest.elecciones.map((e) => e.totales?.fechaActualizacion || 0)) : 0;
  // observaciones: diferencias en los totales del último corte + actas con observaciones
  const obs = (d.live ? d.checks?.total || 0 : 0) + (actas?.avisos?.alerta || 0) + (actas?.avisos?.revisar || 0);
  // reacciones del público sumadas por agente (para su ficha y para la sala 3D)
  const { reactions } = useAudience();
  const likesBy = useMemo(() => {
    const o = {};
    for (const x of d.feed?.items || []) { const c = reactions[msgId(x)]; if (c) o[x.agente] = (o[x.agente] || 0) + c[0] + c[1] + c[2]; }
    return o;
  }, [d.feed, reactions]);
  return { ...d, actas, agents, election, anomalyDeps, working, likesBy, feedPub, boletin, corte, obs };
}

/* ───────── reacciones del público ───────── */
const REACTS = [['like', ThumbsUp, 'Me gusta'], ['love', Heart, 'Me encanta'], ['star', Star, 'Importante']];

function Reactions({ id, readOnly }) {
  const { reactions, mine, react } = useAudience();
  const c = reactions[id] || [0, 0, 0];
  const my = mine[id] || [];
  if (readOnly && !(c[0] || c[1] || c[2])) return null;
  return (
    <div className="flex items-center gap-1 mt-1.5" role="group" aria-label="Reacciones">
      {REACTS.map(([t, I, label], i) => {
        const on = my.includes(t);
        if (readOnly && !c[i]) return null;
        return (
          <button key={t} type="button" disabled={readOnly} data-t={t} aria-pressed={on} title={label}
            aria-label={c[i] ? `${label}: ${n(c[i])}` : label} onClick={() => react(id, t)} className={`react ${on ? 'is-on' : ''}`}>
            <I key={on ? 'on' : 'off'} size={13} fill={on ? 'currentColor' : 'none'} className={on ? 'react-pop' : ''} />
            {c[i] > 0 && <span className="num">{n(c[i])}</span>}
          </button>
        );
      })}
    </div>
  );
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
/** El boletín sin su primera frase («Corte ONPE de las HH:MM.»), que ya va en el rótulo. */
const cuerpo = (b) => b.texto.replace(/^Corte ONPE de las [\d:]+\.\s*/, '');

export function Avatar({ name, size = 32, dim = false, ring = false }) {
  return (
    <span className="rounded-full grid place-items-center font-bold text-white flex-none select-none"
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorOf(name), opacity: dim ? 0.4 : 1, boxShadow: ring ? '0 0 0 2px #fff' : undefined }}>
      {name === 'Don Pepe' ? 'P' : name[0]}
    </span>
  );
}

/* ───────── piezas del reproductor ───────── */

/** Rótulo inferior: alterna lo último que dijo cada agente con el boletín del corte (si ya hay resultados). */
export function LowerThird({ m, big }) {
  const slots = useMemo(() => {
    const pubs = (m.feedPub?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 6)
      .map((x) => ({ key: x.ts, name: x.agente, sub: etiquetaDe(x) ? `${etiquetaDe(x)[0]} · agente de IA` : `${m.agents.find((y) => y.agente === x.agente)?.puesto || 'Agente'} · IA`, color: colorOf(x.agente), text: plain(x.texto, 220) }));
    if (!m.boletin) return pubs;
    const bol = { key: `b${m.boletin.corte}`, name: `Corte ${m.boletin.hora}`, sub: 'Boletín · datos de la ONPE', color: '#0b1f4b', text: cuerpo(m.boletin) };
    return pubs.length ? pubs.flatMap((x, i) => (i % 2 === 0 ? [bol, x] : [x])) : [bol];
  }, [m.feedPub, m.boletin, m.agents]);
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((v) => v + 1), 8000); return () => clearInterval(t); }, []);
  const x = slots.length ? slots[i % slots.length] : null;
  if (!x) return null;
  return (
    <div key={x.key} className={`flex overflow-hidden rise ${big ? 'rounded-[14px] shadow-[0_14px_30px_-14px_rgba(11,31,75,.55)]' : 'rounded-lg shadow-[0_12px_30px_-14px_rgba(11,31,75,.5)]'}`}>
      <div className={`flex-none flex flex-col justify-center text-white ${big ? 'px-[22px] py-4' : 'px-4 py-2.5'}`} style={{ background: x.color }}>
        <b className={`display !text-white leading-tight ${big ? 'text-[32px]' : 'text-[17px]'}`}>{x.name}</b>
        <span className={`opacity-90 ${big ? 'text-[19px]' : 'text-[12px]'}`}>{x.sub}</span>
      </div>
      <p className={`m-0 flex-1 min-w-0 flex items-center bg-white text-ink ${big ? 'px-[22px] py-4 text-[26px] leading-[1.3]' : 'px-4 py-2.5 text-[14.5px] leading-[1.35]'}`}>
        <span className={big ? 'line-clamp-3' : 'line-clamp-2'}>{x.text}</span>
      </p>
    </div>
  );
}

export function Ticker({ m, big, card }) {
  const r = m.actas;
  const parts = [
    m.status?.estado === 'en-vivo' ? `ONPE: resultados oficiales, corte de las ${timeLima(m.corte)}` : m.status?.estado === 'bloqueado' ? 'ONPE: el portal está rechazando nuestras consultas' : 'ONPE: el portal aún no publica resultados',
    ...(m.live ? m.latest.elecciones.slice(0, 4).map((e) => `${e.menu || e.nombre}: ${pct(e.totales?.actasContabilizadas, 1)} de actas contadas`) : []),
    r ? `Acta por acta: ${n(r.actasLeidas)} actas revisadas · ${n((r.avisos?.alerta || 0) + (r.avisos?.revisar || 0))} con observaciones` : 'Acta por acta: empieza con las primeras actas',
    `${m.working} de ${m.agents.length} agentes trabajando`,
    'Proyecto independiente, sin financiamiento de partidos ni empresas',
    'Sitio no oficial: no somos la ONPE ni el JNE',
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

/** La sala vista desde arriba, sin 3D: liviana para celulares. La escena 3D se carga al tocar el botón. */
function OfficeLite({ m, onStart, onPick }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-[#edf2f9] to-[#dde4ee]">
      {/* los escritorios en arco, como en la sala: cada círculo es un agente; al tocarlo se abre su ficha */}
      {m.agents.map((a, i) => {
        const u = m.agents.length > 1 ? i / (m.agents.length - 1) : 0.5;
        const on = a.estado === 'activo' || a.estado === 'cumpliendo';
        return (
          <button key={a.agente} type="button" onClick={() => onPick?.(a.agente)} aria-label={`Ver a ${a.agente}`} title={`${a.agente} · ${a.puesto}`} className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${8 + 84 * u}%`, top: `${60 - 24 * Math.sin(Math.PI * u)}%` }}>
            <span className="relative block"><Avatar name={a.agente} size={26} dim={!on} ring />{a.estado === 'activo' && <i className="dot dot-pulse absolute -right-0.5 -top-0.5" style={{ background: 'var(--color-ok)', color: 'var(--color-ok)' }} />}</span>
          </button>
        );
      })}
      <button type="button" onClick={onStart} className="absolute left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2 btn-pill !h-8 !text-[12.5px] shadow-[0_8px_20px_-10px_rgba(11,31,75,.5)]"><Box size={14} />Ver la oficina en 3D</button>
    </div>
  );
}

function Player({ m, now, sel, onSelect, autoRotate, onInteract, compact }) {
  // En celular la escena 3D (≈1,5 MB) no se descarga hasta que la persona la pide.
  const [on3d, setOn3d] = useState(!compact);
  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-[#dfe5ee] shadow-[0_24px_50px_-28px_rgba(11,31,75,.45)]" onPointerDown={onInteract}>
      {on3d ? (
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-dim text-[13px]">Encendiendo la sala…</div>}>
          <Office agents={m.agents} feed={m.feedPub} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps}
            selected={sel} onSelect={onSelect} autoRotate={autoRotate} compact={compact} likesBy={m.likesBy} />
        </Suspense>
      ) : <OfficeLite m={m} onStart={() => setOn3d(true)} onPick={onSelect} />}
      <div className={`absolute flex gap-2 pointer-events-none ${compact ? 'left-2.5 top-2.5' : 'left-4 top-4'}`}>
        <span className="live-badge !h-7 !px-2.5 !text-[12px]"><i />EN VIVO</span>
        {on3d && <span className="h-7 px-2.5 flex items-center rounded-md bg-navy/85 text-white num text-[12px] font-semibold">AL AIRE {hms(now - TEAM_START_MS)}</span>}
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
      <div className="eyebrow">Transmisión en vivo · ERM 2026</div>
      <h1 className="display m-0 text-[24px] xl:text-[28px] leading-[1.1]">Elecciones Regionales y Municipales 2026: auditoría en vivo</h1>
      <div className="flex items-center gap-x-3.5 gap-y-2 flex-wrap text-[13.5px] text-dim">
        <span><b className="num text-ink-2">{viewers ? n(viewers) : '—'}</b> viendo ahora</span>
        <span aria-hidden="true">·</span>
        <span>Al aire desde las 00:38</span>
        <span aria-hidden="true">·</span>
        <span>{m.agents.length} agentes de IA · datos oficiales de la ONPE</span>
        <span className="ml-auto flex gap-2">
          {!m.live && <a href="#resultados" className="btn-pill !bg-navy !border-navy !text-white hover:!bg-[#13295e]"><ChartColumn size={15} />Ver resultados</a>}
          <a href="#acerca/datos" className="btn-pill"><Database size={15} />Datos abiertos</a>
        </span>
      </div>
    </div>
  );
}

/** Las cuatro cifras de arriba. Con resultados: actas contadas, participación, actas revisadas y observaciones. */
function Kpis({ m, now, flat = false }) {
  const left = CLOSE_MS - now;
  const t = m.election?.totales;
  const items = m.live ? [
    ['ACTAS CONTADAS', pct(t?.actasContabilizadas, 1), '', String(m.election.menu || m.election.nombre).toLowerCase()],
    ['PARTICIPACIÓN', pct(t?.participacionCiudadana, 1), '', 'de los electores'],
    ['ACTAS REVISADAS', n(m.actas?.actasLeidas ?? 0), '', 'una por una'],
    ['OBSERVACIONES', n(m.obs), m.obs ? 'text-warn' : '', m.obs ? 'diferencias por mirar' : 'todo cuadra hasta ahora'],
  ] : [
    [left > 0 ? 'CIERRE DE LA VOTACIÓN EN' : 'ESPERANDO A LA ONPE', left > 0 ? hms(left) : '—'],
    ['ACTAS REVISADAS', n(m.actas?.actasLeidas ?? 0)],
    ['OBSERVACIONES', n(m.obs)],
    ['AGENTES ACTIVOS', `${m.working}/${m.agents.length}`, 'text-ok'],
  ];
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map(([l, v, c, sub]) => (
        <div key={l} className={`px-3.5 py-3 rounded-xl flex flex-col gap-1.5 min-w-0 border border-line ${flat ? 'bg-bg-2' : 'bg-white'}`}>
          <span className="num text-[10.5px] tracking-[0.1em] text-dim font-semibold truncate">{l}</span>
          <span className={`num font-bold text-[24px] leading-none text-navy ${c || ''}`}>{v}</span>
          {sub && <span className="text-[11.5px] text-dim leading-none truncate">{sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Con resultados: el corte de la ONPE primero. Cifras, tu zona y el camino a todos los resultados. */
function CutCard({ m, now }) {
  const places = usePlaces();
  const zone = useZone();
  const races = useZoneRaces(zone, places);
  return (
    <section className="rounded-2xl bg-white border border-line p-4 xl:p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="live-badge !h-7 !px-2.5 !text-[12px]"><i />CORTE ONPE {timeLima(m.corte)}</span>
          <span className="text-[12.5px] text-dim">resultados oficiales parciales · consultado {ago(Date.parse(m.status?.consultado), now)}</span>
        </div>
        <a href="#resultados" className="btn-pill !bg-navy !border-navy !text-white hover:!bg-[#13295e]"><ChartColumn size={15} />Ver resultados</a>
      </div>
      <Kpis m={m} now={now} flat />
      {zone && races.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="eyebrow flex items-center gap-1.5"><MapPin size={12} />Tu zona</span>
            <button type="button" className="text-[12.5px] text-dim hover:underline" onClick={() => setZone(null)}>Cambiar</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">{races.map((r) => <RaceMini key={r.tipo} race={r} />)}</div>
        </div>
      )}
    </section>
  );
}

/* ───────── chat de agentes (a la derecha) ───────── */

/** Rótulo de cada mensaje público: qué es (lo pone el agente al empezar el mensaje). */
export const ETIQUETA = {
  dato: ['Dato ONPE', 'info'], confirmado: ['Confirmado', 'ok'], falso: ['Falso', 'alert'], enganoso: ['Engañoso', 'warn'],
  'sin-prueba': ['Sin prueba', 'dim'], revisar: ['En revisión', 'warn'], bitacora: ['Bitácora', 'dim'], info: ['Información', 'info'],
  bocaurna: ['Boca de urna', 'warn'], reporte: ['Reporte', 'info'],
  verificacion: ['Verificación', 'ok'],   // feeds anteriores
};
const etiquetaDe = (x) => ETIQUETA[x.etiqueta || x.clase];

function Message({ x, onPick, readOnly }) {
  const et = etiquetaDe(x);
  return (
    <li className="msg grid grid-cols-[32px_minmax(0,1fr)] gap-2.5 items-start">
      <button onClick={() => onPick?.(x.agente)} aria-label={`Ver a ${x.agente}`} className="self-start mt-0.5"><Avatar name={x.agente} dim={x.interno} /></button>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <button onClick={() => onPick?.(x.agente)} className="font-bold text-[13.5px] hover:underline" style={{ color: ink(x.agente) }}>{x.agente}</button>
          {x.tipo === 'recibe' ? <Tag tone="info">encargo de Norma</Tag> : et ? <Tag tone={et[1]}>{et[0]}</Tag> : x.interno ? <Tag tone="dim">trabajo interno</Tag> : null}
          <span className="num text-[11px] text-dim">{timeLima(Date.parse(x.ts))}</span>
        </div>
        <div className={`mt-0.5 leading-[1.45] ${x.tipo === 'recibe' || x.interno ? 'text-[13px] text-ink-2 italic' : 'text-[13.5px] text-ink'}`}>
          <RichText text={clip(x.texto, 420)} />
        </div>
        {!x.interno && <Reactions id={msgId(x)} readOnly={readOnly} />}
      </div>
    </li>
  );
}

/** Varios mensajes internos seguidos se pliegan en una sola línea: se ve que el equipo trabaja, sin confundir. */
function InternalGroup({ g, open, onToggle, onPick, readOnly }) {
  const names = [...new Set(g.items.map((x) => x.agente))];
  return (
    <>
      <li className="msg">
        <button type="button" disabled={readOnly} onClick={onToggle} aria-expanded={open}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border border-dashed border-line text-left text-[12px] text-dim enabled:hover:bg-bg-2 enabled:hover:text-ink-2">
          <span className="flex flex-none">{names.slice(0, 4).map((nm, i) => <span key={nm} className={i ? '-ml-1.5' : ''}><Avatar name={nm} size={18} ring dim /></span>)}</span>
          <span className="min-w-0 flex-1 truncate">Trabajo interno: {names.join(', ')} · {g.items.length} {g.items.length === 1 ? 'mensaje' : 'mensajes'}</span>
          {!readOnly && <span className="flex-none font-semibold text-accent-2">{open ? 'Ocultar' : 'Ver'}</span>}
        </button>
      </li>
      {open && g.items.map((x) => <Message key={x.ts + x.agente} x={x} onPick={onPick} readOnly={readOnly} />)}
    </>
  );
}

function Messages({ items, onPick, readOnly }) {
  const box = useRef(null);
  const stick = useRef(true);
  const [open, setOpen] = useState(() => new Set());
  // los mensajes internos seguidos forman un grupo plegado
  const rows = useMemo(() => {
    const out = [];
    for (const x of items) {
      const last = out[out.length - 1];
      if (x.interno && last?.group) last.items.push(x);
      else if (x.interno) out.push({ group: true, key: `g${x.ts}`, items: [x] });
      else out.push(x);
    }
    return out;
  }, [items]);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [rows]);
  const toggle = (k) => setOpen((s) => { const n2 = new Set(s); if (n2.has(k)) n2.delete(k); else n2.add(k); return n2; });
  return (
    <ul ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="scroll-y fade-mask-top flex-1 min-h-0 px-4 py-3 flex flex-col gap-3.5">
      {items.length === 0 && <li className="text-dim text-[13px] py-8 text-center">Sin mensajes todavía.</li>}
      <li className="flex-1" aria-hidden="true" />
      {rows.map((r) => (r.group
        ? <InternalGroup key={r.key} g={r} open={open.has(r.key)} onToggle={() => toggle(r.key)} onPick={onPick} readOnly={readOnly} />
        : <Message key={r.ts + r.agente} x={r} onPick={onPick} readOnly={readOnly} />))}
    </ul>
  );
}

function AgentCard({ a, onClose, likes }) {
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
        {likes > 0 && <span className="chip !text-live"><Heart size={12} fill="currentColor" /> <span className="num">{n(likes)}</span> {likes === 1 ? 'reacción' : 'reacciones'}</span>}
      </div>
    </div>
  );
}

/** El boletín del último corte: lo arma el programa con los datos de la ONPE, sin IA. */
export function BulletinPin({ b, className = '', link = true }) {
  return (
    <div className={`px-3.5 py-3 rounded-[10px] bg-navy text-white ${className}`}>
      <div className="flex items-center gap-2 text-[11px] num tracking-[0.1em] font-semibold opacity-90"><ScrollText size={13} />BOLETÍN · CORTE {b.hora} · SIN IA</div>
      <p className="m-0 mt-1.5 text-[13px] leading-snug line-clamp-6">{cuerpo(b)}</p>
      {link && <a href="#resultados/avance" className="inline-block mt-1.5 text-[12.5px] font-semibold underline underline-offset-2 decoration-white/40">Ver todos los cortes</a>}
    </div>
  );
}

/** Arriba del chat: el boletín del último corte o, antes de que haya resultados, una nota de qué es este chat. */
function ChatPin({ m, readOnly }) {
  const veda = m.feed?.veda && Date.now() < Date.parse(m.feed.veda.hasta) ? m.feed.veda : null;
  if (m.boletin) return <BulletinPin b={m.boletin} className="flex-none mx-3 mt-3" link={!readOnly} />;
  const espera = veda?.retenidos > 0 ? ` (${n(veda.retenidos)} en espera)` : '';
  return (
    <div className="flex-none mx-3 mt-3 px-3 py-2.5 rounded-[10px] bg-accent-soft text-[12.5px] leading-snug text-[#2b3a5c]">
      {veda ? (
        <>
          <span className="lg:hidden"><b className="font-semibold">Veda electoral:</b> los mensajes sobre candidatos, partidos o encuestas salen a las 17:00{espera}.</span>
          <span className="hidden lg:inline">Aquí publican los agentes de IA del equipo; cada mensaje dice qué es (Dato ONPE, Confirmado, Falso…) y su trabajo interno aparece plegado. Por la veda, hasta las 17:00 no se publica nada sobre candidatos, partidos, encuestas ni tendencias{espera}.</span>
        </>
      ) : 'Aquí publican los agentes de IA del equipo; cada mensaje dice qué es (Dato ONPE, Confirmado, Falso…) y su trabajo interno aparece plegado. Las cifras del tablero vienen directo de la ONPE.'}
    </div>
  );
}

export function AgentChat({ m, sel, onPick, className = '', readOnly = false }) {
  const all = m.feed?.items;
  const items = useMemo(() => (all || []).filter((x) => !sel || x.agente === sel).slice(0, 150).reverse(), [all, sel]);
  const a = sel && m.agents.find((x) => x.agente === sel);
  const inRoom = m.agents.filter((x) => x.estado === 'activo' || x.estado === 'cumpliendo');
  const next = m.agents.filter((x) => x.estado === 'programado').map((x) => x.inicio).sort()[0];
  return (
    <aside aria-label="Chat de agentes" className={`flex flex-col min-h-0 rounded-2xl bg-white border border-line overflow-hidden ${className}`}>
      <div className="h-[52px] flex-none flex items-center justify-between gap-2 px-4 border-b border-line">
        <span className="display text-[16px] !font-bold !tracking-normal flex items-center gap-2"><MessageSquare size={16} />Chat de agentes en vivo</span>
        {sel ? <button onClick={() => onPick(null)} className="text-[12.5px] text-accent-2 font-semibold hover:underline flex items-center gap-1"><ArrowLeft size={14} />Todos</button> : <span className="text-[12px] text-dim">comentarios de IA</span>}
      </div>
      {a ? <AgentCard a={a} onClose={() => onPick(null)} likes={m.likesBy?.[a.agente] || 0} /> : <ChatPin m={m} readOnly={readOnly} />}
      <Messages items={items} onPick={onPick} readOnly={readOnly} />
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
  const [tab, setTab] = useState(null);
  const wide = useMedia('(min-width: 1024px)');
  const pick = (name) => { setSel(name); if (name) setTab('chat'); };
  // En celular: con resultados se abre en el corte; antes, en el chat.
  const curTab = tab || (m.live ? 'ahora' : 'chat');

  // ?escena: solo la sala, sin nada alrededor (capturas para diseño y prensa)
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('escena')) {
    return (
      <div className="fixed inset-0">
        <Suspense fallback={null}><Office agents={m.agents} feed={m.feedPub} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps} selected={sel} onSelect={pick} autoRotate={false} /></Suspense>
      </div>
    );
  }

  if (wide) return (
    <div className="h-[calc(100dvh-var(--hdr))] grid grid-cols-[minmax(0,1fr)_400px] gap-5 px-6 py-5 box-border">
      <section className="flex flex-col gap-3.5 min-w-0 min-h-0 overflow-y-auto pr-1">
        {m.live && <CutCard m={m} now={now} />}
        <Player m={m} now={now} sel={sel} onSelect={pick} autoRotate={false} />
        <StreamMeta m={m} />
        {!m.live && <Kpis m={m} now={now} />}
      </section>
      <AgentChat m={m} sel={sel} onPick={pick} />
    </div>
  );

  // Celular: reproductor arriba; debajo, pestañas de alto fijo (nada empuja la página).
  return (
    <div className="flex flex-col h-[calc(100dvh-var(--hdr)-64px)]">
      <div className="flex-none px-3 pt-3"><Player m={m} now={now} sel={sel} onSelect={pick} autoRotate={false} compact /></div>
      <div className="flex-none px-3 pt-2.5">
        <h1 className="display m-0 text-[19px] leading-[1.15]">ERM 2026: auditoría en vivo</h1>
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-3 pt-2.5 pb-3 gap-2.5">
        <div className="seg w-full">
          {[['ahora', m.live ? 'Corte' : 'Resumen', Radio], ['chat', 'Chat', MessageSquare], ['equipo', 'Equipo', Users]].map(([k, l, I]) => (
            <button key={k} aria-pressed={curTab === k} onClick={() => setTab(k)} className="flex-1 inline-flex items-center justify-center gap-1.5"><I size={14} />{l}</button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          {curTab === 'chat' && <AgentChat m={m} sel={sel} onPick={pick} className="h-full" />}
          {curTab === 'ahora' && (
            <div className="h-full overflow-y-auto flex flex-col gap-2.5">
              {m.live ? <CutCard m={m} now={now} /> : <><LowerThird m={m} /><Kpis m={m} now={now} /></>}
              {m.boletin && <BulletinPin b={m.boletin} className="flex-none" />}
              {!m.live && <div className="flex gap-2"><a href="#resultados" className="btn-pill flex-1 !bg-navy !border-navy !text-white"><ChartColumn size={15} />Ver resultados</a><a href="#acerca/datos" className="btn-pill flex-1"><Database size={15} />Datos</a></div>}
            </div>
          )}
          {curTab === 'equipo' && (
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
