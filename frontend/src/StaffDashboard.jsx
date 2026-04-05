import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  Users, ClipboardCheck, MessageSquare, UserPlus, Target, CreditCard,
  CalendarDays, DollarSign, AlertTriangle, Clock, TrendingUp, UserCheck,
  BarChart3, Dumbbell, ShieldCheck, Bell, ChevronRight, RefreshCw,
  CheckCircle, Activity, Zap, Sparkles
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// ─── Count-Up Hook ──────────────────────────────────────────────────────────
function useCountUp(target, duration = 800) {
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
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return display;
}

// ─── Animated KPI Card ──────────────────────────────────────────────────────
function StaffKPI({ label, value, icon: Icon, gradient, index = 0, onClick, prefix = '', suffix = '' }) {
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);
  const displayValue = typeof value === 'number' ? `${prefix}${animatedValue.toLocaleString()}${suffix}` : value;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative overflow-hidden rounded-2xl border border-white/60 bg-white p-4 text-left transition-all hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
      style={{ opacity: 0, animation: `staffCardIn 0.5s ease-out ${100 + index * 80}ms forwards` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="text-2xl font-black text-slate-900 mt-1.5 truncate">{displayValue}</p>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: gradient }}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      {onClick && <ChevronRight size={14} className="absolute top-4 right-4 text-slate-300" />}
    </button>
  );
}

