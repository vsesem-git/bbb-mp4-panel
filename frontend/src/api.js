/**
 * Клиент API. Все URL относительные — бэкенд и фронт живут на одном хосте,
 * никаких хардкодов IP/домена (см. README).
 */
async function json(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchTasks() {
  return json(fetch('/api/tasks'));
}

export async function createTask({ url, resolution, videoBitrate, audioBitrate, preset }) {
  return json(fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, resolution, videoBitrate, audioBitrate, preset }),
  }));
}

export async function stopTask(id) {
  return json(fetch(`/api/tasks/${id}/stop`, { method: 'POST' }));
}

export async function retryTask(id) {
  return json(fetch(`/api/tasks/${id}/retry`, { method: 'POST' }));
}

export async function deleteTask(id, keepFiles = false) {
  return json(fetch(`/api/tasks/${id}?${keepFiles ? 'keepFiles=true' : ''}`, { method: 'DELETE' }));
}

export function downloadUrl(id) {
  return `/api/tasks/${id}/download`;
}

export function previewUrl(id, updatedAt) {
  return `/previews/${id}.jpg?t=${updatedAt || ''}`;
}

export async function fetchSettings() {
  return json(fetch('/api/settings'));
}

export async function updateSettings(values) {
  return json(fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  }));
}

export const RESOLUTION_OPTIONS = ['1280x720', '1920x1080', '2560x1440', '3840x2160'];

export function parseTime(str) {
  if (!str) return 0;
  const p = String(str).trim().split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return 0;
}

export function formatHMS(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const STATUS_LABELS = {
  queued: 'В очереди',
  running: 'Запись',
  done: 'Готово',
  cancelled: 'Отменено',
  error: 'Ошибка',
};
