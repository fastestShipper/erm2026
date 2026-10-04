// La sala: piso de piedra pulida, rotonda con listones de roble, mesa central, y lo que la rodea
// (racks, plantas, cámaras de estudio, bandera, luces). Todo es geometría y texturas hechas por código.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { materials } from './materials.js';
import { drawRack, makeFlagTexture, makeFloorTexture, makeSignTexture, newCanvas } from './textures.js';

const ACCENT = '#2563eb';
const DEG = Math.PI / 180;
const R_WALL = 14;
/** Punto sobre un círculo de radio r; el ángulo 180° es el fondo de la sala (detrás de la pared de video). */
const polar = (deg, r, y = 0) => [Math.sin(deg * DEG) * r, y, Math.cos(deg * DEG) * r];

/* ───────── luz: una luz principal con sombras y un entorno de estudio para los reflejos ───────── */
export function Lights({ lowPower }) {
  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#ffffff', '#c3cddc', 0.38]} />
      <directionalLight position={[7, 15, 9]} intensity={2.1} color="#fffaf2" castShadow={!lowPower}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04}>
        <orthographicCamera attach="shadow-camera" args={[-17, 17, 15, -15, 1, 45]} />
      </directionalLight>
      <directionalLight position={[-9, 9, 6]} intensity={0.3} color="#dbe7ff" />
      <pointLight position={[0, 3.2, 0.2]} intensity={10} distance={9} color="#60a5fa" />
      <Environment resolution={lowPower ? 128 : 256} frames={1}>
        <mesh scale={60}><sphereGeometry args={[1, 24, 16]} /><meshBasicMaterial color="#aeb8c8" side={THREE.BackSide} /></mesh>
        <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[26, 26, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#fff3e0" position={[14, 5, 6]} rotation-y={-Math.PI / 2.4} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#dbe7ff" position={[-14, 5, 6]} rotation-y={Math.PI / 2.4} scale={[10, 6, 1]} />
        <Lightformer form="ring" intensity={0.9} color="#bfdbfe" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={7} />
      </Environment>
    </>
  );
}

/* ───────── piso ───────── */
export function Floor({ lowPower }) {
  const M = materials();
  const map = useMemo(() => makeFloorTexture([26, 26]), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[42, 96]} />
        {lowPower
          ? <meshStandardMaterial map={map} color="#dfe3ea" roughness={0.5} metalness={0.05} />
          : <MeshReflectorMaterial map={map} blur={[280, 90]} resolution={1024} mixBlur={0.85} mixStrength={1.15} roughness={0.5} depthScale={0.5} minDepthThreshold={0.4} maxDepthThreshold={1.25} color="#d9dee6" metalness={0.1} mirror={0.32} />}
      </mesh>
      {/* incrustaciones de latón: un aro alrededor de la mesa y otro alrededor de los puestos */}
      {[[4.02, 4.08], [10.3, 10.37]].map(([a, b]) => (
        <mesh key={a} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.2]} material={M.brass} receiveShadow>
          <ringGeometry args={[a, b, 160]} />
        </mesh>
      ))}
    </group>
  );
}

/* ───────── rotonda: muro curvo con listones de roble a los lados ───────── */
export function Rotunda() {
  const M = materials();
  const slats = useRef();
  const list = useMemo(() => {
    const out = [];
    for (const [a, b] of [[56, 148], [212, 304]]) for (let d = a; d <= b; d += 0.92) out.push(d);
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    list.forEach((d, i) => {
      m.position.set(...polar(d, R_WALL - 0.1, 3.0));
      m.rotation.set(0, d * DEG, 0);
      m.updateMatrix();
      slats.current.setMatrixAt(i, m.matrix);
    });
    slats.current.instanceMatrix.needsUpdate = true;
  }, [list]);
  const arc = (r, h, a = 52, len = 256) => [r, r, h, 128, 1, true, a * DEG, len * DEG];
  return (
    <group>
      <mesh position={[0, 3.5, 0]} material={M.wall} receiveShadow><cylinderGeometry args={arc(R_WALL, 7)} /></mesh>
      {/* zócalo y líneas de luz */}
      <mesh position={[0, 0.09, 0]}><cylinderGeometry args={arc(R_WALL - 0.03, 0.18)} /><meshStandardMaterial color="#1d2531" roughness={0.5} metalness={0.4} side={THREE.BackSide} /></mesh>
      <mesh position={[0, 0.205, 0]}><cylinderGeometry args={arc(R_WALL - 0.035, 0.03)} /><meshBasicMaterial color="#bfdbfe" toneMapped={false} side={THREE.BackSide} /></mesh>
      <mesh position={[0, 5.95, 0]}><cylinderGeometry args={arc(R_WALL - 0.04, 0.05)} /><meshBasicMaterial color="#fff4dc" toneMapped={false} side={THREE.BackSide} /></mesh>
      {/* listones */}
      <instancedMesh ref={slats} args={[undefined, undefined, list.length]} material={M.oak} castShadow receiveShadow>
        <boxGeometry args={[0.075, 5.6, 0.16]} />
      </instancedMesh>
    </group>
  );
}

