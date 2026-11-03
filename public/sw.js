// TIPOFF PWA push receiver. This caches no authenticated pages, scores, or API
// responses. Push payloads MUST contain no secret picks or personal information.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" && data.title.length < 100 ? data.title : "TIPOFF update";
  const body = typeof data.body === "string" && data.body.length < 240 ? data.body : "Open TIPOFF to see your latest rivalry updates.";
  // Do not navigate to arbitrary origins, even if the push sender is compromised.
  const requested = typeof data.url === "string" ? data.url : "/rooms";
  const url = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/rooms";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/tipoff-icon.svg",
    badge: "/tipoff-icon.svg",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 80) : undefined,
    data: { url },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url : "/rooms";
  const url = path.startsWith("/") && !path.startsWith("//") ? path : "/rooms";
  event.waitUntil((async () => {
    const tabs = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = tabs.find(tab => new URL(tab.url).origin === self.location.origin);
    if (app) { await app.focus(); if ("navigate" in app) await app.navigate(url); }
    else await clients.openWindow(url);
  })());
});
