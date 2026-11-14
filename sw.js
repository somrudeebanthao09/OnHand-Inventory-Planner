self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      payload = { title: 'Material Planner', body: event.data ? event.data.text() : 'มีการอัปเดตใบเบิก Part' };
    } catch (__) {}
  }
  const title = payload.title || '🔔 แจ้งเตือนเบิก-จ่าย Part';
  const options = {
    body: payload.body || 'มีการอัปเดตรายการใหม่ในระบบ',
    icon: payload.icon || './icon.svg',
    badge: payload.badge || './icon.svg',
    tag: payload.tag || ('part-req-' + (payload.reqId || Date.now())),
    renotify: true,
    requireInteraction: true,
    vibrate: [250, 120, 250, 120, 350],
    data: {
      url: payload.url || './',
      reqId: payload.reqId || '',
      kind: payload.kind || ''
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        try {
          if (targetUrl && targetUrl !== './') client.postMessage({ type: 'OPEN_PART_REQ_PAGE', url: targetUrl });
        } catch (_) {}
        return;
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
