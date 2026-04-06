import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Search, Edit2, Plus, X, Zap, RefreshCw, Trash2, Ban, Calendar,
  CreditCard, Clock, AlertTriangle, CheckCircle, Flame, TrendingUp,
  MessageSquare, ListChecks, UserPlus, Phone, Download, Users, Mail, Snowflake,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import { buildUpiCollectionUri, copyCollectionText, describeCollectionLinkDelivery, formatCollectionAmount, openCollectionLink } from './utils/memberCollection';
import { buildReminderPreviewDialog, getReminderPreviewBlockReason, previewWhatsAppReminders, sendWhatsAppReminders, summarizeReminderResult } from './utils/whatsappReminders';
import PageLoader from './PageLoader';
import { reportClientError } from './utils/clientErrorReporter';

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

const STATUS_PILLS = { ACTIVE: 'bg-emerald-100 text-emerald-700', INACTIVE: 'bg-amber-100 text-amber-700', FROZEN: 'bg-cyan-100 text-cyan-700', 'EXPIRING SOON': 'bg-orange-100 text-orange-700', EXPIRED: 'bg-rose-100 text-rose-700', UNPAID: 'bg-slate-100 text-slate-500' };

const extractArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const getApiErrorMessage = (error, fallback) => {
  const payload = error?.response?.data;
  if (payload && typeof payload === 'object') {
    return String(payload.message || payload.error || fallback);
  }
  return fallback;
};

const normalizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
const isValidPhoneInput = (value) => /^\d{10}$/.test(normalizePhoneInput(value));
const toDateInputValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_MEMBER_DOCUMENT_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_MAX_DIMENSION = 1600;
const allowedProfileImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);
const allowedMemberDocumentMimeTypes = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);
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

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Unable to read file.'));
  reader.readAsDataURL(file);
});

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

const hasPermission = (user, permission) => {
  if (!permission) return true;
  if (!user) return false;
  if (String(user.role || '').toUpperCase() === 'OWNER') return true;

  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (permissions.includes('*') || permissions.includes(permission)) return true;

  const [scope] = String(permission).split(':');
  return Boolean(scope && permissions.includes(`${scope}:*`));
};

const normalizeMemberRecord = (member) => ({
  ...member,
  profile_pic: normalizeProfileImageUrl(member?.profile_pic),
});

const getLatestPaymentDate = (member) => member?.latest_payment_date || (Array.isArray(member?.payment_history) ? member.payment_history[0]?.payment_date : null) || null;

const getEffectiveVisitSource = (member) => member?.last_visit || getLatestPaymentDate(member) || null;

const SuccessModal = ({ memberName, onClose, onDownload }) => {
  const [countdown, setCountdown] = useState(4);
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    const auto = setTimeout(() => { clearInterval(t); onClose(); }, 4000);
    return () => { clearInterval(t); clearTimeout(auto); };
  }, [onClose]);
  return (
    <div className="app-modal-shell z-[200] backdrop-blur-md animate-in fade-in duration-300" style={{ background: 'rgba(15,23,42,0.85)' }}>
      <div className="app-modal-panel p-10 rounded-[40px] shadow-2xl text-center flex flex-col items-center animate-in zoom-in-95 duration-300 max-w-sm w-full border border-emerald-500/20" style={{ background: 'linear-gradient(180deg, #0d2b1e 0%, #0f172a 100%)' }}>
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.05) 70%)', boxShadow: '0 0 40px rgba(16,185,129,0.3)' }}>
            <CheckCircle size={52} className="text-emerald-400" strokeWidth={1.5} />
          </div>
          <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs font-black">{countdown}</div>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight mb-1">Activated!</h2>
        <p className="text-emerald-400/80 font-semibold text-sm mb-2">Membership live for</p>
        <p className="text-white font-black text-lg mb-8">{memberName}</p>
        <div className="w-full space-y-3">
          <button onClick={onDownload} className="w-full py-4 text-white rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-[0.98] hover:opacity-90" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 6px 20px rgba(16,185,129,0.35)' }}><Download size={18} /> Download Receipt</button>
          <button onClick={onClose} className="w-full py-2 text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-slate-300 transition-colors">Close · auto in {countdown}s</button>
        </div>
      </div>
    </div>
  );
};

