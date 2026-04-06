const normalizeErrorPayload = (scope, error, extra) => ({
  scope,
  message: error?.message || String(error || 'Unknown client error'),
  stack: typeof error?.stack === 'string' ? error.stack : '',
  page: typeof window !== 'undefined' ? window.location.pathname : '',
  extra: extra && typeof extra === 'object' ? extra : extra ? { value: extra } : null,
});

export const reportClientError = (scope, error, extra = null) => {
  const payload = normalizeErrorPayload(scope, error, extra);

  if (import.meta.env.DEV) {
    if (extra) {
      console.warn(`[${scope}] ${payload.message}`, extra);
      return;
    }
    console.warn(`[${scope}] ${payload.message}`);
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return;
  }

  window.setTimeout(() => {
    fetch('/api/support/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, 0);
};