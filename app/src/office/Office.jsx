import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, PerformanceMonitor, useAnimations, useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { deskPose, lookOf, seatAgents } from '../lib/agents.js';
import { norm, partyColor, pct, plain, timeLima } from '../lib/format.js';
import { Desk, DESK_Y } from './Desk.jsx';
import { CommandTable, Floor, Lights, Surroundings } from './Set.jsx';
import { SCREEN } from './textures.js';

const ACCENT = '#2563eb';
const ALERT = '#dc2626';
const BG = '#eef2f7';
const ease = (delta, speed = 3) => 1 - Math.exp(-speed * delta);

/* ───────────────────────── personaje: robot animado (CC0, Tomás Laulhé / Quaternius) ───────────────────────── */

const ROBOT_URL = 'models/robot.glb';
const ROBOT_HEIGHT = 2.4;           // alto pedido al modelo (sale ~2.1 visibles: cabeza grande sobre el escritorio)
const OFF_COLOR = '#aab3c2';        // robot «apagado» (aún no entra a su turno)

function Robot({ color, estado, gesture, seed }) {
  const group = useRef();
  const { scene, animations } = useGLTF(ROBOT_URL, false, false);   // sin Draco ni Meshopt: nada de decodificadores externos ni WASM
  const awake = estado === 'activo' || estado === 'cumpliendo' || estado === 'atrasado';

  // copia independiente (con su propio esqueleto) y materiales propios para pintarla
  const { model, scale, heads } = useMemo(() => {
    const m = cloneSkinned(scene);
    const heads = [];
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      o.material.metalness = 0.08;
      o.material.roughness = 0.38;
      if (o.morphTargetDictionary && 'Sad' in o.morphTargetDictionary) heads.push(o);
    });
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y || 1;
    return { model: m, scale: ROBOT_HEIGHT / h, heads };
  }, [scene]);

  // color del agente; gris si está apagado
  useEffect(() => {
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'Main') o.material.color.set(awake ? color : OFF_COLOR);
      if (o.material.name === 'Grey') o.material.color.set(awake ? '#e2e8f0' : '#cfd6e0');
    });
  }, [model, color, awake]);

  const { actions } = useAnimations(animations, group);
  const current = useRef(null);
  const play = (name, { once = false, fade = 0.35 } = {}) => {
    const a = actions[name];
    if (!a) return;
    if (once) {
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
      a.setEffectiveWeight(1).fadeIn(fade).play();
      const back = setTimeout(() => { a.fadeOut(0.4); }, (a.getClip().duration - 0.4) * 1000);
      return () => clearTimeout(back);
    }
    if (current.current && current.current !== a) current.current.fadeOut(fade);
    a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    current.current = a;
  };

  // pose base según el estado
  useEffect(() => {
    play('Idle');
    const idle = actions.Idle;
    if (idle) idle.timeScale = awake ? 0.9 + (seed % 3) * 0.08 : 0;   // apagado: quieto
    if (idle && !awake) idle.time = 0.6;
  }, [actions, awake]); // eslint-disable-line react-hooks/exhaustive-deps

  // vida: el que está trabajando asiente de vez en cuando; el atrasado niega
  useEffect(() => {
    if (!awake) return;
    let t;
    const loop = () => {
      t = setTimeout(() => {
        if (estado === 'activo') play('Yes', { once: true });
        else if (estado === 'atrasado') play('No', { once: true });
        loop();
      }, 7000 + ((seed * 1373) % 6000));
    };
    loop();
    return () => clearTimeout(t);
  }, [awake, estado, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // gesto cuando publica o recibe un encargo
  useEffect(() => {
    if (!gesture || !awake) return;
    return play(gesture.name, { once: true });
  }, [gesture]); // eslint-disable-line react-hooks/exhaustive-deps

  // expresión: triste si se atrasa, sorprendido mientras saluda
  useFrame((_, delta) => {
    for (const h of heads) {
      const d = h.morphTargetDictionary, inf = h.morphTargetInfluences;
      const sadT = estado === 'atrasado' ? 1 : 0;
      const surT = gesture && Date.now() - gesture.at < 2200 ? 0.6 : 0;
      inf[d.Sad] += (sadT - inf[d.Sad]) * Math.min(1, delta * 4);
      if (d.Surprised !== undefined) inf[d.Surprised] += (surT - inf[d.Surprised]) * Math.min(1, delta * 4);
    }
  });

  return (
    <group ref={group} position={[0, 0, -0.52]} scale={scale}>
      <primitive object={model} />
    </group>
  );
}
useGLTF.preload(ROBOT_URL, false, false);

/* ───────────────────────── puesto de trabajo (escritorio alto) ───────────────────────── */

function Workstation({ agent, index, total, selected, onSelect, compact, latestMsg, focusMode, portal, likes = 0 }) {
  const pose = useMemo(() => deskPose(index, total), [index, total]);
  const look = lookOf(agent.agente, index);
  const ring = useRef();
  const late = agent.estado === 'atrasado';
  const on = agent.estado === 'activo' || agent.estado === 'cumpliendo';
  const awake = on || late;
  const tone = late ? ALERT : on ? look.color : '#94a3b8';
  const lead = agent.agente === 'Norma';

  // globo con el mensaje nuevo + gesto del robot
  const [bubble, setBubble] = useState(null);
  const [gesture, setGesture] = useState(null);
  const seen = useRef(null);
  useEffect(() => {
    if (!latestMsg) return;
    const fresh = Date.now() - Date.parse(latestMsg.ts) < 120000;
    if (seen.current === null && !fresh) { seen.current = latestMsg.ts; return; }
    if (seen.current === latestMsg.ts) return;
    seen.current = latestMsg.ts;
    setBubble(plain(latestMsg.texto, 110));
    setGesture({ name: latestMsg.tipo === 'recibe' ? 'Yes' : index % 2 ? 'ThumbsUp' : 'Wave', at: Date.now() });
    const t = setTimeout(() => setBubble(null), 9000);
    return () => clearTimeout(t);
  }, [latestMsg, index]);

  // cuando el público reacciona a un mensaje de este agente, sube un «+N ♥» junto a su cabeza
  const [pop, setPop] = useState(null);
  const prevLikes = useRef(null);
  useEffect(() => {
    const before = prevLikes.current;
    prevLikes.current = likes;
    if (before === null || likes <= before) return;
    setPop({ n: likes - before, k: Date.now() });
    const t = setTimeout(() => setPop(null), 1900);
    return () => clearTimeout(t);
  }, [likes]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + index;
    if (ring.current) {
      const p = agent.estado === 'activo' || late ? 1 + ((t * 0.7) % 1) * 0.35 : 1;
      ring.current.scale.setScalar(p);
      ring.current.material.opacity = agent.estado === 'activo' || late ? 0.9 - ((t * 0.7) % 1) * 0.8 : 0.45;
    }
  });

  return (
    <group position={[pose.x, 0, pose.z]} rotation={[0, pose.rotY, 0]}>
      {/* aro de estado en el piso */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -0.1]}>
        <ringGeometry args={[1.05, 1.12, 64]} />
        <meshBasicMaterial color={tone} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, -0.1]}>
        <circleGeometry args={[1.05, 48]} />
        <meshBasicMaterial color={tone} transparent opacity={0.08} depthWrite={false} />
      </mesh>

      <Suspense fallback={null}>
        <Robot color={look.color} estado={agent.estado} gesture={gesture} seed={index + 1} />
      </Suspense>

      <Desk agent={agent} index={index} color={look.color} tone={tone} on={on} late={late} kind={SCREEN[agent.agente]} lead={lead} />

      {/* etiqueta con nombre y puesto */}
      <Html portal={portal} position={[0, compact ? 2.95 : 2.8, -0.52]} center distanceFactor={focusMode ? 5.5 : compact ? 12 : 10} zIndexRange={[30, 0]}>
        <button className={`nametag ${selected ? 'is-selected' : ''} ${late ? 'is-late' : ''}`} onClick={(e) => { e.stopPropagation(); onSelect?.(agent.agente); }}>
          <b><i className="dot" style={{ background: late ? ALERT : on ? '#059669' : '#a3afc0' }} />{agent.agente}</b>
          <span>{agent.puesto}</span>
        </button>
      </Html>
      {/* globo con lo que acaba de publicar */}
      {bubble && (
        <Html portal={portal} position={[0.55, 2.25, -0.52]} distanceFactor={focusMode ? 5.5 : compact ? 12 : 10} zIndexRange={[40, 0]} style={{ transform: 'translateY(-50%)' }}>
          <div className="speech">{bubble}</div>
        </Html>
      )}
      {pop && (
        <Html portal={portal} position={[-0.75, 2.3, -0.52]} center distanceFactor={focusMode ? 5.5 : compact ? 12 : 10} zIndexRange={[45, 0]}>
          <div key={pop.k} className="like-pop">+{pop.n} ♥</div>
        </Html>
      )}
      {!awake && (
        <Html portal={portal} position={[0, DESK_Y + 0.25, 0.1]} center distanceFactor={focusMode ? 5 : 7.5} zIndexRange={[20, 0]}>
          <div className="holo-sign">{agent.estado === 'programado' ? `Entra ${agent.inicio}` : 'Fuera de turno'}</div>
        </Html>
      )}
    </group>
  );
}

