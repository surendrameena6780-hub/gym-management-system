import { apiFetch } from './apiFetch';
import { getSessionToken } from './authSession';

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

  const authToken = getSessionToken();
  if (!authToken) {
    return;
  }

  window.setTimeout(() => {
    apiFetch('/api/support/client-errors', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': authToken,
      },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, 0);
};