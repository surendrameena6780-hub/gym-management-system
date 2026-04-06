import { ChevronRight } from 'lucide-react';
import useCountUp from '../utils/useCountUp';

export const DashboardAnimationStyles = () => (
  <style>{`
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    @keyframes cardCascade {
      from { opacity: 0; transform: translateY(20px) scale(0.97); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0)   scale(1);    filter: blur(0); }
    }
    @keyframes heroPulse {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.05); }
    }
  `}</style>
);

export const Card = ({ children, className = '', style = {} }) => (
  <div
    className={`bg-white/80 backdrop-blur-sm rounded-[24px] border border-white/60 shadow-[0_2px_20px_rgba(99,102,241,0.06)] hover:shadow-[0_6px_30px_rgba(99,102,241,0.1)] transition-all duration-300 ${className}`}
    style={style}
  >
    {children}
  </div>
);

export const KPICard = (props) => {
  const { title, value, iconGradient, index = 0, onClick, tag } = props;
  const strVal = String(value ?? '');
  const prefix = strVal.startsWith('₹') ? '₹' : '';
  const suffix = strVal.endsWith('%') ? '%' : '';
  const rawNum = Number.parseFloat(strVal.replace(/[₹%,]/g, ''));
  const isNumeric = !Number.isNaN(rawNum);
  const animated = useCountUp(isNumeric ? rawNum : 0);
  const displayVal = isNumeric
    ? `${prefix}${animated.toLocaleString()}${suffix}`
    : strVal;

  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden bg-white/85 backdrop-blur-sm rounded-[20px] sm:rounded-[24px] border border-white/60 p-4 sm:p-5 flex flex-col justify-between shadow-[0_2px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_10px_36px_rgba(0,0,0,0.09)] hover:-translate-y-1 transition-all duration-300 ${onClick ? 'cursor-pointer' : ''}`}
      style={{ opacity: 0, animation: `cardCascade 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 75}ms forwards` }}
    >
      <div
        className="absolute -right-4 -bottom-4 w-20 h-20 sm:w-28 sm:h-28 rounded-full opacity-[0.045] group-hover:opacity-[0.09] group-hover:scale-125 transition-all duration-700"
        style={{ background: iconGradient }}
      />
      <div className="flex items-start justify-between relative z-10">
        <div
          className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center text-white shadow-lg"
          style={{ background: iconGradient, boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }}
        >
          <props.icon size={17} strokeWidth={2} />
        </div>
        {onClick && (
          <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-indigo-50 flex items-center justify-center transition-colors duration-200 mt-0.5">
            <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-400 transition-colors duration-200" />
          </div>
        )}
      </div>
      <div className="relative z-10 mt-2.5 sm:mt-3">
        {tag && (
          <span className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-500 mb-1.5">{tag}</span>
        )}
        <h3 className="text-[23px] sm:text-[26px] font-black text-slate-900 tracking-tight leading-none">{displayVal}</h3>
        <p className="text-slate-400 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mt-1.5">{title}</p>
      </div>
    </div>
  );
};

export const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-slate-900 text-white px-3.5 py-2.5 rounded-xl shadow-2xl text-xs font-bold">
      <p className="text-slate-400 mb-0.5">{label}</p>
      <p className="text-white text-sm">₹{Number(payload[0]?.value || 0).toLocaleString()}</p>
    </div>
  );
};