/* ───────────────────────── holograma del Perú ───────────────────────── */

const S = 0.34; // escala grados → unidades
function project([lon, lat]) { return new THREE.Vector2((lon + 75.0) * S, (lat + 9.3) * S); }

function HoloMap({ geo, latest, election, anomalyDeps }) {
  const group = useRef();
  const scan = useRef();
  const regions = useMemo(() => {
    if (!geo) return [];
    return geo.features.filter((f) => !/titicaca/i.test(f.properties.name)).map((f) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const shapes = polys.map((rings) => {
        const shape = new THREE.Shape(rings[0].map(project));
        rings.slice(1).forEach((h) => shape.holes.push(new THREE.Path(h.map(project))));
        return shape;
      });
      const geom = new THREE.ExtrudeGeometry(shapes, { depth: 0.07, bevelEnabled: false });
      const edges = new THREE.EdgesGeometry(geom, 20);
      geom.computeBoundingBox();
      const c = new THREE.Vector3(); geom.boundingBox.getCenter(c);
      return { name: f.properties.name, key: norm(f.properties.name), geom, edges, center: c };
    });
  }, [geo]);

  const fills = useMemo(() => {
    const byName = {};
    const el = latest?.elecciones?.find((e) => e.id === election) || latest?.elecciones?.[0];
    for (const d of el?.departamentos || []) byName[norm(d.nombre)] = d;
    return Object.fromEntries(regions.map((r) => {
      const d = byName[r.key];
      const lead = d?.participantes?.find((p) => p.votos && !p.especial && !/BLANCO|NULO|IMPUGNAD/i.test(p.partido || ''));
      return [r.key, lead ? partyColor(lead.codPartido, lead.partido) : null];
    }));
  }, [regions, latest, election]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) group.current.position.y = 1.32 + Math.sin(t * 0.8) * 0.04;
    if (scan.current) {
      const k = (t * 0.18) % 1;
      scan.current.position.z = 3.2 - k * 6.6;
      scan.current.material.opacity = 0.18 * Math.sin(k * Math.PI);
    }
  });

  return (
    <group>
      <group ref={group} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.32, 0.2]}>
        {regions.map((r) => {
          const col = fills[r.key] || ACCENT;
          const alert = anomalyDeps?.has(r.key);
          return (
            <group key={r.name}>
              <mesh geometry={r.geom}>
                <meshBasicMaterial color={alert ? ALERT : fills[r.key] ? col : '#93c5fd'} transparent opacity={fills[r.key] ? 0.7 : 0.38} depthWrite={false} toneMapped={false} />
              </mesh>
              <lineSegments geometry={r.edges}>
                <lineBasicMaterial color={alert ? ALERT : '#1e3a8a'} transparent opacity={0.75} toneMapped={false} />
              </lineSegments>
              {alert && <Ripple position={[r.center.x, r.center.y, 0.1]} />}
            </group>
          );
        })}
      </group>
      {/* barrido de escaneo */}
      <mesh ref={scan} position={[0, 1.36, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.6, 0.06]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.15} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* cono de luz de la mesa al mapa */}
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[3.0, 2.6, 0.5, 48, 1, true]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Ripple({ position }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const k = (clock.elapsedTime * 0.6) % 1;
    if (ref.current) { ref.current.scale.setScalar(0.2 + k * 1.4); ref.current.material.opacity = 0.9 * (1 - k); }
  });
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[0.18, 0.22, 32]} />
      <meshBasicMaterial color={ALERT} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/* ───────────────────────── pared de video ───────────────────────── */

