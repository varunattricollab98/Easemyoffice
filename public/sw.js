// EaseMyOffice CRM service worker.
//
// Deliberately does NOT cache anything: the CRM is live data, and a caching
// worker is the classic way to keep serving an old build after a deploy. It
// exists so the app is installable as a home-screen app and so push
// notifications can be added on top of it later.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
