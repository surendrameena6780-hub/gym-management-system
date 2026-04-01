import React from 'react';
import { Dumbbell } from 'lucide-react';

const loaderStyles = `
  @keyframes gv-loader-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes gv-loader-bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  @keyframes gv-loader-fade {
    0%, 100% { opacity: 0.22; }
    50% { opacity: 0.5; }
  }
`;

const PageLoader = ({ className = '', label = '' }) => (
  <div
    className={`flex w-full items-center justify-center rounded-[32px] border border-white/70 bg-white/82 px-4 py-6 shadow-[0_22px_50px_-34px_rgba(79,70,229,0.18)] backdrop-blur-sm ${className}`}
    style={{ minHeight: 'calc(var(--app-viewport-height) - var(--safe-area-top) - 4rem - var(--app-bottom-ui-offset) - 2rem)' }}
  >
    <style>{loaderStyles}</style>
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-8">
      <div className="relative h-28 w-28">
        <div
          className="absolute inset-[4px] rounded-full border border-black/8"
          style={{ animation: 'gv-loader-fade 1.1s ease-in-out infinite' }}
        />
        <div
          className="absolute inset-[3px] rounded-full border-[3px] border-transparent border-t-black border-r-black/68"
          style={{ animation: 'gv-loader-spin 0.84s linear infinite' }}
        />
        <div
          className="absolute inset-[18px] rounded-full border-[3px] border-transparent border-b-black/42 border-l-black/18"
          style={{ animation: 'gv-loader-spin 1.1s linear infinite reverse' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-black text-white shadow-[0_18px_36px_rgba(15,23,42,0.16)]"
            style={{ animation: 'gv-loader-bob 1s ease-in-out infinite' }}
          >
            <Dumbbell size={18} strokeWidth={2.5} />
          </div>
        </div>
      </div>
      {label ? <p className="text-sm font-semibold tracking-[0.02em] text-slate-400">{label}</p> : null}
    </div>
  </div>
);

export default PageLoader;