import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui';

/** Keeps one broken panel from blanking the whole app; offers a reload. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SHRUTI UI error', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error)
      return (
        <div className="mx-auto max-w-2xl py-10">
          <ErrorState
            title="This page hit an unexpected error"
            message={this.state.error.message || String(this.state.error)}
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    return this.props.children;
  }
}
