import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import axios from 'axios'
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import SuperAdminLogin from './SuperAdminLogin';
import SuperAdminDashboard from './SuperAdminDashboard';
import PageErrorBoundary from './PageErrorBoundary';
import PageLoader from './PageLoader';
import SuspensionOverlay from './SuspensionOverlay'; 
import { applyInterfacePreferences, saveInterfacePreferencesLocal } from './utils/interfacePreferences';
import { clearSessionToken, getSessionToken, setSessionToken } from './utils/authSession';
import { DEFAULT_BRANCH_ID, getBranchLabel, getBranchRequestValue, getDefaultBranchId, buildBranchOptions, normalizeBranchDirectory } from './utils/branchScope';
import { reportClientError } from './utils/clientErrorReporter';
import { lazyWithRecovery } from './utils/lazyWithRecovery';
import {
  X, CheckCircle, AlertTriangle, AlertCircle,
  LayoutDashboard, Users, Layers, CreditCard,
  ClipboardCheck, BarChart3, Settings, LogOut, Lock, Bell, User, LifeBuoy,
  Dumbbell,
  Bot, ArrowRight, Target, Sparkles, Download, MoreHorizontal, CalendarDays, Building2, ChevronDown
} from 'lucide-react';

const DashboardPage = lazyWithRecovery('dashboard', () => import('./DashboardPage'));
const MembersPage = lazyWithRecovery('members', () => import('./MembersPage'));
const LeadsPage = lazyWithRecovery('leads', () => import('./LeadsPage'));
const PlansPage = lazyWithRecovery('plans', () => import('./PlansPage'));
const PaymentsPage = lazyWithRecovery('payments', () => import('./PaymentsPage'));
const AttendancePage = lazyWithRecovery('attendance', () => import('./AttendancePage'));
const ClassesPage = lazyWithRecovery('classes', () => import('./ClassesPage'));
const RfidSetupPage = lazyWithRecovery('rfid-setup', () => import('./RfidSetupPage'));
const InsightsPage = lazyWithRecovery('insights', () => import('./InsightsPage'));
const SettingsPage = lazyWithRecovery('settings', () => import('./SettingsPage'));
const HelpSupportPage = lazyWithRecovery('help-support', () => import('./HelpSupportPage'));
const StaffDashboard = lazyWithRecovery('staff-dashboard', () => import('./StaffDashboard'));

// ─── Navigation Config ────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { name: 'Dashboard',  icon: LayoutDashboard },
  { name: 'Members',    icon: Users           },
  { name: 'Leads',      icon: Target          },
  { name: 'Plans',      icon: Layers          },
  { name: 'Payments',   icon: CreditCard      },
  { name: 'Attendance', icon: ClipboardCheck  },
  { name: 'Classes',    icon: CalendarDays    },
  { name: 'Insights',   icon: BarChart3       },
  { name: 'Settings',   icon: Settings        },
];

const MOBILE_PRIMARY_NAV = ['Dashboard', 'Members', 'Plans', 'Payments'];
const AUTH_USER_STORAGE_KEY = 'user';
const GLOBAL_DATA_CHANGE_STORAGE_KEY = 'gymvault:data-change-at';
const OPERATIONS_BRANCH_STORAGE_KEY = 'gymvault:operations-branch-id';

const PAGE_PERMISSIONS = {
  Dashboard: null,
  Members: 'members:read',
  Leads: 'members:read',
  Plans: 'plans:read',
  Payments: 'payments:read',
  Attendance: 'attendance:read',
  Classes: 'attendance:read',
  'RFID Setup': 'owner:only',
  Insights: 'insights:read',
  Settings: 'owner:only',
  'Help & Support': 'support:read',
};

const isIgnoredRuntimeIssue = (message, source = '') => {
  const normalizedMessage = String(message || '').trim().toLowerCase();
  const normalizedSource = String(source || '').trim().toLowerCase();

  return normalizedMessage.includes('resizeobserver loop limit exceeded')
    || normalizedMessage === 'script error.'
    || normalizedSource.startsWith('chrome-extension://')
    || normalizedSource.startsWith('moz-extension://')
    || normalizedSource.startsWith('safari-web-extension://');
};

const getAuthStorage = () => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch (_err) {
    return null;
  }
};

const readStoredUser = () => {
  const storage = getAuthStorage();
  if (!storage) return null;

  try {
    const raw = String(storage.getItem(AUTH_USER_STORAGE_KEY) || '').trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_err) {
    try {
      storage.removeItem(AUTH_USER_STORAGE_KEY);
    } catch (_storageErr) {
      // Ignore storage cleanup failures.
    }
    return null;
  }
};

const writeStoredUser = (user) => {
  const storage = getAuthStorage();
  if (!storage) return;

  if (!user || typeof user !== 'object') {
    try {
      storage.removeItem(AUTH_USER_STORAGE_KEY);
    } catch (_err) {
      // Ignore storage cleanup failures and fall back to in-memory state.
    }
    return;
  }

  try {
    storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  } catch (_err) {
    // Ignore storage write failures and fall back to in-memory state.
  }
};

const TOUR_STEPS = [
  { targetId: null, page: 'Dashboard', position: 'center', title: 'Welcome to GymVault ?', desc: 'Let\'s set up your gym in a few steps. I will guide you through the exact workflow.' },
  { targetId: 'tour-dashboard-hero', page: 'Dashboard', position: 'bottom', title: 'Dashboard Overview', desc: 'This is your central command. It tracks revenue, active members, and daily check-ins in real-time.' },
  { targetId: 'nav-Members', page: 'Dashboard', position: 'right', title: 'Members Directory', desc: 'Manage your clients here. You can track their active memberships and contact details.' },
  { targetId: 'btn-add-member', page: 'Dashboard', position: 'top', title: 'Quick Actions', desc: 'Use this button anytime to instantly register a new member, record a payment, or send a WhatsApp broadcast.' },
  { targetId: 'nav-Plans', page: 'Plans', position: 'right', title: 'Membership Plans', desc: 'Before adding members, you will create Plans here (e.g., Monthly VIP for ?2000). They dictate pricing and duration.' },
  { targetId: 'nav-Payments', page: 'Payments', position: 'right', title: 'Financial Ledger', desc: 'Every transaction is recorded safely here for your accounting.' },
  { targetId: 'nav-Settings', page: 'Settings', position: 'right', title: 'Gym Configuration', desc: 'Upload your gym logo, update your address, and configure staff access here.' },
  { targetId: null, page: 'Dashboard', position: 'center', title: 'You\'re All Set! ??', desc: 'Your gym setup is fully complete. You are ready to dominate. Let\'s get to work.' }
];

// ─── Toast System ─────────────────────────────────────────────────────────────

function useToast() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, toast, removeToast };
}

