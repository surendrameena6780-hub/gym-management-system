import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Dumbbell, Mail, Lock, ArrowRight, Eye, EyeOff,
  Users, TrendingUp, Layers, ChevronRight, Phone, CheckCircle
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

// ─── Full-screen Member Portal Dashboard (shown after OTP verification) ──────
function MemberPortalDashboard({ member, token, onSignOut }) {
  const [attendance, setAttendance] = useState([]);
  const [loadingAtt, setLoadingAtt] = useState(true);

  useEffect(() => {
    axios.get('/api/auth/member/attendance', { headers: { 'x-auth-token': token } })
      .then(res => setAttendance(res.data.attendance || []))
      .catch(() => {})
      .finally(() => setLoadingAtt(false));
  }, [token]);

  const toDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayStr = toDateStr(new Date());

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
    <div className="min-h-[100dvh] font-['Inter'] overflow-y-auto"
      style={{ background: 'linear-gradient(160deg, #060b14 0%, #090c18 100%)' }}>

      {/* Ambient blobs */}
      <div className="fixed -top-40 -left-40 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)', filter: 'blur(90px)' }} />
      <div className="fixed bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)', filter: 'blur(90px)' }} />

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between"
        style={{ background: 'rgba(6,11,20,0.88)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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

  // Member portal state
  const [phone, setPhone]           = useState('');
  const [otp, setOtp]               = useState('');
  const [otpSent, setOtpSent]       = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [firstName, setFirstName]   = useState('');
  const [memberData, setMemberData] = useState(null);
  const [memberToken, setMemberToken] = useState(null);

  // Read auth_error from OAuth redirect URL param
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const errCode = params.get('auth_error');
    if (!errCode) return;
    const msgs = {
      google_not_configured: 'Google Sign-In is not set up on this server. Use email & password.',
      google_cancelled:      'Google sign-in was cancelled.',
      google_token_failed:   'Google sign-in failed. Please try again.',
      account_suspended:     'Your account is suspended. Contact GymVault HQ.',
      server_error:          'A server error occurred. Please try again.',
    };
    setError(msgs[errCode] || 'Sign-in failed. Please try again.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // ── Owner email login ──────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
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

  const handleGoogle = () => { window.location.href = '/api/auth/google'; };

  const handleApple = () => {
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
    setOtpLoading(true); setError('');
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
    setOtpLoading(true); setError('');
    try {
      const res = await axios.post('/api/auth/member/verify-otp', { phone, otp });
      setMemberData(res.data.member);
      setMemberToken(res.data.token);
    } catch (err) { setError(err?.response?.data?.message || 'Invalid OTP. Please try again.'); }
    finally { setOtpLoading(false); }
  };

  const switchTab = (t) => { setTab(t); setError(''); setOtpSent(false); setOtp(''); setMemberData(null); setMemberToken(null); };

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
    <div className="min-h-[100dvh] flex font-['Inter'] overflow-hidden" style={{ background: '#060b14' }}>

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
              {LEFT_STATS.map(({ Icon, label, value, color, sub }, i) => (
                <div key={i}
                  className="flex items-center gap-4 p-4 rounded-2xl gv-auth-stat-card"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    animationDelay: `${i * 0.12}s`,
                  }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}18`, border: `1px solid ${color}28` }}>
                    <Icon size={17} style={{ color }} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-500 text-[11px] font-semibold mb-0.5">{label}</p>
                    <p className="text-white font-black text-[1.05rem] leading-none">{value}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 whitespace-nowrap"
                    style={{ background: `${color}14`, color }}>
                    {sub}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-slate-700 text-[11px] font-medium mt-8">
            © 2026 GymVault · Trusted by 1,000+ gyms across India
          </p>
        </div>
      </div>

      {/* ════════════════════ RIGHT PANEL — Form ════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col items-center justify-center p-5 md:p-12 overflow-y-auto"
        style={{ background: 'linear-gradient(170deg, #0c1120 0%, #090c18 100%)' }}
      >
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 6px 20px rgba(99,102,241,0.5)' }}>
            <Dumbbell size={18} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-black text-lg tracking-tight">GymVault</span>
        </div>

        <div className="w-full max-w-[390px]">

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

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <span className="text-slate-500 text-[11px] font-bold tracking-wide">or sign in with email</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
              </div>

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

          <p className="text-center text-slate-700 text-[10px] font-medium mt-8">
            Authorized Personnel Only &nbsp;·&nbsp; GymVault v2.0
          </p>
        </div>
      </div>
    </div>
  );
}

