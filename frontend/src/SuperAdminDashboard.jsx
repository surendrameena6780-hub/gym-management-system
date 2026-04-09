import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { reportClientError } from './utils/clientErrorReporter';
import {
  Building2,
  Users,
  CreditCard,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  LogOut,
  Activity,
  Search,
  Ban,
  PauseCircle,
  Trash2,
  Eye,
  Edit3,
  UserCog,
  Ticket,
  BarChart3,
  Settings,
  ClipboardList,
  AlertTriangle,
  Send,
  KeyRound,
  RefreshCw,
  Bell,
} from 'lucide-react';
import PaginationControls from './components/PaginationControls';
import {
  BILLING_ADDON_ORDER,
  BILLING_PLAN_ORDER,
  normalizeBillingCatalog as normalizeFrontendBillingCatalog,
} from './utils/billingCatalog';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'support', label: 'Support', icon: Ticket },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'system', label: 'System', icon: Settings },
  { id: 'logs', label: 'Logs', icon: ClipboardList },
  { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
];

const statusClass = (status) => {
  const value = String(status || '').toUpperCase();
  if (value === 'ACTIVE') return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
  if (value === 'BLOCKED') return 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
  return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
};

const DEFAULT_AUTOMATION_SETTINGS = {
  owner_staff_enabled: true,
  member_push_enabled: true,
  owner_staff_slots: {
    MORNING: true,
    AFTERNOON: true,
    EVENING: true,
  },
  member_slots: {
    MORNING: true,
    AFTERNOON: false,
    EVENING: true,
  },
  owner_staff_daily_limit: 3,
  member_daily_limit: 50,
  member_max_per_slot: 25,
  message_templates: {
    SETUP_FOCUS: {
      title: 'Your next move is obvious',
      body: '{{setup_hint}}',
    },
    LEAD_SPRINT: {
      title: 'Lead queue is warm',
      body: '{{count}} follow-up {{lead_label}} {{are_is}} ready today. A quick callback sprint before the day gets noisy can turn curiosity into walk-ins.',
    },
    RENEWAL_RADAR: {
      title: 'Renewals are within reach',
      body: '{{count}} {{membership_label}} {{enter_label}} the final 3-day window today. One crisp follow-up can lock revenue before the day slips away.',
    },
    RENEWAL_WEEK: {
      title: 'Renewal week just opened',
      body: '{{count}} {{member_label}} {{are_is}} now inside renewal week. Get ahead of the rush and make the rejoin decision feel easy.',
    },
    ATTENDANCE_PULSE: {
      title: 'The floor could use a lift',
      body: '{{today_checkins}} check-ins so far against a {{avg_daily}}/day recent rhythm. One story, one class ping, or one comeback call can still lift the evening rush.',
    },
    COLLECTIONS_PUSH: {
      title: 'Collections are still on the table',
      body: '{{due_amount}} is still waiting across {{due_members}} {{account_label}}. Tonight is a clean window to recover dues while intent is still warm.',
    },
    WINBACK_LIST: {
      title: 'Your comeback list is ready',
      body: '{{count}} {{member_label}} {{have_has}} been quiet for 10+ days. A smart nudge tonight can wake up stalled routines before they go cold.',
    },
    MEMBER_RENEWAL: {
      title: 'Your plan is almost out of reps',
      body: '{{first_name}}, {{gym_name}} access wraps in {{days_left}} {{day_label}}. Renew today and keep your streak moving, not paused.',
    },
    MEMBER_DUE: {
      title: 'A quick clear-up keeps you moving',
      body: '{{first_name}}, {{amount_due}} is still pending on your plan. Clear it today and keep your next entry smooth.',
    },
    MEMBER_COMEBACK: {
      title: 'Your spot is still warm',
      body: '{{first_name}}, it has been {{days_inactive}} days since your last workout. One session today can flip the whole week back in your favour.',
    },
  },
};

const SLOT_LABELS = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

const AUTOMATION_TEMPLATE_FIELDS = [
  { key: 'SETUP_FOCUS', label: 'Setup Reminder', audience: 'Owner / Staff', placeholders: '{{setup_hint}}' },
  { key: 'LEAD_SPRINT', label: 'Lead Follow-Up', audience: 'Owner / Staff', placeholders: '{{count}}, {{lead_label}}, {{are_is}}' },
  { key: 'RENEWAL_RADAR', label: '3-Day Renewals', audience: 'Owner / Staff', placeholders: '{{count}}, {{membership_label}}, {{enter_label}}' },
  { key: 'RENEWAL_WEEK', label: '7-Day Renewals', audience: 'Owner / Staff', placeholders: '{{count}}, {{member_label}}, {{are_is}}' },
  { key: 'ATTENDANCE_PULSE', label: 'Attendance Push', audience: 'Owner / Staff', placeholders: '{{today_checkins}}, {{avg_daily}}' },
  { key: 'COLLECTIONS_PUSH', label: 'Collections Push', audience: 'Owner / Staff', placeholders: '{{due_amount}}, {{due_members}}, {{account_label}}' },
  { key: 'WINBACK_LIST', label: 'Comeback Push', audience: 'Owner / Staff', placeholders: '{{count}}, {{member_label}}, {{have_has}}' },
  { key: 'MEMBER_RENEWAL', label: 'Member Renewal Push', audience: 'Member', placeholders: '{{first_name}}, {{gym_name}}, {{days_left}}, {{day_label}}' },
  { key: 'MEMBER_DUE', label: 'Member Due Push', audience: 'Member', placeholders: '{{first_name}}, {{amount_due}}' },
  { key: 'MEMBER_COMEBACK', label: 'Member Comeback Push', audience: 'Member', placeholders: '{{first_name}}, {{days_inactive}}' },
];

const BILLING_LIMIT_FIELDS = [
  { key: 'members', label: 'Members' },
  { key: 'staff', label: 'Staff Users' },
  { key: 'branches', label: 'Branches' },
  { key: 'whatsapp', label: 'WhatsApp / Month' },
  { key: 'hello', label: 'Hello Numbers' },
  { key: 'storage', label: 'Storage GB' },
];

const BILLING_PLAN_TINTS = {
  test: 'border-amber-500/20 bg-amber-500/10',
  basic: 'border-sky-500/20 bg-sky-500/10',
  growth: 'border-indigo-500/20 bg-indigo-500/10',
  pro: 'border-rose-500/20 bg-rose-500/10',
};

const mergeAutomationSettings = (value) => {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...raw,
    owner_staff_slots: {
      ...DEFAULT_AUTOMATION_SETTINGS.owner_staff_slots,
      ...(raw.owner_staff_slots || {}),
    },
    member_slots: {
      ...DEFAULT_AUTOMATION_SETTINGS.member_slots,
      ...(raw.member_slots || {}),
    },
    owner_staff_daily_limit: Math.min(3, Math.max(1, Number(raw.owner_staff_daily_limit) || DEFAULT_AUTOMATION_SETTINGS.owner_staff_daily_limit)),
    member_daily_limit: Math.min(500, Math.max(1, Number(raw.member_daily_limit) || DEFAULT_AUTOMATION_SETTINGS.member_daily_limit)),
    member_max_per_slot: Math.min(100, Math.max(1, Number(raw.member_max_per_slot) || DEFAULT_AUTOMATION_SETTINGS.member_max_per_slot)),
    message_templates: Object.fromEntries(
      Object.entries(DEFAULT_AUTOMATION_SETTINGS.message_templates).map(([templateKey, templateValue]) => {
        const source = raw.message_templates && typeof raw.message_templates === 'object' && raw.message_templates[templateKey] && typeof raw.message_templates[templateKey] === 'object'
          ? raw.message_templates[templateKey]
          : {};
        return [templateKey, {
          title: typeof source.title === 'string' && source.title.trim() ? source.title : templateValue.title,
          body: typeof source.body === 'string' && source.body.trim() ? source.body : templateValue.body,
        }];
      })
    ),
  };
};

