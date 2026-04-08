import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  Users, ClipboardCheck, MessageSquare, UserPlus, Target, CreditCard,
  CalendarDays, DollarSign, AlertTriangle, Clock, TrendingUp, UserCheck,
  BarChart3, Dumbbell, ShieldCheck, Bell, ChevronRight, RefreshCw,
  CheckCircle, Activity, Zap, Sparkles, Wallet, ArrowUpRight, ArrowRight,
} from 'lucide-react';
import useCountUp from './utils/useCountUp';
import { reportClientError } from './utils/clientErrorReporter';
import { getApiOrigin } from './utils/apiUrl';

const API = getApiOrigin();

// ─── Animated Counter ────────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '' }) {
  const animated = useCountUp(typeof value === 'number' ? value : 0);
  return <>{prefix}{animated.toLocaleString()}{suffix}</>;
}

function StaffDashboard({ appRuntime, isActive = true }) {
  const { navigateTo, currentUser, canAccessPage, token } = appRuntime;
  const displayRole = String(currentUser?.staff_role || currentUser?.role || 'Staff')
    .toLowerCase()
    .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

  const [stats, setStats] = useState({
    todayCheckins: 0,
    activeMembers: 0,
    expiringThisWeek: 0,
    pendingDues: 0,
    expiringMembers: [],
    totalMembers: 0,
    recentCheckins: [],
  });
  const [loading, setLoading] = useState(true);

  const staffRole = String(currentUser?.staff_role || '').toUpperCase();
  const perms = useMemo(() => Array.isArray(currentUser?.permissions) ? currentUser.permissions : [], [currentUser?.permissions]);
  const hasPerm = useCallback((p) => perms.includes('*') || perms.includes(p) || perms.includes(p.split(':')[0] + ':*'), [perms]);

  const canMembers = canAccessPage?.('Members') ?? true;
  const canAttendance = canAccessPage?.('Attendance') ?? true;
  const canSupport = canAccessPage?.('Help & Support') ?? true;
  const canPayments = canAccessPage?.('Payments') ?? true;
  const canLeads = canAccessPage?.('Leads') ?? true;
  const canClasses = canAccessPage?.('Classes') ?? true;

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const headers = { 'x-auth-token': token };
      const requests = [];
      if (canMembers) {
        requests.push(axios.get(`${API}/api/members/summary`, { headers }).catch(() => ({ data: {} })));
        requests.push(axios.get(`${API}/api/members`, {
          headers,
          params: {
            status: 'EXPIRING SOON',
            paginate: true,
            page: 1,
            limit: 5,
          },
        }).catch(() => ({ data: { items: [] } })));
      } else {
        requests.push(Promise.resolve({ data: {} }));
        requests.push(Promise.resolve({ data: { items: [] } }));
      }
      if (canAttendance) {
        requests.push(axios.get(`${API}/api/attendance/overview`, { headers }).catch(() => ({ data: {} })));
      } else {
        requests.push(Promise.resolve({ data: {} }));
      }
      if (canPayments) {
        requests.push(axios.get(`${API}/api/payments/stats`, { headers }).catch(() => ({ data: {} })));
      } else {
        requests.push(Promise.resolve({ data: {} }));
      }
      const [membersSummaryRes, expiringMembersRes, attendanceRes, payStatsRes] = await Promise.all(requests);
      const membersSummary = membersSummaryRes.data && typeof membersSummaryRes.data === 'object' ? membersSummaryRes.data : {};
      const expiringMembers = Array.isArray(expiringMembersRes.data?.items)
        ? expiringMembersRes.data.items
        : Array.isArray(expiringMembersRes.data)
          ? expiringMembersRes.data
          : [];
      expiringMembers.sort((left, right) => Number(left?.days_left || 9999) - Number(right?.days_left || 9999));
      const attendData = attendanceRes.data?.data || attendanceRes.data || {};
      const todayCheckins = Number(attendData.totalToday || attendData.today_count || attendData.total || 0);
      const recentCheckins = Array.isArray(attendData.recent) ? attendData.recent.slice(0, 5) : [];
      const payStats = payStatsRes.data?.data || payStatsRes.data || {};
      setStats({
        todayCheckins,
        activeMembers: Number(membersSummary.active || 0),
        totalMembers: Number(membersSummary.total || 0),
        expiringThisWeek: Number(membersSummary.expiring_soon || expiringMembers.length || 0),
        pendingDues: Number(payStats.pending_dues || 0),
        expiringMembers: expiringMembers.slice(0, 5),
        recentCheckins,
      });
    } catch (err) {
      reportClientError('Staff stats fetch', err);
    } finally { setLoading(false); }
  }, [token, canMembers, canAttendance, canPayments]);

  useEffect(() => {
    if (!token || !isActive) return undefined;

    fetchStats();

    const refreshStats = () => {
      if (document.visibilityState && document.visibilityState === 'hidden') return;
      fetchStats();
    };
    window.addEventListener('gymvault:data-changed', refreshStats);
    window.addEventListener('gymvault:app-resumed', refreshStats);

    return () => {
      window.removeEventListener('gymvault:data-changed', refreshStats);
      window.removeEventListener('gymvault:app-resumed', refreshStats);
    };
  }, [fetchStats, isActive, token]);

  const isReception = ['RECEPTION', 'MANAGER'].includes(staffRole) || hasPerm('members:write');
  const isTrainer = staffRole === 'TRAINER' || hasPerm('attendance:write');
  const isAccountant = staffRole === 'ACCOUNTANT' || hasPerm('payments:write');

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ── Build quick actions based on role ──
  const quickActions = useMemo(() => {
    const actions = [];
    if (canAttendance) actions.push({ label: 'Check-In', icon: CheckCircle, gradient: 'linear-gradient(135deg, #10b981, #059669)', action: () => navigateTo('Attendance') });
    if ((isReception || hasPerm('members:write')) && canMembers) actions.push({ label: 'Add Member', icon: UserPlus, gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)', action: () => navigateTo('Members', 'All', { action: 'add' }) });
    if (canPayments) actions.push({ label: 'Collect Due', icon: DollarSign, gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', action: () => navigateTo('Payments') });
    if (canPayments) actions.push({ label: 'Payroll', icon: Wallet, gradient: 'linear-gradient(135deg, #ec4899, #db2777)', action: () => navigateTo('Payments', 'All', { section: 'payroll-list' }) });
    if (canLeads) actions.push({ label: 'Leads', icon: Target, gradient: 'linear-gradient(135deg, #f97316, #ea580c)', action: () => navigateTo('Leads') });
    if (canClasses) actions.push({ label: 'Classes', icon: CalendarDays, gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', action: () => navigateTo('Classes') });
    if (canMembers) actions.push({ label: 'Members', icon: Users, gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', action: () => navigateTo('Members') });
    if (canSupport) actions.push({ label: 'Support', icon: MessageSquare, gradient: 'linear-gradient(135deg, #64748b, #475569)', action: () => navigateTo('Help & Support') });
    return actions.slice(0, 8);
  }, [canAttendance, canMembers, canPayments, canLeads, canClasses, canSupport, isReception, hasPerm, navigateTo]);

  // ── Role section config ──
  const roleSection = useMemo(() => {
    if (isReception) return {
      title: 'Front Desk',
      color: '#818cf8',
      items: [
        canMembers && { label: 'New Member', desc: 'Onboard & register', icon: UserPlus, bg: '#10b981', action: () => navigateTo('Members', 'All', { action: 'add' }) },
        canLeads && { label: 'Walk-in Leads', desc: 'Track prospects', icon: Target, bg: '#f97316', action: () => navigateTo('Leads') },
        canPayments && { label: 'Collect Payment', desc: 'Pending dues', icon: CreditCard, bg: '#f59e0b', action: () => navigateTo('Payments') },
        canMembers && { label: 'Renewals', desc: 'Expiring plans', icon: AlertTriangle, bg: '#ef4444', action: () => navigateTo('Members', 'Expiring Soon') },
      ].filter(Boolean),
    };
    if (isTrainer) return {
      title: 'Trainer Tools',
      color: '#38bdf8',
      items: [
        canAttendance && { label: 'Mark Attendance', desc: 'Daily check-ins', icon: ClipboardCheck, bg: '#0ea5e9', action: () => navigateTo('Attendance') },
        canClasses && { label: 'My Classes', desc: 'Schedule & roster', icon: CalendarDays, bg: '#8b5cf6', action: () => navigateTo('Classes') },
        canMembers && { label: 'Members', desc: 'View member list', icon: Users, bg: '#6366f1', action: () => navigateTo('Members', 'Active') },
        canSupport && { label: 'Support', desc: 'Raise issues', icon: MessageSquare, bg: '#7c3aed', action: () => navigateTo('Help & Support') },
      ].filter(Boolean),
    };
    if (isAccountant) return {
      title: 'Finance Desk',
      color: '#fbbf24',
      items: [
        canPayments && { label: 'Collections', desc: 'Payments & overview', icon: CreditCard, bg: '#f59e0b', action: () => navigateTo('Payments') },
        canPayments && { label: 'Payroll', desc: 'Staff salaries', icon: Wallet, bg: '#ec4899', action: () => navigateTo('Payments', 'All', { section: 'payroll-list' }) },
        canMembers && { label: 'Overdue', desc: 'Pending collections', icon: AlertTriangle, bg: '#ef4444', action: () => navigateTo('Members', 'Expiring Soon') },
        canSupport && { label: 'Support', desc: 'Raise issues', icon: MessageSquare, bg: '#64748b', action: () => navigateTo('Help & Support') },
      ].filter(Boolean),
    };
    return {
      title: 'Quick Navigation',
      color: '#94a3b8',
      items: [
        canMembers && { label: 'Members', desc: 'Search & manage', icon: Users, bg: '#6366f1', action: () => navigateTo('Members') },
        canAttendance && { label: 'Attendance', desc: 'Check-ins & records', icon: ClipboardCheck, bg: '#0ea5e9', action: () => navigateTo('Attendance') },
        canPayments && { label: 'Payments', desc: 'Finance hub', icon: CreditCard, bg: '#f59e0b', action: () => navigateTo('Payments') },
        canClasses && { label: 'Classes', desc: 'View schedule', icon: CalendarDays, bg: '#8b5cf6', action: () => navigateTo('Classes') },
      ].filter(Boolean),
    };
  }, [isReception, isTrainer, isAccountant, canMembers, canLeads, canPayments, canAttendance, canClasses, canSupport, navigateTo]);

  const tip = isTrainer
    ? 'Check the Classes page routinely to manage bookings and keep sessions on track.'
    : isAccountant
    ? 'Review pending dues daily and use the Payroll tab to manage staff salaries efficiently.'
    : isReception
    ? 'Use the Quick Check-In button to speed up member arrivals during peak hours.'
    : 'Use the Quick Actions above to navigate to your most-used features efficiently.';

  return (
    <>
      <style>{`
        @keyframes sdFadeUp {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sdSlideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes sdPulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.9; }
        }
        .sd-card { opacity: 0; animation: sdFadeUp 0.55s cubic-bezier(0.16,1,0.3,1) forwards; }
        .sd-card-1 { animation-delay: 80ms; }
        .sd-card-2 { animation-delay: 160ms; }
        .sd-card-3 { animation-delay: 240ms; }
        .sd-card-4 { animation-delay: 320ms; }
        .sd-card-5 { animation-delay: 400ms; }
        .sd-card-6 { animation-delay: 480ms; }
        .sd-card-7 { animation-delay: 560ms; }
      `}</style>

      <div className="min-h-full dashboard-content-safe space-y-4">

        {/* ════════════ HERO WELCOME ════════════ */}
        <div className="sd-card sd-card-1 relative overflow-hidden rounded-[20px] p-5 sm:p-6"
          style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 40%, #312e81 100%)' }}>
          {/* Decorative orbs */}
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)', animation: 'sdPulse 5s ease-in-out infinite' }} />
          <div className="absolute -bottom-12 -left-12 w-36 h-36 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)' }} />

          <div className="relative z-10">
            {/* Role badge + date */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.18em] bg-white/10 text-indigo-300 backdrop-blur-sm border border-white/10">
                  <ShieldCheck size={10} className="inline mr-1 -mt-px" />{displayRole}
                </div>
              </div>
              <p className="text-[11px] font-semibold text-white/30 hidden sm:block">{dateStr}</p>
            </div>

            {/* Greeting */}
            <h2 className="text-[22px] sm:text-2xl font-black text-white leading-tight tracking-tight">{greeting},</h2>
            <p className="text-lg sm:text-xl font-bold text-white/90 mt-0.5">{currentUser?.full_name || 'Team Member'}</p>
            <p className="text-[11px] font-semibold text-white/30 mt-1.5 sm:hidden">{dateStr}</p>

            {/* Stats row inside hero */}
            {!loading && (
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {canAttendance && (
                  <button type="button" onClick={() => navigateTo('Attendance')} className="text-left p-3 rounded-2xl bg-white/[0.07] border border-white/[0.08] hover:bg-white/[0.12] transition-colors backdrop-blur-sm">
                    <p className="text-2xl sm:text-3xl font-black text-emerald-400"><AnimatedNumber value={stats.todayCheckins} /></p>
                    <p className="text-[9px] font-black text-white/35 uppercase tracking-[0.18em] mt-1">Check-ins</p>
                  </button>
                )}
                {canMembers && (
                  <button type="button" onClick={() => navigateTo('Members', 'Active')} className="text-left p-3 rounded-2xl bg-white/[0.07] border border-white/[0.08] hover:bg-white/[0.12] transition-colors backdrop-blur-sm">
                    <p className="text-2xl sm:text-3xl font-black text-blue-400"><AnimatedNumber value={stats.activeMembers} /></p>
                    <p className="text-[9px] font-black text-white/35 uppercase tracking-[0.18em] mt-1">Active</p>
                  </button>
                )}
                {canMembers && (
                  <button type="button" onClick={() => navigateTo('Members', 'Expiring Soon')} className="text-left p-3 rounded-2xl bg-white/[0.07] border border-white/[0.08] hover:bg-white/[0.12] transition-colors backdrop-blur-sm">
                    <p className="text-2xl sm:text-3xl font-black text-orange-400"><AnimatedNumber value={stats.expiringThisWeek} /></p>
                    <p className="text-[9px] font-black text-white/35 uppercase tracking-[0.18em] mt-1">Expiring</p>
                  </button>
                )}
                {canPayments ? (
                  <button type="button" onClick={() => navigateTo('Payments')} className="text-left p-3 rounded-2xl bg-white/[0.07] border border-white/[0.08] hover:bg-white/[0.12] transition-colors backdrop-blur-sm">
                    <p className="text-2xl sm:text-3xl font-black text-amber-300"><AnimatedNumber value={stats.pendingDues} prefix="₹" /></p>
                    <p className="text-[9px] font-black text-white/35 uppercase tracking-[0.18em] mt-1">Dues</p>
                  </button>
                ) : canMembers ? (
                  <button type="button" onClick={() => navigateTo('Members')} className="text-left p-3 rounded-2xl bg-white/[0.07] border border-white/[0.08] hover:bg-white/[0.12] transition-colors backdrop-blur-sm">
                    <p className="text-2xl sm:text-3xl font-black text-violet-300"><AnimatedNumber value={stats.totalMembers} /></p>
                    <p className="text-[9px] font-black text-white/35 uppercase tracking-[0.18em] mt-1">Total</p>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* ════════════ QUICK ACTIONS ════════════ */}
        <div className="sd-card sd-card-2">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2.5 px-1">Quick Actions</p>
          <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
            {quickActions.map((qa) => (
              <button key={qa.label} type="button" onClick={qa.action}
                className="flex flex-col items-center gap-1.5 sm:gap-2 p-2.5 sm:p-3 rounded-2xl bg-white border border-slate-100 hover:border-indigo-200 hover:shadow-lg transition-all active:scale-95 group">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow" style={{ background: qa.gradient }}>
                  <qa.icon size={17} className="text-white" />
                </div>
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-600 leading-tight text-center">{qa.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ════════════ KPI CARDS ════════════ */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {canAttendance && (
            <button type="button" onClick={() => navigateTo('Attendance')}
              className="sd-card sd-card-3 relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 text-left hover:shadow-lg hover:border-emerald-200 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm"><CheckCircle size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-emerald-300 group-hover:text-emerald-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.todayCheckins} /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Today's Check-ins</p>
            </button>
          )}
          {canMembers && (
            <button type="button" onClick={() => navigateTo('Members', 'Active')}
              className="sd-card sd-card-3 relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 text-left hover:shadow-lg hover:border-blue-200 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center shadow-sm"><Users size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-blue-300 group-hover:text-blue-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.activeMembers} /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Active Members</p>
            </button>
          )}
          {canMembers && (
            <button type="button" onClick={() => navigateTo('Members', 'Expiring Soon')}
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4 text-left hover:shadow-lg hover:border-amber-200 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm"><AlertTriangle size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-amber-300 group-hover:text-amber-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.expiringThisWeek} /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Expiring This Week</p>
            </button>
          )}
          {canPayments ? (
            <button type="button" onClick={() => navigateTo('Payments')}
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-4 text-left hover:shadow-lg hover:border-rose-200 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shadow-sm"><CreditCard size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-rose-300 group-hover:text-rose-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.pendingDues} prefix="₹" /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Pending Dues</p>
            </button>
          ) : canMembers ? (
            <button type="button" onClick={() => navigateTo('Members')}
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4 text-left hover:shadow-lg hover:border-violet-200 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-sm"><UserCheck size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-violet-300 group-hover:text-violet-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.totalMembers} /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Total Members</p>
            </button>
          ) : null}
        </div>

        {/* ════════════ EXPIRING MEMBERS ALERT ════════════ */}
        {canMembers && stats.expiringMembers.length > 0 && (
          <div className="sd-card sd-card-5 rounded-[20px] border p-4 sm:p-5"
            style={{
              background: 'linear-gradient(145deg, #1c1917 0%, #292524 50%, #44403c 100%)',
              borderColor: 'rgba(251, 146, 60, 0.2)',
              boxShadow: '0 20px 50px -20px rgba(251,146,60,0.15)',
            }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
                  <Clock size={15} className="text-white" />
                </div>
                <div>
                  <p className="text-xs font-black text-amber-200 tracking-wide">Expiring Soon</p>
                  <p className="text-[9px] text-amber-200/40 font-semibold">{stats.expiringMembers.length} member{stats.expiringMembers.length > 1 ? 's' : ''} this week</p>
                </div>
              </div>
              <button type="button" onClick={() => navigateTo('Members', 'Expiring Soon')}
                className="flex items-center gap-1 text-[10px] font-bold text-amber-300/80 hover:text-amber-200 transition-colors">
                View All <ArrowRight size={12} />
              </button>
            </div>
            <div className="space-y-2">
              {stats.expiringMembers.map((member, i) => (
                <div key={member.id} className="flex items-center justify-between rounded-xl border px-3 py-2.5"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    borderColor: 'rgba(255,255,255,0.06)',
                    opacity: 0,
                    animation: `sdSlideIn 0.35s ease-out ${100 + i * 60}ms forwards`,
                  }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white/90 truncate">{member.full_name}</p>
                    <p className="text-[10px] text-white/30 font-medium truncate">{member.plan_name || 'No plan'}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black"
                    style={{
                      background: member.days_left <= 2 ? 'rgba(239,68,68,0.15)' : 'rgba(251,146,60,0.12)',
                      color: member.days_left <= 2 ? '#fca5a5' : '#fdba74',
                      border: `1px solid ${member.days_left <= 2 ? 'rgba(239,68,68,0.2)' : 'rgba(251,146,60,0.15)'}`,
                    }}>
                    {member.days_left}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════ ROLE SECTION ════════════ */}
        {roleSection.items.length > 0 && (
          <div className="sd-card sd-card-6">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-2.5 px-1" style={{ color: roleSection.color }}>{roleSection.title}</p>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {roleSection.items.map((item) => (
                <button key={item.label} type="button" onClick={item.action}
                  className="p-4 rounded-2xl bg-white border border-slate-100 text-left transition-all hover:border-indigo-200 hover:shadow-md active:scale-[0.97] group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 shadow-sm group-hover:shadow-md transition-shadow" style={{ background: item.bg }}>
                    <item.icon size={18} className="text-white" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">{item.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ════════════ FOOTER TIP ════════════ */}
        <div className="sd-card sd-card-7 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-violet-50/40 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Sparkles size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-indigo-500">Pro Tip</p>
              <p className="text-[13px] font-medium text-slate-600 mt-1 leading-relaxed">{tip}</p>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

export default StaffDashboard;
