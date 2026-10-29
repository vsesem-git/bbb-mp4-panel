#!/usr/bin/env bash
#
# deploy.sh — развёртывание bbb-mp4-panel на Ubuntu (VPS или локальный сервер, LAN).
# Одна команда: ставит Docker + Compose, клонирует репозиторий, собирает и запускает
# контейнер. Работает без правок как на VPS (публичный IP/домен), так и в локальной
# сети (http://192.168.1.5:3000) — никаких хардкодов IP/домена.
set -euo pipefail

REPO_URL="https://github.com/vsesem-git/bbb-mp4-panel.git"
INSTALL_DIR="/opt/bbb-mp4-panel"
PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-/var/lib/bbb-mp4-panel}"

log() { printf '[bbb-mp4-deploy] %s\n' "$*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Запустите скрипт от root или через sudo: sudo bash deploy.sh" >&2
    exit 1
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker и docker compose уже установлены"
    return
  fi
  log "Устанавливаем Docker и docker compose plugin..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git docker.io docker-compose-plugin
  systemctl enable --now docker 2>/dev/null || true
}

main() {
  require_root
  install_docker

  if [ ! -d "$INSTALL_DIR/.git" ]; then
    log "Клонируем репозиторий в $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  else
    log "Обновляем репозиторий в $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only
  fi

  if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    log "Создан $INSTALL_DIR/.env из .env.example (отредактируйте при необходимости)"
  fi

  #_PORT_ из окружения берет приоритет
  sed -i "s/^PORT=.*/PORT=$PORT/" "$INSTALL_DIR/.env"

  mkdir -p "$DATA_DIR"

  export PORT
  cd "$INSTALL_DIR"
  log "Собираем и запускаем контейнер (docker compose up -d --build)..."
  docker compose up -d --build

  IP=$(hostname -I | awk '{print $1}')
  echo
  log "Готово!"
  echo "  Веб-панель:   http://${IP}:${PORT}   (или http://localhost:${PORT})"
  echo "  Настройки:    http://${IP}:${PORT}/settings"
  echo "  API:          http://${IP}:${PORT}/api/tasks"
  echo
  log "Логи контейнера: docker logs -f bbb-mp4-panel"
  log "Данные (БД, MP4, превью): том docker bbb-mp4-data / каталог $DATA_DIR на хосте при биндинге volumes."
}

main "$@"
