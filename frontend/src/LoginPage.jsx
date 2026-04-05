import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';
import { buildApiUrl } from './utils/apiUrl';
import {
  Dumbbell, Mail, Lock, ArrowRight, Eye, EyeOff,
  Users, TrendingUp, Layers, ChevronRight, Phone, CheckCircle,
  Copy, LocateFixed, MapPin, QrCode, RefreshCw, ScanLine, X
} from 'lucide-react';

// ─── Static left-panel stats (design elements) ────────────────────────────────
const LEFT_STATS = [
  { Icon: Users,      label: 'Active Members',  value: '2,841',     color: '#818cf8', sub: '+12 this week'          },
  { Icon: TrendingUp, label: 'Monthly Revenue',  value: '₹1,24,500', color: '#34d399', sub: 'Up 18% from last month' },
  { Icon: Layers,     label: 'Memberships Live', value: '12 Plans',  color: '#c084fc', sub: '3 launched this month'  },
];

// ─── Input styling helpers ────────────────────────────────────────────────────
const iFocus = (e) => { e.target.style.borderColor = 'rgba(99,102,241,0.7)'; e.target.style.background = 'rgba(99,102,241,0.08)'; };
const iBlur  = (e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.06)'; };
const iBase  = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };

// ─── Google SVG icon ──────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

// ─── Apple SVG icon ───────────────────────────────────────────────────────────
function AppleIcon() {
  return (
    <svg width="15" height="18" viewBox="0 0 814 1000" fill="white" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.9 0 694.5 0 604.5 0 450.9 100.9 266.7 234.4 200.71c39.9-20.1 83.5-31.4 128.7-31.4 90 0 136.4 39.5 247.2 39.5 97.4 0 156.1-39.5 243.3-39.5 30.7 0 108.4 6.5 158.5 55.7z"/>
      <path d="M449.7 156.5C478.5 117.6 500.1 63.2 500.1 8.8c0-8.1-.6-16.2-2.5-23.7-55.9 2.5-121.9 37.1-159.6 83.3-30.7 37.1-56.5 94.7-56.5 152.9 0 8.1 1.3 16.2 1.9 18.7 3.1.6 8.1 1.3 13.1 1.3 50.3 0 113.8-33.2 152.2-84.8z"/>
    </svg>
  );
}

// ─── Reusable social button ───────────────────────────────────────────────────
function SocialBtn({ icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold text-white transition-all duration-200 hover:scale-[1.015] active:scale-[0.985]"
      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
      {icon}{label}
    </button>
  );
}

function PasswordResetModal({
  open,
  step,
  email,
  setEmail,
  otp,
  setOtp,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  showNewPassword,
  setShowNewPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  loading,
  error,
  notice,
  delivery,
  onClose,
  onRequestOtp,
  onConfirmReset,
  onResendOtp,
  onCopyPreviewOtp,
}) {
  if (!open) return null;

  const isConfirmStep = step === 'confirm';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-[28px] p-6 relative"
        style={{
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(9,12,24,0.98) 100%)',
          border: '1px solid rgba(129,140,248,0.16)',
          boxShadow: '0 24px 80px rgba(2,6,23,0.55)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          aria-label="Close password reset"
        >
          <X size={16} />
        </button>

        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-300 mb-2">
          {isConfirmStep ? 'Verify OTP' : 'Forgot Password'}
        </p>
        <h3 className="text-white text-[1.45rem] font-black leading-tight pr-10">
          {isConfirmStep ? 'Reset your password' : 'Recover your account'}
        </h3>
        <p className="text-slate-400 text-sm font-medium mt-2 leading-relaxed">
          {isConfirmStep
            ? `Enter the 6-digit code prepared for ${delivery?.maskedEmail || email}, then choose a new password.`
            : 'Enter your registered email address and GymVault will prepare a reset OTP for you.'}
        </p>

        {notice && (
          <div
            className="mt-5 px-4 py-3 rounded-2xl text-sm font-semibold text-emerald-100"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)' }}
          >
            {notice}
          </div>
        )}

        {error && (
          <div
            className="mt-5 px-4 py-3 rounded-2xl text-sm font-semibold text-rose-200"
            style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.22)' }}
          >
            {error}
          </div>
        )}

        {delivery?.previewOtp && (
          <div
            className="mt-5 p-4 rounded-2xl"
            style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.22)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Preview OTP</p>
                <p className="text-white text-2xl font-black tracking-[0.3em] mt-1">{delivery.previewOtp}</p>
                <p className="text-amber-100/90 text-xs font-medium mt-2 leading-relaxed">
                  {delivery.previewNotice || 'Email delivery is not configured yet, so this preview code is shown directly.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCopyPreviewOtp}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-200 hover:text-white transition-colors shrink-0"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                aria-label="Copy preview OTP"
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
        )}

        {!isConfirmStep ? (
          <form onSubmit={onRequestOtp} className="space-y-4 mt-6">
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Registered Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@mygym.com"
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                  style={iBase}
                  onFocus={iFocus}
                  onBlur={iBlur}
                />
              </div>
            </div>

            <button
              disabled={loading}
              className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                boxShadow: loading ? 'none' : '0 8px 28px rgba(99,102,241,0.5)',
                opacity: loading ? 0.72 : 1,
              }}
            >
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Preparing...</>
                : <><span>Send OTP</span><ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={onConfirmReset} className="space-y-4 mt-6">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
              <span>Code expires in about {delivery?.expiresInMinutes || 10} minutes</span>
              <button type="button" onClick={onResendOtp} className="text-indigo-300 hover:text-indigo-200 transition-colors">
                Resend code
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">OTP Code</label>
              <div className="relative">
                <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all tracking-[0.35em]"
                  style={iBase}
                  onFocus={iFocus}
                  onBlur={iBlur}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">New Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  required
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full pl-11 pr-12 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                  style={iBase}
                  onFocus={iFocus}
                  onBlur={iBlur}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Confirm New Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  required
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat new password"
                  className="w-full pl-11 pr-12 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                  style={iBase}
                  onFocus={iFocus}
                  onBlur={iBlur}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              disabled={loading}
              className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                boxShadow: loading ? 'none' : '0 8px 28px rgba(99,102,241,0.5)',
                opacity: loading ? 0.72 : 1,
              }}
            >
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Updating...</>
                : <><span>Update Password</span><ArrowRight size={16} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Full-screen Member Portal Dashboard (shown after OTP verification) ──────
