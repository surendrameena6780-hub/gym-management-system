import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Search, Plus, X, Phone, MessageSquare, Target, Clock3, CalendarDays,
  Pencil, Trash2, ArrowRight, CheckCircle2, Sparkles, Send, RefreshCw,
} from 'lucide-react';
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

const AUTOMATED_THREAD_NOTE_PATTERN = /^(\[WhatsApp reply\b|WhatsApp thread active\.)/i;

const buildLeadNoteSummary = (notes, lostReason) => {
  if (lostReason) {
    return {
      tone: 'lost',
      title: 'Lost reason',
      body: String(lostReason || '').trim(),
      badge: '',
      extra: '',
    };
  }

  const rawNotes = String(notes || '').trim();
  if (!rawNotes) return null;

  const blocks = rawNotes
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const threadBlocks = blocks.filter((block) => AUTOMATED_THREAD_NOTE_PATTERN.test(block));
  const manualBlocks = blocks.filter((block) => !AUTOMATED_THREAD_NOTE_PATTERN.test(block));

  if (threadBlocks.length === 0) {
    return {
      tone: 'notes',
      title: 'Notes',
      body: rawNotes,
      badge: '',
      extra: '',
    };
  }

  const latestThreadBlock = threadBlocks[threadBlocks.length - 1]
    .replace(/^\[WhatsApp reply[^\]]*\]\s*/i, '')
    .replace(/^WhatsApp thread active\.\s*Latest reply:\s*/i, '')
    .trim();

  return {
    tone: 'thread',
    title: 'WhatsApp thread',
    body: latestThreadBlock || 'Latest WhatsApp reply received.',
    badge: `${threadBlocks.length} repl${threadBlocks.length === 1 ? 'y' : 'ies'}`,
    extra: manualBlocks.join(' '),
  };
};

