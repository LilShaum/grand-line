/* Grand Line — service worker.
   Network-first for navigations (so new deploys reach users immediately),
   cache-first with runtime caching for everything else (offline play). */
var CACHE = "grandline-v7";
var CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  // vendored web fonts (previously Google Fonts CDN)
  "./vendor/fonts/geist-variable.woff2",
  "./vendor/fonts/instrument-serif-400-italic.woff2",
  "./vendor/fonts/instrument-serif-400-normal.woff2",
  "./vendor/fonts/special-elite-400-normal.woff2",
  "./vendor/fonts/pirata-one-400-normal.woff2",
  // vendored Tabler icons (previously jsdelivr CDN)
  "./vendor/tabler-icons/tabler-icons.min.css",
  "./vendor/tabler-icons/fonts/tabler-icons.woff2",
  "./vendor/tabler-icons/fonts/tabler-icons.woff",
  "./vendor/tabler-icons/fonts/tabler-icons.ttf",
  // ambient ocean audio (local, but must be precached for first offline use)
  "./audio/ocean.mp3",
  "./audio/ocean.ogg",
  // split app modules + stylesheet (previously inlined in index.html)
  "./style.css",
  "./js/economy.js",
  "./js/state.js",
  "./js/rewards.js",
  "./js/game.js",
  "./js/ui.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // resilient precache: a single missing file must not break install
      return Promise.all(CORE.map(function (url) {
        return c.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // Only an *update* (a prior cache existed) should prompt a reload; a
    // first-ever install must not nag.
    var hadOldCache = keys.some(function (k) { return k !== CACHE; });
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }))
      .then(function () { return self.clients.claim(); })
      .then(function () {
        if (!hadOldCache) return;
        return self.clients.matchAll().then(function (clients) {
          clients.forEach(function (c) { c.postMessage({ type: "update-available" }); });
        });
      });
  }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;

  // Navigations: network-first so the latest index.html is always served when online.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html").then(function (hit) { return hit || caches.match("./"); });
      })
    );
    return;
  }

  // Everything else (app modules, stylesheet, fonts, icons, audio):
  // stale-while-revalidate. Serve the cached copy instantly for offline speed,
  // but always kick off a background fetch to refresh the cache, so a changed
  // js/*.js or style.css can't stay stale behind a fresh index.html across a
  // deploy — the update lands on the next load.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var fetchPromise = fetch(e.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetchPromise;
    })
  );
});
