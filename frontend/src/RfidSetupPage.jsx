import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ArrowLeft,
  Copy,
  Fingerprint,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
} from 'lucide-react';
import PageLoader from './PageLoader';

const asArray = (value) => (Array.isArray(value) ? value : []);

const asObject = (value, fallback = {}) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
);

const unwrapApiData = (payload) => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return unwrapApiData(payload.data);
  }
  return payload;
};

const statusBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (key === 'EXPIRED') return 'bg-rose-100 text-rose-700';
  if (key === 'UNPAID') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

const eventBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'ACCEPTED') return 'bg-emerald-100 text-emerald-700';
  if (key === 'UNKNOWN_TAG') return 'bg-amber-100 text-amber-700';
  if (key === 'REJECTED') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-GB')} · ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

const formatRelativeTime = (value) => {
  if (!value) return 'No heartbeat yet';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown';

  const diffMinutes = Math.round((timestamp - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return formatter.format(diffDays, 'day');

  return formatDateTime(value);
};

const maskSensitiveValue = (value, { visibleStart = 2, visibleEnd = 4 } = {}) => {
  const text = String(value || '').trim();
  if (!text) return '—';
  if (text.length <= visibleStart + visibleEnd) return text;
  return `${text.slice(0, visibleStart)}••••${text.slice(-visibleEnd)}`;
};

const buildRfidSimulatorCommand = (device, sharedSecret) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const serial = device?.reader_serial || '<reader-serial>';
  const key = sharedSecret || '<reader-key>';
  return `node scripts/rfid-bridge-simulator.js --api ${origin} --serial ${serial} --key ${key}`;
};

function RfidSetupPage({ appRuntime, navigateBack }) {
  const { token, toast, currentUser = null } = appRuntime;
  const headers = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);
  const isOwner = String(currentUser?.role || '').toUpperCase() === 'OWNER';

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [rfidDevices, setRfidDevices] = useState([]);
  const [rfidEvents, setRfidEvents] = useState([]);
  const [rfidProvisioning, setRfidProvisioning] = useState(null);
  const [rfidForm, setRfidForm] = useState({ reader_name: '', reader_serial: '', reader_location: '' });
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [tagPairInput, setTagPairInput] = useState('');

  const activeReaders = useMemo(
    () => rfidDevices.filter((device) => String(device.status || '').toUpperCase() === 'ACTIVE').length,
    [rfidDevices]
  );

  const latestRfidEvent = rfidEvents[0] || null;

  const copyText = useCallback(async (value, successMessage, errorMessage) => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      toast?.(errorMessage || 'Copy is not available on this device.', 'warning');
      return false;
    }

    try {
      await navigator.clipboard.writeText(String(value));
      toast?.(successMessage || 'Copied.', 'success');
      return true;
    } catch (_err) {
      toast?.(errorMessage || 'Could not copy.', 'warning');
      return false;
    }
  }, [toast]);

  const loadSetupData = useCallback(async () => {
    if (!token) return;

    const [devicesRes, eventsRes] = await Promise.all([
      axios.get('/api/attendance/rfid/devices', headers),
      axios.get('/api/attendance/rfid/events?limit=16', headers),
    ]);

    setRfidDevices(asArray(unwrapApiData(devicesRes.data)));
    setRfidEvents(asArray(unwrapApiData(eventsRes.data)));
  }, [headers, token]);

  useEffect(() => {
    if (!token) return;

    let ignore = false;
    const run = async () => {
      setLoading(true);
      try {
        await loadSetupData();
      } catch (_err) {
        if (!ignore) toast?.('Failed to load RFID setup.', 'error');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    run();
    return () => { ignore = true; };
  }, [token, loadSetupData, toast]);

  useEffect(() => {
    if (!selectedMember?.id) {
      setTagPairInput('');
      return;
    }

    setTagPairInput(selectedMember.rfid_tag_id || '');
  }, [selectedMember?.id, selectedMember?.rfid_tag_id]);

  useEffect(() => {
    if (!token) return;
    const query = searchText.trim();

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/attendance/search?q=${encodeURIComponent(query)}`, headers);
        setSearchResults(asArray(unwrapApiData(res.data)));
      } catch (_err) {
        setSearchResults([]);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [searchText, headers, token]);

  const createReader = async (e) => {
    if (e) e.preventDefault();
    if (!isOwner) return;

    const payload = {
      reader_name: rfidForm.reader_name.trim(),
      reader_serial: rfidForm.reader_serial.trim(),
      reader_location: rfidForm.reader_location.trim(),
    };

    if (!payload.reader_name || !payload.reader_serial) {
      toast?.('Reader name and serial are required.', 'warning');
      return;
    }

    setBusyAction(true);
    try {
      const res = await axios.post('/api/attendance/rfid/devices', payload, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setRfidForm({ reader_name: '', reader_serial: '', reader_location: '' });
      setRfidProvisioning({ ...(body.device || {}), shared_secret: body.shared_secret || '' });
      toast?.('RFID reader registered. Save the shared key now.', 'success');
      await loadSetupData();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to register RFID reader.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const updateReaderStatus = async (device, status) => {
    if (!device?.id || !isOwner) return;

    setBusyAction(true);
    try {
      await axios.put(`/api/attendance/rfid/devices/${device.id}`, { status }, headers);
      toast?.(`Reader marked ${String(status || '').toLowerCase()}.`, 'success');
      await loadSetupData();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to update reader status.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const rotateReaderKey = async (device) => {
    if (!device?.id || !isOwner) return;

    setBusyAction(true);
    try {
      const res = await axios.post(`/api/attendance/rfid/devices/${device.id}/rotate-secret`, {}, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setRfidProvisioning({ ...(body.device || device), shared_secret: body.shared_secret || '' });
      toast?.('Reader key rotated. Update the bridge with the new key.', 'success');
      await loadSetupData();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to rotate reader key.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const pairSelectedMemberTag = async (e) => {
    if (e) e.preventDefault();
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    const nextTag = tagPairInput.trim();
    if (!nextTag) {
      toast?.('Enter the card or tag number first.', 'warning');
      return;
    }

    setBusyAction(true);
    try {
      const res = await axios.post('/api/attendance/rfid/pair-member', {
        member_id: selectedMember.id,
        tag_id: nextTag,
      }, headers);
      const body = asObject(unwrapApiData(res.data), {});
      const pairedTag = body.tag_id || nextTag;
      setSelectedMember((prev) => (prev ? { ...prev, rfid_tag_id: pairedTag } : prev));
      setTagPairInput(pairedTag);
      toast?.(body.message || 'RFID tag paired successfully.', 'success');
      await loadSetupData();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to pair RFID tag.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const unpairSelectedMemberTag = async () => {
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyAction(true);
    try {
      const res = await axios.post('/api/attendance/rfid/unpair-member', {
        member_id: selectedMember.id,
      }, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setSelectedMember((prev) => (prev ? { ...prev, rfid_tag_id: null } : prev));
      setTagPairInput('');
      toast?.(body.message || 'RFID tag removed.', 'success');
      await loadSetupData();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to remove RFID tag.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  if (loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <div className="space-y-5 p-2">
      <div className="rounded-[28px] border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-6 text-white shadow-[0_25px_80px_-35px_rgba(15,23,42,0.9)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-rose-200">
              <Fingerprint size={12} /> RFID Setup
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white">RFID Ready Kit</h1>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-200">
              Keep the setup isolated from daily attendance operations. Register readers, pair cards, and prepare the bridge packet now so the actual machine hookup later is mostly hardware wiring.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => loadSetupData().catch(() => toast?.('Failed to refresh RFID setup.', 'error'))}
              disabled={busyAction}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              onClick={navigateBack}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              <ArrowLeft size={14} /> Back to Attendance
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 desktop:grid-cols-3 gap-4">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Readers Registered</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{rfidDevices.length}</p>
          <p className="mt-2 text-sm font-semibold text-slate-600">Each gate or lane gets its own serial and secret.</p>
        </div>

        <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Active Readers</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{activeReaders}</p>
          <p className="mt-2 text-sm font-semibold text-slate-700">Paused readers stay provisioned without validating scans.</p>
        </div>

        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-rose-600">Last Gate Event</p>
          <p className="mt-2 text-lg font-black text-slate-900">{latestRfidEvent ? formatRelativeTime(latestRfidEvent.event_timestamp) : 'Awaiting first tap'}</p>
          <p className="mt-2 text-sm font-semibold text-slate-700">{latestRfidEvent ? latestRfidEvent.reader_name || 'RFID reader' : 'Events will appear here once the bridge starts sending scans.'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] gap-5">
        <div className="space-y-5 min-w-0">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">Reader Registry</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">Create gate identities now. Later, the hardware bridge only needs the machine protocol.</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                <ShieldCheck size={12} /> Owner Setup
              </div>
            </div>

            <form onSubmit={createReader} className="grid grid-cols-1 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-3 items-end">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Reader Name</label>
                <input
                  type="text"
                  value={rfidForm.reader_name}
                  onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_name: e.target.value }))}
                  placeholder="Main Gate"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Reader Serial</label>
                <input
                  type="text"
                  value={rfidForm.reader_serial}
                  onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_serial: e.target.value }))}
                  placeholder="GATE-01"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Location</label>
                <input
                  type="text"
                  value={rfidForm.reader_location}
                  onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_location: e.target.value }))}
                  placeholder="Reception turnstile"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <button
                type="submit"
                disabled={busyAction || !isOwner}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.22em] text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busyAction ? 'Saving...' : 'Register'}
              </button>
            </form>
          </div>

          <div className="space-y-3">
            {rfidDevices.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center shadow-sm">
                <p className="text-lg font-black text-slate-900">No RFID readers registered yet.</p>
                <p className="mt-2 text-sm font-semibold text-slate-600">Create them now so the real machine can be connected later without product changes.</p>
              </div>
            ) : (
              rfidDevices.map((device) => {
                const statusKey = String(device.status || '').toUpperCase();
                const statusTone = statusKey === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-700'
                  : statusKey === 'PAUSED'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-200 text-slate-700';

                return (
                  <div key={device.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-black text-slate-900 truncate">{device.reader_name}</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-600">Serial: {device.reader_serial}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-600">Location: {device.reader_location || 'Not set yet'}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusTone}`}>{statusKey || 'ACTIVE'}</span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Heartbeat</p>
                        <p className="mt-1 text-sm font-black text-slate-900">{formatRelativeTime(device.last_heartbeat)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Created</p>
                        <p className="mt-1 text-sm font-black text-slate-900">{formatDateTime(device.created_at)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <select
                        value={statusKey || 'ACTIVE'}
                        disabled={busyAction || !isOwner}
                        onChange={(e) => updateReaderStatus(device, e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-700 disabled:opacity-60"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="PAUSED">Paused</option>
                        <option value="DISABLED">Disabled</option>
                      </select>

                      <button
                        onClick={() => rotateReaderKey(device)}
                        disabled={busyAction || !isOwner}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        Rotate Key
                      </button>

                      <button
                        onClick={() => copyText(device.reader_serial, 'Reader serial copied.', 'Could not copy reader serial.')}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50"
                      >
                        Copy Serial
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-5 min-w-0">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Search size={16} className="text-slate-400" />
              <div>
                <h2 className="text-lg font-black text-slate-900">Card Pairing Desk</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">Find a member here, then pair or replace their RFID card without touching the daily attendance screen.</p>
              </div>
            </div>

            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search member name, phone, or email"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
              />
            </div>

            {searchResults.length > 0 && (
              <div className="mb-4 max-h-48 overflow-y-auto rounded-2xl border border-slate-200 bg-white">
                {searchResults.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => {
                      setSelectedMember(member);
                      setSearchText(member.full_name || '');
                      setSearchResults([]);
                    }}
                    className="w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 last:border-b-0"
                  >
                    <p className="text-sm font-black text-slate-900">{member.full_name}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{member.phone || member.email || 'No contact'} · {member.plan_name || 'No active plan'}</p>
                  </button>
                ))}
              </div>
            )}

            {selectedMember ? (
              <form onSubmit={pairSelectedMemberTag} className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-black text-slate-900">{selectedMember.full_name}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">{selectedMember.plan_name || 'No active plan'}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusBadge(selectedMember.membership_status)}`}>{selectedMember.membership_status || 'UNPAID'}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-600">Current tag: <span className="font-black text-slate-900">{selectedMember.rfid_tag_id ? maskSensitiveValue(selectedMember.rfid_tag_id, { visibleStart: 3, visibleEnd: 3 }) : 'Not paired yet'}</span></p>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Tag / Card Number</label>
                  <input
                    type="text"
                    value={tagPairInput}
                    onChange={(e) => setTagPairInput(e.target.value)}
                    placeholder="Enter UID or printed card number"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={busyAction}
                    className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {busyAction ? 'Saving...' : selectedMember.rfid_tag_id ? 'Replace Tag' : 'Pair Tag'}
                  </button>
                  <button
                    type="button"
                    onClick={unpairSelectedMemberTag}
                    disabled={busyAction || !selectedMember.rfid_tag_id}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Remove Tag
                  </button>
                  {selectedMember.rfid_tag_id && (
                    <button
                      type="button"
                      onClick={() => copyText(selectedMember.rfid_tag_id, 'RFID tag copied.', 'Could not copy RFID tag.')}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50"
                    >
                      Copy Current Tag
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <p className="text-sm font-black text-slate-900">Search for a member to pair their RFID card.</p>
                <p className="mt-2 text-sm font-semibold text-slate-600">This keeps the pairing workflow separate from front-desk attendance.</p>
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-700 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 text-white shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-black text-white">Bridge Provision Packet</h2>
                <p className="mt-1 text-sm font-semibold text-slate-300">Use this once the gate vendor details arrive. The simulator already matches your backend contract.</p>
              </div>
              <ScanLine size={18} className="text-rose-300 shrink-0" />
            </div>

            {rfidProvisioning?.shared_secret ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Reader</p>
                  <p className="mt-2 text-base font-black text-white">{rfidProvisioning.reader_name || 'RFID Reader'} · {rfidProvisioning.reader_serial}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-200">Shared key:</p>
                  <p className="mt-1 break-all font-mono text-xs font-bold text-rose-100">{rfidProvisioning.shared_secret}</p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Simulator Command</p>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] font-semibold text-slate-100">{buildRfidSimulatorCommand(rfidProvisioning, rfidProvisioning.shared_secret)}</pre>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => copyText(rfidProvisioning.shared_secret, 'Shared key copied.', 'Could not copy shared key.')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-900 hover:bg-slate-100"
                  >
                    <Copy size={12} /> Copy Shared Key
                  </button>
                  <button
                    onClick={() => copyText(buildRfidSimulatorCommand(rfidProvisioning, rfidProvisioning.shared_secret), 'Simulator command copied.', 'Could not copy simulator command.')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white hover:bg-white/10"
                  >
                    <Copy size={12} /> Copy Command
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-5 text-sm font-semibold text-slate-200">
                Create a reader or rotate a reader key to generate the one-time shared secret packet. That packet is what your future gate bridge will use.
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">Recent RFID Events</h2>
                <p className="mt-1 text-sm font-semibold text-slate-600">Accepted, blocked, and unknown-tag events will land here when the real bridge starts posting scans.</p>
              </div>
            </div>

            {rfidEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-600">
                No RFID events yet. That is expected until the hardware bridge is connected.
              </div>
            ) : (
              <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
                {rfidEvents.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black text-slate-900">{event.member_name || 'Unknown tag attempt'}</p>
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${eventBadge(event.event_status)}`}>{event.event_status || 'RECEIVED'}</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-slate-600">Reader: {event.reader_name || event.reader_serial || 'RFID reader'} · Tag: {maskSensitiveValue(event.tag_id, { visibleStart: 3, visibleEnd: 3 })}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-600">{event.response_message || 'Awaiting processing.'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-black text-slate-900">{formatDateTime(event.event_timestamp)}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{event.membership_status || 'UNPAID'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RfidSetupPage;