/* ───────── mesa central del holograma ───────── */
export function CommandTable() {
  const M = materials();
  const ring = useRef();
  useFrame(({ clock }) => { if (ring.current) ring.current.material.opacity = 0.65 + Math.sin(clock.elapsedTime * 1.4) * 0.2; });
  return (
    <group position={[0, 0, 0.2]}>
      <mesh position={[0, 0.05, 0]} material={M.navy} castShadow receiveShadow><cylinderGeometry args={[3.3, 3.36, 0.1, 96]} /></mesh>
      <mesh position={[0, 0.115, 0]}><cylinderGeometry args={[3.2, 3.2, 0.03, 96, 1, true]} /><meshBasicMaterial color="#93c5fd" toneMapped={false} /></mesh>
      <mesh position={[0, 0.5, 0]} material={M.gloss} castShadow receiveShadow><cylinderGeometry args={[3.12, 3.2, 0.76, 96]} /></mesh>
      <mesh position={[0, 0.885, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.alu}><torusGeometry args={[3.11, 0.028, 12, 128]} /></mesh>
      <mesh ref={ring} position={[0, 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.96, 3.06, 128]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.895, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.96, 96]} />
        <meshBasicMaterial color="#dbeafe" transparent opacity={0.92} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ───────── estructura de la pared de video: marco, columnas, aparador y letrero ───────── */
export function WallStand() {
  const M = materials();
  const sign = useMemo(() => makeSignTexture(), []);
  const dot = useRef();
  useFrame(({ clock }) => { if (dot.current) dot.current.material.opacity = 0.75 + Math.sin(clock.elapsedTime * 3) * 0.25; });
  return (
    <group position={[0, 0, -10.6]}>
      <mesh position={[0, 3.6, -0.13]} material={M.graphite} castShadow><boxGeometry args={[11.9, 3.66, 0.2]} /></mesh>
      {[-4.7, 4.7].map((x) => <mesh key={x} position={[x, 1.2, -0.16]} material={M.graphite} castShadow><boxGeometry args={[0.34, 2.4, 0.26]} /></mesh>)}
      {/* aparador de roble con tapa blanca y luz por debajo */}
      <mesh position={[0, 0.36, 0.2]} material={M.oak} castShadow receiveShadow><boxGeometry args={[11.6, 0.6, 0.62]} /></mesh>
      <mesh position={[0, 0.68, 0.2]} material={M.white} castShadow><boxGeometry args={[11.8, 0.04, 0.7]} /></mesh>
      <mesh position={[0, 0.035, 0.2]} material={M.ledBlue}><boxGeometry args={[11.4, 0.03, 0.5]} /></mesh>
      {[-3.9, -1.3, 1.3, 3.9].map((x) => <mesh key={x} position={[x, 0.36, 0.512]} material={M.graphite}><boxGeometry args={[0.012, 0.6, 0.004]} /></mesh>)}
      {/* sobre el aparador: libros, una pieza de latón y dos plantas pequeñas */}
      {[[-4.6, '#0b1f4b'], [-4.52, '#e11d48'], [-4.45, '#f6f8fb'], [3.2, '#1d4ed8'], [3.28, '#f6f8fb']].map(([x, c], i) => (
        <mesh key={x} position={[x, 0.7 + 0.13, 0.22]} rotation={[0, 0, i === 2 || i === 4 ? -0.18 : 0]} castShadow><boxGeometry args={[0.06, 0.26, 0.2]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
      ))}
      <mesh position={[4.9, 0.7 + 0.16, 0.2]} material={M.brass} castShadow><octahedronGeometry args={[0.16, 0]} /></mesh>
      <mesh position={[4.9, 0.7 + 0.015, 0.2]} material={M.navy}><cylinderGeometry args={[0.1, 0.12, 0.03, 20]} /></mesh>
      {[-2.4, 1.2].map((x) => (
        <group key={x} position={[x, 0.7, 0.2]}>
          <mesh position={[0, 0.08, 0]} material={M.gloss} castShadow><cylinderGeometry args={[0.11, 0.085, 0.16, 20]} /></mesh>
          {[[0, 0.27, 0, 0.16], [0.09, 0.22, 0.04, 0.11], [-0.08, 0.23, -0.03, 0.12]].map(([px, py, pz, s], i) => (
            <mesh key={i} position={[px, py, pz]} scale={s} rotation={[i, i * 2, 0]} material={M.leaf[i % 3]} castShadow><icosahedronGeometry args={[1, 0]} /></mesh>
          ))}
        </group>
      ))}
      {/* letrero EN VIVO */}
      <group position={[-8.45, 4.25, -0.2]} rotation={[0, 0.66, 0]}>
        <mesh material={M.graphite} castShadow><boxGeometry args={[2.1, 0.56, 0.14]} /></mesh>
        <mesh ref={dot} position={[0, 0, 0.072]}><planeGeometry args={[2.0, 0.5]} /><meshBasicMaterial map={sign} transparent toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

/* ───────── racks de servidores ───────── */
function Racks({ at, offset }) {
  const M = materials();
  const { canvas, tex } = useMemo(() => {
    const c = newCanvas(128, 384);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, tex: t };
  }, []);
  const last = useRef(-9);
  const k = useRef(offset);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.7) return;
    last.current = clock.elapsedTime;
    k.current += 1;
    drawRack(canvas.getContext('2d'), 128, 384, k.current);
    tex.needsUpdate = true;
  });
  const [x, , z] = polar(at, R_WALL - 1.5);
  return (
    <group position={[x, 0, z]} rotation={[0, at * DEG + Math.PI, 0]}>
      {[-0.78, 0, 0.78].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 1.1, 0]} material={M.graphite} castShadow receiveShadow><boxGeometry args={[0.74, 2.2, 0.9]} /></mesh>
          <mesh position={[0, 1.12, 0.452]}><planeGeometry args={[0.6, 1.96]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
          <mesh position={[0, 1.12, 0.458]} material={M.glass}><planeGeometry args={[0.66, 2.04]} /></mesh>
          <mesh position={[0.345, 1.1, 0.455]} material={M.ledBlue}><boxGeometry args={[0.012, 2.0, 0.006]} /></mesh>
        </group>
      ))}
    </group>
  );
}

