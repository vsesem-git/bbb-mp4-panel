import { createContext, useContext, useState, useEffect } from 'react';

const ErrorContext = createContext(null);

export { ErrorContext };

const STORAGE_KEY = 'bbb-mp4-errors';
const MAX_ERRORS = 200;

export const CATEGORIES = {
  container: 'Контейнер',
  processing: 'Обработка',
  chrome: 'Chrome',
  api: 'API',
  validation: 'Валидация',
  unknown: 'Неизвестно',
};

export function ErrorProvider({ children }) {
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setErrors(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(errors.slice(0, MAX_ERRORS)));
    } catch (e) {
      /* ignore */
    }
  }, [errors]);

  const addError = (error) => {
    const newError = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      category: error.category || 'unknown',
      message: error.message || 'Неизвестная ошибка',
      source: error.source || 'ui',
      details: error.details || '',
      status: error.status || null,
    };
    setErrors((prev) => [newError, ...prev]);
  };

  const clearErrors = () => {
    setErrors([]);
  };

  const getErrorCategoryLabel = (category) => {
    return CATEGORIES[category] || CATEGORIES.unknown;
  };

  return (
    <ErrorContext.Provider
      value={{ errors, addError, clearErrors, getErrorCategoryLabel, CATEGORIES }}
    >
      {children}
    </ErrorContext.Provider>
  );
}

export const useErrors = () => {
  const ctx = useContext(ErrorContext);
  if (!ctx) {
    throw new Error('useErrors must be used within ErrorProvider');
  }
  return ctx;
};
