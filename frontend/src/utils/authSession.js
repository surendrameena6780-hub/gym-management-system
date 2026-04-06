let sessionToken = '';
let legacyTokenHydrated = false;

const AUTH_TOKEN_STORAGE_KEY = 'gv_auth_token';
const LEGACY_TOKEN_STORAGE_KEY = 'token';

const getLocalStorage = () => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch (_err) {
    return null;
  }
};

const readStorageValue = (storage, key) => {
  try {
    return String(storage?.getItem(key) || '').trim();
  } catch (_err) {
    return '';
  }
};

const writeStorageValue = (storage, key, value) => {
  try {
    if (value) {
      storage?.setItem(key, value);
    } else {
      storage?.removeItem(key);
    }
  } catch (_err) {
    // Ignore storage write failures and keep the in-memory token alive.
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

  const persistedToken = readStorageValue(storage, AUTH_TOKEN_STORAGE_KEY);
  if (persistedToken) {
    writeStorageValue(storage, LEGACY_TOKEN_STORAGE_KEY, '');
    return persistedToken;
  }

  const token = readStorageValue(storage, LEGACY_TOKEN_STORAGE_KEY);
  if (token) {
    writeStorageValue(storage, AUTH_TOKEN_STORAGE_KEY, token);
    writeStorageValue(storage, LEGACY_TOKEN_STORAGE_KEY, '');
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
  const storage = getLocalStorage();
  writeStorageValue(storage, AUTH_TOKEN_STORAGE_KEY, sessionToken);
  writeStorageValue(storage, LEGACY_TOKEN_STORAGE_KEY, '');
  return sessionToken;
};

export const clearSessionToken = () => {
  sessionToken = '';
  const storage = getLocalStorage();
  writeStorageValue(storage, AUTH_TOKEN_STORAGE_KEY, '');
  writeStorageValue(storage, LEGACY_TOKEN_STORAGE_KEY, '');
};