'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const {
  initDb,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getSettings,
  upsertSettings,
} = require('./db');
const { startWorker, stopTask, retryTask, getQueueStatus } = require('./worker');
const logger = require('./logger');

const DATA_DIR = process.env.DATA_DIR || '/data';
const PORT = parseInt(process.env.PORT || '3000', 10);
const FRONTEND_DIST = path.join(REPO_ROOT, 'frontend', 'dist');

logger.init(DATA_DIR);

const app = express();

const rawOrigins = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = rawOrigins.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.originalUrl}`);
  next();
});

// Превью текущих кадров: /previews/<taskId>.jpg
app.use('/previews', express.static(path.join(DATA_DIR, 'previews')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

function parseTaskBody(body, settings) {
  if (!body || typeof body.url !== 'string') {
    throw new Error('поле url обязательно');
  }
  const url = String(body.url).trim();
  const m = url.match(/\/playback\/presentation\/2\.3\/([^\/#?]+)/);
  if (!m) {
    throw new Error('URL должен соответствовать шаблону */playback/presentation/2.3/<meeting_id>');
  }
  const meetingId = m[1];
  const resolution = String(body.resolution || settings.RESOLUTION).trim();
  const videoBitrate = String(body.videoBitrate || settings.VIDEO_BITRATE).trim();
  const audioBitrate = String(body.audioBitrate || settings.AUDIO_BITRATE).trim();
  const preset = String(body.preset || settings.FFMPEG_PRESET).trim();
  if (!/^\d+x\d+$/.test(resolution)) {
    throw new Error('resolution должен быть в формате WxH, например 1920x1080');
  }
  return { url, meetingId, resolution, videoBitrate, audioBitrate, preset };
}

// ---- tasks ----

app.get('/api/tasks', (_req, res) => {
  res.json(listTasks());
});

app.get('/api/tasks/:id', (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  res.json(t);
});

app.post('/api/tasks', (req, res) => {
  try {
    const settings = getSettings();
    const parsed = parseTaskBody(req.body, settings);
    const t = createTask(parsed);
    logger.info(`задача ${t.id} создана: meeting=${t.meeting_id} resolution=${t.resolution}`);
    const { enqueue } = require('./worker');
    enqueue(t.id);
    return res.status(201).json(t);
  } catch (err) {
    logger.error('ошибка создания задачи', err);
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/stop', (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  const result = stopTask(req.params.id);
  res.json({ id: t.id, status: t.status, ...result });
});

app.post('/api/tasks/:id/retry', (req, res) => {
  const result = retryTask(req.params.id);
  if (!result) return res.status(404).json({ error: 'task not found' });
  if (result.rejected) return res.status(409).json({ error: 'task is running', id: result.id });
  res.json(result);
});

app.delete('/api/tasks/:id', (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });

  stopTask(req.params.id); // если running — запрашиваем остановку

  const keepFiles = req.query.keepFiles === 'true';
  if (!keepFiles) {
    const files = [];
    if (t.output_path) files.push(t.output_path);
    files.push(path.join(DATA_DIR, 'recordings', `${t.meeting_id}.mp4`));
    files.push(path.join(DATA_DIR, 'recordings', `${t.meeting_id}_${t.id}.mp4`));
    files.push(path.join(DATA_DIR, 'previews', `${t.id}.jpg`));
    for (const f of files) {
      if (!f) continue;
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {
        logger.error(`не удалось удалить файл ${f}`, e);
      }
    }
  }

  deleteTask(req.params.id);
  res.json({ ok: true });
});

app.get('/api/tasks/:id/download', (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  const file = t.output_path;
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'file not found' });

  res.setHeader('Content-Disposition', `attachment; filename="${t.meeting_id}.mp4"`);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
  });
  stream.pipe(res);
});

// ---- settings ----

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const values = req.body || {};
    const allowed = ['RESOLUTION', 'VIDEO_BITRATE', 'AUDIO_BITRATE', 'FFMPEG_PRESET', 'MAX_CONCURRENT'];
    const update = {};
    for (const key of allowed) {
      if (values[key] !== undefined) update[key] = String(values[key]);
    }
    if (update.RESOLUTION && !/^\d+x\d+$/.test(update.RESOLUTION)) {
      throw new Error('resolution должен быть в формате WxH');
    }
    if (update.MAX_CONCURRENT && !/^\d+$/.test(update.MAX_CONCURRENT)) {
      throw new Error('MAX_CONCURRENT должен быть целым числом');
    }
    const next = upsertSettings(update);
    logger.info(`настройки обновлены: ${JSON.stringify(update)}`);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/queue', (_req, res) => {
  res.json(getQueueStatus());
});

// ---- frontend (SPA) ----

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api|previews|health|queue).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  app.get('/api/_dev', (_req, res) => {
    res.json({ note: 'frontend not built yet; run `cd frontend && npm run build`' });
  });
}

process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection', err));

async function main() {
  await initDb(DATA_DIR);
  getSettings(); // ensure defaults exist

  logger.info(`bbb-mp4-panel: DATA_DIR=${DATA_DIR} PORT=${PORT}`);

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`панель доступна на http://0.0.0.0:${PORT}`);
  });

  startWorker();
}

main().catch((err) => {
  logger.error('startup failed', err);
  process.exit(1);
});
