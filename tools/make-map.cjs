// Genera app/public/geo/peru.json a partir de geoBoundaries (gbOpen PER ADM1, dominio público).
//   node tools/make-map.cjs <geoBoundaries-PER-ADM1_simplified.geojson> [tolerancia en grados]
// Simplifica respetando los bordes compartidos: cada tramo entre dos nudos se simplifica una sola vez,
// así dos regiones vecinas quedan con exactamente el mismo borde (sin huecos ni traslapes).
const fs = require('fs');
const path = require('path');
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const TOL = +(process.argv[3] || 0.02);
const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

// anillos de todas las regiones (sin el punto de cierre repetido)
const rings = [];
for (const f of src.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  polys.forEach((poly, pi) => poly.forEach((ring, ri) => {
    const pts = ring.slice(0, -1);
    if (pts.length >= 3) rings.push({ f, pi, ri, pts });
  }));
}
// vecinos de cada vértice: si tiene más de dos, es un nudo (ahí se juntan tres regiones o empieza la costa)
const nb = new Map();
for (const r of rings) {
  const n = r.pts.length;
  r.pts.forEach((p, i) => {
    const k = key(p);
    if (!nb.has(k)) nb.set(k, new Set());
    nb.get(k).add(key(r.pts[(i + n - 1) % n]));
    nb.get(k).add(key(r.pts[(i + 1) % n]));
  });
}
const isNode = (p) => nb.get(key(p)).size > 2;

function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d > wd) { wd = d; worst = i; }
    }
    if (wd > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// un tramo se simplifica siempre en el mismo sentido (del extremo «menor» al «mayor») para que el
// resultado sea idéntico visto desde cualquiera de las dos regiones que lo comparten
function arc(pts) {
  const a = key(pts[0]), b = key(pts[pts.length - 1]);
  const flip = a > b || (a === b && key(pts[1]) > key(pts[pts.length - 2]));
  const s = dp(flip ? pts.slice().reverse() : pts, TOL);
  return flip ? s.reverse() : s;
}

const out = new Map();
let before = 0, after = 0;
for (const r of rings) {
  const n = r.pts.length;
  before += n;
  const nodes = r.pts.map((p, i) => (isNode(p) ? i : -1)).filter((i) => i >= 0);
  let ring;
  if (nodes.length < 2) {
    const s = dp([...r.pts, r.pts[0]], TOL);          // isla o anillo sin vecinos
    ring = s.slice(0, -1);
  } else {
    ring = [];
    for (let j = 0; j < nodes.length; j++) {
      const a = nodes[j], b = nodes[(j + 1) % nodes.length];
      const seg = [];
      for (let i = a; ; i = (i + 1) % n) { seg.push(r.pts[i]); if (i === b && seg.length > 1) break; }
      ring.push(...arc(seg).slice(0, -1));
    }
  }
  if (ring.length < 3) continue;                         // islote que desaparece a esta escala
  after += ring.length;
  const closed = [...ring, ring[0]].map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
  const k = r.f.properties.shapeISO;
  if (!out.has(k)) out.set(k, { f: r.f, polys: new Map() });
  const polys = out.get(k).polys;
  if (!polys.has(r.pi)) polys.set(r.pi, []);
  polys.get(r.pi)[r.ri] = closed;
}

const NAMES = { 'Municipalidad Metropolitana de Lima': 'Lima Metropolitana', 'El Callao': 'Callao' };
const features = [...out.values()].map(({ f, polys }) => {
  const list = [...polys.values()].map((p) => p.filter(Boolean)).filter((p) => p.length);
  const name = NAMES[f.properties.shapeName] || f.properties.shapeName;
  return {
    type: 'Feature',
    properties: { id: f.properties.shapeISO.replace('*', ''), name },
    geometry: list.length === 1 ? { type: 'Polygon', coordinates: list[0] } : { type: 'MultiPolygon', coordinates: list },
  };
}).sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const dest = path.join(__dirname, '..', 'app', 'public', 'geo', 'peru.json');
const body = JSON.stringify({
  type: 'FeatureCollection',
  fuente: 'geoBoundaries gbOpen PER ADM1 (dominio público; origen: Wikimedia Commons). Simplificado para este sitio.',
  features,
});
fs.writeFileSync(dest, body);
console.log(`${features.length} regiones · ${before} → ${after} puntos · ${(body.length / 1024).toFixed(1)} KB → ${dest}`);
