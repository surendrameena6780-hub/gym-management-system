import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { 
  User, Building2, Users, Bell, CreditCard, Blocks, 
  ShieldCheck, Database, Sliders, Palette, Zap, 
  FileText, AlertOctagon, Save, Lock, Trash2,
  CheckCircle, Plus, Download, Smartphone, Monitor, Globe,
  Mail, Phone, MapPin, Link, FileDigit, Fingerprint, Camera, 
  RefreshCw, Check, HardDrive, AlertTriangle, ToggleRight, ToggleLeft, Star, Crown,
  MessageSquare, Send, ChevronDown, ChevronRight, ArrowLeft, Moon
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import PageLoader from './PageLoader';
import { applyInterfacePreferences, saveInterfacePreferencesLocal } from './utils/interfacePreferences';
import { apiFetch } from './utils/apiFetch';
import { reportClientError } from './utils/clientErrorReporter';

const TABS = [
  { id: 'account', label: 'Account & Business', icon: User, group: 'Personal & Business' },
  { id: 'staff', label: 'Staff & Roles', icon: Users, group: 'Personal & Business' },
  { id: 'billing', label: 'Billing & Subscriptions', icon: CreditCard, group: 'Personal & Business' },
  { id: 'integrations', label: 'Integrations', icon: Blocks, group: 'System' },
  { id: 'security', label: 'Security Settings', icon: ShieldCheck, group: 'System' },
  { id: 'data', label: 'Data & Backup', icon: Database, group: 'System' },
  { id: 'preferences', label: 'System Preferences', icon: Sliders, group: 'Customization' },
  { id: 'interface', label: 'Interface Preferences', icon: Palette, group: 'Customization' },
  { id: 'automation', label: 'Automation', icon: Zap, group: 'Advanced' },
  { id: 'reports', label: 'Report Settings', icon: FileText, group: 'Advanced' },
  { id: 'danger', label: 'Danger Zone', icon: AlertOctagon, group: 'Danger' },
];

const SETTINGS_GROUPS = ['Personal & Business', 'System', 'Customization', 'Advanced', 'Danger'];

const normalizeSettingsTab = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return TABS.some((tab) => tab.id === normalized) ? normalized : 'account';
};

const SAAS_PLANS = {
  monthly: [
    { id: 'test',  name: 'Test Drive', price: 1,    billed: 1,     features: ['Full Feature Access', 'For Testing Only', '₹1 Payment Test', 'Expires in 1 Day'], icon: Zap, test: true, color: 'text-amber-500', bg: 'bg-amber-50' },
    { id: 'basic', name: 'Basic',      price: 999,  billed: 999,   features: ['Up to 100 Members', 'Basic Analytics', '1 Staff Account', 'Email Support'], icon: Star, color: 'text-blue-500', bg: 'bg-blue-50' },
    { id: 'pro',   name: 'Pro Vault',  price: 1999, billed: 1999,  features: ['Unlimited Members', 'AI Financial Insights', 'Auto WhatsApp Alerts', '3 Staff Accounts'], icon: Zap, popular: true, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 'elite', name: 'Elite',      price: 3999, billed: 3999,  features: ['Multi-Branch Support', 'Custom Branded App', 'Dedicated Manager', 'Unlimited Staff'], icon: Crown, color: 'text-rose-500', bg: 'bg-rose-50' },
  ],
  annual: [
    { id: 'test',  name: 'Test Drive', price: 1,    billed: 1,     features: ['Full Feature Access', 'For Testing Only', '₹1 Payment Test', 'Expires in 1 Day'], icon: Zap, test: true, color: 'text-amber-500', bg: 'bg-amber-50' },
    { id: 'basic', name: 'Basic',      price: 839,  billed: 10068, features: ['Up to 100 Members', 'Basic Analytics', '1 Staff Account', 'Email Support'], icon: Star, color: 'text-blue-500', bg: 'bg-blue-50' },
    { id: 'pro',   name: 'Pro Vault',  price: 1666, billed: 19992, features: ['Unlimited Members', 'AI Financial Insights', 'Auto WhatsApp Alerts', '3 Staff Accounts'], icon: Zap, popular: true, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 'elite', name: 'Elite',      price: 3333, billed: 39996, features: ['Multi-Branch Support', 'Custom Branded App', 'Dedicated Manager', 'Unlimited Staff'], icon: Crown, color: 'text-rose-500', bg: 'bg-rose-50' },
  ],
};

// Per-plan limits used in ProgressBars and feature descriptions
const PLAN_LIMITS = {
  test:  { members: 'Unlimited', staff: 'Unlimited', storage: 2  },
  basic: { members: 100,         staff: 1,           storage: 5  },
  pro:   { members: 'Unlimited', staff: 3,           storage: 10 },
  elite: { members: 'Unlimited', staff: 'Unlimited', storage: 20 },
};

const STAFF_ROLE_OPTIONS = [
  'MANAGER',
  'RECEPTION',
  'TRAINER',
  'WORKER',
  'CLEANER',
  'ACCOUNTANT',
  'STAFF',
];

const API_SCOPE_OPTIONS = [
  'members:read',
  'members:write',
  'payments:read',
  'payments:write',
  'attendance:read',
  'attendance:write',
  'dashboard:read',
];

const WEBHOOK_EVENT_OPTIONS = [
  'member.created',
  'member.updated',
  'payment.recorded',
  'attendance.checked_in',
  'class.booking.created',
];

const buildBranchDirectoryState = (count = 1, existing = []) => {
  const normalizedCount = Math.max(1, Math.min(25, Number.parseInt(count, 10) || 1));
  const next = Array.from({ length: normalizedCount }, (_, index) => {
    const current = existing[index] || {};
    return {
      id: current.id || `branch-${index + 1}`,
      name: current.name || (index === 0 ? 'Main Branch' : `Branch ${index + 1}`),
      address: current.address || '',
      phone: current.phone || '',
    };
  });
  return next;
};

const createWebhookDraft = () => ({
  id: null,
  url: '',
  events: ['payment.recorded'],
  secret: '',
  is_active: true,
});

const IMPORT_SAMPLE_CSV = 'full_name,email,phone\nAarav Singh,aarav@example.com,9876543210\nMeera Patel,meera@example.com,9123456780';

const DEFAULT_MESSAGE_TEMPLATES = [
  { template_key: 'EXPIRING_SOON', title: 'Membership Expiring Soon', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'EXPIRED', title: 'Membership Expired', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'UNPAID', title: 'Pending Payment', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'INACTIVE', title: 'Inactive Member Winback', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'SALES_OFFER', title: 'Sales / Promo Offer', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'HOLIDAY', title: 'Holiday Announcement', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'RENEWAL_REMINDER', title: 'Renewal Reminder', whatsapp_text: '', sms_text: '', is_active: true },
  { template_key: 'PAYMENT_DUE', title: 'Payment Due Alert', whatsapp_text: '', sms_text: '', is_active: true },
];

const normalizeTemplateSyncStatus = (value) => {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return 'NOT_SYNCED';
  if (status.includes('APPROVED') || status === 'ACTIVE' || status.includes('ENABLE') || status === 'LIVE') return 'APPROVED';
  if (status.includes('PENDING') || status.includes('PROCESS') || status.includes('QUEUE') || status.includes('REVIEW') || status.includes('REQUESTED')) return 'PENDING';
  if (status.includes('REJECT')) return 'REJECTED';
  if (status.includes('DISABLE') || status.includes('INACTIVE')) return 'DISABLED';
  if (status.includes('FAIL') || status.includes('ERROR')) return 'FAILED';
  return status;
};

const getWhatsAppConnectionMeta = (status) => {
  const normalized = String(status || 'NOT_CONFIGURED').toUpperCase();
  const lookup = {
    CONNECTED: {
      label: 'Connected',
      card: 'bg-emerald-50 border-emerald-200',
      dot: 'bg-emerald-500',
      text: 'text-emerald-700',
      note: 'This gym number is verified and ready for MSG91 template messaging.',
    },
    PENDING_CONNECTION: {
      label: 'Pending Connection',
      card: 'bg-amber-50 border-amber-200',
      dot: 'bg-amber-400',
      text: 'text-amber-700',
      note: 'Finish the one-time MSG91 and Meta verification for this business number.',
    },
    PLATFORM_NOT_READY: {
      label: 'Platform Not Ready',
      card: 'bg-rose-50 border-rose-200',
      dot: 'bg-rose-500',
      text: 'text-rose-700',
      note: 'MSG91 WhatsApp auth is missing on the server.',
    },
    ERROR: {
      label: 'Sync Error',
      card: 'bg-rose-50 border-rose-200',
      dot: 'bg-rose-500',
      text: 'text-rose-700',
      note: 'GymVault could not refresh this number right now. Try again after checking MSG91.',
    },
    NOT_CONFIGURED: {
      label: 'Not Configured',
      card: 'bg-slate-50 border-slate-200',
      dot: 'bg-slate-300',
      text: 'text-slate-600',
      note: 'Add your gym business WhatsApp number to start setup.',
    },
  };
  return lookup[normalized] || lookup.NOT_CONFIGURED;
};

const getTemplateSyncMeta = (status) => {
  const normalized = String(status || 'NOT_SYNCED').toUpperCase();
  const lookup = {
    READY: { label: 'Templates Ready', pill: 'bg-emerald-100 text-emerald-700' },
    PARTIAL: { label: 'Partially Ready', pill: 'bg-amber-100 text-amber-700' },
    PENDING_APPROVAL: { label: 'Pending Approval', pill: 'bg-amber-100 text-amber-700' },
    ERROR: { label: 'Needs Attention', pill: 'bg-rose-100 text-rose-700' },
    NOT_SYNCED: { label: 'Not Synced', pill: 'bg-slate-100 text-slate-600' },
  };
  return lookup[normalized] || lookup.NOT_SYNCED;
};

const getWhatsAppDeliveryMeta = (status) => {
  const normalized = String(status || 'QUEUED').trim().toUpperCase();
  const lookup = {
    READ: { label: 'Read', pill: 'bg-emerald-100 text-emerald-700' },
    DELIVERED: { label: 'Delivered', pill: 'bg-teal-100 text-teal-700' },
    SENT: { label: 'Sent', pill: 'bg-sky-100 text-sky-700' },
    SUBMITTED: { label: 'Submitted', pill: 'bg-indigo-100 text-indigo-700' },
    QUEUED: { label: 'Queued', pill: 'bg-slate-100 text-slate-600' },
    FAILED: { label: 'Failed', pill: 'bg-rose-100 text-rose-700' },
    UNKNOWN: { label: 'Unknown', pill: 'bg-slate-100 text-slate-500' },
  };
  return lookup[normalized] || lookup.UNKNOWN;
};

const getWhatsAppDeliveryActivity = (log) => {
  if (log?.read_at) return { label: 'Read', time: log.read_at };
  if (log?.delivered_at) return { label: 'Delivered', time: log.delivered_at };
  if (log?.failed_at) return { label: 'Failed', time: log.failed_at };
  if (log?.sent_at) return { label: 'Sent', time: log.sent_at };
  if (log?.submitted_at) return { label: 'Submitted', time: log.submitted_at };
  if (log?.updated_at) return { label: 'Updated', time: log.updated_at };
  return { label: 'Created', time: log?.created_at };
};

const DELIVERY_LOG_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'READ', label: 'Read' },
];

const getRazorpayCheckoutImageUrl = () => {
  if (typeof window === 'undefined') return '';
  return new URL('/gymvault-app-icon-192.png', window.location.origin).toString();
};

const DEFAULT_WHATSAPP_ONBOARDING = {
  login_url: 'https://control.msg91.com/signin/',
  launch_url: 'https://control.msg91.com/signin/',
  guide_url: 'https://msg91.com/help/whatsapp/whatsapp-number-integration---onboarding',
  meta_business_url: 'https://business.facebook.com/',
  support_url: 'https://calendly.com/onbording-msg91/20-min-onbording',
  requires_msg91_login: true,
  requires_meta_verification: true,
  embed_mode: 'iframe',
};

const WHATSAPP_ONBOARDING_VIEWS = {
  msg91: {
    label: 'MSG91 Portal',
    description: 'Sign in to MSG91, then open WhatsApp setup for this business number.',
    icon: Blocks,
  },
  meta: {
    label: 'Meta Business',
    description: 'Complete Meta Business and WhatsApp number verification when MSG91 asks for it.',
    icon: Building2,
  },
  guide: {
    label: 'Setup Guide',
    description: 'Keep the official onboarding guide open inside GymVault while you work through verification.',
    icon: FileText,
  },
};

const normalizeWhatsAppOnboardingConfig = (value) => ({
  ...DEFAULT_WHATSAPP_ONBOARDING,
  ...(value && typeof value === 'object' ? value : {}),
});

const getWhatsAppOnboardingUrl = (view, onboardingConfig = DEFAULT_WHATSAPP_ONBOARDING) => {
  if (view === 'meta') return onboardingConfig.meta_business_url || DEFAULT_WHATSAPP_ONBOARDING.meta_business_url;
  if (view === 'guide') return onboardingConfig.guide_url || DEFAULT_WHATSAPP_ONBOARDING.guide_url;
  return onboardingConfig.launch_url || onboardingConfig.login_url || DEFAULT_WHATSAPP_ONBOARDING.launch_url;
};

  let razorpayScriptPromise = null;

