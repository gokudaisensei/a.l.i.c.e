/* Alice's service worker: shows the notifications Alice sends, and opens the app when one is tapped. */
self.addEventListener("push", (event) => {
  let p = { title: "Alice", body: "", data: {} };
  try { p = { ...p, ...event.data.json() }; } catch { /* a plain message */ }
  event.waitUntil(self.registration.showNotification(p.title, { body: p.body, data: p.data, icon: "/favicon.ico", tag: p.data && p.data.alertId ? p.data.alertId : undefined }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("/");
  })());
});
