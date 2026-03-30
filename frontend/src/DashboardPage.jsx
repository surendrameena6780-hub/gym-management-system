import React, { useState, useMemo, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Users, DollarSign, Plus, Zap, MessageSquare, ShieldAlert,
  Sparkles, Clock, CheckCircle, CreditCard, Flame, UserMinus, Activity,
  X, TrendingUp, ChevronRight, UserPlus, RefreshCw,
  Bot, Play // <-- 🚨 ADDED ICONS
} from 'lucide-react';

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};


// ─── Animation Keyframes ──────────────────────────────────────────────────────
const animationStyles = (
  <style>{`
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    @keyframes cardCascade {
      from { opacity: 0; transform: translateY(20px) scale(0.97); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0)   scale(1);    filter: blur(0); }
    }
    @keyframes heroPulse {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.05); }
    }
  `}</style>
);

// ─── Skeleton ─────────────────────────────────────────────────────────────────
const ShimmerBar = ({ className = '' }) => (
  <div className={`relative overflow-hidden bg-white/20 ${className}`}>
    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
      style={{ animation: 'shimmer 1.8s ease-in-out infinite' }} />
  </div>
);

const DashboardSkeleton = () => (
  <div className="min-h-full p-0 pb-24">
    {animationStyles}
    {/* Hero skeleton */}
    <div className="rounded-[28px] h-40 bg-white/20 backdrop-blur-sm mb-6 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        style={{ animation: 'shimmer 2s ease-in-out infinite' }} />
    </div>
    {/* KPI row 1 */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-5 h-32"
          style={{ opacity: 0, animation: `cardCascade 0.5s ease-out ${i * 60}ms forwards` }}>
          <div className="w-11 h-11 bg-slate-100 rounded-2xl mb-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent"
              style={{ animation: 'shimmer 1.8s ease-in-out infinite' }} />
          </div>
          <ShimmerBar className="h-6 w-16 rounded-lg mb-2" />
          <ShimmerBar className="h-2.5 w-24 rounded-md" />
        </div>
      ))}
    </div>
    {/* Main content */}
    <div className="grid grid-cols-12 gap-5 mb-5">
      <div className="col-span-12 lg:col-span-8 bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-6 h-80"
        style={{ opacity: 0, animation: 'cardCascade 0.5s ease-out 320ms forwards' }}>
        <ShimmerBar className="h-5 w-48 rounded-lg mb-2" />
        <ShimmerBar className="h-3 w-32 rounded-md mb-6" />
        <ShimmerBar className="h-52 w-full rounded-2xl" />
      </div>
      <div className="col-span-12 lg:col-span-4 flex flex-col gap-5"
        style={{ opacity: 0, animation: 'cardCascade 0.5s ease-out 400ms forwards' }}>
        <div className="bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-6 h-36">
          <ShimmerBar className="h-4 w-28 rounded-md mb-4" />
          <ShimmerBar className="h-14 w-full rounded-xl mb-3" />
          <ShimmerBar className="h-10 w-full rounded-xl" />
        </div>
        <div className="bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-6 flex-1">
          <ShimmerBar className="h-4 w-36 rounded-md mb-4" />
          {[0, 1, 2].map(i => (
            <div key={i} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0">
              <ShimmerBar className="h-3 w-32 rounded-md" />
              <ShimmerBar className="h-7 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
    {/* KPI row 2 */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-5 h-32"
          style={{ opacity: 0, animation: `cardCascade 0.5s ease-out ${500 + i * 60}ms forwards` }}>
          <ShimmerBar className="h-11 w-11 rounded-2xl mb-4" />
          <ShimmerBar className="h-6 w-16 rounded-lg mb-2" />
          <ShimmerBar className="h-2.5 w-24 rounded-md" />
        </div>
      ))}
    </div>
    {/* Bottom row */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {[0, 1, 2].map(i => (
        <div key={i} className="bg-white/60 backdrop-blur-sm rounded-[24px] border border-white/60 p-5 h-40"
          style={{ opacity: 0, animation: `cardCascade 0.5s ease-out ${750 + i * 60}ms forwards` }}>
          <ShimmerBar className="h-3 w-24 rounded-md mb-4" />
          <ShimmerBar className="h-10 w-16 rounded-lg mb-3" />
          <ShimmerBar className="h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  </div>
);

// ─── Utilities ────────────────────────────────────────────────────────────────
const Card = ({ children, className = '', style = {} }) => (
  <div
    className={`bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/60 shadow-[0_2px_20px_rgba(99,102,241,0.06)] hover:shadow-[0_6px_30px_rgba(99,102,241,0.1)] transition-all duration-300 ${className}`}
    style={style}
  >
    {children}
  </div>
);

const KPICard = ({ title, value, icon: Icon, iconGradient, index = 0, onClick, tag }) => (
  <div
    onClick={onClick}
    className={`group relative overflow-hidden bg-white/85 backdrop-blur-sm rounded-[24px] border border-white/60 p-5 flex flex-col justify-between shadow-[0_2px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_10px_36px_rgba(0,0,0,0.09)] hover:-translate-y-1 transition-all duration-300 ${onClick ? 'cursor-pointer' : ''}`}
    style={{ opacity: 0, animation: `cardCascade 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 75}ms forwards` }}
  >
    <div
      className="absolute -right-5 -bottom-5 w-28 h-28 rounded-full opacity-[0.045] group-hover:opacity-[0.09] group-hover:scale-125 transition-all duration-700"
      style={{ background: iconGradient }}
    />
    <div className="flex items-start justify-between relative z-10">
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-lg"
        style={{ background: iconGradient, boxShadow: `0 4px 14px rgba(0,0,0,0.15)` }}
      >
        <Icon size={19} strokeWidth={2} />
      </div>
      {onClick && (
        <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-indigo-50 flex items-center justify-center transition-colors duration-200 mt-0.5">
          <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-400 transition-colors duration-200" />
        </div>
      )}
    </div>
    <div className="relative z-10 mt-3">
      {tag && (
        <span className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-500 mb-1.5">{tag}</span>
      )}
      <h3 className="text-[26px] font-black text-slate-900 tracking-tight leading-none">{value}</h3>
      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1.5">{title}</p>
    </div>
  </div>
);

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

const formatHour = (h) => {
  if (h === 0) return '12A';
  if (h < 12) return `${h}A`;
  if (h === 12) return '12P';
  return `${h - 12}P`;
};

const getPriorityMeta = (priority) => {
  if (priority === 'P0') {
    return {
      label: 'Critical',
      badgeClass: 'bg-rose-50 text-rose-700 border border-rose-100',
      rowClass: 'border-rose-100 bg-white',
      buttonClass: 'bg-rose-600 text-white hover:bg-rose-700',
    };
  }
  if (priority === 'P1') {
    return {
      label: 'Attention',
      badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100',
      rowClass: 'border-amber-100 bg-white',
      buttonClass: 'bg-amber-500 text-white hover:bg-amber-600',
    };
  }
  return {
    label: 'Opportunity',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-100',
    rowClass: 'border-slate-200 bg-white',
    buttonClass: 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50',
  };
};

// Custom recharts tooltip
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white px-3.5 py-2.5 rounded-xl shadow-2xl text-xs font-bold">
      <p className="text-slate-400 mb-0.5">{label}</p>
      <p className="text-white text-sm">₹{Number(payload[0]?.value || 0).toLocaleString()}</p>
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

// 🚨 ADDED startTour to props!
const DashboardPage = ({ token, setCurrentPage, toast, navigateTo: navTo, startTour }) => {
  const navigateTo = navTo || ((page) => setCurrentPage?.(page));
  const DASHBOARD_REQUEST_TIMEOUT_MS = 12000;
  const MAX_WARMUP_RETRIES = 8;

  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [payStats, setPayStats] = useState({ total_revenue: 0, today_revenue: 0, pending_dues: 0 });
  const [chart30, setChart30] = useState([]);
  const [chart7, setChart7] = useState([]);
  const [attendanceHeatmap, setAttendanceHeatmap] = useState([]);
  const [todayCheckins, setTodayCheckins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chartDays, setChartDays] = useState(30);
  
  // SETUP ONBOARDING STATE
  const [setup, setSetup] = useState({
    progress: 0,
    is_complete: false,
    steps: { profile: false, plans: false, members: false }
  });
  const [isSkipped, setIsSkipped] = useState(localStorage.getItem('gymvault_skip_setup') === 'true');
  const [showTourBanner, setShowTourBanner] = useState(localStorage.getItem('gymvault_tour_completed') !== 'true');
  const [isWarmupRetrying, setIsWarmupRetrying] = useState(false);
  const warmupRetryTimerRef = useRef(null);
  const warmupRetryCountRef = useRef(0);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinQuery, setCheckinQuery] = useState('');
  const [checkinBusyMemberId, setCheckinBusyMemberId] = useState(null);
  const [todayAttendance, setTodayAttendance] = useState([]);

  // Form states
  const [addFormData, setAddFormData] = useState({ full_name: '', email: '', phone: '' });
  const [addFile, setAddFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [addSelectedPlanId, setAddSelectedPlanId] = useState('');
  const [selectedMemberForPay, setSelectedMemberForPay] = useState('');
  const [selectedPlanForPay, setSelectedPlanForPay] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [broadcastAudience, setBroadcastAudience] = useState('All');
  const [broadcastChannel, setBroadcastChannel] = useState('WHATSAPP');
  const [broadcastTemplateKey, setBroadcastTemplateKey] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [campaignPreviewCount, setCampaignPreviewCount] = useState(0);
  const [campaignPreviewLoading, setCampaignPreviewLoading] = useState(false);
  const [broadcastTemplates, setBroadcastTemplates] = useState([]);
  const [churnInsights, setChurnInsights] = useState({ summary: { high: 0, medium: 0, low: 0 }, members: [] });
  const [campaignLogs, setCampaignLogs] = useState([]);

  const headers = { headers: { 'x-auth-token': token } };

  const unwrapApiData = (payload) => {
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return unwrapApiData(payload.data);
    }
    return payload;
  };

  const asArray = (value) => (Array.isArray(value) ? value : []);

  const normalizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
  const isValidPhoneInput = (value) => /^\d{10}$/.test(normalizePhoneInput(value));

  const asObject = (value, fallback = {}) => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
  );

  const fetchData = async () => {
    try {
      const requestConfig = { ...headers, timeout: DASHBOARD_REQUEST_TIMEOUT_MS };
      const [
        membersRes, plansRes, statsRes,
        chart30Res, chart7Res, attendanceRes,
        todayRes, setupRes, churnRes, logsRes
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
        axios.get('/api/notifications/campaign/logs?limit=50', requestConfig)
      ]);

      const pickData = (result, fallback) => {
        if (result.status !== 'fulfilled') return fallback;
        const unwrapped = unwrapApiData(result.value?.data);
        return unwrapped ?? fallback;
      };

      setMembers(asArray(pickData(membersRes, [])));
      setPlans(asArray(pickData(plansRes, [])));
      setPayStats(asObject(pickData(statsRes, { total_revenue: 0, today_revenue: 0, pending_dues: 0 }), { total_revenue: 0, today_revenue: 0, pending_dues: 0 }));
      setChart30(asArray(pickData(chart30Res, [])));
      setChart7(asArray(pickData(chart7Res, [])));
      setAttendanceHeatmap(asArray(pickData(attendanceRes, [])));
      const todayData = pickData(todayRes, []);
      const normalizedTodayData = Array.isArray(todayData) ? todayData : [];
      setTodayAttendance(normalizedTodayData);
      setTodayCheckins(normalizedTodayData.length);
      setSetup(asObject(pickData(setupRes, { progress: 0, is_complete: false, steps: {} }), { progress: 0, is_complete: false, steps: {} }));
      const churnData = asObject(pickData(churnRes, { summary: { high: 0, medium: 0, low: 0 }, members: [] }), { summary: { high: 0, medium: 0, low: 0 }, members: [] });
      setChurnInsights({
        summary: asObject(churnData.summary, { high: 0, medium: 0, low: 0 }),
        members: asArray(churnData.members),
      });
      setCampaignLogs(asArray(pickData(logsRes, [])));

      const failedCalls = [membersRes, plansRes, statsRes, chart30Res, chart7Res, attendanceRes, todayRes, setupRes, churnRes, logsRes]
        .filter((result) => result.status === 'rejected')
        .length;
      const successfulCalls = 10 - failedCalls;

      if (failedCalls > 0 && successfulCalls > 0) {
        toast?.(`${failedCalls} dashboard section(s) failed to load.`, 'warning');
      }

      if (failedCalls === 10 && warmupRetryCountRef.current === 0) {
        toast?.('Server is waking up. Dashboard will retry automatically.', 'warning');
      }

      if (successfulCalls === 0 && warmupRetryCountRef.current < MAX_WARMUP_RETRIES) {
        warmupRetryCountRef.current += 1;
        setIsWarmupRetrying(true);
        const retryDelayMs = Math.min(4000 * warmupRetryCountRef.current, 30000);
        if (warmupRetryTimerRef.current) {
          clearTimeout(warmupRetryTimerRef.current);
        }
        warmupRetryTimerRef.current = setTimeout(() => {
          fetchData();
        }, retryDelayMs);
      } else {
        warmupRetryCountRef.current = 0;
        setIsWarmupRetrying(false);
        if (warmupRetryTimerRef.current) {
          clearTimeout(warmupRetryTimerRef.current);
          warmupRetryTimerRef.current = null;
        }
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (warmupRetryTimerRef.current) {
        clearTimeout(warmupRetryTimerRef.current);
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => { if (token) fetchData(); }, [token]);

  const handleStartTour = () => {
      localStorage.setItem('gymvault_tour_completed', 'true');
      setShowTourBanner(false);
      startTour(); 
  }

  const handleSkipSetup = () => {
    localStorage.setItem('gymvault_skip_setup', 'true');
    setIsSkipped(true);
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    const normalizedPhone = normalizePhoneInput(addFormData.phone);
    if (!isValidPhoneInput(normalizedPhone)) {
      toast('Phone must be exactly 10 digits.', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('full_name', addFormData.full_name);
    formData.append('email', addFormData.email);
    formData.append('phone', normalizedPhone);
    if (addFile) formData.append('profile_pic', addFile);
    try {
      const res = await axios.post('/api/members/add', formData, {
        headers: { 'x-auth-token': token }
      });
      setShowAddModal(false);
      const newMember = res.data;
      
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
    } catch (_err) {
      toast(_err.response?.data?.error || 'Error adding member.', 'error');
    }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    if (!selectedMemberForPay || !selectedPlanForPay) {
      return toast('Please select a member and a plan.', 'warning');
    }

    setPaymentSubmitting(true);
    try {
      if (paymentMode === 'Online') {
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          toast('Failed to load Razorpay checkout.', 'error');
          return;
        }

        const orderRes = await axios.post('/api/memberships/online/create-order', {
          member_id: selectedMemberForPay,
          plan_id: selectedPlanForPay,
        }, headers);

        const order = orderRes.data?.order;
        const keyId = orderRes.data?.key_id;
        if (!order?.id || !keyId) {
          toast('Failed to start online payment. Missing gateway details.', 'error');
          return;
        }

        await new Promise((resolve) => {
          const options = {
            key: keyId,
            amount: order.amount,
            currency: order.currency || 'INR',
            name: 'Gym Membership Payment',
            description: orderRes.data?.plan?.name || 'Membership Plan',
            order_id: order.id,
            prefill: {
              name: orderRes.data?.member?.full_name || '',
              email: orderRes.data?.member?.email || '',
              contact: orderRes.data?.member?.phone || '',
            },
            theme: { color: '#6366f1' },
            handler: async (response) => {
              try {
                await axios.post('/api/memberships/online/verify', {
                  member_id: selectedMemberForPay,
                  plan_id: selectedPlanForPay,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }, headers);
                toast('Online payment recorded successfully!', 'success');
                setShowPaymentModal(false);
                setSelectedMemberForPay('');
                setSelectedPlanForPay('');
                fetchData();
              } catch (verifyErr) {
                toast(verifyErr?.response?.data?.error || 'Payment verification failed.', 'error');
              } finally {
                resolve();
              }
            },
            modal: {
              ondismiss: () => {
                resolve();
              },
            },
          };
          const rzp = new window.Razorpay(options);
          rzp.open();
        });
      } else {
        await axios.post('/api/memberships/activate', {
          member_id: selectedMemberForPay,
          plan_id: selectedPlanForPay,
          payment_mode: paymentMode,
          payment_id: null,
        }, headers);
        toast('Payment recorded successfully!', 'success');
        setShowPaymentModal(false);
        setSelectedMemberForPay('');
        setSelectedPlanForPay('');
        fetchData();
      }
    } catch (_err) {
      toast(_err?.response?.data?.error || 'Payment recording failed.', 'error');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const audienceToSegment = (audience) => ({
    All: 'ALL',
    Active: 'ACTIVE',
    Expiring: 'EXPIRING_7_DAYS',
    Ghosts: 'GHOSTS',
    Expired: 'EXPIRED',
    HighChurn: 'HIGH_CHURN',
  }[audience] || 'ALL');

  const loadCampaignPreview = async (audience) => {
    if (!token || !showBroadcastModal) return;
    setCampaignPreviewLoading(true);
    try {
      const segment = audienceToSegment(audience);
      const res = await axios.get(`/api/notifications/campaign/segments?segment=${segment}&limit=200`, headers);
      const payload = unwrapApiData(res.data) || {};
      setCampaignPreviewCount(Number(payload.total || 0));
    } catch (err) {
      setCampaignPreviewCount(0);
    } finally {
      setCampaignPreviewLoading(false);
    }
  };

  useEffect(() => {
    loadCampaignPreview(broadcastAudience);
  }, [broadcastAudience, showBroadcastModal]);

  useEffect(() => {
    const loadTemplates = async () => {
      if (!showBroadcastModal) return;
      try {
        const res = await axios.get('/api/settings/integrations', headers);
        const templates = Array.isArray(res.data?.templates) ? res.data.templates.filter((item) => item.is_active !== false) : [];
        setBroadcastTemplates(templates);
        const isSandbox = String(res.data?.whatsapp_mode || '') === 'SANDBOX';
        const smsReady = Boolean(res.data?.sms_ready);
        if (isSandbox && smsReady) {
          setBroadcastChannel('SMS');
        }
      } catch (_err) {
        setBroadcastTemplates([]);
      }
    };
    loadTemplates();
  }, [showBroadcastModal]);

  useEffect(() => {
    if (!broadcastTemplateKey) return;
    const selected = broadcastTemplates.find((item) => item.template_key === broadcastTemplateKey);
    if (!selected) return;
    const content = broadcastChannel === 'SMS' ? selected.sms_text : selected.whatsapp_text;
    setBroadcastMessage(String(content || ''));
  }, [broadcastTemplateKey, broadcastChannel, broadcastTemplates]);

  const handleBroadcast = async (e) => {
    e.preventDefault();
    try {
      setIsAutomating(true);
      const segment = audienceToSegment(broadcastAudience);
      const res = await axios.post('/api/notifications/campaign/run', {
        segment,
        channel: broadcastChannel,
        template_key: broadcastTemplateKey || undefined,
        message: broadcastMessage,
      }, headers);

      const payload = unwrapApiData(res.data) || {};
      const failed = Number(payload.failed_count || 0);
      const delivered = Number(payload.sent_to_count || 0);
      const fallbackSms = Number(payload.fallback_sms_count || 0);
      const statusLine = failed > 0
        ? `Campaign delivered to ${delivered} members, ${failed} failed.`
        : `Campaign delivered to ${delivered} members.`;

      const fullStatus = fallbackSms > 0
        ? `${statusLine} ${fallbackSms} sent via SMS fallback.`
        : statusLine;

      toast(fullStatus, failed > 0 ? 'warning' : 'success');
      setShowBroadcastModal(false);
      setBroadcastTemplateKey('');
      setBroadcastMessage('');
      fetchData();
    } catch (err) {
      toast(err?.response?.data?.error || 'Broadcast launch failed.', 'error');
    } finally {
      setIsAutomating(false);
    }
  };

  const handleQuickCheckIn = async (member) => {
    if (!member?.id || checkinBusyMemberId) return;
    setCheckinBusyMemberId(member.id);
    try {
      await axios.post('/api/attendance/checkin', {
        member_id: member.id,
        method: 'STAFF',
      }, headers);
      toast?.(`Checked in ${member.full_name}.`, 'success');
      await fetchData();
    } catch (err) {
      toast?.(err?.response?.data?.message || err?.response?.data?.error || 'Check-in failed.', 'error');
    } finally {
      setCheckinBusyMemberId(null);
    }
  };

  const dashboardData = useMemo(() => {
    const today = new Date();
    const active   = members.filter(m => m.membership_status === 'ACTIVE');
    const unpaid   = members.filter(m => m.membership_status === 'UNPAID');
    const expired  = members.filter(m => m.membership_status === 'EXPIRED');
    
    const expiringIn3Days = active.filter(m => m.days_left > 0 && m.days_left <= 3);
    const expiringIn7Days = active.filter(m => m.days_left > 0 && m.days_left <= 7);
    
    const ghosts = active.filter(m => {
      if (!m.last_visit) return true;
      return Math.floor((today - new Date(m.last_visit)) / 86400000) > 20;
    });

    const escalatedLeads = members.filter(m => {
      const daysAbsent = m.last_visit ? Math.floor((today - new Date(m.last_visit)) / 86400000) : 999;
      const isLongExpired = m.membership_status === 'EXPIRED' && m.days_left < -5;
      const isDeepGhost = m.membership_status === 'ACTIVE' && daysAbsent > 30;
      return isLongExpired || isDeepGhost;
    });

    const revenueAtRisk = expiringIn7Days.reduce((sum, m) => {
      const plan = plans.find(p => p.name === m.plan_name);
      return sum + parseFloat(plan?.price || 0);
    }, 0);

    const monthlyRevenue = chart30.reduce((sum, d) => sum + (d.revenue || 0), 0);
    const healthScore = members.length > 0 ? Math.round((active.length / members.length) * 100) : 0;
    const pendingDues = Number(payStats.pending_dues || 0);

    const planCounts = {};
    members.forEach(m => { if (m.plan_name) planCounts[m.plan_name] = (planCounts[m.plan_name] || 0) + 1; });
    const topPlanEntry = Object.entries(planCounts).sort((a, b) => b[1] - a[1])[0] || null;
    const topPlanPct = topPlanEntry && members.length > 0 ? Math.round((topPlanEntry[1] / members.length) * 100) : 0;

    const heatmap = attendanceHeatmap.map(d => ({ t: formatHour(d.hour), v: d.count }));

    const avgPlanPrice = plans.length > 0
      ? Math.round(plans.reduce((sum, p) => sum + Number(p.price || 0), 0) / plans.length)
      : 1500;
    const planPriceByName = new Map(plans.map((p) => [String(p.name || ''), Number(p.price || 0)]));
    const estimateMemberValue = (member) => {
      const byPlan = planPriceByName.get(String(member?.plan_name || ''));
      if (Number.isFinite(byPlan) && byPlan > 0) return byPlan;
      return avgPlanPrice;
    };

    const immediateRiskAmount = expiringIn3Days.reduce((sum, m) => sum + estimateMemberValue(m), 0);
    const highChurnMembers = (churnInsights.members || []).filter((m) => String(m.churn_tier).toUpperCase() === 'HIGH');
    const highChurnRiskAmount = highChurnMembers.reduce((sum, m) => sum + estimateMemberValue(m), 0);
    const ghostRiskAmount = ghosts.reduce((sum, m) => sum + Math.round(estimateMemberValue(m) * 0.65), 0);
    const expiredWinbackValue = Math.round(expired.length * avgPlanPrice * 0.5);

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

    const buildRecommendation = ({
      id,
      title,
      reason,
      count,
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

    const aiCandidates = [
      buildRecommendation({
        id: 'HIGH_CHURN',
        title: 'Launch retention for high-churn members',
        reason: `${highChurnMembers.length} members are in HIGH churn tier`,
        count: highChurnMembers.length,
        impact: highChurnRiskAmount,
        confidence: Math.min(95, 74 + highChurnMembers.length * 2),
        urgency: 'Today',
        priority: 'P0',
        cta: 'Launch Retention',
        sub: 'Prevent churn before expiry',
        action: () => {
          setBroadcastAudience('HighChurn');
          setBroadcastMessage('Hi from GymVault! We noticed your gym momentum dipped. We would love to support your comeback—reply and we will unlock a personalized renewal offer. 💪');
          setShowBroadcastModal(true);
        },
      }),
      buildRecommendation({
        id: 'EXPIRING_72H',
        title: 'Renew plans expiring in 72 hours',
        reason: `${expiringIn3Days.length} memberships will expire within 3 days`,
        count: expiringIn3Days.length,
        impact: immediateRiskAmount,
        confidence: Math.min(94, 70 + expiringIn3Days.length * 2),
        urgency: 'Today',
        priority: 'P0',
        cta: 'Draft Renewal Broadcast',
        sub: 'Immediate revenue protection',
        action: () => {
          setBroadcastAudience('Expiring');
          setBroadcastMessage('Hi! Quick reminder from GymVault: Your membership expires very soon. Renew today to keep crushing your fitness goals with us! 💪🔥');
          setShowBroadcastModal(true);
        },
      }),
      buildRecommendation({
        id: 'EXPIRED_WINBACK',
        title: 'Win back expired members',
        reason: `${expired.length} members are already expired`,
        count: expired.length,
        impact: expiredWinbackValue,
        confidence: Math.min(90, 62 + expired.length),
        urgency: 'This week',
        priority: 'P1',
        cta: 'Broadcast Winback',
        sub: 'Recover dormant revenue',
        action: () => {
          setBroadcastAudience('Expired');
          setBroadcastMessage('Hi from GymVault! Your membership has expired. We miss your energy at the gym. Let us know if you want to renew your plan! 🏋️‍♂️');
          setShowBroadcastModal(true);
        },
      }),
      buildRecommendation({
        id: 'GHOST_REACTIVATION',
        title: 'Reactivate inactive active-members',
        reason: `${ghosts.length} active members have not visited recently`,
        count: ghosts.length,
        impact: ghostRiskAmount,
        confidence: Math.min(88, 60 + Math.floor(ghosts.length * 0.8)),
        urgency: 'This week',
        priority: 'P1',
        cta: 'Open Inactive Members',
        sub: 'Stop silent churn',
        action: () => navigateTo('Members', 'Inactive'),
      }),
      buildRecommendation({
        id: 'UNPAID_ACTIVATION',
        title: 'Activate unpaid profiles',
        reason: `${unpaid.length} unpaid members are waiting for activation`,
        count: unpaid.length,
        impact: pendingDues,
        confidence: Math.min(86, 58 + unpaid.length),
        urgency: 'This week',
        priority: 'P1',
        cta: 'Activate Memberships',
        sub: 'Convert pending dues',
        action: () => setShowPaymentModal(true),
      }),
      buildRecommendation({
        id: 'ESCALATED_CALLS',
        title: 'Call escalated leads manually',
        reason: `${escalatedLeads.length} members are deeply unresponsive`,
        count: escalatedLeads.length,
        impact: Math.round(escalatedLeads.length * avgPlanPrice * 0.4),
        confidence: Math.min(84, 55 + escalatedLeads.length * 3),
        urgency: 'Today',
        priority: 'P0',
        cta: 'Open Escalations',
        sub: 'Human intervention required',
        action: () => navigateTo('Members', 'Inactive'),
      }),
    ].filter((candidate) => candidate.count > 0)
      .sort((a, b) => b.score - a.score);

    const recommendations = aiCandidates.slice(0, 3);
    const primary = recommendations[0] || {
      id: 'GROWTH',
      title: 'Launch growth campaign',
      reason: 'Retention signals are stable. Focus on acquiring and onboarding new members.',
      count: 0,
      impact: avgPlanPrice * 3,
      confidence: 78,
      urgency: 'This week',
      priority: 'P2',
      cta: 'Grow Business',
      sub: 'Acquire new members',
      action: () => setShowAddModal(true),
    };

    const aiSummary = recommendations.length > 0
      ? `Top priority: ${primary.title}. Estimated impact ₹${primary.impact.toLocaleString()} with ${primary.confidence}% confidence.`
      : `Gym health is ${healthScore}%. Operations are stable. Focus on growth by adding new members this week.`;

    const ACTION_SLOT_COUNT = 3;
    const actionRequiredRows = aiCandidates
      .filter((item) => item.priority === 'P0' || item.priority === 'P1')
      .slice(0, ACTION_SLOT_COUNT);

    const proactiveRows = [
      {
        id: 'PROACTIVE_GROWTH',
        title: 'Run growth outreach campaign',
        count: Math.max(1, Math.min(20, active.length || members.length || 1)),
        impact: Math.round(avgPlanPrice * 2.5),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Launch Growth',
        sub: 'Fill pipeline with fresh leads',
        action: () => {
          setBroadcastAudience('All');
          setBroadcastMessage('Hi from GymVault! Ready to crush your fitness goals this week? Reply to this message and we will unlock a special joining offer for you. 💪');
          setShowBroadcastModal(true);
        },
      },
      {
        id: 'PROACTIVE_ADD_MEMBER',
        title: 'Add and activate a new member',
        count: 1,
        impact: avgPlanPrice,
        urgency: 'Today',
        priority: 'P2',
        cta: 'Add Member',
        sub: 'Daily growth execution',
        action: () => setShowAddModal(true),
      },
      {
        id: 'PROACTIVE_CHURN_REVIEW',
        title: 'Review medium/high churn list',
        count: Math.max(1, (churnInsights.summary?.high || 0) + (churnInsights.summary?.medium || 0)),
        impact: Math.round((highChurnRiskAmount + ghostRiskAmount) * 0.25),
        urgency: 'This week',
        priority: 'P2',
        cta: 'Open Churn List',
        sub: 'Stay ahead of drop-offs',
        action: () => navigateTo('Members', 'Inactive'),
      },
    ];

    // Required actions temporarily occupy proactive slots until resolved.
    const mergedActionRows = [...actionRequiredRows, ...proactiveRows]
      .filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index)
      .slice(0, ACTION_SLOT_COUNT);
    const urgentCount = aiCandidates.filter((item) => item.priority === 'P0' || item.priority === 'P1').length;

    return {
      active: active.length, unpaid: unpaid.length, expired: expired.length,
      expiring7: expiringIn7Days.length, expiring3: expiringIn3Days.length, ghosts: ghosts.length,
      escalated: escalatedLeads,
      monthlyRevenue, revenueAtRisk, healthScore,
      topPlan: topPlanEntry ? { name: topPlanEntry[0], count: topPlanEntry[1], pct: topPlanPct } : null,
      heatmap,
      churnHigh: churnInsights.summary?.high || 0,
      ai: {
        summary: aiSummary,
        primary,
        recommendations,
        urgentCount,
      },
      actionRows: mergedActionRows,
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
  }, [members, plans, chart30, attendanceHeatmap, churnInsights, campaignLogs, payStats.pending_dues]);

  const [isAutomating, setIsAutomating] = useState(false);

  const displayChartData = useMemo(() => {
    const data = chartDays === 7 ? chart7 : chart30;
    return data.map(d => ({
      name: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      rev: d.revenue || 0,
    }));
  }, [chartDays, chart7, chart30]);

  const chartTotal = useMemo(() => {
    return (chartDays === 7 ? chart7 : chart30).reduce((s, d) => s + (d.revenue || 0), 0);
  }, [chartDays, chart7, chart30]);

  const checkedInMemberIds = useMemo(() => {
    return new Set(
      todayAttendance
        .map((row) => Number(row.member_id))
        .filter((id) => Number.isFinite(id))
    );
  }, [todayAttendance]);

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
  }, [members, checkinQuery, checkedInMemberIds]);


  if (loading) return <DashboardSkeleton />;

  return (
    <div className="min-h-full pb-24 sm:pb-28 font-inter relative">
      {animationStyles}

      {isWarmupRetrying && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm font-semibold">
          Backend is waking up. Retrying dashboard data automatically...
        </div>
      )}

      {/* ════════════════════════════════════════
          🚀 AI AUTO-PILOT TOUR INITIALIZATION
      ════════════════════════════════════════ */}
      {showTourBanner && !setup.is_complete && !isSkipped && (
        <div className="relative overflow-hidden bg-slate-900 rounded-[32px] shadow-2xl border border-slate-800 p-8 md:p-10 mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-purple-500/20 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
            <div className="w-40 h-40 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.4)] shrink-0">
               <Bot size={64} className="text-indigo-400 animate-bounce" />
            </div>
            <div className="flex-1 text-center md:text-left">
               <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-black uppercase tracking-widest mb-4">
                  <Sparkles size={14} /> Auto-Pilot Initialized
               </div>
               <h2 className="text-3xl md:text-4xl font-black text-white mb-4 tracking-tight">
                 Let's build your Gym, <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">together.</span>
               </h2>
               <p className="text-slate-400 font-medium text-lg leading-relaxed mb-8 max-w-2xl mx-auto md:mx-0">
                 Skip the manual setup. Click start, and our AI Guide will take control of your screen, automatically jumping through the software to explain exactly how to configure your business.
               </p>
               <div className="flex flex-col sm:flex-row items-center gap-4">
                  <button onClick={handleStartTour} className="w-full sm:w-auto px-8 py-4 bg-white text-slate-900 rounded-xl font-black text-sm hover:bg-indigo-50 transition-all hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2">
                     <Play size={18} fill="currentColor" /> Start Automated Tour
                  </button>
                  <button onClick={handleSkipSetup} className="w-full sm:w-auto px-6 py-4 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                     Skip Tour <X size={14} />
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          HERO BANNER
      ════════════════════════════════════════ */}
      <div
        id="tour-dashboard-hero"
        className="relative overflow-hidden rounded-[24px] sm:rounded-[28px] p-5 sm:p-6 md:p-8 mb-5 sm:mb-6"
        style={{
          background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
          boxShadow: '0 20px 60px rgba(48,43,99,0.25), 0 1px 0 rgba(255,255,255,0.05) inset',
          opacity: 0, animation: 'cardCascade 0.7s cubic-bezier(0.16,1,0.3,1) 0ms forwards'
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.28) 0%, transparent 70%)' }} />
          <div className="absolute right-1/2 -bottom-10 w-72 h-56 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.16) 0%, transparent 70%)' }} />
          <div className="absolute left-0 top-1/2 w-48 h-48 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%)' }} />
        </div>
        <div className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />

        <div className="relative flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 bg-emerald-400 rounded-full inline-block" style={{ animation: 'heroPulse 2s ease-in-out infinite' }} />
              <span className="text-emerald-400/80 text-[10px] font-black uppercase tracking-[0.22em]">Live Dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-[2.75rem] font-black text-white tracking-tight leading-none mb-2">
              {getGreeting()} 👋
            </h1>
            <p className="text-white/35 font-semibold text-sm">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="flex items-center gap-5 lg:gap-8 flex-wrap">
            {[
              { label: 'Active Members',  value: dashboardData.active,                              color: 'text-emerald-300' },
              { label: 'Monthly Revenue', value: `₹${dashboardData.monthlyRevenue.toLocaleString()}`, color: 'text-indigo-300' },
              { label: 'Health Score',    value: `${dashboardData.healthScore}%`,                    color: 'text-purple-300' },
            ].map((m, i) => (
              <React.Fragment key={m.label}>
                {i > 0 && <div className="w-[1px] h-10 bg-white/10 hidden sm:block" />}
                <div>
                  <p className={`text-2xl md:text-3xl font-black tracking-tight ${m.color}`}>{m.value}</p>
                  <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.2em] mt-0.5">{m.label}</p>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KPICard
            title="Active Members" value={dashboardData.active}
            icon={Users} index={0}
            iconGradient="linear-gradient(135deg, #10b981, #0d9488)"
            onClick={() => navigateTo('Members', 'Active')}
          />
          <KPICard
            title="Monthly Revenue" value={`₹${dashboardData.monthlyRevenue.toLocaleString()}`}
            icon={TrendingUp} index={1}
            iconGradient="linear-gradient(135deg, #6366f1, #8b5cf6)"
            onClick={() => navigateTo('Payments')}
          />
          <KPICard
            title="Today's Revenue" value={`₹${Number(payStats.today_revenue).toLocaleString()}`}
            icon={DollarSign} index={2}
            iconGradient="linear-gradient(135deg, #3b82f6, #0ea5e9)"
            onClick={() => navigateTo('Payments')}
          />
          <KPICard
            title="Expiring in 7 Days" value={dashboardData.expiring7}
            icon={Clock} index={3}
            iconGradient="linear-gradient(135deg, #f59e0b, #f97316)"
            onClick={() => navigateTo('Members', 'Expiring Soon')}
            tag={dashboardData.expiring7 > 0 ? 'Action needed' : undefined}
          />
        </div>

        <div className="grid grid-cols-12 gap-5">
          <Card
            className="col-span-12 lg:col-span-8 p-6 flex flex-col"
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
                {[7, 30].map(d => (
                  <button key={d} onClick={() => setChartDays(d)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${chartDays === d ? 'bg-white text-slate-900 shadow-sm shadow-black/5' : 'text-slate-500 hover:text-slate-700'}`}>
                    {d}D
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-[220px]">
              {displayChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={displayChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 0" vertical={false} stroke="rgba(99,102,241,0.06)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} dy={8} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                      tickFormatter={v => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} width={44} />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Area type="monotone" dataKey="rev" stroke="#6366f1" strokeWidth={2.5}
                      fillOpacity={1} fill="url(#revGrad)" dot={false} activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
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

          <div className="col-span-12 lg:col-span-4 flex flex-col gap-5">
            <div
              className="relative p-[1.5px] rounded-[24px] shadow-[0_4px_24px_rgba(99,102,241,0.2)]"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #a855f7, #ec4899)',
                opacity: 0, animation: 'cardCascade 0.6s ease-out 420ms forwards'
              }}
            >
              <div className="bg-white rounded-[23px] p-5 h-full flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                      <Sparkles size={14} className="text-white" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600">AI Engine</span>
                  </div>
                  <div className="text-[9px] font-bold text-slate-400 text-right">
                    <p>{dashboardData.automations.sentToday} Sent Today</p>
                    <p>{dashboardData.automations.runsToday} Runs</p>
                  </div>
                </div>
                
                <p className="text-slate-700 font-semibold text-sm leading-relaxed flex-1">
                  {dashboardData.ai.summary}
                </p>

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
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Est. Value</p>
                    <p className="text-xs font-black text-slate-800 mt-0.5">₹{dashboardData.automations.estimatedRecoveryValue.toLocaleString()}</p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-semibold">
                  Last automation: {dashboardData.automations.lastAutomationLabel}
                </p>

                <div className="space-y-1.5">
                  {dashboardData.ai.recommendations.map((rec, index) => {
                    const meta = getPriorityMeta(rec.priority);
                    return (
                      <button
                        key={rec.id}
                        onClick={rec.action}
                        className={`w-full text-left p-2 rounded-lg border transition-colors hover:bg-slate-50 ${meta.rowClass}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black text-slate-800 truncate">{index + 1}. {rec.title}</p>
                          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${meta.badgeClass}`}>{meta.label}</span>
                        </div>
                        <p className="text-[9px] text-slate-500 font-semibold mt-0.5">
                          ₹{Number(rec.impact || 0).toLocaleString()} impact · {rec.confidence}% confidence · {rec.urgency}
                        </p>
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={dashboardData.ai.primary.action}
                  disabled={isAutomating}
                  className="w-full py-2.5 rounded-xl font-bold text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-600 hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-70 disabled:cursor-wait"
                >
                  {isAutomating ? (
                    <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Zap size={13} fill="currentColor" /> 
                  )}
                  {isAutomating ? 'Running Automations...' : dashboardData.ai.primary.cta}
                </button>
              </div>
            </div>

            <Card
              className="p-0 overflow-hidden flex-1 flex flex-col"
              style={{ opacity: 0, animation: 'cardCascade 0.6s ease-out 500ms forwards' }}
            >
              <div className="px-5 py-4 border-b border-slate-100/80 flex justify-between items-center bg-slate-50/50">
                <h3 className="font-black text-slate-800 text-sm flex items-center gap-2">
                  <ShieldAlert size={16} className="text-rose-500" /> Action Required
                </h3>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {dashboardData.ai.urgentCount} urgent
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {dashboardData.actionRows.map((row) => {
                  const meta = getPriorityMeta(row.priority);
                  return (
                    <div key={row.id} className={`px-3 py-2.5 rounded-lg border flex items-center justify-between gap-2.5 transition-colors hover:bg-slate-50 ${meta.rowClass}`}>
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
                        onClick={row.action}
                        disabled={isAutomating || row.count === 0}
                        className={`shrink-0 px-3 py-1.5 text-[9px] font-black uppercase rounded-lg transition-all duration-200 ${meta.buttonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {row.cta}
                      </button>
                    </div>
                  );
                })}

                {dashboardData.escalated.length > 0 && (
                  <div className="bg-rose-50/30">
                    <div className="px-5 py-2 bg-rose-50 border-y border-rose-100">
                      <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1.5">
                        <Flame size={12} fill="currentColor" /> Escalated Leads (Call Now)
                      </p>
                    </div>
                    {dashboardData.escalated.slice(0, 3).map(lead => (
                      <div key={lead.id} className="px-5 py-3 flex items-center justify-between border-b border-rose-50 last:border-0 hover:bg-rose-50/50">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{lead.full_name}</p>
                          <p className="text-[10px] text-rose-400 font-semibold mt-0.5">Unresponsive • {lead.phone}</p>
                        </div>
                        <button
                          onClick={() => window.open(`tel:${lead.phone}`, '_self')}
                          className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-colors"
                        >
                          <Activity size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KPICard
            title="Check-ins Today" value={todayCheckins}
            icon={CheckCircle} index={8}
            iconGradient="linear-gradient(135deg, #14b8a6, #06b6d4)"
            onClick={() => navigateTo('Attendance')}
          />
          <KPICard
            title="Unpaid Profiles" value={dashboardData.unpaid}
            icon={CreditCard} index={9}
            iconGradient="linear-gradient(135deg, #64748b, #475569)"
            onClick={() => navigateTo('Members', 'Inactive')}
          />
          <KPICard
            title="Expired Members" value={dashboardData.expired}
            icon={UserMinus} index={10}
            iconGradient="linear-gradient(135deg, #f43f5e, #e11d48)"
            onClick={() => navigateTo('Members', 'Expired')}
            tag={dashboardData.expired > 0 ? 'Re-engage' : undefined}
          />
          <KPICard
            title="Pending Dues" value={`₹${Number(payStats.pending_dues).toLocaleString()}`}
            icon={Activity} index={11}
            iconGradient="linear-gradient(135deg, #f97316, #ef4444)"
            onClick={() => navigateTo('Payments')}
          />
        </div>

      </div>

      {/* ════════════════════════════════════════
          FLOATING ACTION BAR
      ════════════════════════════════════════ */}
      <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-8 duration-700 [animation-delay:800ms] [animation-fill-mode:both] w-[calc(100%-1rem)] md:w-auto">
        <div
          className="p-2 rounded-full flex items-center gap-0.5 backdrop-blur-xl border border-white/10 overflow-x-auto"
          style={{
            background: 'rgba(15, 15, 35, 0.92)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)'
          }}
        >
          <button id="btn-add-member" onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white transition-all duration-200 group hover:bg-emerald-500/15 active:scale-95">
            <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:rotate-90 transition-all duration-300"
              style={{ boxShadow: '0 0 12px rgba(16,185,129,0.5)' }}>
              <Plus size={14} strokeWidth={3} className="text-white" />
            </div>
            <span className="text-sm font-bold">Add Member</span>
          </button>

          <div className="w-px h-6 bg-white/10 mx-1" />

      <button onClick={() => setShowPaymentModal(true)}
            className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-indigo-500/15 rounded-full text-sm font-bold transition-all flex items-center gap-2 active:scale-95 group">
            <RefreshCw size={16} className="group-hover:scale-110 transition-transform" /> Renew
          </button>

          <button onClick={() => setShowBroadcastModal(true)}
            className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-emerald-500/15 rounded-full text-sm font-bold transition-all flex items-center gap-2 active:scale-95 group">
            <MessageSquare size={16} className="group-hover:scale-110 transition-transform" /> Broadcast
          </button>

          <button
            onClick={() => {
              setCheckinQuery('');
              setShowCheckinModal(true);
            }}
            className="px-4 py-2.5 text-slate-300 hover:text-white hover:bg-sky-500/15 rounded-full text-sm font-bold transition-all flex items-center gap-2 active:scale-95 group"
          >
            <CheckCircle size={16} className="group-hover:scale-110 transition-transform" /> Check In
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════
          MODALS
      ════════════════════════════════════════ */}

      {/* Add Member */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-0 sm:p-4">
          <div className="bg-white rounded-t-[28px] sm:rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150 max-h-[92dvh] sm:max-h-[90dvh]">
            <div
              className="relative p-6 text-white flex justify-between items-center"
              style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <UserPlus size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-black">New Member</h2>
                  <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider">Add to GymVault</p>
                </div>
              </div>
              <button
                onClick={() => { setShowAddModal(false); setAddSelectedPlanId(''); setPreviewUrl(null); setAddFile(null); }}
                className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="p-6 space-y-4 overflow-y-auto max-h-[calc(92dvh-96px)] sm:max-h-none">
              <div className="flex flex-col items-center">
                <label className="cursor-pointer block">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-slate-300">
                        <UserPlus size={28} />
                        <span className="text-[9px] font-bold uppercase tracking-wider">Upload</span>
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      setAddFile(e.target.files[0]);
                      setPreviewUrl(URL.createObjectURL(e.target.files[0]));
                    }}
                  />
                </label>
                <p className="text-[10px] text-slate-400 font-medium mt-2">Click to upload photo (optional)</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
                  value={addFormData.full_name}
                  onChange={(e) => setAddFormData({ ...addFormData, full_name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone *</label>
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[0-9]{10}"
                    title="Enter exactly 10 digits"
                    placeholder="9876543210"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
                    value={addFormData.phone}
                    onChange={(e) => setAddFormData({ ...addFormData, phone: normalizePhoneInput(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="rahul@email.com"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
                    value={addFormData.email}
                    onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">
                  <Zap size={10} className="text-emerald-500" /> Assign Plan Now (optional)
                </label>
                <select
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 text-sm font-semibold text-slate-700 appearance-none cursor-pointer transition-all"
                  value={addSelectedPlanId}
                  onChange={(e) => setAddSelectedPlanId(e.target.value)}
                >
                  <option value="">Skip — assign plan later</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ₹{p.price} / {p.duration_days}d
                    </option>
                  ))}
                </select>
                {addSelectedPlanId && (
                  <p className="text-[10px] text-emerald-600 font-bold mt-1.5 ml-0.5">
                    Payment will be collected in the next step →
                  </p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg"
                style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(5,150,105,0.35)' }}
              >
                {addSelectedPlanId ? 'Add Member & Assign Plan →' : 'Add Member'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-end sm:items-center justify-center z-[200] p-0 sm:p-4">
          <div className="bg-white rounded-t-[24px] sm:rounded-[24px] w-full max-w-md shadow-2xl animate-in zoom-in-95 fade-in duration-200 overflow-hidden max-h-[92dvh] sm:max-h-[90dvh]">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  <CreditCard size={17} className="text-white" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Record Payment</h2>
              </div>
              <button onClick={() => setShowPaymentModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <form onSubmit={handlePayment} className="p-6 space-y-4 overflow-y-auto max-h-[calc(92dvh-84px)] sm:max-h-none">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Member</label>
                <select required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={selectedMemberForPay} onChange={e => setSelectedMemberForPay(e.target.value)}>
                  <option value="">Choose a member...</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.phone})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Plan</label>
                <select required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={selectedPlanForPay} onChange={e => setSelectedPlanForPay(e.target.value)}>
                  <option value="">Choose a plan...</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Payment Mode</label>
                <div className="flex gap-2">
                  {['Cash', 'Online'].map(mode => (
                    <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                      className={`flex-1 py-2.5 rounded-xl font-bold text-sm border transition-all ${paymentMode === mode ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                      {mode === 'Online' ? 'Online / UPI' : mode}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit"
                disabled={paymentSubmitting}
                className="w-full py-3 rounded-xl font-black text-sm text-white mt-2 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-98"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                <Zap size={16} fill="currentColor" /> {paymentSubmitting ? 'Processing...' : 'Complete Transaction'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Broadcast */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-end sm:items-center justify-center z-[200] p-0 sm:p-4">
          <div className="bg-white rounded-t-[24px] sm:rounded-[24px] w-full max-w-md shadow-2xl animate-in zoom-in-95 fade-in duration-200 overflow-hidden max-h-[92dvh] sm:max-h-[90dvh]">
            <div className="px-6 py-5 flex justify-between items-center"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
              <div className="flex items-center gap-3">
                <MessageSquare size={20} className="text-white" />
                <h2 className="text-lg font-black text-white">Bulk Broadcast</h2>
              </div>
              <button onClick={() => setShowBroadcastModal(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
                <X size={16} className="text-white" />
              </button>
            </div>
            <form onSubmit={handleBroadcast} className="p-6 space-y-4 overflow-y-auto max-h-[calc(92dvh-84px)] sm:max-h-none">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Target Audience</label>
               <select
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  value={broadcastAudience} onChange={e => setBroadcastAudience(e.target.value)}>
                  <option value="All">All Members ({members.length})</option>
                  <option value="Active">Active Members ({dashboardData.active})</option>
                  <option value="Expiring">Expiring Soon ({dashboardData.expiring7})</option>
                  <option value="Expired">Expired Members ({dashboardData.expired})</option>
                  <option value="Ghosts">Ghost Members ({dashboardData.ghosts})</option>
                  <option value="HighChurn">High Churn Risk ({dashboardData.churnHigh})</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  {campaignPreviewLoading ? 'Loading segment preview...' : `Estimated audience: ${campaignPreviewCount}`}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Channel</label>
                  <select
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    value={broadcastChannel}
                    onChange={(e) => setBroadcastChannel(e.target.value)}
                  >
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Template</label>
                  <select
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    value={broadcastTemplateKey}
                    onChange={(e) => setBroadcastTemplateKey(e.target.value)}
                  >
                    <option value="">Custom Message</option>
                    {broadcastTemplates.map((template) => (
                      <option key={template.template_key} value={template.template_key}>{template.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Campaign Message</label>
                <textarea required rows={4}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                  placeholder="Type your message here..."
                  value={broadcastMessage} onChange={e => setBroadcastMessage(e.target.value)} />
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">Opens WhatsApp Web tabs for each member individually.</p>
              </div>
              <button type="submit"
                className="w-full py-3 rounded-xl font-black text-sm text-white mt-2 transition-all hover:opacity-90 active:scale-98"
                style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}>
                Launch Broadcast
              </button>
            </form>
          </div>
        </div>
      )}

      {showCheckinModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-md flex items-end sm:items-center justify-center z-[200] p-0 sm:p-4">
          <div className="bg-white rounded-t-[24px] sm:rounded-[24px] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 overflow-hidden max-h-[92dvh] sm:max-h-[90dvh]">
            <div
              className="px-6 py-5 flex justify-between items-center"
              style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)' }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle size={20} className="text-white" />
                <div>
                  <h2 className="text-lg font-black text-white">Manual Check-In</h2>
                  <p className="text-white/75 text-[10px] font-bold uppercase tracking-wider">Identify quickly with photo + details</p>
                </div>
              </div>
              <button
                onClick={() => setShowCheckinModal(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
              >
                <X size={16} className="text-white" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(92dvh-88px)] sm:max-h-[75vh]">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <input
                  type="text"
                  value={checkinQuery}
                  onChange={(e) => setCheckinQuery(e.target.value)}
                  placeholder="Search by name, phone, or email"
                  className="w-full sm:max-w-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                  Checked in today: {todayCheckins}
                </p>
              </div>

              {checkinMembers.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70">
                  <p className="text-sm font-bold text-slate-500">No members found for this search.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                  {checkinMembers.map((member) => {
                    const isCheckedIn = checkedInMemberIds.has(Number(member.id));
                    const membershipStatus = String(member.membership_status || 'UNPAID').toUpperCase();
                    const statusClass = membershipStatus === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      : membershipStatus === 'EXPIRED'
                        ? 'bg-rose-50 text-rose-700 border border-rose-100'
                        : 'bg-amber-50 text-amber-700 border border-amber-100';
                    const initials = String(member.full_name || '?')
                      .split(' ')
                      .filter(Boolean)
                      .map((part) => part[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();

                    return (
                      <div key={member.id} className="p-3 rounded-2xl border border-slate-100 bg-white flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                            {member.profile_pic ? (
                              <img src={member.profile_pic} alt={member.full_name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-xs font-black">
                                {initials}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{member.full_name}</p>
                            <p className="text-[11px] text-slate-500 font-semibold truncate">{member.phone}{member.email ? ` · ${member.email}` : ''}</p>
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${statusClass}`}>
                                {membershipStatus}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${isCheckedIn ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                                {isCheckedIn ? 'Checked Today' : 'Not Checked In'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleQuickCheckIn(member)}
                          disabled={isCheckedIn || checkinBusyMemberId === member.id}
                          className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
                        >
                          {checkinBusyMemberId === member.id ? 'Checking...' : isCheckedIn ? 'Checked' : 'Check In'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;