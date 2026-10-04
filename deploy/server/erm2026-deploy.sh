#!/usr/bin/env bash
# Publica el sitio en el servidor a partir de un tar.gz que llega por la entrada estándar.
# Se instala en /usr/local/sbin/erm2026-deploy y lo llama deploy/run.sh:
#
#   tar -czf - web data | ssh lima /usr/local/sbin/erm2026-deploy site
#   tar -czf - 045.json | ssh lima /usr/local/sbin/erm2026-deploy mesas
#
# «site»: extrae en una carpeta nueva, la valida y la activa cambiando un enlace simbólico con un
# rename atómico. Si algo falla, la versión publicada no se toca.
# «mesas»: valida cada archivo y lo reemplaza con un mv atómico.
set -Eeuo pipefail
umask 022

MODE="${1:-}"
REL=/srv/erm2026-releases          # versiones del sitio
LIVE=/srv/erm2026                  # enlace simbólico a la versión activa (nginx sirve desde aquí)
MESAS=/srv/erm2026-mesas
KEEP=3                             # versiones que se conservan
ASSET_DAYS=3                       # días que se conservan los assets de builds anteriores

die() { echo "erm2026-deploy: $*" >&2; exit 1; }

# El paquete solo puede traer carpetas y archivos normales.
only_plain_files() {
  if find "$1" \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit | grep -q .; then
    die "el paquete trae enlaces o archivos especiales; se rechaza"
  fi
}

valid_json() { python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$1" 2>/dev/null; }

mkdir -p "$REL"
# restos de despliegues que se cortaron hace rato
find "$REL" -maxdepth 1 -name '.stage.*' -mmin +30 -exec rm -rf {} + 2>/dev/null || true

case "$MODE" in
site)
  stage=$(mktemp -d "$REL/.stage.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  tar -xzf - -C "$stage" --no-same-owner --no-same-permissions
  only_plain_files "$stage"

  # Lo mínimo para que el sitio funcione. Si falta algo, se conserva la versión anterior.
  for f in web/index.html web/live.html web/config.json web/geo/peru.json web/models/robot.glb \
           data/status.json data/latest.json data/checks.json data/bots/feed.json data/bots/schedule.json; do
    [ -s "$stage/$f" ] || die "falta $f; se conserva la versión anterior"
  done
  for f in web/config.json data/status.json data/latest.json data/checks.json data/bots/feed.json data/bots/schedule.json; do
    valid_json "$stage/$f" || die "$f no es JSON válido; se conserva la versión anterior"
  done
  # Todo lo que las páginas cargan de assets/ tiene que venir en el paquete (protege de un build a medias).
  for page in index.html live.html; do
    grep -o 'assets/[A-Za-z0-9._-]*' "$stage/web/$page" | sort -u | while read -r a; do
      [ -s "$stage/web/$a" ] || die "$page pide $a y no viene en el paquete"
    done
  done

  # Los assets de builds recientes se conservan: quien tenga la página abierta desde antes
  # sigue encontrando sus archivos (y no recibe 404).
  if [ -d "$LIVE/web/assets" ]; then
    find "$LIVE/web/assets" -maxdepth 1 -type f -mtime -"$ASSET_DAYS" -print0 | while IFS= read -r -d '' old; do
      [ -e "$stage/web/assets/$(basename "$old")" ] || cp -p "$old" "$stage/web/assets/"
    done
  fi

  chown -R root:root "$stage"
  find "$stage" -type d -exec chmod 0755 {} +
  find "$stage" -type f -exec chmod 0644 {} +

  name="$(date -u +%Y%m%dT%H%M%S)-$$"
  mv "$stage" "$REL/$name"
  trap - EXIT

  ln -s "$REL/$name" "$LIVE.next"
  if [ -e "$LIVE" ] && [ ! -L "$LIVE" ]; then
    # Primera vez: /srv/erm2026 todavía es una carpeta real y hay que apartarla (único paso no atómico).
    mv "$LIVE" "$REL/.legacy-$name"
  fi
  mv -T "$LIVE.next" "$LIVE"         # rename atómico: nginx pasa de una versión completa a otra

  # Limpieza: versiones viejas y la carpeta del esquema anterior
  ls -1d "$REL"/20* 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
  rm -rf "$REL"/.legacy-* /srv/erm2026.old /srv/erm2026.new
  echo "erm2026-deploy: publicada $name"
  ;;

mesas)
  mkdir -p "$MESAS"
  stage=$(mktemp -d "$REL/.stage.XXXXXX")     # mismo sistema de archivos que el destino: el mv es atómico
  trap 'rm -rf "$stage"' EXIT
  tar -xzf - -C "$stage" --no-same-owner --no-same-permissions
  only_plain_files "$stage"
  n=0
  for f in "$stage"/[0-9][0-9][0-9].json; do
    [ -f "$f" ] || continue
    valid_json "$f" || { echo "erm2026-deploy: $(basename "$f") no es JSON válido; se omite" >&2; continue; }
    chown root:root "$f"; chmod 0644 "$f"
    mv -f "$f" "$MESAS/$(basename "$f")"
    n=$((n + 1))
  done
  echo "erm2026-deploy: $n archivos de mesas"
  ;;

*)
  die "uso: erm2026-deploy site|mesas  (tar.gz por la entrada estándar)"
  ;;
esac
