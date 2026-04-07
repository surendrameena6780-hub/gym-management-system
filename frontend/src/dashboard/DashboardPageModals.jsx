import { QRCodeCanvas } from 'qrcode.react';
import { Check, CheckCircle, CreditCard, MessageSquare, RefreshCw, UserPlus, X, Zap } from 'lucide-react';
import {
  buildUpiCollectionUri,
  describeCollectionLinkDelivery,
  formatCollectionAmount,
  openCollectionLink,
} from '../utils/memberCollection';
import { buildProfileUrl, normalizePhoneInput, resolveBroadcastTemplateSuggestion } from './dashboardPageUtils';

const AddMemberModal = ({ controller }) => {
  const {
    addFormData,
    addSelectedPlanId,
    addSubmitting,
    handleAddMember,
    plans,
    previewUrl,
    setAddFile,
    setAddFormData,
    setAddSelectedPlanId,
    setPreviewUrl,
    setShowAddModal,
    showAddModal,
  } = controller;

  if (!showAddModal) return null;

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddSelectedPlanId('');
    setPreviewUrl(null);
    setAddFile(null);
  };

  return (
    <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-label="New member form" className="app-modal-panel bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div
          className="relative p-6 text-white flex justify-between items-center"
          style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black">New Member</h2>
              <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider">Add to GymVault</p>
            </div>
          </div>
          <button type="button" aria-label="Close new member form" onClick={closeAddModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleAddMember} className="app-modal-scroll p-6 space-y-4">
          <div className="flex flex-col items-center">
            <label className="cursor-pointer block">
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-all">
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-300">
                    <UserPlus size={28} />
                    <span className="text-[9px] font-bold uppercase tracking-wider">Upload</span>
                  </div>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  setAddFile(event.target.files[0]);
                  setPreviewUrl(URL.createObjectURL(event.target.files[0]));
                }}
              />
            </label>
            <p className="text-[10px] text-slate-400 font-medium mt-2">Click to upload photo (optional)</p>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Rahul Sharma"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
              value={addFormData.full_name}
              onChange={(event) => setAddFormData({ ...addFormData, full_name: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone *</label>
              <input
                type="text"
                required
                inputMode="numeric"
                maxLength={10}
                pattern="[0-9]{10}"
                title="Enter exactly 10 digits"
                placeholder="9876543210"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
                value={addFormData.phone}
                onChange={(event) => setAddFormData({ ...addFormData, phone: normalizePhoneInput(event.target.value) })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email *</label>
              <input
                type="email"
                required
                placeholder="rahul@email.com"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 font-semibold text-slate-900 text-sm transition-all"
                value={addFormData.email}
                onChange={(event) => setAddFormData({ ...addFormData, email: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">
              <Zap size={10} className="text-emerald-500" /> Assign Plan Now (optional)
            </label>
            <select
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 text-sm font-semibold text-slate-700 appearance-none cursor-pointer transition-all"
              value={addSelectedPlanId}
              onChange={(event) => setAddSelectedPlanId(event.target.value)}
            >
              <option value="">Skip — assign plan later</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — ₹{plan.price} / {plan.duration_days}d
                </option>
              ))}
            </select>
            {addSelectedPlanId && (
              <p className="text-[10px] text-emerald-600 font-bold mt-1.5 ml-0.5">Payment will be collected in the next step →</p>
            )}
          </div>

          <button
            type="submit"
            disabled={addSubmitting}
            className="w-full py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg"
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(5,150,105,0.35)' }}
          >
            {addSubmitting ? (
              <span className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Saving...</span>
            ) : (addSelectedPlanId ? 'Add Member & Assign Plan →' : 'Add Member')}
          </button>
        </form>
      </div>
    </div>
  );
};

const PaymentModal = ({ controller }) => {
  const {
    checkDashboardRazorpayStatus,
    closePaymentModal,
    handleCopyPaymentCollectionDetail,
    handlePayment,
    members,
    paymentCollectionContext,
    paymentMode,
    paymentOnlineMode,
    paymentRazorpayContext,
    paymentReference,
    paymentStep,
    paymentSubmitting,
    payMemberDropdownOpen,
    payMemberSearch,
    plans,
    selectedMemberForPay,
    selectedPlanForPay,
    setPayMemberDropdownOpen,
    setPayMemberSearch,
    setPaymentCollectionContext,
    setPaymentMode,
    setPaymentOnlineMode,
    setPaymentReference,
    setPaymentRazorpayContext,
    setPaymentStep,
    setSelectedMemberForPay,
    setSelectedPlanForPay,
    showPaymentModal,
  } = controller;

  if (!showPaymentModal) return null;

  const resetPaymentFlow = () => {
    setPaymentOnlineMode('RAZORPAY');
    setPaymentCollectionContext(null);
    setPaymentRazorpayContext(null);
    setPaymentReference('');
    setPaymentStep('idle');
  };

  const clearSelectedMember = () => {
    setSelectedMemberForPay('');
    setPayMemberSearch('');
    setPayMemberDropdownOpen(false);
    resetPaymentFlow();
  };

  const selectedMember = members.find((member) => String(member.id) === String(selectedMemberForPay));
  const selectedMemberStatus = String(selectedMember?.membership_status || '').toUpperCase();
  const selectedMemberBadge = selectedMemberStatus === 'EXPIRED'
    ? 'text-rose-600 bg-rose-50'
    : selectedMemberStatus === 'ACTIVE'
      ? 'text-emerald-600 bg-emerald-50'
      : 'text-amber-600 bg-amber-50';
  const paymentLinkDelivery = paymentRazorpayContext?.payment_link
    ? describeCollectionLinkDelivery(paymentRazorpayContext.payment_link)
    : null;
  const filteredMembers = (() => {
    const query = payMemberSearch.toLowerCase();
    return members
      .filter((member) => {
        const name = (member.full_name || '').toLowerCase();
        const phone = (member.phone || '').toLowerCase();
        const status = (member.membership_status || '').toLowerCase();
        if (!query) return true;
        if (query === 'expired') return status === 'expired';
        if (query === 'unpaid') return status !== 'active';
        return name.includes(query) || phone.includes(query);
      })
      .sort((a, b) => {
        const priority = (status) => (status === 'expired' ? 0 : status === 'active' ? 2 : 1);
        const aPriority = priority((a.membership_status || '').toLowerCase());
        const bPriority = priority((b.membership_status || '').toLowerCase());
        return aPriority - bPriority || (a.full_name || '').localeCompare(b.full_name || '');
      });
  })();
  const paymentSubmitLabel = paymentSubmitting
    ? paymentMode === 'Online'
      ? paymentOnlineMode === 'RAZORPAY'
        ? paymentRazorpayContext
          ? 'Checking Razorpay Payment...'
          : 'Sending Razorpay Link...'
        : paymentCollectionContext
          ? 'Recording Collection...'
          : 'Preparing Collection QR...'
      : 'Please wait...'
    : paymentMode === 'Online'
      ? paymentOnlineMode === 'RAZORPAY'
        ? paymentRazorpayContext
          ? 'Check Razorpay Payment'
          : 'Send Razorpay Link & Show QR'
        : paymentCollectionContext
          ? 'Record Direct UPI Collection'
          : 'Show Direct UPI QR'
      : 'Complete Transaction';

  return (
    <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-label="Record payment" className="app-modal-panel relative bg-white rounded-[24px] w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <CreditCard size={17} className="text-white" />
            </div>
            <h2 className="text-lg font-black text-slate-900">Record Payment</h2>
          </div>
          <button type="button" aria-label="Close payment modal" onClick={closePaymentModal} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X size={16} className="text-slate-500" />
          </button>
        </div>
        <form onSubmit={handlePayment} className="app-modal-scroll p-6 space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Member</label>
            <div className="relative">
              {selectedMemberForPay ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{selectedMember?.full_name}</p>
                    <p className="text-[10px] text-slate-500 font-semibold truncate">{selectedMember?.phone}</p>
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${selectedMemberBadge}`}>
                    {selectedMemberStatus || 'UNPAID'}
                  </span>
                  <button type="button" aria-label="Clear selected member" onClick={clearSelectedMember} className="w-6 h-6 rounded-full bg-slate-200 hover:bg-rose-100 flex items-center justify-center shrink-0 transition-colors">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    aria-label="Search members for payment"
                    placeholder="Search by name or phone..."
                    value={payMemberSearch}
                    onChange={(event) => { setPayMemberSearch(event.target.value); setPayMemberDropdownOpen(true); }}
                    onFocus={() => setPayMemberDropdownOpen(true)}
                    className="w-full px-4 py-2.5 pl-9 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                  </div>
                </div>
              )}

              {payMemberDropdownOpen && !selectedMemberForPay && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-2xl z-[300] overflow-hidden">
                  <div className="flex gap-0 border-b border-slate-100">
                    {['All', 'Expired', 'Unpaid'].map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setPayMemberSearch(tab === 'All' ? '' : tab.toLowerCase())}
                        aria-label={`Filter payment member search to ${tab}`}
                        className="flex-1 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {!filteredMembers.length ? (
                      <div className="py-6 text-center text-sm text-slate-400 font-semibold">No members found</div>
                    ) : filteredMembers.map((member) => {
                      const status = String(member.membership_status || '').toUpperCase();
                      const badge = status === 'EXPIRED' ? 'text-rose-600 bg-rose-50' : status === 'ACTIVE' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50';
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => {
                            setSelectedMemberForPay(String(member.id));
                            setPayMemberSearch('');
                            setPayMemberDropdownOpen(false);
                            resetPaymentFlow();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 transition-colors text-left border-b border-slate-50 last:border-0"
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-black shrink-0">
                            {(member.full_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{member.full_name}</p>
                            <p className="text-[10px] text-slate-500 font-semibold">{member.phone}</p>
                          </div>
                          <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 ${badge}`}>{status || 'UNPAID'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {payMemberDropdownOpen && !selectedMemberForPay && (
                <div className="fixed inset-0 z-[299]" onClick={() => setPayMemberDropdownOpen(false)} />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Plan</label>
            <select
              required
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={selectedPlanForPay}
              onChange={(event) => {
                setSelectedPlanForPay(event.target.value);
                setPaymentCollectionContext(null);
                setPaymentRazorpayContext(null);
                setPaymentReference('');
                setPaymentStep('idle');
              }}
            >
              <option value="">Choose a plan...</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} — ₹{plan.price}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Payment Mode</label>
            <div className="flex gap-2">
              {['Cash', 'Online'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={paymentMode === mode}
                  onClick={() => { setPaymentMode(mode); resetPaymentFlow(); }}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm border transition-all ${paymentMode === mode ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                >
                  {mode === 'Online' ? 'Online / UPI' : mode}
                </button>
              ))}
            </div>
          </div>

          {paymentMode === 'Online' && (
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Online Collection Channel</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'RAZORPAY', label: 'Razorpay Link', detail: 'Auto-send link and show hosted checkout QR' },
                  { key: 'UPI', label: 'Direct UPI', detail: 'Show QR and record receipt' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={paymentOnlineMode === option.key}
                    onClick={() => { setPaymentOnlineMode(option.key); setPaymentCollectionContext(null); setPaymentRazorpayContext(null); setPaymentReference(''); setPaymentStep('idle'); }}
                    className={`rounded-2xl border px-3 py-3 text-left transition-all ${paymentOnlineMode === option.key ? 'border-indigo-300 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <p className={`text-xs font-black uppercase tracking-wider ${paymentOnlineMode === option.key ? 'text-indigo-700' : 'text-slate-700'}`}>{option.label}</p>
                    <p className="text-[11px] font-semibold text-slate-500 mt-1">{option.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {paymentMode === 'Online' && paymentOnlineMode === 'RAZORPAY' && paymentRazorpayContext?.payment_link && paymentLinkDelivery && (
            <div className="rounded-[26px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 py-4 shadow-sm space-y-4">
              <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-sm border border-indigo-100">
                  <QRCodeCanvas
                    value={paymentRazorpayContext.payment_link.short_url || 'https://razorpay.com'}
                    size={150}
                    includeMargin
                    bgColor="#ffffff"
                    fgColor="#111827"
                    level="M"
                  />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500/70">Razorpay Payment Link</p>
                    <p className="text-lg font-black text-slate-900 mt-1">₹{formatCollectionAmount(paymentRazorpayContext.payment_link.amount)}</p>
                    <p className="text-sm font-semibold text-slate-600 mt-1">{paymentLinkDelivery.message}</p>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/90 px-3 py-3 space-y-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Link Status</p>
                      <p className="text-sm font-black text-slate-900 uppercase">{String(paymentRazorpayContext.payment_link.status || 'created')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Delivery</p>
                      <p className="text-sm font-bold text-slate-700">{paymentLinkDelivery.label}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" aria-label="Open Razorpay payment link" onClick={() => openCollectionLink(paymentRazorpayContext.payment_link.short_url)} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Open Link</button>
                    <button type="button" aria-label="Check Razorpay payment status" onClick={() => checkDashboardRazorpayStatus({ manual: true })} className="w-full px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Check Status</button>
                  </div>
                </div>
              </div>
              <p className="text-[11px] font-semibold text-indigo-700/80">The member can pay from their own phone using the Razorpay link, or scan this QR from your phone. We also keep checking automatically while this modal stays open.</p>
            </div>
          )}

          {paymentMode === 'Online' && paymentOnlineMode === 'UPI' && paymentCollectionContext && (
            <div className="rounded-[26px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 py-4 shadow-sm">
              <div className="flex flex-col gap-4 desktop:flex-row desktop:items-center">
                <div className="mx-auto md:mx-0 rounded-[24px] bg-white p-3 shadow-sm border border-indigo-100">
                  <QRCodeCanvas
                    value={buildUpiCollectionUri({
                      upiId: paymentCollectionContext.upi_id,
                      payeeName: paymentCollectionContext.payee_name,
                      amount: paymentCollectionContext.amount,
                      note: paymentCollectionContext.note,
                      reference: paymentCollectionContext.reference,
                    }) || 'upi://pay'}
                    size={150}
                    includeMargin
                    bgColor="#ffffff"
                    fgColor="#111827"
                    level="M"
                  />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500/70">Owner Collection QR</p>
                    <p className="text-lg font-black text-slate-900 mt-1">₹{formatCollectionAmount(paymentCollectionContext.amount)}</p>
                    <p className="text-sm font-semibold text-slate-600 mt-1">Let the member scan this QR, then record the collection here.</p>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/90 px-3 py-3 space-y-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">UPI ID</p>
                      <p className="text-sm font-black text-slate-900 break-all">{paymentCollectionContext.upi_id}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Collect Into</p>
                      <p className="text-sm font-bold text-slate-700">{paymentCollectionContext.payee_name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reference</p>
                      <p className="text-sm font-bold text-slate-700 break-all">{paymentCollectionContext.reference}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" aria-label="Copy payment UPI ID" onClick={() => handleCopyPaymentCollectionDetail(paymentCollectionContext.upi_id, 'UPI ID copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors">Copy UPI ID</button>
                    <button type="button" aria-label="Copy payment collection reference" onClick={() => handleCopyPaymentCollectionDetail(paymentCollectionContext.reference, 'Collection reference copied.')} className="px-3 py-2 rounded-full text-[11px] font-black uppercase tracking-wider bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors">Copy Reference</button>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">UPI UTR / Collection Reference</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Paste the UPI UTR or keep the generated reference"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={paymentSubmitting || paymentStep !== 'idle'}
            className="w-full py-3 rounded-xl font-black text-sm text-white mt-2 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-98"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
          >
            {paymentSubmitting ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} fill="currentColor" />} {paymentSubmitLabel}
          </button>
        </form>

        {paymentStep !== 'idle' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[24px] animate-in fade-in duration-150" style={{ background: 'rgba(15,23,42,0.76)', backdropFilter: 'blur(10px)' }}>
            {paymentStep === 'processing' ? (
              <div className="flex flex-col items-center gap-5 rounded-[28px] border border-white/10 bg-slate-950/70 px-8 py-8 shadow-2xl">
                <div className="w-16 h-16 rounded-full border-4 border-white/15 border-t-indigo-400 animate-spin" />
                <div className="text-center">
                  <p className="font-black text-white text-xl">Recording collection...</p>
                  <p className="text-sm text-slate-300 mt-1 font-medium">Please wait. Do not close this window.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5 animate-in zoom-in-90 duration-300 rounded-[28px] border border-emerald-400/20 bg-slate-950/70 px-8 py-8 shadow-2xl">
                <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                  <Check size={36} className="text-white" strokeWidth={3} />
                </div>
                <div className="text-center">
                  <p className="font-black text-white text-xl">Collection recorded</p>
                  <p className="text-sm text-slate-300 mt-1 font-medium">Member activated and checked in.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const BroadcastModal = ({ controller }) => {
  const {
    broadcastAudience,
    broadcastMessage,
    broadcastSearch,
    broadcastSearchResults,
    broadcastSelectedMembers,
    broadcastTemplateKey,
    broadcastTemplates,
    campaignPreviewCount,
    campaignPreviewLoading,
    dashboardData,
    handleBroadcast,
    isAutomating,
    members,
    setBroadcastAudience,
    setBroadcastCustomIds,
    setBroadcastSearch,
    setBroadcastTemplateKey,
    setShowBroadcastModal,
    showBroadcastModal,
  } = controller;

  if (!showBroadcastModal) return null;

  return (
    <>
      <div className="fixed inset-0 z-[190] bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowBroadcastModal(false)} />
      <div role="dialog" aria-modal="true" aria-label="Bulk broadcast" className="app-bottom-sheet z-[200] bg-white shadow-2xl">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        <div className="px-5 py-3 flex justify-between items-center shrink-0" style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
          <div className="flex items-center gap-3">
            <MessageSquare size={18} className="text-white" />
            <h2 className="text-base font-black text-white">Bulk Broadcast</h2>
          </div>
          <button type="button" aria-label="Close broadcast modal" onClick={() => setShowBroadcastModal(false)} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>
        <form onSubmit={handleBroadcast} className="flex min-h-0 flex-1 flex-col">
          <div className="app-modal-scroll dashboard-broadcast-scroll min-h-0 px-4 pb-3 pt-4 space-y-3">
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Search Specific Members</label>
              <input
                type="text"
                value={broadcastSearch}
                onChange={(event) => setBroadcastSearch(event.target.value)}
                aria-label="Search members for broadcast"
                placeholder="Search by name, phone, or email"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
              {broadcastSelectedMembers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {broadcastSelectedMembers.map((member) => (
                    <button
                      key={`broadcast-chip-${member.id}`}
                      type="button"
                      onClick={() => setBroadcastCustomIds((prev) => prev.filter((id) => Number(id) !== Number(member.id)))}
                      aria-label={`Remove ${member.full_name} from broadcast list`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-black border border-emerald-100"
                    >
                      <span className="truncate max-w-[200px]">{member.full_name}</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}
              {broadcastSearchResults.length > 0 && (
                <div className="mt-2 rounded-2xl border border-slate-200 bg-white max-h-40 sm:max-h-48 overflow-y-auto">
                  {broadcastSearchResults.map((member) => (
                    <button
                      key={`broadcast-member-${member.id}`}
                      type="button"
                      onClick={() => {
                        setBroadcastCustomIds((prev) => [...prev, Number(member.id)]);
                        setBroadcastSearch('');
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-emerald-50 border-b border-slate-100 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{member.full_name}</p>
                        <p className="text-[11px] text-slate-500 font-semibold truncate">{member.phone}{member.email ? ` · ${member.email}` : ''}</p>
                      </div>
                      <span className="text-[10px] font-black text-emerald-600 uppercase">Add</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">
                {broadcastSelectedMembers.length > 0 ? 'Custom list selected. Segment buttons below are ignored until you clear these members.' : 'Leave empty to send by audience segment.'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Target Audience</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { value: 'All', label: 'All Members', count: members.length },
                  { value: 'Active', label: 'Active', count: dashboardData.active },
                  { value: 'Expiring', label: 'Expiring Soon', count: dashboardData.expiring7 },
                  { value: 'Expired', label: 'Expired', count: dashboardData.expired },
                  { value: 'Ghosts', label: 'Ghosts', count: dashboardData.ghosts },
                  { value: 'HighChurn', label: 'High Churn', count: dashboardData.churnHigh },
                ].map(({ value, label, count }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setBroadcastAudience(value);
                      if (broadcastSelectedMembers.length === 0) {
                        const suggestedKey = resolveBroadcastTemplateSuggestion(value);
                        const nextTemplate = broadcastTemplates.find((item) => item.template_key === suggestedKey) || broadcastTemplates[0] || null;
                        setBroadcastTemplateKey(nextTemplate?.template_key || '');
                      }
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-black transition-all duration-150 ${broadcastSelectedMembers.length === 0 && broadcastAudience === value ? 'bg-emerald-500 text-white shadow shadow-emerald-200' : 'bg-slate-100 text-slate-600 active:bg-slate-200'}`}
                  >
                    {label}{count > 0 ? ` · ${count}` : ''}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">
                {campaignPreviewLoading ? 'Loading preview...' : `Estimated reach: ${(broadcastSelectedMembers.length || campaignPreviewCount)} member${(broadcastSelectedMembers.length || campaignPreviewCount) !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Approved Template</label>
              <select
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                value={broadcastTemplateKey}
                onChange={(event) => setBroadcastTemplateKey(event.target.value)}
              >
                <option value="">Select template</option>
                {broadcastTemplates.map((template) => (
                  <option key={template.template_key} value={template.template_key}>{template.title}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1.5 font-semibold">Campaigns use approved WhatsApp templates only. Configure or approve more templates from Settings if this list is empty.</p>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Template Preview</label>
              <textarea
                rows={4}
                readOnly
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                placeholder={broadcastTemplates.length === 0 ? 'No approved WhatsApp templates available yet.' : 'Select a template to preview it here.'}
                value={broadcastMessage}
              />
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">{'{{name}}'} auto-fills each member&apos;s name, {'{{plan}}'} fills the plan name, and {'{{gym_name}}'} fills your gym name.</p>
            </div>
          </div>
          <div className="dashboard-broadcast-footer shrink-0 border-t border-slate-100 bg-white px-4 pt-3">
            <button
              type="submit"
              disabled={isAutomating || !broadcastTemplateKey || broadcastTemplates.length === 0}
              className="w-full py-3 rounded-xl font-black text-sm text-white transition-all hover:opacity-90 active:scale-98"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)', opacity: (isAutomating || !broadcastTemplateKey || broadcastTemplates.length === 0) ? 0.6 : 1 }}
            >
              {isAutomating ? 'Sending...' : 'Send Broadcast'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

const CheckinModal = ({ controller }) => {
  const {
    checkedInMemberIds,
    checkinBusyMemberId,
    checkinMembers,
    checkinQuery,
    handleQuickCheckIn,
    setCheckinQuery,
    setShowCheckinModal,
    showCheckinModal,
    todayCheckins,
  } = controller;

  if (!showCheckinModal) return null;

  return (
    <div className="app-modal-shell z-[200] bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="app-modal-panel bg-white rounded-[24px] w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        <div className="px-6 py-5 flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-white" />
            <div>
              <h2 className="text-lg font-black text-white">Manual Check-In</h2>
              <p className="text-white/75 text-[10px] font-bold uppercase tracking-wider">Identify quickly with photo + details</p>
            </div>
          </div>
          <button type="button" aria-label="Close check-in modal" onClick={() => setShowCheckinModal(false)} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>

        <div className="app-modal-scroll p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <input
              type="text"
              value={checkinQuery}
              onChange={(event) => setCheckinQuery(event.target.value)}
              aria-label="Search members for check-in"
              placeholder="Search by name, phone, or email"
              className="w-full sm:max-w-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
            <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Checked in today: {todayCheckins}</p>
          </div>

          {checkinMembers.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70">
              <p className="text-sm font-bold text-slate-500">No members found for this search.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
              {checkinMembers.map((member) => {
                const isCheckedIn = checkedInMemberIds.has(Number(member.id));
                const membershipStatus = String(member.membership_status || 'UNPAID').toUpperCase();
                const statusClass = membershipStatus === 'ACTIVE'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : membershipStatus === 'EXPIRED'
                    ? 'bg-rose-50 text-rose-700 border border-rose-100'
                    : 'bg-amber-50 text-amber-700 border border-amber-100';
                const initials = String(member.full_name || '?')
                  .split(' ')
                  .filter(Boolean)
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div key={member.id} className="p-3 rounded-2xl border border-slate-100 bg-white flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0 relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-[11px] font-black">
                          {initials}
                        </div>
                        {member.profile_pic ? (
                          <img src={buildProfileUrl(member.profile_pic)} alt={member.full_name} className="relative z-10 w-full h-full object-cover" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.style.display = 'none'; }} />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{member.full_name}</p>
                        <p className="text-[11px] text-slate-500 font-semibold truncate">{member.phone}{member.email ? ` · ${member.email}` : ''}</p>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${statusClass}`}>{membershipStatus}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${isCheckedIn ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                            {isCheckedIn ? 'Checked Today' : 'Not Checked In'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={`${isCheckedIn ? 'Already checked in' : 'Check in'} ${member.full_name}`}
                      onClick={() => handleQuickCheckIn(member)}
                      disabled={isCheckedIn || checkinBusyMemberId === member.id}
                      className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
                    >
                      {checkinBusyMemberId === member.id ? 'Checking...' : isCheckedIn ? 'Checked' : 'Check In'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DashboardPageModals = ({ controller }) => (
  <>
    <AddMemberModal controller={controller} />
    <PaymentModal controller={controller} />
    <BroadcastModal controller={controller} />
    <CheckinModal controller={controller} />
  </>
);

export default DashboardPageModals;