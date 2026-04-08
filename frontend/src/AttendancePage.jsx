import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import PageLoader from './PageLoader';
import OperationsBranchScopeBar from './components/OperationsBranchScopeBar';
import PaginationControls from './components/PaginationControls';
import SafeResponsiveContainer from './components/SafeResponsiveContainer';
import { QRCodeCanvas } from 'qrcode.react';
import { getBranchLabel, getBranchRequestValue, getDefaultBranchId, normalizeBranchDirectory } from './utils/branchScope';
import useCountUp from './utils/useCountUp';
import { buildReminderPreviewDialog, getReminderPreviewBlockReason, previewWhatsAppReminders, sendWhatsAppReminders, summarizeReminderResult } from './utils/whatsappReminders';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Copy,
  Fingerprint,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Shield,
  Smartphone,
  Users,
  MessageSquare,
  X,
} from 'lucide-react';
import { BarChart, Bar, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

const DEFAULT_ATTENDANCE_MODE = 'STAFF';
const DEFAULT_GYM_RADIUS_METERS = 200;

const MODE_META = {
  STAFF: {
    label: 'Staff Check-In',
    icon: Users,
    desc: 'Reception marks attendance manually.',
    color: 'from-indigo-500 to-violet-500',
  },
  QR: {
    label: 'QR Code Check-In',
    icon: QrCode,
    desc: 'Member identity verified using QR flow.',
    color: 'from-emerald-500 to-teal-500',
  },
  SELF: {
    label: 'Self Check-In (Mobile)',
    icon: Smartphone,
    desc: 'Member checks in via app with location checks.',
    color: 'from-sky-500 to-blue-500',
  },
  RFID: {
    label: 'RFID / Biometric',
    icon: Fingerprint,
    desc: 'Hardware-triggered check-in with backend validation.',
    color: 'from-rose-500 to-pink-500',
  },
};

const POLICY_DAY_OPTIONS = [
  { value: 'MON', label: 'Mon' },
  { value: 'TUE', label: 'Tue' },
  { value: 'WED', label: 'Wed' },
  { value: 'THU', label: 'Thu' },
  { value: 'FRI', label: 'Fri' },
  { value: 'SAT', label: 'Sat' },
  { value: 'SUN', label: 'Sun' },
];

const POLICY_FORM_DEFAULT = {
  plan_id: '',
  name: '',
  allowed_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  allowed_from: '',
  allowed_to: '',
  is_offpeak_only: false,
  enforce_freeze: true,
  max_daily_visits: '1',
  is_active: true,
};

const normalizePolicyDays = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[\s,|]+/)
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);
};

const methodBadge = (method) => {
  const key = String(method || 'STAFF').toUpperCase();
  const styles = {
    STAFF: 'bg-indigo-100 text-indigo-700',
    QR: 'bg-emerald-100 text-emerald-700',
    SELF: 'bg-sky-100 text-sky-700',
    RFID: 'bg-rose-100 text-rose-700',
  };
  return styles[key] || 'bg-slate-100 text-slate-700';
};

const statusBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (key === 'EXPIRED') return 'bg-rose-100 text-rose-700';
  if (key === 'UNPAID') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return `${date.toLocaleDateString('en-GB')} · ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

const unwrapApiData = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return unwrapApiData(payload.data);
  }
  return payload;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const asObject = (value, fallback = {}) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
);

const getApiErrorMessage = (error, fallback) => {
  const payload = asObject(error?.response?.data, {});
  return String(payload.message || payload.error || fallback);
};

const hasPermission = (user, permission) => {
  if (!permission) return true;
  if (!user) return false;
  if (String(user.role || '').toUpperCase() === 'OWNER') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;

  const [scope] = String(permission).split(':');
  return Boolean(scope && permissions.includes(`${scope}:*`));
};

function AttendancePage({ appRuntime, isActive = true, onOpenRfidSetup, focusSection = null, onSectionHandled }) {
  const { token, toast, showConfirm, currentUser = null } = appRuntime;
  const branchDirectory = normalizeBranchDirectory(appRuntime.branchDirectory);
  const defaultBranchId = getDefaultBranchId(branchDirectory);
  const operationsBranchId = appRuntime.operationsBranchId || currentUser?.branch_id || defaultBranchId;
  const branchScopeValue = getBranchRequestValue(operationsBranchId);
  const branchQueryParams = useMemo(() => (branchScopeValue ? { branch_id: branchScopeValue } : {}), [branchScopeValue]);
  const showBranchMeta = branchDirectory.length > 1;
  const getAttendanceBranchLabel = useCallback((record) => getBranchLabel(branchDirectory, record?.branch_id || branchScopeValue || defaultBranchId, { allLabel: 'Main Branch' }), [branchDirectory, branchScopeValue, defaultBranchId]);
  const headers = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);
  const isOwner = String(currentUser?.role || '').toUpperCase() === 'OWNER';
  const canWriteAttendance = hasPermission(currentUser, 'attendance:write');
  const qrScannerRef = useRef(null);
  const qrScannerBusyRef = useRef(false);
  const inactiveRequestSeqRef = useRef(0);
  const checkinOpsRef = useRef(null);
  const liveFeedRef = useRef(null);
  const refreshAttendanceViewsRef = useRef(() => Promise.resolve());
  const loadOverviewBundleRef = useRef(() => Promise.resolve());

  const [overview, setOverview] = useState({
    today_checkins: 0,
    yesterday_checkins: 0,
    active_members_today: 0,
    peak_hour_today: null,
    peak_hour_count: 0,
  });
  const [modeSettings, setModeSettings] = useState({
    attendance_mode: DEFAULT_ATTENDANCE_MODE,
    attendance_geo_enabled: false,
    gym_latitude: '',
    gym_longitude: '',
    gym_radius_meters: DEFAULT_GYM_RADIUS_METERS,
    allow_expired_checkin: false,
  });

  const [loading, setLoading] = useState(true);
  const [busyCheckin, setBusyCheckin] = useState(false);
  const [busySaveMode, setBusySaveMode] = useState(false);
  const [busyGeoSync, setBusyGeoSync] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);

  const checkinMethod = 'STAFF';
  const [checkinNote, setCheckinNote] = useState('');

  const [feed, setFeed] = useState([]);
  const [records, setRecords] = useState([]);
  const [recordsPagination, setRecordsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasNext: false, hasPrev: false });
  const [feedView, setFeedView] = useState('live');
  const [range, setRange] = useState('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [heatmap, setHeatmap] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [peakHoursDays, setPeakHoursDays] = useState('today');
  const peakHoursDaysRef = useRef('today');
  useEffect(() => { peakHoursDaysRef.current = peakHoursDays; }, [peakHoursDays]);
  const [inactiveDays, setInactiveDays] = useState(7);
  const [inactiveMembers, setInactiveMembers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [reminderLoadingId, setReminderLoadingId] = useState(null);

  const [warningState, setWarningState] = useState(null);
  const [qrModalState, setQrModalState] = useState(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScannerBooting, setQrScannerBooting] = useState(false);
  const [busyQrAction, setBusyQrAction] = useState(false);

  // ── Attendance Hub Tabs ──
  const [attendanceTab, setAttendanceTab] = useState('checkin');
  const [accessPolicies, setAccessPolicies] = useState([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyForm, setPolicyForm] = useState(POLICY_FORM_DEFAULT);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState(null);
  const [planOptions, setPlanOptions] = useState([]);

  const fetchAccessPolicies = useCallback(async () => {
    try {
      setPoliciesLoading(true);
      const res = await axios.get('/api/finance/access-policies', headers);
      setAccessPolicies(Array.isArray(res.data) ? res.data : []);
    } catch { setAccessPolicies([]); } finally { setPoliciesLoading(false); }
  }, [headers]);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await axios.get('/api/plans', headers);
      setPlanOptions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPlanOptions([]);
    }
  }, [headers]);

  useEffect(() => {
    if (attendanceTab === 'policies' && isOwner) {
      fetchAccessPolicies();
      fetchPlans();
    }
  }, [attendanceTab, fetchAccessPolicies, fetchPlans, isOwner]);

  useEffect(() => {
    if (!focusSection || !isActive) return undefined;

    if ((focusSection === 'checkin-ops' || focusSection === 'live-feed') && attendanceTab !== 'checkin') {
      setAttendanceTab('checkin');
      return undefined;
    }

    const sectionNode = focusSection === 'live-feed'
      ? liveFeedRef.current
      : focusSection === 'checkin-ops'
        ? checkinOpsRef.current
        : null;

    if (!sectionNode) return undefined;

    const timer = window.setTimeout(() => {
      sectionNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onSectionHandled?.();
    }, 90);

    return () => window.clearTimeout(timer);
  }, [attendanceTab, focusSection, isActive, onSectionHandled]);

  const closePolicyModal = () => {
    setShowPolicyModal(false);
    setEditingPolicyId(null);
    setPolicyForm(POLICY_FORM_DEFAULT);
  };

  const openNewPolicyModal = () => {
    setEditingPolicyId(null);
    setPolicyForm(POLICY_FORM_DEFAULT);
    setShowPolicyModal(true);
  };

  const openEditPolicyModal = (policy) => {
    setEditingPolicyId(policy.id);
    setPolicyForm({
      plan_id: policy.plan_id ? String(policy.plan_id) : '',
      name: String(policy.name || ''),
      allowed_days: normalizePolicyDays(policy.allowed_days),
      allowed_from: String(policy.allowed_from || '').slice(0, 5),
      allowed_to: String(policy.allowed_to || '').slice(0, 5),
      is_offpeak_only: Boolean(policy.is_offpeak_only),
      enforce_freeze: policy.enforce_freeze !== false,
      max_daily_visits: String(policy.max_daily_visits || 0),
      is_active: policy.is_active !== false,
    });
    setShowPolicyModal(true);
  };

  const togglePolicyDay = (dayCode) => {
    setPolicyForm((prev) => ({
      ...prev,
      allowed_days: prev.allowed_days.includes(dayCode)
        ? prev.allowed_days.filter((item) => item !== dayCode)
        : [...prev.allowed_days, dayCode],
    }));
  };

  const savePolicy = async (event) => {
    event.preventDefault();
    if (!policyForm.name.trim()) {
      toast?.('Policy name is required.', 'warning');
      return;
    }

    setPolicySaving(true);
    try {
      const payload = {
        plan_id: policyForm.plan_id ? Number.parseInt(policyForm.plan_id, 10) : null,
        name: policyForm.name.trim(),
        allowed_days: policyForm.allowed_days.join(','),
        allowed_from: policyForm.allowed_from || null,
        allowed_to: policyForm.allowed_to || null,
        is_offpeak_only: Boolean(policyForm.is_offpeak_only),
        enforce_freeze: Boolean(policyForm.enforce_freeze),
        max_daily_visits: Number.parseInt(policyForm.max_daily_visits, 10) || 0,
        is_active: Boolean(policyForm.is_active),
      };

      if (editingPolicyId) {
        await axios.put(`/api/finance/access-policies/${editingPolicyId}`, payload, headers);
        toast?.('Access policy updated.', 'success');
      } else {
        await axios.post('/api/finance/access-policies', payload, headers);
        toast?.('Access policy created.', 'success');
      }

      closePolicyModal();
      fetchAccessPolicies();
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to save access policy.', 'error');
    } finally {
      setPolicySaving(false);
    }
  };

  const deletePolicy = async (policyId) => {
    if (!window.confirm('Delete this access policy?')) return;
    try {
      await axios.delete(`/api/finance/access-policies/${policyId}`, headers);
      toast?.('Access policy deleted.', 'success');
      fetchAccessPolicies();
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to delete policy.', 'error');
    }
  };

  const peakHourLabel = overview.peak_hour_today === null
    ? '—'
    : `${String(overview.peak_hour_today).padStart(2, '0')}:00`;

  const handleCheckinSuccess = useCallback((payload, fallbackMember = null, fallbackMethod = null) => {
    const body = asObject(payload, {});
    const detail = asObject(body.details, {});
    const member = asObject(body.member, fallbackMember || {});
    const methodUsed = detail.checkin_method || fallbackMethod || checkinMethod;

    if (body.warning) {
      toast?.(body.warning, 'warning');
    } else {
      toast?.(body.message || 'Check-in successful!', 'success');
    }

    setWarningState(null);
    setCheckinNote('');

    if (member?.id) {
      setSelectedMember(member);
      setSearchText(member.full_name || '');
      setSearchResults([]);
    }

    if (member?.full_name) {
      setFeed((prev) => [{
        id: detail.id || `opt-${Date.now()}`,
        full_name: member.full_name,
        check_in_time: detail.check_in_time || new Date().toISOString(),
        checkin_method: methodUsed,
        staff_name: detail.staff_name || currentUser?.full_name || currentUser?.name || null,
        was_override: Boolean(detail.was_override),
        branch_id: detail.branch_id || member.branch_id || branchScopeValue || defaultBranchId,
      }, ...prev].slice(0, 25));
    }

    setOverview((prev) => ({
      ...prev,
      today_checkins: (Number(prev.today_checkins) || 0) + 1,
      active_members_today: (Number(prev.active_members_today) || 0) + 1,
    }));

    refreshAttendanceViewsRef.current().catch(() => {});
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'attendance' } }));
  }, [branchScopeValue, checkinMethod, currentUser?.full_name, currentUser?.name, defaultBranchId, toast]);

  const copyText = async (value, successMessage, errorMessage) => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      toast?.(errorMessage || 'Copy is not available on this device.', 'warning');
      return false;
    }

    try {
      await navigator.clipboard.writeText(String(value));
      toast?.(successMessage || 'Copied.', 'success');
      return true;
    } catch (_err) {
      toast?.(errorMessage || 'Could not copy.', 'warning');
      return false;
    }
  };

  const copyQrToken = async () => {
    if (!qrModalState?.token) return;
    copyText(qrModalState.token, 'QR token copied.', 'Could not copy QR token.');
  };

  const readCurrentPosition = () => new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location access is not available on this device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });

  const persistModeSettings = async (
    nextSettings,
    successMessage = 'Attendance mode settings saved.',
    errorMessage = 'Failed to save attendance mode settings.'
  ) => {
    setBusySaveMode(true);
    try {
      await axios.put('/api/attendance/mode', {
        ...nextSettings,
        attendance_mode: nextSettings.attendance_mode || DEFAULT_ATTENDANCE_MODE,
        gym_radius_meters: nextSettings.attendance_geo_enabled
          ? nextSettings.gym_radius_meters || DEFAULT_GYM_RADIUS_METERS
          : DEFAULT_GYM_RADIUS_METERS,
      }, headers);
      toast?.(successMessage, 'success');
      await loadOverviewBundleRef.current();
      return true;
    } catch (_err) {
      toast?.(errorMessage, 'error');
      await loadOverviewBundleRef.current().catch(() => {});
      return false;
    } finally {
      setBusySaveMode(false);
    }
  };

  const handleGeoToggle = async (enabled) => {
    if (!isOwner) {
      toast?.('Only the gym owner can change attendance mode settings.', 'warning');
      return;
    }

    if (!enabled) {
      const nextSettings = {
        ...modeSettings,
        attendance_mode: modeSettings.attendance_mode === 'SELF' ? DEFAULT_ATTENDANCE_MODE : modeSettings.attendance_mode,
        attendance_geo_enabled: false,
        gym_latitude: '',
        gym_longitude: '',
        gym_radius_meters: DEFAULT_GYM_RADIUS_METERS,
      };
      setModeSettings(nextSettings);
      await persistModeSettings(nextSettings, 'App location check-in disabled.', 'Failed to disable app location check-in.');
      return;
    }

    setBusyGeoSync(true);
    setModeSettings((prev) => ({
      ...prev,
      attendance_geo_enabled: true,
    }));

    try {
      const position = await readCurrentPosition();
      const nextSettings = {
        ...modeSettings,
        attendance_mode: modeSettings.attendance_mode || DEFAULT_ATTENDANCE_MODE,
        attendance_geo_enabled: true,
        gym_latitude: Number(position.coords.latitude).toFixed(6),
        gym_longitude: Number(position.coords.longitude).toFixed(6),
        gym_radius_meters: DEFAULT_GYM_RADIUS_METERS,
      };

      setModeSettings(nextSettings);
      await persistModeSettings(nextSettings, 'Gym location captured and saved.', 'Failed to save gym location.');
    } catch (err) {
      setModeSettings((prev) => ({
        ...prev,
        attendance_geo_enabled: false,
        gym_latitude: '',
        gym_longitude: '',
        gym_radius_meters: DEFAULT_GYM_RADIUS_METERS,
      }));

      const permissionDenied = err?.code === 1;
      toast?.(
        permissionDenied
          ? 'Location permission was denied. Allow location access and try again.'
          : err?.message || 'Unable to capture the gym location.',
        'error'
      );
    } finally {
      setBusyGeoSync(false);
    }
  };

  const openMemberQr = async () => {
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyQrAction(true);
    try {
      const res = await axios.get(`/api/attendance/qr/member/${selectedMember.id}`, { ...headers, params: { branch_id: selectedMember.branch_id || branchScopeValue } });
      const payload = asObject(unwrapApiData(res.data), {});
      setQrModalState({
        type: 'member',
        title: 'Member QR Pass',
        subtitle: 'Show this at reception so staff can scan and verify your membership instantly.',
        token: payload.token || '',
        expiresAt: payload.expires_at,
        accent: 'emerald',
        meta: payload.member || selectedMember,
      });
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'Failed to generate member QR.'), 'error');
    } finally {
      setBusyQrAction(false);
    }
  };

  const openGymQr = async () => {
    setBusyQrAction(true);
    try {
      const res = await axios.get('/api/attendance/qr/gym', { ...headers, params: branchQueryParams });
      const payload = asObject(unwrapApiData(res.data), {});
      setQrModalState({
        type: 'gym',
        title: 'Gym Self Check-In QR',
        subtitle: 'Members can scan this from the member portal to check in without reception help.',
        token: payload.token || '',
        expiresAt: payload.expires_at,
        accent: 'indigo',
        meta: payload.gym || {},
      });
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'Failed to generate gym QR.'), 'error');
    } finally {
      setBusyQrAction(false);
    }
  };

  const submitScannedQr = useCallback(async (decodedText) => {
    setBusyQrAction(true);
    try {
      const res = await axios.post('/api/attendance/checkin/qr', {
        token: decodedText,
        notes: checkinNote,
        branch_id: branchScopeValue,
      }, headers);
      handleCheckinSuccess(unwrapApiData(res.data), null, 'QR');
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      if (errorBody.code === 'ATTENDANCE_BLOCKED' || errorBody.code === 'ACCESS_POLICY_BLOCKED') {
        if (errorBody.member?.id) {
          setSelectedMember(errorBody.member);
          setSearchText(errorBody.member.full_name || '');
          setSearchResults([]);
        }
        setWarningState({
          message: errorBody.message || errorBody.error || 'Membership is not active.',
          warning: errorBody.warning || '',
          member: errorBody.member || selectedMember,
        });
      } else {
        toast?.(errorBody.message || errorBody.error || 'QR check-in failed.', 'error');
      }
    } finally {
      setBusyQrAction(false);
    }
  }, [branchScopeValue, checkinNote, headers, handleCheckinSuccess, selectedMember, toast]);

  const loadOverviewBundle = useCallback(async () => {
    const [overviewRes, feedRes, heatmapRes, modeRes] = await Promise.all([
      axios.get('/api/attendance/overview', { ...headers, params: branchQueryParams }),
      axios.get('/api/attendance/feed', { ...headers, params: { ...branchQueryParams, limit: 25 } }),
      axios.get('/api/attendance/heatmap', { ...headers, params: { ...branchQueryParams, days: 84 } }),
      axios.get('/api/attendance/mode', headers),
    ]);

    setOverview(asObject(unwrapApiData(overviewRes.data), {}));
    setFeed(asArray(unwrapApiData(feedRes.data)));
    setHeatmap(asArray(unwrapApiData(heatmapRes.data)));

    const modeData = asObject(unwrapApiData(modeRes.data), {});
    setModeSettings((prev) => ({
      ...prev,
      attendance_mode: modeData.attendance_mode || DEFAULT_ATTENDANCE_MODE,
      attendance_geo_enabled: Boolean(modeData.attendance_geo_enabled),
      gym_latitude: modeData.gym_latitude ?? '',
      gym_longitude: modeData.gym_longitude ?? '',
      gym_radius_meters: modeData.gym_radius_meters || DEFAULT_GYM_RADIUS_METERS,
      allow_expired_checkin: Boolean(modeData.allow_expired_checkin),
    }));
  }, [branchQueryParams, headers]);

  loadOverviewBundleRef.current = loadOverviewBundle;

  const loadPeakHours = useCallback(async (period) => {
    const res = await axios.get('/api/attendance/peak-hours', {
      ...headers,
      params: period === 'today'
        ? { ...branchQueryParams, today: true }
        : { ...branchQueryParams, days: period },
    });
    setPeakHours(
      asArray(unwrapApiData(res.data)).map((item) => ({
        hourLabel: `${String(item.hour).padStart(2, '0')}:00`,
        count: item.count || 0,
      }))
    );
  }, [branchQueryParams, headers]);

  const loadRecords = useCallback(async () => {
    const res = await axios.get('/api/attendance/records', {
      ...headers,
      params: {
        paginate: true,
        page: recordsPagination.page,
        limit: recordsPagination.limit,
        range,
        ...branchQueryParams,
        from: range === 'custom' && fromDate ? fromDate : undefined,
        to: range === 'custom' && toDate ? toDate : undefined,
      },
    });
    setRecords(asArray(unwrapApiData(res.data)));
    setRecordsPagination((prev) => ({
      ...prev,
      ...(res.data?.pagination || {}),
    }));
  }, [branchQueryParams, fromDate, headers, range, recordsPagination.limit, recordsPagination.page, toDate]);

  const loadInactive = useCallback(async (days = inactiveDays) => {
    const requestId = inactiveRequestSeqRef.current + 1;
    inactiveRequestSeqRef.current = requestId;

    const res = await axios.get('/api/attendance/inactive', { ...headers, params: { ...branchQueryParams, days } });
    if (inactiveRequestSeqRef.current !== requestId) {
      return;
    }

    setInactiveMembers(asArray(unwrapApiData(res.data)));
  }, [branchQueryParams, headers, inactiveDays]);

  const loadLeaderboard = useCallback(async () => {
    const res = await axios.get('/api/attendance/leaderboard', { ...headers, params: { ...branchQueryParams, days: 30, limit: 6 } });
    setLeaderboard(asArray(unwrapApiData(res.data)));
  }, [branchQueryParams, headers]);

  const refreshAttendanceViews = useCallback(() => Promise.all([
    loadOverviewBundle(),
    loadPeakHours(peakHoursDaysRef.current),
    loadRecords(),
    loadInactive(inactiveDays),
    loadLeaderboard(),
  ]), [inactiveDays, loadInactive, loadLeaderboard, loadOverviewBundle, loadPeakHours, loadRecords]);

  useEffect(() => {
    refreshAttendanceViewsRef.current = refreshAttendanceViews;
  }, [refreshAttendanceViews]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      await Promise.all([loadOverviewBundle(), loadPeakHours(peakHoursDaysRef.current), loadRecords(), loadLeaderboard()]);
    } catch (_err) {
      toast?.('Failed to load attendance dashboard.', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadLeaderboard, loadOverviewBundle, loadPeakHours, loadRecords, toast, token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!token) return;
    loadPeakHours(peakHoursDays);
  }, [loadPeakHours, peakHoursDays, token]);

  useEffect(() => {
    if (!token) return;
    loadRecords().catch(() => toast?.('Failed to load attendance table.', 'error'));
  }, [loadRecords, recordsPagination.limit, recordsPagination.page, toast, token]);

  useEffect(() => {
    setRecordsPagination((prev) => prev.page === 1 ? prev : { ...prev, page: 1 });
  }, [range, fromDate, toDate]);

  useEffect(() => {
    if (!token) return;
    loadInactive(inactiveDays).catch(() => toast?.('Failed to load inactive members.', 'error'));
  }, [inactiveDays, loadInactive, toast, token]);

  useEffect(() => {
    if (!qrScannerOpen) return undefined;

    let cancelled = false;
    let scanner = null;

    const stopScanner = async () => {
      const activeScanner = scanner || qrScannerRef.current;
      qrScannerRef.current = null;
      if (!activeScanner) return;
      try {
        await activeScanner.stop();
      } catch (_err) {
        // ignore stop errors during teardown
      }
      try {
        await activeScanner.clear();
      } catch (_err) {
        // ignore clear errors during teardown
      }
    };

    const bootScanner = async () => {
      setQrScannerBooting(true);
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode('attendance-staff-qr-reader');
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
          async (decodedText) => {
            if (qrScannerBusyRef.current) return;
            qrScannerBusyRef.current = true;
            await stopScanner();
            if (!cancelled) {
              setQrScannerBooting(false);
              setQrScannerOpen(false);
            }
            await submitScannedQr(decodedText);
            qrScannerBusyRef.current = false;
          },
          () => {}
        );

        if (!cancelled) {
          setQrScannerBooting(false);
        }
      } catch (_err) {
        await stopScanner();
        if (!cancelled) {
          setQrScannerBooting(false);
          setQrScannerOpen(false);
          toast?.('Unable to start QR scanner. Check camera permission and try again.', 'error');
        }
      }
    };

    bootScanner();

    return () => {
      cancelled = true;
      qrScannerBusyRef.current = false;
      setQrScannerBooting(false);
      stopScanner();
    };
  }, [qrScannerOpen, submitScannedQr, toast, token]);

  useEffect(() => {
    if (!token) return;
    const q = searchText.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await axios.get('/api/attendance/search', { ...headers, params: { ...branchQueryParams, q } });
        setSearchResults(asArray(unwrapApiData(res.data)));
      } catch (_err) {
        setSearchResults([]);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [branchQueryParams, headers, searchText, token]);

  const saveModeSettings = async () => {
    if (!isOwner) {
      toast?.('Only the gym owner can change attendance mode settings.', 'warning');
      return;
    }

    if (modeSettings.attendance_mode === 'SELF' && !modeSettings.attendance_geo_enabled) {
      toast?.('Enable app location check-in before saving Self Check-In mode.', 'warning');
      return;
    }

    await persistModeSettings(modeSettings);
  };

  const submitCheckin = async (allowOverride = false) => {
    if (!canWriteAttendance) {
      toast?.('You do not have permission to check members in.', 'warning');
      return;
    }

    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyCheckin(true);
    try {
      const checkinPayload = {
        member_id: selectedMember.id,
        method: 'STAFF',
        notes: checkinNote,
        allow_override: allowOverride,
        branch_id: selectedMember.branch_id || branchScopeValue,
      };

      const res = await axios.post('/api/attendance/checkin', checkinPayload, headers);
      handleCheckinSuccess(unwrapApiData(res.data), selectedMember, 'STAFF');
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      const code = errorBody.code;
      if (code === 'ATTENDANCE_BLOCKED' || code === 'ACCESS_POLICY_BLOCKED') {
        setWarningState({
          message: errorBody.message || errorBody.error || 'Membership is not active.',
          warning: errorBody.warning || '',
          member: errorBody.member || selectedMember,
        });
      } else {
        toast?.(errorBody.message || errorBody.error || 'Check-in failed.', 'error');
      }
    } finally {
      setBusyCheckin(false);
    }
  };

  const sendReminder = async (member) => {
    if (!member?.id) {
      toast?.('Member details are incomplete for this reminder.', 'warning');
      return;
    }

    try {
      setReminderLoadingId(member.id);
      const previewPayload = await previewWhatsAppReminders({
        token,
        memberIds: [member.id],
        templateKey: 'INACTIVE',
      });
      const previewDialog = buildReminderPreviewDialog(previewPayload);

      if (!previewDialog) {
        toast?.(getReminderPreviewBlockReason(previewPayload) || 'No reminder can be sent for this member.', 'warning');
        return;
      }

      const runSend = async () => {
        try {
          setReminderLoadingId(member.id);
          const payload = await sendWhatsAppReminders({
            token,
            memberIds: [member.id],
            templateKey: 'INACTIVE',
          });
          const summary = summarizeReminderResult(payload, 'Reminder');
          toast?.(summary.message, summary.tone);
        } catch (err) {
          const payload = asObject(err?.response?.data, {});
          toast?.(payload.message || payload.error || 'Failed to queue WhatsApp reminder.', 'error');
        } finally {
          setReminderLoadingId(null);
        }
      };

      if (showConfirm) {
        showConfirm({
          title: previewDialog.title,
          message: previewDialog.message,
          confirmLabel: previewDialog.confirmLabel,
          variant: 'warning',
          panelClassName: 'max-w-2xl',
          messageClassName: 'text-left text-slate-600',
          onConfirm: runSend,
        });
        return;
      }

      if (window.confirm(previewDialog.message)) {
        await runSend();
      }
    } catch (err) {
      const payload = asObject(err?.response?.data, {});
      toast?.(payload.message || payload.error || 'Failed to prepare WhatsApp reminder preview.', 'error');
    } finally {
      setReminderLoadingId(null);
    }
  };

  const weekdayPerformance = useMemo(() => {
    const totals = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, dayIndex) => ({
      label,
      dayIndex,
      total: 0,
      days: 0,
    }));

    heatmap.forEach((entry) => {
      const date = new Date(entry.date);
      if (Number.isNaN(date.getTime())) return;
      const bucket = totals[date.getDay()];
      bucket.total += Number(entry.count || 0);
      bucket.days += 1;
    });

    const enriched = totals.map((item) => ({
      ...item,
      avg: item.days > 0 ? Math.round((item.total / item.days) * 10) / 10 : 0,
    }));
    const maxTotal = Math.max(...enriched.map((item) => item.total), 0);

    return enriched
      .map((item) => ({
        ...item,
        width: maxTotal > 0 ? Math.round((item.total / maxTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [heatmap]);

  const hasPeakHoursData = peakHours.some((item) => Number(item.count || 0) > 0);
  const hasWeekdayPerformance = weekdayPerformance.some((item) => Number(item.total || 0) > 0);

  // Count-up animated values for stat cards (must be before any conditional return)
  const animatedTodayCheckins      = useCountUp(overview.today_checkins || 0);
  const animatedYesterdayCheckins  = useCountUp(overview.yesterday_checkins || 0);
  const animatedActiveMembersToday = useCountUp(overview.active_members_today || 0);
  const animatedPeakHourCount      = useCountUp(overview.peak_hour_count || 0);

  if (loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <div className="space-y-5 p-2">
      <div className="flex justify-end">
        <OperationsBranchScopeBar
          branchDirectory={branchDirectory}
          branchId={operationsBranchId}
          onChange={appRuntime.setOperationsBranchId}
          currentUser={currentUser}
          loading={appRuntime.branchScopeLoading}
          title="Attendance scope"
          description="Filter search, check-ins, live feed, and retention views by branch without leaving the page."
          className="ml-auto w-full max-w-[11rem] sm:max-w-none sm:w-auto shrink-0"
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Today's Check-ins</p>
          <h3 className="text-3xl font-black text-slate-900 mt-1">{animatedTodayCheckins}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Yesterday</p>
          <h3 className="text-3xl font-black text-slate-900 mt-1">{animatedYesterdayCheckins}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Members Today</p>
          <h3 className="text-3xl font-black text-emerald-600 mt-1">{animatedActiveMembersToday}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Peak Hour Today</p>
          <h3 className="text-3xl font-black text-indigo-600 mt-1">{peakHourLabel}</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">{animatedPeakHourCount} check-ins</p>
        </div>
      </div>

      {/* ── Attendance Hub Tab Bar ── */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-0.5 w-fit">
        <button onClick={() => setAttendanceTab('checkin')} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${attendanceTab === 'checkin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Check-in Ops</button>
        {isOwner && <button onClick={() => setAttendanceTab('policies')} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${attendanceTab === 'policies' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Access Policies</button>}
        {isOwner && <button onClick={() => setAttendanceTab('health')} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${attendanceTab === 'health' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Reader Health</button>}
      </div>

      {/* ═══════ CHECK-IN OPS TAB ═══════ */}
      {attendanceTab === 'checkin' && (<>

      <div ref={checkinOpsRef} className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-indigo-500" />
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Attendance Mode</h3>
        </div>
        <div className="grid grid-cols-1 desktop:grid-cols-2 xl:grid-cols-4 gap-3">
          {Object.entries(MODE_META).map(([key, item]) => {
            const Icon = item.icon;
            const active = key === modeSettings.attendance_mode;
            return (
              <button
                key={key}
                type="button"
                disabled={!isOwner}
                onClick={() => setModeSettings((prev) => ({ ...prev, attendance_mode: key }))}
                className={`text-left p-4 rounded-2xl border transition-all ${active ? 'border-indigo-400 bg-indigo-50/70 shadow-sm' : 'border-slate-200 bg-white'} ${isOwner ? 'hover:border-slate-300 hover:-translate-y-0.5' : 'cursor-default opacity-90'}`}
              >
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.color} text-white flex items-center justify-center mb-3`}>
                  <Icon size={17} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-slate-900">{item.label}</p>
                  {active && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">Active</span>}
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">{item.desc}</p>
                {key === 'SELF' && !modeSettings.attendance_geo_enabled && (
                  <p className="mt-2 text-[11px] font-semibold text-amber-600">Requires app location check-in to be enabled.</p>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs font-semibold text-slate-500">
          Choose the primary attendance workflow. Manual desk check-in, QR tools, and RFID operations stay available across the hub.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white">
            <span className="text-sm font-bold text-slate-700">Allow expired/unpaid override</span>
            <input
              type="checkbox"
              checked={modeSettings.allow_expired_checkin}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, allow_expired_checkin: e.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white">
            <span className="text-sm font-bold text-slate-700">Enable app location check-in</span>
            <input
              type="checkbox"
              checked={modeSettings.attendance_geo_enabled}
              disabled={!isOwner || busyGeoSync}
              onChange={(e) => handleGeoToggle(e.target.checked)}
            />
          </label>
        </div>

        <div className="mt-4">
          {!isOwner && <p className="mb-2 text-xs font-semibold text-slate-500">Attendance mode settings are view-only for staff accounts.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={saveModeSettings}
              disabled={busySaveMode || busyGeoSync || !isOwner}
              className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-60"
            >
              {busyGeoSync ? 'Capturing location...' : busySaveMode ? 'Saving...' : 'Save Mode Settings'}
            </button>
            {modeSettings.attendance_mode === 'RFID' && isOwner && (
              <button
                onClick={() => onOpenRfidSetup?.()}
                className="px-5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-black hover:bg-rose-100 active:scale-95 transition-all"
              >
                Open RFID Setup
              </button>
            )}
          </div>
          {modeSettings.attendance_mode === 'RFID' && (
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Reader registration, card pairing, and bridge provisioning are managed on the separate RFID Setup page.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-3">Quick Check-In Panel</h3>

          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search member name / phone"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            />
          </div>

          {searchResults.length > 0 && (
            <div className="mb-3 border border-slate-200 rounded-xl max-h-44 overflow-y-auto">
              {searchResults.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedMember(m);
                    setSearchText(m.full_name);
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <p className="text-sm font-bold text-slate-900">{m.full_name}</p>
                  <p className="text-xs text-slate-500 font-medium">{m.phone} · {m.plan_name || 'No plan'}{showBranchMeta ? ` · ${getAttendanceBranchLabel(m)}` : ''}</p>
                </button>
              ))}
            </div>
          )}

          <div className="mb-3">
            <label className="text-xs font-bold text-slate-500">Method</label>
            <div className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-900">
              Staff
            </div>
          </div>

          <textarea
            value={checkinNote}
            onChange={(e) => setCheckinNote(e.target.value)}
            rows={2}
            placeholder="Optional note"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold resize-none"
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={openGymQr}
              disabled={busyQrAction || !canWriteAttendance}
              className="px-3 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-black hover:bg-indigo-100 disabled:opacity-60 transition-all active:scale-95"
            >
              {busyQrAction && qrModalState?.type === 'gym' ? 'Loading...' : 'Show Gym QR'}
            </button>
            <button
              type="button"
              onClick={() => {
                setQrScannerOpen(true);
              }}
              disabled={busyQrAction || !canWriteAttendance}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 disabled:opacity-60 transition-all active:scale-95"
            >
              Scan Member QR
            </button>
          </div>

          <p className="mt-2 text-[11px] font-semibold text-slate-500">
            Staff can scan a member QR here. Members can also self check-in by scanning the gym QR from the member portal.
          </p>

          <div className="mt-4">
            <button
              onClick={() => submitCheckin(false)}
              disabled={!selectedMember || busyCheckin || busyQrAction || !canWriteAttendance}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-black disabled:opacity-60"
            >
              {busyCheckin ? 'Checking in...' : 'Check In Member'}
            </button>
          </div>

          {selectedMember && (
            <div className="mt-4 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
              <p className="text-sm font-black text-slate-900 mb-2">Member Snapshot</p>
              <div className="space-y-1.5 text-xs font-semibold text-slate-600">
                <p><span className="text-slate-400">Name:</span> {selectedMember.full_name}</p>
                <p><span className="text-slate-400">Plan:</span> {selectedMember.plan_name || 'No active plan'}</p>
                {showBranchMeta ? <p><span className="text-slate-400">Branch:</span> {getAttendanceBranchLabel(selectedMember)}</p> : null}
                <p><span className="text-slate-400">Status:</span> <span className={`px-1.5 py-0.5 rounded-full ml-1 ${statusBadge(selectedMember.membership_status)}`}>{selectedMember.membership_status || 'UNPAID'}</span></p>
                <p><span className="text-slate-400">Last Visit:</span> {selectedMember.last_visit ? formatDateTime(selectedMember.last_visit) : 'Never'}</p>
              </div>
            </div>
          )}
        </div>

        <div ref={liveFeedRef} className="xl:col-span-2 bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Live Feed + Records</h3>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setFeedView('live')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-wider transition ${feedView === 'live' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Live
                </button>
                <button
                  onClick={() => setFeedView('records')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-wider transition ${feedView === 'records' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Records
                </button>
              </div>
              <button
                onClick={async () => {
                  await Promise.all([loadOverviewBundle(), loadRecords()]);
                }}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
              >
                Refresh
              </button>
            </div>
          </div>

          {feedView === 'live' ? (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">No live check-ins yet.</div>
              ) : (
                feed.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between border border-slate-100 rounded-xl p-3 bg-white">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{entry.full_name}</p>
                      <p className="text-xs font-medium text-slate-500">{formatDateTime(entry.check_in_time)} {entry.staff_name ? `· Staff: ${entry.staff_name}` : ''}{showBranchMeta ? ` · ${getAttendanceBranchLabel(entry)}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-black ${methodBadge(entry.checkin_method)}`}>{entry.checkin_method}</span>
                      {entry.was_override ? <span className="px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">OVERRIDE</span> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 justify-end mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={range} onChange={(e) => setRange(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold">
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="custom">Date Range</option>
                  </select>
                  {range === 'custom' && (
                    <>
                      <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                      <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="py-3 px-2">Member</th>
                      <th className="py-3 px-2">Check-In Time</th>
                      <th className="py-3 px-2">Plan</th>
                      <th className="py-3 px-2">Status</th>
                      <th className="py-3 px-2">Method</th>
                      <th className="py-3 px-2">Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-bold">No records found for selected range.</td>
                      </tr>
                    ) : (
                      records.map((row) => (
                        <tr key={row.id} className="border-b border-slate-50">
                          <td className="py-3 px-2 font-bold text-slate-900">{row.member_name}{showBranchMeta ? <div className="text-[11px] font-semibold text-slate-400 mt-1">{getAttendanceBranchLabel(row)}</div> : null}</td>
                          <td className="py-3 px-2 font-semibold text-slate-600">{formatDateTime(row.check_in_time)}</td>
                          <td className="py-3 px-2 font-semibold text-slate-700">{row.plan_name || '—'}</td>
                          <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-[10px] font-black ${statusBadge(row.membership_status)}`}>{row.membership_status || 'UNPAID'}</span></td>
                          <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-[10px] font-black ${methodBadge(row.checkin_method)}`}>{row.checkin_method}</span></td>
                          <td className="py-3 px-2 font-semibold text-slate-600">{row.staff_name || 'System'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {recordsPagination.totalPages > 1 && (
                <div className="pt-4">
                  <PaginationControls
                    pagination={recordsPagination}
                    itemLabel="records"
                    onPageChange={(nextPage) => setRecordsPagination((prev) => ({ ...prev, page: nextPage }))}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Activity size={16} className="text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                Peak Hour Analysis ({peakHoursDays === 'today' ? 'Today' : peakHoursDays === 7 ? '7D' : '30D'})
              </h3>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">Hourly traffic and full weekday rankings stay accessible on every screen.</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg shrink-0">
            {[['today', 'Today'], [7, '7D'], [30, '30D']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPeakHoursDays(val)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all ${peakHoursDays === val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px] gap-4">
          <div className="min-w-0 h-[240px] sm:h-[280px] xl:h-[260px]">
            {hasPeakHoursData ? (
              <SafeResponsiveContainer
                isActive={isActive}
                fallback={<div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />}
              >
                  <BarChart data={peakHours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ff" />
                    <XAxis dataKey="hourLabel" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[5, 5, 0, 0]} />
                  </BarChart>
              </SafeResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-center text-sm font-bold text-slate-400">
                No attendance traffic recorded for this period.
              </div>
            )}
          </div>
          {hasWeekdayPerformance ? (
            <>
              <div className="xl:hidden -mx-1 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-3 px-1">
                  {weekdayPerformance.map((item, index) => (
                    <div key={item.label} className="w-[148px] rounded-2xl border border-slate-100 bg-white p-3 shrink-0">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{index + 1} day</p>
                          <p className="text-sm font-black text-slate-900 truncate">{item.label}</p>
                        </div>
                        <p className="text-base font-black text-indigo-600 shrink-0">{item.total}</p>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${item.width}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden xl:flex xl:flex-col xl:gap-2.5 xl:max-h-[260px] xl:overflow-y-auto xl:pr-1">
                {weekdayPerformance.map((item, index) => (
                  <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{index + 1} day</p>
                        <p className="text-sm font-black text-slate-900 truncate">{item.label}</p>
                      </div>
                      <p className="text-sm font-black text-indigo-600 shrink-0">{item.total}</p>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${item.width}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">
              No weekday attendance trend is available yet.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Inactive Members (Retention Risk)</h3>
          <div className="flex items-center gap-2">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setInactiveDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${inactiveDays === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[24rem] overflow-y-auto overscroll-contain lg:max-h-none lg:overflow-y-visible no-scrollbar grid grid-cols-1 lg:grid-cols-2 gap-3">
          {inactiveMembers.length === 0 ? (
            <div className="col-span-full py-8 text-center text-slate-400 font-bold">No inactive active-members in this range.</div>
          ) : (
            inactiveMembers.map((m) => (
              <div key={m.id} className="p-3 rounded-xl border border-slate-100 bg-white flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{m.full_name}</p>
                  <p className="text-xs text-slate-500 font-medium truncate">{m.plan_name || 'No plan'} · {m.days_inactive} days inactive{showBranchMeta ? ` · ${getAttendanceBranchLabel(m)}` : ''}</p>
                </div>
                <button
                  onClick={() => sendReminder(m)}
                  disabled={reminderLoadingId === m.id}
                  className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black hover:bg-emerald-100 flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {reminderLoadingId === m.id ? <RefreshCw size={12} className="animate-spin" /> : <MessageSquare size={12} />} Remind
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-4">Engagement Leaderboard (30D)</h3>
        {leaderboard.length === 0 ? (
          <div className="py-6 text-center text-slate-400 font-bold text-sm">No leaderboard data yet.</div>
        ) : (
          <div className="space-y-2.5">
            {leaderboard.map((item, idx) => {
              const topVisits = Number(leaderboard[0]?.visits || 0);
              const itemVisits = Number(item.visits || 0);
              const widthPercent = topVisits > 0 ? Math.max(8, Math.round((itemVisits / topVisits) * 100)) : 8;

              return (
                <div key={item.id} className="p-3 rounded-xl border border-slate-100 bg-white gv-fade-up" style={{ animationDelay: `${Math.min(idx * 0.04, 0.25)}s` }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 text-xs font-black flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{item.full_name}</p>
                        <p className="text-xs text-slate-500 font-semibold">Last visit: {formatDateTime(item.last_check_in)}{showBranchMeta ? ` · ${getAttendanceBranchLabel(item)}` : ''}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-black text-indigo-600 leading-none">{itemVisits}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-1">visits</p>
                    </div>
                  </div>

                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${widthPercent}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      </>)}

      {/* ═══════ ACCESS POLICIES TAB ═══════ */}
      {attendanceTab === 'policies' && isOwner && (
        <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Access Policies</h3>
              <p className="text-xs text-slate-400 mt-0.5">Define plan-level days, windows, and visit caps that the live check-in engine actually enforces.</p>
            </div>
            <button onClick={openNewPolicyModal} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 transition-all">
              Add Policy
            </button>
          </div>
          {policiesLoading ? (
            <div className="text-center py-8 text-slate-400">Loading...</div>
          ) : accessPolicies.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No access policies configured</p>
              <p className="text-sm mt-1">Create your first policy to restrict plan timings, freeze access, or daily visit limits.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {accessPolicies.map(p => (
                <div key={p.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">{p.name}</p>
                        {p.plan_name && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-700">{p.plan_name}</span>}
                        {p.is_offpeak_only && <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">Off-Peak</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{String(p.allowed_from || '00:00').slice(0, 5)} - {String(p.allowed_to || '23:59').slice(0, 5)} · {p.allowed_days || 'All days'}</p>
                      <p className="text-xs text-slate-500 mt-2">{Number(p.max_daily_visits || 0) > 0 ? `Max ${p.max_daily_visits} visit(s) per day` : 'Unlimited daily visits'} · {p.enforce_freeze ? 'Freeze enforced' : 'Freeze can be overridden'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEditPolicyModal(p)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-100 transition-all">Edit</button>
                        <button onClick={() => deletePolicy(p.id)} className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-100 text-[11px] font-black uppercase tracking-wide text-rose-600 hover:bg-rose-100 transition-all">Delete</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ READER HEALTH TAB ═══════ */}
      {attendanceTab === 'health' && isOwner && (
        <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Reader Health & Diagnostics</h3>
            <p className="text-xs text-slate-400 mt-0.5">RFID reader status, unknown tags, and system diagnostics</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100 text-center">
              <p className="text-2xl font-black text-emerald-700">●</p>
              <p className="text-xs font-bold text-emerald-600 mt-1">Reader Online</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-center">
              <p className="text-2xl font-black text-slate-700">{overview.today_checkins || 0}</p>
              <p className="text-xs font-bold text-slate-500 mt-1">Scans Today</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 text-center">
              <p className="text-2xl font-black text-amber-700">0</p>
              <p className="text-xs font-bold text-amber-600 mt-1">Unknown Tags</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 text-center">
              <p className="text-2xl font-black text-blue-700">—</p>
              <p className="text-xs font-bold text-blue-600 mt-1">Last Heartbeat</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-sm text-slate-500">Reader diagnostics will update in real-time when an RFID reader is connected.</p>
            {onOpenRfidSetup && (
              <button onClick={onOpenRfidSetup} className="mt-3 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700">Open RFID Setup</button>
            )}
          </div>
        </div>
      )}

      {showPolicyModal && (
        <div className="app-modal-shell z-[205] bg-slate-900/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={editingPolicyId ? 'Edit access policy' : 'Create access policy'} className="app-modal-panel bg-white rounded-[28px] w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)' }}>
              <div>
                <h2 className="text-lg font-black">{editingPolicyId ? 'Edit Access Policy' : 'Create Access Policy'}</h2>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mt-1">Rule engine for member entry</p>
              </div>
              <button type="button" aria-label="Close access policy form" onClick={closePolicyModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <form onSubmit={savePolicy} className="app-modal-scroll p-6 space-y-5">
              <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Policy Name</label>
                  <input type="text" required value={policyForm.name} onChange={(event) => setPolicyForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Morning Access" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Plan</label>
                  <select value={policyForm.plan_id} onChange={(event) => setPolicyForm((prev) => ({ ...prev, plan_id: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                    <option value="">All plans</option>
                    {planOptions.map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2 ml-0.5">Allowed Days</label>
                <div role="group" aria-label="Allowed days" className="flex flex-wrap gap-2">
                  {POLICY_DAY_OPTIONS.map((option) => {
                    const active = policyForm.allowed_days.includes(option.value);
                    return (
                      <button key={option.value} type="button" aria-pressed={active} onClick={() => togglePolicyDay(option.value)} className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1 ${active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 desktop:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Allowed From</label>
                  <input type="time" value={policyForm.allowed_from} onChange={(event) => setPolicyForm((prev) => ({ ...prev, allowed_from: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Allowed To</label>
                  <input type="time" value={policyForm.allowed_to} onChange={(event) => setPolicyForm((prev) => ({ ...prev, allowed_to: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Max Daily Visits</label>
                  <input type="number" min="0" value={policyForm.max_daily_visits} onChange={(event) => setPolicyForm((prev) => ({ ...prev, max_daily_visits: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="0 = unlimited" />
                </div>
              </div>

              <div className="grid grid-cols-1 desktop:grid-cols-3 gap-3">
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <span className="text-sm font-bold text-slate-700">Off-peak only</span>
                  <input type="checkbox" checked={policyForm.is_offpeak_only} onChange={(event) => setPolicyForm((prev) => ({ ...prev, is_offpeak_only: event.target.checked }))} />
                </label>
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <span className="text-sm font-bold text-slate-700">Enforce freeze</span>
                  <input type="checkbox" checked={policyForm.enforce_freeze} onChange={(event) => setPolicyForm((prev) => ({ ...prev, enforce_freeze: event.target.checked }))} />
                </label>
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <span className="text-sm font-bold text-slate-700">Policy active</span>
                  <input type="checkbox" checked={policyForm.is_active} onChange={(event) => setPolicyForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" disabled={policySaving} className="flex-1 py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)', boxShadow: '0 4px 16px rgba(37,99,235,0.28)' }}>
                  {policySaving ? 'Saving...' : editingPolicyId ? 'Save Policy Changes' : 'Create Policy'}
                </button>
                <button type="button" onClick={closePolicyModal} className="sm:w-auto py-3 px-5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {warningState && (
        <div className="app-modal-shell z-[220] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[24px] max-w-md w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertTriangle size={18} />
              <p className="font-black">Membership Warning</p>
            </div>
            <p className="text-sm font-semibold text-slate-700">{warningState.message}</p>
            {warningState.warning ? <p className="text-xs text-slate-500 mt-2">{warningState.warning}</p> : null}

            <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600">
              <p><span className="text-slate-400">Member:</span> {warningState.member?.full_name}</p>
              <p><span className="text-slate-400">Status:</span> {warningState.member?.membership_status || 'UNPAID'}</p>
              <p><span className="text-slate-400">Plan:</span> {warningState.member?.plan_name || 'No plan'}</p>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setWarningState(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitCheckin(true)}
                disabled={!canWriteAttendance}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-black hover:bg-amber-600"
              >
                Override Check-In
              </button>
            </div>
          </div>
        </div>
      )}

      {qrModalState && (
        <div className="app-modal-shell z-[220] bg-slate-900/70 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Attendance QR" className="app-modal-panel bg-white rounded-[28px] max-w-md w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Attendance QR</p>
                <h3 className="text-xl font-black text-slate-900 mt-1">{qrModalState.title}</h3>
                <p className="text-sm font-semibold text-slate-500 mt-1">{qrModalState.subtitle}</p>
              </div>
              <button
                type="button"
                aria-label="Close attendance QR"
                onClick={() => setQrModalState(null)}
                className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className={`mt-5 rounded-[24px] border p-4 ${qrModalState.accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/80' : 'border-indigo-200 bg-indigo-50/80'}`}>
              <div className="rounded-[20px] bg-white p-4 border border-white/80 flex items-center justify-center">
                <QRCodeCanvas value={qrModalState.token || 'gymvault'} size={220} includeMargin level="H" />
              </div>
              <div className="mt-4 space-y-1.5 text-xs font-semibold text-slate-600">
                {qrModalState.type === 'member' ? (
                  <>
                    <p><span className="text-slate-400">Member:</span> {qrModalState.meta?.full_name || 'Member'}</p>
                    <p><span className="text-slate-400">Plan:</span> {qrModalState.meta?.plan_name || 'No active plan'}</p>
                    <p><span className="text-slate-400">Membership:</span> {qrModalState.meta?.membership_status || 'UNPAID'}</p>
                  </>
                ) : (
                  <>
                    <p><span className="text-slate-400">Gym:</span> {qrModalState.meta?.name || 'Your gym'}</p>
                    <p><span className="text-slate-400">Use:</span> Member app self check-in</p>
                    <p><span className="text-slate-400">Gate rule:</span> Expired or unpaid members are still blocked by backend validation.</p>
                  </>
                )}
                <p><span className="text-slate-400">Expires:</span> {formatDateTime(qrModalState.expiresAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => {
                  if (qrModalState.type === 'member') {
                    openMemberQr();
                  } else {
                    openGymQr();
                  }
                }}
                disabled={busyQrAction}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-black hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                onClick={copyQrToken}
                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <Copy size={14} /> Copy Token
              </button>
            </div>
          </div>
        </div>
      )}

      {qrScannerOpen && (
        <div className="app-modal-shell z-[220] bg-slate-900/70 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Scan member QR" className="app-modal-panel bg-white rounded-[28px] max-w-lg w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Reception Scan</p>
                <h3 className="text-xl font-black text-slate-900 mt-1">Scan Member QR</h3>
                <p className="text-sm font-semibold text-slate-500 mt-1">Open the member portal QR on the customer phone and point the camera here.</p>
              </div>
              <button
                type="button"
                aria-label="Close QR scanner"
                onClick={() => setQrScannerOpen(false)}
                className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div id="attendance-staff-qr-reader" className="overflow-hidden rounded-[18px] bg-black min-h-[320px]" />
            </div>

            <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <ScanLine size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">What happens after scan?</p>
                <p className="text-xs font-semibold text-slate-600 mt-1">The backend validates membership, duplicate timing, and override rules before recording attendance. Expired and unpaid members are still blocked unless override is explicitly allowed.</p>
              </div>
            </div>

            {qrScannerBooting ? (
              <p className="mt-3 text-xs font-bold text-slate-500">Starting camera...</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default AttendancePage;
