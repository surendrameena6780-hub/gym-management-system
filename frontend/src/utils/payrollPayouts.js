const roundPayrollAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

const isStandaloneMode = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator?.standalone === true
  );
};

const shouldLaunchInSameContext = () => {
  if (typeof window === 'undefined') return false;
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase();
  return isStandaloneMode() || /iphone|ipad|ipod|android/.test(userAgent);
};

export const buildPayrollUpiUri = ({ upiId, payeeName, amount, note, reference }) => {
  const normalizedUpiId = String(upiId || '').trim();
  if (!normalizedUpiId) return '';

  const params = new URLSearchParams();
  params.set('pa', normalizedUpiId);
  if (payeeName) params.set('pn', String(payeeName).trim());

  const normalizedAmount = roundPayrollAmount(amount);
  if (Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
    params.set('am', normalizedAmount.toFixed(2));
  }

  params.set('cu', 'INR');
  if (note) params.set('tn', String(note).trim());
  if (reference) params.set('tr', String(reference).trim());

  return `upi://pay?${params.toString()}`;
};

export const copyPayrollText = async (value) => {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(normalizedValue);
    return true;
  } catch (_err) {
    return false;
  }
};

export const openPayrollUpiIntent = (value) => {
  const url = String(value || '').trim();
  if (!url || typeof window === 'undefined') {
    return false;
  }

  if (shouldLaunchInSameContext()) {
    window.location.assign(url);
    return true;
  }

  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.location.assign(url);
  }

  return true;
};

export const buildPayrollPayoutReference = (payrollId) => {
  const numericId = Number.parseInt(payrollId, 10);
  const safeId = Number.isInteger(numericId) && numericId > 0 ? numericId : 'X';
  return `UPI-${safeId}-${Date.now().toString(36).toUpperCase()}`;
};
