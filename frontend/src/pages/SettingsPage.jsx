import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings, RESOLUTION_OPTIONS } from '../api.js';

export default function SettingsPage() {
  const [values, setValues] = useState({
    RESOLUTION: '1920x1080',
    VIDEO_BITRATE: '2000k',
    AUDIO_BITRATE: '128k',
    FFMPEG_PRESET: 'veryfast',
    MAX_CONCURRENT: '2',
  });
  const [customResolution, setCustomResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchSettings().then(setValues).catch(() => setToast('Не удалось загрузить настройки', 'err'));
  }, []);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const resolution = values.RESOLUTION === 'custom' && customResolution.trim()
        ? customResolution.trim()
        : values.RESOLUTION;
      await updateSettings({ ...values, RESOLUTION: resolution });
      setValues({ ...values, RESOLUTION: resolution });
      showToast('Настройки сохранены');
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h2>Глобальные настройки конвертации</h2>
      <p className="small">
        Применяются к новым заданиям, если при создании не указаны свои значения.
        На уже созданные задания не распространяются.
      </p>
      <form onSubmit={handleSave} className="form-grid">
        <div className="setting-row">
          <label>Разрешение видео</label>
          <select value={values.RESOLUTION} onChange={(e) => setValues({ ...values, RESOLUTION: e.target.value })}>
            {RESOLUTION_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="custom">своё</option>
          </select>
          {values.RESOLUTION === 'custom' && (
            <input value={customResolution} onChange={(e) => setCustomResolution(e.target.value)} placeholder="1920x1080" />
          )}
        </div>
        <div className="setting-row">
          <label>Битрейт видео (-b:v)</label>
          <input value={values.VIDEO_BITRATE} onChange={(e) => setValues({ ...values, VIDEO_BITRATE: e.target.value })} placeholder="2000k" />
        </div>
        <div className="setting-row">
          <label>Битрейт аудио (-b:a)</label>
          <input value={values.AUDIO_BITRATE} onChange={(e) => setValues({ ...values, AUDIO_BITRATE: e.target.value })} placeholder="128k" />
        </div>
        <div className="setting-row">
          <label>Пресет кодирования (-preset)</label>
          <select value={values.FFMPEG_PRESET} onChange={(e) => setValues({ ...values, FFMPEG_PRESET: e.target.value })}>
            ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <label>Макс. параллельных записей</label>
          <input type="number" min="1" max="8" value={values.MAX_CONCURRENT} onChange={(e) => setValues({ ...values, MAX_CONCURRENT: e.target.value })} placeholder="2" />
        </div>
        <button className="btn primary" disabled={saving} type="submit">Сохранить настройки</button>
      </form>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