/* ───────── plantas ───────── */
function BigPlant({ at, r = R_WALL - 1.35, seed = 1, navy = false }) {
  const M = materials();
  const [x, , z] = polar(at, r);
  const blobs = useMemo(() => {
    const out = [];
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 9; i++) out.push({ p: [(rnd() - 0.5) * 0.95, 1.55 + rnd() * 0.95, (rnd() - 0.5) * 0.95], s: 0.34 + rnd() * 0.3, r: [rnd() * 3, rnd() * 3, 0], m: i % 3 });
    return out;
  }, [seed]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.34, 0]} material={navy ? M.navy : M.gloss} castShadow receiveShadow><cylinderGeometry args={[0.36, 0.27, 0.68, 32]} /></mesh>
      <mesh position={[0, 0.665, 0]} rotation={[-Math.PI / 2, 0, 0]} material={M.soil}><circleGeometry args={[0.33, 24]} /></mesh>
      <mesh position={[0, 1.2, 0]} material={M.trunk} castShadow><cylinderGeometry args={[0.035, 0.05, 1.1, 8]} /></mesh>
      {blobs.map((b, i) => (
        <mesh key={i} position={b.p} rotation={b.r} scale={b.s} material={M.leaf[b.m]} castShadow><icosahedronGeometry args={[1, 0]} /></mesh>
      ))}
    </group>
  );
}

