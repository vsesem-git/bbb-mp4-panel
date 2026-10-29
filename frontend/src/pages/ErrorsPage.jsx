import { useState } from 'react';
import { useErrors, CATEGORIES } from '../context/ErrorContext.jsx';

export default function ErrorsPage() {
  const { errors, clearErrors, getErrorCategoryLabel } = useErrors();
  const [activeTab, setActiveTab] = useState('all');

  const categories = ['all', 'container', 'processing', 'chrome', 'api', 'validation', 'unknown'];
  const tabLabels = {
    all: 'Все',
    container: 'Контейнер',
    processing: 'Обработка',
    chrome: 'Chrome',
    api: 'API',
    validation: 'Валидация',
    unknown: 'Неизвестно',
  };

  const categoryColors = {
    container: '#dc2626',
    processing: '#d97706',
    chrome: '#2563eb',
    api: '#7c3aed',
    validation: '#0891b2',
    unknown: '#6b7280',
  };

  const countByCategory = (cat) => {
    if (cat === 'all') return errors.length;
    return errors.filter((e) => e.category === cat).length;
  };

  const filteredErrors = activeTab === 'all'
    ? errors
    : errors.filter((e) => e.category === activeTab);

  return (
    <div className="card">
      <h2>Журнал ошибок</h2>
      <p className="small">
        Все ошибки контейнера, обработки, Chrome и API сохраняются здесь.
        Ошибки сохраняются даже после перезагрузки страницы.
      </p>

      <div className="actions" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`btn ${activeTab === cat ? 'primary' : ''}`}
            style={{
              marginBottom: 8,
              borderColor: categoryColors[cat] || '#cbd5e1',
              color: activeTab === cat ? '#fff' : '#374151',
              background: activeTab === cat ? categoryColors[cat] || '#cbd5e1' : '#fff',
            }}
          >
            {tabLabels[cat]} ({countByCategory(cat)})
          </button>
        ))}
        <button onClick={clearErrors} className="btn danger" style={{ marginBottom: 8 }}>
          Очистить журнал
        </button>
      </div>

      {filteredErrors.length === 0 ? (
        <div className="empty">Ошибок нет.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Категория</th>
              <th>Источник</th>
              <th>Сообщение</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {filteredErrors.map((err) => (
              <tr key={err.id}>
                <td className="small">{new Date(err.timestamp).toLocaleString('ru-RU')}</td>
                <td>
                  <span
                    className="status"
                    style={{
                      backgroundColor: `${categoryColors[err.category] || '#6b7280'}20`,
                      color: categoryColors[err.category] || '#6b7280',
                      border: `1px solid ${categoryColors[err.category] || '#6b7280'}`,
                    }}
                  >
                    {getErrorCategoryLabel(err.category)}
                  </span>
                </td>
                <td className="small" style={{ color: '#6b7280' }}>{err.source}</td>
                <td className="small" style={{ maxWidth: 320, wordBreak: 'break-all' }}>{err.message}</td>
                <td className="small" style={{ maxWidth: 400, wordBreak: 'break-all', color: '#6b7280' }}>
                  {err.details ? err.details : err.status ? `HTTP ${err.status}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
