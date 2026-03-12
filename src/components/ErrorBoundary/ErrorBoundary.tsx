import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import './ErrorBoundary.css';

interface Props {
    children: ReactNode;
    fallbackLabel?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary] ${this.props.fallbackLabel ?? 'Component'} crashed:`, error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <span className="error-boundary-title">
                            {this.props.fallbackLabel ?? 'Component'} crashed
                        </span>
                        <span className="error-boundary-message">
                            {this.state.error?.message ?? 'Unknown error'}
                        </span>
                        <button className="error-boundary-reset" onClick={this.handleReset}>
                            Retry
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