const MembersPage = ({ appRuntime, defaultFilter = 'All', focusMemberId = null, focusAction = null, onFocusHandled, isActive = true }) => {
  const { token, toast, showConfirm, currentUser = null } = appRuntime;
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState(defaultFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [loading, setLoading] = useState(true);

  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [addMemberSubmitting, setAddMemberSubmitting] = useState(false);
  const [activatingMode, setActivatingMode] = useState('');
  const [activationOnlineMode, setActivationOnlineMode] = useState('RAZORPAY');
  const [activationCollectionContext, setActivationCollectionContext] = useState(null);
  const [activationRazorpayContext, setActivationRazorpayContext] = useState(null);
  const [activationReference, setActivationReference] = useState('');
  const [memberActionLoading, setMemberActionLoading] = useState(null);
  const [reminderLoadingKey, setReminderLoadingKey] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState('');
  const activationRazorpayPollBusyRef = useRef(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);

  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [addSelectedPlanId, setAddSelectedPlanId] = useState('');
  const [addFormData, setAddFormData] = useState({ full_name: '', email: '', phone: '' });
  const [editFormData, setEditFormData] = useState({ id: '', full_name: '', email: '', phone: '' });
  const [freezeFormData, setFreezeFormData] = useState({ freeze_end_date: '', freeze_reason: '' });

  // Lifecycle drawer state
  const [drawerTab, setDrawerTab] = useState('profile');
  const [memberNotes, setMemberNotes] = useState([]);
  const [memberDocs, setMemberDocs] = useState([]);
  const [memberWaivers, setMemberWaivers] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [docForm, setDocForm] = useState({ doc_type: 'ID Proof', doc_url: '', doc_name: '', notes: '' });
  const [docSaving, setDocSaving] = useState(false);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({
    onboarding_complete: false,
    emergency_contact: '',
    gender: '',
    date_of_birth: '',
    address: '',
    blood_group: '',
    medical_notes: '',
  });

  const membersListRef = useRef(null);
  const membersScrollState = useRef({ lastY: 0, velocity: 0, rafId: null });
  const fetchMembersRef = useRef(null);
  const checkActivationRazorpayStatusRef = useRef(null);
  const activationResumeStateRef = useRef({
    showActivateModal: false,
    activationOnlineMode: 'RAZORPAY',
    paymentLinkId: '',
    selectedPlanId: '',
    plans: [],
  });
  const docCameraInputRef = useRef(null);
  const docGalleryInputRef = useRef(null);
  const memberActionTimerRef = useRef(null);

  const [addFile, setAddFile] = useState(null);
  const [editFile, setEditFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const canWriteMembers = hasPermission(currentUser, 'members:write');
  const canWritePayments = hasPermission(currentUser, 'payments:write');
  const canWriteAttendance = hasPermission(currentUser, 'attendance:write');

  const notifyDashboardDataChanged = () => {
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
      detail: {
        source: 'members',
        at: Date.now(),
      },
    }));
  };

  const syncOnboardingForm = (member) => {
    setOnboardingForm({
      onboarding_complete: Boolean(member?.onboarding_complete),
      emergency_contact: String(member?.emergency_contact || ''),
      gender: String(member?.gender || ''),
      date_of_birth: toDateInputValue(member?.date_of_birth),
      address: String(member?.address || ''),
      blood_group: String(member?.blood_group || ''),
      medical_notes: String(member?.medical_notes || ''),
    });
  };

  const loadMemberDetails = async (memberId) => {
    const res = await axios.get(`/api/members/${memberId}`, { headers: { 'x-auth-token': token } });
    const normalized = normalizeMemberRecord(res.data);
    setSelectedMember(normalized);
    syncOnboardingForm(normalized);
    return normalized;
  };

  // ── Lifecycle data fetchers ──
  const fetchMemberNotes = async (memberId) => {
    try {
      const res = await axios.get(`/api/members/${memberId}/notes`, { headers: { 'x-auth-token': token } });
      setMemberNotes(Array.isArray(res.data) ? res.data : []);
    } catch { setMemberNotes([]); }
  };
  const fetchMemberDocs = async (memberId) => {
    try {
      const res = await axios.get(`/api/members/${memberId}/documents`, { headers: { 'x-auth-token': token } });
      setMemberDocs(Array.isArray(res.data) ? res.data : []);
    } catch { setMemberDocs([]); }
  };
  const fetchMemberWaivers = async (memberId) => {
    try {
      const res = await axios.get(`/api/members/${memberId}/waivers`, { headers: { 'x-auth-token': token } });
      setMemberWaivers(Array.isArray(res.data) ? res.data : []);
    } catch { setMemberWaivers([]); }
  };
  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedMember) return;
    try {
      await axios.post(`/api/members/${selectedMember.id}/notes`, { note: newNote.trim(), note_type: 'general' }, { headers: { 'x-auth-token': token } });
      setNewNote('');
      fetchMemberNotes(selectedMember.id);
    } catch { toast?.('Failed to add note', 'error'); }
  };
  const handleDeleteNote = (noteId) => {
    if (!selectedMember) return;
    const runDelete = async () => {
      try {
        await axios.delete(`/api/members/${selectedMember.id}/notes/${noteId}`, { headers: { 'x-auth-token': token } });
        fetchMemberNotes(selectedMember.id);
        toast?.('Note deleted', 'success');
      } catch {
        toast?.('Failed to delete note', 'error');
      }
    };
    if (showConfirm) {
      showConfirm({
        title: 'Delete Note',
        message: 'This note will be removed permanently.',
        confirmLabel: 'Delete Note',
        variant: 'danger',
        onConfirm: runDelete,
      });
      return;
    }
    if (window.confirm('Delete this note?')) runDelete();
  };
  const handleAddDocument = async () => {
    const normalizedDocType = String(docForm.doc_type || '').trim();
    const normalizedDocUrl = String(docForm.doc_url || '').trim();
    if (!selectedMember) return;
    if (!normalizedDocType || !normalizedDocUrl) {
      toast?.('Choose a document from camera or gallery first.', 'warning');
      return;
    }
    setDocSaving(true);
    try {
      await axios.post(`/api/members/${selectedMember.id}/documents`, {
        doc_type: normalizedDocType,
        doc_url: normalizedDocUrl,
        doc_name: String(docForm.doc_name || '').trim(),
        notes: docForm.notes.trim(),
      }, { headers: { 'x-auth-token': token } });
      setDocForm({ doc_type: 'ID Proof', doc_url: '', doc_name: '', notes: '' });
      fetchMemberDocs(selectedMember.id);
      toast?.('Document added', 'success');
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'Failed to add document'), 'error');
    } finally {
      setDocSaving(false);
    }
  };
  const handleSelectDocumentFile = async (event) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = '';
    if (!selectedFile) return;

    const mimeType = String(selectedFile.type || '').toLowerCase();
    if (!allowedMemberDocumentMimeTypes.has(mimeType)) {
      toast?.('Only JPG, JPEG, PNG, and WEBP documents are supported.', 'warning');
      return;
    }

    try {
      const normalized = await normalizeProfileImageFile(selectedFile);
      if (normalized.error || !normalized.file) {
        toast?.(normalized.error || 'Unable to process this document.', 'error');
        return;
      }

      if (Number(normalized.file.size || 0) > MAX_MEMBER_DOCUMENT_BYTES) {
        toast?.('Document is too large. Please keep it under 2MB.', 'warning');
        return;
      }

      const dataUrl = await readFileAsDataUrl(normalized.file);
      setDocForm((prev) => ({
        ...prev,
        doc_url: dataUrl,
        doc_name: normalized.file.name || selectedFile.name || 'document.jpg',
      }));
      toast?.('Document ready to upload.', 'success');
    } catch (_err) {
      toast?.('Unable to read this document. Please try another image.', 'error');
    }
  };
  const clearSelectedDocument = () => {
    setDocForm((prev) => ({ ...prev, doc_url: '', doc_name: '' }));
  };
  const handleDeleteDocument = (docId) => {
    if (!selectedMember) return;
    const runDelete = async () => {
      try {
        await axios.delete(`/api/members/${selectedMember.id}/documents/${docId}`, { headers: { 'x-auth-token': token } });
        fetchMemberDocs(selectedMember.id);
        toast?.('Document deleted', 'success');
      } catch {
        toast?.('Failed to delete document', 'error');
      }
    };
    if (showConfirm) {
      showConfirm({
        title: 'Delete Document',
        message: 'This document reference will be removed permanently.',
        confirmLabel: 'Delete Document',
        variant: 'danger',
        onConfirm: runDelete,
      });
      return;
    }
    if (window.confirm('Delete this document?')) runDelete();
  };
  const handleSaveOnboarding = async () => {
    if (!selectedMember) return;
    setSavingOnboarding(true);
    try {
      await axios.patch(`/api/members/${selectedMember.id}/onboarding`, onboardingForm, { headers: { 'x-auth-token': token } });
      await loadMemberDetails(selectedMember.id);
      await fetchMembers();
      toast?.('Onboarding details saved', 'success');
    } catch {
      toast?.('Failed to save onboarding details', 'error');
    } finally {
      setSavingOnboarding(false);
    }
  };
  const handleCancelMember = async () => {
    if (!selectedMember) return;
    try {
      await axios.post(`/api/members/${selectedMember.id}/cancel`, { cancellation_reason: cancelReason }, { headers: { 'x-auth-token': token } });
      toast?.('Member cancelled', 'success');
      setShowCancelModal(false);
      setCancelReason('');
      setShowDetailsModal(false);
      fetchMembers();
      notifyDashboardDataChanged();
    } catch { toast?.('Failed to cancel member', 'error'); }
  };
  const handleSignWaiver = async () => {
    if (!selectedMember) return;
    try {
      await axios.post(`/api/members/${selectedMember.id}/waiver`, { waiver_type: 'general', waiver_text: 'Standard gym liability waiver' }, { headers: { 'x-auth-token': token } });
      toast?.('Waiver signed', 'success');
      fetchMemberWaivers(selectedMember.id);
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'Failed to sign waiver'), 'error');
    }
  };

  const renderOnboardingCard = () => (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-indigo-500 mb-1">Onboarding</div>
          <p className="text-sm font-black text-slate-900">Health, identity, and emergency details</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${onboardingForm.onboarding_complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {onboardingForm.onboarding_complete ? 'Complete' : 'Pending'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="min-w-0">
          <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Emergency Contact</label>
          <input value={onboardingForm.emergency_contact} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, emergency_contact: event.target.value }))} className="w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700" disabled={!canWriteMembers} />
        </div>
        <div className="min-w-0">
          <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Gender</label>
          <select value={onboardingForm.gender} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, gender: event.target.value }))} className="w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700" disabled={!canWriteMembers}>
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Date of Birth</label>
          <input type="date" value={onboardingForm.date_of_birth} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, date_of_birth: event.target.value }))} className="block w-full min-w-0 max-w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700" style={{ WebkitAppearance: 'none', appearance: 'none' }} disabled={!canWriteMembers} />
        </div>
        <div className="min-w-0">
          <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Blood Group</label>
          <input value={onboardingForm.blood_group} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, blood_group: event.target.value }))} className="w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700" disabled={!canWriteMembers} placeholder="A+, O-, B+..." />
        </div>
      </div>

      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Address</label>
        <textarea value={onboardingForm.address} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, address: event.target.value }))} rows={2} className="w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700 resize-none" disabled={!canWriteMembers} />
      </div>

      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Medical Notes</label>
        <textarea value={onboardingForm.medical_notes} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, medical_notes: event.target.value }))} rows={3} className="w-full px-3 py-2 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700 resize-none" disabled={!canWriteMembers} placeholder="Injury history, movement restrictions, medications..." />
      </div>

      <label className="flex items-center justify-between rounded-xl border border-indigo-100 bg-white px-3 py-2.5 gap-3">
        <span className="text-sm font-bold text-slate-700">Mark onboarding complete</span>
        <input type="checkbox" checked={onboardingForm.onboarding_complete} onChange={(event) => setOnboardingForm((prev) => ({ ...prev, onboarding_complete: event.target.checked }))} disabled={!canWriteMembers} />
      </label>

      {canWriteMembers && (
        <button onClick={handleSaveOnboarding} disabled={savingOnboarding} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wider hover:bg-indigo-700 transition-all disabled:opacity-60">
          {savingOnboarding ? 'Saving...' : 'Save Onboarding'}
        </button>
      )}
    </div>
  );

  // Load lifecycle data when drawer opens
  useEffect(() => {
    return () => {
      if (memberActionTimerRef.current) {
        clearTimeout(memberActionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (showDetailsModal && selectedMember?.id) {
      setDrawerTab('profile');
      syncOnboardingForm(selectedMember);
      setDocForm({ doc_type: 'ID Proof', doc_url: '', doc_name: '', notes: '' });
      fetchMemberNotes(selectedMember.id);
      fetchMemberDocs(selectedMember.id);
      fetchMemberWaivers(selectedMember.id);
      loadMemberDetails(selectedMember.id).catch(() => {});
    }
  }, [showDetailsModal, selectedMember?.id]);

  const openAddMemberModal = () => {
    if (!canWriteMembers) {
      toast?.('You do not have permission to add members.', 'warning');
      return;
    }
    setShowAddModal(true);
  };

  const openActivateModalForMember = (member) => {
    if (!canWritePayments) {
      toast?.('You do not have permission to manage memberships or payments.', 'warning');
      return;
    }
    setSelectedMember(member);
    setSelectedPlanId('');
    setActivationOnlineMode('RAZORPAY');
    setActivationCollectionContext(null);
    setActivationRazorpayContext(null);
    setActivationReference('');
    setActivatingMode('');
    setShowActivateModal(true);
  };

  const openActivateModalWithFeedback = (member, actionKey) => {
    if (!canWritePayments) {
      toast?.('You do not have permission to manage memberships or payments.', 'warning');
      return;
    }

    setMemberActionLoading(actionKey);
    if (memberActionTimerRef.current) {
      clearTimeout(memberActionTimerRef.current);
    }

    memberActionTimerRef.current = setTimeout(() => {
      setSelectedMember(member);
      setSelectedPlanId('');
      setActivationOnlineMode('RAZORPAY');
      setActivationCollectionContext(null);
      setActivationRazorpayContext(null);
      setActivationReference('');
      setActivatingMode('');
      setShowActivateModal(true);
      setMemberActionLoading(null);
      memberActionTimerRef.current = null;
    }, 150);
  };

  const closeActivateModal = () => {
    setShowActivateModal(false);
    setSelectedPlanId('');
    setActivationOnlineMode('RAZORPAY');
    setActivationCollectionContext(null);
    setActivationRazorpayContext(null);
    setActivationReference('');
    setActivatingMode('');
  };

  const handleCopyActivationDetail = async (value, successMessage) => {
    const copied = await copyCollectionText(value);
    if (copied) {
      toast?.(successMessage, 'success');
      return;
    }
    toast?.('Copy failed on this device. Long-press and copy it manually.', 'warning');
  };

  const finishActivationSuccess = async (plan, paymentId) => {
    if (canWriteAttendance) {
      await axios.put(`/api/members/${selectedMember.id}/check-in`, {}, { headers: { 'x-auth-token': token } });
    }
    setReceiptData({ memberName: selectedMember.full_name, planName: plan.name, amount: plan.price, payId: paymentId });
    closeActivateModal();
    setShowSuccessAnim(true);
  };

  const checkActivationRazorpayStatus = async (plan, { manual = false } = {}) => {
    const paymentLinkId = activationRazorpayContext?.payment_link?.id;
    if (!selectedMember?.id || !plan?.id || !paymentLinkId || activationRazorpayPollBusyRef.current) {
      return false;
    }

    activationRazorpayPollBusyRef.current = true;
    try {
      const statusRes = await axios.post(
        '/api/memberships/online/payment-link-status',
        {
          member_id: selectedMember.id,
          plan_id: plan.id,
          payment_link_id: paymentLinkId,
        },
        { headers: { 'x-auth-token': token } }
      );

      if (!statusRes.data?.paid) {
        if (manual) {
          toast?.('Payment is still pending on Razorpay.', 'warning');
        }
        return false;
      }

      setActivatingMode('verifying');
      await fetchMembers();
      notifyDashboardDataChanged();
      await finishActivationSuccess(plan, statusRes.data?.payment_id || paymentLinkId);
      return true;
    } catch (err) {
      if (manual) {
        toast?.(err?.response?.data?.error || 'Unable to verify Razorpay payment right now.', 'error');
      }
      return false;
    } finally {
      activationRazorpayPollBusyRef.current = false;
    }
  };

  checkActivationRazorpayStatusRef.current = checkActivationRazorpayStatus;
  activationResumeStateRef.current = {
    showActivateModal,
    activationOnlineMode,
    paymentLinkId: activationRazorpayContext?.payment_link?.id || '',
    selectedPlanId,
    plans,
  };

  useEffect(() => {
    if (!token || !isActive) return undefined;

    const refreshMembers = () => {
      if (document.visibilityState && document.visibilityState === 'hidden') return;
      fetchMembersRef.current?.();

      const resumeState = activationResumeStateRef.current;
      if (!resumeState.showActivateModal || resumeState.activationOnlineMode !== 'RAZORPAY' || !resumeState.paymentLinkId) {
        return;
      }

      const selectedPlan = resumeState.plans.find((plan) => plan.id === parseInt(resumeState.selectedPlanId, 10));
      if (selectedPlan) {
        checkActivationRazorpayStatusRef.current?.(selectedPlan, { manual: false });
      }
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        refreshMembers();
      }
    };

    window.addEventListener('focus', refreshMembers);
    window.addEventListener('pageshow', refreshMembers);
    window.addEventListener('gymvault:app-resumed', refreshMembers);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', refreshMembers);
      window.removeEventListener('pageshow', refreshMembers);
      window.removeEventListener('gymvault:app-resumed', refreshMembers);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [token, isActive]);

  useEffect(() => {
    const selectedPlan = plans.find((plan) => plan.id === parseInt(selectedPlanId, 10));
    if (!showActivateModal || activationOnlineMode !== 'RAZORPAY' || !activationRazorpayContext?.payment_link?.id || !selectedPlan) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      checkActivationRazorpayStatus(selectedPlan);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activationOnlineMode, activationRazorpayContext, plans, selectedPlanId, showActivateModal]);

  const openFreezeModalForMember = (member) => {
    if (!canWritePayments) {
      toast?.('You do not have permission to pause memberships.', 'warning');
      return;
    }

    const membershipStatus = String(member?.membership_status || '').toUpperCase();
    if (membershipStatus !== 'ACTIVE') {
      toast?.('Only active memberships can be frozen.', 'warning');
      return;
    }

    setSelectedMember(member);
    setFreezeFormData({
      freeze_end_date: toDateInputValue(member?.freeze_end_date),
      freeze_reason: String(member?.freeze_reason || ''),
    });
    setShowFreezeModal(true);
  };

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

  const fetchMembers = async () => {
    try {
      const res = await axios.get('/api/members', { headers: { 'x-auth-token': token } });
      const normalizedMembers = extractArray(res.data, ['members', 'rows', 'items']).map(normalizeMemberRecord);
      setMembers(normalizedMembers);
      // Sync selectedMember so photo & data stay fresh after any upload/edit
      setSelectedMember(prev => {
        if (!prev) return prev;
        const fresh = normalizedMembers.find(m => m.id === prev.id);
        return fresh ? { ...prev, ...fresh } : prev;
      });
    } catch (err) { toast?.('Failed to load members', 'error'); } finally { setLoading(false); }
  };

  fetchMembersRef.current = fetchMembers;

  const fetchPlans = async () => {
    try {
      const res = await axios.get('/api/memberships/plans', { headers: { 'x-auth-token': token } });
      setPlans(extractArray(res.data, ['plans', 'rows', 'items']));
    } catch (err) { reportClientError('Members fetch plans', err); }
  };

  useEffect(() => {
    if (!token) return;
    fetchPlans();
  }, [token]);

  useEffect(() => {
    if (!token || !isActive) return;
    setLoading(true);
    fetchMembers();
  }, [token, isActive]);

  // Instantly refresh when dashboard check-in or payment fires the data-changed event
  useEffect(() => {
    if (!token) return;
    const handler = () => fetchMembers();
    window.addEventListener('gymvault:data-changed', handler);
    return () => window.removeEventListener('gymvault:data-changed', handler);
  }, [token]);

  useEffect(() => {
    if (!focusAction || focusMemberId) return;
    if (focusAction === 'add') {
      openAddMemberModal();
      onFocusHandled?.();
    }
  }, [focusAction, focusMemberId, onFocusHandled, canWriteMembers]);

  useEffect(() => {
    if (!token || !focusMemberId) return;

    let isMounted = true;

    const openFocusedMember = async () => {
      const targetId = Number.parseInt(focusMemberId, 10);
      if (!Number.isInteger(targetId)) {
        onFocusHandled?.();
        return;
      }

      setSearchTerm('');
      setSelectedIds([]);
      setIsBulkMode(false);

      const memberFromList = members.find((member) => Number(member.id) === targetId);
      if (memberFromList) {
        setSelectedMember(memberFromList);
        setShowDetailsModal(true);
        if (focusAction === 'activate') {
          openActivateModalForMember(memberFromList);
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
          openActivateModalForMember(normalizedMember);
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
  }, [token, focusMemberId, focusAction, members, onFocusHandled, toast, canWritePayments]);

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
  // Re-run when loading flips false so membersListRef is attached after PageLoader unmounts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
    if (!canWritePayments) {
      toast?.('You do not have permission to manage memberships or payments.', 'warning');
      return;
    }
    if (!selectedPlanId) { toast?.('Please select a plan first.', 'warning'); return; }
    const selectedPlan = plans.find((p) => p.id === parseInt(selectedPlanId));

    if (type === 'cash') {
      showConfirm?.({
        title: 'Confirm Cash Payment',
        message: `Record a cash payment of ₹${selectedPlan.price} for ${selectedMember?.full_name}?`,
        confirmLabel: 'Confirm Cash',
        variant: 'warning',
        onConfirm: () => processActivation(selectedPlan, `CASH-${Date.now()}`, 'Cash'),
      });
      return;
    }

    try {
      setActivatingMode('online');
      if (activationOnlineMode === 'UPI') {
        if (!activationCollectionContext) {
          const collectionRes = await axios.post(
            '/api/memberships/online/create-order',
            { member_id: selectedMember.id, plan_id: selectedPlan.id },
            { headers: { 'x-auth-token': token } }
          );

          const collection = collectionRes.data?.collection;
          if (!collection?.upi_id) {
            setActivatingMode('');
            return toast?.('Direct UPI QR is not configured. Add a collection UPI ID in Integrations or use Razorpay collection.', 'error');
          }

          setActivationCollectionContext(collection);
          setActivationRazorpayContext(null);
          setActivationReference(collection.reference || '');
          setActivatingMode('');
          toast?.('Show this direct UPI QR to the member, then record the collection once payment is received.', 'success');
          return;
        }

        await processActivation(selectedPlan, activationReference || activationCollectionContext.reference, 'Online');
        setActivatingMode('');
        return;
      }

      if (activationRazorpayContext?.payment_link?.id) {
        await checkActivationRazorpayStatus(selectedPlan, { manual: true });
        setActivatingMode('');
        return;
      }

      const orderRes = await axios.post(
        '/api/memberships/online/create-order',
        { member_id: selectedMember.id, plan_id: selectedPlan.id },
        { headers: { 'x-auth-token': token } }
      );

      const razorpay = orderRes.data?.razorpay;
      const paymentLink = razorpay?.payment_link;
      if (!paymentLink?.id || !paymentLink?.short_url) {
        setActivatingMode('');
        return toast?.('Razorpay collection is not configured. Add Razorpay keys/connect in Integrations or use Direct UPI.', 'error');
      }

      setActivationCollectionContext(null);
      setActivationRazorpayContext(razorpay);
      setActivatingMode('');

      const delivery = describeCollectionLinkDelivery(paymentLink);
      toast?.(
        delivery.label === 'Manual share required'
          ? 'Razorpay QR is ready. Since no member phone or email is saved, share the link manually.'
          : `${delivery.label} and QR is ready on this screen.`,
        'success'
      );
    } catch (err) {
      setActivatingMode('');
      toast?.(err?.response?.data?.error || 'Unable to start online collection.', 'error');
    }
  };

  const processActivation = async (plan, paymentId, mode = 'Cash') => {
    try {
      setActivatingMode(mode === 'Online' ? 'verifying' : 'cash');
      await axios.post('/api/memberships/activate', { member_id: selectedMember.id, plan_id: plan.id, payment_id: paymentId, payment_mode: mode }, { headers: { 'x-auth-token': token } });
      await fetchMembers();
      notifyDashboardDataChanged();
      await finishActivationSuccess(plan, paymentId);
    } catch (err) {
      toast?.('Activation failed. Please try again.', 'error');
    } finally {
      setActivatingMode('');
    }
  };

  const confirmAndSendReminders = async ({ memberIds, templateKey, loadingSetter, loadingValue, summaryLabel = 'Reminder' }) => {
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      toast?.('Select at least one member first.', 'warning');
      return;
    }

    try {
      loadingSetter?.(loadingValue);
      const previewPayload = await previewWhatsAppReminders({ token, memberIds, templateKey });
      const previewDialog = buildReminderPreviewDialog(previewPayload, {
        singleTitle: 'Send Reminder',
        multiTitle: 'Send Reminders',
        singleConfirmLabel: 'Send Reminder',
        multiConfirmLabelPrefix: 'Send',
      });

      if (!previewDialog) {
        toast?.(getReminderPreviewBlockReason(previewPayload) || 'No reminders can be sent for the selected members.', 'warning');
        return;
      }

      const runSend = async () => {
        try {
          loadingSetter?.(loadingValue);
          const payload = await sendWhatsAppReminders({ token, memberIds, templateKey });
          const summary = summarizeReminderResult(payload, summaryLabel);
          toast?.(summary.message, summary.tone);
        } catch (err) {
          toast?.(getApiErrorMessage(err, 'Failed to queue WhatsApp reminder.'), 'error');
        } finally {
          loadingSetter?.('');
        }
      };

      if (showConfirm) {
        showConfirm({
          title: previewDialog.title,
          message: previewDialog.message,
          confirmLabel: previewDialog.confirmLabel,
          variant: 'warning',
          panelClassName: 'max-w-2xl',
          messageClassName: 'text-left text-slate-600',
          onConfirm: runSend,
        });
        return;
      }

      if (window.confirm(previewDialog.message)) {
        await runSend();
      }
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'Failed to prepare WhatsApp reminder preview.'), 'error');
    } finally {
      loadingSetter?.('');
    }
  };

  const sendWhatsAppReminder = async (member, type) => {
    if (!member?.id) {
      toast?.('Member details are incomplete for this reminder.', 'warning');
      return;
    }

    const templateKey = type === 'reminder'
      ? 'EXPIRING_SOON'
      : type === 'followup'
        ? 'INACTIVE'
        : type === 'expired'
          ? 'EXPIRED'
          : undefined;

    await confirmAndSendReminders({
      memberIds: [member.id],
      templateKey,
      loadingSetter: setReminderLoadingKey,
      loadingValue: `member-reminder-${member.id}`,
    });
  };

  const handleCall = (phoneNumber) => window.open(`tel:${phoneNumber}`, '_self');

  const handleBulkReminder = async () => {
    const selected = members.filter((m) => selectedIds.includes(m.id));
    if (selected.length === 0) {
      toast?.('Select at least one member first.', 'warning');
      return;
    }

    await confirmAndSendReminders({
      memberIds: selected.map((member) => member.id),
      loadingSetter: setBulkActionLoading,
      loadingValue: 'reminder',
    });
  };

  const handleBulkDelete = () => {
    if (!canWriteMembers) {
      toast?.('You do not have permission to delete members.', 'warning');
      return;
    }

    const selected = members.filter((member) => selectedIds.includes(member.id));
    if (selected.length === 0) {
      toast?.('Select at least one member first.', 'warning');
      return;
    }

    const runDelete = async () => {
      try {
        setBulkActionLoading('delete');
        const results = await Promise.allSettled(
          selected.map((member) => axios.delete(`/api/members/${member.id}`, { headers: { 'x-auth-token': token } }))
        );

        const failed = results.filter((result) => result.status === 'rejected');
        const deletedCount = results.length - failed.length;

        if (deletedCount > 0) {
          setSelectedIds([]);
          setIsBulkMode(false);
          await fetchMembers();
          notifyDashboardDataChanged();
        }

        if (failed.length === 0) {
          toast?.(deletedCount === 1 ? 'Member deleted.' : `${deletedCount} members deleted.`, 'success');
          return;
        }

        if (deletedCount > 0) {
          toast?.(`${deletedCount} members deleted, ${failed.length} failed.`, 'warning');
          return;
        }

        const failure = failed[0]?.reason;
        toast?.(getApiErrorMessage(failure, 'Failed to delete selected members.'), 'error');
      } catch (err) {
        toast?.(getApiErrorMessage(err, 'Failed to delete selected members.'), 'error');
      } finally {
        setBulkActionLoading('');
      }
    };

    if (showConfirm) {
      showConfirm({
        title: selected.length === 1 ? 'Delete Member' : 'Delete Selected Members',
        message: selected.length === 1
          ? 'This action cannot be undone.'
          : `This will permanently archive ${selected.length} selected members and their related records.`,
        confirmLabel: selected.length === 1 ? 'Yes, Delete' : `Delete ${selected.length} Members`,
        variant: 'danger',
        onConfirm: runDelete,
      });
      return;
    }

    if (window.confirm(`Delete ${selected.length} selected member${selected.length === 1 ? '' : 's'}?`)) {
      runDelete();
    }
  };

  const handleQuickExtend = async (days) => {
    if (!canWritePayments) {
      toast?.('You do not have permission to extend memberships.', 'warning');
      return;
    }
    try {
      await axios.post('/api/memberships/extend', { member_id: editFormData.id, days }, { headers: { 'x-auth-token': token } });
      await fetchMembers();
      notifyDashboardDataChanged();
      toast?.(`Extended by ${days} days!`, 'success');
    } catch (err) { toast?.('Extension failed.', 'error'); }
  };

  const handleFreezeMembership = async (event) => {
    event.preventDefault();
    if (!selectedMember?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }
    if (!canWritePayments) {
      toast?.('You do not have permission to pause memberships.', 'warning');
      return;
    }

    try {
      await axios.post('/api/memberships/freeze', {
        member_id: selectedMember.id,
        freeze_end_date: freezeFormData.freeze_end_date || null,
        freeze_reason: freezeFormData.freeze_reason.trim(),
      }, { headers: { 'x-auth-token': token } });
      setShowFreezeModal(false);
      setFreezeFormData({ freeze_end_date: '', freeze_reason: '' });
      await fetchMembers();
      notifyDashboardDataChanged();
      toast?.('Membership frozen successfully.', 'success');
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to freeze membership.', 'error');
    }
  };

  const handleUnfreezeMembership = (member = selectedMember) => {
    if (!member?.id) {
      toast?.('Select a member first.', 'warning');
      return;
    }
    if (!canWritePayments) {
      toast?.('You do not have permission to resume memberships.', 'warning');
      return;
    }

    showConfirm?.({
      title: 'Resume Membership',
      message: `Resume ${member.full_name}'s membership and extend it by the frozen days?`,
      confirmLabel: 'Resume Now',
      variant: 'warning',
      onConfirm: async () => {
        try {
          const res = await axios.post('/api/memberships/unfreeze', { member_id: member.id }, { headers: { 'x-auth-token': token } });
          await fetchMembers();
          notifyDashboardDataChanged();
          const extension = Number(res?.data?.extended_by_days || 0);
          toast?.(extension > 0 ? `Membership resumed and extended by ${extension} days.` : 'Membership resumed successfully.', 'success');
        } catch (err) {
          toast?.(err?.response?.data?.error || 'Unable to resume membership.', 'error');
        }
      },
    });
  };

  const getStatusInfo = (member) => {
    if (String(member?.membership_status || '').toUpperCase() === 'FROZEN') return { label: 'FROZEN', color: 'bg-cyan-400', text: 'text-cyan-500' };
    if (member.membership_status === 'UNPAID' || !member.plan_name) return { label: 'UNPAID', color: 'bg-slate-300', text: 'text-slate-400' };
    if (member.days_left <= 0) return { label: 'EXPIRED', color: 'bg-rose-500', text: 'text-rose-500' };
    // Expiring soon: 7-day window — highest priority, checked before inactivity
    if (member.days_left <= 7) return { label: 'EXPIRING SOON', color: 'bg-orange-500', text: 'text-orange-500' };
    // Fresh activations should not immediately look inactive just because no visit happened yet.
    const latestPaymentDate = getLatestPaymentDate(member);
    const activationReference = latestPaymentDate || member.joining_date;
    const today = new Date();
    const effectiveVisitSource = getEffectiveVisitSource(member);
    const lastVisit = effectiveVisitSource ? new Date(effectiveVisitSource) : null;
    const activationDate = activationReference ? new Date(activationReference) : null;
    const diffDays = lastVisit
      ? Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(lastVisit.getFullYear(), lastVisit.getMonth(), lastVisit.getDate())) / (1000 * 60 * 60 * 24))
      : 999;
    const activationAgeDays = activationDate
      ? Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(activationDate.getFullYear(), activationDate.getMonth(), activationDate.getDate())) / (1000 * 60 * 60 * 24))
      : 999;
    if (activationAgeDays <= 14) return { label: 'ACTIVE', color: 'bg-emerald-400', text: 'text-emerald-500' };
    if (diffDays > 14) return { label: 'INACTIVE', color: 'bg-amber-400', text: 'text-amber-500' };
    return { label: 'ACTIVE', color: 'bg-emerald-400', text: 'text-emerald-500' };
  };

  const canCheckMemberIn = (member) => {
    const label = getStatusInfo(member).label;
    return ['ACTIVE', 'INACTIVE', 'EXPIRING SOON'].includes(label);
  };

  const handleManualCheckIn = async (e, memberId) => {
    e.stopPropagation();
    if (!canWriteAttendance) {
      toast?.('You do not have permission to check members in.', 'warning');
      return;
    }
    try {
      await axios.put(`/api/members/${memberId}/check-in`, {}, { headers: { 'x-auth-token': token } });
      await fetchMembers();
      notifyDashboardDataChanged();
    } catch (err) { toast?.('Check-in failed', 'error'); }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!canWriteMembers) {
      toast?.('You do not have permission to add members.', 'warning');
      return;
    }
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
      setAddMemberSubmitting(true);
      const res = await axios.post('/api/members/add', formData, { headers: { 'x-auth-token': token } });
      setShowAddModal(false);
      setAddFormData({ full_name: '', email: '', phone: '' }); setAddFile(null); setPreviewUrl(null);
      await fetchMembers();
      notifyDashboardDataChanged();
      toast?.('Member added successfully!', 'success');
      if (canWritePayments && addSelectedPlanId && res.data) { setSelectedMember(normalizeMemberRecord(res.data)); setSelectedPlanId(addSelectedPlanId); setShowActivateModal(true); }
      setAddSelectedPlanId('');
    } catch (err) {
      const message = err?.response?.data?.error || err?.response?.data?.message || 'Error adding member.';
      toast?.(message, 'error');
    } finally {
      setAddMemberSubmitting(false);
    }
  };

  const handleEditClick = (member) => {
    if (!canWriteMembers) {
      toast?.('You do not have permission to edit members.', 'warning');
      return;
    }
    setEditFormData({ id: member.id, full_name: member.full_name, email: member.email, phone: member.phone });
    setShowEditModal(true);
  };
  const handleViewDetails = (member) => { setSelectedMember(member); setShowDetailsModal(true); };

  const handleUpdateMember = async (e) => {
    e.preventDefault();
    if (!canWriteMembers) {
      toast?.('You do not have permission to edit members.', 'warning');
      return;
    }
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
      setShowEditModal(false); setEditFile(null); await fetchMembers(); notifyDashboardDataChanged(); toast?.('Member updated successfully!', 'success');
    } catch (err) {
      const message = err?.response?.data?.error || err?.response?.data?.message || 'Update failed. Please try again.';
      toast?.(message, 'error');
    }
  };

  const handleDeleteMember = () => {
    if (!canWriteMembers) {
      toast?.('You do not have permission to delete members.', 'warning');
      return;
    }
    showConfirm?.({ title: 'Delete Member', message: 'This action cannot be undone.', confirmLabel: 'Yes, Delete', variant: 'danger', onConfirm: async () => {
        try { await axios.delete(`/api/members/${editFormData.id}`, { headers: { 'x-auth-token': token } }); setShowEditModal(false); await fetchMembers(); notifyDashboardDataChanged(); toast?.('Member deleted.', 'success'); } catch (err) { toast?.('Delete failed.', 'error'); }
      }
    });
  };

  const handleRemovePlan = () => {
    if (!canWritePayments) {
      toast?.('You do not have permission to change memberships.', 'warning');
      return;
    }
    showConfirm?.({ title: 'Cancel Active Plan', message: 'This will remove the active membership plan.', confirmLabel: 'Cancel Plan', variant: 'danger', onConfirm: async () => {
        try { await axios.post('/api/memberships/remove-plan', { member_id: editFormData.id }, { headers: { 'x-auth-token': token } }); setShowEditModal(false); await fetchMembers(); notifyDashboardDataChanged(); toast?.('Plan removed.', 'success'); } catch (err) { toast?.('Failed to remove plan.', 'error'); }
      }
    });
  };

  const toggleSelection = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const filteredMembers = useMemo(() => {
    const searchLower = deferredSearchTerm.trim().toLowerCase();
    return members.filter((member) => {
      const statusInfo = getStatusInfo(member);
      const matchesFilter = filter === 'All'
        ? true
        : (filter === 'Active' && (statusInfo.label === 'ACTIVE' || statusInfo.label === 'EXPIRING SOON'))
          || (filter === 'Frozen' && statusInfo.label === 'FROZEN')
          || (filter === 'Unpaid' && statusInfo.label === 'UNPAID')
          || (filter === 'Expired' && statusInfo.label === 'EXPIRED')
          || (filter === 'Expiring Soon' && statusInfo.label === 'EXPIRING SOON')
          || (filter === 'Inactive' && statusInfo.label === 'INACTIVE');

      if (!matchesFilter) return false;
      if (!searchLower) return true;

      return member.full_name?.toLowerCase().includes(searchLower)
        || member.email?.toLowerCase().includes(searchLower)
        || String(member.phone || '').includes(deferredSearchTerm);
    });
  }, [deferredSearchTerm, filter, members]);

  const counts = useMemo(() => ({
    All: members.length,
    Active: members.filter((member) => ['ACTIVE', 'EXPIRING SOON'].includes(getStatusInfo(member).label)).length,
    Frozen: members.filter((member) => getStatusInfo(member).label === 'FROZEN').length,
    Expired: members.filter((member) => getStatusInfo(member).label === 'EXPIRED').length,
    'Expiring Soon': members.filter((member) => getStatusInfo(member).label === 'EXPIRING SOON').length,
    Inactive: members.filter((member) => getStatusInfo(member).label === 'INACTIVE').length,
    Unpaid: members.filter((member) => getStatusInfo(member).label === 'UNPAID').length,
  }), [members]);

  if (loading && members.length === 0) return <PageLoader className="min-h-[56vh]" />;

  return (
    <div className="flex min-h-0 flex-col gap-3 sm:gap-5 p-1 sm:p-2 relative">
      {showSuccessAnim && (
        <SuccessModal
          memberName={selectedMember?.full_name}
          onClose={() => { setShowSuccessAnim(false); fetchMembers(); }}
          onDownload={downloadReceipt}
        />
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
        <div className="flex flex-col desktop:flex-row justify-between desktop:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">Members {isBulkMode && (<span className="text-xs bg-slate-900 text-white px-2.5 py-1 rounded-full font-black">{selectedIds.length} selected</span>)}</h1>
            <p className="text-slate-500 text-sm mt-0.5">Manage and track your gym members</p>
          </div>
          <div className="flex gap-2.5 w-full md:w-auto">
            <button onClick={() => { setIsBulkMode(!isBulkMode); setSelectedIds([]); }} className={`flex-1 desktop:flex-none px-4 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 border text-sm transition-all ${isBulkMode ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}><ListChecks size={16} /> {isBulkMode ? 'Exit' : 'Bulk Select'}</button>
            {canWriteMembers && <button onClick={openAddMemberModal} className="flex-1 desktop:flex-none text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 text-sm" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}><Plus size={16} /> Add Member</button>}
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
              {canWriteMembers && <button onClick={openAddMemberModal} className="text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,0.4)' }}><UserPlus size={20} /> Add First Member</button>}
            </div>
          ) : (
            <>
              <div className="desktop:hidden py-2">
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
                        const effectiveVisitSource = getEffectiveVisitSource(member);
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
                  <div className="gv-list-bottom-fade absolute bottom-0 inset-x-0 h-12 pointer-events-none rounded-b-2xl" style={{ background: 'linear-gradient(to top, rgba(248,250,252,0.96) 0%, transparent 100%)' }} />
                </div>
              </div>

              <div className="hidden desktop:block h-full overflow-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1160px]">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase font-bold tracking-widest border-b border-slate-100">
                  <th className="py-4 w-[40px] px-2">{isBulkMode && '✓'}</th>
                  <th className="py-4 w-[16%] pr-2 pl-0">Name</th>
                  <th className="py-4 w-[10%] px-2">Phone</th>
                  <th className="py-4 w-[13%] px-2">Email</th>
                  <th className="py-4 w-[9%] text-center px-2">Status</th>
                  <th className="py-4 w-[11%] text-center px-2">Plan</th>
                  <th className="py-4 w-[7%] text-center px-2">Days</th>
                  <th className="py-4 w-[10%] text-center px-2">Last Visit</th>
                  <th className="py-4 w-[18%] text-right px-3">Actions</th>
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
                    const effectiveVisitSource = getEffectiveVisitSource(member);
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
                        <td className="py-4 px-2 text-center">{statusInfo.label === 'UNPAID' ? <span className="text-slate-300 font-bold text-sm">—</span> : member.days_left <= 0 ? <span className="px-2 py-0.5 bg-rose-100 text-rose-600 text-[9px] font-black rounded-full uppercase">Exp'd</span> : member.days_left <= 7 ? <span className="px-2.5 py-1 bg-orange-100 text-orange-600 text-[10px] font-black rounded-full">{displayDays}d</span> : <span className="text-sm font-bold text-slate-700">{displayDays}</span>}</td>
                        <td className="py-4 px-2 text-center"><span className="text-xs font-semibold text-slate-600 whitespace-nowrap">{effectiveVisitSource ? new Date(effectiveVisitSource).toLocaleDateString('en-GB') : '—'}</span></td>
                        <td className="py-4 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="ml-auto flex max-w-[220px] flex-wrap justify-end items-center gap-1.5">
                            {canWritePayments && statusInfo.label === 'UNPAID' && <button onClick={() => openActivateModalWithFeedback(member, `member-${member.id}`)} className="inline-flex min-w-[82px] items-center justify-center gap-1 bg-purple-50 text-purple-600 px-2.5 py-1.5 rounded-lg border border-purple-100 text-[10px] font-black uppercase hover:bg-purple-600 hover:text-white transition-all shadow-sm">{memberActionLoading === `member-${member.id}` ? <RefreshCw size={10} className="animate-spin" /> : <Zap size={10} fill="currentColor" />} Initiate</button>}
                            {canWritePayments && (statusInfo.label === 'EXPIRED' || statusInfo.label === 'EXPIRING SOON') && <button onClick={() => openActivateModalWithFeedback(member, `member-${member.id}`)} className="inline-flex min-w-[76px] items-center justify-center gap-1 bg-rose-50 text-rose-600 px-2.5 py-1.5 rounded-lg border border-rose-100 text-[10px] font-black uppercase hover:bg-rose-600 hover:text-white transition-all shadow-sm">{memberActionLoading === `member-${member.id}` ? <RefreshCw size={10} className="animate-spin" /> : <RefreshCw size={10} />} Renew</button>}
                            {(statusInfo.label === 'INACTIVE' || statusInfo.label === 'EXPIRING SOON' || statusInfo.label === 'EXPIRED') && <button onClick={() => sendWhatsAppReminder(member, statusInfo.label === 'INACTIVE' ? 'followup' : statusInfo.label === 'EXPIRED' ? 'expired' : 'reminder')} disabled={reminderLoadingKey === `member-reminder-${member.id}`} className="inline-flex min-w-[84px] items-center justify-center gap-1 bg-emerald-50 text-emerald-600 px-2.5 py-1.5 rounded-lg border border-emerald-100 text-[10px] font-black uppercase hover:bg-emerald-600 hover:text-white transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed">{reminderLoadingKey === `member-reminder-${member.id}` ? <RefreshCw size={10} className="animate-spin" /> : <MessageSquare size={10} fill="currentColor" />} Remind</button>}
                            {canWriteAttendance && canCheckMemberIn(member) && <button onClick={(e) => handleManualCheckIn(e, member.id)} title="Manual Check-In" className="p-1.5 text-emerald-500 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-500 hover:text-white transition-all"><CheckCircle size={13} /></button>}
                            {canWriteMembers && <button onClick={(e) => { e.stopPropagation(); handleEditClick(member); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"><Edit2 size={13} /></button>}
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
            <button onClick={handleBulkReminder} disabled={bulkActionLoading !== ''} className="flex items-center gap-2 text-xs font-bold bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-xl border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">{bulkActionLoading === 'reminder' ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />} Send Reminders</button>
            <button onClick={handleBulkDelete} disabled={bulkActionLoading !== ''} className="flex items-center gap-2 text-xs font-bold bg-rose-500/10 text-rose-400 px-4 py-2 rounded-xl border border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">{bulkActionLoading === 'delete' ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete</button>
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
          <div className="flex-1 overflow-y-auto px-5 space-y-3 pt-2 pb-4" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            {/* drawer tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-0.5">
              {[{ key: 'profile', label: 'Profile' }, { key: 'notes', label: 'Notes' }, { key: 'docs', label: 'Documents' }, { key: 'waivers', label: 'Waivers' }].map(t => (
                <button key={t.key} onClick={() => setDrawerTab(t.key)} className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${drawerTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{t.label}</button>
              ))}
            </div>

            {drawerTab === 'profile' && (<>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                  <button onClick={() => sendWhatsAppReminder(selectedMember, 'auto')} disabled={reminderLoadingKey === `member-reminder-${selectedMember.id}`} className="p-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed">{reminderLoadingKey === `member-reminder-${selectedMember.id}` ? <RefreshCw size={10} className="animate-spin" /> : <MessageSquare size={10} fill="currentColor" />}</button>
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
              <div className="bg-blue-50/60 p-2 rounded-xl border border-blue-100 text-center min-w-0">
                <p className="text-[8px] sm:text-[9px] font-bold text-blue-500 uppercase tracking-tighter mb-0.5">Visits</p>
                <p className="text-sm sm:text-base font-black text-blue-900">{selectedMember.total_visits || 0}</p>
              </div>
              <div className="bg-orange-50/60 p-2 rounded-xl border border-orange-100 text-center min-w-0">
                <p className="text-[8px] sm:text-[9px] font-bold text-orange-500 uppercase tracking-tighter mb-0.5">Streak</p>
                <div className="flex items-center justify-center gap-0.5">
                  <Flame size={9} className="text-orange-500 shrink-0" fill="currentColor" />
                  <p className="text-sm sm:text-base font-black text-orange-900">{selectedMember.streak || 0}</p>
                </div>
              </div>
              <div className="bg-emerald-50/60 p-2 rounded-xl border border-emerald-100 text-center min-w-0">
                <p className="text-[8px] sm:text-[9px] font-bold text-emerald-500 uppercase tracking-tighter mb-0.5">Paid</p>
                <p className="text-[10px] sm:text-xs font-black text-emerald-900 truncate">₹{selectedMember.total_paid || 0}</p>
              </div>
              <div className="bg-purple-50/60 p-2 rounded-xl border border-purple-100 text-center min-w-0">
                <p className="text-[8px] sm:text-[9px] font-bold text-purple-500 uppercase tracking-tighter mb-0.5">Plan</p>
                <p className="text-[9px] sm:text-[10px] font-black text-purple-900 uppercase truncate">{selectedMember.plan_name || '—'}</p>
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
                <p className="font-bold text-sm text-slate-700">{getEffectiveVisitSource(selectedMember) ? new Date(getEffectiveVisitSource(selectedMember)).toLocaleDateString('en-GB') : 'Never'}</p>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${String(selectedMember.membership_status || '').toUpperCase() === 'FROZEN' ? 'bg-cyan-50 border-cyan-100' : 'bg-slate-50 border-slate-100'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Snowflake size={11} /><span className="text-[9px] font-bold uppercase tracking-tight">Membership Hold</span></div>
                  {String(selectedMember.membership_status || '').toUpperCase() === 'FROZEN' ? (
                    <>
                      <p className="font-black text-sm text-cyan-700">Frozen from {selectedMember.freeze_start_date ? new Date(selectedMember.freeze_start_date).toLocaleDateString('en-GB') : 'today'}</p>
                      <p className="text-xs font-semibold text-cyan-700/80 mt-1">{selectedMember.freeze_end_date ? `Planned resume: ${new Date(selectedMember.freeze_end_date).toLocaleDateString('en-GB')}` : 'No planned resume date yet'}</p>
                      {selectedMember.freeze_reason && <p className="text-xs font-semibold text-cyan-800 mt-2 line-clamp-2">Reason: {selectedMember.freeze_reason}</p>}
                    </>
                  ) : String(selectedMember.membership_status || '').toUpperCase() === 'ACTIVE' ? (
                    <>
                      <p className="font-black text-sm text-slate-800">Pause this membership without removing the plan.</p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">Useful for travel, injury, or temporary breaks while preserving paid days.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-black text-sm text-slate-800">Hold controls unlock on active memberships.</p>
                      <p className="text-xs font-semibold text-slate-500 mt-1">Unpaid or expired members should be reactivated instead of paused.</p>
                    </>
                  )}
                </div>
                {canWritePayments && String(selectedMember.membership_status || '').toUpperCase() === 'FROZEN' && (
                  <button onClick={() => handleUnfreezeMembership(selectedMember)} className="px-3 py-2 rounded-xl bg-cyan-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-cyan-700 transition-all shrink-0">
                    Resume
                  </button>
                )}
                {canWritePayments && String(selectedMember.membership_status || '').toUpperCase() === 'ACTIVE' && (
                  <button onClick={() => openFreezeModalForMember(selectedMember)} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-wide hover:bg-slate-800 transition-all shrink-0">
                    Freeze
                  </button>
                )}
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
            </>)}

            {/* ── Notes Tab ── */}
            {drawerTab === 'notes' && (
              <div className="space-y-3">
                {renderOnboardingCard()}
                {canWriteMembers && (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note..." className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" onKeyDown={e => e.key === 'Enter' && handleAddNote()} />
                    <button onClick={handleAddNote} className="px-3 py-2 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 sm:w-auto">Add</button>
                  </div>
                )}
                {memberNotes.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No notes yet</p>
                ) : memberNotes.map(n => (
                  <div key={n.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-700 flex-1">{n.note}</p>
                      {canWriteMembers && <button onClick={() => handleDeleteNote(n.id)} className="text-[10px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-700">Delete</button>}
                    </div>
                    <div className="flex justify-between mt-2">
                      <p className="text-[10px] text-slate-400">{n.author_name || 'Staff'}</p>
                      <p className="text-[10px] text-slate-400">{n.created_at ? new Date(n.created_at).toLocaleDateString('en-GB') : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Documents Tab ── */}
            {drawerTab === 'docs' && (
              <div className="space-y-3">
                {canWriteMembers && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Upload Document</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={docForm.doc_type} onChange={(event) => setDocForm((prev) => ({ ...prev, doc_type: event.target.value }))} className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700" placeholder="ID Proof" />
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-500 min-h-[42px] flex items-center min-w-0">
                        <span className="truncate">{docForm.doc_name || 'No file selected'}</span>
                      </div>
                    </div>
                    <input ref={docCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleSelectDocumentFile} />
                    <input ref={docGalleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleSelectDocumentFile} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button type="button" onClick={() => docCameraInputRef.current?.click()} className="w-full py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-black hover:bg-indigo-100 transition-all">
                        Open Camera
                      </button>
                      <button type="button" onClick={() => docGalleryInputRef.current?.click()} className="w-full py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-50 transition-all">
                        Choose From Gallery
                      </button>
                    </div>
                    {docForm.doc_name ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                        <p className="text-xs font-bold text-emerald-700 truncate">Ready: {docForm.doc_name}</p>
                        <button type="button" onClick={clearSelectedDocument} className="text-[10px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-700 shrink-0">Clear</button>
                      </div>
                    ) : null}
                    <textarea value={docForm.notes} onChange={(event) => setDocForm((prev) => ({ ...prev, notes: event.target.value }))} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 resize-none" placeholder="Optional note" />
                    <button onClick={handleAddDocument} disabled={docSaving} className="w-full py-2.5 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-60">
                      {docSaving ? 'Saving...' : 'Attach Document'}
                    </button>
                  </div>
                )}
                {memberDocs.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No documents uploaded</p>
                ) : memberDocs.map(d => (
                  <div key={d.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-700">{d.doc_type}</p>
                      {d.doc_name && <p className="text-xs text-slate-500 mt-0.5 truncate">{d.doc_name}</p>}
                      {d.notes && <p className="text-xs text-slate-400 mt-0.5">{d.notes}</p>}
                      <p className="text-[10px] text-slate-400 mt-1">{d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString('en-GB') : ''}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-between sm:justify-start">
                      {d.doc_url && <a href={d.doc_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 text-xs font-bold hover:underline">View</a>}
                      {canWriteMembers && <button onClick={() => handleDeleteDocument(d.id)} className="text-rose-500 text-xs font-black hover:text-rose-700 uppercase tracking-wider">Delete</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Waivers Tab ── */}
            {drawerTab === 'waivers' && (
              <div className="space-y-3">
                {canWriteMembers && !memberWaivers.length && (
                  <button onClick={handleSignWaiver} className="w-full py-3 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 transition-all">
                    Sign Standard Waiver
                  </button>
                )}
                {memberWaivers.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No waivers signed yet</p>
                ) : memberWaivers.map(w => (
                  <div key={w.id} className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <div className="flex items-center gap-1.5 mb-1">
                      <CheckCircle size={12} className="text-emerald-600" />
                      <p className="text-sm font-bold text-emerald-700">{w.waiver_type || 'General'} Waiver</p>
                    </div>
                    <p className="text-xs text-emerald-600">Signed: {w.signed_at ? new Date(w.signed_at).toLocaleDateString('en-GB') : 'N/A'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* action bar */}
          <div className="px-5 py-3 border-t border-slate-100 shrink-0 bg-white">
            <div className="flex gap-2">
            {canWritePayments && (getStatusInfo(selectedMember).label === 'EXPIRED' || getStatusInfo(selectedMember).label === 'UNPAID' || getStatusInfo(selectedMember).label === 'EXPIRING SOON') && (
              <button onClick={() => { setShowDetailsModal(false); openActivateModalWithFeedback(selectedMember, 'details-activate'); }} className="min-w-0 flex-1 px-2 py-2.5 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap transition-all hover:opacity-90 active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                {memberActionLoading === 'details-activate' ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} fill="currentColor" />}{getStatusInfo(selectedMember).label === 'EXPIRED' || getStatusInfo(selectedMember).label === 'EXPIRING SOON' ? 'Renew' : 'Activate'}
              </button>
            )}
            <button onClick={() => sendWhatsAppReminder(selectedMember, 'auto')} disabled={reminderLoadingKey === `member-reminder-${selectedMember.id}`} className="min-w-0 flex-1 px-2 py-2.5 bg-emerald-500 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">
              {reminderLoadingKey === `member-reminder-${selectedMember.id}` ? <RefreshCw size={13} className="animate-spin" /> : <MessageSquare size={13} fill="currentColor" />} Remind
            </button>
            {canWriteMembers && <button onClick={() => { setShowDetailsModal(false); handleEditClick(selectedMember); }} className="min-w-0 flex-1 px-2 py-2.5 bg-slate-800 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-slate-700 transition-all active:scale-95">
              <Edit2 size={13} /> Edit
            </button>}
            {canWriteMembers && ['ACTIVE', 'FROZEN'].includes(String(selectedMember.membership_status || '').toUpperCase()) && (
              <button onClick={() => setShowCancelModal(true)} className="min-w-0 flex-1 px-2 py-2.5 bg-rose-600 text-white text-xs font-black rounded-xl whitespace-nowrap hover:bg-rose-700 transition-all active:scale-95">
                Cancel
              </button>
            )}
            </div>
          </div>
        </>)}
      </div>

      {showEditModal && (
        <div className="app-modal-shell z-[60] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 100%)' }}>
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center"><Edit2 size={18} /></div><div><h2 className="text-lg font-black">Edit Member</h2><p className="text-white/50 text-[10px] font-bold uppercase tracking-wider">Update Profile</p></div></div>
              <button onClick={() => setShowEditModal(false)} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateMember} className="app-modal-scroll p-6 space-y-5">
              <div className="flex justify-center -mt-1"><div className="relative group"><div className="w-20 h-20 rounded-full overflow-hidden shadow-xl border-4 border-white">{editFile ? <img src={URL.createObjectURL(editFile)} alt="Preview" className="w-full h-full object-cover" /> : <GradientAvatar name={members.find((m) => m.id === editFormData.id)?.full_name || editFormData.full_name} src={members.find((m) => m.id === editFormData.id)?.profile_pic} sizePx={80} />}</div><label className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-all rounded-full cursor-pointer">Change<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const ok = await handleProfileImageSelect(e.target.files?.[0], 'edit'); if (!ok) e.target.value = ''; }} /></label></div></div>
              <div className="space-y-4">
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name</label><input type="text" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.full_name} onChange={(e) => setEditFormData({ ...editFormData, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone</label><input type="text" required inputMode="numeric" maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.phone} onChange={(e) => setEditFormData({ ...editFormData, phone: normalizePhoneInput(e.target.value) })} /></div>
                  <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email</label><input type="email" required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-900 font-semibold text-sm transition-all" value={editFormData.email} onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })} /></div>
                </div>
              </div>
              {canWritePayments && <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-2xl border border-indigo-100"><label className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mb-3"><Clock size={12} /> Quick Extend Membership</label><div className="grid grid-cols-3 gap-2">{[2, 5, 15].map((days) => (<button key={days} type="button" onClick={() => handleQuickExtend(days)} className="py-2.5 bg-white border border-indigo-200 text-indigo-700 text-xs font-black rounded-xl hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all shadow-sm active:scale-95">+{days} Days</button>))}</div></div>}
              <button type="submit" className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>Save Changes</button>
              {(canWritePayments || canWriteMembers) && <div className="border-t border-dashed border-rose-100 pt-4"><p className="text-[9px] font-black text-rose-300 uppercase tracking-widest mb-3 text-center">Danger Zone</p><div className="flex gap-2">{canWritePayments && <button type="button" onClick={handleRemovePlan} className="flex-1 py-2.5 text-[10px] font-bold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-all"><Ban size={11} /> Remove Plan</button>}{canWriteMembers && <button type="button" onClick={handleDeleteMember} className="flex-1 py-2.5 text-[10px] font-bold text-rose-500 border border-rose-200 bg-rose-50 rounded-xl hover:bg-rose-500 hover:text-white flex items-center justify-center gap-1.5 transition-all"><Trash2 size={11} /> Delete Member</button>}</div></div>}
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="app-modal-shell z-50 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}>
              <div className="flex items-center gap-3"><div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><UserPlus size={18} /></div><div><h2 className="text-lg font-black">New Member</h2><p className="text-white/60 text-[10px] font-bold uppercase tracking-wider">Add to GymVault</p></div></div>
              <button onClick={() => { setShowAddModal(false); setAddSelectedPlanId(''); }} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddMember} className="app-modal-scroll p-6 space-y-4">
              <div className="flex flex-col items-center"><label className="cursor-pointer block"><div className="w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">{previewUrl ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-1 text-slate-300"><UserPlus size={28} /><span className="text-[9px] font-bold uppercase tracking-wider">Upload</span></div>}</div><input type="file" accept="image/*" className="hidden" onChange={async (e) => { const ok = await handleProfileImageSelect(e.target.files?.[0], 'add'); if (!ok) e.target.value = ''; }} /></label><p className="text-[10px] text-slate-400 font-medium mt-2">Click to upload photo (optional)</p></div>
              <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name *</label><input type="text" required placeholder="e.g. Rahul Sharma" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.full_name} onChange={(e) => setAddFormData({ ...addFormData, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone *</label><input type="text" required inputMode="numeric" maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits" placeholder="9876543210" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.phone} onChange={(e) => setAddFormData({ ...addFormData, phone: normalizePhoneInput(e.target.value) })} /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email *</label><input type="email" required placeholder="rahul@email.com" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all" value={addFormData.email} onChange={(e) => setAddFormData({ ...addFormData, email: e.target.value })} /></div>
              </div>
              {canWritePayments && <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5"><Zap size={10} className="text-emerald-500" /> Assign Plan Now (optional)</label>
                <select className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 text-sm font-semibold text-slate-700 appearance-none cursor-pointer transition-all" value={addSelectedPlanId} onChange={(e) => setAddSelectedPlanId(e.target.value)}><option value="">Skip — assign plan later</option>{plans.map((p) => (<option key={p.id} value={p.id}>{p.name} — ₹{p.price} / {p.duration_days}d</option>))}</select>
                {addSelectedPlanId && <p className="text-[10px] text-emerald-600 font-bold mt-1.5 ml-0.5">Payment will be collected in the next step →</p>}
              </div>}
              <button type="submit" disabled={addMemberSubmitting} className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg disabled:opacity-70" style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(5,150,105,0.35)' }}>{addMemberSubmitting ? <span className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Saving...</span> : (canWritePayments && addSelectedPlanId ? 'Add Member & Assign Plan →' : 'Add Member')}</button>
            </form>
          </div>
        </div>
      )}

      {showActivateModal && (
        <div className="app-modal-shell z-[110] bg-slate-900/70 backdrop-blur-sm">
          <div className="app-modal-panel rounded-[32px] w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200"
            style={{ background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)' }}>
            <div className="p-8 text-center shrink-0">
              <div className="w-16 h-16 bg-purple-500/20 text-purple-400 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-purple-500/30"><Zap size={32} fill="currentColor" /></div>
              <h2 className="text-2xl font-black text-white tracking-tight">Activate Plan</h2>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">For {selectedMember?.full_name}</p>
            </div>
            <div className="app-modal-scroll px-8 pb-8 space-y-4">
              <div className="relative">
                <select required className="w-full px-5 py-4 rounded-2xl focus:outline-none text-sm font-black appearance-none cursor-pointer border border-white/10" style={{ background: 'rgba(255,255,255,0.07)', color: '#e2e8f0' }} value={selectedPlanId} onChange={(e) => { setSelectedPlanId(e.target.value); setActivationCollectionContext(null); setActivationRazorpayContext(null); setActivationReference(''); }}>
                  <option value="" style={{ background: '#1e1b4b' }}>Select Membership Plan...</option>
                  {plans.map((p) => (<option key={p.id} value={p.id} style={{ background: '#1e1b4b' }}>{p.name} — ₹{p.price}</option>))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><Calendar size={18} /></div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Online Collection Channel</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'RAZORPAY', label: 'Razorpay Link', detail: 'Auto-send link and show hosted checkout QR' },
                    { key: 'UPI', label: 'Direct UPI', detail: 'Show QR and record receipt' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setActivationOnlineMode(option.key);
                        setActivationCollectionContext(null);
                        setActivationRazorpayContext(null);
                        setActivationReference('');
                      }}
                      className={`rounded-2xl border px-3 py-3 text-left transition-all ${activationOnlineMode === option.key ? 'border-violet-300 bg-violet-500/10 shadow-sm' : 'border-white/10 bg-white/6 hover:border-white/20'}`}
                    >
                      <p className={`text-xs font-black uppercase tracking-wider ${activationOnlineMode === option.key ? 'text-violet-100' : 'text-slate-200'}`}>{option.label}</p>
                      <p className="text-[11px] font-semibold text-slate-400 mt-1">{option.detail}</p>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-2">{activationOnlineMode === 'RAZORPAY' ? 'Razorpay sends the member a payment link and also shows the same hosted checkout QR on this screen.' : 'Direct UPI shows your gym QR and lets you record the receipt after payment.'}</p>
              </div>
              {activationOnlineMode === 'RAZORPAY' && activationRazorpayContext?.payment_link && (
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-4 space-y-4">
                  <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                    <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-xl shadow-slate-950/20">
                      <QRCodeCanvas
                        value={activationRazorpayContext.payment_link.short_url || 'https://razorpay.com'}
                        size={156}
                        includeMargin
                        bgColor="#ffffff"
                        fgColor="#111827"
                        level="M"
                      />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-200/70">Razorpay Payment Link</p>
                        <p className="text-xl font-black text-white mt-1">₹{formatCollectionAmount(activationRazorpayContext.payment_link.amount)}</p>
                        <p className="text-sm font-semibold text-slate-300 mt-1">
                          {describeCollectionLinkDelivery(activationRazorpayContext.payment_link).message}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Link Status</p>
                          <p className="text-sm font-black text-white uppercase">{String(activationRazorpayContext.payment_link.status || 'created')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Delivery</p>
                          <p className="text-sm font-bold text-slate-200">
                            {describeCollectionLinkDelivery(activationRazorpayContext.payment_link).label}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => openCollectionLink(activationRazorpayContext.payment_link.short_url)} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border border-white/15 bg-white/10 text-slate-100 hover:bg-white/15 transition-colors">Open Link</button>
                    <button type="button" onClick={() => { const selectedPlan = plans.find((plan) => plan.id === parseInt(selectedPlanId, 10)); if (selectedPlan) { checkActivationRazorpayStatus(selectedPlan, { manual: true }); } }} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border border-white/15 bg-white/10 text-slate-100 hover:bg-white/15 transition-colors">Check Status</button>
                  </div>
                  <p className="text-[11px] font-semibold text-violet-100/75">The member can pay from their own phone using the Razorpay link, or scan this QR from your phone. We also keep checking automatically while this modal stays open.</p>
                </div>
              )}
              {activationOnlineMode === 'UPI' && activationCollectionContext && (
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-4 space-y-4">
                  <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                    <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-xl shadow-slate-950/20">
                      <QRCodeCanvas
                        value={buildUpiCollectionUri({
                          upiId: activationCollectionContext.upi_id,
                          payeeName: activationCollectionContext.payee_name,
                          amount: activationCollectionContext.amount,
                          note: activationCollectionContext.note,
                          reference: activationCollectionContext.reference,
                        }) || 'upi://pay'}
                        size={156}
                        includeMargin
                        bgColor="#ffffff"
                        fgColor="#111827"
                        level="M"
                      />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-200/70">Owner Collection QR</p>
                        <p className="text-xl font-black text-white mt-1">₹{formatCollectionAmount(activationCollectionContext.amount)}</p>
                        <p className="text-sm font-semibold text-slate-300 mt-1">Ask {selectedMember?.full_name} to scan and pay before you activate the plan.</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">UPI ID</p>
                          <p className="text-sm font-black text-white break-all">{activationCollectionContext.upi_id}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Collect Into</p>
                          <p className="text-sm font-bold text-slate-200">{activationCollectionContext.payee_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reference</p>
                          <p className="text-sm font-bold text-slate-200 break-all">{activationCollectionContext.reference}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => handleCopyActivationDetail(activationCollectionContext.upi_id, 'UPI ID copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border border-violet-300/30 bg-white/10 text-violet-100 hover:bg-white/15 transition-colors">Copy UPI ID</button>
                    <button type="button" onClick={() => handleCopyActivationDetail(activationCollectionContext.reference, 'Collection reference copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider border border-white/15 bg-white/10 text-slate-100 hover:bg-white/15 transition-colors">Copy Reference</button>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">UPI UTR / Collection Reference</label>
                    <input type="text" className="w-full px-4 py-3 rounded-2xl border border-white/10 bg-white/8 text-sm font-bold text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400/30" placeholder="Paste the UPI UTR or keep the generated reference" value={activationReference} onChange={(e) => setActivationReference(e.target.value)} />
                  </div>
                </div>
              )}
              <div className="pt-2 space-y-3">
                <button onClick={() => handleActivateSubscription(null, 'online')} disabled={Boolean(activatingMode)} className="w-full py-4 text-white rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] disabled:opacity-70" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 6px 20px rgba(99,102,241,0.4)' }}>{activatingMode === 'online' || activatingMode === 'verifying' ? <RefreshCw size={18} className="animate-spin" /> : <CreditCard size={18} />}{activatingMode === 'verifying' ? 'Recording Collection...' : activatingMode === 'online' ? (activationOnlineMode === 'RAZORPAY' ? (activationRazorpayContext ? 'Checking Razorpay Payment...' : 'Sending Razorpay Link...') : 'Preparing Collection QR...') : activationOnlineMode === 'RAZORPAY' ? (activationRazorpayContext ? 'Check Razorpay Payment' : 'Send Razorpay Link & Show QR') : activationCollectionContext ? 'Record Direct UPI Collection' : 'Show Direct UPI QR'}</button>
                <button onClick={() => handleActivateSubscription(null, 'cash')} disabled={Boolean(activatingMode)} className="w-full py-4 rounded-2xl font-black text-sm hover:opacity-80 transition-all flex items-center justify-center gap-2 border border-white/10 disabled:opacity-70" style={{ background: 'rgba(255,255,255,0.06)', color: '#6ee7b7' }}>{activatingMode === 'cash' ? <RefreshCw size={18} className="animate-spin" /> : <span className="font-black text-lg">₹</span>}{activatingMode === 'cash' ? 'Recording Cash Payment...' : 'Paid as Cash'}</button>
              </div>
              <button onClick={closeActivateModal} className="w-full text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-slate-300 transition-colors pt-1">Cancel Transaction</button>
            </div>
          </div>
        </div>
      )}

      {showFreezeModal && (
        <div className="app-modal-shell z-[120] bg-slate-900/70 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #155e75 100%)' }}>
              <div>
                <h2 className="text-lg font-black">Freeze Membership</h2>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mt-1">Pause access without cancelling the plan</p>
              </div>
              <button onClick={() => setShowFreezeModal(false)} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <form onSubmit={handleFreezeMembership} className="app-modal-scroll p-6 space-y-5">
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-600 mb-1">Member</p>
                <p className="text-base font-black text-slate-900">{selectedMember?.full_name}</p>
                <p className="text-xs font-semibold text-slate-500 mt-1">The plan stays attached and days resume when you unfreeze.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Planned Resume Date</label>
                <input type="date" value={freezeFormData.freeze_end_date} onChange={(event) => setFreezeFormData((prev) => ({ ...prev, freeze_end_date: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 font-semibold text-slate-900 text-sm transition-all" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Reason</label>
                <textarea value={freezeFormData.freeze_reason} onChange={(event) => setFreezeFormData((prev) => ({ ...prev, freeze_reason: event.target.value }))} rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 font-semibold text-slate-900 text-sm transition-all resize-none" placeholder="Travel, injury, medical break, family emergency..." />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" className="flex-1 py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #0891b2, #155e75)', boxShadow: '0 4px 16px rgba(8,145,178,0.3)' }}>
                  Freeze Membership
                </button>
                <button type="button" onClick={() => setShowFreezeModal(false)} className="sm:w-auto py-3 px-5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </form>
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

      {/* ── Cancel Member Modal ── */}
      {showCancelModal && selectedMember && (
        <div className="app-modal-shell z-[70] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-sm shadow-2xl overflow-hidden border border-slate-100">
            <div className="p-6 text-white" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)' }}>
              <h2 className="text-lg font-black">Cancel Membership</h2>
              <p className="text-white/60 text-xs mt-1">{selectedMember.full_name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Reason for Cancellation</label>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none" placeholder="Relocating, unhappy with service, etc." />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowCancelModal(false); setCancelReason(''); }} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-xs font-black rounded-xl hover:bg-slate-200 transition-all">Back</button>
                <button onClick={handleCancelMember} className="flex-1 py-2.5 bg-rose-600 text-white text-xs font-black rounded-xl hover:bg-rose-700 transition-all">Confirm Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default MembersPage;