const CACHE_NAME = 'elegoo-cc2-cost-v4';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/kit_card_winter_house_plate.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { credentials: 'same-origin' }).then((res) => {
            if (res.ok && res.type === 'basic') {
              return cache.put(url, res);
            }
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Top-level navigation (opening the Desktop app window)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkRes = await fetch(event.request);
          // Only use and cache clean 200 responses (avoids opaqueredirect or 502/503 when container sleeps)
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            cache.put('/', networkRes.clone());
            return networkRes;
          }
        } catch {
          // Network offline or dev server asleep — fall through to local cache
        }
        const cachedRoot = (await cache.match('/')) || (await cache.match('/index.html'));
        if (cachedRoot) return cachedRoot;
        return fetch(event.request);
      })()
    );
    return;
  }

  // 2. Same-origin scripts, styles, fonts, and images: Network-first with automatic local cache fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const networkRes = await fetch(event.request);
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          cache.put(event.request, networkRes.clone());
          return networkRes;
        }
      } catch {
        // Dev server asleep or offline — serve from local cache
      }
      const cached = await cache.match(event.request, { ignoreSearch: false }) ||
                     await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return fetch(event.request);
    })()
  );
});
