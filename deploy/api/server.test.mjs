// Pruebas de la API (node --test). Levantan el servidor en un puerto al azar contra datos de prueba.
// Los datos originales NO se tocan: si una prueba necesita cambiarlos, trabaja sobre una copia en un directorio temporal.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crearServidor } from './server.mjs';

const DATA = process.env.FIXTURE_DATA_DIR || 'W:/dev0x/erm2026/local/testroot/data';
const MESAS = process.env.FIXTURE_MESAS_DIR || path.join(DATA, 'actas', 'mesas');
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const T0 = Date.parse('2026-10-04T05:30:00-05:00');   // 6 min después de la mesa de prueba (05:23:43)
const MIN = 60e3, HORA = 60 * MIN;

/* ───────── ayudas ───────── */
const temporales = [];
const tmp = (pref) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), pref)); temporales.push(d); return d; };
after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

const leerJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
let n_mtime = 0;
function reescribir(archivo, contenido) {            // escribe y deja un mtime siempre distinto
  fs.writeFileSync(archivo, typeof contenido === 'string' ? contenido : JSON.stringify(contenido));
  const t = new Date(Date.now() + 60e3 * ++n_mtime);
  fs.utimesSync(archivo, t, t);
}
// Copia solo lo que la API lee. Opcionalmente cambia el estado ('en-vivo', etc.).
function copiarDatos(estado) {
  const data = path.join(tmp('erm-api-datos-'), 'data');
  fs.cpSync(DATA, data, { recursive: true, filter: (src) => /^(|(status|latest|boletines|checks)\.json|ambitos|actas)([\\/]|$)/.test(path.relative(DATA, src)) });
  if (estado) reescribir(path.join(data, 'status.json'), { ...leerJson(DATA, 'status.json'), estado });
  return { dataDir: data, mesasDir: path.join(data, 'actas', 'mesas') };
}

async function levantar({ dataDir = DATA, mesasDir = MESAS, stateDir = tmp('erm-api-estado-'), reloj = { t: T0 } } = {}) {
  const servidor = crearServidor({ dataDir, mesasDir, stateDir, ahora: () => reloj.t });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const port = servidor.address().port;
  const agente = new http.Agent({ keepAlive: true, maxSockets: 4 });   // reutiliza conexiones (cientos de pedidos seguidos)
  const pedir = (ruta, { method = 'GET', headers, cuerpo } = {}) => new Promise((ok, fallo) => {
    const largo = cuerpo ? { 'content-length': Buffer.byteLength(cuerpo) } : {};
    const req = http.request({ host: '127.0.0.1', port, path: ruta, method, headers: { ...largo, ...headers }, agent: agente }, (res) => {
      const trozos = [];
      res.on('data', (d) => trozos.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        let json = null; try { json = JSON.parse(texto); } catch { /* se verifica en cada prueba */ }
        ok({ status: res.statusCode, headers: res.headers, texto, json });
      });
    });
    req.on('error', fallo);
    req.end(cuerpo);
  });
  const cerrar = () => new Promise((ok) => { agente.destroy(); servidor.close(ok); servidor.closeAllConnections(); });
  return { pedir, cerrar, port, reloj, stateDir };
}
async function conApi(opciones, fn) {
  const a = await levantar(opciones);
  try { await fn(a); } finally { await a.cerrar(); }
}

// Toda respuesta: HTTP 200, JSON y las 4 cabeceras. Devuelve el JSON.
function json200(r) {
  assert.equal(r.status, 200, r.texto.slice(0, 200));
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(r.json, 'debe ser JSON: ' + r.texto.slice(0, 100));
  return r.json;
}
function bien(r) {                                   // éxito con el sobre completo → devuelve data
  const j = json200(r);
  assert.equal(j.ok, true, r.texto.slice(0, 300));
  assert.deepEqual(Object.keys(j), ['ok', 'fuente', 'copia', 'aviso', 'consultado', 'estado', 'data']);
  return j.data;
}
function mal(r, patron = /./) {                      // error: sigue siendo 200
  const j = json200(r);
  assert.equal(j.ok, false, r.texto.slice(0, 300));
  assert.deepEqual(Object.keys(j), ['ok', 'error']);
  assert.match(j.error, patron);
  return j;
}
const esEspecial = (p) => /^VOTOS /.test(p);

