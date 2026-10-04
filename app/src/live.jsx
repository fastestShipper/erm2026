// Página para transmitir en vivo: TikTok vertical 1080×1920 (con ?h=1, horizontal 1920×1080).
// Se captura con OBS como «Fuente de navegador». Sin interacción: la cámara recorre la sala sola.
// Vertical: arriba (~170 px) y abajo (comentarios del live) quedan libres porque TikTok dibuja ahí su interfaz.
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { DataProvider, useNow } from './lib/data.jsx';
import { CLOSE_MS, TEAM_START_MS, hms, pct, timeLima } from './lib/format.js';
import { useLiveModel, LowerThird, Ticker, AgentChat } from './views/Live.jsx';

const Office = lazy(() => import('./office/Office.jsx'));
const H = new URLSearchParams(location.search).has('h');
const W0 = H ? 1920 : 1080, H0 = H ? 1080 : 1920;

/** Recorrido de cámara: vista general ↔ agente que habló hace poco. */
function useTour(m) {
  const [sel, setSel] = useState(null);
  useEffect(() => {
    let step = 0;
    const t = setInterval(() => {
      step++;
      if (step % 2 === 1) {
        const recent = [...new Set((m.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 8).map((x) => x.agente))];
        const pool = recent.length ? recent : m.agents.filter((a) => a.estado !== 'programado').map((a) => a.agente);
        setSel(pool.length ? pool[Math.floor(step / 2) % pool.length] : null);
      } else setSel(null);
    }, 9000);
    return () => clearInterval(t);
  }, [m.feed, m.agents]);
  return sel;
}

function Scene({ m, sel, now, big }) {
  return (
    <>
      <Suspense fallback={null}>
        <Office agents={m.agents} feed={m.feed} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps} selected={sel} autoRotate={false} compact fov={H ? 36 : 46} likesBy={m.likesBy} />
      </Suspense>
      <div className="absolute left-6 top-6 flex gap-2.5 pointer-events-none">
        <span className={`flex items-center rounded-[10px] bg-navy/85 text-white num font-bold ${big ? 'h-11 px-4 text-[20px]' : 'h-8 px-3 text-[14px]'}`}>AL AIRE {hms(now - TEAM_START_MS)}</span>
      </div>
      <div className={`absolute right-6 top-6 flex flex-col items-end gap-1 rounded-xl bg-white/90 pointer-events-none ${big ? 'px-4 py-2.5' : 'px-3 py-2'}`}>
        <span className={`num font-bold leading-none text-navy ${big ? 'text-[34px]' : 'text-[24px]'}`}>{timeLima(now)}</span>
        <span className={`num tracking-[0.14em] text-dim font-semibold ${big ? 'text-[14px]' : 'text-[11px]'}`}>HORA DE LIMA</span>
      </div>
      <div className="absolute left-6 right-6 bottom-6 pointer-events-none"><LowerThird m={m} big={big} /></div>
    </>
  );
}

function Kpi({ label, value, cls = '', big }) {
  return (
    <div className={`rounded-[18px] bg-white border border-line flex flex-col gap-2.5 ${big ? 'px-6 py-5' : 'px-5 py-4'}`}>
      <span className={`num tracking-[0.12em] text-dim font-semibold ${big ? 'text-[17px]' : 'text-[14px]'}`}>{label}</span>
      <span className={`num font-bold leading-none text-navy ${cls} ${big ? 'text-[54px]' : 'text-[40px]'}`}>{value}</span>
    </div>
  );
}

