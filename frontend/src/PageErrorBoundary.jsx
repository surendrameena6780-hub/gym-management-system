import React from 'react';
import { AlertTriangle, LayoutDashboard, RefreshCw } from 'lucide-react';

class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`${this.props.pageName || 'Page'} render error:`, error, errorInfo);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  handleGoHome = () => {
    this.setState({ error: null });
    this.props.onGoHome?.();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const pageName = this.props.pageName || 'This page';

    return (
      <div className="min-h-[420px] flex items-center justify-center py-10">
        <div
          role="alert"
          className="w-full max-w-2xl rounded-[28px] border border-rose-100 bg-white/90 p-8 shadow-[0_24px_70px_-35px_rgba(15,23,42,0.45)] backdrop-blur"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
                <AlertTriangle size={24} />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-rose-500">Page recovery</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{pageName} hit an unexpected error.</h2>
                <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-slate-500">
                  The rest of the app is still available. Retry this page, or jump back to the dashboard while the faulty screen reloads.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800"
            >
              <RefreshCw size={16} />
              Retry page
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
            >
              <LayoutDashboard size={16} />
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default PageErrorBoundary;