// CobSci service worker: offline screen + push notifications.
// Portal pages are never cached (they hold private data); only the offline page and icons are.
const CACHE = 'cobsci-v2'
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Page loads go to the network; if there's no connection, show the offline page.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
  } else if (url.origin === self.location.origin && PRECACHE.includes(url.pathname)) {
    // The offline page's own assets: network first, cached copy when offline.
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)))
  }
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'CobSci', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'CobSci', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/app' },
    }),
  )
})

// Tapping a notification opens (or focuses) the portal on the right page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/app', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.navigate(url)
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