function ToastItem({ message, type, onRemove }) {
  const config = {
    success: { bg: 'bg-emerald-500', icon: <CheckCircle size={18} /> },
    error:   { bg: 'bg-rose-500',    icon: <AlertCircle size={18} /> },
    warning: { bg: 'bg-amber-500',   icon: <AlertTriangle size={18} /> },
  }[type] || { bg: 'bg-emerald-500', icon: <CheckCircle size={18} /> };
  return (
    <div className={`${config.bg} text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[280px] max-w-sm animate-in slide-in-from-right-5 duration-300`}>
      <div className="shrink-0">{config.icon}</div>
      <p className="flex-1 text-sm font-bold leading-snug">{message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={onRemove} className="text-white/70 hover:text-white ml-1 shrink-0 transition-colors"><X size={16} /></button>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function useConfirm() {
  const [confirmState, setConfirmState] = useState(null);
  const showConfirm = useCallback(({ title, message, onConfirm, confirmLabel, cancelLabel, variant = 'danger', panelClassName = '', messageClassName = '' }) => {
    setConfirmState({ title, message, onConfirm, confirmLabel, cancelLabel, variant, panelClassName, messageClassName });
  }, []);
  const hideConfirm = useCallback(() => setConfirmState(null), []);
  return { confirmState, showConfirm, hideConfirm };
}

function ConfirmModal({ confirmState, hideConfirm }) {
  if (!confirmState) return null;
  const isDanger = confirmState.variant === 'danger';
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className={`bg-white rounded-[28px] w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-300 ${confirmState.panelClassName || ''}`}>
        <div className="p-8 text-center">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 mx-auto ${isDanger ? 'bg-rose-100 text-rose-500' : 'bg-amber-100 text-amber-500'}`}>
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-900 mb-2">{confirmState.title}</h3>
          <p className={`text-sm font-semibold text-slate-500 leading-relaxed whitespace-pre-wrap ${confirmState.messageClassName || ''}`}>{confirmState.message}</p>
        </div>
        <div className="px-8 pb-8 flex flex-col gap-3">
          <button
            onClick={() => { confirmState.onConfirm(); hideConfirm(); }}
            className={`w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all active:scale-95 ${
              isDanger ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-lg shadow-rose-200'
                       : 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-200'
            }`}
          >
            {confirmState.confirmLabel || (isDanger ? 'Yes, Delete' : 'Confirm')}
          </button>
          <button onClick={hideConfirm} className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-700 transition-colors">
            {confirmState.cancelLabel || 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

// Single flat colour used everywhere for the splash — must match index.html/body/root pre-React
const SPLASH_BG = '#0f1117';
// iOS black-translucent darkens the status-bar zone by ~30% (result = content × 0.70).
// So the content behind the status bar must be SPLASH_BG ÷ 0.70 ≈ #1f2971
// to appear as SPLASH_BG after iOS applies its overlay — making top and bottom match.
const SPLASH_STATUS_BAR_BG = '#171e38';

function SplashScreen({ exiting }) {
  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-300 ease-out ${exiting ? 'opacity-0' : 'opacity-100'}`}
      style={{
        background: `linear-gradient(to bottom, ${SPLASH_STATUS_BAR_BG} 0px, ${SPLASH_STATUS_BAR_BG} calc(env(safe-area-inset-top, 44px) - 1px), ${SPLASH_BG} calc(env(safe-area-inset-top, 44px) + 12px), ${SPLASH_BG} 100%)`,
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Ambient glows on top of the flat base colour */}
        <div className="absolute inset-x-0 top-0 h-[45%]"
          style={{ background: 'radial-gradient(ellipse 90% 65% at 50% 0%, rgba(99,102,241,0.38) 0%, rgba(99,102,241,0.10) 55%, transparent 78%)' }} />
        <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
      </div>

      <div
        className="relative w-20 h-20 rounded-[22px] flex items-center justify-center mb-6 animate-in zoom-in-50 duration-700 overflow-visible"
        style={{
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          boxShadow: '0 0 80px rgba(99,102,241,0.5), 0 0 160px rgba(99,102,241,0.2), 0 20px 40px rgba(0,0,0,0.4)'
        }}
      >
        <Dumbbell size={36} className="text-white" strokeWidth={2} />
        <div className="absolute inset-0 rounded-[22px] border border-white/20" />
      </div>

      <h1 className="text-4xl font-black text-white tracking-tight mb-1.5 animate-in fade-in slide-in-from-bottom-3 duration-700 [animation-delay:200ms] [animation-fill-mode:both]">
        GymVault
      </h1>
      <p className="text-white/25 text-[11px] uppercase tracking-[0.35em] font-bold mb-14 animate-in fade-in duration-700 [animation-delay:350ms] [animation-fill-mode:both]">
        Pro Dashboard
      </p>

      <div className="w-44 h-[3px] bg-white/[0.07] rounded-full overflow-hidden animate-in fade-in duration-300 [animation-delay:240ms] [animation-fill-mode:both]">
        <div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #6366f1, #a855f7, #6366f1)',
            backgroundSize: '200% 100%',
            animation: 'splashBar 0.9s ease-out forwards, shimmerBar 0.9s linear infinite 0.12s'
          }}
        />
      </div>
      <p className="text-white/20 text-[10px] uppercase tracking-[0.2em] font-bold mt-4 animate-in fade-in duration-300 [animation-delay:300ms] [animation-fill-mode:both]">
        Loading your dashboard...
      </p>

      <style>{`
        @keyframes splashBar { from { width: 0% } to { width: 100% } }
        @keyframes shimmerBar {
          0% { background-position: 200% center }
          100% { background-position: -200% center }
        }
      `}</style>
    </div>
  );
}

// ─── iOS-style sliding mobile nav ─────────────────────────────────────────────