function drawWall(g, w, h, info) {
  g.clearRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#08121a'); grd.addColorStop(1, '#04080d');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(34,211,238,0.08)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = 'rgba(34,211,238,0.9)'; g.font = '600 30px "Geist Mono", monospace';
  g.fillText('AUDITORA INDEPENDIENTE AUTOMATIZADA DE PROCESOS ELECTORALES · ERM 2026', 56, 70);
  g.fillStyle = info.statusColor; g.font = '800 92px Archivo, sans-serif';
  g.fillText(info.status, 56, 200);
  g.fillStyle = '#aab6c6'; g.font = '500 34px Archivo, sans-serif';
  g.fillText(info.sub, 58, 258);
  // KPIs
  info.kpis.forEach(([label, value], i) => {
    const x = 56 + i * 470;
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 320, 440, 170);
    g.fillStyle = '#6f7d91'; g.font = '600 24px "Geist Mono", monospace'; g.fillText(label.toUpperCase(), x + 24, 366);
    g.fillStyle = '#e8eef6'; g.font = '700 74px "Geist Mono", monospace'; g.fillText(value, x + 22, 452);
  });
  g.fillStyle = '#e8eef6'; g.font = '700 58px "Geist Mono", monospace';
  const clock = info.clock;
  g.fillText(clock, w - 56 - g.measureText(clock).width, 92);
  g.fillStyle = '#6f7d91'; g.font = '600 22px "Geist Mono", monospace';
  g.fillText('HORA DE LIMA', w - 56 - g.measureText('HORA DE LIMA').width, 124);
  g.fillStyle = 'rgba(255,45,85,0.95)'; g.beginPath(); g.arc(w - 300, 186, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8eef6'; g.font = '700 30px "Geist Mono", monospace'; g.fillText('CAM-01 [EN VIVO]', w - 276, 197);
}

