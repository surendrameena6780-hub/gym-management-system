import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  Users, ClipboardCheck, MessageSquare, UserPlus, Target, CreditCard,
  CalendarDays, DollarSign, AlertTriangle, Clock, TrendingUp, UserCheck,
  BarChart3, Dumbbell, ShieldCheck, Bell, ChevronRight, RefreshCw,
  CheckCircle, Activity, Zap, Sparkles, Wallet, ArrowUpRight, ArrowRight, Send,
  Camera, FileText, XCircle,
} from 'lucide-react';
import useCountUp from './utils/useCountUp';
import { reportClientError } from './utils/clientErrorReporter';
import { getApiOrigin } from './utils/apiUrl';
import { INLINE_IMAGE_ACCEPT, filesToInlineImageDataUrls } from './utils/inlineImageUpload';

const API = getApiOrigin();
const STAFF_TASK_MAX_PHOTOS = 4;

const formatTaskDateTime = (value) => {
  if (!value) return 'No deadline';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No deadline';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatTaskLabel = (value, fallback = 'Task') => {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getTaskStatusTone = (task = {}) => {
  const rawStatus = String(task.status || 'OPEN').trim().toUpperCase();
  if (rawStatus === 'COMPLETED') return 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100';
  if (rawStatus === 'CANCELLED') return 'border-white/10 bg-white/5 text-white/60';
  if (task.is_overdue) return 'border-rose-300/20 bg-rose-500/10 text-rose-100';
  if (rawStatus === 'IN_PROGRESS') return 'border-amber-300/20 bg-amber-500/10 text-amber-100';
  return 'border-indigo-300/20 bg-indigo-500/10 text-indigo-100';
};

