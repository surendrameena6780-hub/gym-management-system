import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { buildApiUrl } from './utils/apiUrl';
import {
  Dumbbell, Mail, Lock, ArrowRight, ArrowLeft, User, Building2,
  Eye, EyeOff, Check, Phone, MapPin, Sun, Moon, Loader2, AlertCircle, Copy,
} from 'lucide-react';

// â”€â”€â”€ Plans (14-day trial automatic on all  -  no "Test Drive" option) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PLANS = [
  { key: 'basic',  label: 'Basic',  price: '\u20B91,499', color: '#6366f1', desc: 'Up to 150 members'   },
  { key: 'growth', label: 'Growth', price: '\u20B92,799', color: '#a855f7', desc: 'Up to 400 members'   },
  { key: 'pro',    label: 'Pro',    price: '\u20B93,699', color: '#10b981', desc: 'Up to 1,000 members' },
];

const PENDING_GOOGLE_SIGNUP_KEY = 'gv_pending_google_signup';

// â”€â”€â”€ Password strength â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function passwordStrength(pwd) {
  if (!pwd) return { level: 0, label: '', color: '' };
  let s = 0;
  if (pwd.length >= 8)           s++;
  if (pwd.length >= 12)          s++;
  if (/[A-Z]/.test(pwd))         s++;
  if (/[0-9]/.test(pwd))         s++;
  if (/[^a-zA-Z0-9]/.test(pwd))  s++;
  if (s <= 1) return { level: 1, label: 'Weak',   color: '#ef4444' };
  if (s <= 2) return { level: 2, label: 'Fair',   color: '#f59e0b' };
  if (s <= 3) return { level: 3, label: 'Good',   color: '#6366f1' };
  return       { level: 4, label: 'Strong', color: '#10b981' };
}