/* ───────── guía, sobre y cabeceras ───────── */
test('guía en / con el sobre, las cabeceras y todos los ejemplos funcionando', async () => {
  await conApi({}, async (a) => {
    const j = json200(await a.pedir('/'));
    const st = leerJson(DATA, 'status.json');
    assert.equal(j.ok, true);
    assert.equal(j.fuente, 'ONPE (resultadoelectoral.onpe.gob.pe)');
    assert.equal(j.copia, 'peruvian.dev/dataonpe — copia no oficial, tomada cada minuto desde una conexión peruana');
    assert.equal(j.aviso, 'Sitio no oficial. Los resultados oficiales son los que publica la ONPE.');
    assert.equal(j.consultado, st.consultado);
    assert.equal(j.estado, st.estado);
    const rutas = j.data.endpoints.map((e) => e.ruta.split('?')[0].replace(/\/\{.*$/, ''));
    for (const r of ['/', '/estado', '/resumen', '/eleccion', '/lugar', '/mesa', '/observaciones', '/boletines', '/cola']) assert.ok(rutas.includes(r), 'falta ' + r);
    assert.equal(j.data.base, 'https://peruvian.dev/dataonpe/api/v1');
    for (const e of j.data.endpoints) {                // cada ejemplo de la guía responde bien
      assert.ok(e.descripcion.length > 10);
      assert.ok(e.ejemplo.startsWith(j.data.base));
      bien(await a.pedir('/dataonpe/api/v1' + e.ejemplo.slice(j.data.base.length)));
    }
  });
});

test('acepta las rutas con y sin el prefijo /dataonpe/api/v1', async () => {
  await conApi({}, async (a) => {
    const base = bien(await a.pedir('/estado'));
    for (const ruta of ['/dataonpe/api/v1/estado', '/dataonpe/api/v1/estado/', '/api/v1/estado', '//estado', '/estado/']) {
      assert.deepEqual(bien(await a.pedir(ruta)), base, ruta);
    }
    bien(await a.pedir('/dataonpe/api/v1'));
    bien(await a.pedir('/dataonpe/api/v1/'));
    mal(await a.pedir('/dataonpe/api/v1x/estado'), /Ruta no encontrada/);
  });
});

test('HEAD responde 200 con las cabeceras y sin cuerpo; otros métodos dan 200 "solo GET"', async () => {
  await conApi({}, async (a) => {
    const h = await a.pedir('/estado', { method: 'HEAD' });
    assert.equal(h.status, 200);
    assert.equal(h.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(h.headers['access-control-allow-origin'], '*');
    assert.equal(h.texto, '');
    assert.ok(+h.headers['content-length'] > 100);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await a.pedir('/mesa/000001', { method, cuerpo: method === 'OPTIONS' ? undefined : '{"x":1}', headers: { 'content-type': 'application/json' } });
      assert.deepEqual(json200(r), { ok: false, error: 'solo GET' }, method);
    }
  });
});

/* ───────── estado y resumen ───────── */
test('/estado: con el estado "error" no hay resultados en vivo; con "en-vivo" sí', async () => {
  await conApi({}, async (a) => {
    const d = bien(await a.pedir('/estado'));
    assert.equal(d.estado, 'error');
    assert.equal(d.resultados, false);
    assert.equal(d.consultado, leerJson(DATA, 'status.json').consultado);
    assert.equal(d.elecciones.length, 4);
    assert.deepEqual(d.elecciones.map((e) => e.id), [20, 21, 22, 23]);
    assert.deepEqual(d.elecciones[0], { id: 20, nombre: 'Gobernador Regional', actasContabilizadas: 89.992, corte: '05:55' });   // hora de Lima
    assert.match(d.nota, /últimos que se copiaron/);
    assert.ok(!JSON.stringify(d).includes('urlopen'), 'no se expone el error interno');
  });
  await conApi(copiarDatos('en-vivo'), async (a) => {
    const j = json200(await a.pedir('/estado'));
    assert.equal(j.estado, 'en-vivo');
    assert.equal(j.data.resultados, true);
    assert.equal(j.data.nota, undefined);
  });
});

test('/resumen: totales, 5 primeros sin blancos/nulos y último boletín', async () => {
  const datos = copiarDatos();
  const f = path.join(datos.dataDir, 'latest.json');
  const latest = leerJson(f);
  latest.elecciones[0].participantes.find((p) => p.especial).votos = 9e9;   // blancos mayores que todos: no deben ir primero
  reescribir(f, latest);
  await conApi(datos, async (a) => {
    const d = bien(await a.pedir('/resumen'));
    assert.equal(d.elecciones.length, 4);
    for (const e of d.elecciones) {
      assert.ok(e.id && e.nombre && e.cargo && e.tipo && e.nivel && e.totales && e.corte === '05:55');
      assert.equal(e.top.length, 5);
      assert.equal(e.truncado, true);
      assert.ok(e.top.every((p) => !esEspecial(p.partido)));
      assert.ok(e.top.every((p, i) => i === 0 || e.top[i - 1].votos >= p.votos));
    }
    assert.equal(d.elecciones[0].top[0].partido, 'JUNTOS DE MENTIRA');
    assert.equal(d.elecciones[0].totales.participacionCiudadana, 72.918);
    assert.equal(d.boletin.hora, '05:55');
    assert.match(d.boletin.texto, /^Corte ONPE de las 05:55/);
  });
});

/* ───────── elección ───────── */
test('/eleccion/:id: departamentos reducidos y ?detalle=1', async () => {
  await conApi({}, async (a) => {
    const d = bien(await a.pedir('/eleccion/20'));
    assert.equal(d.id, 20);
    assert.equal(d.departamentos.length, 25);
    const amazonas = d.departamentos[0];
    assert.deepEqual(Object.keys(amazonas), ['ubigeo', 'nombre', 'actasContabilizadas', 'primero', 'segundo', 'puedeCambiar']);
    assert.equal(amazonas.primero.partido, 'JUNTOS DE MENTIRA');   // los votos en blanco (106272) son más pero no cuentan
    assert.ok(d.departamentos.every((x) => !esEspecial(x.primero.partido) && !esEspecial(x.segundo.partido)));
    assert.ok(!('participantes' in amazonas));
    assert.equal(d.top.length, 5);
    assert.equal(d.truncado, true);                    // hay 7 organizaciones y se muestran 5
    assert.ok(JSON.stringify(d).length < 20000);

    const det = bien(await a.pedir('/eleccion/20?detalle=1'));
    assert.equal(det.top.length, 7);                   // con detalle caben hasta 10: aquí hay 7
    assert.equal(det.truncado, undefined);
    for (const x of det.departamentos) {
      assert.ok(x.participantes.length > 0 && x.participantes.length <= 10);
      assert.ok(x.participantes.every((p) => !esEspecial(p.partido)));
    }
    for (const id of ['21', '22', '23']) assert.equal(bien(await a.pedir('/eleccion/' + id)).id, +id);
    mal(await a.pedir('/eleccion/99'), /No existe esa elección/);
    mal(await a.pedir('/eleccion/abc'), /id de elección/);
    mal(await a.pedir('/eleccion/12345'), /id de elección/);
    mal(await a.pedir('/eleccion/2%200'), /id de elección/);
    mal(await a.pedir('/eleccion/'), /Ruta no encontrada/);
  });
});

test('/eleccion: si falta la contienda, primero y segundo salen de la lista sin blancos', async () => {
  const datos = copiarDatos();
  const f = path.join(datos.dataDir, 'latest.json');
  const latest = leerJson(f);
  delete latest.elecciones[0].departamentos[0].contienda;
  reescribir(f, latest);
  await conApi(datos, async (a) => {
    const d = bien(await a.pedir('/eleccion/20'));
    assert.equal(d.departamentos[0].primero.partido, 'JUNTOS DE MENTIRA');
    assert.equal(d.departamentos[0].segundo.partido, 'PARTIDO EJEMPLO');
    assert.equal(d.departamentos[0].puedeCambiar, null);
  });
});

/* ───────── lugares ───────── */
test('/lugar?q=: sin tildes ni mayúsculas, prefijos primero, máximo 10', async () => {
  await conApi({}, async (a) => {
    const nombres = async (q) => bien(await a.pedir('/lugar?q=' + q)).lugares.map((l) => l.ubigeo);
    assert.deepEqual(await nombres(encodeURIComponent('cañete')), await nombres('CANETE'));
    assert.deepEqual(await nombres(encodeURIComponent('CAÑETE')), await nombres('canete'));
    assert.equal((await nombres('canete')).length, 3);
    const c = bien(await a.pedir('/lugar?q=san%20vicente'));
    assert.deepEqual(c.lugares[0], { nivel: 3, ubigeo: '140201', nombre: 'SAN VICENTE DE CAÑETE', ruta: 'SAN VICENTE DE CAÑETE, CAÑETE, LIMA', ver: '/lugar/3/140201' });
    const m = bien(await a.pedir('/lugar?q=miraflores')).lugares;
    assert.equal(m.length, 1);
    assert.equal(m[0].ruta, 'MIRAFLORES, LIMA, LIMA');
    const lima = bien(await a.pedir('/lugar?q=lima'));            // región, provincia y distrito primero; el resto recortado
    assert.deepEqual(lima.lugares.slice(0, 3).map((l) => l.nivel), [1, 2, 3]);
    assert.equal(lima.lugares.length, 10);
    assert.equal(lima.truncado, true);
    assert.ok(lima.total > 10);
    const ca = bien(await a.pedir('/lugar?q=ca')).lugares.map((l) => l.nombre.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').startsWith('ca'));
    assert.deepEqual(ca, [...ca].sort((x, y) => y - x), 'primero los que empiezan igual');
    const num = bien(await a.pedir('/lugar?q=1401')).lugares;
    assert.ok(num.length > 0 && num.every((l) => l.ubigeo.startsWith('1401')));
    assert.equal(bien(await a.pedir('/lugar?q=zzzzzz')).lugares.length, 0);
    assert.equal(bien(await a.pedir('/lugar?q=' + 'a'.repeat(40))).total, 0);
    mal(await a.pedir('/lugar?q=' + 'a'.repeat(41)), /q:/);
    mal(await a.pedir('/lugar'), /Falta q/);
    mal(await a.pedir('/lugar?q='), /q:/);
    mal(await a.pedir('/lugar?q=%20%20'), /q:/);
    for (const raro of ['%3Cscript%3E', '%00', '..%2F..', '%27%3B--', '%E0%A4%A', 'a%2Fb', 'a%5Cb', '%7B%7D', 'a%3Db']) mal(await a.pedir('/lugar?q=' + raro), /q:/);
    assert.equal(bien(await a.pedir('/lugar?q=a%0A%20%20b')).consulta, 'a b');       // los espacios raros se normalizan
  });
});

test('/lugar/:nivel/:ubigeo: contiendas de distrito, provincia y región', async () => {
  await conApi({}, async (a) => {
    const cargos = async (ruta) => bien(await a.pedir(ruta)).contiendas.map((c) => c.cargo);
    assert.deepEqual(await cargos('/lugar/3/140102'), ['Alcalde Distrital', 'Alcalde Provincial']);    // Lima Metropolitana: sin gobernador
    assert.deepEqual(await cargos('/lugar/3/140201'), ['Alcalde Distrital', 'Alcalde Provincial', 'Gobernador Regional']);
    assert.deepEqual(await cargos('/lugar/2/140100'), ['Alcalde Provincial']);
    assert.deepEqual(await cargos('/lugar/2/140200'), ['Alcalde Provincial', 'Gobernador Regional']);
    assert.deepEqual(await cargos('/lugar/1/140000'), ['Gobernador Regional']);
    assert.deepEqual(await cargos('/lugar/3/010101'), ['Alcalde Distrital', 'Alcalde Provincial', 'Gobernador Regional']);

    const mira = bien(await a.pedir('/lugar/3/140102'));
    assert.equal(mira.nombre, 'MIRAFLORES');
    assert.equal(mira.ruta, 'MIRAFLORES, LIMA, LIMA');
    const [dist, prov] = mira.contiendas;
    const f = leerJson(DATA, 'ambitos', 'eleccion-23', '140000.json').distritos['140102'];
    const esperado = f.participantes.filter((p) => !p.especial).sort((x, y) => y.votos - x.votos).slice(0, 5);
    assert.deepEqual(dist.top.map((p) => p.votos), esperado.map((p) => p.votos));
    assert.equal(dist.top.length, 5);
    assert.deepEqual(dist.especiales.map((e) => e.partido).sort(), ['VOTOS EN BLANCO', 'VOTOS NULOS']);
    assert.equal(dist.contienda.primero.partido, f.contienda.primero.partido);
    assert.equal(dist.contienda.diferencia, f.contienda.diferencia);
    assert.equal(dist.contienda.puedeCambiar, f.contienda.puedeCambiar);
    assert.equal(dist.corte, '05:55');
    assert.equal(dist.visto, '2026-10-04T05:55:42-05:00');
    assert.equal(dist.lugar, 'MIRAFLORES, LIMA, LIMA');
    assert.equal(dist.totales.totalActas, f.totales.totalActas);
    assert.equal(prov.lugar, 'LIMA, LIMA');
    assert.equal(prov.eleccion, 22);

    const gob = (await a.pedir('/lugar/3/140201')).json.data.contiendas[2];   // gobernador de Lima, desde latest.json
    const dep = leerJson(DATA, 'latest.json').elecciones[0].departamentos.find((d) => d.ubigeo === '140000');
    assert.equal(gob.lugar, 'LIMA');
    assert.equal(gob.contienda.primero.votos, dep.contienda.primero.votos);
    assert.equal(gob.visto, null);

    // lugares que no tenemos
    for (const ruta of ['/lugar/3/999999', '/lugar/1/990000', '/lugar/2/999900']) {
      const d = bien(await a.pedir(ruta));
      assert.equal(d.pendiente, true);
      assert.deepEqual(d.contiendas, []);
      assert.match(d.mensaje, /no está en nuestra copia/);
    }
    // entradas inválidas
    for (const ruta of ['/lugar/4/140102', '/lugar/0/140102', '/lugar/x/140102', '/lugar/3/14010', '/lugar/3/1401021', '/lugar/3/abcdef', '/lugar/3/..%2F..', '/lugar/%2e%2e/140102', '/lugar/13/140102']) {
      mal(await a.pedir(ruta), /nivel|ubigeo/);
    }
    mal(await a.pedir('/lugar/3/140102/extra'), /Ruta no encontrada/);
  });
});

test('/lugar: si falta una contienda se dice "pendiente" en español y no se rompe nada', async () => {
  const datos = copiarDatos();
  const f23 = path.join(datos.dataDir, 'ambitos', 'eleccion-23', '140000.json');
  const d23 = leerJson(f23); delete d23.distritos['140102']; reescribir(f23, d23);
  fs.rmSync(path.join(datos.dataDir, 'ambitos', 'eleccion-22', '140000.json'));
  await conApi(datos, async (a) => {
    const [dist, prov] = bien(await a.pedir('/lugar/3/140102')).contiendas;
    for (const c of [dist, prov]) {
      assert.equal(c.pendiente, true);
      assert.match(c.mensaje, /Todavía no tenemos los resultados/);
      assert.ok(c.cargo && c.lugar);
    }
    const otro = bien(await a.pedir('/lugar/3/140101')).contiendas;     // Lima distrito: el distrital sí está, el provincial no
    assert.deepEqual(otro.map((c) => c.pendiente), [undefined, true]);
    assert.equal(bien(await a.pedir('/lugar/3/140201')).contiendas[2].pendiente, undefined);   // el gobernador sí está
  });
});

/* ───────── mesas y cola ───────── */
test('/mesa/:codigo: encontrada y al día, con sus observaciones', async () => {
  await conApi({}, async (a) => {
    const m = bien(await a.pedir('/mesa/000001'));
    assert.equal(m.codigo, '000001');
    assert.equal(m.encontrada, true);
    assert.equal(m.enCola, false);
    assert.equal(m.mesa.actas.length, 3);
    assert.equal(m.mesa.local, 'IE 101');
    assert.deepEqual(m.observaciones, []);
    const alerta = bien(await a.pedir('/mesa/000007'));
    assert.equal(alerta.observaciones.length, 1);
    assert.equal(alerta.observaciones[0].severidad, 'alerta');
    assert.equal(alerta.observaciones[0].tipo, 'mas-votos-que-electores');
    assert.deepEqual(bien(await a.pedir('/mesa/000013')).observaciones.map((o) => o.tipo).sort(), ['suma-emitidos', 'suma-partidos']);
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, []);
  });
});

test('/mesa: códigos inválidos dan error en 200 y nunca tocan el disco', async () => {
  await conApi({}, async (a) => {
    for (const c of ['12345', '1234567', 'abcdef', '00000a', '%2e%2e%2f%2e%2e', '..%2F..%2Fetc%2Fpasswd', '%00', '0000%201', '000001%0A', encodeURIComponent('１２３４５６'), '__proto__', 'constructor']) {
      mal(await a.pedir('/mesa/' + c), /mesa:/);
    }
    mal(await a.pedir('/mesa/'), /Ruta no encontrada/);
    mal(await a.pedir('/mesa/000001/000002'), /Ruta no encontrada/);
  });
});

test('/mesa sin lectura en vivo: no se pide nada', async () => {
  await conApi({}, async (a) => {                    // el estado de los datos de prueba es "error"
    const m = bien(await a.pedir('/mesa/999999'));
    assert.equal(m.encontrada, false);
    assert.equal(m.enCola, false);
    assert.match(m.mensaje, /no hay lectura en vivo/);
    a.reloj.t += HORA;                               // mesa vieja pero sin lectura en vivo: igual no se pide
    const v = bien(await a.pedir('/mesa/000001'));
    assert.equal(v.encontrada, true);
    assert.equal(v.enCola, false);
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, []);
  });
});

