// Service worker: shows a system notification when the server pushes a guest arrival,
// even if the page is closed and the phone is locked.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'A guest has arrived' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'A guest has arrived', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true,
    icon: '/icon-192.png',
    vibrate: [250, 120, 250, 120, 400],
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => new URL(w.url).pathname === '/rep.html');
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
