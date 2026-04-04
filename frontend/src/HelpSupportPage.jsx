import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  'Get my deleted member back',
  'Reset staff password',
];

const fallbackAssistantReply = (message) => {
  const lower = String(message || '').toLowerCase();

  if (lower.includes('add member') || lower.includes('new member') || lower.includes('register member')) {
    return {
      answer: 'To add a member, open Members, tap Add Member, fill the name, phone, and email, then save. If it fails, check if the phone number is already used.',
      category: 'GENERAL',
      priority: 'MEDIUM',
      suggested_subject: 'Unable to add member',
      actions: ['Open Members page', 'Raise support ticket'],
    };
  }

  if (lower.includes('staff') && lower.includes('login')) {
    return {
      answer: 'If staff cannot log in, check that the staff account is active, the role is assigned correctly, and the password is right. You can also reset the password from staff settings.',
      category: 'ACCOUNT',
      priority: 'MEDIUM',
      suggested_subject: 'Staff login issue',
      actions: ['Open Settings → Staff & Roles', 'Reset staff password', 'Raise support ticket'],
    };
  }

  if (lower.includes('attendance') || lower.includes('check in') || lower.includes('check-in') || lower.includes('checkin')) {
    return {
      answer: 'For check-in issues, first check the attendance mode, then confirm the member plan is active, and try again. If it still fails, send the member name and time in a ticket.',
      category: 'TECHNICAL',
      priority: 'HIGH',
      suggested_subject: 'Attendance check-in issue',
      actions: ['Verify attendance mode', 'Retry check-in', 'Raise support ticket'],
    };
  }

  if (lower.includes('bill') || lower.includes('invoice') || lower.includes('subscription') || lower.includes('payment')) {
    return {
      answer: 'For billing help, open Settings and go to Billing. There you can check your current plan, validity, and download the invoice from billing history.',
      category: 'BILLING',
      priority: 'MEDIUM',
      suggested_subject: 'Billing or invoice issue',
      actions: ['Open Billing settings', 'Raise support ticket'],
    };
  }

  if (lower.includes('delete') && lower.includes('member')) {
    return {
      answer: 'Deleted members can usually be recovered. Send the member name, phone number, and approximate delete time in a ticket.',
      category: 'DATA',
      priority: 'HIGH',
      suggested_subject: 'Recover deleted member',
      actions: ['Raise support ticket'],
    };
  }

  return {
    answer: 'I can help with member add issues, staff login, check-in issues, billing, and deleted data. Tap a quick issue below or raise a ticket.',
    category: 'GENERAL',
    priority: 'LOW',
    suggested_subject: 'General support assistance',
    actions: ['Raise support ticket'],
  };
};

function HelpSupportPage({ token, toast }) {
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

  const loadAll = async () => {
    setLoading(true);
    try {
      const [overviewRes, ticketsRes] = await Promise.all([
        axios.get('/api/support/overview', headers),
        axios.get('/api/support/tickets', headers),
      ]);

      setOverview(overviewRes.data || overview);
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
  };

  useEffect(() => {
    if (token) loadAll();
  }, [token]);

  useEffect(() => {
    const chatBox = chatScrollRef.current;
    if (!chatBox) return;
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
  }, [chatBusy, chatMessages, chatOpen]);

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
    const wrapperClass = 'fixed inset-x-3 bottom-[5.5rem] z-[170] h-[min(34rem,calc(100vh-8rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col sm:inset-x-auto sm:right-6 sm:bottom-20 sm:w-[380px]';

    return (
      <div className={wrapperClass}>
        <div className="px-4 py-3 bg-indigo-600 text-white flex items-center justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-wider">Support Chat</p>
            <p className="text-[11px] text-white/75 font-semibold mt-0.5">Quick help for billing, login, check-in, and data issues.</p>
          </div>
          <button type="button" onClick={() => setChatOpen(false)} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center">
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
        <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
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
      <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
        <div className="flex items-center gap-2 mb-2">
          <LifeBuoy size={18} className="text-indigo-500" />
          <h2 className="text-lg font-black text-slate-900">Help & Support</h2>
        </div>
        <p className="text-sm text-slate-500 font-medium">Get help quickly, talk clearly with support, and track all your tickets in one place.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 flex-1 min-h-0">
        <div className="xl:col-span-2 space-y-5 min-h-0 flex flex-col">
          <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
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

          <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5 min-h-0 flex-1 flex flex-col">
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
          <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
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

          <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-5">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-3">Know Us</h3>
            <div className="space-y-2.5 text-xs font-semibold text-slate-600">
              <p className="flex items-start gap-2"><Building2 size={14} className="text-indigo-500 mt-0.5" /> {overview.about.mission}</p>
              <p className="flex items-start gap-2"><ShieldCheck size={14} className="text-indigo-500 mt-0.5" /> {overview.about.address}</p>
              <p className="flex items-start gap-2"><Clock3 size={14} className="text-indigo-500 mt-0.5" /> {overview.about.support_window}</p>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/70 p-4">
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
        type="button"
        onClick={() => setChatOpen((prev) => !prev)}
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