test('/mesa en vivo: pide las que faltan o están viejas, sin duplicar, y las quita al actualizarse', async () => {
  const datos = copiarDatos('en-vivo');
  await conApi(datos, async (a) => {
    const ip = { 'x-real-ip': '203.0.113.7' };
    const nueva = bien(await a.pedir('/mesa/999999', { headers: ip }));
    assert.equal(nueva.encontrada, false);
    assert.equal(nueva.enCola, true);
    assert.equal(nueva.mensaje, 'Se pidió; vuelve a consultar en unos minutos');
    assert.equal(bien(await a.pedir('/mesa/999999', { headers: ip })).enCola, true);
    assert.equal(bien(await a.pedir('/mesa/000001')).enCola, false);   // está al día (6 min)
    const cola = bien(await a.pedir('/cola'));
    assert.deepEqual(cola.pedidas, ['999999']);                        // una sola vez
    assert.match(cola.actualizado, /^2026-10-04T05:30:00-05:00$/);

    a.reloj.t += 30 * MIN;                                             // ahora la mesa 000001 tiene 36 min
    const vieja = bien(await a.pedir('/mesa/000001', { headers: ip }));
    assert.equal(vieja.encontrada, true);
    assert.equal(vieja.enCola, true);
    assert.equal(vieja.mesa.mesa, '000001');                           // devuelve lo que tiene
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, ['999999', '000001']);

    // el colector actualiza la mesa → deja de estar pedida
    const f = path.join(datos.mesasDir, '000.json');
    const mesas = leerJson(f);
    mesas['000001'].consultado = '2026-10-04T05:58:00-05:00';
    reescribir(f, mesas);
    a.reloj.t += 10e3;                                                 // pasan más de 5 s: se vuelve a mirar el archivo
    const lista = bien(await a.pedir('/mesa/000001'));
    assert.equal(lista.enCola, false);
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, ['999999']);

    // en disco: escritura atómica, sin temporales ni IPs
    const guardado = path.join(a.stateDir, 'cola.json');
    assert.deepEqual(leerJson(guardado).pedidas, ['999999']);
    assert.deepEqual(fs.readdirSync(a.stateDir), ['cola.json']);
    assert.ok(!fs.readFileSync(guardado, 'utf8').includes('203.0.113.7'));
  });
});

