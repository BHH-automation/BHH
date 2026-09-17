/*
  British Heritage Hosts Ltd, service worker
  Author: Faleh al Bishi, Director, British Heritage Hosts Ltd
  Created: 18 September 2026

  Deliberately conservative. Pages are always fetched from the network first, so a
  freshly deployed change is never hidden behind a cached copy. The cache holds only
  the offline notice and the icons, and is used only when the network fails.
*/

const CACHE = "bhh shell v1";
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/appletouchicon.png", "/icon512.png", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
