/*
 * The app opens without a network.
 *
 * Written by hand rather than generated. A service worker is the single most
 * dangerous thing you can add to an installed app — it sits in front of every
 * request, it outlives the page, and a bad one serves a broken build to
 * somebody who cannot clear it. So this one is built on a rule it never
 * breaks:
 *
 *   NOTHING CACHED IS EVER SERVED TO SOMEBODY WHOSE NETWORK IS WORKING.
 *
 * The cache is a fallback, not a source. Every request goes to the network
 * first and only what the network refuses to answer is served from the copy.
 * The one exception is /_next/static/immutable/, which is hashed by the build
 * and cannot change under a URL, so it is the one thing a cache cannot get
 * wrong.
 *
 * Consequences worth stating, because they are the whole safety argument:
 *
 *   A deploy is picked up on the very next load. Nothing holds an old page.
 *   A signed-out manager never sees a signed-in page. Documents are not cached.
 *   Live scores are never stale to somebody online. The network always wins.
 *
 * What it buys: the app opens in a dead zone, showing the last scores it had,
 * with the app telling you it is doing that (see OfflineBar). And on a bad
 * connection, the shell is instant because the hashed assets are local.
 */

// Bumping this drops every old cache on activate. Bump it whenever the rules
// below change, never for content — content is keyed by URL and revalidated.
const VERSION = "pylon-v1";
const ASSETS = `${VERSION}-assets`;
const DATA = `${VERSION}-data`;
const SHELL = `${VERSION}-shell`;

/** The page shown when a navigation cannot be answered at all. */
const OFFLINE = "/offline";

/**
 * The boards worth remembering: the ones a manager opens to look at rather
 * than to change something. Nothing that writes, and nothing whose staleness
 * would be dangerous rather than merely old.
 */
const REMEMBERED = [
  "/api/home",
  "/api/lineup",
  "/api/matchup",
  "/api/schedule",
  "/api/league",
  "/api/roster",
  "/api/activity",
  "/api/logos",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      // Best effort: a failed precache must not stop the worker installing,
      // or a flaky first load leaves the app with no worker at all.
      await shell.add(new Request(OFFLINE, { cache: "reload" })).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
      );
      // Take over the open pages now rather than at the next cold start, so a
      // fix ships when it is deployed and not whenever somebody force-quits.
      await self.clients.claim();
    })(),
  );
});

/** Hashed by the build, so the URL is the version. Safe to serve from disk. */
function immutable(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Icons and launch images: stable paths, and no harm if a day old. */
function artwork(url) {
  return url.pathname.startsWith("/icons/") || url.pathname.startsWith("/assets/");
}

function remembered(url) {
  return REMEMBERED.some((p) => url.pathname === p);
}

async function fromCacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function fromNetworkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    // Only a real answer is worth keeping. A 401 or a 500 cached would be
    // served back the next time the network is down, which is the one moment
    // somebody most wants the last good copy.
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Being told something while the app is shut.
 *
 * The other half of what a worker is for. Everything above is about the app
 * opening without a network; this is about the app reaching somebody who does
 * not have it open at all.
 *
 * The payload is encrypted end to end — the push service carries it and cannot
 * read it, and neither can anything until it arrives here. What comes out is
 * the object the server put in.
 */

self.addEventListener("push", (event) => {
  // A push with no data is a wake-up from a service, not from us. The
  // specification requires that a subscription made with userVisibleOnly shows
  // something for every message, so there is a fallback rather than a silent
  // return: showing nothing is what gets a site's permission revoked.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Pylon Fantasy";
  const options = {
    body: payload.body || "Something happened in your league.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge.png",
    // Grouped by kind, so four scoring updates across an afternoon replace one
    // another rather than stacking into a column of stale numbers. A recap and
    // an injury are different tags and both stand.
    tag: payload.tag || payload.kind || "pylon",
    renotify: Boolean(payload.renotify),
    timestamp: Date.now(),
    data: { href: payload.href || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const href = (event.notification.data && event.notification.data.href) || "/";
  const target = new URL(href, self.location.origin).href;

  event.waitUntil(
    (async () => {
      // A window that is already open is the one to use. Opening a second copy
      // of an installed app is how somebody ends up with four of them and the
      // one they were reading is not the one that came forward.
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of open) {
        if (client.url === target) return client.focus();
      }
      for (const client of open) {
        if ("navigate" in client) {
          await client.focus();
          return client.navigate(target);
        }
      }

      return self.clients.openWindow(target);
    })(),
  );
});

/*
 * A subscription can be rotated by the browser without anybody asking. When it
 * is, the old endpoint stops working and the app would go quiet with nothing
 * to show for it — so the new one is posted straight back.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const fresh =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe(event.oldSubscription.options));

      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fresh),
      }).catch(() => {});
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that changes something on the server is none of this worker's
  // business, and neither is another origin.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // A page. Never cached — it carries the session, and a stale one could show
  // the wrong manager's league. Only the offline page stands in for it.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.open(SHELL);
        return (
          (await shell.match(OFFLINE)) ??
          new Response("Offline.", { status: 503, headers: { "content-type": "text/plain" } })
        );
      }),
    );
    return;
  }

  if (immutable(url)) return event.respondWith(fromCacheFirst(request, ASSETS));
  if (artwork(url)) return event.respondWith(fromNetworkFirst(request, ASSETS));
  if (remembered(url)) return event.respondWith(fromNetworkFirst(request, DATA));

  // Everything else — the rest of /api, the RSC payloads — goes straight out
  // and is not remembered. Falling through without calling respondWith leaves
  // the browser to do exactly what it would have done with no worker at all.
});
