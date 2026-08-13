const CACHE_NAME = 'reminders-v2';
const APP_SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, action }),
      })
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
