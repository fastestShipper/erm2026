// «Mi zona»: el lugar que elige cada visitante (región, provincia o distrito) y los datos de sus contiendas.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getJson, useData } from './data.jsx';
import { n, norm, pct, timeLima, title } from './format.js';

const KEY = 'erm-zona';
const SITE = 'https://peruvian.dev/dataonpe/';
const listeners = new Set();
let current = (() => { try { return localStorage.getItem(KEY) || null; } catch { return null; } })();

/** Guarda la zona en este navegador (no sale de aquí). `null` la borra. */
export function setZone(zone) {
  current = zone || null;
  try { if (current) localStorage.setItem(KEY, current); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  listeners.forEach((f) => f());
}
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
/** Zona guardada, como «3:140102» (nivel:ubigeo). */
export const useZone = () => useSyncExternalStore(subscribe, () => current);

/* ───────── índice de lugares ───────── */
let cache = null;
let cacheAt = 0;

function build(j) {
  const list = (j.lugares || []).map(([nivel, code, dep, prov, nombre]) => ({ nivel, code, dep, prov, nombre, id: `${nivel}:${code}` }));
  const byId = Object.fromEntries(list.map((x) => [x.id, x]));
  for (const x of list) {
    const depName = byId[`1:${x.dep}`]?.nombre || '';
    const provName = x.prov ? byId[`2:${x.prov}`]?.nombre || '' : '';
    x.depName = depName;
    x.provName = provName;
    x.ruta = x.nivel === 1 ? title(x.nombre) : x.nivel === 2 ? `${title(x.nombre)}, ${title(depName)}` : `${title(x.nombre)}, ${title(provName)}, ${title(depName)}`;
    x.buscar = norm(x.nombre);
    x.buscarTodo = norm(`${x.nombre} ${provName} ${depName}`);
  }
  return { list, byId, elecciones: j.elecciones || {} };
}

/** Regiones, provincias y distritos (se arma con lo que publica la ONPE). `null` mientras carga o si aún no existe. */
export function usePlaces() {
  const d = useData();
  const [p, setP] = useState(cache);
  useEffect(() => {
    if (!d.live) return undefined;
    let alive = true;
    const load = () => getJson('data/ambitos/indice.json').then((j) => {
      if (!j?.lugares?.length) return;
      cache = build(j);
      cacheAt = Date.now();
      if (alive) setP(cache);
    });
    if (!cache || Date.now() - cacheAt > 300000) load();
    const t = setInterval(load, 300000);
    return () => { alive = false; clearInterval(t); };
  }, [d.live]);
  return p;
}

/** Busca lugares por nombre: primero los que empiezan con el texto, luego los que lo contienen. */
export function searchPlaces(places, q, limit = 8) {
  const k = norm(q);
  if (!places || k.length < 2) return [];
  const starts = [], contains = [];
  for (const x of places.list) {
    if (x.buscar.startsWith(k)) starts.push(x);
    else if (x.buscarTodo.includes(k)) contains.push(x);
  }
  const order = (a, b) => a.nivel - b.nivel || a.nombre.localeCompare(b.nombre);
  return [...starts.sort(order), ...contains.sort(order)].slice(0, limit);
}

/* ───────── contiendas de una zona ───────── */
const tipoDe = (e) => e.tipo || (e.nivel === 3 ? 'distrital' : e.nivel === 2 ? 'provincial' : 'gobernador');
export const CARGO = { distrital: 'Alcalde distrital', provincial: 'Alcalde provincial', gobernador: 'Gobernador regional' };

/**
 * Las contiendas que le tocan a un lugar: su distrito, su provincia y su región.
 * Cada una trae `data` (totales, participantes, contienda) o `null` si todavía no la tenemos.
 */
export function useZoneRaces(zone, places) {
  const d = useData();
  const place = (zone && places?.byId[zone]) || null;
  const els = d.latest?.elecciones || [];
  const eDist = els.find((e) => tipoDe(e) === 'distrital');
  const eProv = els.find((e) => tipoDe(e) === 'provincial');
  const eGob = els.find((e) => tipoDe(e) === 'gobernador');
  const [shards, setShards] = useState({});
  const corte = Math.max(0, ...els.map((e) => e.totales?.fechaActualizacion || 0));
  const dep = place?.dep;
  const need = useMemo(() => {
    if (!place) return [];
    const out = [];
    if (place.nivel === 3 && eDist) out.push(`data/ambitos/eleccion-${eDist.id}/${dep}.json`);
    if (place.nivel >= 2 && eProv) out.push(`data/ambitos/eleccion-${eProv.id}/${dep}.json`);
    return out;
  }, [place, dep, eDist?.id, eProv?.id]);

  useEffect(() => {
    if (!need.length) return undefined;
    let alive = true;
    const load = () => need.forEach((path) => getJson(path).then((j) => { if (alive && j) setShards((s) => ({ ...s, [path]: j })); }));
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [need, corte]);

  return useMemo(() => {
    if (!place) return [];
    const races = [];
    const depName = place.depName || place.nombre;
    if (place.nivel === 3 && eDist) {
      const sh = shards[`data/ambitos/eleccion-${eDist.id}/${dep}.json`];
      races.push({ tipo: 'distrital', eleccion: eDist, lugar: place.nombre, donde: `${title(place.nombre)} (${title(place.provName)})`, zone: place.id, data: sh?.distritos?.[place.code] || null, cargando: !sh });
    }
    if (place.nivel >= 2 && eProv) {
      const sh = shards[`data/ambitos/eleccion-${eProv.id}/${dep}.json`];
      const provName = place.nivel === 2 ? place.nombre : place.provName;
      races.push({ tipo: 'provincial', eleccion: eProv, lugar: provName, donde: `${title(provName)} (${title(depName)})`, zone: `2:${place.prov}`, data: sh?.provincias?.[place.prov] || null, cargando: !sh });
    }
    // Lima Metropolitana no elige gobernador regional: su alcalde provincial cumple esa función.
    const limaMetro = norm(depName) === 'LIMA' && place.nivel >= 2 && norm(place.nivel === 2 ? place.nombre : place.provName) === 'LIMA';
    if (eGob && !limaMetro) {
      const dd = (eGob.departamentos || []).find((x) => x.ubigeo === dep);
      races.push({ tipo: 'gobernador', eleccion: eGob, lugar: depName, donde: title(depName), zone: `1:${dep}`, data: dd ? { ...dd, visto: d.status?.consultado } : null, cargando: false });
    }
    return races;
  }, [place, shards, eDist, eProv, eGob, dep, d.status?.consultado]);
}

/** Organizaciones (sin blancos ni nulos) y votos especiales de un ámbito. */
export function splitRows(participantes = []) {
  const orgs = participantes.filter((p) => !p.especial && !/BLANCO|NULO|IMPUGNAD/i.test(p.partido || '') && p.votos !== null && p.votos !== undefined);
  const especiales = participantes.filter((p) => p.especial || /BLANCO|NULO|IMPUGNAD/i.test(p.partido || ''));
  return { orgs, especiales };
}

/** Quién va primero (nunca blancos ni nulos). */
export const leaderOf = (participantes) => splitRows(participantes).orgs.find((p) => p.votos) || null;

/* ───────── compartir ───────── */
export const zoneUrl = (zone) => `${SITE}#resultados/${String(zone).replace(':', '-')}`;

/** Texto corto de una contienda para compartir. Solo cifras oficiales de la ONPE, con su hora de corte. */
export function shareText(race) {
  const t = race.data?.totales || {};
  const { orgs } = splitRows(race.data?.participantes);
  const top = orgs.slice(0, 3).map((p, i) => `${i + 1}.º ${title(p.candidato || p.partido)}${p.candidato ? ` (${title(p.partido)})` : ''} ${pct(p.pctValidos, 1)}`).join(' · ');
  return `${CARGO[race.tipo]} de ${title(race.lugar)} · corte ONPE ${timeLima(t.fechaActualizacion)}, ${pct(t.actasContabilizadas, 1)} de actas contadas (${n(t.contabilizadas)} de ${n(t.totalActas)}). ${top}. Cifras oficiales de la ONPE, no son resultados finales.`;
}

export async function share(text, url) {
  try {
    if (navigator.share) { await navigator.share({ text, url }); return 'compartido'; }
  } catch { return 'cancelado'; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'copiado'; } catch { return 'error'; }
}
export const whatsappUrl = (text, url) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
