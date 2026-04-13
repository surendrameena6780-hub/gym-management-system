import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Search, Plus, X, Phone, MessageSquare, Target, Clock3, CalendarDays,
  Pencil, Trash2, ArrowRight, CheckCircle2, Sparkles,
} from 'lucide-react';
import { openWhatsAppConversation } from './utils/externalNavigation';
import { getBranchRequestValue } from './utils/branchScope';
import PageLoader from './PageLoader';
import PaginationControls from './components/PaginationControls';

const STATUS_OPTIONS = [
  { key: 'ALL', label: 'All', pill: 'bg-slate-900 text-white', subtle: 'bg-slate-100 text-slate-600' },
  { key: 'NEW', label: 'New', pill: 'bg-sky-500 text-white', subtle: 'bg-sky-50 text-sky-700' },
  { key: 'CONTACTED', label: 'Contacted', pill: 'bg-indigo-500 text-white', subtle: 'bg-indigo-50 text-indigo-700' },
  { key: 'FOLLOW_UP', label: 'Follow Up', pill: 'bg-amber-500 text-white', subtle: 'bg-amber-50 text-amber-700' },
  { key: 'TRIAL_BOOKED', label: 'Trial Booked', pill: 'bg-emerald-500 text-white', subtle: 'bg-emerald-50 text-emerald-700' },
  { key: 'WON', label: 'Won', pill: 'bg-violet-500 text-white', subtle: 'bg-violet-50 text-violet-700' },
  { key: 'LOST', label: 'Lost', pill: 'bg-rose-500 text-white', subtle: 'bg-rose-50 text-rose-700' },
];

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];

const STATUS_STYLES = {
  NEW: 'bg-sky-100 text-sky-700 border border-sky-200',
  CONTACTED: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  FOLLOW_UP: 'bg-amber-100 text-amber-700 border border-amber-200',
  TRIAL_BOOKED: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  WON: 'bg-violet-100 text-violet-700 border border-violet-200',
  LOST: 'bg-rose-100 text-rose-700 border border-rose-200',
};

const PRIORITY_STYLES = {
  LOW: 'bg-slate-100 text-slate-600 border border-slate-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border border-amber-200',
  HIGH: 'bg-rose-50 text-rose-700 border border-rose-200',
};

const INITIAL_FORM = {
  full_name: '',
  phone: '',
  email: '',
  source: 'Walk-in',
  status: 'NEW',
  priority: 'MEDIUM',
  next_follow_up_at: '',
  trial_date: '',
  notes: '',
  lost_reason: '',
  mark_contacted: false,
};

const normalizePhoneInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

const toDateTimeLocal = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formatDateTimeLabel = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildLeadForm = (lead = null) => ({
  full_name: String(lead?.full_name || ''),
  phone: normalizePhoneInput(lead?.phone || ''),
  email: String(lead?.email || ''),
  source: String(lead?.source || 'Walk-in'),
  status: String(lead?.status || 'NEW').toUpperCase(),
  priority: String(lead?.priority || 'MEDIUM').toUpperCase(),
  next_follow_up_at: toDateTimeLocal(lead?.next_follow_up_at),
  trial_date: toDateTimeLocal(lead?.trial_date),
  notes: String(lead?.notes || ''),
  lost_reason: String(lead?.lost_reason || ''),
  mark_contacted: false,
});

const isDueLead = (lead) => {
  if (!lead?.next_follow_up_at) return false;
  const parsed = new Date(lead.next_follow_up_at);
  if (Number.isNaN(parsed.getTime())) return false;
  if (['WON', 'LOST'].includes(String(lead.status || '').toUpperCase())) return false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return parsed <= endOfToday;
};

const requestDataRefresh = (source) => {
  window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
    detail: { source, at: Date.now() },
  }));
};

