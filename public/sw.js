// EaseMyOffice CRM service worker.
//
// Pages (HTML) and API calls always go to the network, so a deploy is live on
// the next open and data is never stale. Only the content-hashed build files
// under /assets/ are cached: their names change on every deploy, so an old
// build can never be served from here. This is what makes the home-screen app /
// bookmark open quickly on a phone.
const ASSET_CACHE = "emo-assets-v1";
const MAX_ENTRIES = 250;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("emo-assets-") && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/assets/")) return;
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") {
        cache
          .put(req, res.clone())
          .then(() => trim(cache))
          .catch(() => {});
      }
      return res;
    }),
  );
});

// Tapping a notification focuses an open CRM window (or opens one) at its URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
