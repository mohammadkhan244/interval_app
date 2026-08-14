const CACHE_NAME = 'reminders-v5';
const APP_SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.json'];

// Must match REMINDERS_SECRET env var and the value hardcoded in app.js
const API_SECRET = '103074';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(async (keys) => {
      const stale = keys.filter((k) => k !== CACHE_NAME);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Force all open tabs to reload so they pick up the new cached files
      if (stale.length) {
        const all = await self.clients.matchAll({ type: 'window' });
        all.forEach((c) => c.navigate(c.url));
      }
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'Reminder';
  const options = {
    body: data.body || '',
    tag: data.ruleId || 'reminder',
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'done', title: 'Done' },
      { action: 'snooze', title: 'Snooze' },
      { action: 'skip', title: 'Skip Today' },
    ],
    data: { ruleId: data.ruleId },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { action } = e;
  const { ruleId } = e.notification.data || {};

  if ((action === 'done' || action === 'snooze' || action === 'skip') && ruleId) {
    e.waitUntil(
      fetch('/api/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-reminders-secret': API_SECRET,
        },
        body: JSON.stringify({ ruleId, action }),
      })
        .then((res) => {
          if (!res.ok) console.error(`[SW] /api/action ${action} failed: ${res.status}`);
        })
        .catch((err) => console.error('[SW] /api/action fetch error:', err))
    );
  } else {
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then((windowClients) => {
        const existing = windowClients.find((c) => c.url === '/' && 'focus' in c);
        if (existing) return existing.focus();
        if (clients.openWindow) return clients.openWindow('/');
      })
    );
  }
});
