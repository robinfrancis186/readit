/*
 * Readit service worker.
 *
 * Its job is to make the installed app open instantly and survive a dropped
 * connection — not to cache your library. Deliberate choices:
 *
 * - Navigations are network-first with a cached shell as fallback, so a rebuild
 *   is picked up on the next load rather than being pinned to a stale bundle.
 * - Hashed build assets are cache-first; their names change when they change.
 * - /api/ is never cached. Your notes and library must never be served stale,
 *   and book files are far too large to hold in the cache storage quota.
 */
const VERSION = 'readit-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

/**
 * The bundle filenames are content-hashed, so they cannot be listed here.
 * Read them out of index.html at install time instead — otherwise they are
 * only cached on the *second* visit (the worker is not yet controlling the
 * page during the first one) and the first offline load renders blank.
 */
async function precacheBundle() {
  const res = await fetch('/index.html', { cache: 'reload' });
  if (!res.ok) return;
  const html = await res.text();
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const cache = await caches.open(ASSETS);
  await Promise.all(urls.map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // addAll fails the whole install if any single URL 404s, so add
      // individually and tolerate misses.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => precacheBundle().catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html', { ignoreVary: true }).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      // ignoreVary: a cached asset must match regardless of whether the
      // request carried an Origin header (a <script crossorigin> does, the
      // worker's own cache.add does not).
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
