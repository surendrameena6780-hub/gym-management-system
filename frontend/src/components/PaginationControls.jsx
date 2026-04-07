import React from 'react';

const PaginationControls = ({ pagination, onPageChange, itemLabel = 'items', className = '' }) => {
  if (!pagination) {
    return null;
  }

  const page = Number(pagination.page || 1);
  const limit = Number(pagination.limit || 30);
  const total = Number(pagination.total || 0);
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  const hasPrev = Boolean(pagination.hasPrev) || page > 1;
  const hasNext = Boolean(pagination.hasNext) || page < totalPages;
  const start = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const end = total === 0 ? 0 : Math.min(total, page * limit);

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}>
      <div className="text-xs font-bold text-slate-500">
        Showing <span className="text-slate-900">{start}-{end}</span> of <span className="text-slate-900">{total}</span> {itemLabel}
      </div>

      <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange?.(page - 1)}
            disabled={!hasPrev}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-slate-600 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <div className="min-w-[88px] text-center text-xs font-black text-slate-700">
            Page {page} / {totalPages}
          </div>
          <button
            type="button"
            onClick={() => onPageChange?.(page + 1)}
            disabled={!hasNext}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-slate-600 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
    </div>
  );
};

export default PaginationControls;