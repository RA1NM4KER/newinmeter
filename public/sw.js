const VERSION = "v5";
const SHELL_CACHE = `ledger-shell-${VERSION}`;
const PAGE_CACHE = `ledger-pages-${VERSION}`;
const DATA_CACHE = `ledger-data-${VERSION}`;
const STATIC_CACHE = `ledger-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const SHELL_URLS = ["/", "/data", OFFLINE_URL, "/manifest.webmanifest", "/icon"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![SHELL_CACHE, PAGE_CACHE, DATA_CACHE, STATIC_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js")
  ) {
    event.respondWith(cacheFirstStatic(request));
  }
});

// Web Push handler. iOS requires every push to show a user-visible
// notification (silent push is rejected), so we always call showNotification.
// Alongside it we set the Home Screen badge from the worker -- this is what
// makes the badge update while the app is closed, which the in-page
// DataSyncAction can't do.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "NewinMeter";
  const body = payload.body || "Your usage data looks stale. Open the app to sync.";
  const url = payload.url || "/";
  // Per-type tag so e.g. a low-balance push and a daily-spend push don't
  // silently collapse into one notification (same tag = the OS replaces the
  // old one). Falls back to the original shared tag for any payload that
  // doesn't specify one, preserving the existing stale-data push behaviour.
  const tag = payload.tag || "newinmeter-stale-data";

  event.waitUntil(
    (async () => {
      // Pass an explicit count: iOS has no indeterminate badge and renders
      // nothing for a no-arg setAppBadge(), unlike desktop which shows a dot.
      if ("setAppBadge" in self.navigator) {
        await self.navigator.setAppBadge(1).catch(() => undefined);
      }

      await self.registration.showNotification(title, {
        body,
        icon: "/icon",
        badge: "/icon",
        // Collapses repeats of the SAME alert onto one notification instead
        // of stacking, without swallowing a different simultaneous alert.
        tag,
        data: { url }
      });
    })()
  );
});

// Focus an existing app window if one is open, otherwise open the target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of allClients) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => undefined);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })()
  );
});

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    const shellCache = await caches.open(SHELL_CACHE);
    return shellCache.match(OFFLINE_URL) || Response.error();
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    return new Response(JSON.stringify({ message: "Offline. No cached data is available yet." }), {
      status: 503,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}
