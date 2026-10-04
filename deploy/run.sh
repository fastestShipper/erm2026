#!/usr/bin/env bash
# Ciclo completo (cada 2 min, desde el Programador de tareas de Windows):
#   1) bitácora de bots -> data/bots   2) colector ONPE (+ commit/push)   3) sincroniza web y data al servidor
set -u
ROOT=/w/dev0x/erm2026
LOG=$ROOT/local/run.log
LOCK=$ROOT/local/run.lock
mkdir -p "$ROOT/local"
if ! mkdir "$LOCK" 2>/dev/null; then
  # lock viejo (más de 15 min) = corrida colgada; se libera
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then rmdir "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rmdir "$LOCK"' EXIT
exec </dev/null                 # sin consola (Programador de tareas): stdin válido para todos los procesos
export PYTHONIOENCODING=utf-8
exec >>"$LOG" 2>&1
echo "---- $(date -Is)"
# Ruta a lima: IP pública o, si falla, Tailscale (cualquiera de las dos puede estar bloqueada)
LIMA_OPT=""
if ! timeout 15 ssh -o ConnectTimeout=8 -o BatchMode=yes lima true 2>/dev/null; then LIMA_OPT="-o HostName=100.96.13.90"; fi
PY="${ERM_PY:-/c/Users/shitc/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe}"
export ERM_ROOT="$(cygpath -w "$ROOT")" ERM_INBOX="$(cygpath -w "$ROOT/local/inbox")"
ERM_OUT="$(cygpath -w "$ROOT/data/bots")" timeout 40 node "$ROOT/bots/narrador.mjs" || echo "narrador: fallo $?"
ERM_OUT="$(cygpath -w "$ROOT/data/bots")" ERM_REMOTE=none ERM_ALERT=1 timeout 120 node "$ROOT/bots/export_grok.mjs" || echo "bots: fallo $?"
timeout 900 "$PY" "$ROOT/collector/collect.py" || echo "colector: fallo $?"
# Fragmentos de «Busca tu mesa»: solo se suben los que cambiaron; el servidor los valida y reemplaza uno por uno
if [ -s "$ROOT/local/mesas-changed.txt" ]; then
  mv "$ROOT/local/mesas-changed.txt" "$ROOT/local/mesas-sending.txt"
  if sort -u "$ROOT/local/mesas-sending.txt" | tar -C "$ROOT/local/mesas" -czf - -T -       | timeout 300 ssh -o ConnectTimeout=15 -o BatchMode=yes $LIMA_OPT lima /usr/local/sbin/erm2026-deploy mesas; then
    rm -f "$ROOT/local/mesas-sending.txt"
  else
    cat "$ROOT/local/mesas-sending.txt" >> "$ROOT/local/mesas-changed.txt"; rm -f "$ROOT/local/mesas-sending.txt"; echo "sync mesas: fallo"
  fi
fi

# Sitio + datos: el servidor extrae en una carpeta nueva, valida y cambia de versión de forma atómica.
# Si el paquete llega incompleto o inválido, la versión publicada no se toca.
tar -C "$ROOT" --exclude='*.tmp' --exclude='data/crawl-state.json' --exclude='data/crawl-ambitos.json' -czf - web data   | timeout 180 ssh -o ConnectTimeout=15 -o BatchMode=yes $LIMA_OPT lima /usr/local/sbin/erm2026-deploy site   || echo "sync: fallo $?"
