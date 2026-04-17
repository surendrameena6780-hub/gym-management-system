import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  LifeBuoy,
  Phone,
  Mail,
  MessageSquare,
  X,
  Building2,
  Clock3,
  ShieldCheck,
  Send,
  Ticket,
} from 'lucide-react';
import PageLoader from './PageLoader';

const statusBadge = (status) => {
  const key = String(status || '').toUpperCase();
  if (key === 'OPEN') return 'bg-amber-50 text-amber-700 border border-amber-100';
  if (key === 'RESOLVED') return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
  if (key === 'CLOSED') return 'bg-slate-100 text-slate-600 border border-slate-200';
  return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
};

const priorityBadge = (priority) => {
  const key = String(priority || '').toUpperCase();
  if (key === 'HIGH' || key === 'CRITICAL') return 'bg-rose-50 text-rose-700 border border-rose-100';
  if (key === 'MEDIUM') return 'bg-amber-50 text-amber-700 border border-amber-100';
  return 'bg-slate-100 text-slate-600 border border-slate-200';
};

const QUICK_PROBLEMS = [
  'How do I add a member?',
  'Staff login not working',
  'Check-in is not working',
  'I need my billing invoice',
  'How to send WhatsApp messages?',
  'How to manage leads?',
  'How to create a plan?',
  'Reset staff password',
];

