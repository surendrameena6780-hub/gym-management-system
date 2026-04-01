import React from 'react';
import { Dumbbell } from 'lucide-react';

const loaderStyles = `
  @keyframes gv-loader-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes gv-loader-bob {
    0%, 100% { transform: translateY(0) rotate(-10deg); }
    50% { transform: translateY(-5px) rotate(8deg); }
  }

  @keyframes gv-loader-fade {
    0%, 100% { opacity: 0.22; }
    50% { opacity: 0.5; }
  }
`;

const PageLoader = ({ className = '', label = '' }) => (
  <div className={`flex min-h-[52vh] w-full items-center justify-center rounded-[28px] bg-white/96 ${className}`}>
    <style>{loaderStyles}</style>
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-8">
      <div className="relative h-24 w-24">
        <div
          className="absolute inset-0 rounded-full border border-black/8"
          style={{ animation: 'gv-loader-fade 1.1s ease-in-out infinite' }}
        />
        <div
          className="absolute inset-[7px] rounded-full border-[2px] border-transparent border-t-black border-r-black/60"
          style={{ animation: 'gv-loader-spin 0.72s linear infinite' }}
        />
        <div
          className="absolute inset-[16px] rounded-full border-[2px] border-transparent border-b-black/55 border-l-black/25"
          style={{ animation: 'gv-loader-spin 1s linear infinite reverse' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-black text-white shadow-[0_18px_36px_rgba(15,23,42,0.14)]"
            style={{ animation: 'gv-loader-bob 1s ease-in-out infinite' }}
          >
            <Dumbbell size={20} strokeWidth={2.4} />
          </div>
        </div>
      </div>
      {label ? <p className="text-sm font-semibold tracking-[0.02em] text-slate-400">{label}</p> : null}
    </div>
  </div>
);

export default PageLoader;