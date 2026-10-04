import { lazy, Suspense } from 'react';
import { ChartColumn, CircleHelp, Eye, Info, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useData, useNow, useRoute, useStale, useViewers } from './lib/data.jsx';
import { n, timeLima } from './lib/format.js';
import { useBocas } from './hud/night.jsx';

const Live = lazy(() => import('./views/Live.jsx'));
const Results = lazy(() => import('./views/Results.jsx'));
const Audit = lazy(() => import('./views/Audit.jsx'));
const About = lazy(() => import('./views/About.jsx'));
const WhatIs = lazy(() => import('./views/WhatIs.jsx'));

const NAV = [
  { id: 'en-vivo', label: 'En vivo', short: 'En vivo', icon: Radio, view: Live, full: true },
  { id: 'resultados', label: 'Resultados', short: 'Resultados', icon: ChartColumn, view: Results },
  { id: 'auditoria', label: 'Auditoría', short: 'Auditoría', icon: ShieldCheck, view: Audit },
  { id: 'que-es', label: '¿Qué es esto?', short: '¿Qué es?', icon: CircleHelp, view: WhatIs },
  { id: 'acerca', label: 'Acerca', short: 'Acerca', icon: Info, view: About },
];

/** Estado de la ONPE y cuántas personas miran. */
function StatusPill() {
  const d = useData();
  const v = useViewers();
  const s = d.status?.estado;
  const [label, short, color] = d.live ? ['Resultados en vivo', 'En vivo', 'var(--color-ok)'] : s === 'bloqueado' ? ['ONPE no responde', 'Sin ONPE', 'var(--color-alert)'] : ['Esperando a la ONPE', 'Esperando', 'var(--color-warn)'];
  return (
    <div className="flex items-center gap-3 flex-none">
      <span className="hidden xl:inline-flex items-center gap-1.5 text-[12.5px] text-dim" title="Personas viendo ahora"><Eye size={14} /><span className="num">{v ? n(v) : '—'}</span></span>
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-bg border border-line text-[12.5px] font-semibold whitespace-nowrap" style={{ color }}>
        <i className="dot dot-pulse" style={{ background: color, color }} /><span className="text-ink-2 hidden xl:inline">{label}</span><span className="text-ink-2 xl:hidden">{short}</span>
      </span>
    </div>
  );
}

/** Marca: cuadro azul marino con un aro y un punto rojo (el mismo dibujo del ícono de la pestaña). */
function Mark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="flex-none">
      <rect width="40" height="40" rx="11" fill="#0b1f4b" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2.6" />
      <circle cx="20" cy="20" r="4.6" fill="#e11d48" />
    </svg>
  );
}

function Brand({ size = 'lg' }) {
  const big = size === 'lg';
  return (
    <a href="#en-vivo" className="flex items-center gap-3 min-w-0 text-navy" aria-label="peruvianDream · Auditora Independiente Automatizada de Procesos Electorales">
      <Mark size={big ? 40 : 32} />
      <span className="flex flex-col min-w-0 leading-none">
        <span className={`display !font-extrabold tracking-tight ${big ? 'text-[24px]' : 'text-[19px]'}`} style={{ fontStretch: '85%' }}>peruvianDream</span>
        <span className={`eyebrow !text-live ${big ? 'mt-1.5 !text-[10.5px] !tracking-[0.14em] whitespace-nowrap' : 'mt-1 !text-[7.5px] !tracking-[0.05em] !leading-[1.3] max-w-[230px]'}`}>Auditora Independiente Automatizada de Procesos Electorales</span>
      </span>
    </a>
  );
}

/** A la izquierda de la marca: de qué elección se trata y la hora de Lima. */
function Occasion() {
  const now = useNow(15000);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="live-badge !h-7 !px-2.5 !text-[11.5px] flex-none"><i />EN VIVO</span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="text-[13px] font-semibold text-ink truncate">Elecciones Regionales y Municipales 2026</span>
        <span className="text-[12px] text-dim">Domingo 4 de octubre · <span className="num">{timeLima(now)}</span> en Lima</span>
      </span>
    </div>
  );
}

