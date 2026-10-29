'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { updateTask } = require('./db');
const logger = require('./logger');

/**
 * Recorder для одного задания конвертации.
 *
 * Архитектурные решения (подробнее — README):
 *  - Каждое задание получает своё Xvfb-окно (:99, :100, …), так что параллельные
 *    задачи nunca не записывают экраны друг друга.
 *  - Chromium запускается headful на этом дисплее (DISPLAY=:N) через Puppeteer.
 *  - FFmpeg записывает экран через x11grab (видео) и pulseaudio default sink
 *    (аудио, если pulseaudio доступен — иначе видео без звука).
 *  - FFmpeg останавливается SIGINT — MP4 финализируется корректно; SIGKILL —
 *    только запасной вариант после 15-секундного таймаута.
 */

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';
const DATA_DIR = process.env.DATA_DIR || '/data';

const DISPLAY_BASE = 99;
let nextDisplay = DISPLAY_BASE;
const displaysInUse = new Set();

function allocDisplay() {
  while (displaysInUse.has(nextDisplay)) nextDisplay += 1;
  const d = nextDisplay;
  nextDisplay += 1;
  displaysInUse.add(d);
  return d;
}

function freeDisplay(d) {
  displaysInUse.delete(d);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Спим ms мс, но проверяем флаг остановки каждые 2 с, чтобы SIGINT
 * по кнопке «Остановить» приходил без минуты задержки.
 */
async function sleepInterruptible(ms, ctrl) {
  const step = 2000;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    if (ctrl.stopRequested) return false;
    await sleep(Math.min(step, ms - elapsed));
  }
  return !ctrl.stopRequested;
}

function parseTime(str) {
  if (!str) return 0;
  const p = String(str).trim().split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return 0;
}

function formatHMS(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pulseAvailable() {
  try {
    const r = spawnSync('pulseaudio', ['--check']);
    return r.status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Один кадр текущего экрана Xvfb -> preview.jpg (совпадает с записываемым кадром).
 */
function takeScreenshot(display, w, h, outPath) {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'x11grab', '-framerate', '1', '-video_size', `${w}x${h}`, '-i', `:${display}.0`,
        '-frames:v', '1', '-qscale:v', '2', outPath,
      ],
      { stdio: 'ignore' }
    );
    proc.on('exit', () => resolve());
    proc.on('error', () => resolve());
  });
}

/**
 * Запись одного задания.
 * ctrl.stopRequested — общий флаг остановки (ставится worker'ом по POST /stop).
 */
