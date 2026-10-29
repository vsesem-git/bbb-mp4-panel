FROM node:22-slim

ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    PORT=3000 \
    DATA_DIR=/data

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg chromium xvfb pulseaudio ca-certificates curl iproute2 \
        build-essential python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Настройки npm для нестабильных сетей: повторные попытки и большие таймауты.
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && npm config set fetch-retry-mintimeout 10000

# Бэкенд: устанавливаем production-зависимости (puppeteer не качает Chromium —
# используется системный /usr/bin/chromium, см. PUPPETEER_SKIP_DOWNLOAD).
COPY backend/package.json ./backend/package.json
RUN cd /app/backend && npm install --omit=dev || (sleep 30 && npm install --omit=dev)

# Фронт: ставим ВСЕ зависимости (включая dev — vite нужен для сборки),
# собираем SPA, затем удаляем dev-зависимости из образа.
COPY frontend ./frontend
RUN cd /app/frontend && npm install --include=dev && npm run build && npm prune --omit=dev

COPY backend ./backend
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
VOLUME /data

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/backend/server.js"]
