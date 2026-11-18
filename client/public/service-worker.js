// Necessário para o navegador oferecer "Instalar aplicativo". Não guarda nada em cache: a rede continua sendo usada normalmente.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  const raw = event.data ? event.data.text() : '';
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { body: raw };
  }
  const title = payload.title || 'Novo aviso';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/',
    badge: payload.icon || '/',
    tag: payload.tag || 'portfolio-notice',
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(url);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});
