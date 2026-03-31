import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  User, Building2, Users, Bell, CreditCard, Blocks, 
  ShieldCheck, Database, Sliders, Palette, Zap, 
  FileText, AlertOctagon, Save, Lock, Trash2,
  CheckCircle, Plus, Download, Smartphone, Monitor, Globe,
  Mail, Phone, MapPin, Link, FileDigit, Fingerprint, Camera, 
  RefreshCw, Check, HardDrive, AlertTriangle, ToggleRight, ToggleLeft, Star, Crown
} from 'lucide-react';

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

const SAAS_PLANS = {
  monthly: [
    { id: 'basic', name: 'Basic', price: 999, billed: 999, features: ['Up to 100 Members', 'Basic Analytics', '1 Staff Account', 'Email Support'], icon: Star, color: 'text-blue-500', bg: 'bg-blue-50' },
    { id: 'pro', name: 'Pro Vault', price: 1999, billed: 1999, features: ['Unlimited Members', 'AI Financial Insights', 'Auto WhatsApp Alerts', '3 Staff Accounts'], icon: Zap, popular: true, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 'elite', name: 'Elite', price: 3999, billed: 3999, features: ['Multi-Branch Support', 'Custom Branded App', 'Dedicated Manager', 'Unlimited Staff'], icon: Crown, color: 'text-rose-500', bg: 'bg-rose-50' }
  ],
  annual: [
    { id: 'basic', name: 'Basic', price: 839, billed: 10068, features: ['Up to 100 Members', 'Basic Analytics', '1 Staff Account', 'Email Support'], icon: Star, color: 'text-blue-500', bg: 'bg-blue-50' },
    { id: 'pro', name: 'Pro Vault', price: 1666, billed: 19992, features: ['Unlimited Members', 'AI Financial Insights', 'Auto WhatsApp Alerts', '3 Staff Accounts'], icon: Zap, popular: true, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 'elite', name: 'Elite', price: 3333, billed: 39996, features: ['Multi-Branch Support', 'Custom Branded App', 'Dedicated Manager', 'Unlimited Staff'], icon: Crown, color: 'text-rose-500', bg: 'bg-rose-50' }
  ]
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

const loadRazorpayScript = () => {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

const apiOrigin = (import.meta.env.VITE_API_URL || 'http://localhost:5000').trim();

// 🚨 FIX: Added defaultTab to the props here!
  const SettingsPage = ({ toast, token, defaultTab }) => { 
    const razorpayKey = import.meta.env.VITE_RAZORPAY_KEY_ID;
  
  // 🚨 FIX: Made it fallback to lowercase 'account' to match your TABS array
  const [activeTab, setActiveTab] = useState(defaultTab ? defaultTab.toLowerCase() : 'account');

  useEffect(() => {
      if (defaultTab) {
          // 🚨 FIX: Force lowercase so 'Billing' successfully matches 'billing'
          setActiveTab(defaultTab.toLowerCase());
      }
  }, [defaultTab]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [localInvoice, setLocalInvoice] = useState(null); 
  
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [autoRenew, setAutoRenew] = useState(true);

  const fileInputRef = useRef(null); 
  const [profileImage, setProfileImage] = useState(null); 
  const [previewUrl, setPreviewUrl] = useState(null); 

  const [accountData, setAccountData] = useState({ 
    full_name: '', email: '', phone: '', 
    current_password: '', new_password: '', confirm_password: '' 
  });
  
  const [gymData, setGymData] = useState({ 
    name: '', phone: '', email: '', address: '', 
    currency: '₹', timezone: 'Asia/Kolkata', tax_id: '', website: '',
    saas_status: 'FREE_TRIAL', saas_valid_until: '', current_plan: 'pro', saas_billing_cycle: 'monthly'
  });

  const [usageData, setUsageData] = useState({
      members: 0,
      staff: 1,
      storage: 0.1
  });

  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [connectingGateway, setConnectingGateway] = useState(false);
  const [disconnectingGateway, setDisconnectingGateway] = useState(false);
  const [showLinkedAccountForm, setShowLinkedAccountForm] = useState(false);
  const [linkedAccountSaving, setLinkedAccountSaving] = useState(false);
  const [linkedAccountForm, setLinkedAccountForm] = useState({
    legal_business_name: '',
    business_email: '',
    business_phone: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [integrationData, setIntegrationData] = useState({
    owner_mobile: '',
    gateway_connected: false,
    whatsapp_mode: 'UNAVAILABLE',
    whatsapp_ready: false,
    sms_ready: false,
    bulk_enabled: false,
    bulk_monthly_limit: 500,
    bulk_per_campaign_limit: 50,
    bulk_channels: { whatsapp: true, sms: false },
    monthly_usage: 0,
    monthly_remaining: 500,
    templates: DEFAULT_MESSAGE_TEMPLATES,
    member_payments: {
      enabled: false,
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
    channel: 'WHATSAPP',
    to: '',
    message: 'Test message from GymVault integration setup.',
  });

  const [darkMode, setDarkMode] = useState(false);
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

  const headers = { headers: { 'x-auth-token': token } };

  const fetchSettings = async () => {
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
              setPreviewUrl(`${apiOrigin}${res.data.account.profile_pic}`);
          }
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
            saas_billing_cycle: res.data.gym.saas_billing_cycle || 'monthly'
          }));
          
          if (res.data.gym.saas_billing_cycle) {
              setBillingCycle(res.data.gym.saas_billing_cycle);
          }
      }

      if (res.data.usage) {
          setUsageData(res.data.usage);
      }

    } catch (err) {
      console.error("Fetch Settings Error:", err);
      toast("Failed to load settings. Please check backend terminal.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [token]);

  const fetchStaff = async () => {
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
  };

  useEffect(() => {
    if (activeTab === 'staff') {
      fetchStaff();
    }
  }, [activeTab, token]);

  const loadIntegrations = async () => {
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
        gateway_connected: Boolean(payload.gateway_connected),
        whatsapp_mode: String(payload.whatsapp_mode || 'UNAVAILABLE'),
        whatsapp_ready: Boolean(payload.whatsapp_ready),
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

      setIntegrationTest((prev) => ({
        ...prev,
        channel: String(payload.whatsapp_mode || 'UNAVAILABLE') === 'SANDBOX' ? 'SMS' : prev.channel,
      }));
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to load integration settings.', 'error');
    } finally {
      setIntegrationLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'integrations') {
      loadIntegrations();
    }
  }, [activeTab, token]);

  const handleIntegrationSave = async (e) => {
    e.preventDefault();
    setIntegrationSaving(true);
    try {
      await axios.put('/api/settings/integrations', {
        ...integrationData,
        templates: integrationData.templates,
        member_payments: {
          enabled: Boolean(integrationData.member_payments?.enabled),
          connect_mode: String(integrationData.member_payments?.connect_mode || 'MANUAL').toUpperCase(),
          razorpay_key_id: String(integrationData.member_payments?.razorpay_key_id || '').trim(),
          razorpay_key_secret: String(integrationData.member_payments?.razorpay_key_secret || '').trim(),
          has_razorpay_secret: Boolean(integrationData.member_payments?.has_razorpay_secret),
          upi_id: String(integrationData.member_payments?.upi_id || '').trim(),
        },
      }, headers);
      toast('Messaging integration saved successfully.', 'success');
      await loadIntegrations();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to save integration settings.', 'error');
    } finally {
      setIntegrationSaving(false);
    }
  };

  const handleTestMessage = async (e) => {
    e.preventDefault();
    if (!integrationTest.to.trim() || !integrationTest.message.trim()) {
      toast('Test recipient and message are required.', 'warning');
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
    const f = linkedAccountForm;
    if (!f.legal_business_name.trim() || !f.business_email.trim() || !f.city.trim() || !f.state.trim() || !f.pincode.trim()) {
      toast('Business name, email, city, state and pincode are required.', 'warning');
      return;
    }
    setLinkedAccountSaving(true);
    try {
      const res = await axios.post('/api/memberships/online/linked-account/create', f, headers);
      toast(res.data?.message || 'Razorpay linked account created!', 'success');
      setShowLinkedAccountForm(false);
      setLinkedAccountForm({ legal_business_name: '', business_email: '', business_phone: '', city: '', state: '', pincode: '' });
      await loadIntegrations();
    } catch (err) {
      toast(err?.response?.data?.error || 'Failed to create linked account.', 'error');
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
  const getDerivedStatus = () => {
      if (!gymData.saas_valid_until || gymData.saas_status === 'FREE_TRIAL') return 'FREE_TRIAL';
      
      const validUntil = new Date(gymData.saas_valid_until);
      const now = new Date();
      const diffDays = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      if (gymData.saas_status === 'EXPIRED' || diffDays <= -3) return 'EXPIRED';
      if (gymData.saas_status === 'GRACE_PERIOD' || (diffDays < 0 && diffDays > -3)) return 'GRACE_PERIOD';
      return 'ACTIVE';
  };

  const realStatus = getDerivedStatus();
  const isLockedOut = realStatus === 'EXPIRED';

  // Force Tab to Billing if Locked Out
  useEffect(() => {
      if (isLockedOut && activeTab !== 'billing') {
          setActiveTab('billing');
      }
  }, [isLockedOut, activeTab]);

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

          const options = {
              key: razorpayKey,
              amount: order.amount,
              currency: order.currency,
              name: `GymVault ${selectedPlan.name}`,
              description: `${billingCycle === 'annual' ? 'Annual' : 'Monthly'} Software Subscription`,
              order_id: order.id,
              handler: async function (response) {
                  try {
                      // 1. Optimistic UI Update
                      setGymData(prev => ({
                          ...prev,
                          saas_status: 'ACTIVE',
                          current_plan: selectedPlan.id,
                          saas_billing_cycle: billingCycle,
                          saas_valid_until: new Date(Date.now() + (billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString()
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
                      console.error("Backend Sync Error:", err);
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
              theme: { color: "#4f46e5" }
          };

              if (!options.key) {
                toast("Payment key not configured. Please set VITE_RAZORPAY_KEY_ID.", "error");
                setIsProcessingPayment(false);
                return;
              }

          const paymentObject = new window.Razorpay(options);
          paymentObject.on('payment.failed', function (response){
              toast("Payment cancelled or failed.", "error");
              setIsProcessingPayment(false);
          });
          paymentObject.open();

      } catch (err) {
          toast("Server error while initiating payment.", "error");
          setIsProcessingPayment(false);
      }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfileImage(file);
      setPreviewUrl(URL.createObjectURL(file));
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

    if (accountData.new_password) {
        if (accountData.new_password !== accountData.confirm_password) {
            setIsSaving(false);
            return toast('New passwords do not match!', 'error');
        }
        formData.append('current_password', accountData.current_password);
        formData.append('new_password', accountData.new_password);
    }

    try {
      await axios.put('/api/settings/account', formData, {
        headers: { 'x-auth-token': token, 'Content-Type': 'multipart/form-data' }
      });
      await axios.put('/api/settings/gym', gymData, headers);
      toast('Profile & Business details updated successfully!', 'success');
      setAccountData(prev => ({ ...prev, current_password: '', new_password: '', confirm_password: '' })); 
      setProfileImage(null);
    } catch (err) {
      toast(err.response?.data?.error || "Failed to update details", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreferencesSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await axios.put('/api/settings/preferences', { currency: gymData.currency, timezone: gymData.timezone }, headers);
      toast('System preferences saved!', 'success');
    } catch (err) {
      toast("Failed to update preferences", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGym = async () => {
    if (deleteConfirm !== 'DELETE') {
      return toast('Please type DELETE to confirm', 'error');
    }
    try {
      await axios.delete('/api/settings/nuke', headers);
      window.location.href = '/login'; 
    } catch (err) {
      toast("Failed to delete account", "error");
    }
  };

  const formatExpiry = (date) => {
      if (!date || isNaN(new Date(date).getTime())) return 'N/A';
      return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const ProgressBar = ({ label, current, max, icon: Icon, unit = '' }) => {
      const percentage = max === 'Unlimited' ? 100 : Math.min(100, (current / max) * 100);
      const isNearLimit = max !== 'Unlimited' && percentage > 85;
      return (
          <div className="mb-4 last:mb-0">
              <div className="flex justify-between text-xs font-bold mb-2">
                  <span className="flex items-center gap-1.5 text-slate-700"><Icon size={14} className="text-indigo-500"/> {label}</span>
                  <span className={isNearLimit ? 'text-rose-500' : 'text-slate-500'}>{current} / {max} {unit}</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-1000 ${max === 'Unlimited' ? 'bg-indigo-500' : isNearLimit ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${percentage}%` }} />
              </div>
          </div>
      )
  };

  if (isLoading) return <div className="p-10 text-center font-bold text-slate-400 animate-pulse">Loading Configurations...</div>;

  return (
    <div className="flex flex-col md:flex-row gap-6 md:h-[calc(100vh-100px)]">
      
      {/* SIDEBAR NAVIGATION */}
      <div className="w-full md:w-64 flex-shrink-0 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar pb-10">
        {['Personal & Business', 'System', 'Customization', 'Advanced', 'Danger'].map(group => (
          <div key={group} className="flex flex-col gap-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-1">{group}</p>
            {TABS.filter(t => t.group === group).map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const isDanger = tab.id === 'danger';
              const isTabDisabled = isLockedOut && tab.id !== 'billing'; // Lockout logic applied here

              return (
                <button
                  key={tab.id}
                  disabled={isTabDisabled}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
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
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex-1 bg-white/80 backdrop-blur-xl border border-white/60 rounded-[28px] shadow-sm overflow-y-auto relative custom-scrollbar">
        <div className="max-w-4xl p-8 mb-10 mx-auto">
          
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
                        <button type="button" onClick={() => {setPreviewUrl(null); setProfileImage(null);}} className="px-4 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">Remove</button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Owner Name</label><div className="relative"><User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="text" value={accountData.full_name} onChange={e => setAccountData({...accountData, full_name: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Login Email</label><div className="relative"><Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input required type="email" value={accountData.email} onChange={e => setAccountData({...accountData, email: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Personal Phone</label><div className="relative"><Smartphone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" placeholder="+91 00000 00000" value={accountData.phone} onChange={e => setAccountData({...accountData, phone: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">System Role</label><div className="relative"><ShieldCheck size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-500" /><input disabled type="text" value="Super Administrator" className="w-full pl-11 pr-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-indigo-600 cursor-not-allowed" /></div></div>
                  </div>
                </div>

                <div className="space-y-5">
                  <h3 className="text-xs font-black text-rose-500 uppercase tracking-widest flex items-center gap-2 border-b border-rose-50 pb-3"><Fingerprint size={14} /> Security Updates</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Current Password</label><div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="Verify identity" value={accountData.current_password} onChange={e => setAccountData({...accountData, current_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">New Password</label><div className="relative"><Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="New password" value={accountData.new_password} onChange={e => setAccountData({...accountData, new_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                    <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Confirm Password</label><div className="relative"><CheckCircle size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="password" placeholder="Confirm new password" value={accountData.confirm_password} onChange={e => setAccountData({...accountData, confirm_password: e.target.value})} className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-500/10 focus:border-rose-400 transition-all" /></div></div>
                  </div>
                </div>

                <div className="space-y-5 pt-2">
                  <h3 className="text-xs font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2 border-b border-emerald-50 pb-3"><Building2 size={14} /> Gym Business Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                <form onSubmit={handleAddStaff} className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                <table className="w-full text-left text-sm">
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
                          <p className="text-xs text-amber-700 mt-0.5">Your subscription expired on {formatExpiry(gymData.saas_valid_until)}. You have a few days to renew before your vault is locked.</p>
                      </div>
                  </div>
              )}

              {/* PREMIUM ACTIVE BANNER */}
              {realStatus === 'ACTIVE' && (
                  <div className="mb-8 p-8 bg-slate-900 rounded-[32px] shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden border border-slate-800">
                      <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/10 blur-[100px] pointer-events-none"></div>
                      
                      <div className="relative z-10 flex items-center gap-5">
                          <div className="flex items-center justify-center w-14 h-14 bg-emerald-500/20 rounded-2xl border border-emerald-500/30">
                              <CheckCircle size={28} className="text-emerald-400" />
                          </div>
                          <div>
                              <div className="flex items-center gap-2 mb-1">
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                      Enterprise License
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

              <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 mb-1">Billing & Subscription</h2>
                    <p className="text-sm font-medium text-slate-500">Upgrade to unlock your gym's full potential.</p>
                </div>
                
                {/* Monthly/Annual Toggle */}
                <div className="bg-slate-100 p-1 rounded-xl inline-flex shadow-inner">
                    <button onClick={() => setBillingCycle('monthly')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${billingCycle === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        Monthly
                    </button>
                    <button onClick={() => setBillingCycle('annual')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${billingCycle === 'annual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        Annually <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">Save 16%</span>
                    </button>
                </div>
              </div>
              
              {/* Tiered Pricing Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
                  {SAAS_PLANS[billingCycle].map((plan) => {
                      const Icon = plan.icon;
                      const isCurrentPlan = gymData.current_plan === plan.id;
                      const isActive = realStatus === 'ACTIVE' && isCurrentPlan && gymData.saas_billing_cycle === billingCycle;
                      const isSamePlanDifferentCycle = realStatus === 'ACTIVE' && isCurrentPlan && gymData.saas_billing_cycle !== billingCycle;
                      const needsRenewal = (realStatus === 'EXPIRED' || realStatus === 'GRACE_PERIOD') && isCurrentPlan && gymData.saas_billing_cycle === billingCycle;
                      
                      return (
                          <div key={plan.id} className={`relative flex flex-col p-6 rounded-[28px] transition-all duration-300 ${isActive ? 'bg-indigo-50 border-2 border-indigo-500 shadow-xl scale-[1.02]' : 'bg-white border border-slate-200 hover:border-indigo-300 shadow-sm hover:shadow-xl'}`}>
                              {plan.popular && !isActive && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md">Most Popular</span>}
                              {isActive && <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-md flex items-center gap-1"><CheckCircle size={10}/> Current Plan</span>}
                              
                              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${isActive ? 'bg-indigo-500 text-white' : plan.bg + ' ' + plan.color}`}>
                                  <Icon size={24} />
                              </div>
                              <h3 className="text-xl font-black mb-1 text-slate-900">{plan.name}</h3>
                              <div className="flex items-baseline gap-1 mb-6 text-slate-900">
                                  <span className="text-3xl font-black">₹{plan.price}</span>
                                  <span className="text-sm font-medium text-slate-500">/mo</span>
                              </div>

                              <ul className="space-y-3 mb-8 flex-1">
                                  {plan.features.map((feature, i) => (
                                      <li key={i} className="flex items-start gap-2 text-sm font-medium text-slate-600">
                                          <Check size={16} className={isActive ? 'text-indigo-500 shrink-0' : 'text-slate-400 shrink-0'} />
                                          {feature}
                                      </li>
                                  ))}
                              </ul>

                             <button 
    onClick={() => handleSubscribe(plan)}
    disabled={isProcessingPayment || isActive}
    className={`w-full py-3.5 rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 ${isActive ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 cursor-not-allowed' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}
>
    {isActive 
        ? 'Currently Active' 
        : needsRenewal 
            ? 'Renew Subscription' 
            : isSamePlanDifferentCycle 
                ? `Switch to ${billingCycle === 'annual' ? 'Annual' : 'Monthly'}` 
                : `Upgrade to ${plan.name}`
    }
</button>
                          </div>
                      );
                  })}
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
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 mt-6">
                      <ProgressBar 
                          label="Total Registered Members" 
                          current={usageData.members} 
                          max={gymData.current_plan === 'basic' ? 100 : 'Unlimited'} 
                          icon={Users} 
                      />
                      <ProgressBar 
                          label="Cloud Storage (Images & Backups)" 
                          current={usageData.storage} 
                          max={10} 
                          unit="GB" 
                          icon={HardDrive} 
                      />
                      <ProgressBar 
                          label="Active Staff Accounts" 
                          current={usageData.staff} 
                          max={gymData.current_plan === 'basic' ? 1 : gymData.current_plan === 'pro' ? 3 : 'Unlimited'} 
                          icon={User} 
                      />
                  </div>
              </div>

              {/* Dynamic Invoice & Security Layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
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
                                      {formatExpiry(localInvoice.date)} • #{localInvoice.id.slice(0,10)}...
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
              <p className="text-sm font-medium text-slate-500 mb-8">Owner-friendly messaging setup: only one mobile number + ready templates and limits.</p>

              {integrationLoading ? (
                <div className="p-10 bg-white border border-slate-200 rounded-2xl text-center text-slate-400 font-bold animate-pulse">Loading messaging integrations...</div>
              ) : (
                <div className="space-y-6 max-w-5xl">
                  <form onSubmit={handleIntegrationSave} className="space-y-6">
                    <div className="border border-slate-200 rounded-2xl p-5 bg-white">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-black text-slate-900 text-lg">Messaging Gateway</h3>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${integrationData.gateway_connected ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {integrationData.gateway_connected ? 'Gateway Connected' : 'Gateway Not Connected'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Owner Mobile Number</label>
                          <input
                            value={integrationData.owner_mobile}
                            onChange={(e) => setIntegrationData((prev) => ({ ...prev, owner_mobile: e.target.value }))}
                            placeholder="+91XXXXXXXXXX"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                          <p className="text-[11px] mt-1 text-slate-500 font-medium">Only this number is required from owner side.</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-medium p-3 rounded-xl bg-slate-50 border border-slate-200">
                            Twilio SID/Auth/From numbers are managed by platform admin and hidden from gym owners.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className={`p-3 rounded-xl border ${integrationData.whatsapp_mode === 'PRODUCTION' ? 'bg-emerald-50 border-emerald-200' : integrationData.whatsapp_mode === 'SANDBOX' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                          <p className="text-[11px] uppercase tracking-wider font-black text-slate-500">WhatsApp Mode</p>
                          <p className="text-sm font-black mt-1 text-slate-800">
                            {integrationData.whatsapp_mode === 'PRODUCTION' ? 'Production (real WhatsApp)' : integrationData.whatsapp_mode === 'SANDBOX' ? 'Sandbox (join required)' : 'Not Configured'}
                          </p>
                          {integrationData.whatsapp_mode === 'SANDBOX' && (
                            <p className="text-xs font-semibold mt-1 text-amber-700">Members must join sandbox for WhatsApp. SMS fallback is used when enabled.</p>
                          )}
                        </div>
                        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <p className="text-[11px] uppercase tracking-wider font-black text-slate-500">SMS Fallback</p>
                          <p className="text-sm font-black mt-1 text-slate-800">{integrationData.sms_ready ? 'Ready' : 'Not Configured'}</p>
                          <p className="text-xs font-semibold mt-1 text-slate-500">Configure SMS to send directly without sandbox joining.</p>
                        </div>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-2xl p-5 bg-white">
                      <h3 className="font-black text-slate-900 text-lg mb-4">Bulk Messaging Safety Controls</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <span className="text-sm font-bold text-slate-700">Enable bulk messaging</span>
                          <input
                            type="checkbox"
                            checked={integrationData.bulk_enabled}
                            onChange={(e) => setIntegrationData((prev) => ({ ...prev, bulk_enabled: e.target.checked }))}
                          />
                        </label>

                        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <p className="text-[11px] uppercase tracking-wider font-black text-slate-500">Monthly Usage</p>
                          <p className="text-lg font-black text-slate-900 mt-1">{integrationData.monthly_usage} / {integrationData.bulk_monthly_limit}</p>
                          <p className="text-xs text-slate-500 font-semibold">Remaining: {integrationData.monthly_remaining}</p>
                        </div>

                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Monthly Member Limit</label>
                          <input
                            type="number"
                            min="10"
                            value={integrationData.bulk_monthly_limit}
                            onChange={(e) => setIntegrationData((prev) => ({ ...prev, bulk_monthly_limit: e.target.value }))}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Per Campaign Limit</label>
                          <input
                            type="number"
                            min="1"
                            value={integrationData.bulk_per_campaign_limit}
                            onChange={(e) => setIntegrationData((prev) => ({ ...prev, bulk_per_campaign_limit: e.target.value }))}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                        </div>

                        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <span className="text-sm font-bold text-slate-700">Allow WhatsApp campaigns</span>
                          <input
                            type="checkbox"
                            checked={Boolean(integrationData.bulk_channels?.whatsapp)}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              bulk_channels: { ...(prev.bulk_channels || {}), whatsapp: e.target.checked },
                            }))}
                          />
                        </label>

                        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <span className="text-sm font-bold text-slate-700">Allow SMS campaigns</span>
                          <input
                            type="checkbox"
                            checked={Boolean(integrationData.bulk_channels?.sms)}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              bulk_channels: { ...(prev.bulk_channels || {}), sms: e.target.checked },
                            }))}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-2xl p-5 bg-white">
                      <h3 className="font-black text-slate-900 text-lg mb-4">Campaign Templates</h3>
                      <p className="text-xs text-slate-500 font-medium mb-4">{'Use placeholders: {{name}}, {{plan}}, {{days_left}}, {{gym_name}}'}</p>
                      <div className="space-y-4">
                        {(integrationData.templates || []).map((template, index) => (
                          <div key={template.template_key} className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                            <div className="flex items-center justify-between mb-2">
                              <input
                                value={template.title}
                                onChange={(e) => {
                                  const next = [...integrationData.templates];
                                  next[index] = { ...next[index], title: e.target.value };
                                  setIntegrationData((prev) => ({ ...prev, templates: next }));
                                }}
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-800 w-full max-w-md"
                              />
                              <label className="flex items-center gap-2 ml-3 text-xs font-bold text-slate-600 shrink-0">
                                Active
                                <input
                                  type="checkbox"
                                  checked={template.is_active !== false}
                                  onChange={(e) => {
                                    const next = [...integrationData.templates];
                                    next[index] = { ...next[index], is_active: e.target.checked };
                                    setIntegrationData((prev) => ({ ...prev, templates: next }));
                                  }}
                                />
                              </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">WhatsApp Text</label>
                                <textarea
                                  rows={3}
                                  value={template.whatsapp_text}
                                  onChange={(e) => {
                                    const next = [...integrationData.templates];
                                    next[index] = { ...next[index], whatsapp_text: e.target.value };
                                    setIntegrationData((prev) => ({ ...prev, templates: next }));
                                  }}
                                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">SMS Text</label>
                                <textarea
                                  rows={3}
                                  value={template.sms_text}
                                  onChange={(e) => {
                                    const next = [...integrationData.templates];
                                    next[index] = { ...next[index], sms_text: e.target.value };
                                    setIntegrationData((prev) => ({ ...prev, templates: next }));
                                  }}
                                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 resize-none"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-2xl p-5 bg-white">
                      <h3 className="font-black text-slate-900 text-lg mb-4">Member Online Payments (Gym Collection)</h3>
                      <p className="text-xs text-slate-500 font-medium mb-4">Configure each gym owner's Razorpay account to collect member fees directly for plans.</p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-wider font-black text-slate-500">Connect Status</p>
                            <p className="text-sm font-black mt-1 text-slate-800">
                              {integrationData.member_payments?.onboarding_status === 'CONNECTED' ? 'Connected' : integrationData.member_payments?.onboarding_status === 'AUTHORIZED' ? 'Authorized (final setup pending)' : integrationData.member_payments?.onboarding_status === 'FAILED' ? 'Failed' : 'Not Connected'}
                            </p>
                            {integrationData.member_payments?.connected_account_id && (
                              <p className="text-xs font-semibold mt-1 text-slate-500">Account: {integrationData.member_payments.connected_account_id}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleConnectRazorpay}
                              disabled={connectingGateway}
                              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-black text-xs hover:bg-indigo-700 disabled:opacity-60"
                            >
                              {connectingGateway ? 'Connecting...' : 'Connect Razorpay'}
                            </button>
                            {integrationData.member_payments?.onboarding_status === 'CONNECTED' && (
                              <button
                                type="button"
                                onClick={handleDisconnectRazorpay}
                                disabled={disconnectingGateway}
                                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-xs hover:bg-slate-50 disabled:opacity-60"
                              >
                                {disconnectingGateway ? 'Disconnecting...' : 'Disconnect'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── Linked Account setup (for gym owners without a Razorpay account) ── */}
                        {integrationData.member_payments?.onboarding_status !== 'CONNECTED' && (
                          <div className="md:col-span-2">
                            <button
                              type="button"
                              onClick={() => setShowLinkedAccountForm((v) => !v)}
                              className="text-xs font-bold text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                            >
                              {showLinkedAccountForm ? 'Cancel' : "Don't have a Razorpay account? Set up here →"}
                            </button>

                            {showLinkedAccountForm && (
                              <div className="mt-4 p-4 rounded-xl border border-indigo-100 bg-indigo-50 space-y-3">
                                <p className="text-[11px] font-black uppercase tracking-wider text-indigo-700">Create Razorpay Linked Account</p>
                                <p className="text-xs text-slate-500 font-medium">We create a Razorpay account under GymVault for this gym. Razorpay will email the owner to add their PAN and bank details. Payments start routing immediately after.</p>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="md:col-span-2">
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Legal Business / Gym Name *</label>
                                    <input
                                      required
                                      value={linkedAccountForm.legal_business_name}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, legal_business_name: e.target.value }))}
                                      placeholder="Iron Body Fitness Pvt Ltd"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Owner Email * (Razorpay will contact here)</label>
                                    <input
                                      required
                                      type="email"
                                      value={linkedAccountForm.business_email}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, business_email: e.target.value }))}
                                      placeholder="owner@gym.com"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Owner Mobile (optional)</label>
                                    <input
                                      type="tel"
                                      value={linkedAccountForm.business_phone}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, business_phone: e.target.value }))}
                                      placeholder="9876543210"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">City *</label>
                                    <input
                                      required
                                      value={linkedAccountForm.city}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, city: e.target.value }))}
                                      placeholder="Mumbai"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">State * (e.g. MAHARASHTRA)</label>
                                    <input
                                      required
                                      value={linkedAccountForm.state}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, state: e.target.value }))}
                                      placeholder="MAHARASHTRA"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Pincode *</label>
                                    <input
                                      required
                                      value={linkedAccountForm.pincode}
                                      onChange={(e) => setLinkedAccountForm((p) => ({ ...p, pincode: e.target.value }))}
                                      placeholder="400001"
                                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                                    />
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={handleCreateLinkedAccount}
                                  disabled={linkedAccountSaving}
                                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-black text-xs hover:bg-indigo-700 disabled:opacity-60"
                                >
                                  {linkedAccountSaving ? 'Creating account...' : 'Create & Connect'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 md:col-span-2">
                          <span className="text-sm font-bold text-slate-700">Use connected Razorpay account (best way)</span>
                          <input
                            type="checkbox"
                            checked={String(integrationData.member_payments?.connect_mode || 'MANUAL').toUpperCase() === 'PARTNER'}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              member_payments: {
                                ...(prev.member_payments || {}),
                                connect_mode: e.target.checked ? 'PARTNER' : 'MANUAL',
                              },
                            }))}
                          />
                        </label>

                        <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 md:col-span-2">
                          <span className="text-sm font-bold text-slate-700">Enable member online payments</span>
                          <input
                            type="checkbox"
                            checked={Boolean(integrationData.member_payments?.enabled)}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              member_payments: {
                                ...(prev.member_payments || {}),
                                enabled: e.target.checked,
                              },
                            }))}
                          />
                        </label>

                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Razorpay Key ID</label>
                          <input
                            value={integrationData.member_payments?.razorpay_key_id || ''}
                            disabled={String(integrationData.member_payments?.connect_mode || 'MANUAL').toUpperCase() === 'PARTNER'}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              member_payments: {
                                ...(prev.member_payments || {}),
                                razorpay_key_id: e.target.value,
                              },
                            }))}
                            placeholder="rzp_live_xxxxx"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">Razorpay Key Secret</label>
                          <input
                            type="password"
                            value={integrationData.member_payments?.razorpay_key_secret || ''}
                            disabled={String(integrationData.member_payments?.connect_mode || 'MANUAL').toUpperCase() === 'PARTNER'}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              member_payments: {
                                ...(prev.member_payments || {}),
                                razorpay_key_secret: e.target.value,
                              },
                            }))}
                            placeholder={integrationData.member_payments?.has_razorpay_secret ? 'Saved securely (enter to replace)' : 'rzp_live_secret_xxxxx'}
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">UPI ID (optional for display)</label>
                          <input
                            value={integrationData.member_payments?.upi_id || ''}
                            onChange={(e) => setIntegrationData((prev) => ({
                              ...prev,
                              member_payments: {
                                ...(prev.member_payments || {}),
                                upi_id: e.target.value,
                              },
                            }))}
                            placeholder="yourgym@upi"
                            className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={integrationSaving}
                        className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                      >
                        <Save size={15} /> {integrationSaving ? 'Saving...' : 'Save Integrations'}
                      </button>
                    </div>
                  </form>

                  <form onSubmit={handleTestMessage} className="border border-slate-200 rounded-2xl p-5 bg-white">
                    <h3 className="font-black text-slate-900 text-lg mb-3">Send Test Message</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <select
                        value={integrationTest.channel}
                        onChange={(e) => setIntegrationTest((prev) => ({ ...prev, channel: e.target.value }))}
                        className="px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                      >
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="SMS">SMS</option>
                      </select>
                      <input
                        value={integrationTest.to}
                        onChange={(e) => setIntegrationTest((prev) => ({ ...prev, to: e.target.value }))}
                        placeholder="Recipient phone (+91...)"
                        className="px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold"
                      />
                      <button
                        type="submit"
                        disabled={testSending}
                        className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-black text-sm hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {testSending ? 'Sending...' : 'Send Test'}
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={integrationTest.message}
                      onChange={(e) => setIntegrationTest((prev) => ({ ...prev, message: e.target.value }))}
                      className="w-full mt-3 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold resize-none"
                      placeholder="Test message"
                    />
                  </form>
                </div>
              )}
            </div>
          )}

          {activeTab === 'data' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">Data & Backup</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Export your data anytime. You own your data.</p>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Members List</h3><p className="text-xs text-slate-500 mt-1">Download a full CSV of all active, expired, and unpaid members.</p></div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
                </div>
                <div className="flex items-center justify-between p-5 border border-slate-200 rounded-2xl bg-white hover:border-indigo-300 transition-colors">
                  <div><h3 className="font-bold text-slate-800">Export Payment History</h3><p className="text-xs text-slate-500 mt-1">Download all financial transactions for accounting purposes.</p></div>
                  <button className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-sm hover:bg-indigo-100"><Download size={16} /> CSV</button>
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
                  <div><p className="font-bold text-sm text-slate-800">Windows • Chrome Browser</p><p className="text-xs text-emerald-500 font-bold">Current Session</p></div><Globe size={20} className="text-slate-300" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-900 mb-1">System Preferences</h2>
              <p className="text-sm font-medium text-slate-500 mb-8">Configure how GymVault behaves for your region.</p>
              
              <form onSubmit={handlePreferencesSave} className="space-y-6 max-w-3xl">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Currency Symbol</label>
                    <select value={gymData.currency} onChange={e => setGymData({...gymData, currency: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                      <option value="₹">₹ (INR)</option><option value="$">$ (USD)</option><option value="€">€ (EUR)</option><option value="£">£ (GBP)</option>
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
              <p className="text-sm font-medium text-slate-500 mb-8">Customize how the dashboard looks.</p>
              
              <div className="border border-slate-200 rounded-2xl p-6 bg-white mb-6 max-w-3xl">
                <div className="flex justify-between items-center">
                  <div><h3 className="font-bold text-slate-900 text-sm mb-1">Dark Mode (Coming Soon)</h3><p className="text-xs text-slate-500">Switch the entire dashboard to a dark theme.</p></div>
                  <button onClick={() => setDarkMode(!darkMode)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${darkMode ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                </div>
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
      
      <style dangerouslySetInnerHTML={{__html: `.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }`}} />
    </div>
  );
};

export default SettingsPage;