/** Aviso fijo en todas las pantallas: quien llega tiene que saber de entrada que esto no es la ONPE ni el JNE. */
/* Marquesina de noticiero: las bocas de urna corren arriba, en la misma franja del aviso (no mueve nada),
   hasta que la ONPE tenga actas contadas. */
const ORDEN_BU = { provincial: 1, gobernador: 2, distrital: 3 };
const pctEs = (v) => `${Number(v).toFixed(1).replace('.', ',')} %`;
function useMarquee() {
  const d = useData();
  const bocas = useBocas();
  const conActas = (d.latest?.elecciones || []).some((e) => (e.totales?.actasContabilizadas || 0) > 0);
  if (!bocas?.length || conActas) return null;
  const lista = [...bocas].sort((a, b) => {
    const la = a.ubigeo === '140100' ? 0 : ORDEN_BU[a.tipo] ?? 4, lb = b.ubigeo === '140100' ? 0 : ORDEN_BU[b.tipo] ?? 4;
    return la - lb || String(a.lugar).localeCompare(String(b.lugar));
  });
  const row = (k) => (
    <span key={k} className="inline-flex items-center gap-7 pr-7">
      {lista.map((b) => (
        <span key={b.id} className="inline-flex items-center gap-2">
          <b className="font-bold text-white">{b.lugar}</b>
          <span className="text-white/60 text-[11px]">{b.encuestadora}</span>
          {b.filas.slice(0, 3).map((f, i) => (
            <span key={i} className={i === 0 ? 'text-white' : 'text-white/80'}>{f.candidato || f.partido} <b className="num">{pctEs(f.pct)}</b>{i < Math.min(2, b.filas.length - 1) ? <span className="text-white/40"> ·</span> : null}</span>
          ))}
          <span className="text-live text-[10px]" aria-hidden="true">◆</span>
        </span>
      ))}
      <span className="text-white/70">Estimaciones de encuestadoras difundidas por los medios, no resultados oficiales · Sitio no oficial: no somos la ONPE ni el JNE</span>
      <span className="text-live text-[10px]" aria-hidden="true">◆</span>
    </span>
  );
  return (
    <a href="#resultados" className="h-7 border-b border-[#0b1f4b] bg-navy text-[12.5px] leading-none flex items-stretch whitespace-nowrap overflow-hidden" aria-label="Bocas de urna: ver todas en Resultados">
      <span className="flex-none flex items-center gap-1.5 bg-live text-white font-bold uppercase tracking-[.08em] text-[11px] px-3"><i className="w-1.5 h-1.5 rounded-full bg-white animate-[blink_1.2s_steps(2)_infinite]" />Boca de urna</span>
      <span className="flex-1 overflow-hidden flex items-center"><span className="crawl-track pl-4" style={{ animationDuration: `${Math.max(45, lista.length * 9)}s` }}>{row('a')}{row('b')}</span></span>
      <span className="flex-none hidden md:flex items-center px-3 text-[11px] font-semibold text-white bg-[#13295e]">Ver todas ({lista.length}) →</span>
    </a>
  );
}

function Unofficial() {
  // Si los datos se atrasan, la franja lo dice en lugar del aviso habitual: nunca mostramos cifras viejas como si fueran actuales.
  const stale = useStale();
  const marquee = useMarquee();
  if (stale) return (
    <div className="h-7 border-b border-[#f3d9a8] bg-[#fdf3e2] text-[12px] leading-none text-[#7c4a03] flex items-center justify-center gap-1.5 px-4 whitespace-nowrap overflow-hidden" role="alert">
      <TriangleAlert size={13} className="flex-none" />
      <span className="md:hidden"><b className="font-semibold">Datos con {stale} min de retraso.</b> Consulta también la ONPE.</span>
      <span className="hidden md:inline"><b className="font-semibold">Los datos de este tablero tienen {stale} minutos de retraso.</b> Ya lo estamos revisando; mientras tanto, consulta resultadoelectoral.onpe.gob.pe.</span>
    </div>
  );
  if (marquee) return marquee;
  return (
    <div className="h-7 border-b border-line bg-bg-2 text-[12px] leading-none text-ink-2 flex items-center justify-center gap-1.5 px-4 whitespace-nowrap overflow-hidden" role="note">
      <Info size={13} className="flex-none text-dim" />
      <span className="md:hidden"><b className="font-semibold text-ink">Sitio no oficial:</b> no somos la ONPE ni el JNE.</span>
      <span className="hidden md:inline"><b className="font-semibold text-ink">Sitio no oficial.</b> Iniciativa ciudadana independiente: no somos la ONPE ni el JNE.<span className="hidden lg:inline"> Los resultados oficiales son los que publica la ONPE.</span></span>
    </div>
  );
}

