// Minimální service worker: umožní instalaci aplikace na plochu. Nic nekešuje,
// takže data i nová verze aplikace se vždy berou živě ze serveru.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
