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
        <label className="operations-branch-shell relative inline-flex w-full min-w-[132px] max-w-[8.75rem] sm:max-w-full sm:min-w-[220px]">
          <div className="operations-branch-surface pointer-events-none inline-flex w-full items-center gap-2 rounded-[18px] border px-3 py-2 text-[12px] font-bold shadow-[0_10px_28px_rgba(15,23,42,0.08)] sm:px-3.5 sm:py-2.5 sm:text-[13px]">
            <Building2 size={15} className="operations-branch-icon shrink-0" />
            <span className="operations-branch-label min-w-0 flex-1 truncate">{loading ? 'Loading branch...' : activeLabel}</span>
            {loading ? (
              <LoaderCircle size={15} className="operations-branch-caret shrink-0 animate-spin" />
            ) : (
              <ChevronDown size={15} className="operations-branch-caret shrink-0" />
            )}
          </div>
          <select
            value={branchId || options[0]?.value || ''}
            onChange={(event) => onChange(event.target.value)}
            aria-label={title}
            title={description}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-[18px] opacity-0"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      ) : (
        <div
          className="operations-branch-surface inline-flex max-w-[8.75rem] items-center gap-2 rounded-[18px] border px-3 py-2 text-[12px] font-bold shadow-[0_10px_28px_rgba(15,23,42,0.08)] sm:max-w-full sm:px-3.5 sm:py-2.5 sm:text-[13px]"
          title={loading ? 'Loading branch access...' : `Locked to ${activeLabel}`}
        >
          {loading ? <LoaderCircle size={15} className="operations-branch-caret animate-spin shrink-0" /> : <Building2 size={15} className="operations-branch-icon shrink-0" />}
          <span className="operations-branch-label max-w-[7rem] truncate sm:max-w-[10rem]">{loading ? 'Loading branch...' : activeLabel}</span>
        </div>
      )}
    </div>
  );
};

export default OperationsBranchScopeBar;