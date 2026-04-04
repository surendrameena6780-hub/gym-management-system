import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Users, DollarSign, Plus, Zap, MessageSquare, ShieldAlert,
  Sparkles, Clock, CheckCircle, CreditCard, Flame, UserMinus, Activity,
  X, TrendingUp, ChevronRight, UserPlus, RefreshCw, Check,
  Bot, Play, Trash2 // <-- 🚨 ADDED ICONS
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import PageLoader from './PageLoader';

// ─── Count-Up Hook ─────────────────────────────────────────────────────────────
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
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return display;
}

const buildProfileUrl = (pic) => normalizeProfileImageUrl(pic);

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

const DEFAULT_BROADCAST_MESSAGES = {
  All: 'Hi {{name}}, here is an update from {{gym_name}}. Reply if you need any help with your membership.',
  Active: 'Hi {{name}}, thanks for training with {{gym_name}}. Reply if you need help with your current plan or goals.',
  Expiring: 'Hi {{name}}, your membership at {{gym_name}} expires this week. Renew in time to keep your plan active.',
  Expired: 'Hi {{name}}, your membership at {{gym_name}} has expired. Reply if you want help restarting with the best plan for you.',
  Ghosts: 'Hi {{name}}, we have missed you at {{gym_name}}. Reply if you want help getting back into your routine.',
  HighChurn: 'Hi {{name}}, we noticed your routine at {{gym_name}} has slowed down. Reply and we will help you with the right plan to get back on track.',
};

const resolveBroadcastAudienceMessage = (audience) => DEFAULT_BROADCAST_MESSAGES[audience] || DEFAULT_BROADCAST_MESSAGES.All;

const ESCALATED_LEAD_DELETE_WIDTH = 96;
const ESCALATED_LEAD_DELETE_THRESHOLD = 42;

const getEscalatedLeadSwipeOffset = (value) => {
  if (value > 0) return value * 0.2;
  if (value < -ESCALATED_LEAD_DELETE_WIDTH) {
    return -ESCALATED_LEAD_DELETE_WIDTH + (value + ESCALATED_LEAD_DELETE_WIDTH) * 0.18;
  }
  return value;
};

