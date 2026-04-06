import { buildApiUrl } from './apiUrl';
import { getSessionToken } from './authSession';

const normalizeHeaders = (headers) => {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers && typeof headers === 'object' ? { ...headers } : {};
};

const hasAuthHeader = (headers) => Object.keys(headers).some((key) => {
  const normalizedKey = String(key || '').trim().toLowerCase();
  return normalizedKey === 'x-auth-token' || normalizedKey === 'authorization';
});

export const apiFetch = (path, options = {}) => {
  const {
    headers: rawHeaders,
    skipAuth = false,
    credentials = 'include',
    ...rest
  } = options;

  const headers = normalizeHeaders(rawHeaders);
  const sessionToken = getSessionToken();

  if (!skipAuth && sessionToken && !hasAuthHeader(headers)) {
    headers['x-auth-token'] = sessionToken;
  }

  return globalThis.fetch(buildApiUrl(path), {
    credentials,
    ...rest,
    headers,
  });
};

export default apiFetch;