import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  TrendingUp, Users, Activity, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Download,
  UserMinus, UserCheck, Clock, Target, ShieldCheck,
  MessageSquare, Phone, Award,
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import { openWhatsAppConversation } from './utils/externalNavigation';
import PageLoader from './PageLoader';

const EMPTY_ANALYTICS = {
  revenue: {
    graphData: [],
    arpu: 0,
    lostRevenue: 0,
    topPlans: [],
  },
  health: {
    active: 0,
    retention: 0,
    churn: 0,
    expired: 0,
  },
  risk: {
    expiringCount: 0,
    revenueAtRisk: 0,
    expiringList: [],
    inactiveCount: 0,
    inactiveList: [],
  },
  attendance: {
    heatmap: [],
    topMembers: [],
  },
};

function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const prevTarget = useRef(null);

  useEffect(() => {
    const end = Number(target) || 0;
    if (prevTarget.current === end) return;
    prevTarget.current = end;
    const begin = display;
    const startTime = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(begin + (end - begin) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm ${className}`}>
    {children}
  </div>
);

const KPICard = ({ title, value, change, trend, icon: Icon, color, className = '' }) => {
  const strVal = String(value ?? '');
  const prefix = strVal.startsWith('₹') ? '₹' : '';
  const suffix = strVal.endsWith('%') ? '%' : '';
  const rawNum = parseFloat(strVal.replace(/[₹%,]/g, ''));
  const isNumeric = !Number.isNaN(rawNum);
  const animated = useCountUp(isNumeric ? rawNum : 0);
  const displayVal = isNumeric ? `${prefix}${animated.toLocaleString()}${suffix}` : strVal;

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${className}`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-opacity-100`}>
          <Icon size={20} className={color.replace('bg-', 'text-')} />
        </div>
        {change ? (
          <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${trend === 'up' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {change}
          </div>
        ) : null}
      </div>
      <div>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
        <h3 className="text-2xl font-black text-slate-900">{displayVal}</h3>
      </div>
    </div>
  );
};

const normalizeInsightsPayload = (payload) => ({
  revenue: {
    graphData: Array.isArray(payload?.revenue?.graphData) ? payload.revenue.graphData : [],
    arpu: Number(payload?.revenue?.arpu || 0),
    lostRevenue: Number(payload?.revenue?.lostRevenue || 0),
    topPlans: Array.isArray(payload?.revenue?.topPlans) ? payload.revenue.topPlans : [],
  },
  health: {
    active: Number(payload?.health?.active || 0),
    retention: Number(payload?.health?.retention || 0),
    churn: Number(payload?.health?.churn || 0),
    expired: Number(payload?.health?.expired || 0),
  },
  risk: {
    expiringCount: Number(payload?.risk?.expiringCount || 0),
    revenueAtRisk: Number(payload?.risk?.revenueAtRisk || 0),
    expiringList: Array.isArray(payload?.risk?.expiringList) ? payload.risk.expiringList : [],
    inactiveCount: Number(payload?.risk?.inactiveCount || 0),
    inactiveList: Array.isArray(payload?.risk?.inactiveList) ? payload.risk.inactiveList : [],
  },
  attendance: {
    heatmap: Array.isArray(payload?.attendance?.heatmap) ? payload.attendance.heatmap : [],
    topMembers: Array.isArray(payload?.attendance?.topMembers)
      ? payload.attendance.topMembers.map((member) => ({
          ...member,
          profile_pic: normalizeProfileImageUrl(member?.profile_pic),
          total_paid: Number(member?.total_paid || 0),
        }))
      : [],
  },
});

const InsightsPage = ({ token, toast, currentUser, isActive = true }) => {
  const gymName = currentUser?.gym_name || 'GymVault';
  const [activeTab, setActiveTab] = useState('revenue');
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('6M');
  const [insightsPeakDays, setInsightsPeakDays] = useState('today');
  const [insightsPeakHours, setInsightsPeakHours] = useState([]);
  const cacheRef = useRef(new Map());

  const sendWhatsApp = (member, type) => {
    let message = '';

    if (type === 'expiring') {
      message = `Hi ${member.full_name}, your membership at ${gymName} is expiring in ${member.days_left} days. Renew now to keep your fitness journey going.`;
    } else if (type === 'expired') {
      message = `Hi ${member.full_name}, your membership at ${gymName} has expired. We would love to have you back. Renew your plan today.`;
    } else {
      message = `Hi ${member.full_name}, we missed you at ${gymName}. It's been a while since your last visit. Hope to see you back in the gym soon.`;
    }

    openWhatsAppConversation({ phone: member.phone, message });
  };

  const handleCall = (phoneNumber) => window.open(`tel:${phoneNumber}`, '_self');
  const handleDownloadReport = () => window.print();

  const fetchInsights = useCallback(async (range, allowCache = true) => {
    if (!token) return;

    if (allowCache && cacheRef.current.has(range)) {
      setAnalytics(cacheRef.current.get(range));
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await axios.get(`/api/insights/overview?range=${encodeURIComponent(range)}`, {
        headers: { 'x-auth-token': token },
      });
      const normalized = normalizeInsightsPayload(res.data || {});
      cacheRef.current.set(range, normalized);
      setAnalytics(normalized);
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to load insights.', 'error');
      setAnalytics(EMPTY_ANALYTICS);
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    if (!token || !isActive) return;
    fetchInsights(dateRange, true);
  }, [token, dateRange, isActive, fetchInsights]);

  useEffect(() => {
    if (!token) return;
    const url = insightsPeakDays === 'today'
      ? '/api/attendance/peak-hours?today=true'
      : `/api/attendance/peak-hours?days=${insightsPeakDays}`;
    axios.get(url, { headers: { 'x-auth-token': token } })
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setInsightsPeakHours(rows.map((item) => ({
          time: `${String(item.hour).padStart(2, '0')}:00`,
          count: Number(item.count || 0),
        })));
      })
      .catch(() => {});
  }, [token, insightsPeakDays, isActive]);

  const hasRevenueGraph = analytics.revenue.graphData.some((item) => Number(item.revenue || 0) > 0);
  const hasPeakHourData = insightsPeakHours.some((item) => Number(item.count || 0) > 0);

  if (loading) return <PageLoader className="min-h-[56vh]" />;

  return (
    <div className="min-h-full p-0 space-y-8 font-inter text-slate-900">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Gym Insights</h1>
          <p className="text-slate-500 font-medium mt-1">Simple numbers from real payments, memberships, and attendance.</p>
        </div>
        <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          {['1M', '3M', '6M', '1Y'].map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dateRange === range ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
            >
              {range}
            </button>
          ))}
          <div className="w-[1px] h-6 bg-slate-200 mx-1" />
          <button
            onClick={handleDownloadReport}
            className="px-3 py-2 text-slate-400 hover:text-slate-900 transition-colors"
            title="Download PDF Report"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Average Per Member" value={`₹${analytics.revenue.arpu.toLocaleString()}`} icon={Target} color="bg-emerald-500" className="gv-fade-up" />
        <KPICard title="Renewals Due Soon" value={analytics.risk.expiringCount} change={analytics.risk.expiringCount > 0 ? 'urgent' : null} trend="down" icon={Clock} color="bg-amber-500" className="gv-fade-up gv-fade-up-1" />
        <KPICard title="Members Staying" value={`${analytics.health.retention}%`} change={`${analytics.health.expired} expired`} trend={Number(analytics.health.churn || 0) > 0 ? 'down' : 'up'} icon={Activity} color="bg-violet-500" className="gv-fade-up gv-fade-up-2" />
        <KPICard title="Money At Risk" value={`₹${analytics.risk.revenueAtRisk.toLocaleString()}`} change={analytics.risk.inactiveCount > 0 ? `${analytics.risk.inactiveCount} not visiting` : null} trend={analytics.risk.revenueAtRisk > 0 ? 'down' : 'up'} icon={AlertTriangle} color="bg-rose-500" className="gv-fade-up gv-fade-up-3" />
      </div>

      {/* ── Plain Summary ── */}
      <div className="bg-white/80 backdrop-blur-sm rounded-[20px] border border-slate-200/80 p-5 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Quick Summary</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-600 font-medium leading-relaxed">
          <div className="space-y-2">
            <p>
              <span className="font-bold text-slate-900">Money:</span>{' '}
              {analytics.revenue.arpu > 0
                ? `You are earning about ₹${analytics.revenue.arpu.toLocaleString()} per active member, and ₹${analytics.revenue.lostRevenue.toLocaleString()} was lost from expired plans. `
                : 'No payment data is available yet for this period. '}
              {analytics.health.active > 0 && `If current members stay active, that is about ₹${(analytics.health.active * analytics.revenue.arpu).toLocaleString()} for the month.`}
            </p>
            <p>
              <span className="font-bold text-slate-900">Members staying:</span>{' '}
              {Number(analytics.health.retention) >= 80
                ? `${analytics.health.retention}% of members are staying active. `
                : Number(analytics.health.retention) >= 50
                  ? `${analytics.health.retention}% of members are staying active, but this needs attention. `
                  : `Only ${analytics.health.retention}% of members are staying active. Follow-up is needed. `}
              {analytics.health.expired > 0 && `${analytics.health.expired} memberships expired in this window.`}
            </p>
          </div>
          <div className="space-y-2">
            <p>
              <span className="font-bold text-slate-900">Attention needed:</span>{' '}
              {analytics.risk.expiringCount > 0
                ? `${analytics.risk.expiringCount} renewals are due soon and ₹${analytics.risk.revenueAtRisk.toLocaleString()} could be lost. `
                : 'No urgent renewal risk right now. '}
              {analytics.risk.inactiveCount > 0 && `${analytics.risk.inactiveCount} members are not visiting and may stop coming.`}
            </p>
            <p>
              <span className="font-bold text-slate-900">Visits:</span>{' '}
              {hasPeakHourData
                ? `Attendance data now shows the busiest hours. Open the Attendance tab below to see them.`
                : 'Attendance data is still building. Check again after a few more check-ins.'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-8 overflow-x-auto">
        {[
          { id: 'revenue', label: 'Money', icon: TrendingUp },
          { id: 'attendance', label: 'Attendance', icon: Users },
          { id: 'retention', label: 'Member Health', icon: UserCheck },
          { id: 'risk', label: 'Attention Needed', icon: AlertTriangle },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-4 flex items-center gap-2 text-sm font-bold transition-all border-b-2 whitespace-nowrap active:scale-95 ${activeTab === tab.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-200'}`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {activeTab === 'revenue' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-5 border-l-4 border-l-blue-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><Target size={12} /> Average Per Member (30D)</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-slate-900">₹{analytics.revenue.arpu.toLocaleString()}</h3>
                  <span className="text-sm font-bold text-slate-400 mb-1">/ active member</span>
                </div>
              </Card>
              <Card className="p-5 border-l-4 border-l-rose-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><TrendingUp size={12} className="rotate-180" /> Money Lost From Expired Plans</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-rose-600">₹{analytics.revenue.lostRevenue.toLocaleString()}</h3>
                  <span className="text-sm font-bold text-slate-400 mb-1">from expired memberships</span>
                </div>
              </Card>
              <Card className="p-5 border-l-4 border-l-emerald-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><ShieldCheck size={12} /> Expected Next Month</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-emerald-600">₹{(analytics.health.active * analytics.revenue.arpu).toLocaleString()}</h3>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded mb-1 border border-emerald-100">Based on active members</span>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="font-bold text-lg text-slate-900">Payment Trend</h3>
                    <p className="text-xs text-slate-400 font-medium mt-1">Payments collected in the selected period</p>
                  </div>
                </div>
                <div className="h-[250px] w-full">
                  {hasRevenueGraph ? (
                    isActive ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={analytics.revenue.graphData}>
                          <defs>
                            <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(val) => `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`} />
                          <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} formatter={(val) => [`₹${val}`, 'Revenue']} />
                          <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400 font-bold">No payment activity yet for this range.</div>
                  )}
                </div>
              </Card>

              <Card className="p-0 overflow-hidden flex flex-col">
                <div className="p-6 border-b border-slate-50 bg-slate-900 text-white">
                  <h3 className="font-bold text-lg">Top Plans</h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">Plans ranked by real collected payments</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {analytics.revenue.topPlans.length > 0 ? (
                    <div className="space-y-1">
                      {analytics.revenue.topPlans.map((plan, idx) => (
                        <div key={`${plan.name}-${idx}`} className="p-4 hover:bg-slate-50 rounded-xl transition-colors border-b border-slate-50 last:border-0">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-sm text-slate-800">{plan.name}</span>
                            <span className="font-black text-sm text-emerald-600">₹{Number(plan.revenue || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                              <Users size={12} />
                              <span>{Number(plan.users || 0)} Active Members</span>
                            </div>
                            <span className="text-slate-400 font-bold uppercase text-[10px]">Rank #{idx + 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">No plan revenue recorded yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'attendance' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex items-center justify-between gap-3 mb-6">
                <h3 className="font-bold text-lg text-slate-900">
                  Peak Visiting Hours ({insightsPeakDays === 'today' ? 'Today' : insightsPeakDays === 7 ? '7D' : '30D'})
                </h3>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg shrink-0">
                  {[['today', 'Today'], [7, '7D'], [30, '30D']].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setInsightsPeakDays(val)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all ${insightsPeakDays === val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[300px] w-full">
                {hasPeakHourData ? (
                  isActive ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={insightsPeakHours}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                        <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={40} name="Check-ins" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 font-bold">No attendance data yet for this period.</div>
                )}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-bold text-lg text-slate-900 mb-6">Top Paying Members</h3>
              <div className="space-y-4">
                {analytics.attendance.topMembers.length > 0 ? (
                  analytics.attendance.topMembers.map((member, index) => (
                    <div key={member.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors border border-slate-50">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-300 font-black text-sm w-4">{index + 1}</span>
                        <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center text-slate-400 font-bold text-xs shrink-0">
                          {member.profile_pic ? (
                            <img src={member.profile_pic} alt="pic" className="w-full h-full object-cover" />
                          ) : (
                            String(member.full_name || '?').charAt(0)
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-sm text-slate-700 truncate">{member.full_name}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase">₹{member.total_paid.toLocaleString()} Total Paid</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100 shrink-0">
                        <Award size={12} /> MVP
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-400 font-bold py-10">Active paying members will appear here automatically.</div>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl">
                <div className="flex items-center gap-2 text-rose-600 mb-2 font-bold uppercase text-xs tracking-wider">
                  <AlertTriangle size={14} /> Immediate Attention
                </div>
                <h3 className="text-2xl font-black text-rose-900">{analytics.risk.expiringCount} Members</h3>
                <p className="text-rose-700/70 text-sm font-medium mt-1">Expired or ending within 7 days. Money at risk: <b>₹{analytics.risk.revenueAtRisk.toLocaleString()}</b>.</p>
              </div>
              <div className="bg-amber-50 border border-amber-100 p-6 rounded-2xl">
                <div className="flex items-center gap-2 text-amber-600 mb-2 font-bold uppercase text-xs tracking-wider">
                  <UserMinus size={14} /> Active But Not Visiting
                </div>
                <h3 className="text-2xl font-black text-amber-900">{analytics.risk.inactiveCount} Members</h3>
                <p className="text-amber-700/70 text-sm font-medium mt-1">Active members who have not visited in the last 7+ days.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-rose-500" />
                  Renew Soon
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] text-slate-400 uppercase font-black border-b border-slate-100">
                      <tr>
                        <th className="pb-3 pl-2">Name</th>
                        <th className="pb-3 text-center">Status</th>
                        <th className="pb-3 text-right">Quick Contact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {analytics.risk.expiringList.length > 0 ? analytics.risk.expiringList.map((member) => (
                        <tr key={member.id} className="group hover:bg-slate-50 transition-colors">
                          <td className="py-3 pl-2">
                            <span className="font-bold text-slate-700 block">{member.full_name}</span>
                            <span className="text-xs text-slate-400">{member.phone}</span>
                          </td>
                          <td className="py-3 text-center">
                            {Number(member.days_left) <= 0 ? (
                              <span className="text-[10px] font-black bg-rose-100 text-rose-600 px-2 py-1 rounded-full uppercase">Expired</span>
                            ) : (
                              <span className="font-black text-amber-500">{member.days_left} Days Left</span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => handleCall(member.phone)} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"><Phone size={14} /></button>
                              <button onClick={() => sendWhatsApp(member, Number(member.days_left) <= 0 ? 'expired' : 'expiring')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"><MessageSquare size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr><td colSpan="3" className="py-8 text-center text-slate-400 font-bold">No critical renewals found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
                  <Clock size={18} className="text-amber-500" />
                  Inactive Members
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] text-slate-400 uppercase font-black border-b border-slate-100">
                      <tr>
                        <th className="pb-3 pl-2">Name</th>
                        <th className="pb-3 text-center">Last Visit</th>
                        <th className="pb-3 text-right">Quick Contact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {analytics.risk.inactiveList.length > 0 ? analytics.risk.inactiveList.map((member) => (
                        <tr key={member.id} className="group hover:bg-slate-50 transition-colors">
                          <td className="py-3 pl-2">
                            <span className="font-bold text-slate-700 block">{member.full_name}</span>
                            <span className="text-xs text-slate-400">{member.phone}</span>
                          </td>
                          <td className="py-3 text-center font-bold text-amber-500">
                            {member.last_visit ? new Date(member.last_visit).toLocaleDateString('en-GB') : 'Never'}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => handleCall(member.phone)} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"><Phone size={14} /></button>
                              <button onClick={() => sendWhatsApp(member, 'inactive')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"><MessageSquare size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr><td colSpan="3" className="py-8 text-center text-slate-400 font-bold">No inactive members found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'retention' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-5 border-l-4 border-l-violet-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><UserCheck size={12} /> Active Members</p>
                <h3 className="text-2xl font-black text-slate-900">{analytics.health.active}</h3>
              </Card>
              <Card className="p-5 border-l-4 border-l-rose-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><UserMinus size={12} /> Expired Members</p>
                <h3 className="text-2xl font-black text-rose-600">{analytics.health.expired}</h3>
              </Card>
              <Card className="p-5 border-l-4 border-l-amber-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><Clock size={12} /> Active But Not Visiting</p>
                <h3 className="text-2xl font-black text-amber-600">{analytics.risk.inactiveCount}</h3>
              </Card>
            </div>

            <Card className="p-8">
              <h3 className="text-xl font-bold text-slate-900">Member Stay Snapshot</h3>
              <p className="text-slate-500 max-w-2xl mt-2 mb-6 font-medium">This view uses real member status and visit activity only. Nothing here is estimated or seeded.</p>
              <div className="w-full bg-slate-100 rounded-full h-3 mb-3 overflow-hidden shadow-inner">
                <div className="bg-violet-500 h-full rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]" style={{ width: `${analytics.health.retention}%` }} />
              </div>
              <div className="flex justify-between w-full text-xs font-bold text-slate-500 mb-6">
                <span>Leaving: {analytics.health.churn}%</span>
                <span>Staying: {analytics.health.retention}%</span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Renewals Due</p>
                  <p className="text-2xl font-black text-slate-900 mt-1">{analytics.risk.expiringCount}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Money At Risk</p>
                  <p className="text-2xl font-black text-slate-900 mt-1">₹{analytics.risk.revenueAtRisk.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Staying</p>
                  <p className="text-2xl font-black text-emerald-600 mt-1">{analytics.health.retention}%</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Leaving</p>
                  <p className="text-2xl font-black text-rose-600 mt-1">{analytics.health.churn}%</p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default InsightsPage;