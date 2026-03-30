import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import DashboardPage from './DashboardPage';
import MembersPage from './MembersPage';
import PlansPage from './PlansPage';
import PaymentsPage from "./PaymentsPage";
import AttendancePage from './AttendancePage';
import InsightsPage from './InsightsPage';
import SettingsPage from './SettingsPage';
import HelpSupportPage from './HelpSupportPage';
import StaffDashboard from './StaffDashboard';
import LoginPage from './LoginPage';
import SuperAdminLogin from './SuperAdminLogin';
import SuperAdminDashboard from './SuperAdminDashboard';
import SuspensionOverlay from './SuspensionOverlay'; 
import {
  X, CheckCircle, AlertTriangle, AlertCircle,
  LayoutDashboard, Users, Layers, CreditCard,
  ClipboardCheck, BarChart3, Settings, LogOut, Dumbbell, Lock, Bell, User, LifeBuoy,
  Bot, ArrowRight, Target, Sparkles, Download // <-- 🚨 ADDED TOUR ICONS
} from 'lucide-react';

// ─── Navigation Config ────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { name: 'Dashboard',  icon: LayoutDashboard },
  { name: 'Members',    icon: Users           },
  { name: 'Plans',      icon: Layers          },
  { name: 'Payments',   icon: CreditCard      },
  { name: 'Attendance', icon: ClipboardCheck  },
  { name: 'Insights',   icon: BarChart3       },
  { name: 'Settings',   icon: Settings        },
];

const PAGE_PERMISSIONS = {
  Dashboard: null,
  Members: 'members:read',
  Plans: 'plans:read',
  Payments: 'payments:read',
  Attendance: 'attendance:read',
  Insights: 'insights:read',
  Settings: 'owner:only',
  'Help & Support': 'support:read',
};

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
      <button onClick={onRemove} className="text-white/70 hover:text-white ml-1 shrink-0 transition-colors"><X size={16} /></button>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function useConfirm() {
  const [confirmState, setConfirmState] = useState(null);
  const showConfirm = useCallback(({ title, message, onConfirm, confirmLabel, variant = 'danger' }) => {
    setConfirmState({ title, message, onConfirm, confirmLabel, variant });
  }, []);
  const hideConfirm = useCallback(() => setConfirmState(null), []);
  return { confirmState, showConfirm, hideConfirm };
}

