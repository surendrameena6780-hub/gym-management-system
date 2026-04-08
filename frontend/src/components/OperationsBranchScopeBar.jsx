import React from 'react';
import { Building2, ChevronDown, LoaderCircle } from 'lucide-react';
import { buildBranchOptions, getBranchLabel, normalizeBranchDirectory } from '../utils/branchScope';

const OperationsBranchScopeBar = ({
  branchDirectory = [],
  branchId = '',
  onChange,
  currentUser = null,
  loading = false,
  title = 'Operational scope',
  description = 'Filter this page by branch. Owners can switch views without leaving the workflow.',
  allLabel = 'All branches',
  className = '',
}) => {
  const normalizedBranchDirectory = normalizeBranchDirectory(branchDirectory);
  const isOwner = String(currentUser?.role || '').toUpperCase() === 'OWNER';
  const canSelect = isOwner && normalizedBranchDirectory.length > 1 && typeof onChange === 'function';
  const activeLabel = getBranchLabel(normalizedBranchDirectory, branchId, { allLabel });
  const options = buildBranchOptions(normalizedBranchDirectory, {
    includeAll: isOwner,
    allLabel,
  });

  return (
    <div className={`inline-flex min-w-0 max-w-full justify-end ${className}`.trim()}>
      <span className="sr-only">{title}</span>
      {canSelect ? (
        <label className="relative inline-flex w-full min-w-[132px] max-w-[8.75rem] sm:max-w-full sm:min-w-[220px]">
          <Building2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={branchId || options[0]?.value || ''}
            onChange={(event) => onChange(event.target.value)}
            aria-label={title}
            title={description}
            className="w-full appearance-none rounded-[18px] border border-slate-200/90 bg-white/92 pl-9 pr-9 py-2 text-[12px] font-bold text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.08)] outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 sm:pl-10 sm:pr-10 sm:py-2.5 sm:text-[13px]"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {loading ? (
            <LoaderCircle size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
          ) : (
            <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          )}
        </label>
      ) : (
        <div
          className="inline-flex max-w-[8.75rem] items-center gap-2 rounded-[18px] border border-slate-200/90 bg-white/92 px-3 py-2 text-[12px] font-bold text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.08)] sm:max-w-full sm:px-3.5 sm:py-2.5 sm:text-[13px]"
          title={loading ? 'Loading branch access...' : `Locked to ${activeLabel}`}
        >
          {loading ? <LoaderCircle size={15} className="animate-spin text-slate-400 shrink-0" /> : <Building2 size={15} className="text-slate-400 shrink-0" />}
          <span className="max-w-[7rem] truncate sm:max-w-[10rem]">{loading ? 'Loading branch...' : activeLabel}</span>
        </div>
      )}
    </div>
  );
};

export default OperationsBranchScopeBar;