function SuperAdminDashboard({ token, onLogout }) {
  const headers = useMemo(() => ({ headers: { 'x-super-token': token } }), [token]);

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const initialLoadRef = useRef(false);

  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState({ gyms: [], users: [] });

  const [overview, setOverview] = useState({ stats: {}, recent_activity: [] });
  const [gyms, setGyms] = useState([]);
  const [selectedGym, setSelectedGym] = useState(null);
  const [users, setUsers] = useState([]);
  const [expandedGyms, setExpandedGyms] = useState({});
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [reports, setReports] = useState({ summary: {}, growth: [] });
  const [system, setSystem] = useState({
    maintenance_mode: false,
    maintenance_message: '',
    feature_flags: {},
    automation_settings: DEFAULT_AUTOMATION_SETTINGS,
    billing_config: normalizeFrontendBillingCatalog(),
    support_profile: {
      phone: '',
      email: '',
      whatsapp: '',
      about: '',
      address: '',
      timings: '',
    },
  });
  const [logs, setLogs] = useState([]);
  const [telemetry, setTelemetry] = useState(null);
  const [webhookData, setWebhookData] = useState(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [runtimeEvents, setRuntimeEvents] = useState([]);
  const [runtimeFilters, setRuntimeFilters] = useState({ q: '', event_type: '', severity: '' });
  const [runtimePagination, setRuntimePagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1, hasNext: false, hasPrev: false });

  const [gymFilters, setGymFilters] = useState({ q: '', status: '', plan: '', dateFrom: '', dateTo: '' });
  const [userFilters, setUserFilters] = useState({ q: '', status: '' });
  const [ticketFilters, setTicketFilters] = useState({ q: '', status: '', priority: '' });

  const [ticketReply, setTicketReply] = useState('');
  const [broadcast, setBroadcast] = useState({ title: '', message: '', url: '/', roles: ['OWNER', 'STAFF'], target_gym_id: '' });
  const [broadcastResult, setBroadcastResult] = useState(null);

  const [dangerGym, setDangerGym] = useState({ gymId: '', confirmName: '' });
  const [dangerUser, setDangerUser] = useState({ userId: '', confirmText: '' });
  const [showGymViewModal, setShowGymViewModal] = useState(false);
  const [gymEditModal, setGymEditModal] = useState({
    open: false,
    gymId: null,
    gym_name: '',
    phone: '',
    support_email: '',
    website: '',
    plan: 'pro',
    saving: false,
    error: '',
  });
  const [gymActionModal, setGymActionModal] = useState({
    open: false,
    mode: '',
    gym: null,
    status: '',
    reason: '',
    confirmText: '',
    busy: false,
    error: '',
  });
  const billingConfig = normalizeFrontendBillingCatalog(system.billing_config);

  const groupedUsers = useMemo(() => {
    const groupsMap = new Map();

    users.forEach((user) => {
      const key = `${user.gym_id || user.gym_name || 'ungrouped'}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          gymName: user.gym_name || 'No Gym',
          owner: null,
          staff: [],
          all: [],
        });
      }

      const group = groupsMap.get(key);
      group.all.push(user);

      const role = String(user.role || '').toUpperCase();
      if (!group.owner && role === 'OWNER') {
        group.owner = user;
      } else {
        group.staff.push(user);
      }
    });

    const groups = Array.from(groupsMap.values()).map((group) => {
      if (!group.owner && group.all.length > 0) {
        group.owner = group.all[0];
        group.staff = group.all.slice(1);
      }
      return group;
    });

    return groups.sort((a, b) => String(a.gymName).localeCompare(String(b.gymName)));
  }, [users]);

  const handleApiError = useCallback((err) => {
    if (err?.response?.status === 401) onLogout();
    reportClientError('Superadmin API', err);
  }, [onLogout]);

  const loadOverview = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/overview', headers);
      setOverview(res.data || { stats: {}, recent_activity: [] });
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers]);

  const loadGyms = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/gyms', { ...headers, params: gymFilters });
      setGyms(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err);
    }
  }, [gymFilters, handleApiError, headers]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/users', { ...headers, params: userFilters });
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers, userFilters]);

  const loadTickets = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/support/tickets', { ...headers, params: ticketFilters });
      setTickets(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers, ticketFilters]);

  const loadReports = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/reports/light', headers);
      setReports(res.data || { summary: {}, growth: [] });
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers]);

  const loadSystem = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/system', headers);
      const payload = res.data || {};
      setSystem((prev) => ({
        maintenance_mode: typeof payload.maintenance_mode === 'boolean' ? payload.maintenance_mode : (prev.maintenance_mode || false),
        maintenance_message: payload.maintenance_message ?? prev.maintenance_message ?? '',
        feature_flags: payload.feature_flags || prev.feature_flags || {},
        automation_settings: mergeAutomationSettings(payload.automation_settings),
        billing_config: normalizeFrontendBillingCatalog(payload.billing_config),
        support_profile: {
          phone: payload.support_profile?.phone ?? prev.support_profile?.phone ?? '',
          email: payload.support_profile?.email ?? prev.support_profile?.email ?? '',
          whatsapp: payload.support_profile?.whatsapp ?? prev.support_profile?.whatsapp ?? '',
          about: payload.support_profile?.about ?? payload.support_profile?.mission ?? prev.support_profile?.about ?? '',
          address: payload.support_profile?.address ?? prev.support_profile?.address ?? '',
          timings: payload.support_profile?.timings ?? payload.support_profile?.support_window ?? prev.support_profile?.timings ?? '',
        },
      }));
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/logs', headers);
      setLogs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers]);

  const loadTelemetry = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/telemetry', headers);
      setTelemetry(res.data || null);
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers]);

  const loadRuntimeEvents = useCallback(async () => {
    try {
      const res = await axios.get('/api/superadmin/runtime-events', {
        ...headers,
        params: {
          q: runtimeFilters.q || undefined,
          event_type: runtimeFilters.event_type || undefined,
          severity: runtimeFilters.severity || undefined,
          page: runtimePagination.page,
          limit: runtimePagination.limit,
        },
      });
      setRuntimeEvents(Array.isArray(res.data?.items) ? res.data.items : []);
      setRuntimePagination((prev) => ({
        ...prev,
        ...(res.data?.pagination || {}),
      }));
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, headers, runtimeFilters.event_type, runtimeFilters.q, runtimeFilters.severity, runtimePagination.limit, runtimePagination.page]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadOverview(), loadGyms(), loadUsers(), loadTickets(), loadReports(), loadSystem(), loadLogs(), loadTelemetry(), loadRuntimeEvents(), loadWebhookUrl()]);
    setLoading(false);
  }, [loadGyms, loadLogs, loadOverview, loadReports, loadRuntimeEvents, loadSystem, loadTelemetry, loadTickets, loadUsers]);

  useEffect(() => {
    if (initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = true;
    loadAll();
  }, [loadAll]);
  useEffect(() => { loadGyms(); }, [loadGyms]);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => {
    if (activeTab === 'system') {
      loadTelemetry();
    }
  }, [activeTab, loadTelemetry]);
  useEffect(() => {
    if (activeTab === 'logs') {
      loadRuntimeEvents();
    }
  }, [activeTab, loadRuntimeEvents]);
  useEffect(() => {
    setRuntimePagination((prev) => prev.page === 1 ? prev : { ...prev, page: 1 });
  }, [runtimeFilters.q, runtimeFilters.event_type, runtimeFilters.severity]);

  const runGlobalSearch = async () => {
    if (!search.trim()) {
      setGlobalSearch({ gyms: [], users: [] });
      return;
    }
    try {
      const res = await axios.get('/api/superadmin/search', { ...headers, params: { q: search } });
      setGlobalSearch(res.data || { gyms: [], users: [] });
    } catch (err) {
      handleApiError(err);
    }
  };

  const applyGymStatus = async (gym, status, reason = '') => {
    await axios.put(`/api/superadmin/gyms/${gym.id}/status`, { status, reason }, headers);
    if (selectedGym?.id === gym.id) {
      const detail = await axios.get(`/api/superadmin/gyms/${gym.id}`, headers);
      setSelectedGym(detail.data);
    }
    loadOverview();
    loadGyms();
    loadLogs();
  };

  const openGymEditModal = (gym) => {
    setGymEditModal({
      open: true,
      gymId: gym.id,
      gym_name: gym.gym_name || '',
      phone: gym.phone || '',
      support_email: gym.support_email || '',
      website: gym.website || '',
      plan: gym.plan || 'pro',
      saving: false,
      error: '',
    });
  };

  const saveGymEdits = async () => {
    const payload = {
      gym_name: gymEditModal.gym_name,
      phone: gymEditModal.phone,
      support_email: gymEditModal.support_email,
      website: gymEditModal.website,
      plan: gymEditModal.plan,
    };

    if (!payload.gym_name.trim()) {
      setGymEditModal((prev) => ({ ...prev, error: 'Gym name is required.' }));
      return;
    }

    try {
      setGymEditModal((prev) => ({ ...prev, saving: true, error: '' }));
      await axios.put(`/api/superadmin/gyms/${gymEditModal.gymId}`, payload, headers);
      setGymEditModal({
        open: false,
        gymId: null,
        gym_name: '',
        phone: '',
        support_email: '',
        website: '',
        plan: 'pro',
        saving: false,
        error: '',
      });
      loadGyms();
      loadLogs();
      if (selectedGym?.id === gymEditModal.gymId) {
        const detail = await axios.get(`/api/superadmin/gyms/${gymEditModal.gymId}`, headers);
        setSelectedGym(detail.data);
      }
    } catch (err) {
      handleApiError(err);
      setGymEditModal((prev) => ({ ...prev, saving: false, error: 'Failed to save gym changes.' }));
    }
  };

  const viewGym = async (gymId) => {
    try {
      const res = await axios.get(`/api/superadmin/gyms/${gymId}`, headers);
      setSelectedGym(res.data);
      setShowGymViewModal(true);
    } catch (err) {
      handleApiError(err);
    }
  };

  const performDeleteGym = async (gym) => {
    await axios.delete(`/api/superadmin/gyms/${gym.id}`, headers);
    if (selectedGym?.id === gym.id) {
      setSelectedGym(null);
      setShowGymViewModal(false);
    }
    loadOverview();
    loadGyms();
    loadLogs();
  };

  const openGymActionModal = (mode, gym, status = '') => {
    setGymActionModal({
      open: true,
      mode,
      gym,
      status,
      reason: '',
      confirmText: '',
      busy: false,
      error: '',
    });
  };

  const closeGymActionModal = () => {
    setGymActionModal({
      open: false,
      mode: '',
      gym: null,
      status: '',
      reason: '',
      confirmText: '',
      busy: false,
      error: '',
    });
  };

  const runGymAction = async () => {
    if (!gymActionModal.gym) return;

    if (gymActionModal.mode === 'delete' && gymActionModal.confirmText !== gymActionModal.gym.gym_name) {
      setGymActionModal((prev) => ({ ...prev, error: 'Gym name does not match. Please type exact name.' }));
      return;
    }

    try {
      setGymActionModal((prev) => ({ ...prev, busy: true, error: '' }));

      if (gymActionModal.mode === 'status') {
        await applyGymStatus(gymActionModal.gym, gymActionModal.status, gymActionModal.reason || '');
      }

      if (gymActionModal.mode === 'impersonate') {
        await axios.post(`/api/superadmin/gyms/${gymActionModal.gym.id}/impersonate`, {}, headers);
        window.location.href = '/dashboard';
        return;
      }

      if (gymActionModal.mode === 'delete') {
        await performDeleteGym(gymActionModal.gym);
      }

      closeGymActionModal();
    } catch (err) {
      handleApiError(err);
      setGymActionModal((prev) => ({ ...prev, busy: false, error: 'Action failed. Please try again.' }));
    }
  };

  const blockUser = async (user, blocked) => {
    try {
      await axios.put(`/api/superadmin/users/${user.id}/block`, { blocked }, headers);
      loadUsers();
      loadLogs();
    } catch (err) {
      handleApiError(err);
      alert('Failed to update user status');
    }
  };

  const resetPassword = async (user) => {
    const typed = window.prompt('Enter new password (min 8 chars):', '');
    if (!typed || typed.trim().length < 8) {
      alert('Password reset cancelled. Enter at least 8 characters.');
      return;
    }
    try {
      await axios.post(`/api/superadmin/users/${user.id}/reset-password`, { new_password: typed.trim() }, headers);
      alert('Password reset successful.');
      loadLogs();
    } catch (err) {
      handleApiError(err);
      alert('Failed to reset password');
    }
  };

  const deleteUser = async (user) => {
    if (!window.confirm(`Delete user ${user.email} permanently?`)) return;
    try {
      await axios.delete(`/api/superadmin/users/${user.id}`, headers);
      loadUsers();
      loadLogs();
    } catch (err) {
      handleApiError(err);
      alert('Failed to delete user');
    }
  };

  const openTicket = async (id) => {
    try {
      const res = await axios.get(`/api/superadmin/support/tickets/${id}`, headers);
      setSelectedTicket(res.data);
    } catch (err) {
      handleApiError(err);
    }
  };

  const updateTicket = async (patch) => {
    if (!selectedTicket?.ticket?.id) return;
    try {
      const res = await axios.put(`/api/superadmin/support/tickets/${selectedTicket.ticket.id}`, patch, headers);
      setSelectedTicket((prev) => ({ ...prev, ticket: { ...prev.ticket, ...res.data } }));
      loadTickets();
      loadLogs();
    } catch (err) {
      handleApiError(err);
      alert('Failed to update ticket');
    }
  };

  const replyTicket = async () => {
    if (!ticketReply.trim() || !selectedTicket?.ticket?.id) return;
    try {
      const res = await axios.post(`/api/superadmin/support/tickets/${selectedTicket.ticket.id}/reply`, { message: ticketReply }, headers);
      setSelectedTicket((prev) => ({ ...prev, messages: [...(prev.messages || []), res.data] }));
      setTicketReply('');
      loadTickets();
      loadLogs();
    } catch (err) {
      handleApiError(err);
      alert('Failed to send reply');
    }
  };

  const saveSystem = async () => {
    try {
      await axios.put('/api/superadmin/system', system, headers);
      loadSystem();
      loadLogs();
      alert('System settings saved');
    } catch (err) {
      handleApiError(err);
      alert('Failed to save system settings');
    }
  };

  const loadWebhookUrl = async () => {
    try {
      const res = await axios.get('/api/superadmin/system/whatsapp-webhook', headers);
      setWebhookData(res.data);
    } catch { /* ignore */ }
  };

  const updateAutomationTemplate = (templateKey, field, value) => {
    setSystem((prev) => {
      const nextAutomationSettings = mergeAutomationSettings(prev.automation_settings);
      return {
        ...prev,
        automation_settings: {
          ...nextAutomationSettings,
          message_templates: {
            ...nextAutomationSettings.message_templates,
            [templateKey]: {
              ...nextAutomationSettings.message_templates[templateKey],
              [field]: value,
            },
          },
        },
      };
    });
  };

  const updateBillingPlanField = (planId, field, value) => {
    setSystem((prev) => {
      const billingConfig = normalizeFrontendBillingCatalog(prev.billing_config);
      return {
        ...prev,
        billing_config: {
          ...billingConfig,
          plans: {
            ...billingConfig.plans,
            [planId]: {
              ...billingConfig.plans[planId],
              [field]: field === 'popular' ? Boolean(value) : value,
            },
          },
        },
      };
    });
  };

  const updateBillingPlanLimit = (planId, limitKey, value) => {
    setSystem((prev) => {
      const billingConfig = normalizeFrontendBillingCatalog(prev.billing_config);
      const nextValue = value === '' ? null : (Number.parseInt(value, 10) || 0);
      return {
        ...prev,
        billing_config: {
          ...billingConfig,
          plans: {
            ...billingConfig.plans,
            [planId]: {
              ...billingConfig.plans[planId],
              limits: {
                ...billingConfig.plans[planId].limits,
                [limitKey]: nextValue,
              },
            },
          },
        },
      };
    });
  };

  const updateBillingPlanFeatures = (planId, value) => {
    setSystem((prev) => {
      const billingConfig = normalizeFrontendBillingCatalog(prev.billing_config);
      return {
        ...prev,
        billing_config: {
          ...billingConfig,
          plans: {
            ...billingConfig.plans,
            [planId]: {
              ...billingConfig.plans[planId],
              features: String(value || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
            },
          },
        },
      };
    });
  };

  const updateBillingAddonField = (addonKey, field, value) => {
    setSystem((prev) => {
      const billingConfig = normalizeFrontendBillingCatalog(prev.billing_config);
      const nextValue = ['price', 'increment'].includes(field)
        ? (value === '' ? 0 : (Number.parseInt(value, 10) || 0))
        : value;
      return {
        ...prev,
        billing_config: {
          ...billingConfig,
          addons: {
            ...billingConfig.addons,
            [addonKey]: {
              ...billingConfig.addons[addonKey],
              [field]: nextValue,
            },
          },
        },
      };
    });
  };

  const toggleBillingAddonPlan = (addonKey, planId) => {
    setSystem((prev) => {
      const billingConfig = normalizeFrontendBillingCatalog(prev.billing_config);
      const currentPlans = Array.isArray(billingConfig.addons[addonKey]?.requires_plans)
        ? billingConfig.addons[addonKey].requires_plans
        : [];
      const nextPlans = currentPlans.includes(planId)
        ? currentPlans.filter((entry) => entry !== planId)
        : [...currentPlans, planId];
      return {
        ...prev,
        billing_config: {
          ...billingConfig,
          addons: {
            ...billingConfig.addons,
            [addonKey]: {
              ...billingConfig.addons[addonKey],
              requires_plans: nextPlans,
            },
          },
        },
      };
    });
  };

  const sendBroadcast = async () => {
    if (!broadcast.title.trim() || !broadcast.message.trim()) return;
    try {
      const payload = {
        title: broadcast.title,
        message: broadcast.message,
        url: broadcast.url || '/',
        roles: broadcast.roles,
      };
      if (broadcast.target_gym_id) payload.target_gym_id = broadcast.target_gym_id;
      const res = await axios.post('/api/superadmin/system/broadcast', payload, headers);
      setBroadcast({ title: '', message: '', url: '/', roles: ['OWNER', 'STAFF'], target_gym_id: '' });
      setBroadcastResult(res.data);
      loadLogs();
      setTimeout(() => setBroadcastResult(null), 5000);
    } catch (err) {
      handleApiError(err);
      alert('Failed to send broadcast');
    }
  };

  const applyDangerGymDelete = async () => {
    const gym = gyms.find((g) => String(g.id) === String(dangerGym.gymId));
    if (!gym) return alert('Invalid gym id');
    if (dangerGym.confirmName !== gym.gym_name) return alert('Gym name mismatch');
    await performDeleteGym(gym);
    setDangerGym({ gymId: '', confirmName: '' });
  };

  const applyDangerUserDelete = async () => {
    const user = users.find((u) => String(u.id) === String(dangerUser.userId));
    if (!user) return alert('Invalid user id');
    if (dangerUser.confirmText !== 'DELETE') return alert('Type DELETE to confirm');
    await deleteUser(user);
    setDangerUser({ userId: '', confirmText: '' });
  };

  if (loading) {
    return <div className="app-min-shell-height flex items-center justify-center bg-[#050505] text-rose-500 font-black tracking-widest" style={{ paddingTop: 'var(--safe-area-top)' }}>LOADING HQ...</div>;
  }

  const stats = overview.stats || {};

  const renderGymManagementSection = () => (
    <div className="space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
        <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Search gym/owner/email" value={gymFilters.q} onChange={(e) => setGymFilters((p) => ({ ...p, q: e.target.value }))} />
        <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={gymFilters.status} onChange={(e) => setGymFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All Status</option><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option><option value="SUSPENDED">Suspended</option>
        </select>
        <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={gymFilters.plan} onChange={(e) => setGymFilters((p) => ({ ...p, plan: e.target.value }))}>
          <option value="">All Plans</option><option value="basic">Basic</option><option value="growth">Growth</option><option value="pro">Pro</option>
        </select>
        <input type="date" className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={gymFilters.dateFrom} onChange={(e) => setGymFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        <input type="date" className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={gymFilters.dateTo} onChange={(e) => setGymFilters((p) => ({ ...p, dateTo: e.target.value }))} />
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1200px]">
            <thead className="bg-black/40 text-[10px] text-slate-400 uppercase font-black tracking-widest">
              <tr>
                <th className="p-4">Gym</th>
                <th className="p-4">Owner</th>
                <th className="p-4">Email</th>
                <th className="p-4">Plan</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created</th>
                <th className="p-4">Last Active</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {gyms.map((g) => (
                <tr key={g.id} className="hover:bg-white/[0.02]">
                  <td className="p-4 font-bold text-white">{g.gym_name}</td>
                  <td className="p-4 text-slate-300">{g.owner_name || '-'}</td>
                  <td className="p-4 text-slate-400">{g.owner_email || '-'}</td>
                  <td className="p-4 text-indigo-300 font-bold uppercase">{g.plan}</td>
                  <td className="p-4"><span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusClass(g.status)}`}>{g.status}</span></td>
                  <td className="p-4 text-slate-400">{new Date(g.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="p-4 text-slate-400">{g.last_active ? new Date(g.last_active).toLocaleString('en-GB') : '-'}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" aria-label={`View ${g.gym_name}`} onClick={() => viewGym(g.id)} className="p-2 rounded-lg border border-white/10 hover:bg-white/10 transition-all" title="View"><Eye size={14} /></button>
                      <button type="button" aria-label={`Edit ${g.gym_name}`} onClick={() => openGymEditModal(g)} className="p-2 rounded-lg border border-white/10 hover:bg-white/10 transition-all" title="Edit"><Edit3 size={14} /></button>
                      <button type="button" aria-label={`Block ${g.gym_name}`} onClick={() => openGymActionModal('status', g, 'BLOCKED')} className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all" title="Block"><Ban size={14} /></button>
                      <button type="button" aria-label={`Suspend ${g.gym_name}`} onClick={() => openGymActionModal('status', g, 'SUSPENDED')} className="p-2 rounded-lg border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all" title="Suspend"><PauseCircle size={14} /></button>
                      <button type="button" aria-label={`Activate ${g.gym_name}`} onClick={() => openGymActionModal('status', g, 'ACTIVE')} className="p-2 rounded-lg border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all" title="Activate"><Activity size={14} /></button>
                      <button type="button" aria-label={`Impersonate ${g.gym_name}`} onClick={() => openGymActionModal('impersonate', g)} className="p-2 rounded-lg border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 transition-all" title="Impersonate"><UserCog size={14} /></button>
                      <button type="button" aria-label={`Archive ${g.gym_name}`} onClick={() => openGymActionModal('delete', g)} className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all" title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {gyms.length === 0 && <tr><td colSpan="8" className="p-8 text-center text-slate-500 font-bold">No gyms found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-min-shell-height bg-[#050505] text-slate-200 font-['Inter'] p-6 lg:p-8" style={{ paddingTop: 'max(1.5rem, var(--safe-area-top))' }}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-500 flex items-center justify-center border border-rose-500/30">
                <ShieldAlert size={18} />
              </div>
              <h1 className="text-3xl font-black text-white tracking-tight">HQ Command</h1>
            </div>
            <p className="text-slate-400 text-sm">Super Admin Global Overview & Controls</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-72 max-w-[65vw]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runGlobalSearch()}
                aria-label="Search gyms and users"
                placeholder="Search gym, user, email"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:border-indigo-500/40"
              />
            </div>
            <button onClick={runGlobalSearch} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">Search</button>
            <button aria-label="Refresh HQ data" onClick={loadAll} className="px-3 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5"><RefreshCw size={16} /></button>
            <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-rose-500/10 hover:text-rose-400 text-slate-400 rounded-xl font-bold transition-all text-sm border border-white/10">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>

        {(globalSearch.gyms?.length > 0 || globalSearch.users?.length > 0) && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest font-black text-slate-400 mb-2">Gyms</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {globalSearch.gyms.map((gym) => (
                  <button key={`s-g-${gym.id}`} onClick={() => { setActiveTab('overview'); viewGym(gym.id); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm">
                    <span className="font-bold text-white">{gym.gym_name}</span> <span className="text-slate-500">· {gym.plan}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest font-black text-slate-400 mb-2">Users</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {globalSearch.users.map((u) => (
                  <button key={`s-u-${u.id}`} onClick={() => setActiveTab('users')} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm">
                    <span className="font-bold text-white">{u.full_name}</span> <span className="text-slate-500">· {u.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Total Gyms</p><h3 className="text-2xl font-black text-white mt-1">{stats.total_gyms || 0}</h3></div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Active Gyms</p><h3 className="text-2xl font-black text-emerald-400 mt-1">{stats.active_gyms || 0}</h3></div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Blocked Gyms</p><h3 className="text-2xl font-black text-rose-400 mt-1">{stats.blocked_gyms || 0}</h3></div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Total Users</p><h3 className="text-2xl font-black text-blue-400 mt-1">{stats.total_users || 0}</h3></div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Revenue</p><h3 className="text-2xl font-black text-white mt-1">₹{Number(stats.total_revenue || 0).toLocaleString()}</h3></div>
              <div className="bg-white/5 border border-white/10 p-4 rounded-2xl"><p className="text-[10px] text-slate-400 uppercase font-black">Open Tickets</p><h3 className="text-2xl font-black text-amber-400 mt-1">{stats.open_support_tickets || 0}</h3></div>
            </div>

            {renderGymManagementSection()}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Search name/email/gym" value={userFilters.q} onChange={(e) => setUserFilters((p) => ({ ...p, q: e.target.value }))} />
              <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={userFilters.status} onChange={(e) => setUserFilters((p) => ({ ...p, status: e.target.value }))}>
                <option value="">All Status</option><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option>
              </select>
            </div>

            <div className="space-y-3">
              {groupedUsers.map((group) => {
                const owner = group.owner;
                const isExpanded = !!expandedGyms[group.key];
                return (
                  <div key={group.key} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-black/30 border-b border-white/10 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Gym</p>
                        <p className="text-sm font-black text-white">{group.gymName}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-black">Owner: {owner ? 1 : 0}</span>
                        <span className="px-2 py-1 rounded-full border border-white/20 bg-white/5 text-slate-300 font-black">Staff: {group.staff.length}</span>
                        <button onClick={() => setExpandedGyms((prev) => ({ ...prev, [group.key]: !isExpanded }))} className="ml-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 flex items-center gap-1.5 font-bold">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {isExpanded ? 'Hide Team' : 'Show Team'}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm min-w-[1000px]">
                        <thead className="bg-black/20 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                          <tr><th className="p-4">Name</th><th className="p-4">Email</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Last Login</th><th className="p-4 text-right">Actions</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {owner && (
                            <tr className="hover:bg-white/[0.02] bg-indigo-500/[0.06]">
                              <td className="p-4 font-bold text-white">{owner.full_name}</td>
                              <td className="p-4 text-slate-400">{owner.email}</td>
                              <td className="p-4 text-indigo-300 font-bold uppercase">OWNER{owner.staff_role ? `/${owner.staff_role}` : ''}</td>
                              <td className="p-4"><span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${owner.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>{owner.is_active ? 'ACTIVE' : 'BLOCKED'}</span></td>
                              <td className="p-4 text-slate-400">{owner.last_login_at ? new Date(owner.last_login_at).toLocaleString('en-GB') : '-'}</td>
                              <td className="p-4 text-right">
                                <div className="flex justify-end gap-2">
                                  <button type="button" aria-label={`Reset password for ${owner.full_name}`} onClick={() => resetPassword(owner)} className="p-2 rounded-lg border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20" title="Reset Password"><KeyRound size={14} /></button>
                                  <button type="button" aria-label={`${owner.is_active ? 'Block' : 'Unblock'} ${owner.full_name}`} onClick={() => blockUser(owner, owner.is_active)} className="p-2 rounded-lg border border-amber-500/20 text-amber-300 hover:bg-amber-500/20" title="Block/Unblock"><Ban size={14} /></button>
                                  <button type="button" aria-label={`Delete ${owner.full_name}`} onClick={() => deleteUser(owner)} className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/20" title="Delete"><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          )}

                          {isExpanded && group.staff.map((u) => (
                            <tr key={u.id} className="hover:bg-white/[0.02]">
                              <td className="p-4 font-bold text-white pl-8">↳ {u.full_name}</td>
                              <td className="p-4 text-slate-400">{u.email}</td>
                              <td className="p-4 text-indigo-300 font-bold uppercase">{u.role}{u.staff_role ? `/${u.staff_role}` : ''}</td>
                              <td className="p-4"><span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${u.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>{u.is_active ? 'ACTIVE' : 'BLOCKED'}</span></td>
                              <td className="p-4 text-slate-400">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-GB') : '-'}</td>
                              <td className="p-4 text-right">
                                <div className="flex justify-end gap-2">
                                  <button type="button" aria-label={`Reset password for ${u.full_name}`} onClick={() => resetPassword(u)} className="p-2 rounded-lg border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20" title="Reset Password"><KeyRound size={14} /></button>
                                  <button type="button" aria-label={`${u.is_active ? 'Block' : 'Unblock'} ${u.full_name}`} onClick={() => blockUser(u, u.is_active)} className="p-2 rounded-lg border border-amber-500/20 text-amber-300 hover:bg-amber-500/20" title="Block/Unblock"><Ban size={14} /></button>
                                  <button type="button" aria-label={`Delete ${u.full_name}`} onClick={() => deleteUser(u)} className="p-2 rounded-lg border border-rose-500/20 text-rose-400 hover:bg-rose-500/20" title="Delete"><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          ))}

                          {isExpanded && group.staff.length === 0 && (
                            <tr>
                              <td colSpan="6" className="p-6 text-center text-slate-500 font-bold">No staff found under this gym owner.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {groupedUsers.length === 0 && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-500 font-bold">No users found.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'support' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Search ticket/gym/user" value={ticketFilters.q} onChange={(e) => setTicketFilters((p) => ({ ...p, q: e.target.value }))} />
                <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={ticketFilters.status} onChange={(e) => setTicketFilters((p) => ({ ...p, status: e.target.value }))}><option value="">All Status</option><option value="OPEN">Open</option><option value="PENDING">Pending</option><option value="CLOSED">Closed</option></select>
                <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={ticketFilters.priority} onChange={(e) => setTicketFilters((p) => ({ ...p, priority: e.target.value }))}><option value="">All Priority</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="max-h-[560px] overflow-y-auto">
                  {tickets.map((t) => (
                    <button key={t.id} onClick={() => openTicket(t.id)} className="w-full text-left p-3 border-b border-white/5 hover:bg-white/[0.03]">
                      <div className="flex justify-between items-start gap-2">
                        <p className="font-black text-white text-sm truncate">#{t.id} · {t.subject}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${statusClass(t.status)}`}>{t.status}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{t.gym_name} · {t.user_email || t.user_name || '-'} · {new Date(t.created_at).toLocaleString('en-GB')}</p>
                    </button>
                  ))}
                  {tickets.length === 0 && <div className="p-8 text-center text-slate-500 font-bold">No tickets found.</div>}
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              {!selectedTicket ? (
                <div className="h-full flex items-center justify-center text-slate-500 font-bold">Select a ticket to view details</div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-black/30 border border-white/10">
                    <p className="font-black text-white">#{selectedTicket.ticket.id} · {selectedTicket.ticket.subject}</p>
                    <p className="text-xs text-slate-400 mt-1">{selectedTicket.ticket.gym_name} · {selectedTicket.ticket.user_email || selectedTicket.ticket.user_name || '-'}</p>
                    <p className="text-sm text-slate-300 mt-2">{selectedTicket.ticket.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <select className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm" value={selectedTicket.ticket.status || 'OPEN'} onChange={(e) => updateTicket({ status: e.target.value })}>
                      <option value="OPEN">Open</option><option value="PENDING">Pending</option><option value="CLOSED">Closed</option>
                    </select>
                    <select className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm" value={selectedTicket.ticket.priority || 'MEDIUM'} onChange={(e) => updateTicket({ priority: e.target.value })}>
                      <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
                    </select>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2">
                    {(selectedTicket.messages || []).map((m) => (
                      <div key={m.id} className="p-2.5 rounded-xl bg-black/30 border border-white/10">
                        <p className="text-[11px] text-indigo-300 font-black uppercase tracking-widest">{m.author_type}</p>
                        <p className="text-sm text-slate-200 mt-1">{m.message}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{new Date(m.created_at).toLocaleString('en-GB')}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input value={ticketReply} onChange={(e) => setTicketReply(e.target.value)} placeholder="Reply to ticket..." className="flex-1 px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" />
                    <button onClick={replyTicket} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center gap-1"><Send size={13} /> Reply</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4"><p className="text-[10px] text-slate-400 uppercase font-black">Total Revenue</p><p className="text-2xl font-black text-white mt-1">₹{Number(reports.summary?.total_revenue || 0).toLocaleString()}</p></div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4"><p className="text-[10px] text-slate-400 uppercase font-black">Active Gyms Growth (This Month)</p><p className="text-2xl font-black text-emerald-400 mt-1">{reports.summary?.gyms_this_month || 0}</p></div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4"><p className="text-[10px] text-slate-400 uppercase font-black">Churn Gyms</p><p className="text-2xl font-black text-rose-400 mt-1">{reports.summary?.churn_gyms || 0}</p></div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <p className="text-xs uppercase tracking-widest font-black text-slate-400 mb-3">Active Gyms Growth Trend</p>
              <div className="space-y-2">
                {(reports.growth || []).map((g) => (
                  <div key={g.month} className="flex justify-between px-3 py-2 rounded-xl bg-black/30 border border-white/5">
                    <span className="text-slate-300 font-bold">{g.month}</span>
                    <span className="text-indigo-300 font-black">{g.gyms}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Runtime Telemetry</p>
                  <p className="text-sm text-slate-500 mt-1">HQ-only live view of backend load, request latency, memory, and database pressure.</p>
                </div>
                <button onClick={loadTelemetry} className="px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-sm font-bold flex items-center gap-2">
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {[
                  { label: 'Avg Response', value: `${Number(telemetry?.requests?.avg_duration_ms || 0)}ms` },
                  { label: 'Active Requests', value: Number(telemetry?.requests?.active || 0) },
                  { label: 'Pool Waiting', value: Number(telemetry?.database?.pool_waiting || 0) },
                  { label: 'Heap Used', value: `${Number(telemetry?.process?.heap_used_mb || 0)} MB` },
                ].map((card) => (
                  <div key={card.label} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">{card.label}</p>
                    <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-3">Slowest Endpoints</p>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {(telemetry?.slowest_endpoints || []).map((entry) => (
                      <div key={`${entry.method}-${entry.route}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-white truncate">{entry.method} {entry.route}</p>
                          <p className="text-[11px] text-slate-500">avg {entry.avgDurationMs}ms · max {entry.maxDurationMs}ms</p>
                        </div>
                        <span className="text-xs font-black text-amber-300 shrink-0">{entry.count} hits</span>
                      </div>
                    ))}
                    {(telemetry?.slowest_endpoints || []).length === 0 && <div className="text-sm font-bold text-slate-500">No endpoint telemetry yet.</div>}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-3">Recent Runtime Errors</p>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {(telemetry?.recent_errors || []).map((entry, index) => (
                      <div key={`${entry.created_at || index}-${entry.message || index}`} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-white truncate">{entry.message || 'Unknown runtime issue'}</p>
                          <span className="text-[11px] font-bold text-slate-500 shrink-0">{entry.created_at ? new Date(entry.created_at).toLocaleTimeString('en-GB') : 'now'}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{entry.route ? `${entry.method || ''} ${entry.route}`.trim() : entry.source || 'server'}</p>
                      </div>
                    ))}
                    {(telemetry?.recent_errors || []).length === 0 && <div className="text-sm font-bold text-slate-500">No recent runtime errors captured.</div>}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-indigo-400" />
                <p className="text-xs uppercase tracking-widest font-black text-slate-400">Global Notification Automation</p>
              </div>

              <p className="text-sm text-slate-400 max-w-2xl">
                HQ-only control for app-wide notification automation. Owner and staff get business nudges, and members get a separate push stream with its own caps.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/10">
                  <span className="font-bold text-slate-200">Owner / Staff automations</span>
                  <input
                    type="checkbox"
                    checked={!!system.automation_settings?.owner_staff_enabled}
                    onChange={(e) => setSystem((p) => ({
                      ...p,
                      automation_settings: {
                        ...(p.automation_settings || DEFAULT_AUTOMATION_SETTINGS),
                        owner_staff_enabled: e.target.checked,
                      },
                    }))}
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/10">
                  <span className="font-bold text-slate-200">Member push automations</span>
                  <input
                    type="checkbox"
                    checked={!!system.automation_settings?.member_push_enabled}
                    onChange={(e) => setSystem((p) => ({
                      ...p,
                      automation_settings: {
                        ...(p.automation_settings || DEFAULT_AUTOMATION_SETTINGS),
                        member_push_enabled: e.target.checked,
                      },
                    }))}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-black/30 border border-white/10 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Owner / Staff Slots</p>
                  {Object.entries(SLOT_LABELS).map(([slotKey, label]) => (
                    <label key={`owner-${slotKey}`} className="flex items-center justify-between p-2.5 rounded-lg bg-black/20 border border-white/5">
                      <span className="font-bold text-slate-300">{label}</span>
                      <input
                        type="checkbox"
                        checked={!!system.automation_settings?.owner_staff_slots?.[slotKey]}
                        onChange={(e) => setSystem((p) => ({
                          ...p,
                          automation_settings: {
                            ...(p.automation_settings || DEFAULT_AUTOMATION_SETTINGS),
                            owner_staff_slots: {
                              ...(p.automation_settings?.owner_staff_slots || DEFAULT_AUTOMATION_SETTINGS.owner_staff_slots),
                              [slotKey]: e.target.checked,
                            },
                          },
                        }))}
                      />
                    </label>
                  ))}
                </div>

                <div className="p-3 rounded-xl bg-black/30 border border-white/10 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Member Push Slots</p>
                  {Object.entries(SLOT_LABELS).map(([slotKey, label]) => (
                    <label key={`member-${slotKey}`} className="flex items-center justify-between p-2.5 rounded-lg bg-black/20 border border-white/5">
                      <span className="font-bold text-slate-300">{label}</span>
                      <input
                        type="checkbox"
                        checked={!!system.automation_settings?.member_slots?.[slotKey]}
                        onChange={(e) => setSystem((p) => ({
                          ...p,
                          automation_settings: {
                            ...(p.automation_settings || DEFAULT_AUTOMATION_SETTINGS),
                            member_slots: {
                              ...(p.automation_settings?.member_slots || DEFAULT_AUTOMATION_SETTINGS.member_slots),
                              [slotKey]: e.target.checked,
                            },
                          },
                        }))}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Owner / Staff Nudges Per Day</p>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                    value={system.automation_settings?.owner_staff_daily_limit || DEFAULT_AUTOMATION_SETTINGS.owner_staff_daily_limit}
                    onChange={(e) => setSystem((p) => ({
                      ...p,
                      automation_settings: {
                        ...mergeAutomationSettings(p.automation_settings),
                        owner_staff_daily_limit: Math.min(3, Math.max(1, Number(e.target.value) || DEFAULT_AUTOMATION_SETTINGS.owner_staff_daily_limit)),
                      },
                    }))}
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Member Pushes Per Day</p>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                    value={system.automation_settings?.member_daily_limit || DEFAULT_AUTOMATION_SETTINGS.member_daily_limit}
                    onChange={(e) => setSystem((p) => ({
                      ...p,
                      automation_settings: {
                        ...mergeAutomationSettings(p.automation_settings),
                        member_daily_limit: Math.min(500, Math.max(1, Number(e.target.value) || DEFAULT_AUTOMATION_SETTINGS.member_daily_limit)),
                      },
                    }))}
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Member Push Cap Per Slot</p>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                    value={system.automation_settings?.member_max_per_slot || DEFAULT_AUTOMATION_SETTINGS.member_max_per_slot}
                    onChange={(e) => setSystem((p) => ({
                      ...p,
                      automation_settings: {
                        ...mergeAutomationSettings(p.automation_settings),
                        member_max_per_slot: Math.min(100, Math.max(1, Number(e.target.value) || DEFAULT_AUTOMATION_SETTINGS.member_max_per_slot)),
                      },
                    }))}
                  />
                </div>
              </div>

              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Editable Message Templates</p>
                  <p className="text-sm text-slate-500 mt-1">These texts apply only to automatic notifications controlled here in HQ. Gym admins do not get these controls.</p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {AUTOMATION_TEMPLATE_FIELDS.map((template) => (
                    <div key={template.key} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-200">{template.label}</p>
                          <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mt-1">{template.audience}</p>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 text-right">{template.placeholders}</span>
                      </div>

                      <input
                        type="text"
                        className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                        value={system.automation_settings?.message_templates?.[template.key]?.title || DEFAULT_AUTOMATION_SETTINGS.message_templates[template.key].title}
                        onChange={(e) => updateAutomationTemplate(template.key, 'title', e.target.value)}
                        placeholder="Notification title"
                      />

                      <textarea
                        rows={4}
                        className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm resize-y"
                        value={system.automation_settings?.message_templates?.[template.key]?.body || DEFAULT_AUTOMATION_SETTINGS.message_templates[template.key].body}
                        onChange={(e) => updateAutomationTemplate(template.key, 'body', e.target.value)}
                        placeholder="Notification body"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveSystem} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm">Save Automation Settings</button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard size={14} className="text-indigo-400" />
                <p className="text-xs uppercase tracking-widest font-black text-slate-400">Billing Catalog</p>
              </div>

              <p className="text-sm text-slate-400 max-w-3xl">
                Edit plan names, monthly and annual pricing, runtime limits, visible feature bullets, and add-on pricing here. These values feed signup, owner billing, checkout, and backend capacity enforcement.
              </p>

              <div className="space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-3">Plans</p>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {BILLING_PLAN_ORDER.map((planId) => {
                      const plan = billingConfig.plans[planId];
                      if (!plan) return null;
                      return (
                        <div key={planId} className={`rounded-2xl border p-4 space-y-3 ${BILLING_PLAN_TINTS[planId] || 'border-white/10 bg-black/20'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-white">{plan.name}</p>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mt-1">{planId}</p>
                            </div>
                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-300">
                              <input
                                type="checkbox"
                                checked={Boolean(plan.popular)}
                                onChange={(e) => updateBillingPlanField(planId, 'popular', e.target.checked)}
                              />
                              Popular
                            </label>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="md:col-span-1">
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Plan Name</p>
                              <input
                                type="text"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={plan.name}
                                onChange={(e) => updateBillingPlanField(planId, 'name', e.target.value)}
                              />
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Monthly Price</p>
                              <input
                                type="number"
                                min="0"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={plan.monthly_price}
                                onChange={(e) => updateBillingPlanField(planId, 'monthly_price', Number.parseInt(e.target.value, 10) || 0)}
                              />
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Annual Price</p>
                              <input
                                type="number"
                                min="0"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={plan.annual_price}
                                onChange={(e) => updateBillingPlanField(planId, 'annual_price', Number.parseInt(e.target.value, 10) || 0)}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Runtime Limits</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {BILLING_LIMIT_FIELDS.map((limitField) => (
                                <div key={`${planId}-${limitField.key}`}>
                                  <p className="text-[10px] font-bold text-slate-400 mb-1">{limitField.label}</p>
                                  <input
                                    type="number"
                                    min="0"
                                    className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                    value={plan.limits?.[limitField.key] ?? ''}
                                    placeholder={planId === 'test' ? 'Unlimited' : '0'}
                                    onChange={(e) => updateBillingPlanLimit(planId, limitField.key, e.target.value)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Feature Bullets</p>
                            <textarea
                              rows={6}
                              className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm resize-y"
                              value={(plan.features || []).join('\n')}
                              onChange={(e) => updateBillingPlanFeatures(planId, e.target.value)}
                              placeholder="One feature per line"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-3">Add-ons</p>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {BILLING_ADDON_ORDER.map((addonKey) => {
                      const addon = billingConfig.addons[addonKey];
                      if (!addon) return null;
                      return (
                        <div key={addonKey} className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-white">{addon.label}</p>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mt-1">Affects {addon.limit_key}</p>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
                              {addonKey}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Label</p>
                              <input
                                type="text"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={addon.label}
                                onChange={(e) => updateBillingAddonField(addonKey, 'label', e.target.value)}
                              />
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Price</p>
                              <input
                                type="number"
                                min="0"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={addon.price}
                                onChange={(e) => updateBillingAddonField(addonKey, 'price', e.target.value)}
                              />
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Increment</p>
                              <input
                                type="number"
                                min="1"
                                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                                value={addon.increment}
                                onChange={(e) => updateBillingAddonField(addonKey, 'increment', e.target.value)}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1.5">Description</p>
                            <textarea
                              rows={3}
                              className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm resize-y"
                              value={addon.description}
                              onChange={(e) => updateBillingAddonField(addonKey, 'description', e.target.value)}
                            />
                          </div>

                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">Allowed Plans</p>
                            <div className="flex flex-wrap gap-2">
                              {BILLING_PLAN_ORDER.filter((planId) => planId !== 'test').map((planId) => {
                                const active = (addon.requires_plans || []).includes(planId);
                                return (
                                  <button
                                    key={`${addonKey}-${planId}`}
                                    type="button"
                                    onClick={() => toggleBillingAddonPlan(addonKey, planId)}
                                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${active ? 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40' : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
                                  >
                                    {planId}
                                  </button>
                                );
                              })}
                              {(addon.requires_plans || []).length === 0 && (
                                <span className="text-[11px] font-bold text-slate-500">Available on all paid plans.</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button onClick={saveSystem} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm">Save Billing Catalog</button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest font-black text-slate-400">Global Controls</p>
              <label className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/10">
                <span className="font-bold text-slate-200">Maintenance Mode</span>
                <input type="checkbox" checked={!!system.maintenance_mode} onChange={(e) => setSystem((p) => ({ ...p, maintenance_mode: e.target.checked }))} />
              </label>
              <input className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Maintenance message" value={system.maintenance_message || ''} onChange={(e) => setSystem((p) => ({ ...p, maintenance_message: e.target.value }))} />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {['support', 'attendance', 'billing'].map((key) => (
                  <label key={key} className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/10">
                    <span className="font-bold text-slate-300 capitalize">{key}</span>
                    <input type="checkbox" checked={!!system.feature_flags?.[key]} onChange={(e) => setSystem((p) => ({ ...p, feature_flags: { ...(p.feature_flags || {}), [key]: e.target.checked } }))} />
                  </label>
                ))}
              </div>

              <button onClick={saveSystem} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm">Save Settings</button>
            </div>

            {/* WhatsApp Webhook Configuration */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest font-black text-slate-400">WhatsApp Webhook (MSG91)</p>
              <p className="text-sm text-slate-500">Paste this URL once into MSG91 WhatsApp → Webhook for outbound delivery reports.</p>
              {webhookData ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${webhookData.webhook_token_configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {webhookData.webhook_token_configured ? 'Token Protected' : 'Open URL'}
                    </span>
                  </div>
                  <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-3">
                    <p className="text-sm font-bold text-slate-200 break-all">{webhookData.callback_url}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { navigator.clipboard.writeText(webhookData.callback_url); setWebhookCopied(true); setTimeout(() => setWebhookCopied(false), 2000); }} className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2">
                      {webhookCopied ? '✓ Copied' : 'Copy URL'}
                    </button>
                    {webhookData.docs_url && (
                      <a href={webhookData.docs_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-slate-300 text-xs font-black uppercase tracking-wider hover:bg-white/20 transition-all">
                        MSG91 Guide
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <button type="button" onClick={loadWebhookUrl} className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 font-bold text-sm">Load Webhook URL</button>
              )}
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest font-black text-slate-400">Global Help & Support Contact</p>
              <p className="text-sm text-slate-500">
                These HQ contact details appear on every gym's Help & Support page quick-contact card.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Support phone" value={system.support_profile?.phone || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), phone: e.target.value } }))} />
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Support email" value={system.support_profile?.email || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), email: e.target.value } }))} />
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="WhatsApp" value={system.support_profile?.whatsapp || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), whatsapp: e.target.value } }))} />
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Support timings" value={system.support_profile?.timings || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), timings: e.target.value } }))} />
              </div>

              <input className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Support address" value={system.support_profile?.address || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), address: e.target.value } }))} />
              <textarea className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm min-h-[88px]" placeholder="About support (shown in Know Us)" value={system.support_profile?.about || ''} onChange={(e) => setSystem((p) => ({ ...p, support_profile: { ...(p.support_profile || {}), about: e.target.value } }))} />

              <button onClick={saveSystem} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm">Save Support Profile</button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-indigo-400" />
                <p className="text-xs uppercase tracking-widest font-black text-slate-400">Push &amp; In-App Broadcast</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                  placeholder="Notification title *"
                  value={broadcast.title}
                  onChange={(e) => setBroadcast((p) => ({ ...p, title: e.target.value }))}
                />
                <input
                  className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                  placeholder="Deep-link URL (e.g. /members)"
                  value={broadcast.url}
                  onChange={(e) => setBroadcast((p) => ({ ...p, url: e.target.value }))}
                />
              </div>

              <textarea
                className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm min-h-[100px]"
                placeholder="Broadcast message *"
                value={broadcast.message}
                onChange={(e) => setBroadcast((p) => ({ ...p, message: e.target.value }))}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {/* Audience selector */}
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Audience (push)</p>
                  <div className="flex flex-wrap gap-2">
                    {['OWNER', 'STAFF', 'MEMBER'].map((role) => {
                      const selected = broadcast.roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setBroadcast((p) => ({
                            ...p,
                            roles: selected
                              ? p.roles.filter((r) => r !== role)
                              : [...p.roles, role],
                          }))}
                          className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${
                            selected
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'bg-black/30 border-white/10 text-slate-400 hover:border-white/30'
                          }`}
                        >
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Target gym (optional) */}
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Target Gym (leave blank = all gyms)</p>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                    value={broadcast.target_gym_id}
                    onChange={(e) => setBroadcast((p) => ({ ...p, target_gym_id: e.target.value }))}
                  >
                    <option value="">All Gyms</option>
                    {gyms.map((g) => (
                      <option key={g.id} value={g.id}>{g.gym_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {broadcastResult && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-bold">
                  ✓ Sent! Push delivered to {broadcastResult.pushSent ?? 0} device(s).
                </div>
              )}

              <button
                onClick={sendBroadcast}
                disabled={!broadcast.title.trim() || !broadcast.message.trim()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center gap-2"
              >
                <Send size={14} /> Send to {broadcast.target_gym_id ? 'selected gym' : 'all gyms'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Runtime Events</p>
                  <p className="text-sm text-slate-500 mt-1">Slow requests, pool issues, process failures, and client-side breakages from the app.</p>
                </div>
                <button onClick={loadRuntimeEvents} className="px-3 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-sm font-bold flex items-center gap-2">
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm"
                  placeholder="Search runtime logs"
                  value={runtimeFilters.q}
                  onChange={(e) => setRuntimeFilters((prev) => ({ ...prev, q: e.target.value }))}
                />
                <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={runtimeFilters.event_type} onChange={(e) => setRuntimeFilters((prev) => ({ ...prev, event_type: e.target.value }))}>
                  <option value="">All event types</option>
                  {['REQUEST_ERROR', 'SLOW_REQUEST', 'CLIENT_ERROR', 'POOL_ERROR', 'PROCESS_ERROR'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
                <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={runtimeFilters.severity} onChange={(e) => setRuntimeFilters((prev) => ({ ...prev, severity: e.target.value }))}>
                  <option value="">All severities</option>
                  {['ERROR', 'WARN', 'INFO'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/40 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                    <tr><th className="p-4">Event</th><th className="p-4">Route</th><th className="p-4">Impact</th><th className="p-4">Time</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {runtimeEvents.map((entry) => (
                      <tr key={entry.id} className="hover:bg-white/[0.02]">
                        <td className="p-4">
                          <div className="flex flex-col gap-1">
                            <span className="font-black text-white">{entry.event_type}</span>
                            <span className="text-xs text-slate-500">{entry.message}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-300">{entry.method || 'SYSTEM'} {entry.route || '—'}</td>
                        <td className="p-4 text-slate-400 text-xs">{entry.duration_ms ? `${entry.duration_ms}ms` : entry.status_code ? `HTTP ${entry.status_code}` : entry.severity}</td>
                        <td className="p-4 text-slate-400">{new Date(entry.created_at).toLocaleString('en-GB')}</td>
                      </tr>
                    ))}
                    {runtimeEvents.length === 0 && <tr><td colSpan="4" className="p-8 text-center text-slate-500 font-bold">No runtime events found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {runtimePagination.totalPages > 1 && (
              <PaginationControls
                pagination={runtimePagination}
                itemLabel="runtime events"
                onPageChange={(nextPage) => setRuntimePagination((prev) => ({ ...prev, page: nextPage }))}
              />
            )}

            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/40 text-[10px] text-slate-400 uppercase font-black tracking-widest">
                    <tr><th className="p-4">Action</th><th className="p-4">Target</th><th className="p-4">Time</th><th className="p-4">Details</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {logs.map((l) => (
                      <tr key={l.id} className="hover:bg-white/[0.02]">
                        <td className="p-4 font-black text-white">{l.action}</td>
                        <td className="p-4 text-slate-300">{l.target_type} · {l.target_label || l.target_id || '-'}</td>
                        <td className="p-4 text-slate-400">{new Date(l.created_at).toLocaleString('en-GB')}</td>
                        <td className="p-4 text-slate-500 text-xs">{typeof l.details === 'object' ? JSON.stringify(l.details) : String(l.details || '-')}</td>
                      </tr>
                    ))}
                    {logs.length === 0 && <tr><td colSpan="4" className="p-8 text-center text-slate-500 font-bold">No audit logs found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'danger' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest font-black text-rose-300">Delete Gym Permanently</p>
              <input className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-rose-500/30 text-sm" placeholder="Gym ID" value={dangerGym.gymId} onChange={(e) => setDangerGym((p) => ({ ...p, gymId: e.target.value }))} />
              <input className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-rose-500/30 text-sm" placeholder="Type exact gym name" value={dangerGym.confirmName} onChange={(e) => setDangerGym((p) => ({ ...p, confirmName: e.target.value }))} />
              <button onClick={applyDangerGymDelete} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm flex items-center gap-2"><Trash2 size={14} /> Delete Gym</button>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 space-y-3">
              <p className="text-xs uppercase tracking-widest font-black text-rose-300">Delete User Permanently</p>
              <input className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-rose-500/30 text-sm" placeholder="User ID" value={dangerUser.userId} onChange={(e) => setDangerUser((p) => ({ ...p, userId: e.target.value }))} />
              <input className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-rose-500/30 text-sm" placeholder="Type DELETE to confirm" value={dangerUser.confirmText} onChange={(e) => setDangerUser((p) => ({ ...p, confirmText: e.target.value }))} />
              <button onClick={applyDangerUserDelete} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm flex items-center gap-2"><Trash2 size={14} /> Delete User</button>
            </div>
          </div>
        )}

        {showGymViewModal && selectedGym && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <div className="w-full max-w-3xl bg-[#0d0d0f] border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Gym Detail</p>
                  <h3 className="text-xl font-black text-white mt-1">{selectedGym.gym_name}</h3>
                </div>
                <button onClick={() => setShowGymViewModal(false)} className="w-9 h-9 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10">✕</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Owner</p><p className="font-black text-white">{selectedGym.owner_name || '-'}</p><p className="text-slate-400 mt-0.5">{selectedGym.owner_email || '-'}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Plan / Status</p><p className="font-black text-white uppercase">{selectedGym.plan} · {selectedGym.status}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Phone</p><p className="font-black text-white">{selectedGym.phone || '-'}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Members</p><p className="font-black text-white">{selectedGym.total_members}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Revenue</p><p className="font-black text-white">₹{Number(selectedGym.total_revenue || 0).toLocaleString()}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Last Activity</p><p className="font-black text-white">{selectedGym.last_active ? new Date(selectedGym.last_active).toLocaleString('en-GB') : '-'}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10 md:col-span-2"><p className="text-slate-500">Support Email</p><p className="font-black text-white">{selectedGym.support_email || '-'}</p></div>
                <div className="bg-black/30 rounded-xl p-3 border border-white/10"><p className="text-slate-500">Website</p><p className="font-black text-white truncate">{selectedGym.website || '-'}</p></div>
              </div>

              <div className="flex justify-end">
                <button onClick={() => setShowGymViewModal(false)} className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-sm font-bold">Close</button>
              </div>
            </div>
          </div>
        )}

        {gymEditModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <div className="w-full max-w-2xl bg-[#0d0d0f] border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Edit Gym</p>
                  <h3 className="text-xl font-black text-white mt-1">Update gym details</h3>
                </div>
                <button onClick={() => setGymEditModal((prev) => ({ ...prev, open: false }))} className="w-9 h-9 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10">✕</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Gym Name" value={gymEditModal.gym_name} onChange={(e) => setGymEditModal((prev) => ({ ...prev, gym_name: e.target.value }))} />
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Phone" value={gymEditModal.phone} onChange={(e) => setGymEditModal((prev) => ({ ...prev, phone: e.target.value }))} />
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Support Email" value={gymEditModal.support_email} onChange={(e) => setGymEditModal((prev) => ({ ...prev, support_email: e.target.value }))} />
                <select className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" value={gymEditModal.plan} onChange={(e) => setGymEditModal((prev) => ({ ...prev, plan: e.target.value }))}>
                  <option value="basic">Basic</option>
                  <option value="growth">Growth</option>
                  <option value="pro">Pro</option>
                </select>
                <input className="px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm md:col-span-2" placeholder="Website" value={gymEditModal.website} onChange={(e) => setGymEditModal((prev) => ({ ...prev, website: e.target.value }))} />
              </div>

              {gymEditModal.error && <p className="text-sm text-rose-400 font-semibold">{gymEditModal.error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => setGymEditModal((prev) => ({ ...prev, open: false }))} className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-sm font-bold">Cancel</button>
                <button onClick={saveGymEdits} disabled={gymEditModal.saving} className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold">{gymEditModal.saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}

        {gymActionModal.open && gymActionModal.gym && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
            <div className="w-full max-w-xl bg-[#0d0d0f] border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest font-black text-slate-400">Confirm Action</p>
                  <h3 className="text-xl font-black text-white mt-1">
                    {gymActionModal.mode === 'status' && `${gymActionModal.status} gym`}
                    {gymActionModal.mode === 'impersonate' && 'Impersonate gym owner'}
                    {gymActionModal.mode === 'delete' && 'Delete gym permanently'}
                  </h3>
                </div>
                <button onClick={closeGymActionModal} className="w-9 h-9 rounded-lg border border-white/10 text-slate-300 hover:bg-white/10">✕</button>
              </div>

              <div className="p-3 rounded-xl bg-black/30 border border-white/10 text-sm text-slate-300">
                Target gym: <span className="font-black text-white">{gymActionModal.gym.gym_name}</span>
              </div>

              {gymActionModal.mode === 'status' && (
                <div>
                  <label className="text-xs uppercase tracking-widest font-black text-slate-400">Reason (optional)</label>
                  <textarea value={gymActionModal.reason} onChange={(e) => setGymActionModal((prev) => ({ ...prev, reason: e.target.value }))} className="mt-2 w-full min-h-[90px] px-3 py-2.5 rounded-xl bg-black/30 border border-white/10 text-sm" placeholder="Add action reason for audit logs" />
                </div>
              )}

              {gymActionModal.mode === 'delete' && (
                <div>
                  <label className="text-xs uppercase tracking-widest font-black text-slate-400">Type gym name to confirm</label>
                  <input value={gymActionModal.confirmText} onChange={(e) => setGymActionModal((prev) => ({ ...prev, confirmText: e.target.value }))} className="mt-2 w-full px-3 py-2.5 rounded-xl bg-black/30 border border-rose-500/30 text-sm" placeholder={gymActionModal.gym.gym_name} />
                </div>
              )}

              {gymActionModal.error && <p className="text-sm text-rose-400 font-semibold">{gymActionModal.error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={closeGymActionModal} className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-sm font-bold">Cancel</button>
                <button
                  onClick={runGymAction}
                  disabled={gymActionModal.busy}
                  className={`px-4 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60 ${gymActionModal.mode === 'delete' ? 'bg-rose-600 hover:bg-rose-500' : gymActionModal.mode === 'impersonate' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-amber-600 hover:bg-amber-500'}`}
                >
                  {gymActionModal.busy ? 'Processing...' : gymActionModal.mode === 'delete' ? 'Delete Gym' : gymActionModal.mode === 'impersonate' ? 'Continue' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SuperAdminDashboard;
