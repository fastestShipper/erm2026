#!/usr/bin/env bash
# Compila el sitio en una carpeta aparte y la intercambia de golpe, con el mismo candado del ciclo
# de despliegue: así el ciclo nunca empaqueta un build a medias.
set -euo pipefail
ROOT=/w/dev0x/erm2026
LOCK=$ROOT/local/run.lock
cd "$ROOT/app"
rm -rf "$ROOT/web.next"
npx vite build --outDir ../web.next --emptyOutDir
[ -s "$ROOT/web.next/index.html" ] && [ -s "$ROOT/web.next/live.html" ] || { echo "build incompleto"; exit 1; }
for i in $(seq 1 90); do mkdir "$LOCK" 2>/dev/null && break; sleep 2; done
[ -d "$LOCK" ] || { echo "no se pudo tomar el candado"; exit 1; }
trap 'rmdir "$LOCK"' EXIT
cd "$ROOT"
rm -rf web.prev
mv web web.prev
mv web.next web
rm -rf web.prev
echo "build listo: $(ls web/assets | wc -l) archivos en assets"
