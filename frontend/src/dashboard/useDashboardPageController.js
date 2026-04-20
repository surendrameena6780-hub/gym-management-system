import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { copyCollectionText, describeCollectionLinkDelivery } from '../utils/memberCollection';
import { normalizeProfileImageUrl } from '../utils/profileImage';
import { reportClientError } from '../utils/clientErrorReporter';
import {
  formatHour,
  isValidPhoneInput,
  normalizePhoneInput,
  resolveBroadcastTemplateSuggestion,
} from './dashboardPageUtils';
import {
  buildBroadcastActionMeta as buildSharedBroadcastActionMeta,
  isDashboardActionCompleted,
  normalizeActionMembers,
  normalizeBroadcastTemplates,
} from './dashboardActionUtils';

const DASHBOARD_REQUEST_TIMEOUT_MS = 12000;
const MAX_WARMUP_RETRIES = 8;
const TERMINAL_RAZORPAY_LINK_STATUSES = new Set(['PAID', 'EXPIRED', 'CANCELLED', 'FAILED', 'NOT_FOUND']);

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

const getRazorpayLinkStatus = (paymentLink) => String(paymentLink?.status || '').trim().toUpperCase();

const canReuseRazorpayLink = (paymentLink) => Boolean(paymentLink?.id) && !TERMINAL_RAZORPAY_LINK_STATUSES.has(getRazorpayLinkStatus(paymentLink));

const mergeRazorpayContextPayload = (currentContext, nextPayload) => {
  const nextRoot = asObject(nextPayload, null);
  const nextPaymentLink = asObject(nextPayload?.payment_link, null);
  if (!nextRoot || !nextPaymentLink) {
    return currentContext;
  }

  return {
    ...asObject(currentContext, {}),
    ...nextRoot,
    payment_link: {
      ...asObject(currentContext?.payment_link, {}),
      ...nextPaymentLink,
    },
  };
};

const audienceToSegment = (audience) => ({
  All: 'ALL',
  Active: 'ACTIVE',
  Expiring: 'EXPIRING_7_DAYS',
  Ghosts: 'GHOSTS',
  Expired: 'EXPIRED',
  HighChurn: 'HIGH_CHURN',
}[audience] || 'ALL');

const normalizeActionPayments = (sourcePayments) => {
  const uniquePayments = new Map();

  asArray(sourcePayments).forEach((payment) => {
    const id = Number.parseInt(payment?.id, 10);
    if (!Number.isInteger(id) || uniquePayments.has(id)) return;
    uniquePayments.set(id, payment);
  });

  return Array.from(uniquePayments.values());
};

