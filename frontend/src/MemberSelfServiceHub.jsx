import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  User,
  XCircle,
} from 'lucide-react';
import PageLoader from './PageLoader';
import {
  buildUpiCollectionUri,
  copyCollectionText,
  describeCollectionLinkDelivery,
  formatCollectionAmount,
  openCollectionLink,
} from './utils/memberCollection';
import { normalizeProfileImageUrl } from './utils/profileImage';
import { INLINE_IMAGE_ACCEPT, fileToInlineImageDataUrl } from './utils/inlineImageUpload';

const TABS = [
  { key: 'overview', label: 'Overview', Icon: Sparkles },
  { key: 'payments', label: 'Payments', Icon: CreditCard },
  { key: 'classes', label: 'Classes', Icon: CalendarDays },
  { key: 'profile', label: 'Profile', Icon: User },
];

const TERMINAL_RAZORPAY_LINK_STATUSES = new Set(['PAID', 'EXPIRED', 'CANCELLED', 'FAILED', 'NOT_FOUND']);
const MEMBER_DOCUMENT_TYPES = [
  'Aadhaar Card',
  'PAN Card',
  'Photo ID',
  'Address Proof',
  'Medical Certificate',
  'Other',
];

const getRazorpayLinkStatus = (paymentLink) => String(paymentLink?.status || '').trim().toUpperCase();

const canReuseRazorpayLink = (paymentLink) => Boolean(paymentLink?.id) && !TERMINAL_RAZORPAY_LINK_STATUSES.has(getRazorpayLinkStatus(paymentLink));

const mergeMemberPaymentLinkContext = (currentContext, nextPayload) => {
  const nextPaymentLink = nextPayload?.payment_link;
  if (!nextPaymentLink) return currentContext;

  return {
    ...(currentContext || {}),
    razorpay: {
      ...(currentContext?.razorpay || {}),
      payment_link: {
        ...(currentContext?.razorpay?.payment_link || {}),
        ...nextPaymentLink,
      },
    },
  };
};

const formatDate = (value) => {
  if (!value) return '—';
  const rawValue = typeof value === 'string' && !value.includes('T') ? `${value}T00:00:00` : value;
  const date = new Date(rawValue);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
};

const buildMemberSnapshot = (member, dashboard) => {
  const nextMember = dashboard?.member || {};
  const membership = dashboard?.membership || null;

  return {
    ...member,
    ...nextMember,
    profile_pic: normalizeProfileImageUrl(nextMember.profile_pic || member?.profile_pic || ''),
    plan_name: membership?.plan_name || member?.plan_name || '',
    membership_start: membership?.start_date || member?.membership_start || null,
    membership_end: membership?.end_date || member?.membership_end || null,
    membership_status: membership?.status || member?.membership_status || '',
    status: nextMember?.status || member?.status || 'UNPAID',
    gym_id: nextMember?.gym_id || member?.gym_id || null,
    phone: nextMember?.phone || member?.phone || '',
    email: nextMember?.email || member?.email || '',
    onboarding_complete: Boolean(nextMember?.onboarding_complete ?? member?.onboarding_complete),
    emergency_contact: nextMember?.emergency_contact || member?.emergency_contact || '',
    gender: nextMember?.gender || member?.gender || '',
    date_of_birth: nextMember?.date_of_birth || member?.date_of_birth || '',
    address: nextMember?.address || member?.address || '',
    blood_group: nextMember?.blood_group || member?.blood_group || '',
    medical_notes: nextMember?.medical_notes || member?.medical_notes || '',
  };
};

const hasMemberSnapshotChanged = (currentMember, nextMember) => (
  [
    'full_name',
    'email',
    'phone',
    'profile_pic',
    'gym_name',
    'gym_id',
    'plan_name',
    'membership_start',
    'membership_end',
    'membership_status',
    'status',
    'onboarding_complete',
    'emergency_contact',
    'gender',
    'date_of_birth',
    'address',
    'blood_group',
    'medical_notes',
  ].some((field) => String(currentMember?.[field] || '') !== String(nextMember?.[field] || ''))
);

const createEmptyProfileForm = (member) => ({
  full_name: String(member?.full_name || ''),
  email: String(member?.email || ''),
  phone: String(member?.phone || ''),
});

const createEmptyOnboardingForm = (member) => ({
  onboarding_complete: Boolean(member?.onboarding_complete),
  emergency_contact: String(member?.emergency_contact || ''),
  gender: String(member?.gender || ''),
  date_of_birth: member?.date_of_birth ? String(member.date_of_birth).slice(0, 10) : '',
  address: String(member?.address || ''),
  blood_group: String(member?.blood_group || ''),
  medical_notes: String(member?.medical_notes || ''),
});

const createEmptyDocumentForm = () => ({
  doc_type: '',
  doc_name: '',
  notes: '',
});

const escapeInvoiceHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatInvoiceMoney = (value) => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const openMemberInvoiceWindow = ({ entry, receiptInfo, memberSummary }) => {
  const invoiceWindow = window.open('', '_blank');
  if (!invoiceWindow) return false;

  const gymName = String(receiptInfo?.name || memberSummary?.gym_name || 'GymVault').trim() || 'GymVault';
  const invoiceNumber = String(entry?.invoice_id || entry?.transaction_id || `INV-${Date.now()}`).trim();
  const paymentDate = entry?.payment_date ? new Date(entry.payment_date) : new Date();
  const formattedDate = Number.isNaN(paymentDate.getTime())
    ? formatDateTime(new Date().toISOString())
    : paymentDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const logoMarkup = receiptInfo?.gym_logo
    ? `<img src="${receiptInfo.gym_logo}" alt="Gym logo" style="width:76px;height:76px;object-fit:contain;border-radius:18px;" />`
    : `<div style="width:76px;height:76px;border-radius:18px;background:linear-gradient(135deg,#111827,#312e81);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:900;">${escapeInvoiceHtml(gymName.slice(0, 1).toUpperCase())}</div>`;
  const signatureMarkup = receiptInfo?.owner_signature
    ? `<img src="${receiptInfo.owner_signature}" alt="Owner signature" style="height:48px;object-fit:contain;max-width:190px;" />`
    : `<div style="font-family:'Brush Script MT','Segoe Script',cursive;font-size:34px;color:#111827;line-height:1;">${escapeInvoiceHtml(receiptInfo?.owner_name || gymName)}</div>`;

  invoiceWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${escapeInvoiceHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #eef2ff; color: #0f172a; }
    .page { max-width: 840px; margin: 28px auto; background: #ffffff; border-radius: 28px; overflow: hidden; box-shadow: 0 28px 70px rgba(15, 23, 42, 0.18); }
    .toolbar { padding: 16px 22px; display: flex; justify-content: flex-end; background: #111827; }
    .toolbar button { border: none; background: #ffffff; color: #111827; padding: 11px 18px; border-radius: 999px; font-weight: 800; cursor: pointer; }
    .hero { padding: 30px 32px 24px; background: linear-gradient(135deg, #0f172a 0%, #312e81 100%); color: #ffffff; display: flex; gap: 18px; align-items: center; }
    .hero-copy { flex: 1; }
    .eyebrow { font-size: 11px; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; color: #c7d2fe; }
    .hero h1 { margin: 10px 0 0; font-size: 32px; line-height: 1.05; }
    .hero p { margin: 8px 0 0; color: #cbd5e1; font-size: 14px; }
    .content { padding: 28px 32px 34px; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
    .meta-card { border: 1px solid #e2e8f0; border-radius: 22px; padding: 14px 16px; background: #f8fafc; }
    .meta-label { font-size: 11px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; color: #64748b; }
    .meta-value { margin-top: 8px; font-size: 18px; font-weight: 900; color: #0f172a; }
    .meta-sub { margin-top: 4px; font-size: 12px; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; overflow: hidden; border-radius: 24px; }
    thead th { background: #e0e7ff; color: #312e81; text-transform: uppercase; letter-spacing: 0.18em; font-size: 10px; padding: 14px 16px; text-align: left; }
    tbody td { border-bottom: 1px solid #e2e8f0; padding: 15px 16px; font-size: 14px; font-weight: 600; color: #0f172a; }
    tbody tr:last-child td { border-bottom: none; }
    .summary { margin-top: 24px; display: flex; justify-content: space-between; gap: 18px; align-items: flex-end; }
    .summary-note { max-width: 54%; font-size: 13px; line-height: 1.6; color: #475569; }
    .summary-total { min-width: 230px; border-radius: 24px; background: #0f172a; color: #ffffff; padding: 18px 20px; }
    .summary-total p { margin: 0; }
    .summary-total .label { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #cbd5e1; font-weight: 900; }
    .summary-total .amount { margin-top: 10px; font-size: 30px; font-weight: 900; }
    .signature { margin-top: 34px; display: flex; justify-content: flex-end; }
    .signature-box { min-width: 220px; text-align: center; }
    .signature-line { border-top: 1.5px solid #0f172a; margin-top: 6px; }
    .signature-label { margin-top: 8px; font-size: 11px; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; color: #475569; }
    .footer { margin-top: 26px; font-size: 12px; color: #64748b; text-align: center; }
    @media print {
      body { background: #ffffff; }
      .page { margin: 0; max-width: none; border-radius: 0; box-shadow: none; }
      .toolbar { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar"><button onclick="window.print()">Print Invoice</button></div>
    <div class="hero">
      ${logoMarkup}
      <div class="hero-copy">
        <div class="eyebrow">Membership Invoice</div>
        <h1>${escapeInvoiceHtml(gymName)}</h1>
        <p>${escapeInvoiceHtml(receiptInfo?.address || '')}${receiptInfo?.phone ? ` • ${escapeInvoiceHtml(receiptInfo.phone)}` : ''}</p>
      </div>
    </div>
    <div class="content">
      <div class="meta">
        <div class="meta-card">
          <div class="meta-label">Invoice Number</div>
          <div class="meta-value">${escapeInvoiceHtml(invoiceNumber)}</div>
          <div class="meta-sub">Generated for your recorded membership payment</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Invoice Date</div>
          <div class="meta-value">${escapeInvoiceHtml(formattedDate)}</div>
          <div class="meta-sub">Payment mode: ${escapeInvoiceHtml(entry?.payment_mode || 'Offline')}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Billed To</div>
          <div class="meta-value">${escapeInvoiceHtml(memberSummary?.full_name || 'Member')}</div>
          <div class="meta-sub">${escapeInvoiceHtml(memberSummary?.phone || memberSummary?.email || '')}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Entry Type</div>
          <div class="meta-value">${escapeInvoiceHtml(entry?.entry_type === 'DUE_COLLECTION' ? 'Due Collection' : 'Membership Payment')}</div>
          <div class="meta-sub">Tax ID: ${escapeInvoiceHtml(receiptInfo?.tax_id || 'Not provided')}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Reference</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeInvoiceHtml(entry?.plan_name || 'Membership')}</td>
            <td>${escapeInvoiceHtml(entry?.transaction_id || entry?.invoice_id || 'Recorded payment')}</td>
            <td>₹${formatInvoiceMoney(entry?.amount_paid || 0)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-note">
          This invoice reflects the payment currently recorded in your gym account. For corrections, refunds, or membership duration questions, contact the gym front desk directly.
        </div>
        <div class="summary-total">
          <p class="label">Total Paid</p>
          <p class="amount">₹${formatInvoiceMoney(entry?.amount_paid || 0)}</p>
        </div>
      </div>

      <div class="signature">
        <div class="signature-box">
          ${signatureMarkup}
          <div class="signature-line"></div>
          <div class="signature-label">Authorized Signature</div>
        </div>
      </div>

      <div class="footer">This is a computer-generated invoice.</div>
    </div>
  </div>
</body>
</html>`);
  invoiceWindow.document.close();
  return true;
};

const NoticeBanner = ({ notice }) => {
  if (!notice) return null;

  const tone = notice.type === 'success'
    ? {
      background: 'rgba(16,185,129,0.12)',
      border: '1px solid rgba(16,185,129,0.24)',
      color: '#a7f3d0',
    }
    : notice.type === 'warning'
      ? {
        background: 'rgba(251,191,36,0.12)',
        border: '1px solid rgba(251,191,36,0.22)',
        color: '#fde68a',
      }
      : {
        background: 'rgba(248,113,113,0.1)',
        border: '1px solid rgba(248,113,113,0.18)',
        color: '#fecaca',
      };

  return (
    <div className="p-3.5 rounded-2xl text-sm font-semibold" style={tone}>
      {notice.message}
    </div>
  );
};

const SectionShell = ({ title, subtitle, actions, children }) => (
  <div
    className="p-5 rounded-[28px]"
    style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}
  >
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <p className="text-white font-black text-base">{title}</p>
        {subtitle ? <p className="text-slate-400 text-sm font-medium mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
    {children}
  </div>
);

const MemberAvatar = ({ member, previewUrl, size = 68 }) => {
  const resolvedProfile = previewUrl || normalizeProfileImageUrl(member?.profile_pic);
  const initials = String(member?.full_name || 'M').trim().charAt(0).toUpperCase() || 'M';

  return (
    <div
      className="rounded-[22px] overflow-hidden flex items-center justify-center text-white font-black"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {resolvedProfile ? (
        <img src={resolvedProfile} alt={member?.full_name || 'Member profile'} className="w-full h-full object-cover" />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.38) }}>{initials}</span>
      )}
    </div>
  );
};

const CollectionCard = ({
  title,
  subtitle,
  context,
  checking,
  onCopyLink,
  onOpenLink,
  onCheckStatus,
  onDismiss,
}) => {
  if (!context) return null;

  const razorpay = context?.razorpay?.payment_link || null;
  const upi = !razorpay ? context?.collection || null : null;
  const deliveryMeta = razorpay ? describeCollectionLinkDelivery(razorpay) : null;
  const upiUri = upi
    ? buildUpiCollectionUri({
      upiId: upi.upi_id,
      payeeName: upi.payee_name,
      amount: upi.amount,
      note: upi.note,
      reference: upi.reference,
    })
    : '';

  return (
    <div
      className="rounded-[28px] p-5 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.94) 0%, rgba(30,41,59,0.94) 55%, rgba(99,102,241,0.22) 100%)', border: '1px solid rgba(129,140,248,0.18)' }}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        aria-label="Dismiss payment panel"
      >
        <XCircle size={15} />
      </button>

      <p className="text-indigo-300 text-[10px] font-black uppercase tracking-[0.22em]">{title}</p>
      <h4 className="text-white font-black text-xl mt-1">{subtitle}</h4>
      <p className="text-slate-400 text-sm font-medium mt-2">
        {razorpay
          ? (deliveryMeta?.message || 'Open the secure payment link or scan the QR code to complete your payment.')
          : 'Direct UPI collection is available, but your gym will confirm this payment after they receive it.'}
      </p>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-[170px_1fr] gap-4 items-start">
        <div className="rounded-[24px] bg-white p-3 shadow-sm border border-white/10 mx-auto md:mx-0">
          <QRCodeCanvas
            value={razorpay?.short_url || upiUri || 'upi://pay'}
            size={146}
            includeMargin
            bgColor="#ffffff"
            fgColor="#111827"
            level="M"
          />
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/12 bg-white/5 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Collect Into</p>
            <p className="text-white font-black text-sm mt-1">{context?.merchant_name || upi?.payee_name || 'Gym'}</p>
          </div>

          <div className="rounded-2xl border border-white/12 bg-white/5 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Amount</p>
            <p className="text-white font-black text-2xl mt-1">
              ₹{formatCollectionAmount(razorpay?.amount || upi?.amount || 0)}
            </p>
            <p className="text-slate-400 text-xs font-semibold mt-1">
              {razorpay ? (deliveryMeta?.label || 'Razorpay secure collection') : 'Direct UPI reference below'}
            </p>
          </div>

          {razorpay ? (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onOpenLink}
                className="w-full px-3 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Open Link
              </button>
              <button
                type="button"
                onClick={onCopyLink}
                className="w-full px-3 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Copy Link
              </button>
              <button
                type="button"
                onClick={onCheckStatus}
                disabled={checking}
                className="w-full px-3 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                {checking ? 'Checking...' : 'Check Status'}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-orange-200/20 bg-orange-500/10 px-3 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-200">UPI Reference</p>
              <p className="text-white font-black text-sm mt-1 break-all">{upi?.reference || 'Generated with payment request'}</p>
              <p className="text-orange-100/80 text-xs font-semibold mt-2">
                Use any UPI app to pay this amount. Your gym will mark the payment once they confirm receipt.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function MemberSelfServiceHub({ member, token, onMemberChange }) {
  const memberHeaders = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [notice, setNotice] = useState(null);
  const [history, setHistory] = useState([]);
  const [dues, setDues] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [duesLoading, setDuesLoading] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [bookingBusyKey, setBookingBusyKey] = useState('');
  const [renewalBusy, setRenewalBusy] = useState(false);
  const [renewalPlanId, setRenewalPlanId] = useState('');
  const [renewalContext, setRenewalContext] = useState(null);
  const [dueBusyKey, setDueBusyKey] = useState('');
  const [dueContext, setDueContext] = useState(null);
  const [profileForm, setProfileForm] = useState(() => createEmptyProfileForm(member));
  const [onboardingForm, setOnboardingForm] = useState(() => createEmptyOnboardingForm(member));
  const [profileSaving, setProfileSaving] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [profileFile, setProfileFile] = useState(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState('');
  const [removeProfilePic, setRemoveProfilePic] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentDeletingId, setDocumentDeletingId] = useState('');
  const [documentForm, setDocumentForm] = useState(() => createEmptyDocumentForm());
  const [documentDataUrl, setDocumentDataUrl] = useState('');
  const [documentFileName, setDocumentFileName] = useState('');

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const res = await axios.get('/api/member/dashboard', memberHeaders);
      setDashboard(res.data || null);
      setRenewalPlanId((current) => {
        const nextMembershipPlan = String(res.data?.membership?.plan_id || '');
        if (current && (res.data?.renewal_options || []).some((plan) => String(plan.id) === current)) {
          return current;
        }
        if (nextMembershipPlan) return nextMembershipPlan;
        return String(res.data?.renewal_options?.[0]?.id || '');
      });

      const mergedMember = buildMemberSnapshot(member, res.data);
      setProfileForm(createEmptyProfileForm(mergedMember));
      setOnboardingForm(createEmptyOnboardingForm(mergedMember));
      setRemoveProfilePic(false);
      setProfileFile(null);
      setProfilePreviewUrl('');
      if (hasMemberSnapshotChanged(member, mergedMember)) {
        onMemberChange?.(mergedMember);
      }
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not load your member workspace.' });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [member, memberHeaders, onMemberChange]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await axios.get('/api/member/payments/history?limit=25', memberHeaders);
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice((current) => current || { type: 'error', message: err?.response?.data?.error || 'Could not load payment history.' });
    } finally {
      setHistoryLoading(false);
    }
  }, [memberHeaders]);

  const loadDues = useCallback(async () => {
    setDuesLoading(true);
    try {
      const res = await axios.get('/api/member/payments/dues', memberHeaders);
      setDues(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice((current) => current || { type: 'error', message: err?.response?.data?.error || 'Could not load pending dues.' });
    } finally {
      setDuesLoading(false);
    }
  }, [memberHeaders]);

  const loadBookings = useCallback(async () => {
    setBookingsLoading(true);
    try {
      const res = await axios.get('/api/member/classes/bookings?limit=12', memberHeaders);
      setBookings(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice((current) => current || { type: 'error', message: err?.response?.data?.error || 'Could not load class bookings.' });
    } finally {
      setBookingsLoading(false);
    }
  }, [memberHeaders]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const from = new Date();
      const to = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));
      const res = await axios.get('/api/member/classes/schedule', {
        ...memberHeaders,
        params: {
          from: from.toISOString(),
          to: to.toISOString(),
        },
      });
      setSchedule(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice((current) => current || { type: 'error', message: err?.response?.data?.error || 'Could not load class schedule.' });
    } finally {
      setScheduleLoading(false);
    }
  }, [memberHeaders]);

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const res = await axios.get('/api/member/documents', memberHeaders);
      setDocuments(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setNotice((current) => current || { type: 'error', message: err?.response?.data?.error || 'Could not load your uploaded documents.' });
    } finally {
      setDocumentsLoading(false);
    }
  }, [memberHeaders]);

  const refreshPaymentsState = useCallback(async () => {
    await Promise.all([
      loadDashboard({ silent: true }),
      loadHistory(),
      loadDues(),
    ]);
  }, [loadDashboard, loadDues, loadHistory]);

  const refreshClassesState = useCallback(async () => {
    await Promise.all([
      loadDashboard({ silent: true }),
      loadBookings(),
      loadSchedule(),
    ]);
  }, [loadBookings, loadDashboard, loadSchedule]);

  const handleCopyCollectionValue = useCallback(async (value, successMessage) => {
    const didCopy = await copyCollectionText(value);
    setNotice({
      type: didCopy ? 'success' : 'warning',
      message: didCopy ? successMessage : 'Could not copy that value on this device.',
    });
  }, []);

  const handleCreateRenewalOrder = useCallback(async () => {
    if (!renewalPlanId) {
      setNotice({ type: 'warning', message: 'Select a plan before starting renewal.' });
      return;
    }

    setRenewalBusy(true);
    setNotice(null);
    try {
      const res = await axios.post('/api/member/membership/renew/create-order', {
        plan_id: Number(renewalPlanId),
      }, memberHeaders);
      setRenewalContext({ ...res.data, plan_id: Number(renewalPlanId) });
      if (!res.data?.razorpay?.payment_link && res.data?.collection) {
        setNotice({ type: 'warning', message: 'Direct UPI is available, but the gym will confirm that payment manually after they receive it.' });
      }
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not start the renewal payment.' });
    } finally {
      setRenewalBusy(false);
    }
  }, [memberHeaders, renewalPlanId]);

  const handleCheckRenewalStatus = useCallback(async ({ manual = false } = {}) => {
    const paymentLinkId = renewalContext?.razorpay?.payment_link?.id;
    if (!paymentLinkId || !renewalContext?.plan_id) return;

    setRenewalBusy(true);
    try {
      const res = await axios.post('/api/member/membership/renew/payment-link-status', {
        plan_id: renewalContext.plan_id,
        payment_link_id: paymentLinkId,
      }, memberHeaders);

      if (res.data?.payment_link) {
        setRenewalContext((current) => mergeMemberPaymentLinkContext(current, res.data));
      }

      if (!res.data?.paid) {
        const latestLinkStatus = getRazorpayLinkStatus(res.data?.payment_link || renewalContext?.razorpay?.payment_link);
        if (TERMINAL_RAZORPAY_LINK_STATUSES.has(latestLinkStatus) && latestLinkStatus !== 'PAID') {
          if (manual) {
            setNotice({
              type: 'warning',
              message: latestLinkStatus === 'NOT_FOUND'
                ? 'This Razorpay link is no longer available. Start the payment again.'
                : `This Razorpay link is ${latestLinkStatus.toLowerCase()}. Start the payment again.`,
            });
          }
          return;
        }

        if (manual) {
          setNotice({ type: 'warning', message: 'Payment is still pending on Razorpay.' });
        }
        return;
      }

      setRenewalContext(null);
      setNotice({ type: 'success', message: res.data?.message || 'Membership renewed successfully.' });
      await loadDashboard({ silent: true });
    } catch (err) {
      if (manual) {
        setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not verify the renewal payment.' });
      }
    } finally {
      setRenewalBusy(false);
    }
  }, [loadDashboard, memberHeaders, renewalContext]);

  const handleCreateDueOrder = useCallback(async (due) => {
    setDueBusyKey(`create-${due.id}`);
    setNotice(null);
    try {
      const res = await axios.post(`/api/member/payments/dues/${due.id}/create-order`, {
        amount: due.amount_due,
      }, memberHeaders);
      setDueContext({
        ...res.data,
        paymentId: due.id,
        amount: due.amount_due,
        plan_name: due.plan_name,
      });
      if (!res.data?.razorpay?.payment_link && res.data?.collection) {
        setNotice({ type: 'warning', message: 'Direct UPI is available, but the gym will confirm that payment after they receive it.' });
      }
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not start the due payment.' });
    } finally {
      setDueBusyKey('');
    }
  }, [memberHeaders]);

  const handleCheckDueStatus = useCallback(async ({ manual = false } = {}) => {
    const paymentId = dueContext?.paymentId;
    const paymentLinkId = dueContext?.razorpay?.payment_link?.id;
    if (!paymentId || !paymentLinkId) return;

    setDueBusyKey(`status-${paymentId}`);
    try {
      const res = await axios.post(`/api/member/payments/dues/${paymentId}/payment-link-status`, {
        payment_link_id: paymentLinkId,
        amount: dueContext?.amount,
      }, memberHeaders);

      if (res.data?.payment_link) {
        setDueContext((current) => mergeMemberPaymentLinkContext(current, res.data));
      }

      if (!res.data?.paid) {
        const latestLinkStatus = getRazorpayLinkStatus(res.data?.payment_link || dueContext?.razorpay?.payment_link);
        if (TERMINAL_RAZORPAY_LINK_STATUSES.has(latestLinkStatus) && latestLinkStatus !== 'PAID') {
          if (manual) {
            setNotice({
              type: 'warning',
              message: latestLinkStatus === 'NOT_FOUND'
                ? 'This Razorpay link is no longer available. Start the payment again.'
                : `This Razorpay link is ${latestLinkStatus.toLowerCase()}. Start the payment again.`,
            });
          }
          return;
        }

        if (manual) {
          setNotice({ type: 'warning', message: 'Payment is still pending on Razorpay.' });
        }
        return;
      }

      setDueContext(null);
      setNotice({ type: 'success', message: res.data?.message || 'Pending due cleared successfully.' });
      await refreshPaymentsState();
    } catch (err) {
      if (manual) {
        setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not verify the due payment.' });
      }
    } finally {
      setDueBusyKey('');
    }
  }, [dueContext, memberHeaders, refreshPaymentsState]);

  const handleBookClass = useCallback(async (sessionId) => {
    setBookingBusyKey(`book-${sessionId}`);
    setNotice(null);
    try {
      const res = await axios.post('/api/member/classes/bookings', {
        session_id: sessionId,
      }, memberHeaders);
      setNotice({
        type: 'success',
        message: res.data?.booking_status === 'WAITLISTED'
          ? 'Class was full, so you were added to the waitlist.'
          : 'Class booked successfully.',
      });
      await refreshClassesState();
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not book that class.' });
    } finally {
      setBookingBusyKey('');
    }
  }, [memberHeaders, refreshClassesState]);

  const handleCancelBooking = useCallback(async (bookingId) => {
    setBookingBusyKey(`cancel-${bookingId}`);
    setNotice(null);
    try {
      await axios.delete(`/api/member/classes/bookings/${bookingId}`, memberHeaders);
      setNotice({ type: 'success', message: 'Class booking cancelled.' });
      await refreshClassesState();
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not cancel that class booking.' });
    } finally {
      setBookingBusyKey('');
    }
  }, [memberHeaders, refreshClassesState]);

  const handleProfileFileChange = useCallback((event) => {
    const nextFile = event.target.files?.[0] || null;
    setProfileFile(nextFile);
    setRemoveProfilePic(false);
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setProfileSaving(true);
    setNotice(null);
    try {
      const payload = new FormData();
      payload.set('full_name', profileForm.full_name);
      payload.set('email', profileForm.email);
      payload.set('phone', profileForm.phone);
      if (removeProfilePic) {
        payload.set('remove_profile_pic', 'true');
      }
      if (profileFile) {
        payload.set('profile_pic', profileFile);
      }

      await axios.put('/api/member/profile', payload, {
        headers: {
          'x-auth-token': token,
          'Content-Type': 'multipart/form-data',
        },
      });

      setNotice({ type: 'success', message: 'Profile updated successfully.' });
      await loadDashboard({ silent: true });
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not update your profile.' });
    } finally {
      setProfileSaving(false);
    }
  }, [loadDashboard, profileFile, profileForm.email, profileForm.full_name, profileForm.phone, removeProfilePic, token]);

  const handleSaveOnboarding = useCallback(async () => {
    setOnboardingSaving(true);
    setNotice(null);
    try {
      await axios.patch('/api/member/onboarding', onboardingForm, memberHeaders);
      setNotice({ type: 'success', message: 'Onboarding details updated successfully.' });
      await loadDashboard({ silent: true });
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not update onboarding details.' });
    } finally {
      setOnboardingSaving(false);
    }
  }, [loadDashboard, memberHeaders, onboardingForm]);

  const handleDocumentFileChange = useCallback(async (event) => {
    const nextFile = event.target.files?.[0] || null;
    if (!nextFile) return;

    try {
      const inlineImage = await fileToInlineImageDataUrl(nextFile);
      setDocumentDataUrl(inlineImage);
      setDocumentFileName(nextFile.name || 'document');
      setNotice(null);
      setDocumentForm((current) => ({
        ...current,
        doc_name: current.doc_name || nextFile.name.replace(/\.[^.]+$/, ''),
      }));
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Could not read the selected document.' });
      setDocumentDataUrl('');
      setDocumentFileName('');
    } finally {
      event.target.value = '';
    }
  }, []);

  const handleSaveDocument = useCallback(async () => {
    if (!documentForm.doc_type || !documentDataUrl) {
      setNotice({ type: 'warning', message: 'Select a document type and upload an image before saving.' });
      return;
    }

    setDocumentSaving(true);
    setNotice(null);
    try {
      await axios.post('/api/member/documents', {
        doc_type: documentForm.doc_type,
        doc_name: documentForm.doc_name,
        notes: documentForm.notes,
        doc_url: documentDataUrl,
      }, memberHeaders);
      setDocumentForm(createEmptyDocumentForm());
      setDocumentDataUrl('');
      setDocumentFileName('');
      setNotice({ type: 'success', message: 'Document uploaded successfully.' });
      await loadDocuments();
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not save this document.' });
    } finally {
      setDocumentSaving(false);
    }
  }, [documentDataUrl, documentForm, loadDocuments, memberHeaders]);

  const handleDeleteDocument = useCallback(async (documentId) => {
    setDocumentDeletingId(String(documentId));
    setNotice(null);
    try {
      await axios.delete(`/api/member/documents/${documentId}`, memberHeaders);
      setNotice({ type: 'success', message: 'Document deleted.' });
      await loadDocuments();
    } catch (err) {
      setNotice({ type: 'error', message: err?.response?.data?.error || 'Could not delete this document.' });
    } finally {
      setDocumentDeletingId('');
    }
  }, [loadDocuments, memberHeaders]);

  const handleOpenInvoice = useCallback((entry) => {
    const opened = openMemberInvoiceWindow({
      entry,
      receiptInfo: dashboard?.receipt_info || {},
      memberSummary: buildMemberSnapshot(member, dashboard),
    });
    if (!opened) {
      setNotice({ type: 'warning', message: 'Popup blocked. Allow popups to view your invoice.' });
    }
  }, [dashboard, member]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === 'payments') {
      loadHistory();
      loadDues();
    }
  }, [activeTab, loadDues, loadHistory]);

  useEffect(() => {
    if (activeTab === 'classes') {
      loadBookings();
      loadSchedule();
    }
  }, [activeTab, loadBookings, loadSchedule]);

  useEffect(() => {
    if (activeTab === 'profile') {
      loadDocuments();
    }
  }, [activeTab, loadDocuments]);

  useEffect(() => {
    if (!profileFile) {
      setProfilePreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(profileFile);
    setProfilePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [profileFile]);

  useEffect(() => {
    const paymentLinkId = renewalContext?.razorpay?.payment_link?.id;
    if (!paymentLinkId || !canReuseRazorpayLink(renewalContext?.razorpay?.payment_link)) return undefined;

    const intervalId = window.setInterval(() => {
      handleCheckRenewalStatus();
    }, 12000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [handleCheckRenewalStatus, renewalContext?.razorpay?.payment_link?.id]);

  useEffect(() => {
    const paymentLinkId = dueContext?.razorpay?.payment_link?.id;
    if (!paymentLinkId || !canReuseRazorpayLink(dueContext?.razorpay?.payment_link)) return undefined;

    const intervalId = window.setInterval(() => {
      handleCheckDueStatus();
    }, 12000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [dueContext?.razorpay?.payment_link?.id, handleCheckDueStatus]);

  const currentMembership = dashboard?.membership || null;
  const recentHistory = dashboard?.payments_summary?.recent_history || [];
  const upcomingSummaryBookings = dashboard?.classes_summary?.upcoming_bookings || [];
  const paymentCapabilities = dashboard?.payment_capabilities || {
    online_enabled: false,
    channels: { razorpay: false, upi: false },
  };
  const canBookClasses = Boolean(currentMembership?.can_book_classes);
  const visibleStatus = String(currentMembership?.status || member?.membership_status || '').toUpperCase();
  const summaryMember = buildMemberSnapshot(member, dashboard);

  if (loading && !dashboard) {
    return <PageLoader className="min-h-[36vh]" label="Loading member workspace..." />;
  }

  return (
    <div className="space-y-3">
      <SectionShell
        title="Self-service workspace"
        subtitle="Renew plans, clear dues, manage class bookings, and update your profile from the same member portal."
        actions={(
          <button
            type="button"
            onClick={() => loadDashboard()}
            disabled={loading}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-60"
            style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(129,140,248,0.24)' }}
            aria-label="Refresh member workspace"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Member self service sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full rounded-2xl px-3 py-3 text-left transition-all ${activeTab === tab.key ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
              style={{
                background: activeTab === tab.key ? 'linear-gradient(135deg, rgba(99,102,241,0.28), rgba(139,92,246,0.24))' : 'rgba(255,255,255,0.04)',
                border: activeTab === tab.key ? '1px solid rgba(129,140,248,0.28)' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-2">
                <tab.Icon size={15} />
                <span className="text-sm font-black">{tab.label}</span>
              </div>
            </button>
          ))}
        </div>
      </SectionShell>

      <NoticeBanner notice={notice} />

      {activeTab === 'overview' && (
        <div className="space-y-3">
          <SectionShell
            title="Renew membership"
            subtitle={currentMembership?.end_date
              ? `Current plan ends on ${formatDate(currentMembership.end_date)}. Renew now to avoid interruptions.`
              : 'Start or renew your membership from the plans your gym has published.'}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_auto] gap-3 items-end">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Choose Plan</label>
                <select
                  value={renewalPlanId}
                  onChange={(event) => setRenewalPlanId(event.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-bold outline-none"
                >
                  {(dashboard?.renewal_options || []).map((plan) => (
                    <option key={plan.id} value={plan.id} className="text-slate-900">
                      {plan.name} • ₹{formatCollectionAmount(plan.price)} • {plan.duration_days} days
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleCreateRenewalOrder}
                disabled={renewalBusy || !renewalPlanId || !paymentCapabilities.online_enabled}
                className="w-full md:w-auto px-5 py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                {renewalBusy ? 'Starting...' : 'Renew Now'}
              </button>
            </div>

            {!paymentCapabilities.online_enabled && (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm font-semibold">
                Your gym has not enabled self-service online payments yet. Ask reception to enable member collection in Integrations.
              </div>
            )}

            {renewalContext && (
              <div className="mt-4">
                <CollectionCard
                  title="Membership Renewal"
                  subtitle={renewalContext?.plan?.name || currentMembership?.plan_name || 'Secure collection'}
                  context={renewalContext}
                  checking={renewalBusy}
                  onCopyLink={() => handleCopyCollectionValue(renewalContext?.razorpay?.payment_link?.short_url, 'Payment link copied.')}
                  onOpenLink={() => openCollectionLink(renewalContext?.razorpay?.payment_link?.short_url)}
                  onCheckStatus={() => handleCheckRenewalStatus({ manual: true })}
                  onDismiss={() => setRenewalContext(null)}
                />
              </div>
            )}
          </SectionShell>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="space-y-3">
          <SectionShell
            title="Pending dues"
            subtitle="Clear any open balances with the same secure collection flow your gym already uses at the desk."
          >
            {duesLoading ? (
              <PageLoader className="min-h-[24vh]" label="Loading dues..." />
            ) : dues.length > 0 ? (
              <div className="space-y-3">
                {dues.map((due) => (
                  <div key={due.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-white font-black text-sm">{due.plan_name || 'Membership due'}</p>
                        <p className="text-slate-400 text-xs font-semibold mt-1">Raised on {formatDateTime(due.payment_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-black text-lg">₹{formatCollectionAmount(due.amount_due)}</p>
                        <p className="text-slate-400 text-[11px] font-semibold mt-1">Pending balance</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-4 text-[11px] font-semibold text-slate-400">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Invoice</p>
                        <p className="text-white font-black mt-1">{due.invoice_id || 'Unassigned'}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</p>
                        <p className="text-white font-black mt-1">{due.status || 'Pending'}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCreateDueOrder(due)}
                      disabled={Boolean(dueBusyKey) || !paymentCapabilities.online_enabled}
                      className="w-full mt-4 py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}
                    >
                      {dueBusyKey === `create-${due.id}` ? 'Starting...' : 'Pay This Due'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-4 text-emerald-100 text-sm font-semibold">
                No pending dues found on your account.
              </div>
            )}

            {dueContext && (
              <div className="mt-4">
                <CollectionCard
                  title="Pending Due"
                  subtitle={dueContext.plan_name || 'Secure collection'}
                  context={dueContext}
                  checking={dueBusyKey === `status-${dueContext.paymentId}`}
                  onCopyLink={() => handleCopyCollectionValue(dueContext?.razorpay?.payment_link?.short_url, 'Payment link copied.')}
                  onOpenLink={() => openCollectionLink(dueContext?.razorpay?.payment_link?.short_url)}
                  onCheckStatus={() => handleCheckDueStatus({ manual: true })}
                  onDismiss={() => setDueContext(null)}
                />
              </div>
            )}
          </SectionShell>

          <SectionShell title="Payment history" subtitle="This includes both membership payments and any later due collections.">
            {historyLoading ? (
              <PageLoader className="min-h-[24vh]" label="Loading payment history..." />
            ) : history.length > 0 ? (
              <div className="space-y-2">
                {history.map((entry, index) => (
                  <div key={`${entry.transaction_id || entry.invoice_id || entry.payment_date}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-white font-black text-sm">{entry.plan_name || 'Membership'}</p>
                      <p className="text-slate-400 text-xs font-semibold mt-1">{formatDateTime(entry.payment_date)} • {entry.payment_mode || 'Cash'}</p>
                      <p className="text-slate-500 text-[11px] font-semibold mt-1">Invoice: {entry.invoice_id || entry.transaction_id || 'Generated at desk'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-black text-sm">₹{formatCollectionAmount(entry.amount_paid)}</p>
                      <p className="text-slate-400 text-[11px] font-semibold mt-1">{entry.entry_type === 'DUE_COLLECTION' ? 'Due collection' : 'Membership payment'}</p>
                      <button
                        type="button"
                        onClick={() => handleOpenInvoice(entry)}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                      >
                        <FileText size={13} /> View Invoice
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-slate-300 text-sm font-semibold">
                No payment history yet.
              </div>
            )}
          </SectionShell>
        </div>
      )}

      {activeTab === 'classes' && (
        <div className="space-y-3">
          <SectionShell
            title="Your bookings"
            subtitle={canBookClasses ? 'Manage the classes you have already booked.' : 'Booking new classes requires an active membership.'}
          >
            {bookingsLoading ? (
              <PageLoader className="min-h-[24vh]" label="Loading bookings..." />
            ) : bookings.length > 0 ? (
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <div key={booking.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-white font-black text-sm">{booking.class_title}</p>
                        <p className="text-slate-400 text-xs font-semibold mt-1">{formatDateTime(booking.starts_at)} • {booking.location || 'Main floor'}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${booking.status === 'WAITLISTED' ? 'bg-amber-500/20 text-amber-100' : 'bg-indigo-500/20 text-indigo-100'}`}>
                        {booking.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-4 text-[11px] font-semibold text-slate-400">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Trainer</p>
                        <p className="text-white font-black mt-1">{booking.trainer_name || 'Gym staff'}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Category</p>
                        <p className="text-white font-black mt-1">{booking.category || 'General'}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCancelBooking(booking.id)}
                      disabled={bookingBusyKey === `cancel-${booking.id}`}
                      className="w-full mt-4 py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #f43f5e, #ef4444)' }}
                    >
                      {bookingBusyKey === `cancel-${booking.id}` ? 'Cancelling...' : 'Cancel Booking'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-slate-300 text-sm font-semibold">
                You have no active class bookings yet.
              </div>
            )}
          </SectionShell>

          <SectionShell
            title="Upcoming schedule"
            subtitle={canBookClasses ? 'Book open sessions for the next two weeks.' : 'Activate your membership before booking new sessions.'}
          >
            {!canBookClasses && (
              <div className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-amber-100 text-sm font-semibold">
                An active membership is required before you can self-book classes.
              </div>
            )}

            {scheduleLoading ? (
              <PageLoader className="min-h-[24vh]" label="Loading class schedule..." />
            ) : schedule.length > 0 ? (
              <div className="space-y-3">
                {schedule.map((session) => {
                  const isBooked = Boolean(session.member_booking);
                  const seatsLeft = Math.max(0, Number(session.capacity || 0) - Number(session.booked_count || 0));
                  return (
                    <div key={session.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-white font-black text-sm">{session.class_title}</p>
                          <p className="text-slate-400 text-xs font-semibold mt-1">{formatDateTime(session.starts_at)} • {session.location || 'Gym floor'} </p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${isBooked ? 'bg-indigo-500/20 text-indigo-100' : session.is_full ? 'bg-amber-500/20 text-amber-100' : 'bg-emerald-500/20 text-emerald-100'}`}>
                          {isBooked ? session.member_booking.status : session.is_full ? 'Almost Full' : 'Open'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-4 text-[11px] font-semibold text-slate-400">
                        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Trainer</p>
                          <p className="text-white font-black mt-1">{session.trainer_name || 'Gym staff'}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Seats Left</p>
                          <p className="text-white font-black mt-1">{seatsLeft}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Category</p>
                          <p className="text-white font-black mt-1">{session.category || 'General'}</p>
                        </div>
                      </div>

                      {!isBooked ? (
                        <button
                          type="button"
                          onClick={() => handleBookClass(session.id)}
                          disabled={!canBookClasses || bookingBusyKey === `book-${session.id}`}
                          className="w-full mt-4 py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}
                        >
                          {bookingBusyKey === `book-${session.id}` ? 'Booking...' : 'Book Class'}
                        </button>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-indigo-300/20 bg-indigo-500/10 px-4 py-3 text-indigo-100 text-sm font-semibold">
                          You already have a {session.member_booking.status.toLowerCase()} entry for this class.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-slate-300 text-sm font-semibold">
                No upcoming class sessions were published yet.
              </div>
            )}
          </SectionShell>
        </div>
      )}

      {activeTab === 'profile' && (
        <SectionShell title="Profile settings" subtitle="Update your contact details, finish onboarding, and keep your personal documents ready in the same portal.">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="shrink-0">
                <MemberAvatar member={summaryMember} previewUrl={removeProfilePic ? '' : profilePreviewUrl} size={82} />
              </div>

              <div className="flex-1 w-full space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => document.getElementById('member-profile-upload-input')?.click()}
                    className="w-full py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white"
                    style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}
                  >
                    <span className="inline-flex items-center gap-2"><Upload size={15} /> Upload Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileFile(null);
                      setProfilePreviewUrl('');
                      setRemoveProfilePic(true);
                    }}
                    className="w-full py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    <span className="inline-flex items-center gap-2"><Camera size={15} /> Remove Photo</span>
                  </button>
                </div>
                <input id="member-profile-upload-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" className="hidden" onChange={handleProfileFileChange} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Full Name</span>
                    <input
                      type="text"
                      value={profileForm.full_name}
                      onChange={(event) => setProfileForm((current) => ({ ...current, full_name: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Your full name"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Phone</span>
                    <div className="relative">
                      <Phone size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={profileForm.phone}
                        onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 10) }))}
                        className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                        placeholder="10-digit mobile"
                      />
                    </div>
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Email</span>
                    <div className="relative">
                      <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                        className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                        placeholder="your@email.com"
                      />
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-semibold text-slate-400">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Gym</p>
                    <p className="text-white font-black mt-1">{summaryMember.gym_name || 'GymVault gym'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current Plan</p>
                    <p className="text-white font-black mt-1">{currentMembership?.plan_name || 'None assigned'}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className="w-full py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #10b981, #14b8a6)' }}
                >
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-black text-base">Onboarding details</p>
                    <p className="text-slate-400 text-sm font-medium mt-1">Keep your emergency, health, and identity details updated.</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.18em] ${onboardingForm.onboarding_complete ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'}`}>
                    {onboardingForm.onboarding_complete ? 'Complete' : 'Pending'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Emergency Contact</span>
                    <input
                      type="text"
                      value={onboardingForm.emergency_contact}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, emergency_contact: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Family member or emergency number"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Gender</span>
                    <select
                      value={onboardingForm.gender}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, gender: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                    >
                      <option value="" className="text-slate-900">Select</option>
                      <option value="Male" className="text-slate-900">Male</option>
                      <option value="Female" className="text-slate-900">Female</option>
                      <option value="Other" className="text-slate-900">Other</option>
                      <option value="Prefer not to say" className="text-slate-900">Prefer not to say</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Date of Birth</span>
                    <input
                      type="date"
                      value={onboardingForm.date_of_birth}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, date_of_birth: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Blood Group</span>
                    <input
                      type="text"
                      value={onboardingForm.blood_group}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, blood_group: event.target.value.toUpperCase() }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="A+, O-, B+"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Address</span>
                    <textarea
                      rows={2}
                      value={onboardingForm.address}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, address: event.target.value }))}
                      className="w-full resize-none px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Your current address"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Medical Notes</span>
                    <textarea
                      rows={3}
                      value={onboardingForm.medical_notes}
                      onChange={(event) => setOnboardingForm((current) => ({ ...current, medical_notes: event.target.value }))}
                      className="w-full resize-none px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Mention injuries, restrictions, medications, or other notes your trainer should know."
                    />
                  </label>
                </div>

                <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3 gap-3">
                  <span className="text-sm font-black text-white">Mark onboarding complete</span>
                  <input
                    type="checkbox"
                    checked={onboardingForm.onboarding_complete}
                    onChange={(event) => setOnboardingForm((current) => ({ ...current, onboarding_complete: event.target.checked }))}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSaveOnboarding}
                  disabled={onboardingSaving}
                  className="w-full py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  {onboardingSaving ? 'Saving...' : 'Save Onboarding'}
                </button>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-black text-base">Documents</p>
                    <p className="text-slate-400 text-sm font-medium mt-1">Upload your ID and supporting documents so the gym can keep your profile complete.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => document.getElementById('member-document-upload-input')?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10"
                  >
                    <Upload size={13} /> Add File
                  </button>
                </div>

                <input id="member-document-upload-input" type="file" accept={INLINE_IMAGE_ACCEPT} className="hidden" onChange={handleDocumentFileChange} />

                <div className="grid grid-cols-1 gap-3 text-sm">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Document Type</span>
                    <select
                      value={documentForm.doc_type}
                      onChange={(event) => setDocumentForm((current) => ({ ...current, doc_type: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                    >
                      <option value="" className="text-slate-900">Select document type</option>
                      {MEMBER_DOCUMENT_TYPES.map((docType) => (
                        <option key={docType} value={docType} className="text-slate-900">{docType}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Document Name</span>
                    <input
                      type="text"
                      value={documentForm.doc_name}
                      onChange={(event) => setDocumentForm((current) => ({ ...current, doc_name: event.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Example: Aadhaar Front"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Notes</span>
                    <textarea
                      rows={2}
                      value={documentForm.notes}
                      onChange={(event) => setDocumentForm((current) => ({ ...current, notes: event.target.value }))}
                      className="w-full resize-none px-4 py-3 rounded-2xl bg-slate-950/40 border border-white/10 text-white font-semibold outline-none"
                      placeholder="Optional note for the gym team"
                    />
                  </label>
                </div>

                {documentDataUrl ? (
                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 p-3">
                    <div className="flex items-start gap-3">
                      <img src={documentDataUrl} alt={documentFileName || 'Document preview'} className="h-20 w-20 rounded-2xl object-cover border border-white/10" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-emerald-50 truncate">{documentFileName || 'Selected document'}</p>
                        <p className="mt-1 text-[11px] font-semibold text-emerald-100/80">Ready to upload to your member profile.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setDocumentDataUrl('');
                            setDocumentFileName('');
                          }}
                          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-200/20 bg-slate-950/25 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-50"
                        >
                          <XCircle size={13} /> Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/20 px-4 py-8 text-center">
                    <FileText size={18} className="mx-auto text-slate-500" />
                    <p className="mt-2 text-sm font-semibold text-slate-300">No document selected yet.</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">Accepted formats: JPG, PNG, WEBP.</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveDocument}
                  disabled={documentSaving}
                  className="w-full py-3 rounded-2xl text-sm font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}
                >
                  {documentSaving ? 'Uploading...' : 'Save Document'}
                </button>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-white font-black text-sm">Uploaded documents</p>
                    <button
                      type="button"
                      onClick={loadDocuments}
                      disabled={documentsLoading}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={documentsLoading ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>

                  {documentsLoading ? (
                    <PageLoader className="min-h-[20vh]" label="Loading documents..." />
                  ) : documents.length > 0 ? (
                    <div className="space-y-2">
                      {documents.map((doc) => (
                        <div key={doc.id} className="rounded-2xl border border-white/10 bg-slate-950/25 px-3 py-3 flex items-start gap-3">
                          <a href={doc.doc_url} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                            <img src={doc.doc_url} alt={doc.doc_name || doc.doc_type || 'Document'} className="h-16 w-16 object-cover" loading="lazy" />
                          </a>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-white truncate">{doc.doc_name || doc.doc_type || 'Document'}</p>
                            <p className="mt-1 text-[11px] font-semibold text-slate-400">{doc.doc_type || 'Document'} • {formatDateTime(doc.uploaded_at || doc.created_at)}</p>
                            {doc.notes ? <p className="mt-2 text-[12px] font-medium text-slate-300 leading-5">{doc.notes}</p> : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteDocument(doc.id)}
                            disabled={documentDeletingId === String(doc.id)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-300/20 bg-rose-500/10 text-rose-100 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
                            aria-label={`Delete ${doc.doc_name || doc.doc_type || 'document'}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/20 px-4 py-6 text-center text-sm font-semibold text-slate-400">
                      No documents uploaded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </SectionShell>
      )}
    </div>
  );
}