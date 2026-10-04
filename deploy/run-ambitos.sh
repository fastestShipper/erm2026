#!/usr/bin/env bash
# Recorrido de provincias y distritos (cada 2 min, desde el Programador de tareas de Windows).
# Corre aparte del ciclo principal: así el corte nacional sale cada 2 minutos mientras los ~2,100
# lugares de «Mi zona» se van refrescando en ronda. Cada corrida dura unos 100 segundos.
set -u
ROOT=/w/dev0x/erm2026
LOCK=$ROOT/local/ambitos.lock
mkdir -p "$ROOT/local"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rmdir "$LOCK"' EXIT
exec </dev/null                 # sin consola (Programador de tareas): stdin válido para todos los procesos
export PYTHONIOENCODING=utf-8
exec >>"$ROOT/local/ambitos.log" 2>&1
PY="${ERM_PY:-/c/Users/shitc/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe}"
export ERM_ROOT="$(cygpath -w "$ROOT")"
# Con resultados publicados: qué lugares está mirando el público (solo conteos), para refrescarlos primero.
if grep -q '"en-vivo"' "$ROOT/data/status.json" 2>/dev/null; then
  Z=/var/lib/private/erm2026-viewers/zonas.json
  for OPT in "" "-o HostName=100.96.13.90"; do
    if timeout 12 ssh -o ConnectTimeout=6 -o BatchMode=yes $OPT lima "cat $Z 2>/dev/null || echo '{}'" > "$ROOT/local/zonas.json.tmp" 2>/dev/null && [ -s "$ROOT/local/zonas.json.tmp" ]; then
      mv "$ROOT/local/zonas.json.tmp" "$ROOT/local/zonas.json"; break
    fi
  done
fi
timeout 240 "$PY" "$ROOT/collector/collect.py" --ambitos || echo "ambitos: fallo $?"