function MobileNav({ items, moreItems, currentPage, isMoreActive, showMobileMoreNav, isSuspended, onNav, onMoreToggle }) {
  const colCount = items.length + (moreItems.length > 0 ? 1 : 0);
  const containerRef = useRef(null);
  const pillRef = useRef(null);
  const buttonRefs = useRef([]);

  // Find active index in primary items
  const activeIdx = items.findIndex(({ name }) => name === currentPage);

  // Slide pill to active button
  useEffect(() => {
    const container = containerRef.current;
    const pill = pillRef.current;
    if (!container || !pill) return;
    const targetBtn = buttonRefs.current[activeIdx >= 0 ? activeIdx : -1];
    if (!targetBtn) {
      pill.style.opacity = '0';
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const btnRect = targetBtn.getBoundingClientRect();
    pill.style.opacity = '1';
    pill.style.width = `${btnRect.width}px`;
    pill.style.height = `${btnRect.height}px`;
    pill.style.transform = `translateX(${btnRect.left - containerRect.left}px)`;
  }, [currentPage, activeIdx]);

  return (
    <div
      ref={containerRef}
      className="relative flex gap-1"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
    >
      {/* Sliding pill */}
      <div
        ref={pillRef}
        className="absolute top-0 left-0 rounded-2xl pointer-events-none"
        style={{
          background: '#0f172a',
          boxShadow: '0 8px 20px -8px rgba(15,23,42,0.8)',
          opacity: 0,
          transition: 'transform 0.36s cubic-bezier(0.34,1.56,0.64,1), width 0.2s, height 0.2s, opacity 0.2s',
          zIndex: 0,
        }}
      />

      {/* Nav buttons */}
      {items.map((item, idx) => {
        const { name } = item;
        const IconComponent = item.icon;
        const isActive = currentPage === name;
        const isBlocked = isSuspended && name !== 'Settings';
        return (
          <button
            key={`mobile-${name}`}
            ref={el => { buttonRefs.current[idx] = el; }}
            onClick={() => onNav(name)}
            disabled={isBlocked}
            className={`relative z-10 flex flex-col items-center justify-center gap-1 rounded-2xl py-2 px-1 transition-colors duration-200 ${
              isActive ? 'text-white' : 'text-slate-500 hover:text-slate-700'
            } ${isBlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <IconComponent size={16} strokeWidth={isActive ? 2.5 : 2} />
            <span className={`text-[10px] font-bold leading-none tracking-[0.01em] transition-all duration-200 ${isActive ? 'scale-105' : ''}`}>{name}</span>
          </button>
        );
      })}

      {/* More button */}
      {moreItems.length > 0 && (
        <button
          onClick={onMoreToggle}
          className={`relative z-10 flex flex-col items-center justify-center gap-1 rounded-2xl py-2 px-1 transition-colors duration-200 ${
            isMoreActive || showMobileMoreNav ? 'text-indigo-700 bg-indigo-50' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <MoreHorizontal size={17} strokeWidth={2} />
          <span className="text-[10px] font-bold leading-none tracking-[0.01em]">More</span>
        </button>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const pathname = String(window.location.pathname || '/');
  const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
  const isHQ = normalizedPathname === '/hq-admin' || normalizedPathname.startsWith('/hq-admin/');
  const [superToken, setSuperToken] = useState('');
  
  const [currentPage, setCurrentPage] = useState('Dashboard');
  const [memberFilter, setMemberFilter] = useState('All');
  const [memberFocus, setMemberFocus] = useState({ id: null, action: null });
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [paymentFocus, setPaymentFocus] = useState({ id: null, action: null });
  const [paymentSectionFocus, setPaymentSectionFocus] = useState(null);
  const [attendanceSectionFocus, setAttendanceSectionFocus] = useState(null);
  const [stats, setStats] = useState(null);
  const [token, setToken] = useState(() => getSessionToken());
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());
  const [branchDirectory, setBranchDirectory] = useState([]);
  const [operationsBranchId, setOperationsBranchId] = useState('');
  const [branchScopeLoading, setBranchScopeLoading] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(!isHQ);
  const [isSuspended, setIsSuspended] = useState(false); 
  const [saasGrace, setSaasGrace] = useState(false);
  const [saasGraceNoticeKey, setSaasGraceNoticeKey] = useState('');
  const [settingsTab, setSettingsTab] = useState('account'); 
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [canInstallApp, setCanInstallApp] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [isStandaloneMode, setIsStandaloneMode] = useState(false);
  const [showMobileMoreNav, setShowMobileMoreNav] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const authTransitionRef = useRef(false);
  const [showSignup, setShowSignup] = useState(normalizedPathname === '/signup');

  // 🚨 MASTERCLASS TOUR STATE 🚨
  const [tour, setTour] = useState({ isActive: false, step: 0, isWaitingForAction: false });
  const [tourRect, setTourRect] = useState(null); // <-- NEW: Tracks element position

  const [showSplash, setShowSplash] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);

  const { toasts, toast, removeToast } = useToast();
  const { confirmState, showConfirm, hideConfirm } = useConfirm();
  const toastRef = useRef(toast);
  const apiErrorToastRef = useRef({ message: '', at: 0 });
  const runtimeIssueReportRef = useRef({ key: '', at: 0 });
  const dashboardFallbackNotifiedRef = useRef(false);
  const mainRef = useRef(null);
  const [visitedPages, setVisitedPages] = useState(() => new Set(['Dashboard']));
  const animatedPagesRef = useRef(new Set());
  const operationsBranchIdRef = useRef('');
  const branchBroadcastStateRef = useRef({ initialized: false, lastBranchId: '' });

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    operationsBranchIdRef.current = operationsBranchId;
  }, [operationsBranchId]);

  const readStoredOperationsBranchId = useCallback(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    try {
      return String(window.sessionStorage.getItem(OPERATIONS_BRANCH_STORAGE_KEY) || '').trim().toLowerCase();
    } catch {
      return '';
    }
  }, []);

  const emitGlobalDataChange = useCallback((detail = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    const at = Number(detail.at || Date.now());
    window.__gymvaultLastDataChangeAt = Math.max(Number(window.__gymvaultLastDataChangeAt || 0), at);

    try {
      window.sessionStorage.setItem(GLOBAL_DATA_CHANGE_STORAGE_KEY, String(at));
    } catch {
      // Ignore storage write failures; the in-memory event is enough.
    }

    window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
      detail: {
        ...detail,
        at,
      },
    }));
  }, []);

  const resolveOperationsBranchId = useCallback((nextDirectoryInput, options = {}) => {
    const nextDirectory = normalizeBranchDirectory(nextDirectoryInput);
    const nextDefaultBranchId = getDefaultBranchId(nextDirectory);
    const assignedBranchId = String(currentUser?.branch_id || '').trim().toLowerCase();
    const preferredBranchId = String(options.preferredBranchId || '').trim().toLowerCase();
    const previousBranchId = String(options.previousBranchId || '').trim().toLowerCase();
    const isOwnerUser = String(currentUser?.role || '').toUpperCase() === 'OWNER';

    if (!isOwnerUser) {
      return String(assignedBranchId || nextDefaultBranchId || DEFAULT_BRANCH_ID);
    }

    if (preferredBranchId && nextDirectory.some((branch) => branch.id === preferredBranchId)) {
      return preferredBranchId;
    }

    if (previousBranchId && nextDirectory.some((branch) => branch.id === previousBranchId)) {
      return previousBranchId;
    }

    if (assignedBranchId && nextDirectory.some((branch) => branch.id === assignedBranchId)) {
      return assignedBranchId;
    }

    return String(nextDefaultBranchId || DEFAULT_BRANCH_ID);
  }, [currentUser?.branch_id, currentUser?.role]);

  const applyBranchDirectoryState = useCallback((nextDirectoryInput, options = {}) => {
    const nextDirectory = normalizeBranchDirectory(nextDirectoryInput);
    const nextBranchId = resolveOperationsBranchId(nextDirectory, {
      preferredBranchId: options.preferredBranchId,
      previousBranchId: options.previousBranchId || operationsBranchIdRef.current,
    });

    setBranchDirectory(nextDirectory);
    setOperationsBranchId(nextBranchId);

    return {
      nextDirectory,
      nextBranchId,
    };
  }, [resolveOperationsBranchId]);

  const stabilizeViewportAfterAuth = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const activeElement = document.activeElement;
    const isEditable = activeElement instanceof HTMLElement
      && (activeElement.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName));

    if (isEditable && typeof activeElement.blur === 'function') {
      activeElement.blur();
    }

    document.documentElement.classList.remove('app-keyboard-open');
    document.documentElement.style.setProperty('--app-keyboard-inset', '0px');

    window.dispatchEvent(new CustomEvent('gymvault:force-viewport-sync', {
      detail: {
        source: 'auth-transition',
        at: Date.now(),
      },
    }));
  }, []);

  useEffect(() => {
    setVisitedPages((prev) => {
      if (prev.has(currentPage)) return prev;
      const next = new Set(prev);
      next.add(currentPage);
      return next;
    });
  }, [currentPage]);

  // Handle ?auth_source= from Google / Apple OAuth redirect (cookie-based auth)
  const oauthCookiePending = useRef(false);
  const [authCheckBump, setAuthCheckBump] = useState(0);
  useEffect(() => {
    if (isHQ) return;
    const params   = new URLSearchParams(window.location.search);
    const authSource = params.get('auth_source');
    if (!authSource) return;
    stabilizeViewportAfterAuth();
    // Token is in the HttpOnly cookie now, trigger a /me check
    oauthCookiePending.current = true;
    setAuthCheckBump((n) => n + 1);
    window.history.replaceState({}, '', '/dashboard');
  }, [isHQ, stabilizeViewportAfterAuth]);

  const getPageVisibility = useCallback((pageName) => {
    if (currentPage !== pageName) return 'hidden';
    if (animatedPagesRef.current.has(pageName)) return '';
    animatedPagesRef.current.add(pageName);
    return 'gv-page-fade';
  }, [currentPage]);

  useEffect(() => {
    if (isHQ) {
      setCanInstallApp(false);
      setDeferredInstallPrompt(null);
      return undefined;
    }

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsIosDevice(isIos);
    setIsStandaloneMode(standalone);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
      setCanInstallApp(true);
    };

    const onAppInstalled = () => {
      setCanInstallApp(false);
      setDeferredInstallPrompt(null);
      toastRef.current?.('GymVault app installed!', 'success');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    if (isIos && !standalone) {
      setCanInstallApp(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [isHQ]);

  useEffect(() => {
    if (isHQ) {
      document.documentElement.classList.remove('gv-splash-active');
      return;
    }

    document.documentElement.classList.toggle('gv-splash-active', showSplash);

    return () => {
      document.documentElement.classList.remove('gv-splash-active');
    };
  }, [showSplash, isHQ]);

  const handleInstallApp = useCallback(async () => {
    if (isStandaloneMode) return;

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult?.outcome !== 'accepted') {
        toastRef.current?.('Install cancelled.', 'warning');
      }
      setDeferredInstallPrompt(null);
      setCanInstallApp(false);
      return;
    }

    if (isIosDevice) {
      toastRef.current?.('On iPhone/iPad: tap Share, then Add to Home Screen.', 'warning');
      return;
    }

    toastRef.current?.('Install prompt is not available yet on this browser.', 'warning');
  }, [deferredInstallPrompt, isIosDevice, isStandaloneMode]);

  const clearAuthState = useCallback(({ redirectToLogin = true } = {}) => {
    clearSessionToken();
    writeStoredUser(null);
    localStorage.removeItem('gv_saas_grace_dismissed');
    try {
      window.sessionStorage.removeItem(OPERATIONS_BRANCH_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures during logout.
    }
    
    // Wipe tour memory on logout
    localStorage.removeItem('gymvault_tour_completed');
    localStorage.removeItem('gymvault_skip_setup');

    setToken(null);
    setCurrentUser(null);
    setIsSuspended(false);
    setSaasGrace(false);
    setSaasGraceNoticeKey('');
    setVisitedPages(new Set(['Dashboard']));
    animatedPagesRef.current = new Set();
    setCurrentPage('Dashboard');
    setShowNotifications(false);
    setShowProfileMenu(false);
    setShowMobileMoreNav(false);
    setIsAuthChecking(false);
    branchBroadcastStateRef.current = { initialized: false, lastBranchId: '' };

    if (redirectToLogin && !isHQ) {
      setShowSignup(false);
      const currentPath = (String(window.location.pathname || '/').replace(/\/+$/, '') || '/');
      if (currentPath !== '/login') {
        window.history.pushState({}, '', '/login');
      }
    }
  }, [isHQ]);

  const handleLogout = useCallback(async ({ redirectToLogin = true, skipServerLogout = false } = {}) => {
    if (!skipServerLogout) {
      const requestConfig = token ? { headers: { 'x-auth-token': token } } : undefined;
      await axios.post('/api/auth/logout', {}, requestConfig).catch(() => {});
    }

    clearAuthState({ redirectToLogin });
  }, [clearAuthState, token]);

  const hasPermission = useCallback((permission) => {
    if (!permission) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'OWNER') return true;

    if (permission === 'owner:only') return false;

    const list = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
    if (list.includes('*')) return true;
    if (list.includes(permission)) return true;

    const [scope] = String(permission).split(':');
    return scope ? list.includes(`${scope}:*`) : false;
  }, [currentUser]);

  const canAccessPage = useCallback((page) => {
    const permission = PAGE_PERMISSIONS[page];
    return hasPermission(permission);
  }, [hasPermission]);

  const availableNavItems = NAV_ITEMS.filter((item) => canAccessPage(item.name));

  // Role-aware mobile primary nav — staff sees their most relevant 4 pages
  const staffRole = String(currentUser?.staff_role || '').toUpperCase();
  const isOwner = currentUser?.role === 'OWNER';
  const mobilePrimary = isOwner ? MOBILE_PRIMARY_NAV : (() => {
    if (['RECEPTION', 'MANAGER'].includes(staffRole)) return ['Dashboard', 'Members', 'Leads', 'Payments'];
    if (staffRole === 'TRAINER') return ['Dashboard', 'Attendance', 'Classes', 'Members'];
    if (staffRole === 'ACCOUNTANT') return ['Dashboard', 'Payments', 'Members', 'Plans'];
    return MOBILE_PRIMARY_NAV;
  })();
  const mobilePrimaryNavItems = availableNavItems.filter((item) => mobilePrimary.includes(item.name));
  const mobileMoreNavItems = [
    ...availableNavItems.filter((item) => !mobilePrimary.includes(item.name)),
    ...(canAccessPage('Help & Support') ? [{ name: 'Help & Support', icon: LifeBuoy }] : []),
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.name === item.name) === index);
  const isMoreActive = !mobilePrimary.includes(currentPage);

  useEffect(() => {
    if (isHQ) {
      setIsAuthChecking(false);
      return undefined;
    }

    if (!token && !oauthCookiePending.current) {
      writeStoredUser(null);
      setCurrentUser(null);
      setBranchDirectory([]);
      setOperationsBranchId('');
      setBranchScopeLoading(false);
      setIsAuthChecking(false);
      return undefined;
    }

    let cancelled = false;
    setIsAuthChecking(true);
    const pendingOAuth = oauthCookiePending.current;
    oauthCookiePending.current = false;

    const headers = token ? { 'x-auth-token': token } : {};
    axios.get('/api/auth/me', { headers })
      .then((res) => {
        if (cancelled) return;

        const user = res.data?.user;
        const returnedToken = String(res.data?.token || token || '').trim();

        if (returnedToken) {
          setSessionToken(returnedToken);
          if (returnedToken !== token) {
            setToken(returnedToken);
          }
        }

        if (user) {
          writeStoredUser(user);
          setCurrentUser(user);
        } else {
          writeStoredUser(null);
          setCurrentUser(null);
        }
        // Check SaaS status from auth/me response
        const saas = res.data?.saas;
        if (saas) {
          const graceKey = `GRACE_PERIOD:${saas.valid_until || ''}`;
          if (saas.status === 'EXPIRED') {
            setIsSuspended(true);
            setCurrentPage('Settings');
            setSaasGrace(false);
            setSaasGraceNoticeKey('');
          } else if (saas.status === 'GRACE_PERIOD') {
            setIsSuspended(false);
            setSaasGraceNoticeKey(graceKey);
            setSaasGrace(localStorage.getItem('gv_saas_grace_dismissed') !== graceKey);
          } else {
            setIsSuspended(false);
            setSaasGrace(false);
            setSaasGraceNoticeKey('');
            localStorage.removeItem('gv_saas_grace_dismissed');
          }
        }

        setIsAuthChecking(false);
      })
      .catch((err) => {
        if (cancelled) return;

        const status = Number(err?.response?.status || 0);
        const code = String(err?.response?.data?.code || '').trim().toUpperCase();
        const shouldClearSession = status === 401
          || status === 403
          || status === 404
          || code === 'AUTH_INVALID'
          || code === 'AUTH_MISSING';

        if (!shouldClearSession) {
          const cachedUser = readStoredUser();
          if (cachedUser) {
            setCurrentUser(cachedUser);
          }
          setIsAuthChecking(false);
          return;
        }

        const currentPath = (String(window.location.pathname || '/').replace(/\/+$/, '') || '/');
        const shouldRedirectToLogin = Boolean(token) || !['/login', '/signup'].includes(currentPath);
        clearAuthState({ redirectToLogin: shouldRedirectToLogin });
      });

    return () => {
      cancelled = true;
    };
  }, [token, isHQ, clearAuthState, authCheckBump]);

  useEffect(() => {
    if (isHQ || !token || String(currentUser?.role || '').toUpperCase() !== 'OWNER') return undefined;

    let cancelled = false;
    axios.get('/api/settings/preferences', { headers: { 'x-auth-token': token } })
      .then((res) => {
        if (cancelled) return;
        const applied = applyInterfacePreferences(res.data || {});
        saveInterfacePreferencesLocal(applied);
      })
      .catch(() => {
        // Preference fetch should never block app rendering.
      });

    return () => {
      cancelled = true;
    };
  }, [token, isHQ, currentUser?.role]);

  useEffect(() => {
    if (isHQ || !token || !currentUser) {
      setBranchDirectory([]);
      setOperationsBranchId('');
      setBranchScopeLoading(false);
      branchBroadcastStateRef.current = { initialized: false, lastBranchId: '' };
      return undefined;
    }

    let cancelled = false;
    const preferredBranchId = readStoredOperationsBranchId();
    setBranchScopeLoading(true);

    axios.get('/api/settings/branches', { headers: { 'x-auth-token': token } })
      .then((res) => {
        if (cancelled) return;

        applyBranchDirectoryState(res.data?.branch_directory, {
          preferredBranchId,
        });
      })
      .catch(() => {
        if (cancelled) return;

        const fallbackDirectory = normalizeBranchDirectory(
          currentUser?.branch_id
            ? [{ id: currentUser.branch_id, name: 'Assigned Branch' }]
            : [{ id: DEFAULT_BRANCH_ID, name: 'Main Branch' }]
        );

        applyBranchDirectoryState(fallbackDirectory, {
          preferredBranchId,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setBranchScopeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, isHQ, currentUser, readStoredOperationsBranchId, applyBranchDirectoryState]);

  useEffect(() => {
    if (isHQ || !token || !currentUser) {
      return undefined;
    }

    const handleBranchesConfigured = (event) => {
      const nextDirectory = event?.detail?.branch_directory;
      if (!Array.isArray(nextDirectory)) {
        return;
      }

      applyBranchDirectoryState(nextDirectory, {
        preferredBranchId: event?.detail?.preferred_branch_id || readStoredOperationsBranchId(),
      });
    };

    window.addEventListener('gymvault:branches-configured', handleBranchesConfigured);

    return () => {
      window.removeEventListener('gymvault:branches-configured', handleBranchesConfigured);
    };
  }, [token, isHQ, currentUser, applyBranchDirectoryState, readStoredOperationsBranchId]);

  useEffect(() => {
    if (isHQ) return;
    if (!token) return;
    if (canAccessPage(currentPage)) return;

    const firstAllowed = availableNavItems[0]?.name || 'Help & Support';
    setCurrentPage(firstAllowed);
  }, [currentPage, availableNavItems, canAccessPage, token, isHQ]);

  useEffect(() => {
    setShowMobileMoreNav(false);
  }, [currentPage]);

  // Scroll main panel back to top on every page switch
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentPage]);

  // --- NOTIFICATION STATE & LOGIC ---
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    if (!token || isHQ || isSuspended) return;
    try {
      const res = await axios.get('/api/notifications', {
        headers: { 'x-auth-token': token },
        suppressGlobalErrorToast: true,
      });
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unread_count);
    } catch (err) {
      reportClientError('Notifications fetch', err);
    }
  }, [token, isHQ, isSuspended]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!token || isHQ || isSuspended) return undefined;

    const intervalId = setInterval(() => {
      fetchNotifications();
    }, 90000);

    return () => clearInterval(intervalId);
  }, [fetchNotifications, token, isHQ, isSuspended]);

  // ── Web Push Subscribe ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isHQ || !token || isSuspended) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission === 'denied') return;

    let cancelled = false;

    (async () => {
      try {
        const keyRes = await axios.get('/api/push/vapid-public-key');
        const vapidPublicKey = keyRes.data?.publicKey;
        if (!vapidPublicKey || cancelled) return;

        const registration = await navigator.serviceWorker.ready;

        // Check if already subscribed
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          // Re-register in case it was lost on the server
          await axios.post('/api/push/subscribe', existing.toJSON(), { headers: { 'x-auth-token': token } }).catch(() => {});
          return;
        }

        // Request permission only if not already granted
        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (permission !== 'granted' || cancelled) return;

        // Convert VAPID key
        const urlB64 = vapidPublicKey;
        const padding = '='.repeat((4 - urlB64.length % 4) % 4);
        const base64 = (urlB64 + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const outputArray = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) outputArray[i] = raw.charCodeAt(i);

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray,
        });

        if (!cancelled) {
          await axios.post('/api/push/subscribe', subscription.toJSON(), { headers: { 'x-auth-token': token } }).catch(() => {});
        }
      } catch (_err) {
        // Push setup failure should never block the app
      }
    })();

    return () => { cancelled = true; };
  }, [token, isHQ, isSuspended]);

  const handleMarkAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`, {}, {
        headers: { 'x-auth-token': token }
      });
      fetchNotifications(); 
    } catch (err) {
      reportClientError('Notifications mark read', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await axios.put('/api/notifications/read-all', {}, {
        headers: { 'x-auth-token': token }
      });
      fetchNotifications();
      setShowNotifications(false); 
    } catch (err) {
      reportClientError('Notifications mark all read', err);
    }
  };


  useEffect(() => {
    if (isHQ) return undefined;

    const handleAuthInvalid = (event) => {
      const message = String(event?.detail?.message || 'Session expired. Please login again.').trim();
      toastRef.current?.(message, 'error');
      handleLogout({ redirectToLogin: true, skipServerLogout: true });
    };

    const handleApiError = (event) => {
      const message = String(event?.detail?.message || '').trim();
      if (!message) return;

      const now = Date.now();
      if (apiErrorToastRef.current.message === message && now - apiErrorToastRef.current.at < 4000) {
        return;
      }

      apiErrorToastRef.current = { message, at: now };
      toastRef.current?.(message, 'warning');
    };

    window.addEventListener('gymvault:auth-invalid', handleAuthInvalid);
    window.addEventListener('gymvault:api-error', handleApiError);

    return () => {
      window.removeEventListener('gymvault:auth-invalid', handleAuthInvalid);
      window.removeEventListener('gymvault:api-error', handleApiError);
    };
  }, [handleLogout, isHQ]);

  useEffect(() => {
    const shouldReportRuntimeIssue = (key) => {
      const now = Date.now();
      if (runtimeIssueReportRef.current.key === key && now - runtimeIssueReportRef.current.at < 5000) {
        return false;
      }

      runtimeIssueReportRef.current = { key, at: now };
      return true;
    };

    const handleWindowError = (event) => {
      const source = String(event?.filename || '').trim();
      const message = String(event?.error?.message || event?.message || 'Uncaught browser error').trim();

      if (!message || isIgnoredRuntimeIssue(message, source)) {
        return;
      }

      const signature = `window:${source}:${message}`;
      if (!shouldReportRuntimeIssue(signature)) {
        return;
      }

      const error = event?.error instanceof Error ? event.error : new Error(message);
      reportClientError('Window error', error, {
        source,
        line: Number(event?.lineno || 0),
        column: Number(event?.colno || 0),
      });
    };

    const handleUnhandledRejection = (event) => {
      const reason = event?.reason;
      const message = String(reason?.message || reason || 'Unhandled promise rejection').trim();

      if (!message || isIgnoredRuntimeIssue(message)) {
        return;
      }

      const signature = `rejection:${message}`;
      if (!shouldReportRuntimeIssue(signature)) {
        return;
      }

      const error = reason instanceof Error ? reason : new Error(message);
      reportClientError('Unhandled rejection', error, {
        reasonType: typeof reason,
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.data.error === "SAAS_EXPIRED") {
          setIsSuspended(true); 
          setCurrentPage('Settings'); 
          return new Promise(() => {}); 
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  // 🚨 NAVIGATION
  const handleSidebarNav = useCallback((page) => {
    if (!canAccessPage(page)) {
      toast('Access restricted for your role.', 'warning');
      return;
    }
    if (isSuspended && page !== 'Settings') {
      toast("Access Restricted: Please renew your subscription", "error");
      return; 
    }
    if (page === 'Members') {
      setMemberFilter('All');
      setMemberFocus({ id: null, action: null });
    } else {
      setMemberFocus({ id: null, action: null });
    }
    if (page === 'Payments') {
      setPaymentFilter('All');
      setPaymentFocus({ id: null, action: null });
      setPaymentSectionFocus(null);
    } else {
      setPaymentFocus({ id: null, action: null });
      setPaymentSectionFocus(null);
    }
    if (page !== 'Attendance') {
      setAttendanceSectionFocus(null);
    }
    if (page === 'Settings') {
      setSettingsTab('menu');
    }
    setCurrentPage(page);
  }, [isSuspended, toast, canAccessPage]);

  const navigateTo = useCallback((page, subPath = 'All', options = {}) => {
    if (!canAccessPage(page)) return;
    if (isSuspended && page !== 'Settings') return; 
    if (page === 'Members') {
      setMemberFilter(subPath);
      const rawMemberId = Number.parseInt(options?.memberId, 10);
      setMemberFocus({
        id: Number.isInteger(rawMemberId) ? rawMemberId : null,
        action: typeof options?.action === 'string' ? options.action : null,
      });
    } else {
      setMemberFocus({ id: null, action: null });
    }
    if (page === 'Payments') {
      const rawPaymentId = Number.parseInt(options?.paymentId, 10);
      setPaymentFilter(typeof subPath === 'string' && subPath ? subPath : 'All');
      setPaymentFocus({
        id: Number.isInteger(rawPaymentId) ? rawPaymentId : null,
        action: typeof options?.action === 'string' ? options.action : null,
      });
      setPaymentSectionFocus(typeof options?.section === 'string' && options.section ? options.section : null);
    } else {
      setPaymentFocus({ id: null, action: null });
      setPaymentSectionFocus(null);
    }
    if (page === 'Attendance') {
      setAttendanceSectionFocus(typeof options?.section === 'string' && options.section ? options.section : null);
    } else {
      setAttendanceSectionFocus(null);
    }
    if (page === 'Settings') setSettingsTab(subPath || 'menu');
    setCurrentPage(page);
  }, [isSuspended, canAccessPage]);

  const normalizedBranchDirectory = normalizeBranchDirectory(branchDirectory);
  const defaultBranchId = getDefaultBranchId(normalizedBranchDirectory);
  const branchScopeValue = getBranchRequestValue(operationsBranchId);
  const canSelectOperationsBranch = String(currentUser?.role || '').toUpperCase() === 'OWNER' && normalizedBranchDirectory.length > 1;
  const activeOperationsBranchLabel = getBranchLabel(normalizedBranchDirectory, operationsBranchId, {
    allLabel: normalizedBranchDirectory[0]?.name || 'Branch',
  });
  const handleOperationsBranchChange = useCallback((nextBranchId) => {
    const resolvedBranchId = String(nextBranchId || defaultBranchId || DEFAULT_BRANCH_ID);
    if (resolvedBranchId === operationsBranchIdRef.current) {
      return;
    }

    setOperationsBranchId(resolvedBranchId);
  }, [defaultBranchId]);

  useEffect(() => {
    if (isHQ || !token || !operationsBranchId) {
      return;
    }

    try {
      window.sessionStorage.setItem(OPERATIONS_BRANCH_STORAGE_KEY, operationsBranchId);
    } catch {
      // Ignore storage write failures; in-memory branch state still works.
    }

    const previousBranchId = branchBroadcastStateRef.current.lastBranchId;
    branchBroadcastStateRef.current.lastBranchId = operationsBranchId;

    if (!branchBroadcastStateRef.current.initialized) {
      branchBroadcastStateRef.current.initialized = true;
      return;
    }

    if (previousBranchId === operationsBranchId) {
      return;
    }

    const at = Date.now();
    window.dispatchEvent(new CustomEvent('gymvault:branch-scope-changed', {
      detail: {
        branch_id: operationsBranchId,
        branch_scope_value: branchScopeValue,
        at,
      },
    }));

    emitGlobalDataChange({
      source: 'branch-scope-change',
      scope: 'branch-scope',
      branch_id: operationsBranchId,
      branch_scope_value: branchScopeValue,
      at,
    });
  }, [branchScopeValue, emitGlobalDataChange, isHQ, operationsBranchId, token]);

  const appRuntime = useMemo(() => ({
    token,
    toast,
    showConfirm,
    currentUser,
    navigateTo,
    canAccessPage,
    branchDirectory: normalizedBranchDirectory,
    defaultBranchId,
    operationsBranchId,
    branchScopeValue,
    branchScopeLoading,
    canSelectOperationsBranch,
    setOperationsBranchId: handleOperationsBranchChange,
  }), [
    token,
    toast,
    showConfirm,
    currentUser,
    navigateTo,
    canAccessPage,
    normalizedBranchDirectory,
    defaultBranchId,
    operationsBranchId,
    branchScopeValue,
    branchScopeLoading,
    canSelectOperationsBranch,
    handleOperationsBranchChange,
  ]);

  const renderPageLoader = (label) => (
    <PageLoader className="mx-auto" label={`Loading ${label}...`} />
  );

  useEffect(() => {
    if (isHQ) {
      setShowSplash(false);
      return;
    }
    const t1 = setTimeout(() => setSplashExiting(true), 420);
    const t2 = setTimeout(() => setShowSplash(false), 760);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isHQ]);

  useEffect(() => {
    if (isHQ || token) return undefined;

    const syncAuthRoute = () => {
      const currentPath = (String(window.location.pathname || '/').replace(/\/+$/, '') || '/');
      setShowSignup(currentPath === '/signup');
    };

    syncAuthRoute();
    window.addEventListener('popstate', syncAuthRoute);
    return () => window.removeEventListener('popstate', syncAuthRoute);
  }, [isHQ, token]);

  useEffect(() => {
    if (isHQ) return;
    if (token && (window.location.pathname === '/login' || window.location.pathname === '/signup')) {
      window.history.pushState({}, '', '/dashboard');
      setCurrentPage('Dashboard');
    }
  }, [token, isHQ]);

  const fetchDashboard = useCallback(async () => {
    if (!token || isHQ || isSuspended || currentUser?.role !== 'OWNER') return;
    try {
      const params = {};
      if (branchScopeValue) params.branch_id = branchScopeValue;
      const res = await axios.get('/api/dashboard/stats', {
        headers: { 'x-auth-token': token },
        params,
      });
      if (res.data.is_active === false) {
        setIsSuspended(true);
        setCurrentPage('Settings');
        return;
      }
      if (res.data) {
        setStats({
          activeMembers: res.data.active_members || 0,
          monthlyRevenue: res.data.total_earnings || 0,
          todayCheckins: 0,
          expiringSoon: res.data.inactive_members || 0
        });
      } else {
        setStats({
          activeMembers: 0,
          monthlyRevenue: 0,
          todayCheckins: 0,
          expiringSoon: 0
        });
      }
    } catch (_err) {
      setStats({
        activeMembers: 0,
        monthlyRevenue: 0,
        todayCheckins: 0,
        expiringSoon: 0
      });
      if (!dashboardFallbackNotifiedRef.current) {
        dashboardFallbackNotifiedRef.current = true;
        toastRef.current?.('Dashboard stats are temporarily unavailable. Showing basic view.', 'warning');
      }
    }
  }, [token, isHQ, isSuspended, currentUser?.role, branchScopeValue]);

  useEffect(() => {
    if (currentPage === 'Dashboard' && !isSuspended && currentUser?.role === 'OWNER') fetchDashboard();
  }, [currentPage, isSuspended, currentUser?.role, fetchDashboard]);

  useEffect(() => {
    if (!token || isHQ || isSuspended || currentUser?.role !== 'OWNER' || currentPage !== 'Dashboard') {
      return;
    }

    const intervalId = setInterval(() => {
      fetchDashboard();
    }, 45000);

    return () => clearInterval(intervalId);
  }, [token, isHQ, isSuspended, currentUser?.role, currentPage, fetchDashboard]);

  useEffect(() => {
    if (!token || isHQ || isSuspended || currentUser?.role !== 'OWNER' || currentPage !== 'Dashboard' || stats) {
      return;
    }

    const fallbackTimer = setTimeout(() => {
      setStats((prev) => prev || {
        activeMembers: 0,
        monthlyRevenue: 0,
        todayCheckins: 0,
        expiringSoon: 0
      });

      if (!dashboardFallbackNotifiedRef.current) {
        dashboardFallbackNotifiedRef.current = true;
        toastRef.current?.('Dashboard took too long to load stats. Showing basic view.', 'warning');
      }
    }, 7000);

    return () => clearTimeout(fallbackTimer);
  }, [token, isHQ, isSuspended, currentUser, currentPage, stats]);

  // ════════════════════════════════════════════════════════════════════════
  // 🚀 THE MASTERCLASS TOUR ENGINE
  // ════════════════════════════════════════════════════════════════════════

  // The engine that finds the element on the screen and draws the spotlight over it
  useEffect(() => {
    if (!tour.isActive) return;
    const step = TOUR_STEPS[tour.step];
    if (step.targetId) {
      const findElement = () => {
        const el = document.getElementById(step.targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            setTourRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          }, 300);
        } else {
          setTimeout(findElement, 200); // Retry if page is still rendering
        }
      };
      findElement();
    } else {
      setTourRect(null);
    }
  }, [tour.isActive, tour.step, currentPage]);

  const startTour = useCallback(() => { setTour({ isActive: true, step: 0 }); navigateTo('Dashboard'); }, [navigateTo]);

  const handleNextTourStep = () => {
    const nextStep = tour.step + 1;
    if (nextStep < TOUR_STEPS.length) {
      navigateTo(TOUR_STEPS[nextStep].page);
      setTour({ isActive: true, step: nextStep });
    } else {
      setTour({ isActive: false, step: 0 });
      navigateTo('Dashboard');
      toast("Setup Tour Complete!", "success");
    }
  };

  const endTour = () => { setTour({ isActive: false, step: 0 }); toast("Tour exited.", "info"); };

  // ════════════════════════════════════════════════════════════════════════

  if (isHQ) {
    if (!superToken) {
      return <SuperAdminLogin setSuperToken={setSuperToken} />;
    }
    return <SuperAdminDashboard token={superToken} onLogout={() => { setSuperToken(''); }} />;
  }

  if (!token) {
    if (isAuthChecking) {
      return <SplashScreen exiting={false} />;
    }

    const storeToken = (t, user) => {
      stabilizeViewportAfterAuth();
      authTransitionRef.current = true;
      setTimeout(() => { authTransitionRef.current = false; }, 600);
      const nextToken = setSessionToken(t);
      setIsAuthChecking(false);
      setShowProfileMenu(false);
      setToken(nextToken);
      if (user) {
        writeStoredUser(user);
        setCurrentUser(user);
      } else {
        writeStoredUser(null);
        setCurrentUser(null);
      }
        setVisitedPages(new Set(['Dashboard']));
        animatedPagesRef.current = new Set();
        setCurrentPage('Dashboard');
        setSaasGrace(false);
        setSaasGraceNoticeKey('');
        localStorage.removeItem('gv_saas_grace_dismissed');
    };
    const showLoginPage = () => {
      setShowSignup(false);
      if (window.location.pathname !== '/login') {
        window.history.pushState({}, '', '/login');
      }
    };
    const showSignupPage = () => {
      setShowSignup(true);
      if (window.location.pathname !== '/signup') {
        window.history.pushState({}, '', '/signup');
      }
    };
    if (showSignup) {
      return <SignupPage onShowLogin={showLoginPage} setToken={storeToken} />;
    }
    return <LoginPage setToken={storeToken} onShowSignup={showSignupPage} />;
  }

  if (isAuthChecking || !currentUser) {
    return <SplashScreen exiting={false} />;
  }

  return (
    <>
      {isSuspended && <SuspensionOverlay onLogout={handleLogout} onRenew={() => { setIsSuspended(false); setCurrentPage('Settings'); setSettingsTab('billing'); }} />}
      {saasGrace && !isSuspended && (
        <div className="fixed top-0 left-0 right-0 z-[9980] bg-gradient-to-r from-orange-500 to-amber-500 text-white px-4 py-2.5 text-center shadow-lg" style={{ paddingTop: 'calc(var(--safe-area-top) + 0.625rem)' }}>
          <div className="relative mx-auto max-w-[1400px] px-8">
            <p className="text-xs font-bold">?? Your subscription has expired. You have a few days of grace period remaining. <button onClick={() => { setSaasGrace(false); setCurrentPage('Settings'); setSettingsTab('billing'); }} className="underline font-extrabold ml-1 hover:text-white/80">Renew Now</button></p>
            <button
              type="button"
              onClick={() => {
                if (saasGraceNoticeKey) {
                  localStorage.setItem('gv_saas_grace_dismissed', saasGraceNoticeKey);
                }
                setSaasGrace(false);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 transition-colors"
              aria-label="Dismiss subscription warning"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {showSplash && <SplashScreen exiting={splashExiting} />}

      {/* 🚀 SMART SPOTLIGHT TOUR OVERLAY */}
      {tour.isActive && (
        <div className="fixed inset-0 z-[9990] pointer-events-none">
          
          {/* Background Dimmer (If no specific target, dim entire screen) */}
          {!tourRect && <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm transition-all duration-500" />}

          {/* The Spotlight Cutout (Draws a massive shadow outside the box to dim the screen, leaving the element clear) */}
          {tourRect && (
            <div 
              className="absolute rounded-2xl transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                top: tourRect.top - 8, left: tourRect.left - 8, 
                width: tourRect.width + 16, height: tourRect.height + 16,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.75)',
                border: '2px solid #818cf8'
              }}
            />
          )}

          {/* The Tooltip Card */}
          <div 
            className="absolute z-[9999] bg-white rounded-2xl shadow-2xl p-6 w-[340px] pointer-events-auto transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] border border-slate-100"
            style={
              !tourRect || TOUR_STEPS[tour.step].position === 'center' 
                ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '400px' } 
                : TOUR_STEPS[tour.step].position === 'right' 
                  ? { top: tourRect.top, left: tourRect.left + tourRect.width + 30 }
                  : TOUR_STEPS[tour.step].position === 'bottom'
                    ? { top: tourRect.top + tourRect.height + 30, left: tourRect.left + (tourRect.width/2) - 170 }
                    : { top: tourRect.top - 220, left: tourRect.left + (tourRect.width/2) - 170 } // Top fallback
            }
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-1.5">Step {tour.step + 1} of {TOUR_STEPS.length}</p>
            <h3 className="text-lg font-black text-slate-900 mb-2">{TOUR_STEPS[tour.step].title}</h3>
            <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">{TOUR_STEPS[tour.step].desc}</p>
            
            <div className="flex items-center gap-3">
              <button onClick={handleNextTourStep} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2">
                 {tour.step === TOUR_STEPS.length - 1 ? 'Finish Tour' : 'Next'} <ArrowRight size={16} />
              </button>
              <button onClick={endTour} className="px-4 py-3 text-slate-400 hover:text-slate-600 font-bold text-xs uppercase tracking-widest transition-colors">
                 Skip
              </button>
            </div>
          </div>
        </div>
      )}


      <div
        className="flex overflow-hidden font-['Inter'] antialiased text-slate-900"
        style={{
          /* position:fixed + inset:0 makes the shell ALWAYS fill the exact
             viewport � no dependence on window.innerHeight measurements.
             This eliminates the iOS standalone PWA relaunch layout shift where
             innerHeight reports a transient smaller value, producing empty space
             below content or showing the manifest background_color strip near
             the home indicator. */
          position: 'fixed',
          inset: 0,
          background: `
            radial-gradient(ellipse at 18% 18%, rgba(99,102,241,0.09) 0%, transparent 55%),
            radial-gradient(ellipse at 82% 82%, rgba(168,85,247,0.07) 0%, transparent 55%),
            radial-gradient(ellipse at 82% 12%, rgba(59,130,246,0.05) 0%, transparent 50%),
            radial-gradient(ellipse at 12% 82%, rgba(16,185,129,0.04) 0%, transparent 50%),
            #f3f4ff
          `
        }}
      >
        <div className="fixed right-4 sm:right-5 z-[9999] flex flex-col gap-3 pointer-events-none" style={{ top: 'max(calc(var(--safe-area-top) + 1rem), 1rem)' }}>
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem {...t} onRemove={() => removeToast(t.id)} />
            </div>
          ))}
        </div>

        <ConfirmModal confirmState={confirmState} hideConfirm={hideConfirm} />

        <aside
          className="w-64 p-5 hidden desktop:flex flex-col text-white shadow-2xl relative overflow-hidden z-10 shrink-0"
          style={{ background: 'linear-gradient(180deg, #0b0f1e 0%, #0f1526 100%)' }}
        >
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)' }} />
          <div className="absolute bottom-28 -left-14 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.14) 0%, transparent 70%)' }} />

          <div className="flex items-center gap-3 mb-10 px-2 relative">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                boxShadow: '0 4px 20px rgba(99,102,241,0.5)'
              }}>
              <Dumbbell size={17} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[15px] font-extrabold tracking-tight leading-none text-white">GymVault</div>
              <div className="text-[9px] font-bold tracking-[0.18em] uppercase mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>
                {currentUser?.role === 'OWNER' ? 'Pro Dashboard' : (currentUser?.staff_role || currentUser?.role || 'Staff').replace(/(^\w|\s\w)/g, m => m.toUpperCase()) + ' View'}
              </div>
            </div>
          </div>

          <nav className="space-y-0.5 flex-1">
            {availableNavItems.map((item) => {
              const { name } = item;
              const IconComponent = item.icon;
              const isActive = currentPage === name;
              const isBlocked = isSuspended && name !== 'Settings';
              return (
                <div
                  id={`nav-${name}`}
                  key={name}
                  onClick={() => handleSidebarNav(name)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 group relative ${
                    isBlocked ? 'opacity-30 cursor-not-allowed grayscale' : 'cursor-pointer'
                  } ${
                    isActive ? 'text-white bg-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-indigo-400" />
                  )}
                  <IconComponent size={16} className={isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
                  {name}
                  {isBlocked && <Lock size={12} className="ml-auto opacity-50" />}
                </div>
              );
            })}
          </nav>

          <div className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => handleSidebarNav('Help & Support')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${currentPage === 'Help & Support' ? 'text-white bg-indigo-600/20' : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'}`}
            >
              <LifeBuoy size={16} className="shrink-0" />
              Help & Support
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="relative z-50 shrink-0 border-b border-white/60 app-header-safe">
            <div className="app-header-row flex items-center justify-between px-4 desktop:px-8">
              {/* Left: page name */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="hidden desktop:inline text-sm font-semibold text-slate-400">Home</span>
                {currentPage !== 'Dashboard' && (
                  <>
                    <span className="hidden desktop:inline text-slate-300 text-xs mx-0.5">/</span>
                    <span className="text-sm font-bold text-slate-800 truncate">{currentPage}</span>
                  </>
                )}
                {currentPage === 'Dashboard' && (
                  <span className="desktop:hidden text-sm font-bold text-slate-800">Dashboard</span>
                )}
              </div>

              {/* Center: branch switcher on mobile */}
              {canSelectOperationsBranch && (
                <div className="desktop:hidden absolute left-1/2 -translate-x-1/2">
                  <label className="relative inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 shadow-sm cursor-pointer">
                    <Building2 size={14} className="text-indigo-500 shrink-0" />
                    <span className="max-w-[100px] truncate">{activeOperationsBranchLabel}</span>
                    <ChevronDown size={13} className="text-slate-400 shrink-0" />
                    <select
                      value={operationsBranchId}
                      onChange={(e) => handleOperationsBranchChange(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      aria-label="Switch branch"
                    >
                      {buildBranchOptions(normalizedBranchDirectory, { includeAll: false }).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="flex items-center gap-2 sm:gap-5">
              {token && !isStandaloneMode && canInstallApp && (
                <button
                  onClick={handleInstallApp}
                  className="desktop:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-black uppercase tracking-wider hover:bg-indigo-100 transition-colors"
                >
                  <Download size={13} />
                  Add to Screen
                </button>
              )}
  
                {/* NOTIFICATION BELL */}
                <div className="relative">
                <button 
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white animate-pulse" />
                  )}
                </button>

                {showNotifications && (
                  <>
                    <div className="fixed inset-0 z-[40]" onClick={() => setShowNotifications(false)} />
                    <div className="absolute top-full right-0 mt-3 w-80 bg-white rounded-2xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.3)] border border-slate-100 overflow-hidden z-[50] animate-in slide-in-from-top-2 fade-in duration-200">
                      <div className="p-4 border-b flex items-center justify-between bg-slate-50/50">
                        <h3 className="font-bold text-slate-800 text-sm">Notifications</h3>
                        {unreadCount > 0 && (
                          <button onClick={handleMarkAllAsRead} className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-700">
                            Mark all read
                          </button>
                        )}
                      </div>
                      
                      <div className="max-h-[350px] overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="p-8 text-center text-sm text-slate-400 font-semibold">
                            You're all caught up!
                          </div>
                        ) : (
                          notifications.map(notif => (
                            <div 
                              key={notif.id} 
                              onClick={() => { if(!notif.is_read) handleMarkAsRead(notif.id) }}
                              className={`p-4 border-b border-slate-50 last:border-0 transition-colors cursor-pointer ${notif.is_read ? 'bg-white hover:bg-slate-50' : 'bg-indigo-50/40 hover:bg-indigo-50/70'}`}
                            >
                              <div className="flex gap-3">
                                <div className="pt-1.5 shrink-0">
                                   <div className={`w-2 h-2 rounded-full ${notif.is_read ? 'bg-slate-200' : 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]'}`} />
                                </div>
                                <div>
                                  <h4 className={`text-sm ${notif.is_read ? 'font-semibold text-slate-600' : 'font-black text-slate-900'}`}>
                                    {notif.title}
                                  </h4>
                                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    {notif.message}
                                  </p>
                                  <span className="text-[10px] text-slate-400 mt-2 block font-bold uppercase tracking-wider">
                                    {new Date(notif.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
                </div>

                {/* BRANCH SWITCHER � desktop only (mobile version is centered above) */}
                {canSelectOperationsBranch && (
                  <div className="relative hidden desktop:block max-w-[12rem] shrink-0">
                    <label className="relative inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 shadow-sm cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all">
                      <Building2 size={14} className="text-indigo-500 shrink-0" />
                      <span className="max-w-[120px] truncate">{activeOperationsBranchLabel}</span>
                      <ChevronDown size={13} className="text-slate-400 shrink-0" />
                      <select
                        value={operationsBranchId}
                        onChange={(e) => handleOperationsBranchChange(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label="Switch branch"
                      >
                        {buildBranchOptions(normalizedBranchDirectory, { includeAll: false }).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

               {/* PROFILE MENU */}
                <div className="relative">
                <button 
                  onClick={() => { if (!authTransitionRef.current) setShowProfileMenu(!showProfileMenu); }}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-black shadow-md bg-gradient-to-tr from-indigo-500 to-purple-500 hover:scale-105 transition-transform ring-2 ring-white"
                >
                  G
                </button>

                {showProfileMenu && (
                  <>
                    <div className="fixed inset-0 z-[40]" onClick={() => setShowProfileMenu(false)} />
                    <div className="absolute top-full right-0 mt-3 w-64 bg-white rounded-2xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.3)] border border-slate-100 overflow-hidden z-[50] animate-in slide-in-from-top-2 fade-in duration-200">
                      
                      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                        <p className="text-sm font-black text-slate-800">{currentUser?.full_name || 'Gym User'}</p>
                        <p className="text-xs font-semibold text-slate-500 mt-0.5 truncate">{currentUser?.email || 'user@gymvault.com'}</p>
                      </div>
                      <div className="p-2">
                        {canAccessPage('Settings') && (
                          <>
                            <button 
                              onClick={() => { navigateTo('Settings', 'account'); setShowProfileMenu(false); }} 
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            >
                              <User size={16} /> Account Profile
                            </button>
                            <button 
                              onClick={() => { navigateTo('Settings', 'billing'); setShowProfileMenu(false); }} 
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            >
                              <CreditCard size={16} /> Billing & Subscription
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => { navigateTo('Help & Support'); setShowProfileMenu(false); }} 
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        >
                          <LifeBuoy size={16} /> Help & Support
                        </button>
                      </div>

                      <div className="p-2 border-t border-slate-100">
                        <button 
                          onClick={handleLogout} 
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-black text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                        >
                          <LogOut size={16} /> Sign Out
                        </button>
                      </div>

                    </div>
                  </>
                )}
                </div>
              </div>
            </div>
          </header>

          {/* ── Keep-alive page mounting: each page stays in DOM after first visit ── */}
          <main ref={mainRef} className="app-scroll-shell flex-1 overflow-y-auto">

            {/* Dashboard */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll-dashboard ${getPageVisibility('Dashboard')}`}>
              {visitedPages.has('Dashboard') && (
                <PageErrorBoundary pageName="Dashboard" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Dashboard')}>
                    {currentUser?.role === 'OWNER'
                      ? <DashboardPage appRuntime={appRuntime} setCurrentPage={setCurrentPage} startTour={startTour} isActive={currentPage === 'Dashboard'} />
                      : <StaffDashboard appRuntime={appRuntime} isActive={currentPage === 'Dashboard'} />}
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Members */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Members')}`}>
              {visitedPages.has('Members') && (
                <PageErrorBoundary pageName="Members" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Members')}>
                    <MembersPage key={`members-${memberFilter}`} appRuntime={appRuntime} defaultFilter={memberFilter} focusMemberId={memberFocus.id} focusAction={memberFocus.action} onFocusHandled={() => setMemberFocus({ id: null, action: null })} isActive={currentPage === 'Members'} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Leads */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Leads')}`}>
              {visitedPages.has('Leads') && (
                <PageErrorBoundary pageName="Leads" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Leads')}>
                    <LeadsPage appRuntime={appRuntime} canManage={hasPermission('members:write')} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Plans */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Plans')}`}>
              {visitedPages.has('Plans') && (
                <PageErrorBoundary pageName="Plans" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Plans')}>
                    <PlansPage appRuntime={appRuntime} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Payments */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Payments')}`}>
              {visitedPages.has('Payments') && (
                <PageErrorBoundary pageName="Payments" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Payments')}>
                    <PaymentsPage
                      appRuntime={appRuntime}
                      isActive={currentPage === 'Payments'}
                      defaultFilter={paymentFilter}
                      focusPaymentId={paymentFocus.id}
                      focusAction={paymentFocus.action}
                      onFocusHandled={() => setPaymentFocus({ id: null, action: null })}
                      focusSection={paymentSectionFocus}
                      onSectionHandled={() => setPaymentSectionFocus(null)}
                    />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Attendance */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Attendance')}`}>
              {visitedPages.has('Attendance') && (
                <PageErrorBoundary pageName="Attendance" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Attendance')}>
                    <AttendancePage
                      appRuntime={appRuntime}
                      isActive={currentPage === 'Attendance'}
                      focusSection={attendanceSectionFocus}
                      onSectionHandled={() => setAttendanceSectionFocus(null)}
                      onOpenRfidSetup={() => navigateTo('RFID Setup')}
                    />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Classes */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Classes')}`}>
              {visitedPages.has('Classes') && (
                <PageErrorBoundary pageName="Classes" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Classes')}>
                    <ClassesPage appRuntime={appRuntime} canManage={hasPermission('attendance:write')} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* RFID Setup */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('RFID Setup')}`}>
              {visitedPages.has('RFID Setup') && (
                <PageErrorBoundary pageName="RFID Setup" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('RFID Setup')}>
                    <RfidSetupPage
                      appRuntime={appRuntime}
                      navigateBack={() => navigateTo('Attendance')}
                    />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Insights */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Insights')}`}>
              {visitedPages.has('Insights') && (
                <PageErrorBoundary pageName="Insights" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Insights')}>
                    <InsightsPage appRuntime={appRuntime} isActive={currentPage === 'Insights'} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Settings */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Settings')}`}>
              {visitedPages.has('Settings') && (
                <PageErrorBoundary pageName="Settings" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Settings')}>
                    <SettingsPage appRuntime={appRuntime} defaultTab={settingsTab} isActive={currentPage === 'Settings'} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

            {/* Help & Support */}
            <div className={`max-w-[1400px] mx-auto w-full p-4 desktop:p-6 lg:p-8 app-main-scroll ${getPageVisibility('Help & Support')}`}>
              {visitedPages.has('Help & Support') && (
                <PageErrorBoundary pageName="Help & Support" onGoHome={() => navigateTo('Dashboard')}>
                  <Suspense fallback={renderPageLoader('Help & Support')}>
                    <HelpSupportPage appRuntime={appRuntime} />
                  </Suspense>
                </PageErrorBoundary>
              )}
            </div>

          </main>
        </div>

        {showMobileMoreNav && (
          <>
            <div
              className="fixed inset-0 z-[115] desktop:hidden bg-slate-900/25 backdrop-blur-[1px]"
              onClick={() => setShowMobileMoreNav(false)}
            />
            <div
              className="fixed left-3 right-3 z-[116] desktop:hidden rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl p-2 shadow-[0_20px_45px_-25px_rgba(15,23,42,0.55)]"
              style={{ bottom: 'calc(var(--mobile-nav-offset) + 0.5rem)' }}
            >
              <div className="grid grid-cols-2 gap-1.5">
                {mobileMoreNavItems.map((item) => {
                  const { name } = item;
                  const IconComponent = item.icon;
                  const isActive = currentPage === name;
                  const isBlocked = isSuspended && name !== 'Settings';
                  return (
                    <button
                      key={`mobile-more-${name}`}
                      onClick={() => {
                        setShowMobileMoreNav(false);
                        handleSidebarNav(name);
                      }}
                      disabled={isBlocked}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        isActive ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100/70'
                      } ${isBlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <IconComponent size={15} />
                      <span className="truncate">{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <nav className="app-mobile-nav fixed inset-x-0 bottom-0 desktop:hidden z-[120] px-3 pt-1">
          <div className="mx-auto max-w-[560px] rounded-[26px] border border-slate-200/80 bg-white/95 backdrop-blur-2xl p-1.5 shadow-[0_15px_40px_-18px_rgba(15,23,42,0.6)]">
            {/* iOS-style sliding indicator nav */}
            <MobileNav
              items={mobilePrimaryNavItems}
              moreItems={mobileMoreNavItems}
              currentPage={currentPage}
              isMoreActive={isMoreActive}
              showMobileMoreNav={showMobileMoreNav}
              isSuspended={isSuspended}
              onNav={handleSidebarNav}
              onMoreToggle={() => setShowMobileMoreNav((prev) => !prev)}
            />
          </div>
        </nav>
      </div>
    </>
  );
}

export default App;
