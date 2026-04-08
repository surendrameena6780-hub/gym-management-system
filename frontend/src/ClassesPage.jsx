import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  CalendarDays, Clock3, Users, Plus, X, Search, CheckCircle2,
  MapPin, User, Layers, Pencil, Trash2, Sparkles, ArrowRight,
} from 'lucide-react';
import OperationsBranchScopeBar from './components/OperationsBranchScopeBar';
import { normalizeProfileImageUrl } from './utils/profileImage';
import PageLoader from './PageLoader';
import { getBranchLabel, getBranchRequestValue, getDefaultBranchId, normalizeBranchDirectory } from './utils/branchScope';

const COLOR_THEMES = {
  indigo: {
    panel: 'border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white',
    icon: 'bg-indigo-100 text-indigo-600',
    badge: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
    button: 'bg-indigo-600 text-white hover:bg-indigo-700',
  },
  emerald: {
    panel: 'border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white',
    icon: 'bg-emerald-100 text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    button: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
  amber: {
    panel: 'border-amber-100 bg-gradient-to-br from-amber-50 via-white to-white',
    icon: 'bg-amber-100 text-amber-600',
    badge: 'bg-amber-100 text-amber-700 border border-amber-200',
    button: 'bg-amber-500 text-white hover:bg-amber-600',
  },
  rose: {
    panel: 'border-rose-100 bg-gradient-to-br from-rose-50 via-white to-white',
    icon: 'bg-rose-100 text-rose-600',
    badge: 'bg-rose-100 text-rose-700 border border-rose-200',
    button: 'bg-rose-500 text-white hover:bg-rose-600',
  },
  cyan: {
    panel: 'border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-white',
    icon: 'bg-cyan-100 text-cyan-600',
    badge: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
    button: 'bg-cyan-600 text-white hover:bg-cyan-700',
  },
  slate: {
    panel: 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white',
    icon: 'bg-slate-100 text-slate-600',
    badge: 'bg-slate-100 text-slate-700 border border-slate-200',
    button: 'bg-slate-800 text-white hover:bg-slate-700',
  },
};

const CLASS_TYPE_FORM = {
  title: '',
  category: '',
  description: '',
  trainer_name: '',
  capacity: '20',
  duration_minutes: '60',
  location: '',
  branch_id: '',
  color_theme: 'indigo',
  is_active: true,
};

const SESSION_FORM = {
  class_type_id: '',
  starts_at: '',
  duration_minutes: '60',
  trainer_name: '',
  capacity: '20',
  status: 'SCHEDULED',
  repeat_mode: '',
  repeat_until: '',
  repeat_days: [],
  notes: '',
};

const REPEAT_DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const SESSION_STATUS_STYLES = {
  SCHEDULED: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  COMPLETED: 'bg-slate-100 text-slate-700 border border-slate-200',
  CANCELLED: 'bg-rose-100 text-rose-700 border border-rose-200',
};

const BOOKING_STATUS_STYLES = {
  BOOKED: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  WAITLISTED: 'bg-amber-100 text-amber-700 border border-amber-200',
  CHECKED_IN: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  CANCELLED: 'bg-rose-100 text-rose-700 border border-rose-200',
};

const getTheme = (value) => COLOR_THEMES[String(value || '').toLowerCase()] || COLOR_THEMES.indigo;

const getDefaultSessionTime = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toDateTimeLocal = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getDurationMinutes = (session) => {
  if (session?.starts_at && session?.ends_at) {
    const start = new Date(session.starts_at);
    const end = new Date(session.ends_at);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const diff = Math.round((end.getTime() - start.getTime()) / 60000);
      if (diff > 0) return diff;
    }
  }
  return Number(session?.duration_minutes || 60);
};

const formatDateLabel = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
};

