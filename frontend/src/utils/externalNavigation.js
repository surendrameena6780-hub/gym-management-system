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

export const openWhatsAppConversation = ({ phone, message, countryCode = '91' }) => {
  if (typeof window === 'undefined') return false;

  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return false;

  const encodedMessage = encodeURIComponent(String(message || ''));
  const url = `https://wa.me/${countryCode}${digits}${encodedMessage ? `?text=${encodedMessage}` : ''}`;

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