'use strict';

const { recordTask } = require('./recorder');
const { getTask, updateTask, listTasks } = require('./db');
const logger = require('./logger');

/**
 * Очередь задач с ограничением параллелизма (MAX_CONCURRENT, по умолчанию 2).
 * Задачи обрабатываются внутри контейнера бэкенда — отдельный Docker-in-Docker
 * не нужен (запись идёт через Xvfb + Puppeteer + FFmpeg в этом же контейнере).
 */

const MAX_CONCURRENT = Math.max(1, Math.min(8, parseInt(process.env.MAX_CONCURRENT || '2', 10)));

const queue = []; // task id'ы, ожидающие обработки
const active = new Map(); // id -> { stopRequested: boolean }
let runningCount = 0;
let started = false;

function startWorker() {
  if (started) return;
  started = true;
  logger.info(`worker запущен, MAX_CONCURRENT=${MAX_CONCURRENT}`);

  // При перезапуске контейнера ставим в очередь только queued-задачи.
  // Задачи, которые были running на момент перезапуска, остаются в статусе
  // running (документировано в README) — их файлы/превью остаются на диске.
  const tasks = listTasks();
  for (const t of tasks) {
    if (t.status === 'queued') enqueue(t.id);
  }
  setImmediate(() => tick());
}

function enqueue(id) {
  if (active.has(id) || queue.includes(id)) return;
  queue.push(id);
  logger.info(`задача ${id} поставлена в очередь (в очереди: ${queue.length})`);
  tick();
}

async function tick() {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift();
    runningCount += 1;
    const ctrl = { stopRequested: false };
    active.set(id, ctrl);

    runTask(id, ctrl)
      .catch((err) => logger.error(`worker: задача ${id} упала`, err))
      .finally(() => {
        runningCount -= 1;
        active.delete(id);
        tick();
      });
  }
}

async function runTask(id, ctrl) {
  const task = getTask(id);
  if (!task) return;

  let status;
  try {
    status = await recordTask(task, ctrl);
  } catch (err) {
    status = 'error';
    updateTask(id, { error: err.message });
  }

  const task2 = getTask(id);
  if (status === 'error') {
    const retryCount = (task2.retry_count || 0) + 1;
    if (retryCount <= 2) {
      logger.info(`задача ${id}: авто-повтор ${retryCount}/2`);
      updateTask(id, {
        status: 'queued',
        retry_count: retryCount,
        error: null,
        progress: 0,
        remaining: 0,
      });
      enqueue(id);
    } else {
      updateTask(id, { status: 'error' });
      logger.error(`задача ${id}: исчерпаны попытки (${retryCount}), статус error`);
    }
    return;
  }
  // 'done' / 'cancelled' уже установлены recorder'ом.
}

/**
 * Остановка записи: FFmpeg получает SIGINT (корректная финализация MP4),
 * затем считается задача отменённой.
 *
 * - running: ставим stopRequested=true -> recorder завершит запись и статусом
 *   пометит cancelled.
 * - queued: убираем из очереди, статус cancelled.
 */
function stopTask(id) {
  const act = active.get(id);
  if (act) {
    act.stopRequested = true;
    logger.info(`задача ${id}: запрошена остановка (SIGINT FFmpeg)`);
    return { stopped: true, running: true };
  }
  const idx = queue.indexOf(id);
  if (idx !== -1) {
    queue.splice(idx, 1);
    updateTask(id, { status: 'cancelled' });
    logger.info(`задача ${id}: удалена из очереди, статус cancelled`);
    return { stopped: true, running: false };
  }
  const t = getTask(id);
  if (t && t.status === 'running') {
    return { stopped: false, running: true };
  }
  return { stopped: false, running: false };
}

/**
 * Повтор задачи (кнопка "Повторить" при ошибке).
 */
function retryTask(id) {
  const t = getTask(id);
  if (!t) return null;
  if (t.status === 'running') return { rejected: true, reason: 'running' };
  updateTask(id, {
    status: 'queued',
    retry_count: 0,
    error: null,
    progress: 0,
    remaining: 0,
    partial: 0,
  });
  enqueue(id);
  return getTask(id);
}

function getQueueStatus() {
  return {
    maxConcurrent: MAX_CONCURRENT,
    running: runningCount,
    queued: queue.length,
  };
}

module.exports = { startWorker, enqueue, stopTask, retryTask, getQueueStatus };