function VideoWall({ info }) {
  const canvas = useMemo(() => { const c = document.createElement('canvas'); c.width = 2048; c.height = 560; return c; }, []);
  const tex = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }, [canvas]);
  const last = useRef(0);
  const infoRef = useRef(info);
  infoRef.current = info;
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return;
    last.current = clock.elapsedTime;
    drawWall(canvas.getContext('2d'), canvas.width, canvas.height, { ...infoRef.current, clock: timeLima(Date.now(), { seconds: true }) });
    tex.needsUpdate = true;
  });
  return (
    <group position={[0, 3.6, -10.6]}>
      <mesh><planeGeometry args={[11.5, 3.14]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      <mesh position={[0, -1.86, 0]}><boxGeometry args={[11.9, 0.03, 0.03]} /><meshBasicMaterial color={ACCENT} toneMapped={false} /></mesh>
    </group>
  );
}

/* ───────────────────────── paquetes de datos entre escritorios ───────────────────────── */

function Packets({ feed, poses }) {
  const [packets, setPackets] = useState([]);
  const lastTs = useRef(null);
  useEffect(() => {
    const items = feed?.items || [];
    if (!items.length) return;
    if (lastTs.current) {
      const fresh = items.filter((x) => x.ts > lastTs.current).slice(0, 8);
      const now = performance.now();
      const add = fresh.map((x, i) => {
        const from = x.tipo === 'recibe' ? poses.Norma : poses[x.agente];
        const to = x.tipo === 'recibe' ? poses[x.agente] : { x: 0, z: 0.2, center: true };
        if (!from || !to) return null;
        return { id: `${x.ts}-${i}-${Math.random()}`, from, to, color: x.color, start: now + i * 450 };
      }).filter(Boolean);
      if (add.length) setPackets((p) => [...p, ...add]);
    }
    lastTs.current = items[0].ts;
  }, [feed, poses]);
  return packets.map((p) => <Packet key={p.id} p={p} onDone={() => setPackets((ps) => ps.filter((q) => q.id !== p.id))} />);
}

