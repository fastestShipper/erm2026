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
AMBITOS_STATE = 'crawl-ambitos.json'                              # estado del recorrido de provincias y distritos
LOWER_SECONDS = float(os.environ.get('ERM_AMBITOS_BUDGET', '100'))  # segundos por corrida de `--ambitos`
LOWER_DELAY = float(os.environ.get('ERM_AMBITOS_DELAY', '0.5'))    # pausa entre pedidos: el corte nacional tiene prioridad
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
MESA_MAX = 300    # máximo de electores por mesa de sufragio (Ley Orgánica de Elecciones, art. 52)
BACKOFF = os.path.join(ROOT, 'local', 'onpe-backoff.json')   # pausa compartida con actas.py si la ONPE bloquea


def now_iso():
    return datetime.now(PERU).isoformat(timespec='seconds')


def log(*a):
    print(f'[{now_iso()}]', *a, flush=True)


class NotLive(Exception):
    """El portal responde, pero con la página 'Próximamente' (HTML) en vez de JSON."""


class Blocked(Exception):
    """La ONPE (CloudFront/AWS WAF) rechazó o desafió el pedido. No se intenta evadir."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def get(path, tries=3):
    url = f'{BASE}/{path}'
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with _opener.open(req, timeout=25) as r:
                body = r.read()
                ctype = r.headers.get('content-type', '')
                waf = r.headers.get('x-amzn-waf-action')
            time.sleep(DELAY)
            if waf:
                raise Blocked(f'{path}: AWS WAF pide {waf}')
            if 'json' not in ctype:
                raise NotLive(f'{path}: {ctype or "sin content-type"}')
            j = json.loads(body.decode('utf-8'))
            return j
        except (NotLive, Blocked):
            raise
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                raise NotLive(f'{path}: redirige a {e.headers.get("location", "?")}')
            if e.code in (401, 403, 405, 429) or e.headers.get('x-amzn-waf-action'):
                raise Blocked(f'{path}: HTTP {e.code}')
            last = e
            time.sleep(2 * (i + 1))
        except (urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f'{path}: {last}')


def data_of(j):
    if isinstance(j, dict) and 'data' in j:
        return j['data']
    return j


def write_json(rel, obj, manifest=None, source=None, indent=1):
    path = os.path.join(DATA, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = json.dumps(obj, ensure_ascii=False, indent=indent, sort_keys=False, separators=None if indent else (',', ':'))
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


def kind_for(nombre, lvl):
    """gobernador | consejeros | provincial | distrital. En consejeros no hay un único primer lugar."""
    if lvl == 3:
        return 'distrital'
    if lvl == 2:
        return 'provincial'
    return 'consejeros' if 'consej' in slug(nombre) else 'gobernador'


_RECHECK = {'siguen': 0}


def _same_cut(t, p):
    """True si los votos de las organizaciones suman los válidos del total (los dos pedidos son del mismo corte)."""
    tv = (data_of(t) or {}).get('totalVotosValidos') if isinstance(data_of(t), dict) else None
    parts = data_of(p) or []
    if tv is None or not isinstance(parts, list) or not parts:
        return True
    return tv == sum((x.get('totalVotosValidos') or 0) for x in parts
                     if isinstance(x, dict) and not BLANK_RE.search(str(x.get('nombreAgrupacionPolitica') or '')))


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
    if _RECHECK['siguen'] < 5 and not _same_cut(t, p):
        # Los dos pedidos pueden caer a cada lado de una actualización de la ONPE. Se repiten una vez
        # para no reportar como diferencia lo que solo es un cambio de corte entre un pedido y otro.
        # Si la diferencia sigue ahí varias veces, es real: se deja de repetir y se reporta.
        time.sleep(1.5)
        t = get(f'resumen-general/totales?{q}')
        p = get(f'resumen-general/participantes?{q}')
        if not _same_cut(t, p):
            _RECHECK['siguen'] += 1
    write_json(f'{prefix}totales.json', t, manifest, f'resumen-general/totales?{q}')
    write_json(f'{prefix}participantes.json', p, manifest, f'resumen-general/participantes?{q}')
    return data_of(t) or {}, data_of(p) or []


def compact_participants(parts, limit=None):
    """Organizaciones ordenadas por votos. Los votos en blanco, nulos e impugnados van al final con
    'especial': nunca cuentan como «primer lugar». No se copia el DNI de los candidatos (sigue en la
    respuesta original de la ONPE, en data/onpe/)."""
    orgs, special = [], []
    for x in parts or []:
        name = x.get('nombreAgrupacionPolitica')
        row = {
            'partido': name,
            'codPartido': x.get('codigoAgrupacionPolitica'),
            'candidato': x.get('nombreCandidato'),
            'votos': x.get('totalVotosValidos'),
            'pctValidos': x.get('porcentajeVotosValidos'),
            'pctEmitidos': x.get('porcentajeVotosEmitidos'),
        }
        if BLANK_RE.search(str(name or '')):
            row['especial'] = True
            row['candidato'] = None
            special.append(row)
        else:
            orgs.append(row)
    orgs.sort(key=lambda r: (r['votos'] is None, -(r['votos'] or 0)))
    return (orgs[:limit] if limit else orgs) + special


def contienda(totals, parts):
    """Primer y segundo lugar de un ámbito, y si el primer lugar todavía puede cambiar.

    No es una proyección ni una estimación: es una cota. Cada mesa tiene como máximo 300 electores
    (Ley Orgánica de Elecciones, art. 52), así que en las actas que faltan no puede haber más de
    «actas que faltan × 300» votos. Si la diferencia entre el primero y el segundo es mayor que
    eso, el orden ya no cambia con lo que falta contar. No dice quién gana: eso lo proclama el JNE,
    y en la elección regional hay segunda vuelta si nadie pasa el 30 % de los votos válidos."""
    orgs = [p for p in parts or [] if not p.get('especial') and p.get('votos') is not None]
    if not orgs or not totals:
        return None
    keys = ('partido', 'codPartido', 'candidato', 'votos', 'pctValidos')
    a, b = orgs[0], (orgs[1] if len(orgs) > 1 else None)
    out = {'primero': {k: a.get(k) for k in keys}}
    dif = (a['votos'] or 0) - ((b['votos'] or 0) if b else 0)
    if b:
        out['segundo'] = {k: b.get(k) for k in keys}
    out['diferencia'] = dif
    total, cont = totals.get('totalActas'), totals.get('contabilizadas')
    if isinstance(total, (int, float)) and isinstance(cont, (int, float)) and total >= cont >= 0:
        faltan = int(total - cont)
        out['actasFaltan'] = faltan
        out['votosMaxFaltan'] = faltan * MESA_MAX
        out['puedeCambiar'] = not (cont > 0 and (a['votos'] or 0) > 0 and dif > faltan * MESA_MAX)
    return out


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
    # stdin=DEVNULL: desde el Programador de tareas no hay consola y heredar stdin falla (WinError 6)
    return subprocess.run(['git', '-C', ROOT, *args], env=env, check=check,
                          capture_output=True, text=True, stdin=subprocess.DEVNULL)


def publish(summary):
    """Sube los datos al repositorio. Si git falla, se anota y se sigue: nunca debe tumbar el tablero."""
    try:
        _publish(summary)
    except Exception as e:
        log('git falló (los datos del sitio no se ven afectados):', repr(e)[:200])


def _publish(summary):
    if not os.path.isdir(os.path.join(ROOT, '.git')):
        return
    git('add', '-A', 'data')
    if git('diff', '--cached', '--quiet', check=False).returncode == 0:
        return
    git('commit', '-q', '-m', f'datos: {summary}', '--', 'data')   # solo data/: no arrastra código en preparación
    if PUSH:
        r = git('push', '-q', 'origin', 'HEAD', check=False)
        if r.returncode != 0:
            git('pull', '-q', '--rebase', 'origin', 'main', check=False)
            r = git('push', '-q', 'origin', 'HEAD', check=False)
            if r.returncode != 0:
                log('push falló:', r.stderr.strip()[:300])


# ---------------------------------------------------------------- principal

def ensure_placeholders():
    """El tablero consulta estos archivos cada minuto. Si no existen, cada visita genera
    respuestas 404 y el firewall del servidor (CrowdSec) puede confundirlo con un escaneo y
    bloquear IPs compartidas (CGNAT). Por eso siempre existen, aunque sea vacíos."""
    for rel, empty in (('latest.json', {'fuente': 'https://resultadoelectoral.onpe.gob.pe', 'elecciones': []}),
                       ('checks.json', {'total': 0, 'items': []}),
                       ('hallazgos.json', {'items': []}),
                       ('actas/resumen.json', {'mesasEncontradas': 0, 'actasLeidas': 0, 'actasContabilizadas': 0, 'avisos': {'alerta': 0, 'revisar': 0}}),
                       ('actas/anomalias.json', {'total': 0, 'items': []}),
                       ('boletines.json', {'items': []})):
        if empty is not None and not os.path.exists(os.path.join(DATA, rel)):
            write_json(rel, empty)


def main():
    os.makedirs(DATA, exist_ok=True)
    ensure_placeholders()
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
    except Blocked as e:
        status.update({'estado': 'bloqueado', 'detalle': 'El portal de la ONPE está rechazando nuestras consultas en este momento. '
                       'No usamos trucos para saltar sus protecciones: el tablero se actualiza solo cuando vuelva a responder. '
                       'Mientras tanto, consulta directamente resultadoelectoral.onpe.gob.pe.', 'error': str(e)[:300]})
        write_json('status.json', status)
        log('bloqueado:', e)
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
    except (RuntimeError, NotLive, Blocked):
        pass
    for path, rel in (('participacion-ciudadana/totales?tipoFiltro=total', 'onpe/participacion-totales.json'),
                      ('mesa/totales?tipoFiltro=eleccion', 'onpe/mesas-totales.json')):
        try:
            write_json(rel, get(path), manifest, path)
        except (RuntimeError, NotLive, Blocked):
            pass

    elecciones = [e for e in (data_of(el_raw) or []) if (e.get('idEleccion') or 0) > 0]
    prev_latest = read_json('latest.json', {}) or {}
    prev_by_id = {e['id']: e for e in prev_latest.get('elecciones', [])}
    checks = []
    latest = {'fuente': 'https://resultadoelectoral.onpe.gob.pe',
              'proceso': {k: proc.get(k) for k in ('id', 'nombre', 'acronimo', 'fechaProceso')},
              'elecciones': []}
    crawl = read_json('crawl-state.json', {}) or {}
    ambitos = read_json(AMBITOS_STATE, {}) or {}      # lo llena `collect.py --ambitos`
    # Observaciones vigentes por ámbito: cada una se reemplaza cuando ese ámbito se vuelve a consultar.
    # Los retrocesos son hechos entre dos cortes: una vez vistos, se quedan.
    vigentes = crawl.setdefault('_checks', {})
    retrocesos = crawl.setdefault('_retrocesos', [])
    nuevos = []

    def revisar(label, totals, parts, prev_totals=None, cur_totals=None):
        found = []
        check_scope(found, label, totals, parts)
        if found != vigentes.get(label):
            nuevos.extend(found)
        if found:
            vigentes[label] = found
        else:
            vigentes.pop(label, None)
        back = []
        check_monotonic(back, label, prev_totals, cur_totals)
        retrocesos.extend(back)
        nuevos.extend(back)

    for e in elecciones:
        eid = e['idEleccion']
        nombre = e.get('descripcion') or e.get('nombre')
        lvl = level_for(f'{e.get("nombre")} {e.get("descripcion")}')
        pre = f'onpe/eleccion-{eid}/'
        t, p = fetch_scope(eid, 0, manifest=manifest, prefix=pre + 'nacional-')
        ct = compact_totals(t)
        prev = prev_by_id.get(eid, {})
        revisar(f'{nombre} · Nacional', t, p, prev.get('totales'), ct)
        tipo = kind_for(f'{e.get("nombre")} {e.get("descripcion")}', lvl)
        item = {'id': eid, 'nombre': nombre, 'menu': e.get('nombre'), 'nivel': lvl, 'tipo': tipo, 'totales': ct,
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
                revisar(f'{nombre} · {name}', dt, dp)
                dep_item = {'ubigeo': code, 'nombre': name, 'totales': compact_totals(dt),
                            'participantes': compact_participants(dp, None if lvl == 1 else 5)}
                if tipo == 'gobernador':
                    dep_item['contienda'] = contienda(dep_item['totales'], dep_item['participantes'])
                deps.append(dep_item)
            item['departamentos'] = deps
            if ct:
                append_series(eid, ct)
            write_csv(eid, nombre, item)
        if lvl >= 2:
            item['provincias_resumen'] = lower_summary(ambitos.get(str(eid)), lvl)
        latest['elecciones'].append(item)

    checks = retrocesos[-200:] + [c for items in vigentes.values() for c in items]
    # observaciones de provincias y distritos (las anota el recorrido de ámbitos)
    lower = [c for items in ((read_json('checks-ambitos.json', {}) or {}).get('porAmbito') or {}).values() for c in items]
    try:
        if not os.path.exists(os.path.join(DATA, 'ambitos', 'indice.json')):
            write_places_index(latest, ambitos)
        view = {**ambitos, '_lideres': crawl.setdefault('_lideres', {}), '_cambios': crawl.setdefault('_cambios', [])}
        boletin(latest, view, checks + lower)
    except Exception as e:  # el boletín es un extra: nunca detiene la publicación de resultados
        log('boletín:', repr(e))
    write_json('crawl-state.json', crawl, indent=None)
    write_json('latest.json', latest)
    write_json('checks.json', {'total': len(checks) + len(lower), 'items': checks + lower})
    if nuevos:   # bitácora: cada observación se anota una vez, cuando aparece o cambia
        with open(os.path.join(DATA, 'checks-log.ndjson'), 'a', encoding='utf-8') as f:
            for c in nuevos:
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


def backoff_active():
    """True mientras dure la pausa que se toma cuando la ONPE rechaza consultas (la comparte actas.py)."""
    try:
        with open(BACKOFF, encoding='utf-8') as f:
            return time.time() < json.load(f).get('hasta', 0)
    except (FileNotFoundError, ValueError):
        return False


def note_block(reason):
    """La ONPE rechazó una consulta: se pausan los recorridos largos (5, 10, 20… hasta 40 minutos).
    El corte nacional se sigue consultando; no se intenta saltar el bloqueo."""
    prev = {}
    try:
        with open(BACKOFF, encoding='utf-8') as f:
            prev = json.load(f)
    except (FileNotFoundError, ValueError):
        pass
    n = prev.get('n', 0) + 1 if time.time() - prev.get('visto', 0) < 3600 else 1
    minutes = min(40, 5 * 2 ** (n - 1))
    os.makedirs(os.path.dirname(BACKOFF), exist_ok=True)
    with open(BACKOFF, 'w', encoding='utf-8') as f:
        json.dump({'hasta': time.time() + 60 * minutes, 'visto': time.time(), 'n': n, 'motivo': str(reason)[:200]}, f)
    log(f'la ONPE rechazó consultas ({reason}); los recorridos largos esperan {minutes} min')


def list_scopes(eid, lvl, deps, st, deadline):
    """Arma la lista de lugares de una elección: provincias (alcalde provincial) o distritos (alcalde
    distrital). Son unos 220 pedidos, así que se hace por departamentos: si la corrida se queda sin
    tiempo, la siguiente continúa donde quedó. Devuelve True cuando la lista está completa."""
    part = st.setdefault('listando', {'hechos': [], 'lugares': []})
    for d in deps:
        if d['ubigeo'] in part['hechos']:
            continue
        if time.time() > deadline:
            return False
        found = []
        provs = data_of(get(f'ubigeos/provincias?idEleccion={eid}&idAmbitoGeografico=1&idUbigeoDepartamento={d["ubigeo"]}')) or []
        for pv in provs:
            pc = pv.get('ubigeo') or pv.get('idUbigeo')
            if not pc:
                continue
            if lvl == 2:
                found.append([d['ubigeo'], pc, None, f'{d["nombre"]} / {pv.get("nombre")}'])
                continue
            ds = data_of(get(f'ubigeos/distritos?idEleccion={eid}&idAmbitoGeografico=1&idUbigeoProvincia={pc}')) or []
            for di in ds:
                dc = di.get('ubigeo') or di.get('idUbigeo')
                if dc:
                    found.append([d['ubigeo'], pc, dc, f'{d["nombre"]} / {pv.get("nombre")} / {di.get("nombre")}'])
        part['lugares'].extend(found)
        part['hechos'].append(d['ubigeo'])
    st['todos'] = part['lugares']
    st['listado'] = time.time()
    st['cola'] = [list(x) for x in st['todos']]
    st.pop('listando', None)
    return True


def crawl_lower(eid, nombre, lvl, deps, manifest, crawl, on_checks, budget, deadline, wanted=()):
    """Una tanda del recorrido de provincias (alcalde provincial) o distritos (alcalde distrital).

    La lista de lugares se arma una vez y se recorre en ronda: todos los lugares se refrescan, y un
    tercio de cada tanda va a los que tienen más actas, para que las ciudades grandes se actualicen
    más seguido. Cada lugar guarda la hora en que se consultó ('visto'). Devuelve cuántos visitó."""
    st = crawl.setdefault(str(eid), {})
    for k, v in (('provincias', {}), ('distritos', {}), ('cola', []), ('todos', []), ('listado', 0), ('grande', 0)):
        st.setdefault(k, v)
    pre = f'onpe/eleccion-{eid}/'
    key = 'distritos' if lvl == 3 else 'provincias'
    store = st[key]
    code_of = (lambda x: x[2]) if lvl == 3 else (lambda x: x[1])
    touched, seen = set(), set()

    def visit(x):
        dep, prov, dist, label = x
        if lvl == 3:
            t, p = fetch_scope(eid, 3, dep, prov, dist, manifest=manifest, prefix=f'{pre}dist-{dist}-')
        else:
            t, p = fetch_scope(eid, 2, dep, prov, manifest=manifest, prefix=f'{pre}prov-{prov}-')
        ct, cp = compact_totals(t), compact_participants(p, 8)
        store[code_of(x)] = {'nombre': label, 'dep': dep, 'prov': prov, 'totales': ct, 'participantes': cp,
                             'contienda': contienda(ct, cp), 'visto': now_iso()}
        touched.add(dep)
        found = []
        check_scope(found, f'{nombre} · {label}', t, p)
        on_checks(f'{nombre} · {label}', found)

    def run(queue_next, limit):
        n = 0
        while n < limit and time.time() < deadline:
            x = queue_next()
            if x is None:
                break
            if code_of(x) in seen:
                continue
            seen.add(code_of(x))
            try:
                visit(x)
            except (RuntimeError, NotLive) as e:
                log('ámbito:', e)
            n += 1
        return n

    try:
        if not st['todos'] or time.time() - st['listado'] > 12 * 3600:
            list_scopes(eid, lvl, deps, st, deadline)   # mientras se rearma, se sigue con la lista anterior
        if not st['todos']:
            return 0
        # 0) los lugares que el público está mirando ahora, si llevan más de 90 s sin consultarse
        by_code = {str(code_of(x)): x for x in st['todos']}
        asked = [by_code[c] for c in map(str, wanted) if c in by_code and _age(store.get(code_of(by_code[c]))) > 90]

        def next_asked():
            return asked.pop(0) if asked else None

        done_asked = run(next_asked, max(1, budget // 4))
        # 1) los lugares con más actas, en ronda (un tercio de la tanda)
        big = sorted((x for x in st['todos'] if code_of(x) in store),
                     key=lambda x: -((store[code_of(x)].get('totales') or {}).get('totalActas') or 0))[:40]

        def next_big():
            if not big or len(seen) >= len(big):
                return None
            st['grande'] += 1
            return big[st['grande'] % len(big)]

        def next_all():
            if len(seen) >= len(st['todos']):
                return None                      # ya se visitaron todos en esta tanda
            if not st['cola']:
                st['cola'] = [list(x) for x in st['todos']]
            return st['cola'].pop(0)

        scopes = max(1, budget // 2)
        done = done_asked
        done += run(next_big, scopes // 3) if len(store) >= len(st['todos']) * 0.5 else 0
        done += run(next_all, max(0, scopes - done))
    except Blocked as e:
        note_block(e)
        done = len(seen)
    except (RuntimeError, NotLive) as e:
        log('ámbito (lista):', e)
        done = len(seen)

    # un archivo por departamento: es lo que carga «Mi zona»
    for dep in touched:
        write_json(f'ambitos/eleccion-{eid}/{dep}.json',
                   {'eleccion': nombre, 'nivel': lvl, key: {c: v for c, v in store.items() if v.get('dep') == dep}}, indent=None)
    return done


def _age(entry):
    """Segundos desde que se consultó un lugar (infinito si nunca)."""
    try:
        return time.time() - datetime.fromisoformat(entry['visto']).timestamp()
    except (TypeError, KeyError, ValueError):
        return float('inf')


def wanted_codes(crawl, els):
    """Lugares que el público está mirando (local/zonas.json, lo deja deploy/run-ambitos.sh), por elección.
    Quien mira un distrito ve también la elección de su provincia: se pide también esa provincia."""
    try:
        with open(os.path.join(ROOT, 'local', 'zonas.json'), encoding='utf-8') as f:
            z = json.load(f)
        if time.time() - datetime.fromisoformat(z['actualizado'].replace('Z', '+00:00')).timestamp() > 900:
            return {}
        zonas = sorted((z.get('zonas') or {}).items(), key=lambda kv: -kv[1])
    except (OSError, ValueError, KeyError, AttributeError):
        return {}
    dist = [k.split('-', 1)[1] for k, _ in zonas if k.startswith('3-')]
    prov = [k.split('-', 1)[1] for k, _ in zonas if k.startswith('2-')]
    prov_of = {}
    for e in els:
        if e['nivel'] == 3:
            prov_of = {str(x[2]): str(x[1]) for x in (crawl.get(str(e['id'])) or {}).get('todos') or []}
    prov += [prov_of[d] for d in dist if d in prov_of and prov_of[d] not in prov]
    return {e['id']: (dist if e['nivel'] == 3 else prov) for e in els}


def lower_summary(st, lvl):
    st = st or {}
    todos = len(st.get('todos') or [])
    have = len((st.get('distritos') if lvl == 3 else st.get('provincias')) or {})
    return {'provincias': len(st.get('provincias') or {}), 'distritos': len(st.get('distritos') or {}),
            'pendientes': max(0, todos - have), 'total': todos}


def lower_main():
    """Recorrido de provincias y distritos (`collect.py --ambitos`).

    Corre aparte del ciclo principal, con su propio ritmo, para que el corte nacional y regional se
    siga publicando cada 2 minutos mientras los ~2,100 lugares se van refrescando en ronda."""
    global DELAY
    DELAY = LOWER_DELAY
    status = read_json('status.json', {}) or {}
    if status.get('estado') != 'en-vivo':
        log('ámbitos: la ONPE aún no publica resultados')
        return
    if backoff_active():
        log('ámbitos: en pausa, la ONPE rechazó consultas hace poco')
        return
    latest = read_json('latest.json', {}) or {}
    els = [e for e in latest.get('elecciones', []) if e.get('nivel', 1) >= 2 and e.get('departamentos')]
    if not els:
        return
    crawl = read_json(AMBITOS_STATE, {}) or {}
    manifest = read_json('manifest-ambitos.json', {}) or {}
    found = read_json('checks-ambitos.json', {}) or {}
    by_scope = found.get('porAmbito') or {}

    def on_checks(label, items):
        if items:
            if label not in by_scope:
                with open(os.path.join(DATA, 'checks-log.ndjson'), 'a', encoding='utf-8') as f:
                    for c in items:
                        f.write(json.dumps({'visto': now_iso(), **c}, ensure_ascii=False) + '\n')
            by_scope[label] = items
        else:
            by_scope.pop(label, None)

    deadline = time.time() + LOWER_SECONDS
    visited = 0
    asked = wanted_codes(crawl, els)
    while time.time() < deadline and not backoff_active():
        n = 0
        for e in els:
            # los distritos son diez veces más que las provincias: se llevan tres cuartos de cada vuelta
            n += crawl_lower(e['id'], e['nombre'], e['nivel'], e['departamentos'], manifest, crawl, on_checks,
                             60 if e['nivel'] == 3 else 20, deadline, asked.get(e['id'], ()))
        visited += n
        if n == 0:
            break
    for e in els:
        st = crawl.get(str(e['id'])) or {}
        write_json(f'ambitos/eleccion-{e["id"]}.json', {'eleccion': e['nombre'], 'nivel': e['nivel'],
                                                         'provincias': st.get('provincias') or {}, 'distritos': st.get('distritos') or {},
                                                         **{k: v for k, v in lower_summary(st, e['nivel']).items() if k in ('pendientes', 'total')}},
                   indent=None)
    write_places_index(latest, crawl)
    write_json(AMBITOS_STATE, crawl, indent=None)
    write_json('manifest-ambitos.json', manifest)
    write_json('checks-ambitos.json', {'actualizado': now_iso(), 'porAmbito': by_scope}, indent=None)
    log('ámbitos:', visited, 'lugares consultados;',
        ', '.join(f'{e.get("menu") or e["nombre"]}: {lower_summary(crawl.get(str(e["id"])), e["nivel"])["pendientes"]} sin visitar' for e in els))


def write_places_index(latest, crawl):
    """Índice de lugares para el buscador de «Mi zona»: regiones, provincias y distritos con su ruta."""
    places, seen = [], set()

    def add(nivel, code, dep, prov, nombre):
        if code and (nivel, code) not in seen:
            seen.add((nivel, code))
            places.append([nivel, code, dep, prov, nombre])

    by_level = {}
    for e in latest.get('elecciones', []):
        by_level.setdefault(e['nivel'], e)
    for d in (by_level.get(1) or by_level.get(2) or by_level.get(3) or {}).get('departamentos', []):
        add(1, d['ubigeo'], d['ubigeo'], None, d['nombre'])
    for lvl in (2, 3):
        e = by_level.get(lvl)
        for dep, prov, dist, label in (crawl.get(str(e['id']), {}).get('todos', []) if e else []):
            names = [s.strip() for s in label.split(' / ')]
            if lvl == 2:
                add(2, prov, dep, prov, names[-1])
            else:
                add(2, prov, dep, prov, names[1] if len(names) > 1 else '')
                add(3, dist, dep, prov, names[-1])
    if places:
        write_json('ambitos/indice.json', {'actualizado': now_iso(),
                                          'elecciones': {str(lvl): e['id'] for lvl, e in by_level.items()},
                                          'campos': ['nivel', 'ubigeo', 'departamento', 'provincia', 'nombre'],
                                          'lugares': places}, indent=None)


_MINUS = {'De', 'Del', 'La', 'Las', 'Los', 'Y', 'E', 'En', 'El'}


def nice(name):
    """«SAN JUAN DE LURIGANCHO» → «San Juan de Lurigancho»."""
    words = str(name or '').title().split()
    return ' '.join(w.lower() if i and w in _MINUS else w for i, w in enumerate(words))


def races(latest, crawl):
    """Todas las contiendas con datos: (elección, clave, lugar, totales, contienda)."""
    for e in latest.get('elecciones', []):
        if e.get('tipo') == 'consejeros':
            continue
        if e['nivel'] == 1:
            for d in e.get('departamentos', []):
                yield e, f'{e["id"]}:{d["ubigeo"]}', nice(d['nombre']), d.get('totales') or {}, d.get('contienda')
        else:
            st = crawl.get(str(e['id']), {})
            for code, v in ((st.get('distritos') if e['nivel'] == 3 else st.get('provincias')) or {}).items():
                names = [x.strip() for x in v['nombre'].split(' / ')]
                # provincia (región) o distrito (provincia): muchos lugares comparten nombre
                lugar = f'{nice(names[-1])} ({nice(names[-2])})' if len(names) > 1 else nice(names[-1])
                yield e, f'{e["id"]}:{code}', lugar, v.get('totales') or {}, v.get('contienda')


def boletin(latest, crawl, checks):
    """Boletín de corte: lo que cambió entre un corte oficial de la ONPE y el anterior.

    Lo arma este programa con los datos de la ONPE, sin inteligencia artificial. Cada corrida
    anota los cambios de primer lugar; cuando la ONPE publica un corte nuevo, se cierra un boletín."""
    lideres = crawl.setdefault('_lideres', {})
    pend = crawl.setdefault('_cambios', [])
    for e, key, lugar, tot, c in races(latest, crawl):
        if not c or not (c['primero'].get('votos') or 0):
            continue
        lid = str(c['primero'].get('codPartido') or c['primero'].get('partido'))
        old = lideres.get(key)
        if old and old[0] != lid:
            pend[:] = [x for x in pend if x['clave'] != key]
            pend.append({'clave': key, 'eleccion': e.get('menu') or e['nombre'], 'lugar': lugar, 'antes': old[1],
                         'ahora': c['primero'].get('partido'), 'candidato': c['primero'].get('candidato'),
                         'actas': tot.get('totalActas') or 0})
        lideres[key] = [lid, c['primero'].get('partido')]

    corte = max([(x.get('totales') or {}).get('fechaActualizacion') or 0 for x in latest.get('elecciones', [])] or [0])
    hist = read_json('boletines.json', {}) or {}
    items = hist.get('items') or []
    if not corte or (items and items[0].get('corte') == corte):
        return
    prev = {a['id']: a for a in ((items[0].get('avance') or []) if items else [])}
    avance = []
    for e in latest['elecciones']:
        t = e.get('totales') or {}
        avance.append({'id': e['id'], 'eleccion': e.get('menu') or e['nombre'], 'actasPct': t.get('actasContabilizadas'),
                       'contabilizadas': t.get('contabilizadas'), 'totalActas': t.get('totalActas'),
                       'participacion': t.get('participacionCiudadana'),
                       'antesPct': (prev.get(e['id']) or {}).get('actasPct')})
    firmes = {}
    for e, key, lugar, tot, c in races(latest, crawl):
        if not c or 'puedeCambiar' not in c or not (tot.get('contabilizadas') or 0):
            continue
        f = firmes.setdefault(str(e['id']), {'eleccion': e.get('menu') or e['nombre'], 'nivel': e['nivel'], 'firmes': 0, 'conDatos': 0})
        f['conDatos'] += 1
        f['firmes'] += 0 if c['puedeCambiar'] else 1
    actas = read_json('actas/resumen.json', {}) or {}
    cambios = sorted(pend, key=lambda x: -x['actas'])
    b = {'corte': corte, 'hora': datetime.fromtimestamp(corte / 1000, PERU).strftime('%H:%M'), 'generado': now_iso(),
         'avance': avance,
         'cambios': [{k: x[k] for k in ('eleccion', 'lugar', 'antes', 'ahora', 'candidato')} for x in cambios[:12]],
         'cambiosTotal': len(cambios),
         'firmes': list(firmes.values()),
         'observaciones': {'totales': len(checks), 'actasRevisadas': actas.get('actasLeidas') or 0,
                           'actasImportantes': (actas.get('avisos') or {}).get('alerta') or 0,
                           'actasRevisar': (actas.get('avisos') or {}).get('revisar') or 0}}
    b['texto'] = boletin_text(b)
    pend.clear()
    write_json('boletines.json', {'nota': 'Boletines generados por programa con los datos oficiales de la ONPE (sin IA). '
                                          'No son proyecciones.', 'items': ([b] + items)[:300]})


def boletin_text(b):
    """El mismo boletín en texto plano (para compartir y para la transmisión)."""
    lugar_tipo = {1: 'regiones', 2: 'provincias', 3: 'distritos'}
    out = [f'Corte ONPE de las {b["hora"]}.']
    av = []
    for a in b['avance']:
        if a.get('actasPct') is None:
            continue
        s = f'{a["eleccion"]} {a["actasPct"]:.1f}%'
        if a.get('antesPct') is not None and a['antesPct'] != a['actasPct']:
            s += f' (antes {a["antesPct"]:.1f}%)'
        av.append(s)
    if av:
        out.append('Actas contadas: ' + ' · '.join(av) + '.')
    if b['cambiosTotal']:
        names = [f'{c["lugar"]}, {c["eleccion"].lower()}' for c in b['cambios'][:4]]
        extra = b['cambiosTotal'] - len(names)
        out.append(f'Cambió el primer lugar en {b["cambiosTotal"]} ' + ('contienda: ' if b['cambiosTotal'] == 1 else 'contiendas: ')
                   + '; '.join(names) + (f'; y {extra} más' if extra > 0 else '') + '.')
    fs = [f'{f["firmes"]:,} de {f["conDatos"]:,} {lugar_tipo.get(f["nivel"], "lugares")}' for f in b['firmes'] if f['firmes']]
    if fs:
        out.append('El primer lugar ya no puede cambiar con las actas que faltan en ' + ', '.join(fs) + '.')
    o = b['observaciones']
    rev = ('los totales cuadran' if not o['totales'] else 'una diferencia en los totales' if o['totales'] == 1
           else f'{o["totales"]:,} diferencias en los totales')
    n_obs = o['actasImportantes'] + o['actasRevisar']
    if o['actasRevisadas']:
        rev += f'; {o["actasRevisadas"]:,} actas revisadas, {n_obs:,} con observaciones'
    out.append(f'Revisión: {rev}.')
    return ' '.join(out)


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
        w.writerow(['eleccion', 'ubigeo', 'departamento', 'partido', 'candidato', 'votos',
                    'pct_validos', 'actas_contabilizadas_pct', 'fecha_actualizacion_onpe'])
        for d in item['departamentos']:
            for p in d['participantes']:
                w.writerow([nombre, d['ubigeo'], d['nombre'], p['partido'], p['candidato'],
                            p['votos'], p['pctValidos'], d['totales'].get('actasContabilizadas'),
                            d['totales'].get('fechaActualizacion')])


if __name__ == '__main__':
    if '--ambitos' in sys.argv:
        try:
            lower_main()
        except Exception as e:  # el estado del tablero lo lleva el ciclo principal: aquí solo se anota
            log('ámbitos, fallo:', repr(e))
            sys.exit(1)
        sys.exit(0)
    try:
        main()
    except Exception as e:  # nunca dejamos el status mintiendo: si algo falla, se dice
        st = read_json('status.json', {}) or {}
        st.update({'estado': 'error', 'consultado': now_iso(), 'error': f'{type(e).__name__}: {e}'[:300]})
        write_json('status.json', st)
        log('fallo:', repr(e))
        sys.exit(1)
