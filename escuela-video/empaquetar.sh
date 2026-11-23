#!/usr/bin/env bash
# Convierte un video maestro (.mp4 vertical 1080x1920) en HLS listo para el servidor de la Escuela y lo sube a R2.
# Uso: ./empaquetar.sh <video_maestro.mp4> <codigo_de_video> <version>
#   ej: ./empaquetar.sh BIE-001_master.mp4 GAL-EV-BIE-001 1.0
# Requiere ffmpeg y una sesión de wrangler (npx wrangler login). El .mp4 maestro NUNCA se sube: queda en el archivo de la empresa.
set -euo pipefail
MASTER="$1"; VIDEO="$2"; VER="$3"
CARPETA="onb/${VIDEO}/v${VER}"
TMP="$(mktemp -d)"
ffmpeg -hide_banner -loglevel error -i "$MASTER" \
  -vf "scale=720:1280:flags=lanczos" -c:v libx264 -preset veryfast -crf 22 -profile:v main -pix_fmt yuv420p \
  -g 48 -keyint_min 48 -sc_threshold 0 -c:a aac -b:a 96k -ac 2 \
  -hls_time 6 -hls_playlist_type vod -hls_segment_filename "$TMP/seg_%03d.ts" "$TMP/index.m3u8"
ffmpeg -hide_banner -loglevel error -ss 1 -i "$MASTER" -frames:v 1 -vf "scale=360:640" -q:v 4 "$TMP/portada.jpg"
for f in "$TMP"/*; do
  npx wrangler r2 object put "galletti-escuela/${CARPETA}/$(basename "$f")" --file "$f" --remote >/dev/null
  echo "subido: ${CARPETA}/$(basename "$f")"
done
rm -rf "$TMP"
echo "Listo. Ruta para publicar en Alba (Escuela > Catálogo): ${CARPETA}/index.m3u8"