const loadRazorpayScript = () => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      return Promise.resolve(true);
    }

    if (razorpayScriptPromise) {
      return razorpayScriptPromise;
    }

    razorpayScriptPromise = new Promise((resolve) => {
      const existingScript = document.querySelector('script[data-razorpay-checkout="true"]');
      if (existingScript) {
        if (existingScript.getAttribute('data-loaded') === 'true') {
          resolve(true);
          return;
        }

        existingScript.addEventListener('load', () => resolve(true), { once: true });
        existingScript.addEventListener('error', () => {
          razorpayScriptPromise = null;
          resolve(false);
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.setAttribute('data-razorpay-checkout', 'true');
      script.onload = () => {
        script.setAttribute('data-loaded', 'true');
        resolve(true);
      };
      script.onerror = () => {
        razorpayScriptPromise = null;
        script.remove();
        resolve(false);
      };
      document.body.appendChild(script);
    });

    return razorpayScriptPromise;
};

// FIX: Added defaultTab to the props here!
  const SettingsPage = ({ appRuntime, defaultTab, isActive = false }) => { 
    const { toast, token, currentUser = null } = appRuntime;
  const [razorpayKey, setRazorpayKey] = useState('');
  const isOwner = String(currentUser?.role || '').toUpperCase() === 'OWNER';
  
  const [activeTab, setActiveTab] = useState(() => normalizeSettingsTab(defaultTab));
  const [mobileMenuVisible, setMobileMenuVisible] = useState(() => {
    const normalized = String(defaultTab || '').trim().toLowerCase();
    return !normalized || normalized === 'menu';
  });
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) || TABS[0];

  useEffect(() => {
      const normalized = String(defaultTab || '').trim().toLowerCase();
      if (!normalized || normalized === 'menu') {
          setMobileMenuVisible(true);
          return;
      }

      setActiveTab(normalizeSettingsTab(defaultTab));
      setMobileMenuVisible(false);
  }, [defaultTab]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const invoiceStorageKey = `gv_invoice_${token?.slice(-12) || 'default'}`;
  const [localInvoice, setLocalInvoiceState] = useState(() => {
    try { const s = localStorage.getItem(invoiceStorageKey); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const setLocalInvoice = (inv) => { setLocalInvoiceState(inv); try { if (inv) localStorage.setItem(invoiceStorageKey, JSON.stringify(inv)); else localStorage.removeItem(invoiceStorageKey); } catch (_err) { return null; } };

  const downloadExport = useCallback(async (path, fileName) => {
    try {
      const response = await apiFetch(path, {
        headers: token ? { 'x-auth-token': token } : undefined,
      });

      if (!response.ok) {
        throw new Error(`Export request failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (_err) {
      toast?.('Export failed', 'error');
    }
  }, [toast, token]);
  
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [autoRenew, setAutoRenew] = useState(true);

  // Fetch Razorpay public key from backend (avoids need for VITE_ build-time env var)
  useEffect(() => {
    if (!token || !isActive || !isOwner) return;
    axios.get('/api/billing/config', { headers: { 'x-auth-token': token } })
      .then(res => setRazorpayKey(res.data.razorpay_key_id || ''))
      .catch(() => { setRazorpayKey(''); });
  }, [token, isActive, isOwner]);

  const fileInputRef = useRef(null); 
  const [profileImage, setProfileImage] = useState(null); 
  const [previewUrl, setPreviewUrl] = useState(null); 
  const [removeProfileImage, setRemoveProfileImage] = useState(false);

  const [accountData, setAccountData] = useState({ 
    full_name: '', email: '', phone: '', 
    current_password: '', new_password: '', confirm_password: '' 
  });
  
  const [gymData, setGymData] = useState({ 
    name: '', phone: '', email: '', address: '', 
    currency: '₹', timezone: 'Asia/Kolkata', tax_id: '', website: '',
    saas_status: 'FREE_TRIAL', saas_valid_until: '', current_plan: 'pro', saas_billing_cycle: 'monthly', grace_period_days: 3
  });

  const [usageData, setUsageData] = useState({
      members: 0,
      staff: 1,
      storage: 0.1
  });

  const [integSubTab, setIntegSubTab] = useState('payments');
  const [expandedTemplate, setExpandedTemplate] = useState(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformData, setPlatformData] = useState({
    city: '',
    branches_count: 1,
    branch_directory: buildBranchDirectoryState(1),
    api_keys: [],
    webhooks: [],
    whatsapp_delivery: {
      callback_url: '',
      docs_url: '',
      webhook_token_configured: false,
      summary: {
        total_count: 0,
        in_flight_count: 0,
        delivered_count: 0,
        read_count: 0,
        failed_count: 0,
      },
      recent_logs: [],
    },
  });
  const [apiKeyForm, setApiKeyForm] = useState({ key_name: '', scopes: ['members:read'] });
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [revealedApiKey, setRevealedApiKey] = useState('');
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [copiedDeliveryCallback, setCopiedDeliveryCallback] = useState(false);
  const [deliveryLogFilter, setDeliveryLogFilter] = useState('ALL');
  const [webhookForm, setWebhookForm] = useState(() => createWebhookDraft());
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookTestingId, setWebhookTestingId] = useState(null);
  const [importForm, setImportForm] = useState({ csv_text: IMPORT_SAMPLE_CSV, dry_run: true });
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [connectingGateway, setConnectingGateway] = useState(false);
  const [disconnectingGateway, setDisconnectingGateway] = useState(false);
  const [showLinkedAccountForm, setShowLinkedAccountForm] = useState(false);
  const [linkedAccountSaving, setLinkedAccountSaving] = useState(false);
  const [linkedAccountForm, setLinkedAccountForm] = useState({
    account_id: '',
  });
  const [integrationData, setIntegrationData] = useState({
    owner_mobile: '',
    whatsapp_number: '',
    whatsapp_display_name: '',
    whatsapp_category: '',
    whatsapp_status: 'NOT_CONFIGURED',
    whatsapp_connected_at: null,
    whatsapp_last_checked_at: null,
    whatsapp_last_error: '',
    whatsapp_templates_status: 'NOT_SYNCED',
    whatsapp_templates_last_synced_at: null,
    gateway_connected: false,
    whatsapp_mode: 'NOT_CONFIGURED',
    whatsapp_ready: false,
    platform_otp_ready: true,
    platform_otp_mode: 'preview',
    approved_template_count: 0,
    sms_ready: false,
    bulk_enabled: false,
    bulk_monthly_limit: 500,
    bulk_per_campaign_limit: 50,
    bulk_channels: { whatsapp: true, sms: false },
    monthly_usage: 0,
    monthly_remaining: 500,
    templates: DEFAULT_MESSAGE_TEMPLATES,
    member_payments: {
      enabled: true,
      connect_mode: 'MANUAL',
      onboarding_status: 'NOT_CONNECTED',
      connected_account_id: '',
      connected_at: null,
      razorpay_key_id: '',
      razorpay_key_secret: '',
      has_razorpay_secret: false,
      upi_id: '',
    },
  });
  const [integrationTest, setIntegrationTest] = useState({
    to: '',
    template_key: '',
  });
  const [whatsappOnboarding, setWhatsAppOnboarding] = useState(DEFAULT_WHATSAPP_ONBOARDING);
  const [whatsappOnboardingOpen, setWhatsAppOnboardingOpen] = useState(false);
  const [whatsappOnboardingView, setWhatsAppOnboardingView] = useState('msg91');
  const [whatsappOnboardingLaunching, setWhatsAppOnboardingLaunching] = useState(false);
  const [whatsappOnboardingRefreshing, setWhatsAppOnboardingRefreshing] = useState(false);
  const [whatsappOnboardingFrameLoading, setWhatsAppOnboardingFrameLoading] = useState(false);
  const [whatsappOnboardingFrameKey, setWhatsAppOnboardingFrameKey] = useState(0);
  const [whatsappNumberEditorOpen, setWhatsAppNumberEditorOpen] = useState(false);

  const [interfacePreferences, setInterfacePreferences] = useState({
    reduce_motion: false,
    compact_mode: false,
    dark_mode: true,
  });
  const [twoFactor, setTwoFactor] = useState(false);
  const [staffMembers, setStaffMembers] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [addingStaff, setAddingStaff] = useState(false);
  const [savingStaffId, setSavingStaffId] = useState(null);
  const [resettingPasswordId, setResettingPasswordId] = useState(null);
  const [staffForm, setStaffForm] = useState({
    full_name: '',
    email: '',
    password: '',
    staff_role: 'TRAINER',
  });
  const [staffPasswordReset, setStaffPasswordReset] = useState({});

  const headers = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);
  const activeWhatsAppOnboardingView = WHATSAPP_ONBOARDING_VIEWS[whatsappOnboardingView] || WHATSAPP_ONBOARDING_VIEWS.msg91;
  const activeWhatsAppOnboardingUrl = getWhatsAppOnboardingUrl(whatsappOnboardingView, whatsappOnboarding);
  const isWhatsAppConnected = String(integrationData.whatsapp_status || '').toUpperCase() === 'CONNECTED';
  const resolvedWhatsAppDisplayName = integrationData.whatsapp_display_name || (isWhatsAppConnected ? 'Managed in MSG91 portal' : 'Waiting for MSG91 sync');
  const resolvedWhatsAppCategory = integrationData.whatsapp_category || (isWhatsAppConnected ? 'Managed in MSG91 portal' : 'Not available yet');
  const recentDeliveryLogs = Array.isArray(platformData.whatsapp_delivery?.recent_logs) ? platformData.whatsapp_delivery.recent_logs : [];
  const visibleDeliveryLogs = recentDeliveryLogs.filter((log) => {
    if (deliveryLogFilter === 'ALL') return true;
    return String(log?.current_status || '').trim().toUpperCase() === deliveryLogFilter;
  });
  const activeDeliveryFilterLabel = DELIVERY_LOG_FILTERS.find((option) => option.value === deliveryLogFilter)?.label || 'All';

  useEffect(() => {
    setWhatsAppNumberEditorOpen(!isWhatsAppConnected);
  }, [isWhatsAppConnected]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings', headers);
      
      if (res.data.account) {
          setAccountData(prev => ({ 
            ...prev, 
            full_name: res.data.account.full_name || prev.full_name, 
            email: res.data.account.email || prev.email,
            phone: res.data.account.phone || prev.phone
          }));
          if (res.data.account.profile_pic) {
              setPreviewUrl(normalizeProfileImageUrl(res.data.account.profile_pic));
          } else {
            setPreviewUrl(null);
          }
          setRemoveProfileImage(false);
      }

      if (res.data.gym) {
          setGymData(prev => ({
            ...prev,
            name: res.data.gym.name || prev.name,
            phone: res.data.gym.phone || prev.phone,
            address: res.data.gym.address || prev.address,
            currency: res.data.gym.currency || prev.currency,
            timezone: res.data.gym.timezone || prev.timezone,
            tax_id: res.data.gym.tax_id || prev.tax_id,
            website: res.data.gym.website || prev.website,
            email: res.data.gym.support_email || prev.email,
            saas_status: res.data.gym.saas_status || 'FREE_TRIAL',
            saas_valid_until: res.data.gym.saas_valid_until || '',
            current_plan: res.data.gym.current_plan || 'pro',
            saas_billing_cycle: res.data.gym.saas_billing_cycle || 'monthly',
            grace_period_days: Number(res.data.gym.grace_period_days || prev.grace_period_days || 3)
          }));

          const nextInterfacePreferences = {
            reduce_motion: Boolean(res.data.gym.interface_reduce_motion),
            compact_mode: Boolean(res.data.gym.interface_compact_mode),
            dark_mode: Boolean(res.data.gym.interface_dark_mode ?? true),
          };
          setInterfacePreferences(nextInterfacePreferences);
          applyInterfacePreferences(nextInterfacePreferences);
          saveInterfacePreferencesLocal(nextInterfacePreferences);
          
          if (res.data.gym.saas_billing_cycle) {
              setBillingCycle(res.data.gym.saas_billing_cycle);
          }
      }

      if (res.data.usage) {
          setUsageData(res.data.usage);
      }

    } catch (err) {
      reportClientError('Settings fetch', err);
      toast("Failed to load settings. Please check backend terminal.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [headers, toast]);

  useEffect(() => {
    if (!token || !isActive || !isOwner) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchSettings();
  }, [fetchSettings, isActive, isOwner, token]);

  const fetchStaff = useCallback(async () => {
    if (!token) return;
    setLoadingStaff(true);
    try {
      const res = await axios.get('/api/users/staff', headers);
      setStaffMembers(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to load staff members.', 'error');
    } finally {
      setLoadingStaff(false);
    }
  }, [headers, toast, token]);

  useEffect(() => {
    if (!isActive || !isOwner) return;
    if (activeTab === 'staff') {
      fetchStaff();
    }
  }, [activeTab, fetchStaff, isActive, isOwner]);

  const loadIntegrations = useCallback(async () => {
    if (!token) return;
    setIntegrationLoading(true);
    try {
      const res = await axios.get('/api/settings/integrations', headers);
      const payload = res.data || {};
      const templateMap = new Map((payload.templates || []).map((item) => [item.template_key, item]));
      const normalizedTemplates = DEFAULT_MESSAGE_TEMPLATES.map((fallback) => ({
        ...fallback,
        ...(templateMap.get(fallback.template_key) || {}),
      }));

      setIntegrationData((prev) => ({
        ...prev,
        owner_mobile: payload.owner_mobile || gymData.phone || '',
        whatsapp_number: payload.whatsapp_number || '',
        whatsapp_display_name: payload.whatsapp_display_name || '',
        whatsapp_category: payload.whatsapp_category || '',
        whatsapp_status: String(payload.whatsapp_status || payload.whatsapp_mode || 'NOT_CONFIGURED').toUpperCase(),
        whatsapp_connected_at: payload.whatsapp_connected_at || null,
        whatsapp_last_checked_at: payload.whatsapp_last_checked_at || null,
        whatsapp_last_error: payload.whatsapp_last_error || '',
        whatsapp_templates_status: String(payload.whatsapp_templates_status || 'NOT_SYNCED').toUpperCase(),
        whatsapp_templates_last_synced_at: payload.whatsapp_templates_last_synced_at || null,
        gateway_connected: Boolean(payload.gateway_connected),
        whatsapp_mode: String(payload.whatsapp_mode || 'NOT_CONFIGURED').toUpperCase(),
        whatsapp_ready: Boolean(payload.whatsapp_ready),
        platform_otp_ready: Boolean(payload.platform_otp_ready ?? true),
        platform_otp_mode: String(payload.platform_otp_mode || 'preview').toLowerCase(),
        approved_template_count: Number(payload.approved_template_count || 0),
        sms_ready: Boolean(payload.sms_ready),
        bulk_enabled: Boolean(payload.bulk_enabled),
        bulk_monthly_limit: Number(payload.bulk_monthly_limit || 500),
        bulk_per_campaign_limit: Number(payload.bulk_per_campaign_limit || 50),
        bulk_channels: payload.bulk_channels || { whatsapp: true, sms: false },
        monthly_usage: Number(payload.monthly_usage || 0),
        monthly_remaining: Number(payload.monthly_remaining || 0),
        templates: normalizedTemplates,
        member_payments: {
          enabled: Boolean(payload.member_payments?.enabled),
          connect_mode: String(payload.member_payments?.connect_mode || 'MANUAL').toUpperCase(),
          onboarding_status: String(payload.member_payments?.onboarding_status || 'NOT_CONNECTED').toUpperCase(),
          connected_account_id: String(payload.member_payments?.connected_account_id || ''),
          connected_at: payload.member_payments?.connected_at || null,
          razorpay_key_id: String(payload.member_payments?.razorpay_key_id || ''),
          razorpay_key_secret: '',
          has_razorpay_secret: Boolean(payload.member_payments?.has_razorpay_secret),
          upi_id: String(payload.member_payments?.upi_id || ''),
        },
      }));
      setWhatsAppOnboarding(normalizeWhatsAppOnboardingConfig(payload.whatsapp_onboarding));

      setIntegrationTest((prev) => ({
        ...prev,
        template_key: prev.template_key || normalizedTemplates.find((item) => item.is_active !== false && normalizeTemplateSyncStatus(item.whatsapp_template_status) === 'APPROVED')?.template_key || '',
      }));
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to load integration settings.', 'error');
    } finally {
      setIntegrationLoading(false);
    }
  }, [gymData.phone, headers, token, toast]);

  const loadPlatform = useCallback(async () => {
    if (!token) return;
    setPlatformLoading(true);
    try {
      const res = await axios.get('/api/settings/platform', headers);
      const payload = res.data || {};
      const branchesCount = Math.max(1, Math.min(25, Number.parseInt(payload.branches_count, 10) || 1));
      setPlatformData({
        city: String(payload.city || ''),
        branches_count: branchesCount,
        branch_directory: buildBranchDirectoryState(branchesCount, Array.isArray(payload.branch_directory) ? payload.branch_directory : []),
        api_keys: Array.isArray(payload.api_keys) ? payload.api_keys : [],
        webhooks: Array.isArray(payload.webhooks) ? payload.webhooks : [],
        whatsapp_delivery: {
          callback_url: String(payload.whatsapp_delivery?.callback_url || ''),
          docs_url: String(payload.whatsapp_delivery?.docs_url || ''),
          webhook_token_configured: Boolean(payload.whatsapp_delivery?.webhook_token_configured),
          summary: {
            total_count: Number(payload.whatsapp_delivery?.summary?.total_count || 0),
            in_flight_count: Number(payload.whatsapp_delivery?.summary?.in_flight_count || 0),
            delivered_count: Number(payload.whatsapp_delivery?.summary?.delivered_count || 0),
            read_count: Number(payload.whatsapp_delivery?.summary?.read_count || 0),
            failed_count: Number(payload.whatsapp_delivery?.summary?.failed_count || 0),
          },
          recent_logs: Array.isArray(payload.whatsapp_delivery?.recent_logs) ? payload.whatsapp_delivery.recent_logs : [],
        },
      });
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to load platform settings.', 'error');
    } finally {
      setPlatformLoading(false);
    }
  }, [headers, token, toast]);

  useEffect(() => {
    if (!isActive || !isOwner) return;
    if (activeTab === 'integrations') {
      loadIntegrations();
      loadPlatform();
    }
  }, [activeTab, isActive, isOwner, loadIntegrations, loadPlatform]);

  const updateBranchCount = (value) => {
    const nextCount = Math.max(1, Math.min(25, Number.parseInt(value, 10) || 1));
    setPlatformData((prev) => ({
      ...prev,
      branches_count: nextCount,
      branch_directory: buildBranchDirectoryState(nextCount, prev.branch_directory),
    }));
  };

  const updateBranchField = (branchIndex, field, value) => {
    setPlatformData((prev) => ({
      ...prev,
      branch_directory: prev.branch_directory.map((branch, index) => index === branchIndex ? { ...branch, [field]: value } : branch),
    }));
  };

  const saveBranchControls = async () => {
    setPlatformSaving(true);
    try {
      const res = await axios.put('/api/settings/platform/branches', {
        city: platformData.city,
        branches_count: platformData.branches_count,
        branch_directory: platformData.branch_directory,
      }, headers);
      const payload = res.data || {};
      setPlatformData((prev) => ({
        ...prev,
        city: String(payload.city || ''),
        branches_count: Math.max(1, Math.min(25, Number.parseInt(payload.branches_count, 10) || prev.branches_count)),
        branch_directory: buildBranchDirectoryState(payload.branches_count || prev.branches_count, payload.branch_directory || prev.branch_directory),
      }));
      toast(payload.message || 'Branch controls saved successfully.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to save branch controls.', 'error');
    } finally {
      setPlatformSaving(false);
    }
  };

  const toggleApiScope = (scope) => {
    setApiKeyForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((entry) => entry !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const copyApiKeyToClipboard = async () => {
    if (!revealedApiKey) return;
    try {
      await navigator.clipboard.writeText(revealedApiKey);
      setCopiedApiKey(true);
      window.setTimeout(() => setCopiedApiKey(false), 1500);
      toast('API key copied to clipboard.', 'success');
    } catch {
      toast('Failed to copy API key. Copy it manually.', 'warning');
    }
  };

  const copyDeliveryCallbackToClipboard = async () => {
    const callbackUrl = String(platformData.whatsapp_delivery?.callback_url || '').trim();
    if (!callbackUrl) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopiedDeliveryCallback(true);
      window.setTimeout(() => setCopiedDeliveryCallback(false), 1500);
      toast('WhatsApp callback URL copied.', 'success');
    } catch {
      toast('Failed to copy callback URL. Copy it manually.', 'warning');
    }
  };

  const createApiKey = async () => {
    if (!apiKeyForm.key_name.trim()) {
      toast('API key name is required.', 'warning');
      return;
    }
    if (apiKeyForm.scopes.length === 0) {
      toast('Select at least one API scope.', 'warning');
      return;
    }
    setApiKeySaving(true);
    try {
      const res = await axios.post('/api/settings/platform/api-keys', apiKeyForm, headers);
      setPlatformData((prev) => ({
        ...prev,
        api_keys: [res.data.api_key, ...prev.api_keys],
      }));
      setRevealedApiKey(String(res.data.plain_text_key || ''));
      setCopiedApiKey(false);
      setApiKeyForm({ key_name: '', scopes: ['members:read'] });
      toast(res.data?.message || 'API key created.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to create API key.', 'error');
    } finally {
      setApiKeySaving(false);
    }
  };

  const revokeApiKey = async (id) => {
    if (!window.confirm('Revoke this API key? Existing clients using it will stop working.')) return;
    try {
      await axios.delete(`/api/settings/platform/api-keys/${id}`, headers);
      setPlatformData((prev) => ({
        ...prev,
        api_keys: prev.api_keys.map((key) => key.id === id ? { ...key, is_active: false } : key),
      }));
      toast('API key revoked.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to revoke API key.', 'error');
    }
  };

  const toggleWebhookEvent = (eventName) => {
    setWebhookForm((prev) => ({
      ...prev,
      events: prev.events.includes(eventName)
        ? prev.events.filter((entry) => entry !== eventName)
        : [...prev.events, eventName],
    }));
  };

  const editWebhook = (webhook) => {
    setWebhookForm({
      id: webhook.id,
      url: webhook.url || '',
      events: Array.isArray(webhook.events) ? webhook.events : [],
      secret: '',
      is_active: webhook.is_active !== false,
    });
  };

  const resetWebhookForm = () => {
    setWebhookForm(createWebhookDraft());
  };

  const saveWebhook = async () => {
    if (!webhookForm.url.trim()) {
      toast('Webhook URL is required.', 'warning');
      return;
    }
    if (webhookForm.events.length === 0) {
      toast('Select at least one webhook event.', 'warning');
      return;
    }
    setWebhookSaving(true);
    try {
      const payload = {
        url: webhookForm.url,
        events: webhookForm.events,
        secret: webhookForm.secret,
        is_active: webhookForm.is_active,
      };
      if (webhookForm.id) {
        const res = await axios.put(`/api/settings/platform/webhooks/${webhookForm.id}`, payload, headers);
        setPlatformData((prev) => ({
          ...prev,
          webhooks: prev.webhooks.map((webhook) => webhook.id === webhookForm.id ? res.data.webhook : webhook),
        }));
        toast(res.data?.message || 'Webhook updated successfully.', 'success');
      } else {
        const res = await axios.post('/api/settings/platform/webhooks', payload, headers);
        setPlatformData((prev) => ({
          ...prev,
          webhooks: [res.data.webhook, ...prev.webhooks],
        }));
        toast(res.data?.message || 'Webhook created successfully.', 'success');
      }
      resetWebhookForm();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to save webhook.', 'error');
    } finally {
      setWebhookSaving(false);
    }
  };

  const deleteWebhook = async (id) => {
    if (!window.confirm('Delete this webhook endpoint?')) return;
    try {
      await axios.delete(`/api/settings/platform/webhooks/${id}`, headers);
      setPlatformData((prev) => ({
        ...prev,
        webhooks: prev.webhooks.filter((webhook) => webhook.id !== id),
      }));
      if (webhookForm.id === id) {
        resetWebhookForm();
      }
      toast('Webhook deleted.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to delete webhook.', 'error');
    }
  };

  const testWebhook = async (id) => {
    setWebhookTestingId(id);
    try {
      const res = await axios.post(`/api/settings/platform/webhooks/${id}/test`, {}, headers);
      toast(res.data?.message || 'Webhook test sent.', 'success');
      loadPlatform();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to send webhook test.', 'error');
    } finally {
      setWebhookTestingId(null);
    }
  };

  const importMembers = async (dryRun) => {
    if (!String(importForm.csv_text || '').trim()) {
      toast('Paste CSV data before importing.', 'warning');
      return;
    }
    setImportSubmitting(true);
    try {
      const res = await axios.post('/api/settings/import/members', {
        csv_text: importForm.csv_text,
        dry_run: dryRun,
      }, headers);
      setImportForm((prev) => ({ ...prev, dry_run: dryRun }));
      setImportResult(res.data || null);
      if (!dryRun && Number(res.data?.imported_count || 0) > 0) {
        fetchSettings();
      }
      toast(res.data?.message || (dryRun ? 'Import preview generated.' : 'Members imported.'), 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to process member import.', 'error');
    } finally {
      setImportSubmitting(false);
    }
  };

  const handleIntegrationSave = async (e) => {
    e.preventDefault();
    setIntegrationSaving(true);
    try {
      const res = await saveIntegrationSection(integSubTab);
      toast(res.data?.message || 'Integration settings saved successfully.', 'success');
      await loadIntegrations();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to save integration settings.', 'error');
    } finally {
      setIntegrationSaving(false);
    }
  };

  const handleTestMessage = async (e) => {
    e.preventDefault();
    if (!integrationTest.to.trim()) {
      toast('Test recipient is required.', 'warning');
      return;
    }

    setTestSending(true);
    try {
      const res = await axios.post('/api/settings/integrations/test-message', integrationTest, headers);
      toast(res.data?.message || 'Test message sent.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to send test message.', 'error');
    } finally {
      setTestSending(false);
    }
  };

  function saveIntegrationSection(saveScope = integSubTab) {
    const normalizedScope = ['payments', 'messaging', 'campaigns', 'all'].includes(String(saveScope || '').trim().toLowerCase())
      ? String(saveScope || '').trim().toLowerCase()
      : 'all';

    const payload = { save_scope: normalizedScope };

    if (normalizedScope === 'messaging' || normalizedScope === 'all') {
      payload.owner_mobile = integrationData.owner_mobile;
      payload.whatsapp_number = integrationData.whatsapp_number;
    }

    if (normalizedScope === 'campaigns' || normalizedScope === 'all') {
      payload.bulk_enabled = integrationData.bulk_enabled;
      payload.bulk_monthly_limit = integrationData.bulk_monthly_limit;
      payload.bulk_per_campaign_limit = integrationData.bulk_per_campaign_limit;
      payload.bulk_channels = integrationData.bulk_channels;
      payload.templates = integrationData.templates;
    }

    if (normalizedScope === 'payments' || normalizedScope === 'all') {
      payload.member_payments = {
        enabled: Boolean(integrationData.member_payments?.enabled),
        connect_mode: String(integrationData.member_payments?.connect_mode || 'MANUAL').toUpperCase(),
        razorpay_key_id: String(integrationData.member_payments?.razorpay_key_id || '').trim(),
        razorpay_key_secret: String(integrationData.member_payments?.razorpay_key_secret || '').trim(),
        has_razorpay_secret: Boolean(integrationData.member_payments?.has_razorpay_secret),
        upi_id: String(integrationData.member_payments?.upi_id || '').trim(),
      };
    }

    return axios.put('/api/settings/integrations', payload, headers);
  }

  const switchWhatsAppOnboardingView = (nextView) => {
    setWhatsAppOnboardingView(nextView);
    setWhatsAppOnboardingFrameLoading(true);
    setWhatsAppOnboardingFrameKey((prev) => prev + 1);
  };

  const openWhatsAppOnboardingPopup = () => {
    const popup = window.open(activeWhatsAppOnboardingUrl, 'gymvault_whatsapp_onboarding', 'width=1280,height=840');
    if (!popup) {
      window.location.assign(activeWhatsAppOnboardingUrl);
      return;
    }

    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(poll);
      loadIntegrations();
    }, 700);
  };

  const handleLaunchWhatsAppOnboarding = async () => {
    if (!String(integrationData.whatsapp_number || '').trim()) {
      toast('Enter the gym business WhatsApp number first.', 'warning');
      return;
    }

    setWhatsAppOnboardingLaunching(true);
    try {
      const res = await saveIntegrationSection('messaging');
      await loadIntegrations();
      setWhatsAppOnboardingOpen(true);
      switchWhatsAppOnboardingView('msg91');
      toast(res.data?.message || 'Business number saved. Continue setup in the in-app WhatsApp workspace.', 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to start WhatsApp onboarding.', 'error');
    } finally {
      setWhatsAppOnboardingLaunching(false);
    }
  };

  const handleRefreshWhatsAppOnboarding = async () => {
    setWhatsAppOnboardingRefreshing(true);
    try {
      await loadIntegrations();
    } finally {
      setWhatsAppOnboardingRefreshing(false);
    }
  };

  const handleConnectRazorpay = async () => {
    setConnectingGateway(true);
    try {
      const res = await axios.get('/api/memberships/online/connect-url', headers);
      const connectUrl = String(res.data?.connect_url || '').trim();
      if (!connectUrl) {
        toast('Failed to prepare Razorpay connect URL.', 'error');
        return;
      }

      const popup = window.open(connectUrl, 'razorpay_connect', 'width=540,height=760');
      if (!popup) {
        window.location.href = connectUrl;
        return;
      }

      const poll = setInterval(async () => {
        if (popup.closed) {
          clearInterval(poll);
          await loadIntegrations();
        }
      }, 1200);

      toast('Complete onboarding on Razorpay page. Status will auto-refresh after closing.', 'info');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to start Razorpay onboarding.', 'error');
    } finally {
      setConnectingGateway(false);
    }
  };

  const handleDisconnectRazorpay = async () => {
    setDisconnectingGateway(true);
    try {
      await axios.post('/api/memberships/online/connect/disconnect', {}, headers);
      toast('Razorpay connection removed.', 'success');
      await loadIntegrations();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to disconnect Razorpay.', 'error');
    } finally {
      setDisconnectingGateway(false);
    }
  };

  const handleCreateLinkedAccount = async () => {
    const accountId = String(linkedAccountForm.account_id || '').trim();
    if (!accountId.startsWith('acc_')) {
      toast('Please enter a valid Razorpay Account ID starting with acc_', 'warning');
      return;
    }
    setLinkedAccountSaving(true);
    try {
      const res = await axios.post('/api/memberships/online/linked-account/save', { account_id: accountId }, headers);
      toast(res.data?.message || 'Razorpay account connected!', 'success');
      setShowLinkedAccountForm(false);
      setLinkedAccountForm({ account_id: '' });
      await loadIntegrations();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to connect account.', 'error');
    } finally {
      setLinkedAccountSaving(false);
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!staffForm.full_name.trim() || !staffForm.email.trim() || !staffForm.password.trim()) {
      toast('All staff fields are required.', 'warning');
      return;
    }
    if (staffForm.password.length < 8) {
      toast('Password must be at least 8 characters.', 'warning');
      return;
    }

    setAddingStaff(true);
    try {
      await axios.post('/api/users/staff', staffForm, headers);
      toast('Staff member created successfully.', 'success');
      setStaffForm({ full_name: '', email: '', password: '', staff_role: 'TRAINER' });
      fetchStaff();
      setUsageData((prev) => ({ ...prev, staff: Number(prev.staff || 0) + 1 }));
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to add staff member.', 'error');
    } finally {
      setAddingStaff(false);
    }
  };

  const toggleStaffStatus = async (staff) => {
    setSavingStaffId(staff.id);
    try {
      await axios.put(`/api/users/staff/${staff.id}`, {
        full_name: staff.full_name,
        staff_role: staff.staff_role || 'STAFF',
        is_active: !staff.is_active,
        permissions: staff.permissions,
      }, headers);
      toast(`Staff ${!staff.is_active ? 'activated' : 'deactivated'} successfully.`, 'success');
      fetchStaff();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to update staff status.', 'error');
    } finally {
      setSavingStaffId(null);
    }
  };

  const updateStaffRole = async (staff, nextRole) => {
    setSavingStaffId(staff.id);
    try {
      await axios.put(`/api/users/staff/${staff.id}`, {
        full_name: staff.full_name,
        staff_role: nextRole,
        is_active: staff.is_active,
        permissions: [],
      }, headers);
      toast('Staff role updated.', 'success');
      fetchStaff();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to update staff role.', 'error');
    } finally {
      setSavingStaffId(null);
    }
  };

  const resetStaffPassword = async (staffId) => {
    const newPassword = String(staffPasswordReset[staffId] || '').trim();
    if (newPassword.length < 8) {
      toast('New password must be at least 8 characters.', 'warning');
      return;
    }

    setResettingPasswordId(staffId);
    try {
      await axios.post(`/api/users/staff/${staffId}/reset-password`, { new_password: newPassword }, headers);
      toast('Staff password reset successfully.', 'success');
      setStaffPasswordReset((prev) => ({ ...prev, [staffId]: '' }));
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to reset password.', 'error');
    } finally {
      setResettingPasswordId(null);
    }
  };

  // --- SMART TIME-AWARE STATUS CALCULATOR ---
  // This reads the clock directly to enforce lockouts instantly, even if backend text hasn't updated yet.
  const getBillingWindow = () => {
      const graceDays = Math.max(0, Number(gymData.grace_period_days || 3));
      if (!gymData.saas_valid_until) {
        const fallbackStatus = gymData.saas_status === 'EXPIRED' ? 'EXPIRED' : 'FREE_TRIAL';
        return { status: fallbackStatus, daysUntilExpiry: null, graceDays, isExpiringSoon: false, expiresToday: false, graceDaysRemaining: graceDays };
      }

      const expiry = new Date(gymData.saas_valid_until);
      if (Number.isNaN(expiry.getTime())) {
        const fallbackStatus = gymData.saas_status === 'EXPIRED' ? 'EXPIRED' : 'FREE_TRIAL';
        return { status: fallbackStatus, daysUntilExpiry: null, graceDays, isExpiringSoon: false, expiresToday: false, graceDaysRemaining: graceDays };
      }

      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
      const dayMs = 1000 * 60 * 60 * 24;
      const daysUntilExpiry = Math.round((expiryDay.getTime() - todayStart.getTime()) / dayMs);

      let status = 'ACTIVE';
      if (gymData.saas_status === 'EXPIRED' || daysUntilExpiry < -graceDays) status = 'EXPIRED';
      else if (daysUntilExpiry < 0) status = 'GRACE_PERIOD';
      else if (gymData.saas_status === 'FREE_TRIAL') status = 'FREE_TRIAL';

      return {
        status,
        daysUntilExpiry,
        graceDays,
        isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 1,
        expiresToday: daysUntilExpiry === 0,
        graceDaysRemaining: daysUntilExpiry < 0 ? Math.max(0, graceDays + daysUntilExpiry) : graceDays,
      };
  };

  const billingWindow = getBillingWindow();
  const realStatus = billingWindow.status;
  const isLockedOut = realStatus === 'EXPIRED';

  // Force Tab to Billing if Locked Out
  useEffect(() => {
      if (isLockedOut && activeTab !== 'billing') {
          setActiveTab('billing');
          setMobileMenuVisible(false);
      }
  }, [isLockedOut, activeTab]);

  const groupedTabs = SETTINGS_GROUPS.map((group) => ({
    group,
    items: TABS.filter((tab) => tab.group === group),
  }));

  const openTab = (tabId) => {
    setActiveTab(tabId);
    setMobileMenuVisible(false);
  };

  const generateSaaSInvoice = (invoice) => {
    if (!invoice) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>GymVault Invoice - ${invoice.id}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; background: #f8fafc; }
            .receipt-box { background: white; border: 1px solid #e2e8f0; padding: 40px; border-radius: 24px; max-width: 500px; margin: auto; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
            .logo { font-size: 28px; font-weight: 900; text-align: center; color: #0f172a; margin-bottom: 5px; }
            .sub-logo { font-size: 10px; font-weight: 700; text-align: center; color: #6366f1; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 30px; }
            .divider { border-top: 2px dashed #e2e8f0; margin: 20px 0; }
            .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; }
            .label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; }
            .value { font-weight: 700; color: #0f172a; font-size: 14px; }
            .total-row { background: #f1f5f9; padding: 20px; border-radius: 12px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; }
            .footer { text-align: center; margin-top: 30px; font-size: 10px; color: #94a3b8; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="receipt-box">
            <div class="logo">GymVault HQ</div>
            <div class="sub-logo">Official SaaS Subscription Receipt</div>
            <div class="info-row"><span class="label">Date</span><span class="value">${new Date(invoice.date).toLocaleDateString('en-GB')}</span></div>
            <div class="info-row"><span class="label">Billed To</span><span class="value">${gymData.name || accountData.full_name}</span></div>
            ${gymData.tax_id ? `<div class="info-row"><span class="label">GST/Tax ID</span><span class="value">${gymData.tax_id}</span></div>` : ''}
            <div class="info-row"><span class="label">Plan</span><span class="value">${invoice.plan}</span></div>
            <div class="info-row"><span class="label">Transaction ID</span><span class="value" style="font-size: 11px;">${invoice.id}</span></div>
            <div class="divider"></div>
            <div class="total-row">
              <span class="label" style="color: #0f172a; font-size: 14px;">Total Paid</span>
              <span style="font-weight: 900; font-size: 24px; color: #10b981;">&#8377;${invoice.amount}</span>
            </div>
            <div class="footer">This is a computer generated tax invoice and does not require a physical signature.</div>
          </div>
          <script>window.onload = function() { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleResetTest = async () => {
      try {
          const res = await axios.post('/api/billing/reset-test', {}, headers);
          setGymData(prev => ({ ...prev, saas_valid_until: res.data.saas_valid_until }));
          toast('Test timer reset — expires in 1 day.', 'success');
      } catch (err) {
          toast(err?.response?.data?.error || 'Failed to reset test timer.', 'error');
      }
  };

  const handleSubscribe = async (selectedPlan) => {
      setIsProcessingPayment(true);
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
          toast("Razorpay script failed to load. Are you online?", "error");
          setIsProcessingPayment(false);
          return;
      }

      try {
            const orderRes = await axios.post('/api/billing/create-order', {
              plan_tier: selectedPlan.id,
              cycle: billingCycle,
            }, headers);
          
          const order = orderRes.data;
          const checkoutImageUrl = getRazorpayCheckoutImageUrl();

          const options = {
              key: razorpayKey,
              amount: order.amount,
              currency: order.currency,
              name: `GymVault ${selectedPlan.name}`,
              description: `${billingCycle === 'annual' ? 'Annual' : 'Monthly'} Software Subscription`,
              image: checkoutImageUrl,
              order_id: order.id,
              handler: async function (response) {
                  try {
                      // 1. Optimistic UI Update
                      const optDays = selectedPlan.id === 'test' ? 1 : billingCycle === 'annual' ? 365 : 30;
                      setGymData(prev => ({
                          ...prev,
                          saas_status: 'ACTIVE',
                          current_plan: selectedPlan.id,
                          saas_billing_cycle: billingCycle,
                          saas_valid_until: new Date(Date.now() + optDays * 24 * 60 * 60 * 1000).toISOString()
                      }));

                      setLocalInvoice({
                          id: response.razorpay_payment_id,
                          date: new Date().toISOString(),
                          amount: selectedPlan.billed,
                          plan: `GymVault ${selectedPlan.name} (${billingCycle})`
                      });

                      toast(`Successfully upgraded to ${selectedPlan.name}!`, "success");

                      // 2. Save officially to DB
                      await axios.post('/api/billing/verify', {
                          razorpay_order_id: response.razorpay_order_id,
                          razorpay_payment_id: response.razorpay_payment_id,
                          razorpay_signature: response.razorpay_signature,
                          plan_tier: selectedPlan.id,
                          cycle: billingCycle
                      }, headers);

                      setTimeout(() => { fetchSettings(); }, 1500);
                      
                  } catch (err) {
                      reportClientError('Settings billing sync', err);
                      toast("Payment received. System is syncing...", "warning");
                      setTimeout(() => { fetchSettings(); }, 2000);
                  } finally {
                      setIsProcessingPayment(false);
                  }
              },
              prefill: {
                  name: accountData.full_name,
                  email: accountData.email,
                  contact: accountData.phone || gymData.phone
              },
              theme: { color: "#4f46e5" },
              modal: { ondismiss: () => setIsProcessingPayment(false) }
          };

              if (!options.key) {
                toast("Payment gateway is not configured yet. Add Razorpay billing keys on the server.", "error");
                setIsProcessingPayment(false);
                return;
              }

            const paymentObject = new window.Razorpay(options);
            paymentObject.on('payment.failed', function (){
              toast("Payment cancelled or failed.", "error");
              setIsProcessingPayment(false);
          });
          paymentObject.open();

          } catch (_err) {
          toast("Server error while initiating payment.", "error");
          setIsProcessingPayment(false);
      }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfileImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      setRemoveProfileImage(false);
    }
  };

  const handleCombinedSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    const formData = new FormData();
    formData.append('full_name', accountData.full_name);
    formData.append('email', accountData.email);
    formData.append('phone', accountData.phone);
    if (profileImage) formData.append('profile_pic', profileImage);
    if (removeProfileImage && !profileImage) formData.append('remove_profile_pic', 'true');

    if (accountData.new_password) {
        if (accountData.new_password !== accountData.confirm_password) {
            setIsSaving(false);
            return toast('New passwords do not match!', 'error');
        }
        formData.append('current_password', accountData.current_password);
        formData.append('new_password', accountData.new_password);
    }

    try {
      const accountRes = await axios.put('/api/settings/account', formData, {
        headers: { 'x-auth-token': token, 'Content-Type': 'multipart/form-data' }
      });
      await axios.put('/api/settings/gym', gymData, headers);
      if (accountRes.data?.profile_pic) {
        setPreviewUrl(normalizeProfileImageUrl(accountRes.data.profile_pic));
      } else if (removeProfileImage) {
        setPreviewUrl(null);
      }
      toast('Profile & Business details updated successfully!', 'success');
      setAccountData(prev => ({ ...prev, current_password: '', new_password: '', confirm_password: '' })); 
      setProfileImage(null);
      setRemoveProfileImage(false);
    } catch (err) {
      toast(err.response?.data?.error || "Failed to update details", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const persistPreferences = async (successMessage) => {
    setIsSaving(true);
    try {
      await axios.put('/api/settings/preferences', {
        currency: gymData.currency,
        timezone: gymData.timezone,
        interface_reduce_motion: interfacePreferences.reduce_motion,
        interface_compact_mode: interfacePreferences.compact_mode,
        interface_dark_mode: interfacePreferences.dark_mode,
      }, headers);
      applyInterfacePreferences(interfacePreferences);
      saveInterfacePreferencesLocal(interfacePreferences);
      toast(successMessage, 'success');
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to update preferences', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreferencesSave = async (e) => {
    e.preventDefault();
    await persistPreferences('System preferences saved!');
  };

  const handleInterfaceSave = async () => {
    await persistPreferences('Interface preferences saved!');
  };

  const handleDeleteGym = async () => {
    if (deleteConfirm !== 'DELETE') {
      return toast('Please type DELETE to confirm', 'error');
    }
    try {
      await axios.delete('/api/settings/nuke', headers);
      window.location.href = '/login'; 
    } catch (_err) {
      toast("Failed to delete account", "error");
    }
  };

  const formatExpiry = (date) => {
      if (!date || isNaN(new Date(date).getTime())) return 'N/A';
      return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

    const ProgressBar = (props) => {
      const { label, current, max, unit = '' } = props;
      const percentage = max === 'Unlimited' ? 100 : Math.min(100, (current / max) * 100);
      const isNearLimit = max !== 'Unlimited' && percentage > 85;
      return (
          <div className="mb-4 last:mb-0">
              <div className="flex justify-between text-xs font-bold mb-2">
            <span className="flex items-center gap-1.5 text-slate-700"><props.icon size={14} className="text-indigo-500"/> {label}</span>
                  <span className={isNearLimit ? 'text-rose-500' : 'text-slate-500'}>{current} / {max} {unit}</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${max === 'Unlimited' ? 'bg-indigo-500' : isNearLimit ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${percentage}%` }} />
              </div>
          </div>
      )
  };

  if (isLoading) return <PageLoader className="min-h-[56vh]" />;

  return (
    <div className="flex flex-col desktop:flex-row gap-4 desktop:gap-6 desktop:min-h-[calc(var(--app-viewport-height)-7rem)]">
      
      {/* SIDEBAR NAVIGATION */}
      <div className={`w-full md:w-64 flex-shrink-0 ${mobileMenuVisible ? 'flex' : 'hidden'} md:flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar pb-10`}>
        {groupedTabs.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-1">{group}</p>
            {items.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isDanger = tab.id === 'danger';
              const isTabDisabled = isLockedOut && tab.id !== 'billing'; // Lockout logic applied here

              return (
                <button
                  key={tab.id}
                  disabled={isTabDisabled}
                  onClick={() => openTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                    isTabDisabled ? 'opacity-50 cursor-not-allowed grayscale' : ''
                  } ${
                    isActive 
                      ? isDanger ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20' : 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                      : isDanger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                  {isTabDisabled && <Lock size={12} className="ml-auto opacity-50" />}
                  {!isTabDisabled && <ChevronRight size={14} className="ml-auto opacity-45 desktop:hidden" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={`${mobileMenuVisible ? 'hidden' : 'block'} md:block flex-1 bg-white/80 backdrop-blur-xl border border-white/60 rounded-[28px] shadow-sm overflow-y-auto relative custom-scrollbar`}>
        <div className="sticky top-0 z-20 desktop:hidden flex items-center gap-3 px-4 py-4 border-b border-slate-100 bg-white/95 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setMobileMenuVisible(true)}
            className="w-10 h-10 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Settings</p>
            <h2 className="text-base font-black text-slate-900 truncate">{activeTabMeta.label}</h2>
          </div>
        </div>
        <div className="max-w-4xl p-5 sm:p-8 mb-10 mx-auto">
          
          {activeTab === 'account' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Account & Business</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Manage your personal credentials and public gym information.</p>
              
              <form onSubmit={handleCombinedSave} className="space-y-10 max-w-3xl">
                <div className="space-y-6">
                  <h3 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2 border-b border-indigo-50 pb-3">
                    <User size={14} /> Personal Details
                  </h3>
                  <div className="flex items-center gap-6 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                    <div className="relative group cursor-pointer" onClick={() => fileInputRef.current.click()}>
                      <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-3xl font-black shadow-lg shadow-indigo-500/30 overflow-hidden">
                        {previewUrl ? <img src={previewUrl} className="w-full h-full object-cover" alt="Avatar" /> : accountData.full_name ? accountData.full_name.charAt(0).toUpperCase() : 'O'}
                      </div>
                      <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Camera size={20} className="text-white" /></div>
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 mb-1">Profile Avatar</h4>
                      <p className="text-xs font-medium text-slate-500 mb-3">Upload a PNG or JPG, max 5MB.</p>
                      <div className="flex gap-2">
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageSelect} />
                        <button type="button" onClick={() => fileInputRef.current.click()} className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors">Upload New</button>
                        <button type="button" onClick={() => { setPreviewUrl(null); setProfileImage(null); setRemoveProfileImage(true); }} className="px-4 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">Remove</button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 desktop:grid-cols-2 gap-5">
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Owner Name</label><div className="relative"><User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="text" value={accountData.full_name} onChange={e => setAccountData({...accountData, full_name: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Login Email</label><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="email" value={accountData.email} onChange={e => setAccountData({...accountData, email: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Personal Phone</label><div className="relative"><Smartphone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" placeholder="+91 00000 00000" value={accountData.phone} onChange={e => setAccountData({...accountData, phone: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">System Role</label><div className="relative"><ShieldCheck size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500" /><input disabled type="text" value="Super Administrator" className="w-full pl-11 pr-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-indigo-600 cursor-not-allowed" /></div></div>
                  </div>
                </div>

                <div className="space-y-5">
                  <h3 className="text-xs font-black text-rose-500 uppercase tracking-widest flex items-center gap-2 border-b border-rose-50 pb-3"><Fingerprint size={14} /> Security Updates</h3>
                  <div className="grid grid-cols-1 desktop:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Current Password</label><div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="Verify identity" value={accountData.current_password} onChange={e => setAccountData({...accountData, current_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">New Password</label><div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="New password" value={accountData.new_password} onChange={e => setAccountData({...accountData, new_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Confirm Password</label><div className="relative"><CheckCircle size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="Confirm new password" value={accountData.confirm_password} onChange={e => setAccountData({...accountData, confirm_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                  </div>
                </div>

                <div className="space-y-5 pt-2">
                  <h3 className="text-xs font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2 border-b border-emerald-50 pb-3"><Building2 size={14} /> Gym Business Information</h3>
                  <div className="grid grid-cols-1 desktop:grid-cols-2 gap-5">
                    <div className="md:col-span-2"><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Registered Gym Name</label><div className="relative"><Building2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="text" value={gymData.name} onChange={e => setGymData({...gymData, name: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Support Phone</label><div className="relative"><Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={gymData.phone} onChange={e => setGymData({...gymData, phone: e.target.value})} placeholder="For member inquiries" className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Support Email</label><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="email" value={gymData.email} onChange={e => setGymData({...gymData, email: e.target.value})} placeholder="hello@yourgym.com" className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Website / Instagram</label><div className="relative"><Link size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={gymData.website} onChange={e => setGymData({...gymData, website: e.target.value})} placeholder="instagram.com/yourgym" className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">GST / Tax ID (Optional)</label><div className="relative"><FileDigit size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={gymData.tax_id || ''} onChange={e => setGymData({...gymData, tax_id: e.target.value})} placeholder="22AAAAA0000A1Z5" className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all" /></div></div>
                    <div className="md:col-span-2"><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Full Gym Address</label><div className="relative"><MapPin size={16} className="absolute left-4 top-4 text-slate-400" /><textarea value={gymData.address} onChange={e => setGymData({...gymData, address: e.target.value})} rows="3" placeholder="123 Fitness Street, City, State..." className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all resize-none" /></div></div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 sticky bottom-0 bg-white/85 backdrop-blur-md p-4 -mx-4 rounded-b-[28px] border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-10">
                  <button type="submit" disabled={isSaving} className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3.5 rounded-xl font-black text-sm hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-70 shadow-lg shadow-indigo-500/30">
                    <Save size={18} /> {isSaving ? 'Saving Updates...' : 'Save All Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex justify-between items-end mb-8 max-w-5xl">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 mb-1">Staff & Roles</h2>
                  <p className="text-sm font-medium text-slate-500">Manage team access and permissions.</p>
                </div>
                <button onClick={fetchStaff} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-indigo-100 transition-all">
                  <RefreshCw size={16} /> Refresh
                </button>
              </div>

              <div className="border border-slate-200 rounded-2xl p-5 bg-white max-w-5xl mb-5">
                <h3 className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-4">Add Staff Member</h3>
                <form onSubmit={handleAddStaff} className="grid grid-cols-1 desktop:grid-cols-5 gap-3">
                  <input
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    placeholder="Full Name"
                    className="md:col-span-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
                  />
                  <input
                    value={staffForm.email}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="Email"
                    type="email"
                    className="md:col-span-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
                  />
                  <input
                    value={staffForm.password}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Temporary Password"
                    type="password"
                    className="md:col-span-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
                  />
                  <select
                    value={staffForm.staff_role}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, staff_role: e.target.value }))}
                    className="md:col-span-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold"
                  >
                    {STAFF_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={addingStaff}
                    className="md:col-span-1 flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-black text-sm hover:bg-indigo-700 transition-all disabled:opacity-60"
                  >
                    <Plus size={16} /> {addingStaff ? 'Adding...' : 'Add Staff'}
                  </button>
                </form>
              </div>
              
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white max-w-5xl">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr><th className="px-6 py-4">Name</th><th className="px-6 py-4">Role</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Reset Password</th><th className="px-6 py-4 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-6 py-4 font-bold text-slate-800">{accountData.full_name} <span className="block text-xs font-medium text-slate-400">{accountData.email}</span></td>
                      <td className="px-6 py-4"><span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold uppercase tracking-wider">Owner</span></td>
                      <td className="px-6 py-4"><span className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold"><CheckCircle size={14}/> Active</span></td>
                      <td className="px-6 py-4 text-slate-300 text-xs font-bold">—</td>
                      <td className="px-6 py-4 text-right text-slate-300 font-bold text-xs">Cannot edit owner</td>
                    </tr>

                    {loadingStaff ? (
                      <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-medium bg-slate-50/50">Loading staff members...</td></tr>
                    ) : staffMembers.filter((u) => u.role !== 'OWNER').length === 0 ? (
                      <tr><td colSpan="5" className="px-6 py-8 text-center text-slate-400 font-medium bg-slate-50/50">You haven't added any staff members yet.</td></tr>
                    ) : (
                      staffMembers.filter((u) => u.role !== 'OWNER').map((staff) => (
                        <tr key={staff.id}>
                          <td className="px-6 py-4 font-bold text-slate-800">
                            {staff.full_name}
                            <span className="block text-xs font-medium text-slate-400">{staff.email}</span>
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={staff.staff_role || 'STAFF'}
                              disabled={savingStaffId === staff.id}
                              onChange={(e) => updateStaffRole(staff, e.target.value)}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border border-slate-200 bg-white text-slate-700"
                            >
                              {STAFF_ROLE_OPTIONS.map((role) => (
                                <option key={role} value={role}>{role}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${staff.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {staff.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                value={staffPasswordReset[staff.id] || ''}
                                onChange={(e) => setStaffPasswordReset((prev) => ({ ...prev, [staff.id]: e.target.value }))}
                                placeholder="New password"
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold w-36"
                              />
                              <button
                                onClick={() => resetStaffPassword(staff.id)}
                                type="button"
                                disabled={resettingPasswordId === staff.id}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-60"
                              >
                                {resettingPasswordId === staff.id ? 'Saving' : 'Reset'}
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => toggleStaffStatus(staff)}
                              disabled={savingStaffId === staff.id}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${staff.is_active ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} disabled:opacity-60`}
                            >
                              {staff.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                  </div>
              </div>
            </div>
          )}

          {/* ADVANCED SAAS BILLING DASHBOARD */}
          {activeTab === 'billing' && (
            <div className="animate-in fade-in duration-300">
              
              {/* Lockout Warning Banners (Driven by Real-Time Clock) */}
              {isLockedOut && (
                  <div className="mb-8 bg-rose-600 text-white p-6 rounded-2xl flex items-start gap-4 shadow-xl shadow-rose-600/20 animate-in slide-in-from-top-4">
                      <Lock size={28} className="mt-1 shrink-0" />
                      <div>
                          <h4 className="font-black text-lg">Vault Locked: Subscription Expired</h4>
                          <p className="text-sm font-medium text-rose-100 mt-1">Your access to members, attendance, and analytics has been paused. Please renew your subscription to instantly unlock your gym's data.</p>
                      </div>
                  </div>
              )}

              {realStatus === 'GRACE_PERIOD' && (
                  <div className="mb-8 bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-4">
                      <AlertTriangle className="text-amber-500 mt-0.5" size={20} />
                      <div>
                          <h4 className="font-bold text-amber-800 text-sm">Action Required: Grace Period Ending</h4>
                      <p className="text-xs text-amber-700 mt-0.5">Your subscription expired on {formatExpiry(gymData.saas_valid_until)}. {billingWindow.graceDaysRemaining > 0 ? `${billingWindow.graceDaysRemaining} day${billingWindow.graceDaysRemaining === 1 ? '' : 's'} left before your vault is locked.` : 'Renew now to avoid lockout.'}</p>
                      </div>
                  </div>
              )}

                {!isLockedOut && realStatus !== 'GRACE_PERIOD' && billingWindow.isExpiringSoon && (
                  <div className="mb-8 bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-4">
                    <AlertTriangle className="text-amber-500 mt-0.5" size={20} />
                    <div>
                      <h4 className="font-bold text-amber-800 text-sm">Billing Warning</h4>
                      <p className="text-xs text-amber-700 mt-0.5">{realStatus === 'FREE_TRIAL' ? `Your free trial ${billingWindow.expiresToday ? 'ends today' : 'ends tomorrow'}. Choose a plan now to avoid interruption.` : `Your subscription ${billingWindow.expiresToday ? 'ends today' : 'ends tomorrow'}. Renew now to avoid entering grace period.`}</p>
                    </div>
                  </div>
                )}

              {/* FREE TRIAL BANNER */}
              {realStatus === 'FREE_TRIAL' && (
                  <div className="mb-8 p-6 rounded-[28px] border-2 border-dashed border-indigo-300 bg-indigo-50 flex flex-col desktop:flex-row items-start desktop:items-center justify-between gap-4 animate-in slide-in-from-top-4">
                      <div className="flex items-start gap-4">
                          <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center shrink-0">
                              <Zap size={22} className="text-indigo-600" />
                          </div>
                          <div>
                              <div className="flex items-center gap-2 mb-1">
                                  <span className="px-2.5 py-0.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">Free Trial</span>
                                  <span className="text-[11px] font-bold text-indigo-400">Expires {formatExpiry(gymData.saas_valid_until)}</span>
                              </div>
                              <h3 className="text-lg font-black text-slate-900">You're on a 14-day free trial</h3>
                              <p className="text-sm text-slate-500 font-medium mt-0.5">All features unlocked. Choose a plan below to continue after your trial — no charges until then.</p>
                          </div>
                      </div>
                  </div>
              )}

              {/* PREMIUM ACTIVE BANNER */}
              {realStatus === 'ACTIVE' && (
                  <div className="mb-8 p-8 bg-slate-900 rounded-[32px] shadow-2xl flex flex-col desktop:flex-row items-center justify-between gap-6 relative overflow-hidden border border-slate-800">
                      <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/10 blur-[100px] pointer-events-none"></div>
                      
                      <div className="relative z-10 flex items-center gap-5">
                          <div className="flex items-center justify-center w-14 h-14 bg-emerald-500/20 rounded-2xl border border-emerald-500/30">
                              <CheckCircle size={28} className="text-emerald-400" />
                          </div>
                          <div>
                              <div className="flex items-center gap-2 mb-1">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                      gymData.current_plan === 'test'
                                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                        : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                  }`}>
                                      {gymData.current_plan === 'test' ? 'Dev Test' : 'Enterprise License'}
                                  </span>
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                                      {gymData.saas_billing_cycle === 'annual' ? 'Annual Plan' : 'Monthly Plan'}
                                  </span>
                              </div>
                              <h3 className="text-3xl font-black text-white">Vault Active</h3>
                              <p className="text-sm text-slate-400 font-medium mt-1">
                                  Your gym is running on {SAAS_PLANS[gymData.saas_billing_cycle]?.find(p => p.id === gymData.current_plan)?.name || 'Pro Vault'}.
                              </p>
                          </div>
                      </div>

                      <div className="relative z-10 text-left md:text-right w-full md:w-auto bg-white/5 border border-white/10 p-5 rounded-2xl backdrop-blur-md">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Access Valid Until</p>
                          <p className="font-black text-2xl text-emerald-400 tracking-wide">
                              {formatExpiry(gymData.saas_valid_until)}
                          </p>
                      </div>
                  </div>
              )}

              {/* ── Billing cycle toggle ── */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 mb-1">Billing &amp; Subscription</h2>
                  <p className="text-sm font-medium text-slate-500">Upgrade to unlock your gym's full potential.</p>
                </div>
                <div className="bg-slate-100 p-1 rounded-xl inline-flex shadow-inner shrink-0">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >Monthly</button>
                  <button
                    onClick={() => setBillingCycle('annual')}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${billingCycle === 'annual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Annually
                    <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">Save 16%</span>
                  </button>
                </div>
              </div>

              {/* ── Plan carousel (swipeable on mobile, grid on desktop) ── */}
              <div className="relative mb-10">
                {/* scroll hint arrows — mobile only */}
                <div className="gv-carousel-fade-l absolute left-0 top-9 bottom-4 w-6 bg-gradient-to-r from-white/60 to-transparent pointer-events-none z-10 lg:hidden" />
                <div className="gv-carousel-fade-r absolute right-0 top-9 bottom-4 w-6 bg-gradient-to-l from-white/60 to-transparent pointer-events-none z-10 lg:hidden" />

                {/* the scroll container becomes a grid on lg+ */}
                <div
                  className="flex gap-4 overflow-x-auto snap-x snap-mandatory pt-6 pb-4 scroll-smooth lg:grid lg:grid-cols-4 lg:overflow-visible lg:snap-none lg:pt-6"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {SAAS_PLANS[billingCycle].map((plan) => {
                    const Icon = plan.icon;
                    const isCurrentPlan = gymData.current_plan === plan.id;
                    const isTrial = realStatus === 'FREE_TRIAL' && isCurrentPlan;
                    const isActive = realStatus === 'ACTIVE' && isCurrentPlan && gymData.saas_billing_cycle === billingCycle;
                    const isSamePlanDifferentCycle = realStatus === 'ACTIVE' && isCurrentPlan && gymData.saas_billing_cycle !== billingCycle;
                    const needsRenewal = (realStatus === 'EXPIRED' || realStatus === 'GRACE_PERIOD') && isCurrentPlan && gymData.saas_billing_cycle === billingCycle;

                    // button label
                    let btnLabel = `Upgrade to ${plan.name}`;
                    if (isActive) btnLabel = 'Currently Active';
                    else if (isTrial) btnLabel = 'Activate Now — Avoid Interruption';
                    else if (needsRenewal) btnLabel = 'Renew Subscription';
                    else if (isSamePlanDifferentCycle) btnLabel = `Switch to ${billingCycle === 'annual' ? 'Annual' : 'Monthly'}`;
                    else if (plan.test) btnLabel = 'Pay \u20B91 \u2014 Test';

                    return (
                      <div
                        key={plan.id}
                        className={`
                          relative flex flex-col
                          min-w-[82vw] max-w-[340px]
                          lg:min-w-0 lg:max-w-none
                          flex-shrink-0 snap-center
                          p-5 rounded-[24px] transition-all duration-300
                          ${plan.test
                            ? 'gv-test-plan-card bg-amber-50 border-2 border-amber-300 border-dashed'
                            : isTrial
                            ? 'bg-indigo-50 border-2 border-indigo-400 border-dashed shadow-lg'
                            : isActive
                            ? 'bg-indigo-50 border-2 border-indigo-500 shadow-xl'
                            : 'bg-white border border-slate-200 hover:border-indigo-300 shadow-sm hover:shadow-xl'
                          }
                        `}
                      >
                        {/* badge */}
                        {plan.popular && !isActive && !isTrial && !plan.test && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md whitespace-nowrap">Most Popular</span>
                        )}
                        {isActive && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md flex items-center gap-1 whitespace-nowrap">
                            <CheckCircle size={10}/> Current Plan
                          </span>
                        )}
                        {isTrial && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md flex items-center gap-1 whitespace-nowrap">
                            <Zap size={10} fill="currentColor"/> In Trial
                          </span>
                        )}
                        {plan.test && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md whitespace-nowrap">DEV TEST</span>
                        )}

                        {/* icon */}
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-4 ${isActive ? 'bg-indigo-500 text-white' : plan.bg + ' ' + plan.color}`}>
                          <Icon size={22} />
                        </div>

                        {/* name + price */}
                        <h3 className="text-lg font-black mb-0.5 text-slate-900">{plan.name}</h3>
                        <div className="flex items-baseline gap-1 mb-5 text-slate-900">
                          <span className="text-3xl font-black">&#8377;{plan.price}</span>
                          <span className="text-sm font-medium text-slate-500">/mo</span>
                        </div>

                        {/* features */}
                        <ul className="space-y-2.5 mb-6 flex-1">
                          {plan.features.map((feature, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm font-medium text-slate-600">
                              <Check size={15} className={`shrink-0 mt-0.5 ${isActive ? 'text-indigo-500' : plan.test ? 'text-amber-500' : 'text-slate-400'}`} />
                              {feature}
                            </li>
                          ))}
                        </ul>

                        {/* CTA button */}
                        <button
                          onClick={() => handleSubscribe(plan)}
                          disabled={isProcessingPayment || isActive}
                          className={`w-full py-3 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 active:scale-95 ${
                            isActive
                              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 cursor-not-allowed'
                              : isTrial
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/30'
                              : plan.test
                              ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/30'
                              : 'bg-slate-900 text-white hover:bg-slate-700 shadow-md'
                          } disabled:opacity-60`}
                        >
                          {isProcessingPayment ? <><RefreshCw size={14} className="animate-spin" /> Processing…</> : btnLabel}
                        </button>
                        {plan.test && isActive && (
                          <button
                            onClick={handleResetTest}
                            className="w-full mt-2 py-2 rounded-xl font-bold text-xs text-amber-600 border border-amber-200 hover:bg-amber-50 transition-all flex items-center justify-center gap-1.5"
                          >
                            <RefreshCw size={12} /> Reset Test Timer
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* dot indicators — mobile only */}
                <div className="flex justify-center gap-1.5 mt-1 lg:hidden">
                  {SAAS_PLANS[billingCycle].map((plan) => (
                    <div key={plan.id} className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  ))}
                </div>
              </div>

              {/* Usage & Limits Dashboard */}
              <div className="p-6 md:p-8 bg-white border border-slate-200 rounded-[28px] shadow-sm mb-10">
                  <div className="flex items-center gap-3 mb-6">
                      <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><Database size={20} /></div>
                      <div>
                          <h3 className="font-black text-slate-900 text-lg leading-tight">Live Database Usage</h3>
                          <p className="text-xs font-bold text-slate-500">Tracked against your current plan limits.</p>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-1 desktop:grid-cols-2 gap-x-12 gap-y-8 mt-6">
                      <ProgressBar 
                          label="Total Registered Members" 
                          current={usageData.members} 
                          max={PLAN_LIMITS[gymData.current_plan]?.members ?? 'Unlimited'} 
                          icon={Users} 
                      />
                      <ProgressBar 
                          label="Cloud Storage (Images & Backups)" 
                          current={usageData.storage} 
                          max={PLAN_LIMITS[gymData.current_plan]?.storage ?? 10} 
                          unit="GB" 
                          icon={HardDrive} 
                      />
                      <ProgressBar 
                          label="Active Staff Accounts" 
                          current={usageData.staff} 
                          max={PLAN_LIMITS[gymData.current_plan]?.staff ?? 'Unlimited'} 
                          icon={User} 
                      />
                  </div>
              </div>

              {/* Dynamic Invoice & Security Layout */}
              <div className="grid grid-cols-1 desktop:grid-cols-2 gap-6 mt-6">
                  <div className="p-6 bg-white border border-slate-200 rounded-[28px] shadow-sm flex flex-col">
                      <div className="flex justify-between items-center mb-6">
                          <h3 className="font-black text-slate-900 text-lg">Recent Invoices</h3>
                          <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl"><FileText size={18} /></span>
                      </div>
                      
                      {localInvoice ? (
                          <div className="flex items-center justify-between p-5 bg-slate-50 border border-slate-100 rounded-2xl animate-in fade-in zoom-in-95 duration-500">
                              <div>
                                  <p className="font-black text-slate-800 text-sm mb-1">{localInvoice.plan}</p>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                      {formatExpiry(localInvoice.date)} &bull; #{localInvoice.id.slice(0,10)}...
                                  </p>
                              </div>
                              <button onClick={() => generateSaaSInvoice(localInvoice)} className="text-indigo-600 font-black text-xs uppercase tracking-wider hover:bg-indigo-100 bg-indigo-50 px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm">
                                  <Download size={14}/> PDF
                              </button>
                          </div>
                      ) : (
                          <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                              <FileText size={24} className="text-slate-300 mb-2"/>
                              <p className="font-bold text-sm">No recent invoices found.</p>
                              <p className="text-xs font-medium text-slate-400 mt-1">Upgrade to generate receipts.</p>
                          </div>
                      )}
                  </div>
                  
                  <div className="p-6 bg-white border border-slate-200 rounded-[28px] shadow-sm">
                      <div className="flex justify-between items-center mb-5">
                          <h3 className="font-black text-slate-900 text-lg">Payment Security</h3>
                          <span className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><ShieldCheck size={18} /></span>
                      </div>
                      <p className="text-sm text-slate-500 font-medium mb-6 leading-relaxed">
                          Your transactions are 256-bit encrypted and secured directly by Razorpay's banking network. GymVault does not store or process your card details.
                      </p>
                      <div className="space-y-3">
                          <div className="flex items-center gap-3 text-slate-700 font-bold text-sm bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <ShieldCheck size={18} className="text-emerald-500" /> PCI-DSS Certified
                          </div>
                          <div className="flex items-center gap-3 text-slate-700 font-bold text-sm bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <Lock size={18} className="text-indigo-500" /> End-to-End Encryption
                          </div>
                      </div>
                  </div>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Integrations</h2>
              <p className="text-sm font-medium text-slate-500 mb-6">Connect payment gateways, messaging services &amp; manage campaign templates.</p>

              {/* Sub-tab switcher */}
              <div role="tablist" aria-label="Integration sections" className="grid w-full max-w-3xl grid-cols-2 sm:grid-cols-4 bg-slate-100 rounded-2xl p-1 mb-8 gap-1">
                <button type="button" id="settings-integration-tab-payments" role="tab" aria-selected={integSubTab === 'payments'} aria-controls="settings-integration-panel-payments" tabIndex={integSubTab === 'payments' ? 0 : -1} onClick={() => setIntegSubTab('payments')}
                  className={`min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 ${integSubTab === 'payments' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  <CreditCard size={14} /> Payments
                </button>
                <button type="button" id="settings-integration-tab-messaging" role="tab" aria-selected={integSubTab === 'messaging'} aria-controls="settings-integration-panel-messaging" tabIndex={integSubTab === 'messaging' ? 0 : -1} onClick={() => setIntegSubTab('messaging')}
                  className={`min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 ${integSubTab === 'messaging' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  <MessageSquare size={14} /> Messaging
                </button>
                <button type="button" id="settings-integration-tab-campaigns" role="tab" aria-selected={integSubTab === 'campaigns'} aria-controls="settings-integration-panel-campaigns" tabIndex={integSubTab === 'campaigns' ? 0 : -1} onClick={() => setIntegSubTab('campaigns')}
                  className={`min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 ${integSubTab === 'campaigns' ? 'bg-white shadow-sm text-purple-700' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Zap size={14} /> Campaigns
                </button>
                <button type="button" id="settings-integration-tab-platform" role="tab" aria-selected={integSubTab === 'platform'} aria-controls="settings-integration-panel-platform" tabIndex={integSubTab === 'platform' ? 0 : -1} onClick={() => setIntegSubTab('platform')}
                  className={`min-w-0 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-3 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 ${integSubTab === 'platform' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Blocks size={14} /> Platform
                </button>
              </div>

              {integrationLoading ? (
                <div className="p-10 bg-white border border-slate-100 rounded-2xl text-center text-slate-400 font-bold animate-pulse">Loading integrations...</div>
              ) : (
                <div className="w-full max-w-4xl min-w-0 overflow-x-hidden">

                  {/* â•â• PAYMENTS TAB â•â• */}
                  {integSubTab === 'payments' && (
                    <div id="settings-integration-panel-payments" role="tabpanel" aria-labelledby="settings-integration-tab-payments" className="space-y-4 animate-in fade-in duration-200">

                      {/* Razorpay Connect Hero Card */}
                      <div className={`rounded-2xl p-5 sm:p-6 border ${integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'bg-emerald-50 border-emerald-200' : 'bg-gradient-to-br from-indigo-50 to-white border-indigo-200'}`}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'bg-emerald-500' : integrationData.member_payments?.onboarding_status === 'AUTHORIZED' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                              <span className={`text-xs font-black uppercase tracking-wider ${integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'text-emerald-700' : integrationData.member_payments?.onboarding_status === 'AUTHORIZED' ? 'text-amber-700' : 'text-slate-500'}`}>
                                {integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'Connected via Razorpay Route' : integrationData.member_payments?.onboarding_status === 'AUTHORIZED' ? 'Authorized - Setup Pending' : integrationData.member_payments?.onboarding_status === 'FAILED' ? 'Connection Failed' : 'Not Connected'}
                              </span>
                            </div>
                            <h3 className="text-lg font-black text-slate-900 mb-1">
                              {integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'Razorpay Connected' : 'Connect with Razorpay'}
                            </h3>
                            <p className="text-xs font-medium text-slate-500 mb-4 break-all">
                              {integrationData.member_payments?.onboarding_status === 'CONNECTED' ? `Account: ${integrationData.member_payments.connected_account_id}` : 'Members pay membership fees directly to your account. GymVault auto-collects its platform fee via Route.'}
                            </p>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
                              <button type="button" onClick={handleConnectRazorpay} disabled={connectingGateway}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                                {connectingGateway ? <><RefreshCw size={14} className="animate-spin" />Connecting...</> : 'Connect Razorpay'}
                              </button>
                              {integrationData.member_payments?.onboarding_status === 'CONNECTED' && (
                                <button type="button" onClick={handleDisconnectRazorpay} disabled={disconnectingGateway}
                                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold text-sm hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 active:scale-95 transition-all disabled:opacity-60">
                                  {disconnectingGateway ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0 self-start">
                            <CreditCard size={22} className="text-indigo-500" />
                          </div>
                        </div>
                      </div>

                      {/* Paste acc_ manually */}
                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                        <button type="button" onClick={() => setShowLinkedAccountForm(v => !v)} aria-expanded={showLinkedAccountForm} aria-controls="settings-linked-account-panel"
                          className="w-full flex items-center justify-between p-5 text-left hover:bg-slate-50 transition-colors">
                          <div>
                            <p className="font-bold text-slate-800 text-sm">Already have a Razorpay Account ID?</p>
                            <p className="text-xs text-slate-500 mt-0.5">Paste acc_... to connect directly without OAuth</p>
                          </div>
                          <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${showLinkedAccountForm ? 'rotate-180' : ''}`} />
                        </button>
                        {showLinkedAccountForm && (
                          <div id="settings-linked-account-panel" className="px-5 pb-5 space-y-3 animate-in fade-in duration-200">
                            <div className="h-px bg-slate-100" />
                            <p className="text-xs text-slate-500 font-medium break-words">Go to <strong>Razorpay &gt; Route &gt; Accounts</strong> and copy your Account ID (starts with <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">acc_</code>)</p>
                            <input
                              value={linkedAccountForm.account_id || ''}
                              onChange={(e) => setLinkedAccountForm(p => ({ ...p, account_id: e.target.value }))}
                              placeholder="acc_XXXXXXXXXXXXXXXXX"
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-mono font-semibold focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none"
                            />
                            <button type="button" onClick={handleCreateLinkedAccount} disabled={linkedAccountSaving}
                              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-60">
                              {linkedAccountSaving ? 'Saving...' : 'Connect Account'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Manual API Keys */}
                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                          <div>
                            <h4 className="font-black text-slate-900 text-sm">Manual API Keys</h4>
                            <p className="text-xs text-slate-500 mt-0.5">For gyms using their own Razorpay account directly</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-500">Use Route</span>
                            <button type="button" aria-pressed={integrationData.member_payments?.connect_mode === 'PARTNER'} aria-label="Toggle Razorpay Route mode" onClick={() => setIntegrationData(prev => ({ ...prev, member_payments: { ...prev.member_payments, connect_mode: prev.member_payments?.connect_mode === 'PARTNER' ? 'MANUAL' : 'PARTNER' } }))}
                              className={`relative w-10 h-6 rounded-full transition-colors ${integrationData.member_payments?.connect_mode === 'PARTNER' ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${integrationData.member_payments?.connect_mode === 'PARTNER' ? 'translate-x-4' : ''}`} />
                            </button>
                          </div>
                        </div>
                        <div className={`space-y-3 ${integrationData.member_payments?.connect_mode === 'PARTNER' ? 'opacity-40 pointer-events-none' : ''}`}>
                          <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Razorpay Key ID</label>
                            <input value={integrationData.member_payments?.razorpay_key_id || ''}
                              onChange={(e) => setIntegrationData(prev => ({ ...prev, member_payments: { ...prev.member_payments, razorpay_key_id: e.target.value } }))}
                              placeholder="rzp_live_xxxxx"
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Razorpay Key Secret</label>
                            <input type="password" value={integrationData.member_payments?.razorpay_key_secret || ''}
                              onChange={(e) => setIntegrationData(prev => ({ ...prev, member_payments: { ...prev.member_payments, razorpay_key_secret: e.target.value } }))}
                              placeholder={integrationData.member_payments?.has_razorpay_secret ? 'Saved securely (enter to replace)' : 'rzp_live_secret_xxxxx'}
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none" />
                          </div>
                        </div>
                      </div>

                      {/* UPI + Enable toggle */}
                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">UPI ID for Direct QR Collection <span className="font-medium normal-case text-slate-400">(optional if Razorpay is configured)</span></label>
                          <input value={integrationData.member_payments?.upi_id || ''}
                            onChange={(e) => setIntegrationData(prev => ({ ...prev, member_payments: { ...prev.member_payments, upi_id: e.target.value } }))}
                            placeholder="yourgym@upi"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none" />
                          <p className="text-xs text-slate-400 mt-1 font-medium">Shown in the direct UPI QR flow when staff collects member fees at the desk</p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-1">
                          <div>
                            <p className="font-bold text-slate-800 text-sm">Enable Member Online Collection</p>
                            <p className="text-xs text-slate-500 mt-0.5">Staff can collect member payments using Razorpay payment links with member-phone delivery and owner QR, direct UPI QR, or both</p>
                          </div>
                          <button type="button" aria-pressed={Boolean(integrationData.member_payments?.enabled)} aria-label="Toggle member online collection" onClick={() => setIntegrationData(prev => ({ ...prev, member_payments: { ...prev.member_payments, enabled: !prev.member_payments?.enabled } }))}
                            className={`relative w-11 h-6 rounded-full transition-colors ${integrationData.member_payments?.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${integrationData.member_payments?.enabled ? 'translate-x-5' : ''}`} />
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-stretch sm:justify-end">
                        <button type="button" onClick={handleIntegrationSave} disabled={integrationSaving}
                          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                          <Save size={15} /> {integrationSaving ? 'Saving...' : 'Save Payment Settings'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* â•â• MESSAGING TAB â•â• */}
                  {integSubTab === 'messaging' && (
                    <div id="settings-integration-panel-messaging" role="tabpanel" aria-labelledby="settings-integration-tab-messaging" className="space-y-4 animate-in fade-in duration-200">
                      {isWhatsAppConnected && !whatsappNumberEditorOpen ? (
                        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h4 className="font-black text-slate-900 text-sm mb-1">Connected Gym WhatsApp</h4>
                              <p className="text-xs text-slate-500 font-medium">This connected business number is now active for member-facing messaging from GymVault.</p>
                            </div>
                            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-emerald-50 text-emerald-700 text-xs font-black uppercase tracking-wider border border-emerald-200">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Connected
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Business WhatsApp Number</p>
                              <p className="mt-1 font-bold text-slate-800">{integrationData.whatsapp_number || 'Not available'}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Owner Alert Mobile</p>
                              <p className="mt-1 font-bold text-slate-800">{integrationData.owner_mobile || 'Not set'}</p>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                            <p className="text-[11px] font-semibold text-emerald-800 leading-relaxed">
                              Gym owners do not need a separate MSG91 account. They only verify their business number once inside your shared MSG91 setup. After that, GymVault keeps sending from the connected number.
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3">
                            <button
                              type="button"
                              onClick={handleLaunchWhatsAppOnboarding}
                              disabled={whatsappOnboardingLaunching || integrationSaving}
                              className="flex-1 px-4 py-3 rounded-xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                            >
                              <Blocks size={15} /> {whatsappOnboardingLaunching ? 'Opening Workspace...' : 'Open WhatsApp Workspace'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setWhatsAppNumberEditorOpen(true)}
                              className="sm:w-auto px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-sm hover:bg-slate-50 transition-all"
                            >
                              Change Number
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h4 className="font-black text-slate-900 text-sm mb-1">Gym Business WhatsApp</h4>
                              <p className="text-xs text-slate-500 font-medium">This is the verified business number GymVault will use for outbound member messaging.</p>
                            </div>
                            {isWhatsAppConnected && (
                              <button
                                type="button"
                                onClick={() => {
                                  setWhatsAppNumberEditorOpen(false);
                                  loadIntegrations();
                                }}
                                className="sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-black text-xs hover:bg-slate-50 transition-all"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Business WhatsApp Number</label>
                              <input value={integrationData.whatsapp_number}
                                onChange={(e) => setIntegrationData(prev => ({ ...prev, whatsapp_number: e.target.value }))}
                                placeholder="+91XXXXXXXXXX"
                                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none" />
                            </div>
                            <div>
                              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Owner Alert Mobile (optional)</label>
                              <input value={integrationData.owner_mobile}
                                onChange={(e) => setIntegrationData(prev => ({ ...prev, owner_mobile: e.target.value }))}
                                placeholder="+91XXXXXXXXXX"
                                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none" />
                            </div>
                          </div>
                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                            <p className="text-[11px] font-semibold text-emerald-800 leading-relaxed">
                              Gym owners still log in using the phone saved on their account. This business number is only for member-facing WhatsApp templates and reminders.
                            </p>
                          </div>
                          {isWhatsAppConnected && (
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                              <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
                                Changing the connected number will pause template sync until the new number is verified in MSG91 and refreshed inside GymVault.
                              </p>
                            </div>
                          )}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">In-App Setup Workspace</p>
                              <p className="text-sm font-semibold text-slate-700 mt-1">Save the business number here, then launch MSG91 and Meta inside GymVault to finish onboarding.</p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3">
                              <button
                                type="button"
                                onClick={handleLaunchWhatsAppOnboarding}
                                disabled={whatsappOnboardingLaunching || integrationSaving}
                                className="flex-1 px-4 py-3 rounded-xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                              >
                                <Blocks size={15} /> {whatsappOnboardingLaunching ? 'Opening Workspace...' : integrationData.whatsapp_status === 'CONNECTED' ? 'Open WhatsApp Workspace' : 'Start In-App Setup'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWhatsAppOnboardingOpen(true);
                                  switchWhatsAppOnboardingView('guide');
                                }}
                                className="sm:w-auto px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-black text-sm hover:bg-white transition-all flex items-center justify-center gap-2"
                              >
                                <FileText size={15} /> View Guide
                              </button>
                            </div>
                            <p className="text-[11px] font-semibold text-slate-500 leading-relaxed">
                              GymVault keeps the setup anchored here. If MSG91 blocks embedding in your browser during login, you can still pop the same step out and return here to refresh status.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <div className={`rounded-2xl p-4 border ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).card}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-2 h-2 rounded-full ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).dot}`} />
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">WhatsApp Connection</span>
                          </div>
                          <p className={`text-sm font-black ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).text}`}>{getWhatsAppConnectionMeta(integrationData.whatsapp_status).label}</p>
                          <p className="text-[11px] text-slate-600 font-semibold mt-1">{getWhatsAppConnectionMeta(integrationData.whatsapp_status).note}</p>
                        </div>

                        <div className="rounded-2xl p-4 border bg-indigo-50 border-indigo-200">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Owner Sign-In</span>
                          </div>
                          <p className="text-sm font-black text-indigo-700">Google or Email Password</p>
                          <p className="text-[11px] text-slate-600 font-semibold mt-1">
                            Owner and staff sign-in now uses Google or email and password. Email OTP remains available for signup verification and forgot-password recovery only.
                          </p>
                        </div>

                        <div className="rounded-2xl p-4 border bg-slate-50 border-slate-200">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-slate-400" />
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Template Sync</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-black text-slate-800">{getTemplateSyncMeta(integrationData.whatsapp_templates_status).label}</p>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getTemplateSyncMeta(integrationData.whatsapp_templates_status).pill}`}>
                              {integrationData.approved_template_count} approved
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-semibold mt-1">Templates must be approved in MSG91 before campaigns can send.</p>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h4 className="font-black text-slate-900 text-sm mb-1">Connection Details</h4>
                            <p className="text-xs text-slate-500 font-medium">Use refresh after completing verification in MSG91.</p>
                          </div>
                          <button type="button" onClick={loadIntegrations}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-black hover:bg-slate-50 transition-colors">
                            <RefreshCw size={14} /> Refresh Status
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Display Name</p>
                            <p className="mt-1 font-bold text-slate-800">{resolvedWhatsAppDisplayName}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Business Category</p>
                            <p className="mt-1 font-bold text-slate-800">{resolvedWhatsAppCategory}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Last Checked</p>
                            <p className="mt-1 font-bold text-slate-800">{integrationData.whatsapp_last_checked_at ? new Date(integrationData.whatsapp_last_checked_at).toLocaleString() : 'Not checked yet'}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Templates Synced</p>
                            <p className="mt-1 font-bold text-slate-800">{integrationData.whatsapp_templates_last_synced_at ? new Date(integrationData.whatsapp_templates_last_synced_at).toLocaleString() : 'Not synced yet'}</p>
                          </div>
                        </div>

                        {isWhatsAppConnected && (!integrationData.whatsapp_display_name || !integrationData.whatsapp_category) && (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold text-slate-600 leading-relaxed">
                              MSG91's current number API is returning the connected number but not the display-name or business-category metadata for this account. Messaging still works normally, and those details remain managed in the MSG91 portal.
                            </p>
                          </div>
                        )}

                        {integrationData.whatsapp_last_error && (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                            <p className="text-xs font-black text-rose-700 uppercase tracking-wider mb-1">Latest Sync Note</p>
                            <p className="text-sm font-semibold text-rose-700">{integrationData.whatsapp_last_error}</p>
                          </div>
                        )}
                      </div>

                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                        <h4 className="font-black text-slate-900 text-sm mb-1">Send Test Template</h4>
                        <p className="text-xs text-slate-500 mb-4 font-medium">GymVault sends an approved WhatsApp template from your connected business number.</p>
                        <form onSubmit={handleTestMessage} className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Approved Template</label>
                              <select value={integrationTest.template_key}
                                onChange={(e) => setIntegrationTest(prev => ({ ...prev, template_key: e.target.value }))}
                                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none">
                                <option value="">Use first approved template</option>
                                {(integrationData.templates || [])
                                  .filter((template) => template.is_active !== false && normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'APPROVED')
                                  .map((template) => (
                                    <option key={template.template_key} value={template.template_key}>{template.title}</option>
                                  ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Recipient</label>
                              <input value={integrationTest.to}
                                onChange={(e) => setIntegrationTest(prev => ({ ...prev, to: e.target.value }))}
                                placeholder="+91XXXXXXXXXX"
                                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none" />
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                            <p className="text-[11px] font-semibold text-slate-600 leading-relaxed">
                              Test sends use placeholder values like Test Member, Elite Plan, and 3 days left so you can confirm the template formatting before real campaigns.
                            </p>
                          </div>
                          <button type="submit" disabled={testSending || Number(integrationData.approved_template_count || 0) === 0}
                            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                            <Send size={14} /> {testSending ? 'Sending...' : 'Send Test Template'}
                          </button>
                        </form>
                      </div>

                      <div className="flex justify-stretch sm:justify-end">
                        <button type="button" onClick={handleIntegrationSave} disabled={integrationSaving}
                          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                          <Save size={15} /> {integrationSaving ? 'Saving...' : 'Save WhatsApp Setup'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* â•â• CAMPAIGNS TAB â•â• */}
                  {integSubTab === 'campaigns' && (
                    <div id="settings-integration-panel-campaigns" role="tabpanel" aria-labelledby="settings-integration-tab-campaigns" className="space-y-4 animate-in fade-in duration-200">

                      {/* Usage + Controls */}
                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                          <div>
                            <h4 className="font-black text-slate-900 text-sm">Bulk Messaging</h4>
                            <p className="text-xs text-slate-500 mt-0.5 font-medium">Send campaigns to multiple members at once</p>
                          </div>
                          <button type="button" aria-pressed={Boolean(integrationData.bulk_enabled)} aria-label="Toggle bulk messaging" onClick={() => setIntegrationData(prev => ({ ...prev, bulk_enabled: !prev.bulk_enabled }))}
                            className={`relative w-11 h-6 rounded-full transition-colors ${integrationData.bulk_enabled ? 'bg-purple-500' : 'bg-slate-300'}`}>
                            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${integrationData.bulk_enabled ? 'translate-x-5' : ''}`} />
                          </button>
                        </div>

                        {/* Usage bar */}
                        <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-2">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Monthly Usage</p>
                              <p className="text-2xl font-black text-slate-900">{integrationData.monthly_usage}<span className="text-sm text-slate-400 font-bold"> / {integrationData.bulk_monthly_limit}</span></p>
                            </div>
                            <span className={`text-xs font-black px-2.5 py-1 rounded-full ${integrationData.monthly_remaining > 50 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {integrationData.monthly_remaining} left
                            </span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div className="bg-purple-500 h-2 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, (integrationData.monthly_usage / Math.max(1, integrationData.bulk_monthly_limit)) * 100)}%` }} />
                          </div>
                        </div>

                        {/* Limits */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Monthly Limit</label>
                            <input type="number" min="10" value={integrationData.bulk_monthly_limit}
                              onChange={(e) => setIntegrationData(prev => ({ ...prev, bulk_monthly_limit: e.target.value }))}
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-purple-300 focus:ring-2 focus:ring-purple-100 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Per Campaign</label>
                            <input type="number" min="1" value={integrationData.bulk_per_campaign_limit}
                              onChange={(e) => setIntegrationData(prev => ({ ...prev, bulk_per_campaign_limit: e.target.value }))}
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-purple-300 focus:ring-2 focus:ring-purple-100 outline-none" />
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-slate-700">WhatsApp Campaigns</p>
                            <p className="text-[11px] text-slate-500 font-medium mt-0.5">Campaign sending is template-first and WhatsApp-only for now.</p>
                          </div>
                          <button type="button" aria-pressed={Boolean(integrationData.bulk_channels?.whatsapp)} aria-label="Toggle WhatsApp campaign delivery" onClick={() => setIntegrationData(prev => ({ ...prev, bulk_channels: { whatsapp: !prev.bulk_channels?.whatsapp, sms: false } }))}
                            className={`relative w-9 h-5 rounded-full transition-colors ${integrationData.bulk_channels?.whatsapp ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${integrationData.bulk_channels?.whatsapp ? 'translate-x-4' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {/* Templates accordion */}
                      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                        <div className="px-5 pt-5 pb-3">
                          <h4 className="font-black text-slate-900 text-sm mb-0.5">Message Templates</h4>
                          <p className="text-xs text-slate-500 font-medium">{'Placeholders: {{name}}, {{plan}}, {{days_left}}, {{gym_name}}'}</p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {(integrationData.templates || []).map((template, index) => (
                            <div key={template.template_key}>
                              <button type="button"
                                onClick={() => setExpandedTemplate(expandedTemplate === template.template_key ? null : template.template_key)}
                                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors text-left">
                                <div className="flex items-center gap-3">
                                  <div className={`w-2 h-2 rounded-full shrink-0 ${template.is_active !== false ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                  <div>
                                    <span className="text-sm font-bold text-slate-800 block">{template.title}</span>
                                    <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${getTemplateSyncMeta(normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'APPROVED' ? 'READY' : normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'PENDING' ? 'PENDING_APPROVAL' : normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'REJECTED' || normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'FAILED' ? 'ERROR' : normalizeTemplateSyncStatus(template.whatsapp_template_status) === 'DISABLED' ? 'NOT_SYNCED' : 'NOT_SYNCED').pill}`}>
                                      {normalizeTemplateSyncStatus(template.whatsapp_template_status).replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                </div>
                                <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 shrink-0 ${expandedTemplate === template.template_key ? 'rotate-180' : ''}`} />
                              </button>
                              {expandedTemplate === template.template_key && (
                                <div className="px-5 pb-5 space-y-3 animate-in fade-in duration-150 bg-slate-50/50">
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    <input value={template.title}
                                      onChange={(e) => { const next = [...integrationData.templates]; next[index] = { ...next[index], title: e.target.value }; setIntegrationData(prev => ({ ...prev, templates: next })); }}
                                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-800 focus:border-purple-300 focus:ring-2 focus:ring-purple-100 outline-none" />
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-xs font-bold text-slate-500">Active</span>
                                      <button type="button" onClick={() => { const next = [...integrationData.templates]; next[index] = { ...next[index], is_active: next[index].is_active === false ? true : false }; setIntegrationData(prev => ({ ...prev, templates: next })); }}
                                        className={`relative w-9 h-5 rounded-full transition-colors ${template.is_active !== false ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${template.is_active !== false ? 'translate-x-4' : ''}`} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">WhatsApp Template Copy</label>
                                      <textarea rows={4} value={template.whatsapp_text}
                                        onChange={(e) => { const next = [...integrationData.templates]; next[index] = { ...next[index], whatsapp_text: e.target.value }; setIntegrationData(prev => ({ ...prev, templates: next })); }}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 resize-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 outline-none" />
                                    </div>
                                    <div className="space-y-3">
                                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Provider Template Name</p>
                                        <p className="mt-1 text-xs font-bold text-slate-700 break-all">{template.whatsapp_template_name || 'Generated after first save'}</p>
                                      </div>
                                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sync Status</p>
                                        <p className="mt-1 text-xs font-bold text-slate-700">{normalizeTemplateSyncStatus(template.whatsapp_template_status).replace(/_/g, ' ')}</p>
                                        {template.whatsapp_template_error && (
                                          <p className="mt-2 text-[11px] font-semibold text-rose-600 leading-relaxed">{template.whatsapp_template_error}</p>
                                        )}
                                      </div>
                                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Notes</p>
                                        <p className="mt-1 text-[11px] font-semibold text-slate-600 leading-relaxed">Use placeholders like {'{{name}}'}, {'{{plan}}'}, {'{{days_left}}'}, and {'{{gym_name}}'}. Changing the copy creates a new provider template version for approval.</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-stretch sm:justify-end">
                        <button type="button" onClick={handleIntegrationSave} disabled={integrationSaving}
                          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-purple-600 text-white font-black text-sm hover:bg-purple-700 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                          <Save size={15} /> {integrationSaving ? 'Saving...' : 'Save Campaign Settings'}
                        </button>
                      </div>
                    </div>
                  )}

                  {integSubTab === 'platform' && (
                    <div id="settings-integration-panel-platform" role="tabpanel" aria-labelledby="settings-integration-tab-platform" className="space-y-4 animate-in fade-in duration-200">
                      {platformLoading ? (
                        <div className="p-10 bg-white border border-slate-100 rounded-2xl text-center text-slate-400 font-bold animate-pulse">Loading platform settings...</div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
                            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
                              <div>
                                <h4 className="font-black text-slate-900 text-sm">Branch Controls</h4>
                                <p className="text-xs text-slate-500 mt-0.5">Manage city, branch count, and front-desk contact details per location.</p>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">City</label>
                                  <input
                                    value={platformData.city}
                                    onChange={(e) => setPlatformData((prev) => ({ ...prev, city: e.target.value }))}
                                    placeholder="Jaipur"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-slate-300 focus:ring-2 focus:ring-slate-100 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Branch Count</label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="25"
                                    value={platformData.branches_count}
                                    onChange={(e) => updateBranchCount(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:border-slate-300 focus:ring-2 focus:ring-slate-100 outline-none"
                                  />
                                </div>
                              </div>
                              <div className="space-y-3">
                                {platformData.branch_directory.map((branch, index) => (
                                  <div key={branch.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Branch {index + 1}</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <input
                                        value={branch.name}
                                        onChange={(e) => updateBranchField(index, 'name', e.target.value)}
                                        placeholder="Branch name"
                                        className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold outline-none"
                                      />
                                      <input
                                        value={branch.phone}
                                        onChange={(e) => updateBranchField(index, 'phone', e.target.value)}
                                        placeholder="Branch phone"
                                        className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold outline-none"
                                      />
                                      <textarea
                                        value={branch.address}
                                        onChange={(e) => updateBranchField(index, 'address', e.target.value)}
                                        placeholder="Branch address"
                                        rows={2}
                                        className="sm:col-span-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold resize-none outline-none"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="flex justify-end">
                                <button type="button" onClick={saveBranchControls} disabled={platformSaving} className="px-6 py-3 rounded-xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center gap-2">
                                  <Save size={15} /> {platformSaving ? 'Saving...' : 'Save Branch Controls'}
                                </button>
                              </div>
                            </div>

                            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4">
                              <div>
                                <h4 className="font-black text-slate-900 text-sm">API Keys</h4>
                                <p className="text-xs text-slate-500 mt-0.5">Generate scoped API keys for external apps and kiosks.</p>
                              </div>
                              <div className="space-y-3">
                                <input
                                  value={apiKeyForm.key_name}
                                  onChange={(e) => setApiKeyForm((prev) => ({ ...prev, key_name: e.target.value }))}
                                  placeholder="Front desk kiosk"
                                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold outline-none"
                                />
                                <div className="flex flex-wrap gap-2">
                                  {API_SCOPE_OPTIONS.map((scope) => {
                                    const isActive = apiKeyForm.scopes.includes(scope);
                                    return (
                                      <button
                                        type="button"
                                        key={scope}
                                        onClick={() => toggleApiScope(scope)}
                                        className={`px-3 py-1.5 rounded-full text-xs font-black transition-all ${isActive ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                      >
                                        {scope}
                                      </button>
                                    );
                                  })}
                                </div>
                                <button type="button" onClick={createApiKey} disabled={apiKeySaving} className="w-full px-4 py-3 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                                  <Plus size={15} /> {apiKeySaving ? 'Creating...' : 'Create API Key'}
                                </button>
                              </div>

                              {revealedApiKey && (
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/80">Copy This Now</p>
                                  <p className="font-mono text-sm font-bold text-slate-900 break-all mt-2">{revealedApiKey}</p>
                                  <button type="button" onClick={copyApiKeyToClipboard} className="mt-3 px-3 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-100 transition-all flex items-center gap-2">
                                    {copiedApiKey ? <Check size={14} /> : <Download size={14} />} {copiedApiKey ? 'Copied' : 'Copy Key'}
                                  </button>
                                </div>
                              )}

                              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                {platformData.api_keys.length === 0 ? (
                                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm font-medium">No API keys created yet.</div>
                                ) : (
                                  platformData.api_keys.map((key) => (
                                    <div key={key.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-black text-slate-900">{key.key_name}</p>
                                          <p className="text-xs font-semibold text-slate-500 mt-1">{key.key_prefix}•••• • {new Date(key.created_at).toLocaleDateString('en-GB')}</p>
                                          <div className="flex flex-wrap gap-1.5 mt-2">
                                            {(key.scopes || []).map((scope) => (
                                              <span key={scope} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-500">{scope}</span>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${key.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{key.is_active ? 'Active' : 'Revoked'}</span>
                                          {key.is_active && (
                                            <button type="button" onClick={() => revokeApiKey(key.id)} className="text-[10px] font-black uppercase tracking-wider text-rose-600 hover:text-rose-700">Revoke</button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
                              <div className="space-y-4">
                                <div>
                                  <h4 className="font-black text-slate-900 text-sm">Webhook Router</h4>
                                  <p className="text-xs text-slate-500 mt-0.5">Push member, payment, attendance, and class events into your external systems.</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Endpoint URL</label>
                                  <input
                                    value={webhookForm.url}
                                    onChange={(e) => setWebhookForm((prev) => ({ ...prev, url: e.target.value }))}
                                    placeholder="https://example.com/gymvault/webhooks"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Events</label>
                                  <div className="flex flex-wrap gap-2">
                                    {WEBHOOK_EVENT_OPTIONS.map((eventName) => {
                                      const isActive = webhookForm.events.includes(eventName);
                                      return (
                                        <button
                                          type="button"
                                          key={eventName}
                                          onClick={() => toggleWebhookEvent(eventName)}
                                          className={`px-3 py-1.5 rounded-full text-xs font-black transition-all ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                        >
                                          {eventName}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Signing Secret</label>
                                  <input
                                    value={webhookForm.secret}
                                    onChange={(e) => setWebhookForm((prev) => ({ ...prev, secret: e.target.value }))}
                                    placeholder={webhookForm.id ? 'Leave blank to keep current secret' : 'Optional HMAC secret'}
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold outline-none"
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">Webhook Active</p>
                                    <p className="text-xs text-slate-500 mt-1">Inactive endpoints stay saved but do not receive events.</p>
                                  </div>
                                  <button type="button" onClick={() => setWebhookForm((prev) => ({ ...prev, is_active: !prev.is_active }))} className={`relative w-11 h-6 rounded-full transition-colors ${webhookForm.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${webhookForm.is_active ? 'translate-x-5' : ''}`} />
                                  </button>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-3">
                                  <button type="button" onClick={saveWebhook} disabled={webhookSaving} className="flex-1 px-4 py-3 rounded-xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 transition-all disabled:opacity-60">
                                    {webhookSaving ? 'Saving...' : webhookForm.id ? 'Update Webhook' : 'Create Webhook'}
                                  </button>
                                  <button type="button" onClick={resetWebhookForm} className="px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-600 font-black text-sm hover:bg-slate-50 transition-all">
                                    Reset
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                                {platformData.webhooks.length === 0 ? (
                                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm font-medium">No webhooks configured yet.</div>
                                ) : (
                                  platformData.webhooks.map((webhook) => (
                                    <div key={webhook.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="text-sm font-black text-slate-900 break-all">{webhook.url}</p>
                                          <div className="flex flex-wrap gap-1.5 mt-2">
                                            {(webhook.events || []).map((eventName) => (
                                              <span key={eventName} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-500">{eventName}</span>
                                            ))}
                                          </div>
                                          <p className="text-xs font-semibold text-slate-500 mt-2">Last triggered: {webhook.last_triggered_at ? new Date(webhook.last_triggered_at).toLocaleString() : 'Never'} • {webhook.has_secret ? 'Signed' : 'Unsigned'}</p>
                                        </div>
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase shrink-0 ${webhook.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{webhook.is_active ? 'Active' : 'Disabled'}</span>
                                      </div>
                                      <div className="flex flex-wrap gap-2 mt-4">
                                        <button type="button" onClick={() => editWebhook(webhook)} className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider hover:bg-slate-100 transition-all">Edit</button>
                                        <button type="button" onClick={() => testWebhook(webhook.id)} disabled={webhookTestingId === webhook.id} className="px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider hover:bg-indigo-100 transition-all disabled:opacity-60 flex items-center gap-2">
                                          <Send size={13} /> {webhookTestingId === webhook.id ? 'Testing...' : 'Send Test'}
                                        </button>
                                        <button type="button" onClick={() => deleteWebhook(webhook.id)} className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-black uppercase tracking-wider hover:bg-rose-100 transition-all">Delete</button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-4">
                              <div>
                                <h4 className="font-black text-slate-900 text-sm">WhatsApp Delivery Tracking</h4>
                                <p className="text-xs text-slate-500 mt-0.5">Delivery receipts stay here in Settings only. Nothing new appears on the main app screens.</p>
                              </div>
                              <button type="button" onClick={loadPlatform} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-black hover:bg-slate-50 transition-colors">
                                <RefreshCw size={14} /> Refresh Status
                              </button>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-4">
                              <div className="space-y-4">
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                  <div className="flex items-center justify-between gap-3 mb-3">
                                    <div>
                                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">MSG91 Callback URL</p>
                                      <p className="text-xs text-slate-500 mt-1">Paste this into MSG91 WhatsApp outbound webhook settings.</p>
                                    </div>
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${platformData.whatsapp_delivery?.webhook_token_configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                      {platformData.whatsapp_delivery?.webhook_token_configured ? 'Token Protected' : 'Open URL'}
                                    </span>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <p className="text-sm font-bold text-slate-800 break-all">{platformData.whatsapp_delivery?.callback_url || 'Callback URL will appear here after platform settings load.'}</p>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mt-3">
                                    <button type="button" onClick={copyDeliveryCallbackToClipboard} disabled={!platformData.whatsapp_delivery?.callback_url} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center gap-2">
                                      {copiedDeliveryCallback ? <Check size={13} /> : <Link size={13} />} {copiedDeliveryCallback ? 'Copied' : 'Copy URL'}
                                    </button>
                                    {platformData.whatsapp_delivery?.docs_url && (
                                      <a href={platformData.whatsapp_delivery.docs_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-black uppercase tracking-wider hover:bg-slate-50 transition-all">
                                        MSG91 Guide
                                      </a>
                                    )}
                                  </div>
                                  <p className="text-[11px] font-semibold text-slate-600 leading-relaxed mt-3">
                                    In MSG91 open <span className="font-black text-slate-700">WhatsApp → Webhook</span> or <span className="font-black text-slate-700">Webhook (New)</span>, then paste this URL for outbound delivery reports. MSG91 may retry duplicate callbacks, so GymVault keeps these updates idempotent.
                                  </p>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-5 gap-3">
                                  <div className="min-w-0 min-h-[92px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] leading-tight text-slate-400 break-words">30d Total</p>
                                    <p className="text-2xl font-black text-slate-900 mt-1">{platformData.whatsapp_delivery?.summary?.total_count || 0}</p>
                                  </div>
                                  <div className="min-w-0 min-h-[92px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] leading-tight text-slate-400 break-words">In Flight</p>
                                    <p className="text-2xl font-black text-indigo-600 mt-1">{platformData.whatsapp_delivery?.summary?.in_flight_count || 0}</p>
                                  </div>
                                  <div className="min-w-0 min-h-[92px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] leading-tight text-slate-400 break-words">Delivered</p>
                                    <p className="text-2xl font-black text-teal-600 mt-1">{platformData.whatsapp_delivery?.summary?.delivered_count || 0}</p>
                                  </div>
                                  <div className="min-w-0 min-h-[92px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] leading-tight text-slate-400 break-words">Read</p>
                                    <p className="text-2xl font-black text-emerald-600 mt-1">{platformData.whatsapp_delivery?.summary?.read_count || 0}</p>
                                  </div>
                                  <div className="min-w-0 min-h-[92px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.18em] leading-tight text-slate-400 break-words">Failed</p>
                                    <p className="text-2xl font-black text-rose-600 mt-1">{platformData.whatsapp_delivery?.summary?.failed_count || 0}</p>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                  {DELIVERY_LOG_FILTERS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => setDeliveryLogFilter(option.value)}
                                      className={`px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-colors ${deliveryLogFilter === option.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>

                                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                                {visibleDeliveryLogs.length === 0 ? (
                                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm font-medium">{deliveryLogFilter === 'ALL' ? 'No WhatsApp delivery logs yet.' : `No ${activeDeliveryFilterLabel.toLowerCase()} logs yet.`}</div>
                                ) : (
                                  visibleDeliveryLogs.map((log) => {
                                    const statusMeta = getWhatsAppDeliveryMeta(log.current_status);
                                    const activity = getWhatsAppDeliveryActivity(log);
                                    return (
                                      <div key={log.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                          <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="text-sm font-black text-slate-900 truncate">{log.recipient_name || 'Unknown recipient'}</p>
                                              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">{String(log.source_kind || 'WHATSAPP').replace(/_/g, ' ')}</span>
                                            </div>
                                            <p className="text-xs font-semibold text-slate-500 mt-1">{log.recipient_number || 'No phone'} • {log.template_title || log.template_key || 'Template not recorded'}</p>
                                            <p className="text-xs font-semibold text-slate-500 mt-2">{activity.label}: {activity.time ? new Date(activity.time).toLocaleString() : 'Waiting for update'}</p>
                                            {log.status_detail && (
                                              <p className="text-[11px] font-semibold text-rose-600 leading-relaxed mt-2">{log.status_detail}</p>
                                            )}
                                          </div>
                                          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusMeta.pill}`}>{statusMeta.label}</span>
                                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{log.provider_status || 'No provider status yet'}</span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {activeTab === 'data' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Data & Backup</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Export your data anytime. You own your data.</p>
              
              <div className="space-y-4">
                <div className="border border-slate-200 rounded-2xl bg-white p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-slate-800">Bulk Member Import</h3>
                      <p className="text-xs text-slate-500 mt-1">Paste CSV rows with <span className="font-bold">full_name,email,phone</span>. Preview first, then import live members in one step.</p>
                    </div>
                    <button type="button" onClick={() => setImportForm((prev) => ({ ...prev, csv_text: IMPORT_SAMPLE_CSV }))} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all">Load Sample</button>
                  </div>
                  <textarea
                    rows={8}
                    value={importForm.csv_text}
                    onChange={(e) => setImportForm((prev) => ({ ...prev, csv_text: e.target.value }))}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 resize-y outline-none"
                    placeholder="full_name,email,phone"
                  />
                  <div className="flex flex-col sm:flex-row gap-3 mt-4">
                    <button type="button" onClick={() => importMembers(true)} disabled={importSubmitting} className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 transition-all disabled:opacity-60">
                      {importSubmitting && importForm.dry_run ? 'Previewing...' : 'Preview Import'}
                    </button>
                    <button type="button" onClick={() => importMembers(false)} disabled={importSubmitting} className="flex-1 px-4 py-3 rounded-xl bg-slate-900 text-white font-black text-sm hover:bg-slate-800 transition-all disabled:opacity-60">
                      {importSubmitting && !importForm.dry_run ? 'Importing...' : 'Import Members'}
                    </button>
                  </div>

                  {importResult && (
                    <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rows</p>
                          <p className="text-xl font-black text-slate-900 mt-1">{importResult.total_rows || 0}</p>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valid</p>
                          <p className="text-xl font-black text-emerald-600 mt-1">{importResult.valid_rows || 0}</p>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Imported</p>
                          <p className="text-xl font-black text-indigo-600 mt-1">{importResult.imported_count || 0}</p>
                        </div>
                        <div className="rounded-xl bg-white border border-slate-200 p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Errors</p>
                          <p className="text-xl font-black text-rose-600 mt-1">{importResult.error_count || 0}</p>
                        </div>
                      </div>
                      {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                        <div className="rounded-xl bg-white border border-rose-100 p-4">
                          <p className="text-xs font-black uppercase tracking-widest text-rose-500 mb-3">Validation Errors</p>
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {importResult.errors.map((errorItem, index) => (
                              <div key={`${errorItem.row}-${index}`} className="text-sm font-semibold text-slate-700 border border-slate-100 rounded-xl px-3 py-2">
                                Row {errorItem.row}: {errorItem.error}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Members List</h3><p className="text-xs text-slate-500 mt-1">Download a full CSV of all active, expired, and unpaid members.</p></div>
                  <button onClick={() => downloadExport('/api/exports/members', 'members-export.csv')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Payment History</h3><p className="text-xs text-slate-500 mt-1">Download all financial transactions for accounting purposes.</p></div>
                  <button onClick={() => downloadExport('/api/exports/payments', 'payments-export.csv')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Attendance Records</h3><p className="text-xs text-slate-500 mt-1">Download check-in history (last 5000 records).</p></div>
                  <button onClick={() => downloadExport('/api/exports/attendance', 'attendance-export.csv')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Leads</h3><p className="text-xs text-slate-500 mt-1">Download all lead enquiries and follow-up data.</p></div>
                  <button onClick={() => downloadExport('/api/exports/leads', 'leads-export.csv')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Expenses</h3><p className="text-xs text-slate-500 mt-1">Download all expense records for bookkeeping.</p></div>
                  <button onClick={() => downloadExport('/api/exports/expenses', 'expenses-export.csv')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Security Settings</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Advanced protection for your gym's data.</p>
              
              <div className="border border-slate-200 rounded-2xl p-6 bg-white mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2"><Smartphone size={18}/> Two-Factor Authentication</h3>
                  <button onClick={() => setTwoFactor(!twoFactor)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${twoFactor ? 'bg-emerald-500' : 'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${twoFactor ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                </div>
                <p className="text-sm text-slate-500">Require an OTP sent to your phone number every time you log in from a new device.</p>
              </div>

              <div className="border border-slate-200 rounded-2xl p-6 bg-white">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Monitor size={18}/> Active Sessions</h3>
                <div className="flex items-center justify-between py-3 border-b border-slate-100">
                  <div><p className="font-bold text-sm text-slate-800">Windows &bull; Chrome Browser</p><p className="text-xs text-emerald-500 font-bold">Current Session</p></div><Globe size={20} className="text-slate-300" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">System Preferences</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Configure how GymVault behaves for your region.</p>
              
              <form onSubmit={handlePreferencesSave} className="space-y-6 max-w-3xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Currency Symbol</label>
                    <select value={gymData.currency} onChange={e => setGymData({...gymData, currency: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                      <option value="₹">INR (₹)</option><option value="$">USD ($)</option><option value="€">EUR (€)</option><option value="£">GBP (£)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Time Zone</label>
                    <select value={gymData.timezone} onChange={e => setGymData({...gymData, timezone: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option><option value="America/New_York">America/New_York (EST)</option><option value="Europe/London">Europe/London (GMT)</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end pt-4"><button type="submit" disabled={isSaving} className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-70"><Save size={16} /> {isSaving ? 'Saving...' : 'Save Preferences'}</button></div>
              </form>
            </div>
          )}

          {activeTab === 'interface' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Interface Preferences</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Apply real interface behavior changes across the app.</p>

              <div className="space-y-4 max-w-3xl">
                <div className="border border-slate-200 rounded-2xl p-6 bg-white">
                  <div className="flex justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0">
                        <Moon size={16} className="text-indigo-300" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm mb-0.5">Dark Mode</h3>
                        <p className="text-xs text-slate-500">Switch the entire app to a dark theme. Easy on the eyes in low-light environments.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const next = { ...interfacePreferences, dark_mode: !interfacePreferences.dark_mode };
                        setInterfacePreferences(next);
                        applyInterfacePreferences(next);
                        saveInterfacePreferencesLocal(next);
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${interfacePreferences.dark_mode ? 'bg-indigo-600' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${interfacePreferences.dark_mode ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl p-6 bg-white">
                  <div className="flex justify-between items-center gap-4">
                    <div><h3 className="font-bold text-slate-900 text-sm mb-1">Reduce Motion</h3><p className="text-xs text-slate-500">Turns off most animations and transitions across the dashboard.</p></div>
                    <button onClick={() => setInterfacePreferences((prev) => ({ ...prev, reduce_motion: !prev.reduce_motion }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${interfacePreferences.reduce_motion ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${interfacePreferences.reduce_motion ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl p-6 bg-white">
                  <div className="flex justify-between items-center gap-4">
                    <div><h3 className="font-bold text-slate-900 text-sm mb-1">Compact Layout</h3><p className="text-xs text-slate-500">Reduces page spacing and header height for a denser dashboard layout.</p></div>
                    <button onClick={() => setInterfacePreferences((prev) => ({ ...prev, compact_mode: !prev.compact_mode }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${interfacePreferences.compact_mode ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${interfacePreferences.compact_mode ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                  </div>
                </div>

                <div className="flex justify-end pt-2"><button type="button" disabled={isSaving} onClick={handleInterfaceSave} className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-70"><Save size={16} /> {isSaving ? 'Saving...' : 'Save Interface Preferences'}</button></div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && (
            <div className="animate-in fade-in duration-300 max-w-3xl">
              <h2 className="text-2xl font-black text-rose-600 mb-1 flex items-center gap-2"><AlertOctagon size={24} /> Danger Zone</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Irreversible actions that will permanently destroy your data.</p>
              <div className="border border-rose-200 bg-rose-50/50 rounded-2xl p-6 mb-6">
                <h3 className="font-bold text-rose-900 mb-1">Delete GymVault Account</h3>
                <p className="text-sm text-rose-700 mb-4">Once you delete your gym, there is no going back. All members, attendance logs, and payment data will be permanently wiped.</p>
                <div className="flex flex-col gap-3 max-w-sm">
                  <label className="text-xs font-bold text-rose-800 uppercase">Type "DELETE" to confirm</label>
                  <input type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="px-4 py-3 bg-white border border-rose-200 rounded-xl text-sm font-black text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all" />
                  <button onClick={handleDeleteGym} disabled={deleteConfirm !== 'DELETE'} className="flex items-center justify-center gap-2 bg-rose-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-rose-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 size={16} /> Permanently Delete Gym</button>
                </div>
              </div>
            </div>
          )}

          {['automation', 'reports'].includes(activeTab) && (
            <div className="h-full flex flex-col items-center justify-center text-center pt-20 animate-in fade-in zoom-in-95 duration-500 max-w-3xl">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6 border-4 border-white shadow-xl">{(() => { const ActiveIcon = TABS.find(t => t.id === activeTab)?.icon; return ActiveIcon ? <ActiveIcon size={32} /> : null; })()}</div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">Coming Soon</h2>
              <p className="text-slate-500 max-w-md mx-auto font-medium">The <span className="font-bold text-indigo-500">{TABS.find(t => t.id === activeTab)?.label}</span> module is scheduled for the next major software update.</p>
            </div>
          )}
        </div>
      </div>

      {whatsappOnboardingOpen && (
        <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="w-full h-full bg-white rounded-[28px] shadow-2xl overflow-hidden flex flex-col xl:flex-row">
            <div className="w-full xl:w-[360px] border-b xl:border-b-0 xl:border-r border-slate-200 bg-slate-50/80 p-5 sm:p-6 overflow-y-auto">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">WhatsApp Onboarding</p>
                  <h3 className="text-xl font-black text-slate-900 mt-2">Connect {integrationData.whatsapp_number || 'your business number'}</h3>
                  <p className="text-sm font-medium text-slate-500 mt-2">MSG91 and Meta stay inside this workspace so the owner can finish setup without leaving GymVault.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setWhatsAppOnboardingOpen(false)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-black hover:bg-slate-100 transition-colors"
                >
                  <ArrowLeft size={14} /> Back
                </button>
              </div>

              <div className="mt-5 space-y-2">
                {Object.entries(WHATSAPP_ONBOARDING_VIEWS).map(([viewId, viewMeta]) => {
                  const ViewIcon = viewMeta.icon;
                  const active = whatsappOnboardingView === viewId;
                  return (
                    <button
                      key={viewId}
                      type="button"
                      onClick={() => switchWhatsAppOnboardingView(viewId)}
                      className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${active ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-900/10' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${active ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <ViewIcon size={18} />
                        </div>
                        <div>
                          <p className="text-sm font-black">{viewMeta.label}</p>
                          <p className={`text-xs mt-1 leading-relaxed ${active ? 'text-white/75' : 'text-slate-500'}`}>{viewMeta.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 space-y-3">
                {[
                  {
                    label: 'Business number saved in GymVault',
                    done: Boolean(String(integrationData.whatsapp_number || '').trim()),
                  },
                  {
                    label: 'MSG91 login and number onboarding',
                    done: ['PENDING_CONNECTION', 'CONNECTED'].includes(String(integrationData.whatsapp_status || '').toUpperCase()),
                  },
                  {
                    label: 'Meta verification completed',
                    done: String(integrationData.whatsapp_status || '').toUpperCase() === 'CONNECTED',
                  },
                  {
                    label: 'GymVault status refreshed',
                    done: String(integrationData.whatsapp_status || '').toUpperCase() === 'CONNECTED',
                  },
                ].map((step) => (
                  <div key={step.label} className={`rounded-2xl border px-4 py-3 ${step.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <CheckCircle size={16} className={step.done ? 'text-emerald-600' : 'text-slate-300'} />
                      <p className={`text-sm font-semibold ${step.done ? 'text-emerald-700' : 'text-slate-600'}`}>{step.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={handleRefreshWhatsAppOnboarding}
                  disabled={whatsappOnboardingRefreshing}
                  className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <RefreshCw size={15} className={whatsappOnboardingRefreshing ? 'animate-spin' : ''} /> {whatsappOnboardingRefreshing ? 'Refreshing...' : 'Refresh Connection Status'}
                </button>
                <button
                  type="button"
                  onClick={openWhatsAppOnboardingPopup}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-black text-sm hover:bg-slate-100 transition-all flex items-center justify-center gap-2"
                >
                  <Link size={15} /> Open Current Step In Popup
                </button>
                <button
                  type="button"
                  onClick={() => window.open(whatsappOnboarding.support_url, 'gymvault_whatsapp_support', 'width=1080,height=760')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-700 font-black text-sm hover:bg-slate-200 transition-all"
                >
                  Provider Support Slot
                </button>
                <p className="text-[11px] font-semibold text-slate-500 leading-relaxed">
                  {integrationData.whatsapp_status === 'CONNECTED'
                    ? 'This business number is already connected. You can still use the workspace to review MSG91 or Meta settings.'
                    : 'Meta and MSG91 may still ask for one-time verification, OTP confirmation, or business details. Finish those steps here, then refresh the GymVault status.'}
                </p>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col bg-white">
              <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Embedded Provider View</p>
                  <h4 className="text-base font-black text-slate-900 mt-1">{activeWhatsAppOnboardingView.label}</h4>
                  <p className="text-xs font-medium text-slate-500 mt-1 break-all">{activeWhatsAppOnboardingUrl}</p>
                </div>
                <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-black uppercase tracking-wider ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).card} ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).text}`}>
                  <span className={`w-2 h-2 rounded-full ${getWhatsAppConnectionMeta(integrationData.whatsapp_status).dot}`} />
                  {getWhatsAppConnectionMeta(integrationData.whatsapp_status).label}
                </span>
              </div>

              <div className="relative flex-1 bg-slate-100 min-h-[420px]">
                {whatsappOnboardingFrameLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-100/90 text-slate-500">
                    <RefreshCw size={22} className="animate-spin" />
                    <p className="text-sm font-semibold text-center px-6">Loading the provider workspace inside GymVault.</p>
                  </div>
                )}
                <iframe
                  key={whatsappOnboardingFrameKey}
                  title={activeWhatsAppOnboardingView.label}
                  src={activeWhatsAppOnboardingUrl}
                  onLoad={() => setWhatsAppOnboardingFrameLoading(false)}
                  className="w-full h-full border-0 bg-white"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          </div>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }`}} />
    </div>
  );
};

export default SettingsPage;