test('cola: 20 códigos nuevos por hora por cliente', async () => {
  await conApi(copiarDatos('en-vivo'), async (a) => {
    const yo = { 'x-real-ip': '198.51.100.1' };
    const resultados = [];
    for (let i = 1; i <= 25; i++) resultados.push(bien(await a.pedir('/mesa/90' + String(i).padStart(4, '0'), { headers: yo })));
    assert.equal(resultados.filter((r) => r.enCola).length, 20);
    assert.ok(resultados.slice(0, 20).every((r) => r.enCola));
    assert.ok(resultados.slice(20).every((r) => !r.enCola && /máximo 20/.test(r.mensaje) && r.encontrada === false));
    assert.equal(bien(await a.pedir('/mesa/900001', { headers: yo })).enCola, true);    // ya pedida: no cuenta
    assert.equal(bien(await a.pedir('/mesa/900100', { headers: { 'x-real-ip': '198.51.100.2' } })).enCola, true);   // otro cliente sí puede
    assert.equal(bien(await a.pedir('/cola')).pedidas.length, 21);
    assert.ok(!bien(await a.pedir('/cola')).pedidas.includes('900021'));
    a.reloj.t += HORA + 1000;                                                           // pasó la hora: puede pedir otra vez
    assert.equal(bien(await a.pedir('/mesa/900200', { headers: yo })).enCola, true);
    assert.ok(!fs.readFileSync(path.join(a.stateDir, 'cola.json'), 'utf8').includes('198.51.100'));
  });
});

