// Apariencia y lugar de cada agente en la sala. El orden define su escritorio en el anillo.
export const LOOKS = {
  'Luchito':  { color: '#2563eb', skin: '#a8714a', hair: '#141010', hairStyle: 'short' },
  'Toño':     { color: '#4d7c0f', skin: '#a87250', hair: '#141010', hairStyle: 'short', glasses: true },
  'Rosita':   { color: '#047857', skin: '#d39a72', hair: '#3a2416', hairStyle: 'bun', glasses: true },
  'Kike':     { color: '#c2410c', skin: '#9b6440', hair: '#0f0d0c', hairStyle: 'spiky' },
  'Norma':    { color: '#e11d48', skin: '#c68863', hair: '#1b1412', hairStyle: 'bob', glasses: true, lead: true },
  'Maritza':  { color: '#7c3aed', skin: '#b97c55', hair: '#2a1a12', hairStyle: 'long' },
  'Jorge':    { color: '#0f766e', skin: '#a56b46', hair: '#1d1714', hairStyle: 'short', headset: true },
  'Charo':    { color: '#db2777', skin: '#c48a64', hair: '#5b2d1a', hairStyle: 'long' },
  'Don Pepe': { color: '#475569', skin: '#b07a55', hair: '#c9c9c9', hairStyle: 'bald', mustache: true },
  'Beto':     { color: '#b45309', skin: '#9d6a47', hair: '#191311', hairStyle: 'cap' },
};
const SPARE = [
  { color: '#0284c7', skin: '#b9825c', hair: '#201612', hairStyle: 'long' },
  { color: '#a21caf', skin: '#a06a45', hair: '#121010', hairStyle: 'short' },
];
export const ORDER = ['Luchito', 'Toño', 'Rosita', 'Kike', 'Norma', 'Maritza', 'Jorge', 'Charo', 'Don Pepe', 'Beto'];

export const lookOf = (name, i = 0) => LOOKS[name] || SPARE[i % SPARE.length];
export const colorOf = (name) => (LOOKS[name] || SPARE[0]).color;

export const STATE = {
  activo:            { label: 'Trabajando ahora', tone: 'ok' },
  cumpliendo:        { label: 'Al día', tone: 'ok' },
  atrasado:          { label: 'Atrasado', tone: 'alert' },
  programado:        { label: 'Aún no entra', tone: 'info' },
  'fuera-de-horario': { label: 'Terminó su turno', tone: 'dim' },
};

/** Ordena el roster según el anillo de la sala; los recién llegados van al final. */
export function seatAgents(agentes = []) {
  const known = ORDER.map((n) => agentes.find((a) => a.agente === n)).filter(Boolean);
  const extra = agentes.filter((a) => !ORDER.includes(a.agente));
  return [...known, ...extra];
}

/** Posición de cada escritorio: herradura alrededor del holograma, abierta hacia la cámara. */
export function deskPose(i, total) {
  const R = 7.4;
  const t = total <= 1 ? 0.5 : i / (total - 1);
  const ang = Math.PI * (1.02 + 0.96 * t);         // de ~184° a ~356° (pasando por el fondo)
  const x = R * Math.cos(ang);
  const z = R * Math.sin(ang) + 0.6;
  return { x, z, rotY: Math.atan2(-x, -z) };   // mirando al holograma (0,0)
}
