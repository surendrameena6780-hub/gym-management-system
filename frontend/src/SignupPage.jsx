import React, { useState } from 'react';
import axios from 'axios';
import {
  Dumbbell, Mail, Lock, ArrowRight, ArrowLeft,
  User, Building2, Eye, EyeOff, Check
} from 'lucide-react';

// ─── Plan options shown in step 3 (visual only — billing done post-login) ─────
const PLANS = [
  { key: 'test',  label: 'Test Drive', price: '₹1',       desc: '1-day trial',          color: '#f59e0b' },
  { key: 'basic', label: 'Basic',      price: '₹999/mo',  desc: 'Up to 100 members',    color: '#6366f1' },
  { key: 'pro',   label: 'Pro',        price: '₹1,999/mo',desc: 'Up to 500 members',    color: '#a855f7' },
  { key: 'elite', label: 'Elite',      price: '₹3,499/mo',desc: 'Unlimited everything', color: '#10b981' },
];

// ─── Password strength calculator ─────────────────────────────────────────────
function passwordStrength(pwd) {
  if (!pwd) return { level: 0, label: '', color: '' };
  let s = 0;
  if (pwd.length >= 8)        s++;
  if (pwd.length >= 12)       s++;
  if (/[A-Z]/.test(pwd))      s++;
  if (/[0-9]/.test(pwd))      s++;
  if (/[^a-zA-Z0-9]/.test(pwd)) s++;
  if (s <= 1) return { level: 1, label: 'Weak',   color: '#ef4444' };
  if (s <= 2) return { level: 2, label: 'Fair',   color: '#f59e0b' };
  if (s <= 3) return { level: 3, label: 'Good',   color: '#6366f1' };
  return       { level: 4, label: 'Strong', color: '#10b981' };
}

// ─── Input style helpers ──────────────────────────────────────────────────────
const iFocus = (e) => { e.target.style.borderColor = 'rgba(99,102,241,0.7)'; e.target.style.background = 'rgba(99,102,241,0.08)'; };
const iBlur  = (e) => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.06)'; };
const iBase  = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };

// ─── Google icon ──────────────────────────────────────────────────────────────
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

// ─── Apple icon ───────────────────────────────────────────────────────────────
function AppleIcon() {
  return (
    <svg width="15" height="18" viewBox="0 0 814 1000" fill="white" aria-hidden>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.9 0 694.5 0 604.5 0 450.9 100.9 266.7 234.4 200.71c39.9-20.1 83.5-31.4 128.7-31.4 90 0 136.4 39.5 247.2 39.5 97.4 0 156.1-39.5 243.3-39.5 30.7 0 108.4 6.5 158.5 55.7z"/>
      <path d="M449.7 156.5C478.5 117.6 500.1 63.2 500.1 8.8c0-8.1-.6-16.2-2.5-23.7-55.9 2.5-121.9 37.1-159.6 83.3-30.7 37.1-56.5 94.7-56.5 152.9 0 8.1 1.3 16.2 1.9 18.7 3.1.6 8.1 1.3 13.1 1.3 50.3 0 113.8-33.2 152.2-84.8z"/>
    </svg>
  );
}

// ─── Progress dots ────────────────────────────────────────────────────────────
function ProgressDots({ step, total = 3 }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="rounded-full transition-all duration-500"
          style={{
            width:      i === step ? '28px' : '8px',
            height:     '8px',
            background: i <= step
              ? 'linear-gradient(90deg, #6366f1, #a855f7)'
              : 'rgba(255,255,255,0.1)',
          }} />
      ))}
    </div>
  );
}

