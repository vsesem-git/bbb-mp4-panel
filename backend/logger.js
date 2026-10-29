'use strict';

const fs = require('fs');
const path = require('path');

let logFile = null;

function init(dataDir) {
  try {
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
    logFile = fs.createWriteStream(path.join(dataDir, 'logs', 'app.log'), { flags: 'a' });
  } catch (e) {
    // stdout only if log file cannot be created
    logFile = null;
  }
}

function write(level, msg) {
  const line = `${new Date().toISOString()} ${level} ${msg}\n`;
  process.stdout.write(line);
  if (logFile) {
    try { logFile.write(line); } catch (e) { /* ignore */ }
  }
}

function info(msg) { write('INFO ', msg); }
function error(msg, err) {
  const detail = err && err.stack ? err.stack : err !== undefined ? String(err) : '';
  write('ERROR', detail ? `${msg} ${detail}` : msg);
}
function debug(msg) {
  if (process.env.DEBUG) write('DEBUG', msg);
}

module.exports = { init, info, error, debug };
