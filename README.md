# bbb-mp4-panel

Система конвертации записей BigBlueButton (BBB) в MP4 на отдельном сервере с веб-панелью управления.

Основана на https://github.com/manishkatyan/bbb-mp4 (Xvfb + Google Chrome + FFmpeg + NodeJS в Docker-контейнере, запись экрана при открытии playback-URL записи BBB).

## Архитектура (принятые инженерные решения)

ТЗ не содержит полной детализации нескольких моментов — ниже описаны принятые решения (best practice).

### 1. Один контейнер вместо Docker-in-Docker

Оригинальный bbb-mp4.sh запускает контейнер с Xvfb+Chrome+FFmpeg на самом BBB-сервере через `post_publish`. Мы выносим конвертацию на отдельный сервер. Поднимать Docker-in-Docker (запуск контейнера в контейнере) не нужно: **бэкенд (Node.js + Express + SQLite) и воркер живут в одном контейнере**, в котором установлены ffmpeg, Chromium, Xvfb и pulseaudio. Воркер на каждое задание поднимает собственное Xvfb-окно (дисплей :99, :100, …), запускает на нём Chromium через Puppeteer и записывает экран FFmpeg через `x11grab`. Это избавляет от вложенной виртуализации, проблем с сокетом Docker и прав доступа, при этом сохраняет изоляцию экранов задач друг от друга.

### 2. Запись и аудио

- Видео: `ffmpeg -f x11grab -video_size WxH -framerate 25 -i :N.0 -c:v libx264 …`
- Аудио: pulseaudio默认 sink (`-f pulse -i default`, кодек aac). Если pulseaudio недоступен — запись видео без аудио (запись не падает).
- Xvfb и FFmpeg используют одно и то же разрешение (из настроек/задания), поэтому нет обрезки и чёрных полей.
- Chromium запускается с `--autoplay-policy=no-user-gesture-required`, чтобы ролик на странице playback начал проигрываться без участия пользователя.

### 3. Прогресс (в точности по ТЗ)

Прогресс вычисляется из элементов Video.js на странице записи:
- селектор `.vjs-remaining-time-display` (обратный отсчёт, формат H:MM:SS);
- `total` — приоритет `video.duration` (ожидание до 60 с), фолбэк — парсинг remaining-time;
- `progress = (total − remaining) / total`, обновляется раз в 60 с;
- когда `remaining <= 2` или `progress >= 100` — запись завершается, статус `done`.

Превью кадра делается FFmpeg с того же дисплея Xvfb (`-frames:v 1`) раз в 60 с и сохраняется в `/data/previews/<id>.jpg`.

### 4. Остановка задания (SIGINT)

При `POST /api/tasks/:id/stop` FFmpeg получает `SIGINT` (не `SIGKILL`) — MP4 финализируется корректно. Далее ожидание до 15 с, при необходимости `SIGKILL`, закрытие браузера и остановка Xvfb. Статус → `cancelled`, частичный MP4 сохраняется на диске (`partial=true`), в UI — кнопка «Скачать (частично)».

### 5. БД и настройки

- SQLite (better-sqlite3, WAL) в `/data/bbb-mp4.sqlite`.
- Таблица `tasks` — задания; таблица `settings` — глобальные настройки (`key/value`).
- API: `GET /api/settings`, `PUT /api/settings`.

### 6. Хранение файлов

MP4: `/data/recordings/<meeting_id>.mp4`. Если файл с таким meeting_id уже существует (повторная конвертация того же ролика), пишется `<meeting_id>_<taskId>.mp4` (конфликт не перезаписывает предыдущий файл). Превью: `/data/previews/<taskId>.jpg`.

### 7. Сеть и URL

Никаких хардкодов IP/домена. Бэкенд слушает `0.0.0.0:$PORT` (по умолчанию 3000). Все URL во фронте относительные (`/api/…`, `/previews/…`). CORS: по умолчанию любые origin, настраивается через `ALLOWED_ORIGINS` (список через запятую). Работает одинаково на VPS (публичный IP/домен, опционально HTTPS через nginx) и в LAN (`http://192.168.1.5:3000`).

### 8. Лимиты ресурсов и надёжность

- `docker-compose` ограничивает контейнер (`cpus: 2.0`, `memory: 4G`, `shm_size: 2gb` для Chromium).
- `MAX_CONCURRENT` (по умолчанию 2) — число одновременно записываемых задач; остальные ждут в очереди SQLite.
- Авто-ретраи: при ошибке задача повторяется до 2 раз, затем статус `error` с кнопкой «Повторить».
- Логи: stdout + файл `/data/logs/app.log`.
- Health-check: `GET /health`.

## Быстрый старт (одна команда)

