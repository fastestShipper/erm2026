import { useMemo, useState } from 'react';
import { CircleCheck, Dices, ExternalLink, Flag, Hash, ScanSearch, Search as SearchIcon, ShieldCheck } from 'lucide-react';
import { getJson, useData } from '../lib/data.jsx';
import { ago, n, title } from '../lib/format.js';
import { Empty, PageHeader, Pager, Stat, Tag, usePaged } from '../hud/common.jsx';
import { REPO } from './About.jsx';

const ONPE_ACTAS = 'https://resultadoelectoral.onpe.gob.pe/main/actas';

const TIPO = {
  'mas-votos-que-electores': 'Más votos que electores',
  'suma-partidos': 'Los votos no suman los válidos',
  'suma-emitidos': 'Válidos + blancos + nulos ≠ emitidos',
  'emitidos-asistentes': 'Emitidos ≠ asistentes',
  'participacion-100': 'Participación del 100%',
  concentracion: 'Una organización con casi todos los votos',
  'cambio-despues-de-contabilizada': 'Cambió después de contabilizada',
  'suma-votos-validos': 'La suma no da los válidos',
  porcentaje: 'Porcentaje que no coincide',
  actas: 'Más actas contadas que actas totales',
  votos: 'Más votos válidos que emitidos',
  retroceso: 'Un acumulado retrocedió',
};

const RULES = [
  ['Que los votos sumen', 'Los votos de todas las organizaciones deben dar exactamente los votos válidos, en cada acta y en cada total.'],
  ['Que nada sobre', 'Una mesa no puede tener más votos que electores, ni los válidos superar a los emitidos.'],
  ['Que nada retroceda', 'Las actas y los votos contados no deberían bajar entre un corte y el siguiente.'],
  ['Que lo contabilizado no cambie', 'Si un acta ya contabilizada cambia sus números después, queda anotado.'],
];

function Item({ x }) {
  return (
    <li className="py-3.5 border-t border-line first:border-0 flex gap-3">
      <div className="pt-0.5 flex-none"><Tag tone={x.severidad === 'alerta' ? 'alert' : 'warn'}>{x.severidad === 'alerta' ? 'Importante' : 'Para revisar'}</Tag></div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{x.mesa ? `Mesa ${x.mesa} · ${x.eleccion}` : x.ambito}</div>
        {x.local && <div className="text-[12.5px] text-dim">{title(x.local)}</div>}
        <div className="text-[13.5px] text-ink-2 mt-1"><span className="text-ink">{TIPO[x.tipo] || x.tipo}.</span> {x.detalle}</div>
        {x.visto && <div className="text-[12px] text-dim mt-1">Estado del acta: {x.estadoActa || '—'} · detectado {ago(Date.parse(x.visto))}</div>}
      </div>
    </li>
  );
}