function Stream() {
  const m = useLiveModel();
  const now = useNow(1000);
  const sel = useTour(m);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const f = () => setScale(Math.min(innerWidth / W0, innerHeight / H0));
    f(); addEventListener('resize', f); return () => removeEventListener('resize', f);
  }, []);
  const left = CLOSE_MS - now;
  const first = m.live ? ['ACTAS CONTADAS', pct(m.election?.totales?.actasContabilizadas, 1)] : [left > 0 ? 'CIERRE DE LA VOTACIÓN EN' : 'ESPERANDO A LA ONPE', left > 0 ? hms(left) : '—'];

  return (
    <div style={{ width: W0, height: H0, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="relative overflow-hidden bg-bg flex flex-col">
      {H ? (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_520px] gap-6 p-8">
          <div className="flex flex-col gap-5 min-w-0">
            <div className="flex items-center gap-4">
              <span className="live-badge !h-10 !px-4 !text-[18px]"><i className="!w-2.5 !h-2.5" />EN VIVO</span>
              <h1 className="display m-0 text-[30px] leading-none">Auditora Independiente Automatizada de Procesos Electorales</h1>
              <span className="ml-auto flex-none h-10 px-4 flex items-center rounded-[10px] border border-line bg-white text-[17px] font-semibold text-ink-2 whitespace-nowrap">Sitio no oficial</span>
            </div>
            <div className="relative flex-1 min-h-0 rounded-3xl overflow-hidden bg-[#dfe5ee] shadow-[0_30px_60px_-30px_rgba(11,31,75,.5)]">
              <Scene m={m} sel={sel} now={now} big />
            </div>
            <Ticker m={m} big card />
          </div>
          <div className="flex flex-col gap-4 min-h-0">
            <div className="grid grid-cols-2 gap-4">
              <Kpi label={first[0]} value={first[1]} />
              <Kpi label="AGENTES TRABAJANDO" value={`${m.working} de ${m.agents.length}`} cls="!text-ok" />
            </div>
            <AgentChat m={m} sel={null} onPick={() => {}} className="flex-1" readOnly />
            <div className="flex items-center justify-between gap-4 px-6 py-4 rounded-[18px] bg-navy text-white">
              <span className="text-[20px]">Todos los datos en</span>
              <span className="num font-bold text-[22px]">peruvian.dev/dataonpe</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="h-[170px] flex-none bg-gradient-to-b from-[#e9eef7] to-bg" />
          <header className="flex-none flex flex-col gap-2.5 px-14 pb-7">
            <span className="flex items-center gap-3 num font-bold text-[22px] tracking-[0.16em] text-live"><span className="w-3.5 h-3.5 rounded-full bg-live dot-pulse" style={{ color: 'var(--color-live)' }} />EN VIVO · ERM 2026</span>
            <h1 className="display m-0 text-[56px] leading-[1.02]">Auditora Independiente Automatizada de Procesos Electorales</h1>
            <p className="m-0 text-[28px] leading-[1.3] text-ink-2">{m.agents.length} agentes de IA vigilan el conteo oficial de la ONPE. <b className="font-semibold text-ink">Sitio no oficial:</b> no somos la ONPE ni el JNE.</p>
          </header>
          <div className="relative h-[780px] flex-none mx-10 rounded-[28px] overflow-hidden bg-[#dfe5ee] shadow-[0_30px_60px_-30px_rgba(11,31,75,.5)]">
            <Scene m={m} sel={sel} now={now} big />
          </div>
          <div className="flex-none grid grid-cols-2 gap-4 mx-10 mt-6">
            <Kpi label={first[0]} value={first[1]} big />
            <Kpi label="AGENTES TRABAJANDO" value={`${m.working} de ${m.agents.length}`} cls="!text-ok" big />
          </div>
          <div className="flex-none mx-10 mt-4 flex items-center justify-between gap-4 px-6 py-5 rounded-[18px] bg-navy text-white">
            <span className="text-[26px] leading-tight">Revisa todos los datos en</span>
            <span className="num font-bold text-[28px]">peruvian.dev/dataonpe</span>
          </div>
          <div className="flex-none mx-10 mt-4"><Ticker m={m} big card /></div>
          <div className="flex-1 bg-gradient-to-b from-bg to-[#e9eef7]" />
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<DataProvider><Stream /></DataProvider>);
