import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../../utils/logger';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail = info.componentStack ? `${error.message}\n${info.componentStack}` : error.message;
    logError('ErrorBoundary', detail, error);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-panel">
          <h2 className="error-boundary-title">Something went wrong</h2>
          <p className="error-boundary-message">{error.message || String(error)}</p>
          {error.stack && (
            <pre className="error-boundary-stack">{error.stack}</pre>
          )}
          <div className="error-boundary-actions">
            <button
              type="button"
              className="error-boundary-btn error-boundary-btn-primary"
              onClick={this.handleReload}
            >
              Reload
            </button>
            <button
              type="button"
              className="error-boundary-btn"
              onClick={this.reset}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }
}