function MemberPortalDashboard({ member, token, onSignOut }) {
  const qrScannerRef = useRef(null);
  const qrScannerBusyRef = useRef(false);
  const autoGeoAttemptRef = useRef(false);
  const [attendance, setAttendance] = useState([]);
  const [loadingAtt, setLoadingAtt] = useState(true);
  const [memberQr, setMemberQr] = useState(null);
  const [memberQrLoading, setMemberQrLoading] = useState(true);
  const [memberQrModalOpen, setMemberQrModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scannerBooting, setScannerBooting] = useState(false);
  const [selfCheckinBusy, setSelfCheckinBusy] = useState(false);
  const [geoCheckinBusy, setGeoCheckinBusy] = useState(false);
  const [geoPermissionBusy, setGeoPermissionBusy] = useState(false);
  const [geoPermissionState, setGeoPermissionState] = useState('checking');
  const [attendanceOptionsLoading, setAttendanceOptionsLoading] = useState(true);
  const [attendanceOptions, setAttendanceOptions] = useState({
    gym: { id: null, name: member.gym_name || '' },
    attendance_mode: 'STAFF',
    attendance_geo_enabled: false,
    gym_radius_meters: 200,
    self_checkin_available: false,
    member_qr_available: true,
    gym_qr_available: true,
  });
  const [portalNotice, setPortalNotice] = useState(null);

  const memberHeaders = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);

  const loadAttendance = useCallback(async () => {
    setLoadingAtt(true);
    try {
      const res = await axios.get('/api/auth/member/attendance', memberHeaders);
      setAttendance(res.data.attendance || []);
    } catch (_err) {
      setPortalNotice((prev) => prev || { type: 'error', message: 'Could not refresh attendance history.' });
    } finally {
      setLoadingAtt(false);
    }
  }, [memberHeaders]);

  const loadMemberQr = useCallback(async () => {
    setMemberQrLoading(true);
    try {
      const res = await axios.get('/api/attendance/member/qr', memberHeaders);
      setMemberQr(res.data || null);
    } catch (_err) {
      setPortalNotice({ type: 'error', message: 'Could not load your attendance QR. Please try again.' });
    } finally {
      setMemberQrLoading(false);
    }
  }, [memberHeaders]);

  const loadAttendanceOptions = useCallback(async () => {
    setAttendanceOptionsLoading(true);
    try {
      const res = await axios.get('/api/attendance/member/options', memberHeaders);
      setAttendanceOptions((prev) => ({
        ...prev,
        ...(res.data || {}),
        gym: {
          id: res.data?.gym?.id || null,
          name: res.data?.gym?.name || member.gym_name || prev.gym?.name || '',
        },
      }));
    } catch (_err) {
      setPortalNotice((prev) => prev || { type: 'error', message: 'Could not load attendance options for this gym.' });
    } finally {
      setAttendanceOptionsLoading(false);
    }
  }, [member.gym_name, memberHeaders]);

  const submitGymQr = useCallback(async (decodedText) => {
    setSelfCheckinBusy(true);
    try {
      const res = await axios.post('/api/attendance/member/checkin/qr', { token: decodedText }, memberHeaders);
      setPortalNotice({
        type: 'success',
        message: res.data?.warning || res.data?.message || 'Self check-in recorded successfully.',
      });
      await loadAttendance();
    } catch (err) {
      const apiMessage = err?.response?.data?.message || err?.response?.data?.error || 'Self check-in failed.';
      setPortalNotice({ type: 'error', message: apiMessage });
    } finally {
      setSelfCheckinBusy(false);
    }
  }, [loadAttendance, memberHeaders]);

  const submitLocationSelfCheckin = useCallback(async ({ auto = false } = {}) => {
    if (!navigator.geolocation) {
      setGeoPermissionState('unsupported');
      if (!auto) {
        setPortalNotice({ type: 'error', message: 'Location is not supported on this device.' });
      }
      return false;
    }

    setGeoCheckinBusy(true);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 45000 }
        );
      });

      const res = await axios.post('/api/attendance/member/checkin/self', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }, memberHeaders);

      setPortalNotice({
        type: 'success',
        message: auto
          ? (res.data?.warning || 'You were checked in automatically when the app opened near the gym.')
          : (res.data?.warning || res.data?.message || 'Location self check-in successful.'),
      });
      setGeoPermissionState('granted');
      await loadAttendance();
      return true;
    } catch (err) {
      if (typeof err?.code === 'number') {
        if (err.code === 1) {
          setGeoPermissionState('denied');
        }
        const geoMessage = err.code === 1
          ? 'Location permission is required for geo self check-in.'
          : err.code === 2
            ? 'Could not detect your location right now. Move closer to the entrance and try again.'
            : 'Location request timed out. Try again while standing near the gym entrance.';
        if (!auto) {
          setPortalNotice({ type: 'error', message: geoMessage });
        }
        return false;
      }

      const apiMessage = err?.response?.data?.message || err?.response?.data?.error || 'Location self check-in failed.';
      setPortalNotice({ type: 'error', message: apiMessage });
      return false;
    } finally {
      setGeoCheckinBusy(false);
    }
  }, [loadAttendance, memberHeaders]);

  const requestLocationAccess = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeoPermissionState('unsupported');
      setPortalNotice({ type: 'error', message: 'Location is not supported on this device.' });
      return false;
    }

    setGeoPermissionBusy(true);
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });

      setGeoPermissionState('granted');
      setPortalNotice({ type: 'success', message: 'Location access enabled. Automatic and manual self check-in are now ready.' });
      return true;
    } catch (err) {
      if (typeof err?.code === 'number' && err.code === 1) {
        setGeoPermissionState('denied');
        setPortalNotice({ type: 'error', message: 'Location permission was denied. Enable it in browser settings to use geo check-in.' });
      } else {
        setPortalNotice({ type: 'error', message: 'Could not enable location access right now. Try again near the gym entrance.' });
      }
      return false;
    } finally {
      setGeoPermissionBusy(false);
    }
  }, []);

  useEffect(() => {
    loadAttendance();
    loadMemberQr();
    loadAttendanceOptions();
  }, [loadAttendance, loadAttendanceOptions, loadMemberQr]);

  useEffect(() => {
    const gymId = attendanceOptions?.gym?.id || member?.gym_id || null;
    if (!gymId || !member?.id) return undefined;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return undefined;
    if (Notification.permission === 'denied') return undefined;

    let cancelled = false;

    (async () => {
      try {
        const keyRes = await axios.get('/api/push/vapid-public-key');
        const vapidPublicKey = keyRes.data?.publicKey;
        if (!vapidPublicKey || cancelled) return;

        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (existing) {
          await axios.post('/api/push/subscribe-member', {
            ...existing.toJSON(),
            member_id: member.id,
            gym_id: gymId,
          }).catch(() => {});
          return;
        }

        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (permission !== 'granted' || cancelled) return;

        const padding = '='.repeat((4 - vapidPublicKey.length % 4) % 4);
        const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const outputArray = new Uint8Array(raw.length);
        for (let index = 0; index < raw.length; index += 1) {
          outputArray[index] = raw.charCodeAt(index);
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray,
        });

        if (!cancelled) {
          await axios.post('/api/push/subscribe-member', {
            ...subscription.toJSON(),
            member_id: member.id,
            gym_id: gymId,
          }).catch(() => {});
        }
      } catch (_err) {
        // Member push subscription should never block the portal.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attendanceOptions?.gym?.id, member?.gym_id, member?.id]);

  useEffect(() => {
    if (!navigator?.geolocation) {
      setGeoPermissionState('unsupported');
      return undefined;
    }

    if (!navigator?.permissions?.query) {
      setGeoPermissionState('prompt');
      return undefined;
    }

    let active = true;
    let permissionStatus = null;

    const applyPermissionState = () => {
      if (active && permissionStatus?.state) {
        setGeoPermissionState(permissionStatus.state);
      }
    };

    navigator.permissions.query({ name: 'geolocation' })
      .then((status) => {
        if (!active) return;
        permissionStatus = status;
        applyPermissionState();
        permissionStatus.onchange = applyPermissionState;
      })
      .catch(() => {
        if (active) {
          setGeoPermissionState('prompt');
        }
      });

    return () => {
      active = false;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!scanModalOpen) return undefined;

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
      setScannerBooting(true);
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode('member-gym-qr-reader');
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
          async (decodedText) => {
            if (qrScannerBusyRef.current) return;
            qrScannerBusyRef.current = true;
            await stopScanner();
            if (!cancelled) {
              setScannerBooting(false);
              setScanModalOpen(false);
            }
            await submitGymQr(decodedText);
            qrScannerBusyRef.current = false;
          },
          () => {}
        );

        if (!cancelled) {
          setScannerBooting(false);
        }
      } catch (_err) {
        await stopScanner();
        if (!cancelled) {
          setScannerBooting(false);
          setScanModalOpen(false);
          setPortalNotice({ type: 'error', message: 'Could not start the camera. Please check permission and try again.' });
        }
      }
    };

    bootScanner();

    return () => {
      cancelled = true;
      qrScannerBusyRef.current = false;
      setScannerBooting(false);
      stopScanner();
    };
  }, [scanModalOpen, submitGymQr]);

  const copyMemberQr = async () => {
    if (!memberQr?.token) return;
    try {
      await navigator.clipboard.writeText(memberQr.token);
      setPortalNotice({ type: 'success', message: 'Your QR token has been copied.' });
    } catch (_err) {
      setPortalNotice({ type: 'error', message: 'Could not copy your QR token.' });
    }
  };

  const formatPortalDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatPortalDate = (value) => {
    if (!value) return '—';
    const raw = typeof value === 'string' && !value.includes('T') ? `${value}T00:00:00` : value;
    const date = new Date(raw);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const toDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayStr = toDateStr(new Date());
  const todayAttendance = attendance.find((entry) => String(entry.date).slice(0, 10) === todayStr);
  const todayCheckins = Number(todayAttendance?.count || 0);
  const checkedInToday = todayCheckins > 0;
  const lastVisitLabel = attendance[0]?.date ? formatPortalDate(attendance[0].date) : 'No recent check-in';
  const availableMethods = [
    attendanceOptions.self_checkin_available ? 'Geo' : null,
    attendanceOptions.gym_qr_available ? 'Gym QR' : null,
    attendanceOptions.member_qr_available ? 'Member QR' : null,
  ].filter(Boolean);
  const geoStatusMeta = {
    unsupported: {
      label: 'Unsupported',
      tone: { background: 'rgba(148,163,184,0.14)', border: '1px solid rgba(148,163,184,0.22)', color: '#cbd5e1' },
    },
    checking: {
      label: 'Checking Device',
      tone: { background: 'rgba(129,140,248,0.14)', border: '1px solid rgba(129,140,248,0.22)', color: '#c7d2fe' },
    },
    prompt: {
      label: 'Needs Permission',
      tone: { background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.22)', color: '#fde68a' },
    },
    denied: {
      label: 'Blocked',
      tone: { background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.22)', color: '#fecaca' },
    },
    granted: {
      label: 'Auto Ready',
      tone: { background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.22)', color: '#a7f3d0' },
    },
  }[geoPermissionState] || {
    label: 'Checking Device',
    tone: { background: 'rgba(129,140,248,0.14)', border: '1px solid rgba(129,140,248,0.22)', color: '#c7d2fe' },
  };

  useEffect(() => {
    if (!attendanceOptions.self_checkin_available) return;
    if (autoGeoAttemptRef.current) return;
    if (loadingAtt) return;
    if (checkedInToday) return;
    if (!navigator?.permissions?.query) return;

    const storageKey = `gymvault:auto-self-check:${member.id}:${todayStr}`;
    try {
      if (window.localStorage.getItem(storageKey)) {
        autoGeoAttemptRef.current = true;
        return;
      }
    } catch (_err) {
      // ignore storage access errors
    }

    autoGeoAttemptRef.current = true;

    const run = async () => {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state !== 'granted') {
          return;
        }

        const success = await submitLocationSelfCheckin({ auto: true });
        if (success) {
          try {
            window.localStorage.setItem(storageKey, String(Date.now()));
          } catch (_err) {
            // ignore storage access errors
          }
        }
      } catch (_err) {
        // permissions api not available or rejected, stay manual
      }
    };

    run();
  }, [attendanceOptions.self_checkin_available, checkedInToday, loadingAtt, member.id, submitLocationSelfCheckin, todayStr]);

  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return { date: toDateStr(d), day: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.getDay()], dayNum: d.getDate() };
  });

  const attendedDates = new Set(attendance.map(a => String(a.date).slice(0, 10)));

  const daysLeft = member.membership_end
    ? Math.max(0, Math.ceil((new Date(member.membership_end) - Date.now()) / 86400000))
    : null;
  const totalDays = (member.membership_start && member.membership_end)
    ? Math.max(1, Math.ceil((new Date(member.membership_end) - new Date(member.membership_start)) / 86400000))
    : null;
  const progressPct = (totalDays && daysLeft !== null)
    ? Math.max(0, Math.min(100, Math.round(((totalDays - daysLeft) / totalDays) * 100)))
    : null;

  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthCount = attendance.filter(a => String(a.date).startsWith(currentYM)).length;

  const streak = (() => {
    let s = 0;
    const checkedToday = attendedDates.has(todayStr);
    for (let i = checkedToday ? 0 : 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (attendedDates.has(toDateStr(d))) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  const urgency = daysLeft === null ? 'gray' : daysLeft <= 7 ? 'rose' : daysLeft <= 30 ? 'amber' : 'emerald';
  const clr     = { rose: '#f87171', amber: '#fbbf24', emerald: '#34d399', gray: '#94a3b8' }[urgency];
  const expiryLabel = member.membership_end
    ? new Date(member.membership_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No active plan';

  return (
    <div className="app-min-shell-height font-['Inter'] overflow-y-auto"
      style={{ background: 'linear-gradient(160deg, #060b14 0%, #090c18 100%)' }}>

      {/* Ambient blobs */}
      <div className="fixed -top-40 -left-40 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)', filter: 'blur(90px)' }} />
      <div className="fixed bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)', filter: 'blur(90px)' }} />

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 px-5 pb-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(var(--safe-area-top) + 1rem)', background: 'rgba(6,11,20,0.88)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
            <Dumbbell size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-white font-black text-sm leading-none">GymVault</p>
            <p className="text-slate-500 text-[10px] font-semibold">Member Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-white font-bold text-sm leading-none">{member.full_name.split(' ')[0]}</p>
            <p className="text-slate-500 text-[10px]">{member.gym_name}</p>
          </div>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-black text-white"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
            {member.full_name[0].toUpperCase()}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 pb-12">

        {/* Welcome banner */}
        <div className="p-5 rounded-2xl relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(168,85,247,0.12) 100%)', border: '1px solid rgba(99,102,241,0.28)' }}>
          <div className="absolute right-0 top-0 bottom-0 w-24 opacity-10 pointer-events-none"
            style={{ background: 'radial-gradient(circle at right, white 0%, transparent 70%)' }} />
          <p className="text-indigo-300 text-[11px] font-black uppercase tracking-wider mb-1">Welcome back</p>
          <h2 className="text-white font-black text-2xl leading-tight">{member.full_name.split(' ')[0]}! 💪</h2>
          <p className="text-slate-400 text-sm font-medium mt-1">{member.gym_name}</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${member.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {member.status === 'ACTIVE' ? '● Active' : '● Inactive'}
            </span>
            {member.plan_name && (
              <span className="px-3 py-1 rounded-full text-xs font-bold text-indigo-400"
                style={{ background: 'rgba(99,102,241,0.15)' }}>
                {member.plan_name}
              </span>
            )}
          </div>
        </div>

        {/* 3-stat grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Days Left',  value: daysLeft !== null ? String(daysLeft) : '—', color: clr,       sub: 'until expiry'  },
            { label: 'This Month', value: String(thisMonthCount),                      color: '#818cf8', sub: 'check-ins'     },
            { label: 'Streak',     value: String(streak),                              color: '#34d399', sub: 'days in a row' },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="p-3.5 rounded-2xl text-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="font-black text-2xl leading-none" style={{ color }}>{value}</p>
              <p className="text-white text-[10px] font-bold mt-1">{label}</p>
              <p className="text-slate-600 text-[9px] mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Membership card */}
        {member.membership_end ? (
          <div className="p-5 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-wider">Membership Plan</p>
                <p className="text-white font-black text-xl leading-tight mt-0.5">{member.plan_name || 'Active Plan'}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-[10px] font-bold">Expires</p>
                <p className="text-white font-bold text-sm mt-0.5">{expiryLabel}</p>
              </div>
            </div>
            {progressPct !== null && (
              <>
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1.5">
                  <span>Progress</span><span>{progressPct}% used</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, #6366f1, ${clr})` }} />
                </div>
                <div className="flex justify-between text-[10px] font-medium text-slate-600 mt-1">
                  <span>Start → End</span>
                  <span style={{ color: clr }}>{daysLeft} days remaining</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-2xl text-center"
            style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}>
            <p className="text-slate-400 text-sm font-semibold">No active membership found.</p>
            <p className="text-slate-500 text-xs mt-1">Contact your gym to renew.</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="p-5 rounded-[28px] relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.94) 0%, rgba(30,41,59,0.92) 52%, rgba(67,56,202,0.25) 100%)', border: '1px solid rgba(129,140,248,0.18)' }}>
            <div className="absolute -right-12 -top-10 w-40 h-40 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.24) 0%, transparent 70%)', filter: 'blur(24px)' }} />
            <div className="absolute -left-12 bottom-0 w-32 h-32 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.16) 0%, transparent 70%)', filter: 'blur(20px)' }} />

            <div className="relative z-10 flex items-start justify-between gap-3">
              <div>
                <p className="text-indigo-300 text-[10px] font-black uppercase tracking-[0.22em]">Check-In Hub</p>
                <h3 className="text-white font-black text-2xl leading-tight mt-1">Fast, guided attendance</h3>
                <p className="text-slate-400 text-sm font-medium mt-2 max-w-md">Use the fastest available method for your gym: geo self check-in, scan the gym QR, or show your member pass at the desk.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  loadMemberQr();
                  loadAttendanceOptions();
                }}
                disabled={memberQrLoading || attendanceOptionsLoading}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-60 shrink-0"
                style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(129,140,248,0.24)' }}
              >
                <RefreshCw size={15} className={memberQrLoading || attendanceOptionsLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 relative z-10">
              <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Today</p>
                <p className="text-white font-black text-lg mt-1">{checkedInToday ? 'Checked In' : 'Ready'}</p>
                <p className="text-slate-400 text-[11px] font-semibold mt-1">{checkedInToday ? `${todayCheckins} mark${todayCheckins !== 1 ? 's' : ''} today` : 'No attendance mark yet'}</p>
              </div>
              <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Location</p>
                <p className="text-white font-black text-lg mt-1">{attendanceOptions.self_checkin_available ? `${attendanceOptions.gym_radius_meters || 200}m` : 'Off'}</p>
                <p className="text-slate-400 text-[11px] font-semibold mt-1">{attendanceOptions.self_checkin_available ? 'Geo radius active' : 'Geo self check-in disabled'}</p>
              </div>
              <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Methods</p>
                <p className="text-white font-black text-lg mt-1">{availableMethods.length}</p>
                <p className="text-slate-400 text-[11px] font-semibold mt-1">{availableMethods.join(' • ') || 'Staff only'}</p>
              </div>
              <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Last Visit</p>
                <p className="text-white font-black text-lg mt-1">{lastVisitLabel === 'No recent check-in' ? '—' : lastVisitLabel}</p>
                <p className="text-slate-400 text-[11px] font-semibold mt-1">{lastVisitLabel === 'No recent check-in' ? 'No attendance in last 30 days' : 'Recent attendance found'}</p>
              </div>
            </div>
          </div>

          {portalNotice && (
            <div
              className="p-3.5 rounded-2xl text-sm font-semibold"
              style={{
                background: portalNotice.type === 'success' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.1)',
                border: portalNotice.type === 'success' ? '1px solid rgba(52,211,153,0.22)' : '1px solid rgba(248,113,113,0.18)',
                color: portalNotice.type === 'success' ? '#6ee7b7' : '#fca5a5',
              }}>
              {portalNotice.message}
            </div>
          )}

          <div className="space-y-3">
            <div className="p-5 rounded-[28px]"
              style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.18)' }}>
                    <LocateFixed size={18} className="text-emerald-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-black text-base">Geo Radius Self Check-In</p>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                        style={geoStatusMeta.tone}>
                        {geoStatusMeta.label}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm font-medium mt-1">Open the app near the gym entrance and use location-based check-in. If permission is already granted, the app can auto-attempt once when opened.</p>
                  </div>
                </div>
                {checkedInToday ? (
                  <span className="px-3 py-1.5 rounded-full text-[11px] font-black text-emerald-300 shrink-0"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.18)' }}>
                    <span className="inline-flex items-center gap-1"><CheckCircle size={12} /> Checked today</span>
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 text-[11px] font-semibold text-slate-400">
                <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-slate-500 block mb-1">Gym Radius</span>
                  <span className="text-white font-black">{attendanceOptions.self_checkin_available ? `${attendanceOptions.gym_radius_meters || 200} meters` : 'Not configured yet'}</span>
                </div>
                <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-slate-500 block mb-1">Location Access</span>
                  <span className="text-white font-black">{geoPermissionState === 'granted' ? 'Allowed on this device' : geoPermissionState === 'denied' ? 'Blocked in browser' : geoPermissionState === 'unsupported' ? 'Not supported' : 'Needs confirmation'}</span>
                </div>
                <div className="p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-slate-500 block mb-1">Gate Protection</span>
                  <span className="text-white font-black">Expired or unpaid entries still alert staff instantly</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                <button
                  type="button"
                  onClick={requestLocationAccess}
                  disabled={geoPermissionBusy || geoPermissionState === 'unsupported'}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <MapPin size={16} /> {geoPermissionBusy ? 'Enabling...' : geoPermissionState === 'granted' ? 'Location Enabled' : 'Enable Location'}
                </button>
                <button
                  type="button"
                  onClick={() => submitLocationSelfCheckin({ auto: false })}
                  disabled={!attendanceOptions.self_checkin_available || geoCheckinBusy || selfCheckinBusy || geoPermissionBusy}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #10b981, #14b8a6)' }}>
                  <LocateFixed size={16} /> {geoCheckinBusy ? 'Checking location...' : 'Check In Now'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-5 rounded-[28px]"
                style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <ScanLine size={18} className="text-indigo-300" />
                  </div>
                  <div>
                    <p className="text-white font-black text-base">Scan Gym QR</p>
                    <p className="text-slate-400 text-sm font-medium mt-1">Best for front-desk kiosks or a wall-mounted gym QR. Open the scanner and point your camera at the gym code.</p>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-2xl text-[11px] font-semibold text-slate-400"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  Works even when geo radius is disabled. The server still validates your membership before attendance is recorded.
                </div>

                <button
                  type="button"
                  onClick={() => setScanModalOpen(true)}
                  disabled={selfCheckinBusy || geoCheckinBusy}
                  className="w-full mt-4 flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                  <ScanLine size={16} /> {selfCheckinBusy ? 'Waiting...' : 'Open QR Scanner'}
                </button>
              </div>

              <div className="p-5 rounded-[28px]"
                style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.18)' }}>
                      <QrCode size={18} className="text-sky-300" />
                    </div>
                    <div>
                      <p className="text-white font-black text-base">Member Pass</p>
                      <p className="text-slate-400 text-sm font-medium mt-1">Show this QR at reception for a quick desk scan when staff is checking people in.</p>
                    </div>
                  </div>
                  <div className="w-[82px] h-[82px] rounded-2xl bg-white flex items-center justify-center shrink-0 overflow-hidden">
                    {memberQr?.token ? (
                      <QRCodeCanvas value={memberQr.token} size={74} includeMargin={false} level="H" />
                    ) : (
                      <QrCode size={24} className="text-slate-300" />
                    )}
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-2xl text-[11px] font-semibold text-slate-400"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  Pass expiry: <span className="text-white font-black">{formatPortalDateTime(memberQr?.expires_at)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setMemberQrModalOpen(true)}
                    disabled={!memberQr?.token}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>
                    <QrCode size={16} /> Open Full Pass
                  </button>
                  <button
                    type="button"
                    onClick={copyMemberQr}
                    disabled={!memberQr?.token}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <Copy size={15} /> Copy Backup Token
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                {
                  step: '01',
                  title: 'Open the app near the entrance',
                  text: 'If location access is already allowed, the app can attempt geo check-in automatically when it opens.',
                },
                {
                  step: '02',
                  title: 'Use the fastest available method',
                  text: 'Tap Check In Now for geo mode, scan the gym QR, or show your member pass to the reception desk.',
                },
                {
                  step: '03',
                  title: 'Protection stays active',
                  text: 'Expired, unpaid, or outside-radius attempts are blocked and flagged to gym staff immediately.',
                },
              ].map((item) => (
                <div key={item.step} className="p-4 rounded-[24px]"
                  style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <p className="text-indigo-300 text-[10px] font-black uppercase tracking-[0.22em]">Step {item.step}</p>
                  <p className="text-white font-black text-sm mt-2">{item.title}</p>
                  <p className="text-slate-500 text-xs font-medium mt-2 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 14-day attendance grid */}
        <div className="p-5 rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white font-black text-sm">Last 14 Days</p>
            {loadingAtt && (
              <div className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            )}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {last14.map(({ date, day, dayNum }) => {
              const checked = attendedDates.has(date);
              const isToday = date === todayStr;
              return (
                <div key={date} className="flex flex-col items-center gap-1">
                  <p className="text-slate-600 text-[9px] font-bold">{day}</p>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black"
                    style={{
                      background: checked  ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                                 : isToday ? 'rgba(99,102,241,0.15)'
                                 :           'rgba(255,255,255,0.04)',
                      border:    checked  ? 'none'
                                 : isToday ? '1.5px solid rgba(99,102,241,0.5)'
                                 :           '1px solid rgba(255,255,255,0.07)',
                      color:     checked  ? 'white'
                                 : isToday ? '#818cf8'
                                 :           'rgba(255,255,255,0.2)',
                    }}>
                    {checked ? '✓' : dayNum}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 justify-end">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }} />
              <span className="text-slate-500 text-[10px] font-semibold">Checked in</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
              <span className="text-slate-500 text-[10px] font-semibold">Missed</span>
            </div>
          </div>
        </div>

        {/* Motivational message */}
        {thisMonthCount > 0 && (
          <div className="p-4 rounded-2xl text-center"
            style={{ background: 'linear-gradient(135deg, rgba(52,211,153,0.08), rgba(99,102,241,0.08))', border: '1px solid rgba(52,211,153,0.15)' }}>
            <p className="text-emerald-400 font-black text-sm">
              {thisMonthCount >= 20 ? "🔥 You're crushing it this month!"
               : thisMonthCount >= 12 ? '💪 Great consistency this month!'
               : thisMonthCount >= 5  ? '⚡ Keep that momentum going!'
               :                        '🌟 Every session counts. Keep going!'}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              {thisMonthCount} check-in{thisMonthCount !== 1 ? 's' : ''} this month
            </p>
          </div>
        )}

        {/* Sign out */}
        <button type="button" onClick={onSignOut}
          className="w-full py-3.5 rounded-xl text-slate-500 hover:text-slate-300 text-xs font-bold uppercase tracking-widest transition-colors mt-2"
          style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          Sign Out
        </button>
      </div>

      {memberQrModalOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md px-4 py-6 flex items-center justify-center">
          <div className="w-full max-w-md rounded-[30px] p-5"
            style={{ background: 'linear-gradient(170deg, #0c1120 0%, #090c18 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-sky-300 text-[10px] font-black uppercase tracking-[0.24em]">Member Pass</p>
                <h3 className="text-white font-black text-2xl mt-1">Show this at reception</h3>
                <p className="text-slate-500 text-xs font-medium mt-1">Staff can scan this pass directly from your phone screen to record attendance fast.</p>
              </div>
              <button
                type="button"
                onClick={() => setMemberQrModalOpen(false)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="rounded-[28px] p-5"
              style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(241,245,249,0.96) 100%)' }}>
              <div className="flex justify-center">
                {memberQr?.token ? (
                  <QRCodeCanvas value={memberQr.token} size={248} includeMargin level="H" />
                ) : (
                  <div className="h-[248px] w-[248px] rounded-[24px] flex items-center justify-center bg-slate-100 text-slate-400 text-sm font-bold">
                    QR unavailable
                  </div>
                )}
              </div>

              <div className="mt-4 p-3 rounded-2xl"
                style={{ background: 'rgba(15,23,42,0.05)', border: '1px solid rgba(148,163,184,0.16)' }}>
                <p className="text-slate-900 font-black text-sm">{member.full_name}</p>
                <p className="text-slate-500 text-xs font-semibold mt-1">{member.plan_name || 'Active member'} · {member.gym_name}</p>
                <p className="text-slate-400 text-[11px] font-semibold mt-2">Pass expiry: {formatPortalDateTime(memberQr?.expires_at)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={loadMemberQr}
                disabled={memberQrLoading}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <RefreshCw size={15} className={memberQrLoading ? 'animate-spin' : ''} /> Refresh Pass
              </button>
              <button
                type="button"
                onClick={copyMemberQr}
                disabled={!memberQr?.token}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl text-sm font-black text-white transition-all duration-200 active:scale-[0.985] disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>
                <Copy size={15} /> Copy Backup Token
              </button>
            </div>
          </div>
        </div>
      )}

      {scanModalOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md px-4 py-6 flex items-center justify-center">
          <div className="w-full max-w-md rounded-[28px] p-5"
            style={{ background: 'linear-gradient(170deg, #0c1120 0%, #090c18 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-indigo-300 text-[10px] font-black uppercase tracking-wider">Self Check-In</p>
                <h3 className="text-white font-black text-xl mt-1">Scan Gym QR</h3>
                <p className="text-slate-500 text-xs font-medium mt-1">Point your camera at the QR displayed by the gym to mark today’s attendance.</p>
              </div>
              <button
                type="button"
                onClick={() => setScanModalOpen(false)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="rounded-[24px] overflow-hidden"
              style={{ background: '#020617', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div id="member-gym-qr-reader" className="min-h-[320px]" />
            </div>

            <div className="mt-4 p-3 rounded-2xl"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.16)' }}>
              <p className="text-white text-sm font-black">Attendance rules stay enforced</p>
              <p className="text-slate-400 text-xs font-medium mt-1">The server still checks membership status and duplicate windows before accepting the scan.</p>
            </div>

            {scannerBooting ? <p className="mt-3 text-xs font-bold text-slate-500">Starting camera...</p> : null}
            {selfCheckinBusy ? <p className="mt-2 text-xs font-bold text-indigo-300">Recording check-in...</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main LoginPage ───────────────────────────────────────────────────────────
export default function LoginPage({ setToken, onShowSignup }) {
  const [tab, setTab]               = useState('OWNER'); // 'OWNER' | 'MEMBER'
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPwd, setShowPwd]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [notice, setNotice]         = useState('');
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(null);
  const [adminEmailOtpEnabled, setAdminEmailOtpEnabled] = useState(true);
  const [adminEmailOtpMode, setAdminEmailOtpMode] = useState('preview');
  const [adminPhoneOtpEnabled, setAdminPhoneOtpEnabled] = useState(true);
  const [adminPhoneOtpMode, setAdminPhoneOtpMode] = useState('preview');
  const [adminLoginMethod, setAdminLoginMethod] = useState('PASSWORD');
  const [adminOtpEmail, setAdminOtpEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminLoginOtp, setAdminLoginOtp] = useState('');
  const [adminOtpSent, setAdminOtpSent] = useState(false);
  const [adminOtpLoading, setAdminOtpLoading] = useState(false);
  const [adminOtpDelivery, setAdminOtpDelivery] = useState(null);
  const [showForgotEmailHint, setShowForgotEmailHint] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetStep, setPasswordResetStep] = useState('request');
  const [passwordResetEmail, setPasswordResetEmail] = useState('');
  const [passwordResetOtp, setPasswordResetOtp] = useState('');
  const [passwordResetNewPassword, setPasswordResetNewPassword] = useState('');
  const [passwordResetConfirmPassword, setPasswordResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState('');
  const [passwordResetNotice, setPasswordResetNotice] = useState('');
  const [passwordResetDelivery, setPasswordResetDelivery] = useState(null);

  // Member portal state
  const [phone, setPhone]           = useState('');
  const [otp, setOtp]               = useState('');
  const [otpSent, setOtpSent]       = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [firstName, setFirstName]   = useState('');
  const [memberData, setMemberData] = useState(null);
  const [memberToken, setMemberToken] = useState(null);
  const isValidAdminOtpEmail = /^\S+@\S+\.\S+$/;

  useEffect(() => {
    let cancelled = false;

    axios.get('/api/auth/config')
      .then((res) => {
        if (!cancelled) {
          setGoogleAuthEnabled(Boolean(res.data?.google_auth_enabled));
          setAdminEmailOtpEnabled(Boolean(res.data?.admin_email_otp_enabled ?? true));
          setAdminEmailOtpMode(String(res.data?.admin_email_otp_mode || 'preview'));
          setAdminPhoneOtpEnabled(Boolean(res.data?.admin_phone_otp_enabled ?? true));
          setAdminPhoneOtpMode(String(res.data?.admin_phone_otp_mode || 'preview'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleAuthEnabled(null);
          setAdminEmailOtpEnabled(true);
          setAdminEmailOtpMode('preview');
          setAdminPhoneOtpEnabled(true);
          setAdminPhoneOtpMode('preview');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Read auth_error from OAuth redirect URL param
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const errCode = params.get('auth_error');
    if (!errCode) return;
    const msgs = {
      google_not_configured: 'Google Sign-In is not set up on this server. Use email & password.',
      google_cancelled:      'Google sign-in was cancelled.',
      google_token_failed:   'Google sign-in failed. Please try again.',
      google_profile_failed: 'Google sign-in could not read your Google profile. Please try again.',
      google_signup_required:'This Google account is not registered yet. Sign up with Google first.',
      google_use_email_login:'This email is registered with email and password. Use email sign-in instead.',
      account_suspended:     'Your account is suspended. Contact GymVault HQ.',
      server_error:          'A server error occurred. Please try again.',
    };
    setError(msgs[errCode] || 'Sign-in failed. Please try again.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const resetPasswordRecoveryState = () => {
    setPasswordResetStep('request');
    setPasswordResetEmail('');
    setPasswordResetOtp('');
    setPasswordResetNewPassword('');
    setPasswordResetConfirmPassword('');
    setShowResetPassword(false);
    setShowResetConfirmPassword(false);
    setPasswordResetLoading(false);
    setPasswordResetError('');
    setPasswordResetNotice('');
    setPasswordResetDelivery(null);
  };

  const closePasswordReset = () => {
    setPasswordResetOpen(false);
    resetPasswordRecoveryState();
  };

  const resetAdminOtpState = () => {
    setAdminOtpEmail('');
    setAdminPhone('');
    setAdminLoginOtp('');
    setAdminOtpSent(false);
    setAdminOtpLoading(false);
    setAdminOtpDelivery(null);
  };

  const openPasswordReset = () => {
    resetPasswordRecoveryState();
    setPasswordResetEmail(String(email || '').trim().toLowerCase());
    setPasswordResetOpen(true);
    setShowForgotEmailHint(false);
    setError('');
    setNotice('');
  };

  // ── Owner email login ──────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try {
      const res = await axios.post('/api/auth/login', { email, password });
      setToken(res.data.token, res.data.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) {
      const status   = err?.response?.status;
      const retry    = err?.response?.data?.retry_after_seconds;
      const apiMsg   = err?.response?.data?.message || err?.response?.data?.error;
      if (!err?.response) { setError('Cannot connect to server. Please try again.'); return; }
      if (status === 429) { setError(retry ? `Too many attempts. Wait ${retry}s.` : (apiMsg || 'Too many attempts.')); }
      else { setError(apiMsg || 'Invalid credentials. Please try again.'); }
    } finally { setLoading(false); }
  };

  const handleAdminSendEmailOtp = async (event) => {
    event?.preventDefault?.();
    const normalizedEmail = String(adminOtpEmail || '').trim().toLowerCase();

    if (!isValidAdminOtpEmail.test(normalizedEmail)) {
      setError('Enter the email address registered on your owner or staff account.');
      return;
    }

    setAdminOtpLoading(true);
    setError('');
    setNotice('');

    try {
      const res = await axios.post('/api/auth/admin/send-email-otp', { email: normalizedEmail });
      setAdminOtpEmail(normalizedEmail);
      setAdminOtpSent(true);
      setAdminOtpDelivery({
        mode: String(res.data?.delivery_mode || adminEmailOtpMode || 'preview'),
        maskedEmail: res.data?.masked_email || normalizedEmail,
        expiresInMinutes: res.data?.expires_in_minutes || 10,
        previewOtp: res.data?.preview_otp || '',
        previewNotice: res.data?.preview_notice || '',
        userName: res.data?.user_name || '',
      });
      if (res.data?.preview_otp) {
        setAdminLoginOtp(String(res.data.preview_otp));
      }
      setNotice(res.data?.message || 'Email OTP prepared successfully.');
    } catch (err) {
      const retry = err?.response?.data?.retry_after_seconds;
      const apiMessage = err?.response?.data?.message || err?.response?.data?.error || 'Failed to send login code.';
      setError(retry ? `Please wait ${retry}s before requesting another OTP.` : apiMessage);
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleAdminSendOtp = async (event) => {
    event?.preventDefault?.();
    const normalizedPhone = String(adminPhone || '').replace(/\D/g, '').slice(0, 10);

    if (normalizedPhone.length !== 10) {
      setError('Enter the 10-digit mobile number registered on your owner or staff account.');
      return;
    }

    setAdminOtpLoading(true);
    setError('');
    setNotice('');

    try {
      const res = await axios.post('/api/auth/admin/send-otp', { phone: normalizedPhone });
      setAdminPhone(normalizedPhone);
      setAdminOtpSent(true);
      setAdminOtpDelivery({
        mode: String(res.data?.delivery_mode || adminPhoneOtpMode || 'preview'),
        maskedPhone: res.data?.masked_phone || normalizedPhone,
        expiresInMinutes: res.data?.expires_in_minutes || 10,
        previewOtp: res.data?.preview_otp || '',
        previewNotice: res.data?.preview_notice || '',
        userName: res.data?.user_name || '',
      });
      if (res.data?.preview_otp) {
        setAdminLoginOtp(String(res.data.preview_otp));
      }
      setNotice(res.data?.message || 'OTP prepared successfully.');
    } catch (err) {
      const retry = err?.response?.data?.retry_after_seconds;
      const apiMessage = err?.response?.data?.message || err?.response?.data?.error || 'Failed to send owner login OTP.';
      setError(retry ? `Please wait ${retry}s before requesting another OTP.` : apiMessage);
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleAdminVerifyEmailOtp = async (event) => {
    event?.preventDefault?.();
    const normalizedEmail = String(adminOtpEmail || '').trim().toLowerCase();
    const normalizedOtp = String(adminLoginOtp || '').replace(/\D/g, '').slice(0, 6);

    if (!isValidAdminOtpEmail.test(normalizedEmail)) {
      setError('Enter the email address registered on your account.');
      return;
    }
    if (normalizedOtp.length !== 6) {
      setError('Enter the 6-digit OTP.');
      return;
    }

    setAdminOtpLoading(true);
    setError('');
    setNotice('');

    try {
      const res = await axios.post('/api/auth/admin/verify-email-otp', { email: normalizedEmail, otp: normalizedOtp });
      resetAdminOtpState();
      setToken(res.data.token, res.data.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Invalid OTP. Please try again.');
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleAdminVerifyOtp = async (event) => {
    event?.preventDefault?.();
    const normalizedPhone = String(adminPhone || '').replace(/\D/g, '').slice(0, 10);
    const normalizedOtp = String(adminLoginOtp || '').replace(/\D/g, '').slice(0, 6);

    if (normalizedPhone.length !== 10) {
      setError('Enter the 10-digit mobile number registered on your account.');
      return;
    }
    if (normalizedOtp.length !== 6) {
      setError('Enter the 6-digit OTP.');
      return;
    }

    setAdminOtpLoading(true);
    setError('');
    setNotice('');

    try {
      const res = await axios.post('/api/auth/admin/verify-otp', { phone: normalizedPhone, otp: normalizedOtp });
      resetAdminOtpState();
      setToken(res.data.token, res.data.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Invalid OTP. Please try again.');
    } finally {
      setAdminOtpLoading(false);
    }
  };

  const handleGoogle = () => {
    setNotice('');
    if (googleAuthEnabled === false) {
      setError('Google Sign-In is not set up on this server. Use email & password.');
      return;
    }

    window.location.href = buildApiUrl('/api/auth/google?mode=login');
  };

  const handleApple = () => {
    setNotice('');
    if (!window.AppleID) {
      setError('Apple Sign-In is not configured. Use email or Google instead.');
      return;
    }
    window.AppleID.auth.signIn()
      .then(async (resp) => {
        const id_token = resp?.authorization?.id_token;
        const name     = [resp?.user?.name?.firstName, resp?.user?.name?.lastName].filter(Boolean).join(' ');
        try {
          const res = await axios.post('/api/auth/apple', { id_token, full_name: name });
          setToken(res.data.token, res.data.user);
          window.history.pushState({}, '', '/dashboard');
        } catch (err) { setError(err?.response?.data?.message || 'Apple Sign-In failed.'); }
      })
      .catch((err) => { if (err?.error !== 'popup_closed_by_user') setError('Apple Sign-In failed. Please try again.'); });
  };

  // ── Member OTP ─────────────────────────────────────────────────────────────
  const handleSendOTP = async (e) => {
    e.preventDefault();
    setOtpLoading(true); setError(''); setNotice('');
    try {
      const res = await axios.post('/api/auth/member/send-otp', { phone });
      setFirstName(res.data.member_name || '');
      // Bypass mode: backend returned OTP directly — auto-verify immediately
      if (res.data.dev_otp) {
        const verifyRes = await axios.post('/api/auth/member/verify-otp', { phone, otp: res.data.dev_otp });
        setMemberData(verifyRes.data.member);
        setMemberToken(verifyRes.data.token);
        return;
      }
      setOtpSent(true);
    } catch (err) { setError(err?.response?.data?.message || 'Failed to send OTP.'); }
    finally { setOtpLoading(false); }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setOtpLoading(true); setError(''); setNotice('');
    try {
      const res = await axios.post('/api/auth/member/verify-otp', { phone, otp });
      setMemberData(res.data.member);
      setMemberToken(res.data.token);
    } catch (err) { setError(err?.response?.data?.message || 'Invalid OTP. Please try again.'); }
    finally { setOtpLoading(false); }
  };

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();
    const normalizedEmail = String(passwordResetEmail || '').trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setPasswordResetError('Please enter a valid email address.');
      return;
    }

    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetNotice('');

    try {
      const res = await axios.post('/api/auth/password-reset/request', { email: normalizedEmail });
      setPasswordResetEmail(normalizedEmail);
      setPasswordResetStep('confirm');
      setPasswordResetDelivery({
        channel: res.data?.delivery_channel || 'preview',
        maskedEmail: res.data?.masked_email || normalizedEmail,
        expiresInMinutes: res.data?.expires_in_minutes || 10,
        previewOtp: res.data?.preview_otp || '',
        previewNotice: res.data?.preview_notice || '',
      });
      setPasswordResetNotice(res.data?.message || 'A reset code is ready.');
    } catch (err) {
      const retry = err?.response?.data?.retry_after_seconds;
      const apiMessage = err?.response?.data?.message || err?.response?.data?.error || 'Could not start password recovery.';
      setPasswordResetError(retry ? `Please wait ${retry}s before requesting another code.` : apiMessage);
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const handlePasswordResetConfirm = async (e) => {
    e.preventDefault();

    if (passwordResetNewPassword.length < 8) {
      setPasswordResetError('New password must be at least 8 characters.');
      return;
    }
    if (passwordResetNewPassword !== passwordResetConfirmPassword) {
      setPasswordResetError('New passwords do not match.');
      return;
    }

    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetNotice('');

    try {
      const res = await axios.post('/api/auth/password-reset/confirm', {
        email: passwordResetEmail,
        otp: passwordResetOtp,
        new_password: passwordResetNewPassword,
      });
      setEmail(passwordResetEmail);
      setPassword('');
      closePasswordReset();
      setNotice(res.data?.message || 'Password updated successfully. Sign in with your new password.');
    } catch (err) {
      setPasswordResetError(err?.response?.data?.message || err?.response?.data?.error || 'Could not reset password.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const handleCopyPreviewOtp = async () => {
    if (!passwordResetDelivery?.previewOtp) return;

    try {
      await navigator.clipboard.writeText(passwordResetDelivery.previewOtp);
      setPasswordResetNotice('Preview OTP copied.');
      setPasswordResetError('');
    } catch (_err) {
      setPasswordResetError('Could not copy the preview OTP.');
    }
  };

  const handleCopyAdminPreviewOtp = async () => {
    if (!adminOtpDelivery?.previewOtp) return;

    try {
      await navigator.clipboard.writeText(adminOtpDelivery.previewOtp);
      setNotice('Preview owner OTP copied.');
      setError('');
    } catch (_err) {
      setError('Could not copy the preview OTP.');
    }
  };

  const switchTab = (t) => {
    setTab(t);
    setError('');
    setNotice('');
    setOtpSent(false);
    setOtp('');
    setMemberData(null);
    setMemberToken(null);
    setShowForgotEmailHint(false);
    setPasswordResetOpen(false);
    resetPasswordRecoveryState();
    resetAdminOtpState();
  };

  // Full-screen member portal — takes over the entire page after OTP verification
  if (tab === 'MEMBER' && memberData && memberToken) {
    return (
      <MemberPortalDashboard
        member={memberData}
        token={memberToken}
        onSignOut={() => { setMemberData(null); setMemberToken(null); setPhone(''); setOtp(''); setOtpSent(false); setError(''); }}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-min-shell-height flex font-['Inter'] overflow-hidden" style={{ background: '#060b14' }}>

      {/* ════════════════════ LEFT PANEL — desktop only ═══════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[52%] xl:w-[55%] flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(148deg, #080d1f 0%, #0e0821 50%, #14092a 100%)' }}
      >
        {/* Ambient blobs */}
        <div className="absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 65%)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 right-0 w-[440px] h-[440px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.22) 0%, transparent 65%)', filter: 'blur(90px)' }} />
        <div className="absolute top-[55%] left-[38%] w-[320px] h-[320px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 65%)', filter: 'blur(80px)' }} />

        {/* Dot-grid texture */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />

        <div className="relative z-10 flex flex-col h-full p-12 xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 24px rgba(99,102,241,0.55)' }}>
              <Dumbbell size={20} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-white font-black text-xl tracking-tight">GymVault</span>
          </div>

          {/* Headline block */}
          <div className="flex-1 flex flex-col justify-center mt-8">
            <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.24em] mb-5">
              Premium Gym Management
            </p>
            <h1 className="text-4xl xl:text-[2.8rem] font-black text-white leading-[1.12] mb-6">
              Every Rep.<br />
              Every Member.<br />
              <span style={{ background: 'linear-gradient(90deg, #818cf8 0%, #c084fc 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Every Rupee.
              </span>
            </h1>
            <p className="text-slate-400 text-[0.88rem] leading-relaxed max-w-[22rem]">
              The all-in-one platform trusted by gym owners across India. Track members, collect payments, and grow your business effortlessly.
            </p>

            {/* Floating stat cards */}
            <div className="mt-10 space-y-3">
              {LEFT_STATS.map((item, i) => {
                const StatIcon = item.Icon;

                return (
                  <div key={i}
                    className="flex items-center gap-4 p-4 rounded-2xl gv-auth-stat-card"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      animationDelay: `${i * 0.12}s`,
                    }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${item.color}18`, border: `1px solid ${item.color}28` }}>
                      <StatIcon size={17} style={{ color: item.color }} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-500 text-[11px] font-semibold mb-0.5">{item.label}</p>
                      <p className="text-white font-black text-[1.05rem] leading-none">{item.value}</p>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
                      style={{ background: `${item.color}14`, color: item.color }}>
                      {item.sub}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-slate-700 text-[11px] font-medium mt-8">
            © 2026 GymVault · Trusted by 1,000+ gyms across India
          </p>
        </div>
      </div>

      {/* ════════════════════ RIGHT PANEL — Form ════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col items-center justify-start lg:justify-center p-5 desktop:p-12 overflow-y-auto"
        style={{
          background: 'linear-gradient(170deg, #0c1120 0%, #090c18 100%)',
          paddingTop: 'max(1rem, var(--safe-area-top))',
          paddingBottom: 'max(1rem, var(--safe-area-bottom))',
        }}
      >
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 6px 20px rgba(99,102,241,0.5)' }}>
            <Dumbbell size={18} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-black text-lg tracking-tight">GymVault</span>
        </div>

        <div className="w-full max-w-[390px] flex min-h-full flex-col lg:min-h-0 lg:justify-center">

          {/* Page title */}
          <div className="mb-7">
            <h2 className="text-[1.7rem] font-black text-white leading-tight">
              {memberData ? `Hi, ${memberData.full_name.split(' ')[0]}!` : 'Welcome back'}
            </h2>
            <p className="text-slate-400 text-sm font-medium mt-1.5">
              {memberData         ? 'Your GymVault membership portal'
               : tab === 'OWNER' ? 'Sign in to manage your gym'
                                 : 'View your membership status'}
            </p>
          </div>

          {/* Tab Toggle */}
          {!memberData && (
            <div className="flex p-1 rounded-[18px] mb-7 relative overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="absolute top-1 bottom-1 rounded-[14px] transition-all duration-300 pointer-events-none"
                style={{
                  left: tab === 'OWNER' ? '4px' : 'calc(50%)',
                  width: 'calc(50% - 4px)',
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  boxShadow: '0 4px 14px rgba(99,102,241,0.45)',
                }} />
              {(['OWNER', 'MEMBER']).map((t) => (
                <button key={t} type="button" onClick={() => switchTab(t)}
                  className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest relative z-10 rounded-[14px] transition-all duration-200 ${tab === t ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                  {t === 'OWNER' ? 'Admin / Staff' : 'Gym Member'}
                </button>
              ))}
            </div>
          )}

          {notice && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm font-semibold text-emerald-100 gv-fade-in"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
              {notice}
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm font-semibold text-rose-300 gv-fade-in"
              style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}>
              {error}
            </div>
          )}

          {/* Animated tab content */}
          <div key={tab} className="gv-fade-in">

          {/* ════════ OWNER FORM ════════ */}
          {tab === 'OWNER' && (
            <>
              <div className="space-y-2.5 mb-6">
                <SocialBtn icon={<GoogleIcon />} label="Continue with Google" onClick={handleGoogle} />
                <SocialBtn icon={<AppleIcon />}  label="Continue with Apple"  onClick={handleApple}  />
              </div>

              {(adminEmailOtpEnabled || adminPhoneOtpEnabled) && (
                <div
                  className={`mb-6 p-1.5 rounded-2xl grid ${adminEmailOtpEnabled && adminPhoneOtpEnabled ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAdminLoginMethod('PASSWORD');
                      setError('');
                      setNotice('');
                      setShowForgotEmailHint(false);
                      resetAdminOtpState();
                    }}
                    className="py-2.5 rounded-xl text-xs font-black uppercase tracking-[0.16em] transition-all"
                    style={{
                      background: adminLoginMethod === 'PASSWORD' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
                      color: adminLoginMethod === 'PASSWORD' ? '#fff' : '#94a3b8',
                      boxShadow: adminLoginMethod === 'PASSWORD' ? '0 8px 24px rgba(99,102,241,0.22)' : 'none',
                    }}
                  >
                    Email Password
                  </button>
                  {adminEmailOtpEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdminLoginMethod('EMAIL_OTP');
                        setError('');
                        setNotice('');
                        setShowForgotEmailHint(false);
                        closePasswordReset();
                      }}
                      className="py-2.5 rounded-xl text-xs font-black uppercase tracking-[0.16em] transition-all"
                      style={{
                        background: adminLoginMethod === 'EMAIL_OTP' ? 'linear-gradient(135deg, #1d4ed8, #06b6d4)' : 'transparent',
                        color: adminLoginMethod === 'EMAIL_OTP' ? '#fff' : '#94a3b8',
                        boxShadow: adminLoginMethod === 'EMAIL_OTP' ? '0 8px 24px rgba(14,165,233,0.22)' : 'none',
                      }}
                    >
                      Email OTP
                    </button>
                  )}
                  {adminPhoneOtpEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdminLoginMethod('PHONE_OTP');
                        setError('');
                        setNotice('');
                        setShowForgotEmailHint(false);
                        closePasswordReset();
                      }}
                      className="py-2.5 rounded-xl text-xs font-black uppercase tracking-[0.16em] transition-all"
                      style={{
                        background: adminLoginMethod === 'PHONE_OTP' ? 'linear-gradient(135deg, #0f766e, #10b981)' : 'transparent',
                        color: adminLoginMethod === 'PHONE_OTP' ? '#fff' : '#94a3b8',
                        boxShadow: adminLoginMethod === 'PHONE_OTP' ? '0 8px 24px rgba(16,185,129,0.22)' : 'none',
                      }}
                    >
                      Phone OTP
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <span className="text-slate-500 text-[11px] font-bold tracking-wide">
                  {adminLoginMethod === 'PHONE_OTP'
                    ? 'or sign in with your registered mobile'
                    : adminLoginMethod === 'EMAIL_OTP'
                      ? 'or sign in with a one-time email code'
                      : 'or sign in with email'}
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              </div>

              {adminLoginMethod === 'PASSWORD' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Email Address</label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                      <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@mygym.com"
                        className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                        style={iBase} onFocus={iFocus} onBlur={iBlur} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Password</label>
                    <div className="relative">
                      <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                      <input required type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-11 pr-12 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                        style={iBase} onFocus={iFocus} onBlur={iBlur} />
                      <button type="button" onClick={() => setShowPwd((p) => !p)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
                        {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>

                  <div className="-mt-1 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={openPasswordReset}
                        className="text-indigo-300 hover:text-indigo-200 transition-colors"
                      >
                        Forgot password?
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowForgotEmailHint((value) => !value)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Forgot email?
                      </button>
                    </div>
                    {showForgotEmailHint && (
                      <div className="px-3.5 py-3 rounded-xl text-[11px] font-medium text-slate-300 leading-relaxed"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        If you originally signed up with Google or Apple, use that provider. Otherwise ask your gym owner or GymVault support to confirm the email registered on your account.
                      </div>
                    )}
                  </div>

                  <button disabled={loading}
                    className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all mt-1"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                      boxShadow: loading ? 'none' : '0 8px 28px rgba(99,102,241,0.5)',
                      opacity: loading ? 0.7 : 1,
                    }}>
                    {loading
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in...</>
                      : <><span>Sign In</span><ArrowRight size={16} /></>}
                  </button>
                </form>
              ) : !adminOtpSent ? (
                adminLoginMethod === 'EMAIL_OTP' ? (
                  <form onSubmit={handleAdminSendEmailOtp} className="space-y-4">
                    <p className="text-slate-400 text-sm font-medium mb-5 leading-relaxed">
                      Enter the owner or staff email address already registered on this account. GymVault will send a one-time login code there.
                    </p>
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Registered Email</label>
                      <div className="relative">
                        <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                        <input required type="email" value={adminOtpEmail}
                          onChange={(e) => setAdminOtpEmail(e.target.value)}
                          placeholder="owner@mygym.com"
                          className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                          style={iBase} onFocus={iFocus} onBlur={iBlur} />
                      </div>
                    </div>

                    <div className="px-3.5 py-3 rounded-xl text-[11px] font-medium leading-relaxed text-slate-300"
                      style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.16)' }}>
                      {adminEmailOtpMode === 'preview'
                        ? 'SMTP preview mode is active right now, so the OTP will appear on this screen after you request it.'
                        : 'GymVault will email the OTP to that registered address. No DLT registration is needed for this email flow.'}
                    </div>

                    <button disabled={adminOtpLoading || !isValidAdminOtpEmail.test(String(adminOtpEmail || '').trim().toLowerCase())}
                      className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)',
                        boxShadow: '0 8px 28px rgba(14,165,233,0.32)',
                        opacity: (adminOtpLoading || !isValidAdminOtpEmail.test(String(adminOtpEmail || '').trim().toLowerCase())) ? 0.65 : 1,
                      }}>
                      {adminOtpLoading
                        ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</>
                        : <>Send Email OTP <ArrowRight size={16} /></>}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleAdminSendOtp} className="space-y-4">
                    <p className="text-slate-400 text-sm font-medium mb-5 leading-relaxed">
                      Enter the owner or staff mobile number already registered on this account. GymVault will prepare a login OTP for it.
                    </p>
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Registered Mobile</label>
                      <div className="relative">
                        <Phone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                        <input required type="tel" value={adminPhone}
                          onChange={(e) => setAdminPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="9876543210"
                          className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                          style={iBase} onFocus={iFocus} onBlur={iBlur} />
                      </div>
                    </div>

                    <div className="px-3.5 py-3 rounded-xl text-[11px] font-medium leading-relaxed text-slate-300"
                      style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.14)' }}>
                      {adminPhoneOtpMode === 'preview'
                        ? 'Preview mode is active right now, so the OTP will appear on this screen after you request it.'
                        : 'The platform SMS gateway will send the OTP to that registered number.'}
                    </div>

                    <button disabled={adminOtpLoading || adminPhone.length < 10}
                      className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #0f766e, #10b981)',
                        boxShadow: '0 8px 28px rgba(16,185,129,0.32)',
                        opacity: (adminOtpLoading || adminPhone.length < 10) ? 0.65 : 1,
                      }}>
                      {adminOtpLoading
                        ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</>
                        : <>Send Owner OTP <ArrowRight size={16} /></>}
                    </button>
                  </form>
                )
              ) : (
                <form onSubmit={adminLoginMethod === 'EMAIL_OTP' ? handleAdminVerifyEmailOtp : handleAdminVerifyOtp} className="space-y-4">
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl mb-4"
                    style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}>
                    <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                    <p className="text-emerald-300 text-sm font-semibold">
                      OTP ready for {adminLoginMethod === 'EMAIL_OTP' ? (adminOtpDelivery?.maskedEmail || adminOtpEmail) : (adminOtpDelivery?.maskedPhone || adminPhone)}{adminOtpDelivery?.userName ? ` · Hi, ${adminOtpDelivery.userName}!` : ''}
                    </p>
                  </div>

                  {adminOtpDelivery?.previewOtp && (
                    <div
                      className="p-4 rounded-2xl"
                      style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.22)' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Preview Owner OTP</p>
                          <p className="text-white text-2xl font-black tracking-[0.3em] mt-1">{adminOtpDelivery.previewOtp}</p>
                          <p className="text-amber-100/90 text-xs font-medium mt-2 leading-relaxed">
                            {adminOtpDelivery.previewNotice || (adminLoginMethod === 'EMAIL_OTP'
                              ? 'Production email is not wired yet, so the OTP is shown directly here.'
                              : 'Production SMS is not wired yet, so the OTP is shown directly here.')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyAdminPreviewOtp}
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-200 hover:text-white transition-colors shrink-0"
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                          aria-label="Copy preview owner OTP"
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span>Code expires in about {adminOtpDelivery?.expiresInMinutes || 10} minutes</span>
                    <button type="button" onClick={adminLoginMethod === 'EMAIL_OTP' ? handleAdminSendEmailOtp : handleAdminSendOtp} className="text-emerald-300 hover:text-emerald-200 transition-colors">
                      Resend code
                    </button>
                  </div>

                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">6-Digit OTP</label>
                    <input required type="text" value={adminLoginOtp} maxLength={6}
                      onChange={(e) => setAdminLoginOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="● ● ● ● ● ●"
                      className="w-full px-4 py-4 rounded-xl text-white text-center text-2xl font-black tracking-[0.55em] placeholder-slate-700 outline-none transition-all"
                      style={iBase} onFocus={iFocus} onBlur={iBlur} />
                  </div>

                  <button disabled={adminOtpLoading || adminLoginOtp.length < 6}
                    className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #0f766e, #10b981)',
                      boxShadow: '0 8px 28px rgba(16,185,129,0.32)',
                      opacity: (adminOtpLoading || adminLoginOtp.length < 6) ? 0.65 : 1,
                    }}>
                    {adminOtpLoading
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</>
                      : <>Verify & Continue <ArrowRight size={16} /></>}
                  </button>
                  <button type="button" onClick={() => { resetAdminOtpState(); setError(''); setNotice(''); }}
                    className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors">
                    ← Use a different {adminLoginMethod === 'EMAIL_OTP' ? 'email' : 'number'}
                  </button>
                </form>
              )}

              <div className="text-center mt-6">
                <button type="button" onClick={onShowSignup}
                  className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 mx-auto">
                  New gym? Create your account <ChevronRight size={13} />
                </button>
              </div>
            </>
          )}

          {/* ════════ MEMBER FORM ════════ */}
          {tab === 'MEMBER' && !memberData && (
            <>
              {!otpSent ? (
                <form onSubmit={handleSendOTP} className="space-y-4">
                  <p className="text-slate-400 text-sm font-medium mb-5 leading-relaxed">
                    Enter your registered phone number — we'll send a one-time code to verify it's you.
                  </p>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Phone Number</label>
                    <div className="relative">
                      <Phone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                      <input required type="tel" value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="9876543210"
                        className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                        style={iBase} onFocus={iFocus} onBlur={iBlur} />
                    </div>
                  </div>
                  <button disabled={otpLoading || phone.length < 10}
                    className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                      boxShadow: '0 8px 28px rgba(99,102,241,0.5)',
                      opacity: (otpLoading || phone.length < 10) ? 0.65 : 1,
                    }}>
                    {otpLoading
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending...</>
                      : <>Send OTP <ArrowRight size={16} /></>}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <div className="flex items-center gap-2.5 p-3.5 rounded-xl mb-4"
                    style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)' }}>
                    <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                    <p className="text-emerald-300 text-sm font-semibold">
                      OTP sent to {phone}{firstName ? ` · Hi, ${firstName}!` : ''}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">6-Digit OTP</label>
                    <input required type="text" value={otp} maxLength={6}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="● ● ● ● ● ●"
                      className="w-full px-4 py-4 rounded-xl text-white text-center text-2xl font-black tracking-[0.55em] placeholder-slate-700 outline-none transition-all"
                      style={iBase} onFocus={iFocus} onBlur={iBlur} />
                  </div>
                  <button disabled={otpLoading || otp.length < 6}
                    className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                    style={{
                      background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                      boxShadow: '0 8px 28px rgba(99,102,241,0.5)',
                      opacity: (otpLoading || otp.length < 6) ? 0.65 : 1,
                    }}>
                    {otpLoading
                      ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</>
                      : <>Verify & Continue <ArrowRight size={16} /></>}
                  </button>
                  <button type="button" onClick={() => { setOtpSent(false); setOtp(''); setError(''); }}
                    className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors">
                    ← Use a different number
                  </button>
                </form>
              )}
            </>
          )}

          {/* ════════ MEMBER DASHBOARD after OTP ════════ */}
          {/* Handled full-screen above — nothing to render here */}

          </div>{/* end animated tab content */}

          <p className="text-center text-slate-700 text-[10px] font-medium mt-auto pt-8">
            Authorized Personnel Only &nbsp;·&nbsp; GymVault v2.0
          </p>
        </div>
      </div>

      <PasswordResetModal
        open={passwordResetOpen}
        step={passwordResetStep}
        email={passwordResetEmail}
        setEmail={setPasswordResetEmail}
        otp={passwordResetOtp}
        setOtp={setPasswordResetOtp}
        newPassword={passwordResetNewPassword}
        setNewPassword={setPasswordResetNewPassword}
        confirmPassword={passwordResetConfirmPassword}
        setConfirmPassword={setPasswordResetConfirmPassword}
        showNewPassword={showResetPassword}
        setShowNewPassword={setShowResetPassword}
        showConfirmPassword={showResetConfirmPassword}
        setShowConfirmPassword={setShowResetConfirmPassword}
        loading={passwordResetLoading}
        error={passwordResetError}
        notice={passwordResetNotice}
        delivery={passwordResetDelivery}
        onClose={closePasswordReset}
        onRequestOtp={handlePasswordResetRequest}
        onConfirmReset={handlePasswordResetConfirm}
        onResendOtp={handlePasswordResetRequest}
        onCopyPreviewOtp={handleCopyPreviewOtp}
      />
    </div>
  );
}

