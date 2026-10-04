// Puesto de trabajo: escritorio alto, pantalla de vidrio, teclado, equipo bajo la mesa y objetos.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { materials } from './materials.js';
import { drawScreen, newCanvas } from './textures.js';

export const DESK_Y = 0.98;

// geometrías compartidas entre los escritorios
const GEO = {};
const geo = (k, make) => (GEO[k] ||= make());
const rbox = (w, h, d, r = 0.012, s = 3) => geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, s, r));
const box = (w, h, d) => geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, n = 24) => geo(`c${rt}|${rb}|${h}|${n}`, () => new THREE.CylinderGeometry(rt, rb, h, n));

const SW = 0.86, SH = 0.5;       // pantalla

/** Pantalla de vidrio sobre un pie de aluminio: se lee desde los dos lados, así el público también la ve. */
function GlassDisplay({ kind, color, tone, on, late, busy, index, side = 1, x }) {
  const M = materials();
  const { canvas, tex } = useMemo(() => {
    const c = newCanvas(512, 300);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, tex: t };
  }, []);
  const mat = useRef();
  const last = useRef(-10);
  const tick = useRef(index * 7);
  const paint = () => { drawScreen(canvas.getContext('2d'), 512, 300, kind, tick.current, color); tex.needsUpdate = true; };
  useEffect(() => { paint(); }, [kind, color]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + index * 0.37;
    if (on && t - last.current > (busy ? 0.9 : 2.4)) { last.current = t; tick.current += 1; paint(); }
    if (mat.current) mat.current.opacity = on ? 0.96 : late ? 0.5 + Math.sin(t * 6) * 0.25 : 0.16;
  });
  const outline = geo('outline', () => new THREE.EdgesGeometry(new THREE.PlaneGeometry(SW, SH)));
  return (
    <group position={[x * side, DESK_Y + 0.023, 0.3]} rotation={[0, -0.62 * side, 0]}>
      <mesh geometry={cyl(0.11, 0.115, 0.012, 32)} material={M.alu} position={[0, 0.006, 0]} castShadow />
      <mesh geometry={box(0.036, 0.22, 0.018)} material={M.alu} position={[0, 0.12, -0.012]} />
      <group position={[0, 0.48, 0]} rotation={[-0.06, 0, 0]}>
        <mesh geometry={rbox(SW, SH, 0.012, 0.005)} material={M.glass} />
        <mesh geometry={rbox(SW + 0.012, 0.034, 0.03, 0.008)} material={M.graphite} position={[0, -SH / 2 - 0.01, 0]} castShadow />
        <mesh position={[0, 0, 0.0075]}>
          <planeGeometry args={[SW - 0.05, SH - 0.05]} />
          <meshBasicMaterial ref={mat} map={tex} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        {(on || late) && <lineSegments geometry={outline}><lineBasicMaterial color={tone} transparent opacity={0.9} toneMapped={false} /></lineSegments>}
        <mesh position={[SW / 2 - 0.04, -SH / 2 - 0.01, 0.0165]}><circleGeometry args={[0.006, 10]} /><meshBasicMaterial color={on || late ? tone : '#64748b'} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

function Plant({ position }) {
  const M = materials();
  const leaf = geo('leaf', () => new THREE.IcosahedronGeometry(0.075, 0));
  return (
    <group position={position}>
      <mesh geometry={cyl(0.06, 0.045, 0.09, 16)} material={M.gloss} position={[0, 0.045, 0]} castShadow />
      {[[0, 0.14, 0, 1], [0.05, 0.11, 0.02, 0.7], [-0.045, 0.12, -0.02, 0.75], [0.01, 0.2, -0.01, 0.6]].map(([px, py, pz, s], i) => (
        <mesh key={i} geometry={leaf} material={M.leaf[i % 3]} position={[px, py, pz]} scale={s} rotation={[i, i * 2, 0]} castShadow />
      ))}
    </group>
  );
}

/**
 * Todo lo que hay en un puesto, menos el robot y las etiquetas.
 * @param tone  color de estado (el del agente si trabaja, rojo si va atrasado, gris si no ha entrado)
 */
export function Desk({ agent, index, color, tone, on, late, kind, lead }) {
  const M = materials();
  const W = lead ? 2.2 : 1.6;
  const awake = on || late;
  const busy = agent.estado === 'activo';
  const edge = useMemo(() => new THREE.MeshBasicMaterial({ color: tone, toneMapped: false }), [tone]);
  useEffect(() => () => edge.dispose(), [edge]);
  const lx = W / 2 - 0.17;
  return (
    <>
      <group position={[0, 0, 0.3]}>
        {/* tablero blanco sobre una capa de roble */}
        <mesh geometry={rbox(W, 0.036, 0.72, 0.014)} material={M.white} position={[0, DESK_Y, 0]} castShadow receiveShadow />
        <mesh geometry={box(W - 0.03, 0.022, 0.69)} material={M.oak} position={[0, DESK_Y - 0.028, 0]} />
        {/* columnas de altura regulable con su pie */}
        {[-lx, lx].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh geometry={box(0.085, DESK_Y - 0.07, 0.07)} material={M.alu} position={[0, (DESK_Y - 0.07) / 2 + 0.03, 0]} castShadow />
            <mesh geometry={rbox(0.09, 0.03, 0.64, 0.012)} material={M.alu} position={[0, 0.015, 0]} castShadow />
          </group>
        ))}
        <mesh geometry={box(W - 0.4, 0.045, 0.03)} material={M.alu} position={[0, DESK_Y - 0.09, -0.08]} />
        {/* frente: panel y línea de luz con el color del agente */}
        <mesh geometry={box(W - 0.46, 0.34, 0.016)} material={M.white} position={[0, DESK_Y - 0.24, 0.3]} castShadow />
        <mesh geometry={box(W - 0.46, 0.014, 0.02)} material={edge} position={[0, DESK_Y - 0.415, 0.302]} />
        <mesh geometry={box(W - 0.03, 0.01, 0.01)} material={edge} position={[0, DESK_Y + 0.02, 0.356]} />

        {/* teclado y ratón, del lado del agente */}
        <group position={[lead ? 0 : -0.06, DESK_Y + 0.019, -0.16]}>
          <mesh geometry={rbox(0.46, 0.014, 0.15, 0.006)} material={M.alu} position={[0, 0.007, 0]} castShadow />
          <mesh rotation={[-Math.PI / 2, 0, Math.PI]} position={[0, 0.0146, 0]} material={M.keys}><planeGeometry args={[0.44, 0.134]} /></mesh>
          <mesh geometry={rbox(0.062, 0.026, 0.1, 0.012)} material={M.gloss} position={[0.34, 0.013, 0.01]} castShadow />
        </group>
        {/* taza */}
        <group position={[-(W / 2 - 0.2), DESK_Y + 0.019, 0.1]}>
          <mesh geometry={cyl(0.042, 0.036, 0.09, 20)} material={M.navy} position={[0, 0.045, 0]} castShadow />
          <mesh position={[0.045, 0.047, 0]} rotation={[0, 0, 0]} material={M.navy}><torusGeometry args={[0.026, 0.007, 8, 16, Math.PI * 1.2]} /></mesh>
        </group>
        {/* libreta con lapicero, o una planta */}
        {index % 3 === 1 ? <Plant position={[-(W / 2 - 0.42), DESK_Y + 0.019, 0.2]} /> : (
          <group position={[-(W / 2 - 0.5), DESK_Y + 0.019, 0.02]} rotation={[0, 0.25 + (index % 2) * 0.3, 0]}>
            <mesh geometry={box(0.17, 0.012, 0.23)} material={M.paper} position={[0, 0.006, 0]} castShadow />
            <mesh geometry={box(0.17, 0.004, 0.23)} position={[0, 0.014, 0]}><meshStandardMaterial color={color} roughness={0.7} /></mesh>
            <mesh geometry={cyl(0.005, 0.005, 0.15, 8)} material={M.graphite} position={[0.11, 0.008, 0]} rotation={[Math.PI / 2, 0, 0.2]} />
          </group>
        )}
        {/* equipo bajo la mesa, con su línea de luz */}
        <group position={[W / 2 - 0.42, 0, -0.04]}>
          <mesh geometry={rbox(0.19, 0.46, 0.44, 0.016)} material={M.graphite} position={[0, 0.26, 0]} castShadow />
          <mesh geometry={box(0.012, 0.36, 0.006)} material={awake ? edge : M.rubber} position={[0.05, 0.26, 0.222]} />
          <mesh position={[-0.05, 0.43, 0.2215]}><circleGeometry args={[0.012, 12]} /><meshBasicMaterial color={awake ? '#e2e8f0' : '#475569'} toneMapped={false} /></mesh>
        </group>
      </group>

      <GlassDisplay kind={kind} color={color} tone={tone} on={on} late={late} busy={busy} index={index} x={lead ? 0.86 : 0.6} />
      {lead && <GlassDisplay kind="datos" color={color} tone={tone} on={on} late={late} busy={busy} index={index + 3} side={-1} x={0.86} />}
    </>
  );
}
