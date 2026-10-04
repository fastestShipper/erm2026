import { lazy, Suspense } from 'react';
import { ChartColumn, Eye, Info, Radio, ShieldCheck } from 'lucide-react';
import { useData, useRoute, useViewers } from './lib/data.jsx';
import { n } from './lib/format.js';

const Live = lazy(() => import('./views/Live.jsx'));
const Results = lazy(() => import('./views/Results.jsx'));
const Audit = lazy(() => import('./views/Audit.jsx'));
const About = lazy(() => import('./views/About.jsx'));

const NAV = [
  { id: 'en-vivo', label: 'En vivo', icon: Radio, view: Live, full: true },
  { id: 'resultados', label: 'Resultados', icon: ChartColumn, view: Results },
  { id: 'auditoria', label: 'Auditoría', icon: ShieldCheck, view: Audit },
  { id: 'acerca', label: 'Acerca', icon: Info, view: About },
];

function StatusPill() {
  const d = useData();
  const v = useViewers();
  const s = d.status?.estado;
  const [label, short, color] = d.live ? ['Resultados en vivo', 'En vivo', 'var(--color-ok)'] : s === 'bloqueado' ? ['ONPE no responde', 'Sin ONPE', 'var(--color-alert)'] : ['Esperando a la ONPE', 'Esperando', 'var(--color-warn)'];
  return (
    <div className="flex items-center gap-2 flex-none">
      <span className="hidden xl:inline-flex items-center gap-1.5 text-[12.5px] text-dim"><Eye size={14} /><span className="num">{v ? n(v) : '—'}</span></span>
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-bg border border-line text-[12.5px] font-semibold whitespace-nowrap" style={{ color }}>
        <i className="dot dot-pulse" style={{ background: color, color }} /><span className="text-ink-2 hidden xl:inline">{label}</span><span className="text-ink-2 xl:hidden">{short}</span>
      </span>
    </div>
  );
}

function Brand({ compact }) {
  return (
    <a href="#en-vivo" className="flex items-center gap-2.5 min-w-0 text-navy">
      <span className="w-[30px] h-[30px] rounded-lg grid place-items-center bg-navy flex-none"><span className="w-[9px] h-[9px] rounded-full bg-live" /></span>
      <span className="display text-[17px] !font-extrabold flex-none" style={{ fontStretch: '85%' }}>peruvianDream</span>
      {!compact && <span className="text-[13px] text-dim font-medium truncate">Auditora Independiente Automatizada de Procesos Electorales</span>}
    </a>
  );
}

/** Aviso fijo en todas las pantallas: quien llega tiene que saber de entrada que esto no es la ONPE ni el JNE. */
function Unofficial() {
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
  const View = cur.view;
  return (
    <div className="app-shell">
      {/* barra superior */}
      <div className="sticky top-0 z-40">
        <header className="h-14 border-b border-line bg-white">
          <div className="h-full px-4 lg:px-6 flex items-center gap-5">
            <div className="lg:hidden flex-1 min-w-0"><Brand compact /></div>
            <div className="hidden lg:block xl:hidden flex-none"><Brand compact /></div>
            <div className="hidden xl:block flex-none min-w-0 max-w-[620px]"><Brand /></div>
            <nav className="hidden lg:flex items-center gap-0.5 ml-auto" aria-label="Secciones">
              {NAV.map(({ id, label }) => (
                <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined}
                  className={`inline-flex items-center h-[34px] px-3.5 rounded-full text-[13.5px] whitespace-nowrap transition-colors ${route === id ? 'bg-navy text-white font-semibold' : 'text-ink-2 font-medium hover:bg-bg'}`}>
                  {label}
                </a>
              ))}
            </nav>
            <StatusPill />
          </div>
        </header>
        <Unofficial />
      </div>

      <main className={cur.full ? 'flex-1' : 'flex-1 w-full max-w-[1240px] mx-auto px-4 lg:px-6 pt-6 lg:pt-10 pb-28 lg:pb-16'}>
        <Suspense fallback={<div className="p-10"><div className="skeleton h-8 w-64" /><div className="skeleton h-40 mt-6" /></div>}>
          <View key={route} />
        </Suspense>
      </main>

      {/* barra inferior en celular: las cuatro secciones */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-line bg-white/92 backdrop-blur-xl grid grid-cols-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Secciones">
        {NAV.map(({ id, label, icon: I }) => (
          <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${route === id ? 'text-ink' : 'text-dim'}`}>
            <I size={19} className={route === id ? 'text-live' : ''} />{label}
          </a>
        ))}
      </nav>
    </div>
  );
}
