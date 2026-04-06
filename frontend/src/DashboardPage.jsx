import DashboardPageModals from './dashboard/DashboardPageModals';
import DashboardPageView from './dashboard/DashboardPageView';
import useDashboardPageController from './dashboard/useDashboardPageController';
import PageLoader from './PageLoader';

const DashboardPage = (props) => {
  const controller = useDashboardPageController(props);

  if (controller.loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <>
      <DashboardPageView controller={controller} />
      <DashboardPageModals controller={controller} />
    </>
  );
};

export default DashboardPage;