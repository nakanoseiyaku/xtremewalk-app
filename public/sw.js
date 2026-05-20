const STATIC_CACHE = 'xwalk-static-v1';
const WEATHER_CACHE = 'xwalk-weather-v1';

const BASE = self.location.pathname.replace(/\/sw\.js$/, '');
const STATIC_URLS = [
  BASE + '/',
  BASE + '/index.html',
];

// Install: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_URLS).catch(() => {
        // Ignore cache errors during install
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== WEATHER_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: route requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Weather API: network-first with cache fallback
  if (url.hostname === 'api.open-meteo.com') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(WEATHER_CACHE).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For same-origin requests: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Cross-origin (Claude API, etc.): network only
  event.respondWith(fetch(event.request));
});
