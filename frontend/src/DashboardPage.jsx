import { RefreshCw, AlertTriangle } from 'lucide-react';
import DashboardPageModals from './dashboard/DashboardPageModals';
import DashboardPageView from './dashboard/DashboardPageView';
import useDashboardPageController from './dashboard/useDashboardPageController';
import PageLoader from './PageLoader';

const DashboardPage = (props) => {
  const controller = useDashboardPageController(props);

  if (controller.loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  if (controller.fetchError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[56vh] gap-4 px-6">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center">
          <AlertTriangle size={28} className="text-rose-500" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-black text-slate-800 dark:text-white mb-1">Dashboard failed to load</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Something went wrong while fetching your data. This usually resolves on retry.</p>
        </div>
        <button
          onClick={controller.retryDashboard}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <DashboardPageView controller={controller} isActive={props.isActive !== false} />
      <DashboardPageModals controller={controller} />
    </>
  );
};

export default DashboardPage;