const fallbackAssistantReply = (message) => {
  const lower = String(message || '').toLowerCase();

  if (lower.includes('add member') || lower.includes('new member') || lower.includes('register member') || lower.includes('create member')) {
    return {
      answer: 'To add a member:\n1. Go to Members page from the bottom navigation.\n2. Tap "+ Add Member" at the top.\n3. Fill in name, phone number, and email.\n4. Select a plan and start date.\n5. Click Save.\n\nIf it fails, check if the phone number is already used by another member.',
      category: 'GENERAL', priority: 'MEDIUM', suggested_subject: 'How to add a member',
      actions: ['Open Members page'],
    };
  }

  if (lower.includes('staff') && (lower.includes('login') || lower.includes('password'))) {
    return {
      answer: 'To reset a staff password:\n1. Go to Settings → Staff & Roles.\n2. Find the staff member.\n3. Click Edit and enter a new password (min 8 chars).\n4. Click Save.\n\nThe staff member can log in with their email and the new password.',
      category: 'ACCOUNT', priority: 'MEDIUM', suggested_subject: 'Staff password reset',
      actions: ['Open Settings → Staff & Roles'],
    };
  }

  if (lower.includes('attendance') || lower.includes('check in') || lower.includes('check-in') || lower.includes('checkin') || lower.includes('qr') || lower.includes('scan')) {
    return {
      answer: 'To check in a member:\n1. Go to Attendance → Check-In tab.\n2. Search by name or phone.\n3. Select and tap Check In.\n\nIf it fails:\n• Member must have an active plan.\n• Check attendance mode in Settings.\n• For QR, ensure camera permission is granted.\n• For RFID, the member needs a paired tag.',
      category: 'TECHNICAL', priority: 'HIGH', suggested_subject: 'Check-in help',
      actions: ['Open Attendance page'],
    };
  }

  if (lower.includes('bill') || lower.includes('invoice') || lower.includes('subscription')) {
    return {
      answer: 'To manage billing:\n1. Go to Settings → Billing & Subscriptions.\n2. View current plan, validity, and payment history.\n3. To download an invoice, find the payment and tap Download.\n4. To change plans, tap Upgrade or Change Plan.',
      category: 'BILLING', priority: 'MEDIUM', suggested_subject: 'Billing help',
      actions: ['Open Billing settings'],
    };
  }

  if (lower.includes('payment') || lower.includes('collect') || lower.includes('razorpay') || lower.includes('payment link')) {
    return {
      answer: 'To collect a payment:\n1. Go to Payments page.\n2. Tap "+ New Payment".\n3. Select plan, amount, and method.\n4. Click Record Payment.\n\nFor online payments via Razorpay:\n1. Go to Settings → Integrations → Payments.\n2. Enter your Razorpay Account ID.\n3. Once connected, send payment links to members via WhatsApp.',
      category: 'BILLING', priority: 'MEDIUM', suggested_subject: 'Payment collection help',
      actions: ['Open Payments page'],
    };
  }

  if (lower.includes('whatsapp') || lower.includes('message') || lower.includes('broadcast') || lower.includes('reminder')) {
    return {
      answer: 'To send WhatsApp messages:\n1. Go to Settings → Integrations → Messaging.\n2. Connect MSG91 with your API key and Hello number.\n3. Once connected, you can:\n   - Send reminders from member profiles\n   - Send broadcasts from Members page\n   - Auto-reminders for expiring/expired members run daily\n\nIf a message shows "Failed":\n• Check member has valid WhatsApp number.\n• Check MSG91 account balance.\n• Ensure template is approved by Meta.',
      category: 'TECHNICAL', priority: 'MEDIUM', suggested_subject: 'WhatsApp messaging help',
      actions: ['Open Settings → Integrations'],
    };
  }

  if (lower.includes('plan') || lower.includes('pricing') || lower.includes('create plan')) {
    return {
      answer: 'To create a plan:\n1. Go to Plans page.\n2. Tap "+ New Plan".\n3. Set name, duration, price, and discounts.\n4. Click Save.\n\nTo edit, tap the edit icon on any plan card.\n\nTips:\n• 2-3 plans gives members good choice.\n• Add a premium plan for higher revenue.\n• Enable discounts for special offers.',
      category: 'GENERAL', priority: 'MEDIUM', suggested_subject: 'Plan management help',
      actions: ['Open Plans page'],
    };
  }

  if (lower.includes('lead') || lower.includes('enquir') || lower.includes('follow up') || lower.includes('convert')) {
    return {
      answer: 'To manage leads:\n1. Go to Leads page from More menu.\n2. Tap "+ Add Lead" for a new enquiry.\n3. Fill name, phone, source, and priority.\n4. Set a follow-up date.\n\nTo follow up:\n• Tap Call to phone them.\n• Tap Chat to WhatsApp them.\n• When they join, tap Convert to create their member profile.\n\nTip: Reply within 5 minutes for best conversion.',
      category: 'GENERAL', priority: 'MEDIUM', suggested_subject: 'Lead management help',
      actions: ['Open Leads page'],
    };
  }

  if (lower.includes('class') || lower.includes('batch') || lower.includes('schedule') || lower.includes('trainer')) {
    return {
      answer: 'To manage classes:\n1. Go to Classes page from More menu.\n2. Create class types (Yoga, CrossFit, etc.).\n3. Add sessions with time, trainer, and capacity.\n4. Enroll members into sessions.\n\nTips:\n• Set capacity limits to avoid overcrowding.\n• Assign trainers for accountability.',
      category: 'GENERAL', priority: 'MEDIUM', suggested_subject: 'Class scheduling help',
      actions: ['Open Classes page'],
    };
  }

  if ((lower.includes('delete') && lower.includes('member')) || lower.includes('recover member') || lower.includes('restore member')) {
    return {
      answer: 'Deleted members are soft-deleted and can be recovered.\n\nTo recover:\n1. Go to Members page and check for deleted members.\n2. If not visible, raise a support ticket with:\n   - Member name\n   - Phone number\n   - Approximate deletion time\n\nOur team will restore the member safely.',
      category: 'DATA', priority: 'HIGH', suggested_subject: 'Recover deleted member',
      actions: ['Raise recovery ticket'],
    };
  }

  if (lower.includes('report') || lower.includes('insight') || lower.includes('analytics') || lower.includes('revenue') || lower.includes('dashboard')) {
    return {
      answer: 'To view analytics:\n1. Go to Insights page from More menu.\n2. Choose a time range (1M, 3M, 6M, 1Y).\n3. View revenue trends, retention rate, renewals due, and attendance heatmap.\n\nThe Dashboard shows daily smart tips and action items to grow your gym.',
      category: 'GENERAL', priority: 'LOW', suggested_subject: 'Reports and analytics help',
      actions: ['Open Insights page'],
    };
  }

  if (lower.includes('branch') || lower.includes('location') || lower.includes('multi branch')) {
    return {
      answer: 'To set up branches:\n1. Go to Settings → Branches.\n2. Tap Add Branch with name and address.\n3. Assign staff to each branch.\n\nUse the branch selector in the header to switch between branches. Each branch has its own members, attendance, and reports.',
      category: 'GENERAL', priority: 'MEDIUM', suggested_subject: 'Branch management help',
      actions: ['Open Settings → Branches'],
    };
  }

  return {
    answer: 'I can help you with:\n• Adding members and managing profiles\n• Payment collection and billing\n• WhatsApp messaging and broadcasts\n• Attendance and check-in setup\n• Plans and pricing\n• Lead management and follow-ups\n• Staff roles and permissions\n• Class scheduling\n• Reports and analytics\n• Branch management\n\nTell me what you need help with, or tap a quick issue above.',
    category: 'GENERAL', priority: 'LOW', suggested_subject: 'General support assistance',
    actions: ['Raise support ticket'],
  };
};