На целевом сервере Ubuntu (VPS или локальная машина, требуется root/sudo):

```bash
curl -L -o deploy.sh https://raw.githubusercontent.com/vsesem-git/bbb-mp4-panel/main/deploy.sh
sudo bash deploy.sh
```

Скрипт:
1. ставит Docker и docker compose plugin (если нет);
2. клонирует/обновляет репозиторий;
3. создаёт `.env` из `.env.example`;
4. запускает `docker compose up -d --build`;
5. определяет локальный IP (`hostname -I`) и печатает адрес панели, например:
   ```
   Веб-панель:   http://192.168.1.5:3000
   ```

Откройте адрес в браузере — панель готова к работе. На VPS с доменом можно передний край завернуть за nginx + Let's Encrypt (пример конфига ниже), бэкенд останется на `0.0.0.0:3000`.

## Переменные окружения (`.env` / `docker-compose`)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | Порт бэкенда (`0.0.0.0:$PORT`) |
| `DATA_DIR` | `/data` | Каталог с БД, записями, превью, логами |
| `MAX_CONCURRENT` | `2` | Параллельно записываемых задач (1–2 на старт) |
| `ALLOWED_ORIGINS` | `*` | CORS origins через запятую |
| `RESOLUTION` | `1920x1080` | Разрешение по умолчанию (WxH) |
| `VIDEO_BITRATE` | `2000k` | Битрейт видео по умолчанию |
| `AUDIO_BITRATE` | `128k` | Битрейт аудио по умолчанию |
| `FFMPEG_PRESET` | `veryfast` | Пресет кодирования FFmpeg |

## API

| Метод | Путь | Действие |
|---|---|---|
| `POST` | `/api/tasks` | Добавить задание `{url, resolution?, videoBitrate?, audioBitrate?, preset?}` |
| `GET` | `/api/tasks` | Список задач |
| `GET` | `/api/tasks/:id` | Детали (статус, прогресс, remaining, preview) |
| `POST` | `/api/tasks/:id/stop` | Остановить (SIGINT FFmpeg) |
| `POST` | `/api/tasks/:id/retry` | Повторить задачу в ошибке |
| `DELETE` | `/api/tasks/:id?keepFiles=true` | Удалить задачу (+ файлы, если не keepFiles) |
| `GET` | `/api/tasks/:id/download` | Скачать MP4 (поток, `Content-Disposition: attachment`) |
| `GET` | `/api/settings` | Глобальные настройки |
| `PUT` | `/api/settings` | Обновить настройки |
| `GET` | `/health` | Проверка работоспособности |

Валидация URL: шаблон `*/playback/presentation/2.3/<meeting_id>`, meeting_id извлекается из пути.

## Использование

1. Перейдите на http://<сервер>:3000.
2. Вставьте ссылку на запись BBB, например:
   `https://vks.vsesem.ru/playback/presentation/2.3/b0836d59cf31eec7e6677fc50f2fb7127e715fbb-1793082244017`
3. Нажмите «Добавить задание». При желании переопределите разрешение/битрейт для этого задания.
4. В списке вы увидите статус, остаточное время (`-H:MM:SS`), прогресс-бар и превью текущего кадра (обновляется раз в 60 с).
5. По завершении — нажмите «Скачать» (или «Скачать (частично)» после остановки).
6. Страница «Настройки» — глобальные параметры конвертации для новых задач.

Статусы: `queued` (в очереди) → `running` (запись) → `done` (готово) / `cancelled` (остановлено) / `error` (ошибка, до 2 автоповторов).

## nginx (опционально, продакшен на VPS)

Пример `/etc/nginx/sites-available/bbb-mp4-panel`:

```nginx
server {
    listen 80;
    server_name panel.vsem.example.ru;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /previews/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

Панель сама не занимается HTTPS — при необходимости поставьте перед ней nginx с сертификатом Let's Encrypt. Внутри LAN достаточно `http://192.168.1.5:3000`.

## Разработка локально (без Docker)

```bash
cd backend
cp ../.env.example .env   # DATA_DIR=/tmp/bbb-data, PORT=3000
npm install
npm start
cd ../frontend
npm install
npm run dev               # http://localhost:5173 (Vite proxy к бэкенду не нужен, API относительное)
```

Для сборки фронта в образ: `cd frontend && npm run build` → `dist` раздаётся бэкендом через `express.static`.

## Технологический стек

- Бэкенд/воркер: Node.js, Express, better-sqlite3 (SQLite), Puppeteer (Chromium), FFmpeg, Xvfb, pulseaudio.
- Фронт: React + Vite, React Router.
- Инфраструктура: Docker, docker compose, Ubuntu.