/* ───────── cámara de estudio sobre pedestal ───────── */
function StudioCamera({ position, live }) {
  const M = materials();
  const tally = useRef();
  const yaw = Math.atan2(-position[0], 0.2 - position[2]);
  useFrame(({ clock }) => { if (tally.current && live) tally.current.material.opacity = 0.55 + Math.sin(clock.elapsedTime * 4) * 0.45; });
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.085, 0]} material={M.graphite} castShadow><cylinderGeometry args={[0.3, 0.36, 0.07, 40]} /></mesh>
      <mesh position={[0, 0.125, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.alu}><torusGeometry args={[0.3, 0.012, 8, 48]} /></mesh>
      {[0, 120, 240].map((d) => (
        <mesh key={d} position={[Math.sin(d * DEG) * 0.3, 0.04, Math.cos(d * DEG) * 0.3]} material={M.rubber}><sphereGeometry args={[0.04, 12, 10]} /></mesh>
      ))}
      <mesh position={[0, 0.42, 0]} material={M.graphite} castShadow><cylinderGeometry args={[0.085, 0.1, 0.72, 20]} /></mesh>
      <mesh position={[0, 1.04, 0]} material={M.alu} castShadow><cylinderGeometry args={[0.05, 0.05, 0.56, 16]} /></mesh>
      <mesh position={[0, 1.36, 0]} material={M.graphite} castShadow><boxGeometry args={[0.2, 0.1, 0.24]} /></mesh>
      <group position={[0, 1.58, 0]} rotation={[0.1, 0, 0]}>
        <mesh material={M.graphite} castShadow><boxGeometry args={[0.3, 0.3, 0.56]} /></mesh>
        <mesh position={[0, 0, 0.42]} rotation={[Math.PI / 2, 0, 0]} material={M.rubber} castShadow><cylinderGeometry args={[0.11, 0.1, 0.3, 24]} /></mesh>
        <mesh position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]} material={M.graphite}><cylinderGeometry args={[0.17, 0.12, 0.12, 4, 1, true]} /></mesh>
        <mesh position={[0, 0, 0.572]} material={M.lens}><circleGeometry args={[0.095, 24]} /></mesh>
        <mesh position={[0, 0.2, -0.02]} material={M.alu}><boxGeometry args={[0.04, 0.04, 0.36]} /></mesh>
        {/* visor del operador y luz de «al aire» */}
        <mesh position={[0.2, 0.08, -0.2]} rotation={[0, -0.5, 0]} material={M.graphite}><boxGeometry args={[0.2, 0.14, 0.02]} /></mesh>
        <mesh position={[0.196, 0.08, -0.212]} rotation={[0, Math.PI - 0.5, 0]}><planeGeometry args={[0.17, 0.11]} /><meshBasicMaterial color="#bfdbfe" toneMapped={false} /></mesh>
        <mesh ref={tally} position={[0, 0.175, 0.24]}><sphereGeometry args={[0.028, 12, 12]} /><meshBasicMaterial color={live ? '#f43f5e' : '#64748b'} transparent toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

/* ───────── bandera ───────── */
function Flag({ position }) {
  const M = materials();
  const tex = useMemo(() => makeFlagTexture(), []);
  const cloth = useRef();
  const base = useMemo(() => new THREE.PlaneGeometry(1.2, 0.8, 24, 10), []);
  useFrame(({ clock }) => {
    const p = cloth.current.geometry.attributes.position;
    const t = clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 0.6) / 1.2;          // 0 en el asta
      p.setZ(i, Math.sin(u * 7 - t * 1.1) * 0.05 * u + Math.sin(u * 3 + p.getY(i) * 4 - t * 0.7) * 0.03 * u);
    }
    p.needsUpdate = true;
    cloth.current.geometry.computeVertexNormals();
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} material={M.brass} castShadow><cylinderGeometry args={[0.2, 0.24, 0.06, 32]} /></mesh>
      <mesh position={[0, 1.5, 0]} material={M.brass} castShadow><cylinderGeometry args={[0.022, 0.022, 2.95, 12]} /></mesh>
      <mesh position={[0, 3.0, 0]} material={M.brass}><sphereGeometry args={[0.045, 16, 12]} /></mesh>
      <mesh ref={cloth} geometry={base} position={[0.62, 2.5, 0]} castShadow>
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ───────── techo: aros de luz y riel de focos ───────── */
function Ceiling() {
  const halo = useRef();
  useFrame(({ clock }) => { if (halo.current) halo.current.material.opacity = 0.6 + Math.sin(clock.elapsedTime * 0.9) * 0.15; });
  return (
    <group>
      <mesh ref={halo} position={[0, 7.0, 0.2]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.4, 0.05, 10, 128]} /><meshBasicMaterial color="#60a5fa" transparent toneMapped={false} /></mesh>
    </group>
  );
}

/** Todo lo que rodea a los puestos de trabajo. */
export function Surroundings({ live }) {
  return (
    <group>
      <Rotunda />
      <WallStand />
      <Ceiling />
      <Racks at={118} offset={3} />
      <Racks at={242} offset={40} />
      <BigPlant at={70} seed={14} navy />
      <BigPlant at={98} seed={2} />
      <BigPlant at={137} seed={5} navy />
      <BigPlant at={223} seed={8} navy />
      <BigPlant at={262} seed={11} />
      <BigPlant at={290} seed={17} navy />
      <Flag position={[-6.5, 0, -10.15]} />
      <StudioCamera position={[6.3, 0, 4.9]} live />
      <StudioCamera position={[-6.3, 0, 4.9]} live={live} />
    </group>
  );
}