function StaffDashboard({ navigateTo, currentUser, canAccessPage, token }) {
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
  });
  const [loading, setLoading] = useState(true);

  const staffRole = String(currentUser?.staff_role || '').toUpperCase();
  const perms = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
  const hasPerm = (p) => perms.includes('*') || perms.includes(p) || perms.includes(p.split(':')[0]+':*');

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
        requests.push(axios.get(`${API}/api/members`, { headers }).catch(() => ({ data: [] })));
      } else {
        requests.push(Promise.resolve({ data: [] }));
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
      const [membersRes, attendanceRes, payStatsRes] = await Promise.all(requests);
      const membersArr = Array.isArray(membersRes.data) ? membersRes.data
        : Array.isArray(membersRes.data?.data) ? membersRes.data.data
        : Array.isArray(membersRes.data?.members) ? membersRes.data.members : [];
      const activeMembers = membersArr.filter(m => m.membership_status === 'ACTIVE');
      const expiringMembers = activeMembers
        .filter(m => m.days_left > 0 && m.days_left <= 7)
        .sort((a, b) => a.days_left - b.days_left);
      const attendData = attendanceRes.data?.data || attendanceRes.data || {};
      const todayCheckins = Number(attendData.totalToday || attendData.today_count || attendData.total || 0);
      const payStats = payStatsRes.data?.data || payStatsRes.data || {};
      setStats({
        todayCheckins,
        activeMembers: activeMembers.length,
        totalMembers: membersArr.length,
        expiringThisWeek: expiringMembers.length,
        pendingDues: Number(payStats.pending_dues || 0),
        expiringMembers: expiringMembers.slice(0, 5),
      });
    } catch (err) {
      console.error('Staff stats fetch error:', err);
    } finally { setLoading(false); }
  }, [token, canMembers, canAttendance, canPayments]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Role-specific quick actions
  const isReception = ['RECEPTION', 'MANAGER'].includes(staffRole) || hasPerm('members:write');
  const isTrainer = staffRole === 'TRAINER' || hasPerm('attendance:write');
  const isAccountant = staffRole === 'ACCOUNTANT' || hasPerm('payments:write');

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good Morning' : now.getHours() < 17 ? 'Good Afternoon' : 'Good Evening';

  const quickActions = [
    canAttendance && { label: 'Check In', icon: CheckCircle, gradient: 'linear-gradient(135deg, #10b981, #06d6a0)', action: () => navigateTo('Attendance') },
    (isReception || hasPerm('members:write')) && canMembers && { label: 'Add Member', icon: UserPlus, gradient: 'linear-gradient(135deg, #6366f1, #a855f7)', action: () => navigateTo('Members', 'All', { action: 'add' }) },
    canPayments && { label: 'Collect Due', icon: DollarSign, gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)', action: () => navigateTo('Payments') },
    canMembers && { label: 'Members', icon: Users, gradient: 'linear-gradient(135deg, #3b82f6, #6366f1)', action: () => navigateTo('Members') },
    canLeads && { label: 'Leads', icon: Target, gradient: 'linear-gradient(135deg, #f97316, #fb923c)', action: () => navigateTo('Leads') },
    canClasses && { label: 'Classes', icon: CalendarDays, gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', action: () => navigateTo('Classes') },
    canSupport && { label: 'Support', icon: MessageSquare, gradient: 'linear-gradient(135deg, #64748b, #475569)', action: () => navigateTo('Help & Support') },
  ].filter(Boolean).slice(0, 4);

  const topKpis = [
    canAttendance && {
      label: "Today's Check-ins",
      value: stats.todayCheckins,
      icon: CheckCircle,
      gradient: 'linear-gradient(135deg, #10b981, #06d6a0)',
      index: 0,
      onClick: () => navigateTo('Attendance'),
    },
    canMembers && {
      label: 'Active Members',
      value: stats.activeMembers,
      icon: Users,
      gradient: 'linear-gradient(135deg, #3b82f6, #6366f1)',
      index: 1,
      onClick: () => navigateTo('Members', 'Active'),
    },
    canMembers && {
      label: 'Expiring This Week',
      value: stats.expiringThisWeek,
      icon: AlertTriangle,
      gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
      index: 2,
      onClick: () => navigateTo('Members', 'Expiring Soon'),
    },
    (canPayments
      ? {
          label: 'Pending Dues',
          value: stats.pendingDues,
          icon: CreditCard,
          gradient: 'linear-gradient(135deg, #f97316, #fb923c)',
          index: 3,
          onClick: () => navigateTo('Payments', 'Pending'),
          prefix: '₹',
        }
      : canMembers
      ? {
          label: 'Total Members',
          value: stats.totalMembers,
          icon: UserCheck,
          gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
          index: 3,
          onClick: () => navigateTo('Members'),
        }
      : null),
  ].filter(Boolean);

  const cardClass = (enabled) =>
    `p-4 rounded-2xl bg-white border text-left transition-all ${
      enabled
        ? 'border-slate-200 hover:border-indigo-300 hover:shadow-sm cursor-pointer'
        : 'border-slate-100 opacity-55 cursor-not-allowed'
    }`;

  return (
    <>
      <style>{`
        @keyframes staffCardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes staffSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes staffHeroPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>

      <div className="min-h-full dashboard-content-safe space-y-5">
        {/* ── Hero Welcome Card ─────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-[24px] p-6 text-white"
          style={{
            background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            opacity: 0,
            animation: 'staffCardIn 0.6s ease-out 50ms forwards',
          }}
        >
          <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)', animation: 'staffHeroPulse 4s ease-in-out infinite' }} />
          <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)' }} />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <div className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest"
                style={{ background: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}>
                <ShieldCheck size={10} className="inline mr-1" />{displayRole}
              </div>
            </div>
            <h2 className="text-2xl font-black leading-tight">{greeting} 👋</h2>
            <p className="text-lg font-bold text-white/90 mt-0.5">{currentUser?.full_name || 'Team Member'}</p>
            <p className="text-sm text-white/40 font-medium mt-1">
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>

            {!loading && (
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
                {canAttendance && (
                  <div>
                    <p className="text-3xl font-black text-emerald-400">{stats.todayCheckins}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Check-ins Today</p>
                  </div>
                )}
                {canMembers && (
                  <div>
                    <p className="text-3xl font-black text-blue-400">{stats.activeMembers}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Active Members</p>
                  </div>
                )}
                {canMembers && (
                  <div>
                    <p className="text-3xl font-black text-orange-400">{stats.expiringThisWeek}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Expiring Soon</p>
                  </div>
                )}
                {canPayments ? (
                  <div>
                    <p className="text-3xl font-black text-amber-300">₹{stats.pendingDues}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Pending Dues</p>
                  </div>
                ) : canMembers ? (
                  <div>
                    <p className="text-3xl font-black text-violet-300">{stats.totalMembers}</p>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Total Members</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* ── KPI Cards ────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {topKpis.map((kpi) => (
            <StaffKPI
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              icon={kpi.icon}
              gradient={kpi.gradient}
              index={kpi.index}
              onClick={kpi.onClick}
              prefix={kpi.prefix || ''}
            />
          ))}
        </div>

        {/* ── Quick Actions Strip ──────────────────────────── */}
        <div style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 300ms forwards' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2.5 px-1">Quick Actions</p>
          <div className="grid grid-cols-4 gap-2">
            {quickActions.map((qa) => (
              <button key={qa.label} onClick={qa.action}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all active:scale-95">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: qa.gradient }}>
                  <qa.icon size={18} className="text-white" />
                </div>
                <span className="text-[10px] font-bold text-slate-600 leading-tight text-center">{qa.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Expiring Members Alert ───────────────────────── */}
        {canMembers && stats.expiringMembers.length > 0 && (
          <div className="rounded-2xl border p-4 shadow-[0_18px_50px_-32px_rgba(251,146,60,0.5)]"
            style={{
              background: 'linear-gradient(135deg, #181425 0%, #241917 45%, #3a2416 100%)',
              borderColor: 'rgba(251, 146, 60, 0.22)',
              opacity: 0,
              animation: 'staffCardIn 0.5s ease-out 400ms forwards',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
                  <Clock size={14} className="text-white" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-200">Expiring Soon</span>
              </div>
              <button onClick={() => navigateTo('Members', 'Expiring Soon')}
                className="text-[10px] font-bold text-amber-300 hover:text-amber-100 transition-colors">View All →</button>
            </div>
            <div className="space-y-2">
              {stats.expiringMembers.map((member, i) => (
                <div key={member.id} className="flex items-center justify-between rounded-xl border px-3 py-2.5"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    opacity: 0,
                    animation: `staffSlideUp 0.35s ease-out ${450 + i * 60}ms forwards`,
                  }}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{member.full_name}</p>
                    <p className="text-[10px] text-amber-100/60 font-medium">{member.plan_name || 'No plan'}</p>
                  </div>
                  <span className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black text-amber-200"
                    style={{ background: 'rgba(251,146,60,0.14)', borderColor: 'rgba(251,146,60,0.16)' }}>
                    {member.days_left}d left
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Role-Specific Feature Sections ───────────────── */}
        {isReception && (
          <div style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 500ms forwards' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-2.5 px-1">Front Desk</p>
            <div className="grid grid-cols-2 gap-3">
              <button disabled={!canMembers} onClick={() => navigateTo('Members', 'All', { action: 'add' })} className={cardClass(canMembers)}>
                <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center mb-3"><UserPlus size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">New Member</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Onboard & register</p>
              </button>
              <button disabled={!canLeads} onClick={() => navigateTo('Leads')} className={cardClass(canLeads)}>
                <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center mb-3"><Target size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Leads</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Walk-ins & follow-ups</p>
              </button>
              <button disabled={!canPayments} onClick={() => navigateTo('Payments')} className={cardClass(canPayments)}>
                <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mb-3"><DollarSign size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Collect Due</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Pending payments</p>
              </button>
              <button disabled={!canMembers} onClick={() => navigateTo('Members', 'Expiring Soon')} className={cardClass(canMembers)}>
                <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center mb-3"><AlertTriangle size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Renewals</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Expiring memberships</p>
              </button>
            </div>
          </div>
        )}

        {isTrainer && (
          <div style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 500ms forwards' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-400 mb-2.5 px-1">Trainer Tools</p>
            <div className="grid grid-cols-2 gap-3">
              <button disabled={!canAttendance} onClick={() => navigateTo('Attendance')} className={cardClass(canAttendance)}>
                <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center mb-3"><ClipboardCheck size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Check-In</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Mark attendance</p>
              </button>
              <button disabled={!canClasses} onClick={() => navigateTo('Classes')} className={cardClass(canClasses)}>
                <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center mb-3"><CalendarDays size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">My Classes</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Schedule & bookings</p>
              </button>
              <button disabled={!canMembers} onClick={() => navigateTo('Members', 'Active')} className={cardClass(canMembers)}>
                <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center mb-3"><Users size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Members</p>
                <p className="text-[10px] text-slate-400 mt-0.5">View member list</p>
              </button>
              <button disabled={!canSupport} onClick={() => navigateTo('Help & Support')} className={cardClass(canSupport)}>
                <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center mb-3"><MessageSquare size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Support</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Raise issues</p>
              </button>
            </div>
          </div>
        )}

        {isAccountant && (
          <div style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 500ms forwards' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400 mb-2.5 px-1">Finance Desk</p>
            <div className="grid grid-cols-2 gap-3">
              <button disabled={!canPayments} onClick={() => navigateTo('Payments')} className={cardClass(canPayments)}>
                <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mb-3"><CreditCard size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Collections</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Payments & overdue</p>
              </button>
              <button disabled={!canMembers} onClick={() => navigateTo('Members', 'Expiring Soon')} className={cardClass(canMembers)}>
                <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center mb-3"><AlertTriangle size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Overdue</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Pending collections</p>
              </button>
            </div>
          </div>
        )}

        {!isReception && !isTrainer && !isAccountant && (
          <div style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 500ms forwards' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2.5 px-1">Quick Actions</p>
            <div className="grid grid-cols-2 gap-3">
              <button disabled={!canMembers} onClick={() => navigateTo('Members', 'All')} className={cardClass(canMembers)}>
                <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center mb-3"><Users size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Members</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Search & manage</p>
              </button>
              <button disabled={!canAttendance} onClick={() => navigateTo('Attendance')} className={cardClass(canAttendance)}>
                <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center mb-3"><ClipboardCheck size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Attendance</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Check-ins & records</p>
              </button>
              <button disabled={!canSupport} onClick={() => navigateTo('Help & Support')} className={cardClass(canSupport)}>
                <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center mb-3"><MessageSquare size={18} className="text-white" /></div>
                <p className="text-sm font-bold text-slate-900">Support</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Raise issues</p>
              </button>
              {canClasses && (
                <button onClick={() => navigateTo('Classes')} className={cardClass(true)}>
                  <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center mb-3"><CalendarDays size={18} className="text-white" /></div>
                  <p className="text-sm font-bold text-slate-900">Classes</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">View schedule</p>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Footer Tips ──────────────────────────────────── */}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4"
          style={{ opacity: 0, animation: 'staffCardIn 0.5s ease-out 600ms forwards' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Staff Tip</p>
              <p className="text-sm font-medium text-slate-600 mt-1 leading-relaxed">
                {isTrainer
                  ? 'Check the Classes page routinely to manage bookings and keep sessions on track.'
                  : isAccountant
                  ? 'Review pending dues daily and follow up with members to keep collections on track.'
                  : isReception
                  ? 'Use the Quick Check-In button to speed up member arrivals during peak hours.'
                  : 'Use the Quick Actions above to navigate to your most-used features efficiently.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default StaffDashboard;
