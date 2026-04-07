import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import axios from 'axios';
import { 
  Search, Filter, Download, Plus, DollarSign, 
  AlertCircle, FileText, CheckCircle2, 
  Clock, X, ChevronDown, User, ArrowDownToLine, History, Wallet, CreditCard, Trash2,
  Phone, MessageCircle, RefreshCw
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import useCountUp from './utils/useCountUp';
import { reportClientError } from './utils/clientErrorReporter';
import { buildUpiCollectionUri, copyCollectionText, describeCollectionLinkDelivery, formatCollectionAmount, openCollectionLink } from './utils/memberCollection';
import { buildReminderPreviewDialog, getReminderPreviewBlockReason, previewWhatsAppReminders, sendWhatsAppReminders, summarizeReminderResult } from './utils/whatsappReminders';
import PaginationControls from './components/PaginationControls';

const extractArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const extractObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return fallback;
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getTodayInputValue = () => new Date().toISOString().slice(0, 10);

const shiftDateInputValue = (dateValue, days) => {
  const baseDate = new Date(`${dateValue}T00:00:00`);
  baseDate.setDate(baseDate.getDate() - days);
  return baseDate.toISOString().slice(0, 10);
};

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

const PaymentSkeletonRow = () => (
  <tr className="border-b border-slate-100">
    <td className="p-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-100 animate-pulse shrink-0" />
        <div className="flex flex-col gap-2">
          <div className="h-3 w-28 bg-slate-100 rounded animate-pulse" />
          <div className="h-2 w-16 bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    </td>
    <td className="p-6"><div className="h-6 w-24 bg-slate-100 rounded animate-pulse" /></td>
    <td className="p-6">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
        <div className="h-2 w-12 bg-slate-100 rounded animate-pulse" />
      </div>
    </td>
    <td className="p-6"><div className="h-4 w-16 bg-slate-100 rounded animate-pulse" /></td>
    <td className="p-6"><div className="h-6 w-16 bg-slate-100 rounded-full animate-pulse" /></td>
    <td className="p-6"><div className="h-8 w-8 bg-slate-100 rounded-full animate-pulse" /></td>
  </tr>
);

const INSIGHT_TONE_STYLES = {
  emerald: {
    wrapper: 'bg-emerald-50 border-emerald-100',
    icon: 'bg-white text-emerald-500',
    title: 'text-emerald-700',
    detail: 'text-emerald-700/80',
  },
  indigo: {
    wrapper: 'bg-indigo-50 border-indigo-100',
    icon: 'bg-white text-indigo-500',
    title: 'text-indigo-700',
    detail: 'text-indigo-700/80',
  },
  orange: {
    wrapper: 'bg-orange-50 border-orange-100',
    icon: 'bg-white text-orange-500',
    title: 'text-orange-700',
    detail: 'text-orange-700/80',
  },
  sky: {
    wrapper: 'bg-sky-50 border-sky-100',
    icon: 'bg-white text-sky-500',
    title: 'text-sky-700',
    detail: 'text-sky-700/80',
  },
  slate: {
    wrapper: 'bg-slate-50 border-slate-100',
    icon: 'bg-white text-slate-500',
    title: 'text-slate-700',
    detail: 'text-slate-600',
  },
  rose: {
    wrapper: 'bg-rose-50 border-rose-100',
    icon: 'bg-white text-rose-500',
    title: 'text-rose-700',
    detail: 'text-rose-700/80',
  },
};

// ─── Main Component ──────────────────────────────────────────────────────────

const PaymentsPage = ({ appRuntime, defaultFilter = 'All', focusPaymentId = null, focusAction = null, onFocusHandled, focusSection = null, onSectionHandled, isActive = true }) => {
  const { token, toast, showConfirm } = appRuntime;
  const [payments, setPayments] = useState([]);
  const [ledgerPayments, setLedgerPayments] = useState([]);
  const [ledgerPagination, setLedgerPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1, hasNext: false, hasPrev: false });
  const [stats, setStats] = useState({ total_revenue: 0, today_revenue: 0, pending_dues: 0 });
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30d');
  const [customDateRange, setCustomDateRange] = useState(() => {
    const today = getTodayInputValue();
    return {
      from: shiftDateInputValue(today, 30),
      to: today,
    };
  });

  const resolveDateRangeBounds = useCallback((range, customRange = customDateRange) => {
    if (range === 'all') {
      return {
        start: null,
        end: null,
        startInput: '',
        endInput: '',
        label: 'All time',
      };
    }

    if (range === 'custom') {
      const startInput = customRange.from || '';
      const endInput = customRange.to || '';

      return {
        start: startInput ? new Date(`${startInput}T00:00:00`) : null,
        end: endInput ? new Date(`${endInput}T23:59:59.999`) : null,
        startInput,
        endInput,
        label: startInput && endInput ? `Custom · ${startInput} to ${endInput}` : 'Custom range',
      };
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 30);

    return {
      start,
      end: null,
      startInput: start.toISOString().slice(0, 10),
      endInput: '',
      label: 'Last 30 days',
    };
  }, [customDateRange]);

  const getDateRangeLabel = useCallback((range) => resolveDateRangeBounds(range).label, [resolveDateRangeBounds]);

  const dateFilteredPayments = useMemo(() => {
    const { start, end } = resolveDateRangeBounds(dateRange);
    if (!start && !end) return payments;

    return payments.filter((payment) => {
      const paymentDate = new Date(payment.payment_date);
      if (Number.isNaN(paymentDate.getTime())) {
        return false;
      }
      if (start && paymentDate < start) return false;
      if (end && paymentDate > end) return false;
      return true;
    });
  }, [payments, dateRange, resolveDateRangeBounds]);

  // Compute filtered stats from date-filtered payments
  const filteredStats = useMemo(() => {
    if (dateRange === 'all') return stats;
    const filtered = dateFilteredPayments;
    const total = filtered.reduce((s, p) => s + (parseFloat(p.amount_paid) || 0), 0);
    const pending = filtered.filter(p => p.status === 'Pending').reduce((s, p) => s + (parseFloat(p.amount_due) || 0), 0);
    const todayStr = new Date().toDateString();
    const todayRev = filtered.filter(p => new Date(p.payment_date).toDateString() === todayStr)
      .reduce((s, p) => s + (parseFloat(p.amount_paid) || 0), 0);
    return { total_revenue: total, today_revenue: todayRev, pending_dues: pending };
  }, [dateRange, dateFilteredPayments, stats]);

  // Count-up animated values for stat cards
  const animatedTotalRevenue = useCountUp(parseFloat(filteredStats.total_revenue || 0));
  const animatedTodayRevenue = useCountUp(parseFloat(filteredStats.today_revenue || 0));
  const animatedPendingDues  = useCountUp(parseFloat(filteredStats.pending_dues  || 0));

  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeFilter, setActiveFilter] = useState(defaultFilter || 'All');

  const [showModal, setShowModal] = useState(false);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [memberHistory, setMemberHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dueModalPayment, setDueModalPayment] = useState(null);
  const [dueFormData, setDueFormData] = useState({ amount: '', payment_mode: 'Online', transaction_id: '', notes: '' });
  const [dueSubmitting, setDueSubmitting] = useState(false);
  const [dueStep, setDueStep] = useState('idle');
  const [dueOnlineMode, setDueOnlineMode] = useState('RAZORPAY');
  const [dueCollectionContext, setDueCollectionContext] = useState(null);
  const [dueRazorpayContext, setDueRazorpayContext] = useState(null);
  const [dueReminderLoadingId, setDueReminderLoadingId] = useState(null);

  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);

  const [formData, setFormData] = useState({
    user_id: '', plan_id: '', amount_paid: '', total_amount: '', payment_mode: 'Online', transaction_id: '', notes: ''
  });

  const paymentsListRef = useRef(null);
  const paymentsScrollState = useRef({ lastY: 0, velocity: 0, rafId: null });
  const dueRazorpayPollBusyRef = useRef(false);
  const fetchDataRef = useRef(null);
  const checkDueRazorpayStatusRef = useRef(null);
  const dueResumeStateRef = useRef({
    dueModalPaymentId: null,
    paymentMode: 'Online',
    dueOnlineMode: 'RAZORPAY',
    paymentLinkId: '',
  });
  const financeFocusTimerRef = useRef(null);
  const collectionsOverviewRef = useRef(null);
  const collectionsLedgerRef = useRef(null);
  const expensesListRef = useRef(null);
  const payrollListRef = useRef(null);
  const posCatalogRef = useRef(null);

  // ── Finance Hub State ──
  const [financeTab, setFinanceTab] = useState('collections');
  const [financeOverview, setFinanceOverview] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [posProducts, setPosProducts] = useState([]);
  const [posSales, setPosSales] = useState([]);
  const [posCart, setPosCart] = useState([]);
  const [posCheckout, setPosCheckout] = useState({ member_id: '', payment_mode: 'Cash', notes: '' });
  const [posSubmitting, setPosSubmitting] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: '', vendor: '', description: '', amount: '', bill_date: '', payment_mode: 'Cash' });
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [payrollForm, setPayrollForm] = useState({ user_id: '', pay_period: '', base_pay: '', commission: '0', deductions: '0', notes: '' });
  const [showPosModal, setShowPosModal] = useState(false);
  const [posForm, setPosForm] = useState({ name: '', category: 'supplement', price: '', stock_qty: '' });

  const financeOverviewParams = useMemo(() => {
    const bounds = resolveDateRangeBounds(dateRange);
    return {
      period: dateRange,
      from: bounds.startInput || undefined,
      to: bounds.endInput || undefined,
    };
  }, [dateRange, resolveDateRangeBounds]);

  const fetchFinanceOverview = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/overview', {
        headers: { 'x-auth-token': token },
        params: financeOverviewParams,
      });
      setFinanceOverview(extractObject(res.data, {}));
    } catch {
      setFinanceOverview(null);
    }
  }, [financeOverviewParams, token]);

  const fetchExpenses = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/expenses', { headers: { 'x-auth-token': token } });
      setExpenses(Array.isArray(res.data) ? res.data : []);
    } catch {
      setExpenses([]);
    }
  }, [token]);

  const fetchPayroll = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/payroll', { headers: { 'x-auth-token': token } });
      setPayrollEntries(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPayrollEntries([]);
    }
  }, [token]);

  const fetchPosProducts = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/pos/products', { headers: { 'x-auth-token': token } });
      setPosProducts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPosProducts([]);
    }
  }, [token]);

  const fetchPosSales = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/pos/sales', { headers: { 'x-auth-token': token } });
      setPosSales(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPosSales([]);
    }
  }, [token]);

  const fetchStaffOptions = useCallback(async () => {
    try {
      const res = await axios.get('/api/users/staff', { headers: { 'x-auth-token': token } });
      setStaffOptions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setStaffOptions([]);
    }
  }, [token]);

  useEffect(() => {
    if (financeTab === 'expenses') {
      fetchExpenses();
    } else if (financeTab === 'payroll') {
      fetchPayroll();
      fetchStaffOptions();
    } else if (financeTab === 'pos') {
      fetchPosProducts();
      fetchPosSales();
    } else if (financeTab === 'collections') {
      fetchFinanceOverview();
    }
  }, [financeTab, fetchExpenses, fetchPayroll, fetchPosProducts, fetchPosSales, fetchFinanceOverview, fetchStaffOptions]);

  const handleSaveExpense = async () => {
    try {
      await axios.post('/api/finance/expenses', expenseForm, { headers: { 'x-auth-token': token } });
      toast?.('Expense added', 'success');
      setShowExpenseModal(false);
      setExpenseForm({ category: '', vendor: '', description: '', amount: '', bill_date: '', payment_mode: 'Cash' });
      fetchExpenses();
      fetchFinanceOverview();
    } catch { toast?.('Failed to add expense', 'error'); }
  };

  const handleSavePayroll = async () => {
    if (!payrollForm.user_id || !payrollForm.pay_period || !payrollForm.base_pay) {
      toast?.('Select a staff member, pay period, and base pay.', 'warning');
      return;
    }
    try {
      await axios.post('/api/finance/payroll', payrollForm, { headers: { 'x-auth-token': token } });
      toast?.('Payroll entry added', 'success');
      setShowPayrollModal(false);
      setPayrollForm({ user_id: '', pay_period: '', base_pay: '', commission: '0', deductions: '0', notes: '' });
      fetchPayroll();
      fetchFinanceOverview();
    } catch { toast?.('Failed to add payroll entry', 'error'); }
  };

  const handleSavePosProduct = async () => {
    try {
      await axios.post('/api/finance/pos/products', posForm, { headers: { 'x-auth-token': token } });
      toast?.('Product added', 'success');
      setShowPosModal(false);
      setPosForm({ name: '', category: 'supplement', price: '', stock_qty: '' });
      fetchPosProducts();
    } catch { toast?.('Failed to add product', 'error'); }
  };

  const addProductToCart = (product) => {
    const existing = posCart.find((item) => item.product_id === product.id);
    const nextQuantity = (existing?.quantity || 0) + 1;
    if (nextQuantity > Number(product.stock_qty || 0)) {
      toast?.('No more stock available for this product.', 'warning');
      return;
    }
    setPosCart((prev) => {
      if (existing) {
        return prev.map((item) => item.product_id === product.id ? { ...item, quantity: nextQuantity } : item);
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        unit_price: Number(product.price || 0),
        quantity: 1,
        stock_qty: Number(product.stock_qty || 0),
      }];
    });
  };

  const updateCartQuantity = (productId, quantity) => {
    setPosCart((prev) => prev
      .map((item) => item.product_id === productId ? { ...item, quantity: Math.max(1, Math.min(Number(quantity || 1), item.stock_qty)) } : item)
      .filter((item) => item.quantity > 0));
  };

  const removeCartItem = (productId) => {
    setPosCart((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const posCartTotal = useMemo(() => posCart.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0), [posCart]);

  const handleCheckoutPosSale = async () => {
    if (posCart.length === 0) {
      toast?.('Add at least one product to the POS cart.', 'warning');
      return;
    }
    setPosSubmitting(true);
    try {
      await axios.post('/api/finance/pos/sales', {
        member_id: posCheckout.member_id ? Number.parseInt(posCheckout.member_id, 10) : null,
        payment_mode: posCheckout.payment_mode,
        notes: posCheckout.notes,
        items: posCart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
      }, { headers: { 'x-auth-token': token } });
      toast?.('POS sale recorded.', 'success');
      setPosCart([]);
      setPosCheckout({ member_id: '', payment_mode: 'Cash', notes: '' });
      fetchPosProducts();
      fetchPosSales();
      fetchFinanceOverview();
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to complete POS sale.', 'error');
    } finally {
      setPosSubmitting(false);
    }
  };

  const markPayrollPaid = async (entry) => {
    try {
      await axios.put(`/api/finance/payroll/${entry.id}`, {
        base_pay: entry.base_pay,
        commission: entry.commission,
        deductions: entry.deductions,
        notes: entry.notes,
        status: 'PAID',
      }, { headers: { 'x-auth-token': token } });
      toast?.('Payroll marked as paid.', 'success');
      fetchPayroll();
      fetchFinanceOverview();
    } catch {
      toast?.('Failed to update payroll status.', 'error');
    }
  };

  const getImageUrl = (path) => normalizeProfileImageUrl(path);

  const handleDueWhatsApp = useCallback(async (payment) => {
    if (!payment?.user_id) {
      toast?.('Member details are incomplete for this reminder.', 'warning');
      return;
    }

    try {
      setDueReminderLoadingId(payment.id);
      const previewPayload = await previewWhatsAppReminders({
        token,
        memberIds: [payment.user_id],
        templateKey: 'PAYMENT_DUE',
      });
      const previewDialog = buildReminderPreviewDialog(previewPayload, {
        singleTitle: 'Send Payment Reminder',
        multiTitle: 'Send Payment Reminders',
        singleConfirmLabel: 'Send Payment Reminder',
        multiConfirmLabelPrefix: 'Send',
      });

      if (!previewDialog) {
        toast?.(getReminderPreviewBlockReason(previewPayload) || 'No reminder can be sent for this member.', 'warning');
        return;
      }

      const runSend = async () => {
        try {
          setDueReminderLoadingId(payment.id);
          const payload = await sendWhatsAppReminders({
            token,
            memberIds: [payment.user_id],
            templateKey: 'PAYMENT_DUE',
          });
          const summary = summarizeReminderResult(payload, 'Payment reminder');
          toast?.(summary.message, summary.tone);
        } catch (err) {
          toast?.(err?.response?.data?.message || err?.response?.data?.error || 'Failed to queue WhatsApp reminder.', 'error');
        } finally {
          setDueReminderLoadingId(null);
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
      toast?.(err?.response?.data?.message || err?.response?.data?.error || 'Failed to prepare WhatsApp reminder preview.', 'error');
    } finally {
      setDueReminderLoadingId(null);
    }
  }, [showConfirm, toast, token]);

  const handleDueCall = useCallback((payment) => {
    const digits = String(payment?.member_phone || '').replace(/\D/g, '');
    if (!digits) {
      toast?.('Phone number not available for this member.', 'warning');
      return;
    }
    window.open(`tel:${digits}`, '_self');
  }, [toast]);

  const focusFinanceSection = useCallback((sectionKey) => {
    const sectionMap = {
      'collections-overview': { tab: 'collections', ref: collectionsOverviewRef },
      'payments-ledger': { tab: 'collections', ref: collectionsLedgerRef },
      'expenses-list': { tab: 'expenses', ref: expensesListRef },
      'payroll-list': { tab: 'payroll', ref: payrollListRef },
      'pos-catalog': { tab: 'pos', ref: posCatalogRef },
    };

    const target = sectionMap[sectionKey];
    if (!target) return;

    setFinanceTab(target.tab);

    if (financeFocusTimerRef.current) {
      clearTimeout(financeFocusTimerRef.current);
    }

    financeFocusTimerRef.current = window.setTimeout(() => {
      target.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onSectionHandled?.();
    }, 180);
  }, [onSectionHandled]);

  const filteredPayments = ledgerPayments;

  const loadMemberOptions = useCallback(async (query = '') => {
    try {
      const res = await axios.get('/api/members/options', {
        headers: { 'x-auth-token': token },
        params: {
          search: query || undefined,
          limit: 20,
        },
      });
      setMembers(extractArray(res.data, ['members', 'rows', 'items']));
    } catch (_err) {
      setMembers([]);
    }
  }, [token]);

  const loadLedger = useCallback(async () => {
    try {
      const res = await axios.get('/api/payments', {
        headers: { 'x-auth-token': token },
        params: {
          paginate: true,
          page: ledgerPagination.page,
          limit: ledgerPagination.limit,
          search: deferredSearchTerm || undefined,
          filter: activeFilter,
          from: financeOverviewParams.from,
          to: financeOverviewParams.to,
        },
      });

      const ledgerData = extractArray(res.data, ['payments', 'rows', 'items']).map((payment) => ({
        ...payment,
        profile_pic: normalizeProfileImageUrl(payment?.profile_pic),
      }));
      setLedgerPayments(ledgerData);
      setLedgerPagination((prev) => ({
        ...prev,
        ...(res.data?.pagination || {}),
      }));
    } catch (err) {
      reportClientError('Payments load ledger', err);
      setLedgerPayments([]);
    }
  }, [activeFilter, deferredSearchTerm, financeOverviewParams.from, financeOverviewParams.to, ledgerPagination.limit, ledgerPagination.page, token]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const headers = { 'x-auth-token': token };
      const [paymentsRes, statsRes, membersRes, plansRes] = await Promise.all([
        axios.get('/api/payments', { headers, params: { from: financeOverviewParams.from, to: financeOverviewParams.to } }),
        axios.get('/api/payments/stats', { headers, params: { from: financeOverviewParams.from, to: financeOverviewParams.to } }),
        axios.get('/api/members/options', { headers, params: { limit: 20 } }),
        axios.get('/api/plans', { headers })
      ]);

      const paymentsData = extractArray(paymentsRes.data, ['payments', 'rows', 'items']).map((payment) => ({
        ...payment,
        profile_pic: normalizeProfileImageUrl(payment?.profile_pic),
      }));
      const membersData = extractArray(membersRes.data, ['members', 'rows', 'items']);
      const plansData = extractArray(plansRes.data, ['plans', 'rows', 'items']);

      setPayments(paymentsData);
      setStats(extractObject(statsRes.data, { total_revenue: 0, today_revenue: 0, pending_dues: 0 }));
      setMembers(membersData);
      setPlans(plansData);
      setLoading(false);
    } catch (err) {
      reportClientError('Payments load data', err);
      setLoading(false);
    }
  }, [financeOverviewParams.from, financeOverviewParams.to, token]);

  const refreshAllData = useCallback(async () => {
    await Promise.all([fetchData(), loadLedger()]);
  }, [fetchData, loadLedger]);

  fetchDataRef.current = refreshAllData;

  useEffect(() => {
    if (!token || !isActive) return;
    fetchData();
  }, [fetchData, isActive, token]);

  useEffect(() => {
    if (!token || !isActive) return;
    loadLedger();
  }, [activeFilter, deferredSearchTerm, isActive, ledgerPagination.limit, ledgerPagination.page, loadLedger, token]);

  useEffect(() => {
    setLedgerPagination((prev) => prev.page === 1 ? prev : { ...prev, page: 1 });
  }, [activeFilter, deferredSearchTerm, financeOverviewParams.from, financeOverviewParams.to]);

  useEffect(() => {
    setActiveFilter(defaultFilter || 'All');
  }, [defaultFilter]);

  useEffect(() => {
    const handleDashboardFilter = (event) => {
      const nextFilter = String(event?.detail?.filter || '').trim();
      if (!nextFilter) return;
      setActiveFilter(nextFilter);
    };

    window.addEventListener('gymvault:payments-filter', handleDashboardFilter);
    return () => window.removeEventListener('gymvault:payments-filter', handleDashboardFilter);
  }, []);

  useEffect(() => {
    if (!token) return;

    const refreshPayments = () => {
      refreshAllData();
    };

    window.addEventListener('gymvault:data-changed', refreshPayments);
    return () => window.removeEventListener('gymvault:data-changed', refreshPayments);
  }, [refreshAllData, token]);

  useEffect(() => {
    if (!focusSection) return;
    focusFinanceSection(focusSection);
    return () => {
      if (financeFocusTimerRef.current) {
        clearTimeout(financeFocusTimerRef.current);
        financeFocusTimerRef.current = null;
      }
    };
  }, [focusFinanceSection, focusSection]);

  useEffect(() => {
    if (!showModal || !token) return;
    loadMemberOptions(memberSearch);
  }, [loadMemberOptions, memberSearch, showModal, token]);

  const handleRecordPayment = async (e) => {
    if (e) e.preventDefault();
    if (recordSubmitting) return;
    setRecordSubmitting(true);
    try {
      const finalPayload = {
        ...formData,
        payment_mode: (formData.transaction_id && formData.transaction_id.trim() !== "") ? "Online" : formData.payment_mode
      };
      await axios.post('/api/payments/record', finalPayload, { headers: { 'x-auth-token': token } });
      setShowModal(false);
      setMemberSearch('');
      setShowMemberDropdown(false);
      setFormData({ user_id: '', plan_id: '', amount_paid: '', total_amount: '', payment_mode: 'Online', transaction_id: '', notes: '' });
      await refreshAllData();
      window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments' } }));
      toast?.("Payment recorded successfully!", "success");
    } catch (_err) {
      toast?.("Error recording payment. Please try again.", "error");
    } finally {
      setRecordSubmitting(false);
    }
  };

  const handleDeletePayment = (id) => {
    showConfirm?.({
      title: 'Delete Transaction',
      message: "This will permanently delete the payment record and reset the member's status to UNPAID.",
      confirmLabel: 'Yes, Delete',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await axios.delete(`/api/payments/${id}`, {
            headers: { 'x-auth-token': token }
          });
          setShowReceipt(false);
          await refreshAllData();
          window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments' } }));
          toast?.("Transaction deleted. Member status reset.", "success");
        } catch (err) {
          reportClientError('Payments delete', err);
          toast?.("Error deleting record.", "error");
        }
      },
    });
  };

  const handlePlanSelect = (e) => {
    const planId = e.target.value;
    const selectedPlan = plans.find(p => p.id === parseInt(planId));
    setFormData({ ...formData, plan_id: planId, total_amount: selectedPlan ? selectedPlan.price : '' });
  };

  const openReceipt = useCallback(async (payment) => {
    setSelectedPayment(payment);
    setShowReceipt(true);
    setMemberHistory([]);
    setHistoryLoading(true);
    if (!payment.user_id) { setHistoryLoading(false); return; }
    try {
      const res = await axios.get(`/api/payments/history/${payment.user_id}`, {
        headers: { 'x-auth-token': token }
      });
      setMemberHistory(extractArray(res.data, ['history', 'payments', 'rows', 'items']));
    } catch (_err) {
      // silently fail
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  const resetDueModal = useCallback(() => {
    setDueModalPayment(null);
    setDueFormData({ amount: '', payment_mode: 'Online', transaction_id: '', notes: '' });
    setDueStep('idle');
    setDueOnlineMode('RAZORPAY');
    setDueCollectionContext(null);
    setDueRazorpayContext(null);
  }, []);

  const openDueModal = useCallback((payment) => {
    const remainingDue = roundMoney(payment?.amount_due || 0);
    if (remainingDue <= 0) {
      toast?.('This payment does not have any remaining due.', 'warning');
      return;
    }

    setDueModalPayment(payment);
    setDueFormData({
      amount: String(remainingDue),
      payment_mode: 'Online',
      transaction_id: '',
      notes: '',
    });
    setDueStep('idle');
    setDueOnlineMode('RAZORPAY');
    setDueCollectionContext(null);
    setDueRazorpayContext(null);
  }, [toast]);

  const handleCopyDueCollectionDetail = useCallback(async (value, successMessage) => {
    const copied = await copyCollectionText(value);
    if (copied) {
      toast?.(successMessage, 'success');
      return;
    }
    toast?.('Copy failed on this device. Long-press and copy it manually.', 'warning');
  }, [toast]);

  const settleDueLocally = useCallback(async (payload, fallbackMessage) => {
    const updatedPayment = { ...(dueModalPayment || {}), ...(payload?.payment || {}) };
    resetDueModal();
    await refreshAllData();
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments-due' } }));
    toast?.(payload?.message || fallbackMessage || 'Pending due collected successfully.', 'success');
    if (updatedPayment?.id) {
      await openReceipt(updatedPayment);
    }
  }, [dueModalPayment, openReceipt, refreshAllData, resetDueModal, toast]);

  const checkDueRazorpayStatus = useCallback(async ({ manual = false } = {}) => {
    const paymentLinkId = dueRazorpayContext?.payment_link?.id;
    if (!dueModalPayment?.id || !paymentLinkId || dueRazorpayPollBusyRef.current) {
      return false;
    }

    dueRazorpayPollBusyRef.current = true;
    try {
      const statusRes = await axios.post(
        `/api/payments/${dueModalPayment.id}/due/payment-link-status`,
        {
          payment_link_id: paymentLinkId,
          amount: dueFormData.amount,
          notes: dueFormData.notes,
        },
        { headers: { 'x-auth-token': token } }
      );

      if (!statusRes.data?.paid) {
        if (manual) {
          toast?.('Payment is still pending on Razorpay.', 'warning');
        }
        return false;
      }

      setDueStep('processing');
      await settleDueLocally(statusRes.data, 'Pending due collected successfully.');
      return true;
    } catch (err) {
      if (manual) {
        toast?.(err?.response?.data?.error || 'Unable to verify Razorpay payment right now.', 'error');
      }
      return false;
    } finally {
      dueRazorpayPollBusyRef.current = false;
    }
  }, [dueFormData.amount, dueFormData.notes, dueModalPayment, dueRazorpayContext, settleDueLocally, toast, token]);

  checkDueRazorpayStatusRef.current = checkDueRazorpayStatus;
  dueResumeStateRef.current = {
    dueModalPaymentId: dueModalPayment?.id || null,
    paymentMode: dueFormData.payment_mode,
    dueOnlineMode,
    paymentLinkId: dueRazorpayContext?.payment_link?.id || '',
  };

  useEffect(() => {
    if (!token || !isActive) return undefined;

    const refreshPayments = () => {
      if (document.visibilityState && document.visibilityState === 'hidden') return;
      fetchDataRef.current?.();

      const resumeState = dueResumeStateRef.current;
      if (
        resumeState.dueModalPaymentId
        && resumeState.paymentMode === 'Online'
        && resumeState.dueOnlineMode === 'RAZORPAY'
        && resumeState.paymentLinkId
      ) {
        checkDueRazorpayStatusRef.current?.({ manual: false });
      }
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        refreshPayments();
      }
    };

    window.addEventListener('focus', refreshPayments);
    window.addEventListener('pageshow', refreshPayments);
    window.addEventListener('gymvault:app-resumed', refreshPayments);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', refreshPayments);
      window.removeEventListener('pageshow', refreshPayments);
      window.removeEventListener('gymvault:app-resumed', refreshPayments);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [token, isActive]);

  useEffect(() => {
    if (!dueModalPayment?.id || dueFormData.payment_mode !== 'Online' || dueOnlineMode !== 'RAZORPAY' || !dueRazorpayContext?.payment_link?.id) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      checkDueRazorpayStatus();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkDueRazorpayStatus, dueFormData.payment_mode, dueModalPayment, dueOnlineMode, dueRazorpayContext]);

  const handleCollectDue = useCallback(async (e) => {
    if (e) e.preventDefault();

    if (!dueModalPayment || dueSubmitting) return;

    const remainingDue = roundMoney(dueModalPayment.amount_due || 0);
    const requestedAmount = dueFormData.amount === '' ? remainingDue : roundMoney(Number.parseFloat(dueFormData.amount));

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      toast?.('Enter a valid amount to collect.', 'warning');
      return;
    }
    if (requestedAmount - remainingDue > 0.009) {
      toast?.('Collection amount cannot be greater than the remaining due.', 'warning');
      return;
    }

    setDueSubmitting(true);

    try {
      if (dueFormData.payment_mode === 'Online') {
        if (dueOnlineMode === 'UPI') {
          if (!dueCollectionContext) {
            setDueStep('processing');

            const collectionRes = await axios.post(
              `/api/payments/${dueModalPayment.id}/due/create-order`,
              { amount: requestedAmount, notes: dueFormData.notes },
              { headers: { 'x-auth-token': token } }
            );

            const collection = collectionRes.data?.collection;
            if (!collection?.upi_id) {
              toast?.('Direct UPI QR is not configured. Add a collection UPI ID in Integrations or use Razorpay collection.', 'error');
              setDueStep('idle');
              return;
            }

            setDueCollectionContext(collection);
            setDueRazorpayContext(null);
            setDueFormData((prev) => ({
              ...prev,
              transaction_id: prev.transaction_id || collection.reference || '',
            }));
            setDueStep('collecting');
            toast?.('Show this direct UPI QR to the member, then confirm after you receive the money.', 'success');
            return;
          }

          setDueStep('processing');

          const onlineRes = await axios.post(
            `/api/payments/${dueModalPayment.id}/due/collect`,
            {
              amount: requestedAmount,
              payment_mode: 'Online',
              transaction_id: dueFormData.transaction_id || dueCollectionContext.reference,
              notes: dueFormData.notes,
            },
            { headers: { 'x-auth-token': token } }
          );
          await settleDueLocally(onlineRes.data, 'Pending due collected successfully.');
        } else {
          if (dueRazorpayContext?.payment_link?.id) {
            await checkDueRazorpayStatus({ manual: true });
            return;
          }

          setDueStep('processing');

          const orderRes = await axios.post(
            `/api/payments/${dueModalPayment.id}/due/create-order`,
            { amount: requestedAmount, notes: dueFormData.notes },
            { headers: { 'x-auth-token': token } }
          );

          const razorpay = orderRes.data?.razorpay;
          const paymentLink = razorpay?.payment_link;
          if (!paymentLink?.id || !paymentLink?.short_url) {
            toast?.('Razorpay collection is not configured. Add Razorpay keys/connect in Integrations or use Direct UPI.', 'error');
            setDueStep('idle');
            return;
          }

          setDueCollectionContext(null);
          setDueRazorpayContext(razorpay);
          setDueStep('collecting');

          const delivery = describeCollectionLinkDelivery(paymentLink);
          toast?.(
            delivery.label === 'Manual share required'
              ? 'Razorpay QR is ready. Since no member phone or email is saved, share the link manually.'
              : `${delivery.label} and QR is ready on this screen.`,
            'success'
          );
          return;
        }
      } else {
        setDueStep('processing');
        const cashRes = await axios.post(
          `/api/payments/${dueModalPayment.id}/due/collect`,
          {
            amount: requestedAmount,
            payment_mode: 'Cash',
            transaction_id: dueFormData.transaction_id,
            notes: dueFormData.notes,
          },
          { headers: { 'x-auth-token': token } }
        );
        await settleDueLocally(cashRes.data, 'Pending due collected successfully.');
      }
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to collect pending due.', 'error');
      setDueStep(
        dueFormData.payment_mode === 'Online' && (
          (dueOnlineMode === 'UPI' && dueCollectionContext)
          || (dueOnlineMode === 'RAZORPAY' && dueRazorpayContext)
        )
          ? 'collecting'
          : 'idle'
      );
    } finally {
      setDueSubmitting(false);
    }
  }, [checkDueRazorpayStatus, dueCollectionContext, dueFormData.amount, dueFormData.notes, dueFormData.payment_mode, dueFormData.transaction_id, dueModalPayment, dueOnlineMode, dueRazorpayContext, dueSubmitting, settleDueLocally, toast, token]);

  useEffect(() => {
    if (!focusPaymentId) return;
    const targetPayment = ledgerPayments.find((payment) => Number(payment.id) === Number(focusPaymentId))
      || payments.find((payment) => Number(payment.id) === Number(focusPaymentId));
    if (!targetPayment) return;

    setActiveFilter('Pending');
    if (focusAction === 'collectDue') {
      openDueModal(targetPayment);
    } else {
      openReceipt(targetPayment);
    }
    onFocusHandled?.();
  }, [focusAction, focusPaymentId, ledgerPayments, onFocusHandled, openDueModal, openReceipt, payments]);

  const handleDownloadReceipt = () => {
    if (!selectedPayment) return;
    const refId = selectedPayment.transaction_id || selectedPayment.invoice_id;
    const receiptText = `GYM RECEIPT\nRef ID: ${refId}\nDate: ${new Date(selectedPayment.payment_date).toLocaleDateString()}\nMember: ${selectedPayment.member_name}\nAmount: ₹${selectedPayment.amount_paid}`;
    const blob = new Blob([receiptText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Receipt_${refId}.txt`;
    document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (payments.length === 0) { toast?.("No data to export.", "warning"); return; }
    const headers = ["ID", "Member", "Date", "Amount", "Mode", "Transaction ID"];
    const rows = payments.map(p => [p.invoice_id, p.member_name, new Date(p.payment_date).toLocaleDateString(), p.amount_paid, p.payment_mode, p.transaction_id || '-']);
    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri); link.setAttribute("download", "payments.csv");
    document.body.appendChild(link); link.click();
  };

  const revenueSplit = useMemo(() => {
    let cashTotal = 0, onlineTotal = 0, onlineCount = 0;
    dateFilteredPayments.forEach(p => {
      const initialAmount = parseFloat(p.initial_amount_paid ?? p.amount_paid) || 0;
      const dueOnlineAmount = parseFloat(p.due_online_collected || 0) || 0;
      const dueCashAmount = parseFloat(p.due_cash_collected || 0) || 0;
      const modeLabel = p.payment_mode ? p.payment_mode.toString().toLowerCase().trim() : '';
      const txnId = p.transaction_id ? p.transaction_id.toString().toLowerCase().trim() : '';
      const invId = p.invoice_id ? p.invoice_id.toString().toLowerCase().trim() : '';
      const isInitialOnline = (txnId !== "" && txnId !== invId && txnId !== "null" && txnId !== "processing...") || modeLabel.includes('online') || modeLabel.includes('upi') || txnId.startsWith('pay_');
      if (isInitialOnline) onlineTotal += initialAmount;
      else cashTotal += initialAmount;
      onlineTotal += dueOnlineAmount;
      cashTotal += dueCashAmount;
      if (isInitialOnline || dueOnlineAmount > 0) onlineCount++;
    });
    const total = cashTotal + onlineTotal;
    return { cash: cashTotal, online: onlineTotal, onlineCount, cashPer: total > 0 ? (cashTotal / total) * 100 : 0, onlinePer: total > 0 ? (onlineTotal / total) * 100 : 0 };
  }, [dateFilteredPayments]);

  const financePeriodSummary = useMemo(() => {
    const summary = extractObject(financeOverview?.summary, {});
    const periodLabel = summary.period_label || getDateRangeLabel(dateRange);
    const periodIncome = Number(summary.period_income || 0);
    const periodOutflows = Number(summary.period_outflows || 0);
    const periodProfit = Number(summary.period_profit || 0);

    return {
      periodLabel,
      periodIncome,
      periodOutflows,
      periodProfit,
    };
  }, [dateRange, financeOverview, getDateRangeLabel]);

  const profitInsight = useMemo(() => {
    const profit = roundMoney(financePeriodSummary.periodProfit);
    const outflows = roundMoney(financePeriodSummary.periodOutflows);
    const label = dateRange === 'all' ? 'Profit earned overall' : `Profit earned · ${financePeriodSummary.periodLabel}`;

    if (profit > 0) {
      return {
        id: 'period-profit',
        icon: CheckCircle2,
        tone: 'emerald',
        title: label,
        detail: `₹${profit.toLocaleString()} net after ₹${outflows.toLocaleString()} of expenses and payroll.`,
      };
    }

    if (profit < 0) {
      return {
        id: 'period-profit',
        icon: AlertCircle,
        tone: 'rose',
        title: label,
        detail: `₹${Math.abs(profit).toLocaleString()} net loss after ₹${outflows.toLocaleString()} of expenses and payroll.`,
      };
    }

    return {
      id: 'period-profit',
      icon: History,
      tone: 'slate',
      title: label,
      detail: outflows > 0
        ? `Collections are currently matching ₹${outflows.toLocaleString()} of expenses and payroll.`
        : 'No expense or payroll outflow recorded in the selected period yet.',
    };
  }, [dateRange, financePeriodSummary]);

  const collectionIntelligence = useMemo(() => {
    const completed = dateFilteredPayments.filter((payment) => payment.status === 'Completed');
    const pending = dateFilteredPayments.filter((payment) => payment.status !== 'Completed');
    const totalCollected = completed.reduce((sum, payment) => sum + (parseFloat(payment.amount_paid) || 0), 0);
    const averageTicket = completed.length > 0 ? Math.round(totalCollected / completed.length) : 0;
    const onlineShare = Math.round(revenueSplit.onlinePer || 0);
    const pendingValue = Number(filteredStats.pending_dues || 0);
    const dominantMode = revenueSplit.online === 0 && revenueSplit.cash === 0
      ? 'No mix yet'
      : revenueSplit.online >= revenueSplit.cash ? 'Online' : 'Cash';

    const actions = [];
    if (pendingValue > 0) {
      actions.push({
        id: 'recover-dues',
        icon: AlertCircle,
        tone: 'orange',
        title: 'Recover outstanding dues',
        detail: `₹${pendingValue.toLocaleString()} is still pending across ${pending.length} record${pending.length === 1 ? '' : 's'}.`,
      });
    }
    actions.push(profitInsight);
    if (actions.length < 2) {
      actions.push({
        id: 'protect-ticket',
        icon: History,
        tone: 'slate',
        title: averageTicket > 0 ? 'Protect average ticket value' : 'Start building ticket history',
        detail: averageTicket > 0
          ? `Average ticket is ₹${averageTicket.toLocaleString()}. Upsell longer renewals during collections.`
          : 'Complete a few payments to unlock smarter collection guidance.',
      });
    }

    return {
      completedCount: completed.length,
      averageTicket,
      onlineShare,
      dominantMode,
      actions: actions.slice(0, 2),
    };
  }, [dateFilteredPayments, filteredStats.pending_dues, profitInsight, revenueSplit]);

  const financeSummary = useMemo(() => {
    const revenue = extractObject(financeOverview?.revenue, {});
    const expensesSummary = extractObject(financeOverview?.expenses, {});
    const payrollSummary = extractObject(financeOverview?.payroll, {});
    const posSummary = extractObject(financeOverview?.pos, {});
    const overdueSummary = extractObject(financeOverview?.overdue, {});

    const membershipRevenue = Number(revenue.total_revenue || 0);
    const posRevenue = Number(posSummary.pos_revenue || 0);
    const totalIncome = membershipRevenue + posRevenue;
    const totalExpenses = Number(expensesSummary.total_expenses || 0);
    const totalPayroll = Number(payrollSummary.total_payroll || 0);
    const totalOutflows = totalExpenses + totalPayroll;
    const netPosition = totalIncome - totalOutflows;
    const overdueAmount = Number(overdueSummary.overdue_amount || revenue.total_pending || 0);

    return {
      membershipRevenue,
      posRevenue,
      totalIncome,
      totalExpenses,
      totalPayroll,
      totalOutflows,
      netPosition,
      overdueAmount,
      overdueCount: Number(overdueSummary.overdue_count || 0),
      pendingPayroll: Number(payrollSummary.pending_payroll || 0),
      pendingPayrollCount: Number(payrollSummary.pending_count || 0),
      monthExpenses: Number(expensesSummary.month_expenses || 0),
      posToday: Number(posSummary.pos_today || 0),
      posCount: Number(posSummary.pos_count || 0),
      todayRevenue: Number(revenue.today_revenue || 0),
    };
  }, [financeOverview]);

  const getEmptySubtitle = () => {
    if (searchTerm) return `No results matching "${searchTerm}"`;
    if (activeFilter !== 'All') return `No ${activeFilter} payments recorded yet`;
    return 'Record your first payment to get started';
  };

  useEffect(() => {
    const el = paymentsListRef.current;
    if (!el) return;
    const s = paymentsScrollState.current;
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

  return (
    <div className="min-h-full p-2 font-sans relative" onClick={() => setShowFilterDropdown(false)}>
      <style>{`
        @keyframes payCardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div className="bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-4 sm:p-6 flex flex-col gap-5 sm:gap-6 mb-0"
        style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)', opacity: 0, animation: 'payCardIn 0.6s cubic-bezier(0.16,1,0.3,1) 0ms forwards' }}>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Finance Hub</h1>
          {/* Finance hub tabs */}
          <div className="flex gap-1 mt-3 bg-slate-100 rounded-xl p-0.5 w-fit overflow-x-auto whitespace-nowrap">
            {[{ key: 'collections', label: 'Collections' }, { key: 'expenses', label: 'Expenses' }, { key: 'payroll', label: 'Payroll' }, { key: 'pos', label: 'POS' }].map(t => (
              <button key={t.key} onClick={() => setFinanceTab(t.key)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${financeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{t.label}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-2.5 w-full sm:w-auto">
          {financeTab === 'collections' && <>
            <button onClick={handleExport} className="justify-center bg-white border border-slate-200 text-slate-600 px-3 sm:px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-50 shadow-sm"><Download size={17} /> Export</button>
            <button onClick={() => setShowModal(true)} className="justify-center bg-slate-900 text-white px-3 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 shadow-lg"><Plus size={18} /> Record Payment</button>
          </>}
          {financeTab === 'expenses' && <button onClick={() => setShowExpenseModal(true)} className="justify-center bg-slate-900 text-white px-3 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 shadow-lg"><Plus size={18} /> Add Expense</button>}
          {financeTab === 'payroll' && <button onClick={() => setShowPayrollModal(true)} className="justify-center bg-slate-900 text-white px-3 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 shadow-lg"><Plus size={18} /> Add Payroll</button>}
          {financeTab === 'pos' && <button onClick={() => setShowPosModal(true)} className="justify-center bg-slate-900 text-white px-3 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 shadow-lg"><Plus size={18} /> Add Product</button>}
        </div>
      </div>

      {/* ═══════ COLLECTIONS TAB ═══════ */}
      {financeTab === 'collections' && (<>
      {/* DATE RANGE FILTER */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1 shrink-0">Period:</span>
          {[
            { key: '30d', label: '30 Days' },
            { key: 'all', label: 'All Time' },
            { key: 'custom', label: 'Custom' },
          ].map((rangeOption) => (
            <button
              key={rangeOption.key}
              onClick={() => setDateRange(rangeOption.key)}
              className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${dateRange === rangeOption.key ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
            >
              {rangeOption.label}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
              From
              <input
                type="date"
                value={customDateRange.from}
                max={customDateRange.to || undefined}
                onChange={(e) => setCustomDateRange((prev) => ({
                  ...prev,
                  from: e.target.value,
                  to: prev.to && e.target.value && prev.to < e.target.value ? e.target.value : prev.to,
                }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-slate-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
              To
              <input
                type="date"
                value={customDateRange.to}
                min={customDateRange.from || undefined}
                max={getTodayInputValue()}
                onChange={(e) => setCustomDateRange((prev) => ({
                  ...prev,
                  to: e.target.value,
                  from: prev.from && e.target.value && prev.from > e.target.value ? e.target.value : prev.from,
                }))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const today = getTodayInputValue();
                setCustomDateRange({ from: shiftDateInputValue(today, 30), to: today });
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        )}
      </div>
      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          <div className="gv-pay-card-emerald relative overflow-hidden rounded-[20px] p-5 sm:p-6 border"
            style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)', borderColor: 'rgba(16,185,129,0.15)', boxShadow: '0 4px 20px rgba(16,185,129,0.08)', opacity: 0, animation: 'payCardIn 0.5s cubic-bezier(0.16,1,0.3,1) 120ms forwards' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-emerald-700/70 text-[10px] font-black uppercase tracking-widest mb-3">{dateRange === 'all' ? 'Total Revenue' : `Revenue (${getDateRangeLabel(dateRange)})`}</p>
                  <h3 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">₹{animatedTotalRevenue.toLocaleString()}</h3>
                  <p className="text-emerald-600 text-xs font-bold mt-1.5">{dateRange === 'all' ? 'All time earnings' : 'Filtered period'}</p>
                </div>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(16,185,129,0.12)' }}>
                  <DollarSign size={22} className="text-emerald-600" />
                </div>
              </div>
          </div>
          <div className="gv-pay-card-blue relative overflow-hidden rounded-[20px] p-5 sm:p-6 border"
            style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)', borderColor: 'rgba(59,130,246,0.15)', boxShadow: '0 4px 20px rgba(59,130,246,0.08)', opacity: 0, animation: 'payCardIn 0.5s cubic-bezier(0.16,1,0.3,1) 210ms forwards' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-blue-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Collected Today</p>
                  <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">₹{animatedTodayRevenue.toLocaleString()}</h3>
                  <p className="text-blue-600 text-xs font-bold mt-1.5">Today's collection</p>
                </div>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.12)' }}>
                  <Clock size={22} className="text-blue-600" />
                </div>
              </div>
          </div>
          <div className="gv-pay-card-orange relative overflow-hidden rounded-[20px] p-5 sm:p-6 border"
            style={{ background: 'linear-gradient(135deg, #fff7ed 0%, #fef9f0 100%)', borderColor: 'rgba(249,115,22,0.15)', boxShadow: '0 4px 20px rgba(249,115,22,0.08)', opacity: 0, animation: 'payCardIn 0.5s cubic-bezier(0.16,1,0.3,1) 300ms forwards' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 pr-2">
                  <p className="text-orange-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Pending Dues</p>
                  <h3 className="text-2xl sm:text-3xl font-black text-orange-500 tracking-tight">₹{animatedPendingDues.toLocaleString()}</h3>
                  <p className="text-orange-500 text-xs font-bold mt-1.5">Awaiting payment</p>
                </div>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.12)' }}>
                  <AlertCircle size={22} className="text-orange-600" />
                </div>
              </div>
          </div>
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div ref={collectionsOverviewRef} className="lg:col-span-2 bg-white/90 p-5 sm:p-8 rounded-[24px] border border-slate-100/60 scroll-mt-28" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
            <div>
              <h3 className="text-lg font-black text-slate-900">Collection Intelligence</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Short signals to improve cashflow today</p>
            </div>
            <div className="hidden sm:block rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 self-start">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Dominant Mode</p>
              <p className="text-sm font-black text-slate-900">{collectionIntelligence.dominantMode} · {collectionIntelligence.onlineShare}% digital</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 sm:p-4 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Completed</p>
              <p className="text-[clamp(1.375rem,5vw,2rem)] font-black leading-none text-slate-900">{collectionIntelligence.completedCount}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 sm:p-4 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/70 mb-1">Avg Ticket</p>
              <p className="text-[clamp(1.375rem,5vw,2rem)] font-black leading-none tracking-tight text-emerald-600">₹{collectionIntelligence.averageTicket.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-3 sm:p-4 min-w-0 col-span-2 lg:col-span-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600/70 mb-1">Digital Mix</p>
              <p className="text-[clamp(1.375rem,5vw,2rem)] font-black leading-none tracking-tight text-indigo-600">{collectionIntelligence.onlineShare}%</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {collectionIntelligence.actions.slice(0, 2).map((item) => {
              const tone = INSIGHT_TONE_STYLES[item.tone] || INSIGHT_TONE_STYLES.slate;
              const Icon = item.icon;
              return (
                <div key={item.id} className={`rounded-2xl border p-4 ${tone.wrapper}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone.icon}`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className={`text-sm font-black ${tone.title}`}>{item.title}</p>
                      <p className={`text-xs font-semibold mt-1 leading-relaxed ${tone.detail}`}>{item.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden sm:grid sm:grid-cols-2 gap-3">
            {collectionIntelligence.actions.map((item) => {
              const tone = INSIGHT_TONE_STYLES[item.tone] || INSIGHT_TONE_STYLES.slate;
              const Icon = item.icon;
              return (
                <div key={item.id} className={`rounded-2xl border p-4 ${tone.wrapper}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone.icon}`}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className={`text-sm font-black ${tone.title}`}>{item.title}</p>
                      <p className={`text-xs font-semibold mt-1 leading-relaxed ${tone.detail}`}>{item.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

          <div className="bg-white/90 p-5 sm:p-8 rounded-[24px] border border-slate-100/60 flex flex-col" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
          <h3 className="text-lg font-black text-slate-900 mb-2">Revenue Split</h3>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Cash vs Online Values</p>
          <div className="space-y-6 mt-4">
            <div>
              <div className="flex justify-between items-end mb-2">
                <div className="flex items-center gap-2 text-blue-600"><Wallet size={16} /><span className="text-sm font-black uppercase">Cash</span></div>
                <span className="text-lg font-black text-slate-900">₹{revenueSplit.cash.toLocaleString()}</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-1000" style={{ width: `${revenueSplit.cashPer}%` }}></div></div>
            </div>
            <div>
              <div className="flex justify-between items-end mb-2">
                <div className="flex items-center gap-2 text-emerald-600"><CreditCard size={16} /><span className="text-sm font-black uppercase">Online</span></div>
                <span className="text-lg font-black text-slate-900">₹{revenueSplit.online.toLocaleString()}</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all duration-1000" style={{ width: `${revenueSplit.onlinePer}%` }}></div></div>
            </div>
            <div className="pt-6 border-t border-slate-50">
              <div className="bg-slate-50 p-4 rounded-2xl">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status Summary</p>
                <div className="flex items-center justify-between font-black text-slate-700"><span>{revenueSplit.onlineCount} DETECTED ONLINE</span><span className="text-emerald-500">{revenueSplit.onlinePer.toFixed(0)}% SHARE</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LEDGER TABLE */}
      <div ref={collectionsLedgerRef} className="bg-white/90 rounded-[24px] border border-slate-100/60 overflow-hidden scroll-mt-28" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
        <div className="p-6 border-b border-slate-100 flex flex-col desktop:flex-row justify-between gap-4">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><input type="text" aria-label="Search payments" placeholder="Search..." className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 transition-all" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
          <div className="relative">
            <button type="button" aria-label="Filter payments" aria-expanded={showFilterDropdown} aria-controls="payments-filter-dropdown" onClick={(e) => { e.stopPropagation(); setShowFilterDropdown(!showFilterDropdown); }} className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 flex items-center gap-2 hover:bg-slate-50"><Filter size={16}/> {activeFilter}</button>
            {showFilterDropdown && (<div id="payments-filter-dropdown" className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-10 animate-in fade-in zoom-in-95 duration-200">{['All', 'Cash', 'Online', 'Pending'].map(f => (<button type="button" key={f} onClick={() => { setActiveFilter(f); setShowFilterDropdown(false); }} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-bold ${activeFilter === f ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>{f}</button>))}</div>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="desktop:hidden p-4">
            <div className="relative">
              <div ref={paymentsListRef} className="payments-mobile-list-scroll no-scrollbar">
                <div className="space-y-3 pb-6">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`pay-mobile-skeleton-${i}`} className="p-4 rounded-2xl border border-slate-100 bg-white">
                  <div className="h-3 w-28 bg-slate-100 rounded animate-pulse mb-2" />
                  <div className="h-3 w-20 bg-slate-100 rounded animate-pulse mb-2" />
                  <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                </div>
              ))
            ) : filteredPayments.length === 0 ? (
              <div className="text-center text-slate-400 font-bold py-8">No transactions found</div>
            ) : (
              filteredPayments.map((payment) => (
                <div key={`pay-mobile-${payment.id}`} className="p-4 rounded-2xl border border-slate-100 bg-white space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 truncate pr-2">{payment.member_name}</p>
                        {parseFloat(payment.amount_due) > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDueWhatsApp(payment)}
                              disabled={dueReminderLoadingId === payment.id}
                              className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                              aria-label={`Send WhatsApp reminder to ${payment.member_name}`}
                              title="Send WhatsApp reminder"
                            >
                              {dueReminderLoadingId === payment.id ? <RefreshCw size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDueCall(payment)}
                              className="w-7 h-7 rounded-full bg-sky-50 text-sky-600 border border-sky-100 flex items-center justify-center"
                              aria-label={`Call ${payment.member_name}`}
                              title="Call member"
                            >
                              <Phone size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">{payment.member_phone || payment.member_email || 'No contact saved'}</p>
                    </div>
                    <p className="font-black text-emerald-600 shrink-0">₹{parseFloat(payment.amount_paid).toLocaleString()}</p>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{payment.plan_name || 'N/A'} • {new Date(payment.payment_date).toLocaleDateString()}</p>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${payment.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                      {payment.status === 'Completed' ? 'Paid' : 'Pending'}
                    </span>
                    <div className="flex items-center gap-2">
                      {parseFloat(payment.amount_due) > 0 && (
                        <button onClick={() => openDueModal(payment)} className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-100">
                          Collect Due
                        </button>
                      )}
                      <button onClick={() => openReceipt(payment)} className="text-xs font-bold text-indigo-600">View</button>
                    </div>
                  </div>
                </div>
              ))
            )}
                </div>
              </div>
              <div className="gv-list-bottom-fade absolute bottom-0 inset-x-0 h-12 pointer-events-none rounded-b-2xl" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.96) 0%, transparent 100%)' }} />
            </div>
          </div>

          <table className="hidden md:table w-full text-left border-collapse">
            <thead><tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400"><th className="p-6">Member / Plan</th><th className="p-6">Transaction ID</th><th className="p-6">Date</th><th className="p-6">Amount</th><th className="p-6">Status</th><th className="p-6">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <PaymentSkeletonRow key={i} />)
              ) : filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-300">
                        <FileText size={32} />
                      </div>
                      <h3 className="text-lg font-black text-slate-900 mb-1">No Transactions Found</h3>
                      <p className="text-slate-400 text-sm font-bold mb-5">{getEmptySubtitle()}</p>
                      {(activeFilter !== 'All' || searchTerm) && (
                        <button
                          onClick={() => { setActiveFilter('All'); setSearchTerm(''); }}
                          className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2"
                        >
                          <X size={14} /> Clear Filter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPayments.map((payment) => (
                  <tr key={payment.id} className="group hover:bg-slate-50/50 transition-colors">
                    <td className="p-6"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 border border-slate-100">{payment.profile_pic ? (<img src={getImageUrl(payment.profile_pic)} onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} alt="Member" className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center font-black text-xs text-slate-500 bg-slate-200">{(payment.member_name || '?').charAt(0).toUpperCase()}</div>)}</div><div><div className="flex items-center gap-2"><div className="font-bold text-slate-900">{payment.member_name}</div>{parseFloat(payment.amount_due) > 0 && (<div className="flex items-center gap-1"><button type="button" onClick={() => handleDueWhatsApp(payment)} disabled={dueReminderLoadingId === payment.id} className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed" aria-label={`Send WhatsApp reminder to ${payment.member_name}`} title="Send WhatsApp reminder">{dueReminderLoadingId === payment.id ? <RefreshCw size={13} className="animate-spin" /> : <MessageCircle size={13} />}</button><button type="button" onClick={() => handleDueCall(payment)} className="w-7 h-7 rounded-full bg-sky-50 text-sky-600 border border-sky-100 flex items-center justify-center" aria-label={`Call ${payment.member_name}`} title="Call member"><Phone size={13} /></button></div>)}</div><div className="text-xs font-bold text-slate-400">{payment.plan_name}</div></div></div></td>
                    <td className="p-6"><div className={`font-mono text-xs font-bold px-2 py-1 rounded w-fit ${payment.transaction_id || payment.invoice_id ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'}`}>{(payment.transaction_id && payment.transaction_id.trim() !== "" && payment.transaction_id !== "Processing...") ? payment.transaction_id : (payment.invoice_id || `ID-${payment.id}`)}</div></td>
                    <td className="p-6"><div className="text-sm font-bold text-slate-600">{new Date(payment.payment_date).toLocaleDateString()}</div><div className="text-xs font-bold text-slate-400 mt-0.5">{new Date(payment.payment_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div></td>
                    <td className="p-6"><div className="font-black text-slate-900">₹{parseFloat(payment.amount_paid).toLocaleString()}</div>{parseFloat(payment.amount_due) > 0 && (<div className="text-[10px] font-bold text-orange-500">Due: ₹{payment.amount_due}</div>)}</td>
                    <td className="p-6">{payment.status === 'Completed' ? (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> Paid</span>) : (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700"><Clock size={12} /> Pending</span>)}</td>
                    <td className="p-6"><div className="flex items-center justify-end gap-2">{parseFloat(payment.amount_due) > 0 && (<button type="button" onClick={() => openDueModal(payment)} aria-label={`Collect due payment for ${payment.member_name}`} className="px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-all">Collect Due</button>)}<button type="button" onClick={() => openReceipt(payment)} aria-label={`Open receipt for ${payment.member_name}`} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-900 transition-all"><FileText size={18} /></button></div></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {ledgerPagination.totalPages > 1 && (
          <div className="px-4 pb-4 md:px-6">
            <PaginationControls
              pagination={ledgerPagination}
              itemLabel="payments"
              onPageChange={(nextPage) => setLedgerPagination((prev) => ({ ...prev, page: nextPage }))}
              onLimitChange={(nextLimit) => setLedgerPagination({ page: 1, limit: nextLimit, total: 0, totalPages: 1, hasNext: false, hasPrev: false })}
            />
          </div>
        )}
      </div>

      </>)}

      {/* ═══════ EXPENSES TAB ═══════ */}
      {financeTab === 'expenses' && (
        <div ref={expensesListRef} className="space-y-4 scroll-mt-28">
          {expenses.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No expenses recorded yet</p>
              <p className="text-sm mt-1">Add your first expense to start tracking outflows.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 desktop:hidden">
                {expenses.map((expense) => (
                  <div key={`expense-mobile-${expense.id}`} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{expense.category}</p>
                        <p className="text-xs font-semibold text-slate-500 mt-1">{expense.vendor || 'No vendor added'}</p>
                      </div>
                      <span className="text-sm font-black text-slate-900">₹{Number(expense.amount).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{expense.description || 'No description added.'}</p>
                    <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-slate-500">
                      <span>{expense.bill_date ? new Date(expense.bill_date).toLocaleDateString('en-GB') : 'No date'}</span>
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 uppercase">{expense.payment_mode}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden desktop:block overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Category</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Vendor</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Mode</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {expenses.map(e => (
                    <tr key={e.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-bold text-slate-700">{e.category}</td>
                      <td className="px-4 py-3 text-slate-600">{e.vendor || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{e.description || '—'}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">₹{Number(e.amount).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-500">{e.bill_date ? new Date(e.bill_date).toLocaleDateString('en-GB') : '—'}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-slate-100 text-slate-600">{e.payment_mode}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════ PAYROLL TAB ═══════ */}
      {financeTab === 'payroll' && (
        <div ref={payrollListRef} className="space-y-4 scroll-mt-28">
          {payrollEntries.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No payroll entries yet</p>
              <p className="text-sm mt-1">Add staff salary records to track payroll.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 desktop:hidden">
                {payrollEntries.map((entry) => (
                  <div key={`payroll-mobile-${entry.id}`} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{entry.staff_name}</p>
                        <p className="text-xs font-semibold text-slate-500 mt-1">{entry.staff_role || 'Staff'}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${String(entry.status || '').toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{String(entry.status || '').toUpperCase() === 'PAID' ? 'Paid' : 'Pending'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm font-semibold text-slate-600">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Base</p>
                        <p className="font-black text-slate-900">₹{Number(entry.base_pay).toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Net Pay</p>
                        <p className="font-black text-slate-900">₹{Number(entry.net_pay).toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl bg-rose-50 border border-rose-100 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-rose-500/70 mb-1">Deductions</p>
                        <p className="font-black text-rose-600">₹{Number(entry.deductions).toLocaleString()}</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/70 mb-1">Commission</p>
                        <p className="font-black text-emerald-600">₹{Number(entry.commission).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                      <span>{entry.pay_period || 'No pay period set'}</span>
                      {String(entry.status || '').toUpperCase() === 'PAID' ? (
                        <span className="text-slate-400 font-bold">Cleared</span>
                      ) : (
                        <button onClick={() => markPayrollPaid(entry)} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-slate-800">
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden desktop:block overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Staff</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Base</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Deductions</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Commission</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Net Pay</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Period</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {payrollEntries.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-bold text-slate-700">{p.staff_name}</td>
                      <td className="px-4 py-3 text-slate-600">{p.staff_role || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{Number(p.base_pay).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-rose-600">-₹{Number(p.deductions).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">+₹{Number(p.commission).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">₹{Number(p.net_pay).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-500">{p.pay_period || '—'}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${String(p.status || '').toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{String(p.status || '').toUpperCase() === 'PAID' ? 'Paid' : 'Pending'}</span></td>
                      <td className="px-4 py-3 text-right">
                        {String(p.status || '').toUpperCase() === 'PAID' ? (
                          <span className="text-xs font-bold text-slate-400">Cleared</span>
                        ) : (
                          <button onClick={() => markPayrollPaid(p)} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-slate-800">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════ POS TAB ═══════ */}
      {financeTab === 'pos' && (
        <div ref={posCatalogRef} className="space-y-4 scroll-mt-28">
          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-slate-100 bg-white p-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Product Catalog</h3>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Tap products to add them to the checkout cart.</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 self-start">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sales Today</p>
                    <p className="text-sm font-black text-slate-900 mt-1">₹{financeSummary.posToday.toLocaleString()}</p>
                  </div>
                </div>
                {posProducts.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <p className="text-lg font-bold">No products in store</p>
                    <p className="text-sm mt-1">Add supplements, merchandise, or other products.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 desktop:grid-cols-2 2xl:grid-cols-3 gap-3">
                    {posProducts.map(p => {
                      const lowStock = Number(p.stock_qty || 0) <= Number(p.low_stock_threshold || 5);
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => addProductToCart(p)}
                          disabled={Number(p.stock_qty || 0) <= 0}
                          className="text-left bg-white rounded-2xl border border-slate-100 p-4 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
                              <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{p.category}</p>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase ${lowStock ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>{lowStock ? 'Low Stock' : 'Ready'}</span>
                          </div>
                          <div className="flex justify-between items-end mt-4">
                            <p className="text-lg font-black text-slate-900">₹{Number(p.price).toLocaleString()}</p>
                            <p className={`text-xs font-bold ${lowStock ? 'text-rose-500' : 'text-emerald-600'}`}>{p.stock_qty} in stock</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-slate-100 bg-white p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Recent POS Bills</h3>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Latest desk sales with line items.</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total POS Sales</p>
                    <p className="text-sm font-black text-slate-900 mt-1">{posSales.length}</p>
                  </div>
                </div>
                {posSales.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <p className="text-lg font-bold">No POS sales yet</p>
                    <p className="text-sm mt-1">Complete the first checkout to start the counter ledger.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {posSales.slice(0, 5).map((sale) => (
                      <div key={sale.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-900">{sale.member_name || 'Walk-in sale'}</p>
                            <p className="text-xs font-bold text-slate-500 mt-1">{new Date(sale.created_at).toLocaleString()} • {sale.payment_mode}</p>
                            <p className="text-xs font-semibold text-slate-500 mt-2">{Array.isArray(sale.items) ? sale.items.map((item) => `${item.product_name} x${item.quantity}`).join(', ') : 'Items unavailable'}</p>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="text-lg font-black text-slate-900">₹{Number(sale.total_amount).toLocaleString()}</p>
                            <p className="text-xs font-bold text-slate-400 mt-1">Sold by {sale.sold_by_name || 'Desk'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-900 bg-slate-900 text-white p-5 h-fit">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <h3 className="text-lg font-black">Checkout Cart</h3>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">Attach a member if needed and bill from the desk.</p>
                </div>
                <button type="button" onClick={() => setPosCart([])} className="text-xs font-black uppercase tracking-wider text-slate-300 hover:text-white">Clear</button>
              </div>

              <div className="space-y-3 mb-5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Member</label>
                  <select value={posCheckout.member_id} onChange={(e) => setPosCheckout((prev) => ({ ...prev, member_id: e.target.value }))} className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white outline-none">
                    <option value="">Walk-in / no member</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Payment Mode</label>
                  <select value={posCheckout.payment_mode} onChange={(e) => setPosCheckout((prev) => ({ ...prev, payment_mode: e.target.value }))} className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white outline-none">
                    {['Cash', 'Online', 'Card', 'UPI'].map((mode) => (
                      <option key={mode} value={mode}>{mode}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Desk Notes</label>
                  <textarea value={posCheckout.notes} onChange={(e) => setPosCheckout((prev) => ({ ...prev, notes: e.target.value }))} className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white outline-none min-h-[88px] resize-none" placeholder="Optional note for the sale" />
                </div>
              </div>

              <div className="space-y-3 mb-5 max-h-[340px] overflow-y-auto pr-1">
                {posCart.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-800/80 px-4 py-8 text-center text-slate-400">
                    <p className="text-sm font-bold">Your cart is empty</p>
                    <p className="text-xs font-semibold mt-1">Add a product from the catalog to start checkout.</p>
                  </div>
                ) : (
                  posCart.map((item) => (
                    <div key={item.product_id} className="rounded-2xl border border-slate-800 bg-slate-800/80 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-white">{item.name}</p>
                          <p className="text-xs font-bold text-slate-400 mt-1">₹{Number(item.unit_price).toLocaleString()} each • {item.stock_qty} in stock</p>
                        </div>
                        <button type="button" onClick={() => removeCartItem(item.product_id)} className="p-2 rounded-xl hover:bg-slate-700 text-slate-400 hover:text-white">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-3">
                        <input
                          type="number"
                          min="1"
                          max={item.stock_qty}
                          value={item.quantity}
                          onChange={(e) => updateCartQuantity(item.product_id, e.target.value)}
                          className="w-24 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white outline-none"
                        />
                        <p className="text-sm font-black text-white">₹{(Number(item.unit_price) * Number(item.quantity)).toLocaleString()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-white text-slate-900 px-4 py-4">
                <div className="flex items-center justify-between text-sm font-bold text-slate-500">
                  <span>Items</span>
                  <span>{posCart.length}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-base font-black">Total</span>
                  <span className="text-2xl font-black">₹{posCartTotal.toLocaleString()}</span>
                </div>
                <button onClick={handleCheckoutPosSale} disabled={posSubmitting || posCart.length === 0} className="w-full mt-4 py-3 rounded-xl bg-slate-900 text-white font-black hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed">
                  {posSubmitting ? 'Processing...' : 'Complete Sale'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      </div>{/* end glass card */}

      {/* RECORD PAYMENT MODAL */}
      {showModal && (
        <div className="app-modal-shell z-[90] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowMemberDropdown(false)}>
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Record Transaction</h2><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Log a manual payment</p></div>
              <button onClick={() => { setShowModal(false); setMemberSearch(''); setShowMemberDropdown(false); }} className="bg-white p-2 rounded-full text-slate-400 hover:text-slate-900 shadow-sm transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleRecordPayment} className="app-modal-scroll p-6 space-y-5">
              {/* Member searchable combobox */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Select Member</label>
                <div className="relative">
                  <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-slate-900/10">
                    <Search size={14} className="text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="Search member by name or phone..."
                      className="flex-1 bg-transparent font-bold text-slate-900 outline-none text-sm placeholder:font-normal placeholder:text-slate-400"
                      value={memberSearch}
                      onFocus={() => { setShowMemberDropdown(true); loadMemberOptions(memberSearch); }}
                      onChange={e => {
                        const nextValue = e.target.value;
                        setMemberSearch(nextValue);
                        setShowMemberDropdown(true);
                        if (!nextValue) setFormData(f => ({...f, user_id: ''}));
                        loadMemberOptions(nextValue);
                      }}
                    />
                    {formData.user_id && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg shrink-0">Selected</span>}
                  </div>
                  {showMemberDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {members.map(m => (
                        <button key={m.id} type="button"
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${formData.user_id === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-900'}`}
                          onClick={() => { setFormData(f => ({...f, user_id: m.id})); setMemberSearch(m.full_name); setShowMemberDropdown(false); }}>
                          <span className="font-bold">{m.full_name}</span>
                          <span className="text-slate-400 text-xs ml-2">{m.phone || m.email}</span>
                        </button>
                      ))}
                      {members.length === 0 && (
                        <div className="px-4 py-3 text-sm text-slate-400 font-bold">No members found</div>
                      )}
                    </div>
                  )}
                </div>
                {/* Hidden native required validation */}
                <input type="text" required className="sr-only" readOnly value={formData.user_id} />
              </div>
              <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Select Plan</label><div className="relative"><select required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none appearance-none" value={formData.plan_id} onChange={handlePlanSelect}><option value="">-- Choose Plan --</option>{plans.map(p => (<option key={p.id} value={p.id}>{p.name} - ₹{p.price}</option>))}</select><ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} /></div></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Total Amount (₹)</label><input type="number" readOnly className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-500 outline-none cursor-not-allowed" value={formData.total_amount} /></div>
                <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Amount Paid (₹)</label><input type="number" required className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-emerald-600 outline-none focus:ring-2 focus:ring-emerald-500/20" placeholder="0" value={formData.amount_paid} onChange={e => setFormData({...formData, amount_paid: e.target.value})} /></div>
              </div>
              <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Payment Mode</label><div className="flex gap-2">{['Cash', 'Online'].map(mode => (<button key={mode} type="button" onClick={() => setFormData({...formData, payment_mode: mode})} className={`flex-1 py-3 rounded-xl text-xs font-bold border-2 transition-all ${formData.payment_mode === mode ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300'}`}>{mode}</button>))}</div></div>
              <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Razorpay / UPI Reference ID</label><input type="text" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="e.g. pay_Lw82..." value={formData.transaction_id} onChange={e => setFormData({...formData, transaction_id: e.target.value})} /></div>
              <button type="submit" disabled={recordSubmitting} className="w-full py-4 bg-emerald-500 text-white rounded-xl font-black text-sm uppercase tracking-wider hover:bg-emerald-600 shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"><CheckCircle2 size={18} /> {recordSubmitting ? 'Saving...' : 'Confirm Payment'}</button>
            </form>
          </div>
        </div>
      )}

      {dueModalPayment && (
        <div className="app-modal-shell z-[95] bg-slate-950/65 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel bg-white rounded-[30px] w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="relative overflow-hidden px-6 py-6 border-b border-orange-100 text-white" style={{ background: 'linear-gradient(135deg, #111827 0%, #7c2d12 45%, #f97316 100%)' }}>
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at top right, rgba(255,255,255,0.7) 0%, transparent 32%)' }} />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-100/80 mb-2">Pending Balance</p>
                  <h2 className="text-2xl font-black tracking-tight">Collect Due</h2>
                  <p className="text-sm font-semibold text-orange-50/80 mt-1">Send a Razorpay payment link, show your gym UPI QR, or settle the balance in cash.</p>
                </div>
                <button onClick={() => !dueSubmitting && resetDueModal()} className="bg-white/10 p-2 rounded-full text-white/80 hover:text-white transition-colors disabled:opacity-50" disabled={dueSubmitting}><X size={20} /></button>
              </div>
            </div>

            <form onSubmit={handleCollectDue} className="app-modal-scroll p-6 space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Member</p>
                  <p className="text-lg font-black text-slate-900">{dueModalPayment.member_name}</p>
                  <p className="text-xs font-semibold text-slate-500 mt-1">{dueModalPayment.plan_name || 'Membership'} · Invoice {dueModalPayment.invoice_id || dueModalPayment.id}</p>
                </div>
                <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4 text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-500/70 mb-1">Remaining</p>
                  <p className="text-2xl font-black text-orange-600">₹{roundMoney(dueModalPayment.amount_due || 0).toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Collection Amount</label>
                  <input type="number" min="0" step="0.01" max={roundMoney(dueModalPayment.amount_due || 0)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-slate-900 outline-none focus:ring-2 focus:ring-orange-500/20" value={dueFormData.amount} onChange={(e) => { setDueCollectionContext(null); setDueRazorpayContext(null); setDueStep('idle'); setDueFormData((prev) => ({ ...prev, amount: e.target.value, transaction_id: '' })); }} />
                  <div className="flex items-center gap-2 mt-2">
                    <button type="button" onClick={() => { setDueCollectionContext(null); setDueRazorpayContext(null); setDueStep('idle'); setDueFormData((prev) => ({ ...prev, amount: String(roundMoney(dueModalPayment.amount_due || 0)), transaction_id: '' })); }} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-50 text-orange-600 border border-orange-100">Full Balance</button>
                    <button type="button" onClick={() => { setDueCollectionContext(null); setDueRazorpayContext(null); setDueStep('idle'); setDueFormData((prev) => ({ ...prev, amount: String(roundMoney((dueModalPayment.amount_due || 0) / 2)), transaction_id: '' })); }} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-200">Half Now</button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Online', 'Cash'].map((mode) => (
                      <button key={mode} type="button" onClick={() => { setDueCollectionContext(null); setDueRazorpayContext(null); setDueStep('idle'); setDueFormData((prev) => ({ ...prev, payment_mode: mode, transaction_id: '' })); }} className={`py-3 rounded-xl text-xs font-black border-2 transition-all ${dueFormData.payment_mode === mode ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300'}`}>
                        {mode === 'Online' ? 'Online / UPI' : mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-semibold text-slate-500 mt-2">{dueFormData.payment_mode === 'Online' ? 'Razorpay now sends the member a hosted payment link and also shows a QR on this screen.' : 'Record a smooth cash settlement right from the ledger.'}</p>
                </div>
              </div>

              {dueFormData.payment_mode === 'Online' && (
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
                          setDueOnlineMode(option.key);
                          setDueCollectionContext(null);
                          setDueRazorpayContext(null);
                          setDueStep('idle');
                          setDueFormData((prev) => ({ ...prev, transaction_id: '' }));
                        }}
                        className={`rounded-2xl border px-3 py-3 text-left transition-all ${dueOnlineMode === option.key ? 'border-orange-300 bg-orange-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        <p className={`text-xs font-black uppercase tracking-wider ${dueOnlineMode === option.key ? 'text-orange-700' : 'text-slate-700'}`}>{option.label}</p>
                        <p className="text-[11px] font-semibold text-slate-500 mt-1">{option.detail}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {dueFormData.payment_mode === 'Online' && dueOnlineMode === 'RAZORPAY' && dueRazorpayContext?.payment_link && (
                <div className="rounded-[26px] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-4 py-4 shadow-sm space-y-4">
                  <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                    <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-sm border border-orange-100">
                      <QRCodeCanvas
                        value={dueRazorpayContext.payment_link.short_url || 'https://razorpay.com'}
                        size={156}
                        includeMargin
                        bgColor="#ffffff"
                        fgColor="#111827"
                        level="M"
                      />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-500/70">Razorpay Payment Link</p>
                        <p className="text-lg font-black text-slate-900 mt-1">₹{formatCollectionAmount(dueRazorpayContext.payment_link.amount)}</p>
                        <p className="text-sm font-semibold text-slate-600 mt-1">
                          {describeCollectionLinkDelivery(dueRazorpayContext.payment_link).message}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/90 px-3 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Link Status</p>
                          <p className="text-sm font-black text-slate-900 uppercase">{String(dueRazorpayContext.payment_link.status || 'created')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Delivery</p>
                          <p className="text-sm font-bold text-slate-700">
                            {describeCollectionLinkDelivery(dueRazorpayContext.payment_link).label}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => openCollectionLink(dueRazorpayContext.payment_link.short_url)} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Open Link</button>
                        <button type="button" onClick={() => checkDueRazorpayStatus({ manual: true })} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Check Status</button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold text-orange-700/80">The member can pay on their own phone from the Razorpay link, or scan this QR from your phone. We also keep checking automatically while this sheet stays open.</p>
                </div>
              )}

              {dueFormData.payment_mode === 'Online' && dueOnlineMode === 'UPI' && dueCollectionContext && (
                <div className="rounded-[26px] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-4 py-4 shadow-sm">
                  <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                    <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-sm border border-orange-100">
                      <QRCodeCanvas
                        value={buildUpiCollectionUri({
                          upiId: dueCollectionContext.upi_id,
                          payeeName: dueCollectionContext.payee_name,
                          amount: dueCollectionContext.amount,
                          note: dueCollectionContext.note,
                          reference: dueCollectionContext.reference,
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
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-500/70">Owner Collection QR</p>
                        <p className="text-lg font-black text-slate-900 mt-1">₹{formatCollectionAmount(dueCollectionContext.amount)}</p>
                        <p className="text-sm font-semibold text-slate-600 mt-1">Ask {dueModalPayment.member_name} to scan and pay this exact amount.</p>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/90 px-3 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">UPI ID</p>
                          <p className="text-sm font-black text-slate-900 break-all">{dueCollectionContext.upi_id}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Collect Into</p>
                          <p className="text-sm font-bold text-slate-700">{dueCollectionContext.payee_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reference</p>
                          <p className="text-sm font-bold text-slate-700 break-all">{dueCollectionContext.reference}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleCopyDueCollectionDetail(dueCollectionContext.upi_id, 'UPI ID copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-orange-600 border border-orange-200 hover:bg-orange-50 transition-colors">Copy UPI ID</button>
                        <button type="button" onClick={() => handleCopyDueCollectionDetail(dueCollectionContext.reference, 'Collection reference copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Copy Reference</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(dueFormData.payment_mode === 'Cash' || (dueFormData.payment_mode === 'Online' && dueOnlineMode === 'UPI' && dueCollectionContext)) && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">{dueFormData.payment_mode === 'Online' ? 'UPI UTR / Collection Reference' : 'Cash / Desk Reference'}</label>
                  <input type="text" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10" placeholder={dueFormData.payment_mode === 'Online' ? 'Paste the UPI UTR or keep the generated reference' : 'Optional desk reference'} value={dueFormData.transaction_id} onChange={(e) => setDueFormData((prev) => ({ ...prev, transaction_id: e.target.value }))} />
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Internal Note</label>
                <textarea rows="3" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 resize-none" placeholder="Optional note for this settlement" value={dueFormData.notes} onChange={(e) => setDueFormData((prev) => ({ ...prev, notes: e.target.value }))} />
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">After Collection</p>
                  <p className="text-sm font-bold text-slate-800 mt-1">Remaining due will be ₹{Math.max(0, roundMoney((dueModalPayment.amount_due || 0) - (Number.parseFloat(dueFormData.amount || 0) || 0))).toLocaleString()}</p>
                </div>
                <div className={`text-[10px] font-black uppercase tracking-[0.18em] px-2.5 py-1 rounded-full ${dueStep === 'processing' ? 'bg-orange-100 text-orange-600' : dueStep === 'collecting' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-600'}`}>
                  {dueStep === 'processing' ? 'Processing' : dueStep === 'collecting' ? (dueOnlineMode === 'RAZORPAY' ? 'Link Live' : 'QR Ready') : 'Ready'}
                </div>
              </div>

              <button type="submit" disabled={dueSubmitting} className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-[0.18em] text-white transition-all active:scale-[0.99] disabled:opacity-60" style={{ background: dueFormData.payment_mode === 'Online' ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'linear-gradient(135deg, #111827, #334155)', boxShadow: dueFormData.payment_mode === 'Online' ? '0 14px 30px rgba(249,115,22,0.25)' : '0 14px 30px rgba(15,23,42,0.18)' }}>
                {dueSubmitting
                  ? (dueFormData.payment_mode === 'Online'
                    ? (dueOnlineMode === 'RAZORPAY'
                      ? (dueRazorpayContext ? 'Checking Razorpay Payment...' : 'Sending Razorpay Link...')
                      : (dueCollectionContext ? 'Recording Collection...' : 'Preparing Collection QR...'))
                    : 'Collecting Due...')
                  : (dueFormData.payment_mode === 'Online'
                    ? (dueOnlineMode === 'RAZORPAY'
                      ? (dueRazorpayContext ? 'Check Razorpay Payment' : 'Send Razorpay Link & Show QR')
                      : (dueCollectionContext ? 'Mark Direct UPI Received' : 'Show Direct UPI QR'))
                    : 'Record Cash Collection')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      {showReceipt && selectedPayment && (
        <div className="app-modal-shell z-[90] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel bg-white rounded-[24px] w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-emerald-500 p-6 text-center text-white relative">
              <button onClick={() => setShowReceipt(false)} className="absolute right-4 top-4 text-white/80 hover:text-white"><X size={20}/></button>
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-md"><CheckCircle2 size={24} className="text-white"/></div>
              <h3 className="text-xl font-black">Payment Successful</h3>
            </div>
            <div className="app-modal-scroll p-6 space-y-4">
              <div className="text-center mb-6"><p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Total Amount Paid</p><h2 className="text-3xl font-black text-slate-900 mt-1">₹{parseFloat(selectedPayment.amount_paid).toLocaleString()}</h2></div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-slate-500 font-bold">Member</span><span className="text-slate-900 font-bold">{selectedPayment.member_name}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500 font-bold">Ref ID</span><span className="font-mono text-slate-900 font-bold bg-slate-100 px-2 rounded">{selectedPayment.transaction_id || selectedPayment.invoice_id || 'N/A'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500 font-bold">Date</span><span className="text-slate-900 font-bold">{new Date(selectedPayment.payment_date).toLocaleDateString()}</span></div>
              </div>
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><History size={12}/> Recent Transactions</h4>
                {historyLoading ? (
                  <div className="text-center py-4 text-slate-400 text-xs">Loading history...</div>
                ) : (
                  <div className="space-y-2">
                    {memberHistory.map((hist, i) => (<div key={i} className="flex justify-between items-center text-xs p-2 rounded-lg bg-slate-50 gap-2"><div><div className="font-bold text-slate-600">{new Date(hist.payment_date).toLocaleDateString()}</div><div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mt-0.5">{hist.entry_type === 'DUE_COLLECTION' ? 'Due Collection' : 'Payment'}</div></div><div className="font-black text-slate-900">₹{hist.amount_paid}</div><div className="text-slate-400 text-right">{hist.transaction_id || hist.invoice_id}</div></div>))}
                    {memberHistory.length === 0 && <div className="text-xs text-slate-400 italic">No previous records found.</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
              {parseFloat(selectedPayment.amount_due || 0) > 0 && (
                <button onClick={() => { setShowReceipt(false); openDueModal(selectedPayment); }} className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-sm hover:opacity-90 transition-all active:scale-95">
                  Collect Remaining Due
                </button>
              )}
              <button onClick={handleDownloadReceipt} className="w-full py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 shadow-sm flex justify-center items-center gap-2 hover:bg-slate-100 active:scale-95 transition-all"><ArrowDownToLine size={16}/> Download Receipt</button>
              <button onClick={() => handleDeletePayment(selectedPayment.id)} className="w-full py-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl font-bold text-xs flex justify-center items-center gap-2 hover:bg-rose-600 hover:text-white transition-all active:scale-95"><Trash2 size={14}/> Delete This Record</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Expense Modal ── */}
      {showExpenseModal && (
        <div className="app-modal-shell z-[90] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Add Expense</h2></div>
              <button onClick={() => setShowExpenseModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Category</label>
                  <select value={expenseForm.category} onChange={e => setExpenseForm(p => ({ ...p, category: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm">
                    <option value="">Select</option>
                    {['Rent', 'Utilities', 'Equipment', 'Maintenance', 'Marketing', 'Insurance', 'Supplies', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Mode</label>
                  <select value={expenseForm.payment_mode} onChange={e => setExpenseForm(p => ({ ...p, payment_mode: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm">
                    {['Cash', 'Online', 'UPI', 'Card', 'Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Vendor</label><input value={expenseForm.vendor} onChange={e => setExpenseForm(p => ({ ...p, vendor: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="e.g. Electricity Board" /></div>
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Description</label><input value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Amount (₹)</label><input type="number" value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Bill Date</label><input type="date" value={expenseForm.bill_date} onChange={e => setExpenseForm(p => ({ ...p, bill_date: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              </div>
              <button onClick={handleSaveExpense} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Save Expense</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Payroll Modal ── */}
      {showPayrollModal && (
        <div className="app-modal-shell z-[90] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Add Payroll Entry</h2></div>
              <button onClick={() => setShowPayrollModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="app-modal-scroll p-4 sm:p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Staff Member</label>
                <select value={payrollForm.user_id} onChange={e => setPayrollForm(p => ({ ...p, user_id: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm">
                  <option value="">Select staff member</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.full_name} {staff.staff_role ? `• ${staff.staff_role}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Base Pay</label><input type="number" value={payrollForm.base_pay} onChange={e => setPayrollForm(p => ({ ...p, base_pay: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Deductions</label><input type="number" value={payrollForm.deductions} onChange={e => setPayrollForm(p => ({ ...p, deductions: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Commission</label><input type="number" value={payrollForm.commission} onChange={e => setPayrollForm(p => ({ ...p, commission: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              </div>
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Pay Period</label><input value={payrollForm.pay_period} onChange={e => setPayrollForm(p => ({ ...p, pay_period: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="e.g. Jan 2025" /></div>
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Notes</label><textarea value={payrollForm.notes} onChange={e => setPayrollForm(p => ({ ...p, notes: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm min-h-[88px] resize-none" placeholder="Optional context for this payroll entry" /></div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Net Pay Preview</p>
                <p className="text-lg font-black text-slate-900 mt-1">₹{(Number(payrollForm.base_pay || 0) + Number(payrollForm.commission || 0) - Number(payrollForm.deductions || 0)).toLocaleString()}</p>
              </div>
              <button onClick={handleSavePayroll} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Save Payroll</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add POS Product Modal ── */}
      {showPosModal && (
        <div className="app-modal-shell z-[90] bg-slate-900/60 backdrop-blur-sm">
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Add Product</h2></div>
              <button onClick={() => setShowPosModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Product Name</label><input value={posForm.name} onChange={e => setPosForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Category</label>
                  <select value={posForm.category} onChange={e => setPosForm(p => ({ ...p, category: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm">
                    {['supplement', 'merchandise', 'accessory', 'beverage', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Price (₹)</label><input type="number" value={posForm.price} onChange={e => setPosForm(p => ({ ...p, price: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Stock Qty</label><input type="number" value={posForm.stock_qty} onChange={e => setPosForm(p => ({ ...p, stock_qty: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              </div>
              <button onClick={handleSavePosProduct} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800">Save Product</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentsPage;
