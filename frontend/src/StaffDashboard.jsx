import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, ClipboardCheck, MessageSquare, UserPlus, Target, CreditCard,
  CalendarDays, DollarSign, AlertTriangle, Clock, TrendingUp, UserCheck,
  BarChart3, Dumbbell, ShieldCheck, Bell
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

function StaffDashboard({ navigateTo, currentUser, canAccessPage, token }) {
  const displayRole = String(currentUser?.staff_role || currentUser?.role || 'Staff')
    .toLowerCase()
    .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const staffRole = String(currentUser?.staff_role || '').toUpperCase();
  const perms = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
  const hasPerm = (p) => perms.includes('*') || perms.includes(p) || perms.includes(p.split(':')[0]+':*');

  const canMembers = canAccessPage?.('Members') ?? true;
  const canAttendance = canAccessPage?.('Attendance') ?? true;
  const canSupport = canAccessPage?.('Help & Support') ?? true;
  const canPayments = canAccessPage?.('Payments') ?? true;
  const canLeads = canAccessPage?.('Leads') ?? true;
  const canClasses = canAccessPage?.('Classes') ?? true;
  const canInsights = canAccessPage?.('Insights') ?? false;

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${token}` };
      const [membersRes, attendanceRes] = await Promise.all([
        canMembers ? fetch(`${API}/api/members?limit=5&sort=joining_date&order=desc`, { headers }).then(r => r.json()).catch(() => null) : null,
        canAttendance ? fetch(`${API}/api/attendance/today-stats`, { headers }).then(r => r.json()).catch(() => null) : null,
      ]);
      setStats({
        todayCheckins: attendanceRes?.totalToday || attendanceRes?.total || 0,
        recentMembers: Array.isArray(membersRes?.data) ? membersRes.data.length : (Array.isArray(membersRes) ? membersRes.length : 0),
      });
    } catch { setStats(null); } finally { setLoading(false); }
  }, [token, canMembers, canAttendance]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const cardClass = (enabled) =>
    `p-4 rounded-2xl bg-white border text-left transition-all ${
      enabled
        ? 'border-slate-200 hover:border-indigo-300 hover:shadow-sm cursor-pointer'
        : 'border-slate-100 opacity-55 cursor-not-allowed'
    }`;

  // Role-specific quick actions
  const isReception = ['RECEPTION', 'MANAGER'].includes(staffRole) || hasPerm('members:write');
  const isTrainer = staffRole === 'TRAINER' || hasPerm('attendance:write');
  const isAccountant = staffRole === 'ACCOUNTANT' || hasPerm('payments:write');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">Staff Workspace</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">Welcome, {currentUser?.full_name || 'Team Member'}</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Logged in as <span className="text-indigo-600 font-bold">{displayRole}</span>&ensp;&middot;&ensp;{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
          </div>
          {stats && !loading && (
            <div className="flex gap-4">
              {canAttendance && (
                <div className="text-center">
                  <p className="text-2xl font-black text-indigo-600">{stats.todayCheckins}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Today Check-ins</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reception / Front-Desk Section */}
      {isReception && (
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-3 px-1">Front Desk</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button disabled={!canMembers} onClick={() => navigateTo('Members', 'All', { action: 'add' })} className={cardClass(canMembers)}>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2"><UserPlus size={16} /></div>
              <p className="text-sm font-bold text-slate-900">New Member</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Onboard & register</p>
            </button>
            <button disabled={!canLeads} onClick={() => navigateTo('Leads')} className={cardClass(canLeads)}>
              <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center mb-2"><Target size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Leads</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Walk-ins & follow-ups</p>
            </button>
            <button disabled={!canPayments} onClick={() => navigateTo('Payments')} className={cardClass(canPayments)}>
              <div className="w-9 h-9 rounded-xl bg-yellow-50 text-yellow-600 flex items-center justify-center mb-2"><DollarSign size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Collect Due</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Pending payments</p>
            </button>
            <button disabled={!canMembers} onClick={() => navigateTo('Members', 'Expiring Soon')} className={cardClass(canMembers)}>
              <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-2"><AlertTriangle size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Renewals</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Expiring memberships</p>
            </button>
          </div>
        </div>
      )}

      {/* Trainer Section */}
      {isTrainer && (
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-sky-400 mb-3 px-1">Trainer Tools</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button disabled={!canAttendance} onClick={() => navigateTo('Attendance')} className={cardClass(canAttendance)}>
              <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-2"><ClipboardCheck size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Check-In</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Mark attendance</p>
            </button>
            <button disabled={!canClasses} onClick={() => navigateTo('Classes')} className={cardClass(canClasses)}>
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-2"><CalendarDays size={16} /></div>
              <p className="text-sm font-bold text-slate-900">My Classes</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Schedule & bookings</p>
            </button>
            <button disabled={!canMembers} onClick={() => navigateTo('Members', 'Active')} className={cardClass(canMembers)}>
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2"><Users size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Members</p>
              <p className="text-[11px] text-slate-400 mt-0.5">View member list</p>
            </button>
            <button disabled={!canSupport} onClick={() => navigateTo('Help & Support')} className={cardClass(canSupport)}>
              <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-2"><MessageSquare size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Support</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Raise issues</p>
            </button>
          </div>
        </div>
      )}

      {/* Accountant Section */}
      {isAccountant && (
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-amber-400 mb-3 px-1">Finance Desk</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button disabled={!canPayments} onClick={() => navigateTo('Payments')} className={cardClass(canPayments)}>
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2"><CreditCard size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Collections</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Payments & overdue</p>
            </button>
            <button disabled={!canPayments} onClick={() => navigateTo('Payments')} className={cardClass(canPayments)}>
              <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-2"><AlertTriangle size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Overdue</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Pending collections</p>
            </button>
            {canInsights && (
              <button onClick={() => navigateTo('Insights')} className={cardClass(true)}>
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2"><BarChart3 size={16} /></div>
                <p className="text-sm font-bold text-slate-900">Reports</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Revenue insights</p>
              </button>
            )}
          </div>
        </div>
      )}

      {/* General Quick Actions (for all roles without specific sections) */}
      {!isReception && !isTrainer && !isAccountant && (
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 px-1">Quick Actions</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button disabled={!canMembers} onClick={() => navigateTo('Members', 'All')} className={cardClass(canMembers)}>
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2"><Users size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Members</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Search & manage</p>
            </button>
            <button disabled={!canAttendance} onClick={() => navigateTo('Attendance')} className={cardClass(canAttendance)}>
              <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-2"><ClipboardCheck size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Attendance</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Check-ins & records</p>
            </button>
            <button disabled={!canSupport} onClick={() => navigateTo('Help & Support')} className={cardClass(canSupport)}>
              <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-2"><MessageSquare size={16} /></div>
              <p className="text-sm font-bold text-slate-900">Support</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Raise issues</p>
            </button>
            {canClasses && (
              <button onClick={() => navigateTo('Classes')} className={cardClass(true)}>
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-2"><CalendarDays size={16} /></div>
                <p className="text-sm font-bold text-slate-900">Classes</p>
                <p className="text-[11px] text-slate-400 mt-0.5">View schedule</p>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StaffDashboard;
