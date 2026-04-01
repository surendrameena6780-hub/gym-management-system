import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Search, Edit2, Plus, X, Zap, RefreshCw, Trash2, Ban, Calendar,
  CreditCard, Clock, AlertTriangle, CheckCircle, Flame, TrendingUp,
  MessageSquare, ListChecks, UserPlus, Phone, Download, Users, Mail,
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
];

const getInitials = (name) => name?.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
const getAvatarGradient = (name) => AVATAR_GRADIENTS[(name?.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];

const GradientAvatar = ({ name, src, sizePx = 36, onClick, className = '', imageFit = 'object-cover' }) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => {
    setImgError(false);
  }, [src]);
  const showInitials = !src || imgError;
  return (
    <div onClick={onClick} style={{ width: sizePx, height: sizePx, minWidth: sizePx, minHeight: sizePx }} className={`rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center bg-slate-100 ${onClick ? 'cursor-pointer' : ''} ${className}`}>
      {showInitials ? (
        <div className={`w-full h-full rounded-full bg-gradient-to-br ${getAvatarGradient(name)} flex items-center justify-center`}>
          <span style={{ fontSize: Math.max(9, sizePx * 0.34) }} className="text-white font-black leading-none select-none">{getInitials(name)}</span>
        </div>
      ) : (
        <img src={src} alt={name} className={`w-full h-full block ${imageFit}`} style={{ aspectRatio: '1 / 1', objectPosition: 'center top' }} onError={() => setImgError(true)} />
      )}
    </div>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-slate-50">
    <td className="py-5 px-2"><div className="w-4 h-4 bg-slate-100 rounded animate-pulse" /></td>
    <td className="py-5 pr-2 pl-0"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-slate-100 animate-pulse shrink-0" /><div className="flex flex-col gap-1.5"><div className="h-3 w-28 bg-slate-100 rounded animate-pulse" /><div className="h-2 w-14 bg-slate-100 rounded animate-pulse" /></div></div></td>
    <td className="py-5 px-2"><div className="h-3 w-24 bg-slate-100 rounded animate-pulse" /></td>
    <td className="py-5 px-2"><div className="h-3 w-32 bg-slate-100 rounded animate-pulse" /></td>
    <td className="py-5 px-2"><div className="mx-auto h-6 w-20 bg-slate-100 rounded-full animate-pulse" /></td>
    <td className="py-5 px-2"><div className="mx-auto h-4 w-20 bg-slate-100 rounded animate-pulse" /></td>
    <td className="py-5 px-2"><div className="mx-auto h-6 w-12 bg-slate-100 rounded-full animate-pulse" /></td>
    <td className="py-5 px-2"><div className="mx-auto h-3 w-20 bg-slate-100 rounded animate-pulse" /></td>
    <td className="py-5 px-4"><div className="flex gap-2 justify-end"><div className="h-7 w-16 bg-slate-100 rounded-lg animate-pulse" /><div className="h-7 w-7 bg-slate-100 rounded animate-pulse" /><div className="h-7 w-7 bg-slate-100 rounded animate-pulse" /></div></td>
  </tr>
);

const FILTER_TABS = [
  { key: 'All', label: 'All', active: 'bg-slate-800 text-white shadow-md', inactive: 'text-slate-500 hover:bg-slate-50 hover:text-slate-700', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-slate-100 text-slate-500' },
  { key: 'Active', label: 'Active', active: 'bg-emerald-500 text-white shadow-md shadow-emerald-200', inactive: 'text-emerald-600 hover:bg-emerald-50', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-emerald-50 text-emerald-600' },
  { key: 'Unpaid', label: 'Unpaid', active: 'bg-slate-700 text-white shadow-md shadow-slate-200', inactive: 'text-slate-600 hover:bg-slate-100', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-slate-100 text-slate-600' },
  { key: 'Inactive', label: 'Inactive', active: 'bg-amber-500 text-white shadow-md shadow-amber-200', inactive: 'text-amber-600 hover:bg-amber-50', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-amber-50 text-amber-600' },
  { key: 'Expired', label: 'Expired', active: 'bg-rose-500 text-white shadow-md shadow-rose-200', inactive: 'text-rose-600 hover:bg-rose-50', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-rose-50 text-rose-600' },
  { key: 'Expiring Soon', label: 'Expiring Soon', active: 'bg-orange-500 text-white shadow-md shadow-orange-200', inactive: 'text-orange-600 hover:bg-orange-50', badgeActive: 'bg-white/20 text-white', badgeInactive: 'bg-orange-50 text-orange-600' },
];

const STATUS_PILLS = { ACTIVE: 'bg-emerald-100 text-emerald-700', INACTIVE: 'bg-amber-100 text-amber-700', 'EXPIRING SOON': 'bg-orange-100 text-orange-700', EXPIRED: 'bg-rose-100 text-rose-700', UNPAID: 'bg-slate-100 text-slate-500' };

const extractArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const normalizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
const isValidPhoneInput = (value) => /^\d{10}$/.test(normalizePhoneInput(value));
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_MAX_DIMENSION = 1600;
const allowedProfileImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);
const getProfileImageTypeError = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  if (mimeType && !allowedProfileImageMimeTypes.has(mimeType)) {
    return 'Only JPG, JPEG, PNG, and WEBP images are allowed.';
  }
  return null;
};

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Unable to read image.'));
  };

  image.src = objectUrl;
});

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('Image compression failed.'));
      return;
    }
    resolve(blob);
  }, mimeType, quality);
});

const compressProfileImageFile = async (file, maxBytes = MAX_PROFILE_IMAGE_BYTES) => {
  const image = await loadImageFromFile(file);
  const scale = Math.min(1, PROFILE_IMAGE_MAX_DIMENSION / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return file;
  }

  let bestBlob = null;

  for (let pass = 0; pass < 5; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const mimeType of ['image/webp', 'image/jpeg']) {
      for (const quality of [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48]) {
        try {
          const blob = await canvasToBlob(canvas, mimeType, quality);
          if (!bestBlob || blob.size < bestBlob.size) {
            bestBlob = blob;
          }
          if (blob.size <= maxBytes) {
            const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
            const baseName = String(file.name || 'profile').replace(/\.[^/.]+$/, '');
            return new File([blob], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() });
          }
        } catch (_err) {
          // Try next quality/type.
        }
      }
    }

    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
  }

  if (bestBlob) {
    const bestType = bestBlob.type || 'image/jpeg';
    const extension = bestType === 'image/webp' ? 'webp' : 'jpg';
    const baseName = String(file.name || 'profile').replace(/\.[^/.]+$/, '');
    return new File([bestBlob], `${baseName}.${extension}`, { type: bestType, lastModified: Date.now() });
  }

  return file;
};

