/**
 * Error Boundary перехватывает ошибки рендеринга в дочерних компонентах,
 * чтобы вся страница не fell на белый экран из-за одной ошибки.
 */
import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
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
        </div>
      );
    }
    return this.props.children;
  }
}
