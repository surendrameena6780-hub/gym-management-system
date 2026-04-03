import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { 
  Search, Filter, Download, Plus, DollarSign, 
  AlertCircle, FileText, CheckCircle2, 
  Clock, X, ChevronDown, User, ArrowDownToLine, History, Wallet, CreditCard, Trash2
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';

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

// ─── Count-Up Hook ────────────────────────────────────────────────────────────

function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const prevTarget = useRef(null);
  useEffect(() => {
    if (prevTarget.current === target) return;
    prevTarget.current = target;
    const start = display;
    const end = Number(target) || 0;
    if (start === end) return;
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return display;
}

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
};

// ─── Main Component ──────────────────────────────────────────────────────────

const PaymentsPage = ({ token, toast, showConfirm, defaultFilter = 'All', focusPaymentId = null, focusAction = null, onFocusHandled }) => {
  const [payments, setPayments] = useState([]);
  const [filteredPayments, setFilteredPayments] = useState([]);
  const [stats, setStats] = useState({ total_revenue: 0, today_revenue: 0, pending_dues: 0 });
  const [loading, setLoading] = useState(true);

  // Count-up animated values for stat cards
  const animatedTotalRevenue = useCountUp(parseFloat(stats.total_revenue || 0));
  const animatedTodayRevenue = useCountUp(parseFloat(stats.today_revenue || 0));
  const animatedPendingDues  = useCountUp(parseFloat(stats.pending_dues  || 0));

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeFilter, setActiveFilter] = useState(defaultFilter || 'All');

  const [showModal, setShowModal] = useState(false);
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

  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);

  const [formData, setFormData] = useState({
    user_id: '', plan_id: '', amount_paid: '', total_amount: '', payment_mode: 'Online', transaction_id: '', notes: ''
  });

  const paymentsListRef = useRef(null);
  const paymentsScrollState = useRef({ lastY: 0, velocity: 0, rafId: null });

  // ── Finance Hub State ──
  const [financeTab, setFinanceTab] = useState('collections');
  const [expenses, setExpenses] = useState([]);
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [posProducts, setPosProducts] = useState([]);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: '', vendor: '', description: '', amount: '', bill_date: '', payment_mode: 'Cash' });
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [payrollForm, setPayrollForm] = useState({ staff_name: '', role: '', base_salary: '', deductions: '0', bonus: '0', pay_period: '' });
  const [showPosModal, setShowPosModal] = useState(false);
  const [posForm, setPosForm] = useState({ name: '', category: 'supplement', price: '', stock_qty: '' });

  const fetchExpenses = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/expenses', { headers: { 'x-auth-token': token } });
      setExpenses(Array.isArray(res.data) ? res.data : []);
    } catch { setExpenses([]); }
  }, [token]);

  const fetchPayroll = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/payroll', { headers: { 'x-auth-token': token } });
      setPayrollEntries(Array.isArray(res.data) ? res.data : []);
    } catch { setPayrollEntries([]); }
  }, [token]);

  const fetchPosProducts = useCallback(async () => {
    try {
      const res = await axios.get('/api/finance/pos/products', { headers: { 'x-auth-token': token } });
      setPosProducts(Array.isArray(res.data) ? res.data : []);
    } catch { setPosProducts([]); }
  }, [token]);

  useEffect(() => {
    if (financeTab === 'expenses') fetchExpenses();
    else if (financeTab === 'payroll') fetchPayroll();
    else if (financeTab === 'pos') fetchPosProducts();
  }, [financeTab, fetchExpenses, fetchPayroll, fetchPosProducts]);

  const handleSaveExpense = async () => {
    try {
      await axios.post('/api/finance/expenses', expenseForm, { headers: { 'x-auth-token': token } });
      toast?.('Expense added', 'success');
      setShowExpenseModal(false);
      setExpenseForm({ category: '', vendor: '', description: '', amount: '', bill_date: '', payment_mode: 'Cash' });
      fetchExpenses();
    } catch { toast?.('Failed to add expense', 'error'); }
  };

  const handleSavePayroll = async () => {
    try {
      await axios.post('/api/finance/payroll', payrollForm, { headers: { 'x-auth-token': token } });
      toast?.('Payroll entry added', 'success');
      setShowPayrollModal(false);
      setPayrollForm({ staff_name: '', role: '', base_salary: '', deductions: '0', bonus: '0', pay_period: '' });
      fetchPayroll();
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

  const getImageUrl = (path) => normalizeProfileImageUrl(path);

  const matchesFilter = useCallback((payment, filter) => {
    if (filter === 'Pending') {
      return String(payment.status || '').toLowerCase() === 'pending' && Number(payment.amount_due || 0) > 0;
    }
    if (filter === 'Cash') {
      const mode = String(payment.effective_payment_mode || payment.payment_mode || '').toLowerCase();
      return mode === 'cash' || mode === 'mixed';
    }
    if (filter === 'Online') {
      const mode = String(payment.effective_payment_mode || payment.payment_mode || '').toLowerCase();
      return mode === 'online' || mode === 'mixed';
    }
    return true;
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const headers = { 'x-auth-token': token };
      const paymentUrl = searchTerm
        ? `/api/payments?search=${encodeURIComponent(searchTerm)}`
        : '/api/payments';
      const [paymentsRes, statsRes, membersRes, plansRes] = await Promise.all([
        axios.get(paymentUrl, { headers }),
        axios.get('/api/payments/stats', { headers }),
        axios.get('/api/members', { headers }),
        axios.get('/api/plans', { headers })
      ]);

      const paymentsData = extractArray(paymentsRes.data, ['payments', 'rows', 'items']).map((payment) => ({
        ...payment,
        profile_pic: normalizeProfileImageUrl(payment?.profile_pic),
      }));
      const membersData = extractArray(membersRes.data, ['members', 'rows', 'items']);
      const plansData = extractArray(plansRes.data, ['plans', 'rows', 'items']);

      setPayments(paymentsData);
        setFilteredPayments(paymentsData.filter((payment) => matchesFilter(payment, activeFilter)));

      setStats(extractObject(statsRes.data, { total_revenue: 0, today_revenue: 0, pending_dues: 0 }));
      setMembers(membersData);
      setPlans(plansData);
      setLoading(false);
    } catch (err) {
      console.error("Error loading data:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      const delayDebounceFn = setTimeout(() => { fetchData(); }, 300);
      return () => clearTimeout(delayDebounceFn);
    }
  }, [token, searchTerm]);

  useEffect(() => {
    setActiveFilter(defaultFilter || 'All');
  }, [defaultFilter]);

  useEffect(() => {
    setFilteredPayments(payments.filter((payment) => matchesFilter(payment, activeFilter)));
  }, [activeFilter, payments, matchesFilter]);

  useEffect(() => {
    const handleDashboardFilter = (event) => {
      const nextFilter = String(event?.detail?.filter || '').trim();
      if (!nextFilter) return;
      setActiveFilter(nextFilter);
    };

    window.addEventListener('gymvault:payments-filter', handleDashboardFilter);
    return () => window.removeEventListener('gymvault:payments-filter', handleDashboardFilter);
  }, []);

  const handleRecordPayment = async (e) => {
    if (e) e.preventDefault();
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
      await fetchData();
      window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments' } }));
      toast?.("Payment recorded successfully!", "success");
    } catch (err) {
      toast?.("Error recording payment. Please try again.", "error");
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
          await fetchData();
          window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments' } }));
          toast?.("Transaction deleted. Member status reset.", "success");
        } catch (err) {
          console.error("Delete failed", err);
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
    } catch (err) {
      // silently fail
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  const resetDueModal = useCallback(() => {
    setDueModalPayment(null);
    setDueFormData({ amount: '', payment_mode: 'Online', transaction_id: '', notes: '' });
    setDueStep('idle');
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
  }, [toast]);

  const settleDueLocally = useCallback(async (payload, fallbackMessage) => {
    const updatedPayment = { ...(dueModalPayment || {}), ...(payload?.payment || {}) };
    resetDueModal();
    await fetchData();
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', { detail: { source: 'payments-due' } }));
    toast?.(payload?.message || fallbackMessage || 'Pending due collected successfully.', 'success');
    if (updatedPayment?.id) {
      await openReceipt(updatedPayment);
    }
  }, [dueModalPayment, fetchData, openReceipt, resetDueModal, toast]);

  const handleCollectDue = async (e) => {
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
    setDueStep('processing');

    try {
      if (dueFormData.payment_mode === 'Online') {
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          toast?.('Failed to load Razorpay checkout.', 'error');
          setDueStep('idle');
          return;
        }

        const orderRes = await axios.post(
          `/api/payments/${dueModalPayment.id}/due/create-order`,
          { amount: requestedAmount, notes: dueFormData.notes },
          { headers: { 'x-auth-token': token } }
        );

        const order = orderRes.data?.order;
        const keyId = orderRes.data?.key_id;
        if (!order?.id || !keyId) {
          toast?.('Failed to start online due payment.', 'error');
          setDueStep('idle');
          return;
        }

        await new Promise((resolve) => {
          const options = {
            key: keyId,
            amount: order.amount,
            currency: order.currency || 'INR',
            name: 'Pending Due Collection',
            description: `${dueModalPayment.member_name || 'Member'} · ${dueModalPayment.plan_name || 'Membership'}`,
            order_id: order.id,
            prefill: {
              name: dueModalPayment.member_name || '',
              email: dueModalPayment.member_email || '',
              contact: orderRes.data?.payment?.member_phone || dueModalPayment.member_phone || '',
            },
            theme: { color: '#f97316' },
            handler: async (response) => {
              try {
                const verifyRes = await axios.post(
                  `/api/payments/${dueModalPayment.id}/due/verify`,
                  {
                    amount: requestedAmount,
                    notes: dueFormData.notes,
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  },
                  { headers: { 'x-auth-token': token } }
                );
                await settleDueLocally(verifyRes.data, 'Pending due collected successfully.');
              } catch (err) {
                toast?.(err?.response?.data?.error || 'Due payment verification failed.', 'error');
                setDueStep('idle');
              } finally {
                resolve();
              }
            },
            modal: {
              ondismiss: () => {
                setDueStep('idle');
                resolve();
              },
            },
          };
          const rzp = new window.Razorpay(options);
          rzp.open();
        });
      } else {
        const cashRes = await axios.post(
          `/api/payments/${dueModalPayment.id}/due/collect`,
          {
            amount: requestedAmount,
            transaction_id: dueFormData.transaction_id,
            notes: dueFormData.notes,
          },
          { headers: { 'x-auth-token': token } }
        );
        await settleDueLocally(cashRes.data, 'Pending due collected successfully.');
      }
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to collect pending due.', 'error');
      setDueStep('idle');
    } finally {
      setDueSubmitting(false);
    }
  };

  useEffect(() => {
    if (!focusPaymentId) return;
    const targetPayment = payments.find((payment) => Number(payment.id) === Number(focusPaymentId));
    if (!targetPayment) return;

    setActiveFilter('Pending');
    if (focusAction === 'collectDue') {
      openDueModal(targetPayment);
    } else {
      openReceipt(targetPayment);
    }
    onFocusHandled?.();
  }, [focusAction, focusPaymentId, onFocusHandled, openDueModal, openReceipt, payments]);

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
    payments.forEach(p => {
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
  }, [payments]);

  const collectionIntelligence = useMemo(() => {
    const completed = payments.filter((payment) => payment.status === 'Completed');
    const pending = payments.filter((payment) => payment.status !== 'Completed');
    const totalCollected = completed.reduce((sum, payment) => sum + (parseFloat(payment.amount_paid) || 0), 0);
    const averageTicket = completed.length > 0 ? Math.round(totalCollected / completed.length) : 0;
    const todayKey = new Date().toDateString();
    const todayCompleted = completed.filter((payment) => {
      const paymentDate = new Date(payment.payment_date);
      return !Number.isNaN(paymentDate.getTime()) && paymentDate.toDateString() === todayKey;
    });
    const onlineShare = Math.round(revenueSplit.onlinePer || 0);
    const pendingValue = Number(stats.pending_dues || 0);
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
    if (onlineShare < 45 && completed.length >= 4) {
      actions.push({
        id: 'increase-online-share',
        icon: CreditCard,
        tone: 'indigo',
        title: 'Increase digital collections',
        detail: `Only ${onlineShare}% of revenue is online. Push UPI or gateway payments at the desk.`,
      });
    }
    if (Number(stats.today_revenue || 0) > 0) {
      actions.push({
        id: 'today-pace',
        icon: CheckCircle2,
        tone: 'emerald',
        title: `${todayCompleted.length} payment${todayCompleted.length === 1 ? '' : 's'} logged today`,
        detail: `₹${Number(stats.today_revenue || 0).toLocaleString()} collected so far today.`,
      });
    } else {
      actions.push({
        id: 'today-pace',
        icon: Clock,
        tone: 'sky',
        title: 'No collections recorded today',
        detail: 'Capture walk-in renewals early to keep the day on pace.',
      });
    }
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
  }, [payments, revenueSplit, stats.pending_dues, stats.today_revenue]);

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
          <div className="flex gap-1 mt-3 bg-slate-100 rounded-xl p-0.5 w-fit">
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
      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          <div className="gv-pay-card-emerald relative overflow-hidden rounded-[20px] p-5 sm:p-6 border"
            style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)', borderColor: 'rgba(16,185,129,0.15)', boxShadow: '0 4px 20px rgba(16,185,129,0.08)', opacity: 0, animation: 'payCardIn 0.5s cubic-bezier(0.16,1,0.3,1) 120ms forwards' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-emerald-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Total Revenue</p>
                  <h3 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">₹{animatedTotalRevenue.toLocaleString()}</h3>
                  <p className="text-emerald-600 text-xs font-bold mt-1.5">All time earnings</p>
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
          <div className="lg:col-span-2 bg-white/90 p-5 sm:p-8 rounded-[24px] border border-slate-100/60" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
            <div>
              <h3 className="text-lg font-black text-slate-900">Collection Intelligence</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Short signals to improve cashflow today</p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 self-start">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      <div className="bg-white/90 rounded-[24px] border border-slate-100/60 overflow-hidden" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between gap-4">
          <div className="relative flex-1 max-w-md"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><input type="text" placeholder="Search..." className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10 transition-all" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowFilterDropdown(!showFilterDropdown); }} className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 flex items-center gap-2 hover:bg-slate-50"><Filter size={16}/> {activeFilter}</button>
            {showFilterDropdown && (<div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 p-2 z-10 animate-in fade-in zoom-in-95 duration-200">{['All', 'Cash', 'Online', 'Pending'].map(f => (<button key={f} onClick={() => { setActiveFilter(f); setShowFilterDropdown(false); }} className={`w-full text-left px-4 py-2 rounded-lg text-sm font-bold ${activeFilter === f ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>{f}</button>))}</div>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="md:hidden p-4">
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
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-900 truncate pr-2">{payment.member_name}</p>
                    <p className="font-black text-emerald-600">₹{parseFloat(payment.amount_paid).toLocaleString()}</p>
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
                    <td className="p-6"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 border border-slate-100">{payment.profile_pic ? (<img src={getImageUrl(payment.profile_pic)} onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} alt="Member" className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center font-black text-xs text-slate-500 bg-slate-200">{(payment.member_name || '?').charAt(0).toUpperCase()}</div>)}</div><div><div className="font-bold text-slate-900">{payment.member_name}</div><div className="text-xs font-bold text-slate-400">{payment.plan_name}</div></div></div></td>
                    <td className="p-6"><div className={`font-mono text-xs font-bold px-2 py-1 rounded w-fit ${payment.transaction_id || payment.invoice_id ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'}`}>{(payment.transaction_id && payment.transaction_id.trim() !== "" && payment.transaction_id !== "Processing...") ? payment.transaction_id : (payment.invoice_id || `ID-${payment.id}`)}</div></td>
                    <td className="p-6"><div className="text-sm font-bold text-slate-600">{new Date(payment.payment_date).toLocaleDateString()}</div><div className="text-xs font-bold text-slate-400 mt-0.5">{new Date(payment.payment_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div></td>
                    <td className="p-6"><div className="font-black text-slate-900">₹{parseFloat(payment.amount_paid).toLocaleString()}</div>{parseFloat(payment.amount_due) > 0 && (<div className="text-[10px] font-bold text-orange-500">Due: ₹{payment.amount_due}</div>)}</td>
                    <td className="p-6">{payment.status === 'Completed' ? (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> Paid</span>) : (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700"><Clock size={12} /> Pending</span>)}</td>
                    <td className="p-6"><div className="flex items-center justify-end gap-2">{parseFloat(payment.amount_due) > 0 && (<button onClick={() => openDueModal(payment)} className="px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-all">Collect Due</button>)}<button onClick={() => openReceipt(payment)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-900 transition-all"><FileText size={18} /></button></div></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      {/* ═══════ EXPENSES TAB ═══════ */}
      {financeTab === 'expenses' && (
        <div className="space-y-4">
          {expenses.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No expenses recorded yet</p>
              <p className="text-sm mt-1">Add your first expense to start tracking outflows.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-100">
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
          )}
        </div>
      )}

      {/* ═══════ PAYROLL TAB ═══════ */}
      {financeTab === 'payroll' && (
        <div className="space-y-4">
          {payrollEntries.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No payroll entries yet</p>
              <p className="text-sm mt-1">Add staff salary records to track payroll.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Staff</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Base</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Deductions</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Bonus</th>
                    <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-wider">Net Pay</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Period</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {payrollEntries.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-bold text-slate-700">{p.staff_name}</td>
                      <td className="px-4 py-3 text-slate-600">{p.role || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700">₹{Number(p.base_salary).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-rose-600">-₹{Number(p.deductions).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">+₹{Number(p.bonus).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">₹{Number(p.net_pay).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-500">{p.pay_period || '—'}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${p.paid_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.paid_at ? 'Paid' : 'Pending'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ POS TAB ═══════ */}
      {financeTab === 'pos' && (
        <div className="space-y-4">
          {posProducts.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg font-bold">No products in store</p>
              <p className="text-sm mt-1">Add supplements, merchandise, or other products.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {posProducts.map(p => (
                <div key={p.id} className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-sm transition-all">
                  <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
                  <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{p.category}</p>
                  <div className="flex justify-between items-end mt-3">
                    <p className="text-lg font-black text-slate-900">₹{Number(p.price).toLocaleString()}</p>
                    <p className={`text-xs font-bold ${p.stock_qty <= 5 ? 'text-rose-500' : 'text-emerald-600'}`}>{p.stock_qty} in stock</p>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                      onFocus={() => setShowMemberDropdown(true)}
                      onChange={e => { setMemberSearch(e.target.value); setShowMemberDropdown(true); if (!e.target.value) setFormData(f => ({...f, user_id: ''})); }}
                    />
                    {formData.user_id && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg shrink-0">Selected</span>}
                  </div>
                  {showMemberDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {members.filter(m => {
                        const q = memberSearch.toLowerCase();
                        return !q || m.full_name?.toLowerCase().includes(q) || m.phone?.includes(q) || m.email?.toLowerCase().includes(q);
                      }).slice(0, 20).map(m => (
                        <button key={m.id} type="button"
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${formData.user_id === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-900'}`}
                          onClick={() => { setFormData(f => ({...f, user_id: m.id})); setMemberSearch(m.full_name); setShowMemberDropdown(false); }}>
                          <span className="font-bold">{m.full_name}</span>
                          <span className="text-slate-400 text-xs ml-2">{m.phone || m.email}</span>
                        </button>
                      ))}
                      {members.filter(m => { const q = memberSearch.toLowerCase(); return !q || m.full_name?.toLowerCase().includes(q) || m.phone?.includes(q); }).length === 0 && (
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
              <button type="submit" className="w-full py-4 bg-emerald-500 text-white rounded-xl font-black text-sm uppercase tracking-wider hover:bg-emerald-600 shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2"><CheckCircle2 size={18} /> Confirm Payment</button>
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
                  <p className="text-sm font-semibold text-orange-50/80 mt-1">Settle the remaining balance smoothly with Razorpay or cash.</p>
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
                  <input type="number" min="0" step="0.01" max={roundMoney(dueModalPayment.amount_due || 0)} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-slate-900 outline-none focus:ring-2 focus:ring-orange-500/20" value={dueFormData.amount} onChange={(e) => setDueFormData((prev) => ({ ...prev, amount: e.target.value }))} />
                  <div className="flex items-center gap-2 mt-2">
                    <button type="button" onClick={() => setDueFormData((prev) => ({ ...prev, amount: String(roundMoney(dueModalPayment.amount_due || 0)) }))} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-50 text-orange-600 border border-orange-100">Full Balance</button>
                    <button type="button" onClick={() => setDueFormData((prev) => ({ ...prev, amount: String(roundMoney((dueModalPayment.amount_due || 0) / 2)) }))} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-200">Half Now</button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Payment Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Online', 'Cash'].map((mode) => (
                      <button key={mode} type="button" onClick={() => setDueFormData((prev) => ({ ...prev, payment_mode: mode }))} className={`py-3 rounded-xl text-xs font-black border-2 transition-all ${dueFormData.payment_mode === mode ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300'}`}>
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-semibold text-slate-500 mt-2">{dueFormData.payment_mode === 'Online' ? 'Razorpay opens with the exact pending balance.' : 'Record a smooth cash settlement right from the ledger.'}</p>
                </div>
              </div>

              {dueFormData.payment_mode === 'Cash' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Cash / UPI Reference</label>
                  <input type="text" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Optional desk reference" value={dueFormData.transaction_id} onChange={(e) => setDueFormData((prev) => ({ ...prev, transaction_id: e.target.value }))} />
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
                <div className={`text-[10px] font-black uppercase tracking-[0.18em] px-2.5 py-1 rounded-full ${dueStep === 'processing' ? 'bg-orange-100 text-orange-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {dueStep === 'processing' ? 'Processing' : 'Ready'}
                </div>
              </div>

              <button type="submit" disabled={dueSubmitting} className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-[0.18em] text-white transition-all active:scale-[0.99] disabled:opacity-60" style={{ background: dueFormData.payment_mode === 'Online' ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'linear-gradient(135deg, #111827, #334155)', boxShadow: dueFormData.payment_mode === 'Online' ? '0 14px 30px rgba(249,115,22,0.25)' : '0 14px 30px rgba(15,23,42,0.18)' }}>
                {dueSubmitting ? (dueFormData.payment_mode === 'Online' ? 'Opening Razorpay...' : 'Collecting Due...') : (dueFormData.payment_mode === 'Online' ? 'Pay Pending Due Online' : 'Record Cash Collection')}
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
          <div className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Add Payroll Entry</h2></div>
              <button onClick={() => setShowPayrollModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Staff Name</label><input value={payrollForm.staff_name} onChange={e => setPayrollForm(p => ({ ...p, staff_name: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Role</label><input value={payrollForm.role} onChange={e => setPayrollForm(p => ({ ...p, role: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Trainer, Reception..." /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Base Salary</label><input type="number" value={payrollForm.base_salary} onChange={e => setPayrollForm(p => ({ ...p, base_salary: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Deductions</label><input type="number" value={payrollForm.deductions} onChange={e => setPayrollForm(p => ({ ...p, deductions: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
                <div><label className="text-xs font-bold text-slate-600 block mb-1">Bonus</label><input type="number" value={payrollForm.bonus} onChange={e => setPayrollForm(p => ({ ...p, bonus: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" /></div>
              </div>
              <div><label className="text-xs font-bold text-slate-600 block mb-1">Pay Period</label><input value={payrollForm.pay_period} onChange={e => setPayrollForm(p => ({ ...p, pay_period: e.target.value }))} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="e.g. Jan 2025" /></div>
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