const getTaskPriorityTone = (priority) => {
  switch (String(priority || '').trim().toUpperCase()) {
    case 'URGENT':
      return 'border-rose-300/20 bg-rose-500/10 text-rose-100';
    case 'HIGH':
      return 'border-amber-300/20 bg-amber-500/10 text-amber-100';
    case 'LOW':
      return 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100';
    default:
      return 'border-white/10 bg-white/5 text-white/70';
  }
};

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
  const [reminderLoadingId, setReminderLoadingId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState('');
  const [activeTask, setActiveTask] = useState(null);
  const [taskCompletionNotes, setTaskCompletionNotes] = useState('');
  const [taskCompletionPhotos, setTaskCompletionPhotos] = useState([]);
  const [taskCompletionError, setTaskCompletionError] = useState('');

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

  const fetchTasks = useCallback(async () => {
    if (!token) return;
    try {
      setTasksLoading(true);
      const res = await axios.get(`${API}/api/users/tasks`, {
        headers: { 'x-auth-token': token },
        params: { include_completed: '1', limit: 12 },
      });
      setTasks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      reportClientError('Staff tasks fetch', err);
    } finally {
      setTasksLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !isActive) return undefined;

    Promise.all([fetchStats(), fetchTasks()]);

    const refreshStats = () => {
      if (document.visibilityState && document.visibilityState === 'hidden') return;
      Promise.all([fetchStats(), fetchTasks()]);
    };
    window.addEventListener('gymvault:data-changed', refreshStats);
    window.addEventListener('gymvault:app-resumed', refreshStats);

    return () => {
      window.removeEventListener('gymvault:data-changed', refreshStats);
      window.removeEventListener('gymvault:app-resumed', refreshStats);
    };
  }, [fetchStats, fetchTasks, isActive, token]);

  const sendExpiryReminder = useCallback(async (memberId) => {
    if (!token || reminderLoadingId) return;
    setReminderLoadingId(memberId);
    try {
      await axios.post(`${API}/api/notifications/reminders/send`, {
        member_ids: [memberId],
        template_key: 'EXPIRY_REMINDER',
      }, { headers: { 'x-auth-token': token } });
    } catch (_err) {
      // silent — toast not available in StaffDashboard
    } finally {
      setReminderLoadingId(null);
    }
  }, [token, reminderLoadingId]);

  const closeTaskModal = useCallback(() => {
    setActiveTask(null);
    setTaskCompletionNotes('');
    setTaskCompletionPhotos([]);
    setTaskCompletionError('');
  }, []);

  const openTaskModal = useCallback((task) => {
    setActiveTask(task || null);
    setTaskCompletionNotes(task?.completion_notes || '');
    setTaskCompletionPhotos([]);
    setTaskCompletionError('');
  }, []);

  const updateTaskStatus = useCallback(async (task, status) => {
    if (!task?.id || !token) return;
    setTaskBusyId(`status-${task.id}`);
    try {
      await axios.patch(`${API}/api/users/tasks/${task.id}/status`, { status }, { headers: { 'x-auth-token': token } });
      await fetchTasks();
    } catch (err) {
      reportClientError('Staff task status update', err);
    } finally {
      setTaskBusyId('');
    }
  }, [fetchTasks, token]);

  const handleTaskPhotoSelection = useCallback(async (event) => {
    const nextFiles = Array.from(event.target.files || []);
    if (!nextFiles.length) return;
    if (nextFiles.length > STAFF_TASK_MAX_PHOTOS) {
      setTaskCompletionError(`Upload up to ${STAFF_TASK_MAX_PHOTOS} proof photos.`);
      event.target.value = '';
      return;
    }

    try {
      setTaskCompletionError('');
      const dataUrls = await filesToInlineImageDataUrls(nextFiles.slice(0, STAFF_TASK_MAX_PHOTOS));
      setTaskCompletionPhotos(dataUrls);
    } catch (err) {
      setTaskCompletionError(err?.message || 'Could not read the selected photos.');
    } finally {
      event.target.value = '';
    }
  }, []);

  const removeTaskProofPhoto = useCallback((photoIndex) => {
    setTaskCompletionPhotos((current) => current.filter((_photo, index) => index !== photoIndex));
  }, []);

  const submitTaskCompletion = useCallback(async () => {
    if (!activeTask?.id || !token) return;
    if (taskCompletionPhotos.length === 0) {
      setTaskCompletionError('Add at least one proof photo before submitting.');
      return;
    }

    setTaskBusyId(`complete-${activeTask.id}`);
    try {
      setTaskCompletionError('');
      await axios.post(`${API}/api/users/tasks/${activeTask.id}/complete`, {
        completion_notes: taskCompletionNotes,
        completion_photos: taskCompletionPhotos,
      }, { headers: { 'x-auth-token': token } });
      closeTaskModal();
      await fetchTasks();
    } catch (err) {
      setTaskCompletionError(err?.response?.data?.error || 'Could not submit task completion.');
    } finally {
      setTaskBusyId('');
    }
  }, [activeTask, closeTaskModal, fetchTasks, taskCompletionNotes, taskCompletionPhotos, token]);

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
    return actions.slice(0, 8);
  }, [canAttendance, canMembers, canPayments, canLeads, canClasses, canSupport, isReception, hasPerm, navigateTo]);

  const taskCounts = useMemo(() => {
    return tasks.reduce((counts, task) => {
      counts.total += 1;
      if (task.status === 'COMPLETED') {
        counts.completed += 1;
      } else if (task.is_overdue) {
        counts.overdue += 1;
      } else if (task.status === 'IN_PROGRESS') {
        counts.inProgress += 1;
      } else if (task.status === 'CANCELLED') {
        counts.cancelled += 1;
      } else {
        counts.open += 1;
      }
      return counts;
    }, {
      total: 0,
      open: 0,
      inProgress: 0,
      overdue: 0,
      completed: 0,
      cancelled: 0,
    });
  }, [tasks]);

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
        .sd-card-8 { animation-delay: 640ms; }
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
              className="sd-card sd-card-3 relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-4 text-left hover:shadow-lg hover:border-emerald-300 transition-all active:scale-[0.98] group">
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
              className="sd-card sd-card-3 relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100/50 p-4 text-left hover:shadow-lg hover:border-blue-300 transition-all active:scale-[0.98] group">
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
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/50 p-4 text-left hover:shadow-lg hover:border-amber-300 transition-all active:scale-[0.98] group">
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
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100/50 p-4 text-left hover:shadow-lg hover:border-rose-300 transition-all active:scale-[0.98] group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shadow-sm"><CreditCard size={16} className="text-white" /></div>
                <ArrowUpRight size={14} className="text-rose-300 group-hover:text-rose-500 transition-colors" />
              </div>
              <p className="text-2xl font-black text-slate-900"><AnimatedNumber value={stats.pendingDues} prefix="₹" /></p>
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400 mt-1">Pending Dues</p>
            </button>
          ) : canMembers ? (
            <button type="button" onClick={() => navigateTo('Members')}
              className="sd-card sd-card-4 relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100/50 p-4 text-left hover:shadow-lg hover:border-violet-300 transition-all active:scale-[0.98] group">
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
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); sendExpiryReminder(member.id); }}
                    disabled={reminderLoadingId === member.id}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40"
                    style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.2)' }}
                    title="Send Reminder"
                  >
                    <Send size={13} className={`text-indigo-300 ${reminderLoadingId === member.id ? 'animate-pulse' : ''}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sd-card sd-card-6 rounded-[20px] border p-4 sm:p-5"
          style={{
            background: 'linear-gradient(145deg, #0f172a 0%, #111827 48%, #1e293b 100%)',
            borderColor: 'rgba(148,163,184,0.18)',
            boxShadow: '0 20px 55px -24px rgba(15,23,42,0.45)',
          }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-200">My Tasks</p>
              <p className="text-[11px] font-semibold text-white/45 mt-1">Owner-assigned work with deadlines and proof photo submission.</p>
            </div>
            <button
              type="button"
              onClick={fetchTasks}
              disabled={tasksLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/75 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw size={13} className={tasksLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
            {[
              { label: 'Open', value: taskCounts.open, tone: 'rgba(99,102,241,0.14)', color: '#c7d2fe' },
              { label: 'In Progress', value: taskCounts.inProgress, tone: 'rgba(245,158,11,0.14)', color: '#fde68a' },
              { label: 'Overdue', value: taskCounts.overdue, tone: 'rgba(244,63,94,0.14)', color: '#fecdd3' },
              { label: 'Completed', value: taskCounts.completed, tone: 'rgba(16,185,129,0.14)', color: '#bbf7d0' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border px-3 py-3" style={{ background: item.tone, borderColor: 'rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: item.color }}>{item.label}</p>
                <p className="mt-1 text-2xl font-black text-white">{item.value}</p>
              </div>
            ))}
          </div>

          {tasksLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-sm font-semibold text-white/45">
              Loading your assigned tasks...
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center">
              <p className="text-sm font-black text-white">No tasks assigned yet.</p>
              <p className="mt-1 text-[11px] font-semibold text-white/45">When the owner assigns work from Staff & Roles, it will show up here automatically.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const canStartTask = task.status === 'OPEN';
                const canCompleteTask = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
                return (
                  <div key={task.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1 space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getTaskStatusTone(task)}`}>
                            {task.status_label || formatTaskLabel(task.status, 'Open')}
                          </span>
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${getTaskPriorityTone(task.priority)}`}>
                            {formatTaskLabel(task.priority, 'Medium')}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                            {formatTaskLabel(task.category, 'Task')}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm font-black text-white">{task.title || 'Untitled task'}</p>
                          <p className="mt-1 text-[12px] font-medium leading-6 text-white/70">{task.description || 'No additional instructions added by the owner.'}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px] font-semibold text-white/65">
                          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Deadline</p>
                            <p className="mt-1 text-sm font-black text-white">{formatTaskDateTime(task.due_at)}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Branch</p>
                            <p className="mt-1 text-sm font-black text-white">{task.branch_name || 'Main Branch'}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Assigned By</p>
                            <p className="mt-1 text-sm font-black text-white">{task.created_by_name || 'Gym Owner'}</p>
                          </div>
                        </div>

                        {task.completion_notes ? (
                          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-200">Completion Notes</p>
                            <p className="mt-2 text-sm font-medium leading-6 text-emerald-50">{task.completion_notes}</p>
                          </div>
                        ) : null}

                        {Array.isArray(task.completion_photos) && task.completion_photos.length > 0 ? (
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Proof Photos</p>
                            <div className="mt-3 flex flex-wrap gap-3">
                              {task.completion_photos.map((photo, photoIndex) => (
                                <a key={`${task.id}-completed-${photoIndex}`} href={photo} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                                  <img src={photo} alt={`${task.title || 'Task'} proof ${photoIndex + 1}`} className="h-20 w-20 object-cover" loading="lazy" />
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-row flex-wrap gap-2 xl:w-[11rem] xl:flex-col xl:items-stretch">
                        {canStartTask ? (
                          <button
                            type="button"
                            onClick={() => updateTaskStatus(task, 'IN_PROGRESS')}
                            disabled={taskBusyId === `status-${task.id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-500/10 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-500/15 disabled:opacity-50"
                          >
                            <Clock size={13} /> Start
                          </button>
                        ) : null}

                        {canCompleteTask ? (
                          <button
                            type="button"
                            onClick={() => openTaskModal(task)}
                            disabled={Boolean(taskBusyId) && taskBusyId !== `complete-${task.id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                          >
                            <CheckCircle size={13} /> Complete
                          </button>
                        ) : null}

                        {task.status === 'COMPLETED' && task.completed_at ? (
                          <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-100 text-center">
                            Done {formatTaskDateTime(task.completed_at)}
                          </div>
                        ) : null}

                        {task.status === 'CANCELLED' ? (
                          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/60 text-center">
                            Cancelled by owner
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ════════════ ROLE SECTION ════════════ */}
        {roleSection.items.length > 0 && (
          <div className="sd-card sd-card-7">
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
        <div className="sd-card sd-card-8 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Sparkles size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-indigo-600">Pro Tip</p>
              <p className="text-[13px] font-medium text-slate-700 mt-1 leading-relaxed">{tip}</p>
            </div>
          </div>
        </div>

      </div>

      {activeTask && (
        <div className="app-modal-shell z-[92] bg-slate-950/70 backdrop-blur-sm" onClick={closeTaskModal}>
          <div className="app-modal-panel" style={{ width: 'min(100%, 34rem)' }} onClick={(event) => event.stopPropagation()}>
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0f172a] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-6">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Complete Task</p>
                  <h3 className="mt-2 text-lg font-black text-white">{activeTask.title || 'Assigned task'}</h3>
                  <p className="mt-1 text-sm font-medium text-white/55">Submit proof photos and a short summary for the owner.</p>
                </div>
                <button
                  type="button"
                  onClick={closeTaskModal}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close task completion popup"
                >
                  <XCircle size={18} />
                </button>
              </div>

              <div className="app-modal-scroll px-5 py-5 sm:px-6 sm:py-6">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[12px] font-semibold text-white/70">
                    Deadline: <span className="font-black text-white">{formatTaskDateTime(activeTask.due_at)}</span>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.22em] text-white/45">What did you complete?</span>
                    <textarea
                      rows={4}
                      value={taskCompletionNotes}
                      onChange={(event) => setTaskCompletionNotes(event.target.value)}
                      placeholder="Add a short note for the owner. Mention what was done, what was counted, or anything they should verify."
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white outline-none transition-colors focus:border-emerald-300/30 focus:ring-2 focus:ring-emerald-400/10"
                    />
                  </label>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/45">Proof Photos</p>
                        <p className="text-[11px] font-semibold text-white/45 mt-1">Upload at least one image. Up to {STAFF_TASK_MAX_PHOTOS} photos are allowed.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => document.getElementById('staff-task-proof-input')?.click()}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                      >
                        <Camera size={13} /> Add Photos
                      </button>
                    </div>
                    <input id="staff-task-proof-input" type="file" accept={INLINE_IMAGE_ACCEPT} multiple className="hidden" onChange={handleTaskPhotoSelection} />

                    {taskCompletionPhotos.length > 0 ? (
                      <div className="flex flex-wrap gap-3">
                        {taskCompletionPhotos.map((photo, photoIndex) => (
                          <div key={`proof-upload-${photoIndex}`} className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                            <img src={photo} alt={`Task proof ${photoIndex + 1}`} className="h-24 w-24 object-cover" />
                            <button
                              type="button"
                              onClick={() => removeTaskProofPhoto(photoIndex)}
                              className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/75 text-white transition-colors hover:bg-slate-950"
                              aria-label={`Remove proof photo ${photoIndex + 1}`}
                            >
                              <XCircle size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
                        <FileText size={18} className="mx-auto text-white/35" />
                        <p className="mt-2 text-sm font-semibold text-white/55">No proof photos added yet.</p>
                      </div>
                    )}
                  </div>

                  {taskCompletionError ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
                      {taskCompletionError}
                    </div>
                  ) : null}

                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeTaskModal}
                      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-white/10"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitTaskCompletion}
                      disabled={taskBusyId === `complete-${activeTask.id}`}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
                    >
                      <CheckCircle size={15} /> {taskBusyId === `complete-${activeTask.id}` ? 'Submitting...' : 'Submit Completion'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default StaffDashboard;