const normalizeProfileImageFile = async (file) => {
  if (!file) {
    return { file: null, error: null, wasCompressed: false };
  }

  const typeError = getProfileImageTypeError(file);
  if (typeError) {
    return { file: null, error: typeError, wasCompressed: false };
  }

  if (Number(file.size || 0) <= MAX_PROFILE_IMAGE_BYTES) {
    return { file, error: null, wasCompressed: false };
  }

  try {
    const compressedFile = await compressProfileImageFile(file, MAX_PROFILE_IMAGE_BYTES);
    if (Number(compressedFile?.size || 0) > MAX_PROFILE_IMAGE_BYTES) {
      return { file: null, error: 'Image is still too large after optimization. Please choose a smaller photo.', wasCompressed: false };
    }
    return { file: compressedFile, error: null, wasCompressed: true };
  } catch (_err) {
    return { file: null, error: 'Unable to process this image. Please choose another photo.', wasCompressed: false };
  }
};
const normalizeMemberRecord = (member) => ({
  ...member,
  profile_pic: normalizeProfileImageUrl(member?.profile_pic),
});

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const MembersPage = ({ token, toast, showConfirm, defaultFilter = 'All', focusMemberId = null, focusAction = null, onFocusHandled }) => {
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState(defaultFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [addSelectedPlanId, setAddSelectedPlanId] = useState('');
  const [addFormData, setAddFormData] = useState({ full_name: '', email: '', phone: '' });
  const [editFormData, setEditFormData] = useState({ id: '', full_name: '', email: '', phone: '' });

  const membersListRef = useRef(null);
  const membersScrollState = useRef({ lastY: 0, velocity: 0, rafId: null });

  const [addFile, setAddFile] = useState(null);
  const [editFile, setEditFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const handleProfileImageSelect = async (file, target) => {
    if (!file) return false;

    const normalized = await normalizeProfileImageFile(file);
    if (normalized.error || !normalized.file) {
      toast?.(normalized.error || 'Unable to process this image.', 'error');
      return false;
    }

    if (normalized.wasCompressed) {
      toast?.('Image optimized automatically to fit 2MB limit.', 'warning');
    }

    if (target === 'add') {
      setAddFile(normalized.file);
      setPreviewUrl(URL.createObjectURL(normalized.file));
      return true;
    }

    setEditFile(normalized.file);
    return true;
  };

  const fetchMembers = async ({ search = searchTerm } = {}) => {
    try {
      const url = `/api/members${search ? `?search=${encodeURIComponent(search)}` : ''}`;
      const res = await axios.get(url, { headers: { 'x-auth-token': token } });
      const normalizedMembers = extractArray(res.data, ['members', 'rows', 'items']).map(normalizeMemberRecord);
      setMembers(normalizedMembers);
      // Sync selectedMember so photo & data stay fresh after any upload/edit
      setSelectedMember(prev => {
        if (!prev) return prev;
        const fresh = normalizedMembers.find(m => m.id === prev.id);
        return fresh || prev;
      });
    } catch (err) { toast?.('Failed to load members', 'error'); } finally { setLoading(false); }
  };

  const fetchPlans = async () => {
    try {
      const res = await axios.get('/api/memberships/plans', { headers: { 'x-auth-token': token } });
      setPlans(extractArray(res.data, ['plans', 'rows', 'items']));
    } catch (err) { console.error('Error fetching plans:', err); }
  };

  useEffect(() => {
    if (!token) return;
    fetchPlans();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchMembers({ search: searchTerm });
    }, 220);
    return () => clearTimeout(timer);
  }, [token, searchTerm]);

  useEffect(() => {
    if (!focusAction || focusMemberId) return;
    if (focusAction === 'add') {
      setShowAddModal(true);
      onFocusHandled?.();
    }
  }, [focusAction, focusMemberId, onFocusHandled]);

  useEffect(() => {
    if (!token || !focusMemberId) return;

    let isMounted = true;

    const openFocusedMember = async () => {
      const targetId = Number.parseInt(focusMemberId, 10);
      if (!Number.isInteger(targetId)) {
        onFocusHandled?.();
        return;
      }

      const memberFromList = members.find((member) => Number(member.id) === targetId);
      if (memberFromList) {
        setSelectedMember(memberFromList);
        setShowDetailsModal(true);
        if (focusAction === 'activate') {
          setShowActivateModal(true);
        }
        onFocusHandled?.();
        return;
      }

      try {
        const res = await axios.get(`/api/members/${targetId}`, { headers: { 'x-auth-token': token } });
        if (!isMounted) return;

        const normalizedMember = normalizeMemberRecord(res.data);
        setSelectedMember(normalizedMember);
        setShowDetailsModal(true);
        if (focusAction === 'activate') {
          setShowActivateModal(true);
        }
      } catch (_err) {
        if (isMounted) {
          toast?.('Unable to open selected member.', 'warning');
        }
      } finally {
        if (isMounted) {
          onFocusHandled?.();
        }
      }
    };

    openFocusedMember();

    return () => {
      isMounted = false;
    };
  }, [token, focusMemberId, focusAction, members, onFocusHandled, toast]);

  useEffect(() => {
    const el = membersListRef.current;
    if (!el) return;
    const s = membersScrollState.current;
    const onTouchStart = (e) => {
      s.lastY = e.touches[0].clientY;
      s.velocity = 0;
      if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = null; }
    };
    const onTouchMove = (e) => {
      if (!e.touches[0]) return;
      const y = e.touches[0].clientY;
      const dy = s.lastY - y;
      s.lastY = y;
      s.velocity = dy;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight) return;
      const atTop    = scrollTop <= 0 && dy < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && dy > 0;
      if (!atTop && !atBottom) { el.scrollTop += dy; e.preventDefault(); }
    };
    const onTouchEnd = () => {
      const tick = () => {
        s.velocity *= 0.88;
        if (Math.abs(s.velocity) < 0.5) { s.velocity = 0; return; }
        el.scrollTop += s.velocity;
        s.rafId = requestAnimationFrame(tick);
      };
      s.rafId = requestAnimationFrame(tick);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      if (s.rafId) cancelAnimationFrame(s.rafId);
    };
  }, []);

  const downloadReceipt = () => {
    if (!receiptData) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt - ${receiptData.memberName}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; background: #f8fafc; }
            .receipt-box { background: white; border: 1px solid #e2e8f0; padding: 40px; border-radius: 24px; max-width: 450px; margin: auto; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
            .logo { font-size: 24px; font-weight: 900; text-align: center; margin-bottom: 5px; color: #0f172a; }
            .sub-logo { font-size: 10px; font-weight: 700; text-align: center; color: #64748b; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 30px; }
            .divider { border-top: 2px dashed #e2e8f0; margin: 20px 0; }
            .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; }
            .label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; }
            .value { font-weight: 700; color: #0f172a; font-size: 14px; }
            .total-row { background: #f1f5f9; padding: 15px; border-radius: 12px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; }
            .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #94a3b8; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="receipt-box">
            <div class="logo">GymVault</div>
            <div class="sub-logo">Official Payment Receipt</div>
            <div class="info-row"><span class="label">Receipt Date</span><span class="value">${new Date().toLocaleDateString('en-GB')}</span></div>
            <div class="info-row"><span class="label">Member Name</span><span class="value">${receiptData.memberName}</span></div>
            <div class="info-row"><span class="label">Plan Activated</span><span class="value">${receiptData.planName}</span></div>
            <div class="info-row"><span class="label">Payment ID</span><span class="value" style="font-size: 10px;">${receiptData.payId}</span></div>
            <div class="divider"></div>
            <div class="total-row">
              <span class="label" style="color: #0f172a; font-size: 14px;">Total Amount</span>
              <span style="font-weight: 900; font-size: 20px; color: #10b981;">&#8377;${receiptData.amount}</span>
            </div>
            <div class="footer">This is a computer generated receipt.</div>
          </div>
          <script>window.onload = function() { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleActivateSubscription = async (e, type = 'online') => {
    if (e) e.preventDefault();
    if (!selectedPlanId) { toast?.('Please select a plan first.', 'warning'); return; }
    const selectedPlan = plans.find((p) => p.id === parseInt(selectedPlanId));

    if (type === 'cash') {
      showConfirm?.({
        title: 'Confirm Cash Payment',
        message: `Record a cash payment of ₹${selectedPlan.price} for ${selectedMember?.full_name}?`,
        confirmLabel: 'Confirm Cash',
        variant: 'warning',
        onConfirm: () => processActivation(selectedPlan, `CASH-${Date.now()}`),
      });
      return;
    }

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        return toast?.('Failed to load Razorpay checkout.', 'error');
      }

      const orderRes = await axios.post(
        '/api/memberships/online/create-order',
        { member_id: selectedMember.id, plan_id: selectedPlan.id },
        { headers: { 'x-auth-token': token } }
      );

      const keyId = orderRes.data?.key_id;
      const order = orderRes.data?.order;
      if (!keyId || !order?.id) {
        return toast?.('Member payment gateway not configured. Ask owner to setup Integrations.', 'error');
      }

      const options = {
        key: keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'Gym Membership Payment',
        description: `Membership: ${selectedPlan.name}`,
        order_id: order.id,
        handler: async (res) => {
          try {
            await axios.post(
              '/api/memberships/online/verify',
              {
                member_id: selectedMember.id,
                plan_id: selectedPlan.id,
                razorpay_order_id: res.razorpay_order_id,
                razorpay_payment_id: res.razorpay_payment_id,
                razorpay_signature: res.razorpay_signature,
              },
              { headers: { 'x-auth-token': token } }
            );
            await axios.put(`/api/members/${selectedMember.id}/check-in`, {}, { headers: { 'x-auth-token': token } });
            setReceiptData({ memberName: selectedMember.full_name, planName: selectedPlan.name, amount: selectedPlan.price, payId: res.razorpay_payment_id });
            setShowActivateModal(false);
            setShowSuccessAnim(true);
          } catch (verifyErr) {
            toast?.(verifyErr?.response?.data?.error || 'Payment verification failed. Please try again.', 'error');
          }
        },
        prefill: { name: selectedMember.full_name, contact: selectedMember.phone, email: selectedMember.email },
        theme: { color: '#7c3aed' },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to start online payment.', 'error');
    }
  };

  const processActivation = async (plan, paymentId) => {
    try {
      const isOnline = paymentId && String(paymentId).startsWith('pay_');
      const mode = isOnline ? 'Online' : 'Cash';
      await axios.post('/api/memberships/activate', { member_id: selectedMember.id, plan_id: plan.id, payment_id: paymentId, payment_mode: mode }, { headers: { 'x-auth-token': token } });
      await axios.put(`/api/members/${selectedMember.id}/check-in`, {}, { headers: { 'x-auth-token': token } });
      setReceiptData({ memberName: selectedMember.full_name, planName: plan.name, amount: plan.price, payId: paymentId });
      setShowActivateModal(false);
      setShowSuccessAnim(true);
    } catch (err) { toast?.('Activation failed. Please try again.', 'error'); }
  };

  const sendWhatsApp = (member, type) => {
    const gymName = 'GymVault';
    const message = type === 'reminder' ? `Hi ${member.full_name}, your membership at ${gymName} is expiring in ${member.days_left} days. Please renew to continue your fitness journey!` : `Hi ${member.full_name}, we missed you at ${gymName}! Hope to see you back soon!`;
    window.open(`https://wa.me/91${member.phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleCall = (phoneNumber) => window.open(`tel:${phoneNumber}`, '_self');

  const handleBulkReminder = () => {
    const selected = members.filter((m) => selectedIds.includes(m.id));
    selected.forEach((m, index) => setTimeout(() => sendWhatsApp(m, 'reminder'), index * 1000));
  };

  const handleQuickExtend = async (days) => {
    try {
      await axios.post('/api/memberships/extend', { member_id: editFormData.id, days }, { headers: { 'x-auth-token': token } });
      fetchMembers();
      toast?.(`Extended by ${days} days!`, 'success');
    } catch (err) { toast?.('Extension failed.', 'error'); }
  };

  const getStatusInfo = (member) => {
    if (member.membership_status === 'UNPAID' || !member.plan_name) return { label: 'UNPAID', color: 'bg-slate-300', text: 'text-slate-400' };
    if (member.days_left <= 0) return { label: 'EXPIRED', color: 'bg-rose-500', text: 'text-rose-500' };
    const today = new Date();
    const lastVisit = member.last_visit ? new Date(member.last_visit) : null;
    let diffDays = lastVisit ? Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(lastVisit.getFullYear(), lastVisit.getMonth(), lastVisit.getDate())) / (1000 * 60 * 60 * 24)) : 999;
    if (diffDays > 4) return { label: 'INACTIVE', color: 'bg-amber-400', text: 'text-amber-500' };
    if (member.days_left <= 5) return { label: 'EXPIRING SOON', color: 'bg-orange-500', text: 'text-orange-500' };
    return { label: 'ACTIVE', color: 'bg-emerald-400', text: 'text-emerald-500' };
  };

  const handleManualCheckIn = async (e, memberId) => {
    e.stopPropagation();
    try {
      await axios.put(`/api/members/${memberId}/check-in`, {}, { headers: { 'x-auth-token': token } });
      fetchMembers();
    } catch (err) { toast?.('Check-in failed', 'error'); }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    const normalizedPhone = normalizePhoneInput(addFormData.phone);
    if (!isValidPhoneInput(normalizedPhone)) {
      toast?.('Phone must be exactly 10 digits.', 'error');
      return;
    }
    let addFileToUpload = addFile;
    if (addFileToUpload) {
      const normalized = await normalizeProfileImageFile(addFileToUpload);
      if (normalized.error || !normalized.file) {
        toast?.(normalized.error || 'Unable to process this image.', 'error');
        return;
      }
      addFileToUpload = normalized.file;
      if (normalized.file !== addFile) {
        setAddFile(normalized.file);
        setPreviewUrl(URL.createObjectURL(normalized.file));
      }
    }
    const formData = new FormData();
    formData.append('full_name', addFormData.full_name);
    formData.append('email', addFormData.email);
    formData.append('phone', normalizedPhone);
    if (addFileToUpload) formData.append('profile_pic', addFileToUpload);
    try {
      const res = await axios.post('/api/members/add', formData, { headers: { 'x-auth-token': token } });
      setShowAddModal(false);
      setAddFormData({ full_name: '', email: '', phone: '' }); setAddFile(null); setPreviewUrl(null);
      await fetchMembers();
      toast?.('Member added successfully!', 'success');
      if (addSelectedPlanId && res.data) { setSelectedMember(normalizeMemberRecord(res.data)); setSelectedPlanId(addSelectedPlanId); setShowActivateModal(true); }
      setAddSelectedPlanId('');
    } catch (err) {
      const message = err?.response?.data?.error || err?.response?.data?.message || 'Error adding member.';
      toast?.(message, 'error');
    }
  };

  const handleEditClick = (member) => { setEditFormData({ id: member.id, full_name: member.full_name, email: member.email, phone: member.phone }); setShowEditModal(true); };
  const handleViewDetails = (member) => { setSelectedMember(member); setShowDetailsModal(true); };

  const handleUpdateMember = async (e) => {
    e.preventDefault();
    const normalizedPhone = normalizePhoneInput(editFormData.phone);
    if (!isValidPhoneInput(normalizedPhone)) {
      toast?.('Phone must be exactly 10 digits.', 'error');
      return;
    }
    let editFileToUpload = editFile;
    if (editFileToUpload) {
      const normalized = await normalizeProfileImageFile(editFileToUpload);
      if (normalized.error || !normalized.file) {
        toast?.(normalized.error || 'Unable to process this image.', 'error');
        return;
      }
      editFileToUpload = normalized.file;
      if (normalized.file !== editFile) {
        setEditFile(normalized.file);
      }
    }
    try {
      if (editFileToUpload) {
        const formData = new FormData();
        formData.append('full_name', editFormData.full_name);
        formData.append('email', editFormData.email);
        formData.append('phone', normalizedPhone);
        formData.append('profile_pic', editFileToUpload);
        await axios.put(`/api/members/${editFormData.id}`, formData, { headers: { 'x-auth-token': token } });
      } else {
        await axios.put(
          `/api/members/${editFormData.id}`,
          { full_name: editFormData.full_name, email: editFormData.email, phone: normalizedPhone },
          { headers: { 'x-auth-token': token } }
        );
      }
      setShowEditModal(false); setEditFile(null); fetchMembers(); toast?.('Member updated successfully!', 'success');
    } catch (err) {
      const message = err?.response?.data?.error || err?.response?.data?.message || 'Update failed. Please try again.';
      toast?.(message, 'error');
    }
  };

  const handleDeleteMember = () => {
    showConfirm?.({ title: 'Delete Member', message: 'This action cannot be undone.', confirmLabel: 'Yes, Delete', variant: 'danger', onConfirm: async () => {
        try { await axios.delete(`/api/members/${editFormData.id}`, { headers: { 'x-auth-token': token } }); setShowEditModal(false); fetchMembers(); toast?.('Member deleted.', 'success'); } catch (err) { toast?.('Delete failed.', 'error'); }
      }
    });
  };

  const handleRemovePlan = () => {
    showConfirm?.({ title: 'Cancel Active Plan', message: 'This will remove the active membership plan.', confirmLabel: 'Cancel Plan', variant: 'danger', onConfirm: async () => {
        try { await axios.post('/api/memberships/remove-plan', { member_id: editFormData.id }, { headers: { 'x-auth-token': token } }); setShowEditModal(false); fetchMembers(); toast?.('Plan removed.', 'success'); } catch (err) { toast?.('Failed to remove plan.', 'error'); }
      }
    });
  };

  const toggleSelection = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const filteredMembers = members.filter((m) => {
    const statusInfo = getStatusInfo(m);
    const lastVisitDate = m.last_visit ? new Date(m.last_visit) : null;
    const diffDays = lastVisitDate ? Math.ceil((new Date() - lastVisitDate) / (1000 * 60 * 60 * 24)) : 999;
    const matchesFilter = filter === 'All' ? true : (filter === 'Active' && (statusInfo.label === 'ACTIVE' || statusInfo.label === 'EXPIRING SOON')) || (filter === 'Unpaid' && statusInfo.label === 'UNPAID') || (filter === 'Expired' && statusInfo.label === 'EXPIRED') || (filter === 'Expiring Soon' && statusInfo.label === 'EXPIRING SOON') || (filter === 'Inactive' && statusInfo.label !== 'UNPAID' && diffDays > 4);
    const searchLower = searchTerm.toLowerCase();
    return matchesFilter && (m.full_name?.toLowerCase().includes(searchLower) || m.email?.toLowerCase().includes(searchLower) || m.phone?.includes(searchTerm));
  });

  const counts = { All: members.length, Active: members.filter((m) => ['ACTIVE', 'EXPIRING SOON'].includes(getStatusInfo(m).label)).length, Expired: members.filter((m) => getStatusInfo(m).label === 'EXPIRED').length, 'Expiring Soon': members.filter((m) => getStatusInfo(m).label === 'EXPIRING SOON').length, Inactive: members.filter((m) => getStatusInfo(m).label === 'INACTIVE').length, Unpaid: members.filter((m) => getStatusInfo(m).label === 'UNPAID').length };

  return (
    <div className="flex min-h-0 flex-col gap-3 sm:gap-5 p-1 sm:p-2 relative">
      {showSuccessAnim && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white p-10 rounded-[40px] shadow-2xl text-center flex flex-col items-center animate-in zoom-in-95 duration-500 max-w-sm w-full">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4 animate-bounce"><CheckCircle size={48} /></div>
            <h2 className="text-2xl font-black text-slate-900">Success!</h2>
            <p className="text-slate-500 font-bold mb-8">Membership Activated for {selectedMember?.full_name}</p>
            <div className="w-full space-y-3">
              <button onClick={downloadReceipt} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-[0.98]"><Download size={18} /> Download Receipt</button>
              <button onClick={() => { setShowSuccessAnim(false); fetchMembers(); }} className="w-full py-2 text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Close & Refresh</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[ { label: 'Total Members', count: counts.All, icon: Users, bg: 'bg-indigo-50', ic: 'text-indigo-600' }, { label: 'Active', count: counts.Active, icon: CheckCircle, bg: 'bg-emerald-50', ic: 'text-emerald-600' }, { label: 'Expired', count: counts.Expired, icon: Clock, bg: 'bg-rose-50', ic: 'text-rose-600' }, { label: 'Unpaid', count: counts.Unpaid, icon: AlertTriangle, bg: 'bg-amber-50', ic: 'text-amber-600' } ].map(({ label, count, icon: Icon, bg, ic }) => (
          <div key={label} className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 p-4 flex items-center gap-3" style={{ boxShadow: '0 2px 16px rgba(99,102,241,0.05), 0 1px 3px rgba(0,0,0,0.03)' }}>
            <div className={`w-10 h-10 rounded-xl ${bg} ${ic} flex items-center justify-center shrink-0`}><Icon size={18} /></div>
            <div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide leading-none mb-0.5">{label}</p><p className="text-2xl font-black text-slate-900 leading-none">{loading ? '—' : count}</p></div>
          </div>
        ))}
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 overflow-hidden" style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">Members {isBulkMode && (<span className="text-xs bg-slate-900 text-white px-2.5 py-1 rounded-full font-black">{selectedIds.length} selected</span>)}</h1>
            <p className="text-slate-500 text-sm mt-0.5">Manage and track your gym members</p>
          </div>
          <div className="flex gap-2.5 w-full md:w-auto">
            <button onClick={() => { setIsBulkMode(!isBulkMode); setSelectedIds([]); }} className={`flex-1 md:flex-none px-4 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 border text-sm transition-all ${isBulkMode ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}><ListChecks size={16} /> {isBulkMode ? 'Exit' : 'Bulk Select'}</button>
            <button onClick={() => setShowAddModal(true)} className="flex-1 md:flex-none text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 text-sm" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}><Plus size={16} /> Add Member</button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder="Search name, email, phone…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-sm font-medium transition-all" />
          </div>
          <div className="w-full">
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-1.5">
              {FILTER_TABS.map(({ key, label, active, inactive, badgeActive, badgeInactive }) => (
                <button key={key} onClick={() => setFilter(key)} className={`h-10 sm:h-9 w-full sm:w-auto px-2 sm:px-3.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-center leading-tight whitespace-normal sm:whitespace-nowrap border border-transparent ${filter === key ? active : inactive}`}>
                  <span>{label}</span>
                  <span className={`min-w-[18px] text-center text-[9px] px-1.5 py-0.5 rounded-full font-black ${filter === key ? badgeActive : badgeInactive}`}>{counts[key] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden">
          {!loading && members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-[32px] border-2 border-dashed border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-6 text-slate-300"><Users size={40} /></div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Build Your Community!</h2>
              <p className="text-slate-500 font-bold mb-8 text-center max-w-xs">Your gym looks quiet. Start by adding your very first member.</p>
              <button onClick={() => setShowAddModal(true)} className="text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,0.4)' }}><UserPlus size={20} /> Add First Member</button>
            </div>
          ) : (
            <>
              <div className="md:hidden py-2">
                <div className="relative">
                  <div ref={membersListRef} className="members-mobile-list-scroll no-scrollbar">
                    <div className="space-y-3 pb-6">
                      {loading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <div key={`member-mobile-skeleton-${i}`} className="p-4 rounded-2xl border border-slate-100 bg-white space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full gv-skeleton shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3 w-32 gv-skeleton" />
                              <div className="h-2.5 w-44 gv-skeleton" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="h-5 w-16 gv-skeleton rounded-full" />
                            <div className="h-3 w-20 gv-skeleton" />
                          </div>
                        </div>
                      ))
                    ) : filteredMembers.length === 0 ? (
                      <div className="text-center text-slate-400 font-bold py-8">No members found</div>
                    ) : (
                      filteredMembers.map((member, idx) => {
                        const statusInfo = getStatusInfo(member);
                        return (
                          <div
                            key={`member-mobile-${member.id}`}
                            className={`gv-fade-up relative p-4 rounded-2xl border space-y-3 active:scale-[0.98] transition-transform cursor-pointer gv-card-hover ${selectedIds.includes(member.id) ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-100 bg-white'}`}
                            style={{ animationDelay: `${Math.min(idx * 0.04, 0.3)}s` }}
                            onClick={() => (isBulkMode ? toggleSelection(member.id) : handleViewDetails(member))}
                          >
                            {isBulkMode && (
                              <div className="absolute right-3 top-3">
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedIds.includes(member.id) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                                  <CheckCircle size={12} fill="currentColor" />
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <GradientAvatar name={member.full_name} src={member.profile_pic} sizePx={40} />
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-slate-900 truncate">{member.full_name}</p>
                                <p className="text-xs text-slate-500 truncate">{member.phone} • {member.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`inline-block px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-full ${STATUS_PILLS[statusInfo.label] || 'bg-slate-100 text-slate-500'}`}>{statusInfo.label}</span>
                              <span className="text-xs font-bold text-slate-500">{member.plan_name || 'No Plan'}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                    </div>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 h-12 pointer-events-none rounded-b-2xl" style={{ background: 'linear-gradient(to top, rgba(248,250,252,0.96) 0%, transparent 100%)' }} />
                </div>
              </div>

              <div className="hidden md:block h-full overflow-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase font-bold tracking-widest border-b border-slate-100">
                  <th className="py-4 w-[40px] px-2">{isBulkMode && '✓'}</th>
                  <th className="py-4 w-[18%] pr-2 pl-0">Name</th>
                  <th className="py-4 w-[11%] px-2">Phone</th>
                  <th className="py-4 w-[15%] px-2">Email</th>
                  <th className="py-4 w-[11%] text-center px-2">Status</th>
                  <th className="py-4 w-[10%] text-center px-2">Plan</th>
                  <th className="py-4 w-[7%] text-center px-2">Days</th>
                  <th className="py-4 w-[10%] text-center px-2">Last Visit</th>
                  <th className="py-4 w-[18%] text-right px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? ( Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />) ) : filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan="9">
                      <div className="flex flex-col items-center justify-center py-20 animate-in fade-in duration-500">
                        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-5 text-slate-300"><Search size={32} /></div>
                        <h2 className="text-xl font-black text-slate-900 mb-2">No members found</h2>
                        <p className="text-slate-500 font-bold text-sm mb-1">No results for <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded font-black">"{searchTerm || filter}"</span></p>
                        <button onClick={() => { setSearchTerm(''); setFilter('All'); }} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2 mt-6"><X size={16} /> Clear Search</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => {
                    const statusInfo = getStatusInfo(member);
                    const displayDays = member.days_left < 0 ? 0 : (member.days_left || 0);
                    return (
                      <tr key={member.id} onClick={() => (isBulkMode ? toggleSelection(member.id) : handleViewDetails(member))} className={`group cursor-pointer transition-colors ${selectedIds.includes(member.id) ? 'bg-indigo-50/40' : 'hover:bg-slate-50/70'}`}>
                        <td className="py-4 px-2" onClick={(e) => e.stopPropagation()}>
                          {isBulkMode && <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleSelection(member.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />}
                        </td>
                        <td className="py-4 pr-2 pl-0">
                          <div className="flex items-center gap-2.5">
                            <GradientAvatar name={member.full_name} src={member.profile_pic} sizePx={34} onClick={(e) => { e.stopPropagation(); if (member.profile_pic) setPreviewImage(member.profile_pic); }} className="border border-white/80 shadow-sm hover:scale-105 transition-transform ring-1 ring-slate-200/60" />
                            <div className="flex flex-col min-w-0"><span className="truncate font-bold text-slate-900 text-sm">{member.full_name}</span><span className="text-[10px] text-slate-400 font-medium">ID #{member.id}</span></div>
                          </div>
                        </td>
                        <td className="py-4 px-2 text-slate-600 text-sm truncate">{member.phone}</td>
                        <td className="py-4 px-2 text-slate-500 text-xs truncate">{member.email}</td>
                        <td className="py-4 px-2 text-center"><span className={`inline-block px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-full ${STATUS_PILLS[statusInfo.label] || 'bg-slate-100 text-slate-500'}`}>{statusInfo.label}</span></td>
                        <td className="py-4 px-2 text-center">{member.plan_name ? <span className="text-xs font-bold text-slate-700 truncate block">{member.plan_name}</span> : <span className="text-slate-300 font-bold text-sm">—</span>}</td>
                        <td className="py-4 px-2 text-center">{statusInfo.label === 'UNPAID' ? <span className="text-slate-300 font-bold text-sm">—</span> : member.days_left <= 0 ? <span className="px-2 py-0.5 bg-rose-100 text-rose-600 text-[9px] font-black rounded-full uppercase">Exp'd</span> : member.days_left <= 5 ? <span className="px-2.5 py-1 bg-orange-100 text-orange-600 text-[10px] font-black rounded-full">{displayDays}d</span> : <span className="text-sm font-bold text-slate-700">{displayDays}</span>}</td>
                        <td className="py-4 px-2 text-center"><span className="text-xs font-semibold text-slate-600">{member.last_visit ? new Date(member.last_visit).toLocaleDateString('en-GB') : '—'}</span></td>
                        <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end items-center gap-1.5">
                            {statusInfo.label === 'UNPAID' && <button onClick={() => { setSelectedMember(member); setShowActivateModal(true); }} className="inline-flex items-center gap-1 bg-purple-50 text-purple-600 px-2.5 py-1.5 rounded-lg border border-purple-100 text-[10px] font-black uppercase hover:bg-purple-600 hover:text-white transition-all shadow-sm"><Zap size={10} fill="currentColor" /> Initiate</button>}
                            {statusInfo.label === 'EXPIRED' && <button onClick={() => { setSelectedMember(member); setShowActivateModal(true); }} className="inline-flex items-center gap-1 bg-rose-50 text-rose-600 px-2.5 py-1.5 rounded-lg border border-rose-100 text-[10px] font-black uppercase hover:bg-rose-600 hover:text-white transition-all shadow-sm"><RefreshCw size={10} /> Renew</button>}
                            {(statusInfo.label === 'INACTIVE' || statusInfo.label === 'EXPIRING SOON') && <button onClick={() => sendWhatsApp(member, statusInfo.label === 'INACTIVE' ? 'followup' : 'reminder')} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2.5 py-1.5 rounded-lg border border-emerald-100 text-[10px] font-black uppercase hover:bg-emerald-600 hover:text-white transition-all shadow-sm"><MessageSquare size={10} fill="currentColor" /> Remind</button>}
                            <button onClick={(e) => handleManualCheckIn(e, member.id)} title="Manual Check-In" className="p-1.5 text-emerald-500 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-500 hover:text-white transition-all"><CheckCircle size={13} /></button>
                            <button onClick={(e) => { e.stopPropagation(); handleEditClick(member); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"><Edit2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              </table>
              </div>
            </>
          )}
        </div>

      </div>

      {selectedIds.length > 0 && (
        <div className="fixed mobile-floating-offset left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-[560px] bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex flex-wrap items-center gap-3 z-[100] border border-slate-700 backdrop-blur-md bg-opacity-95 animate-in slide-in-from-bottom-10">
          <div className="flex flex-col"><span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Bulk Actions</span><span className="text-sm font-black">{selectedIds.length} Selected</span></div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={handleBulkReminder} className="flex items-center gap-2 text-xs font-bold bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-xl border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all"><Zap size={14} fill="currentColor" /> Send Reminders</button>
            <button className="flex items-center gap-2 text-xs font-bold bg-rose-500/10 text-rose-400 px-4 py-2 rounded-xl border border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all"><Trash2 size={14} /> Delete</button>
            <button onClick={() => setSelectedIds([])} className="text-slate-400 hover:text-white ml-1"><X size={18} /></button>
          </div>
        </div>
      )}

      {/* ── Member detail bottom sheet ─────────────────────────── */}
      <div className={`drawer-backdrop ${showDetailsModal && selectedMember ? 'open' : ''}`} onClick={() => setShowDetailsModal(false)} />
      <div className={`drawer-sheet ${showDetailsModal && selectedMember ? 'open' : ''}`}>
        {selectedMember && (<>
          {/* drag handle */}
          <div className="flex justify-center pt-2.5 pb-1.5 shrink-0 bg-white">
            <div className="w-9 h-[3px] rounded-full bg-slate-200" />
          </div>

          {/* header */}
          <div className="relative px-5 pt-3 pb-10 shrink-0" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 60%, #24243e 100%)' }}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em] mb-0.5">Member Profile</p>
                <h2 className="text-white text-lg font-black leading-tight">{selectedMember.full_name}</h2>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Joined {selectedMember.joining_date ? new Date(selectedMember.joining_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                </p>
              </div>
              <button onClick={() => setShowDetailsModal(false)} className="text-white/50 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all mt-0.5"><X size={18} /></button>
            </div>
          </div>

          {/* avatar — centred, overlapping header */}
          <div className="flex flex-col items-center -mt-9 pb-1 shrink-0 relative z-10">
            <div className="w-[72px] h-[72px] rounded-full border-[3px] border-white shadow-xl overflow-hidden">
              <GradientAvatar name={selectedMember.full_name} src={selectedMember.profile_pic} sizePx={72} imageFit="object-cover" className="" />
            </div>
            <span className={`mt-1.5 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full ${STATUS_PILLS[getStatusInfo(selectedMember).label] || 'bg-slate-100 text-slate-500'}`}>
              {getStatusInfo(selectedMember).label}
            </span>
          </div>
          {/* scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 space-y-3 pt-2 pb-1 no-scrollbar">
            {/* contact row */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center shrink-0"><Phone size={12} /></div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-0.5">Phone</p>
                    <p className="text-sm font-bold text-slate-900 truncate">{selectedMember.phone}</p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleCall(selectedMember.phone)} className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-sm"><Phone size={10} fill="currentColor" /></button>
                  <button onClick={() => sendWhatsApp(selectedMember, 'reminder')} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"><MessageSquare size={10} fill="currentColor" /></button>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex items-center gap-2">
                <div className="w-7 h-7 bg-indigo-50 text-indigo-500 rounded-lg flex items-center justify-center shrink-0"><Mail size={12} /></div>
                <div className="min-w-0">
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-none mb-0.5">Email</p>
                  <p className="text-xs font-bold text-slate-900 truncate">{selectedMember.email || '—'}</p>
                </div>
              </div>
            </div>

            {/* stats row */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-blue-50/60 p-2.5 rounded-xl border border-blue-100 text-center">
                <p className="text-[9px] font-bold text-blue-500 uppercase tracking-tighter mb-0.5">Visits</p>
                <p className="text-base font-black text-blue-900">{selectedMember.total_visits || 0}</p>
              </div>
              <div className="bg-orange-50/60 p-2.5 rounded-xl border border-orange-100 text-center">
                <p className="text-[9px] font-bold text-orange-500 uppercase tracking-tighter mb-0.5">Streak</p>
                <div className="flex items-center justify-center gap-0.5">
                  <Flame size={10} className="text-orange-500" fill="currentColor" />
                  <p className="text-base font-black text-orange-900">{selectedMember.streak || 0}</p>
                </div>
              </div>
              <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 text-center">
                <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter mb-0.5">Paid</p>
                <p className="text-xs font-black text-emerald-900">₹{selectedMember.total_paid || 0}</p>
              </div>
              <div className="bg-purple-50/60 p-2.5 rounded-xl border border-purple-100 text-center">
                <p className="text-[9px] font-bold text-purple-500 uppercase tracking-tighter mb-0.5">Plan</p>
                <p className="text-[10px] font-black text-purple-900 uppercase truncate">{selectedMember.plan_name || '—'}</p>
              </div>
            </div>

            {/* validity row */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Calendar size={11} /><span className="text-[9px] font-bold uppercase tracking-tight">Valid Till</span></div>
                <p className={`font-bold text-sm ${selectedMember.days_left <= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                  {selectedMember.expiry_date ? new Date(selectedMember.expiry_date).toLocaleDateString('en-GB') : 'No Active Plan'}
                </p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-400 mb-1"><TrendingUp size={11} /><span className="text-[9px] font-bold uppercase tracking-tight">Last Check-In</span></div>
                <p className="font-bold text-sm text-slate-700">{selectedMember.last_visit ? new Date(selectedMember.last_visit).toLocaleDateString('en-GB') : 'Never'}</p>
              </div>
            </div>

            {/* payment history */}
            {selectedMember.payment_history?.length > 0 && (
              <div>
                <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><CreditCard size={11} /> Payment History</h3>
                <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="max-h-[150px] overflow-y-auto no-scrollbar">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider">Date</th>
                          <th className="px-3 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider">Mode</th>
                          <th className="px-3 py-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-2 text-right text-[9px] font-black text-slate-400 uppercase tracking-wider">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-600">
                        {selectedMember.payment_history.map((pay, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-3 py-2 font-medium">{new Date(pay.payment_date).toLocaleDateString('en-GB')}</td>
                            <td className="px-3 py-2 font-medium">{pay.payment_mode || 'Cash'}</td>
                            <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase ${!pay.status || pay.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{pay.status || 'Paid'}</span></td>
                            <td className="px-3 py-2 text-right font-black text-slate-900">₹{pay.amount_paid}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* action bar — no extra bottom padding needed, drawer sits above nav */}
          <div className="px-5 py-3 border-t border-slate-100 flex gap-2 shrink-0 bg-slate-50/60">
            {(getStatusInfo(selectedMember).label === 'EXPIRED' || getStatusInfo(selectedMember).label === 'UNPAID') && (
              <button onClick={() => { setShowDetailsModal(false); setShowActivateModal(true); }} className="flex-1 py-2.5 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 transition-all hover:opacity-90 active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                <Zap size={13} fill="currentColor" />{getStatusInfo(selectedMember).label === 'EXPIRED' ? 'Renew' : 'Activate'}
              </button>
            )}
            <button onClick={() => sendWhatsApp(selectedMember, 'reminder')} className="flex-1 py-2.5 bg-emerald-500 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 hover:bg-emerald-600 transition-all active:scale-95">
              <MessageSquare size={13} fill="currentColor" /> WhatsApp
            </button>
            <button onClick={() => { setShowDetailsModal(false); handleEditClick(selectedMember); }} className="flex-1 py-2.5 bg-slate-800 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 hover:bg-slate-700 transition-all active:scale-95">
              <Edit2 size={13} /> Edit
            </button>
          </div>
        </>)}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 100%)' }}>
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center"><Edit2 size={18} /></div><div><h2 className="text-lg font-black">Edit Member</h2><p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Update Profile</p></div></div>
              <button onClick={() => setShowEditModal(false)} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateMember} className="p-6 space-y-5">
              <div className="flex justify-center -mt-1"><div className="relative group"><div className="w-20 h-20 rounded-full overflow-hidden shadow-xl border-4 border-white">{editFile ? <img src={URL.createObjectURL(editFile)} alt="Preview" className="w-full h-full object-cover" /> : <GradientAvatar name={members.find((m) => m.id === editFormData.id)?.full_name || editFormData.full_name} src={members.find((m) => m.id === editFormData.id)?.profile_pic} sizePx={80} />}</div><label className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-all rounded-full cursor-pointer">Change<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const ok = await handleProfileImageSelect(e.target.files?.[0], 'edit'); if (!ok) e.target.value = ''; }} /></label></div></div>
              <div className="space-y-4">
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name</label><input type="text" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.full_name} onChange={(e) => setEditFormData({ ...editFormData, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone</label><input type="text" required inputMode="numeric" maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.phone} onChange={(e) => setEditFormData({ ...editFormData, phone: normalizePhoneInput(e.target.value) })} /></div>
                  <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email</label><input type="email" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.email} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} /></div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-2xl border border-indigo-100"><label className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-3"><Clock size={12} /> Quick Extend Membership</label><div className="grid grid-cols-3 gap-2">{[2, 5, 15].map((days) => (<button key={days} type="button" onClick={() => handleQuickExtend(days)} className="py-2.5 bg-white border border-indigo-200 text-indigo-700 text-xs font-black rounded-xl hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all shadow-sm active:scale-95">+{days} Days</button>))}</div></div>
              <button type="submit" className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>Save Changes</button>
              <div className="border-t border-dashed border-rose-100 pt-4"><p className="text-[9px] font-black text-rose-300 uppercase tracking-widest mb-3 text-center">Danger Zone</p><div className="flex gap-2"><button type="button" onClick={handleRemovePlan} className="flex-1 py-2.5 text-[10px] font-bold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-all"><Ban size={11} /> Remove Plan</button><button type="button" onClick={handleDeleteMember} className="flex-1 py-2.5 text-[10px] font-bold text-rose-500 border border-rose-200 bg-rose-50 rounded-xl hover:bg-rose-500 hover:text-white flex items-center justify-center gap-1.5 transition-all"><Trash2 size={11} /> Delete Member</button></div></div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}>
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><UserPlus size={18} /></div><div><h2 className="text-lg font-black">New Member</h2><p className="text-white/60 text-[10px] font-bold uppercase tracking-wider">Add to GymVault</p></div></div>
              <button onClick={() => { setShowAddModal(false); setAddSelectedPlanId(''); }} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddMember} className="p-6 space-y-4">
              <div className="flex flex-col items-center"><label className="cursor-pointer block"><div className="w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">{previewUrl ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-1 text-slate-300"><UserPlus size={28} /><span className="text-[9px] font-bold uppercase tracking-wider">Upload</span></div>}</div><input type="file" accept="image/*" className="hidden" onChange={async (e) => { const ok = await handleProfileImageSelect(e.target.files?.[0], 'add'); if (!ok) e.target.value = ''; }} /></label><p className="text-[10px] text-slate-400 font-medium mt-2">Click to upload photo (optional)</p></div>
              <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name *</label><input type="text" required placeholder="e.g. Rahul Sharma" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.full_name} onChange={(e) => setAddFormData({ ...addFormData, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone *</label><input type="text" required inputMode="numeric" maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" placeholder="9876543210" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.phone} onChange={(e) => setAddFormData({ ...addFormData, phone: normalizePhoneInput(e.target.value) })} /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email *</label><input type="email" required placeholder="rahul@email.com" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.email} onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })} /></div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5"><Zap size={10} className="text-emerald-500" /> Assign Plan Now (optional)</label>
                <select className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 text-sm font-semibold text-slate-700 appearance-none cursor-pointer transition-all" value={addSelectedPlanId} onChange={(e) => setAddSelectedPlanId(e.target.value)}><option value="">Skip — assign plan later</option>{plans.map((p) => (<option key={p.id} value={p.id}>{p.name} — ₹{p.price} / {p.duration_days}d</option>))}</select>
                {addSelectedPlanId && <p className="text-[10px] text-emerald-600 font-bold mt-1.5 ml-0.5">Payment will be collected in the next step →</p>}
              </div>
              <button type="submit" className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(5,150,105,0.35)' }}>{addSelectedPlanId ? 'Add Member & Assign Plan →' : 'Add Member'}</button>
            </form>
          </div>
        </div>
      )}

      {showActivateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 border">
            <div className="p-8 text-center bg-gradient-to-b from-slate-50 to-white">
              <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 rotate-3 shadow-inner"><Zap size={32} fill="currentColor" /></div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Activate Plan</h2>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">For {selectedMember?.full_name}</p>
            </div>
            <div className="px-8 pb-8 space-y-4">
              <div className="relative">
                <select required className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-purple-500 focus:outline-none text-sm font-black appearance-none cursor-pointer" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
                  <option value="">Select Membership Plan...</option>
                  {plans.map((p) => (<option key={p.id} value={p.id}>{p.name} — ₹{p.price}</option>))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><Calendar size={18} /></div>
              </div>
              <div className="pt-2 space-y-3">
                <button onClick={() => handleActivateSubscription(null, 'online')} className="w-full py-4 text-white rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 6px 20px rgba(99,102,241,0.4)' }}><CreditCard size={18} /> Proceed for Payment</button>
                <button onClick={() => handleActivateSubscription(null, 'cash')} className="w-full py-4 bg-white text-slate-600 border-2 border-slate-100 rounded-2xl font-black text-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2"><span className="text-emerald-500 font-black text-lg">₹</span> Paid as Cash</button>
              </div>
              <button onClick={() => setShowActivateModal(false)} className="w-full text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Cancel Transaction</button>
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[300] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setPreviewImage(null)}>
          <div className="relative animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <button className="absolute -top-16 left-1/2 -translate-x-1/2 text-white/40 hover:text-white flex flex-col items-center" onClick={() => setPreviewImage(null)}><X size={32} strokeWidth={1.5} /><span className="text-[9px] font-bold tracking-[0.2em] mt-1 uppercase">Close</span></button>
            <div className="w-[300px] h-[300px] md:w-[380px] md:h-[380px] rounded-full border-[6px] border-white shadow-2xl overflow-hidden bg-slate-800"><img src={previewImage} alt="Profile" className="w-full h-full object-cover select-none" /></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembersPage;