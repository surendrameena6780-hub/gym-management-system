export const roundCollectionAmount = (value) => Math.round((Number(value) || 0) * 100) / 100;

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

export const describeCollectionLinkDelivery = (paymentLink) => {
  const maskedContact = paymentLink?.customer_contact ? maskCollectionContact(paymentLink.customer_contact) : '';
  const email = String(paymentLink?.customer_email || '').trim();

  if (paymentLink?.notify?.sms && maskedContact) {
    return {
      message: `A Razorpay payment link has been sent to ${maskedContact}. Keep this screen open or let the member scan the QR.`,
      label: `Razorpay SMS to ${maskedContact}`,
    };
  }

  if (paymentLink?.notify?.email && email) {
    return {
      message: `A payment link has been sent to ${email}. Keep this screen open or let the member scan the QR.`,
      label: `Email to ${email}`,
    };
  }

  return {
    message: 'No member phone or email is saved, so show this QR or copy the payment link manually.',
    label: 'Manual share required',
  };
};

export const openCollectionLink = (value) => {
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