// â”€â”€â”€ Dark theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DK = {
  page:      'linear-gradient(160deg, #060b14 0%, #090c18 100%)',
  card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)' },
  inp:       { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' },
  inpFBg:    'rgba(99,102,241,0.08)', inpFBd: 'rgba(99,102,241,0.65)',
  inpBg:     'rgba(255,255,255,0.06)', inpBd: 'rgba(255,255,255,0.1)',
  logo: '#ffffff', text: '#ffffff', sub: '#94a3b8', label: '#64748b',
  div:       'rgba(255,255,255,0.07)',
  social:    { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' },
  socialTxt: '#ffffff',
  back:      { border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' },
  dot:       'rgba(255,255,255,0.1)',
  plan:      { background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' },
  blob1:     'rgba(99,102,241,0.28)', blob2: 'rgba(168,85,247,0.2)',
  icon:      '#64748b',
  errBg:     'rgba(244,63,94,0.1)', errBd: 'rgba(244,63,94,0.22)',
  toggle:    { background: 'rgba(255,255,255,0.07)', color: '#94a3b8' },
  check:     { background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.15)' },
  footer:    '#475569', strengthBg: 'rgba(255,255,255,0.08)',
  trialBg:   'rgba(16,185,129,0.1)', trialBd: 'rgba(16,185,129,0.25)',
  appleClr:  'white',
};

// â”€â”€â”€ Light theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LT = {
  page:      'linear-gradient(160deg, #eef2ff 0%, #f5f8ff 100%)',
  card:      { background: '#ffffff', border: '1px solid rgba(99,102,241,0.14)', boxShadow: '0 12px 48px rgba(99,102,241,0.09)', backdropFilter: 'blur(0)' },
  inp:       { background: '#f1f5f9', border: '1px solid #cbd5e1' },
  inpFBg:    '#eef2ff', inpFBd: 'rgba(99,102,241,0.6)',
  inpBg:     '#f1f5f9', inpBd: '#cbd5e1',
  logo: '#111827', text: '#111827', sub: '#64748b', label: '#6b7280',
  div:       '#e2e8f0',
  social:    { background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  socialTxt: '#374151',
  back:      { border: '1px solid #e2e8f0', color: '#6b7280' },
  dot:       '#e2e8f0',
  plan:      { background: '#f8faff', border: '1.5px solid #c7d2fe' },
  blob1:     'rgba(99,102,241,0.12)', blob2: 'rgba(168,85,247,0.08)',
  icon:      '#94a3b8',
  errBg:     '#fef2f2', errBd: '#fecaca',
  toggle:    { background: '#f1f5f9', color: '#6b7280' },
  check:     { background: '#f1f5f9', border: '1.5px solid #d1d5db' },
  footer:    '#94a3b8', strengthBg: '#e2e8f0',
  trialBg:   '#f0fdf8', trialBd: '#a7f3d0',
  appleClr:  '#1f2937',
};

// â”€â”€â”€ Icons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
function AppleIconSvg({ color }) {
  return (
    <svg width="15" height="18" viewBox="0 0 814 1000" fill={color} aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.9 0 694.5 0 604.5 0 450.9 100.9 266.7 234.4 200.71c39.9-20.1 83.5-31.4 128.7-31.4 90 0 136.4 39.5 247.2 39.5 97.4 0 156.1-39.5 243.3-39.5 30.7 0 108.4 6.5 158.5 55.7z"/>
      <path d="M449.7 156.5C478.5 117.6 500.1 63.2 500.1 8.8c0-8.1-.6-16.2-2.5-23.7-55.9 2.5-121.9 37.1-159.6 83.3-30.7 37.1-56.5 94.7-56.5 152.9 0 8.1 1.3 16.2 1.9 18.7 3.1.6 8.1 1.3 13.1 1.3 50.3 0 113.8-33.2 152.2-84.8z"/>
    </svg>
  );
}

// â”€â”€â”€ Progress dots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ProgressDots({ activeIndex, totalSteps, dotColor }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="rounded-full transition-all duration-500"
          style={{
            width:      i === activeIndex ? '28px' : '8px',
            height:     '8px',
            background: i <= activeIndex ? 'linear-gradient(90deg, #6366f1, #a855f7)' : dotColor,
          }} />
      ))}
    </div>
  );
}

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function SignupPage({ onShowLogin, setToken }) {
  const [isDark, setIsDark]   = useState(() => localStorage.getItem('gv-theme') !== 'light');
  const toggleTheme = () => setIsDark(d => { localStorage.setItem('gv-theme', !d ? 'dark' : 'light'); return !d; });
  const T = isDark ? DK : LT;

  const [step, setStep]       = useState(0);
  const [stepDir, setStepDir] = useState(1); // 1=forward, -1=backward

  // Step 0
  const [email, setEmail]     = useState('');
  const [emailSt, setEmailSt] = useState(null); // null|'checking'|'ok'|'taken'
  const [signupEmailOtpMode, setSignupEmailOtpMode] = useState('preview');
  const [signupEmailOtp, setSignupEmailOtp] = useState('');
  const [signupEmailOtpSent, setSignupEmailOtpSent] = useState(false);
  const [signupEmailOtpVerified, setSignupEmailOtpVerified] = useState(false);
  const [signupEmailOtpDelivery, setSignupEmailOtpDelivery] = useState(null);
  const [signupEmailVerificationToken, setSignupEmailVerificationToken] = useState('');

  // Step 1
  const [fullName, setFullName]       = useState('');
  const [ownerPhone, setOwnerPhone]   = useState('');
  const [phoneSt, setPhoneSt]         = useState(null);

  // Step 2
  const [gymName, setGymName]   = useState('');
  const [city, setCity]         = useState('');
  const [address, setAddress]   = useState('');
  const [branches, setBranches] = useState('1');

  // Step 3
  const [password, setPassword]         = useState('');
  const [confirmPwd, setConfirmPwd]     = useState('');
  const [showPwd, setShowPwd]           = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('basic');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(null);
  const [pendingGoogleSignup, setPendingGoogleSignup] = useState(null);

  const isGoogleSignup = Boolean(pendingGoogleSignup?.signupToken);
  const stepFlow = isGoogleSignup ? [1, 2, 3] : [0, 1, 2, 3];
  const activeStepIndex = Math.max(stepFlow.indexOf(step), 0);
  const totalSteps = stepFlow.length;

  const clearPendingGoogleSignup = () => {
    sessionStorage.removeItem(PENDING_GOOGLE_SIGNUP_KEY);
    setPendingGoogleSignup(null);
  };

  const handleShowLogin = () => {
    clearPendingGoogleSignup();
    onShowLogin();
  };

  useEffect(() => {
    let cancelled = false;

    axios.get('/api/auth/config')
      .then((res) => {
        if (!cancelled) {
          setGoogleAuthEnabled(Boolean(res.data?.google_auth_enabled));
          setSignupEmailOtpMode(String(res.data?.signup_email_otp_mode || 'preview'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGoogleAuthEnabled(null);
          setSignupEmailOtpMode('preview');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const resetSignupEmailOtpState = () => {
    setSignupEmailOtp('');
    setSignupEmailOtpSent(false);
    setSignupEmailOtpVerified(false);
    setSignupEmailOtpDelivery(null);
    setSignupEmailVerificationToken('');
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const signupToken = params.get('google_signup_token');

    if (signupToken) {
      const pending = {
        signupToken,
        email: params.get('signup_email') || '',
        fullName: params.get('signup_name') || '',
        avatarUrl: params.get('signup_avatar') || '',
      };

      sessionStorage.setItem(PENDING_GOOGLE_SIGNUP_KEY, JSON.stringify(pending));
      setPendingGoogleSignup(pending);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    try {
      const raw = sessionStorage.getItem(PENDING_GOOGLE_SIGNUP_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending?.signupToken) {
        setPendingGoogleSignup(pending);
      } else {
        sessionStorage.removeItem(PENDING_GOOGLE_SIGNUP_KEY);
      }
    } catch (_err) {
      sessionStorage.removeItem(PENDING_GOOGLE_SIGNUP_KEY);
    }
  }, []);

  useEffect(() => {
    if (!pendingGoogleSignup?.signupToken) return;
    if (pendingGoogleSignup.email) {
      setEmail(pendingGoogleSignup.email);
      setEmailSt('ok');
    }
    if (pendingGoogleSignup.fullName) {
      setFullName((prev) => prev || pendingGoogleSignup.fullName);
    }
    setStep((currentStep) => (currentStep === 0 ? 1 : currentStep));
  }, [pendingGoogleSignup]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errCode = params.get('auth_error');
    if (!errCode) return;

    const msgs = {
      google_not_configured: 'Google sign-up is not set up on this server. Continue with email instead.',
      google_cancelled: 'Google sign-up was cancelled.',
      google_token_failed: 'Google sign-up failed. Please try again.',
      google_profile_failed: 'Google sign-up could not read your Google profile. Please try again.',
      google_account_exists: 'This Google account is already registered. Sign in with Google instead.',
      google_email_in_use: 'This email is already registered. Use the original sign-in method instead.',
      account_suspended: 'Your account is suspended. Contact GymVault HQ.',
      server_error: 'A server error occurred. Please try again.',
    };

    setError(msgs[errCode] || 'Sign-up failed. Please try again.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const strength = passwordStrength(password);

  // Theme-aware input helpers (must be called during render for latest T)
  const iBase  = T.inp;
  const iFocus = (e) => { e.target.style.background = T.inpFBg; e.target.style.borderColor = T.inpFBd; };
  const iBlur  = (e) => { e.target.style.background = T.inpBg;  e.target.style.borderColor = T.inpBd;  };

  // â”€â”€ Real-time checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const checkEmail = async (val) => {
    const v = val.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
    setEmailSt('checking');
    try { await axios.post('/api/auth/check-email', { email: v }); setEmailSt('ok'); }
    catch (err) { setEmailSt(err?.response?.status === 409 ? 'taken' : null); }
  };

  const checkPhone = async (val) => {
    const d = val.replace(/\D/g, '').slice(-10);
    if (d.length !== 10) return;
    setPhoneSt('checking');
    try { await axios.post('/api/auth/check-phone', { phone: d }); setPhoneSt('ok'); }
    catch (err) { setPhoneSt(err?.response?.status === 409 ? 'taken' : null); }
  };

  // â”€â”€ Social handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleGoogle = () => {
    if (googleAuthEnabled === false) {
      setError('Google sign-up is not set up on this server. Continue with email instead.');
      return;
    }

    window.location.href = buildApiUrl('/api/auth/google?mode=signup');
  };
  const handleApple = () => {
    if (!window.AppleID) { setError('Apple Sign-In is not available on this server.'); return; }
    window.AppleID.auth.signIn()
      .then(async (resp) => {
        const id_token = resp?.authorization?.id_token;
        const name = [resp?.user?.name?.firstName, resp?.user?.name?.lastName].filter(Boolean).join(' ');
        try {
          const res = await axios.post('/api/auth/apple', { id_token, full_name: name });
          setToken(res.data.token, res.data.user);
          window.history.pushState({}, '', '/dashboard');
        } catch (err) { setError(err?.response?.data?.message || 'Apple Sign-Up failed.'); }
      })
      .catch(() => {});
  };

  const handleSendSignupEmailOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) { setError('Email address is required.'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Please enter a valid email address.'); return false; }

    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/auth/signup/send-email-otp', { email: normalizedEmail });
      setEmail(normalizedEmail);
      setEmailSt('ok');
      setSignupEmailOtpSent(true);
      setSignupEmailOtpVerified(false);
      setSignupEmailVerificationToken('');
      setSignupEmailOtp('');
      setSignupEmailOtpDelivery({
        mode: String(res.data?.delivery_mode || signupEmailOtpMode || 'preview'),
        maskedEmail: res.data?.masked_email || normalizedEmail,
        expiresInMinutes: res.data?.expires_in_minutes || 10,
        previewOtp: res.data?.preview_otp || '',
        previewNotice: res.data?.preview_notice || '',
      });
      return true;
    } catch (err) {
      if (err?.response?.status === 409) setEmailSt('taken');
      setError(err?.response?.data?.message || 'Could not send email verification code.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySignupEmailOtp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedOtp = signupEmailOtp.replace(/\D/g, '').slice(0, 6);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError('Please enter a valid email address.'); return false; }
    if (normalizedOtp.length !== 6) { setError('Enter the 6-digit code sent to your email.'); return false; }

    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/auth/signup/verify-email-otp', { email: normalizedEmail, otp: normalizedOtp });
      setSignupEmailOtp(normalizedOtp);
      setSignupEmailOtpVerified(true);
      setSignupEmailVerificationToken(String(res.data?.email_verification_token || ''));
      setEmailSt('ok');
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not verify email OTP.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleCopySignupPreviewOtp = async () => {
    if (!signupEmailOtpDelivery?.previewOtp) return;

    try {
      await navigator.clipboard.writeText(signupEmailOtpDelivery.previewOtp);
      setError('');
    } catch (_err) {
      setError('Could not copy the preview OTP.');
    }
  };

  // â”€â”€ Step navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const goNext = async () => {
    setError('');
    if (step === 0) {
      if (!email.trim())                               { setError('Email address is required.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))  { setError('Please enter a valid email address.'); return; }
      if (emailSt === 'taken')                         { setError('An account with this email already exists. Sign in instead.'); return; }
      if (!signupEmailOtpSent) {
        await handleSendSignupEmailOtp();
        return;
      }
      if (!signupEmailOtpVerified) {
        const verified = await handleVerifySignupEmailOtp();
        if (!verified) return;
      }
      if (!signupEmailVerificationToken) {
        setError('Verify your email before continuing.');
        return;
      }
    }
    if (step === 1) {
      if (!fullName.trim() || fullName.trim().length < 2) { setError('Please enter your full name (at least 2 characters).'); return; }
      const digits = ownerPhone.replace(/\D/g, '').slice(-10);
      if (!digits || digits.length < 10)               { setError('Please enter a valid 10-digit mobile number.'); return; }
      if (phoneSt === 'taken')                         { setError('This phone number is already registered. Sign in instead.'); return; }
      if (phoneSt !== 'ok') {
        setLoading(true);
        try { await axios.post('/api/auth/check-phone', { phone: digits }); setPhoneSt('ok'); }
        catch (err) {
          setLoading(false);
          if (err?.response?.status === 409) { setPhoneSt('taken'); setError('This phone number is already registered.'); }
          else setError('Could not verify phone. Please try again.');
          return;
        }
        setLoading(false);
      }
    }
    if (step === 2) {
      if (!gymName.trim() || gymName.trim().length < 2) { setError('Please enter your gym name (at least 2 characters).'); return; }
      if (!city.trim())                                  { setError('City / State is required.'); return; }
    }
    const currentIndex = stepFlow.indexOf(step);
    if (currentIndex >= stepFlow.length - 1) return;
    setStepDir(1);
    setStep(stepFlow[currentIndex + 1]);
  };

  const goBack = () => {
    setError('');
    const currentIndex = stepFlow.indexOf(step);
    if (currentIndex <= 0) {
      handleShowLogin();
      return;
    }
    setStepDir(-1);
    setStep(stepFlow[currentIndex - 1]);
  };

  // â”€â”€ Final submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!agreedToTerms)          { setError('Please agree to the Terms of Service to continue.'); return; }
    if (!isGoogleSignup) {
      if (password.length < 8)     { setError('Password must be at least 8 characters.'); return; }
      if (password !== confirmPwd) { setError('Passwords do not match.'); return; }
    }
    setLoading(true);
    try {
      if (isGoogleSignup) {
        const signupToken = pendingGoogleSignup?.signupToken;
        if (!signupToken) {
          setError('Google signup session expired. Please continue with Google again.');
          return;
        }

        const res = await axios.post('/api/auth/google/signup/complete', {
          signup_token: signupToken,
          gym_name: gymName.trim(),
          full_name: fullName.trim(),
          owner_phone: ownerPhone.replace(/\D/g, '').slice(-10),
          gym_address: address.trim() || null,
          gym_city: city.trim(),
          branches_count: parseInt(branches, 10) || 1,
          selected_plan: selectedPlan,
        });

        clearPendingGoogleSignup();
        setToken(res.data.token, res.data.user);
        window.history.pushState({}, '', '/dashboard');
        return;
      }

      await axios.post('/api/auth/register-owner', {
        gym_name:      gymName.trim(),
        full_name:     fullName.trim(),
        email:         email.trim().toLowerCase(),
        email_verification_token: signupEmailVerificationToken,
        password,
        owner_phone:   ownerPhone.replace(/\D/g, '').slice(-10),
        gym_address:   address.trim() || null,
        gym_city:      city.trim(),
        branches_count: parseInt(branches) || 1,
        selected_plan:  selectedPlan,
      });
      const res = await axios.post('/api/auth/login', { email: email.trim().toLowerCase(), password });
      setToken(res.data.token, res.data.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) {
      setError(err?.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // â”€â”€ Trial date display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);
  const trialEndStr = trialEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const planObj = PLANS.find(p => p.key === selectedPlan);

  const STEP_TITLES = {
    0: 'Verify your email',
    1: 'About you',
    2: 'Your gym',
    3: isGoogleSignup ? 'Choose your plan' : 'Secure your account',
  };
  const STEP_SUBS = {
    0: 'We will send a 6-digit code before account creation',
    1: 'Tell us a bit about yourself',
    2: 'A few details about your gym',
    3: isGoogleSignup ? 'Finish your Google signup and activate your 14-day trial' : 'Set a strong password and choose your plan',
  };
  const primaryBtn = {
    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
    boxShadow:  loading ? 'none' : '0 8px 28px rgba(99,102,241,0.42)',
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div
      className="app-min-shell-height flex items-center justify-center font-['Inter'] p-4 py-10 overflow-y-auto"
      style={{
        background: T.page,
        transition: 'background 0.4s ease',
        minHeight: 'max(100vh, var(--app-viewport-height))',
        paddingTop: 'max(2.5rem, var(--safe-area-top))',
        paddingBottom: 'max(2rem, var(--safe-area-bottom))',
      }}
    >
      {/* Ambient blobs */}
      <div className="fixed -top-32 -left-32 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${T.blob1} 0%, transparent 70%)`, filter: 'blur(90px)' }} />
      <div className="fixed bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${T.blob2} 0%, transparent 70%)`, filter: 'blur(90px)' }} />

      <div className="w-full max-w-[440px] relative z-10">

        {/* â”€â”€ Logo + Theme toggle â”€â”€ */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 24px rgba(99,102,241,0.5)' }}>
              <Dumbbell size={20} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="font-black text-xl tracking-tight" style={{ color: T.logo }}>GymVault</span>
          </div>
          <button
            type="button" onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95"
            style={{ background: T.toggle.background, color: T.toggle.color }}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* â”€â”€ Card â”€â”€ */}
        <div className="rounded-3xl p-7 sm:p-8"
          style={{ ...T.card, transition: 'background 0.4s ease, border 0.4s ease, box-shadow 0.4s ease' }}>

          <ProgressDots activeIndex={activeStepIndex} totalSteps={totalSteps} dotColor={T.dot} />

          {/* Heading */}
          <div className="mb-6">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] mb-2" style={{ color: '#818cf8' }}>
              Step {activeStepIndex + 1} of {totalSteps}
            </p>
            <h2 className="text-[1.5rem] font-black leading-tight" style={{ color: T.text }}>{STEP_TITLES[step]}</h2>
            <p className="text-sm font-medium mt-1.5" style={{ color: T.sub }}>{STEP_SUBS[step]}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm font-semibold gv-fade-in"
              style={{ background: T.errBg, border: `1px solid ${T.errBd}`, color: '#f87171' }}>
              {error}
            </div>
          )}

          {/* â”€â”€ Animated step content â”€â”€ */}
          <div key={step} className={stepDir > 0 ? 'gv-step-forward' : 'gv-step-backward'}>

            {/* â•â•â•â• STEP 0  -  Email + Social â•â•â•â• */}
            {step === 0 && (
              <div className="space-y-3.5">
                <button type="button" onClick={handleGoogle}
                  className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-[1.015] active:scale-[0.985]"
                  style={{ ...T.social, color: T.socialTxt }}>
                  <GoogleIcon /> Continue with Google  -  quick &amp; easy
                </button>
                <button type="button" onClick={handleApple}
                  className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold transition-all duration-200 hover:scale-[1.015] active:scale-[0.985]"
                  style={{ ...T.social, color: T.socialTxt }}>
                  <AppleIconSvg color={T.appleClr} /> Continue with Apple
                </button>

                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px" style={{ background: T.div }} />
                  <span className="text-[11px] font-bold" style={{ color: T.label }}>or use email</span>
                  <div className="flex-1 h-px" style={{ background: T.div }} />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                    <input
                      type="email" value={email}
                      onChange={e => { setEmail(e.target.value); setEmailSt(null); resetSignupEmailOtpState(); }}
                      onBlur={e => { iBlur(e); checkEmail(e.target.value); }}
                      onFocus={iFocus}
                      onKeyDown={e => e.key === 'Enter' && goNext()}
                      placeholder="admin@mygym.com"
                      className="w-full pl-11 pr-10 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ ...iBase, color: T.text }}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {emailSt === 'checking' && <Loader2 size={14} className="animate-spin" style={{ color: '#818cf8' }} />}
                      {emailSt === 'ok'       && <Check size={14} className="text-emerald-400" strokeWidth={3} />}
                      {emailSt === 'taken'    && <AlertCircle size={14} className="text-rose-400" />}
                    </div>
                  </div>
                  {emailSt === 'taken' && (
                    <p className="text-[10px] font-bold mt-1.5 text-rose-400 flex items-center gap-1 gv-fade-in">
                      <AlertCircle size={10} /> Already registered  - {' '}
                      <button type="button" onClick={handleShowLogin} className="underline ml-0.5">sign in instead</button>
                    </p>
                  )}
                </div>

                <div className="rounded-2xl p-4 space-y-3" style={{ background: T.social.background, border: T.social.border }}>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: '#818cf8' }}>Email verification</p>
                    <p className="text-xs font-medium mt-1 leading-relaxed" style={{ color: T.sub }}>
                      Step 1: send code. Step 2: type the 6-digit code. Step 3: continue signup.
                    </p>
                  </div>

                  {!signupEmailOtpSent ? (
                    <p className="text-[11px] font-medium leading-relaxed" style={{ color: T.sub }}>
                      {signupEmailOtpMode === 'preview'
                        ? 'SMTP preview mode is active. The verification code will appear on this screen after you request it.'
                        : 'GymVault will send the verification code to this email automatically.'}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                        <Check size={14} className="text-indigo-400 flex-shrink-0" strokeWidth={3} />
                        <p className="text-xs font-semibold" style={{ color: T.text }}>
                          Code ready for {signupEmailOtpDelivery?.maskedEmail || email}
                        </p>
                      </div>

                      {signupEmailOtpDelivery?.previewOtp && (
                        <div className="p-4 rounded-2xl" style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.22)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Preview signup OTP</p>
                              <p className="text-white text-2xl font-black tracking-[0.3em] mt-1">{signupEmailOtpDelivery.previewOtp}</p>
                              <p className="text-amber-100/90 text-xs font-medium mt-2 leading-relaxed">
                                {signupEmailOtpDelivery.previewNotice || 'SMTP is not wired yet, so the signup OTP is shown directly here.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleCopySignupPreviewOtp}
                              className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-200 hover:text-white transition-colors shrink-0"
                              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                              aria-label="Copy preview signup OTP"
                            >
                              <Copy size={15} />
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>
                          6-Digit Email OTP
                        </label>
                        <input
                          type="text"
                          value={signupEmailOtp}
                          onChange={(e) => setSignupEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="● ● ● ● ● ●"
                          className="w-full px-4 py-4 rounded-xl text-center text-2xl font-black tracking-[0.55em] outline-none transition-all"
                          style={{ ...iBase, color: T.text }}
                          onFocus={iFocus}
                          onBlur={iBlur}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-semibold" style={{ color: T.sub }}>
                        <span>Code expires in about {signupEmailOtpDelivery?.expiresInMinutes || 10} minutes</span>
                        <button type="button" onClick={handleSendSignupEmailOtp} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                          Resend code
                        </button>
                      </div>

                      {signupEmailOtpVerified && (
                        <div className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.22)' }}>
                          <Check size={14} className="text-emerald-400 flex-shrink-0" strokeWidth={3} />
                          <p className="text-xs font-semibold text-emerald-300">Email verified. You can continue now.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <button type="button" onClick={goNext} disabled={loading}
                  className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-70"
                  style={primaryBtn}>
                  {loading ? (
                    <><Loader2 size={15} className="animate-spin" /> {signupEmailOtpSent && !signupEmailOtpVerified ? 'Verifying...' : 'Sending...'}</>
                  ) : signupEmailOtpVerified ? (
                    <>Continue <ArrowRight size={16} /></>
                  ) : signupEmailOtpSent ? (
                    <>Verify Email <ArrowRight size={16} /></>
                  ) : (
                    <>Send Verification Code <ArrowRight size={16} /></>
                  )}
                </button>
              </div>
            )}

            {/* â•â•â•â• STEP 1  -  About You â•â•â•â• */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Your Full Name</label>
                  <div className="relative">
                    <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                    <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                      placeholder="Rahul Sharma" autoFocus
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Mobile Number</label>
                  <div className="relative">
                    <Phone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                    <input
                      type="tel" value={ownerPhone}
                      onChange={e => { setOwnerPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setPhoneSt(null); }}
                      onBlur={e => { iBlur(e); checkPhone(e.target.value); }}
                      onFocus={iFocus}
                      placeholder="98765 43210"
                      className="w-full pl-11 pr-10 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ ...iBase, color: T.text }}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {phoneSt === 'checking' && <Loader2 size={14} className="animate-spin" style={{ color: '#818cf8' }} />}
                      {phoneSt === 'ok'       && <Check size={14} className="text-emerald-400" strokeWidth={3} />}
                      {phoneSt === 'taken'    && <AlertCircle size={14} className="text-rose-400" />}
                    </div>
                  </div>
                  {phoneSt === 'taken' && (
                    <p className="text-[10px] font-bold mt-1.5 text-rose-400 flex items-center gap-1 gv-fade-in">
                      <AlertCircle size={10} /> Number already registered  - {' '}
                      <button type="button" onClick={handleShowLogin} className="underline ml-0.5">sign in</button>
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={goBack}
                    className="flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:opacity-80"
                    style={T.back}>
                    <ArrowLeft size={15} /> Back
                  </button>
                  <button type="button" onClick={goNext} disabled={loading}
                    className="flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-70"
                    style={primaryBtn}>
                    {loading ? <><Loader2 size={15} className="animate-spin" /> Checking...</> : <>Continue <ArrowRight size={16} /></>}
                  </button>
                </div>
              </div>
            )}

            {/* â•â•â•â• STEP 2  -  Your Gym â•â•â•â• */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Gym Name</label>
                  <div className="relative">
                    <Building2 size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                    <input type="text" value={gymName} onChange={e => setGymName(e.target.value)}
                      placeholder="Titan Fitness" autoFocus
                      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                      style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>
                      City / State <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                      <input type="text" value={city} onChange={e => setCity(e.target.value)}
                        placeholder="Mumbai, MH"
                        className="w-full pl-9 pr-3 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                        style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Branches</label>
                    <input type="number" min="1" max="99" value={branches} onChange={e => setBranches(e.target.value)}
                      className="w-full px-3 py-3.5 rounded-xl text-sm font-medium outline-none transition-all text-center"
                      style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>
                    Gym Address{' '}
                    <span className="font-medium normal-case" style={{ color: T.label }}>(optional)</span>
                  </label>
                  <div className="relative">
                    <MapPin size={14} className="absolute left-4 top-[14px] pointer-events-none" style={{ color: T.icon }} />
                    <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2}
                      placeholder="123 MG Road, Bandra West"
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl text-sm font-medium outline-none transition-all resize-none"
                      style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={goBack}
                    className="flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:opacity-80"
                    style={T.back}>
                    <ArrowLeft size={15} /> Back
                  </button>
                  <button type="button" onClick={goNext}
                    className="flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                    style={primaryBtn}>
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* â•â•â•â• STEP 3  -  Password + Plan â•â•â•â• */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isGoogleSignup && (
                  <>
                    {/* Password */}
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Password</label>
                      <div className="relative">
                        <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                        <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                          placeholder="Min. 8 characters" autoFocus
                          className="w-full pl-11 pr-12 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                          style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                        <button type="button" onClick={() => setShowPwd(p => !p)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors" style={{ color: T.icon }}>
                          {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      {password && (
                        <div className="mt-2">
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: T.strengthBg }}>
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${(strength.level / 4) * 100}%`, background: strength.color }} />
                          </div>
                          <p className="text-[10px] font-bold mt-1" style={{ color: strength.color }}>{strength.label}</p>
                        </div>
                      )}
                    </div>

                    {/* Confirm password */}
                    <div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2" style={{ color: T.label }}>Confirm Password</label>
                      <div className="relative">
                        <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T.icon }} />
                        <input type={showConfirm ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                          placeholder="Repeat your password"
                          className="w-full pl-11 pr-12 py-3.5 rounded-xl text-sm font-medium outline-none transition-all"
                          style={{ ...iBase, color: T.text }} onFocus={iFocus} onBlur={iBlur} />
                        <button type="button" onClick={() => setShowConfirm(p => !p)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors" style={{ color: T.icon }}>
                          {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      {confirmPwd && (
                        <p className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${password === confirmPwd && password.length >= 8 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {password === confirmPwd && password.length >= 8
                            ? <><Check size={10} strokeWidth={3} /> Passwords match</>
                            : 'Passwords don\'t match'}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {isGoogleSignup && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl"
                    style={{ background: T.social.background, border: T.social.border }}>
                    <GoogleIcon />
                    <div>
                      <p className="font-black text-sm" style={{ color: T.text }}>Google account verified</p>
                      <p className="text-[11px] mt-0.5" style={{ color: T.sub }}>
                        {email} will be used for sign-in. Finish your gym details and plan to complete setup.
                      </p>
                    </div>
                  </div>
                )}

                {/* â”€â”€ Trial banner + Plan picker â”€â”€ */}
                <div>
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl mb-3"
                    style={{ background: T.trialBg, border: `1px solid ${T.trialBd}` }}>
                    <span className="text-lg leading-none mt-px flex-shrink-0">{String.fromCodePoint(0x1F389)}</span>
                    <div>
                      <p className="font-black text-sm text-emerald-400">14-day free trial on every plan</p>
                      <p className="text-[11px] mt-0.5" style={{ color: T.sub }}>
                        No payment today. Trial ends <strong>{trialEndStr}</strong>.
                        {planObj && <> Pick a plan below &mdash; you&apos;ll be billed <strong>{planObj.price}/mo</strong> after your trial.</>}
                      </p>
                    </div>
                  </div>

                  <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2.5" style={{ color: T.label }}>
                    Choose Your Plan
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {PLANS.map(plan => (
                      <button key={plan.key} type="button" onClick={() => setSelectedPlan(plan.key)}
                        className="px-2 py-3 rounded-xl text-center transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
                        style={{
                          background: selectedPlan === plan.key ? `${plan.color}15` : T.plan.background,
                          border:     selectedPlan === plan.key ? `2px solid ${plan.color}55` : T.plan.border,
                        }}>
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className="text-[11px] font-black" style={{ color: selectedPlan === plan.key ? plan.color : T.sub }}>{plan.label}</span>
                          {selectedPlan === plan.key && <Check size={9} style={{ color: plan.color }} strokeWidth={3.5} />}
                        </div>
                        <p className="font-black text-[0.82rem] leading-none" style={{ color: T.text }}>{plan.price}</p>
                        <p className="text-[9px] font-semibold mt-0.5" style={{ color: T.label }}>/mo after trial</p>
                        <p className="text-[9px] mt-1.5 leading-tight" style={{ color: T.sub }}>{plan.desc}</p>
                      </button>
                    ))}
                  </div>
                  {planObj && (
                    <p className="text-[10px] text-center mt-2" style={{ color: T.label }}>
                      First bill: <strong>{planObj.price}/mo</strong> &middot; starts {trialEndStr} &middot; cancel anytime
                    </p>
                  )}
                </div>

                {/* Terms */}
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setAgreedToTerms(t => !t)}
                    className="w-5 h-5 rounded-md flex items-center justify-center mt-0.5 flex-shrink-0 transition-all duration-200"
                    style={{
                      background: agreedToTerms ? 'linear-gradient(135deg, #6366f1, #a855f7)' : T.check.background,
                      border:     agreedToTerms ? 'none' : T.check.border,
                    }}>
                    {agreedToTerms && <Check size={11} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-xs font-medium leading-relaxed" style={{ color: T.sub }}>
                    I agree to GymVault's{' '}
                    <span className="text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer">Terms of Service</span>
                    {' '}and{' '}
                    <span className="text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer">Privacy Policy</span>
                  </span>
                </label>

                {/* Submit */}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={goBack}
                    className="flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:opacity-80"
                    style={T.back}>
                    <ArrowLeft size={15} /> Back
                  </button>
                  <button type="submit" disabled={loading}
                    className="flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all disabled:opacity-70"
                    style={primaryBtn}>
                    {loading
                      ? <><Loader2 size={15} className="animate-spin" /> {isGoogleSignup ? 'Finishing...' : 'Creating...'}</>
                      : <>{isGoogleSignup ? 'Complete Signup' : 'Create Gym'} <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          <p className="text-center mt-6">
            <button type="button" onClick={handleShowLogin}
              className="text-[11px] font-bold transition-colors hover:text-indigo-400"
              style={{ color: T.footer }}>
              Already have an account? Sign in →
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