const formatTimeRange = (startValue, endValue) => {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime())) return 'Time unavailable';
  const startLabel = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (Number.isNaN(end.getTime())) return startLabel;
  const endLabel = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${startLabel} - ${endLabel}`;
};

const getInitials = (name) => String(name || '?').split(' ').filter(Boolean).map((value) => value[0]).join('').toUpperCase().slice(0, 2) || '?';

const extractMembers = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.members)) return data.members;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
};

const requestDataRefresh = (source) => {
  window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
    detail: { source, at: Date.now() },
  }));
};

const MemberAvatar = ({ name, profilePic }) => {
  const [imgError, setImgError] = useState(false);
  const src = normalizeProfileImageUrl(profilePic);
  const showInitials = !src || imgError;
  return (
    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
      {showInitials ? (
        <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center text-xs font-black">
          {getInitials(name)}
        </div>
      ) : (
        <img src={src} alt={name} className="w-full h-full object-cover" onError={() => setImgError(true)} />
      )}
    </div>
  );
};

const ClassesPage = ({ appRuntime, canManage = false }) => {
  const { token, toast, showConfirm, currentUser = null } = appRuntime;
  const branchDirectory = normalizeBranchDirectory(appRuntime.branchDirectory);
  const defaultBranchId = getDefaultBranchId(branchDirectory);
  const operationsBranchId = appRuntime.operationsBranchId || currentUser?.branch_id || defaultBranchId;
  const branchScopeValue = getBranchRequestValue(operationsBranchId);
  const showBranchMeta = branchDirectory.length > 1;
  const getClassBranchLabel = useCallback((record) => getBranchLabel(branchDirectory, record?.branch_id || branchScopeValue || defaultBranchId, { allLabel: 'Main Branch' }), [branchDirectory, branchScopeValue, defaultBranchId]);
  const [summary, setSummary] = useState(null);
  const [classTypes, setClassTypes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeForm, setTypeForm] = useState(() => ({ ...CLASS_TYPE_FORM, branch_id: branchScopeValue || defaultBranchId }));
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [sessionForm, setSessionForm] = useState({ ...SESSION_FORM, starts_at: getDefaultSessionTime() });
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const loadCompletedRef = useRef(false);
  const selectedSession = sessions.find((session) => Number(session.id) === Number(selectedSessionId)) || null;

  const fetchClassesData = useCallback(async ({ soft = false } = {}) => {
    if (!token) return;
    if (soft) setRefreshing(true);
    else setLoading(true);

    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + (14 * 24 * 60 * 60 * 1000));

    try {
      const [summaryRes, typesRes, scheduleRes] = await Promise.all([
        axios.get('/api/classes/summary', { headers: { 'x-auth-token': token }, params: { branch_id: branchScopeValue } }),
        axios.get('/api/classes/types', { headers: { 'x-auth-token': token }, params: { include_inactive: true, branch_id: branchScopeValue } }),
        axios.get('/api/classes/schedule', {
          headers: { 'x-auth-token': token },
          params: {
            from: from.toISOString(),
            to: to.toISOString(),
            branch_id: branchScopeValue,
          },
        }),
      ]);

      setSummary(summaryRes.data || {});
      setClassTypes(Array.isArray(typesRes.data) ? typesRes.data : []);
      setSessions(Array.isArray(scheduleRes.data) ? scheduleRes.data : []);
      loadCompletedRef.current = true;
    } catch (_err) {
      toast?.('Unable to load class operations right now.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branchScopeValue, toast, token]);

  const fetchBookings = async (sessionId) => {
    if (!sessionId) return;
    setBookingsLoading(true);
    try {
      const res = await axios.get(`/api/classes/sessions/${sessionId}/bookings`, { headers: { 'x-auth-token': token }, params: { branch_id: branchScopeValue } });
      setBookings(Array.isArray(res.data) ? res.data : []);
    } catch (_err) {
      toast?.('Unable to load class bookings.', 'error');
    } finally {
      setBookingsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return undefined;
    const soft = loadCompletedRef.current;
    const timer = window.setTimeout(() => {
      fetchClassesData({ soft });
    }, soft ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchClassesData, token]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMemberResults([]);
      setMemberSearch('');
      return undefined;
    }
    if (memberSearch.trim().length < 2) {
      setMemberResults([]);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const res = await axios.get('/api/members', {
          headers: { 'x-auth-token': token },
          params: { search: memberSearch.trim(), branch_id: selectedSession?.branch_id || branchScopeValue },
        });
        setMemberResults(extractMembers(res.data).slice(0, 8));
      } catch (_err) {
        setMemberResults([]);
      } finally {
        setMemberSearchLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [branchScopeValue, memberSearch, selectedSession?.branch_id, selectedSessionId, token]);

  const groupedSessions = [];
  sessions.forEach((session) => {
    const key = formatDateLabel(session.starts_at);
    const existing = groupedSessions.find((group) => group.key === key);
    if (existing) {
      existing.items.push(session);
      return;
    }
    groupedSessions.push({ key, items: [session] });
  });

  const summaryCards = [
    { label: 'Active Types', value: summary?.active_types || 0, icon: Layers, box: 'bg-indigo-50 text-indigo-600' },
    { label: 'Today Sessions', value: summary?.today_sessions || 0, icon: CalendarDays, box: 'bg-emerald-50 text-emerald-600' },
    { label: 'Booked Today', value: summary?.booked_today || 0, icon: Users, box: 'bg-amber-50 text-amber-600' },
    { label: 'Checked-In Today', value: summary?.checked_in_today || 0, icon: CheckCircle2, box: 'bg-violet-50 text-violet-600' },
  ];

  const closeTypeModal = () => {
    setShowTypeModal(false);
    setEditingType(null);
    setTypeForm({ ...CLASS_TYPE_FORM, branch_id: branchScopeValue || defaultBranchId });
  };

  const closeSessionModal = () => {
    setShowSessionModal(false);
    setEditingSession(null);
    setSessionForm({ ...SESSION_FORM, starts_at: getDefaultSessionTime() });
  };

  const openTypeModal = (classType = null) => {
    if (!canManage) {
      toast?.('You do not have permission to manage classes.', 'warning');
      return;
    }
    if (classType) {
      setEditingType(classType);
      setTypeForm({
        title: String(classType.title || ''),
        category: String(classType.category || ''),
        description: String(classType.description || ''),
        trainer_name: String(classType.trainer_name || ''),
        capacity: String(classType.capacity || 20),
        duration_minutes: String(classType.duration_minutes || 60),
        location: String(classType.location || ''),
        branch_id: String(classType.branch_id || branchScopeValue || defaultBranchId),
        color_theme: String(classType.color_theme || 'indigo'),
        is_active: Boolean(classType.is_active),
      });
    } else {
      setEditingType(null);
      setTypeForm({ ...CLASS_TYPE_FORM, branch_id: branchScopeValue || defaultBranchId });
    }
    setShowTypeModal(true);
  };

  const openSessionModal = (session = null, classTypeId = '') => {
    if (!canManage) {
      toast?.('You do not have permission to manage classes.', 'warning');
      return;
    }

    if (session) {
      setEditingSession(session);
      setSessionForm({
        class_type_id: String(session.class_type_id || ''),
        starts_at: toDateTimeLocal(session.starts_at),
        duration_minutes: String(getDurationMinutes(session) || 60),
        trainer_name: String(session.trainer_name || session.default_trainer_name || ''),
        capacity: String(session.capacity || session.effective_capacity || 20),
        status: String(session.status || 'SCHEDULED'),
        repeat_mode: '',
        repeat_until: '',
        repeat_days: [],
        notes: String(session.notes || ''),
      });
    } else {
      const linkedType = classTypes.find((item) => Number(item.id) === Number(classTypeId));
      setEditingSession(null);
      setSessionForm({
        class_type_id: classTypeId ? String(classTypeId) : '',
        starts_at: getDefaultSessionTime(),
        duration_minutes: String(linkedType?.duration_minutes || 60),
        trainer_name: String(linkedType?.trainer_name || ''),
        capacity: String(linkedType?.capacity || 20),
        status: 'SCHEDULED',
        repeat_mode: '',
        repeat_until: '',
        repeat_days: [],
        notes: '',
      });
    }
    setShowSessionModal(true);
  };

  const openBookingsModal = async (session) => {
    setSelectedSessionId(session.id);
    setBookings([]);
    await fetchBookings(session.id);
  };

  const closeBookingsModal = () => {
    setSelectedSessionId(null);
    setBookings([]);
    setMemberResults([]);
    setMemberSearch('');
  };

  const handleSaveType = async (event) => {
    event.preventDefault();
    if (!canManage) {
      toast?.('You do not have permission to manage classes.', 'warning');
      return;
    }
    if (!typeForm.title.trim()) {
      toast?.('Class title is required.', 'warning');
      return;
    }

    const payload = {
      ...typeForm,
      title: typeForm.title.trim(),
      category: typeForm.category.trim(),
      description: typeForm.description.trim(),
      trainer_name: typeForm.trainer_name.trim(),
      location: typeForm.location.trim(),
      capacity: Number.parseInt(typeForm.capacity, 10) || 20,
      duration_minutes: Number.parseInt(typeForm.duration_minutes, 10) || 60,
      branch_id: typeForm.branch_id || branchScopeValue || defaultBranchId,
      color_theme: typeForm.color_theme || 'indigo',
    };

    try {
      if (editingType?.id) {
        await axios.put(`/api/classes/types/${editingType.id}`, payload, { headers: { 'x-auth-token': token } });
        toast?.('Class type updated.', 'success');
      } else {
        await axios.post('/api/classes/types', payload, { headers: { 'x-auth-token': token } });
        toast?.('Class type created.', 'success');
      }
      closeTypeModal();
      await fetchClassesData({ soft: true });
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to save class type.', 'error');
    }
  };

  const handleSaveSession = async (event) => {
    event.preventDefault();
    if (!canManage) {
      toast?.('You do not have permission to manage classes.', 'warning');
      return;
    }

    if (!sessionForm.class_type_id || !sessionForm.starts_at) {
      toast?.('Class type and start time are required.', 'warning');
      return;
    }

    const payload = {
      class_type_id: Number.parseInt(sessionForm.class_type_id, 10),
      starts_at: sessionForm.starts_at,
      duration_minutes: Number.parseInt(sessionForm.duration_minutes, 10) || 60,
      trainer_name: sessionForm.trainer_name.trim(),
      capacity: Number.parseInt(sessionForm.capacity, 10) || 20,
      status: sessionForm.status || 'SCHEDULED',
      repeat_mode: sessionForm.repeat_mode || '',
      repeat_until: sessionForm.repeat_until || '',
      repeat_days: Array.isArray(sessionForm.repeat_days) ? sessionForm.repeat_days : [],
      notes: sessionForm.notes.trim(),
      branch_id: branchScopeValue,
    };

    try {
      if (editingSession?.id) {
        await axios.put(`/api/classes/sessions/${editingSession.id}`, payload, { headers: { 'x-auth-token': token } });
        toast?.('Session updated.', 'success');
      } else if (payload.repeat_mode && payload.repeat_until) {
        const res = await axios.post('/api/classes/sessions/recurring', payload, { headers: { 'x-auth-token': token } });
        const createdCount = Number(res.data?.created_count || 0);
        toast?.(createdCount > 1 ? `Scheduled ${createdCount} recurring sessions.` : 'Recurring schedule created.', 'success');
      } else {
        await axios.post('/api/classes/sessions', payload, { headers: { 'x-auth-token': token } });
        toast?.('Session scheduled.', 'success');
      }
      closeSessionModal();
      await fetchClassesData({ soft: true });
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to save session.', 'error');
    }
  };

  const handleAddBooking = async (member) => {
    if (!selectedSessionId || !canManage) return;
    try {
      await axios.post(`/api/classes/sessions/${selectedSessionId}/bookings`, { member_id: member.id, branch_id: selectedSession?.branch_id || branchScopeValue }, { headers: { 'x-auth-token': token } });
      toast?.(`Booked ${member.full_name}.`, 'success');
      setMemberSearch('');
      setMemberResults([]);
      await Promise.all([fetchBookings(selectedSessionId), fetchClassesData({ soft: true })]);
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to create booking.', 'error');
    }
  };

  const handleRemoveBooking = (booking) => {
    if (!selectedSessionId || !canManage) return;
    showConfirm?.({
      title: 'Remove Booking',
      message: `Remove ${booking.full_name} from this class session?`,
      confirmLabel: 'Remove Booking',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await axios.delete(`/api/classes/sessions/${selectedSessionId}/bookings/${booking.member_id}`, { headers: { 'x-auth-token': token }, params: { branch_id: selectedSession?.branch_id || branchScopeValue } });
          toast?.('Booking removed.', 'success');
          await Promise.all([fetchBookings(selectedSessionId), fetchClassesData({ soft: true })]);
        } catch (err) {
          toast?.(err?.response?.data?.error || 'Unable to remove booking.', 'error');
        }
      },
    });
  };

  const handleCheckInBooking = async (booking) => {
    if (!selectedSessionId || !canManage) return;
    try {
      await axios.post(`/api/classes/sessions/${selectedSessionId}/bookings/${booking.member_id}/check-in`, { branch_id: selectedSession?.branch_id || branchScopeValue }, { headers: { 'x-auth-token': token } });
      toast?.('Member checked in from class roster.', 'success');
      requestDataRefresh('classes-checkin');
      await Promise.all([fetchBookings(selectedSessionId), fetchClassesData({ soft: true })]);
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to check member in.', 'error');
    }
  };

  if (loading && sessions.length === 0 && classTypes.length === 0) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 sm:gap-5 p-1 sm:p-2">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 p-4 flex items-center gap-3" style={{ boxShadow: '0 2px 16px rgba(99,102,241,0.05), 0 1px 3px rgba(0,0,0,0.03)' }}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.box}`}>
              <card.icon size={18} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide leading-none mb-0.5">{card.label}</p>
              <p className="text-2xl font-black text-slate-900 leading-none">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start justify-end">
        <OperationsBranchScopeBar
          branchDirectory={branchDirectory}
          branchId={operationsBranchId}
          onChange={appRuntime.setOperationsBranchId}
          currentUser={currentUser}
          loading={appRuntime.branchScopeLoading}
          title="Class scope"
          description="Filter class formats, sessions, and roster actions by branch before scheduling or check-in."
          className="shrink-0"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-4 bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-4 sm:p-6 flex flex-col gap-4 overflow-hidden" style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
                {refreshing && <span className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Refreshing</span>}
              </div>
              <p className="text-slate-500 text-sm mt-0.5">Define formats once, then schedule sessions cleanly.</p>
            </div>
            {canManage && (
              <button onClick={() => openTypeModal()} className="text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all hover:opacity-90 active:scale-95 text-sm shrink-0" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                <Plus size={16} /> Type
              </button>
            )}
          </div>

          <div className="space-y-3 overflow-auto pr-1">
            {classTypes.length === 0 ? (
              <div className="rounded-[24px] border-2 border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-white text-slate-300 shadow-sm flex items-center justify-center mx-auto mb-4">
                  <Layers size={28} />
                </div>
                <h2 className="text-lg font-black text-slate-900 mb-2">No class formats yet</h2>
                <p className="text-sm font-semibold text-slate-500 mb-6">Create yoga, zumba, strength, or PT blocks first. Scheduling gets faster after that.</p>
                {canManage && (
                  <button onClick={() => openTypeModal()} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white font-black text-sm">
                    <Plus size={15} /> Add Class Type
                  </button>
                )}
              </div>
            ) : (
              classTypes.map((classType) => {
                const theme = getTheme(classType.color_theme);
                return (
                  <div key={classType.id} className={`rounded-2xl border p-4 ${theme.panel}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${theme.icon}`}>
                            <Layers size={17} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-900 truncate">{classType.title}</p>
                            <p className="text-xs font-semibold text-slate-500 truncate">{classType.category || 'General class'} • {classType.duration_minutes || 60} min{showBranchMeta ? ` • ${getClassBranchLabel(classType)}` : ''}</p>
                          </div>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${classType.is_active ? theme.badge : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                        {classType.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                      <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Seats</p>
                        <p className="text-sm font-black text-slate-900">{classType.capacity || 20}</p>
                      </div>
                      <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Upcoming</p>
                        <p className="text-sm font-black text-slate-900">{classType.upcoming_sessions || 0}</p>
                      </div>
                      <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Coach</p>
                        <p className="text-sm font-black text-slate-900 truncate">{classType.trainer_name || 'Desk'}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 mt-4 text-xs font-semibold text-slate-500">
                      <span className="truncate flex items-center gap-1.5"><MapPin size={12} /> {classType.location || 'Main floor'}</span>
                      {canManage && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => openSessionModal(null, classType.id)} className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all ${theme.button}`}>
                            Schedule
                          </button>
                          <button type="button" aria-label={`Edit ${classType.title}`} onClick={() => openTypeModal(classType)} className="p-2 rounded-xl bg-white/80 border border-white text-slate-500 hover:text-slate-800 transition-all">
                            <Pencil size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {classType.description && <p className="text-xs text-slate-500 mt-3 leading-relaxed">{classType.description}</p>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="xl:col-span-8 bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-4 sm:p-6 flex flex-col gap-4 overflow-hidden" style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900">Next 14 Days Schedule</h2>
              <p className="text-sm font-semibold text-slate-500 mt-0.5">Bookings, waitlist pressure, and coach visibility stay in one place.</p>
            </div>
            {canManage && (
              <button disabled={classTypes.length === 0} onClick={() => openSessionModal()} className="text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 text-sm disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(135deg, #0f172a, #334155)', boxShadow: '0 4px 16px rgba(15,23,42,0.25)' }}>
                <Plus size={16} /> New Session
              </button>
            )}
          </div>

          {classTypes.length === 0 ? (
            <div className="flex-1 rounded-[24px] border-2 border-dashed border-slate-200 bg-slate-50/60 p-8 text-center flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-white text-slate-300 shadow-sm flex items-center justify-center mb-4">
                <CalendarDays size={28} />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">Create a class type first</h3>
              <p className="text-sm font-semibold text-slate-500 max-w-sm">The schedule stays intentionally simple: define the format once, then stack sessions under it.</p>
            </div>
          ) : groupedSessions.length === 0 ? (
            <div className="flex-1 rounded-[24px] border-2 border-dashed border-slate-200 bg-slate-50/60 p-8 text-center flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-white text-slate-300 shadow-sm flex items-center justify-center mb-4">
                <Sparkles size={28} />
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-2">No sessions scheduled yet</h3>
              <p className="text-sm font-semibold text-slate-500 mb-6 max-w-sm">Add the first session and the roster tools will unlock automatically.</p>
              {canManage && (
                <button onClick={() => openSessionModal()} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white font-black text-sm">
                  <Plus size={15} /> Schedule First Session
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5 overflow-auto pr-1">
              {groupedSessions.map((group) => (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.12)]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">{group.key}</h3>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {group.items.map((session) => {
                      const theme = getTheme(session.color_theme);
                      const bookedCount = Number(session.booked_count || 0);
                      const capacity = Number(session.effective_capacity || 0) || 20;
                      const waitlistCount = Number(session.waitlist_count || 0);
                      const occupancy = Math.min(100, Math.round((bookedCount / capacity) * 100));
                      return (
                        <div key={session.id} className={`rounded-2xl border p-4 ${theme.panel}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <p className="font-black text-slate-900 truncate">{session.class_title}</p>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${SESSION_STATUS_STYLES[String(session.status || 'SCHEDULED').toUpperCase()] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>{session.status}</span>
                              </div>
                              <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Clock3 size={12} /> {formatTimeRange(session.starts_at, session.ends_at)}{showBranchMeta ? ` • ${getClassBranchLabel(session)}` : ''}</p>
                            </div>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${theme.icon}`}>
                              <CalendarDays size={17} />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                            <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Booked</p>
                              <p className="text-sm font-black text-slate-900">{bookedCount}/{capacity}</p>
                            </div>
                            <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Waitlist</p>
                              <p className="text-sm font-black text-slate-900">{waitlistCount}</p>
                            </div>
                            <div className="rounded-xl bg-white/80 border border-white px-2 py-2.5">
                              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Checked-In</p>
                              <p className="text-sm font-black text-slate-900">{session.checked_in_count || 0}</p>
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="h-2 rounded-full bg-white border border-white overflow-hidden">
                              <div className="h-full rounded-full bg-slate-900" style={{ width: `${occupancy}%` }} />
                            </div>
                            <div className="flex items-center justify-between mt-2 text-xs font-semibold text-slate-500 gap-2">
                              <span className="truncate flex items-center gap-1.5"><User size={12} /> {session.trainer_name || session.default_trainer_name || 'Desk assigned'}</span>
                              <span className="truncate flex items-center gap-1.5"><MapPin size={12} /> {session.location || 'Main floor'}</span>
                            </div>
                          </div>

                          {session.notes && <p className="text-xs text-slate-500 mt-3 line-clamp-2">{session.notes}</p>}

                          <div className="flex items-center gap-2 mt-4">
                            <button onClick={() => openBookingsModal(session)} className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all ${theme.button}`}>
                              Bookings
                            </button>
                            {canManage && (
                              <button type="button" aria-label={`Edit ${session.class_title}`} onClick={() => openSessionModal(session)} className="px-3 py-2.5 rounded-xl bg-white/80 border border-white text-slate-600 hover:text-slate-900 transition-all">
                                <Pencil size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showTypeModal && (
        <div className="app-modal-shell z-[140] bg-slate-900/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={editingType ? 'Edit class type' : 'Create class type'} className="app-modal-panel bg-white rounded-[28px] w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' }}>
              <div>
                <h2 className="text-lg font-black">{editingType ? 'Edit Class Type' : 'Create Class Type'}</h2>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mt-1">Keep schedule setup crisp and repeatable</p>
              </div>
              <button type="button" aria-label="Close class type form" onClick={closeTypeModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveType} className="app-modal-scroll p-6 space-y-5">
              <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Title *</label>
                  <input type="text" required value={typeForm.title} onChange={(event) => setTypeForm((prev) => ({ ...prev, title: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Strength Circuit" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Category</label>
                  <input type="text" value={typeForm.category} onChange={(event) => setTypeForm((prev) => ({ ...prev, category: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Group, PT, Cardio..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Trainer Name</label>
                  <input type="text" value={typeForm.trainer_name} onChange={(event) => setTypeForm((prev) => ({ ...prev, trainer_name: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Coach Arjun" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Location</label>
                  <input type="text" value={typeForm.location} onChange={(event) => setTypeForm((prev) => ({ ...prev, location: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Studio A" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Capacity</label>
                  <input type="number" min="1" value={typeForm.capacity} onChange={(event) => setTypeForm((prev) => ({ ...prev, capacity: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Duration Minutes</label>
                  <input type="number" min="15" step="5" value={typeForm.duration_minutes} onChange={(event) => setTypeForm((prev) => ({ ...prev, duration_minutes: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Color Theme</label>
                  <select value={typeForm.color_theme} onChange={(event) => setTypeForm((prev) => ({ ...prev, color_theme: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                    {Object.keys(COLOR_THEMES).map((themeKey) => (
                      <option key={themeKey} value={themeKey}>{themeKey}</option>
                    ))}
                  </select>
                </div>
                {!editingType && branchDirectory.length > 1 && (
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Branch *</label>
                    <select value={typeForm.branch_id || branchScopeValue || defaultBranchId} onChange={(event) => setTypeForm((prev) => ({ ...prev, branch_id: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                      {branchDirectory.map((branch) => (
                        <option key={branch.id} value={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Description</label>
                <textarea value={typeForm.description} onChange={(event) => setTypeForm((prev) => ({ ...prev, description: event.target.value }))} rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all resize-none" placeholder="What members should expect from this format..." />
              </div>

              {editingType && (
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                  <input type="checkbox" checked={typeForm.is_active} onChange={(event) => setTypeForm((prev) => ({ ...prev, is_active: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <div>
                    <p className="text-sm font-black text-slate-900">Keep this class active</p>
                    <p className="text-xs font-semibold text-slate-500">Inactive types stay hidden from future setup unless explicitly shown.</p>
                  </div>
                </label>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" className="flex-1 py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                  {editingType ? 'Save Type Changes' : 'Create Class Type'}
                </button>
                <button type="button" onClick={closeTypeModal} className="sm:w-auto py-3 px-5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSessionModal && (
        <div className="app-modal-shell z-[150] bg-slate-900/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={editingSession ? 'Update session' : 'Schedule session'} className="app-modal-panel bg-white rounded-[28px] w-full max-w-xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)' }}>
              <div>
                <h2 className="text-lg font-black">{editingSession ? 'Update Session' : 'Schedule Session'}</h2>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mt-1">Keep session setup fast for front-desk use</p>
              </div>
              <button type="button" aria-label="Close session form" onClick={closeSessionModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveSession} className="app-modal-scroll p-6 space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Class Type *</label>
                <select value={sessionForm.class_type_id} disabled={Boolean(editingSession)} onChange={(event) => {
                  const nextTypeId = event.target.value;
                  const nextType = classTypes.find((item) => Number(item.id) === Number(nextTypeId));
                  setSessionForm((prev) => ({
                    ...prev,
                    class_type_id: nextTypeId,
                    trainer_name: nextType?.trainer_name || prev.trainer_name,
                    capacity: String(nextType?.capacity || prev.capacity || 20),
                    duration_minutes: String(nextType?.duration_minutes || prev.duration_minutes || 60),
                  }));
                }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all disabled:opacity-60">
                  <option value="">Select class type</option>
                  {classTypes.filter((item) => item.is_active || Number(item.id) === Number(sessionForm.class_type_id)).map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Start Time *</label>
                  <input type="datetime-local" required value={sessionForm.starts_at} onChange={(event) => setSessionForm((prev) => ({ ...prev, starts_at: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Duration Minutes</label>
                  <input type="number" min="15" step="5" value={sessionForm.duration_minutes} onChange={(event) => setSessionForm((prev) => ({ ...prev, duration_minutes: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Trainer</label>
                  <input type="text" value={sessionForm.trainer_name} onChange={(event) => setSessionForm((prev) => ({ ...prev, trainer_name: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Optional override" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Capacity</label>
                  <input type="number" min="1" value={sessionForm.capacity} onChange={(event) => setSessionForm((prev) => ({ ...prev, capacity: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Status</label>
                <select value={sessionForm.status} onChange={(event) => setSessionForm((prev) => ({ ...prev, status: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              {!editingSession && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
                  <div>
                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.18em]">Recurring Builder</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">Turn one session into a clean repeating series for the next few weeks.</p>
                  </div>

                  <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Repeat Pattern</label>
                      <select value={sessionForm.repeat_mode} onChange={(event) => setSessionForm((prev) => ({ ...prev, repeat_mode: event.target.value, repeat_days: event.target.value === 'CUSTOM' ? prev.repeat_days : [] }))} className="w-full px-4 py-2.5 bg-white border border-indigo-100 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                        <option value="">Do not repeat</option>
                        <option value="DAILY">Daily</option>
                        <option value="WEEKDAYS">Weekdays</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="CUSTOM">Custom Days</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Repeat Until</label>
                      <input type="date" value={sessionForm.repeat_until} onChange={(event) => setSessionForm((prev) => ({ ...prev, repeat_until: event.target.value }))} className="w-full px-4 py-2.5 bg-white border border-indigo-100 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" disabled={!sessionForm.repeat_mode} />
                    </div>
                  </div>

                  {sessionForm.repeat_mode === 'CUSTOM' && (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-0.5">Custom Days</label>
                      <div className="flex flex-wrap gap-2">
                        {REPEAT_DAY_OPTIONS.map((option) => {
                          const active = sessionForm.repeat_days.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSessionForm((prev) => ({
                                ...prev,
                                repeat_days: active
                                  ? prev.repeat_days.filter((item) => item !== option.value)
                                  : [...prev.repeat_days, option.value],
                              }))}
                              className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all ${active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Notes</label>
                <textarea value={sessionForm.notes} onChange={(event) => setSessionForm((prev) => ({ ...prev, notes: event.target.value }))} rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all resize-none" placeholder="Special equipment, focus, member notes..." />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" className="flex-1 py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #1e1b4b, #4338ca)', boxShadow: '0 4px 16px rgba(67,56,202,0.32)' }}>
                  {editingSession ? 'Save Session Changes' : 'Schedule Session'}
                </button>
                <button type="button" onClick={closeSessionModal} className="sm:w-auto py-3 px-5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedSession && (
        <div className="app-modal-shell z-[160] bg-slate-900/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Class roster" className="app-modal-panel bg-white rounded-[28px] w-full max-w-3xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-start gap-4" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/55 mb-1.5">Class Roster</p>
                <h2 className="text-xl font-black">{selectedSession.class_title}</h2>
                <p className="text-sm font-semibold text-white/65 mt-1">{formatDateLabel(selectedSession.starts_at)} • {formatTimeRange(selectedSession.starts_at, selectedSession.ends_at)}{showBranchMeta ? ` • ${getClassBranchLabel(selectedSession)}` : ''}</p>
              </div>
              <button type="button" aria-label="Close class roster" onClick={closeBookingsModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <div className="app-modal-scroll p-6 space-y-5">
              {canManage && String(selectedSession.status || '').toUpperCase() === 'SCHEDULED' && (
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Add member to roster</h3>
                    <p className="text-xs font-semibold text-slate-500 mt-1">Search an existing member and place them into the session or waitlist instantly.</p>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input type="text" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search member name or phone..." className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-sm font-medium transition-all" />
                  </div>
                  {memberSearch.trim().length >= 2 && (
                    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                      {memberSearchLoading ? (
                        <div className="px-4 py-3 text-sm font-semibold text-slate-500">Searching members...</div>
                      ) : memberResults.length === 0 ? (
                        <div className="px-4 py-3 text-sm font-semibold text-slate-500">No matching members found.</div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {memberResults.map((member) => (
                            <div key={member.id} className="px-4 py-3 flex items-center justify-between gap-3">
                              <div className="min-w-0 flex items-center gap-3">
                                <MemberAvatar name={member.full_name} profilePic={member.profile_pic} />
                                <div className="min-w-0">
                                  <p className="font-black text-slate-900 truncate">{member.full_name}</p>
                                  <p className="text-xs font-semibold text-slate-500 truncate">{member.phone}{member.email ? ` • ${member.email}` : ''}</p>
                                </div>
                              </div>
                              <button onClick={() => handleAddBooking(member)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-indigo-700 transition-all shrink-0">
                                <ArrowRight size={12} /> Add
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 desktop:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Booked</p>
                  <p className="text-xl font-black text-slate-900">{selectedSession.booked_count || 0}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Capacity</p>
                  <p className="text-xl font-black text-slate-900">{selectedSession.effective_capacity || selectedSession.capacity || 0}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Waitlist</p>
                  <p className="text-xl font-black text-slate-900">{selectedSession.waitlist_count || 0}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Checked-In</p>
                  <p className="text-xl font-black text-slate-900">{selectedSession.checked_in_count || 0}</p>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Roster</h3>
                    <p className="text-xs font-semibold text-slate-500 mt-0.5">Bookings are ordered by check-in state and queue position.</p>
                  </div>
                </div>

                {bookingsLoading ? (
                  <div className="px-4 py-10 text-sm font-semibold text-slate-500 text-center">Loading roster...</div>
                ) : bookings.length === 0 ? (
                  <div className="px-4 py-10 text-sm font-semibold text-slate-500 text-center">No members booked into this session yet.</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {bookings.map((booking) => {
                      const bookingStatus = String(booking.status || 'BOOKED').toUpperCase();
                      const canCheckIn = canManage && bookingStatus !== 'CHECKED_IN' && bookingStatus !== 'CANCELLED' && String(selectedSession.status || '').toUpperCase() === 'SCHEDULED';
                      const canRemove = canManage && bookingStatus !== 'CHECKED_IN' && bookingStatus !== 'CANCELLED' && String(selectedSession.status || '').toUpperCase() === 'SCHEDULED';
                      return (
                        <div key={`${booking.class_session_id}-${booking.member_id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <MemberAvatar name={booking.full_name} profilePic={booking.profile_pic} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-black text-slate-900 truncate">{booking.full_name}</p>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${BOOKING_STATUS_STYLES[bookingStatus] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>{bookingStatus.replace('_', ' ')}</span>
                              </div>
                              <p className="text-xs font-semibold text-slate-500 truncate">{booking.phone}{booking.email ? ` • ${booking.email}` : ''}</p>
                              {booking.check_in_time && <p className="text-[11px] font-semibold text-emerald-600 mt-1">Checked in at {new Date(booking.check_in_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {canCheckIn && (
                              <button onClick={() => handleCheckInBooking(booking)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-emerald-700 transition-all">
                                <CheckCircle2 size={12} /> Check-In
                              </button>
                            )}
                            {canRemove && (
                              <button onClick={() => handleRemoveBooking(booking)} className="p-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-600 hover:text-white transition-all">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassesPage;