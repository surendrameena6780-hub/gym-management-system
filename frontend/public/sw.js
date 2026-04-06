const CACHE_NAME = 'gymvault-v5';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/gymvault-app-icon-32.png',
  '/gymvault-app-icon-64.png',
  '/gymvault-app-icon-180.png',
  '/gymvault-app-icon-192.png',
  '/gymvault-app-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Never cache API calls — always fetch fresh data from the server
  if (event.request.url.includes('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_err) { data = {}; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'GymVault', {
      body: data.body || '',
      icon: data.icon || '/gymvault-app-icon-192.png',
      badge: data.badge || '/gymvault-app-icon-64.png',
      tag: data.tag || 'gymvault-push',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const existing = windowClients.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
