// Learning OS service worker: shows reminders, and caches the app shell so the app opens instantly.
// API responses are never cached (answers must reach the server).
const SHELL = 'shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()),
))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // Hashed build assets never change: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(SHELL).then(async c => (await c.match(e.request)) ?? fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r })))
    return
  }
  // Pages: network-first (so deploys and sign-in redirects win), cached shell only when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') caches.open(SHELL).then(c => c.put('/', r.clone()))
      return r
    }).catch(() => caches.match('/')))
  }
})

self.addEventListener('push', e => {
  let n = { title: 'Learning OS', body: '', url: '/', tag: 'learning-os' }
  try { n = { ...n, ...e.data.json() } } catch { /* plain or empty payload */ }
  e.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = new URL(e.notification.data?.url ?? '/', location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
    const open = wins.find(w => new URL(w.url).origin === location.origin)
    if (open) return open.focus().then(w => w.navigate(target))
    return self.clients.openWindow(target)
  }))
})
