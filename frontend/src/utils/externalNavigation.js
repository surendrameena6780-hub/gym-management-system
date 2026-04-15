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

const normalizeWhatsAppTarget = (phone, countryCode = '91') => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  const normalizedCountryCode = String(countryCode || '').replace(/\D/g, '');
  if (!normalizedCountryCode) return digits;
  if (digits.length === 10) return `${normalizedCountryCode}${digits}`;
  if (digits.startsWith(normalizedCountryCode)) return digits;
  return digits;
};

export const buildWhatsAppConversationUrl = ({ phone, message, countryCode = '91' }) => {
  const target = normalizeWhatsAppTarget(phone, countryCode);
  if (!target) return '';

  const encodedMessage = encodeURIComponent(String(message || ''));
  return `https://wa.me/${target}${encodedMessage ? `?text=${encodedMessage}` : ''}`;
};

export const openWhatsAppConversation = ({ phone, message, countryCode = '91' }) => {
  if (typeof window === 'undefined') return false;

  const url = buildWhatsAppConversationUrl({ phone, message, countryCode });
  if (!url) return false;

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