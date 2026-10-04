import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Todo lo que muestra el sitio sale de estos archivos públicos (los mismos del repositorio).
const SOURCES = {
  status:    { path: 'data/status.json', every: 30 },
  latest:    { path: 'data/latest.json', every: 60 },
  checks:    { path: 'data/checks.json', every: 60 },
  schedule:  { path: 'data/bots/schedule.json', every: 30 },
  feed:      { path: 'data/bots/feed.json', every: 30 },
  actas:     { path: 'data/actas/resumen.json', every: 60 },
  markets:   { path: 'data/mercados.json', every: 120 },
  anomalias: { path: 'data/actas/anomalias.json', every: 120 },
  config:    { path: 'config.json', every: 600 },
};

async function fetchJson(path) {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${path}${sep}t=${Math.floor(Date.now() / 15000)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
export const getJson = fetchJson;
export async function getText(path) {
  try {
    const r = await fetch(`${path}?t=${Math.floor(Date.now() / 15000)}`, { cache: 'no-store' });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

const Ctx = createContext(null);

export function DataProvider({ children }) {
  const [d, setD] = useState({ loaded: false });
  const timers = useRef([]);

  useEffect(() => {
    let alive = true;
    const load = async (key) => {
      const v = await fetchJson(SOURCES[key].path);
      if (alive) setD((p) => (v === null && p[key] !== undefined ? p : { ...p, [key]: v, loaded: true }));
    };
    Promise.all(Object.keys(SOURCES).map(load));
    timers.current = Object.entries(SOURCES).map(([k, s]) => setInterval(() => load(k), s.every * 1000));
    return () => { alive = false; timers.current.forEach(clearInterval); };
  }, []);

  const value = useMemo(() => {
    const live = d.status?.estado === 'en-vivo' && (d.latest?.elecciones?.length || 0) > 0;
    return { ...d, live };
  }, [d]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useData = () => useContext(Ctx);

/** Reloj compartido: re-renderiza cada `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Cuántas personas tienen la página abierta (id aleatorio de sesión; sin datos personales). */
export function useViewers() {
  const [v, setV] = useState(null);
  useEffect(() => {
    let sid = null;
    try { sid = sessionStorage.getItem('erm-sid'); } catch { /* sin storage */ }
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 12);
      try { sessionStorage.setItem('erm-sid', sid); } catch { /* sin storage */ }
    }
    const ping = () => fetch(`api/ping?s=${sid}`, { method: 'POST', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => j && setV(j.viendo)).catch(() => {});
    ping();
    const t = setInterval(ping, 30000);
    return () => clearInterval(t);
  }, []);
  return v;
}

/** Hash de la URL → pestaña. */
export function useRoute(views, fallback) {
  const read = () => { const h = location.hash.replace(/^#\/?/, ''); return views.includes(h) ? h : fallback; };
  const [r, setR] = useState(read);
  useEffect(() => { const f = () => { setR(read()); window.scrollTo({ top: 0 }); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}

/** Media query reactiva (para montar una sola escena 3D según el ancho). */
export function useMedia(q) {
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setOk(mq.matches); mq.addEventListener('change', f); f(); return () => mq.removeEventListener('change', f); }, [q]);
  return ok;
}