test('cola: sin x-real-ip se usa la dirección del socket y el límite es el mismo', async () => {
  await conApi(copiarDatos('en-vivo'), async (a) => {
    let aceptadas = 0;
    for (let i = 0; i < 22; i++) if (bien(await a.pedir('/mesa/91' + String(i).padStart(4, '0'))).enCola) aceptadas++;
    assert.equal(aceptadas, 20);
  });
});

test('cola: 120 códigos nuevos por hora en total', async () => {
  await conApi(copiarDatos('en-vivo'), async (a) => {
    const r = [];
    for (let i = 1; i <= 130; i++) r.push(bien(await a.pedir('/mesa/92' + String(i).padStart(4, '0'), { headers: { 'x-real-ip': '10.0.' + (i >> 8) + '.' + (i & 255) } })));
    assert.equal(r.filter((x) => x.enCola).length, 120);
    assert.ok(r.slice(120).every((x) => !x.enCola && /Hay muchas mesas pedidas/.test(x.mensaje)));
    assert.equal(bien(await a.pedir('/cola')).pedidas.length, 120);
    a.reloj.t += HORA + 1000;
    assert.equal(bien(await a.pedir('/mesa/929999', { headers: { 'x-real-ip': '10.9.9.9' } })).enCola, true);
  });
});

