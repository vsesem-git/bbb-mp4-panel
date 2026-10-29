import { Component } from 'react';
import { ErrorContext } from '../context/ErrorContext.jsx';

/**
 * Error Boundary перехватывает ошибки рендеринга в дочерних компонентах,
 * чтобы вся страница не fell на белый экран из-за одной ошибки.
 * Все ошибки отправляются в журнал ошибок.
 */
export class ErrorBoundary extends Component {
  static contextType = ErrorContext;

  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const { addError } = this.context;
    if (addError) {
      addError({
        category: 'unknown',
        message: error.message || 'Ошибка рендеринга React',
        source: 'ui',
        details: errorInfo.componentStack || '',
      });
    }
    console.error('ErrorBoundary caught an error:', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: '#991b1b' }}>
          <h2>Ошибка при отображении страницы</h2>
          <p>{this.state.error && this.state.error.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn primary"
          >
            Перезагрузить страницу
          </button>
          <p className="small" style={{ marginTop: 12 }}>
            Подробности ошибки доступны на вкладке <strong>Ошибки</strong>.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
