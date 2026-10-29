import { useState, useEffect, useCallback } from 'react';
import {
  fetchTasks,
  createTask,
  stopTask,
  retryTask,
  deleteTask,
  downloadUrl,
  previewUrl,
  fetchSettings,
  RESOLUTION_OPTIONS,
  formatHMS,
  STATUS_LABELS,
} from '../api.js';
import { useErrors, CATEGORIES } from '../context/ErrorContext.jsx';

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    url: '',
    resolution: '1920x1080',
    videoBitrate: '',
    audioBitrate: '',
  });
  const [customResolution, setCustomResolution] = useState('');
  const [toast, setToast] = useState(null);
  const { addError } = useErrors();

  useEffect(() => {
    let mounted = true;
    fetchSettings()
      .then((s) => { if (mounted) setSettings(s); })
      .catch((err) => {
        if (mounted) {
          addError({
            category: err.category || 'api',
            message: err.message || 'Не удалось загрузить настройки',
            source: 'tasks',
            details: `HTTP ${err.status || 'неизвестно'}`,
          });
        }
      });
    const timer = setInterval(() => { if (mounted) refresh(); }, 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, [addError]);

  const refresh = useCallback(() => {
    fetchTasks()
      .then(setTasks)
      .catch((err) => {
        addError({
          category: err.category || 'api',
          message: err.message || 'Не удалось загрузить список задач',
          source: 'tasks',
          details: `HTTP ${err.status || 'неизвестно'}`,
        });
      });
  }, [addError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const resolution =
        form.resolution === 'custom' && customResolution.trim()
          ? customResolution.trim()
          : form.resolution;
      await createTask({
        url: form.url,
        resolution,
        videoBitrate: form.videoBitrate || undefined,
        audioBitrate: form.audioBitrate || undefined,
      });
      setForm({ url: '', resolution: '1920x1080', videoBitrate: '', audioBitrate: '' });
      setCustomResolution('');
      refresh();
      showToast('Задание добавлено');
    } catch (err) {
      addError({
        category: err.category || 'validation',
        message: err.message || 'Не удалось создать задачу',
        source: 'tasks',
        details: `HTTP ${err.status || 'неизвестно'}`,
      });
      showToast('Ошибка: ' + err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (id) => {
    try {
      await stopTask(id);
      refresh();
      showToast('Остановка записи…');
    } catch (err) {
      addError({
        category: err.category || 'api',
        message: err.message || 'Не удалось остановить задачу',
        source: 'tasks',
        details: `HTTP ${err.status || 'неизвестно'}`,
      });
      showToast('Ошибка: ' + err.message, 'err');
    }
  };

  const handleDelete = async (id, meetingId) => {
    if (!window.confirm(`Удалить задание "${meetingId}" и его файлы?`)) return;
    try {
      await deleteTask(id);
      refresh();
      showToast('Удалено');
    } catch (err) {
      addError({
        category: err.category || 'api',
        message: err.message || 'Не удалось удалить задачу',
        source: 'tasks',
        details: `HTTP ${err.status || 'неизвестно'}`,
      });
      showToast('Ошибка: ' + err.message, 'err');
    }
  };

  const handleRetry = async (id) => {
    try {
      await retryTask(id);
      refresh();
      showToast('Повтор запущен');
    } catch (err) {
      addError({
        category: err.category || 'api',
        message: err.message || 'Не удалось запустить повтор',
        source: 'tasks',
        details: `HTTP ${err.status || 'неизвестно'}`,
      });
      showToast('Ошибка: ' + err.message, 'err');
    }
  };

  const rowKey = (t) => t.id;

  return (
    <div className="card">
      <h2>Задачи конвертации</h2>
      <form onSubmit={handleAdd} className="row">
        <div className="input-group">
          <label>Ссылка на запись BBB</label>
          <input
            placeholder="https://domen.ru/playback/presentation/2.3/<meeting_id>"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </div>
        <div className="input-group" style={{ minWidth: 150 }}>
          <label>Разрешение</label>
          <select
            value={form.resolution}
            onChange={(e) => setForm({ ...form, resolution: e.target.value })}
          >
            {RESOLUTION_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="custom">своё</option>
          </select>
        </div>
        {form.resolution === 'custom' && (
          <div className="input-group" style={{ minWidth: 150 }}>
            <label>своё разрешение (WxH)</label>
            <input value={customResolution} onChange={(e) => setCustomResolution(e.target.value)} placeholder="1920x1080" />
          </div>
        )}
        <div className="input-group" style={{ minWidth: 140 }}>
          <label>Видео битрейт</label>
          <input value={form.videoBitrate} onChange={(e) => setForm({ ...form, videoBitrate: e.target.value })} placeholder="2000k" />
        </div>
        <button className="btn primary" disabled={loading} type="submit">
          Добавить задание
        </button>
      </form>
      <p className="small">
        Допустимые параметры берутся из глобальных настроек (<a href="/settings">Настройки</a>); при добавлении задания можно переопределить разрешение и битрейт.
      </p>

      <table>
        <thead>
          <tr>
            <th>Запись</th>
            <th>Ссылка</th>
            <th>Статус</th>
            <th>Осталось</th>
            <th>Прогресс</th>
            <th>Превью</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 ? (
            <tr><td colSpan={7} className="empty">Нет заданий. Добавьте первое — вставьте playback-ссылку выше.</td></tr>
          ) : (
            tasks.map((t) => (
              <tr key={rowKey(t)}>
                <td className="url-cell"><code>{t.meeting_id}</code></td>
                <td className="url-cell"><code>{t.url}</code></td>
                <td><span className={`status ${t.status}`}>{STATUS_LABELS[t.status] || t.status}</span>{t.error ? <span className="badge" title={t.error}>Ошибка</span> : null}</td>
                <td>
                  {t.status === 'running' && t.remaining > 0 ? `-${formatHMS(t.remaining)}` : t.duration > 0 ? `-0:00:00` : '—'}
                </td>
                <td>
                  <div className="progress"><div style={{ width: `${t.progress}%` }} /></div>
                  <span className="small">{t.progress}%</span>
                </td>
                <td>
                  {t.preview_updated_at ? (
                    <div className="preview"><img src={previewUrl(t.id, t.preview_updated_at)} alt="превью" /></div>
                  ) : (
                    <div className="preview-missing">нет превью</div>
                  )}
                </td>
                <td>
                  <div className="actions">
                    {t.status === 'running' && (
                      <>
                        <button className="btn danger" onClick={() => handleStop(t.id)}>Остановить</button>
                        <button className="btn danger" onClick={() => handleDelete(t.id, t.meeting_id)}>Удалить</button>
                      </>
                    )}
                    {t.status === 'queued' && (
                      <button className="btn danger" onClick={() => handleDelete(t.id, t.meeting_id)}>Удалить</button>
                    )}
                    {t.status === 'done' && (
                      <>
                        <a className="btn" href={downloadUrl(t.id)}>Скачать</a>
                        <button className="btn danger" onClick={() => handleDelete(t.id, t.meeting_id)}>Удалить</button>
                      </>
                    )}
                    {t.status === 'cancelled' && (
                      <>
                        {t.partial ? <a className="btn" href={downloadUrl(t.id)}>Скачать (частично)</a> : <span className="small">файла нет</span>}
                        <button className="btn danger" onClick={() => handleDelete(t.id, t.meeting_id)}>Удалить</button>
                      </>
                    )}
                    {t.status === 'error' && (
                      <>
                        <button className="btn primary" onClick={() => handleRetry(t.id)}>Повторить</button>
                        <button className="btn danger" onClick={() => handleDelete(t.id, t.meeting_id)}>Удалить</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
