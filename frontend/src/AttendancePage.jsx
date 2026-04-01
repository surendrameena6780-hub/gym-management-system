import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageLoader from './PageLoader';

function useCountUp(target, duration = 800) {
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
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Fingerprint,
  QrCode,
  Search,
  Shield,
  Smartphone,
  Users,
  MessageSquare,
} from 'lucide-react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const MODE_META = {
  STAFF: {
    label: 'Staff Check-In',
    icon: Users,
    desc: 'Reception marks attendance manually.',
    color: 'from-indigo-500 to-violet-500',
  },
  QR: {
    label: 'QR Code Check-In',
    icon: QrCode,
    desc: 'Member identity verified using QR flow.',
    color: 'from-emerald-500 to-teal-500',
  },
  SELF: {
    label: 'Self Check-In (Mobile)',
    icon: Smartphone,
    desc: 'Member checks in via app with location checks.',
    color: 'from-sky-500 to-blue-500',
  },
  RFID: {
    label: 'RFID / Biometric',
    icon: Fingerprint,
    desc: 'Hardware-triggered check-in with backend validation.',
    color: 'from-rose-500 to-pink-500',
  },
};

const methodBadge = (method) => {
  const key = String(method || 'STAFF').toUpperCase();
  const styles = {
    STAFF: 'bg-indigo-100 text-indigo-700',
    QR: 'bg-emerald-100 text-emerald-700',
    SELF: 'bg-sky-100 text-sky-700',
    RFID: 'bg-rose-100 text-rose-700',
  };
  return styles[key] || 'bg-slate-100 text-slate-700';
};

const statusBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (key === 'EXPIRED') return 'bg-rose-100 text-rose-700';
  if (key === 'UNPAID') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return `${date.toLocaleDateString('en-GB')} · ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

const unwrapApiData = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return unwrapApiData(payload.data);
  }
  return payload;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const asObject = (value, fallback = {}) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
);

const hasPermission = (user, permission) => {
  if (!permission) return true;
  if (!user) return false;
  if (String(user.role || '').toUpperCase() === 'OWNER') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;

  const [scope] = String(permission).split(':');
  return Boolean(scope && permissions.includes(`${scope}:*`));
};

function AttendancePage({ token, toast, isActive = true, currentUser = null }) {
  const headers = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);
  const isOwner = String(currentUser?.role || '').toUpperCase() === 'OWNER';
  const canWriteAttendance = hasPermission(currentUser, 'attendance:write');

  const [overview, setOverview] = useState({
    today_checkins: 0,
    yesterday_checkins: 0,
    active_members_today: 0,
    peak_hour_today: null,
    peak_hour_count: 0,
  });
  const [modeSettings, setModeSettings] = useState({
    attendance_mode: 'STAFF',
    attendance_geo_enabled: false,
    gym_latitude: '',
    gym_longitude: '',
    gym_radius_meters: 200,
    allow_expired_checkin: false,
  });

  const [loading, setLoading] = useState(true);
  const [busyCheckin, setBusyCheckin] = useState(false);
  const [busySaveMode, setBusySaveMode] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);

  const [checkinMethod, setCheckinMethod] = useState('STAFF');
  const [checkinNote, setCheckinNote] = useState('');

  const [feed, setFeed] = useState([]);
  const [records, setRecords] = useState([]);
  const [feedView, setFeedView] = useState('live');
  const [range, setRange] = useState('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [heatmap, setHeatmap] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [inactiveDays, setInactiveDays] = useState(7);
  const [inactiveMembers, setInactiveMembers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  const [warningState, setWarningState] = useState(null);

  const peakHourLabel = overview.peak_hour_today === null
    ? '—'
    : `${String(overview.peak_hour_today).padStart(2, '0')}:00`;

  const loadOverviewBundle = async () => {
    const [overviewRes, feedRes, heatmapRes, peakRes, modeRes] = await Promise.all([
      axios.get('/api/attendance/overview', headers),
      axios.get('/api/attendance/feed?limit=25', headers),
      axios.get('/api/attendance/heatmap?days=84', headers),
      axios.get('/api/attendance/peak-hours?days=30', headers),
      axios.get('/api/attendance/mode', headers),
    ]);

    setOverview(asObject(unwrapApiData(overviewRes.data), {}));
    setFeed(asArray(unwrapApiData(feedRes.data)));
    setHeatmap(asArray(unwrapApiData(heatmapRes.data)));
    setPeakHours(
      asArray(unwrapApiData(peakRes.data)).map((item) => ({
        hourLabel: `${String(item.hour).padStart(2, '0')}:00`,
        count: item.count || 0,
      }))
    );

    const modeData = asObject(unwrapApiData(modeRes.data), {});
    setModeSettings((prev) => ({
      ...prev,
      attendance_mode: modeData.attendance_mode || 'STAFF',
      attendance_geo_enabled: Boolean(modeData.attendance_geo_enabled),
      gym_latitude: modeData.gym_latitude ?? '',
      gym_longitude: modeData.gym_longitude ?? '',
      gym_radius_meters: modeData.gym_radius_meters || 200,
      allow_expired_checkin: Boolean(modeData.allow_expired_checkin),
    }));

    setCheckinMethod(modeData.attendance_mode || 'STAFF');
  };

  const loadRecords = async () => {
    let url = `/api/attendance/records?range=${range}`;
    if (range === 'custom' && fromDate && toDate) {
      url += `&from=${fromDate}&to=${toDate}`;
    }
    const res = await axios.get(url, headers);
    setRecords(asArray(unwrapApiData(res.data)));
  };

  const loadInactive = async () => {
    const res = await axios.get(`/api/attendance/inactive?days=${inactiveDays}`, headers);
    setInactiveMembers(asArray(unwrapApiData(res.data)));
  };

  const loadLeaderboard = async () => {
    const res = await axios.get('/api/attendance/leaderboard?days=30&limit=6', headers);
    setLeaderboard(asArray(unwrapApiData(res.data)));
  };

  const loadAll = async () => {
    if (!token) return;
    setLoading(true);
    try {
      await Promise.all([loadOverviewBundle(), loadRecords(), loadInactive(), loadLeaderboard()]);
    } catch (_err) {
      toast?.('Failed to load attendance dashboard.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadRecords().catch(() => toast?.('Failed to load attendance table.', 'error'));
  }, [range, fromDate, toDate]);

  useEffect(() => {
    if (!token) return;
    loadInactive().catch(() => toast?.('Failed to load inactive members.', 'error'));
  }, [inactiveDays]);

  useEffect(() => {
    if (!token) return;
    const q = searchText.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/attendance/search?q=${encodeURIComponent(q)}`, headers);
        setSearchResults(asArray(unwrapApiData(res.data)));
      } catch (_err) {
        setSearchResults([]);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [searchText, token]);

  const saveModeSettings = async () => {
    if (!isOwner) {
      toast?.('Only the gym owner can change attendance mode settings.', 'warning');
      return;
    }

    setBusySaveMode(true);
    try {
      await axios.put('/api/attendance/mode', modeSettings, headers);
      toast?.('Attendance mode settings saved.', 'success');
      await loadOverviewBundle();
    } catch (_err) {
      toast?.('Failed to save attendance mode settings.', 'error');
    } finally {
      setBusySaveMode(false);
    }
  };

  const submitCheckin = async (allowOverride = false) => {
    if (!canWriteAttendance) {
      toast?.('You do not have permission to check members in.', 'warning');
      return;
    }

    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyCheckin(true);
    try {
      const checkinPayload = {
        member_id: selectedMember.id,
        method: checkinMethod,
        notes: checkinNote,
        allow_override: allowOverride,
      };

      if (checkinMethod === 'SELF' && navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 });
          });
          checkinPayload.latitude = position.coords.latitude;
          checkinPayload.longitude = position.coords.longitude;
        } catch (_geoErr) {
          // Do not block submission if geo read fails; backend will decide by settings.
        }
      }

      const res = await axios.post('/api/attendance/checkin', checkinPayload, headers);
      const payload = asObject(unwrapApiData(res.data), {});
      if (payload.warning) {
        toast?.(payload.warning, 'warning');
      } else {
        toast?.(payload.message || 'Check-in successful!', 'success');
      }

      setWarningState(null);
      setCheckinNote('');
      await Promise.all([loadOverviewBundle(), loadRecords(), loadInactive(), loadLeaderboard()]);
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      const code = errorBody.code;
      if (code === 'ATTENDANCE_BLOCKED') {
        setWarningState({
          message: errorBody.message || errorBody.error || 'Membership is not active.',
          warning: errorBody.warning || '',
          member: errorBody.member || selectedMember,
        });
      } else {
        toast?.(errorBody.message || errorBody.error || 'Check-in failed.', 'error');
      }
    } finally {
      setBusyCheckin(false);
    }
  };

  const sendReminder = (member) => {
    const msg = `Hi ${member.full_name}, we missed you at the gym. It has been ${member.days_inactive} days since your last visit. Come back and continue your fitness streak!`;
    window.open(`https://wa.me/91${member.phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const weekdayPerformance = useMemo(() => {
    const totals = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, dayIndex) => ({
      label,
      dayIndex,
      total: 0,
      days: 0,
    }));

    heatmap.forEach((entry) => {
      const date = new Date(entry.date);
      if (Number.isNaN(date.getTime())) return;
      const bucket = totals[date.getDay()];
      bucket.total += Number(entry.count || 0);
      bucket.days += 1;
    });

    const enriched = totals.map((item) => ({
      ...item,
      avg: item.days > 0 ? Math.round((item.total / item.days) * 10) / 10 : 0,
    }));
    const maxTotal = Math.max(1, ...enriched.map((item) => item.total));

    return enriched
      .map((item) => ({
        ...item,
        width: Math.max(10, Math.round((item.total / maxTotal) * 100)),
      }))
      .sort((a, b) => b.total - a.total);
  }, [heatmap]);

  // Count-up animated values for stat cards (must be before any conditional return)
  const animatedTodayCheckins      = useCountUp(overview.today_checkins || 0);
  const animatedYesterdayCheckins  = useCountUp(overview.yesterday_checkins || 0);
  const animatedActiveMembersToday = useCountUp(overview.active_members_today || 0);
  const animatedPeakHourCount      = useCountUp(overview.peak_hour_count || 0);

  if (loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <div className="space-y-5 p-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Today's Check-ins</p>
          <h3 className="text-3xl font-black text-slate-900 mt-1">{animatedTodayCheckins}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Yesterday</p>
          <h3 className="text-3xl font-black text-slate-900 mt-1">{animatedYesterdayCheckins}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Members Today</p>
          <h3 className="text-3xl font-black text-emerald-600 mt-1">{animatedActiveMembersToday}</h3>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/70 p-4 gv-fade-up gv-fade-up-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Peak Hour Today</p>
          <h3 className="text-3xl font-black text-indigo-600 mt-1">{peakHourLabel}</h3>
          <p className="text-xs font-bold text-slate-400 mt-1">{animatedPeakHourCount} check-ins</p>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-indigo-500" />
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Attendance Mode</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Object.entries(MODE_META).map(([key, item]) => {
            const Icon = item.icon;
            const active = modeSettings.attendance_mode === key;
            return (
              <button
                key={key}
                disabled={!isOwner}
                onClick={() => {
                  setModeSettings((prev) => ({ ...prev, attendance_mode: key }));
                  setCheckinMethod(key);
                }}
                className={`text-left p-4 rounded-2xl border transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'border-indigo-400 bg-indigo-50/70' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
              >
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${item.color} text-white flex items-center justify-center mb-3`}>
                  <Icon size={17} />
                </div>
                <p className="text-sm font-black text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500 font-medium mt-1">{item.desc}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white">
            <span className="text-sm font-bold text-slate-700">Allow expired/unpaid override</span>
            <input
              type="checkbox"
              checked={modeSettings.allow_expired_checkin}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, allow_expired_checkin: e.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white">
            <span className="text-sm font-bold text-slate-700">Enable geo radius for SELF mode</span>
            <input
              type="checkbox"
              checked={modeSettings.attendance_geo_enabled}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, attendance_geo_enabled: e.target.checked }))}
            />
          </label>
        </div>

        {modeSettings.attendance_geo_enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <input
              type="number"
              step="0.000001"
              placeholder="Gym latitude"
              value={modeSettings.gym_latitude}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, gym_latitude: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            />
            <input
              type="number"
              step="0.000001"
              placeholder="Gym longitude"
              value={modeSettings.gym_longitude}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, gym_longitude: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            />
            <input
              type="number"
              min="50"
              placeholder="Radius meters"
              value={modeSettings.gym_radius_meters}
              disabled={!isOwner}
              onChange={(e) => setModeSettings((prev) => ({ ...prev, gym_radius_meters: e.target.value }))}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            />
          </div>
        )}

        <div className="mt-4">
          {!isOwner && <p className="mb-2 text-xs font-semibold text-slate-500">Attendance mode settings are view-only for staff accounts.</p>}
          <button
            onClick={saveModeSettings}
            disabled={busySaveMode || !isOwner}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-60"
          >
            {busySaveMode ? 'Saving...' : 'Save Mode Settings'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1 bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-3">Quick Check-In Panel</h3>

          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search member name / phone"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            />
          </div>

          {searchResults.length > 0 && (
            <div className="mb-3 border border-slate-200 rounded-xl max-h-44 overflow-y-auto">
              {searchResults.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedMember(m);
                    setSearchText(m.full_name);
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <p className="text-sm font-bold text-slate-900">{m.full_name}</p>
                  <p className="text-xs text-slate-500 font-medium">{m.phone} · {m.plan_name || 'No plan'}</p>
                </button>
              ))}
            </div>
          )}

          <div className="mb-3">
            <label className="text-xs font-bold text-slate-500">Method</label>
            <select
              value={checkinMethod}
              onChange={(e) => setCheckinMethod(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
            >
              <option value="STAFF">Staff</option>
              <option value="QR">QR</option>
              <option value="SELF">Self (Mobile)</option>
              <option value="RFID">RFID/Biometric</option>
            </select>
          </div>

          <textarea
            value={checkinNote}
            onChange={(e) => setCheckinNote(e.target.value)}
            rows={2}
            placeholder="Optional note"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold resize-none"
          />

          <div className="mt-4">
            <button
              onClick={() => submitCheckin(false)}
              disabled={!selectedMember || busyCheckin || !canWriteAttendance}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-black disabled:opacity-60"
            >
              {busyCheckin ? 'Checking in...' : 'Check In Member'}
            </button>
          </div>

          {selectedMember && (
            <div className="mt-4 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
              <p className="text-sm font-black text-slate-900 mb-2">Member Snapshot</p>
              <div className="space-y-1.5 text-xs font-semibold text-slate-600">
                <p><span className="text-slate-400">Name:</span> {selectedMember.full_name}</p>
                <p><span className="text-slate-400">Plan:</span> {selectedMember.plan_name || 'No active plan'}</p>
                <p><span className="text-slate-400">Status:</span> <span className={`px-1.5 py-0.5 rounded-full ml-1 ${statusBadge(selectedMember.membership_status)}`}>{selectedMember.membership_status || 'UNPAID'}</span></p>
                <p><span className="text-slate-400">Last Visit:</span> {selectedMember.last_visit ? formatDateTime(selectedMember.last_visit) : 'Never'}</p>
              </div>
            </div>
          )}
        </div>

        <div className="xl:col-span-2 bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Live Feed + Records</h3>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setFeedView('live')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-wider transition ${feedView === 'live' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Live
                </button>
                <button
                  onClick={() => setFeedView('records')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-wider transition ${feedView === 'records' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Records
                </button>
              </div>
              <button
                onClick={async () => {
                  await Promise.all([loadOverviewBundle(), loadRecords()]);
                }}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
              >
                Refresh
              </button>
            </div>
          </div>

          {feedView === 'live' ? (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {feed.length === 0 ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">No live check-ins yet.</div>
              ) : (
                feed.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between border border-slate-100 rounded-xl p-3 bg-white">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{entry.full_name}</p>
                      <p className="text-xs font-medium text-slate-500">{formatDateTime(entry.check_in_time)} {entry.staff_name ? `· Staff: ${entry.staff_name}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-black ${methodBadge(entry.checkin_method)}`}>{entry.checkin_method}</span>
                      {entry.was_override ? <span className="px-2 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">OVERRIDE</span> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2 justify-end mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={range} onChange={(e) => setRange(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold">
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="custom">Date Range</option>
                  </select>
                  {range === 'custom' && (
                    <>
                      <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                      <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="py-3 px-2">Member</th>
                      <th className="py-3 px-2">Check-In Time</th>
                      <th className="py-3 px-2">Plan</th>
                      <th className="py-3 px-2">Status</th>
                      <th className="py-3 px-2">Method</th>
                      <th className="py-3 px-2">Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-bold">No records found for selected range.</td>
                      </tr>
                    ) : (
                      records.map((row) => (
                        <tr key={row.id} className="border-b border-slate-50">
                          <td className="py-3 px-2 font-bold text-slate-900">{row.member_name}</td>
                          <td className="py-3 px-2 font-semibold text-slate-600">{formatDateTime(row.check_in_time)}</td>
                          <td className="py-3 px-2 font-semibold text-slate-700">{row.plan_name || '—'}</td>
                          <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-[10px] font-black ${statusBadge(row.membership_status)}`}>{row.membership_status || 'UNPAID'}</span></td>
                          <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-[10px] font-black ${methodBadge(row.checkin_method)}`}>{row.checkin_method}</span></td>
                          <td className="py-3 px-2 font-semibold text-slate-600">{row.staff_name || 'System'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Activity size={16} className="text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Peak Hour Analysis (30D)</h3>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">Hourly traffic and full weekday rankings stay accessible on every screen.</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px] gap-4">
          <div className="min-w-0 h-[240px] sm:h-[280px] xl:h-[260px]">
            {isActive ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ff" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />}
          </div>
          <div className="xl:hidden -mx-1 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-3 px-1">
              {weekdayPerformance.map((item, index) => (
                <div key={item.label} className="w-[148px] rounded-2xl border border-slate-100 bg-white p-3 shrink-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{index + 1} day</p>
                      <p className="text-sm font-black text-slate-900 truncate">{item.label}</p>
                    </div>
                    <p className="text-base font-black text-indigo-600 shrink-0">{item.total}</p>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${item.width}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="hidden xl:flex xl:flex-col xl:gap-2.5 xl:max-h-[260px] xl:overflow-y-auto xl:pr-1">
            {weekdayPerformance.map((item, index) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{index + 1} day</p>
                    <p className="text-sm font-black text-slate-900 truncate">{item.label}</p>
                  </div>
                  <p className="text-sm font-black text-indigo-600 shrink-0">{item.total}</p>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${item.width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Inactive Members (Retention Risk)</h3>
          <div className="flex items-center gap-2">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setInactiveDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${inactiveDays === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {inactiveMembers.length === 0 ? (
            <div className="col-span-full py-8 text-center text-slate-400 font-bold">No inactive active-members in this range.</div>
          ) : (
            inactiveMembers.map((m) => (
              <div key={m.id} className="p-3 rounded-xl border border-slate-100 bg-white flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{m.full_name}</p>
                  <p className="text-xs text-slate-500 font-medium truncate">{m.plan_name || 'No plan'} · {m.days_inactive} days inactive</p>
                </div>
                <button
                  onClick={() => sendReminder(m)}
                  className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-black hover:bg-emerald-100 flex items-center gap-1"
                >
                  <MessageSquare size={12} /> Remind
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-4">Engagement Leaderboard (30D)</h3>
        {leaderboard.length === 0 ? (
          <div className="py-6 text-center text-slate-400 font-bold text-sm">No leaderboard data yet.</div>
        ) : (
          <div className="space-y-2.5">
            {leaderboard.map((item, idx) => {
              const topVisits = Number(leaderboard[0]?.visits || 0);
              const itemVisits = Number(item.visits || 0);
              const widthPercent = topVisits > 0 ? Math.max(8, Math.round((itemVisits / topVisits) * 100)) : 8;

              return (
                <div key={item.id} className="p-3 rounded-xl border border-slate-100 bg-white gv-fade-up" style={{ animationDelay: `${Math.min(idx * 0.04, 0.25)}s` }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 text-xs font-black flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{item.full_name}</p>
                        <p className="text-xs text-slate-500 font-semibold">Last visit: {formatDateTime(item.last_check_in)}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-black text-indigo-600 leading-none">{itemVisits}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-1">visits</p>
                    </div>
                  </div>

                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${widthPercent}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {warningState && (
        <div className="app-modal-shell z-[220] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[24px] max-w-md w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-600 mb-2">
              <AlertTriangle size={18} />
              <p className="font-black">Membership Warning</p>
            </div>
            <p className="text-sm font-semibold text-slate-700">{warningState.message}</p>
            {warningState.warning ? <p className="text-xs text-slate-500 mt-2">{warningState.warning}</p> : null}

            <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600">
              <p><span className="text-slate-400">Member:</span> {warningState.member?.full_name}</p>
              <p><span className="text-slate-400">Status:</span> {warningState.member?.membership_status || 'UNPAID'}</p>
              <p><span className="text-slate-400">Plan:</span> {warningState.member?.plan_name || 'No plan'}</p>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setWarningState(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-sm font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitCheckin(true)}
                disabled={!canWriteAttendance}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-black hover:bg-amber-600"
              >
                Override Check-In
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AttendancePage;
