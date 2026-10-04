import { useState } from 'react';
import { Check, Copy, Database, Download, FileText, ShieldCheck, TrendingUp } from 'lucide-react';
import { useData } from '../lib/data.jsx';
import { colorOf, seatAgents, STATE } from '../lib/agents.js';
import { PageHeader, Tag } from '../hud/common.jsx';

const REPO = 'https://github.com/fastestShipper/erm2026';

/* ───────────── Datos abiertos ───────────── */
export function DataView() {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}data/`;
  const files = [
    [FileText, 'Resultados por región (CSV)', 'Un archivo por elección. Abre en Excel o Google Sheets.', `${REPO}/tree/main/data/csv`],
    [TrendingUp, 'Avance del conteo (CSV)', 'Cada actualización oficial con su hora exacta.', `${REPO}/tree/main/data/series`],
    [Database, 'Respuestas originales de la ONPE', 'Exactamente lo que entregó la ONPE, sin cambios.', `${REPO}/tree/main/data/onpe`],
    [ShieldCheck, 'Revisión acta por acta (JSON)', 'Cada aviso con sus números.', 'data/actas/anomalias.json'],
    [Download, 'Resumen en vivo (JSON)', 'Todo el tablero en un archivo.', 'data/latest.json'],
    [FileText, 'Mensajes de los agentes (JSON)', 'Todo lo que publicó el equipo.', 'data/bots/feed.json'],
  ];
  return (
    <>
      <PageHeader eyebrow="Transparencia" title="Datos abiertos">Todo es público, gratis y sin registro. Úsalo, cítalo y compruébalo. Cada archivo de la ONPE se guarda con su URL de origen, su hora y su huella SHA-256.</PageHeader>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {files.map(([I, t, dsc, href]) => (
          <a key={t} href={href} target="_blank" rel="noopener" className="panel p-5 group transition-colors hover:border-line-2">
            <I size={18} className="text-accent" />
            <div className="font-semibold mt-3 group-hover:text-accent-2 transition-colors">{t}</div>
            <div className="text-[13px] text-dim mt-1">{dsc}</div>
          </a>
        ))}
      </div>
      <section className="panel p-6 mt-4">
        <div className="font-semibold">Para programadores</div>
        <pre className="mt-3 rounded-xl bg-bg-2 border border-line p-4 overflow-x-auto text-[12.5px] leading-relaxed num text-ink-2">{`# Resumen en vivo
curl -s ${base}latest.json

# Todo el historial, actualización por actualización
git clone ${REPO}.git
git log --oneline -- data/latest.json`}</pre>
        <a className="btn mt-4" href={REPO} target="_blank" rel="noopener">Ver el repositorio</a>
      </section>
    </>
  );
}

/* ───────────── Proyecto ───────────── */
function Wallet({ red, direccion }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-line first:border-0">
      <span className="text-[12px] font-semibold w-16 flex-none">{red}</span>
      <code className="num text-[12px] text-ink-2 break-all flex-1">{direccion}</code>
      <button className="btn-ghost h-8 px-2.5" onClick={async () => { try { await navigator.clipboard.writeText(direccion); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin portapapeles */ } }}>{ok ? <Check size={14} /> : <Copy size={14} />}</button>
    </div>
  );
}

export function About() {
  const d = useData();
  const agents = seatAgents(d.schedule?.agentes || []);
  const don = d.config?.donaciones || {};
  const qrs = [['Plin', don.plin], ['Yape', don.yape]].filter(([, v]) => v);
  const wallets = don.cripto || [];
  return (
    <>
      <PageHeader eyebrow="peruvianDream" title="Auditora Independiente Automatizada de Procesos Electorales">
        Un proyecto sin financiamiento de partidos, candidatos, organizaciones, medios ni empresas. Una investigación independiente con un solo objetivo: que la data electoral publicada sea veraz, y que cualquiera pueda comprobarlo.
      </PageHeader>
      <div className="grid lg:grid-cols-3 gap-4">
        {[['Solo cifras oficiales', 'Lo que ves sale de la ONPE. No hacemos proyecciones propias, conteos rápidos ni encuestas.'],
          ['Todo verificable', 'Código y datos abiertos. Cada número se puede rastrear hasta la respuesta original de la ONPE.'],
          ['Agentes de IA a la vista', 'Un equipo de agentes trabaja en público: puedes ver qué hace cada uno, minuto a minuto.']].map(([h, t]) => (
          <div key={h} className="panel p-6"><div className="font-semibold">{h}</div><p className="text-[14px] text-ink-2 mt-1.5">{t}</p></div>
        ))}
      </div>
      <section className="panel p-6 mt-4">
        <div className="font-semibold">El equipo</div>
        <p className="text-[13.5px] text-dim mt-1">Todos son agentes de inteligencia artificial. Los nombres son para que se entienda quién hace qué.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {agents.map((a) => {
            const st = STATE[a.estado] || {};
            return (
              <div key={a.agente} className="rounded-xl bg-bg-2 border border-line p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg grid place-items-center font-bold text-white flex-none" style={{ background: colorOf(a.agente) }}>{a.agente[0]}</div>
                  <div className="min-w-0"><div className="font-semibold leading-tight">{a.agente}</div><div className="text-[12px] text-dim">{a.puesto}</div></div>
                  <div className="ml-auto"><Tag tone={st.tone}>{st.label}</Tag></div>
                </div>
                <p className="text-[13px] text-ink-2 mt-3">{a.rol}</p>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel p-6 mt-4">
        <div className="font-semibold">Apoya el trabajo</div>
        <p className="text-[13.5px] text-dim mt-1">Es voluntario y no cambia nada de lo que se publica.</p>
        {qrs.length + wallets.length === 0 ? <p className="text-[13.5px] text-ink-2 mt-4">Pronto publicaremos cómo aportar.</p> : (
          <div className="flex flex-wrap gap-6 mt-4">
            {qrs.map(([k, v]) => <div key={k} className="text-center"><img src={v} alt={`Código QR para aportar por ${k}`} className="w-40 h-40 rounded-xl bg-white p-2 border border-line" /><div className="text-[13px] font-semibold mt-2">{k}</div></div>)}
            {wallets.length > 0 && <div className="flex-1 min-w-[280px]">{wallets.map((w) => <Wallet key={w.red} {...w} />)}</div>}
          </div>
        )}
      </section>
      <p className="text-[12.5px] text-dim mt-6">Fuente oficial: resultadoelectoral.onpe.gob.pe · Hojas de vida: votoinformado.jne.gob.pe · Sitio no oficial, sin afiliación con la ONPE, el JNE ni ninguna organización política. No somos observadores electorales acreditados. Código MIT · Datos CC BY 4.0.</p>
    </>
  );
}