test('cola: caduca a las 2 horas', async () => {
  await conApi(copiarDatos('en-vivo'), async (a) => {
    bien(await a.pedir('/mesa/930001'));
    a.reloj.t += 119 * MIN;
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, ['930001']);
    a.reloj.t += 2 * MIN;
    assert.deepEqual(bien(await a.pedir('/cola')).pedidas, []);
    assert.deepEqual(leerJson(a.stateDir, 'cola.json').pedidas, []);
  });
});

test('cola: máximo 300 pendientes (se bota la más vieja), se reanuda tras reiniciar y descarta lo caducado', async () => {
  const stateDir = tmp('erm-api-estado-');
  const detalle = [];
  for (let i = 0; i < 299; i++) detalle.push({ mesa: String(200000 + i), t: T0 - (300 - i) * 1000 });
  detalle.splice(100, 0, { mesa: '300000', t: T0 - 3 * HORA });            // una caducada en medio
  detalle.push({ mesa: 'malo', t: T0 }, { mesa: '200001', t: T0 });        // una inválida y una repetida
  fs.writeFileSync(path.join(stateDir, 'cola.json'), JSON.stringify({ detalle }));
  await conApi({ ...copiarDatos('en-vivo'), stateDir }, async (a) => {
    const inicial = bien(await a.pedir('/cola')).pedidas;
    assert.equal(inicial.length, 299);
    assert.ok(!inicial.includes('300000') && !inicial.includes('malo'));
    assert.equal(new Set(inicial).size, 299);
    bien(await a.pedir('/mesa/990001', { headers: { 'x-real-ip': '1.1.1.1' } }));
    assert.equal(bien(await a.pedir('/cola')).pedidas.length, 300);
    bien(await a.pedir('/mesa/990002', { headers: { 'x-real-ip': '1.1.1.2' } }));
    const final = bien(await a.pedir('/cola')).pedidas;
    assert.equal(final.length, 300);
    assert.equal(final.at(-1), '990002');
    assert.equal(final.at(-2), '990001');
    assert.ok(!final.includes('200000'), 'se botó la más vieja');
  });
});

