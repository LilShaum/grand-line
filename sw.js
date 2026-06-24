/* Grand Line — service worker. Stale-while-revalidate with update notification. */
var CACHE = "grandline-v4";
var CORE = ["./", "./index.html", "./manifest.json", "./icon.svg"];
var updateNotified = false;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (url) { return c.add(url).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(e.request).then(function (cached) {
        var fetchPromise = fetch(e.request).then(function (networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
            if (!updateNotified) {
              updateNotified = true;
              notifyClients("update-available");
            }
          }
          return networkResponse;
        }).catch(function () {
          return cached;
        });

        return cached || fetchPromise;
      });
    })
  );
});

function notifyClients(type) {
  self.clients.matchAll().then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: type });
    });
  });
}

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "skip-waiting") {
    self.skipWaiting();
  }
});
