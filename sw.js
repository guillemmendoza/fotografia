// Cache senzilla per als fitxers propis de l'app (HTML/CSS/JS/icones).
// Les crides a Supabase o a APIs externes sempre van directes a xarxa —
// aquí només accelerem l'arrencada evitant tornar a baixar el mateix codi.
const CACHE_NAME = 'fotografia-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './filmstocks.js',
  './calendar.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Només intervenim en fitxers propis (mateix origen). Tota la resta
  // (Supabase, Google, CDN de llibreries) va directa a xarxa sense passar per aquí.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      // Stale-while-revalidate: mostrem el que tenim en cache a l'instant
      // i, en paral·lel, actualitzem la cache per al proper cop.
      return cached || fetchPromise;
    })
  );
});
