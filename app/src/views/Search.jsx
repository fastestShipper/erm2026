import { useEffect, useMemo, useState } from 'react';
import { Hash, MapPin, Search as SearchIcon } from 'lucide-react';
import { getJson, useData } from '../lib/data.jsx';
import { ago, n, norm, pct, title } from '../lib/format.js';
import { Empty, PageHeader, Pager, Tag, usePaged } from '../hud/common.jsx';

function MesaLookup() {
  const d = useData();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async (ev) => {
    ev.preventDefault();
    const code = q.replace(/\D/g, '').padStart(6, '0');
    if (!/^\d{6}$/.test(code) || code === '000000') { setRes({ error: 'Escribe un número de mesa de 6 dígitos.' }); return; }
    setBusy(true);
    const shard = await getJson(`data/actas/mesas/${code.slice(0, 3)}.json`);
    setBusy(false);
    setRes(shard?.[code] ? { code, m: shard[code] } : { code, missing: true });
  };
  return (
    <section className="panel p-6">
      <div className="flex items-center gap-2 font-semibold"><Hash size={16} className="text-accent" /> Busca tu mesa</div>
      <p className="text-[13.5px] text-dim mt-1.5">El número de mesa tiene 6 dígitos y está en tu constancia de votación o en la cédula. Compara lo que registró la ONPE con lo que se contó en tu mesa.</p>
      <form onSubmit={go} className="flex gap-2 mt-4">
        <input className="field num text-[18px] tracking-[0.15em]" inputMode="numeric" maxLength={6} placeholder="045678" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Número de mesa" />
        <button className="btn h-11" disabled={busy}><SearchIcon size={16} /> Buscar</button>
      </form>
      <div className="mt-4">
        {res?.error && <p className="text-[13px] text-alert">{res.error}</p>}
        {res?.missing && <p className="text-[13.5px] text-dim">Todavía no tenemos la mesa {res.code}. {d.live ? 'La estamos recorriendo: intenta de nuevo en un rato.' : 'Aparecerá cuando la ONPE publique las actas.'}</p>}
        {res?.m && (
          <div className="rise">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="font-semibold text-[17px]">Mesa {res.code}</div>
              <div className="text-[12.5px] text-dim">{title(res.m.local || '')} · consultada {ago(Date.parse(res.m.consultado))}</div>
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
            <p className="text-[12px] text-dim mt-3">Fuente: API pública de la ONPE. Compara estos números con la foto del acta de tu mesa.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function PlaceLookup() {
  const d = useData();
  const els = (d.latest?.elecciones || []).filter((e) => e.nivel >= 2);
  const [eid, setEid] = useState(null);
  const e = els.find((x) => x.id === eid) || els[0];
  const [amb, setAmb] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (e) getJson(`data/ambitos/eleccion-${e.id}.json`).then(setAmb); }, [e?.id, e?.totales?.fechaActualizacion]);
  const rows = useMemo(() => {
    const k = norm(q);
    return Object.values({ ...(amb?.provincias || {}), ...(amb?.distritos || {}) }).filter((r) => !k || norm(r.nombre).includes(k)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [amb, q]);
  const pg = usePaged(rows, 10, q + (e?.id || ''));
  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold"><MapPin size={16} className="text-accent" /> Busca tu provincia o distrito</div>
        {els.length > 1 && <div className="seg">{els.map((x) => <button key={x.id} aria-pressed={x.id === e.id} onClick={() => setEid(x.id)}>{x.menu || x.nombre}</button>)}</div>}
      </div>
      {!e ? <Empty icon={MapPin} title="Disponible cuando la ONPE publique">Aquí podrás ver quién va primero en tu provincia o distrito.</Empty> : (
        <>
          <input className="field mt-4" placeholder="Ej.: Miraflores, Wanchaq, Huancayo…" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Buscar lugar" />
          <div className="mt-3">
            {pg.slice.length === 0 ? <p className="text-[13.5px] text-dim py-6 text-center">{q ? 'No encontramos ese nombre. Prueba escribiéndolo de otra forma.' : 'Todavía estamos descargando provincias y distritos.'}</p> : (
              <table className="w-full text-[13.5px]">
                <thead><tr className="text-left text-dim text-[11.5px] uppercase tracking-wider"><th className="py-2 font-medium">Lugar</th><th className="py-2 font-medium">Va primero</th><th className="py-2 font-medium text-right">%</th><th className="py-2 font-medium text-right hidden sm:table-cell">Actas</th></tr></thead>
                <tbody>
                  {pg.slice.map((r) => {
                    const l = (r.participantes || [])[0] || {};
                    return (
                      <tr key={r.nombre} className="border-t border-line align-top">
                        <td className="py-2.5 pr-2">{title(r.nombre)}</td>
                        <td className="py-2.5 pr-2">{title(l.candidato || '')}<div className="text-[12px] text-dim">{title(l.partido || '—')}</div></td>
                        <td className="py-2.5 text-right num">{pct(l.pctValidos, 1)}</td>
                        <td className="py-2.5 text-right num hidden sm:table-cell">{pct(r.totales?.actasContabilizadas, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Pager {...pg} />
          {amb && <p className="text-[12px] text-dim mt-3">{n(Object.keys(amb.provincias || {}).length)} provincias y {n(Object.keys(amb.distritos || {}).length)} distritos descargados{amb.pendientes ? ` · faltan ${n(amb.pendientes)} (los pedimos de a pocos para no saturar a la ONPE)` : ''}.</p>}
        </>
      )}
    </section>
  );
}

export default function Search() {
  return (
    <>
      <PageHeader eyebrow="Consulta ciudadana" title="Buscar">Busca tu mesa para ver lo que la ONPE registró en su acta, o tu provincia o distrito para ver quién va primero.</PageHeader>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <MesaLookup />
        <PlaceLookup />
      </div>
    </>
  );
}
