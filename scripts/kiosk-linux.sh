#!/usr/bin/env bash
# Abre una pantalla de Dicen en Chrome/Chromium, en modo kiosco y con autoplay habilitado.
# Uso: scripts/kiosk-linux.sh screen1 [ip-del-servidor] [puerto]
SCREEN="${1:-screen1}"
HOST="${2:-localhost}"
PORT="${3:-8080}"

for bin in google-chrome chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then CHROME="$bin"; break; fi
done
if [ -z "$CHROME" ]; then
    echo "No se encontró Chrome ni Chromium." >&2
    exit 1
fi

exec "$CHROME" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs \
    --disable-session-crashed-bubble --disable-infobars \
    --user-data-dir="/tmp/dicen-$SCREEN" "http://$HOST:$PORT/$SCREEN"