/** Busca tu mesa o saca una al azar: lo que registró la ONPE, nuestra revisión y dónde compararla. */
function VerifyYourself() {
  const d = useData();
  const r = d.actas?.actualizado ? d.actas : null;
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async (code) => {
    setBusy(true);
    const shard = await getJson(`data/actas/mesas/${code.slice(0, 3)}.json`);
    setBusy(false);
    return shard;
  };
  const go = async (ev) => {
    ev.preventDefault();
    const code = q.replace(/\D/g, '').padStart(6, '0');
    if (!/^\d{6}$/.test(code) || code === '000000') { setRes({ error: 'Escribe un número de mesa de 6 dígitos.' }); return; }
    const shard = await load(code);
    setRes(shard?.[code] ? { code, m: shard[code] } : { code, missing: true });
  };
  const random = async () => {
    const max = r?.numerosExplorados || 0;
    if (!max) { setRes({ error: 'Todavía no hay actas revisadas. Empieza con las primeras actas que publique la ONPE.' }); return; }
    const frag = r?.fragmentos || [];   // archivos de mesas que ya existen
    for (let i = 0; i < 6; i++) {
      const guess = frag.length ? `${frag[Math.floor(Math.random() * frag.length)]}000` : String(1 + Math.floor(Math.random() * max)).padStart(6, '0');
      const shard = await load(guess);
      const codes = Object.keys(shard || {});
      if (codes.length) { const code = codes[Math.floor(Math.random() * codes.length)]; setQ(code); setRes({ code, m: shard[code], azar: true }); return; }
    }
    setRes({ error: 'No pudimos sacar una mesa ahora. Intenta de nuevo.' });
  };
  const obs = res?.m ? (d.anomalias?.items || []).filter((x) => x.mesa === res.code) : [];

  return (
    <section className="panel p-6">
      <div className="flex items-center gap-2 font-semibold"><Hash size={16} className="text-accent" /> Verifícalo tú</div>
      <p className="text-[13.5px] text-dim mt-1.5">Busca tu mesa (el número de 6 dígitos aparece al consultar tu local de votación en la ONPE y en la puerta de tu aula) o saca una al azar. Verás lo que registró la ONPE y lo que encontró nuestra revisión, para que lo compares con el acta escaneada.</p>
      <form onSubmit={go} className="flex gap-2 mt-4 flex-wrap">
        <input className="field num text-[18px] tracking-[0.15em] flex-1 min-w-[150px]" inputMode="numeric" maxLength={6} placeholder="045678" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Número de mesa" />
        <button className="btn h-11" disabled={busy}><SearchIcon size={16} /> Buscar</button>
        <button type="button" className="btn-ghost !h-11" onClick={random} disabled={busy}><Dices size={16} /> Una al azar</button>
      </form>
      <div className="mt-4">
        {res?.error && <p className="text-[13px] text-alert">{res.error}</p>}
        {res?.missing && <p className="text-[13.5px] text-dim">Todavía no tenemos la mesa {res.code}. {d.live ? 'Las recorremos en orden: intenta de nuevo en un rato.' : 'Aparecerá cuando la ONPE publique las actas.'}</p>}
        {res?.m && (
          <div className="rise">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="font-semibold text-[17px]">Mesa {res.code}{res.azar && <span className="tag tag-info ml-2 align-middle">al azar</span>}</div>
              <div className="text-[12.5px] text-dim">{title(res.m.local || '')} · consultada {ago(Date.parse(res.m.consultado))}</div>
            </div>
            <div className={`mt-3 rounded-xl border p-3.5 text-[13.5px] ${obs.length ? 'border-line bg-bg-2' : ''}`} style={obs.length ? undefined : { borderColor: 'color-mix(in srgb, var(--color-ok) 35%, transparent)', background: 'color-mix(in srgb, var(--color-ok) 7%, transparent)' }}>
              {obs.length === 0 ? <><b className="text-ok">Sin observaciones.</b> <span className="text-ink-2">En esta mesa las sumas cuadran con lo que publicó la ONPE.</span></>
                : <><b>Nuestra revisión anotó {obs.length} {obs.length === 1 ? 'observación' : 'observaciones'}:</b><ul className="mt-1.5 space-y-1 text-ink-2">{obs.map((x, i) => <li key={i}>{x.eleccion}: {TIPO[x.tipo] || x.tipo}. {x.detalle}</li>)}</ul></>}
            </div>
            {res.m.actas.map((a, i) => (
              <div key={i} className="mt-3 rounded-xl border border-line bg-bg-2 p-4">
                <div className="flex items-center justify-between gap-2"><b className="text-[14px]">{a.eleccion}</b><Tag tone={/contabiliz/i.test(a.estado || '') ? 'ok' : 'info'}>{a.estado || '—'}</Tag></div>
                <div className="grid grid-cols-5 gap-2 mt-3 text-center">
                  {[['electores', a.electores], ['emitidos', a.emitidos], ['válidos', a.validos], ['blancos', a.blancos], ['nulos', a.nulos]].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-panel p-2"><div className="num text-[15px] font-semibold">{n(v)}</div><div className="text-[10.5px] text-dim">{l}</div></div>
                  ))}
                </div>
                <table className="w-full text-[13px] mt-3"><tbody>
                  {(a.partidos || []).map(([p, v]) => <tr key={p} className="border-t border-line"><td className="py-1.5 pr-2">{title(p)}</td><td className="py-1.5 text-right num">{n(v)}</td></tr>)}
                </tbody></table>
              </div>
            ))}
            <p className="text-[12.5px] text-ink-2 mt-3">Compárala con el acta escaneada: entra a <a className="text-accent-2 hover:underline inline-flex items-center gap-1" href={ONPE_ACTAS} target="_blank" rel="noopener noreferrer">resultadoelectoral.onpe.gob.pe, sección Actas <ExternalLink size={12} /></a> y busca la mesa <b className="num">{res.code}</b>. Si algo no coincide, <a className="text-accent-2 hover:underline" href={`${REPO}/issues/new?labels=errata&title=${encodeURIComponent(`Mesa ${res.code}: `)}`} target="_blank" rel="noopener noreferrer">avísanos</a>.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Audit() {
  const d = useData();
  const r = d.actas?.actualizado ? d.actas : null;   // sin «actualizado» = la revisión aún no empieza
  const [f, setF] = useState('');
  const acts = useMemo(() => (d.anomalias?.items || []).filter((x) => !f || x.severidad === f), [d.anomalias, f]);
  const pa = usePaged(acts, 7, f);
  const checks = d.live ? d.checks?.items || [] : [];
  const pc = usePaged(checks, 6, checks.length);
  const conObs = (r?.avisos?.alerta ?? 0) + (r?.avisos?.revisar ?? 0);

  return (
    <>
      <PageHeader eyebrow="Auditoría independiente" title="¿Cuadran los números de la ONPE?">
        Revisamos cada total y cada acta que publica la ONPE. Una observación <b className="text-ink">no es una acusación</b>: es una diferencia que vale la pena mirar, con los dos números a la vista. Toño, el agente de actas, contrasta cada una con el acta escaneada.
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Actas revisadas" value={n(r?.actasLeidas ?? 0)} sub={r ? `${n(r.mesasEncontradas)} mesas` : 'Empieza con las primeras actas'} />
        <Stat label="Sin observaciones" value={r?.actasLeidas ? `${(100 * (1 - conObs / r.actasLeidas)).toFixed(1)}%` : '—'} sub="de las actas revisadas" tone={r?.actasLeidas ? 'ok' : undefined} />
        <Stat label="Importantes" value={n(r?.avisos?.alerta ?? 0)} tone={r?.avisos?.alerta ? 'alert' : undefined} sub="observaciones en actas" />
        <Stat label="Para revisar" value={n(r?.avisos?.revisar ?? 0)} sub="diferencias menores" />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="panel p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <div className="flex items-center gap-2 font-semibold"><ScanSearch size={16} className="text-accent" /> Observaciones acta por acta</div>
              <div className="seg">
                {[['', 'Todas'], ['alerta', 'Importantes'], ['revisar', 'Para revisar']].map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
              </div>
            </div>
            <p className="text-[12.5px] text-dim mb-2">
              {!r ? 'La revisión empieza cuando la ONPE publique las primeras actas.' : r.bloqueado ? `La ONPE dejó de responder (${r.bloqueado}). Seguimos cuando vuelva.` : `${r.exploracionCompleta ? 'Ya recorrimos todos los números de mesa' : `Vamos por la mesa ${n(r.numerosExplorados)}`} · actualizado ${ago(Date.parse(r.actualizado))}.`}
            </p>
            {pa.slice.length ? <ul>{pa.slice.map((x) => <Item key={`${x.mesa}-${x.eleccion}-${x.tipo}`} x={x} />)}</ul>
              : <Empty icon={r ? CircleCheck : ScanSearch} title={r ? 'Ninguna acta revisada tiene diferencias' : 'Aún no hay actas que revisar'}>{r ? 'Seguimos revisando las demás.' : 'Cuando la ONPE publique, revisaremos cada mesa.'}</Empty>}
            <Pager {...pa} />
          </section>
          <VerifyYourself />
        </div>

        <div className="flex flex-col gap-4">
          <section className="panel p-5">
            <div className="flex items-center gap-2 font-semibold mb-3"><ShieldCheck size={16} className="text-accent" /> Totales (país, regiones, municipios)</div>
            {!d.live ? <div className="rounded-xl bg-bg-2 border border-line p-4 text-[13.5px] text-ink-2">Todavía no hay totales que revisar. Empieza con el primer corte oficial.</div>
              : checks.length === 0 ? <div className="rounded-xl p-4 text-[13.5px] border" style={{ borderColor: 'color-mix(in srgb, var(--color-ok) 35%, transparent)', background: 'color-mix(in srgb, var(--color-ok) 8%, transparent)' }}><b className="text-ok">Todo cuadra.</b> <span className="text-ink-2">Sumas, porcentajes y acumulados coinciden en el último corte.</span></div>
              : <><ul>{pc.slice.map((x, i) => <Item key={i} x={x} />)}</ul><Pager {...pc} /></>}
          </section>
          <section className="panel p-5">
            <div className="font-semibold mb-2">Qué revisamos</div>
            <ol className="space-y-3">
              {RULES.map(([h, t], i) => (
                <li key={h} className="flex gap-3">
                  <span className="num text-[12px] w-6 h-6 rounded-md grid place-items-center bg-panel-2 text-accent flex-none">{i + 1}</span>
                  <div><div className="text-[14px] font-medium">{h}</div><div className="text-[13px] text-dim">{t}</div></div>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel p-5">
            <div className="flex items-center gap-2 font-semibold"><Flag size={16} className="text-accent" /> ¿Encontraste un error nuestro?</div>
            <p className="text-[13px] text-ink-2 mt-1.5">Lo corregimos a la vista de todos. <a className="text-accent-2 hover:underline" href="#acerca/correcciones">Cómo reportarlo y qué hemos corregido</a>.</p>
          </section>
        </div>
      </div>
    </>
  );
}
