#!/usr/bin/env python3
"""Colector de resultados oficiales ONPE — ERM 2026.

Lee la API pública del portal https://resultadoelectoral.onpe.gob.pe
(presentacion-backend) y guarda:

  data/onpe/...          respuestas crudas de la ONPE, tal cual llegan
  data/latest.json       resumen compacto que usa el dashboard
  data/series/*.csv      evolución del conteo nacional por elección
  data/csv/*.csv         resultados por ámbito en CSV
  data/checks.json       verificaciones automáticas de consistencia
  data/manifest.json     hora de consulta + sha256 de cada archivo crudo
  data/status.json       estado del colector

Regla de oro: ningún número se inventa ni se recalcula para mostrarlo.
Todo lo que el dashboard muestra viene de un campo de la ONPE. Lo único
que se calcula son las verificaciones (sumas y comparaciones), y siempre
se publican con los números de ambos lados.

Solo usa la librería estándar de Python.
"""
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.environ.get('ERM_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
DATA = os.path.join(ROOT, 'data')
INBOX = os.environ.get('ERM_INBOX', '/srv/erm2026/inbox')
BASE = os.environ.get('ERM_BASE', 'https://resultadoelectoral.onpe.gob.pe/presentacion-backend')
PERU = timezone(timedelta(hours=-5))
DELAY = float(os.environ.get('ERM_DELAY', '0.3'))         # pausa entre pedidos: no saturar a la ONPE
DISTRICT_BUDGET = int(os.environ.get('ERM_DISTRICT_BUDGET', '160'))  # pedidos de distrito por corrida
PUSH = os.environ.get('ERM_PUSH', '1') == '1'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-PE,es;q=0.9',
    'Referer': 'https://resultadoelectoral.onpe.gob.pe/main/resumen',
    'Origin': 'https://resultadoelectoral.onpe.gob.pe',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
}

BLANK_RE = re.compile(r'BLANCO|NULO|IMPUGNAD', re.I)


def now_iso():
    return datetime.now(PERU).isoformat(timespec='seconds')


def log(*a):
    print(f'[{now_iso()}]', *a, flush=True)


class NotLive(Exception):
    """El portal responde, pero con la página 'Próximamente' (HTML) en vez de JSON."""


def get(path, tries=3):
    url = f'{BASE}/{path}'
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read()
                ctype = r.headers.get('content-type', '')
            time.sleep(DELAY)
            if 'json' not in ctype:
                raise NotLive(f'{path}: {ctype or "sin content-type"}')
            j = json.loads(body.decode('utf-8'))
            return j
        except NotLive:
            raise
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f'{path}: {last}')


def data_of(j):
    if isinstance(j, dict) and 'data' in j:
        return j['data']
    return j


def write_json(rel, obj, manifest=None, source=None):
    path = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=False)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(raw)
    os.replace(tmp, path)
    if manifest is not None:
        h = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        if (manifest.get(rel) or {}).get('sha256') != h:
            # 'cambio' = cuándo cambió por última vez el contenido que entregó la ONPE
            manifest[rel] = {'fuente': f'{BASE}/{source}' if source else None,
                             'cambio': now_iso(), 'sha256': h}


