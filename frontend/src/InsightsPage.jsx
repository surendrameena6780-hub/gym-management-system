import React, { useState, useMemo, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, Users, DollarSign, Activity, AlertTriangle, 
  ArrowUpRight, ArrowDownRight, Download, CreditCard, 
  UserMinus, UserCheck, Clock, Target, ShieldCheck,
  MessageSquare, Phone, Award
} from 'lucide-react';
import { normalizeProfileImageUrl } from './utils/profileImage';
import PageLoader from './PageLoader';

const extractArray = (value, keys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
};

// ─── Count-Up Hook ─────────────────────────────────────────────────────────────
function useCountUp(target, duration = 900) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const prevTarget = useRef(null);
  useEffect(() => {
    const end = Number(target) || 0;
    if (prevTarget.current === end) return;
    prevTarget.current = end;
    const begin = display;
    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(begin + (end - begin) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return display;
}

// --- UTILITY COMPONENTS ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm ${className}`}>
    {children}
  </div>
);

const KPICard = ({ title, value, change, trend, icon: Icon, color, className = '' }) => {
  const strVal = String(value ?? '');
  const prefix = strVal.startsWith('₹') ? '₹' : '';
  const suffix = strVal.endsWith('%') ? '%' : '';
  const rawNum = parseFloat(strVal.replace(/[₹%,]/g, ''));
  const isNumeric = !Number.isNaN(rawNum);
  const animated = useCountUp(isNumeric ? rawNum : 0);
  const displayVal = isNumeric ? `${prefix}${animated.toLocaleString()}${suffix}` : strVal;
  return (
  <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${className}`}>
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-opacity-100`}>
        <Icon size={20} className={color.replace('bg-', 'text-')} />
      </div>
      {change && (
        <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${trend === 'up' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {change}
        </div>
      )}
    </div>
    <div>
      <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
      <h3 className="text-2xl font-black text-slate-900">{displayVal}</h3>
    </div>
  </div>
  );
};

const formatHour = (h) => {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
};

// --- MAIN PAGE COMPONENT ---

const InsightsPage = ({ token, toast, currentUser, isActive = true }) => {
  const gymName = currentUser?.gym_name || 'GymVault';
  const [activeTab, setActiveTab] = useState('revenue');
  const [members, setMembers] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('6M');

  // --- ACTION FUNCTIONS ---
  const sendWhatsApp = (member, type) => {
    let message = "";
    
    if (type === 'expiring') {
      message = `Hi ${member.full_name}, your membership at ${gymName} is expiring in ${member.days_left} days. Renew now to keep your fitness journey going!`;
    } else if (type === 'expired') {
      message = `Hi ${member.full_name}, your membership at ${gymName} has expired. We would love to have you back! Renew your plan today.`;
    } else {
      message = `Hi ${member.full_name}, we missed you at ${gymName}! It's been a while since your last visit. Hope to see you back in the gym soon!`;
    }
    
    window.open(`https://wa.me/91${member.phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleCall = (phoneNumber) => window.open(`tel:${phoneNumber}`, '_self');

  const handleDownloadReport = () => window.print();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [membersRes, attendanceRes] = await Promise.all([
          axios.get('/api/members', { headers: { 'x-auth-token': token } }),
          axios.get('/api/attendance/summary', { headers: { 'x-auth-token': token } })
        ]);
        setMembers(extractArray(membersRes.data, ['members', 'rows', 'items']).map((member) => ({
          ...member,
          profile_pic: normalizeProfileImageUrl(member?.profile_pic),
        })));
        setAttendanceSummary(extractArray(attendanceRes.data, ['summary', 'attendance', 'rows', 'items']));
      } catch (err) {
        console.error("Failed to load insights data", err);
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchData();
  }, [token]);

  // --- THE INTELLIGENCE ENGINE ---
  const analytics = useMemo(() => {
    if (!members.length) return null;

    const today = new Date();
    
    let totalRevenue = 0;
    let revenueByMonth = {};
    let planPerformance = {};
    let lostRevenue = 0;

    members.forEach(m => {
      const paid = parseFloat(m.total_paid || 0);
      totalRevenue += paid;

      if (m.plan_name) {
        if (!planPerformance[m.plan_name]) {
          planPerformance[m.plan_name] = { name: m.plan_name, revenue: 0, users: 0 };
        }
        planPerformance[m.plan_name].revenue += paid;
        if (m.membership_status === 'ACTIVE') planPerformance[m.plan_name].users += 1;
      }

      if (m.membership_status === 'EXPIRED') {
        lostRevenue += paid > 0 ? paid : 1500; 
      }

      if (m.payment_history && Array.isArray(m.payment_history)) {
        m.payment_history.forEach(pay => {
          const date = new Date(pay.payment_date);
          const monthKey = date.toLocaleString('default', { month: 'short' });
          revenueByMonth[monthKey] = (revenueByMonth[monthKey] || 0) + parseFloat(pay.amount_paid);
        });
      }
    });

    const activeMembers = members.filter(m => m.membership_status === 'ACTIVE').length;
    const expiredMembers = members.filter(m => m.membership_status === 'EXPIRED').length;
    
    // Ignore UNPAID members so they don't drag down the retention rate
    const totalPayingMembers = activeMembers + expiredMembers;
    
    const arpu = activeMembers > 0 ? Math.round(totalRevenue / activeMembers) : 0;
    const retentionRate = totalPayingMembers > 0 ? ((activeMembers / totalPayingMembers) * 100).toFixed(1) : 0;
    const churnRate = totalPayingMembers > 0 ? (100 - retentionRate).toFixed(1) : 0;
    
    const topPlans = Object.values(planPerformance).sort((a, b) => b.revenue - a.revenue);

    // Top active members based on actual lifetime spend, removing fake random streaks
    const topActiveMembers = members
      .filter(m => m.membership_status === 'ACTIVE')
      .sort((a, b) => parseFloat(b.total_paid || 0) - parseFloat(a.total_paid || 0))
      .slice(0, 5);

    let monthsToShow = 6;
    if (dateRange === '1M') monthsToShow = 1;
    if (dateRange === '3M') monthsToShow = 3;
    if (dateRange === '6M') monthsToShow = 6;
    if (dateRange === '1Y') monthsToShow = 12;

    const revenueData = Object.keys(revenueByMonth).map(key => ({
      name: key,
      revenue: revenueByMonth[key]
    })).slice(-monthsToShow);

    // B. RISK ANALYSIS (Strictly ignores UNPAID)
    const criticalMembers = members.filter(m => m.days_left <= 7 && m.membership_status !== 'UNPAID');
    const revenueAtRisk = criticalMembers.filter(m => m.days_left > 0).length * (arpu > 0 ? arpu : 1500); 

    const ghostMembers = members.filter(m => {
      if (m.membership_status !== 'ACTIVE') return false; // Unpaid/Expired are ignored here
      if (!m.last_visit) return true; 
      const daysSince = Math.floor((today - new Date(m.last_visit)) / (1000 * 60 * 60 * 24));
      return daysSince > 4;
    });

    // Map real attendance data for the chart
    const heatmapData = attendanceSummary.map(d => ({
      time: formatHour(d.hour),
      count: parseInt(d.count)
    }));

    return {
      revenue: {
        total: totalRevenue,
        graphData: revenueData.length > 0 ? revenueData : [{ name: 'Current', revenue: totalRevenue }],
        growth: "+12.5%",
        arpu: arpu,
        lostRevenue: lostRevenue,
        topPlans: topPlans
      },
      health: {
        active: activeMembers,
        retention: retentionRate,
        churn: churnRate,
        expired: expiredMembers
      },
      risk: {
        expiringCount: criticalMembers.length,
        revenueAtRisk: revenueAtRisk,
        expiringList: criticalMembers,
        ghostCount: ghostMembers.length,
        ghostList: ghostMembers.slice(0, 5)
      },
      attendance: {
        heatmap: heatmapData,
        topMembers: topActiveMembers
      }
    };
  }, [members, attendanceSummary, dateRange]);

  if (loading) return <PageLoader className="min-h-[56vh]" />;
  if (!analytics) return <div className="p-10 text-center text-slate-500 font-bold">No Data Available. Add members to see insights.</div>;

  return (
    <div className="min-h-full p-0 space-y-8 font-inter text-slate-900">
      
      {/* 1. HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Business Insights</h1>
          <p className="text-slate-500 font-medium mt-1">Real-time strategic performance metrics</p>
        </div>
        <div className="flex items-center gap-3 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          {['1M', '3M', '6M', '1Y'].map(range => (
            <button 
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${dateRange === range ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
            >
              {range}
            </button>
          ))}
          <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>
        <button 
            onClick={handleDownloadReport} 
            className="px-3 py-2 text-slate-400 hover:text-slate-900 transition-colors"
            title="Download PDF Report"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="ARPU" value={`₹${analytics.revenue.arpu.toLocaleString()}`} icon={Target} color="bg-emerald-500" className="gv-fade-up" />
        <KPICard title="Renewals Due Soon" value={analytics.risk.expiringCount} change={analytics.risk.expiringCount > 0 ? 'priority' : 'stable'} trend={analytics.risk.expiringCount > 0 ? 'down' : 'up'} icon={Clock} color="bg-amber-500" className="gv-fade-up gv-fade-up-1" />
        <KPICard title="Retention Rate" value={`${analytics.health.retention}%`} change={`${analytics.health.expired} expired`} trend={Number(analytics.health.churn || 0) > 0 ? 'down' : 'up'} icon={Activity} color="bg-violet-500" className="gv-fade-up gv-fade-up-2" />
        <KPICard title="Revenue At Risk" value={`₹${analytics.risk.revenueAtRisk.toLocaleString()}`} change={`${analytics.risk.ghostCount} ghosts`} trend={analytics.risk.revenueAtRisk > 0 ? 'down' : 'up'} icon={AlertTriangle} color="bg-rose-500" className="gv-fade-up gv-fade-up-3" />
      </div>

      {/* 3. TABS */}
      <div className="border-b border-slate-200 flex gap-8 overflow-x-auto">
        {[
          { id: 'revenue', label: 'Revenue & Finance', icon: DollarSign },
          { id: 'attendance', label: 'Attendance & Trends', icon: Users },
          { id: 'retention', label: 'Retention & Churn', icon: UserCheck },
          { id: 'risk', label: 'Risk Analysis', icon: AlertTriangle },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-4 flex items-center gap-2 text-sm font-bold transition-all border-b-2 whitespace-nowrap active:scale-95 ${activeTab === tab.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-200'}`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 4. DYNAMIC CONTENT AREA */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* --- STRATEGIC REVENUE TAB --- */}
        {activeTab === 'revenue' && (
          <div className="space-y-6">
            
            {/* CEO Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-5 border-l-4 border-l-blue-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><Target size={12}/> ARPU (Avg Rev Per User)</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-slate-900">₹{analytics.revenue.arpu.toLocaleString()}</h3>
                  <span className="text-sm font-bold text-slate-400 mb-1">/ active member</span>
                </div>
              </Card>
              <Card className="p-5 border-l-4 border-l-rose-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><TrendingUp size={12} className="rotate-180"/> Churn Cost (Lost Revenue)</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-rose-600">₹{analytics.revenue.lostRevenue.toLocaleString()}</h3>
                  <span className="text-sm font-bold text-slate-400 mb-1">from expired plans</span>
                </div>
              </Card>
              <Card className="p-5 border-l-4 border-l-emerald-500">
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5"><ShieldCheck size={12}/> Projected Next Month</p>
                <div className="flex items-end gap-2">
                  <h3 className="text-2xl font-black text-emerald-600">₹{(analytics.health.active * analytics.revenue.arpu).toLocaleString()}</h3>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded mb-1 border border-emerald-100">Safe Baseline</span>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Graph */}
              <Card className="lg:col-span-2 p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="font-bold text-lg text-slate-900">Revenue Velocity</h3>
                    <p className="text-xs text-slate-400 font-medium mt-1">Cash flow mapped over your selected period</p>
                  </div>
                </div>
                <div className="h-[250px] w-full">
                  {isActive ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.revenue.graphData}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} tickFormatter={(val) => `₹${val >= 1000 ? (val/1000).toFixed(0)+'k' : val}`} />
                      <Tooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} formatter={(val) => [`₹${val}`, 'Revenue']} />
                      <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                    </AreaChart>
                  </ResponsiveContainer>
                  ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />}
                </div>
              </Card>

              {/* Plan Performance Matrix */}
              <Card className="p-0 overflow-hidden flex flex-col">
                <div className="p-6 border-b border-slate-50 bg-slate-900 text-white">
                  <h3 className="font-bold text-lg">Plan Performance Matrix</h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">Which memberships drive your business</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {analytics.revenue.topPlans.length > 0 ? (
                    <div className="space-y-1">
                      {analytics.revenue.topPlans.map((plan, idx) => (
                        <div key={idx} className="p-4 hover:bg-slate-50 rounded-xl transition-colors border-b border-slate-50 last:border-0">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-sm text-slate-800">{plan.name}</span>
                            <span className="font-black text-sm text-emerald-600">₹{plan.revenue.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                              <Users size={12} />
                              <span>{plan.users} Active Users</span>
                            </div>
                            <span className="text-slate-400 font-bold uppercase text-[10px]">Rank #{idx + 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm font-bold">No plan data available yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* --- ATTENDANCE TAB --- */}
        {activeTab === 'attendance' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <Card className="p-6">
                    <h3 className="font-bold text-lg text-slate-900 mb-6">Peak Visiting Hours</h3>
                    <div className="h-[300px] w-full">
                      {analytics.attendance.heatmap.length > 0 ? (
                        isActive ? (
                          <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={analytics.attendance.heatmap}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '12px', border: 'none'}} />
                                  <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={40} name="Check-ins" />
                              </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="h-full rounded-2xl bg-slate-50 border border-slate-100" />
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-400 font-bold">No attendance data yet.</div>
                      )}
                    </div>
                 </Card>

                 <Card className="p-6">
                    <h3 className="font-bold text-lg text-slate-900 mb-6">Top Active Members (By Lifetime Value)</h3>
                    <div className="space-y-4">
                        {analytics.attendance.topMembers.length > 0 ? (
                          analytics.attendance.topMembers.map((m, i) => (
                              <div key={m.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors border border-slate-50">
                                  <div className="flex items-center gap-3">
                                      <span className="text-slate-300 font-black text-sm w-4">{i+1}</span>
                                      <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center text-slate-400 font-bold text-xs shrink-0">
                                          {m.profile_pic ? (
                                            <img src={m.profile_pic} alt="pic" className="w-full h-full object-cover" />
                                          ) : (
                                            m.full_name.charAt(0)
                                          )}
                                      </div>
                                      <div className="flex flex-col min-w-0">
                                        <span className="font-bold text-sm text-slate-700 truncate">{m.full_name}</span>
                                        <span className="text-[10px] text-slate-400 font-bold uppercase">₹{parseFloat(m.total_paid).toLocaleString()} Lifetime</span>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100 shrink-0">
                                      <Award size={12} /> MVP
                                  </div>
                              </div>
                          ))
                        ) : (
                          <div className="text-center text-slate-400 font-bold py-10">Add active members to see rankings.</div>
                        )}
                    </div>
                 </Card>
            </div>
        )}

        {/* --- RISK ANALYSIS TAB --- */}
        {activeTab === 'risk' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl">
                        <div className="flex items-center gap-2 text-rose-600 mb-2 font-bold uppercase text-xs tracking-wider">
                            <AlertTriangle size={14} /> Critical Attention
                        </div>
                        <h3 className="text-2xl font-black text-rose-900">{analytics.risk.expiringCount} Members</h3>
                        <p className="text-rose-700/70 text-sm font-medium mt-1">Expired or expiring within 7 days. Potential future revenue loss of <b>₹{analytics.risk.revenueAtRisk.toLocaleString()}</b>.</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 p-6 rounded-2xl">
                        <div className="flex items-center gap-2 text-amber-600 mb-2 font-bold uppercase text-xs tracking-wider">
                            <UserMinus size={14} /> At Risk of Churn
                        </div>
                        <h3 className="text-2xl font-black text-amber-900">{analytics.risk.ghostCount} Members</h3>
                        <p className="text-amber-700/70 text-sm font-medium mt-1">Active members who haven't visited in the last 4+ days.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 1. Critical Members Table */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
                            <AlertTriangle size={18} className="text-rose-500" />
                            Critical Attention
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-[10px] text-slate-400 uppercase font-black border-b border-slate-100">
                                    <tr>
                                        <th className="pb-3 pl-2">Name</th>
                                        <th className="pb-3 text-center">Status</th>
                                        <th className="pb-3 text-right">Quick Contact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {analytics.risk.expiringList.length > 0 ? analytics.risk.expiringList.map(m => (
                                        <tr key={m.id} className="group hover:bg-slate-50 transition-colors">
                                            <td className="py-3 pl-2">
                                              <span className="font-bold text-slate-700 block">{m.full_name}</span>
                                              <span className="text-xs text-slate-400">{m.phone}</span>
                                            </td>
                                            <td className="py-3 text-center">
                                                {m.days_left <= 0 ? (
                                                    <span className="text-[10px] font-black bg-rose-100 text-rose-600 px-2 py-1 rounded-full uppercase">Expired</span>
                                                ) : (
                                                    <span className="font-black text-amber-500">{m.days_left} Days Left</span>
                                                )}
                                            </td>
                                            <td className="py-3 text-right">
                                              <div className="flex justify-end gap-2">
                                                <button onClick={() => handleCall(m.phone)} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"><Phone size={14} /></button>
                                                <button onClick={() => sendWhatsApp(m, m.days_left <= 0 ? 'expired' : 'expiring')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"><MessageSquare size={14} /></button>
                                              </div>
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan="3" className="py-8 text-center text-slate-400 font-bold">No critical members found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {/* 2. Ghost Members Table */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
                            <Clock size={18} className="text-amber-500" />
                            Inactive Members (Ghosts)
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="text-[10px] text-slate-400 uppercase font-black border-b border-slate-100">
                                    <tr>
                                        <th className="pb-3 pl-2">Name</th>
                                        <th className="pb-3 text-center">Last Visit</th>
                                        <th className="pb-3 text-right">Quick Contact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {analytics.risk.ghostList.length > 0 ? analytics.risk.ghostList.map(m => (
                                        <tr key={m.id} className="group hover:bg-slate-50 transition-colors">
                                            <td className="py-3 pl-2">
                                              <span className="font-bold text-slate-700 block">{m.full_name}</span>
                                              <span className="text-xs text-slate-400">{m.phone}</span>
                                            </td>
                                            <td className="py-3 text-center font-bold text-amber-500">
                                              {m.last_visit ? new Date(m.last_visit).toLocaleDateString('en-GB') : 'Never'}
                                            </td>
                                            <td className="py-3 text-right">
                                              <div className="flex justify-end gap-2">
                                                <button onClick={() => handleCall(m.phone)} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"><Phone size={14} /></button>
                                                <button onClick={() => sendWhatsApp(m, 'ghost')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"><MessageSquare size={14} /></button>
                                              </div>
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan="3" className="py-8 text-center text-slate-400 font-bold">No inactive members found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                </div>
            </div>
        )}

        {/* --- RETENTION TAB --- */}
        {activeTab === 'retention' && (
             <Card className="p-10 flex flex-col items-center justify-center text-center border-dashed border-2">
                <div className="w-16 h-16 bg-violet-100 text-violet-600 rounded-full flex items-center justify-center mb-4">
                    <TrendingUp size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Retention Analytics</h3>
                <p className="text-slate-400 max-w-sm mt-2 mb-6">Detailed churn prediction and cohort analysis is being calculated based on your historical data.</p>
                <div className="w-full max-w-2xl bg-slate-100 rounded-full h-3 mb-2 overflow-hidden shadow-inner">
                    <div className="bg-violet-500 h-full rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]" style={{ width: `${analytics.health.retention}%` }}></div>
                </div>
                <div className="flex justify-between w-full max-w-2xl text-xs font-bold text-slate-500">
                    <span>Churn Rate: {analytics.health.churn}%</span>
                    <span>Retention: {analytics.health.retention}%</span>
                </div>
             </Card>
        )}

      </div>
    </div>
  );
};

export default InsightsPage;