/* ───────── observaciones y boletines ───────── */
test('/observaciones: filtros, límite y orden (las más nuevas primero)', async () => {
  const datos = copiarDatos();
  const f = path.join(datos.dataDir, 'actas', 'anomalias.json');
  const an = leerJson(f);
  an.items.forEach((it, i) => { it.visto = `2026-10-04T05:${String(i * 10).padStart(2, '0')}:00-05:00`; });   // 05:00, 05:10, 05:20, 05:30
  reescribir(f, an);
  await conApi(datos, async (a) => {
    const d = bien(await a.pedir('/observaciones'));
    assert.equal(d.actas.total, 4);
    assert.deepEqual(d.actas.items.map((x) => x.mesa), an.items.map((x) => x.mesa).reverse());
    assert.equal(d.totales.total, 1);
    assert.equal(d.totales.items[0].tipo, 'porcentaje');
    assert.equal(d.resumen.actasLeidas, 849);
    assert.equal(d.resumen.mesasEncontradas, 283);
    assert.equal(d.resumen.avisos.alerta, 1);
    assert.equal(d.truncado, undefined);
    assert.ok(!('ritmo' in d.resumen));

    const alerta = bien(await a.pedir('/observaciones?severidad=alerta'));
    assert.equal(alerta.actas.total, 1);
    assert.ok(alerta.actas.items.every((x) => x.severidad === 'alerta'));
    assert.equal(alerta.totales.total, 0);
    const revisar = bien(await a.pedir('/observaciones?severidad=revisar&limite=2'));
    assert.equal(revisar.actas.total, 3);
    assert.equal(revisar.actas.items.length, 2);
    assert.equal(revisar.truncado, true);
    assert.equal(revisar.totales.total, 1);
    assert.equal(bien(await a.pedir('/observaciones?limite=1')).actas.items.length, 1);
    assert.equal(bien(await a.pedir('/observaciones?limite=50')).actas.items.length, 4);

    for (const q of ['severidad=otra', 'severidad=ALERTA', 'severidad=', 'limite=0', 'limite=51', 'limite=100', 'limite=abc', 'limite=-1', 'limite=1.5', 'limite=1e1', 'limite=', 'limite=%2B5', 'limite=05']) {
      mal(await a.pedir('/observaciones?' + q), /severidad|limite/);
    }
  });
});

test('/boletines: 5 por defecto, recortados y de más nuevo a más viejo', async () => {
  await conApi({}, async (a) => {
    const d = bien(await a.pedir('/boletines'));
    assert.equal(d.items.length, 5);
    assert.equal(d.total, 32);
    assert.equal(d.truncado, true);
    assert.ok(d.items.every((b, i) => i === 0 || d.items[i - 1].corte >= b.corte));
    assert.ok(d.items.every((b) => b.texto && b.hora && b.cambios.length <= 5));
    assert.ok(d.items[0].cambiosTotal >= d.items[0].cambios.length);
    assert.equal(bien(await a.pedir('/boletines?limite=1')).items.length, 1);
    const todos = bien(await a.pedir('/boletines?limite=50'));
    assert.equal(todos.items.length, 32);
    assert.equal(todos.truncado, undefined);
    assert.ok((await a.pedir('/boletines')).texto.length < 20000, 'respuesta chica');
    mal(await a.pedir('/boletines?limite=0'), /limite/);
    mal(await a.pedir('/boletines?limite=51'), /limite/);
  });
});

/* ───────── nunca 4xx/5xx ───────── */
test('toda entrada mala responde 200 con ok:false', async () => {
  await conApi({}, async (a) => {
    const malas = [
      '/nada', '/ESTADO', '/estado/x', '/resumen/1', '/cola/1', '/boletines/1', '/observaciones/1', '/eleccion', '/eleccion/20/21', '/mesa', '/lugar/3',
      '/%', '/%zz', '/mesa/%', '/lugar?q=%', '/estado/%00', '/..', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/mesa/../../x',
      '/' + 'a'.repeat(3000), '/mesa/' + '1'.repeat(5000), '/estado?x=' + 'b'.repeat(5000), '/*',
    ];
    for (const ruta of malas) {
      const j = json200(await a.pedir(ruta));
      assert.equal(j.ok, false, ruta.slice(0, 60));
      assert.equal(typeof j.error, 'string');
    }
    for (const ruta of ['/estado?a=1&b=2', '/estado?limite=999', '/resumen?q=%00', '/?' + 'q=1&'.repeat(300)]) bien(await a.pedir(ruta));   // parámetros que no se usan se ignoran
    assert.equal((await a.pedir('/nada', { method: 'HEAD' })).status, 200);
  });
});