const EscalatedLeadRow = ({
  lead,
  canDelete,
  isOpen,
  isDeleting,
  onOpen,
  onClose,
  onDelete,
}) => {
  const gestureRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    baseOffset: 0,
    dragging: false,
  });
  const offsetRef = useRef(canDelete && isOpen ? -ESCALATED_LEAD_DELETE_WIDTH : 0);
  const [dragOffset, setDragOffset] = useState(offsetRef.current);
  const [isDragging, setIsDragging] = useState(false);

  const setOffset = useCallback((nextOffset) => {
    offsetRef.current = nextOffset;
    setDragOffset(nextOffset);
  }, []);

  useEffect(() => {
    if (gestureRef.current.dragging) return;
    setOffset(canDelete && isOpen ? -ESCALATED_LEAD_DELETE_WIDTH : 0);
  }, [canDelete, isOpen, setOffset]);

  const resetGesture = useCallback(() => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      baseOffset: 0,
      dragging: false,
    };
    setIsDragging(false);
  }, []);

  const finishGesture = useCallback((event) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    if (!gesture.dragging) {
      resetGesture();
      return;
    }

    const shouldOpen = offsetRef.current <= -ESCALATED_LEAD_DELETE_THRESHOLD;
    setOffset(shouldOpen ? -ESCALATED_LEAD_DELETE_WIDTH : 0);

    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetGesture();
    if (shouldOpen) {
      onOpen();
    } else {
      onClose();
    }
  }, [onClose, onOpen, resetGesture, setOffset]);

  const handlePointerDown = (event) => {
    if (!canDelete || isDeleting) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseOffset: isOpen ? -ESCALATED_LEAD_DELETE_WIDTH : 0,
      dragging: false,
    };
  };

  const handlePointerMove = (event) => {
    if (!canDelete || isDeleting) return;

    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (!gesture.dragging) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        resetGesture();
        return;
      }

      gesture.dragging = true;
      gestureRef.current = gesture;
      setIsDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    event.preventDefault();
    setOffset(getEscalatedLeadSwipeOffset(gesture.baseOffset + deltaX));
  };

  const handlePointerCancel = (event) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;

    setOffset(canDelete && isOpen ? -ESCALATED_LEAD_DELETE_WIDTH : 0);
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetGesture();
  };

  return (
    <div
      className={`dashboard-escalated-row${canDelete ? ' dashboard-escalated-row--swipable' : ''}${isDragging ? ' dashboard-escalated-row--dragging' : ''}${isOpen ? ' dashboard-escalated-row--open' : ''}${isDeleting ? ' dashboard-escalated-row--busy' : ''}`}
    >
      {canDelete && (
        <div className="dashboard-escalated-delete-rail" aria-hidden={!isOpen && !isDragging}>
          <button
            type="button"
            onClick={() => onDelete(lead)}
            className="dashboard-escalated-delete-btn"
            disabled={isDeleting}
          >
            <Trash2 size={15} />
            <span>{isDeleting ? 'Deleting' : 'Delete'}</span>
          </button>
        </div>
      )}
      <div
        className="dashboard-escalated-surface"
        style={{ transform: `translate3d(${dragOffset}px, 0, 0)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={(event) => {
          if (gestureRef.current.dragging) {
            finishGesture(event);
          }
        }}
        onClick={(event) => {
          if (isOpen && !(event.target instanceof Element && event.target.closest('button'))) {
            onClose();
          }
        }}
      >
        <div className="min-w-0">
          <p className="dashboard-escalated-name">{lead.full_name}</p>
          <p className="dashboard-escalated-meta">Unresponsive • {lead.phone}</p>
        </div>
        <button
          type="button"
          onClick={() => window.open(`tel:${lead.phone}`, '_self')}
          className="dashboard-escalated-call"
        >
          <Activity size={14} />
        </button>
      </div>
    </div>
  );
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
  <div className="min-h-full p-0 dashboard-content-safe">
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

const KPICard = ({ title, value, icon: Icon, iconGradient, index = 0, onClick, tag }) => {
  // Detect prefix/suffix and animate the numeric part
  const strVal = String(value ?? '');
  const prefix = strVal.startsWith('₹') ? '₹' : '';
  const suffix = strVal.endsWith('%') ? '%' : '';
  const rawNum = parseFloat(strVal.replace(/[₹%,]/g, ''));
  const isNumeric = !Number.isNaN(rawNum);
  const animated = useCountUp(isNumeric ? rawNum : 0);
  const displayVal = isNumeric
    ? `${prefix}${animated.toLocaleString()}${suffix}`
    : strVal;

  return (
  <div
    onClick={onClick}
    className={`group relative overflow-hidden bg-white/85 backdrop-blur-sm rounded-[20px] sm:rounded-[24px] border border-white/60 p-4 sm:p-5 flex flex-col justify-between shadow-[0_2px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_10px_36px_rgba(0,0,0,0.09)] hover:-translate-y-1 transition-all duration-300 ${onClick ? 'cursor-pointer' : ''}`}
    style={{ opacity: 0, animation: `cardCascade 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 75}ms forwards` }}
  >
    <div
      className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-28 sm:h-28 rounded-full opacity-[0.045] group-hover:opacity-[0.09] group-hover:scale-125 transition-all duration-700"
      style={{ background: iconGradient }}
    />
    <div className="flex items-start justify-between relative z-10">
      <div
        className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-lg"
        style={{ background: iconGradient, boxShadow: `0 4px 14px rgba(0,0,0,0.15)` }}
      >
        <Icon size={17} strokeWidth={2} />
      </div>
      {onClick && (
        <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-indigo-50 flex items-center justify-center transition-colors duration-200 mt-0.5">
          <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-400 transition-colors duration-200" />
        </div>
      )}
    </div>
    <div className="relative z-10 mt-2.5 sm:mt-3">
      {tag && (
        <span className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-500 mb-1.5">{tag}</span>
      )}
      <h3 className="text-[23px] sm:text-[26px] font-black text-slate-900 tracking-tight leading-none">{displayVal}</h3>
      <p className="text-slate-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mt-1.5">{title}</p>
    </div>
  </div>
  );
};

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
const DashboardPage = ({ token, setCurrentPage, toast, navigateTo: navTo, startTour, currentUser, showConfirm, isActive = true }) => {
  const navigateTo = navTo || ((page) => setCurrentPage?.(page));
  const DASHBOARD_REQUEST_TIMEOUT_MS = 12000;
  const MAX_WARMUP_RETRIES = 8;
  const canDeleteEscalatedLeads = String(currentUser?.role || '').toUpperCase() === 'OWNER';

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
  const [openEscalatedLeadId, setOpenEscalatedLeadId] = useState(null);
  const [deletingEscalatedLeadId, setDeletingEscalatedLeadId] = useState(null);
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
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [quickActionLoading, setQuickActionLoading] = useState('');
  const isAnyDashboardModalOpen = showAddModal || showPaymentModal || showBroadcastModal || showCheckinModal;
  const quickActionTimerRef = useRef(null);

  // Form states
  const [addFormData, setAddFormData] = useState({ full_name: '', email: '', phone: '' });
  const [addFile, setAddFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [addSelectedPlanId, setAddSelectedPlanId] = useState('');
  const [selectedMemberForPay, setSelectedMemberForPay] = useState('');
  const [payMemberSearch, setPayMemberSearch] = useState('');
  const [payMemberDropdownOpen, setPayMemberDropdownOpen] = useState(false);
  const [selectedPlanForPay, setSelectedPlanForPay] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentStep, setPaymentStep] = useState('idle'); // 'idle' | 'processing' | 'success'
  const [broadcastAudience, setBroadcastAudience] = useState('All');
  const [broadcastChannel, setBroadcastChannel] = useState('WHATSAPP');
  const [broadcastTemplateKey, setBroadcastTemplateKey] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastCustomIds, setBroadcastCustomIds] = useState([]);
  const [campaignPreviewCount, setCampaignPreviewCount] = useState(0);
  const [campaignPreviewLoading, setCampaignPreviewLoading] = useState(false);
  const [broadcastTemplates, setBroadcastTemplates] = useState([]);
  const [gymName, setGymName] = useState('');
  const [gymBilling, setGymBilling] = useState({
    saas_status: 'FREE_TRIAL',
    saas_valid_until: '',
    current_plan: 'pro',
    saas_billing_cycle: 'monthly',
  });
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

  const handleDeleteEscalatedLead = useCallback((lead) => {
    if (!canDeleteEscalatedLeads) return;

    showConfirm?.({
      title: 'Delete Member',
      message: `Delete ${lead.full_name} from GymVault? This cannot be undone.`,
      confirmLabel: 'Delete Member',
      variant: 'danger',
      onConfirm: async () => {
        try {
          setDeletingEscalatedLeadId(lead.id);
          await axios.delete(`/api/members/${lead.id}`, headers);
          setOpenEscalatedLeadId((current) => (current === lead.id ? null : current));
          setMembers((prev) => prev.filter((member) => member.id !== lead.id));
          toast?.('Member deleted.', 'success');
        } catch (err) {
          const message = err?.response?.data?.error || err?.response?.data?.message || 'Delete failed.';
          toast?.(message, 'error');
        } finally {
          setDeletingEscalatedLeadId(null);
        }
      },
    });
  }, [canDeleteEscalatedLeads, headers, showConfirm, toast]);

  const fetchData = async () => {
    try {
      const requestConfig = { ...headers, timeout: DASHBOARD_REQUEST_TIMEOUT_MS };
      const [
        membersRes, plansRes, statsRes,
        chart30Res, chart7Res, attendanceRes,
        todayRes, setupRes, churnRes, logsRes,
        settingsRes
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
        axios.get('/api/settings', requestConfig)
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
      setSetup(asObject(pickData(setupRes, { progress: 0, is_complete: false, steps: {} }), { progress: 0, is_complete: false, steps: {} }));
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

      const failedCalls = [membersRes, plansRes, statsRes, chart30Res, chart7Res, attendanceRes, todayRes, setupRes, churnRes, logsRes, settingsRes]
        .filter((result) => result.status === 'rejected')
        .length;
      const successfulCalls = 11 - failedCalls;

      if (failedCalls > 0 && successfulCalls > 0) {
        toast?.(`${failedCalls} dashboard section(s) failed to load.`, 'warning');
      }

      if (failedCalls === 11 && warmupRetryCountRef.current === 0) {
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
      if (quickActionTimerRef.current) {
        clearTimeout(quickActionTimerRef.current);
      }
      if (warmupRetryTimerRef.current) {
        clearTimeout(warmupRetryTimerRef.current);
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('app-modal-open', Boolean(isActive && isAnyDashboardModalOpen));

    return () => {
      root.classList.remove('app-modal-open');
    };
  }, [isActive, isAnyDashboardModalOpen]);

  useEffect(() => {
    if (!token || !isActive) return;

    fetchData();

    const handleExternalRefresh = () => {
      fetchData();
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    window.addEventListener('focus', handleExternalRefresh);
    window.addEventListener('gymvault:data-changed', handleExternalRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', handleExternalRefresh);
      window.removeEventListener('gymvault:data-changed', handleExternalRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [token, isActive]);

  useEffect(() => {
    if (!openEscalatedLeadId) return;

    const handleCloseSwipe = (event) => {
      if (event.target instanceof Element && event.target.closest('.dashboard-escalated-row')) return;
      setOpenEscalatedLeadId(null);
    };

    document.addEventListener('pointerdown', handleCloseSwipe);
    return () => {
      document.removeEventListener('pointerdown', handleCloseSwipe);
    };
  }, [openEscalatedLeadId]);

  const handleStartTour = () => {
      localStorage.setItem('gymvault_tour_completed', 'true');
      setShowTourBanner(false);
      startTour(); 
  }

  const handleSkipSetup = () => {
    localStorage.setItem('gymvault_skip_setup', 'true');
    setIsSkipped(true);
  };

  const launchQuickAction = useCallback((actionKey, action) => {
    if (quickActionLoading) return;
    setQuickActionLoading(actionKey);
    if (quickActionTimerRef.current) {
      clearTimeout(quickActionTimerRef.current);
    }
    quickActionTimerRef.current = setTimeout(() => {
      action();
      setQuickActionLoading('');
      quickActionTimerRef.current = null;
    }, 160);
  }, [quickActionLoading]);

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
      setAddSubmitting(true);
      const res = await axios.post('/api/members/add', formData, {
        headers: { 'x-auth-token': token }
      });
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
    } catch (_err) {
      toast(_err.response?.data?.error || 'Error adding member.', 'error');
    } finally {
      setAddSubmitting(false);
    }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    if (!selectedMemberForPay || !selectedPlanForPay) {
      return toast('Please select a member and a plan.', 'warning');
    }

    setPaymentSubmitting(true);
    setPaymentStep('processing');
    try {
      if (paymentMode === 'Online') {
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          toast('Failed to load Razorpay checkout.', 'error');
          setPaymentStep('idle');
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
          setPaymentStep('idle');
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
                // Auto check-in for today so member shows ACTIVE immediately
                try { await axios.post('/api/attendance/checkin', { member_id: selectedMemberForPay, method: 'STAFF' }, headers); } catch (_) {}
                window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payment-modal' } }));
                setPaymentStep('success');
                await new Promise(r => setTimeout(r, 1500));
                setShowPaymentModal(false);
                setSelectedMemberForPay('');
                setSelectedPlanForPay('');
                setPaymentStep('idle');
                fetchData();
              } catch (verifyErr) {
                toast(verifyErr?.response?.data?.error || 'Payment verification failed.', 'error');
                setPaymentStep('idle');
              } finally {
                resolve();
              }
            },
            modal: {
              ondismiss: () => {
                setPaymentStep('idle');
                resolve();
              },
            },
          };
          const rzp = new window.Razorpay(options);
          rzp.open();
        });
      } else {
        const paidMemberId = selectedMemberForPay;
        await axios.post('/api/memberships/activate', {
          member_id: paidMemberId,
          plan_id: selectedPlanForPay,
          payment_mode: paymentMode,
          payment_id: null,
        }, headers);
        // Auto check-in for today so member shows ACTIVE immediately
        try { await axios.post('/api/attendance/checkin', { member_id: paidMemberId, method: 'STAFF' }, headers); } catch (_) {}
        window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payment-modal' } }));
        setPaymentStep('success');
        await new Promise(r => setTimeout(r, 1500));
        setShowPaymentModal(false);
        setSelectedMemberForPay('');
        setSelectedPlanForPay('');
        setPaymentStep('idle');
        fetchData();
      }
    } catch (_err) {
      toast(_err?.response?.data?.error || 'Payment recording failed.', 'error');
      setPaymentStep('idle');
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
    if (broadcastCustomIds.length > 0) {
      setCampaignPreviewCount(broadcastCustomIds.length);
      setCampaignPreviewLoading(false);
      return;
    }
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
  }, [broadcastAudience, showBroadcastModal, broadcastCustomIds.length]);

  useEffect(() => {
    const loadTemplatesAndGymName = async () => {
      if (!showBroadcastModal) return;
      try {
        const [intRes, settRes] = await Promise.allSettled([
          axios.get('/api/settings/integrations', headers),
          axios.get('/api/settings', headers),
        ]);
        if (intRes.status === 'fulfilled') {
          const data = intRes.value.data || {};
          const templates = Array.isArray(data.templates) ? data.templates.filter((item) => item.is_active !== false) : [];
          setBroadcastTemplates(templates);
          const isSandbox = String(data.whatsapp_mode || '') === 'SANDBOX';
          const smsReady = Boolean(data.sms_ready);
          if (isSandbox && smsReady) setBroadcastChannel('SMS');
        } else {
          setBroadcastTemplates([]);
        }
        if (settRes.status === 'fulfilled') {
          const payload = settRes.value.data || {};
          const gym = payload.gym || payload.data?.gym || {};
          const acc = payload.account || payload.data?.account || {};
          const name = String(gym.name || acc.gym_name || '').trim();
          if (name) setGymName(name);
        }
      } catch (_err) {
        setBroadcastTemplates([]);
      }
    };
    loadTemplatesAndGymName();
  }, [showBroadcastModal]);

  useEffect(() => {
    if (!broadcastTemplateKey) return;
    const selected = broadcastTemplates.find((item) => item.template_key === broadcastTemplateKey);
    if (!selected) return;
    const content = broadcastChannel === 'SMS' ? selected.sms_text : selected.whatsapp_text;
    let resolved = String(content || '');
    if (gymName) resolved = resolved.replace(/\{\{gym_name\}\}/gi, gymName);
    setBroadcastMessage(resolved);
  }, [broadcastTemplateKey, broadcastChannel, broadcastTemplates]);

  useEffect(() => {
    if (!showBroadcastModal || broadcastTemplateKey || broadcastCustomIds.length > 0) return;
    if (String(broadcastMessage || '').trim()) return;
    setBroadcastMessage(resolveBroadcastAudienceMessage(broadcastAudience));
  }, [showBroadcastModal, broadcastAudience, broadcastTemplateKey, broadcastCustomIds.length, broadcastMessage]);

  // If gym name loads after template was already selected, resolve {{gym_name}} in-place
  useEffect(() => {
    if (!gymName) return;
    setBroadcastMessage((prev) =>
      prev.includes('{{gym_name}}') ? prev.replace(/\{\{gym_name\}\}/gi, gymName) : prev
    );
  }, [gymName]);

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
        member_ids: broadcastCustomIds,
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
      setBroadcastSearch('');
      setBroadcastCustomIds([]);
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
      window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'dashboard-checkin' } }));
    } catch (err) {
      toast?.(err?.response?.data?.message || err?.response?.data?.error || 'Check-in failed.', 'error');
    } finally {
      setCheckinBusyMemberId(null);
    }
  };

  const openBroadcastDraft = (audience, message) => {
    setBroadcastAudience(audience);
    setBroadcastTemplateKey('');
    setBroadcastSearch('');
    setBroadcastCustomIds([]);
    setBroadcastMessage(message);
    setShowBroadcastModal(true);
  };

  const openBroadcastDraftForMembers = ({ memberIds = [], message = '', audience = 'All' }) => {
    const normalizedIds = Array.from(new Set(
      asArray(memberIds)
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id))
    ));
    setBroadcastAudience(audience);
    setBroadcastTemplateKey('');
    setBroadcastSearch('');
    setBroadcastCustomIds(normalizedIds);
    setBroadcastMessage(message);
    setShowBroadcastModal(true);
  };

  const normalizeActionMembers = (sourceMembers) => {
    const uniqueMembers = new Map();
    asArray(sourceMembers).forEach((member) => {
      const id = Number.parseInt(member?.id, 10);
      if (!Number.isInteger(id) || uniqueMembers.has(id)) return;
      uniqueMembers.set(id, member);
    });
    return Array.from(uniqueMembers.values());
  };

  const normalizeActionPayments = (sourcePayments) => {
    const uniquePayments = new Map();
    asArray(sourcePayments).forEach((payment) => {
      const id = Number.parseInt(payment?.id, 10);
      if (!Number.isInteger(id) || uniquePayments.has(id)) return;
      uniquePayments.set(id, payment);
    });
    return Array.from(uniquePayments.values());
  };

  const buildSmartMemberCta = ({
    members: sourceMembers,
    singleFilter = 'All',
    singleOptions = {},
    singleCta = 'Open Member',
    bulkCta = 'Open Bulk Reminder',
    bulkMessage = '',
    bulkAudience = 'All',
    fallbackAction,
  }) => {
    const members = normalizeActionMembers(sourceMembers);
    const count = members.length;

    if (count === 0) {
      return {
        members,
        count,
        cta: bulkCta,
        action: fallbackAction || (() => {}),
      };
    }

    if (count === 1) {
      const target = members[0];
      return {
        members,
        count,
        cta: singleCta,
        action: () => navigateTo('Members', singleFilter, {
          memberId: target.id,
          ...(singleOptions || {}),
        }),
      };
    }

    return {
      members,
      count,
      cta: bulkCta,
      action: () => openBroadcastDraftForMembers({
        memberIds: members.map((member) => member.id),
        message: bulkMessage,
        audience: bulkAudience,
      }),
    };
  };

  const buildSmartPaymentCta = ({
    payments: sourcePayments,
    members: sourceMembers = [],
    singleCta = 'Collect Due',
    bulkCta = 'Open Pending Dues',
    fallbackAction,
  }) => {
    const payments = normalizeActionPayments(sourcePayments);
    const members = normalizeActionMembers(sourceMembers.length > 0 ? sourceMembers : payments.map((payment) => payment.member).filter(Boolean));
    const count = payments.length;

    if (count === 0) {
      return {
        payments,
        members,
        count,
        cta: bulkCta,
        action: fallbackAction || (() => navigateTo('Payments', 'Pending')),
      };
    }

    if (count === 1) {
      const target = payments[0];
      return {
        payments,
        members,
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
      members,
      count,
      cta: bulkCta,
      action: () => navigateTo('Payments', 'Pending'),
    };
  };

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

    const active   = members.filter(m => m.membership_status === 'ACTIVE');
    const pendingDueMembers = members.filter((member) => !!getLatestPendingDue(member));
    const pendingDuePayments = pendingDueMembers
      .map((member) => {
        const latestPayment = getLatestPendingDue(member);
        return latestPayment ? { ...latestPayment, member } : null;
      })
      .filter(Boolean);
    const pendingDueMemberIds = new Set(pendingDueMembers.map((member) => member.id));
    const unpaid   = members.filter(m => m.membership_status === 'UNPAID' && !pendingDueMemberIds.has(m.id));
    const expired  = members.filter(m => m.membership_status === 'EXPIRED');
    
    const expiringIn3Days = active.filter(m => m.days_left > 0 && m.days_left <= 3);
    const expiringIn7Days = active.filter(m => m.days_left > 0 && m.days_left <= 7);

    // Inactive / ghost members: ACTIVE in DB, not expiring soon, absent 14+ days
    // Threshold matches getStatusInfo in MembersPage so the Inactive filter shows the same people
    const escalatedLeads = members.filter(m => {
      if (m.membership_status === 'UNPAID' || hasRecentActivation(m)) return false;
      const daysAbsent = getDaysAbsent(m);
      const expiredAgeDays = m.expiry_date ? toDayAge(m.expiry_date) : -1;
      const isLongExpired = m.membership_status === 'EXPIRED' && expiredAgeDays > 5;
      const isDeepGhost = m.membership_status === 'ACTIVE' && m.days_left > 7 && daysAbsent > 30;
      return isLongExpired || isDeepGhost;
    });
    const escalatedIds = new Set(escalatedLeads.map(m => m.id));

    const ghosts = active.filter(m => {
      if (m.days_left <= 7 || hasRecentActivation(m) || escalatedIds.has(m.id)) return false;
      return getDaysAbsent(m) > 14;
    });

    const pendingDueValue = pendingDuePayments.reduce((sum, payment) => {
      return sum + Number(payment?.amount_due || 0);
    }, 0);

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

    const immediateRiskAmount = expiringIn3Days.reduce((sum, m) => sum + estimateMemberValue(m), 0);
    const highChurnMembers = (churnInsights.members || []).filter((m) => String(m.churn_tier).toUpperCase() === 'HIGH');
    const highChurnRiskAmount = highChurnMembers.reduce((sum, m) => sum + estimateMemberValue(m), 0);
    const ghostRiskAmount = ghosts.reduce((sum, m) => sum + Math.round(estimateMemberValue(m) * 0.65), 0);
    const expiredWinbackValue = Math.round(expired.length * avgPlanPrice * 0.5);
    const expiringFollowupMembers = expiringIn7Days.filter((member) => member.days_left > 3);
    const expiringFollowupRiskAmount = expiringFollowupMembers.reduce((sum, member) => sum + estimateMemberValue(member), 0);

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
    });
    const expiringImmediateCta = buildSmartMemberCta({
      members: expiringIn3Days,
      singleFilter: 'Expiring Soon',
      bulkMessage: reminderMessages.expiringImmediate,
      bulkAudience: 'Expiring',
      bulkCta: 'Open Renewal Broadcast',
    });
    const expiringSoonCta = buildSmartMemberCta({
      members: expiringFollowupMembers,
      singleFilter: 'Expiring Soon',
      bulkMessage: reminderMessages.expiringSoon,
      bulkAudience: 'Expiring',
      bulkCta: 'Open Bulk Reminder',
    });
    const expiredCta = buildSmartMemberCta({
      members: expired,
      singleFilter: 'Expired',
      bulkMessage: reminderMessages.expired,
      bulkAudience: 'Expired',
      bulkCta: 'Open Winback Broadcast',
    });
    const ghostCta = buildSmartMemberCta({
      members: ghosts,
      singleFilter: 'Inactive',
      bulkMessage: reminderMessages.inactive,
      bulkAudience: 'Ghosts',
      bulkCta: 'Open Bulk Follow-up',
    });
    const unpaidCta = buildSmartMemberCta({
      members: unpaid,
      singleFilter: 'Unpaid',
      bulkMessage: reminderMessages.unpaid,
      bulkAudience: 'All',
      bulkCta: 'Open Bulk Reminder',
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
    const setupStepLabels = {
      profile: 'business profile',
      plans: 'plan catalog',
      members: 'member base',
    };
    const nextSetupStep = incompleteSetupSteps[0] || null;
    const targetTodayTraffic = active.length > 0 ? Math.max(3, Math.round(active.length * 0.14)) : 3;
    const trafficGap = Math.max(0, targetTodayTraffic - todayCheckins);

    const buildRecommendation = ({
      id,
      title,
      reason,
      count,
      members,
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
        members,
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
      buildRecommendation({
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
      buildRecommendation({
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
      buildRecommendation({
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
      buildRecommendation({
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
      buildRecommendation({
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
      // Note: ESCALATED_CALLS is intentionally omitted here — the "Escalated Leads (Call Now)"
      // panel below the action cards already surfaces these members with direct call buttons.
      // Adding a duplicate action card would cause confusion and double-count the same people.
    ].filter((candidate) => candidate.count > 0)
      .sort((a, b) => b.score - a.score);

    const opportunityCandidates = [
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
      members.length >= 12 && weeklyRuns === 0 && buildRecommendation({
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
        action: () => openBroadcastDraft('Active', 'Hi from GymVault! New week, new goals. Reply if you want help with your next workout plan or renewal options.'),
      }),
      topPlanEntry && topPlanPct >= 65 && plans.length >= 2 && buildRecommendation({
        id: 'PLAN_CONCENTRATION',
        title: `Add another plan besides "${topPlanEntry[0]}"`,
        reason: `${topPlanPct}% of members are on one plan. Adding one more option can balance revenue better.`,
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
        title: 'Add one more plan option',
        reason: 'One plan limits upsell and downgrade paths',
        count: members.length,
        impact: Math.round(avgPlanPrice * 2),
        confidence: 78,
        urgency: 'This week',
        priority: 'P2',
        cta: 'Add Tier',
        sub: 'Give members one more choice',
        action: () => navigateTo('Plans'),
      }),
      active.length >= 12 && expiringIn7Days.length === 0 && highChurnMembers.length < 3 && pendingDues < avgPlanPrice && buildRecommendation({
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
        action: () => openBroadcastDraft('All', 'Hi from GymVault! Bring your momentum back this week. Reply if you want help choosing the right plan or bringing a friend along.'),
      }),
    ].filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // ── AI Engine: strategic growth / opportunity insights (NOT member crisis tasks) ──
    const recommendations = opportunityCandidates.slice(0, 3);

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
    const aiSummaryLines = recommendations.length > 0
      ? [
          { label: 'Active plans', value: `${active.length} of ${members.length || 0} members are active right now (${activeCoveragePct}%)` },
          { label: 'Money collected', value: (() => { const earliest = chart30.find(d => (d.revenue || 0) > 0); const sinceLabel = earliest?.date ? new Date(earliest.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : null; return sinceLabel ? `₹${monthlyRevenue.toLocaleString()} collected since ${sinceLabel}` : `₹${monthlyRevenue.toLocaleString()} collected in the last 30 days`; })() },
          { label: 'Watch today', value: nextWatchline },
        ]
      : [
          { label: 'Active plans', value: `${active.length} of ${members.length || 0} members are active right now (${activeCoveragePct}%)` },
          { label: 'Money collected', value: (() => { const earliest = chart30.find(d => (d.revenue || 0) > 0); const sinceLabel = earliest?.date ? new Date(earliest.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : null; return sinceLabel ? `₹${monthlyRevenue.toLocaleString()} collected since ${sinceLabel}` : `₹${monthlyRevenue.toLocaleString()} collected in the last 30 days`; })() },
          { label: 'Watch today', value: nextWatchline },
        ];

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
    const actionCandidates = [subscriptionWarning, ...aiCandidates]
      .filter(Boolean)
      .sort((a, b) => {
        const rankDiff = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
        if (rankDiff !== 0) return rankDiff;
        return Number(b.score || 0) - Number(a.score || 0);
      });
    const actionRequiredRows = actionCandidates.filter((item) => item.priority === 'P0' || item.priority === 'P1');
    const mergedActionRows = actionRequiredRows.length > 0
      ? actionRequiredRows.slice(0, 4)
      : actionCandidates.slice(0, 4);
    const urgentCount = actionRequiredRows.length;

    return {
      active: active.length, unpaid: unpaid.length, expired: expired.length,
      expiring7: expiringIn7Days.length, expiring3: expiringIn3Days.length, ghosts: ghosts.length,
      ghostMembers: ghosts,
      escalated: escalatedLeads, escalatedLeads,
      pendingDuePayments,
      monthlyRevenue, revenueAtRisk, healthScore,
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
  }, [members, plans, chart30, attendanceHeatmap, churnInsights, campaignLogs, payStats.pending_dues, setup, todayCheckins, gymBilling]);

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
  }, [broadcastSearch, broadcastCustomIds, members]);


  if (loading) return <PageLoader className="min-h-[56vh]" />;

  return (
    <div className="min-h-full dashboard-content-safe font-inter relative">
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
        className="gv-dashboard-hero relative overflow-hidden rounded-[24px] sm:rounded-[28px] p-5 sm:p-6 md:p-8 mb-5 sm:mb-6"
        style={{
          boxShadow: '0 20px 60px rgba(7,10,24,0.34)',
          opacity: 0, animation: 'cardCascade 0.7s cubic-bezier(0.16,1,0.3,1) 0ms forwards, gv-hero-gradient-drift 8s ease-in-out 700ms infinite alternate'
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
            <h1 className="text-2xl sm:text-3xl md:text-[2.75rem] font-black text-white tracking-tight leading-none mb-2">
              {getGreeting()} 👋
            </h1>
            <p className="text-white/75 font-semibold text-sm mb-1">
              {gymName || 'Your gym'}
            </p>
            <p className="text-white/40 font-semibold text-sm">
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
                  <p className="text-white/35 text-[9px] font-black uppercase tracking-[0.2em] mt-0.5">{m.label === 'Health Score' ? 'Gym Health' : m.label}</p>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
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
            onClick={() => navigateTo('Payments', 'All', { section: 'collections-overview' })}
          />
          <KPICard
            title="Today's Revenue" value={`₹${Number(payStats.today_revenue).toLocaleString()}`}
            icon={DollarSign} index={2}
            iconGradient="linear-gradient(135deg, #3b82f6, #0ea5e9)"
            onClick={() => navigateTo('Payments', 'All', { section: 'collections-overview' })}
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
              {isActive && displayChartData.length > 0 ? (
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

                <p className="text-[10px] text-slate-400 font-semibold">
                  Last auto message: {dashboardData.automations.lastAutomationLabel}
                </p>

                <div className="space-y-2">
                  {dashboardData.ai.recommendations.map((rec, index) => {
                    return (
                      <div
                        key={rec.id}
                        className="w-full rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black text-slate-800">Tip {index + 1}</p>
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-white text-slate-500 border border-slate-200">{rec.urgency}</span>
                        </div>
                        <p className="text-[12px] font-bold text-slate-800 leading-snug mt-2">
                          {rec.title}
                        </p>
                        <p className="text-[10px] text-slate-500 font-semibold mt-1 leading-relaxed">
                          {rec.reason}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold mt-2">
                          Possible gain ₹{Number(rec.impact || 0).toLocaleString()} · {rec.confidence}% confidence
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

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
                {dashboardData.actionRows.length === 0 && (() => {
                  const emptyItems = [
                    !setup.steps?.profile && { label: 'Complete gym profile', sub: 'Add your gym name, logo & address', onClick: () => navigateTo('Settings', 'account') },
                    !setup.steps?.plans   && { label: 'Create a pricing plan', sub: 'Set up your first membership plan', onClick: () => navigateTo('Plans') },
                    !setup.steps?.members && { label: 'Add your first member', sub: 'Register a member to get started', onClick: () => setShowAddModal(true) },
                    setup.steps?.profile && setup.steps?.plans && { label: 'Set up WhatsApp / SMS messaging', sub: 'Enable automated member alerts', onClick: () => navigateTo('Settings', 'automation') },
                    setup.steps?.profile && { label: 'Connect payment gateway', sub: 'Integrate Razorpay for online payments', onClick: () => navigateTo('Settings', 'integrations') },
                  ].filter(Boolean).slice(0, 4);
                  return (
                    <div className="flex flex-col items-center justify-center py-4 gap-3 text-center">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                        <CheckCircle size={20} className="text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-800">
                          {emptyItems.length === 0 ? 'All clear — gym is running smoothly!' : 'No urgent issues right now.'}
                        </p>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                          {emptyItems.length > 0 ? 'Complete these to fully unlock GymVault:' : 'Keep an eye on renewals and check-ins.'}
                        </p>
                      </div>
                      {emptyItems.length > 0 && (
                        <div className="w-full space-y-1.5 text-left mt-1">
                          {emptyItems.map((item) => (
                            <button key={item.label} onClick={item.onClick} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 text-left transition-colors">
                              <div>
                                <p className="text-[11px] font-bold text-slate-700">{item.label}</p>
                                <p className="text-[9px] text-slate-400 font-semibold mt-0.5">{item.sub}</p>
                              </div>
                              <ChevronRight size={13} className="text-slate-300 shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
                  <div className="dashboard-escalated-leads">
                    <div className="dashboard-escalated-header">
                      <p className="dashboard-escalated-title">
                        <Flame size={12} fill="currentColor" /> Escalated Leads (Call Now)
                      </p>
                    </div>
                    {dashboardData.escalated.slice(0, 3).map((lead) => (
                      <EscalatedLeadRow
                        key={lead.id}
                        lead={lead}
                        canDelete={canDeleteEscalatedLeads}
                        isOpen={openEscalatedLeadId === lead.id}
                        isDeleting={deletingEscalatedLeadId === lead.id}
                        onOpen={() => setOpenEscalatedLeadId(lead.id)}
                        onClose={() => setOpenEscalatedLeadId((current) => (current === lead.id ? null : current))}
                        onDelete={handleDeleteEscalatedLead}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          <KPICard
            title="Check-ins Today" value={todayCheckins}
            icon={CheckCircle} index={8}
            iconGradient="linear-gradient(135deg, #14b8a6, #06b6d4)"
            onClick={() => navigateTo('Attendance', 'All', { section: 'live-feed' })}
          />
          <KPICard
            title="Unpaid Profiles" value={dashboardData.unpaid}
            icon={CreditCard} index={9}
            iconGradient="linear-gradient(135deg, #64748b, #475569)"
            onClick={() => navigateTo('Members', 'Unpaid')}
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
            onClick={() => navigateTo('Payments', 'Pending', { section: 'payments-ledger' })}
          />
        </div>

      </div>

      {/* ════════════════════════════════════════
          FLOATING ACTION BAR
      ════════════════════════════════════════ */}
      <div className="app-floating-action-bar fixed mobile-floating-offset left-1/2 -translate-x-1/2 z-[90] animate-in fade-in duration-500 w-[calc(100%-1.5rem)] max-w-[520px]">
        <div
          className="gv-fab-shell rounded-[22px] border border-white/8 backdrop-blur-2xl p-1.5"
          style={{
            background: 'rgba(10, 12, 30, 0.94)',
            boxShadow: '0 8px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.07)'
          }}
        >
          <div className="grid grid-cols-4 gap-1">
          {[
            { label: 'Add Member', icon: <UserPlus size={16} strokeWidth={2.5} />, color: 'emerald', onClick: () => setShowAddModal(true) },
            { label: 'Renew',      icon: <RefreshCw size={15} strokeWidth={2.5} />, color: 'indigo',  onClick: () => setShowPaymentModal(true) },
            { label: 'Broadcast',  icon: <MessageSquare size={15} strokeWidth={2.5} />, color: 'violet', onClick: () => setShowBroadcastModal(true) },
            { label: 'Check In',   icon: <CheckCircle size={15} strokeWidth={2.5} />, color: 'sky',    onClick: () => { setCheckinQuery(''); setShowCheckinModal(true); } },
          ].map(({ label, icon, color, onClick: onBtnClick }) => {
            const btnCls = {
              emerald: 'text-emerald-400',
              indigo:  'text-indigo-400',
              violet:  'text-violet-400',
              sky:     'text-sky-400',
            }[color];
            const isLoading = quickActionLoading === label;
            return (
              <button
                key={label}
                onClick={() => launchQuickAction(label, onBtnClick)}
                disabled={Boolean(quickActionLoading)}
                className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-[16px] transition-all duration-150 active:scale-[0.93] hover:bg-white/5 disabled:opacity-70 ${btnCls}`}
              >
                {isLoading ? <RefreshCw size={15} strokeWidth={2.5} className="animate-spin" /> : icon}
                <span className="text-[10px] font-bold leading-none tracking-wide">{label}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          MODALS
      ════════════════════════════════════════ */}

      {/* Add Member */}
      {showAddModal && (
        <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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

            <form onSubmit={handleAddMember} className="app-modal-scroll p-6 space-y-4">
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
                disabled={addSubmitting}
                className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg"
                style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(5,150,105,0.35)' }}
              >
                {addSubmitting ? (
                  <span className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Saving...</span>
                ) : (addSelectedPlanId ? 'Add Member & Assign Plan →' : 'Add Member')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment */}
      {showPaymentModal && (
        <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel relative bg-white rounded-[24px] w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  <CreditCard size={17} className="text-white" />
                </div>
                <h2 className="text-lg font-black text-slate-900">Record Payment</h2>
              </div>
              <button onClick={() => { setShowPaymentModal(false); setPayMemberSearch(''); setPayMemberDropdownOpen(false); }}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <form onSubmit={handlePayment} className="app-modal-scroll p-6 space-y-4">
              {/* Searchable member picker */}
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Member</label>
                <div className="relative">
                  {/* Show selected member chip or search input */}
                  {selectedMemberForPay ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                      {(() => {
                        const m = members.find(x => String(x.id) === String(selectedMemberForPay));
                        const status = String(m?.membership_status || '').toUpperCase();
                        const badge = status === 'EXPIRED' ? 'text-rose-600 bg-rose-50' : status === 'ACTIVE' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50';
                        return (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-black text-slate-900 truncate">{m?.full_name}</p>
                              <p className="text-[10px] text-slate-500 font-semibold truncate">{m?.phone}</p>
                            </div>
                            <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${badge}`}>{status || 'UNPAID'}</span>
                            <button type="button" onClick={() => { setSelectedMemberForPay(''); setPayMemberSearch(''); setPayMemberDropdownOpen(false); }}
                              className="w-6 h-6 rounded-full bg-slate-200 hover:bg-rose-100 flex items-center justify-center shrink-0 transition-colors">
                              <X size={12} />
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search by name or phone..."
                        value={payMemberSearch}
                        onChange={e => { setPayMemberSearch(e.target.value); setPayMemberDropdownOpen(true); }}
                        onFocus={() => setPayMemberDropdownOpen(true)}
                        className="w-full px-4 py-2.5 pl-9 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                      </div>
                    </div>
                  )}

                  {/* Dropdown */}
                  {payMemberDropdownOpen && !selectedMemberForPay && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-2xl z-[300] overflow-hidden">
                      {/* Filter tabs */}
                      <div className="flex gap-0 border-b border-slate-100">
                        {['All', 'Expired', 'Unpaid'].map(tab => (
                          <button key={tab} type="button"
                            onClick={() => setPayMemberSearch(tab === 'All' ? '' : tab.toLowerCase())}
                            className="flex-1 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                            {tab}
                          </button>
                        ))}
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        {(() => {
                          const q = payMemberSearch.toLowerCase();
                          const filtered = members
                            .filter(m => {
                              const name = (m.full_name || '').toLowerCase();
                              const phone = (m.phone || '').toLowerCase();
                              const status = (m.membership_status || '').toLowerCase();
                              if (!q) return true;
                              if (q === 'expired') return status === 'expired';
                              if (q === 'unpaid') return status !== 'active';
                              return name.includes(q) || phone.includes(q);
                            })
                            .sort((a, b) => {
                              // Expired/unpaid first
                              const priority = s => s === 'expired' ? 0 : s === 'active' ? 2 : 1;
                              const pa = priority((a.membership_status || '').toLowerCase());
                              const pb = priority((b.membership_status || '').toLowerCase());
                              return pa - pb || (a.full_name || '').localeCompare(b.full_name || '');
                            });
                          if (!filtered.length) return <div className="py-6 text-center text-sm text-slate-400 font-semibold">No members found</div>;
                          return filtered.map(m => {
                            const status = String(m.membership_status || '').toUpperCase();
                            const badge = status === 'EXPIRED' ? 'text-rose-600 bg-rose-50' : status === 'ACTIVE' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50';
                            return (
                              <button key={m.id} type="button"
                                onClick={() => { setSelectedMemberForPay(String(m.id)); setPayMemberSearch(''); setPayMemberDropdownOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 transition-colors text-left border-b border-slate-50 last:border-0">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-black shrink-0">
                                  {(m.full_name || '?').charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-black text-slate-900 truncate">{m.full_name}</p>
                                  <p className="text-[10px] text-slate-500 font-semibold">{m.phone}</p>
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${badge}`}>{status || 'UNPAID'}</span>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                  {/* Click-outside to close */}
                  {payMemberDropdownOpen && !selectedMemberForPay && (
                    <div className="fixed inset-0 z-[299]" onClick={() => setPayMemberDropdownOpen(false)} />
                  )}
                </div>
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
                disabled={paymentSubmitting || paymentStep !== 'idle'}
                className="w-full py-3 rounded-xl font-black text-sm text-white mt-2 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-98"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                {paymentSubmitting ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} fill="currentColor" />} {paymentSubmitting ? 'Please wait...' : 'Complete Transaction'}
              </button>
            </form>

            {/* Payment processing / success animation overlay */}
            {paymentStep !== 'idle' && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[24px] animate-in fade-in duration-150"
                style={{ background: 'rgba(15,23,42,0.76)', backdropFilter: 'blur(10px)' }}>
                {paymentStep === 'processing' ? (
                  <div className="flex flex-col items-center gap-5 rounded-[28px] border border-white/10 bg-slate-950/70 px-8 py-8 shadow-2xl">
                    <div className="w-16 h-16 rounded-full border-4 border-white/15 border-t-indigo-400 animate-spin" />
                    <div className="text-center">
                      <p className="font-black text-white text-xl">Processing payment...</p>
                      <p className="text-sm text-slate-300 mt-1 font-medium">Please wait. Do not close this window.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-5 animate-in zoom-in-90 duration-300 rounded-[28px] border border-emerald-400/20 bg-slate-950/70 px-8 py-8 shadow-2xl">
                    <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                      <Check size={36} className="text-white" strokeWidth={3} />
                    </div>
                    <div className="text-center">
                      <p className="font-black text-white text-xl">Payment complete</p>
                      <p className="text-sm text-slate-300 mt-1 font-medium">Member activated and checked in.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Broadcast — bottom sheet, keyboard-resilient */}
      {showBroadcastModal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[190] bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setShowBroadcastModal(false)}
          />
          {/* Sheet panel — anchored to bottom, not affected by visualViewport keyboard changes */}
          <div className="app-bottom-sheet z-[200] bg-white shadow-2xl">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>
            {/* Header */}
            <div className="px-5 py-3 flex justify-between items-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
              <div className="flex items-center gap-3">
                <MessageSquare size={18} className="text-white" />
                <h2 className="text-base font-black text-white">Bulk Broadcast</h2>
              </div>
              <button type="button" onClick={() => setShowBroadcastModal(false)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
                <X size={16} className="text-white" />
              </button>
            </div>
            <form onSubmit={handleBroadcast} className="flex min-h-0 flex-1 flex-col">
              <div className="app-modal-scroll dashboard-broadcast-scroll min-h-0 px-4 pb-3 pt-4 space-y-3">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Search Specific Members</label>
                <input
                  type="text"
                  value={broadcastSearch}
                  onChange={(e) => setBroadcastSearch(e.target.value)}
                  placeholder="Search by name, phone, or email"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                {broadcastSelectedMembers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {broadcastSelectedMembers.map((member) => (
                      <button
                        key={`broadcast-chip-${member.id}`}
                        type="button"
                        onClick={() => setBroadcastCustomIds((prev) => prev.filter((id) => Number(id) !== Number(member.id)))}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-black border border-emerald-100"
                      >
                        <span className="truncate max-w-[200px]">{member.full_name}</span>
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                )}
                {broadcastSearchResults.length > 0 && (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white max-h-40 sm:max-h-48 overflow-y-auto">
                    {broadcastSearchResults.map((member) => (
                      <button
                        key={`broadcast-member-${member.id}`}
                        type="button"
                        onClick={() => {
                          setBroadcastCustomIds((prev) => [...prev, Number(member.id)]);
                          setBroadcastSearch('');
                        }}
                        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-emerald-50 border-b border-slate-100 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 truncate">{member.full_name}</p>
                          <p className="text-[11px] text-slate-500 font-semibold truncate">{member.phone}{member.email ? ` · ${member.email}` : ''}</p>
                        </div>
                        <span className="text-[10px] font-black text-emerald-600 uppercase">Add</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">
                  {broadcastSelectedMembers.length > 0 ? 'Custom list selected. Segment buttons below are ignored until you clear these members.' : 'Leave empty to send by audience segment.'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Target Audience</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { value: 'All',       label: 'All Members',   count: members.length },
                    { value: 'Active',    label: 'Active',        count: dashboardData.active },
                    { value: 'Expiring',  label: 'Expiring Soon', count: dashboardData.expiring7 },
                    { value: 'Expired',   label: 'Expired',       count: dashboardData.expired },
                    { value: 'Ghosts',    label: 'Ghosts',        count: dashboardData.ghosts },
                    { value: 'HighChurn', label: 'High Churn',    count: dashboardData.churnHigh },
                  ].map(({ value, label, count }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setBroadcastAudience(value)
                        if (broadcastSelectedMembers.length === 0 && !broadcastTemplateKey) {
                          setBroadcastMessage(resolveBroadcastAudienceMessage(value))
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-black transition-all duration-150 ${
                        broadcastSelectedMembers.length === 0 && broadcastAudience === value
                          ? 'bg-emerald-500 text-white shadow shadow-emerald-200'
                          : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                      }`}
                    >
                      {label}{count > 0 ? ` · ${count}` : ''}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">
                  {campaignPreviewLoading ? 'Loading preview...' : `Estimated reach: ${(broadcastSelectedMembers.length || campaignPreviewCount)} member${(broadcastSelectedMembers.length || campaignPreviewCount) !== 1 ? 's' : ''}`}
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
                <textarea required rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                  placeholder="Type your message here..."
                  value={broadcastMessage} onChange={e => setBroadcastMessage(e.target.value)} />
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">{'{{name}}'} auto-fills each member&apos;s name &middot; {'{{gym_name}}'} fills your gym name.</p>
              </div>
              </div>
              <div className="dashboard-broadcast-footer shrink-0 border-t border-slate-100 bg-white px-4 pt-3">
                <button type="submit"
                  className="w-full py-3 rounded-xl font-black text-sm text-white transition-all hover:opacity-90 active:scale-98"
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}>
                  Launch Broadcast
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {showCheckinModal && (
        <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel bg-white rounded-[24px] w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
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

            <div className="app-modal-scroll p-6 space-y-4">
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
                <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
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
                          <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-[11px] font-black">
                              {initials}
                            </div>
                            {member.profile_pic ? (
                              <img src={buildProfileUrl(member.profile_pic)} alt={member.full_name} className="relative z-10 w-full h-full object-cover" onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                            ) : null}
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