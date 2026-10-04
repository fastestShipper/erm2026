#!/usr/bin/env python3
"""Revisión acta por acta — ERM 2026.

Recorre la API pública de la ONPE mesa por mesa (actas/buscar/mesa?codigoMesa=NNNNNN)
y revisa cada acta. Todo sale de la API en vivo: no se usa data de otros procesos.

  1ª vuelta: recorre los números de mesa en orden (000001, 000002, …). Cada número que
             existe queda registrado junto con su acta; los que no existen se saltan.
  Después:   vuelve primero a las mesas con actas sin contabilizar y, de vez en cuando,
             a las ya contabilizadas para detectar cambios.

Revisiones por acta (se publican con los números de ambos lados; nunca son acusaciones):
  - votos de las organizaciones = votos válidos
  - válidos + blancos + nulos (+ impugnados) = emitidos
  - emitidos ≤ electores hábiles
  - emitidos = asistentes
  - participación del 100%                              → revisar
  - una organización con ≥ 95% de los válidos (≥ 50)    → revisar
  - acta contabilizada que después cambia sus números   → alerta

Salidas:
  data/actas/resumen.json       avance del recorrido y conteo de avisos
  data/actas/anomalias.json     actas con avisos (para Toño y para el público)
  data/actas/endpoints.json     rutas de la API que usa el portal (leídas de su código público)
  mesas/<NNN>.json              (fuera de git) lo que la ONPE registra en cada mesa, para «Busca tu mesa»

Ritmo: una consulta cada ERM_ACTAS_DELAY segundos (1.0 por defecto) durante ERM_ACTAS_BUDGET
segundos (540 por defecto). Si la ONPE bloquea, se detiene y lo deja dicho: no se evade.
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.environ.get('ERM_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'actas')
MESAS = os.environ.get('ERM_MESAS_DIR', os.path.join(ROOT, 'local', 'mesas'))
STATE = os.path.join(ROOT, 'local', 'actas-state.json')
CHANGED = os.path.join(ROOT, 'local', 'mesas-changed.txt')
BACKOFF = os.path.join(ROOT, 'local', 'actas-backoff.json')   # pausa propia: un bloqueo de la búsqueda de mesas no detiene el corte
COLA_URL = os.environ.get('ERM_COLA_URL', 'https://peruvian.dev/dataonpe/api/v1/cola')   # mesas pedidas por la API
PORTAL = os.environ.get('ERM_PORTAL', 'https://resultadoelectoral.onpe.gob.pe')
BASE = os.environ.get('ERM_BASE', PORTAL + '/presentacion-backend')
DELAY = float(os.environ.get('ERM_ACTAS_DELAY', '1.0'))   # lento a propósito: no arriesgar el corte nacional
BUDGET = float(os.environ.get('ERM_ACTAS_BUDGET', '540'))
FORCE = os.environ.get('ERM_ACTAS_FORCE') == '1'
MAX_CODE = int(os.environ.get('ERM_ACTAS_MAX', '120000'))     # tope inicial del recorrido; se amplía solo
MISS_STOP = 3000                                               # números seguidos sin mesa = fin del rango
PERU = timezone(timedelta(hours=-5))

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-PE,es;q=0.9',
    'Referer': PORTAL + '/main/actas',
    'Origin': PORTAL,
    'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
}
BLANCO = re.compile(r'BLANCO', re.I)
NULO = re.compile(r'NULO', re.I)
IMPUG = re.compile(r'IMPUGNAD', re.I)


def now_iso():
    return datetime.now(PERU).isoformat(timespec='seconds')


def log(*a):
    print(f'[{now_iso()}] actas:', *a, flush=True)


class Blocked(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def get(path, accept_json=True):
    req = urllib.request.Request(path if path.startswith('http') else f'{BASE}/{path}', headers=HEADERS)
    for i in range(3):
        try:
            with _opener.open(req, timeout=25) as r:
                body = r.read()
                if r.headers.get('x-amzn-waf-action'):
                    raise Blocked('AWS WAF pide ' + r.headers.get('x-amzn-waf-action'))
                ctype = r.headers.get('content-type', '')
                # 202 con HTML = la página de verificación anti-bots de la ONPE. No se resuelve ni se evade.
                if r.status == 202 or (accept_json and 'html' in ctype):
                    raise Blocked('la ONPE pide verificación anti-bots (HTTP 202) para la búsqueda de mesas')
            time.sleep(DELAY)
            if not accept_json:
                return body.decode('utf-8', 'replace')
            if 'json' not in ctype:
                return None
            return json.loads(body.decode('utf-8'))
        except Blocked:
            raise
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 405, 429) or e.headers.get('x-amzn-waf-action'):
                raise Blocked(f'HTTP {e.code}')
            if e.code in (301, 302, 303, 307, 308, 404):
                time.sleep(DELAY)
                return None
            time.sleep(2 * (i + 1))
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
            time.sleep(2 * (i + 1))
    return None


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def write_json(path, obj, indent=1):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def backoff_active():
    """True mientras dure la pausa que se toma cuando la ONPE rechaza consultas."""
    return time.time() < read_json(BACKOFF, {}).get('hasta', 0)


def note_block(reason):
    """La ONPE rechazó una consulta: los recorridos largos esperan 5, 10, 20… hasta 40 minutos. No se evade."""
    prev = read_json(BACKOFF, {})
    n = prev.get('n', 0) + 1 if time.time() - prev.get('visto', 0) < 3600 else 1
    minutes = min(40, 5 * 2 ** (n - 1))
    write_json(BACKOFF, {'hasta': time.time() + 60 * minutes, 'visto': time.time(), 'n': n, 'motivo': str(reason)[:200]}, indent=None)
    log(f'los recorridos largos esperan {minutes} min')


# ------------------------------------------------------------------ rutas del portal

def discover_endpoints():
    """Lee el código JavaScript público del portal y lista las rutas de la API que usa."""
    try:
        html = get(PORTAL + '/', accept_json=False) or ''
        paths = set()
        for js in set(re.findall(r'src="([^"]+\.js)"', html)):
            code = get(js if js.startswith('http') else f'{PORTAL}/{js.lstrip("/")}', accept_json=False) or ''
            for m in re.findall(r'["\'`](/?(?:presentacion-backend/)?[a-z][a-z0-9-]+/[a-zA-Z0-9/_-]+)', code):
                if any(k in m for k in ('acta', 'mesa', 'local', 'ubigeo', 'resumen', 'eleccion', 'participa', 'proceso', 'padron')):
                    paths.add(m.replace('presentacion-backend/', '').lstrip('/'))
        if paths:
            write_json(os.path.join(OUT, 'endpoints.json'), {'detectado': now_iso(), 'rutas': sorted(paths)})
        return sorted(paths)
    except Blocked:
        raise
    except Exception as e:  # el descubrimiento es un extra: nunca detiene el recorrido
        log('no se pudieron leer las rutas del portal:', e)
        return []


# ------------------------------------------------------------------ revisiones

def acta_numbers(a):
    det = a.get('detalle') or []
    partidos, blancos, nulos, impug = [], 0, 0, 0
    for d in det:
        desc = str(d.get('adDescripcion') or '')
        v = d.get('adVotos') or 0
        if BLANCO.search(desc):
            blancos += v
        elif NULO.search(desc):
            nulos += v
        elif IMPUG.search(desc):
            impug += v
        else:
            partidos.append([desc, v])
    return {
        'eleccion': a.get('idEleccion'),
        'estado': a.get('descripcionEstadoActa') or a.get('codigoEstadoActa'),
        'contabilizada': (a.get('codigoEstadoActa') == 'C') or bool(re.search(r'contabiliz', str(a.get('descripcionEstadoActa') or ''), re.I)),
        'electores': a.get('totalElectoresHabiles'),
        'emitidos': a.get('totalVotosEmitidos'),
        'validos': a.get('totalVotosValidos'),
        'asistentes': a.get('totalAsistentes'),
        'blancos': blancos, 'nulos': nulos, 'impugnados': impug,
        'partidos': sorted([p for p in partidos if p[1]], key=lambda p: -p[1]),
        'sumaPartidos': sum(p[1] for p in partidos),
        'tieneBlancoNulo': any(BLANCO.search(str(d.get('adDescripcion') or '')) or NULO.search(str(d.get('adDescripcion') or '')) for d in det),
    }


def check_acta(n):
    out = []
    em, va, el, asi = n['emitidos'], n['validos'], n['electores'], n['asistentes']
    if n['contabilizada'] and va is not None and n['sumaPartidos'] != va:
        out.append(('revisar', 'suma-partidos', f'Los votos de las organizaciones suman {n["sumaPartidos"]:,} y el acta registra {va:,} válidos.'))
    if n['contabilizada'] and n['tieneBlancoNulo'] and None not in (em, va):
        total = va + n['blancos'] + n['nulos'] + n['impugnados']
        if total != em:
            out.append(('revisar', 'suma-emitidos', f'Válidos + blancos + nulos + impugnados = {total:,}, pero el acta registra {em:,} emitidos.'))
    if None not in (em, el) and el > 0 and em > el:
        out.append(('alerta', 'mas-votos-que-electores', f'{em:,} votos emitidos en una mesa de {el:,} electores hábiles.'))
    if None not in (em, asi) and asi and em != asi:
        out.append(('revisar', 'emitidos-asistentes', f'{em:,} votos emitidos y {asi:,} asistentes registrados.'))
    if n['contabilizada'] and None not in (em, el) and el >= 30 and em == el:
        out.append(('revisar', 'participacion-100', f'Votaron los {el:,} electores de la mesa (100%). Es posible, pero poco común.'))
    if n['contabilizada'] and va and va >= 50 and n['partidos'] and n['partidos'][0][1] >= 0.95 * va:
        p = n['partidos'][0]
        out.append(('revisar', 'concentracion', f'{p[0]} obtiene {p[1]:,} de {va:,} votos válidos ({100 * p[1] / va:.1f}%).'))
    return out


def fingerprint(n):
    return hashlib.sha1(json.dumps([n['emitidos'], n['validos'], n['blancos'], n['nulos'], n['partidos']], ensure_ascii=False).encode()).hexdigest()[:16]


# ------------------------------------------------------------------ recorrido

def process(code, data, st, eleccion_names, anomalies, changed_shards):
    actas = [a for a in (data or []) if isinstance(a, dict)]
    if not actas:
        return False
    first = actas[0]
    rec = {'mesa': code, 'local': first.get('nombreLocalVotacion'), 'ubigeo': first.get('idUbigeo'),
           'consultado': now_iso(), 'actas': []}
    prev = st['mesas'].get(code, {})
    fps = prev.get('fp', {})
    new_fps, final = {}, True
    for a in actas:
        n = acta_numbers(a)
        eid = str(n['eleccion'])
        fp = fingerprint(n)
        new_fps[eid] = [fp, n['contabilizada']]
        final = final and n['contabilizada']
        issues = check_acta(n)
        old = fps.get(eid)
        if old and old[1] and n['contabilizada'] and old[0] != fp:
            issues.append(('alerta', 'cambio-despues-de-contabilizada', 'Esta acta ya estaba contabilizada y sus números cambiaron en una consulta posterior.'))
        for sev, tipo, det in issues:
            key = f'{code}:{eid}:{tipo}'
            anomalies[key] = {**anomalies.get(key, {'visto': now_iso()}), 'mesa': code, 'local': rec['local'], 'ubigeo': rec['ubigeo'],
                              'eleccion': eleccion_names.get(n['eleccion'], n['eleccion']), 'estadoActa': n['estado'],
                              'severidad': sev, 'tipo': tipo, 'detalle': det, 'actualizado': now_iso(),
                              'valores': {k: n[k] for k in ('electores', 'emitidos', 'validos', 'asistentes', 'blancos', 'nulos', 'impugnados', 'sumaPartidos')}}
        # si un aviso ya no aplica (p. ej. el acta pasó a contabilizada y cuadra), se retira
        for key in [k for k in anomalies if k.startswith(f'{code}:{eid}:')]:
            if key.split(':')[2] not in {t for _, t, _ in issues} and anomalies[key]['tipo'] != 'cambio-despues-de-contabilizada':
                del anomalies[key]
        rec['actas'].append({'eleccion': eleccion_names.get(n['eleccion'], n['eleccion']), 'estado': n['estado'],
                             **{k: n[k] for k in ('electores', 'emitidos', 'validos', 'blancos', 'nulos', 'impugnados', 'partidos')}})
    st['mesas'][code] = {'t': time.time(), 'final': final, 'fp': new_fps, 'u': rec['ubigeo']}
    shard = code[:3]
    shards = st.setdefault('_shard_cache', {})
    sh = shards.get(shard)
    if sh is None:
        sh = read_json(os.path.join(MESAS, f'{shard}.json'), {})
        shards[shard] = sh
    sh[code] = rec
    changed_shards.add(shard)
    return True


def requested_codes():
    """Mesas que pidieron los agentes o el público por la API (/api/v1/mesa/NNNNNN): van primero.
    La cola vive en el servidor; si no responde, se sigue con el recorrido normal."""
    try:
        req = urllib.request.Request(COLA_URL, headers={'User-Agent': 'erm2026-actas'})
        with urllib.request.urlopen(req, timeout=10) as r:
            j = json.loads(r.read().decode('utf-8'))
        codes = (j.get('data') or {}).get('pedidas') or j.get('pedidas') or []
        return [c for c in codes if isinstance(c, str) and re.fullmatch(r'\d{6}', c)][:60]
    except Exception as e:  # la cola es un extra: nunca detiene el recorrido
        log('cola de pedidos no disponible:', e)
        return []


def next_codes(st, asked=()):
    """Orden de visita: 0) mesas pedidas por la API, 1) números sin explorar, 2) mesas sin
    contabilizar (cada 20 min), 3) mesas contabilizadas (cada 4 h, para detectar cambios)."""
    for code in asked:
        yield code, False
    now = time.time()
    pending = sorted((m['t'], c) for c, m in st['mesas'].items() if not m['final'] and now - m['t'] > 1200)
    stale = sorted((m['t'], c) for c, m in st['mesas'].items() if m['final'] and now - m['t'] > 4 * 3600)
    # alterna exploración y revisitas para que el tablero avance en todos los frentes
    explore = st['cursor'] <= st['max'] and st['misses'] < MISS_STOP
    while True:
        if explore and st['cursor'] <= st['max'] and st['misses'] < MISS_STOP:
            yield f'{st["cursor"]:06d}', True
        if pending:
            yield pending.pop(0)[1], False
        elif stale:
            yield stale.pop(0)[1], False
        elif not (explore and st['cursor'] <= st['max'] and st['misses'] < MISS_STOP):
            return


def main():
    if not os.path.exists(os.path.join(OUT, 'anomalias.json')):
        write_json(os.path.join(OUT, 'anomalias.json'), {'total': 0, 'items': []})
    status = read_json(os.path.join(DATA, 'status.json'), {})
    if status.get('estado') != 'en-vivo' and not FORCE:
        log('la ONPE aún no publica resultados; no hay actas que revisar')
        return
    if backoff_active():
        log('en pausa: la ONPE rechazó consultas hace poco')
        return
    latest = read_json(os.path.join(DATA, 'latest.json'), {})
    names = {e['id']: e.get('menu') or e.get('nombre') for e in latest.get('elecciones', [])}
    st = read_json(STATE, {'cursor': 1, 'max': MAX_CODE, 'misses': 0, 'mesas': {}, 'consultas': 0, 'bloqueado': None})
    anomalies = read_json(os.path.join(ROOT, 'local', 'actas-anomalias.json'), {})
    changed = set()
    t0 = time.time()
    resumen_prev = read_json(os.path.join(OUT, 'resumen.json'), {})

    # (el descubrimiento de rutas leyendo el código del portal queda desactivado: el portal pide verificación anti-bots)

    blocked = None
    try:
        asked = requested_codes()
        if asked:
            log(f'{len(asked)} mesas pedidas por la API van primero')
        for code, exploring in next_codes(st, asked):
            if time.time() - t0 > BUDGET:
                break
            j = get(f'actas/buscar/mesa?codigoMesa={code}')
            st['consultas'] += 1
            data = j.get('data') if isinstance(j, dict) and j.get('success') else None
            found = process(code, data, st, names, anomalies, changed)
            if exploring:
                st['cursor'] += 1
                st['misses'] = 0 if found else st['misses'] + 1
                if found and st['cursor'] > st['max'] - 1000:
                    st['max'] += 20000   # hay mesas cerca del tope: se amplía el rango
    except Blocked as e:
        blocked = str(e)
        log('la ONPE bloqueó las consultas:', e)
        note_block(e)

    # guardar fragmentos de «Busca tu mesa» y la lista de cambios para el sync
    for shard in changed:
        write_json(os.path.join(MESAS, f'{shard}.json'), st['_shard_cache'][shard], indent=None)
    st.pop('_shard_cache', None)
    if changed:
        os.makedirs(os.path.dirname(CHANGED), exist_ok=True)
        with open(CHANGED, 'a', encoding='utf-8') as f:
            f.write(''.join(f'{s}.json\n' for s in sorted(changed)))
    st['bloqueado'] = blocked
    write_json(STATE, st, indent=None)
    write_json(os.path.join(ROOT, 'local', 'actas-anomalias.json'), anomalies, indent=None)

    mesas = st['mesas']
    actas_leidas = sum(len(m['fp']) for m in mesas.values())
    contab = sum(1 for m in mesas.values() for v in m['fp'].values() if v[1])
    items = sorted(anomalies.values(), key=lambda x: (x['severidad'] != 'alerta', x['mesa'], str(x['eleccion'])))
    por_tipo = {}
    for x in items:
        por_tipo[x['tipo']] = por_tipo.get(x['tipo'], 0) + 1
    explorado = min(st['cursor'] - 1, st['max'])
    resumen = {
        'mesasEncontradas': len(mesas),
        'numerosExplorados': explorado,
        'exploracionCompleta': st['misses'] >= MISS_STOP or st['cursor'] > st['max'],
        'actasLeidas': actas_leidas,
        'actasContabilizadas': contab,
        'mesasConTodoContabilizado': sum(1 for m in mesas.values() if m['final']),
        'avisos': {'alerta': sum(1 for x in items if x['severidad'] == 'alerta'),
                   'revisar': sum(1 for x in items if x['severidad'] == 'revisar'), 'porTipo': por_tipo},
        'consultasTotales': st['consultas'],
        'bloqueado': blocked,
        'ritmo': f'1 consulta cada {DELAY:.2f} s',
        'fragmentos': sorted({c[:3] for c in mesas}),   # archivos mesas/NNN.json que existen (para «una mesa al azar»)
    }
    if resumen != {k: resumen_prev.get(k) for k in resumen}:
        write_json(os.path.join(OUT, 'resumen.json'), {**resumen, 'actualizado': now_iso()})
    write_json(os.path.join(OUT, 'anomalias.json'), {'total': len(items), 'items': items[:3000]})
    log(f'{len(mesas)} mesas, {actas_leidas} actas, {len(items)} avisos, explorado hasta {explorado}', '(bloqueado)' if blocked else '')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
