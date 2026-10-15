import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected application error.' };
  }

  componentDidCatch(error, info) {
    console.error('Motion runtime error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-surface text-on-surface flex items-center justify-center p-6">
        <section className="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 p-8 text-center shadow-sm">
          <span className="material-symbols-outlined text-error text-4xl" aria-hidden="true">error</span>
          <h1 className="mt-4 text-xl font-bold">Motion needs to restart</h1>
          <p className="mt-2 text-sm text-on-surface-variant">Something unexpected interrupted the workspace. Your saved data is unchanged.</p>
          <button type="button" className="mt-6 px-5 py-2.5 rounded-lg bg-primary text-on-primary text-sm font-semibold" onClick={this.handleReload}>
            Reload Motion
          </button>
        </section>
      </main>
    );
  }
}