// ─── Main SignupPage ──────────────────────────────────────────────────────────
export default function SignupPage({ onShowLogin, setToken }) {
  const [step, setStep]                   = useState(0);
  const [email, setEmail]                 = useState('');
  const [fullName, setFullName]           = useState('');
  const [gymName, setGymName]             = useState('');
  const [password, setPassword]           = useState('');
  const [confirmPwd, setConfirmPwd]       = useState('');
  const [showPwd, setShowPwd]             = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [selectedPlan, setSelectedPlan]   = useState('basic');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');

  const strength = passwordStrength(password);

  // ── Social quick-sign-up ───────────────────────────────────────────────────
  const handleGoogle = () => { window.location.href = '/api/auth/google'; };

  const handleApple = () => {
    if (!window.AppleID) { setError('Apple Sign-In is not available on this server.'); return; }
    window.AppleID.auth.signIn()
      .then(async (resp) => {
        const id_token = resp?.authorization?.id_token;
        const name     = [resp?.user?.name?.firstName, resp?.user?.name?.lastName].filter(Boolean).join(' ');
        try {
          const res = await axios.post('/api/auth/apple', { id_token, full_name: name });
          setToken(res.data.token, res.data.user);
          window.history.pushState({}, '', '/dashboard');
        } catch (err) { setError(err?.response?.data?.message || 'Apple Sign-Up failed.'); }
      })
      .catch(() => {});
  };

  // ── Step validation ────────────────────────────────────────────────────────
  const validateStep0 = () => {
    if (!email.trim()) { setError('Email address is required.'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address.'); return false; }
    return true;
  };
  const validateStep1 = () => {
    if (!fullName.trim() || fullName.trim().length < 2) { setError('Please enter your full name (at least 2 characters).'); return false; }
    if (!gymName.trim()  || gymName.trim().length  < 2) { setError('Please enter your gym name (at least 2 characters).'); return false; }
    return true;
  };

  const goNext = () => {
    setError('');
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    setStep((s) => s + 1);
  };

  const goBack = () => { setError(''); setStep((s) => s - 1); };

  // ── Final submit ───────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8)        { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPwd)    { setError('Passwords do not match.'); return; }
    if (!agreedToTerms)             { setError('Please agree to the Terms of Service to continue.'); return; }

    setLoading(true);
    try {
      await axios.post('/api/auth/register-owner', {
        gym_name:  gymName.trim(),
        full_name: fullName.trim(),
        email:     email.trim().toLowerCase(),
        password,
      });
      // Immediately log in after registration
      const res = await axios.post('/api/auth/login', { email: email.trim().toLowerCase(), password });
      setToken(res.data.token, res.data.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) {
      setError(err?.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center font-['Inter'] p-4 py-10 overflow-y-auto"
      style={{ background: 'linear-gradient(160deg, #060b14 0%, #090c18 100%)' }}
    >
      {/* Ambient blobs */}
      <div className="fixed -top-32 -left-32 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.28) 0%, transparent 70%)', filter: 'blur(90px)' }} />
      <div className="fixed bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, transparent 70%)', filter: 'blur(90px)' }} />

      <div className="w-full max-w-[420px] relative z-10">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 24px rgba(99,102,241,0.55)' }}>
            <Dumbbell size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-black text-xl tracking-tight">GymVault</span>
        </div>

        {/* Card */}
        <div className="rounded-3xl p-7 sm:p-8"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)' }}>

          <ProgressDots step={step} />

          {/* Step label */}
          <div className="mb-6">
            <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.22em] mb-2">
              Step {step + 1} of 3
            </p>
            <h2 className="text-[1.5rem] font-black text-white leading-tight">
              {step === 0 ? 'Create your account'
               : step === 1 ? 'About you & your gym'
               :              'Secure your account'}
            </h2>
            <p className="text-slate-400 text-sm font-medium mt-1.5">
              {step === 0 ? 'Get started in seconds — no credit card required'
               : step === 1 ? 'Tell us a bit about yourself and your gym'
               :              'Set a strong password and choose your plan'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm font-semibold text-rose-300"
              style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}>
              {error}
            </div>
          )}

          {/* ═══════ STEP 0 — Email or Social ═══════ */}
          {step === 0 && (
            <div className="space-y-3.5">
              {/* Social */}
              <button type="button" onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold text-white transition-all duration-200 hover:scale-[1.015] active:scale-[0.985]"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <GoogleIcon /> Continue with Google — quick & easy
              </button>
              <button type="button" onClick={handleApple}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold text-white transition-all duration-200 hover:scale-[1.015] active:scale-[0.985]"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                <AppleIcon /> Continue with Apple
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <span className="text-slate-500 text-[11px] font-bold">or use email</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              </div>

              {/* Email */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@mygym.com"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                    style={iBase} onFocus={iFocus} onBlur={iBlur}
                    onKeyDown={(e) => e.key === 'Enter' && goNext()} />
                </div>
              </div>

              <button type="button" onClick={goNext}
                className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 28px rgba(99,102,241,0.5)' }}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* ═══════ STEP 1 — Names ═══════ */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Your Full Name</label>
                <div className="relative">
                  <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                    placeholder="Rahul Sharma" autoFocus
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                    style={iBase} onFocus={iFocus} onBlur={iBlur} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Gym Name</label>
                <div className="relative">
                  <Building2 size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input type="text" value={gymName} onChange={(e) => setGymName(e.target.value)}
                    placeholder="Titan Fitness"
                    className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                    style={iBase} onFocus={iFocus} onBlur={iBlur}
                    onKeyDown={(e) => e.key === 'Enter' && goNext()} />
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={goBack}
                  className="flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest text-slate-400 flex items-center justify-center gap-2 transition-all hover:text-slate-200"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="button" onClick={goNext}
                  className="flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 28px rgba(99,102,241,0.5)' }}>
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ═══════ STEP 2 — Password + Plan + Terms ═══════ */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Password */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters" autoFocus
                    className="w-full pl-11 pr-12 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                    style={iBase} onFocus={iFocus} onBlur={iBlur} />
                  <button type="button" onClick={() => setShowPwd((p) => !p)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {/* Strength bar */}
                {password && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(strength.level / 4) * 100}%`, background: strength.color }} />
                    </div>
                    <p className="text-[10px] font-bold mt-1" style={{ color: strength.color }}>{strength.label}</p>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">Confirm Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input type={showConfirm ? 'text' : 'password'} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                    placeholder="Repeat your password"
                    className="w-full pl-11 pr-12 py-3.5 rounded-xl text-white text-sm font-medium placeholder-slate-700 outline-none transition-all"
                    style={iBase} onFocus={iFocus} onBlur={iBlur} />
                  <button type="button" onClick={() => setShowConfirm((p) => !p)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors">
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {confirmPwd && password !== confirmPwd && (
                  <p className="text-[10px] font-bold mt-1 text-rose-400">Passwords don't match</p>
                )}
                {confirmPwd && password === confirmPwd && password.length >= 8 && (
                  <p className="text-[10px] font-bold mt-1 text-emerald-400 flex items-center gap-1">
                    <Check size={10} strokeWidth={3} /> Passwords match
                  </p>
                )}
              </div>

              {/* Plan selector */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-[0.15em] mb-2 text-slate-500">
                  Interested Plan <span className="normal-case text-slate-600 font-medium">(optional — choose later in Settings)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PLANS.map((plan) => (
                    <button key={plan.key} type="button" onClick={() => setSelectedPlan(plan.key)}
                      className="px-3 py-3 rounded-xl text-left transition-all duration-200"
                      style={{
                        background: selectedPlan === plan.key ? `${plan.color}14` : 'rgba(255,255,255,0.04)',
                        border:     selectedPlan === plan.key ? `1.5px solid ${plan.color}55` : '1.5px solid rgba(255,255,255,0.08)',
                      }}>
                      <div className="flex items-start justify-between mb-0.5">
                        <span className="text-xs font-black" style={{ color: selectedPlan === plan.key ? plan.color : 'rgba(255,255,255,0.65)' }}>
                          {plan.label}
                        </span>
                        {selectedPlan === plan.key && <Check size={11} style={{ color: plan.color }} strokeWidth={3} />}
                      </div>
                      <p className="text-white font-black text-[0.85rem] leading-none">{plan.price}</p>
                      <p className="text-slate-500 text-[10px] mt-1">{plan.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Terms checkbox */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <div
                  onClick={() => setAgreedToTerms((t) => !t)}
                  className="w-5 h-5 rounded-md flex items-center justify-center mt-0.5 flex-shrink-0 transition-all duration-200"
                  style={{
                    background: agreedToTerms ? 'linear-gradient(135deg, #6366f1, #a855f7)' : 'rgba(255,255,255,0.06)',
                    border:     agreedToTerms ? 'none' : '1.5px solid rgba(255,255,255,0.15)',
                  }}>
                  {agreedToTerms && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
                <span className="text-xs font-medium text-slate-400 leading-relaxed">
                  I agree to GymVault's{' '}
                  <span className="text-indigo-400 hover:text-indigo-300 cursor-pointer">Terms of Service</span>
                  {' '}and{' '}
                  <span className="text-indigo-400 hover:text-indigo-300 cursor-pointer">Privacy Policy</span>
                </span>
              </label>

              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={goBack}
                  className="flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest text-slate-400 flex items-center justify-center gap-2 transition-all hover:text-slate-200"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="submit" disabled={loading}
                  className="flex-[2] py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                    boxShadow:  loading ? 'none' : '0 8px 28px rgba(99,102,241,0.5)',
                    opacity:    loading ? 0.7 : 1,
                  }}>
                  {loading
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</>
                    : <>Create Gym <ArrowRight size={16} /></>}
                </button>
              </div>
            </form>
          )}

          {/* Already have account */}
          <p className="text-center mt-6">
            <button type="button" onClick={onShowLogin}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-300 transition-colors">
              Already have an account? Sign in →
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