function Packet({ p, onDone }) {
  const ref = useRef();
  const curve = useMemo(() => {
    const a = new THREE.Vector3(p.from.x, 1.5, p.from.z);
    const b = new THREE.Vector3(p.to.x, p.to.center ? 1.7 : 1.5, p.to.z);
    const mid = a.clone().lerp(b, 0.5); mid.y += 2.2;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }, [p]);
  useFrame(() => {
    const k = (performance.now() - p.start) / 1700;
    if (!ref.current) return;
    ref.current.visible = k >= 0;
    if (k >= 1) { onDone(); return; }
    if (k >= 0) ref.current.position.copy(curve.getPoint(k));
  });
  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[0.075, 12, 12]} />
      <meshBasicMaterial color={p.color || ACCENT} toneMapped={false} />
    </mesh>
  );
}

/* ───────────────────────── cámara ───────────────────────── */

const HOME = { pos: new THREE.Vector3(0, 8.4, 13.6), target: new THREE.Vector3(0, 1.1, -1.8) };

function CameraRig({ focus, autoRotate }) {
  const { camera } = useThree();
  if (import.meta.env.DEV) window.__cam = camera;
  const controls = useRef();
  const returning = useRef(false);
  const prevFocus = useRef(null);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (focus) {
      const dir = new THREE.Vector3(-focus.x, 0, -focus.z).normalize();   // del escritorio hacia el centro
      const target = new THREE.Vector3(focus.x, 1.55, focus.z);
      const pos = target.clone().add(dir.multiplyScalar(5.6)).add(new THREE.Vector3(0, 1.6, 0));
      camera.position.lerp(pos, ease(delta, 2.6));
      c.target.lerp(target, ease(delta, 2.6));
      c.enabled = false;
      c.autoRotate = false;
      prevFocus.current = focus;
    } else {
      if (prevFocus.current) { returning.current = true; prevFocus.current = null; }
      if (returning.current) {
        camera.position.lerp(HOME.pos, ease(delta, 2.2));
        c.target.lerp(HOME.target, ease(delta, 2.2));
        if (camera.position.distanceTo(HOME.pos) < 0.08) returning.current = false;
      }
      c.enabled = !returning.current;
      c.autoRotate = autoRotate && !returning.current;
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={HOME.target.toArray()}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={7}
      maxDistance={24}
      minPolarAngle={0.45}
      maxPolarAngle={1.3}
      minAzimuthAngle={-1.75}
      maxAzimuthAngle={1.75}
      autoRotateSpeed={0.35}
    />
  );
}

/* ───────────────────────── escena completa ───────────────────────── */

