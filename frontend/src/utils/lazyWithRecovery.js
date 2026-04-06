import { lazy } from 'react';
import { reportClientError } from './clientErrorReporter';

const RETRY_PREFIX = 'gymvault:chunk-retry:';

const isChunkLoadError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();

  return message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
    || message.includes('css chunk load failed')
    || message.includes('unable to preload css')
    || message.includes('dynamically imported module');
};

const getRetryKey = (moduleKey) => `${RETRY_PREFIX}${moduleKey}`;

const clearAppCaches = async () => {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  const cacheKeys = await window.caches.keys();
  await Promise.all(
    cacheKeys
      .filter((key) => key.startsWith('gymvault-'))
      .map((key) => window.caches.delete(key).catch(() => false)),
  );
};

const refreshServiceWorkers = async () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
};

const triggerHardReload = async (moduleKey, error) => {
  if (typeof window === 'undefined') {
    throw error;
  }

  const retryKey = getRetryKey(moduleKey);
  const alreadyRetried = window.sessionStorage.getItem(retryKey) === '1';

  if (alreadyRetried) {
    window.sessionStorage.removeItem(retryKey);
    throw error;
  }

  window.sessionStorage.setItem(retryKey, '1');

  reportClientError(`Chunk recovery: ${moduleKey}`, error, {
    recovery: 'hard-reload',
  });

  await Promise.allSettled([
    clearAppCaches(),
    refreshServiceWorkers(),
  ]);

  window.location.reload();
  return new Promise(() => {});
};

export const lazyWithRecovery = (moduleKey, importer) => lazy(async () => {
  try {
    const module = await importer();

    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(getRetryKey(moduleKey));
    }

    return module;
  } catch (error) {
    if (!isChunkLoadError(error)) {
      throw error;
    }

    return triggerHardReload(moduleKey, error);
  }
});
