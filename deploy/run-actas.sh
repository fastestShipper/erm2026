#!/usr/bin/env bash
# Revisión acta por acta (cada 10 min, desde el Programador de tareas de Windows). Corre ~9 min por vuelta.
set -u
ROOT=/w/dev0x/erm2026
LOCK=$ROOT/local/actas.lock
mkdir -p "$ROOT/local"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rmdir "$LOCK"' EXIT
exec </dev/null                 # sin consola (Programador de tareas): stdin válido para todos los procesos
export PYTHONIOENCODING=utf-8
exec >>"$ROOT/local/actas.log" 2>&1
PY="${ERM_PY:-/c/Users/shitc/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe}"
export ERM_ROOT="$(cygpath -w "$ROOT")" ERM_MESAS_DIR="$(cygpath -w "$ROOT/local/mesas")"
timeout 660 "$PY" "$ROOT/collector/actas.py" || echo "actas: fallo $?"