function ConfirmModal({ confirmState, hideConfirm }) {
  if (!confirmState) return null;
  const isDanger = confirmState.variant === 'danger';
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[28px] w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="p-8 text-center">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 mx-auto ${isDanger ? 'bg-rose-100 text-rose-500' : 'bg-amber-100 text-amber-500'}`}>
            <AlertTriangle size={28} />
          </div>
          <h3 className="text-xl font-black text-slate-900 mb-2">{confirmState.title}</h3>
          <p className="text-sm font-semibold text-slate-500 leading-relaxed">{confirmState.message}</p>
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ exiting }) {
  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-all duration-700 ease-in-out ${exiting ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}`}
      style={{ background: 'linear-gradient(135deg, #0b0c1e 0%, #151040 40%, #0e1525 100%)' }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
      </div>

      <div
        className="relative w-20 h-20 rounded-[22px] flex items-center justify-center mb-6 animate-in zoom-in-50 duration-700"
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

      <div className="w-44 h-[3px] bg-white/[0.07] rounded-full overflow-hidden animate-in fade-in duration-500 [animation-delay:400ms] [animation-fill-mode:both]">
        <div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #6366f1, #a855f7, #6366f1)',
            backgroundSize: '200% 100%',
            animation: 'splashBar 1.8s ease-out forwards, shimmerBar 1.5s linear infinite 0.3s'
          }}
        />
      </div>
      <p className="text-white/20 text-[10px] uppercase tracking-[0.2em] font-bold mt-4 animate-in fade-in duration-500 [animation-delay:500ms] [animation-fill-mode:both]">
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

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const pathname = String(window.location.pathname || '/');
  const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
  const isHQ = normalizedPathname === '/hq-admin' || normalizedPathname.startsWith('/hq-admin/');
  const [superToken, setSuperToken] = useState(localStorage.getItem('superToken'));
  
  const [currentPage, setCurrentPage] = useState('Dashboard');
  const [memberFilter, setMemberFilter] = useState('All');
  const [memberFocus, setMemberFocus] = useState({ id: null, action: null });
  const [stats, setStats] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  });
  const [isSuspended, setIsSuspended] = useState(false); 
  const [settingsTab, setSettingsTab] = useState('account'); 
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [canInstallApp, setCanInstallApp] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [isStandaloneMode, setIsStandaloneMode] = useState(false);

  // 🚨 MASTERCLASS TOUR STATE 🚨
  const [tour, setTour] = useState({ isActive: false, step: 0, isWaitingForAction: false });
  const [tourRect, setTourRect] = useState(null); // <-- NEW: Tracks element position

  const [showSplash, setShowSplash] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);

  const { toasts, toast, removeToast } = useToast();
  const { confirmState, showConfirm, hideConfirm } = useConfirm();
  const toastRef = useRef(toast);
  const dashboardFallbackNotifiedRef = useRef(false);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
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
  }, []);

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

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Wipe tour memory on logout
    localStorage.removeItem('gymvault_tour_completed');
    localStorage.removeItem('gymvault_skip_setup');

    setToken(null);
    setCurrentUser(null);
    setIsSuspended(false);
    window.history.pushState({}, '', '/login');
  }, []);

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

  useEffect(() => {
    if (isHQ) return;
    if (!token) return;
    axios.get('/api/auth/me', { headers: { 'x-auth-token': token } })
      .then((res) => {
        const user = res.data?.user;
        if (user) {
          setCurrentUser(user);
          localStorage.setItem('user', JSON.stringify(user));
        }
      })
      .catch(() => {
        if (!currentUser) handleLogout();
      });
  }, [token, isHQ]);

  useEffect(() => {
    if (isHQ) return;
    if (!token) return;
    if (canAccessPage(currentPage)) return;

    const firstAllowed = availableNavItems[0]?.name || 'Help & Support';
    setCurrentPage(firstAllowed);
  }, [currentPage, availableNavItems, canAccessPage, token, isHQ]);

  // --- NOTIFICATION STATE & LOGIC ---
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!token || isHQ || isSuspended) return;
    try {
      const res = await axios.get('/api/notifications', {
        headers: { 'x-auth-token': token }
      });
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unread_count);
    } catch (err) {
      console.error("Notifications Error:", err);
    }
  }, [token, isHQ, isSuspended]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id) => {
    try {
      await axios.put(`/api/notifications/${id}/read`, {}, {
        headers: { 'x-auth-token': token }
      });
      fetchNotifications(); 
    } catch (err) {
      console.error("Mark Read Error:", err);
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
      console.error("Mark All Read Error:", err);
    }
  };


  // 🚨 REBUILT INTERCEPTOR
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const requestUrl = String(error?.config?.url || '');
        const isSuperadminRequest = requestUrl.includes('/api/superadmin');

        if (error.response && error.response.data.error === "SAAS_EXPIRED") {
          setIsSuspended(true); 
          setCurrentPage('Settings'); 
          return new Promise(() => {}); 
        }
        if (error.response && error.response.status === 401) {
          if (isHQ || isSuperadminRequest) {
            return Promise.reject(error);
          }
          const authMsg = error.response?.data?.error || error.response?.data?.message || 'Session expired. Please login again.';
          toastRef.current?.(authMsg, 'error');
          handleLogout();
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, [handleLogout, isHQ]);

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
    if (page === 'Settings') setSettingsTab(subPath);
    setCurrentPage(page);
  }, [isSuspended, canAccessPage]);

  useEffect(() => {
    if (isHQ) {
      setShowSplash(false);
      return;
    }
    const t1 = setTimeout(() => setSplashExiting(true), 1600);
    const t2 = setTimeout(() => setShowSplash(false), 2300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isHQ]);

  useEffect(() => {
    if (isHQ) return;
    if (token && window.location.pathname === '/login') {
      window.history.pushState({}, '', '/dashboard');
      setCurrentPage('Dashboard');
    }
  }, [token, isHQ]);

  const fetchDashboard = async () => {
    if (!token || isHQ || isSuspended || currentUser?.role !== 'OWNER') return;
    try {
      const res = await axios.get('/api/dashboard/stats', {
        headers: { 'x-auth-token': token }
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
    } catch (err) {
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
  };

  useEffect(() => {
    if (currentPage === 'Dashboard' && !isSuspended && currentUser?.role === 'OWNER') fetchDashboard();
  }, [currentPage, token, isHQ, isSuspended, currentUser]);

  useEffect(() => {
    if (!token || isHQ || isSuspended || currentUser?.role !== 'OWNER' || currentPage !== 'Dashboard') {
      return;
    }

    const intervalId = setInterval(() => {
      fetchDashboard();
    }, 45000);

    return () => clearInterval(intervalId);
  }, [token, isHQ, isSuspended, currentUser, currentPage]);

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

  const TOUR_STEPS = [
    { targetId: null, page: 'Dashboard', position: 'center', title: 'Welcome to GymVault ✨', desc: 'Let\'s set up your gym in a few steps. I will guide you through the exact workflow.' },
    { targetId: 'tour-dashboard-hero', page: 'Dashboard', position: 'bottom', title: 'Dashboard Overview', desc: 'This is your central command. It tracks revenue, active members, and daily check-ins in real-time.' },
    { targetId: 'nav-Members', page: 'Dashboard', position: 'right', title: 'Members Directory', desc: 'Manage your clients here. You can track their active memberships and contact details.' },
    { targetId: 'btn-add-member', page: 'Dashboard', position: 'top', title: 'Quick Actions', desc: 'Use this button anytime to instantly register a new member, record a payment, or send a WhatsApp broadcast.' },
    { targetId: 'nav-Plans', page: 'Plans', position: 'right', title: 'Membership Plans', desc: 'Before adding members, you will create Plans here (e.g., Monthly VIP for ₹2000). They dictate pricing and duration.' },
    { targetId: 'nav-Payments', page: 'Payments', position: 'right', title: 'Financial Ledger', desc: 'Every transaction is recorded safely here for your accounting.' },
    { targetId: 'nav-Settings', page: 'Settings', position: 'right', title: 'Gym Configuration', desc: 'Upload your gym logo, update your address, and configure staff access here.' },
    { targetId: null, page: 'Dashboard', position: 'center', title: 'You\'re All Set! 🚀', desc: 'Your gym setup is fully complete. You are ready to dominate. Let\'s get to work.' }
  ];

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
      return <SuperAdminLogin setSuperToken={(t) => { localStorage.setItem('superToken', t); setSuperToken(t); }} />;
    }
    return <SuperAdminDashboard token={superToken} onLogout={() => { localStorage.removeItem('superToken'); setSuperToken(null); }} />;
  }

  if (!token) {
    return <LoginPage setToken={(t, user) => { localStorage.setItem('token', t); setToken(t); if (user) { localStorage.setItem('user', JSON.stringify(user)); setCurrentUser(user); } }} />;
  }

  if (!stats && currentPage === 'Dashboard' && !isSuspended && currentUser?.role === 'OWNER') return (
    <>
      {showSplash && <SplashScreen exiting={splashExiting} />}
      <div className="h-screen flex items-center justify-center flex-col gap-4"
        style={{ background: 'radial-gradient(ellipse at 30% 30%, rgba(99,102,241,0.12) 0%, transparent 60%), #0b0f1e' }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-900/60"
          style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
          <Dumbbell size={22} className="text-white" />
        </div>
        <div className="flex gap-1.5">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="font-bold tracking-[0.25em] uppercase text-xs text-slate-500">Initializing GymVault</p>
      </div>
    </>
  );

  return (
    <>
      {isSuspended && <SuspensionOverlay onLogout={handleLogout} onRenew={() => setIsSuspended(false)} />}
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
        className="flex h-[100dvh] overflow-hidden font-['Inter'] antialiased text-slate-900"
        style={{
          background: `
            radial-gradient(ellipse at 18% 18%, rgba(99,102,241,0.09) 0%, transparent 55%),
            radial-gradient(ellipse at 82% 82%, rgba(168,85,247,0.07) 0%, transparent 55%),
            radial-gradient(ellipse at 82% 12%, rgba(59,130,246,0.05) 0%, transparent 50%),
            radial-gradient(ellipse at 12% 82%, rgba(16,185,129,0.04) 0%, transparent 50%),
            #f3f4ff
          `
        }}
      >
        <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem {...t} onRemove={() => removeToast(t.id)} />
            </div>
          ))}
        </div>

        <ConfirmModal confirmState={confirmState} hideConfirm={hideConfirm} />

        <aside
          className="w-64 p-5 hidden md:flex flex-col text-white shadow-2xl relative overflow-hidden z-10 shrink-0"
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
                Pro Dashboard
              </div>
            </div>
          </div>

          <nav className="space-y-0.5 flex-1">
            {availableNavItems.map(({ name, icon: Icon }) => {
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
                  <Icon size={16} className={isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
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

        <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
          <header className="relative z-50 h-16 flex items-center justify-between px-4 md:px-8 shrink-0 border-b bg-white/70 backdrop-blur-3xl">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-400">Home</span>
              {currentPage !== 'Dashboard' && (
                <>
                  <span className="text-slate-300 text-xs mx-0.5">/</span>
                  <span className="text-sm font-bold text-slate-800">{currentPage}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-5">
              {token && !isStandaloneMode && canInstallApp && (
                <button
                  onClick={handleInstallApp}
                  className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-black uppercase tracking-wider hover:bg-indigo-100 transition-colors"
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

             {/* PROFILE MENU */}
              <div className="relative">
                <button 
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
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
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-8">
            <div className="max-w-[1400px] mx-auto w-full">
              {/* 🚨 Passed startTour to Dashboard 🚨 */}
              {currentPage === 'Dashboard'  ? (currentUser?.role === 'OWNER'
                ? <DashboardPage token={token} setCurrentPage={setCurrentPage} toast={toast} navigateTo={navigateTo} startTour={startTour} />
                : <StaffDashboard currentUser={currentUser} navigateTo={navigateTo} canAccessPage={canAccessPage} />) :
               currentPage === 'Members'    ? <MembersPage key={`members-${memberFilter}`} token={token} toast={toast} showConfirm={showConfirm} defaultFilter={memberFilter} focusMemberId={memberFocus.id} focusAction={memberFocus.action} onFocusHandled={() => setMemberFocus({ id: null, action: null })} /> :
               currentPage === 'Plans'      ? <PlansPage token={token} toast={toast} showConfirm={showConfirm} /> :
               currentPage === 'Payments'   ? <PaymentsPage token={token} toast={toast} showConfirm={showConfirm} /> :
               currentPage === 'Attendance' ? <AttendancePage token={token} toast={toast} /> :
               currentPage === 'Insights'   ? <InsightsPage token={token} toast={toast} /> :
               currentPage === 'Settings' ? <SettingsPage toast={toast} token={token} defaultTab={settingsTab} /> :
               currentPage === 'Help & Support' ? <HelpSupportPage token={token} toast={toast} /> : null}
            </div>
          </main>
        </div>

        <nav className="fixed bottom-0 left-0 right-0 md:hidden z-[120] border-t border-slate-200/80 bg-white/95 backdrop-blur-2xl">
          <div className="flex overflow-x-auto no-scrollbar">
            {availableNavItems.map(({ name, icon: Icon }) => {
              const isActive = currentPage === name;
              const isBlocked = isSuspended && name !== 'Settings';
              return (
                <button
                  key={`mobile-${name}`}
                  onClick={() => handleSidebarNav(name)}
                  disabled={isBlocked}
                  className={`py-2.5 px-4 min-w-[88px] flex flex-col items-center justify-center gap-1 transition-colors ${
                    isActive ? 'text-indigo-600' : 'text-slate-400'
                  } ${isBlocked ? 'opacity-40' : ''}`}
                >
                  <Icon size={16} />
                  <span className="text-[10px] font-bold leading-none">{name}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </>
  );
}

export default App;