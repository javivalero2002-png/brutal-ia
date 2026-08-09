/* ─── BRUTAL.IA Service Worker ─────────────────────────────────────────────
 * Funciones:
 *  1) Caché de shell estática → app arranca offline y no muestra pantalla blanca
 *  2) Estrategia de fetch: Cache-first para assets estáticos (_next/static),
 *     Network-first para páginas y fallback a caché si no hay red.
 *  3) Push notifications (notificaciones del sistema)
 * ─────────────────────────────────────────────────────────────────────────── */

const CACHE = 'brutalstudios-v3'

// Shell mínima que se precachea al instalar el SW
const SHELL = [
  '/dashboard',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/manifest.json',
]

// ── Instalación: precachea la shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {})) // no bloquea si algún asset falla
      .then(() => self.skipWaiting())
  )
})

// ── Activación: elimina cachés antiguas ───────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch: estrategia por tipo de recurso ────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Solo interceptar GET del mismo origen
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // API routes → siempre red (datos en tiempo real, nunca cachear)
  if (url.pathname.startsWith('/api/')) return
  // HMR de desarrollo → ignorar
  if (url.pathname.includes('webpack-hmr')) return
  // Rutas de auth → siempre red
  if (url.pathname.startsWith('/login') || url.pathname.startsWith('/auth')) return

  // Assets estáticos de Next.js (_next/static) → Cache-first (tienen hash inmutable)
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()))
          }
          return res
        })
      })
    )
    return
  }

  // Páginas e iconos → Network-first con fallback a caché
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
        }
        return res
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || new Response('Sin conexión', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        )
      )
  )
})

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }

  const actions = data.actions || [
    { action: 'open', title: 'Ver ahora' },
    { action: 'dismiss', title: 'Descartar' },
  ]

  e.waitUntil(
    self.registration.showNotification(data.title || 'BRUTAL.IA', {
      body: data.body || '',
      icon: '/icon-512.png',
      badge: '/icon-192.png',
      image: data.image || undefined,
      tag: data.tag || 'brutalstudios-default',
      data: { url: data.url || '/dashboard' },
      actions,
      requireInteraction: !!data.urgent,
      renotify: !!data.tag,
      silent: false,
      timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
      vibrate: data.urgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  if (e.action === 'dismiss') return

  const url = (e.notification.data && e.notification.data.url) || '/dashboard'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.navigate(url)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})

self.addEventListener('notificationclose', () => {
  // Notificación cerrada sin interacción — sin acción
})