const LeadsPage = ({ appRuntime, canManage = false }) => {
  const { token, toast, showConfirm, navigateTo, currentUser, branchDirectory, defaultBranchId } = appRuntime;
  const operationsBranchId = appRuntime.operationsBranchId || currentUser?.branch_id || defaultBranchId;
  const branchScopeValue = getBranchRequestValue(operationsBranchId);
  const branchQueryParams = useMemo(() => (branchScopeValue ? { branch_id: branchScopeValue } : {}), [branchScopeValue]);
  const [summary, setSummary] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1, hasNext: false, hasPrev: false });
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [formState, setFormState] = useState(INITIAL_FORM);
  const loadCompletedRef = useRef(false);

  const fetchLeadsData = useCallback(async ({ soft = false } = {}) => {
    if (!token) return;

    if (soft) setRefreshing(true);
    else setLoading(true);

    try {
      const [summaryRes, leadsRes] = await Promise.all([
        axios.get('/api/leads/summary', { headers: { 'x-auth-token': token }, params: { ...branchQueryParams } }),
        axios.get('/api/leads', {
          headers: { 'x-auth-token': token },
          params: {
            paginate: true,
            page: pagination.page,
            limit: pagination.limit,
            search: searchTerm || undefined,
            status: statusFilter,
            ...branchQueryParams,
          },
        }),
      ]);

      setSummary(summaryRes.data || {});
      setLeads(Array.isArray(leadsRes.data?.items) ? leadsRes.data.items : []);
      setPagination((prev) => ({
        ...prev,
        ...(leadsRes.data?.pagination || {}),
      }));
      loadCompletedRef.current = true;
    } catch (_err) {
      toast?.('Unable to load leads right now.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branchQueryParams, pagination.limit, pagination.page, searchTerm, statusFilter, toast, token]);

  useEffect(() => {
    if (!token) return undefined;
    const soft = loadCompletedRef.current;
    const timer = window.setTimeout(() => {
      fetchLeadsData({ soft });
    }, soft ? 180 : 0);

    return () => window.clearTimeout(timer);
  }, [fetchLeadsData, token]);

  useEffect(() => {
    setPagination((prev) => prev.page === 1 ? prev : { ...prev, page: 1 });
  }, [searchTerm, statusFilter]);

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingLead(null);
    setFormState(INITIAL_FORM);
  };

  const openCreateModal = () => {
    if (!canManage) {
      toast?.('You do not have permission to manage leads.', 'warning');
      return;
    }
    setEditingLead(null);
    setFormState(INITIAL_FORM);
    setShowFormModal(true);
  };

  const openEditModal = (lead) => {
    if (!canManage) {
      toast?.('You do not have permission to manage leads.', 'warning');
      return;
    }
    setEditingLead(lead);
    setFormState(buildLeadForm(lead));
    setShowFormModal(true);
  };

  const handleSaveLead = async (event) => {
    event.preventDefault();
    if (!canManage) {
      toast?.('You do not have permission to manage leads.', 'warning');
      return;
    }

    const normalizedPhone = normalizePhoneInput(formState.phone);
    if (!formState.full_name.trim() || normalizedPhone.length !== 10) {
      toast?.('Lead name and a valid 10 digit phone are required.', 'warning');
      return;
    }

    const payload = {
      ...formState,
      phone: normalizedPhone,
      full_name: formState.full_name.trim(),
      email: formState.email.trim(),
      source: formState.source.trim() || 'Walk-in',
      next_follow_up_at: formState.next_follow_up_at || null,
      trial_date: formState.trial_date || null,
      lost_reason: formState.status === 'LOST' ? formState.lost_reason.trim() : '',
      notes: formState.notes.trim(),
    };

    try {
      if (editingLead?.id) {
        await axios.put(`/api/leads/${editingLead.id}`, payload, { headers: { 'x-auth-token': token } });
        toast?.('Lead updated successfully.', 'success');
      } else {
        await axios.post('/api/leads', { ...payload, branch_id: branchScopeValue || undefined }, { headers: { 'x-auth-token': token } });
        toast?.('Lead added successfully.', 'success');
      }

      closeFormModal();
      requestDataRefresh('leads');
      await fetchLeadsData({ soft: true });
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to save lead.', 'error');
    }
  };

  const handleDeleteLead = (lead) => {
    if (!canManage) {
      toast?.('You do not have permission to manage leads.', 'warning');
      return;
    }

    showConfirm?.({
      title: 'Delete Lead',
      message: `Remove ${lead.full_name} from the leads pipeline?`,
      confirmLabel: 'Delete Lead',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await axios.delete(`/api/leads/${lead.id}`, { headers: { 'x-auth-token': token } });
          toast?.('Lead deleted.', 'success');
          requestDataRefresh('leads');
          await fetchLeadsData({ soft: true });
        } catch (err) {
          toast?.(err?.response?.data?.error || 'Unable to delete lead.', 'error');
        }
      },
    });
  };

  const handleConvertLead = (lead) => {
    if (!canManage) {
      toast?.('You do not have permission to convert leads.', 'warning');
      return;
    }

    showConfirm?.({
      title: 'Convert Lead',
      message: `Convert ${lead.full_name} into a member now? This will mark the lead as won and open the member record.`,
      confirmLabel: 'Convert To Member',
      variant: 'warning',
      onConfirm: async () => {
        try {
          const res = await axios.post(`/api/leads/${lead.id}/convert`, {}, { headers: { 'x-auth-token': token } });
          const memberId = res.data?.member?.id;
          toast?.(res.data?.created_new_member ? 'Lead converted and member created.' : 'Lead linked to an existing member.', 'success');
          requestDataRefresh('lead-conversion');
          await fetchLeadsData({ soft: true });

          if (memberId) {
            navigateTo?.('Members', 'All', { memberId });
          }
        } catch (err) {
          toast?.(err?.response?.data?.error || 'Unable to convert lead.', 'error');
        }
      },
    });
  };

  const handleCall = (phone) => {
    if (!phone) return;
    window.open(`tel:${phone}`, '_self');
  };

  const handleWhatsApp = (lead) => {
    openWhatsAppConversation({
      phone: lead.phone,
      message: `Hi ${lead.full_name}, this is a quick follow-up from the gym. Let us know if you want to book a visit or start your membership.`,
    });
  };

  const metrics = [
    {
      label: 'Open Leads',
      value: summary?.open_leads || 0,
      icon: Target,
      box: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Follow-Ups Due',
      value: summary?.follow_ups_due || 0,
      icon: Clock3,
      box: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'Trials Today',
      value: summary?.trials_today || 0,
      icon: CalendarDays,
      box: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Converted This Month',
      value: summary?.converted_this_month || 0,
      icon: CheckCircle2,
      box: 'bg-violet-50 text-violet-600',
    },
    {
      label: 'Lost Leads',
      value: summary?.lost_leads || 0,
      icon: Sparkles,
      box: 'bg-rose-50 text-rose-600',
    },
  ];

  if (loading && leads.length === 0) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 sm:gap-5 p-1 sm:p-2">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-white backdrop-blur-sm rounded-2xl border border-slate-200/60 p-4 flex items-center gap-3" style={{ boxShadow: '0 2px 16px rgba(99,102,241,0.05), 0 1px 3px rgba(0,0,0,0.03)' }}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${metric.box}`}>
              <metric.icon size={18} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide leading-none mb-0.5">{metric.label}</p>
              <p className="text-2xl font-black text-slate-900 leading-none">{metric.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white backdrop-blur-sm rounded-[28px] border border-slate-200/60 p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 overflow-hidden" style={{ boxShadow: '0 4px 32px rgba(99,102,241,0.06), 0 1px 4px rgba(0,0,0,0.04)' }}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Leads</h1>
              {refreshing && <span className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Refreshing</span>}
            </div>
            <p className="text-slate-500 text-sm mt-0.5">Track enquiries, follow-ups, trials, and conversions without clutter.</p>
          </div>

          {canManage && (
            <button onClick={openCreateModal} className="text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 text-sm w-full lg:w-auto" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
              <Plus size={16} /> Add Lead
            </button>
          )}
        </div>

        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="relative w-full xl:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Search leads"
              placeholder="Search lead, phone, email..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-sm font-medium transition-all"
            />
          </div>

          <div role="group" aria-label="Lead status filters" className="grid grid-cols-2 sm:grid-cols-4 xl:flex xl:flex-wrap gap-2 w-full">
            {STATUS_OPTIONS.map((option) => {
              const isActive = statusFilter === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStatusFilter(option.key)}
                  aria-pressed={isActive}
                  className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all border focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-1 ${isActive ? `${option.pill} border-transparent shadow-sm` : `${option.subtle} border-transparent hover:border-slate-200`}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-slate-50/60 rounded-[28px] border-2 border-dashed border-slate-200 text-center">
            <div className="w-20 h-20 rounded-3xl bg-white shadow-lg text-slate-300 flex items-center justify-center mb-6">
              <Target size={36} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">Pipeline starts here</h2>
            <p className="text-slate-500 font-bold max-w-sm mb-8">Capture walk-ins, missed calls, and trial interest here so the front desk never loses momentum.</p>
            {canManage && (
              <button onClick={openCreateModal} className="text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,0.35)' }}>
                <Plus size={18} /> Add First Lead
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="desktop:hidden space-y-3">
              {leads.map((lead) => {
                const due = isDueLead(lead);
                const statusLabel = String(lead.status || 'NEW').toUpperCase();
                const priorityLabel = String(lead.priority || 'MEDIUM').toUpperCase();
                return (
                  <div key={lead.id} className={`rounded-2xl border p-4 space-y-3 shadow-[0_10px_30px_rgba(15,23,42,0.18)] ${due ? 'border-amber-500/35 bg-amber-500/10' : 'border-slate-700 bg-slate-900/75'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-white truncate">{lead.full_name}</p>
                        <p className="text-xs text-slate-300 truncate">{lead.phone}{lead.email ? ` • ${lead.email}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${STATUS_STYLES[statusLabel] || 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{statusLabel.replace('_', ' ')}</span>
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${PRIORITY_STYLES[priorityLabel] || PRIORITY_STYLES.MEDIUM}`}>{priorityLabel}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Source</p>
                        <p className="font-bold text-slate-100">{lead.source || 'Walk-in'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Follow-Up</p>
                        <p className={`font-bold ${due ? 'text-amber-300' : 'text-slate-100'}`}>{formatDateTimeLabel(lead.next_follow_up_at)}</p>
                      </div>
                    </div>

                    {(lead.notes || lead.lost_reason || lead.trial_date) && (
                      <div className="rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 space-y-1">
                        {lead.trial_date && <p className="text-xs font-semibold text-slate-200"><span className="text-slate-500">Trial:</span> {formatDateTimeLabel(lead.trial_date)}</p>}
                        {lead.notes && <p className="text-xs text-slate-300 line-clamp-2">{lead.notes}</p>}
                        {lead.lost_reason && <p className="text-xs text-rose-300 line-clamp-2">Lost reason: {lead.lost_reason}</p>}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleCall(lead.phone)} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-blue-500/15 text-blue-200 border border-blue-500/30 text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 hover:bg-blue-500 hover:text-white transition-all">
                        <Phone size={12} /> Call
                      </button>
                      <button onClick={() => handleWhatsApp(lead)} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 hover:bg-emerald-500 hover:text-white transition-all">
                        <MessageSquare size={12} /> WhatsApp
                      </button>
                      {lead.converted_member_id ? (
                        <button onClick={() => navigateTo?.('Members', 'All', { memberId: lead.converted_member_id })} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-violet-500/15 text-violet-200 border border-violet-500/30 text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 hover:bg-violet-500 hover:text-white transition-all">
                          <ArrowRight size={12} /> Open Member
                        </button>
                      ) : (
                        canManage && (
                          <button onClick={() => handleConvertLead(lead)} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 shadow-sm">
                            <ArrowRight size={12} /> Convert
                          </button>
                        )
                      )}
                      {canManage && (
                        <button type="button" aria-label={`Edit ${lead.full_name}`} onClick={() => openEditModal(lead)} className="w-11 h-11 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 flex items-center justify-center hover:bg-slate-700 transition-all">
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden desktop:flex desktop:flex-col gap-3">
              {leads.map((lead) => {
                const due = isDueLead(lead);
                const statusLabel = String(lead.status || 'NEW').toUpperCase();
                const priorityLabel = String(lead.priority || 'MEDIUM').toUpperCase();
                const noteText = lead.lost_reason ? `Lost reason: ${lead.lost_reason}` : lead.notes;

                return (
                  <article
                    key={lead.id}
                    className={`rounded-3xl border px-5 py-5 transition-colors shadow-[0_14px_40px_rgba(15,23,42,0.18)] ${due ? 'border-amber-500/35 bg-amber-500/10' : 'border-slate-700 bg-slate-900/75 hover:bg-slate-900/90'}`}
                  >
                    <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,1.15fr)_minmax(0,1.05fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-4 items-start">
                      <div className="min-w-0 space-y-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-black text-white break-words">{lead.full_name}</h3>
                          {lead.converted_member_id && <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-100">Member Linked</span>}
                          {due && <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200">Due Today</span>}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-200 break-all">{lead.phone}</p>
                          {lead.email && <p className="text-sm font-medium text-slate-400 break-all">{lead.email}</p>}
                        </div>
                        {noteText && (
                          <div className={`rounded-2xl border px-3 py-2.5 ${lead.lost_reason ? 'border-rose-500/30 bg-rose-500/10' : 'border-slate-700 bg-slate-800/90'}`}>
                            <p className={`text-xs leading-relaxed break-words ${lead.lost_reason ? 'font-semibold text-rose-300' : 'font-medium text-slate-300'}`}>
                              {noteText}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Source</p>
                        <p className="text-sm font-bold text-slate-100 break-words">{lead.source || 'Walk-in'}</p>
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Follow-Up</p>
                        <p className={`text-sm font-bold break-words ${due ? 'text-amber-300' : 'text-slate-100'}`}>{formatDateTimeLabel(lead.next_follow_up_at)}</p>
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Trial</p>
                        <p className="text-sm font-bold text-slate-100 break-words">{formatDateTimeLabel(lead.trial_date)}</p>
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Priority</p>
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${PRIORITY_STYLES[priorityLabel] || PRIORITY_STYLES.MEDIUM}`}>{priorityLabel}</span>
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Status</p>
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${STATUS_STYLES[statusLabel] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>{statusLabel.replace('_', ' ')}</span>
                      </div>

                      <div className="min-w-[210px] space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 text-right">Actions</p>
                        <div className="flex justify-end items-center gap-2 flex-wrap">
                          <button type="button" aria-label={`Call ${lead.full_name}`} onClick={() => handleCall(lead.phone)} className="p-2.5 text-blue-200 bg-blue-500/15 border border-blue-500/30 rounded-xl hover:bg-blue-500 hover:text-white transition-all">
                            <Phone size={14} />
                          </button>
                          <button type="button" aria-label={`WhatsApp ${lead.full_name}`} onClick={() => handleWhatsApp(lead)} className="p-2.5 text-emerald-200 bg-emerald-500/15 border border-emerald-500/30 rounded-xl hover:bg-emerald-500 hover:text-white transition-all">
                            <MessageSquare size={14} />
                          </button>
                          {lead.converted_member_id ? (
                            <button onClick={() => navigateTo?.('Members', 'All', { memberId: lead.converted_member_id })} className="inline-flex items-center gap-1.5 bg-violet-500/15 text-violet-200 px-3 py-2 rounded-xl border border-violet-500/30 text-[10px] font-black uppercase hover:bg-violet-500 hover:text-white transition-all shadow-sm">
                              <ArrowRight size={12} /> Open Member
                            </button>
                          ) : (
                            canManage && (
                              <button onClick={() => handleConvertLead(lead)} className="inline-flex items-center gap-1.5 bg-indigo-500/15 text-indigo-200 px-3 py-2 rounded-xl border border-indigo-500/30 text-[10px] font-black uppercase hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                                <ArrowRight size={12} /> Convert
                              </button>
                            )
                          )}
                          {canManage && (
                            <button type="button" aria-label={`Edit ${lead.full_name}`} onClick={() => openEditModal(lead)} className="p-2.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-all">
                              <Pencil size={14} />
                            </button>
                          )}
                          {canManage && (
                            <button type="button" aria-label={`Delete ${lead.full_name}`} onClick={() => handleDeleteLead(lead)} className="p-2.5 text-rose-300 hover:text-rose-100 hover:bg-rose-500/20 rounded-xl transition-all">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {pagination.totalPages > 1 && (
              <PaginationControls
                pagination={pagination}
                itemLabel="leads"
                onPageChange={(nextPage) => setPagination((prev) => ({ ...prev, page: nextPage }))}
              />
            )}
          </>
        )}
      </div>

      {showFormModal && (
        <div className="app-modal-shell z-[140] bg-slate-900/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={editingLead ? 'Update lead' : 'Add lead'} className="app-modal-panel bg-white rounded-[28px] w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-100 animate-in zoom-in-95">
            <div className="relative p-6 text-white flex justify-between items-center" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #312e81 100%)' }}>
              <div>
                <h2 className="text-lg font-black">{editingLead ? 'Update Lead' : 'Add Lead'}</h2>
                <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mt-1">Capture demand without slowing down the desk</p>
              </div>
              <button type="button" aria-label="Close lead form" onClick={closeFormModal} className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-all"><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveLead} className="app-modal-scroll p-6 space-y-5">
              <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Full Name *</label>
                  <input type="text" required value={formState.full_name} onChange={(event) => setFormState((prev) => ({ ...prev, full_name: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="e.g. Rahul Sharma" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Phone *</label>
                  <input type="text" required inputMode="numeric" maxLength={10} value={formState.phone} onChange={(event) => setFormState((prev) => ({ ...prev, phone: normalizePhoneInput(event.target.value) }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="9876543210" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Email</label>
                  <input type="email" value={formState.email} onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="optional@email.com" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Source</label>
                  <input type="text" value={formState.source} onChange={(event) => setFormState((prev) => ({ ...prev, source: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" placeholder="Walk-in, Instagram, Referral..." />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Status</label>
                  <select value={formState.status} onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                    {STATUS_OPTIONS.filter((option) => option.key !== 'ALL').map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Priority</label>
                  <select value={formState.priority} onChange={(event) => setFormState((prev) => ({ ...prev, priority: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all">
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Next Follow-Up</label>
                  <input type="datetime-local" value={formState.next_follow_up_at} onChange={(event) => setFormState((prev) => ({ ...prev, next_follow_up_at: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Trial Date</label>
                  <input type="datetime-local" value={formState.trial_date} onChange={(event) => setFormState((prev) => ({ ...prev, trial_date: event.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Notes</label>
                <textarea value={formState.notes} onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))} rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 font-semibold text-slate-900 text-sm transition-all resize-none" placeholder="Context, objections, preferences, trainer request..." />
              </div>

              {formState.status === 'LOST' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-0.5">Lost Reason</label>
                  <textarea value={formState.lost_reason} onChange={(event) => setFormState((prev) => ({ ...prev, lost_reason: event.target.value }))} rows={3} className="w-full px-4 py-3 bg-rose-50 border border-rose-100 rounded-2xl outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-400 font-semibold text-slate-900 text-sm transition-all resize-none" placeholder="Budget, timing, no response, joined elsewhere..." />
                </div>
              )}

              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                <input type="checkbox" checked={formState.mark_contacted} onChange={(event) => setFormState((prev) => ({ ...prev, mark_contacted: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <div>
                  <p className="text-sm font-black text-slate-900">Mark as contacted</p>
                  <p className="text-xs font-semibold text-slate-500">Update last contact timestamp while saving this lead.</p>
                </div>
              </label>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" className="flex-1 py-3 text-white rounded-xl font-black text-sm transition-all hover:opacity-90 active:scale-[0.98] shadow-lg" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
                  {editingLead ? 'Save Lead Changes' : 'Create Lead'}
                </button>
                <button type="button" onClick={closeFormModal} className="sm:w-auto py-3 px-5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadsPage;