import React from 'react';
import { Users, ClipboardCheck, MessageSquare, UserPlus } from 'lucide-react';

function StaffDashboard({ navigateTo, currentUser, canAccessPage }) {
  const displayRole = String(currentUser?.staff_role || currentUser?.role || 'Staff')
    .toLowerCase()
    .replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());

  const canMembers = canAccessPage?.('Members') ?? true;
  const canAttendance = canAccessPage?.('Attendance') ?? true;
  const canSupport = canAccessPage?.('Help & Support') ?? true;

  const cardClass = (enabled) =>
    `p-5 rounded-2xl bg-white border text-left transition-all ${
      enabled
        ? 'border-slate-200 hover:border-indigo-300 hover:shadow-sm'
        : 'border-slate-100 opacity-55 cursor-not-allowed'
    }`;

  return (
    <div className="space-y-5">
      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-6">
        <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">Staff Workspace</p>
        <h2 className="text-2xl font-black text-slate-900 mt-1">Welcome, {currentUser?.full_name || 'Team Member'}</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Logged in as {displayRole}. This dashboard shows only your operational tools.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          disabled={!canMembers}
          onClick={() => navigateTo('Members', 'All')}
          className={cardClass(canMembers)}
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
            <Users size={18} />
          </div>
          <p className="text-sm font-black text-slate-900">View Members</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Search and manage member data.</p>
        </button>

        <button
          disabled={!canMembers}
          onClick={() => navigateTo('Members', 'All', { action: 'add' })}
          className={cardClass(canMembers)}
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
            <UserPlus size={18} />
          </div>
          <p className="text-sm font-black text-slate-900">Add Member</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Onboard a new member quickly.</p>
        </button>

        <button
          disabled={!canAttendance}
          onClick={() => navigateTo('Attendance')}
          className={cardClass(canAttendance)}
        >
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3">
            <ClipboardCheck size={18} />
          </div>
          <p className="text-sm font-black text-slate-900">Attendance</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Check-ins and activity records.</p>
        </button>

        <button
          disabled={!canSupport}
          onClick={() => navigateTo('Help & Support')}
          className={cardClass(canSupport)}
        >
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-3">
            <MessageSquare size={18} />
          </div>
          <p className="text-sm font-black text-slate-900">Help & Support</p>
          <p className="text-xs text-slate-500 font-medium mt-1">Raise issues and contact support.</p>
        </button>
      </div>
    </div>
  );
}

export default StaffDashboard;