export default function useDashboardPageController({ appRuntime, setCurrentPage, isActive = true }) {
  const { token, toast, navigateTo: navTo, branchScopeValue } = appRuntime;
  const navigateTo = useMemo(() => navTo || ((...args) => setCurrentPage?.(...args)), [navTo, setCurrentPage]);

  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [payStats, setPayStats] = useState({ total_revenue: 0, today_revenue: 0, pending_dues: 0 });
  const [chart30, setChart30] = useState([]);
  const [chart7, setChart7] = useState([]);
  const [attendanceHeatmap, setAttendanceHeatmap] = useState([]);
  const [todayCheckins, setTodayCheckins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [chartDays, setChartDays] = useState(7);
  const [isAutomating, setIsAutomating] = useState(false);

  const [setup, setSetup] = useState({
    progress: 0,
    is_complete: false,
    steps: { profile: false, plans: false, members: false },
    recommended: { whatsapp: false, payments: false },
  });
  const [isWarmupRetrying, setIsWarmupRetrying] = useState(false);
  const warmupRetryTimerRef = useRef(null);
  const warmupRetryCountRef = useRef(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinQuery, setCheckinQuery] = useState('');
  const [checkinBusyMemberIds, setCheckinBusyMemberIds] = useState(() => new Set());
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState('');
  const quickActionTimerRef = useRef(null);
  const dashboardRefreshTimerRef = useRef(null);
  const dashboardFetchInFlightRef = useRef(false);
  const dashboardQueuedRefreshRef = useRef(false);
  const dashboardPendingRefreshRef = useRef(false);
  const dashboardLastSyncAtRef = useRef(0);
  const isDashboardActiveRef = useRef(Boolean(isActive));
  const checkinBusyIdsRef = useRef(new Set());
  const broadcastComposerRequestRef = useRef(null);
  const broadcastComposerLoadedRef = useRef(false);
  const paymentRazorpayPollBusyRef = useRef(false);

  const [addFormData, setAddFormData] = useState({ full_name: '', email: '', phone: '' });
  const [addFile, setAddFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [addSelectedPlanId, setAddSelectedPlanId] = useState('');
  const [selectedMemberForPay, setSelectedMemberForPay] = useState('');
  const [payMemberSearch, setPayMemberSearch] = useState('');
  const [payMemberDropdownOpen, setPayMemberDropdownOpen] = useState(false);
  const [selectedPlanForPay, setSelectedPlanForPay] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [paymentOnlineMode, setPaymentOnlineMode] = useState('RAZORPAY');
  const [paymentCollectionContext, setPaymentCollectionContext] = useState(null);
  const [paymentRazorpayContext, setPaymentRazorpayContext] = useState(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentStep, setPaymentStep] = useState('idle');
  const [broadcastAudience, setBroadcastAudience] = useState('All');
  const [broadcastTemplateKey, setBroadcastTemplateKey] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastCustomIds, setBroadcastCustomIds] = useState([]);
  const [broadcastTemplates, setBroadcastTemplates] = useState([]);
  const [broadcastActionMeta, setBroadcastActionMeta] = useState(null);
  const [gymName, setGymName] = useState('');
  const [gymBilling, setGymBilling] = useState({
    saas_status: 'FREE_TRIAL',
    saas_valid_until: '',
    current_plan: 'pro',
    saas_billing_cycle: 'monthly',
  });
  const [churnInsights, setChurnInsights] = useState({ summary: { high: 0, medium: 0, low: 0 }, members: [] });
  const [campaignLogs, setCampaignLogs] = useState([]);
  const [leadSummary, setLeadSummary] = useState({
    total: 0,
    open_leads: 0,
    new_leads: 0,
    follow_ups_due: 0,
    trials_today: 0,
    trial_booked: 0,
    converted_this_month: 0,
    lost_leads: 0,
  });

  const isAnyDashboardModalOpen = showAddModal || showPaymentModal || showBroadcastModal || showCheckinModal;
  const authHeaders = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);

  const getLatestGlobalDataChangeAt = useCallback(() => {
    if (typeof window === 'undefined') return 0;

    const memoryValue = Number(window.__gymvaultLastDataChangeAt || 0);
    let storedValue = 0;

    try {
      storedValue = Number(window.sessionStorage.getItem('gymvault:data-change-at') || 0);
    } catch {
      storedValue = 0;
    }

    return Math.max(memoryValue, storedValue, 0);
  }, []);

  useEffect(() => {
    isDashboardActiveRef.current = Boolean(isActive);
  }, [isActive]);

  useEffect(() => {
    if (!showBroadcastModal) {
      setBroadcastActionMeta(null);
    }
  }, [showBroadcastModal]);

  const closePaymentModal = useCallback(() => {
    setShowPaymentModal(false);
    setSelectedMemberForPay('');
    setPayMemberSearch('');
    setPayMemberDropdownOpen(false);
    setSelectedPlanForPay('');
    setPaymentMode('Cash');
    setPaymentOnlineMode('RAZORPAY');
    setPaymentCollectionContext(null);
    setPaymentRazorpayContext(null);
    setPaymentReference('');
    setPaymentStep('idle');
  }, []);

  const handleCopyPaymentCollectionDetail = useCallback(async (value, successMessage) => {
    const copied = await copyCollectionText(value);
    if (copied) {
      toast(successMessage, 'success');
      return;
    }
    toast('Copy failed on this device. Long-press and copy it manually.', 'warning');
  }, [toast]);

  const fetchData = useCallback(async () => {
    if (dashboardFetchInFlightRef.current) {
      dashboardQueuedRefreshRef.current = true;
      return;
    }

    dashboardFetchInFlightRef.current = true;

    try {
      const requestConfig = {
        ...authHeaders,
        timeout: DASHBOARD_REQUEST_TIMEOUT_MS,
        suppressGlobalErrorToast: true,
        params: branchScopeValue ? { branch_id: branchScopeValue } : undefined,
      };
      const [
        membersRes, plansRes, statsRes,
        chart30Res, chart7Res, attendanceRes,
        todayRes, setupRes, churnRes, logsRes,
        leadsSummaryRes,
        settingsRes,
      ] = await Promise.allSettled([
        axios.get('/api/members', requestConfig),
        axios.get('/api/memberships/plans', requestConfig),
        axios.get('/api/payments/stats', requestConfig),
        axios.get('/api/payments/chart?days=30', requestConfig),
        axios.get('/api/payments/chart?days=7', requestConfig),
        axios.get('/api/attendance/summary', requestConfig),
        axios.get('/api/attendance/today', requestConfig),
        axios.get('/api/dashboard/setup-status', requestConfig),
        axios.get('/api/notifications/campaign/churn-scores?limit=30', requestConfig),
        axios.get('/api/notifications/campaign/logs?limit=50', requestConfig),
        axios.get('/api/leads/summary', requestConfig),
        axios.get('/api/settings', requestConfig),
      ]);

      const pickData = (result, fallback) => {
        if (result.status !== 'fulfilled') return fallback;
        const unwrapped = unwrapApiData(result.value?.data);
        return unwrapped ?? fallback;
      };

      setMembers(asArray(pickData(membersRes, [])).map((member) => ({
        ...member,
        profile_pic: normalizeProfileImageUrl(member?.profile_pic),
      })));
      setPlans(asArray(pickData(plansRes, [])));
      setPayStats(asObject(pickData(statsRes, { total_revenue: 0, today_revenue: 0, pending_dues: 0 }), { total_revenue: 0, today_revenue: 0, pending_dues: 0 }));
      setChart30(asArray(pickData(chart30Res, [])));
      setChart7(asArray(pickData(chart7Res, [])));
      setAttendanceHeatmap(asArray(pickData(attendanceRes, [])));

      const todayData = pickData(todayRes, []);
      const normalizedTodayData = Array.isArray(todayData) ? todayData : [];
      setTodayAttendance(normalizedTodayData);
      setTodayCheckins(normalizedTodayData.length);
      setSetup(asObject(
        pickData(setupRes, {
          progress: 0,
          is_complete: false,
          steps: { profile: false, plans: false, members: false },
          recommended: { whatsapp: false, payments: false },
        }),
        {
          progress: 0,
          is_complete: false,
          steps: { profile: false, plans: false, members: false },
          recommended: { whatsapp: false, payments: false },
        },
      ));

      const settingsData = asObject(pickData(settingsRes, {}), {});
      const billingData = asObject(settingsData.gym, {});
      const resolvedGymName = String(billingData.name || settingsData.account?.gym_name || '').trim();
      if (resolvedGymName) {
        setGymName(resolvedGymName);
      }

      setGymBilling({
        saas_status: String(billingData.saas_status || 'FREE_TRIAL').toUpperCase(),
        saas_valid_until: String(billingData.saas_valid_until || ''),
        current_plan: String(billingData.current_plan || 'pro'),
        saas_billing_cycle: String(billingData.saas_billing_cycle || 'monthly'),
      });

      const churnData = asObject(pickData(churnRes, { summary: { high: 0, medium: 0, low: 0 }, members: [] }), { summary: { high: 0, medium: 0, low: 0 }, members: [] });
      setChurnInsights({
        summary: asObject(churnData.summary, { high: 0, medium: 0, low: 0 }),
        members: asArray(churnData.members),
      });
      setCampaignLogs(asArray(pickData(logsRes, [])));

      const fallbackLeadSummary = {
        total: 0,
        open_leads: 0,
        new_leads: 0,
        follow_ups_due: 0,
        trials_today: 0,
        trial_booked: 0,
        converted_this_month: 0,
        lost_leads: 0,
      };
      setLeadSummary(asObject(pickData(leadsSummaryRes, fallbackLeadSummary), fallbackLeadSummary));

      const requestResults = [
        membersRes,
        plansRes,
        statsRes,
        chart30Res,
        chart7Res,
        attendanceRes,
        todayRes,
        setupRes,
        churnRes,
        logsRes,
        leadsSummaryRes,
        settingsRes,
      ];
      const failedCalls = requestResults
        .filter((result) => result.status === 'rejected')
        .length;
      const successfulCalls = requestResults.length - failedCalls;

      if (failedCalls === requestResults.length && warmupRetryCountRef.current === 0) {
        toast?.('Server is waking up. Dashboard will retry automatically.', 'warning');
      }

      if (successfulCalls > 0) {
        setFetchError(null);
      }

      if (successfulCalls === 0 && warmupRetryCountRef.current < MAX_WARMUP_RETRIES) {
        warmupRetryCountRef.current += 1;
        setIsWarmupRetrying(true);
        const retryDelayMs = Math.min(4000 * warmupRetryCountRef.current, 30000);
        if (warmupRetryTimerRef.current) {
          window.clearTimeout(warmupRetryTimerRef.current);
        }
        warmupRetryTimerRef.current = window.setTimeout(() => {
          fetchData();
        }, retryDelayMs);
      } else {
        warmupRetryCountRef.current = 0;
        setIsWarmupRetrying(false);
        if (warmupRetryTimerRef.current) {
          window.clearTimeout(warmupRetryTimerRef.current);
          warmupRetryTimerRef.current = null;
        }
      }
    } catch (err) {
      reportClientError('Dashboard fetch', err);
      setFetchError(err);
    } finally {
      dashboardLastSyncAtRef.current = Date.now();
      dashboardFetchInFlightRef.current = false;
      setLoading(false);
      if (dashboardQueuedRefreshRef.current) {
        dashboardQueuedRefreshRef.current = false;
        window.setTimeout(() => {
          fetchData();
        }, 120);
      }
    }
  }, [authHeaders, branchScopeValue, toast]);

  const finalizeDashboardPaymentSuccess = useCallback(async (memberId) => {
    try {
      await axios.post('/api/attendance/checkin', { member_id: memberId, method: 'STAFF' }, authHeaders);
    } catch (_err) {
      // Attendance sync is best-effort here; payment success should still complete.
    }

    window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payment-modal' } }));
    setPaymentStep('success');
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    closePaymentModal();
    await fetchData();
  }, [authHeaders, closePaymentModal, fetchData]);

  const syncDashboardRazorpayContext = useCallback((payload) => {
    if (!payload?.payment_link) return;
    setPaymentRazorpayContext((current) => mergeRazorpayContextPayload(current, payload));
  }, []);

  const checkDashboardRazorpayStatus = useCallback(async ({ manual = false } = {}) => {
    const paymentLinkId = paymentRazorpayContext?.payment_link?.id;
    if (!selectedMemberForPay || !selectedPlanForPay || !paymentLinkId || paymentRazorpayPollBusyRef.current) {
      return false;
    }

    paymentRazorpayPollBusyRef.current = true;
    try {
      const statusRes = await axios.post(
        '/api/memberships/online/payment-link-status',
        {
          member_id: selectedMemberForPay,
          plan_id: selectedPlanForPay,
          payment_link_id: paymentLinkId,
        },
        authHeaders,
      );

      if (statusRes.data?.payment_link) {
        syncDashboardRazorpayContext(statusRes.data);
      }

      if (!statusRes.data?.paid) {
        const latestLinkStatus = getRazorpayLinkStatus(statusRes.data?.payment_link || paymentRazorpayContext?.payment_link);
        if (TERMINAL_RAZORPAY_LINK_STATUSES.has(latestLinkStatus) && latestLinkStatus !== 'PAID') {
          setPaymentStep('idle');
          if (manual) {
            toast?.(
              latestLinkStatus === 'NOT_FOUND'
                ? 'This Razorpay link is no longer available. Send a new link.'
                : `This Razorpay link is ${latestLinkStatus.toLowerCase()}. Send a new link.`,
              'warning',
            );
          }
          return false;
        }

        if (manual) {
          toast?.('Payment is still pending on Razorpay.', 'warning');
        }
        return false;
      }

      setPaymentStep('processing');
      await finalizeDashboardPaymentSuccess(selectedMemberForPay);
      return true;
    } catch (err) {
      if (manual) {
        toast?.(err?.response?.data?.error || 'Unable to verify Razorpay payment right now.', 'error');
      }
      return false;
    } finally {
      paymentRazorpayPollBusyRef.current = false;
    }
  }, [authHeaders, finalizeDashboardPaymentSuccess, paymentRazorpayContext, selectedMemberForPay, selectedPlanForPay, syncDashboardRazorpayContext, toast]);

  useEffect(() => {
    if (!showPaymentModal || paymentMode !== 'Online' || paymentOnlineMode !== 'RAZORPAY' || !canReuseRazorpayLink(paymentRazorpayContext?.payment_link)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      checkDashboardRazorpayStatus();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkDashboardRazorpayStatus, paymentMode, paymentOnlineMode, paymentRazorpayContext, showPaymentModal]);

  useEffect(() => {
    return () => {
      if (quickActionTimerRef.current) {
        window.clearTimeout(quickActionTimerRef.current);
      }
      if (dashboardRefreshTimerRef.current) {
        window.clearTimeout(dashboardRefreshTimerRef.current);
      }
      if (warmupRetryTimerRef.current) {
        window.clearTimeout(warmupRetryTimerRef.current);
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const root = document.documentElement;
    const syncModalClass = () => {
      root.classList.toggle('app-modal-open', Boolean(isActive && isAnyDashboardModalOpen));
    };

    syncModalClass();

    window.addEventListener('pageshow', syncModalClass);
    window.addEventListener('gymvault:app-resumed', syncModalClass);

    return () => {
      window.removeEventListener('pageshow', syncModalClass);
      window.removeEventListener('gymvault:app-resumed', syncModalClass);
      root.classList.remove('app-modal-open');
    };
  }, [isActive, isAnyDashboardModalOpen]);

  useEffect(() => {
    if (!token) return undefined;

    const handleExternalRefresh = (event) => {
      const eventAt = Number(event?.detail?.at || 0);
      const latestChangeAt = Math.max(eventAt, getLatestGlobalDataChangeAt(), Date.now());

      if (latestChangeAt > dashboardLastSyncAtRef.current) {
        dashboardPendingRefreshRef.current = true;
      }

      if (dashboardRefreshTimerRef.current) {
        window.clearTimeout(dashboardRefreshTimerRef.current);
      }

      dashboardRefreshTimerRef.current = window.setTimeout(() => {
        dashboardRefreshTimerRef.current = null;
        if (!dashboardPendingRefreshRef.current) return;
        dashboardPendingRefreshRef.current = false;
        fetchData();
      }, isDashboardActiveRef.current ? 80 : 220);
    };

    window.addEventListener('gymvault:data-changed', handleExternalRefresh);
    window.addEventListener('gymvault:app-resumed', handleExternalRefresh);

    return () => {
      window.removeEventListener('gymvault:data-changed', handleExternalRefresh);
      window.removeEventListener('gymvault:app-resumed', handleExternalRefresh);
    };
  }, [fetchData, getLatestGlobalDataChangeAt, token]);

  useEffect(() => {
    if (!token || !isActive) return undefined;

    const latestChangeAt = getLatestGlobalDataChangeAt();
    const shouldRefresh = dashboardLastSyncAtRef.current === 0
      || dashboardPendingRefreshRef.current
      || latestChangeAt > dashboardLastSyncAtRef.current;

    if (shouldRefresh) {
      dashboardPendingRefreshRef.current = false;
      fetchData();
    }

    return undefined;
  }, [fetchData, getLatestGlobalDataChangeAt, isActive, token]);

  const launchQuickAction = useCallback((actionKey, action) => {
    if (quickActionLoading) return;

    setQuickActionLoading(actionKey);
    if (quickActionTimerRef.current) {
      window.clearTimeout(quickActionTimerRef.current);
    }

    quickActionTimerRef.current = window.setTimeout(() => {
      action();
      setQuickActionLoading('');
      quickActionTimerRef.current = null;
    }, 40);
  }, [quickActionLoading]);

  const handleAddMember = useCallback(async (event) => {
    event.preventDefault();

    const normalizedPhone = normalizePhoneInput(addFormData.phone);
    if (!isValidPhoneInput(normalizedPhone)) {
      toast('Phone must be exactly 10 digits.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('full_name', addFormData.full_name);
    formData.append('email', addFormData.email);
    formData.append('phone', normalizedPhone);
    if (addFile) {
      formData.append('profile_pic', addFile);
    }

    try {
      setAddSubmitting(true);
      const res = await axios.post('/api/members/add', formData, authHeaders);
      setShowAddModal(false);

      const newMember = res.data;
      window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
        detail: {
          source: 'dashboard-add-member',
          member_id: newMember?.id || null,
          at: Date.now(),
        },
      }));

      setAddFormData({ full_name: '', email: '', phone: '' });
      setAddFile(null);
      setPreviewUrl(null);
      toast('Member added successfully!', 'success');
      fetchData();

      if (addSelectedPlanId && newMember) {
        setSelectedMemberForPay(newMember.id);
        setSelectedPlanForPay(addSelectedPlanId);
        setShowPaymentModal(true);
      }
      setAddSelectedPlanId('');
    } catch (err) {
      toast(err.response?.data?.error || 'Error adding member.', 'error');
    } finally {
      setAddSubmitting(false);
    }
  }, [addFile, addFormData, addSelectedPlanId, authHeaders, fetchData, toast]);

  const handlePayment = useCallback(async (event) => {
    event.preventDefault();
    if (!selectedMemberForPay || !selectedPlanForPay) {
      toast('Please select a member and a plan.', 'warning');
      return;
    }

    setPaymentSubmitting(true);
    try {
      if (paymentMode === 'Online') {
        if (paymentOnlineMode === 'UPI') {
          if (!paymentCollectionContext) {
            const collectionRes = await axios.post('/api/memberships/online/create-order', {
              member_id: selectedMemberForPay,
              plan_id: selectedPlanForPay,
            }, authHeaders);

            const collection = collectionRes.data?.collection;
            if (!collection?.upi_id) {
              toast('Direct UPI QR is not configured. Add a collection UPI ID in Integrations or use Razorpay collection.', 'error');
              setPaymentStep('idle');
              return;
            }

            setPaymentCollectionContext(collection);
            setPaymentRazorpayContext(null);
            setPaymentReference(collection.reference || '');
            toast('Show this direct UPI QR to the member, then confirm once payment is received.', 'success');
            return;
          }

          const paidMemberId = selectedMemberForPay;
          setPaymentStep('processing');
          await axios.post('/api/memberships/activate', {
            member_id: paidMemberId,
            plan_id: selectedPlanForPay,
            payment_mode: 'Online',
            payment_id: paymentReference || paymentCollectionContext.reference || null,
          }, authHeaders);
          await finalizeDashboardPaymentSuccess(paidMemberId);
          return;
        }

        if (canReuseRazorpayLink(paymentRazorpayContext?.payment_link)) {
          await checkDashboardRazorpayStatus({ manual: true });
          return;
        }

        if (paymentRazorpayContext?.payment_link?.id) {
          setPaymentRazorpayContext(null);
        }

        setPaymentStep('processing');

        const orderRes = await axios.post('/api/memberships/online/create-order', {
          member_id: selectedMemberForPay,
          plan_id: selectedPlanForPay,
        }, authHeaders);

        const razorpay = orderRes.data?.razorpay;
        const paymentLink = razorpay?.payment_link;
        if (!paymentLink?.id || !paymentLink?.short_url) {
          toast('Razorpay collection is not configured. Add Razorpay keys/connect in Integrations or use Direct UPI.', 'error');
          setPaymentStep('idle');
          return;
        }

        setPaymentCollectionContext(null);
        setPaymentRazorpayContext(razorpay);
        setPaymentStep('idle');

        if (String(paymentLink.environment || '').toUpperCase() === 'TEST') {
          toast('Razorpay is currently using test mode for this link. Live payments will not complete until live credentials are configured.', 'warning');
        }

        const delivery = describeCollectionLinkDelivery(paymentLink);
        toast(
          delivery.label === 'Manual share required'
            ? 'Razorpay QR is ready. Since no member phone or email is saved, share the link manually.'
            : `${delivery.label} and QR is ready on this screen.`,
          'success',
        );
        return;
      }

      const paidMemberId = selectedMemberForPay;
      setPaymentStep('processing');
      await axios.post('/api/memberships/activate', {
        member_id: paidMemberId,
        plan_id: selectedPlanForPay,
        payment_mode: paymentMode,
        payment_id: null,
      }, authHeaders);
      await finalizeDashboardPaymentSuccess(paidMemberId);
    } catch (err) {
      toast(err?.response?.data?.error || 'Payment recording failed.', 'error');
      setPaymentStep('idle');
    } finally {
      setPaymentSubmitting(false);
    }
  }, [
    authHeaders,
    checkDashboardRazorpayStatus,
    finalizeDashboardPaymentSuccess,
    paymentCollectionContext,
    paymentMode,
    paymentOnlineMode,
    paymentRazorpayContext,
    paymentReference,
    selectedMemberForPay,
    selectedPlanForPay,
    toast,
  ]);

  const ensureBroadcastComposer = useCallback(async ({ preferCache = true } = {}) => {
    if (!token) return [];
    if (preferCache && broadcastComposerLoadedRef.current) {
      return broadcastTemplates;
    }
    if (broadcastComposerRequestRef.current) {
      return broadcastComposerRequestRef.current;
    }

    const requestConfig = { ...authHeaders, timeout: DASHBOARD_REQUEST_TIMEOUT_MS };
    const request = axios.get('/api/notifications/campaign/composer', requestConfig)
      .then((res) => {
        const payload = asObject(unwrapApiData(res.data), {});
        const templates = normalizeBroadcastTemplates(payload.templates);
        const nextGymName = String(payload.gym_name || '').trim();

        setBroadcastTemplates(templates);
        if (nextGymName) {
          setGymName(nextGymName);
        }
        broadcastComposerLoadedRef.current = true;
        return templates;
      })
      .finally(() => {
        broadcastComposerRequestRef.current = null;
      });

    broadcastComposerRequestRef.current = request;
    return request;
  }, [authHeaders, broadcastTemplates, token]);

  useEffect(() => {
    if (!token) return;
    ensureBroadcastComposer({ preferCache: true }).catch(() => {});
  }, [ensureBroadcastComposer, token]);

  useEffect(() => {
    if (!showBroadcastModal) return;
    ensureBroadcastComposer({ preferCache: false }).catch(() => {});
  }, [ensureBroadcastComposer, showBroadcastModal]);

  useEffect(() => {
    if (!token || !isActive) return undefined;

    const handleTemplateStateRefresh = (event) => {
      if (event?.detail?.scope && event.detail.scope !== 'messaging-templates') {
        return;
      }

      broadcastComposerLoadedRef.current = false;
      broadcastComposerRequestRef.current = null;
      setBroadcastTemplates([]);

      if (showBroadcastModal) {
        ensureBroadcastComposer({ preferCache: false }).catch(() => {});
      }
    };

    window.addEventListener('gymvault:data-changed', handleTemplateStateRefresh);
    return () => {
      window.removeEventListener('gymvault:data-changed', handleTemplateStateRefresh);
    };
  }, [ensureBroadcastComposer, isActive, showBroadcastModal, token]);

  useEffect(() => {
    if (!showBroadcastModal || broadcastTemplates.length === 0) return;

    const hasCurrentTemplate = broadcastTemplates.some((item) => item.template_key === broadcastTemplateKey);
    if (broadcastTemplateKey && hasCurrentTemplate) {
      return;
    }

    const suggestedKey = resolveBroadcastTemplateSuggestion(broadcastAudience);
    const nextTemplate = broadcastTemplates.find((item) => item.template_key === suggestedKey) || broadcastTemplates[0] || null;
    setBroadcastTemplateKey(nextTemplate?.template_key || '');
  }, [broadcastAudience, broadcastTemplateKey, broadcastTemplates, showBroadcastModal]);

  useEffect(() => {
    if (!broadcastTemplateKey) {
      setBroadcastMessage('');
      return;
    }

    const selected = broadcastTemplates.find((item) => item.template_key === broadcastTemplateKey);
    if (!selected) {
      setBroadcastMessage('');
      return;
    }

    let resolved = String(selected.whatsapp_text || '');
    if (gymName) {
      resolved = resolved.replace(/\{\{gym_name\}\}/gi, gymName);
    }
    setBroadcastMessage(resolved);
  }, [broadcastTemplateKey, broadcastTemplates, gymName]);

  const buildBroadcastActionMeta = useCallback((payload) => buildSharedBroadcastActionMeta(payload), []);

  const isBroadcastActionCompleted = useCallback((actionMeta) => {
    return isDashboardActionCompleted(campaignLogs, actionMeta);
  }, [campaignLogs]);

  const openBroadcastDraft = useCallback((audience, _message, actionMeta = null) => {
    setBroadcastAudience(audience);
    setBroadcastTemplateKey(resolveBroadcastTemplateSuggestion(audience));
    setBroadcastSearch('');
    setBroadcastCustomIds([]);
    setBroadcastMessage('');
    setBroadcastActionMeta(actionMeta || null);
    setShowBroadcastModal(true);
    ensureBroadcastComposer({ preferCache: false }).catch(() => {});
  }, [ensureBroadcastComposer]);

  const openBroadcastDraftForMembers = useCallback(({ memberIds = [], audience = 'All', actionMeta = null }) => {
    const normalizedIds = Array.from(new Set(
      asArray(memberIds)
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id)),
    ));

    setBroadcastAudience(audience);
    setBroadcastTemplateKey(resolveBroadcastTemplateSuggestion(audience));
    setBroadcastSearch('');
    setBroadcastCustomIds(normalizedIds);
    setBroadcastMessage('');
    setBroadcastActionMeta(actionMeta || null);
    setShowBroadcastModal(true);
    ensureBroadcastComposer({ preferCache: false }).catch(() => {});
  }, [ensureBroadcastComposer]);

  const buildSmartMemberCta = useCallback(({
    members: sourceMembers,
    singleFilter = 'All',
    singleOptions = {},
    singleCta = 'Open Member',
    bulkCta = 'Open Bulk Reminder',
    bulkMessage = '',
    bulkAudience = 'All',
    campaignActionKey = '',
    fallbackAction,
  }) => {
    const normalizedMembers = normalizeActionMembers(sourceMembers);
    const count = normalizedMembers.length;
    const completionMeta = buildBroadcastActionMeta({
      actionKey: campaignActionKey,
      members: normalizedMembers,
    });
    const isCompleted = isBroadcastActionCompleted(completionMeta);

    if (count === 0) {
      return {
        members: normalizedMembers,
        count,
        completionMeta,
        isCompleted,
        cta: bulkCta,
        action: fallbackAction || (() => {}),
      };
    }

    if (count === 1) {
      const target = normalizedMembers[0];
      return {
        members: normalizedMembers,
        count,
        completionMeta,
        isCompleted: false,
        cta: singleCta,
        action: () => navigateTo('Members', singleFilter, {
          memberId: target.id,
          ...(singleOptions || {}),
        }),
      };
    }

    return {
      members: normalizedMembers,
      count,
      completionMeta,
      isCompleted,
      cta: bulkCta,
      action: () => openBroadcastDraftForMembers({
        memberIds: normalizedMembers.map((member) => member.id),
        message: bulkMessage,
        audience: bulkAudience,
        actionMeta: completionMeta,
      }),
    };
  }, [buildBroadcastActionMeta, isBroadcastActionCompleted, navigateTo, openBroadcastDraftForMembers]);

  const buildSmartPaymentCta = useCallback(({
    payments: sourcePayments,
    members: sourceMembers = [],
    singleCta = 'Collect Due',
    bulkCta = 'Open Pending Dues',
    fallbackAction,
  }) => {
    const payments = normalizeActionPayments(sourcePayments);
    const normalizedMembers = normalizeActionMembers(sourceMembers.length > 0 ? sourceMembers : payments.map((payment) => payment.member).filter(Boolean));
    const count = payments.length;

    if (count === 0) {
      return {
        payments,
        members: normalizedMembers,
        count,
        cta: bulkCta,
        action: fallbackAction || (() => navigateTo('Payments', 'Pending')),
      };
    }

    if (count === 1) {
      const target = payments[0];
      return {
        payments,
        members: normalizedMembers,
        count,
        cta: singleCta,
        action: () => navigateTo('Payments', 'Pending', {
          paymentId: target.id,
          action: 'collectDue',
        }),
      };
    }

    return {
      payments,
      members: normalizedMembers,
      count,
      cta: bulkCta,
      action: () => navigateTo('Payments', 'Pending'),
    };
  }, [navigateTo]);

  const handleBroadcast = useCallback(async (event) => {
    event.preventDefault();
    if (!broadcastTemplateKey) {
      toast('Select an approved WhatsApp template before sending the broadcast.', 'warning');
      return;
    }

    try {
      setIsAutomating(true);
      const segment = audienceToSegment(broadcastAudience);
      const res = await axios.post('/api/notifications/campaign/run', {
        segment,
        channel: 'WHATSAPP',
        template_key: broadcastTemplateKey || undefined,
        message: broadcastMessage,
        member_ids: broadcastCustomIds,
        dashboard_action_key: broadcastActionMeta?.actionKey || undefined,
        dashboard_audience_hash: broadcastActionMeta?.audienceHash || undefined,
        dashboard_expected_count: broadcastActionMeta?.expectedCount || undefined,
      }, authHeaders);

      const payload = unwrapApiData(res.data) || {};
      const failed = Number(payload.failed_count || 0);
      const delivered = Number(payload.sent_to_count || 0);
      const statusLine = failed > 0
        ? `Campaign delivered to ${delivered} members, ${failed} failed.`
        : `Campaign delivered to ${delivered} members.`;

      toast(statusLine, failed > 0 ? 'warning' : 'success');
      setShowBroadcastModal(false);
      setBroadcastTemplateKey('');
      setBroadcastMessage('');
      setBroadcastSearch('');
      setBroadcastCustomIds([]);
      setBroadcastActionMeta(null);
      fetchData();
    } catch (err) {
      toast(err?.response?.data?.error || 'Broadcast send failed.', 'error');
    } finally {
      setIsAutomating(false);
    }
  }, [authHeaders, broadcastAudience, broadcastCustomIds, broadcastMessage, broadcastTemplateKey, fetchData, toast]);

  const checkedInMemberIds = useMemo(() => new Set(
    todayAttendance
      .map((row) => Number(row.member_id))
      .filter((id) => Number.isFinite(id)),
  ), [todayAttendance]);

  const setCheckinBusyState = useCallback((memberId, isBusy) => {
    const normalizedId = Number(memberId);
    if (!Number.isInteger(normalizedId)) return;

    if (isBusy) {
      checkinBusyIdsRef.current.add(normalizedId);
    } else {
      checkinBusyIdsRef.current.delete(normalizedId);
    }

    setCheckinBusyMemberIds(new Set(checkinBusyIdsRef.current));
  }, []);

  const queueDashboardRefresh = useCallback((delayMs = 900) => {
    if (dashboardRefreshTimerRef.current) {
      return;
    }

    dashboardRefreshTimerRef.current = window.setTimeout(() => {
      dashboardRefreshTimerRef.current = null;
      fetchData().catch(() => {});
    }, delayMs);
  }, [fetchData]);

  const applyLocalDashboardCheckin = useCallback((member, payload = {}) => {
    const fallbackMember = asObject(member, {});
    const resolvedMember = {
      ...fallbackMember,
      ...asObject(payload.member, {}),
    };
    const memberId = Number(resolvedMember.id || fallbackMember.id);
    if (!Number.isInteger(memberId)) return;

    const details = asObject(payload.details, {});
    const checkInTime = details.check_in_time || new Date().toISOString();

    setTodayAttendance((prev) => {
      if (prev.some((row) => Number(row.member_id) === memberId)) {
        return prev;
      }

      return [{
        id: details.id || `dash-checkin-${memberId}-${Date.now()}`,
        member_id: memberId,
        full_name: resolvedMember.full_name || fallbackMember.full_name || '',
        check_in_time: checkInTime,
        checkin_method: details.checkin_method || 'STAFF',
        profile_pic: resolvedMember.profile_pic || fallbackMember.profile_pic || '',
        branch_id: details.branch_id || resolvedMember.branch_id || fallbackMember.branch_id || null,
      }, ...prev];
    });

    if (!checkedInMemberIds.has(memberId)) {
      setTodayCheckins((prev) => prev + 1);
    }

    setMembers((prev) => prev.map((existing) => (
      Number(existing.id) === memberId
        ? { ...existing, last_visit: checkInTime }
        : existing
    )));
  }, [checkedInMemberIds]);

  const handleQuickCheckIn = useCallback(async (member) => {
    const memberId = Number(member?.id);
    if (!Number.isInteger(memberId)) return;
    if (checkedInMemberIds.has(memberId) || checkinBusyIdsRef.current.has(memberId)) return;

    setCheckinBusyState(memberId, true);
    try {
      const res = await axios.post('/api/attendance/checkin', {
        member_id: memberId,
        method: 'STAFF',
      }, authHeaders);

      applyLocalDashboardCheckin(member, asObject(unwrapApiData(res.data), {}));
      toast?.(`Checked in ${member.full_name}.`, 'success');
      queueDashboardRefresh();
      window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'dashboard-checkin' } }));
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});

      if (errorBody.code === 'DUPLICATE_CHECKIN') {
        applyLocalDashboardCheckin(member, {
          member,
          details: {
            check_in_time: errorBody.last_checkin_time || new Date().toISOString(),
            checkin_method: 'STAFF',
          },
        });
        toast?.(`${member.full_name} is already checked in.`, 'warning');
        queueDashboardRefresh(250);
      } else {
        toast?.(errorBody.message || errorBody.error || 'Check-in failed.', 'error');
      }
    } finally {
      setCheckinBusyState(memberId, false);
    }
  }, [applyLocalDashboardCheckin, authHeaders, checkedInMemberIds, queueDashboardRefresh, setCheckinBusyState, toast]);

  const dashboardData = useMemo(() => {
    const today = new Date();
    const toDayAge = (value) => {
      if (!value) return 999;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 999;
      return Math.floor((today - date) / 86400000);
    };
    const getLatestPayment = (member) => Array.isArray(member.payment_history) ? member.payment_history[0] : null;
    const getLatestPendingDue = (member) => {
      const latestPayment = getLatestPayment(member);
      if (!latestPayment) return null;
      return String(latestPayment.status || '').toLowerCase() === 'pending' && Number(latestPayment.amount_due || 0) > 0
        ? latestPayment
        : null;
    };
    const hasRecentActivation = (member) => {
      const latestPayment = getLatestPayment(member);
      const activationReference = latestPayment?.payment_date || member.joining_date;
      return toDayAge(activationReference) <= 14;
    };
    const getDaysAbsent = (member) => {
      const latestPayment = getLatestPayment(member);
      const effectiveVisitSource = member.last_visit || latestPayment?.payment_date || null;
      return effectiveVisitSource ? toDayAge(effectiveVisitSource) : 999;
    };

    const active = members.filter((member) => member.membership_status === 'ACTIVE');
    const pendingDueMembers = members.filter((member) => !!getLatestPendingDue(member));
    const pendingDuePayments = pendingDueMembers
      .map((member) => {
        const latestPayment = getLatestPendingDue(member);
        return latestPayment ? { ...latestPayment, member } : null;
      })
      .filter(Boolean);
    const pendingDueMemberIds = new Set(pendingDueMembers.map((member) => member.id));
    const unpaid = members.filter((member) => member.membership_status === 'UNPAID' && !pendingDueMemberIds.has(member.id));
    const expired = members.filter((member) => member.membership_status === 'EXPIRED');

    const expiringIn3Days = active.filter((member) => member.days_left > 0 && member.days_left <= 3);
    const expiringIn7Days = active.filter((member) => member.days_left > 0 && member.days_left <= 7);

    const ghosts = active.filter((member) => {
      if (member.days_left <= 7 || hasRecentActivation(member)) return false;
      return getDaysAbsent(member) > 14;
    });

    const pendingDueValue = pendingDuePayments.reduce((sum, payment) => sum + Number(payment?.amount_due || 0), 0);
    const revenueAtRisk = expiringIn7Days.reduce((sum, member) => {
      const plan = plans.find((item) => item.name === member.plan_name);
      return sum + Number.parseFloat(plan?.price || 0);
    }, 0);

    const monthlyRevenue = chart30.reduce((sum, day) => sum + (day.revenue || 0), 0);
    const healthScore = members.length > 0 ? Math.round((active.length / members.length) * 100) : 0;
    const pendingDues = Number(payStats.pending_dues || 0);
    const normalizedLeadSummary = asObject(leadSummary, {
      total: 0,
      open_leads: 0,
      new_leads: 0,
      follow_ups_due: 0,
      trials_today: 0,
      trial_booked: 0,
      converted_this_month: 0,
      lost_leads: 0,
    });
    const openLeads = Number(normalizedLeadSummary.open_leads || 0);
    const newLeads = Number(normalizedLeadSummary.new_leads || 0);
    const followUpsDue = Number(normalizedLeadSummary.follow_ups_due || 0);
    const trialsToday = Number(normalizedLeadSummary.trials_today || 0);
    const trialBooked = Number(normalizedLeadSummary.trial_booked || 0);

    const planCounts = {};
    members.forEach((member) => {
      if (member.plan_name) {
        planCounts[member.plan_name] = (planCounts[member.plan_name] || 0) + 1;
      }
    });
    const topPlanEntry = Object.entries(planCounts).sort((a, b) => b[1] - a[1])[0] || null;
    const topPlanPct = topPlanEntry && members.length > 0 ? Math.round((topPlanEntry[1] / members.length) * 100) : 0;

    const heatmap = attendanceHeatmap.map((day) => ({ t: formatHour(day.hour), v: day.count }));

    const avgPlanPrice = plans.length > 0
      ? Math.round(plans.reduce((sum, plan) => sum + Number(plan.price || 0), 0) / plans.length)
      : 1500;
    const planPriceByName = new Map(plans.map((plan) => [String(plan.name || ''), Number(plan.price || 0)]));
    const todayStartDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const accessValidUntil = gymBilling.saas_valid_until ? new Date(gymBilling.saas_valid_until) : null;
    const hasValidAccessDate = Boolean(accessValidUntil && !Number.isNaN(accessValidUntil.getTime()));
    const accessExpiryDay = hasValidAccessDate
      ? new Date(accessValidUntil.getFullYear(), accessValidUntil.getMonth(), accessValidUntil.getDate())
      : null;
    const accessDaysRemaining = accessExpiryDay
      ? Math.ceil((accessExpiryDay.getTime() - todayStartDate.getTime()) / 86400000)
      : null;
    const accessDerivedStatus = (() => {
      if (!hasValidAccessDate || gymBilling.saas_status === 'FREE_TRIAL') return 'FREE_TRIAL';
      const diffDays = (accessValidUntil.getTime() - today.getTime()) / 86400000;
      if (gymBilling.saas_status === 'EXPIRED' || diffDays <= -3) return 'EXPIRED';
      if (gymBilling.saas_status === 'GRACE_PERIOD' || (diffDays < 0 && diffDays > -3)) return 'GRACE_PERIOD';
      return 'ACTIVE';
    })();
    const accessExpiryLabel = hasValidAccessDate
      ? accessValidUntil.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : '';
    const estimateMemberValue = (member) => {
      const byPlan = planPriceByName.get(String(member?.plan_name || ''));
      if (Number.isFinite(byPlan) && byPlan > 0) return byPlan;
      return avgPlanPrice;
    };

    const immediateRiskAmount = expiringIn3Days.reduce((sum, member) => sum + estimateMemberValue(member), 0);
    const highChurnMembers = (churnInsights.members || []).filter((member) => String(member.churn_tier).toUpperCase() === 'HIGH');
    const highChurnRiskAmount = highChurnMembers.reduce((sum, member) => sum + estimateMemberValue(member), 0);
    const ghostRiskAmount = ghosts.reduce((sum, member) => sum + Math.round(estimateMemberValue(member) * 0.65), 0);
    const expiredWinbackValue = Math.round(expired.length * avgPlanPrice * 0.5);
    const expiringFollowupMembers = expiringIn7Days.filter((member) => member.days_left > 3);
    const expiringFollowupRiskAmount = expiringFollowupMembers.reduce((sum, member) => sum + estimateMemberValue(member), 0);
    const leadFollowupValue = Math.round(Math.max(avgPlanPrice, followUpsDue * avgPlanPrice * 0.38));
    const leadPipelineValue = Math.round(Math.max(avgPlanPrice, openLeads * avgPlanPrice * 0.24));
    const trialsTodayValue = Math.round(Math.max(avgPlanPrice, trialsToday * avgPlanPrice * 0.55));

    const reminderMessages = {
      highChurn: 'Hi {{name}}, we noticed your routine at {{gym_name}} has slowed down. Reply and we will help you with the right plan to get back on track.',
      expiringImmediate: 'Hi {{name}}, your membership at {{gym_name}} expires in the next 3 days. Renew now to continue without interruption.',
      expiringSoon: 'Hi {{name}}, your membership at {{gym_name}} expires this week. Renew in time to keep your plan active.',
      expired: 'Hi {{name}}, your membership at {{gym_name}} has expired. Reply if you want help restarting with the best plan for you.',
      inactive: 'Hi {{name}}, we have missed you at {{gym_name}}. Reply if you want help getting back into your routine.',
      unpaid: 'Hi {{name}}, your membership at {{gym_name}} is still waiting for activation. Please complete your payment to start your plan.',
      pendingDue: 'Hi {{name}}, you still have a pending balance for your membership at {{gym_name}}. Please clear the due amount to keep your plan up to date.',
    };

    const highChurnCta = buildSmartMemberCta({
      members: highChurnMembers,
      singleFilter: 'All',
      bulkMessage: reminderMessages.highChurn,
      bulkAudience: 'HighChurn',
      bulkCta: 'Open Bulk Broadcast',
      campaignActionKey: 'HIGH_CHURN_BROADCAST',
    });
    const expiringImmediateCta = buildSmartMemberCta({
      members: expiringIn3Days,
      singleFilter: 'Expiring Soon',
      bulkMessage: reminderMessages.expiringImmediate,
      bulkAudience: 'Expiring',
      bulkCta: 'Open Renewal Broadcast',
      campaignActionKey: 'EXPIRING_IMMEDIATE_BROADCAST',
    });
    const expiringSoonCta = buildSmartMemberCta({
      members: expiringFollowupMembers,
      singleFilter: 'Expiring Soon',
      bulkMessage: reminderMessages.expiringSoon,
      bulkAudience: 'Expiring',
      bulkCta: 'Open Bulk Reminder',
      campaignActionKey: 'EXPIRING_SOON_BROADCAST',
    });
    const expiredCta = buildSmartMemberCta({
      members: expired,
      singleFilter: 'Expired',
      bulkMessage: reminderMessages.expired,
      bulkAudience: 'Expired',
      bulkCta: 'Open Winback Broadcast',
      campaignActionKey: 'EXPIRED_WINBACK_BROADCAST',
    });
    const ghostCta = buildSmartMemberCta({
      members: ghosts,
      singleFilter: 'Inactive',
      bulkMessage: reminderMessages.inactive,
      bulkAudience: 'Ghosts',
      bulkCta: 'Open Bulk Follow-up',
      campaignActionKey: 'GHOST_REACTIVATION_BROADCAST',
    });
    const unpaidCta = buildSmartMemberCta({
      members: unpaid,
      singleFilter: 'Unpaid',
      bulkMessage: reminderMessages.unpaid,
      bulkAudience: 'All',
      bulkCta: 'Open Bulk Reminder',
      campaignActionKey: 'UNPAID_ACTIVATION_BROADCAST',
    });
    const pendingDueCta = buildSmartPaymentCta({
      payments: pendingDuePayments,
      members: pendingDueMembers,
      singleCta: 'Collect Due',
      bulkCta: 'Open Pending Dues',
      fallbackAction: () => navigateTo('Payments'),
    });

    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const sentToday = campaignLogs
      .filter((log) => {
        const created = new Date(log.created_at).getTime();
        return Number.isFinite(created) && created >= startOfDay;
      })
      .reduce((sum, log) => sum + Number(log.sent_to_count || 0), 0);
    const runsToday = campaignLogs.filter((log) => {
      const created = new Date(log.created_at).getTime();
      return Number.isFinite(created) && created >= startOfDay;
    }).length;

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const weeklyLogs = campaignLogs.filter((log) => {
      const created = new Date(log.created_at).getTime();
      return Number.isFinite(created) && created >= sevenDaysAgo;
    });
    const weeklyRuns = weeklyLogs.length;
    const weeklySent = weeklyLogs.reduce((sum, log) => sum + Number(log.sent_to_count || 0), 0);
    const estimatedRecoveryValue = Math.round(weeklySent * avgPlanPrice * 0.12);
    const lastAutomationAt = campaignLogs[0]?.created_at || null;
    const lastAutomationLabel = lastAutomationAt
      ? new Date(lastAutomationAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : 'No runs yet';

    const incompleteSetupSteps = Object.entries(setup.steps || {})
      .filter(([, isDone]) => !isDone)
      .map(([key]) => key);
    const recommendedSetup = asObject(setup.recommended, { whatsapp: false, payments: false });
    const setupStepLabels = {
      profile: 'business profile',
      plans: 'plan catalog',
      members: 'member base',
    };
    const nextSetupStep = incompleteSetupSteps[0] || null;
    const setupActionRows = [
      !setup.steps?.profile && {
        id: 'SETUP_PROFILE',
        title: 'Complete your business profile',
        description: 'Add your gym address and at least one member-facing contact detail before you start collecting members and payments.',
        cta: 'Open Settings',
        action: () => navigateTo('Settings', 'account'),
      },
      !setup.steps?.plans && {
        id: 'SETUP_PLAN',
        title: 'Add your first plan',
        description: 'Create the membership plans you want to sell before enrolling members.',
        cta: 'Create Plan',
        action: () => navigateTo('Plans'),
      },
      !setup.steps?.members && {
        id: 'SETUP_MEMBER',
        title: 'Add your first member',
        description: 'Create the first member profile to start attendance, renewals, and due tracking.',
        cta: 'Add Member',
        action: () => setShowAddModal(true),
      },
      !recommendedSetup.whatsapp && {
        id: 'SETUP_WHATSAPP',
        title: 'Connect WhatsApp reminders',
        description: 'Link your gym WhatsApp number to automate reminders, campaigns, and reply capture.',
        cta: 'Open Integrations',
        action: () => navigateTo('Settings', 'integrations'),
      },
      !recommendedSetup.payments && {
        id: 'SETUP_PAYMENTS',
        title: 'Set up payment collection',
        description: 'Add your UPI ID or payment gateway so activations and dues can be collected smoothly.',
        cta: 'Set Up Payments',
        action: () => navigateTo('Settings', 'integrations'),
      },
    ].filter(Boolean);
    const targetTodayTraffic = active.length > 0 ? Math.max(3, Math.round(active.length * 0.14)) : 3;
    const trafficGap = Math.max(0, targetTodayTraffic - todayCheckins);

    const buildRecommendation = ({
      id,
      title,
      reason,
      count,
      members: recommendationMembers,
      impact,
      confidence,
      urgency,
      priority,
      cta,
      action,
      sub,
    }) => {
      const priorityBoost = priority === 'P0' ? 2400 : priority === 'P1' ? 1100 : 400;
      const score = Math.round((impact || 0) * (confidence / 100) + priorityBoost + (count || 0) * 25);
      return {
        id,
        title,
        reason,
        count,
        members: recommendationMembers,
        impact,
        confidence,
        urgency,
        priority,
        cta,
        action,
        sub,
        score,
      };
    };

    const leadPipelineReason = [
      `${openLeads} open lead${openLeads === 1 ? '' : 's'} in the pipeline`,
      newLeads > 0 ? `${newLeads} new` : '',
      trialBooked > 0 ? `${trialBooked} trial${trialBooked === 1 ? '' : 's'} booked` : '',
    ].filter(Boolean).join(' · ');

    const aiCandidates = [
      !highChurnCta.isCompleted && buildRecommendation({
        id: 'HIGH_CHURN',
        title: 'Launch retention for high-churn members',
        reason: `${highChurnCta.count} member${highChurnCta.count === 1 ? ' is' : 's are'} in HIGH churn tier`,
        count: highChurnCta.count,
        members: highChurnCta.members,
        impact: highChurnRiskAmount,
        confidence: Math.min(95, 74 + highChurnMembers.length * 2),
        urgency: 'Today',
        priority: 'P0',
        cta: highChurnCta.cta,
        sub: 'Prevent churn before expiry',
        action: highChurnCta.action,
      }),
      !expiringImmediateCta.isCompleted && buildRecommendation({
        id: 'EXPIRING_72H',
        title: 'Renew plans expiring in 72 hours',
        reason: `${expiringImmediateCta.count} membership${expiringImmediateCta.count === 1 ? '' : 's'} will expire within 3 days`,
        count: expiringImmediateCta.count,
        members: expiringImmediateCta.members,
        impact: immediateRiskAmount,
        confidence: Math.min(94, 70 + expiringIn3Days.length * 2),
        urgency: 'Today',
        priority: 'P0',
        cta: expiringImmediateCta.cta,
        sub: 'Renew these today',
        action: expiringImmediateCta.action,
      }),
      !expiringSoonCta.isCompleted && buildRecommendation({
        id: 'EXPIRING_7D',
        title: 'Follow up on memberships expiring this week',
        reason: `${expiringSoonCta.count} membership${expiringSoonCta.count === 1 ? '' : 's'} expire within 7 days`,
        count: expiringSoonCta.count,
        members: expiringSoonCta.members,
        impact: expiringFollowupRiskAmount,
        confidence: Math.min(90, 66 + expiringIn7Days.length * 2),
        urgency: 'This week',
        priority: 'P1',
        cta: expiringSoonCta.cta,
        sub: 'Follow up this week',
        action: expiringSoonCta.action,
      }),
      !expiredCta.isCompleted && buildRecommendation({
        id: 'EXPIRED_WINBACK',
        title: 'Win back expired members',
        reason: `${expiredCta.count} member${expiredCta.count === 1 ? ' is' : 's are'} already expired`,
        count: expiredCta.count,
        members: expiredCta.members,
        impact: expiredWinbackValue,
        confidence: Math.min(90, 62 + expired.length),
        urgency: 'This week',
        priority: 'P1',
        cta: expiredCta.cta,
        sub: 'Bring them back',
        action: expiredCta.action,
      }),
      !ghostCta.isCompleted && buildRecommendation({
        id: 'GHOST_REACTIVATION',
        title: 'Bring back members who stopped coming',
        reason: `${ghostCta.count} active member${ghostCta.count === 1 ? '' : 's'} absent 14+ days`,
        count: ghostCta.count,
        members: ghostCta.members,
        impact: ghostRiskAmount,
        confidence: Math.min(88, 60 + Math.floor(ghosts.length * 0.8)),
        urgency: 'This week',
        priority: 'P1',
        cta: ghostCta.cta,
        sub: 'Bring quiet members back',
        action: ghostCta.action,
      }),
      !unpaidCta.isCompleted && buildRecommendation({
        id: 'UNPAID_ACTIVATION',
        title: 'Start unpaid members',
        reason: `${unpaidCta.count} unpaid member${unpaidCta.count === 1 ? ' is' : 's are'} waiting for activation`,
        count: unpaidCta.count,
        members: unpaidCta.members,
        impact: Math.round(unpaid.length * avgPlanPrice * 0.5),
        confidence: Math.min(86, 58 + unpaid.length),
        urgency: 'This week',
        priority: 'P1',
        cta: unpaidCta.cta,
        sub: 'Finish pending payments',
        action: unpaidCta.action,
      }),
      buildRecommendation({
        id: 'PENDING_DUES',
        title: 'Collect pending dues',
        reason: `${pendingDueCta.count} member${pendingDueCta.count === 1 ? ' still has' : 's still have'} an outstanding balance`,
        count: pendingDueCta.count,
        members: pendingDueCta.members,
        impact: pendingDueValue,
        confidence: Math.min(92, 62 + pendingDueMembers.length * 4),
        urgency: 'This week',
        priority: 'P1',
        cta: pendingDueCta.cta,
        sub: 'Clear pending balance',
        action: pendingDueCta.action,
      }),
    ].filter((candidate) => candidate.count > 0)
      .sort((a, b) => b.score - a.score);

    const opportunityCandidates = [
      followUpsDue > 0 && buildRecommendation({
        id: 'LEAD_FOLLOW_UP',
        title: followUpsDue === 1 ? 'Reply to the lead due today' : 'Follow up with leads due today',
        reason: `${followUpsDue} lead${followUpsDue === 1 ? '' : 's'} already need follow-up. Fast replies here can turn warm interest into trial visits.`,
        count: followUpsDue,
        impact: leadFollowupValue,
        confidence: Math.min(90, 74 + followUpsDue * 3),
        urgency: 'Today',
        priority: followUpsDue >= 3 ? 'P1' : 'P2',
        cta: 'Open Leads',
        sub: 'Follow leads for more joins',
        action: () => navigateTo('Leads'),
      }),
      trialsToday > 0 && buildRecommendation({
        id: 'TRIALS_TODAY',
        title: trialsToday === 1 ? 'Prepare today\'s trial visit' : 'Prepare today\'s trial visits',
        reason: `${trialsToday} trial${trialsToday === 1 ? '' : 's'} are scheduled today. Tight follow-up after the visit can move them to paid joins faster.`,
        count: trialsToday,
        impact: trialsTodayValue,
        confidence: Math.min(86, 68 + trialsToday * 4),
        urgency: 'Today',
        priority: 'P2',
        cta: 'Open Leads',
        sub: 'Move trials toward conversion',
        action: () => navigateTo('Leads'),
      }),
      openLeads > 0 && buildRecommendation({
        id: 'LEAD_PIPELINE',
        title: newLeads > 0 ? 'Work the fresh leads queue' : 'Keep the lead pipeline moving',
        reason: leadPipelineReason || 'Leads are waiting for a follow-up and trial conversion push.',
        count: openLeads,
        impact: leadPipelineValue,
        confidence: Math.min(84, 64 + Math.min(openLeads, 8) * 2),
        urgency: newLeads > 0 ? 'Today' : 'This week',
        priority: 'P2',
        cta: 'Open Leads',
        sub: 'Follow leads for more joins',
        action: () => navigateTo('Leads'),
      }),
      incompleteSetupSteps.length > 0 && buildRecommendation({
        id: 'SETUP_PROGRESS',
        title: setup.progress < 50 ? 'Complete your gym setup' : 'Finish remaining setup steps',
        reason: `${incompleteSetupSteps.length} step${incompleteSetupSteps.length === 1 ? '' : 's'} not yet configured — complete them to unlock full features`,
        count: incompleteSetupSteps.length,
        impact: Math.round(avgPlanPrice * Math.max(1.5, incompleteSetupSteps.length * 1.1)),
        confidence: Math.min(92, 72 + incompleteSetupSteps.length * 5),
        urgency: setup.progress < 50 ? 'Today' : 'This week',
        priority: setup.progress < 50 ? 'P1' : 'P2',
        cta: nextSetupStep === 'plans' ? 'Create Plan' : nextSetupStep === 'members' ? 'Add Member' : 'Go to Settings',
        sub: `Next step: ${setupStepLabels[nextSetupStep] || 'Settings'}`,
        action: () => {
          if (nextSetupStep === 'plans') {
            navigateTo('Plans');
            return;
          }
          if (nextSetupStep === 'members') {
            setShowAddModal(true);
            return;
          }
          navigateTo('Settings', 'account');
        },
      }),
      active.length >= 10 && trafficGap > 0 && buildRecommendation({
        id: 'TODAY_TRAFFIC',
        title: todayCheckins === 0 ? 'Kickstart check-ins for today' : 'Today\'s floor traffic is soft',
        reason: `${todayCheckins} check-ins recorded vs ${targetTodayTraffic} expected today`,
        count: trafficGap,
        impact: Math.round(Math.max(avgPlanPrice, trafficGap * avgPlanPrice * 0.25)),
        confidence: Math.min(88, 68 + trafficGap * 4),
        urgency: 'Today',
        priority: todayCheckins === 0 && active.length >= 18 ? 'P1' : 'P2',
        cta: 'Open Check-In',
        sub: 'Move reception focus to attendance',
        action: () => {
          setCheckinQuery('');
          setShowCheckinModal(true);
        },
      }),
      members.length >= 12 && weeklyRuns === 0 && !isBroadcastActionCompleted(buildBroadcastActionMeta({ actionKey: 'AUTOMATION_RESTART_BROADCAST', members: active })) && buildRecommendation({
        id: 'AUTOMATION_RESTART',
        title: 'Restart member messages',
        reason: 'No campaign was sent in the last 7 days',
        count: Math.max(active.length, members.length),
        impact: Math.round(Math.max(avgPlanPrice * 2, active.length * avgPlanPrice * 0.12)),
        confidence: Math.min(84, 64 + Math.min(20, Math.round(active.length / 2))),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Launch Broadcast',
        sub: 'Send member reminders again',
        action: () => openBroadcastDraft(
          'Active',
          'Hi from GymVault! New week, new goals. Reply if you want help with your next workout plan or renewal options.',
          buildBroadcastActionMeta({ actionKey: 'AUTOMATION_RESTART_BROADCAST', members: active }),
        ),
      }),
      topPlanEntry && topPlanPct >= 65 && plans.length >= 2 && buildRecommendation({
        id: 'PLAN_CONCENTRATION',
        title: `Add another plan besides "${topPlanEntry[0]}"`,
        reason: `${topPlanPct}% of members are on one plan. Add another plan to give members more choices.`,
        count: topPlanEntry[1],
        impact: Math.round(monthlyRevenue > 0 ? monthlyRevenue * 0.18 : avgPlanPrice * topPlanEntry[1]),
        confidence: Math.min(82, 60 + Math.round(topPlanPct / 2)),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Review Plans',
        sub: 'Offer more plan options',
        action: () => navigateTo('Plans'),
      }),
      plans.length === 1 && members.length >= 8 && buildRecommendation({
        id: 'SECOND_TIER',
        title: 'Add one more plan',
        reason: 'Having only one plan gives members no choice. Add a second plan so members can pick what suits them.',
        count: members.length,
        impact: Math.round(avgPlanPrice * 2),
        confidence: 78,
        urgency: 'This week',
        priority: 'P2',
        cta: 'Add Tier',
        sub: 'Give members one more choice',
        action: () => navigateTo('Plans'),
      }),
      active.length >= 12 && expiringIn7Days.length === 0 && highChurnMembers.length < 3 && pendingDues < avgPlanPrice && !isBroadcastActionCompleted(buildBroadcastActionMeta({ actionKey: 'GROWTH_PUSH_BROADCAST', members })) && buildRecommendation({
        id: 'GROWTH_PUSH',
        title: 'This week is good for new joins',
        reason: `Risk signals are stable across ${active.length} active members`,
        count: Math.max(6, Math.round(active.length * 0.35)),
        impact: Math.round(avgPlanPrice * 3),
        confidence: 76,
        urgency: 'This week',
        priority: 'P2',
        cta: 'Launch Growth',
        sub: 'Bring in new members',
        action: () => openBroadcastDraft(
          'All',
          'Hi from GymVault! Bring your momentum back this week. Reply if you want help choosing the right plan or bringing a friend along.',
          buildBroadcastActionMeta({ actionKey: 'GROWTH_PUSH_BROADCAST', members }),
        ),
      }),
    ].filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const subscriptionWarning = (() => {
      if (accessDaysRemaining === null) return null;
      if ((accessDerivedStatus === 'ACTIVE' || accessDerivedStatus === 'FREE_TRIAL') && accessDaysRemaining > 7) return null;

      const isCritical = accessDerivedStatus === 'EXPIRED' || accessDerivedStatus === 'GRACE_PERIOD' || accessDaysRemaining <= 1;
      const title = accessDerivedStatus === 'EXPIRED'
        ? 'GymVault access expired'
        : accessDerivedStatus === 'GRACE_PERIOD'
          ? 'GymVault access in grace period'
          : accessDaysRemaining <= 0
            ? 'GymVault access expires today'
            : accessDaysRemaining === 1
              ? 'GymVault access expires tomorrow'
              : `GymVault access expires in ${accessDaysRemaining} days`;
      const reason = accessExpiryLabel
        ? `Renew before ${accessExpiryLabel} to keep members, attendance, and analytics unlocked`
        : 'Renew your GymVault subscription to keep access uninterrupted';

      return buildRecommendation({
        id: 'GYMVAULT_ACCESS',
        title,
        reason,
        count: 1,
        impact: Math.max(monthlyRevenue, avgPlanPrice * 3),
        confidence: 98,
        urgency: isCritical ? 'Critical' : 'This week',
        priority: isCritical ? 'P0' : 'P1',
        cta: 'Open Billing',
        sub: accessDerivedStatus === 'FREE_TRIAL' ? 'Trial ending soon' : 'Software subscription warning',
        action: () => navigateTo('Settings', 'billing'),
      });
    })();

    const priorityRank = { P0: 0, P1: 1, P2: 2 };
    const sortRecommendationCandidates = (a, b) => {
      const rankDiff = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    };
    const actionCandidates = [subscriptionWarning, ...aiCandidates]
      .filter(Boolean)
      .sort(sortRecommendationCandidates);
    const setupFillCandidates = setupActionRows.length > 0
      ? setupActionRows.map((row, index) => buildRecommendation({
        id: row.id,
        title: row.title,
        reason: row.description,
        count: 1,
        impact: Math.round(Math.max(avgPlanPrice, avgPlanPrice * (1.1 - Math.min(index, 2) * 0.08))),
        confidence: Math.max(68, 84 - index * 4),
        urgency: setup.progress < 50 ? 'Today' : 'This week',
        priority: 'P2',
        cta: row.cta,
        sub: row.id === 'SETUP_WHATSAPP'
          ? 'Unlock reminder automation'
          : row.id === 'SETUP_PAYMENTS'
            ? 'Start collecting digitally'
            : row.id === 'SETUP_MEMBER'
              ? 'Start member operations'
              : row.id === 'SETUP_PLAN'
                ? 'Finish your offer catalog'
                : 'Finish business setup',
        action: row.action,
      }))
      : [];
    const hasMeaningfulCollections = monthlyRevenue > 0 || Number(payStats.today_revenue || 0) > 0 || pendingDuePayments.length > 0;
    const hasMeaningfulAttendance = active.length >= 5 || todayCheckins > 0;
    const hasRenewalPipeline = active.length >= 5 || expiringIn7Days.length > 0;
    const fillerActionRows = [
      hasMeaningfulCollections && buildRecommendation({
        id: 'DAILY_COLLECTIONS_REVIEW',
        title: 'Review today\'s collections desk',
        reason: Number(payStats.pending_dues || 0) > 0
          ? `₹${Number(payStats.pending_dues || 0).toLocaleString()} payment is still pending. Follow up today.`
          : 'Check your payments to make sure nothing is missed.',
        count: Math.max(1, pendingDuePayments.length),
        impact: Math.max(avgPlanPrice, Math.round(Number(payStats.pending_dues || 0)) || avgPlanPrice),
        confidence: 72,
        urgency: 'Today',
        priority: 'P2',
        cta: 'Open Payments',
        sub: 'Daily revenue review',
        action: () => navigateTo('Payments'),
      }),
      hasMeaningfulAttendance && buildRecommendation({
        id: 'ATTENDANCE_DESK_REVIEW',
        title: 'Review today\'s attendance desk',
        reason: Number(todayCheckins || 0) === 0
          ? 'No check-ins today yet. Start marking attendance so you can track who is coming.'
          : `${Number(todayCheckins || 0).toLocaleString()} check-ins today. Keep marking attendance and watch for members who are not coming.`,
        count: Math.max(1, Number(todayCheckins || 0)),
        impact: Math.max(avgPlanPrice, Math.round(avgPlanPrice * 1.2)),
        confidence: 69,
        urgency: 'Today',
        priority: 'P2',
        cta: 'Open Attendance',
        sub: 'Front desk watch',
        action: () => navigateTo('Attendance'),
      }),
      hasRenewalPipeline && buildRecommendation({
        id: 'RENEWAL_PIPELINE_REVIEW',
        title: 'Review the renewal pipeline',
        reason: expiringIn7Days.length > 0
          ? `${expiringIn7Days.length} membership${expiringIn7Days.length === 1 ? ' is' : 's are'} ending this week. Talk to them about renewing.`
          : 'No renewals due yet, but check your renewal list regularly.',
        count: Math.max(1, expiringIn7Days.length),
        impact: Math.max(avgPlanPrice, Math.round(avgPlanPrice * 1.4)),
        confidence: 66,
        urgency: 'This week',
        priority: 'P2',
        cta: 'Open Members',
        sub: 'Renewal pipeline review',
        action: () => navigateTo('Members'),
      }),
    ].filter(Boolean);
    // ── Build action rows FIRST so we know which ids are shown there ──
    const maxActionRows = 4;
    const actionRequiredRows = actionCandidates.filter((item) => item.priority === 'P0' || item.priority === 'P1');
    const mergedActionRows = [];
    const seenActionIds = new Set();
    const pushUniqueRows = (rows) => {
      rows.forEach((row) => {
        if (!row || mergedActionRows.length >= maxActionRows || seenActionIds.has(row.id)) {
          return;
        }
        mergedActionRows.push(row);
        seenActionIds.add(row.id);
      });
    };
    pushUniqueRows(actionRequiredRows);
    pushUniqueRows(setupFillCandidates);
    pushUniqueRows(actionCandidates.filter((item) => item.priority !== 'P0' && item.priority !== 'P1'));
    if (setupActionRows.length === 0) {
      pushUniqueRows(fillerActionRows);
    }
    const urgentCount = actionRequiredRows.length;

    // ── Build Smart Tips that are DIFFERENT from action rows ──
    // Insight-style analytical tips that give the owner strategic value
    const retentionRate = members.length > 0 ? Math.round((active.length / members.length) * 100) : 0;
    const avgDailyRevenue = chart30.length > 0 ? Math.round(monthlyRevenue / Math.max(1, chart30.filter(d => d.revenue > 0).length)) : 0;
    const bestDay = chart30.reduce((best, day) => (day.revenue || 0) > (best?.revenue || 0) ? day : best, { revenue: 0 });
    const worstRecentDay = chart30.slice(-7).reduce((worst, day) => ((day.revenue || 0) < (worst?.revenue || Infinity) && day.date) ? day : worst, { revenue: Infinity });
    const activeWithNoVisit14 = active.filter(m => getDaysAbsent(m) >= 14 && getDaysAbsent(m) < 30).length;
    const convertedThisMonth = Number(normalizedLeadSummary.converted_this_month || 0);
    const lostLeads = Number(normalizedLeadSummary.lost_leads || 0);
    const leadConversionRate = openLeads + convertedThisMonth + lostLeads > 0
      ? Math.round((convertedThisMonth / (openLeads + convertedThisMonth + lostLeads)) * 100) : 0;

    const insightCandidates = [
      // Retention health insight
      members.length >= 5 && buildRecommendation({
        id: 'INSIGHT_RETENTION',
        title: retentionRate >= 80 ? 'Members are staying well' : retentionRate >= 60 ? 'Some members are leaving' : 'Many members are not coming back',
        reason: `${retentionRate}% of your ${members.length} members are still active. ${retentionRate >= 80 ? 'Great job! Most of your members are staying.' : retentionRate >= 60 ? 'Try calling inactive members and offer them a reason to come back.' : 'Too many members have stopped coming. Call expired members and try to bring them back this week.'}`,
        count: active.length,
        impact: Math.round(avgPlanPrice * Math.max(1, (100 - retentionRate) * 0.15)),
        confidence: Math.min(92, 70 + Math.round(members.length / 5)),
        urgency: retentionRate < 60 ? 'Today' : 'This week',
        priority: retentionRate < 60 ? 'P1' : 'P2',
        cta: 'View Members',
        sub: 'Retention health check',
        action: () => navigateTo('Members'),
      }),
      // Revenue trend insight
      monthlyRevenue > 0 && chart30.length >= 7 && buildRecommendation({
        id: 'INSIGHT_REVENUE_TREND',
        title: avgDailyRevenue > 0 ? `Your daily average is ₹${avgDailyRevenue.toLocaleString()}` : 'Track revenue patterns',
        reason: bestDay.date ? `Best collection day was ${new Date(bestDay.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} at ₹${Number(bestDay.revenue).toLocaleString()}. ${avgDailyRevenue > 0 ? `Try to collect payments on your best days.` : ''}` : `₹${monthlyRevenue.toLocaleString()} collected in 30 days. Keep collecting every day to stay consistent.`,
        count: Math.max(1, chart30.filter(d => d.revenue > 0).length),
        impact: avgDailyRevenue > 0 ? avgDailyRevenue : avgPlanPrice,
        confidence: Math.min(88, 65 + chart30.filter(d => d.revenue > 0).length),
        urgency: 'This week',
        priority: 'P2',
        cta: 'View Payments',
        sub: 'Revenue pattern analysis',
        action: () => navigateTo('Payments'),
      }),
      // Attendance engagement insight
      active.length >= 5 && activeWithNoVisit14 > 0 && buildRecommendation({
        id: 'INSIGHT_ENGAGEMENT',
        title: `${activeWithNoVisit14} member${activeWithNoVisit14 === 1 ? '' : 's'} not visiting`,
        reason: `${activeWithNoVisit14} member${activeWithNoVisit14 === 1 ? ' has' : 's have'} active plans but haven't come in 14+ days. Give them a call or send a WhatsApp reminder to bring them back.`,
        count: activeWithNoVisit14,
        impact: Math.round(activeWithNoVisit14 * avgPlanPrice * 0.5),
        confidence: Math.min(86, 68 + activeWithNoVisit14 * 3),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Check Attendance',
        sub: 'Member engagement signal',
        action: () => navigateTo('Attendance'),
      }),
      // Lead conversion insight
      (openLeads > 0 || convertedThisMonth > 0) && buildRecommendation({
        id: 'INSIGHT_LEAD_CONVERSION',
        title: convertedThisMonth > 0 ? `${convertedThisMonth} lead${convertedThisMonth === 1 ? '' : 's'} converted this month` : 'No leads converted yet this month',
        reason: leadConversionRate > 0
          ? `${leadConversionRate}% of your enquiries became members. ${leadConversionRate >= 30 ? 'Good work! Keep following up regularly.' : 'Try to reply faster and offer trial visits to convert more.'}${lostLeads > 0 ? ` ${lostLeads} enquir${lostLeads === 1 ? 'y was' : 'ies were'} lost — check why.` : ''}`
          : `${openLeads} enquir${openLeads === 1 ? 'y is' : 'ies are'} pending but none joined yet. Call them and offer a trial visit.`,
        count: Math.max(1, convertedThisMonth),
        impact: Math.round(Math.max(avgPlanPrice, convertedThisMonth * avgPlanPrice * 0.6)),
        confidence: Math.min(84, 60 + Math.min(openLeads + convertedThisMonth, 10) * 3),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Open Leads',
        sub: 'Sales pipeline analysis',
        action: () => navigateTo('Leads'),
      }),
      // Plan pricing insight
      plans.length >= 2 && members.length >= 5 && buildRecommendation({
        id: 'INSIGHT_PLAN_MIX',
        title: topPlanEntry ? `${topPlanPct}% of members are on "${topPlanEntry[0]}"` : 'Review your plan distribution',
        reason: topPlanPct >= 80 ? `Most members are on one plan. Promote your other plans too so you earn more.` : topPlanPct >= 50 ? `${topPlanPct}% members are on your top plan. Try to move some members to a better plan.` : `Members are spread nicely across your ${plans.length} plans. This is good for your business.`,
        count: members.length,
        impact: Math.round(avgPlanPrice * 1.5),
        confidence: Math.min(82, 58 + plans.length * 5),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Review Plans',
        sub: 'Plan mix analysis',
        action: () => navigateTo('Plans'),
      }),
      // Check-in consistency insight
      todayCheckins > 0 && active.length >= 5 && buildRecommendation({
        id: 'INSIGHT_CHECKIN_RATE',
        title: `${todayCheckins} check-in${todayCheckins === 1 ? '' : 's'} today vs ${active.length} active`,
        reason: `${Math.round((todayCheckins / active.length) * 100)}% of active members checked in today. ${todayCheckins / active.length >= 0.15 ? 'Good footfall today. Keep it going!' : 'Footfall is low today. Send a WhatsApp message to bring more members in.'}`,
        count: todayCheckins,
        impact: Math.round(avgPlanPrice * 0.8),
        confidence: Math.min(80, 60 + todayCheckins * 2),
        urgency: 'Today',
        priority: 'P2',
        cta: 'Open Check-In',
        sub: 'Today\'s floor traffic',
        action: () => { setCheckinQuery(''); setShowCheckinModal(true); },
      }),
      // ─── Additional rotating smart tips ───
      // 7: Weekend/weekday opportunity
      members.length >= 3 && buildRecommendation({
        id: 'INSIGHT_WEEKEND_OFFER',
        title: 'Run a weekend promotion',
        reason: 'Members are more likely to bring friends on weekends. Offer a free trial class on Saturday or Sunday to attract walk-ins and referrals.',
        count: members.length,
        impact: Math.round(avgPlanPrice * 2),
        confidence: 72,
        urgency: 'This week',
        priority: 'P3',
        cta: 'View Plans',
        sub: 'Weekend promotion idea',
        action: () => navigateTo('Plans'),
      }),
      // 8: Personal touch
      active.length >= 3 && buildRecommendation({
        id: 'INSIGHT_PERSONAL_TOUCH',
        title: 'Call your top 3 members',
        reason: 'A quick "thank you" call to your top members builds loyalty. Members who feel valued stay 2x longer. Pick your top 3 by attendance and call them today.',
        count: 3,
        impact: Math.round(avgPlanPrice * 3),
        confidence: 75,
        urgency: 'Today',
        priority: 'P3',
        cta: 'View Attendance',
        sub: 'Retention through personal touch',
        action: () => navigateTo('Attendance'),
      }),
      // 9: Expired member recovery
      expired.length > 0 && buildRecommendation({
        id: 'INSIGHT_EXPIRED_RECOVERY',
        title: `${expired.length} expired — win them back`,
        reason: `${expired.length} member${expired.length === 1 ? ' has' : 's have'} expired. Offer a small discount or free week to bring them back. It costs 5x more to get a new member than to retain one.`,
        count: expired.length,
        impact: Math.round(expired.length * avgPlanPrice * 0.7),
        confidence: Math.min(85, 65 + expired.length * 2),
        urgency: 'This week',
        priority: 'P2',
        cta: 'View Members',
        sub: 'Win-back opportunity',
        action: () => navigateTo('Members', 'Expired'),
      }),
      // 10: Social media post
      members.length >= 5 && buildRecommendation({
        id: 'INSIGHT_SOCIAL_POST',
        title: 'Post a member success story',
        reason: 'Gyms that share member transformations on social media see 30% more walk-in enquiries. Ask a member for their permission and post their journey this week.',
        count: members.length,
        impact: Math.round(avgPlanPrice * 1.5),
        confidence: 68,
        urgency: 'This week',
        priority: 'P3',
        cta: 'View Members',
        sub: 'Social media growth tip',
        action: () => navigateTo('Members'),
      }),
      // 11: Referral program
      active.length >= 5 && buildRecommendation({
        id: 'INSIGHT_REFERRAL',
        title: 'Start a referral program',
        reason: 'Offer existing members a free week or discount for every friend they refer who joins. Word-of-mouth is the cheapest and most trusted marketing for gyms.',
        count: active.length,
        impact: Math.round(avgPlanPrice * 3),
        confidence: 74,
        urgency: 'This week',
        priority: 'P3',
        cta: 'Broadcast Offer',
        sub: 'Member referral strategy',
        action: () => navigateTo('Members'),
      }),
      // 12: Collect feedback
      active.length >= 5 && buildRecommendation({
        id: 'INSIGHT_FEEDBACK',
        title: 'Collect member feedback',
        reason: 'Ask your members what they want improved — equipment, timing, cleanliness. Members who feel heard stay longer. Send a quick WhatsApp poll this week.',
        count: active.length,
        impact: Math.round(avgPlanPrice * 2),
        confidence: 70,
        urgency: 'This week',
        priority: 'P3',
        cta: 'Send Broadcast',
        sub: 'Member satisfaction pulse',
        action: () => navigateTo('Members'),
      }),
      // 13: Early morning/late evening batches
      members.length >= 5 && buildRecommendation({
        id: 'INSIGHT_NEW_BATCH',
        title: 'Consider adding a new batch',
        reason: 'If your gym is crowded during peak hours, adding an early morning or late evening batch can attract working professionals who cannot come during regular hours.',
        count: members.length,
        impact: Math.round(avgPlanPrice * 4),
        confidence: 66,
        urgency: 'This week',
        priority: 'P3',
        cta: 'View Classes',
        sub: 'Capacity optimization',
        action: () => navigateTo('Classes'),
      }),
      // 14: Unpaid follow-up
      unpaid.length > 0 && buildRecommendation({
        id: 'INSIGHT_UNPAID_FOLLOWUP',
        title: `${unpaid.length} unpaid — collect today`,
        reason: `${unpaid.length} member${unpaid.length === 1 ? ' has' : 's have'} unpaid registrations. Call them today to close the payment. Longer you wait, less likely they join.`,
        count: unpaid.length,
        impact: Math.round(unpaid.length * avgPlanPrice),
        confidence: Math.min(88, 70 + unpaid.length * 3),
        urgency: 'Today',
        priority: 'P1',
        cta: 'View Members',
        sub: 'Unpaid collection reminder',
        action: () => navigateTo('Members', 'Unpaid'),
      }),
      // 15: WhatsApp broadcast
      active.length >= 3 && buildRecommendation({
        id: 'INSIGHT_BROADCAST',
        title: 'Send a motivation broadcast',
        reason: 'A weekly fitness tip or motivational message on WhatsApp keeps your gym top-of-mind. Members who receive regular communication are 40% more likely to renew.',
        count: active.length,
        impact: Math.round(avgPlanPrice * 1.5),
        confidence: 71,
        urgency: 'This week',
        priority: 'P3',
        cta: 'Send Broadcast',
        sub: 'Member engagement boost',
        action: () => navigateTo('Members'),
      }),
    ].filter(Boolean).sort(sortRecommendationCandidates);

    // Smart tips: exclude anything already in action rows, prefer insights
    // Use day-of-week rotation to vary tips across the week
    const dayOfWeek = new Date().getDay(); // 0-6
    const actionRowIds = new Set(mergedActionRows.map(r => r.id));
    const smartTipPool = [
      ...insightCandidates,
      ...opportunityCandidates.filter(c => !actionRowIds.has(c.id)),
      ...fillerActionRows.filter(c => !actionRowIds.has(c.id)),
    ].filter(Boolean).sort(sortRecommendationCandidates);

    // Rotate: always show the highest-priority tip first, then pick 2 more based on day rotation
    const recommendations = [];
    const seenRecommendationIds = new Set();
    // First slot: always highest priority
    if (smartTipPool[0]) {
      recommendations.push(smartTipPool[0]);
      seenRecommendationIds.add(smartTipPool[0].id);
    }
    // Remaining slots: offset by day-of-week so tips rotate daily
    const rotatedPool = smartTipPool.filter(c => !seenRecommendationIds.has(c.id));
    const rotationOffset = dayOfWeek * 2;
    for (let i = 0; i < rotatedPool.length && recommendations.length < 3; i++) {
      const idx = (i + rotationOffset) % rotatedPool.length;
      const candidate = rotatedPool[idx];
      if (candidate && !seenRecommendationIds.has(candidate.id)) {
        recommendations.push(candidate);
        seenRecommendationIds.add(candidate.id);
      }
    }
    const primary = recommendations[0] || {
      id: 'BASELINE',
      title: 'Keep the gym running strong',
      reason: 'Things look stable. Keep following up and keep new joins moving.',
      count: active.length || members.length || 0,
      impact: avgPlanPrice * 2,
      confidence: 76,
      urgency: 'This week',
      priority: 'P2',
      cta: plans.length > 0 ? 'Add Member' : 'Create Plan',
      sub: plans.length > 0 ? 'Keep growth steady' : 'Set up your plans',
      action: () => {
        if (plans.length === 0) {
          navigateTo('Plans');
          return;
        }
        setShowAddModal(true);
      },
    };
    const activeCoveragePct = members.length > 0 ? Math.round((active.length / members.length) * 100) : 0;
    const nextWatchline = expiringIn7Days.length > 0
      ? `${expiringIn7Days.length} renewals are due within the next 7 days`
      : unpaid.length > 0
        ? `${unpaid.length} unpaid profiles are still waiting for activation`
        : ghosts.length > 0
          ? `${ghosts.length} active members have gone quiet recently`
          : 'No immediate retention or revenue risks are peaking right now';
    const aiSummaryLines = [
      { label: 'Active plans', value: `${active.length} of ${members.length || 0} members are active right now (${activeCoveragePct}%)` },
      { label: 'Money collected', value: (() => {
        const earliest = chart30.find((day) => (day.revenue || 0) > 0);
        const sinceLabel = earliest?.date ? new Date(earliest.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : null;
        return sinceLabel ? `₹${monthlyRevenue.toLocaleString()} collected since ${sinceLabel}` : `₹${monthlyRevenue.toLocaleString()} collected in the last 30 days`;
      })() },
      { label: 'Watch today', value: nextWatchline },
    ];

    return {
      active: active.length,
      unpaid: unpaid.length,
      expired: expired.length,
      expiring7: expiringIn7Days.length,
      expiring3: expiringIn3Days.length,
      ghosts: ghosts.length,
      ghostMembers: ghosts,
      pendingDuePayments,
      monthlyRevenue,
      revenueAtRisk,
      healthScore,
      pendingDueAction: pendingDuePayments.length > 0 ? pendingDueCta.action : () => navigateTo('Payments'),
      topPlan: topPlanEntry ? { name: topPlanEntry[0], count: topPlanEntry[1], pct: topPlanPct } : null,
      heatmap,
      churnHigh: churnInsights.summary?.high || 0,
      ai: {
        summaryLines: aiSummaryLines,
        primary,
        recommendations,
        urgentCount,
      },
      actionRows: mergedActionRows,
      setupActionRows,
      automations: {
        sentToday,
        runsToday,
        weeklyRuns,
        weeklySent,
        estimatedRecoveryValue,
        lastAutomationAt,
        lastAutomationLabel,
      },
    };
  }, [
    attendanceHeatmap,
    buildSmartMemberCta,
    buildSmartPaymentCta,
    campaignLogs,
    chart30,
    churnInsights,
    gymBilling,
    leadSummary,
    members,
    navigateTo,
    openBroadcastDraft,
    payStats.pending_dues,
    payStats.today_revenue,
    plans,
    setup,
    todayCheckins,
  ]);

  const campaignPreviewCount = useMemo(() => {
    if (broadcastCustomIds.length > 0) {
      return broadcastCustomIds.length;
    }

    switch (broadcastAudience) {
      case 'Active':
        return Number(dashboardData.active || 0);
      case 'Expiring':
        return Number(dashboardData.expiring7 || 0);
      case 'Expired':
        return Number(dashboardData.expired || 0);
      case 'Ghosts':
        return Number(dashboardData.ghosts || 0);
      case 'HighChurn':
        return Number(dashboardData.churnHigh || 0);
      default:
        return members.length;
    }
  }, [broadcastAudience, broadcastCustomIds.length, dashboardData.active, dashboardData.churnHigh, dashboardData.expired, dashboardData.expiring7, dashboardData.ghosts, members.length]);

  const campaignPreviewLoading = false;

  const displayChartData = useMemo(() => {
    const data = chartDays === 7 ? chart7 : chart30;
    return data.map((day) => ({
      name: new Date(day.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      rev: day.revenue || 0,
    }));
  }, [chart30, chart7, chartDays]);

  const chartTotal = useMemo(() => (
    (chartDays === 7 ? chart7 : chart30).reduce((sum, day) => sum + (day.revenue || 0), 0)
  ), [chart30, chart7, chartDays]);

  const checkinMembers = useMemo(() => {
    const query = String(checkinQuery || '').trim().toLowerCase();
    const source = query
      ? members.filter((member) => {
          const name = String(member.full_name || '').toLowerCase();
          const phone = String(member.phone || '').toLowerCase();
          const email = String(member.email || '').toLowerCase();
          return name.includes(query) || phone.includes(query) || email.includes(query);
        })
      : members;

    return [...source].sort((a, b) => {
      const aChecked = checkedInMemberIds.has(Number(a.id));
      const bChecked = checkedInMemberIds.has(Number(b.id));
      if (aChecked !== bChecked) return aChecked ? 1 : -1;

      const aActive = String(a.membership_status || '').toUpperCase() === 'ACTIVE';
      const bActive = String(b.membership_status || '').toUpperCase() === 'ACTIVE';
      if (aActive !== bActive) return aActive ? -1 : 1;

      return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    });
  }, [checkinQuery, checkedInMemberIds, members]);

  const broadcastSelectedMembers = useMemo(() => {
    if (broadcastCustomIds.length === 0) return [];
    const idSet = new Set(broadcastCustomIds.map((id) => Number(id)));
    return members.filter((member) => idSet.has(Number(member.id)));
  }, [broadcastCustomIds, members]);

  const broadcastSearchResults = useMemo(() => {
    const query = String(broadcastSearch || '').trim().toLowerCase();
    if (!query) return [];
    return members
      .filter((member) => !broadcastCustomIds.includes(Number(member.id)))
      .filter((member) => {
        const name = String(member.full_name || '').toLowerCase();
        const phone = String(member.phone || '').toLowerCase();
        const email = String(member.email || '').toLowerCase();
        return name.includes(query) || phone.includes(query) || email.includes(query);
      })
      .slice(0, 8);
  }, [broadcastCustomIds, broadcastSearch, members]);

  return {
    addFile,
    addFormData,
    addSelectedPlanId,
    addSubmitting,
    broadcastAudience,
    broadcastCustomIds,
    broadcastMessage,
    broadcastSearch,
    broadcastSearchResults,
    broadcastSelectedMembers,
    broadcastTemplateKey,
    broadcastTemplates,
    campaignPreviewCount,
    campaignPreviewLoading,
    chartDays,
    chartTotal,
    checkDashboardRazorpayStatus,
    checkedInMemberIds,
    checkinBusyMemberIds,
    checkinMembers,
    checkinQuery,
    closePaymentModal,
    dashboardData,
    displayChartData,
    fetchError,
    retryDashboard: fetchData,
    gymName,
    handleAddMember,
    handleBroadcast,
    handleCopyPaymentCollectionDetail,
    handlePayment,
    handleQuickCheckIn,
    isAutomating,
    isWarmupRetrying,
    launchQuickAction,
    loading,
    members,
    navigateTo,
    normalizePhoneInput,
    payMemberDropdownOpen,
    payMemberSearch,
    payStats,
    paymentCollectionContext,
    paymentMode,
    paymentOnlineMode,
    paymentRazorpayContext,
    paymentReference,
    paymentStep,
    paymentSubmitting,
    plans,
    previewUrl,
    quickActionLoading,
    selectedMemberForPay,
    selectedPlanForPay,
    setAddFile,
    setAddFormData,
    setAddSelectedPlanId,
    setBroadcastAudience,
    setBroadcastCustomIds,
    setBroadcastMessage,
    setBroadcastSearch,
    setBroadcastTemplateKey,
    setChartDays,
    setCheckinQuery,
    setPayMemberDropdownOpen,
    setPayMemberSearch,
    setPaymentCollectionContext,
    setPaymentMode,
    setPaymentOnlineMode,
    setPaymentReference,
    setPaymentRazorpayContext,
    setPaymentStep,
    setPreviewUrl,
    setSelectedMemberForPay,
    setSelectedPlanForPay,
    setShowAddModal,
    setShowBroadcastModal,
    setShowCheckinModal,
    setShowPaymentModal,
    setup,
    showAddModal,
    showBroadcastModal,
    showCheckinModal,
    showPaymentModal,
    todayCheckins,
  };
}