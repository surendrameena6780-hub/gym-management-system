import React from 'react';
import { Building2 } from 'lucide-react';
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
    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm">
      <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            <Building2 size={13} />
            <span>{title}</span>
          </div>
          <p className="mt-1 truncate text-sm font-black text-slate-900">
            {loading ? 'Loading branch access...' : activeLabel}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {canSelect ? description : `This account is locked to ${activeLabel}.`}
          </p>
        </div>

        {canSelect ? (
          <label className="block desktop:min-w-[240px]">
            <span className="sr-only">Select branch scope</span>
            <select
              value={branchId || options[0]?.value || ''}
              onChange={(event) => onChange(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 desktop:min-w-[220px]">
            {activeLabel}
          </div>
        )}
      </div>
    </div>
  );
};

export default OperationsBranchScopeBar;