import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { 
  Search, Filter, Download, Plus, DollarSign, 
  TrendingUp, AlertCircle, FileText, CheckCircle2, 
  Clock, X, ChevronDown, User, ArrowDownToLine, History, Wallet, CreditCard, Trash2
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

// ─── Main Component ──────────────────────────────────────────────────────────

const PaymentsPage = ({ token, toast, showConfirm }) => {
  const apiOrigin = (import.meta.env.VITE_API_URL || 'http://localhost:5000').trim();
  const [payments, setPayments] = useState([]);
  const [filteredPayments, setFilteredPayments] = useState([]);
  const [stats, setStats] = useState({ total_revenue: 0, today_revenue: 0, pending_dues: 0 });
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [chartDays, setChartDays] = useState('30');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');

  const [showModal, setShowModal] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [memberHistory, setMemberHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);

  const [formData, setFormData] = useState({
    user_id: '', plan_id: '', amount_paid: '', total_amount: '', payment_mode: 'Online', transaction_id: '', notes: ''
  });

  const paymentsListRef = useRef(null);

  const getImageUrl = (path) => {
    if (!path) return null;
    const filename = path.split(/[/\\]/).pop();
    return `${apiOrigin}/uploads/${filename}`;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const headers = { 'x-auth-token': token };
      const paymentUrl = searchTerm
        ? `/api/payments?search=${searchTerm}`
        : '/api/payments';
      const chartUrl = `/api/payments/chart?days=${chartDays}`;

      const [paymentsRes, statsRes, chartRes, membersRes, plansRes] = await Promise.all([
        axios.get(paymentUrl, { headers }),
        axios.get('/api/payments/stats', { headers }),
        axios.get(chartUrl, { headers }),
        axios.get('/api/members', { headers }),
        axios.get('/api/plans', { headers })
      ]);

      const paymentsData = extractArray(paymentsRes.data, ['payments', 'rows', 'items']);
      const membersData = extractArray(membersRes.data, ['members', 'rows', 'items']);
      const plansData = extractArray(plansRes.data, ['plans', 'rows', 'items']);
      const chartDataSafe = extractArray(chartRes.data, ['chart', 'data', 'rows', 'items']);

      setPayments(paymentsData);
      let newData = paymentsData;
      if (activeFilter === 'Pending') newData = newData.filter(p => p.status === 'Pending');
      else if (activeFilter === 'Cash') newData = newData.filter(p => p.payment_mode === 'Cash');
      else if (activeFilter === 'Online') newData = newData.filter(p => p.payment_mode === 'Online');
      setFilteredPayments(newData);

      setStats(extractObject(statsRes.data, { total_revenue: 0, today_revenue: 0, pending_dues: 0 }));
      setChartData(chartDataSafe);
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
  }, [token, searchTerm, chartDays]);

  useEffect(() => {
    let data = payments;
    if (activeFilter === 'Pending') data = data.filter(p => p.status === 'Pending');
    else if (activeFilter === 'Cash') data = data.filter(p => p.payment_mode === 'Cash');
    else if (activeFilter === 'Online') data = data.filter(p => p.payment_mode === 'Online');
    setFilteredPayments(data);
  }, [activeFilter, payments]);

  const handleRecordPayment = async (e) => {
    if (e) e.preventDefault();
    try {
      const finalPayload = {
        ...formData,
        payment_mode: (formData.transaction_id && formData.transaction_id.trim() !== "") ? "Online" : formData.payment_mode
      };
      await axios.post('/api/payments/record', finalPayload, { headers: { 'x-auth-token': token } });
      setShowModal(false);
      setFormData({ user_id: '', plan_id: '', amount_paid: '', total_amount: '', payment_mode: 'Online', transaction_id: '', notes: '' });
      await fetchData();
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

  const openReceipt = async (payment) => {
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
  };

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
      const amount = parseFloat(p.amount_paid) || 0;
      const modeLabel = p.payment_mode ? p.payment_mode.toString().toLowerCase().trim() : '';
      const txnId = p.transaction_id ? p.transaction_id.toString().toLowerCase().trim() : '';
      const invId = p.invoice_id ? p.invoice_id.toString().toLowerCase().trim() : '';
      const isOnline = (txnId !== "" && txnId !== invId && txnId !== "null" && txnId !== "processing...") || modeLabel.includes('online') || modeLabel.includes('upi') || txnId.startsWith('pay_');
      if (isOnline) { onlineTotal += amount; onlineCount++; }
      else { cashTotal += amount; }
    });
    const total = cashTotal + onlineTotal;
    return { cash: cashTotal, online: onlineTotal, onlineCount, cashPer: total > 0 ? (cashTotal / total) * 100 : 0, onlinePer: total > 0 ? (onlineTotal / total) * 100 : 0 };
  }, [payments]);

  const getEmptySubtitle = () => {
    if (searchTerm) return `No results matching "${searchTerm}"`;
    if (activeFilter !== 'All') return `No ${activeFilter} payments recorded yet`;
    return 'Record your first payment to get started';
  };

  useEffect(() => {
    const el = paymentsListRef.current;
    if (!el) return;
    let startY = 0;
    const onTouchStart = (e) => { startY = e.touches[0].clientY; };
    const onTouchMove = (e) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight) return;
      const delta = startY - e.touches[0].clientY;
      const atTop    = scrollTop <= 0 && delta < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && delta > 0;
      if (!atTop && !atBottom) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
    };
  }, []);

  return (
    <div className="min-h-full p-2 font-sans relative" onClick={() => setShowFilterDropdown(false)}>
      <div className="bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-4 sm:p-6 flex flex-col gap-5 sm:gap-6 mb-0"
        style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div><h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Financial Overview</h1></div>
        <div className="grid grid-cols-2 sm:flex gap-2.5 w-full sm:w-auto">
          <button onClick={handleExport} className="justify-center bg-white border border-slate-200 text-slate-600 px-3 sm:px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-50 shadow-sm"><Download size={17} /> Export</button>
          <button onClick={() => setShowModal(true)} className="justify-center bg-slate-900 text-white px-3 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 shadow-lg"><Plus size={18} /> Record Payment</button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="relative overflow-hidden rounded-[20px] p-6 border"
            style={{ background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)', borderColor: 'rgba(16,185,129,0.15)', boxShadow: '0 4px 20px rgba(16,185,129,0.08)' }}>
              <div className="absolute right-4 top-4 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)' }}>
                <DollarSign size={20} className="text-emerald-600" />
              </div>
              <p className="text-emerald-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Total Revenue</p>
              <h3 className="text-3xl font-black text-slate-900">₹{parseFloat(stats.total_revenue || 0).toLocaleString()}</h3>
              <p className="text-emerald-600 text-xs font-bold mt-1.5">All time earnings</p>
          </div>
          <div className="relative overflow-hidden rounded-[20px] p-6 border"
            style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)', borderColor: 'rgba(59,130,246,0.15)', boxShadow: '0 4px 20px rgba(59,130,246,0.08)' }}>
              <div className="absolute right-4 top-4 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.12)' }}>
                <Clock size={20} className="text-blue-600" />
              </div>
              <p className="text-blue-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Collected Today</p>
              <h3 className="text-3xl font-black text-slate-900">₹{parseFloat(stats.today_revenue || 0).toLocaleString()}</h3>
              <p className="text-blue-600 text-xs font-bold mt-1.5">Today's collection</p>
          </div>
          <div className="relative overflow-hidden rounded-[20px] p-6 border"
            style={{ background: 'linear-gradient(135deg, #fff7ed 0%, #fef9f0 100%)', borderColor: 'rgba(249,115,22,0.15)', boxShadow: '0 4px 20px rgba(249,115,22,0.08)' }}>
              <div className="absolute right-4 top-4 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(249,115,22,0.12)' }}>
                <AlertCircle size={20} className="text-orange-600" />
              </div>
              <p className="text-orange-700/70 text-[10px] font-black uppercase tracking-widest mb-3">Pending Dues</p>
              <h3 className="text-3xl font-black text-orange-500">₹{parseFloat(stats.pending_dues || 0).toLocaleString()}</h3>
              <p className="text-orange-500 text-xs font-bold mt-1.5">Awaiting payment</p>
          </div>
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white/90 p-8 rounded-[24px] border border-slate-100/60" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-black text-slate-900">Revenue Trend</h3>
            <div className="flex gap-2">
              <button onClick={() => setChartDays('7')} className={`px-3 py-1 text-xs font-bold rounded-lg ${chartDays === '7' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>7D</button>
              <button onClick={() => setChartDays('30')} className={`px-3 py-1 text-xs font-bold rounded-lg ${chartDays === '30' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>30D</button>
            </div>
          </div>
          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="99%" height="100%">
                <AreaChart data={chartData}>
                  <defs><linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2}/><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={4} fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                <div className="w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center text-slate-300 border border-slate-100">
                  <TrendingUp size={28} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-black text-slate-600 mb-1">No Revenue Data Yet</p>
                  <p className="text-xs font-bold text-slate-400">Record a payment to see your revenue trend</p>
                </div>
              </div>
            )}
          </div>
        </div>

          <div className="bg-white/90 p-8 rounded-[24px] border border-slate-100/60 flex flex-col" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
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
                    <button onClick={() => openReceipt(payment)} className="text-xs font-bold text-indigo-600">View</button>
                  </div>
                </div>
              ))
            )}
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 h-12 pointer-events-none rounded-b-2xl" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.96) 0%, transparent 100%)' }} />
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
                    <td className="p-6"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 border border-slate-100">{payment.profile_pic ? (<img src={getImageUrl(payment.profile_pic)} onError={(e) => {e.target.onerror = null; e.target.src = 'https://via.placeholder.com/40';}} alt="Member" className="w-full h-full object-cover" />) : (<div className="w-full h-full flex items-center justify-center text-slate-400"><User size={20} /></div>)}</div><div><div className="font-bold text-slate-900">{payment.member_name}</div><div className="text-xs font-bold text-slate-400">{payment.plan_name}</div></div></div></td>
                    <td className="p-6"><div className={`font-mono text-xs font-bold px-2 py-1 rounded w-fit ${payment.transaction_id || payment.invoice_id ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'}`}>{(payment.transaction_id && payment.transaction_id.trim() !== "" && payment.transaction_id !== "Processing...") ? payment.transaction_id : (payment.invoice_id || `ID-${payment.id}`)}</div></td>
                    <td className="p-6"><div className="text-sm font-bold text-slate-600">{new Date(payment.payment_date).toLocaleDateString()}</div><div className="text-xs font-bold text-slate-400 mt-0.5">{new Date(payment.payment_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div></td>
                    <td className="p-6"><div className="font-black text-slate-900">₹{parseFloat(payment.amount_paid).toLocaleString()}</div>{parseFloat(payment.amount_due) > 0 && (<div className="text-[10px] font-bold text-orange-500">Due: ₹{payment.amount_due}</div>)}</td>
                    <td className="p-6">{payment.status === 'Completed' ? (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={12} /> Paid</span>) : (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700"><Clock size={12} /> Pending</span>)}</td>
                    <td className="p-6"><button onClick={() => openReceipt(payment)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-900 transition-all"><FileText size={18} /></button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      </div>{/* end glass card */}

      {/* RECORD PAYMENT MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div><h2 className="text-xl font-black text-slate-900">Record Transaction</h2><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Log a manual payment</p></div>
              <button onClick={() => setShowModal(false)} className="bg-white p-2 rounded-full text-slate-400 hover:text-slate-900 shadow-sm transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6 space-y-5">
              <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Select Member</label><div className="relative"><select required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none appearance-none" value={formData.user_id} onChange={e => setFormData({...formData, user_id: e.target.value})}><option value="">-- Choose Member --</option>{members.map(m => (<option key={m.id} value={m.id}>{m.full_name} ({m.email})</option>))}</select><ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} /></div></div>
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

      {/* RECEIPT MODAL */}
      {showReceipt && selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-white rounded-[24px] w-full max-w-sm shadow-2xl p-0 overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="bg-emerald-500 p-6 text-center text-white relative">
              <button onClick={() => setShowReceipt(false)} className="absolute right-4 top-4 text-white/80 hover:text-white"><X size={20}/></button>
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-md"><CheckCircle2 size={24} className="text-white"/></div>
              <h3 className="text-xl font-black">Payment Successful</h3>
            </div>
            <div className="p-6 space-y-4">
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
                    {memberHistory.map((hist, i) => (<div key={i} className="flex justify-between items-center text-xs p-2 rounded-lg bg-slate-50"><div className="font-bold text-slate-600">{new Date(hist.payment_date).toLocaleDateString()}</div><div className="font-black text-slate-900">₹{hist.amount_paid}</div><div className="text-slate-400">{hist.transaction_id || hist.invoice_id}</div></div>))}
                    {memberHistory.length === 0 && <div className="text-xs text-slate-400 italic">No previous records found.</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
              <button onClick={handleDownloadReceipt} className="w-full py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 shadow-sm flex justify-center items-center gap-2 hover:bg-slate-100 active:scale-95 transition-all"><ArrowDownToLine size={16}/> Download Receipt</button>
              <button onClick={() => handleDeletePayment(selectedPayment.id)} className="w-full py-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl font-bold text-xs flex justify-center items-center gap-2 hover:bg-rose-600 hover:text-white transition-all active:scale-95"><Trash2 size={14}/> Delete This Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentsPage;