function Scene({ agents, feed, latest, election, status, actas, geo, selected, onSelect, autoRotate, lowPower, anomalyDeps, compact, portal, likesBy }) {
  const seatedList = useMemo(() => seatAgents(agents), [agents]);
  const poses = useMemo(() => Object.fromEntries(seatedList.map((a, i) => [a.agente, deskPose(i, seatedList.length)])), [seatedList]);
  const feedColored = useMemo(() => feed && { ...feed, items: (feed.items || []).map((x) => ({ ...x, color: lookOf(x.agente).color })) }, [feed]);
  const focus = selected ? poses[selected] : null;
  const latestBy = useMemo(() => { const o = {}; for (const x of feed?.items || []) if (!o[x.agente]) o[x.agente] = x; return o; }, [feed]);

  const live = status?.estado === 'en-vivo';
  const el = latest?.elecciones?.find((e) => e.id === election) || latest?.elecciones?.[0];
  const working = seatedList.filter((a) => a.estado === 'activo' || a.estado === 'cumpliendo').length;
  const wallInfo = {
    status: live ? 'RESULTADOS OFICIALES EN VIVO' : status?.estado === 'bloqueado' ? 'ONPE NO RESPONDE' : 'ESPERANDO A LA ONPE',
    statusColor: live ? '#34d399' : status?.estado === 'bloqueado' ? '#fb3b5c' : '#fbbf24',
    sub: live ? `${el?.menu || el?.nombre || ''} · corte oficial ${timeLima(el?.totales?.fechaActualizacion)}` : 'El portal aún no publica resultados. Aquí no se muestran estimaciones.',
    kpis: [
      ['Actas contadas', live ? pct(el?.totales?.actasContabilizadas, 1) : '—'],
      ['Actas revisadas', actas?.actasLeidas ? String(actas.actasLeidas) : '0'],
      ['Agentes activos', `${working}/${seatedList.length}`],
      ['Observaciones', String((actas?.avisos?.alerta ?? 0) + (actas?.avisos?.revisar ?? 0))],
    ],
  };

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 26, 60]} />
      <fog attach="fog" args={[BG, 34, 80]} />
      <Lights lowPower={lowPower} />
      <Floor lowPower={lowPower} />
      <Surroundings live={live} />

      <CommandTable />
      <HoloMap geo={geo} latest={latest} election={el?.id} anomalyDeps={anomalyDeps} />
      <VideoWall info={wallInfo} />

      {seatedList.map((a, i) => (
        <Workstation key={a.agente} agent={a} index={i} total={seatedList.length} selected={selected === a.agente} onSelect={onSelect} compact={compact} latestMsg={latestBy[a.agente]} focusMode={!!selected} portal={portal} likes={likesBy?.[a.agente] || 0} />
      ))}
      <Packets feed={feedColored} poses={poses} />
      <CameraRig focus={focus} autoRotate={autoRotate} />

    </>
  );
}

export default function Office(props) {
  const [geo, setGeo] = useState(null);
  const weak = useMemo(() => typeof window !== 'undefined' && (matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4), []);
  // Si el equipo no puede con la escena completa (menos de ~22 cuadros por segundo), se apagan solos
  // los reflejos del piso y las sombras. No vuelve a encenderlos: así no parpadea.
  const [slow, setSlow] = useState(false);
  const lowPower = weak || slow;
  useEffect(() => { fetch('geo/peru.json').then((r) => r.json()).then(setGeo).catch(() => {}); }, []);
  // Las etiquetas HTML (nombres, carteles, globos) van en una capa propia y estable sobre el canvas.
  // Sin esto, drei cambia de contenedor al conectar los eventos y la primera etiqueta queda vacía.
  const overlay = useRef(null);
  return (
    <>
    <Canvas
      shadows={!lowPower}
      dpr={lowPower ? [1, 1.25] : [1, 1.75]}
      camera={{ position: HOME.pos.toArray(), fov: props.fov || 38, near: 0.1, far: 120 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => props.onSelect?.(null)}
      style={{ position: 'absolute', inset: 0 }}
    >
      {!weak && <PerformanceMonitor bounds={() => [22, 60]} flipflops={1} onDecline={() => setSlow(true)} />}
      <Suspense fallback={null}>
        <Scene {...props} geo={geo} lowPower={lowPower} portal={overlay} />
      </Suspense>
    </Canvas>
    <div ref={overlay} className="office-overlay" />
    </>
  );
}
