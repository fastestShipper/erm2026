// Texturas hechas por código (nada se descarga): piso de piedra, madera, teclado, pantallas, racks y bandera.
import * as THREE from 'three';

const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// Navegadores sin roundRect (algunos celulares antiguos): rectángulo recto en su lugar.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h) { this.rect(x, y, w, h); };
}

/** Generador determinista: el piso y la madera salen iguales en cada visita. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(c, { repeat, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/* ───────── piso: piedra clara en losas grandes, con veta suave y junta fina ───────── */
export function makeFloorTexture(repeat) {
  const S = 2048, N = 2, T = S / N;           // 2 × 2 losas por textura
  const c = canvasOf(S, S);
  const g = c.getContext('2d');
  const r = rng(20261004);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = i * T, y = j * T;
    g.save();
    g.beginPath(); g.rect(x, y, T, T); g.clip();
    const l = 84 + (r() - 0.5) * 3;       // cada losa, un tono apenas distinto
    g.fillStyle = `hsl(216 16% ${l}%)`;
    g.fillRect(x, y, T, T);
    // nubes suaves
    for (let k = 0; k < 9; k++) {
      const cx = x + r() * T, cy = y + r() * T, rad = 120 + r() * 380;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const a = 0.05 + r() * 0.06;
      grd.addColorStop(0, r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(150,160,180,${a})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(x, y, T, T);
    }
    // vetas finas, como mármol claro
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      let px = x + r() * T, py = y - 40;
      g.moveTo(px, py);
      const drift = (r() - 0.5) * 1.6;
      while (py < y + T + 40) {
        const nx = px + (drift + (r() - 0.5) * 1.4) * 120, ny = py + 90 + r() * 120;
        g.quadraticCurveTo(px + (r() - 0.5) * 90, (py + ny) / 2, nx, ny);
        px = nx; py = ny;
      }
      g.strokeStyle = `rgba(118,128,150,${0.05 + r() * 0.08})`;
      g.lineWidth = 0.8 + r() * 2.6;
      g.stroke();
    }
    // grano
    for (let k = 0; k < 2600; k++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '70,80,100' : '255,255,255'},${0.03 + r() * 0.05})`;
      g.fillRect(x + r() * T, y + r() * T, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    g.restore();
  }
  // juntas
  g.fillStyle = '#aeb7c6';
  for (let i = 0; i <= N; i++) { g.fillRect(i * T - 2, 0, 4, S); g.fillRect(0, i * T - 2, S, 4); }
  return finish(c, { repeat, aniso: 16 });
}

/* ───────── madera: roble claro con veta a lo largo ───────── */
export function makeWoodTexture() {
  const W = 256, H = 1024;
  const c = canvasOf(W, H);
  const g = c.getContext('2d');
  const r = rng(77);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#c9a57a'); grd.addColorStop(0.5, '#d4b48b'); grd.addColorStop(1, '#c39d70');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 150; i++) {
    let x = r() * W;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= H; y += 64) { x += (r() - 0.5) * 5; g.lineTo(x, y); }
    g.strokeStyle = `rgba(${r() < 0.7 ? '120,82,44' : '255,236,205'},${0.05 + r() * 0.12})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.stroke();
  }
  return finish(c);
}

