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
    <div className={`min-w-0 max-w-full ${className}`.trim()}>
      <span className="sr-only">{title}</span>
      {canSelect ? (
        <label className="relative block w-full max-w-full sm:w-auto sm:min-w-[220px]">
          <Building2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={branchId || options[0]?.value || ''}
            onChange={(event) => onChange(event.target.value)}
            aria-label={title}
            title={description}
            className="w-full max-w-full appearance-none rounded-2xl border border-slate-200 bg-white/90 pl-10 pr-10 py-2.5 text-sm font-black text-slate-900 shadow-sm outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
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
          className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm"
          title={loading ? 'Loading branch access...' : `Locked to ${activeLabel}`}
        >
          {loading ? <LoaderCircle size={15} className="animate-spin text-slate-400 shrink-0" /> : <Building2 size={15} className="text-slate-400 shrink-0" />}
          <span className="truncate">{loading ? 'Loading branch...' : activeLabel}</span>
        </div>
      )}
    </div>
  );
};

export default OperationsBranchScopeBar;