#!/bin/sh
set -e

mkdir -p /data/recordings /data/previews /data/logs

# pulseaudio нужен FFmpeg для captura аудио с системного sink (Chrome играет
# звук в pulse). Если не поднялся — запись будет видео-only (документировано в README).
pulseaudio --daemonize --exit-idle-time=-1 2>/dev/null || true

exec node /app/backend/server.js
