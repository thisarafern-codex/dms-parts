/* Service worker — makes the app work with no signal at all.

   Shell files are cached on install and served cache-first, so the app opens
   instantly in a parts shop with no reception. seed/models.json is fetched
   network-first (it changes when the invoicing app gains machines) but falls
   straight back to cache when offline. Everything dad types lives in
   IndexedDB, which this file never touches. */

var VERSION = 'dms-parts-v1';
var SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/db.js',
  'js/seed.js',
  'js/backup.js',
  'js/ui.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'seed/models.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // addAll fails the whole install if any single file 404s; add them
      // individually so one missing icon can't leave the app uninstallable.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('sw: could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The seed can change; prefer a fresh copy but never block on the network.
  if (url.pathname.indexOf('seed/') !== -1) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // Refresh in the background so the next open is current.
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(VERSION).then(function (c) { c.put(req, res); });
          }
        }).catch(function () {});
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // A navigation with nothing cached still gets the app shell.
        if (req.mode === 'navigate') return caches.match('index.html');
        throw new Error('offline and not cached');
      });
    })
  );
});
