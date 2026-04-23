/**
 * 444Music Service Worker v2
 * FIXED: bumped cache name so stale old JS is evicted on next visit
 * FIXED: /api/* paths now always go to network (never cached)
 * FIXED: Spotify API calls always go to network
 */
 
// ⚠️ INCREMENT THIS whenever you deploy JS changes — forces cache bust
const CACHE_NAME = '444music-v2.0.0';
 
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
];
 
// ─── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch((err) =>
        console.warn('[SW] Cache addAll partial failure:', err)
      )
    )
  );
  // Take over immediately — don't wait for old SW to die
  self.skipWaiting();
});
 
// ─── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
  );
  self.clients.claim();
});
 
// ─── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
 
  // ── Always go straight to network for: ──────────────────────────
  // 1. Non-GET requests (POST to /api/spotify-token etc.)
  // 2. Our own /api/* serverless functions
  // 3. Firebase / Firestore
  // 4. Spotify API and auth
  // 5. Audio streams
  const bypassSW = (
    request.method !== 'GET'                              ||
    url.pathname.startsWith('/api/')                      ||
    url.hostname.includes('firestore.googleapis.com')     ||
    url.hostname.includes('firebase')                     ||
    url.hostname.includes('googleapis.com')               ||
    url.hostname.includes('spotify.com')                  || // covers both api. and accounts.
    url.hostname.includes('p.scdn.co')                    || // Spotify CDN audio previews
    url.hostname.includes('i.scdn.co')                    || // Spotify CDN images
    request.destination === 'audio'
  );
 
  if (bypassSW) {
    // Let it go straight to network — don't touch it
    return;
  }
 
  // ── Images: cache-first with network fallback ────────────────────
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }
 
  // ── Static assets (HTML/CSS/JS/fonts): stale-while-revalidate ───
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => cached || new Response('', { status: 503 }));
 
      // Return cached immediately, update in background
      return cached || networkFetch;
    })
  );
});
 
// ─── PUSH NOTIFICATIONS (future) ─────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || '444Music', {
    body   : data.body  || 'New release available!',
    icon   : '/icons/icon-192.png',
    badge  : '/icons/icon-96.png',
    vibrate: [200, 100, 200],
    data   : { url: data.url || '/' },
  });
});
 
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
 
