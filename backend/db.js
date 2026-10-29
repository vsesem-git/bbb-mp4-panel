'use strict';

/**
 * SQLite-хранилище на базе sql.js (чистый JS + WASM, без нативной компиляции
 * при установке).
 *
 * База хранится в файле <DATA_DIR>/bbb-mp4.sqlite. После каждого
 * change-операции файл перезаписывается через db.export() — просто и надёжно
 * для нашей нагрузки (записи редкие, одно задание — несколько минут).
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  RESOLUTION: '1920x1080',
  VIDEO_BITRATE: '2000k',
  AUDIO_BITRATE: '128k',
  FFMPEG_PRESET: 'veryfast',
  MAX_CONCURRENT: '2',
};

let SQL = null;
let db = null;
let dbFile = null;

function now() {
  return new Date().toISOString();
}

function persist() {
  if (db && dbFile) {
    fs.writeFileSync(dbFile, Buffer.from(db.export()));
  }
}

async function initDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'recordings'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'previews'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

  dbFile = path.join(dataDir, 'bbb-mp4.sqlite');
  const exists = fs.existsSync(dbFile);
  const buffer = exists ? fs.readFileSync(dbFile) : null;

  SQL = await initSqlJs();
  db = new SQL.Database(buffer);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      resolution TEXT NOT NULL,
      video_bitrate TEXT NOT NULL,
      audio_bitrate TEXT NOT NULL,
      preset TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      remaining INTEGER NOT NULL DEFAULT 0,
      duration INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      partial INTEGER NOT NULL DEFAULT 0,
      output_path TEXT,
      preview_updated_at REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  `);

  const upsert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    upsert.run([key, value]);
  }
  persist();

  return db;
}

function listTasks() {
  const rows = [];
  db.each('SELECT * FROM tasks ORDER BY created_at DESC', {}, (row) => rows.push(row));
  return rows;
}

function getTask(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').Fb([id]);
  return Object.keys(row).length ? row : null;
}

function createTask({ url, meetingId, resolution, videoBitrate, audioBitrate, preset }) {
  const id = crypto.randomUUID();
  const created = now();
  db.prepare(
    `INSERT INTO tasks
       (id, url, meeting_id, status, resolution, video_bitrate, audio_bitrate, preset, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
  ).run([id, url, meetingId, resolution, videoBitrate, audioBitrate, preset, created, created]);
  persist();
  return getTask(id);
}

const UPDATE_FIELDS = [
  'status', 'progress', 'remaining', 'duration', 'retry_count',
  'error', 'partial', 'output_path', 'preview_updated_at',
];

function updateTask(id, fields) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!UPDATE_FIELDS.includes(key)) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (!sets.length) return getTask(id);
  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(values);
  persist();
  return getTask(id);
}

function deleteTask(id) {
  const t = getTask(id);
  if (!t) return null;
  db.prepare('DELETE FROM tasks WHERE id = ?').run([id]);
  persist();
  return t;
}

function getSettings() {
  const rows = [];
  db.each('SELECT key, value FROM settings', {}, (row) => rows.push(row));
  const s = { ...DEFAULTS };
  for (const { key, value } of rows) {
    s[key] = value;
  }
  return s;
}

function upsertSettings(values) {
  const upsert = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(values)) {
    upsert.run([key, String(value)]);
  }
  persist();
  return getSettings();
}

module.exports = {
  initDb,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getSettings,
  upsertSettings,
  DEFAULTS,
};
