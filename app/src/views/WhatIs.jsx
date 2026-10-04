import { ArrowRight, Bot, Calculator, ChartColumn, Eye, FileSearch, MapPin, Radio, ShieldCheck, X } from 'lucide-react';
import { useData } from '../lib/data.jsx';

const STEPS = [
  [Eye, 'Leemos', 'Cada minuto, lo que publica la ONPE en su portal de resultados, tal cual llega. Nada se calcula a ojo.'],
  [Calculator, 'Revisamos', 'Que las sumas cuadren, que nada retroceda entre un corte y otro, y cada acta, una por una.'],
  [ChartColumn, 'Te lo mostramos', 'Claro y por tu distrito, con todos los datos abiertos para que lo compruebes tú.'],
];

const DO = [
  ['#en-vivo', Radio, 'Mira la oficina en vivo', '10 agentes de inteligencia artificial siguen la jornada a la vista de todos.'],
  ['#resultados', MapPin, 'Busca tu zona', 'Quién va primero en tu distrito, tu provincia y tu región, y si eso todavía puede cambiar.'],
  ['#auditoria', FileSearch, 'Revisa una mesa', 'Busca tu mesa o una al azar y compárala con el acta escaneada de la ONPE.'],
];

const NOT = [
  'No es la ONPE ni el JNE: los resultados oficiales son los de la ONPE.',
  'No hace encuestas, conteos rápidos ni proyecciones.',
  'No recibe dinero de partidos, candidatos, medios ni empresas.',
];

/** «¿Qué es esto?»: en medio minuto, de qué trata el sitio. */
export default function WhatIs() {
  const d = useData();
  const n = d.schedule?.agentes?.length || 10;
  return (
    <div className="max-w-[980px] mx-auto">
      <section className="text-center pt-2 lg:pt-4">
        <span className="eyebrow !text-live">¿Qué es esto?</span>
        <h1 className="display text-[32px] md:text-[46px] leading-[1.02] mt-3">Una auditoría ciudadana, en vivo,<br className="hidden md:block" /> del conteo de votos</h1>
        <p className="text-[16px] md:text-[18px] text-ink-2 leading-relaxed mt-4 max-w-[720px] mx-auto">
          Seguimos minuto a minuto lo que publica la ONPE sobre las Elecciones Regionales y Municipales del 4 de octubre, y lo revisamos para que cualquiera pueda comprobar que los números cuadran.
        </p>
      </section>

      {/* cómo funciona, en tres pasos */}
      <section className="grid md:grid-cols-3 gap-3 mt-8">
        {STEPS.map(([I, h, t], i) => (
          <div key={h} className="panel p-5 relative overflow-hidden">
            <span className="absolute right-4 top-2 display !text-[64px] leading-none text-navy/[0.06] select-none" aria-hidden="true">{i + 1}</span>
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-navy text-white"><I size={19} /></span>
            <div className="font-bold text-[17px] mt-3">{i + 1}. {h}</div>
            <p className="text-[14px] text-ink-2 mt-1 leading-relaxed">{t}</p>
          </div>
        ))}
      </section>

      {/* qué puedes hacer aquí */}
      <section className="mt-8">
        <h2 className="text-[13px] font-semibold text-dim uppercase tracking-[0.12em] text-center">Qué puedes hacer aquí</h2>
        <div className="grid md:grid-cols-3 gap-3 mt-3">
          {DO.map(([href, I, h, t]) => (
            <a key={href} href={href} className="panel p-5 group transition-colors hover:border-line-2 flex flex-col">
              <I size={20} className="text-accent-2" />
              <div className="font-semibold text-[16px] mt-3 flex items-center gap-1.5 group-hover:text-accent-2 transition-colors">{h}<ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" /></div>
              <p className="text-[13.5px] text-dim mt-1 leading-relaxed">{t}</p>
            </a>
          ))}
        </div>
      </section>

      {/* lo que no es, y quién trabaja */}
      <section className="grid md:grid-cols-[1.25fr_1fr] gap-3 mt-8">
        <div className="panel p-5">
          <div className="font-semibold flex items-center gap-2"><ShieldCheck size={17} className="text-accent-2" />Lo que no es</div>
          <ul className="mt-3 space-y-2.5">
            {NOT.map((t) => (
              <li key={t} className="flex gap-2.5 text-[14px] text-ink-2"><span className="w-5 h-5 rounded-full grid place-items-center bg-[#fdecec] text-alert flex-none mt-px"><X size={12} strokeWidth={3} /></span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="panel p-5">
          <div className="font-semibold flex items-center gap-2"><Bot size={17} className="text-accent-2" />Quién hace el trabajo</div>
          <p className="text-[14px] text-ink-2 mt-3 leading-relaxed">
            Un equipo de {n} agentes de IA, con nombres para que se entienda quién hace qué. Comentan y verifican lo que pasa; <b className="text-ink">las cifras no las escriben ellos</b>: salen directo de la ONPE y las ordena un programa, sin IA.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
        <a href="#en-vivo" className="btn-pill !bg-navy !border-navy !text-white hover:!bg-[#13295e]"><Radio size={15} />Ir a la transmisión</a>
        <a href="#resultados" className="btn-pill"><MapPin size={15} />Buscar mi zona</a>
        <a href="#acerca" className="btn-pill">Más detalles del proyecto</a>
      </div>
    </div>
  );
}