/* ───────── teclado ───────── */
export function makeKeyboardTexture() {
  const W = 512, H = 160;
  const c = canvasOf(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#dfe4ec'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fbfcfe';
  const rows = [14, 14, 13, 12];
  rows.forEach((n, j) => {
    const kw = (W - 24 - (n - 1) * 5) / n;
    for (let i = 0; i < n; i++) { g.beginPath(); g.roundRect(12 + i * (kw + 5), 10 + j * 30, kw, 24, 4); g.fill(); }
  });
  [[12, 60], [78, 60], [144, 220], [370, 60], [436, 64]].forEach(([x, w]) => { g.beginPath(); g.roundRect(x, 130, w, 22, 4); g.fill(); });
  return finish(c);
}

/* ───────── pantallas: cada agente ve en la suya lo que hace ───────── */
export const SCREEN = {
  Luchito: 'datos', 'Toño': 'actas', Rosita: 'verifica', Kike: 'desinfo', Norma: 'coord',
  Maritza: 'redes', Jorge: 'medios', Charo: 'tablero', 'Don Pepe': 'cronista', Beto: 'poste',
};
const NAVY = '11,31,75';

export function drawScreen(g, W, H, kind, k, color) {
  const box = (x, y, w, h, rad = 5) => { g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); };
  const ink = (a) => { g.fillStyle = `rgba(${NAVY},${a})`; };
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.8)'; box(0, 0, W, H, 16);
  // barra de la ventana
  g.fillStyle = color; g.beginPath(); g.arc(22, 21, 6.5, 0, 7); g.fill();
  ink(0.75); box(38, 15, 128, 12, 6);
  ink(0.16); box(W - 150, 15, 58, 12, 6); box(W - 82, 15, 58, 12, 6);
  ink(0.1); g.fillRect(0, 40, W, 2);
  const L = 18, T = 54, R = W - 18, B = H - 16;

  if (kind === 'datos') {                       // cifra grande, barras y curva
    ink(0.8); box(L, T, 150, 46, 8);
    ink(0.2); box(L, T + 56, 110, 10); box(L, T + 74, 86, 10);
    for (let i = 0; i < 9; i++) {
      const h = 34 + ((Math.sin(i * 1.7 + k * 0.6) + 1) / 2) * 96;
      g.fillStyle = i === k % 9 ? color : `rgba(${NAVY},0.32)`;
      box(L + 190 + i * 31, B - h, 21, h, 4);
    }
    g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 10; i++) { const y = B - 40 - i * 7 - Math.sin(i + k * 0.4) * 9; if (i) g.lineTo(L + i * 15, y); else g.moveTo(L, y); }
    g.stroke();
  } else if (kind === 'actas') {                // tabla de mesas con su revisión
    for (let j = 0; j < 7; j++) {
      const y = T + j * 32, cur = j === k % 7;
      if (cur) { g.fillStyle = `${color}22`; box(L - 6, y - 4, R - L + 12, 28, 6); }
      ink(0.7); box(L, y + 4, 62, 12);
      ink(0.24); box(L + 84, y + 4, 70, 12); box(L + 170, y + 4, 70, 12); box(L + 256, y + 4, 70, 12);
      g.fillStyle = (j * 7 + 3) % 5 === 0 ? '#d97706' : '#059669';
      g.beginPath(); g.arc(R - 20, y + 10, 8, 0, 7); g.fill();
    }
  } else if (kind === 'verifica') {             // lista de afirmaciones con veredicto
    const mark = ['#059669', '#dc2626', '#059669', '#d97706', '#059669'];
    for (let j = 0; j < 5; j++) {
      const y = T + j * 46;
      g.fillStyle = j === k % 5 ? `rgba(${NAVY},0.25)` : mark[j];
      g.beginPath(); g.arc(L + 16, y + 18, 14, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 3.2; g.beginPath();
      if (j === k % 5) g.arc(L + 16, y + 18, 7, k, k + 4);
      else if (mark[j] === '#dc2626') { g.moveTo(L + 10, y + 12); g.lineTo(L + 22, y + 24); g.moveTo(L + 22, y + 12); g.lineTo(L + 10, y + 24); }
      else { g.moveTo(L + 9, y + 18); g.lineTo(L + 14, y + 24); g.lineTo(L + 23, y + 12); }
      g.stroke();
      ink(0.6); box(L + 44, y + 7, 250 + (j % 3) * 50, 11);
      ink(0.22); box(L + 44, y + 25, 180 + (j % 2) * 90, 9);
    }
  } else if (kind === 'desinfo') {              // piezas virales, las falsas con sello
    for (let i = 0; i < 3; i++) {
      const x = L + i * 162;
      ink(0.12); box(x, T, 148, 110, 8);
      ink(0.25); g.beginPath(); g.moveTo(x + 14, T + 96); g.lineTo(x + 56, T + 46); g.lineTo(x + 86, T + 78); g.lineTo(x + 108, T + 58); g.lineTo(x + 134, T + 96); g.fill();
      if (i !== k % 3) {
        g.save(); g.translate(x + 74, T + 55); g.rotate(-0.35);
        g.fillStyle = 'rgba(220,38,38,0.9)'; box(-62, -13, 124, 26, 5);
        g.fillStyle = '#fff'; box(-44, -4, 88, 8, 4);
        g.restore();
      }
      ink(0.5); box(x, T + 122, 120, 10);
      ink(0.2); box(x, T + 140, 90, 9);
    }
    ink(0.2); box(L, B - 34, R - L, 9); box(L, B - 18, (R - L) * 0.7, 9);
  } else if (kind === 'coord') {                // tablero de tareas del equipo
    for (let i = 0; i < 3; i++) {
      const x = L + i * 162;
      ink(0.55); box(x, T, 90, 11);
      for (let j = 0; j < 3 + (i === 1 ? 1 : 0); j++) {
        const y = T + 24 + j * 50, hot = (i * 3 + j) === k % 10;
        g.fillStyle = hot ? color : 'rgba(255,255,255,0.95)';
        box(x, y, 148, 42, 8);
        g.fillStyle = hot ? 'rgba(255,255,255,0.9)' : `rgba(${NAVY},0.5)`; box(x + 10, y + 10, 100, 8, 4);
        g.fillStyle = hot ? 'rgba(255,255,255,0.6)' : `rgba(${NAVY},0.2)`; box(x + 10, y + 25, 70, 7, 3);
      }
    }
  } else if (kind === 'redes') {                // publicaciones de cuentas oficiales
    const off = (k % 4) * 18;
    g.save(); g.beginPath(); g.rect(0, 44, W, H - 44); g.clip();
    for (let j = 0; j < 5; j++) {
      const y = T + j * 68 - off;
      g.fillStyle = j % 2 ? color : `rgba(${NAVY},0.7)`;
      g.beginPath(); g.arc(L + 20, y + 20, 18, 0, 7); g.fill();
      ink(0.65); box(L + 50, y + 4, 150, 11);
      ink(0.25); box(L + 50, y + 23, R - L - 70, 9); box(L + 50, y + 39, (R - L - 70) * (0.5 + (j % 3) * 0.2), 9);
    }
    g.restore();
  } else if (kind === 'medios') {               // canales y radios en directo
    for (let i = 0; i < 4; i++) {
      const x = L + (i % 2) * 242, y = T + Math.floor(i / 2) * 92;
      g.fillStyle = 'rgba(11,31,75,0.85)'; box(x, y, 228, 80, 8);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(x + 104, y + 26); g.lineTo(x + 104, y + 54); g.lineTo(x + 128, y + 40); g.fill();
      if (i === k % 4) { g.fillStyle = '#e11d48'; g.beginPath(); g.arc(x + 16, y + 16, 6, 0, 7); g.fill(); }
    }
    for (let i = 0; i < 40; i++) { const h = 4 + Math.abs(Math.sin(i * 0.9 + k)) * 18; g.fillStyle = color; g.fillRect(L + i * 12, B - 12 - h / 2, 6, h); }
  } else if (kind === 'tablero') {              // el propio tablero, en miniatura
    ink(0.14); box(L, T, 300, 150, 8);
    g.fillStyle = color; box(L + 12, T + 118, 150, 20, 5);
    for (let j = 0; j < 6; j++) { ink(j === k % 6 ? 0.6 : 0.22); box(L + 316, T + j * 26, R - L - 316, 16, 5); }
    for (let i = 0; i < 4; i++) { ink(0.75); box(L + i * 78, B - 38, 66, 34, 7); }
  } else if (kind === 'cronista') {             // bitácora: hora y qué pasó
    for (let j = 0; j < 8; j++) {
      const y = T + j * 28;
      g.fillStyle = color; box(L, y + 2, 46, 12, 4);
      ink(j % 3 === 0 ? 0.6 : 0.25); box(L + 60, y + 2, 180 + ((j * 53) % 200), 11);
    }
    if (k % 2) { ink(0.8); g.fillRect(L + 60 + 180 + ((7 * 53) % 200) + 6, T + 7 * 28, 3, 15); }
  } else if (kind === 'poste') {                // diseño del resumen de cada hora
    ink(0.1); box(L, T, 320, B - T, 8);
    g.fillStyle = '#fff'; box(L + 40, T + 14, 240, B - T - 28, 6);
    g.fillStyle = color; box(L + 56, T + 30, 208, 66, 5);
    ink(0.7); box(L + 56, T + 108, 150, 13);
    ink(0.25); box(L + 56, T + 130, 200, 9); box(L + 56, T + 146, 160, 9);
    ['#0b1f4b', '#e11d48', color, '#059669', '#d97706'].forEach((col, i) => { g.fillStyle = col; box(L + 340, T + i * 34, 28, 26, 6); if (i === k % 5) { g.strokeStyle = `rgba(${NAVY},0.8)`; g.lineWidth = 3; g.beginPath(); g.roundRect(L + 337, T + i * 34 - 3, 34, 32, 8); g.stroke(); } });
    for (let j = 0; j < 5; j++) { ink(0.22); box(L + 386, T + j * 34 + 6, R - L - 386, 12); }
  } else {                                      // por defecto: líneas de código
    const r = rng(k + 3);
    for (let y = T; y < B; y += 18) {
      let x = L + (Math.floor(r() * 3)) * 16;
      while (x < R - 30) { const w = 14 + r() * 70; g.fillStyle = r() < 0.2 ? color : `rgba(${NAVY},${0.2 + r() * 0.4})`; box(x, y, Math.min(w, R - x), 9, 4); x += w + 8; if (r() < 0.2) break; }
    }
  }
}