function HelpSupportPage({ appRuntime }) {
  const { token, toast } = appRuntime;
  const headers = useMemo(() => ({ headers: { 'x-auth-token': token } }), [token]);

  const [overview, setOverview] = useState({
    contact: { phone: '', email: '', whatsapp: '', website: '' },
    about: { title: '', mission: '', address: '', support_window: '' },
  });
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [raising, setRaising] = useState(false);

  const [ticketForm, setTicketForm] = useState({
    subject: '',
    category: 'GENERAL',
    priority: 'MEDIUM',
    description: '',
  });
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatScrollRef = useRef(null);
  const chatToggleRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatWasOpenRef = useRef(false);
  const [chatMessages, setChatMessages] = useState([
    {
      id: 'init-assistant',
      role: 'assistant',
      text: 'Hi! I am your GymVault support helper. Tell me the problem in simple words and I will guide you or help you raise a ticket.',
      meta: null,
    },
  ]);

  const ticketSummary = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((t) => String(t.status || '').toUpperCase() === 'OPEN').length;
    const closed = tickets.filter((t) => String(t.status || '').toUpperCase() === 'CLOSED').length;
    const latest = tickets[0]?.created_at ? new Date(tickets[0].created_at).toLocaleDateString('en-GB') : '—';
    return { total, open, closed, latest };
  }, [tickets]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, ticketsRes] = await Promise.all([
        axios.get('/api/support/overview', headers),
        axios.get('/api/support/tickets', headers),
      ]);

      setOverview(overviewRes.data || {
        contact: { phone: '', email: '', whatsapp: '', website: '' },
        about: { title: '', mission: '', address: '', support_window: '' },
      });
      setTickets(Array.isArray(ticketsRes.data) ? ticketsRes.data : []);
      setAccessDenied(false);
    } catch (_err) {
      if (_err?.response?.status === 403) {
        setAccessDenied(true);
        toast?.('Support page is restricted for your current role.', 'warning');
      } else {
        toast?.('Failed to load support center.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [headers, toast]);

  useEffect(() => {
    if (token) loadAll();
  }, [loadAll, token]);

  useEffect(() => {
    const chatBox = chatScrollRef.current;
    if (!chatBox) return;
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
  }, [chatBusy, chatMessages, chatOpen]);

  useEffect(() => {
    if (chatOpen) {
      chatWasOpenRef.current = true;
      const focusTimer = window.setTimeout(() => {
        chatInputRef.current?.focus();
      }, 0);
      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          setChatOpen(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.clearTimeout(focusTimer);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }

    if (chatWasOpenRef.current) {
      chatToggleRef.current?.focus();
    }

    return undefined;
  }, [chatOpen]);

  const createTicket = async ({ subject, category, priority, description }) => {
    if (!subject?.trim() || !description?.trim()) {
      toast?.('Subject and description are required.', 'warning');
      return null;
    }

    setRaising(true);
    try {
      const res = await axios.post('/api/support/tickets', {
        subject,
        category: category || 'GENERAL',
        priority: priority || 'MEDIUM',
        description,
      }, headers);
      const created = res.data;
      setTickets((prev) => [created, ...prev]);
      return created;
    } catch (err) {
      toast?.(err?.response?.data?.error || 'Failed to raise support ticket.', 'error');
      return null;
    } finally {
      setRaising(false);
    }
  };

  const raiseTicket = async (e) => {
    e.preventDefault();
    const created = await createTicket(ticketForm);
    if (created) {
      setTicketForm({ subject: '', category: 'GENERAL', priority: 'MEDIUM', description: '' });
      toast?.('Support ticket raised successfully.', 'success');
    }
  };

  const sendChat = async (presetMessage) => {
    const content = String(presetMessage || chatInput).trim();
    if (!content || chatBusy) return;

    const userMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: content,
      meta: null,
    };
    setChatMessages((prev) => [...prev, userMessage]);
    if (!presetMessage) setChatInput('');
    setChatBusy(true);

    try {
      const res = await axios.post('/api/support/chatbot', { message: content }, headers);
      const botPayload = res.data?.answer ? res.data : fallbackAssistantReply(content);
      const botMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: botPayload.answer || 'I could not understand that clearly. Please share more details or raise a ticket.',
        meta: {
          category: botPayload.category || 'GENERAL',
          priority: botPayload.priority || 'MEDIUM',
          suggested_subject: botPayload.suggested_subject || 'Support assistance needed',
          actions: Array.isArray(botPayload.actions) ? botPayload.actions : [],
        },
      };
      setChatMessages((prev) => [...prev, botMessage]);
    } catch (_err) {
      const fallback = fallbackAssistantReply(content);
      setChatMessages((prev) => ([
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: fallback.answer,
          meta: {
            category: fallback.category,
            priority: fallback.priority,
            suggested_subject: fallback.suggested_subject,
            actions: fallback.actions,
          },
        },
      ]));
    } finally {
      setChatBusy(false);
    }
  };

  const raiseTicketFromBot = async (message) => {
    if (!message?.meta) return;
    const created = await createTicket({
      subject: message.meta.suggested_subject || 'Support assistance needed',
      category: message.meta.category || 'GENERAL',
      priority: message.meta.priority || 'MEDIUM',
      description: `Raised by support assistant chat.\n\nIssue summary: ${message.text}`,
    });

    if (created) {
      toast?.(`Ticket #${created.id} raised from chat.`, 'success');
      setChatMessages((prev) => ([
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `Ticket #${created.id} has been created. Our team will follow up shortly.`,
          meta: null,
        },
      ]));
    }
  };

  if (loading) {
    return <PageLoader className="min-h-[56vh]" />;
  }

  const renderChatAssistant = () => {
    const wrapperClass = 'fixed inset-x-3 bottom-[5.5rem] z-[170] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col sm:inset-x-auto sm:right-6 sm:bottom-20 sm:w-[380px]';

    return (
      <div id="support-chat-panel" role="dialog" aria-modal="false" aria-labelledby="support-chat-title" className={wrapperClass} style={{ height: 'min(34rem, calc(var(--app-viewport-height) - 8rem))' }}>
        <div className="px-4 py-3 bg-indigo-600 text-white flex items-center justify-between">
          <div>
            <p id="support-chat-title" className="text-sm font-black uppercase tracking-wider">Support Chat</p>
            <p className="text-[11px] text-white/75 font-semibold mt-0.5">Quick help for billing, login, check-in, and data issues.</p>
          </div>
          <button type="button" aria-label="Close support chat" onClick={() => setChatOpen(false)} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Quick Issues</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {QUICK_PROBLEMS.map((problem) => (
              <button
                key={problem}
                type="button"
                onClick={() => sendChat(problem)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              >
                {problem}
              </button>
            ))}
          </div>
        </div>

        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-white">
          {chatMessages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[92%] rounded-2xl px-3.5 py-3 border text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                <p className="font-semibold whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                {msg.role === 'assistant' && msg.meta?.actions?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => raiseTicketFromBot(msg)} className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100">
                      Raise Ticket
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatBusy && <div className="text-[12px] text-slate-400 font-semibold">Support helper is typing...</div>}
        </div>

        <div className="border-t border-slate-100 bg-white px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              rows={2}
              placeholder="Type your issue here..."
              className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold resize-none"
            />
            <button
              type="button"
              onClick={() => sendChat()}
              disabled={chatBusy || !chatInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 disabled:opacity-60"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (accessDenied) {
    return (
      <div className="space-y-5">
        <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5">
          <div className="flex items-center gap-2 mb-2">
            <LifeBuoy size={18} className="text-indigo-500" />
            <h2 className="text-lg font-black text-slate-900">Help & Support</h2>
          </div>
          <p className="text-sm text-slate-500 font-medium">Your role currently does not have permission to access support tickets. Contact your gym owner to enable support access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 min-h-full pb-6 flex flex-col">
      <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5">
        <div className="flex items-center gap-2 mb-2">
          <LifeBuoy size={18} className="text-indigo-500" />
          <h2 className="text-lg font-black text-slate-900">Help & Support</h2>
        </div>
        <p className="text-sm text-slate-500 font-medium">Get help quickly, talk clearly with support, and track all your tickets in one place.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 flex-1 min-h-0">
        <div className="xl:col-span-2 space-y-5 min-h-0 flex flex-col">
          <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Ticket size={16} className="text-indigo-500" />
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Raise a Ticket</h3>
            </div>

            <form onSubmit={raiseTicket} className="space-y-3">
              <input
                value={ticketForm.subject}
                onChange={(e) => setTicketForm((prev) => ({ ...prev, subject: e.target.value }))}
                placeholder="What do you need help with?"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
              />

              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {QUICK_PROBLEMS.map((problem) => (
                  <button
                    key={`ticket-${problem}`}
                    type="button"
                    onClick={() => setTicketForm((prev) => ({ ...prev, subject: problem.replace('?', '') }))}
                    className="shrink-0 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] font-black text-slate-600 hover:bg-slate-100"
                  >
                    {problem}
                  </button>
                ))}
              </div>

              <textarea
                rows={4}
                value={ticketForm.description}
                onChange={(e) => setTicketForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Tell us what happened and where you got stuck."
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold resize-none"
              />

              <button
                type="submit"
                disabled={raising}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-black hover:bg-indigo-700 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
              >
                <Send size={14} />
                {raising ? 'Sending...' : 'Send Ticket'}
              </button>
            </form>
          </div>

          <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5 min-h-0 flex-1 flex flex-col">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-4">My Tickets</h3>
            {tickets.length === 0 ? (
              <div className="py-8 text-center text-sm font-bold text-slate-400">No tickets raised yet.</div>
            ) : (
              <div className="space-y-2.5 overflow-y-auto pr-1 min-h-0">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="p-3 rounded-xl border border-slate-100 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">#{ticket.id} · {ticket.subject}</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5 line-clamp-2">{ticket.description}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${statusBadge(ticket.status)}`}>{ticket.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${priorityBadge(ticket.priority)}`}>{ticket.priority}</span>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {ticket.category} · {new Date(ticket.created_at).toLocaleDateString('en-GB')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto pr-1 min-h-0">
          <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-3">Quick Contact</h3>
            <div className="space-y-2.5 text-sm">
              <a href={`tel:${overview.contact.phone}`} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white text-slate-700 font-semibold hover:bg-slate-50">
                <Phone size={14} className="text-indigo-500" /> {overview.contact.phone}
              </a>
              <a href={`mailto:${overview.contact.email}`} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white text-slate-700 font-semibold hover:bg-slate-50">
                <Mail size={14} className="text-indigo-500" /> {overview.contact.email}
              </a>
              <a href={`https://wa.me/${String(overview.contact.whatsapp || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-100 bg-white text-slate-700 font-semibold hover:bg-slate-50">
                <MessageSquare size={14} className="text-indigo-500" /> {overview.contact.whatsapp || 'WhatsApp Support'}
              </a>
            </div>
          </div>

          <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-5">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-3">Know Us</h3>
            <div className="space-y-2.5 text-xs font-semibold text-slate-600">
              <p className="flex items-start gap-2"><Building2 size={14} className="text-indigo-500 mt-0.5" /> {overview.about.mission}</p>
              <p className="flex items-start gap-2"><ShieldCheck size={14} className="text-indigo-500 mt-0.5" /> {overview.about.address}</p>
              <p className="flex items-start gap-2"><Clock3 size={14} className="text-indigo-500 mt-0.5" /> {overview.about.support_window}</p>
            </div>
          </div>

          <div className="bg-white backdrop-blur-sm rounded-[24px] border border-slate-200/60 p-4">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-2">Support Insights</h3>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl border border-slate-100 bg-white">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Total Tickets</p>
                <p className="text-base font-black text-slate-900 mt-1">{ticketSummary.total}</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-white">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Open Tickets</p>
                <p className="text-base font-black text-amber-600 mt-1">{ticketSummary.open}</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-white">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Closed Tickets</p>
                <p className="text-base font-black text-emerald-600 mt-1">{ticketSummary.closed}</p>
              </div>
              <div className="p-2.5 rounded-xl border border-slate-100 bg-white">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Latest Raised</p>
                <p className="text-sm font-black text-slate-900 mt-1">{ticketSummary.latest}</p>
              </div>
            </div>

          </div>
        </div>
      </div>

      <button
        ref={chatToggleRef}
        type="button"
        onClick={() => setChatOpen((prev) => !prev)}
        aria-label={chatOpen ? 'Close support assistant' : 'Open support assistant'}
        aria-controls="support-chat-panel"
        aria-expanded={chatOpen}
        className="fixed right-4 bottom-[5rem] sm:right-6 sm:bottom-6 z-[170] w-12 h-12 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 flex items-center justify-center"
        title="Open support assistant"
      >
        {chatOpen ? <X size={18} /> : <MessageSquare size={18} />}
      </button>

      {chatOpen && (
        renderChatAssistant()
      )}
    </div>
  );
}

export default HelpSupportPage;
