import React, { useState } from 'react';
import axios from 'axios';
import { ShieldAlert, KeyRound, ArrowRight } from 'lucide-react';

function SuperAdminLogin({ setSuperToken }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/superadmin/login', { password });
      setSuperToken(res.data.token);
    } catch (err) {
      if (window.location.pathname !== '/hq-admin') {
        window.history.replaceState({}, '', '/hq-admin');
      }
      const status = err?.response?.status;
      if (status === 401) {
        setError('Wrong HQ password. Please try again.');
      } else {
        setError(err.response?.data?.message || 'HQ access is unavailable right now.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-min-shell-height flex items-center justify-center font-['Inter'] bg-[#050505] relative overflow-hidden" style={{ paddingTop: 'var(--safe-area-top)' }}>
      {/* Red/Gold HQ ambient glow */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(225,29,72,0.15) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,119,6,0.1) 0%, transparent 70%)', filter: 'blur(40px)' }} />

      <div className="relative w-full max-w-sm mx-4 p-10 rounded-[32px] overflow-hidden"
        style={{
          background: 'rgba(20,20,20,0.6)',
          backdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.05)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)'
        }}>
        
        <div className="flex flex-col items-center mb-8 relative">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg, #e11d48 0%, #b45309 100%)', boxShadow: '0 8px 32px rgba(225,29,72,0.3)' }}>
            <ShieldAlert size={26} className="text-white" strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">HQ Command</h2>
          <p className="text-rose-500/80 text-xs font-bold mt-1.5 uppercase tracking-widest">Master Authorization</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <div className="relative">
              <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                required
                type="password"
                placeholder="Enter Master Password"
                className="w-full pl-11 pr-4 py-3.5 rounded-xl text-white placeholder-slate-600 outline-none transition-all font-medium text-sm text-center tracking-widest"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => { e.target.style.borderColor = 'rgba(225,29,72,0.5)'; }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            disabled={loading}
            className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest text-white transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #e11d48 0%, #9f1239 100%)', boxShadow: '0 8px 32px rgba(225,29,72,0.25)' }}
          >
            {loading ? 'Verifying...' : 'Authorize'} <ArrowRight size={16} />
          </button>

          {import.meta.env.DEV && (
            <p className="text-center text-[11px] font-semibold text-slate-500">
              Local dev hint: if no MASTER_PASSWORD is set, use <span className="text-rose-400">admin123</span>.
            </p>
          )}

          <p className="text-center text-[11px] font-semibold text-slate-500">
            Forgot HQ password? Set a new <span className="text-rose-400">MASTER_PASSWORD</span> in Render env and redeploy.
          </p>
        </form>
      </div>
    </div>
  );
}

export default SuperAdminLogin;