async function recordTask(task, ctrl) {
  const id = task.id;
  const [w, h] = String(task.resolution).split('x').map(Number);
  const display = `:${allocDisplay()}`;
  const baseOut = path.join(DATA_DIR, 'recordings', `${task.meeting_id}.mp4`);
  const outputPath = fs.existsSync(baseOut)
    ? path.join(DATA_DIR, 'recordings', `${task.meeting_id}_${id}.mp4`)
    : baseOut;
  const previewPath = path.join(DATA_DIR, 'previews', `${id}.jpg`);

  let xvfb = null;
  let browser = null;
  let ffmpegProc = null;
  let ffmpegExit = null;
  let finalStatus = 'error';
  let totalDuration = null;

  try {
    updateTask(id, {
      status: 'running',
      output_path: outputPath,
      progress: 0,
      remaining: 0,
      duration: 0,
      error: null,
      partial: 0,
    });

    // --- Xvfb для этого задания ---
    xvfb = spawn('Xvfb', [display, '-screen', '0', `${w}x${h}x24`, '-nolisten', 'tcp'], {
      stdio: 'ignore',
    });
    logger.info(`task ${id}: Xvfb ${display} ${w}x${h}x24`);
    await sleep(1500);

    const useAudio = pulseAvailable();
    logger.info(
      `task ${id}: audio capture ${useAudio ? 'enabled (pulseaudio)' : 'disabled (video-only)'}`
    );

    // --- Chrome на дисплее Xvfb ---
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROME_PATH,
      env: { ...process.env, DISPLAY: display },
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--autoplay-policy=no-user-gesture-required',
        '--ignore-certificate-errors',
        '--disable-web-security',
        '--allow-running-insecure-content',
        `--window-size=${w},${h}`,
      ],
      defaultViewport: { width: w, height: h },
    });

    const page = await browser.newPage();
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});

    try {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v && typeof v.play === 'function') v.play().catch(() => {});
      });
    } catch (e) {
      /* некритично */
    }

    try {
      await page.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return v && isFinite(v.duration) && v.duration > 0;
        },
        { timeout: 60000 }
      );
      totalDuration = await page.evaluate(() => document.querySelector('video').duration);
      logger.info(`task ${id}: video duration ${totalDuration}s`);
    } catch (e) {
      logger.warn(`task ${id}: duration not detected; progress will rely on remaining-time`);
    }

    // --- FFmpeg записывает экран Xvfb ---
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-f',
      'x11grab',
      '-framerate',
      '25',
      '-video_size',
      `${w}x${h}`,
      '-i',
      `:${display}.0`,
      '-c:v',
      'libx264',
      '-preset',
      task.preset,
      '-b:v',
      task.videoBitrate,
      '-maxrate',
      task.videoBitrate,
      '-bufsize',
      `${Math.max(1, parseInt(task.videoBitrate) * 2)}k`,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+frag_keyframe+empty_moov',
    ];
    if (useAudio) {
      ffmpegArgs.push(
        '-f', 'pulse', '-i', 'default',
        '-c:a', 'aac', '-b:a', task.audioBitrate,
        '-ar', '44100', '-ac', '2'
      );
    }
    ffmpegArgs.push(outputPath);

    ffmpegProc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    ffmpegProc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) logger.debug(`ffmpeg[${id}]: ${line}`);
    });
    ffmpegExit = new Promise((resolve) => ffmpegProc.once('exit', (code) => resolve(code)));
    logger.info(`task ${id}: ffmpeg started pid=${ffmpegProc.pid}`);

    // --- Основной цикл прогресса: опрос Video.js раз в 60 с ---
    let lastScreen = 0;
    let lastProgress = 0;

    while (!ctrl.stopRequested) {
      if (!(await sleepInterruptible(60000, ctrl))) break;

      if (ffmpegProc.exitCode !== null) {
        finalStatus = ffmpegProc.exitCode === 0 ? 'done' : 'error';
        break;
      }

      let state;
      try {
        state = await page.evaluate(() => {
          const rem = document.querySelector('.vjs-remaining-time-display');
          const v = document.querySelector('video');
          return {
            remainingText: rem ? rem.textContent.trim() : null,
            currentSec: v ? v.currentTime : null,
            durationSec: v ? v.duration : null,
          };
        });
      } catch (e) {
        logger.warn(`task ${id}: page evaluation failed, finishing`);
        break;
      }

      const remainingSec = parseTime(state.remainingText);
      const totalSec = state.durationSec ?? totalDuration;
      const elapsedSec = totalSec ? Math.max(0, totalSec - remainingSec) : 0;
      const progress =
        totalSec > 0 ? Math.min(100, Math.round((elapsedSec / totalSec) * 100)) : lastProgress || 0;
      lastProgress = progress;

      updateTask(id, { progress, remaining: remainingSec, duration: totalSec });

      if (Date.now() - lastScreen > 55000) {
        await takeScreenshot(display, w, h, previewPath);
        updateTask(id, { preview_updated_at: Date.now() });
        lastScreen = Date.now();
        logger.info(`task ${id}: progress ${progress}% remaining ${formatHMS(remainingSec)}`);
      }

      if (remainingSec <= 2 || progress >= 100) {
        finalStatus = 'done';
        break;
      }
    }
  } catch (err) {
    logger.error(`task ${id}: failed`, err);
    try {
      updateTask(id, { error: err.message });
    } catch (e) {
      /* ignore */
    }
    finalStatus = 'error';
  } finally {
    // Останавливаем FFmpeg SIGINT — MP4 финализируется корректно.
    try {
      if (ffmpegProc && ffmpegProc.exitCode === null) ffmpegProc.kill('SIGINT');
    } catch (e) { /* ignore */ }
    try {
      if (ffmpegProc) {
        await Promise.race([ffmpegExit, sleep(15000)]);
        if (ffmpegProc.exitCode === null) ffmpegProc.kill('SIGKILL');
      }
    } catch (e) { /* ignore */ }
    try {
      if (browser) await browser.close();
    } catch (e) { /* ignore */ }
    try {
      if (xvfb) xvfb.kill('SIGKILL');
    } catch (e) { /* ignore */ }
    freeDisplay(display);
  }

  if (ctrl.stopRequested) finalStatus = 'cancelled';
  const partial =
    finalStatus === 'cancelled' && fs.existsSync(outputPath) ? 1 : 0;
  updateTask(id, { status: finalStatus, partial });
  logger.info(`task ${id}: finished status=${finalStatus} partial=${partial}`);
  return finalStatus;
}

module.exports = { recordTask, parseTime, formatHMS, allocDisplay, freeDisplay };
