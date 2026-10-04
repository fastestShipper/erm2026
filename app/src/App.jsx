import { lazy, Suspense, useState } from 'react';
import { ChartColumn, Database, Ellipsis, Eye, Info, Radio, Search, ShieldCheck, TrendingUp, X } from 'lucide-react';
import { useData, useRoute, useViewers } from './lib/data.jsx';
import { n } from './lib/format.js';

const Live = lazy(() => import('./views/Live.jsx'));
const Results = lazy(() => import('./views/Results.jsx'));
const Audit = lazy(() => import('./views/Audit.jsx'));
const SearchView = lazy(() => import('./views/Search.jsx'));
const Markets = lazy(() => import('./views/More.jsx').then((m) => ({ default: m.Markets })));
const DataView = lazy(() => import('./views/More.jsx').then((m) => ({ default: m.DataView })));
const About = lazy(() => import('./views/More.jsx').then((m) => ({ default: m.About })));

const NAV = [
  { id: 'en-vivo', label: 'En vivo', icon: Radio, view: Live, full: true },
  { id: 'resultados', label: 'Resultados', icon: ChartColumn, view: Results },
  { id: 'auditoria', label: 'Auditoría', icon: ShieldCheck, view: Audit },
  { id: 'buscar', label: 'Buscar', icon: Search, view: SearchView },
  { id: 'mercados', label: 'Mercados', icon: TrendingUp, view: Markets },
  { id: 'datos', label: 'Datos', icon: Database, view: DataView },
  { id: 'proyecto', label: 'Proyecto', icon: Info, view: About },
];
const MOBILE_MAIN = ['en-vivo', 'resultados', 'auditoria', 'buscar'];

function StatusPill() {
  const d = useData();
  const v = useViewers();
  const s = d.status?.estado;
  const [label, short, color] = d.live ? ['Resultados en vivo', 'En vivo', 'var(--color-ok)'] : s === 'bloqueado' ? ['ONPE no responde', 'Sin ONPE', 'var(--color-alert)'] : ['Esperando a la ONPE', 'Esperando', 'var(--color-warn)'];
  return (
    <div className="flex items-center gap-2 flex-none">
      <span className="hidden 2xl:inline-flex items-center gap-1.5 text-[12.5px] text-dim"><Eye size={14} /><span className="num">{v ? n(v) : '—'}</span></span>
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-bg border border-line text-[12.5px] font-semibold whitespace-nowrap" style={{ color }}>
        <i className="dot dot-pulse" style={{ background: color, color }} /><span className="text-ink-2 hidden 2xl:inline">{label}</span><span className="text-ink-2 2xl:hidden">{short}</span>
      </span>
    </div>
  );
}

function Brand({ compact }) {
  return (
    <a href="#en-vivo" className="flex items-center gap-2.5 min-w-0 text-navy">
      <span className="w-[30px] h-[30px] rounded-lg grid place-items-center bg-navy flex-none"><span className="w-[9px] h-[9px] rounded-full bg-live" /></span>
      <span className="display text-[17px] !font-extrabold flex-none" style={{ fontStretch: '85%' }}>peruvianDream</span>
      {!compact && <span className="text-[13px] text-dim font-medium truncate">Auditora Independiente de Procesos Electorales</span>}
    </a>
  );
}

export default function App() {
  // ?escena: solo la sala 3D, sin barra ni paneles (capturas para diseño y prensa)
  if (new URLSearchParams(location.search).has('escena')) return <Suspense fallback={null}><Live /></Suspense>;
  const route = useRoute(NAV.map((x) => x.id), 'en-vivo');
  const [more, setMore] = useState(false);
  const cur = NAV.find((x) => x.id === route);
  const View = cur.view;
  return (
    <div className="app-shell">
      {/* barra superior */}
      <header className="sticky top-0 z-40 h-14 border-b border-line bg-white">
        <div className="h-full px-4 lg:px-6 flex items-center gap-5">
          <div className="lg:hidden flex-1 min-w-0"><Brand compact /></div>
          <div className="hidden lg:block xl:hidden flex-none"><Brand compact /></div>
          <div className="hidden xl:block flex-none min-w-0 max-w-[460px]"><Brand /></div>
          <nav className="hidden lg:flex items-center gap-0.5 ml-auto" aria-label="Secciones">
            {NAV.map(({ id, label, icon: I }) => (
              <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined} title={label}
                className={`inline-flex items-center gap-1.5 h-[34px] px-3 rounded-full text-[13.5px] whitespace-nowrap transition-colors ${route === id ? 'bg-navy text-white font-semibold' : 'text-ink-2 font-medium hover:bg-bg'}`}>
                <I size={15} className="xl:hidden" /><span className="hidden xl:inline">{label}</span>
              </a>
            ))}
          </nav>
          <StatusPill />
        </div>
      </header>

      <main className={cur.full ? 'flex-1' : 'flex-1 w-full max-w-[1240px] mx-auto px-4 lg:px-6 pt-6 lg:pt-10 pb-28 lg:pb-16'}>
        <Suspense fallback={<div className="p-10"><div className="skeleton h-8 w-64" /><div className="skeleton h-40 mt-6" /></div>}>
          <View key={route} />
        </Suspense>
      </main>

      {/* barra inferior en celular */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-line bg-white/92 backdrop-blur-xl grid grid-cols-5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Secciones">
        {MOBILE_MAIN.map((id) => {
          const { label, icon: I } = NAV.find((x) => x.id === id);
          return (
            <a key={id} href={`#${id}`} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${route === id ? 'text-ink' : 'text-dim'}`}>
              <I size={19} className={route === id ? 'text-live' : ''} />{label}
            </a>
          );
        })}
        <button onClick={() => setMore(true)} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${MOBILE_MAIN.includes(route) ? 'text-dim' : 'text-ink'}`}>
          <Ellipsis size={19} className={MOBILE_MAIN.includes(route) ? '' : 'text-live'} />Más
        </button>
      </nav>
      {more && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm" onClick={() => setMore(false)}>
          <div className="absolute bottom-0 inset-x-0 rounded-t-2xl border-t border-line bg-white p-4 shadow-2xl pb-8 rise" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><span className="eyebrow">Más secciones</span><button className="btn-ghost h-8 px-2" onClick={() => setMore(false)} aria-label="Cerrar"><X size={16} /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {NAV.filter((x) => !MOBILE_MAIN.includes(x.id)).map(({ id, label, icon: I }) => (
                <a key={id} href={`#${id}`} onClick={() => setMore(false)} className={`flex items-center gap-3 h-14 px-4 rounded-xl border ${route === id ? 'border-accent text-ink' : 'border-line text-ink-2'} bg-bg-2`}>
                  <I size={18} className="text-accent" /><span className="font-medium">{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
