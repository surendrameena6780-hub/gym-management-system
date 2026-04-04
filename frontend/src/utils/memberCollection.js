export const roundCollectionAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const formatCollectionAmount = (value) => roundCollectionAmount(value).toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const buildUpiCollectionUri = ({ upiId, payeeName, amount, note, reference }) => {
  const normalizedUpiId = String(upiId || '').trim();
  if (!normalizedUpiId) return '';

  const params = new URLSearchParams();
  params.set('pa', normalizedUpiId);
  if (payeeName) params.set('pn', String(payeeName).trim());

  const normalizedAmount = roundCollectionAmount(amount);
  if (Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
    params.set('am', normalizedAmount.toFixed(2));
  }

  params.set('cu', 'INR');
  if (note) params.set('tn', String(note).trim());
  if (reference) params.set('tr', String(reference).trim());

  return `upi://pay?${params.toString()}`;
};

export const copyCollectionText = async (value) => {
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

export const maskCollectionContact = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return String(value || '').trim();
  const visibleTail = digits.slice(-4);
  return `••••${visibleTail}`;
};