const formatChatStatusLabel = (value) => {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return 'Queued';
  if (status === 'RECEIVED') return 'Received';
  return status.replace(/_/g, ' ');
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
  const [chatLead, setChatLead] = useState(null);
  const [chatConversation, setChatConversation] = useState([]);
  const [chatMessaging, setChatMessaging] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatRefreshing, setChatRefreshing] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatTemplateKey, setChatTemplateKey] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const loadCompletedRef = useRef(false);
  const chatEndRef = useRef(null);

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

  useEffect(() => {
    if (!chatLead) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatConversation, chatLead]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('app-modal-open', Boolean(showFormModal || chatLead));

    return () => {
      root.classList.remove('app-modal-open');
    };
  }, [chatLead, showFormModal]);

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingLead(null);
    setFormState(INITIAL_FORM);
  };

  const closeChatModal = useCallback(() => {
    setChatLead(null);
    setChatConversation([]);
    setChatMessaging(null);
    setChatLoading(false);
    setChatRefreshing(false);
    setChatSending(false);
    setChatTemplateKey('');
    setChatMessage('');
  }, []);

  const fetchLeadChat = useCallback(async (lead, { soft = false } = {}) => {
    if (!token || !lead?.id) return;

    if (soft) setChatRefreshing(true);
    else setChatLoading(true);

    try {
      const response = await axios.get(`/api/leads/${lead.id}/chat`, { headers: { 'x-auth-token': token } });
      const nextMessaging = response.data?.messaging || null;
      setChatLead(response.data?.lead || lead);
      setChatConversation(Array.isArray(response.data?.conversation) ? response.data.conversation : []);
      setChatMessaging(nextMessaging);
      setChatTemplateKey((current) => {
        const approvedTemplates = Array.isArray(nextMessaging?.approved_templates) ? nextMessaging.approved_templates : [];
        const stillValid = approvedTemplates.some((template) => template.template_key === current);
        if (stillValid) return current;
        return nextMessaging?.preferred_template_key || approvedTemplates[0]?.template_key || '';
      });
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to load lead chat.', 'error');
      if (!soft) {
        closeChatModal();
      }
    } finally {
      setChatLoading(false);
      setChatRefreshing(false);
    }
  }, [closeChatModal, token, toast]);

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

  const handleOpenChat = async (lead) => {
    setChatLead(lead);
    setChatConversation([]);
    setChatMessaging(null);
    setChatTemplateKey('');
    setChatMessage('');
    await fetchLeadChat(lead);
  };

  const handleSendChatMessage = async () => {
    if (!chatLead?.id) return;

    if (!canManage) {
      toast?.('You do not have permission to reply to leads.', 'warning');
      return;
    }

    const selectedTemplate = Array.isArray(chatMessaging?.approved_templates)
      ? chatMessaging.approved_templates.find((template) => template.template_key === chatTemplateKey)
      : null;

    if (!selectedTemplate) {
      toast?.('Select an approved WhatsApp template first.', 'warning');
      return;
    }

    const trimmedMessage = chatMessage.trim();
    if (selectedTemplate.template_key === 'LEAD_REPLY' && !trimmedMessage) {
      toast?.('Type your reply before sending.', 'warning');
      return;
    }

    setChatSending(true);
    try {
      await axios.post(
        `/api/leads/${chatLead.id}/chat/messages`,
        {
          template_key: selectedTemplate.template_key,
          message: trimmedMessage || undefined,
        },
        { headers: { 'x-auth-token': token } }
      );
      setChatMessage('');
      toast?.('WhatsApp reply sent from GymVault.', 'success');
      requestDataRefresh('lead-chat');
      await Promise.all([
        fetchLeadChat(chatLead, { soft: true }),
        fetchLeadsData({ soft: true }),
      ]);
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Unable to send WhatsApp reply.', 'error');
    } finally {
      setChatSending(false);
    }
  };

  const selectedChatTemplate = useMemo(() => {
    if (!Array.isArray(chatMessaging?.approved_templates)) return null;
    return chatMessaging.approved_templates.find((template) => template.template_key === chatTemplateKey) || null;
  }, [chatMessaging?.approved_templates, chatTemplateKey]);

  const chatPreviewText = useMemo(() => {
    const preview = String(selectedChatTemplate?.preview_text || '').trim();
    if (!preview) return '';
    if (selectedChatTemplate?.template_key !== 'LEAD_REPLY') return preview;

    const typedMessage = chatMessage.trim();
    if (!typedMessage) return preview;

    return preview.replace('we would be happy to help you with the next step.', typedMessage);
  }, [chatMessage, selectedChatTemplate]);

  const leadReplyTemplatePending = useMemo(() => {
    const leadReplyTemplate = chatMessaging?.lead_reply_template;
    if (!leadReplyTemplate) return false;
    return String(leadReplyTemplate.whatsapp_template_status || '').toUpperCase() !== 'APPROVED';
  }, [chatMessaging?.lead_reply_template]);

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
                const noteSummary = buildLeadNoteSummary(lead.notes, lead.lost_reason);
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

                    {(noteSummary || lead.trial_date) && (
                      <div className="rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 space-y-1">
                        {lead.trial_date && <p className="text-xs font-semibold text-slate-200"><span className="text-slate-500">Trial:</span> {formatDateTimeLabel(lead.trial_date)}</p>}
                        {noteSummary && (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${noteSummary.tone === 'thread' ? 'text-emerald-300' : noteSummary.tone === 'lost' ? 'text-rose-300' : 'text-slate-500'}`}>{noteSummary.title}</p>
                              {noteSummary.badge && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-200">{noteSummary.badge}</span>}
                            </div>
                            <p className={`text-xs line-clamp-2 ${noteSummary.tone === 'lost' ? 'text-rose-300' : 'text-slate-300'}`}>{noteSummary.body}</p>
                            {noteSummary.extra && <p className="text-[11px] text-slate-500 line-clamp-2">{noteSummary.extra}</p>}
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handleCall(lead.phone)} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-blue-500/15 text-blue-200 border border-blue-500/30 text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 hover:bg-blue-500 hover:text-white transition-all">
                        <Phone size={12} /> Call
                      </button>
                      <button onClick={() => handleOpenChat(lead)} className="flex-1 min-w-[110px] py-2.5 rounded-xl bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 hover:bg-emerald-500 hover:text-white transition-all">
                        <MessageSquare size={12} /> Chat
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
                const noteSummary = buildLeadNoteSummary(lead.notes, lead.lost_reason);

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
                        {noteSummary && (
                          <div className={`rounded-2xl border px-3 py-2.5 ${noteSummary.tone === 'lost' ? 'border-rose-500/30 bg-rose-500/10' : noteSummary.tone === 'thread' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/90'}`}>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${noteSummary.tone === 'lost' ? 'text-rose-300' : noteSummary.tone === 'thread' ? 'text-emerald-200' : 'text-slate-500'}`}>{noteSummary.title}</p>
                              {noteSummary.badge && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-200">{noteSummary.badge}</span>}
                            </div>
                            <p className={`text-xs leading-relaxed break-words ${noteSummary.tone === 'lost' ? 'font-semibold text-rose-300' : 'font-medium text-slate-300'}`}>
                              {noteSummary.body}
                            </p>
                            {noteSummary.extra && <p className="mt-1.5 text-[11px] leading-relaxed break-words text-slate-500">{noteSummary.extra}</p>}
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
                          <button type="button" aria-label={`Open chat for ${lead.full_name}`} onClick={() => handleOpenChat(lead)} className="p-2.5 text-emerald-200 bg-emerald-500/15 border border-emerald-500/30 rounded-xl hover:bg-emerald-500 hover:text-white transition-all">
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

      {chatLead && (
        <div className="app-modal-shell z-[145] bg-slate-950/70 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={`Lead chat for ${chatLead.full_name}`} className="app-modal-panel app-modal-panel--xl lead-chat-modal-panel w-full overflow-hidden rounded-[30px] border border-slate-700 bg-slate-950 text-white shadow-2xl animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-6" style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.96) 55%, rgba(5,150,105,0.28) 100%)' }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black text-white">Lead Chat</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${STATUS_STYLES[String(chatLead.status || 'NEW').toUpperCase()] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                    {String(chatLead.status || 'NEW').replace(/_/g, ' ')}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${PRIORITY_STYLES[String(chatLead.priority || 'MEDIUM').toUpperCase()] || PRIORITY_STYLES.MEDIUM}`}>
                    {String(chatLead.priority || 'MEDIUM')}
                  </span>
                </div>
                <p className="mt-2 text-sm font-black text-white truncate">{chatLead.full_name}</p>
                <p className="mt-1 max-w-full truncate whitespace-nowrap text-xs font-semibold text-slate-300">{chatLead.phone}{chatLead.email ? ` • ${chatLead.email}` : ''}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-label="Refresh lead chat"
                  onClick={() => fetchLeadChat(chatLead, { soft: true })}
                  disabled={chatLoading || chatRefreshing || chatSending}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
                >
                  <RefreshCw size={16} className={chatRefreshing ? 'animate-spin' : ''} />
                </button>
                <button type="button" aria-label="Close lead chat" onClick={closeChatModal} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="lead-chat-modal-body flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(0,1.45fr)_360px] lg:overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col border-b border-slate-800 lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 sm:px-6">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Conversation</p>
                    <p className="mt-1 text-sm font-semibold text-slate-400">Inbound replies and tracked outbound sends appear here.</p>
                  </div>
                  {chatRefreshing && <span className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Refreshing</span>}
                </div>

                <div className="app-modal-scroll lead-chat-thread-scroll flex-1 bg-slate-950/90 px-5 py-5 sm:px-6">
                  {chatLoading ? (
                    <div className="flex min-h-[260px] items-center justify-center">
                      <PageLoader className="min-h-[180px]" />
                    </div>
                  ) : chatConversation.length === 0 ? (
                    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-700 bg-slate-900/60 px-6 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/10 text-emerald-300">
                        <MessageSquare size={28} />
                      </div>
                      <h3 className="mt-4 text-lg font-black text-white">No thread yet</h3>
                      <p className="mt-2 max-w-sm text-sm font-medium text-slate-400">Start the conversation from here. Once the lead replies on WhatsApp, the thread will continue in this popup.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {chatConversation.map((message) => {
                        const isOutbound = String(message.direction || '').toUpperCase() === 'OUTBOUND';
                        return (
                          <div key={message.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[88%] rounded-[24px] px-4 py-3 shadow-lg ${isOutbound ? 'bg-emerald-500 text-emerald-950' : 'border border-slate-700 bg-slate-900 text-slate-100'}`}>
                              <div className="flex items-center gap-2">
                                <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${isOutbound ? 'text-emerald-950/65' : 'text-slate-400'}`}>
                                  {isOutbound ? 'GymVault send' : 'Lead reply'}
                                </p>
                                {message.template_title && (
                                  <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${isOutbound ? 'bg-emerald-950/10 text-emerald-950/70' : 'bg-slate-800 text-slate-400'}`}>
                                    {message.template_title}
                                  </span>
                                )}
                              </div>
                              <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${isOutbound ? 'text-emerald-950' : 'text-slate-100'}`}>{message.message_text || 'No message content available.'}</p>
                              <div className={`mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold ${isOutbound ? 'text-emerald-950/70' : 'text-slate-400'}`}>
                                <span>{formatDateTimeLabel(message.occurred_at)}</span>
                                <span>{formatChatStatusLabel(message.delivery_status)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              <div className="lead-chat-composer shrink-0 space-y-4 border-t border-slate-800 bg-slate-950 px-5 py-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-t-0" style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 100%)' }}>
                {!chatMessaging?.whatsapp_connected ? (
                  <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">Connection needed</p>
                    <p className="mt-2 text-sm font-semibold text-amber-100">Connect the gym WhatsApp business number in Settings before replying from the lead inbox.</p>
                  </div>
                ) : !Array.isArray(chatMessaging?.approved_templates) || chatMessaging.approved_templates.length === 0 ? (
                  <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/10 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">Template approval needed</p>
                    <p className="mt-2 text-sm font-semibold text-amber-100">Approve at least one WhatsApp template in Settings before sending lead replies from here.</p>
                  </div>
                ) : (
                  <>
                    {leadReplyTemplatePending && (
                      <div className="rounded-[24px] border border-sky-500/30 bg-sky-500/10 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">Lead reply template pending</p>
                        <p className="mt-2 text-sm font-semibold text-sky-100">Your dedicated Lead Chat Reply template is not approved yet. You can still send any approved template from this inbox today.</p>
                      </div>
                    )}

                    <div className="space-y-3 rounded-[28px] border border-slate-800 bg-slate-900/70 p-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">Send via WhatsApp</p>
                        <p className="mt-1 text-sm font-semibold text-slate-400">Choose an approved template. If Lead Chat Reply is approved, you can type the message here and send it without leaving GymVault.</p>
                      </div>

                      <div>
                        <label className="mb-1.5 ml-0.5 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Template</label>
                        <select
                          value={chatTemplateKey}
                          onChange={(event) => setChatTemplateKey(event.target.value)}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                        >
                          {chatMessaging.approved_templates.map((template) => (
                            <option key={template.template_key} value={template.template_key}>{template.title}</option>
                          ))}
                        </select>
                      </div>

                      {selectedChatTemplate?.template_key === 'LEAD_REPLY' && (
                        <>
                          <div>
                            <label className="mb-1.5 ml-0.5 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Reply message</label>
                            <textarea
                              value={chatMessage}
                              onChange={(event) => setChatMessage(event.target.value)}
                              rows={5}
                              placeholder="Type the message you want GymVault to send over WhatsApp."
                              className="w-full resize-none rounded-[24px] border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-medium text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                            />
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {[
                              'Would you like us to book your trial slot for today?',
                              'If you want, I can share the current membership offer here.',
                              'Tell me your preferred workout time and I will help you with the best plan.',
                            ].map((quickReply) => (
                              <button
                                key={quickReply}
                                type="button"
                                onClick={() => setChatMessage(quickReply)}
                                className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] font-black text-emerald-200 transition hover:bg-emerald-500 hover:text-white"
                              >
                                {quickReply}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      <div className="rounded-[24px] border border-slate-800 bg-slate-950/80 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Preview</p>
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-200">Tracked send</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-200">{chatPreviewText || 'Select a template to preview the WhatsApp message.'}</p>
                      </div>

                      <button
                        type="button"
                        onClick={handleSendChatMessage}
                        disabled={chatSending || chatRefreshing || !selectedChatTemplate || (selectedChatTemplate.template_key === 'LEAD_REPLY' && !chatMessage.trim()) || !canManage}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white transition disabled:opacity-60"
                        style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                      >
                        <Send size={15} /> {chatSending ? 'Sending WhatsApp...' : 'Send From GymVault'}
                      </button>

                      {!canManage && <p className="text-center text-[11px] font-semibold text-slate-500">You can view the thread, but only lead managers can send replies.</p>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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