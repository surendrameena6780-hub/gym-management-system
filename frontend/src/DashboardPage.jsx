import DashboardPageModals from './dashboard/DashboardPageModals';
import DashboardPageView from './dashboard/DashboardPageView';
import useDashboardPageController from './dashboard/useDashboardPageController';
import PageLoader from './PageLoader';

const DashboardPage = (props) => {
  const controller = useDashboardPageController(props);

  if (controller.loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          minHeight: 'calc(var(--app-viewport-height) - var(--safe-area-top) - var(--app-bottom-ui-offset) - 5rem)',
        }}
      >
        <PageLoader />
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