export default function App() {
  // ?escena: solo la sala 3D, sin barra ni paneles (capturas para diseño y prensa)
  if (new URLSearchParams(location.search).has('escena')) return <Suspense fallback={null}><Live /></Suspense>;
  const route = useRoute(NAV.map((x) => x.id), 'en-vivo');
  const cur = NAV.find((x) => x.id === route);
  const live = useData().live;
  const View = cur.view;
  return (
    <div className="app-shell">
      {/* cabecera: franja de color, marca al centro, secciones centradas debajo y el aviso de sitio no oficial */}
      <div className="sticky top-0 z-40">
        <header className="bg-white border-b border-line">
          <div className="h-[3px] bg-[linear-gradient(90deg,#0b1f4b_0%,#1d4ed8_55%,#e11d48_100%)]" aria-hidden="true" />
          {/* celular: marca centrada y el estado a la derecha */}
          <div className="lg:hidden h-[53px] px-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span />
            <Brand size="sm" />
            <span className="justify-self-end"><StatusPill /></span>
          </div>
          {/* escritorio: tres columnas con la marca al centro */}
          <div className="hidden lg:grid h-[61px] px-6 grid-cols-[1fr_auto_1fr] items-center gap-6">
            <Occasion />
            <Brand />
            <span className="justify-self-end"><StatusPill /></span>
          </div>
          <nav className="hidden lg:flex h-[46px] items-center justify-center gap-1 border-t border-line/70" aria-label="Secciones">
            {NAV.map(({ id, label, icon: I }) => (
              <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined}
                className={`relative inline-flex items-center gap-2 h-[34px] px-4 rounded-full text-[13.5px] whitespace-nowrap transition-colors ${route === id ? 'bg-navy text-white font-semibold shadow-[0_6px_14px_-8px_rgba(11,31,75,.7)]' : id === 'resultados' && live ? 'bg-live text-white font-semibold hover:brightness-110 shadow-[0_6px_14px_-8px_rgba(225,29,72,.8)]' : id === 'que-es' ? 'text-accent-2 font-semibold hover:bg-accent-soft' : 'text-ink-2 font-medium hover:bg-bg'}`}>
                <I size={15} className={route === id || (id === 'resultados' && live) ? 'text-white' : id === 'en-vivo' ? 'text-live' : ''} />{label}
                {id === 'resultados' && live && route !== id && <span className="w-2 h-2 rounded-full bg-white animate-[pulse_1.6s_ease-out_infinite] text-white" aria-hidden="true" />}
              </a>
            ))}
          </nav>
        </header>
        <Unofficial />
      </div>

      <main className={cur.full ? 'flex-1' : 'flex-1 w-full max-w-[1240px] mx-auto px-4 lg:px-6 pt-6 lg:pt-10 pb-28 lg:pb-16'}>
        <Suspense fallback={<div className="p-10"><div className="skeleton h-8 w-64" /><div className="skeleton h-40 mt-6" /></div>}>
          <View key={route} />
        </Suspense>
      </main>

      {/* barra inferior en celular: las cinco secciones */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-line bg-white/92 backdrop-blur-xl grid grid-cols-5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Secciones">
        {NAV.map(({ id, short, icon: I }) => (
          <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${route === id ? 'text-ink' : 'text-dim'}`}>
            <span className="relative"><I size={19} className={route === id || (id === 'resultados' && live) ? 'text-live' : ''} />{id === 'resultados' && live && route !== id && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-live text-live animate-[pulse_1.6s_ease-out_infinite]" aria-hidden="true" />}</span>{short}
          </a>
        ))}
      </nav>
    </div>
  );
}