def read_json(rel, default=None):
    try:
        with open(os.path.join(DATA, rel), encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def slug(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def level_for(nombre):
    n = slug(nombre)
    if 'distrital' in n:
        return 3
    if 'provincial' in n:
        return 2
    return 1  # regionales (gobernador, consejeros) y cualquier otra: por departamento


def fetch_scope(eid, level, dep=None, prov=None, dist=None, manifest=None, prefix=''):
    """Totales + participantes de una elección en un ámbito. Devuelve (totales, participantes)."""
    if level == 0:
        q = f'idEleccion={eid}&tipoFiltro=eleccion'
    elif level == 1:
        q = f'idEleccion={eid}&tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&idUbigeoDepartamento={dep}'
    elif level == 2:
        q = (f'idEleccion={eid}&tipoFiltro=ubigeo_nivel_02&idAmbitoGeografico=1'
             f'&idUbigeoDepartamento={dep}&idUbigeoProvincia={prov}')
    else:
        q = (f'idEleccion={eid}&tipoFiltro=ubigeo_nivel_03&idAmbitoGeografico=1'
             f'&idUbigeoDepartamento={dep}&idUbigeoProvincia={prov}&idUbigeoDistrito={dist}')
    t = get(f'resumen-general/totales?{q}')
    p = get(f'resumen-general/participantes?{q}')
    write_json(f'{prefix}totales.json', t, manifest, f'resumen-general/totales?{q}')
    write_json(f'{prefix}participantes.json', p, manifest, f'resumen-general/participantes?{q}')
    return data_of(t) or {}, data_of(p) or []


def compact_participants(parts, limit=None):
    out = []
    for x in parts or []:
        out.append({
            'partido': x.get('nombreAgrupacionPolitica'),
            'codPartido': x.get('codigoAgrupacionPolitica'),
            'candidato': x.get('nombreCandidato'),
            'dni': x.get('dniCandidato'),
            'votos': x.get('totalVotosValidos'),
            'pctValidos': x.get('porcentajeVotosValidos'),
            'pctEmitidos': x.get('porcentajeVotosEmitidos'),
        })
    out.sort(key=lambda r: (r['votos'] is None, -(r['votos'] or 0)))
    return out[:limit] if limit else out


def compact_totals(t):
    keys = ['actasContabilizadas', 'contabilizadas', 'totalActas', 'participacionCiudadana',
            'actasEnviadasJee', 'enviadasJee', 'actasPendientesJee', 'pendientesJee',
            'totalVotosEmitidos', 'totalVotosValidos', 'fechaActualizacion']
    return {k: t.get(k) for k in keys if isinstance(t, dict) and k in t}


# ---------------------------------------------------------------- verificaciones

def check_scope(checks, label, totals, parts):
    """Verificaciones deterministas. Se publican con ambos números; nunca son acusaciones."""
    if not totals:
        return
    tv = totals.get('totalVotosValidos')
    if tv is not None and parts:
        s = sum((p.get('totalVotosValidos') or 0) for p in parts
                if not BLANK_RE.search(str(p.get('nombreAgrupacionPolitica') or '')))
        if s != tv:
            checks.append({'tipo': 'suma-votos-validos', 'ambito': label, 'severidad': 'revisar',
                           'detalle': f'La suma de votos de las organizaciones ({s:,}) no coincide con '
                                      f'totalVotosValidos ({tv:,}). Diferencia: {s - tv:+,}.',
                           'valores': {'suma_participantes': s, 'totalVotosValidos': tv}})
        for p in parts:
            v, pct = p.get('totalVotosValidos'), p.get('porcentajeVotosValidos')
            if v is not None and pct is not None and tv:
                calc = 100 * v / tv
                if abs(calc - pct) > 0.06:
                    checks.append({'tipo': 'porcentaje', 'ambito': label, 'severidad': 'revisar',
                                   'detalle': f'{p.get("nombreAgrupacionPolitica")}: ONPE publica '
                                              f'{pct}% y el cálculo da {calc:.3f}%.',
                                   'valores': {'votos': v, 'pct_onpe': pct, 'pct_calculado': round(calc, 3)}})
    c, n = totals.get('contabilizadas'), totals.get('totalActas')
    if c is not None and n is not None and c > n:
        checks.append({'tipo': 'actas', 'ambito': label, 'severidad': 'alerta',
                       'detalle': f'Actas contabilizadas ({c:,}) mayores que el total de actas ({n:,}).'})
    em, va = totals.get('totalVotosEmitidos'), totals.get('totalVotosValidos')
    if em is not None and va is not None and va > em:
        checks.append({'tipo': 'votos', 'ambito': label, 'severidad': 'alerta',
                       'detalle': f'Votos válidos ({va:,}) mayores que emitidos ({em:,}).'})


def check_monotonic(checks, label, prev, cur):
    """Entre una actualización y la siguiente, los acumulados no deberían bajar."""
    if not prev or not cur:
        return
    if (prev.get('fechaActualizacion') or 0) >= (cur.get('fechaActualizacion') or 0):
        return
    for k in ('contabilizadas', 'totalVotosEmitidos', 'totalVotosValidos'):
        a, b = prev.get(k), cur.get(k)
        if a is not None and b is not None and b < a:
            checks.append({'tipo': 'retroceso', 'ambito': label, 'severidad': 'alerta',
                           'detalle': f'{k} bajó de {a:,} a {b:,} entre dos actualizaciones de la ONPE.',
                           'valores': {'antes': a, 'despues': b,
                                       'fecha_antes': prev.get('fechaActualizacion'),
                                       'fecha_despues': cur.get('fechaActualizacion')}})


# ---------------------------------------------------------------- bots

def import_bots():
    """El exportador de Windows deja la bitácora de los bots en INBOX/bots; la copiamos a data/bots."""
    src = os.path.join(INBOX, 'bots')
    if not os.path.isdir(src):
        return
    dst = os.path.join(DATA, 'bots')
    os.makedirs(dst, exist_ok=True)
    for name in ('feed.json', 'schedule.json'):
        s = os.path.join(src, name)
        if os.path.isfile(s):
            try:
                json.load(open(s, encoding='utf-8'))  # solo copiamos JSON válido
                shutil.copyfile(s, os.path.join(dst, name))
            except ValueError:
                log('bots: JSON inválido en', name)


# ---------------------------------------------------------------- git

def git(*args, check=True):
    env = dict(os.environ)
    key = os.environ.get('ERM_DEPLOY_KEY')
    if key:
        env['GIT_SSH_COMMAND'] = f'ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
    return subprocess.run(['git', '-C', ROOT, *args], env=env, check=check,
                          capture_output=True, text=True)


def publish(summary):
    if not os.path.isdir(os.path.join(ROOT, '.git')):
        return
    git('add', '-A', 'data')
    if git('diff', '--cached', '--quiet', check=False).returncode == 0:
        return
    git('commit', '-q', '-m', f'datos: {summary}')
    if PUSH:
        r = git('push', '-q', 'origin', 'HEAD', check=False)
        if r.returncode != 0:
            git('pull', '-q', '--rebase', 'origin', 'main', check=False)
            r = git('push', '-q', 'origin', 'HEAD', check=False)
            if r.returncode != 0:
                log('push falló:', r.stderr.strip()[:300])


# ---------------------------------------------------------------- principal

def main():
    os.makedirs(DATA, exist_ok=True)
    import_bots()
    status = read_json('status.json', {}) or {}
    status['consultado'] = now_iso()
    manifest = read_json('manifest.json', {}) or {}

    try:
        proc_raw = get('proceso/proceso-electoral-activo')
    except NotLive as e:
        status.update({'estado': 'esperando', 'detalle': 'El portal de la ONPE todavía muestra "Próximamente". '
                       'No hay resultados oficiales publicados.', 'error': None})
        write_json('status.json', status)
        log('esperando:', e)
        publish('estado del portal')
        return
    except RuntimeError as e:
        status.update({'estado': 'error', 'detalle': 'No se pudo consultar a la ONPE.', 'error': str(e)[:300]})
        write_json('status.json', status)
        log('error:', e)
        publish('estado del portal')
        return

    proc = data_of(proc_raw) or {}
    write_json('onpe/proceso-activo.json', proc_raw, manifest, 'proceso/proceso-electoral-activo')
    pid = proc.get('id')
    nombre_proc = str(proc.get('nombre') or '')
    # Seguridad: si el portal sigue mostrando las Generales de abril, no mezclamos datos.
    if pid is None or re.search(r'GENERALES', nombre_proc, re.I):
        status.update({'estado': 'esperando',
                       'detalle': f'El portal todavía tiene activo otro proceso ({nombre_proc or "sin nombre"}).',
                       'proceso': proc, 'error': None})
        write_json('status.json', status)
        write_json('manifest.json', manifest)
        publish('estado del portal')
        log('proceso activo no es ERM:', nombre_proc)
        return

    el_raw = get(f'proceso/{pid}/elecciones')
    write_json('onpe/elecciones.json', el_raw, manifest, f'proceso/{pid}/elecciones')
    try:
        write_json('onpe/fechas.json', get('fecha/listarFecha'), manifest, 'fecha/listarFecha')
    except (RuntimeError, NotLive):
        pass
    for path, rel in (('participacion-ciudadana/totales?tipoFiltro=total', 'onpe/participacion-totales.json'),
                      ('mesa/totales?tipoFiltro=eleccion', 'onpe/mesas-totales.json')):
        try:
            write_json(rel, get(path), manifest, path)
        except (RuntimeError, NotLive):
            pass

    elecciones = [e for e in (data_of(el_raw) or []) if (e.get('idEleccion') or 0) > 0]
    prev_latest = read_json('latest.json', {}) or {}
    prev_by_id = {e['id']: e for e in prev_latest.get('elecciones', [])}
    checks = []
    latest = {'fuente': 'https://resultadoelectoral.onpe.gob.pe',
              'proceso': {k: proc.get(k) for k in ('id', 'nombre', 'acronimo', 'fechaProceso')},
              'elecciones': []}
    crawl = read_json('crawl-state.json', {}) or {}

    for e in elecciones:
        eid = e['idEleccion']
        nombre = e.get('descripcion') or e.get('nombre')
        lvl = level_for(f'{e.get("nombre")} {e.get("descripcion")}')
        pre = f'onpe/eleccion-{eid}/'
        t, p = fetch_scope(eid, 0, manifest=manifest, prefix=pre + 'nacional-')
        ct = compact_totals(t)
        check_scope(checks, f'{nombre} · Nacional', t, p)
        prev = prev_by_id.get(eid, {})
        check_monotonic(checks, f'{nombre} · Nacional', prev.get('totales'), ct)
        item = {'id': eid, 'nombre': nombre, 'menu': e.get('nombre'), 'nivel': lvl, 'totales': ct,
                'participantes': compact_participants(p, 40), 'departamentos': prev.get('departamentos', [])}

        changed = ct.get('fechaActualizacion') != (prev.get('totales') or {}).get('fechaActualizacion')
        if changed or not item['departamentos']:
            # Departamentos: se vuelven a pedir solo cuando la ONPE actualiza el nacional.
            deps_raw = get(f'ubigeos/departamentos?idEleccion={eid}&idAmbitoGeografico=1')
            write_json(pre + 'departamentos-lista.json', deps_raw, manifest,
                       f'ubigeos/departamentos?idEleccion={eid}&idAmbitoGeografico=1')
            deps = []
            for d in data_of(deps_raw) or []:
                code = d.get('ubigeo') or d.get('idUbigeo') or d.get('codigo')
                name = d.get('nombre') or d.get('descripcion')
                if not code:
                    continue
                dt, dp = fetch_scope(eid, 1, dep=code, manifest=manifest, prefix=f'{pre}dep-{code}-')
                check_scope(checks, f'{nombre} · {name}', dt, dp)
                deps.append({'ubigeo': code, 'nombre': name, 'totales': compact_totals(dt),
                             'participantes': compact_participants(dp, None if lvl == 1 else 5)})
            item['departamentos'] = deps
            if ct:
                append_series(eid, ct)
            write_csv(eid, nombre, item)
        if lvl >= 2:
            item['provincias_resumen'] = crawl_lower(eid, nombre, lvl, item['departamentos'], manifest,
                                                     crawl, changed, checks)
        latest['elecciones'].append(item)

    write_json('crawl-state.json', crawl)
    write_json('latest.json', latest)
    write_json('checks.json', {'total': len(checks), 'items': checks})
    if checks:
        with open(os.path.join(DATA, 'checks-log.ndjson'), 'a', encoding='utf-8') as f:
            for c in checks:
                f.write(json.dumps({'visto': now_iso(), **c}, ensure_ascii=False) + '\n')
    write_json('manifest.json', manifest)
    status.update({'estado': 'en-vivo', 'detalle': 'Resultados oficiales publicados por la ONPE.',
                   'proceso': latest['proceso'], 'error': None,
                   'ultimaActualizacionOnpe': max([(x['totales'] or {}).get('fechaActualizacion') or 0
                                                   for x in latest['elecciones']] or [0])})
    write_json('status.json', status)
    ts = status['ultimaActualizacionOnpe']
    when = datetime.fromtimestamp(ts / 1000, PERU).strftime('%H:%M') if ts else '—'
    publish(f'ONPE corte {when}')
    log('ok', len(latest['elecciones']), 'elecciones,', len(checks), 'verificaciones')


def crawl_lower(eid, nombre, lvl, deps, manifest, crawl, changed, checks):
    """Provincias (y distritos) se recorren por tandas para no saturar a la ONPE."""
    st = crawl.setdefault(str(eid), {'provincias': {}, 'distritos': {}, 'cola': []})
    pre = f'onpe/eleccion-{eid}/'
    if changed or not st['cola']:
        cola = []
        for d in deps:
            q = f'ubigeos/provincias?idEleccion={eid}&idAmbitoGeografico=1&idUbigeoDepartamento={d["ubigeo"]}'
            try:
                provs = data_of(get(q)) or []
            except (RuntimeError, NotLive):
                continue
            for pv in provs:
                pc = pv.get('ubigeo') or pv.get('idUbigeo')
                if not pc:
                    continue
                cola.append(['p', d['ubigeo'], pc, None, f'{d["nombre"]} / {pv.get("nombre")}'])
                if lvl == 3:
                    try:
                        ds = data_of(get(f'ubigeos/distritos?idEleccion={eid}&idAmbitoGeografico=1&idUbigeoProvincia={pc}')) or []
                    except (RuntimeError, NotLive):
                        ds = []
                    for di in ds:
                        dc = di.get('ubigeo') or di.get('idUbigeo')
                        if dc:
                            cola.append(['d', d['ubigeo'], pc, dc, f'{d["nombre"]} / {pv.get("nombre")} / {di.get("nombre")}'])
        st['cola'] = cola
    budget = DISTRICT_BUDGET
    while st['cola'] and budget > 0:
        kind, dep, prov, dist, label = st['cola'].pop(0)
        try:
            if kind == 'p':
                t, p = fetch_scope(eid, 2, dep, prov, manifest=manifest, prefix=f'{pre}prov-{prov}-')
                st['provincias'][prov] = {'nombre': label, 'totales': compact_totals(t),
                                          'participantes': compact_participants(p, 6)}
            else:
                t, p = fetch_scope(eid, 3, dep, prov, dist, manifest=manifest, prefix=f'{pre}dist-{dist}-')
                st['distritos'][dist] = {'nombre': label, 'totales': compact_totals(t),
                                         'participantes': compact_participants(p, 6)}
            check_scope(checks, f'{nombre} · {label}', t, p)
        except (RuntimeError, NotLive) as e:
            log('lower:', e)
        budget -= 2
    write_json(f'ambitos/eleccion-{eid}.json', {'eleccion': nombre,
                                               'provincias': st['provincias'], 'distritos': st['distritos'],
                                               'pendientes': len(st['cola'])})
    return {'provincias': len(st['provincias']), 'distritos': len(st['distritos']), 'pendientes': len(st['cola'])}


def append_series(eid, ct):
    path = os.path.join(DATA, 'series', f'eleccion-{eid}.csv')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cols = ['fechaActualizacion', 'hora_peru', 'actasContabilizadas', 'contabilizadas', 'totalActas',
            'participacionCiudadana', 'totalVotosEmitidos', 'totalVotosValidos']
    new = not os.path.exists(path)
    if not new:
        with open(path, encoding='utf-8') as f:
            last = f.read().strip().splitlines()[-1].split(',')[0]
        if last == str(ct.get('fechaActualizacion')):
            return
    with open(path, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if new:
            w.writerow(cols)
        ts = ct.get('fechaActualizacion')
        hora = datetime.fromtimestamp(ts / 1000, PERU).isoformat(timespec='seconds') if ts else ''
        w.writerow([ts, hora] + [ct.get(c) for c in cols[2:]])


def write_csv(eid, nombre, item):
    path = os.path.join(DATA, 'csv', f'eleccion-{eid}-departamentos.csv')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['eleccion', 'ubigeo', 'departamento', 'partido', 'candidato', 'dni', 'votos',
                    'pct_validos', 'actas_contabilizadas_pct', 'fecha_actualizacion_onpe'])
        for d in item['departamentos']:
            for p in d['participantes']:
                w.writerow([nombre, d['ubigeo'], d['nombre'], p['partido'], p['candidato'], p['dni'],
                            p['votos'], p['pctValidos'], d['totales'].get('actasContabilizadas'),
                            d['totales'].get('fechaActualizacion')])


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # nunca dejamos el status mintiendo: si algo falla, se dice
        st = read_json('status.json', {}) or {}
        st.update({'estado': 'error', 'consultado': now_iso(), 'error': f'{type(e).__name__}: {e}'[:300]})
        write_json('status.json', st)
        log('fallo:', repr(e))
        sys.exit(1)
