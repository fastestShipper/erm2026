import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ago, timeLima } from '../lib/format.js';

/** Texto de un agente con enlaces, negritas y código; todo escapado por React. */
export function RichText({ text }) {
  const parts = useMemo(() => {
    const out = [];
    const re = /\[([^\]]{1,140})\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<)]+)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0, m, k = 0;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) out.push(<a key={k++} href={m[2]} target="_blank" rel="noopener nofollow">{m[1]}</a>);
      else if (m[3]) out.push(<a key={k++} href={m[3]} target="_blank" rel="noopener nofollow">{m[3].replace(/^https:\/\//, '').slice(0, 42)}</a>);
      else if (m[4]) out.push(<b key={k++}>{m[4]}</b>);
      else if (m[5]) out.push(<code key={k++}>{m[5]}</code>);
      last = re.lastIndex;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }, [text]);
  return <span className="prose-msg whitespace-pre-wrap break-words">{parts}</span>;
}

export function Tag({ tone = 'dim', children }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, children, right }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="max-w-3xl">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[28px] md:text-[34px] leading-[1.1] font-bold tracking-[-0.025em]">{title}</h1>
        {children && <p className="mt-3 text-[15.5px] text-ink-2 leading-relaxed">{children}</p>}
      </div>
      {right}
    </header>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div className={`num text-[26px] font-semibold mt-2 ${tone === 'alert' ? 'text-alert' : tone === 'ok' ? 'text-ok' : ''}`}>{value}</div>
      {sub && <div className="text-[12.5px] text-dim mt-1">{sub}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {Icon && <div className="w-11 h-11 rounded-xl grid place-items-center bg-panel-2 border border-line mb-4"><Icon size={20} className="text-dim" /></div>}
      <div className="font-semibold">{title}</div>
      {children && <p className="text-[14px] text-dim mt-1 max-w-md">{children}</p>}
    </div>
  );
}

export function usePaged(items, size, resetKey) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(page, pages);
  return { page: p, pages, setPage, slice: items.slice((p - 1) * size, p * size) };
}

export function Pager({ page, pages, setPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-line">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ opacity: page <= 1 ? 0.4 : 1 }}><ChevronLeft size={16} /> Anterior</button>
      <span className="text-[13px] text-dim num">{page} / {pages}</span>
      <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} style={{ opacity: page >= pages ? 0.4 : 1 }}>Siguiente <ChevronRight size={16} /></button>
    </div>
  );
}

export const When = ({ iso }) => <span className="num text-[11.5px] text-dim">{timeLima(Date.parse(iso))}</span>;
export const Ago = ({ iso }) => <span className="text-[12px] text-dim">{ago(Date.parse(iso))}</span>;
