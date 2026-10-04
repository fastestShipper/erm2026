// Página para transmitir en vivo (TikTok vertical 1080×1920; con ?h=1, horizontal 1920×1080).
// Se captura con OBS como «Fuente de navegador». Sin interacción: la cámara recorre la sala sola.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { DataProvider, useNow } from './lib/data.jsx';
import { colorOf } from './lib/agents.js';
import { CLOSE_MS, TEAM_START_MS, hms, n, pct, plain, timeLima } from './lib/format.js';
import { useLiveModel, NowCard, Crawl } from './views/Live.jsx';

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

function Kpi({ label, value, tone }) {
  return (
    <div className="glass px-6 py-5 flex-1">
      <div className="eyebrow !text-[15px]">{label}</div>
      <div className={`num font-semibold mt-2 ${H ? 'text-[44px]' : 'text-[52px]'} leading-none ${tone === 'alert' ? 'text-alert' : tone === 'ok' ? 'text-ok' : ''}`}>{value}</div>
    </div>
  );
}

function MiniChat({ m, count }) {
  const items = (m.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, count);
  return (
    <div className="glass px-6 py-4 flex flex-col gap-3 overflow-hidden h-full">
      <div className="eyebrow !text-[15px]">Chat de agentes</div>
      {items.map((x) => (
        <div key={x.ts} className="text-[23px] leading-[1.3] line-clamp-2 max-h-[60px] overflow-hidden rise">
          <b style={{ color: colorOf(x.agente) }}>{x.agente}</b> <span className="text-ink-2">{plain(x.texto, 160)}</span>
        </div>
      ))}
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
  const e = m.election;
  const left = CLOSE_MS - now;
  const kpis = useMemo(() => [
    m.live ? ['Actas contadas', pct(e?.totales?.actasContabilizadas, 1)] : [left > 0 ? 'Cierre en' : 'Esperando a la ONPE', left > 0 ? hms(left) : '—'],
    ['Actas revisadas', n(m.actas?.actasLeidas ?? 0)],
    ['Alertas', n(m.actas?.avisos?.alerta ?? 0), m.actas?.avisos?.alerta ? 'alert' : undefined],
    ['Agentes activos', `${m.working}/${m.agents.length}`, 'ok'],
  ], [m, e, left]);

  const office = (
    <Suspense fallback={null}>
      <Office agents={m.agents} feed={m.feed} latest={m.latest} status={m.status} actas={m.actas} anomalyDeps={m.anomalyDeps} selected={sel} autoRotate={!sel} compact fov={H ? 36 : 44} />
    </Suspense>
  );

  const header = (
    <div className="flex items-center gap-5 px-8 h-[150px] flex-none">
      <span className="relative w-[78px] h-[78px] rounded-2xl grid place-items-center bg-panel-2 border border-line-2 flex-none">
        <span className="w-[38px] h-[38px] rounded-full border-[4px] border-accent" />
        <span className="absolute w-[15px] h-[15px] rounded-full bg-live" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow !text-[17px] !text-accent !tracking-[0.2em]">peruvianDream · ERM 2026</div>
        <div className="font-bold text-[38px] leading-[1.05] tracking-[-0.02em] mt-1">Auditora Independiente de Procesos Electorales</div>
      </div>
      <div className="flex flex-col items-end gap-2 flex-none">
        <span className="live-badge !h-[40px] !px-4 !text-[19px]"><i className="!w-[10px] !h-[10px]" />EN VIVO</span>
        <span className="num text-[26px] text-ink-2">{timeLima(now, { seconds: true })}</span>
      </div>
    </div>
  );

  return (
    <div style={{ width: W0, height: H0, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="relative overflow-hidden bg-bg flex flex-col">
      {H ? (
        <>
          {header}
          <div className="flex-1 min-h-0 flex gap-5 px-8 pb-5">
            <div className="relative flex-[2] rounded-3xl overflow-hidden border border-line">{office}
              <span className="absolute left-5 top-5 chip !h-9 !text-[17px] num !bg-white/85">AL AIRE {hms(now - TEAM_START_MS)}</span>
            </div>
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <div className="grid grid-cols-2 gap-4">{kpis.map(([l, v, t]) => <Kpi key={l} label={l} value={v} tone={t} />)}</div>
              <NowCard m={m} big />
              <div className="flex-1 min-h-0"><MiniChat m={m} count={3} /></div>
            </div>
          </div>
          <Crawl m={m} big />
        </>
      ) : (
        <>
          {header}
          <div className="relative h-[930px] flex-none mx-6 rounded-3xl overflow-hidden border border-line">{office}
            <span className="absolute left-5 top-5 chip !h-10 !text-[19px] num !bg-white/85">AL AIRE {hms(now - TEAM_START_MS)}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 px-6 mt-5">{kpis.map(([l, v, t]) => <Kpi key={l} label={l} value={v} tone={t} />)}</div>
          <div className="px-6 mt-5"><NowCard m={m} big /></div>
          <div className="flex-1 min-h-0 px-6 mt-5 mb-5 flex flex-col"><MiniChat m={m} count={2} /></div>
          <div className="text-center text-[25px] text-ink-2 pb-4">Mira todo y envía evidencia en <b className="text-ink">peruvian.dev/dataonpe</b></div>
          <Crawl m={m} big />
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<DataProvider><Stream /></DataProvider>);
