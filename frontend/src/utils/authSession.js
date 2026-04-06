let sessionToken = '';
let legacyTokenHydrated = false;

const LEGACY_TOKEN_STORAGE_KEY = 'token';

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch (_err) {
    return null;
  }
};

const readLegacyTokenOnce = () => {
  if (legacyTokenHydrated) {
    return '';
  }

  legacyTokenHydrated = true;

  const storage = getLocalStorage();
  if (!storage) {
    return '';
  }

  const token = String(storage.getItem(LEGACY_TOKEN_STORAGE_KEY) || '').trim();
  if (token) {
    storage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  }

  return token;
};

export const getSessionToken = () => {
  if (sessionToken) {
    return sessionToken;
  }

  sessionToken = readLegacyTokenOnce();
  return sessionToken;
};

export const setSessionToken = (token) => {
  sessionToken = String(token || '').trim();
  getLocalStorage()?.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  return sessionToken;
};

export const clearSessionToken = () => {
  sessionToken = '';
  getLocalStorage()?.removeItem(LEGACY_TOKEN_STORAGE_KEY);
};