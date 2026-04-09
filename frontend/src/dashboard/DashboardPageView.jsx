import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SafeResponsiveContainer from '../components/SafeResponsiveContainer';
import {
  Activity,
  Bot,
  CheckCircle,
  Clock,
  CreditCard,
  DollarSign,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  Card,
  CustomTooltip,
  DashboardAnimationStyles,
  KPICard,
} from './dashboardPageShared';
import { getGreeting, getPriorityMeta } from './dashboardPageUtils';

const SmartTipsPanel = ({ controller }) => {
  const { dashboardData, navigateTo } = controller;

  return (
    <div
      className="relative p-[1.5px] rounded-[24px] shadow-[0_4px_24px_rgba(99,102,241,0.2)]"
      style={{
        background: 'linear-gradient(135deg, #6366f1, #a855f7, #ec4899)',
        opacity: 0,
        animation: 'cardCascade 0.6s ease-out 420ms forwards',
      }}
    >
      <div className="bg-white rounded-[23px] p-5 h-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}
            >
              <Sparkles size={14} className="text-white" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Smart Tips</span>
          </div>
          <div className="text-[9px] font-bold text-slate-400 text-right">
            <p>{dashboardData.automations.sentToday} Sent Today</p>
            <p>{dashboardData.automations.runsToday} Runs</p>
          </div>
        </div>

        <div className="space-y-2 flex-1">
          {dashboardData.ai.summaryLines.map((line) => (
            <div key={line.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{line.label}</p>
              <p className="text-[13px] font-bold text-slate-800 leading-snug mt-1">{line.value}</p>
            </div>
          ))}
        </div>

        {(dashboardData.automations.weeklyRuns > 0 || dashboardData.automations.weeklySent > 0) ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">7D Runs</p>
              <p className="text-xs font-black text-slate-800 mt-0.5">{dashboardData.automations.weeklyRuns}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">7D Reach</p>
              <p className="text-xs font-black text-slate-800 mt-0.5">{dashboardData.automations.weeklySent}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2 py-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Possible Value</p>
              <p className="text-xs font-black text-slate-800 mt-0.5">₹{dashboardData.automations.estimatedRecoveryValue.toLocaleString()}</p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigateTo('Dashboard', null, { action: 'broadcast' })}
            className="w-full rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-3 text-center hover:bg-indigo-50 transition-colors"
          >
            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400">No campaigns this week</p>
            <p className="text-[11px] font-bold text-indigo-600 mt-1">Run your first broadcast to see stats here</p>
          </button>
        )}

        <p className="text-[10px] text-slate-400 font-semibold">
          Last auto message: {dashboardData.automations.lastAutomationLabel}
        </p>

        <div className="space-y-2">
          {dashboardData.ai.recommendations.map((recommendation, index) => (
            <div
              key={recommendation.id}
              className="w-full rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black text-slate-800">Tip {index + 1}</p>
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-white text-slate-500 border border-slate-200">
                  {recommendation.urgency}
                </span>
              </div>
              <p className="text-[12px] font-bold text-slate-800 leading-snug mt-2">
                {recommendation.title}
              </p>
              <p className="text-[10px] text-slate-500 font-semibold mt-1 leading-relaxed">
                {recommendation.reason}
              </p>
              <p className="text-[10px] text-slate-400 font-bold mt-2">
                Possible gain ₹{Number(recommendation.impact || 0).toLocaleString()} · {recommendation.confidence}% confidence
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AttentionPanel = ({ controller }) => {
  const { dashboardData, isAutomating, navigateTo, setShowAddModal, setup } = controller;

  return (
    <Card
      className="p-0 overflow-hidden flex-1 flex flex-col"
      style={{ opacity: 0, animation: 'cardCascade 0.6s ease-out 500ms forwards' }}
    >
      <div className="px-5 py-4 border-b border-slate-100/80 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
          <ShieldAlert size={16} className="text-rose-500" /> Need Attention
        </h3>
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
          {dashboardData.ai.urgentCount} urgent
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {dashboardData.actionRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle size={20} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-800">No urgent issues right now.</p>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {setup.steps?.profile && setup.steps?.plans && setup.steps?.members
                  ? 'Keep an eye on renewals and check-ins.'
                  : 'Finish the remaining setup to unlock the full flow.'}
              </p>
            </div>
            {(!setup.steps?.profile || !setup.steps?.plans || !setup.steps?.members) && (
              <button
                type="button"
                onClick={() => {
                  if (!setup.steps?.plans) {
                    navigateTo('Plans');
                    return;
                  }
                  if (!setup.steps?.members) {
                    setShowAddModal(true);
                    return;
                  }
                  navigateTo('Settings', 'account');
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 transition-colors"
              >
                Finish Setup
              </button>
            )}
          </div>
        ) : (
          dashboardData.actionRows.map((row) => {
            const meta = getPriorityMeta(row.priority);
            return (
              <div
                key={row.id}
                className={`px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2.5 transition-colors hover:bg-slate-50 ${meta.rowClass}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm font-black text-slate-900 leading-none">{row.count}</span>
                    <span className="text-[13px] leading-tight font-semibold text-slate-700 truncate">{row.title}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 font-semibold tracking-wide mt-0.5">
                    {row.sub} · ₹{Number(row.impact || 0).toLocaleString()} impact · {row.urgency}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={row.action}
                  disabled={isAutomating || row.count === 0}
                  className={`shrink-0 px-3 py-1.5 text-[9px] font-black uppercase rounded-lg transition-all duration-200 ${meta.buttonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {row.cta}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
};

const DesktopRevenuePulsePanel = ({ controller }) => {
  const {
    chartDays,
    chartTotal,
    dashboardData,
    displayChartData,
    navigateTo,
    payStats,
    todayCheckins,
  } = controller;

  const bestRevenueDay = displayChartData.reduce((best, point) => {
    if (!best || Number(point?.rev || 0) > Number(best?.rev || 0)) {
      return point;
    }
    return best;
  }, null);

  const averageDailyRevenue = displayChartData.length > 0
    ? Math.round(chartTotal / displayChartData.length)
    : 0;
  const nextRecommendation = dashboardData.ai.recommendations[0] || null;

  return (
    <Card
      className="hidden desktop:block p-5 overflow-hidden relative"
      style={{ opacity: 0, animation: 'cardCascade 0.6s ease-out 420ms forwards' }}
    >
      <div className="absolute inset-0 pointer-events-none opacity-[0.7]">
        <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-20 left-8 h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600">
            <Activity size={12} /> Desk Pulse
          </div>
          <h3 className="mt-3 text-lg font-black tracking-tight text-slate-900">Operations Snapshot</h3>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Keep the chart focused, and use this panel for the daily operational read.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Range</p>
          <p className="mt-1 text-base font-black text-slate-900">{chartDays} Days</p>
          <p className="text-[11px] font-semibold text-slate-500">₹{chartTotal.toLocaleString()} tracked</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg / Day</p>
          <p className="mt-1 text-xl font-black text-slate-900">₹{averageDailyRevenue.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Best Day</p>
          <p className="mt-1 text-xl font-black text-slate-900">₹{Number(bestRevenueDay?.rev || 0).toLocaleString()}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">{bestRevenueDay?.name || 'No data'}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Check-ins</p>
          <p className="mt-1 text-xl font-black text-slate-900">{Number(todayCheckins || 0).toLocaleString()}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Today at the desk</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pending Dues</p>
          <p className="mt-1 text-xl font-black text-slate-900">₹{Number(payStats.pending_dues || 0).toLocaleString()}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Collections waiting</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="rounded-[22px] border border-indigo-100 bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(6,182,212,0.05))] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">Next Best Move</p>
              <p className="mt-2 text-base font-black text-slate-900">
                {nextRecommendation?.title || 'Momentum is stable today'}
              </p>
            </div>
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-right shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Potential</p>
              <p className="mt-1 text-sm font-black text-slate-900">₹{Number(nextRecommendation?.impact || dashboardData.automations.estimatedRecoveryValue || 0).toLocaleString()}</p>
            </div>
          </div>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
            {nextRecommendation?.reason || 'No urgent recommendation right now. Keep an eye on renewals and daily collections.'}
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => navigateTo('Payments', 'All', { section: 'collections-overview' })}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-left text-white transition-colors hover:bg-slate-800"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Collections</p>
            <p className="mt-1 text-sm font-black">Open revenue desk</p>
          </button>
          <button
            type="button"
            onClick={() => navigateTo('Members', 'Expiring Soon')}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Renewals</p>
            <p className="mt-1 text-sm font-black text-slate-900">{dashboardData.expiring7} expiring in 7 days</p>
          </button>
        </div>
      </div>
    </Card>
  );
};

const FloatingActionBar = ({ controller }) => {
  const {
    launchQuickAction,
    quickActionLoading,
    setCheckinQuery,
    setShowAddModal,
    setShowBroadcastModal,
    setShowCheckinModal,
    setShowPaymentModal,
  } = controller;

  return (
    <div className="app-floating-action-bar fixed mobile-floating-offset left-1/2 -translate-x-1/2 z-[90] animate-in fade-in duration-500 w-[calc(100%-1.5rem)] max-w-[520px]">
      <div
        className="gv-fab-shell rounded-[22px] border border-white/8 backdrop-blur-2xl p-1.5"
        style={{
          background: 'rgba(10, 12, 30, 0.94)',
          boxShadow: '0 8px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        <div className="grid grid-cols-4 gap-1">
          {[
            { label: 'Add Member', icon: <UserPlus size={16} strokeWidth={2.5} />, color: 'text-emerald-400', onClick: () => setShowAddModal(true) },
            { label: 'Renew', icon: <RefreshCw size={15} strokeWidth={2.5} />, color: 'text-indigo-400', onClick: () => setShowPaymentModal(true) },
            { label: 'Broadcast', icon: <MessageSquare size={15} strokeWidth={2.5} />, color: 'text-violet-400', onClick: () => setShowBroadcastModal(true) },
            { label: 'Check In', icon: <CheckCircle size={15} strokeWidth={2.5} />, color: 'text-sky-400', onClick: () => { setCheckinQuery(''); setShowCheckinModal(true); } },
          ].map(({ label, icon, color, onClick }) => {
            const isLoading = quickActionLoading === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => launchQuickAction(label, onClick)}
                disabled={Boolean(quickActionLoading)}
                aria-label={label}
                className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-[16px] transition-all duration-150 active:scale-[0.93] hover:bg-white/5 disabled:opacity-70 ${color}`}
              >
                {isLoading ? <RefreshCw size={15} strokeWidth={2.5} className="animate-spin" /> : icon}
                <span className="text-[10px] font-bold leading-none tracking-wide">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const DashboardPageView = ({ controller, isActive = true }) => {
  const {
    chartDays,
    chartTotal,
    dashboardData,
    displayChartData,
    gymName,
    handleSkipSetup,
    handleStartTour,
    isSkipped,
    isWarmupRetrying,
    navigateTo,
    payStats,
    setChartDays,
    setup,
    showTourBanner,
    todayCheckins,
  } = controller;

  const topCards = [
    {
      title: 'Active Members',
      value: dashboardData.active,
      icon: Users,
      index: 0,
      iconGradient: 'linear-gradient(135deg, #10b981, #0d9488)',
      onClick: () => navigateTo('Members', 'Active'),
    },
    {
      title: 'Monthly Revenue',
      value: `₹${dashboardData.monthlyRevenue.toLocaleString()}`,
      icon: TrendingUp,
      index: 1,
      iconGradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      onClick: () => navigateTo('Payments', 'All', { section: 'collections-overview' }),
    },
    {
      title: "Today's Revenue",
      value: `₹${Number(payStats.today_revenue).toLocaleString()}`,
      icon: DollarSign,
      index: 2,
      iconGradient: 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
      onClick: () => navigateTo('Payments', 'All', { section: 'collections-overview' }),
    },
    {
      title: 'Expiring in 7 Days',
      value: dashboardData.expiring7,
      icon: Clock,
      index: 3,
      iconGradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
      onClick: () => navigateTo('Members', 'Expiring Soon'),
      tag: dashboardData.expiring7 > 0 ? 'Action needed' : undefined,
    },
  ];

  const bottomCards = [
    {
      title: 'Check-ins Today',
      value: todayCheckins,
      icon: CheckCircle,
      index: 8,
      iconGradient: 'linear-gradient(135deg, #14b8a6, #06b6d4)',
      onClick: () => navigateTo('Attendance', 'All', { section: 'live-feed' }),
    },
    {
      title: 'Unpaid Profiles',
      value: dashboardData.unpaid,
      icon: CreditCard,
      index: 9,
      iconGradient: 'linear-gradient(135deg, #64748b, #475569)',
      onClick: () => navigateTo('Members', 'Unpaid'),
    },
    {
      title: 'Expired Members',
      value: dashboardData.expired,
      icon: UserMinus,
      index: 10,
      iconGradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
      onClick: () => navigateTo('Members', 'Expired'),
      tag: dashboardData.expired > 0 ? 'Re-engage' : undefined,
    },
    {
      title: 'Pending Dues',
      value: `₹${Number(payStats.pending_dues).toLocaleString()}`,
      icon: Activity,
      index: 11,
      iconGradient: 'linear-gradient(135deg, #f97316, #ef4444)',
      onClick: () => navigateTo('Payments', 'Pending', { section: 'payments-ledger' }),
    },
  ];

  return (
    <div className="min-h-full dashboard-content-safe font-inter relative">
      <DashboardAnimationStyles />

      {isWarmupRetrying && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm font-semibold">
          Backend is waking up. Retrying dashboard data automatically...
        </div>
      )}

      {showTourBanner && !setup.is_complete && !isSkipped && (
        <div className="relative overflow-hidden bg-slate-900 rounded-[32px] shadow-2xl border border-slate-800 p-8 desktop:p-10 mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-purple-500/20 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10 flex flex-col desktop:flex-row items-center gap-10">
            <div className="w-40 h-40 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.4)] shrink-0">
              <Bot size={64} className="text-indigo-400 animate-bounce" />
            </div>
            <div className="flex-1 text-center desktop:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-black uppercase tracking-widest mb-4">
                <Sparkles size={14} /> Auto-Pilot Initialized
              </div>
              <h2 className="text-3xl desktop:text-4xl font-black text-white mb-4 tracking-tight">
                Let&apos;s build your Gym, <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">together.</span>
              </h2>
              <p className="text-slate-400 font-medium text-lg leading-relaxed mb-8 max-w-2xl mx-auto md:mx-0">
                Skip the manual setup. Click start, and our AI Guide will take control of your screen to explain how to configure your business.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  type="button"
                  onClick={handleStartTour}
                  className="w-full sm:w-auto px-8 py-4 bg-white text-slate-900 rounded-xl font-black text-sm hover:bg-indigo-50 transition-all hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2"
                >
                  <Play size={18} fill="currentColor" /> Start Automated Tour
                </button>
                <button
                  type="button"
                  onClick={handleSkipSetup}
                  className="w-full sm:w-auto px-6 py-4 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                >
                  Skip Tour <X size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        id="tour-dashboard-hero"
        className="gv-dashboard-hero relative overflow-hidden rounded-[24px] sm:rounded-[28px] p-5 sm:p-6 desktop:p-8 mb-5 sm:mb-6"
        style={{
          boxShadow: '0 20px 60px rgba(7,10,24,0.34)',
          opacity: 0,
          animation: 'cardCascade 0.7s cubic-bezier(0.16,1,0.3,1) 0ms forwards, gv-hero-gradient-drift 8s ease-in-out 700ms infinite alternate',
        }}
      >
        <div className="gv-dashboard-hero-sheen" />
        <div className="gv-dashboard-hero-grid" />
        <div className="gv-dashboard-hero-orb gv-dashboard-hero-orb-a" />
        <div className="gv-dashboard-hero-orb gv-dashboard-hero-orb-b" />
        <div className="gv-dashboard-hero-orb gv-dashboard-hero-orb-c" />

        <div className="relative flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 bg-emerald-400 rounded-full inline-block" style={{ animation: 'heroPulse 2s ease-in-out infinite' }} />
              <span className="text-emerald-400/80 text-[10px] font-black uppercase tracking-[0.22em]">Live Dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-3xl desktop:text-[2.75rem] font-black text-white tracking-tight leading-none mb-2">
              {getGreeting()} 👋
            </h1>
            <p className="text-white/75 font-semibold text-sm mb-1">{gymName || 'Your gym'}</p>
            <p className="text-white/40 font-semibold text-sm">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="flex items-center gap-5 lg:gap-8 flex-wrap">
            {[
              { label: 'Active Members', value: dashboardData.active, color: 'text-emerald-300' },
              { label: 'Monthly Revenue', value: `₹${dashboardData.monthlyRevenue.toLocaleString()}`, color: 'text-indigo-300' },
              { label: 'Health Score', value: `${dashboardData.healthScore}%`, color: 'text-purple-300' },
            ].map((metric, index) => (
              <div key={metric.label} className="flex items-center gap-5 lg:gap-8">
                {index > 0 && <div className="w-[1px] h-10 bg-white/10 hidden sm:block" />}
                <div>
                  <p className={`text-2xl desktop:text-3xl font-black tracking-tight ${metric.color}`}>{metric.value}</p>
                  <p className="text-white/35 text-[9px] font-black uppercase tracking-[0.2em] mt-0.5">
                    {metric.label === 'Health Score' ? 'Gym Health' : metric.label}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {topCards.map((card) => <KPICard key={card.title} {...card} />)}
        </div>

        <div className="grid grid-cols-12 gap-5 desktop:items-start">
          <div className="col-span-12 desktop:col-span-8 space-y-5">
            <Card
              className="p-6 flex flex-col"
              style={{ opacity: 0, animation: 'cardCascade 0.6s ease-out 340ms forwards' }}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="font-black text-slate-900 text-lg tracking-tight">Revenue Trend</h3>
                  <p className="text-xs text-slate-400 font-semibold mt-0.5">
                    <span className="font-black text-slate-700">₹{chartTotal.toLocaleString()}</span> · last {chartDays} days
                  </p>
                </div>
                <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl">
                  {[7, 30].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setChartDays(days)}
                      aria-pressed={chartDays === days}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${chartDays === days ? 'bg-white text-slate-900 shadow-sm shadow-black/5' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {days}D
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-[220px] desktop:h-[320px]">
                {displayChartData.length > 0 ? (
                  <SafeResponsiveContainer
                    isActive={isActive}
                    fallback={<div className="h-full rounded-2xl border border-slate-100 bg-slate-50" />}
                  >
                      <AreaChart data={displayChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 0" vertical={false} stroke="rgba(99,102,241,0.06)" />
                        <XAxis
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                          dy={8}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                          tickFormatter={(value) => `₹${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`}
                          width={44}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                        <Area
                          type="monotone"
                          dataKey="rev"
                          stroke="#6366f1"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#revGrad)"
                          dot={false}
                          activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                        />
                      </AreaChart>
                  </SafeResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center">
                      <TrendingUp size={24} className="text-slate-300" />
                    </div>
                    <p className="text-sm font-bold text-slate-300">No revenue data for this period</p>
                  </div>
                )}
              </div>
            </Card>

            <DesktopRevenuePulsePanel controller={controller} />
          </div>

          <div className="col-span-12 desktop:col-span-4 flex flex-col gap-5">
            <SmartTipsPanel controller={controller} />
            <AttentionPanel controller={controller} />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {bottomCards.map((card) => <KPICard key={card.title} {...card} />)}
        </div>
      </div>

      <FloatingActionBar controller={controller} />
    </div>
  );
};

export default DashboardPageView;