test('peticiones mal formadas también reciben 200 con JSON', async () => {
  await conApi({}, async (a) => {
    const crudo = (txt) => new Promise((ok, fallo) => {
      const s = net.connect(a.port, '127.0.0.1', () => s.write(txt));
      let buf = ''; s.on('data', (d) => (buf += d)); s.on('end', () => ok(buf)); s.on('error', fallo);
      setTimeout(() => s.destroy(), 3000).unref();
      s.on('close', () => ok(buf));
    });
    const malformadas = [
      'GET /estado HTTP/1.1\r\nHost: x\r\nCabecera mala\r\n\r\n',
      'GET /estado HTTP/1.1\r\nHost: x\r\nX: ' + 'a'.repeat(40000) + '\r\n\r\n',      // cabeceras enormes
      'GET /lugar?q=cañete HTTP/1.1\r\nHost: x\r\n\r\n',                              // ñ sin codificar
      'GARBAGE\r\n\r\n',
    ];
    for (const txt of malformadas) {
      const r = await crudo(txt);
      assert.match(r, /^HTTP\/1\.1 200 OK\r\n/, txt.slice(0, 30));
      assert.match(r, /content-type: application\/json; charset=utf-8/i);
      assert.match(r, /access-control-allow-origin: \*/i);
      assert.match(r, /\{"ok":false,"error":"Petición mal formada\.[^"]*"\}$/);
    }
  });
});

/* ───────── caché y archivos que faltan ───────── */
test('caché: vuelve a leer un archivo cuando cambia su mtime, pero mira como mucho cada 5 s', async () => {
  const datos = copiarDatos();
  await conApi(datos, async (a) => {
    assert.equal(bien(await a.pedir('/estado')).estado, 'error');
    const f = path.join(datos.dataDir, 'status.json');
    reescribir(f, { ...leerJson(f), estado: 'en-vivo' });
    assert.equal(bien(await a.pedir('/estado')).estado, 'error', 'todavía en caché');
    a.reloj.t += 4900;
    assert.equal(bien(await a.pedir('/estado')).estado, 'error', 'aún no pasan 5 s');
    a.reloj.t += 200;
    const d = bien(await a.pedir('/estado'));
    assert.equal(d.estado, 'en-vivo');
    assert.equal(d.resultados, true);
    a.reloj.t += 6000;                               // sin cambios: sigue igual
    assert.equal(bien(await a.pedir('/estado')).estado, 'en-vivo');
  });
});

test('archivos ausentes o ilegibles se tratan como vacíos y nunca rompen', async () => {
  const datos = copiarDatos();
  const d = datos.dataDir;
  await conApi(datos, async (a) => {
    assert.equal(bien(await a.pedir('/boletines?limite=1')).items.length, 1);   // queda en caché
    fs.rmSync(path.join(d, 'latest.json'));
    fs.rmSync(path.join(d, 'actas', 'anomalias.json'));
    reescribir(path.join(d, 'boletines.json'), 'esto no es json {');           // ilegible: se conserva lo último bueno
    fs.rmSync(path.join(d, 'status.json'));
    a.reloj.t += 6000;
    const est = json200(await a.pedir('/estado'));
    assert.equal(est.ok, true);
    assert.equal(est.estado, 'esperando');
    assert.equal(est.consultado, null);
    assert.deepEqual(est.data.elecciones, []);
    assert.deepEqual(bien(await a.pedir('/resumen')).elecciones, []);
    assert.equal(bien(await a.pedir('/resumen')).boletin.hora, '05:55');
    assert.equal(bien(await a.pedir('/boletines')).items.length, 5);
    assert.equal(bien(await a.pedir('/observaciones')).actas.total, 0);
    assert.equal(bien(await a.pedir('/lugar/1/140000')).contiendas[0].pendiente, true);
    mal(await a.pedir('/eleccion/20'), /No existe esa elección/);
  });
});

test('con todo el directorio de datos ausente, todos los endpoints contestan 200', async () => {
  const vacio = tmp('erm-api-vacio-');
  await conApi({ dataDir: path.join(vacio, 'no-existe'), mesasDir: path.join(vacio, 'tampoco') }, async (a) => {
    for (const ruta of ['/', '/estado', '/resumen', '/lugar?q=lima', '/lugar/3/140102', '/mesa/000001', '/observaciones', '/boletines', '/cola']) {
      const j = json200(await a.pedir(ruta));
      assert.equal(j.ok, true, ruta);
    }
    assert.equal(bien(await a.pedir('/mesa/000001')).encontrada, false);
    assert.deepEqual(bien(await a.pedir('/lugar?q=lima')).lugares, []);
    mal(await a.pedir('/eleccion/20'));
  });
});

/* ───────── proceso real y garantías de código ───────── */
const puertoLibre = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

test('arranca con "node server.mjs", lee PORT/DATA_DIR/MESAS_DIR y solo escucha en 127.0.0.1', { timeout: 20000 }, async () => {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, [SERVER], {
    cwd: tmp('erm-api-cwd-'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(puerto), DATA_DIR: DATA, MESAS_DIR: MESAS, STATE_DIRECTORY: '' },
  });
  try {
    let salida = '';
    hijo.stdout.on('data', (d) => (salida += d)); hijo.stderr.on('data', (d) => (salida += d));
    for (let i = 0; i < 100 && !/escuchando/.test(salida); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(salida, new RegExp(`escuchando en 127\\.0\\.0\\.1:${puerto}`));
    const r = await new Promise((ok, fallo) => http.get({ host: '127.0.0.1', port: puerto, path: '/dataonpe/api/v1/mesa/000001', agent: false }, (res) => {
      let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => ok({ status: res.statusCode, json: JSON.parse(t) }));
    }).on('error', fallo));
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.data.mesa.local, 'IE 101');
    const externa = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (externa) {
      const err = await new Promise((ok) => net.connect(puerto, externa.address).on('connect', function () { this.destroy(); ok(null); }).on('error', ok));
      assert.ok(err && err.code === 'ECONNREFUSED', 'no debe atender por la red externa');
    }
  } finally {
    hijo.kill();
    await new Promise((r) => (hijo.exitCode !== null ? r() : hijo.once('exit', r)));
  }
});

test('el código no sale a internet ni consulta a la ONPE: solo módulos locales de node', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const importados = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort();
  assert.deepEqual(importados, ['node:crypto', 'node:fs', 'node:http', 'node:path', 'node:url']);
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\bfetch\s*\(|\bhttps?\.(request|get)\b|\bnet\.|\bdns\.|child_process|XMLHttpRequest|WebSocket/.test(codigo));
  assert.ok(!/require\(/.test(codigo));
});
