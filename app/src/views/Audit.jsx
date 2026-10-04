import { useMemo, useState } from 'react';
import { CircleCheck, ScanSearch, ShieldCheck } from 'lucide-react';
import { useData } from '../lib/data.jsx';
import { ago, n, title } from '../lib/format.js';
import { Empty, PageHeader, Pager, Stat, Tag, usePaged } from '../hud/common.jsx';

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
  actas: 'Actas imposibles',
  votos: 'Votos imposibles',
  retroceso: 'Un acumulado retrocedió',
};

const RULES = [
  ['Que los votos sumen', 'Los votos de todas las organizaciones deben dar exactamente los votos válidos, en cada acta y en cada total.'],
  ['Que nada sobre', 'Una mesa no puede tener más votos que electores, ni los válidos superar a los emitidos.'],
  ['Que nada retroceda', 'Las actas y los votos contados no deberían bajar entre una actualización y la siguiente.'],
  ['Que lo contabilizado no cambie', 'Un acta ya contabilizada que después cambia sus números es una alerta.'],
];

function Item({ x }) {
  return (
    <li className="py-3.5 border-t border-line first:border-0 flex gap-3">
      <div className="pt-0.5 flex-none"><Tag tone={x.severidad === 'alerta' ? 'alert' : 'warn'}>{x.severidad === 'alerta' ? 'Importante' : 'Revisar'}</Tag></div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{x.mesa ? `Mesa ${x.mesa} · ${x.eleccion}` : x.ambito}</div>
        {x.local && <div className="text-[12.5px] text-dim">{title(x.local)}</div>}
        <div className="text-[13.5px] text-ink-2 mt-1"><span className="text-ink">{TIPO[x.tipo] || x.tipo}.</span> {x.detalle}</div>
        {x.visto && <div className="text-[12px] text-dim mt-1">Estado del acta: {x.estadoActa || '—'} · detectado {ago(Date.parse(x.visto))}</div>}
      </div>
    </li>
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

  return (
    <>
      <PageHeader eyebrow="Auditoría independiente" title="¿Cuadran los números de la ONPE?">
        Revisamos cada total y cada acta que publica la ONPE. Un aviso <b className="text-ink">no es una acusación</b>: es una diferencia que vale la pena mirar, con los dos números a la vista. Toño, el agente de actas, contrasta cada aviso con el acta escaneada.
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Actas revisadas" value={n(r?.actasLeidas ?? 0)} sub={r ? `${n(r.mesasEncontradas)} mesas` : 'Empieza con las primeras actas'} />
        <Stat label="Contabilizadas" value={n(r?.actasContabilizadas ?? 0)} sub="según la ONPE" />
        <Stat label="Importantes" value={n(r?.avisos?.alerta ?? 0)} tone={r?.avisos?.alerta ? 'alert' : undefined} sub="alertas acta por acta" />
        <Stat label="Para revisar" value={n(r?.avisos?.revisar ?? 0)} sub="diferencias menores" />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4">
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="flex items-center gap-2 font-semibold"><ScanSearch size={16} className="text-accent" /> Acta por acta</div>
            <div className="seg">
              {[['', 'Todos'], ['alerta', 'Importantes'], ['revisar', 'Revisar']].map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}
            </div>
          </div>
          <p className="text-[12.5px] text-dim mb-2">
            {!r ? 'La revisión empieza cuando la ONPE publique las primeras actas.' : r.bloqueado ? `La ONPE dejó de responder (${r.bloqueado}). Seguimos cuando vuelva.` : `${r.exploracionCompleta ? 'Ya recorrimos todos los números de mesa' : `Vamos por la mesa ${n(r.numerosExplorados)}`} · actualizado ${ago(Date.parse(r.actualizado))}.`}
          </p>
          {pa.slice.length ? <ul>{pa.slice.map((x) => <Item key={`${x.mesa}-${x.eleccion}-${x.tipo}`} x={x} />)}</ul>
            : <Empty icon={r ? CircleCheck : ScanSearch} title={r ? 'Ninguna acta revisada tiene diferencias' : 'Aún no hay actas que revisar'}>{r ? 'Seguimos revisando las demás.' : 'Cuando la ONPE publique, revisaremos cada mesa.'}</Empty>}
          <Pager {...pa} />
        </section>

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
        </div>
      </div>
    </>
  );
}
