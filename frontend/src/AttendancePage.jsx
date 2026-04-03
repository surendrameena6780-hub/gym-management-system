import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageLoader from './PageLoader';
import { QRCodeCanvas } from 'qrcode.react';
import { openWhatsAppConversation } from './utils/externalNavigation';

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
  Copy,
  Fingerprint,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Shield,
  Smartphone,
  Users,
  MessageSquare,
  X,
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

const formatRelativeTime = (value) => {
  if (!value) return 'No heartbeat yet';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown';

  const diffMinutes = Math.round((timestamp - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return formatter.format(diffDays, 'day');
  }

  return formatDateTime(value);
};

const maskSensitiveValue = (value, { visibleStart = 2, visibleEnd = 4 } = {}) => {
  const text = String(value || '').trim();
  if (!text) return '—';
  if (text.length <= visibleStart + visibleEnd) return text;
  return `${text.slice(0, visibleStart)}••••${text.slice(-visibleEnd)}`;
};

const rfidEventBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'ACCEPTED') return 'bg-emerald-100 text-emerald-700';
  if (key === 'UNKNOWN_TAG') return 'bg-amber-100 text-amber-700';
  if (key === 'REJECTED') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-700';
};

const buildRfidSimulatorCommand = (device, sharedSecret) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const serial = device?.reader_serial || '<reader-serial>';
  const key = sharedSecret || '<reader-key>';
  return `node scripts/rfid-bridge-simulator.js --api ${origin} --serial ${serial} --key ${key}`;
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
  const canReadAttendance = hasPermission(currentUser, 'attendance:read');
  const canWriteAttendance = hasPermission(currentUser, 'attendance:write');
  const canManageMembers = hasPermission(currentUser, 'members:write');
  const qrScannerRef = useRef(null);
  const qrScannerBusyRef = useRef(false);

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
  const [peakHoursDays, setPeakHoursDays] = useState('today');
  const [inactiveDays, setInactiveDays] = useState(7);
  const [inactiveMembers, setInactiveMembers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  const [warningState, setWarningState] = useState(null);
  const [qrModalState, setQrModalState] = useState(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScannerBooting, setQrScannerBooting] = useState(false);
  const [busyQrAction, setBusyQrAction] = useState(false);
  const [rfidDevices, setRfidDevices] = useState([]);
  const [rfidEvents, setRfidEvents] = useState([]);
  const [busyRfidAction, setBusyRfidAction] = useState(false);
  const [rfidProvisioning, setRfidProvisioning] = useState(null);
  const [rfidForm, setRfidForm] = useState({ reader_name: '', reader_serial: '', reader_location: '' });
  const [tagPairInput, setTagPairInput] = useState('');

  const peakHourLabel = overview.peak_hour_today === null
    ? '—'
    : `${String(overview.peak_hour_today).padStart(2, '0')}:00`;

  const activeRfidReaders = useMemo(
    () => rfidDevices.filter((device) => String(device.status || '').toUpperCase() === 'ACTIVE').length,
    [rfidDevices]
  );
  const latestRfidEvent = rfidEvents[0] || null;

  const refreshAttendanceViews = () => Promise.all([
    loadOverviewBundle(),
    loadPeakHours(peakHoursDays),
    loadRecords(),
    loadInactive(),
    loadLeaderboard(),
    canReadAttendance ? loadRfidSetup() : Promise.resolve(),
  ]);

  const handleCheckinSuccess = (payload, fallbackMember = null, fallbackMethod = null) => {
    const body = asObject(payload, {});
    const detail = asObject(body.details, {});
    const member = asObject(body.member, fallbackMember || {});
    const methodUsed = detail.checkin_method || fallbackMethod || checkinMethod;

    if (body.warning) {
      toast?.(body.warning, 'warning');
    } else {
      toast?.(body.message || 'Check-in successful!', 'success');
    }

    setWarningState(null);
    setCheckinNote('');

    if (member?.id) {
      setSelectedMember(member);
      setSearchText(member.full_name || '');
      setSearchResults([]);
    }

    if (member?.full_name) {
      setFeed((prev) => [{
        id: detail.id || `opt-${Date.now()}`,
        full_name: member.full_name,
        check_in_time: detail.check_in_time || new Date().toISOString(),
        checkin_method: methodUsed,
        staff_name: detail.staff_name || currentUser?.full_name || currentUser?.name || null,
        was_override: Boolean(detail.was_override),
      }, ...prev].slice(0, 25));
    }

    setOverview((prev) => ({
      ...prev,
      today_checkins: (Number(prev.today_checkins) || 0) + 1,
      active_members_today: (Number(prev.active_members_today) || 0) + 1,
    }));

    refreshAttendanceViews().catch(() => {});
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'attendance' } }));
  };

  const copyText = async (value, successMessage, errorMessage) => {
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
  };

  const copyQrToken = async () => {
    if (!qrModalState?.token) return;
    copyText(qrModalState.token, 'QR token copied.', 'Could not copy QR token.');
  };

  const openMemberQr = async () => {
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyQrAction(true);
    setCheckinMethod('QR');
    try {
      const res = await axios.get(`/api/attendance/qr/member/${selectedMember.id}`, headers);
      const payload = asObject(unwrapApiData(res.data), {});
      setQrModalState({
        type: 'member',
        title: 'Member QR Pass',
        subtitle: 'Show this at reception so staff can scan and verify your membership instantly.',
        token: payload.token || '',
        expiresAt: payload.expires_at,
        accent: 'emerald',
        meta: payload.member || selectedMember,
      });
    } catch (_err) {
      toast?.('Failed to generate member QR.', 'error');
    } finally {
      setBusyQrAction(false);
    }
  };

  const openGymQr = async () => {
    setBusyQrAction(true);
    setCheckinMethod('QR');
    try {
      const res = await axios.get('/api/attendance/qr/gym', headers);
      const payload = asObject(unwrapApiData(res.data), {});
      setQrModalState({
        type: 'gym',
        title: 'Gym Self Check-In QR',
        subtitle: 'Members can scan this from the member portal to check in without reception help.',
        token: payload.token || '',
        expiresAt: payload.expires_at,
        accent: 'indigo',
        meta: payload.gym || {},
      });
    } catch (_err) {
      toast?.('Failed to generate gym QR.', 'error');
    } finally {
      setBusyQrAction(false);
    }
  };

  const submitScannedQr = async (decodedText) => {
    setBusyQrAction(true);
    setCheckinMethod('QR');
    try {
      const res = await axios.post('/api/attendance/checkin/qr', {
        token: decodedText,
        notes: checkinNote,
      }, headers);
      handleCheckinSuccess(unwrapApiData(res.data), null, 'QR');
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      if (errorBody.code === 'ATTENDANCE_BLOCKED') {
        if (errorBody.member?.id) {
          setSelectedMember(errorBody.member);
          setSearchText(errorBody.member.full_name || '');
          setSearchResults([]);
        }
        setWarningState({
          message: errorBody.message || errorBody.error || 'Membership is not active.',
          warning: errorBody.warning || '',
          member: errorBody.member || selectedMember,
        });
      } else {
        toast?.(errorBody.message || errorBody.error || 'QR check-in failed.', 'error');
      }
    } finally {
      setBusyQrAction(false);
    }
  };

  const loadOverviewBundle = async () => {
    const [overviewRes, feedRes, heatmapRes, modeRes] = await Promise.all([
      axios.get('/api/attendance/overview', headers),
      axios.get('/api/attendance/feed?limit=25', headers),
      axios.get('/api/attendance/heatmap?days=84', headers),
      axios.get('/api/attendance/mode', headers),
    ]);

    setOverview(asObject(unwrapApiData(overviewRes.data), {}));
    setFeed(asArray(unwrapApiData(feedRes.data)));
    setHeatmap(asArray(unwrapApiData(heatmapRes.data)));

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

  const loadPeakHours = async (period) => {
    const url = period === 'today'
      ? '/api/attendance/peak-hours?today=true'
      : `/api/attendance/peak-hours?days=${period}`;
    const res = await axios.get(url, headers);
    setPeakHours(
      asArray(unwrapApiData(res.data)).map((item) => ({
        hourLabel: `${String(item.hour).padStart(2, '0')}:00`,
        count: item.count || 0,
      }))
    );
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

  const loadRfidSetup = async () => {
    if (!canReadAttendance) {
      setRfidDevices([]);
      setRfidEvents([]);
      return;
    }

    if (isOwner) {
      const [devicesRes, eventsRes] = await Promise.all([
        axios.get('/api/attendance/rfid/devices', headers),
        axios.get('/api/attendance/rfid/events?limit=12', headers),
      ]);
      setRfidDevices(asArray(unwrapApiData(devicesRes.data)));
      setRfidEvents(asArray(unwrapApiData(eventsRes.data)));
      return;
    }

    const eventsRes = await axios.get('/api/attendance/rfid/events?limit=12', headers);
    setRfidDevices([]);
    setRfidEvents(asArray(unwrapApiData(eventsRes.data)));
  };

  const loadAll = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const tasks = [loadOverviewBundle(), loadPeakHours(peakHoursDays), loadRecords(), loadInactive(), loadLeaderboard()];
      if (canReadAttendance) tasks.push(loadRfidSetup());
      await Promise.all(tasks);
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
    if (!selectedMember?.id) {
      setTagPairInput('');
      return;
    }

    setTagPairInput(selectedMember.rfid_tag_id || '');
  }, [selectedMember?.id, selectedMember?.rfid_tag_id]);

  useEffect(() => {
    if (!token) return;
    loadPeakHours(peakHoursDays);
  }, [peakHoursDays]);

  useEffect(() => {
    if (!token) return;
    loadRecords().catch(() => toast?.('Failed to load attendance table.', 'error'));
  }, [range, fromDate, toDate]);

  useEffect(() => {
    if (!token) return;
    loadInactive().catch(() => toast?.('Failed to load inactive members.', 'error'));
  }, [inactiveDays]);

  useEffect(() => {
    if (!token || !canReadAttendance) return;
    loadRfidSetup().catch(() => {});
  }, [token, canReadAttendance, isOwner]);

  useEffect(() => {
    if (!qrScannerOpen) return undefined;

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
      setQrScannerBooting(true);
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode('attendance-staff-qr-reader');
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1 },
          async (decodedText) => {
            if (qrScannerBusyRef.current) return;
            qrScannerBusyRef.current = true;
            await stopScanner();
            if (!cancelled) {
              setQrScannerBooting(false);
              setQrScannerOpen(false);
            }
            await submitScannedQr(decodedText);
            qrScannerBusyRef.current = false;
          },
          () => {}
        );

        if (!cancelled) {
          setQrScannerBooting(false);
        }
      } catch (_err) {
        await stopScanner();
        if (!cancelled) {
          setQrScannerBooting(false);
          setQrScannerOpen(false);
          toast?.('Unable to start QR scanner. Check camera permission and try again.', 'error');
        }
      }
    };

    bootScanner();

    return () => {
      cancelled = true;
      qrScannerBusyRef.current = false;
      setQrScannerBooting(false);
      stopScanner();
    };
  }, [qrScannerOpen, token]);

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
  }, [searchText, headers]);

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

  const createRfidReader = async (e) => {
    if (e) e.preventDefault();
    if (!isOwner) {
      toast?.('Only the gym owner can register RFID readers.', 'warning');
      return;
    }

    const payload = {
      reader_name: rfidForm.reader_name.trim(),
      reader_serial: rfidForm.reader_serial.trim(),
      reader_location: rfidForm.reader_location.trim(),
    };

    if (!payload.reader_name || !payload.reader_serial) {
      toast?.('Reader name and serial are required.', 'warning');
      return;
    }

    setBusyRfidAction(true);
    try {
      const res = await axios.post('/api/attendance/rfid/devices', payload, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setRfidForm({ reader_name: '', reader_serial: '', reader_location: '' });
      setRfidProvisioning({ ...(body.device || {}), shared_secret: body.shared_secret || '' });
      toast?.('RFID reader registered. Save the shared key now.', 'success');
      await loadRfidSetup();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to register RFID reader.', 'error');
    } finally {
      setBusyRfidAction(false);
    }
  };

  const updateRfidReaderStatus = async (device, status) => {
    if (!device?.id || !isOwner) return;
    setBusyRfidAction(true);
    try {
      await axios.put(`/api/attendance/rfid/devices/${device.id}`, { status }, headers);
      toast?.(`Reader marked ${String(status || '').toLowerCase()}.`, 'success');
      await loadRfidSetup();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to update reader status.', 'error');
    } finally {
      setBusyRfidAction(false);
    }
  };

  const rotateRfidSecret = async (device) => {
    if (!device?.id || !isOwner) return;
    setBusyRfidAction(true);
    try {
      const res = await axios.post(`/api/attendance/rfid/devices/${device.id}/rotate-secret`, {}, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setRfidProvisioning({ ...(body.device || device), shared_secret: body.shared_secret || '' });
      toast?.('Reader key rotated. Update the bridge with the new key.', 'success');
      await loadRfidSetup();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to rotate reader key.', 'error');
    } finally {
      setBusyRfidAction(false);
    }
  };

  const pairSelectedMemberTag = async (e) => {
    if (e) e.preventDefault();
    if (!canManageMembers) {
      toast?.('You do not have permission to pair RFID tags.', 'warning');
      return;
    }
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    const nextTag = tagPairInput.trim();
    if (!nextTag) {
      toast?.('Enter the card or tag number first.', 'warning');
      return;
    }

    setBusyRfidAction(true);
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
      await loadRfidSetup();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to pair RFID tag.', 'error');
    } finally {
      setBusyRfidAction(false);
    }
  };

  const unpairSelectedMemberTag = async () => {
    if (!canManageMembers) {
      toast?.('You do not have permission to unpair RFID tags.', 'warning');
      return;
    }
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }

    setBusyRfidAction(true);
    try {
      const res = await axios.post('/api/attendance/rfid/unpair-member', {
        member_id: selectedMember.id,
      }, headers);
      const body = asObject(unwrapApiData(res.data), {});
      setSelectedMember((prev) => (prev ? { ...prev, rfid_tag_id: null } : prev));
      setTagPairInput('');
      toast?.(body.message || 'RFID tag removed.', 'success');
      await loadRfidSetup();
    } catch (err) {
      const errorBody = asObject(err?.response?.data, {});
      toast?.(errorBody.error || 'Failed to remove RFID tag.', 'error');
    } finally {
      setBusyRfidAction(false);
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
      handleCheckinSuccess(unwrapApiData(res.data), selectedMember, checkinMethod);
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
    openWhatsAppConversation({ phone: member.phone, message: msg });
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
    const maxTotal = Math.max(...enriched.map((item) => item.total), 0);

    return enriched
      .map((item) => ({
        ...item,
        width: maxTotal > 0 ? Math.round((item.total / maxTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [heatmap]);

  const hasPeakHoursData = peakHours.some((item) => Number(item.count || 0) > 0);
  const hasWeekdayPerformance = weekdayPerformance.some((item) => Number(item.total || 0) > 0);

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

      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Fingerprint size={17} className="text-rose-500" />
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">RFID Ready Kit</h3>
            </div>
            <p className="text-xs font-semibold text-slate-500 mt-1 max-w-3xl">
              Optional prep for premium gyms. You can keep using Staff, QR, and Self check-in now, and plug the hardware bridge in later without reworking the app.
            </p>
          </div>
          <button
            onClick={() => loadRfidSetup().catch(() => toast?.('Failed to refresh RFID setup.', 'error'))}
            disabled={busyRfidAction || !canReadAttendance}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5"
          >
            <RefreshCw size={13} /> Refresh RFID
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Readers Registered</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{rfidDevices.length}</p>
            <p className="text-xs font-semibold text-slate-500 mt-1">Each gate or reader gets its own serial and shared key.</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Active Readers</p>
            <p className="text-2xl font-black text-emerald-700 mt-1">{activeRfidReaders}</p>
            <p className="text-xs font-semibold text-emerald-700/70 mt-1">Paused readers stay provisioned but will not validate scans.</p>
          </div>
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-rose-500">Last Gate Event</p>
            <p className="text-sm font-black text-rose-700 mt-1">{latestRfidEvent ? formatRelativeTime(latestRfidEvent.event_timestamp) : 'Awaiting first tap'}</p>
            <p className="text-xs font-semibold text-rose-700/70 mt-1">{latestRfidEvent ? latestRfidEvent.reader_name || 'RFID reader' : 'Event logs will appear here after the first scan.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-5">
          <div className="space-y-4 min-w-0">
            <div className="rounded-[22px] border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Reader Registry</p>
                  <p className="text-xs font-semibold text-slate-500 mt-1">Create reader identities now so the bridge only needs the machine protocol later.</p>
                </div>
                {!isOwner && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wider">Owner only</span>}
              </div>

              {isOwner ? (
                <form onSubmit={createRfidReader} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-3 items-end">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reader Name</label>
                    <input
                      type="text"
                      value={rfidForm.reader_name}
                      onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_name: e.target.value }))}
                      placeholder="Main Gate"
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reader Serial</label>
                    <input
                      type="text"
                      value={rfidForm.reader_serial}
                      onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_serial: e.target.value }))}
                      placeholder="GATE-01"
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Location</label>
                    <input
                      type="text"
                      value={rfidForm.reader_location}
                      onChange={(e) => setRfidForm((prev) => ({ ...prev, reader_location: e.target.value }))}
                      placeholder="Reception turnstile"
                      className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busyRfidAction}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 disabled:opacity-60"
                  >
                    {busyRfidAction ? 'Saving...' : 'Register'}
                  </button>
                </form>
              ) : (
                <p className="text-xs font-semibold text-slate-500">Staff can view events below, but reader creation and key rotation stay owner-controlled.</p>
              )}
            </div>

            <div className="space-y-3">
              {rfidDevices.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
                  <p className="text-sm font-black text-slate-700">No RFID readers registered yet.</p>
                  <p className="text-xs font-semibold text-slate-500 mt-1">You can pre-create gate identities now and connect the real machine later.</p>
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
                    <div key={device.id} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 truncate">{device.reader_name}</p>
                          <p className="text-xs font-semibold text-slate-500 mt-1">Serial: {device.reader_serial}</p>
                          <p className="text-xs font-semibold text-slate-500 mt-1">Location: {device.reader_location || 'Not set yet'}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusTone}`}>{statusKey || 'ACTIVE'}</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-xs font-semibold text-slate-600">
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Heartbeat</p>
                          <p className="mt-1 text-slate-700">{formatRelativeTime(device.last_heartbeat)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Created</p>
                          <p className="mt-1 text-slate-700">{formatDateTime(device.created_at)}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <select
                          value={statusKey || 'ACTIVE'}
                          disabled={busyRfidAction || !isOwner}
                          onChange={(e) => updateRfidReaderStatus(device, e.target.value)}
                          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wider text-slate-700 disabled:opacity-60"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="PAUSED">Paused</option>
                          <option value="DISABLED">Disabled</option>
                        </select>
                        <button
                          onClick={() => rotateRfidSecret(device)}
                          disabled={busyRfidAction || !isOwner}
                          className="px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-black hover:bg-rose-100 disabled:opacity-60"
                        >
                          Rotate Key
                        </button>
                        <button
                          onClick={() => copyText(device.reader_serial, 'Reader serial copied.', 'Could not copy reader serial.')}
                          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50"
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

          <div className="space-y-4 min-w-0">
            <form onSubmit={pairSelectedMemberTag} className="rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Card Pairing Desk</p>
                  <p className="text-xs font-semibold text-slate-500 mt-1">Use the member search below or the quick check-in panel to select a member, then pair the card number written on the tag.</p>
                </div>
                {!canManageMembers && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wider">Read only</span>}
              </div>

              {selectedMember ? (
                <>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 mb-3">
                    <p className="text-sm font-black text-slate-900">{selectedMember.full_name}</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">{selectedMember.plan_name || 'No active plan'} · {selectedMember.membership_status || 'UNPAID'}</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">Current tag: {selectedMember.rfid_tag_id ? maskSensitiveValue(selectedMember.rfid_tag_id, { visibleStart: 3, visibleEnd: 3 }) : 'Not paired yet'}</p>
                  </div>

                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Tag / Card Number</label>
                  <input
                    type="text"
                    value={tagPairInput}
                    onChange={(e) => setTagPairInput(e.target.value)}
                    placeholder="Enter the UID or printed card number"
                    className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
                  />

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                      type="submit"
                      disabled={busyRfidAction || !canManageMembers}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-60"
                    >
                      {busyRfidAction ? 'Saving...' : selectedMember.rfid_tag_id ? 'Replace Tag' : 'Pair Tag'}
                    </button>
                    <button
                      type="button"
                      onClick={unpairSelectedMemberTag}
                      disabled={busyRfidAction || !canManageMembers || !selectedMember.rfid_tag_id}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
                    >
                      Remove Tag
                    </button>
                    {selectedMember.rfid_tag_id && (
                      <button
                        type="button"
                        onClick={() => copyText(selectedMember.rfid_tag_id, 'RFID tag copied.', 'Could not copy RFID tag.')}
                        className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50"
                      >
                        Copy Current Tag
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-sm font-bold text-slate-500">
                  Select a member in the quick check-in panel, then pair their RFID card here.
                </div>
              )}
            </form>

            <div className="rounded-[22px] border border-slate-100 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 text-white shadow-sm overflow-hidden relative">
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at top right, rgba(255,255,255,0.7) 0%, transparent 34%)' }} />
              <div className="relative">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-black">Bridge Provision Packet</p>
                    <p className="text-xs font-semibold text-slate-300 mt-1">Use this when the machine details arrive. The simulator script will already match your backend routes.</p>
                  </div>
                  <ScanLine size={18} className="text-rose-300 shrink-0" />
                </div>

                {rfidProvisioning?.shared_secret ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-white/10 border border-white/10 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">Reader</p>
                      <p className="text-sm font-black mt-1">{rfidProvisioning.reader_name || 'RFID Reader'} · {rfidProvisioning.reader_serial}</p>
                      <p className="text-xs font-semibold text-slate-300 mt-1">Shared key: <span className="font-mono text-[11px]">{rfidProvisioning.shared_secret}</span></p>
                    </div>

                    <div className="rounded-2xl bg-slate-950/60 border border-white/10 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Simulator Command</p>
                      <pre className="text-[11px] font-semibold text-slate-100 whitespace-pre-wrap break-all">{buildRfidSimulatorCommand(rfidProvisioning, rfidProvisioning.shared_secret)}</pre>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => copyText(rfidProvisioning.shared_secret, 'Shared key copied.', 'Could not copy shared key.')}
                        className="px-3 py-2 rounded-xl bg-white text-slate-900 text-xs font-black hover:bg-slate-100 flex items-center gap-1.5"
                      >
                        <Copy size={12} /> Copy Shared Key
                      </button>
                      <button
                        onClick={() => copyText(buildRfidSimulatorCommand(rfidProvisioning, rfidProvisioning.shared_secret), 'Simulator command copied.', 'Could not copy simulator command.')}
                        className="px-3 py-2 rounded-xl border border-white/20 bg-white/10 text-white text-xs font-black hover:bg-white/15 flex items-center gap-1.5"
                      >
                        <Copy size={12} /> Copy Command
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-sm font-semibold text-slate-300">
                    Create a reader or rotate a reader key to generate the one-time shared secret packet. That packet is what your future gate bridge will use.
                  </div>
                )}

                <p className="text-[11px] font-semibold text-slate-400 mt-3">The shared key is intentionally shown only right after reader creation or key rotation.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[22px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-black text-slate-900">Recent RFID Events</p>
              <p className="text-xs font-semibold text-slate-500 mt-1">Accepted, blocked, and unknown-tag events will show up here once a bridge starts sending scans.</p>
            </div>
          </div>

          {rfidEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm font-bold text-slate-500">
              No RFID events yet. That is expected until the actual machine bridge is connected.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {rfidEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <p className="text-sm font-black text-slate-900 truncate">{event.member_name || 'Unknown tag attempt'}</p>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${rfidEventBadge(event.event_status)}`}>{event.event_status || 'RECEIVED'}</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">Reader: {event.reader_name || event.reader_serial || 'RFID reader'} · Tag: {maskSensitiveValue(event.tag_id, { visibleStart: 3, visibleEnd: 3 })}</p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">{event.response_message || 'Awaiting processing.'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-slate-700">{formatDateTime(event.event_timestamp)}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1">{event.membership_status || 'UNPAID'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              onClick={openMemberQr}
              disabled={!selectedMember || busyQrAction}
              className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-black hover:bg-emerald-100 disabled:opacity-60"
            >
              {busyQrAction && qrModalState?.type !== 'gym' ? 'Loading...' : 'Show Member QR'}
            </button>
            <button
              onClick={openGymQr}
              disabled={busyQrAction}
              className="px-3 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-black hover:bg-indigo-100 disabled:opacity-60"
            >
              {busyQrAction && qrModalState?.type === 'gym' ? 'Loading...' : 'Show Gym QR'}
            </button>
            <button
              onClick={() => {
                setCheckinMethod('QR');
                setQrScannerOpen(true);
              }}
              disabled={busyQrAction || !canWriteAttendance}
              className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
            >
              Scan Member QR
            </button>
          </div>

          <p className="mt-2 text-[11px] font-semibold text-slate-500">
            Staff can scan a member QR here. Members can also self check-in by scanning the gym QR from the member portal.
          </p>

          <div className="mt-4">
            <button
              onClick={() => submitCheckin(false)}
              disabled={!selectedMember || busyCheckin || busyQrAction || !canWriteAttendance}
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
                <p><span className="text-slate-400">RFID Tag:</span> {selectedMember.rfid_tag_id ? maskSensitiveValue(selectedMember.rfid_tag_id, { visibleStart: 3, visibleEnd: 3 }) : 'Not paired'}</p>
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
                  await Promise.all([
                    loadOverviewBundle(),
                    loadRecords(),
                    canReadAttendance ? loadRfidSetup() : Promise.resolve(),
                  ]);
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
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                Peak Hour Analysis ({peakHoursDays === 'today' ? 'Today' : peakHoursDays === 7 ? '7D' : '30D'})
              </h3>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">Hourly traffic and full weekday rankings stay accessible on every screen.</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg shrink-0">
            {[['today', 'Today'], [7, '7D'], [30, '30D']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPeakHoursDays(val)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all ${peakHoursDays === val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px] gap-4">
          <div className="min-w-0 h-[240px] sm:h-[280px] xl:h-[260px]">
            {hasPeakHoursData ? (
              isActive ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={peakHours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2ff" />
                    <XAxis dataKey="hourLabel" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-center text-sm font-bold text-slate-400">
                No attendance traffic recorded for this period.
              </div>
            )}
          </div>
          {hasWeekdayPerformance ? (
            <>
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
            </>
          ) : (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">
              No weekday attendance trend is available yet.
            </div>
          )}
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

      {qrModalState && (
        <div className="app-modal-shell z-[220] bg-slate-900/70 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] max-w-md w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Attendance QR</p>
                <h3 className="text-xl font-black text-slate-900 mt-1">{qrModalState.title}</h3>
                <p className="text-sm font-semibold text-slate-500 mt-1">{qrModalState.subtitle}</p>
              </div>
              <button
                onClick={() => setQrModalState(null)}
                className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className={`mt-5 rounded-[24px] border p-4 ${qrModalState.accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/80' : 'border-indigo-200 bg-indigo-50/80'}`}>
              <div className="rounded-[20px] bg-white p-4 border border-white/80 flex items-center justify-center">
                <QRCodeCanvas value={qrModalState.token || 'gymvault'} size={220} includeMargin level="H" />
              </div>
              <div className="mt-4 space-y-1.5 text-xs font-semibold text-slate-600">
                {qrModalState.type === 'member' ? (
                  <>
                    <p><span className="text-slate-400">Member:</span> {qrModalState.meta?.full_name || 'Member'}</p>
                    <p><span className="text-slate-400">Plan:</span> {qrModalState.meta?.plan_name || 'No active plan'}</p>
                    <p><span className="text-slate-400">Membership:</span> {qrModalState.meta?.membership_status || 'UNPAID'}</p>
                  </>
                ) : (
                  <>
                    <p><span className="text-slate-400">Gym:</span> {qrModalState.meta?.name || 'Your gym'}</p>
                    <p><span className="text-slate-400">Use:</span> Member app self check-in</p>
                    <p><span className="text-slate-400">Gate rule:</span> Expired or unpaid members are still blocked by backend validation.</p>
                  </>
                )}
                <p><span className="text-slate-400">Expires:</span> {formatDateTime(qrModalState.expiresAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => {
                  if (qrModalState.type === 'member') {
                    openMemberQr();
                  } else {
                    openGymQr();
                  }
                }}
                disabled={busyQrAction}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-black hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} /> Refresh
              </button>
              <button
                onClick={copyQrToken}
                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <Copy size={14} /> Copy Token
              </button>
            </div>
          </div>
        </div>
      )}

      {qrScannerOpen && (
        <div className="app-modal-shell z-[220] bg-slate-900/70 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] max-w-lg w-full p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Reception Scan</p>
                <h3 className="text-xl font-black text-slate-900 mt-1">Scan Member QR</h3>
                <p className="text-sm font-semibold text-slate-500 mt-1">Open the member portal QR on the customer phone and point the camera here.</p>
              </div>
              <button
                onClick={() => setQrScannerOpen(false)}
                className="w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div id="attendance-staff-qr-reader" className="overflow-hidden rounded-[18px] bg-black min-h-[320px]" />
            </div>

            <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <ScanLine size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">What happens after scan?</p>
                <p className="text-xs font-semibold text-slate-600 mt-1">The backend validates membership, duplicate timing, and override rules before recording attendance. Expired and unpaid members are still blocked unless override is explicitly allowed.</p>
              </div>
            </div>

            {qrScannerBooting ? (
              <p className="mt-3 text-xs font-bold text-slate-500">Starting camera...</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default AttendancePage;