/* ───────── racks de servidores: filas de luces que parpadean ───────── */
export function drawRack(g, W, H, k) {
  const r = rng(k * 31 + 5);
  g.fillStyle = '#0d131d'; g.fillRect(0, 0, W, H);
  const rows = 22, rh = H / rows;
  for (let j = 0; j < rows; j++) {
    g.fillStyle = '#1b2433'; g.fillRect(6, j * rh + 2, W - 12, rh - 4);
    g.fillStyle = '#2a3649'; g.fillRect(10, j * rh + rh / 2 - 1, W * 0.42, 2);
    for (let i = 0; i < 7; i++) {
      const on = r() < 0.72;
      g.fillStyle = !on ? '#223046' : r() < 0.72 ? '#34d399' : r() < 0.6 ? '#60a5fa' : '#fbbf24';
      g.fillRect(W * 0.56 + i * 7, j * rh + rh / 2 - 2, 4, 4);
    }
  }
}

/* ───────── bandera del Perú ───────── */
export function makeFlagTexture() {
  const c = canvasOf(300, 200);
  const g = c.getContext('2d');
  g.fillStyle = '#d91023'; g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#ffffff'; g.fillRect(100, 0, 100, 200);
  return finish(c);
}

/* ───────── letrero EN VIVO ───────── */
export function makeSignTexture() {
  const c = canvasOf(512, 128);
  const draw = () => {
    const g = c.getContext('2d');
    g.fillStyle = '#e11d48'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(92, 64, 20, 0, 7); g.fill();
    g.font = '800 76px Archivo, system-ui, sans-serif'; g.textBaseline = 'middle';
    g.fillText('EN VIVO', 136, 68);
  };
  draw();
  const t = finish(c);
  document.fonts?.ready?.then(() => { draw(); t.needsUpdate = true; });   // con la tipografía ya cargada
  return t;
}

export const newCanvas = canvasOf;
