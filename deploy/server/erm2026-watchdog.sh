#!/usr/bin/env bash
# Vigía del tablero (corre en el servidor cada minuto, independiente del PC que recoge los datos).
# Avisa por Telegram si los datos publicados dejan de actualizarse, si el sitio no responde
# o si cambia el estado de la ONPE (empieza a publicar, bloquea, error). Se instala en
# /usr/local/sbin/erm2026-watchdog con erm2026-watchdog.service + .timer.
set -u
STATUS=/srv/erm2026/data/status.json
STATE_DIR=/var/lib/erm2026-watchdog
STALE_S=${ERM_STALE_S:-360}          # más de 6 minutos sin consultar a la ONPE = datos atrasados
REPEAT_S=${ERM_REPEAT_S:-1200}       # mientras siga mal, repite el aviso cada 20 minutos
URL=https://peruvian.dev/dataonpe/data/status.json
mkdir -p "$STATE_DIR"

send() { hermes send -t telegram "ERM 2026 · $1" >/dev/null 2>&1 || logger -t erm2026-watchdog "no se pudo avisar: $1"; }

# edad de la última consulta a la ONPE y estado publicado
read -r AGE ESTADO < <(python3 - "$STATUS" <<'PY'
import json, sys, time
from datetime import datetime
try:
    s = json.load(open(sys.argv[1], encoding='utf-8'))
    t = datetime.fromisoformat(s['consultado']).timestamp()
    print(int(time.time() - t), s.get('estado') or '?')
except Exception:
    print(999999, 'ilegible')
PY
)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL" || echo 000)

now=$(date +%s)
problem=""
if [ "$HTTP" != "200" ]; then problem="el sitio no responde (HTTP $HTTP)"
elif [ "$AGE" -gt "$STALE_S" ]; then problem="los datos llevan $((AGE / 60)) min sin actualizarse. Revisa el PC de Windows (tarea ERM2026-ciclo, VPN apagada, sesión iniciada)"
fi

last_alert=$(cat "$STATE_DIR/last_alert" 2>/dev/null || echo 0)
was_bad=$(cat "$STATE_DIR/bad" 2>/dev/null || echo "")
if [ -n "$problem" ]; then
  if [ -z "$was_bad" ] || [ $((now - last_alert)) -ge "$REPEAT_S" ]; then
    send "⚠️ $problem"
    echo "$now" > "$STATE_DIR/last_alert"
  fi
  echo "$problem" > "$STATE_DIR/bad"
elif [ -n "$was_bad" ]; then
  send "✅ el tablero volvió a actualizarse (última consulta a la ONPE hace $((AGE / 60)) min)"
  rm -f "$STATE_DIR/bad"
fi

# cambios de estado de la ONPE
prev=$(cat "$STATE_DIR/estado" 2>/dev/null || echo "")
if [ "$ESTADO" != "ilegible" ] && [ -n "$prev" ] && [ "$ESTADO" != "$prev" ]; then
  case "$ESTADO" in
    en-vivo)   send "🟢 la ONPE empezó a publicar resultados: el tablero ya los muestra." ;;
    bloqueado) send "🔴 el portal de la ONPE está rechazando nuestras consultas (estado: bloqueado). Revisa que la VPN esté apagada." ;;
    error)     send "🟠 el colector reporta un error al consultar a la ONPE. Revisa local/run.log en Windows." ;;
    esperando) send "ℹ️ la ONPE volvió a «Próximamente» (estado: esperando)." ;;
  esac
fi
[ "$ESTADO" != "ilegible" ] && echo "$ESTADO" > "$STATE_DIR/estado"
exit 0
