import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Check, Plus, Trash2, Edit2, Zap, Crown, X, 
  TrendingUp, Save, BarChart3, Users, PieChart, ArrowUpRight, Percent, Clock 
} from 'lucide-react';

const extractArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

const PlansPage = ({ token, toast, showConfirm }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  // MODAL STATES
  const [showModal, setShowModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentFeature, setCurrentFeature] = useState(""); 
  
  // ANALYTICS DATA STATE
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // FORM DATA
  const [formData, setFormData] = useState({
    id: null,
    name: '',
    price: '',
    duration_days: 30,
    features: [],
    color_theme: 'blue',
    is_popular: false,
    discount_percent: 0,
    discount_valid_until: ''
  });

  const fetchPlans = async () => {
    try {
      const res = await axios.get('/api/plans', {
        headers: { 'x-auth-token': token }
      });
      setPlans(extractArray(res.data, ['plans', 'rows', 'items']));
      setLoading(false);
    } catch (err) {
      console.error("Error fetching plans:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if(token) fetchPlans();
  }, [token]);

  // ANALYTICS FETCHER
  const openAnalytics = async (planId) => {
    setShowAnalyticsModal(true);
    setLoadingAnalytics(true);
    try {
        const res = await axios.get(`/api/plans/${planId}/analytics`, {
            headers: { 'x-auth-token': token }
        });
        setAnalyticsData(res.data);
        setLoadingAnalytics(false);
    } catch (err) {
        toast?.("Failed to load analytics.", "error");
        setShowAnalyticsModal(false);
    }
  };

  const getTheme = (color) => {
    const themes = {
      purple: { bg: 'bg-[#7c3aed]', light: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', shadow: 'shadow-purple-200', badge: 'bg-purple-100 text-purple-700' },
      blue:   { bg: 'bg-slate-900', light: 'bg-slate-100', text: 'text-slate-900', border: 'border-slate-200', shadow: 'shadow-slate-200', badge: 'bg-slate-200 text-slate-800' },
      emerald:{ bg: 'bg-emerald-600', light: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', shadow: 'shadow-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
    };
    return themes[color] || themes.blue;
  };

  const analyticsGraphMax = Math.max(1, ...((analyticsData?.graphData || []).map((item) => Number(item.revenue || 0))));

  // --- HANDLERS ---
  const openAddModal = () => {
    setIsEditing(false);
    setFormData({ id: null, name: '', price: '', duration_days: 30, features: [], color_theme: 'blue', is_popular: false, discount_percent: 0, discount_valid_until: '' });
    setShowModal(true);
  };

  const openEditModal = (plan) => {
    setIsEditing(true);
    
    // Format date for input field (YYYY-MM-DD)
    let validDate = '';
    if (plan.discount_valid_until) {
        const d = new Date(plan.discount_valid_until);
        validDate = d.toISOString().split('T')[0];
    }

    setFormData({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      duration_days: plan.duration_days,
      features: plan.features || [],
      color_theme: plan.color_theme || 'blue',
      is_popular: plan.is_popular || false,
      discount_percent: plan.discount_percent || 0,
      discount_valid_until: validDate
    });
    setShowModal(true);
  };

  const handleAddFeature = (e) => {
    e.preventDefault();
    if (currentFeature.trim()) {
      setFormData({ ...formData, features: [...formData.features, currentFeature.trim()] });
      setCurrentFeature("");
    }
  };

  const removeFeature = (index) => {
    const newFeatures = formData.features.filter((_, i) => i !== index);
    setFormData({ ...formData, features: newFeatures });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await axios.put(`/api/plans/${formData.id}`, formData, { headers: { 'x-auth-token': token } });
      } else {
        await axios.post('/api/plans/add', formData, { headers: { 'x-auth-token': token } });
      }
      setShowModal(false);
      fetchPlans();
      toast?.(isEditing ? "Plan updated successfully!" : "Plan created successfully!", "success");
    } catch (err) { toast?.("Error saving plan. Please try again.", "error"); }
  };

  const handleDelete = (id) => {
    showConfirm?.({
      title: 'Delete Plan',
      message: 'This will permanently delete this membership plan. Members already on this plan will not be affected.',
      confirmLabel: 'Yes, Delete',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await axios.delete(`/api/plans/${id}`, { headers: { 'x-auth-token': token } });
          fetchPlans();
          toast?.("Plan deleted successfully.", "success");
        } catch (err) { toast?.("Delete failed. Please try again.", "error"); }
      },
    });
  }

  return (
    <div className="min-h-full p-2 font-sans relative">
      <style>{`
        @keyframes planCardIn {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div className="bg-white/80 backdrop-blur-sm rounded-[28px] border border-white/70 p-5 sm:p-6 lg:p-8"
        style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6 sm:mb-10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Membership Plans</h1>
          <p className="text-slate-500 font-medium mt-1 text-sm sm:text-base">Manage pricing tiers and gym access levels.</p>
        </div>
        <button onClick={openAddModal} className="w-full sm:w-auto justify-center bg-slate-900 text-white px-4 sm:px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg active:scale-95">
          <Plus size={20} /> Create New Plan
        </button>
      </div>

      {/* PLANS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 sm:gap-8">
        {loading && [1,2,3].map(i => <div key={i} className="h-96 bg-white rounded-[32px] animate-pulse border border-slate-100 shadow-sm"></div>)}

        {plans.map((plan) => {
          const theme = getTheme(plan.color_theme || 'blue');
          
          // 🛠️ FIX: DATE-AWARE DISCOUNT LOGIC
          // We get the current date and reset the time to midnight for an accurate comparison
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const hasDiscountField = plan.discount_percent > 0;
          const expiryDate = plan.discount_valid_until ? new Date(plan.discount_valid_until) : null;
          
          // The offer is ONLY active if the discount exists AND the expiry date is in the future or today
          const isOfferActive = hasDiscountField && (!expiryDate || expiryDate >= today);

          const discountedPrice = isOfferActive 
            ? Math.round(plan.price - (plan.price * plan.discount_percent / 100)) 
            : plan.price;

          return (
            <div key={plan.id} className="group relative bg-white rounded-[32px] p-5 sm:p-8 border border-slate-200 shadow-sm hover:shadow-2xl hover:shadow-slate-200/50 hover:-translate-y-2 transition-all duration-300 flex flex-col"
              style={{ opacity: 0, animation: `planCardIn 0.5s cubic-bezier(0.16,1,0.3,1) ${plans.indexOf(plan) * 80}ms forwards` }}>
              
              {/* Analytics Button (Top Right) */}
              <button 
                onClick={() => openAnalytics(plan.id)}
                className="absolute top-5 right-5 sm:top-8 sm:right-8 text-slate-300 hover:text-slate-900 transition-colors p-2 hover:bg-slate-50 rounded-full"
                title="View Analytics"
              >
                <BarChart3 size={20} />
              </button>

              {/* Badges: Sale vs Popular (Updated with isOfferActive) */}
              {isOfferActive ? (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-rose-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 z-10 animate-pulse">
                      <Percent size={12} fill="currentColor" /> {plan.discount_percent}% OFF SALE
                  </div>
              ) : plan.is_popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-500 to-rose-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 z-10">
                  <Crown size={12} fill="currentColor" /> Most Popular
                </div>
              )}

              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className={`text-lg font-black uppercase tracking-wide ${theme.text}`}>{plan.name}</h3>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">{plan.duration_days} Days Access</span>
                </div>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Price Display Logic: Show Discounted if active */}
                  <span className={`text-3xl sm:text-4xl font-black ${isOfferActive ? 'text-emerald-500' : 'text-slate-900'}`}>₹{discountedPrice}</span>
                  
                  {isOfferActive && (
                      <span className="text-slate-400 font-bold text-sm line-through decoration-rose-500 decoration-2">₹{plan.price}</span>
                  )}
                  
                  <span className="text-slate-400 font-bold text-sm whitespace-nowrap">/ period</span>
                </div>

                {isOfferActive ? (
                    <div className="flex items-center gap-2 mt-2">
                         <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                            <Clock size={10} /> Limited Time Deal
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 mt-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => openAnalytics(plan.id)}>
                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                            <TrendingUp size={10} /> View Insights
                        </span>
                    </div>
                )}
              </div>

              <div className="flex-1 space-y-4 mb-8">
                {plan.features && plan.features.length > 0 ? (
                    plan.features.map((feature, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                            <div className={`mt-0.5 p-0.5 rounded-full ${theme.bg} text-white shrink-0`}>
                                <Check size={10} strokeWidth={4} />
                            </div>
                            <span className="text-sm font-semibold text-slate-600 leading-tight">{feature}</span>
                        </div>
                    ))
                ) : (
                    <div className="text-slate-300 text-sm font-medium italic">No features listed</div>
                )}
              </div>

              <div className="pt-6 border-t border-slate-100 flex gap-3">
                <button onClick={() => openEditModal(plan)} className={`flex-1 py-3 rounded-xl font-bold text-sm border-2 transition-all flex items-center justify-center gap-2 ${theme.border} ${theme.text} hover:${theme.bg} hover:text-white`}>
                  <Edit2 size={16} /> Edit
                </button>
                <button onClick={() => handleDelete(plan.id)} className="p-3 rounded-xl border-2 border-slate-100 text-slate-400 hover:border-rose-100 hover:bg-rose-50 hover:text-rose-500 transition-all">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Add New Plan Button */}
        <button onClick={openAddModal} className="border-3 border-dashed border-slate-200 rounded-[32px] flex flex-col items-center justify-center gap-4 min-h-[280px] sm:min-h-[400px] text-slate-300 hover:border-slate-400 hover:text-slate-500 hover:bg-slate-50 transition-all group">
            <div className="w-16 h-16 rounded-full bg-slate-50 group-hover:bg-white border-2 border-slate-100 flex items-center justify-center transition-all shadow-sm">
                <Plus size={32} />
            </div>
            <span className="font-bold text-sm uppercase tracking-widest">Add New Plan</span>
        </button>
      </div>

      </div>{/* end glass card */}

      {/* --- ANALYTICS MODAL --- */}
      {showAnalyticsModal && (
        <div className="app-modal-shell z-[100] bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="app-modal-panel app-modal-panel--wide bg-white rounded-[28px] sm:rounded-[32px] w-full max-w-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col md:flex-row">
            <div className="bg-slate-900 text-white p-5 sm:p-6 md:p-8 md:w-[320px] flex flex-col gap-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500 rounded-full blur-[100px] opacity-20 -mr-20 -mt-20 pointer-events-none"></div>
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black mb-1">{analyticsData?.name || 'Plan'}</h2>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Performance Report</p>
                </div>
                <button onClick={() => setShowAnalyticsModal(false)} className="shrink-0 p-2 rounded-full bg-white/10 hover:bg-white/15 transition-all">
                  <X size={18} className="text-white/80" />
                </button>
              </div>

              <div className="relative space-y-5">
                <div>
                  <div className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Total Revenue</div>
                  <div className="text-3xl font-black text-emerald-400 tracking-tight">₹{analyticsData?.totalRevenue?.toLocaleString() || 0}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-800/60 p-3">
                    <div className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Active Members</div>
                    <div className="text-xl font-bold flex items-center gap-2 text-white">
                      <Users size={16} className="text-blue-400" /> {analyticsData?.activeCount || 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-800/60 p-3">
                    <div className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Churn Rate</div>
                    <div className="text-xl font-bold flex items-center gap-2 text-rose-400">
                      <PieChart size={16} /> {analyticsData?.churnRate || 0}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="bg-emerald-500/20 p-2 rounded-lg text-emerald-400"><ArrowUpRight size={20} /></div>
                  <div>
                    <div className="text-sm font-bold text-white">High Retention</div>
                    <div className="text-[10px] text-slate-400 font-bold">Renewal rate is above 80%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="app-modal-scroll p-5 sm:p-6 md:p-8 bg-slate-50 flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-3 mb-5 md:mb-6">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Revenue Trend</h3>
                  <p className="text-xs font-semibold text-slate-400 mt-1">Monthly earning pattern for this plan.</p>
                </div>
                <button onClick={() => setShowAnalyticsModal(false)} className="hidden md:inline-flex p-2 hover:bg-slate-200 rounded-full transition-all"><X size={20} className="text-slate-400" /></button>
              </div>

              <div className="flex-1 bg-white p-4 sm:p-5 rounded-3xl border border-slate-100 shadow-sm min-h-[240px] relative overflow-hidden">
                {loadingAnalytics ? (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm font-bold animate-pulse">Calculating Data...</div>
                ) : (
                  <div className="grid h-full items-end gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${Math.max((analyticsData?.graphData || []).length, 1)}, minmax(0, 1fr))` }}>
                    {(analyticsData?.graphData || []).map((item, idx) => (
                      <div key={idx} className="flex h-full min-w-0 flex-col items-center justify-end gap-2 group">
                        <div className="relative w-full bg-slate-100 rounded-[22px] overflow-hidden h-[160px] sm:h-[190px] flex items-end justify-center px-1.5 py-1.5">
                          <div
                            style={{ height: `${Math.max(10, Math.round((Number(item.revenue || 0) / analyticsGraphMax) * 100))}%` }}
                            className="w-full bg-slate-900 rounded-[16px] transition-all duration-500 group-hover:bg-purple-600 relative"
                          >
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">₹{item.revenue}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase truncate max-w-full">{item.month}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end">
                <button onClick={() => setShowAnalyticsModal(false)} className="text-sm font-bold text-slate-400 hover:text-slate-900 uppercase tracking-widest">Close Report</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- ADD/EDIT MODAL --- */}
      {showModal && (
        <div className="app-modal-shell z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="app-modal-panel bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-black text-slate-900">{isEditing ? 'Edit Plan' : 'Create New Plan'}</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Configure pricing & features</p>
                    </div>
                    <button onClick={() => setShowModal(false)} className="bg-white p-2 rounded-full text-slate-400 hover:text-slate-900 shadow-sm transition-all"><X size={20} /></button>
                </div>
            <form onSubmit={handleSubmit} className="app-modal-scroll p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-5">
                        <div className="col-span-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Plan Name</label>
                            <input type="text" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Price (₹)</label>
                            <input type="number" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Duration (Days)</label>
                            <input type="number" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 outline-none" value={formData.duration_days} onChange={e => setFormData({...formData, duration_days: e.target.value})} />
                        </div>
                    </div>

                    <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100">
                        <label className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                             <Percent size={12}/> Run Flash Sale (Optional)
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Discount %</label>
                                <input type="number" placeholder="0" max="100" className="w-full px-4 py-2 bg-white border border-rose-200 rounded-xl font-bold text-rose-500 outline-none focus:ring-2 focus:ring-rose-200" value={formData.discount_percent} onChange={e => setFormData({...formData, discount_percent: e.target.value})} />
                             </div>
                             <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Valid Until</label>
                                <input type="date" className="w-full px-4 py-2 bg-white border border-rose-200 rounded-xl font-bold text-slate-600 outline-none focus:ring-2 focus:ring-rose-200" value={formData.discount_valid_until} onChange={e => setFormData({...formData, discount_valid_until: e.target.value})} />
                             </div>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Included Features</label>
                        <div className="flex gap-2 mb-3">
                            <input type="text" placeholder="Type feature & press Enter" className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold outline-none" value={currentFeature} onChange={e => setCurrentFeature(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddFeature(e)} />
                            <button type="button" onClick={handleAddFeature} className="bg-slate-900 text-white p-2 rounded-xl"><Plus size={20} /></button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {formData.features.map((feat, idx) => (
                                <span key={idx} className="bg-white border border-slate-200 px-3 py-1 rounded-lg text-xs font-bold text-slate-600 flex items-center gap-2">
                                    {feat} <button type="button" onClick={() => removeFeature(idx)} className="text-slate-400 hover:text-rose-500"><X size={12} /></button>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Card Theme</label>
                            <div className="flex gap-3">
                                {['blue', 'purple', 'emerald'].map(color => (
                                    <button key={color} type="button" onClick={() => setFormData({...formData, color_theme: color})} className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color_theme === color ? 'border-slate-900 scale-110' : 'border-transparent opacity-50'}`} style={{ backgroundColor: color === 'blue' ? '#0f172a' : color === 'purple' ? '#7c3aed' : '#059669' }} />
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-3 bg-orange-50 px-4 py-2 rounded-xl border border-orange-100">
                             <div className="flex flex-col"><span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Mark Popular</span><span className="text-xs font-bold text-orange-700">Best Value Badge</span></div>
                             <button type="button" onClick={() => setFormData({...formData, is_popular: !formData.is_popular})} className={`w-12 h-6 rounded-full p-1 transition-colors ${formData.is_popular ? 'bg-orange-500' : 'bg-slate-200'}`}><div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${formData.is_popular ? 'translate-x-6' : 'translate-x-0'}`} /></button>
                        </div>
                    </div>
                    <button type="submit" className="w-full py-4 bg-slate-900 text-white rounded-xl font-black text-sm uppercase tracking-wider hover:bg-slate-800 shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"><Save size={18} /> {isEditing ? 'Update Plan' : 'Create Plan'}</button>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};

export default PlansPage;