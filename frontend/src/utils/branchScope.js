export const ALL_BRANCHES_VALUE = 'all';
export const DEFAULT_BRANCH_ID = 'branch-1';

const normalizeBranchId = (value) => String(value || '').trim().toLowerCase();

export const normalizeBranchDirectory = (branchDirectory) => {
  if (!Array.isArray(branchDirectory)) {
    return [];
  }

  const seenIds = new Set();

  return branchDirectory.reduce((items, branch, index) => {
    const id = normalizeBranchId(branch?.id || `branch-${index + 1}`) || `branch-${index + 1}`;
    if (seenIds.has(id)) {
      return items;
    }

    seenIds.add(id);
    items.push({
      id,
      name: String(branch?.name || '').trim() || (index === 0 ? 'Main Branch' : `Branch ${index + 1}`),
      address: String(branch?.address || '').trim(),
      phone: String(branch?.phone || '').trim(),
    });
    return items;
  }, []);
};

export const getDefaultBranchId = (branchDirectory) => normalizeBranchDirectory(branchDirectory)[0]?.id || DEFAULT_BRANCH_ID;

export const getScopedBranchId = (branchId) => {
  const normalized = normalizeBranchId(branchId);
  if (!normalized || normalized === ALL_BRANCHES_VALUE) {
    return '';
  }
  return normalized;
};

export const getBranchRequestValue = (branchId) => getScopedBranchId(branchId) || undefined;

export const getBranchLabel = (branchDirectory, branchId, { allLabel = 'All branches' } = {}) => {
  const scopedBranchId = getScopedBranchId(branchId);
  if (!scopedBranchId) {
    return allLabel;
  }

  const match = normalizeBranchDirectory(branchDirectory).find((branch) => branch.id === scopedBranchId);
  return match?.name || 'Assigned branch';
};

export const buildBranchOptions = (branchDirectory, { includeAll = true, allLabel = 'All branches' } = {}) => {
  const options = normalizeBranchDirectory(branchDirectory).map((branch) => ({
    value: branch.id,
    label: branch.name,
  }));

  if (!includeAll) {
    return options;
  }

  return [{ value: ALL_BRANCHES_VALUE, label: allLabel }, ...options];
};