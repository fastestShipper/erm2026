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
exec >>"$LOG" 2>&1
echo "---- $(date -Is)"
PY="${ERM_PY:-/c/Users/shitc/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe}"
export ERM_ROOT="$(cygpath -w "$ROOT")" ERM_INBOX="$(cygpath -w "$ROOT/local/inbox")"
ERM_OUT="$(cygpath -w "$ROOT/data/bots")" ERM_REMOTE=none ERM_ALERT=1 timeout 120 node "$ROOT/bots/export_grok.mjs" || echo "bots: fallo $?"
[ -f "$ROOT/local/markets.mjs" ] && { timeout 120 node "$ROOT/local/markets.mjs" || echo "mercados: fallo $?"; }
timeout 900 "$PY" "$ROOT/collector/collect.py" || echo "colector: fallo $?"
tar -C "$ROOT" -czf - web data | timeout 120 ssh -o ConnectTimeout=15 -o BatchMode=yes lima \
  'mkdir -p /srv/erm2026.new && tar -xzf - -C /srv/erm2026.new && rm -rf /srv/erm2026.old && { [ -d /srv/erm2026 ] && mv /srv/erm2026 /srv/erm2026.old; mv /srv/erm2026.new /srv/erm2026; }' \
  || echo "sync: fallo $?"

# Aviso por Telegram cuando llegan evidencias nuevas
N=$(timeout 30 ssh -o BatchMode=yes lima 'find /var/lib/erm2026-intake -name meta.json 2>/dev/null | wc -l' 2>/dev/null | tail -1)
P=$(cat "$ROOT/local/intake-count" 2>/dev/null || echo 0)
if [ -n "$N" ] && [ "$N" -gt "$P" ] 2>/dev/null; then
  hermes send -t telegram "ERM 2026: $((N-P)) evidencia(s) nueva(s) en la bandeja (total $N)." >/dev/null 2>&1 || true
  echo "$N" > "$ROOT/local/intake-count"
fi
