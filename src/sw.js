// Service worker template. The build fills in the build id and file list (see vite.config.ts),
// so every deploy changes this file and the browser installs the new version.
const CACHE = "corotena-" + __BUILD_ID__;
const PRECACHE = __PRECACHE__;
// On a weak signal, don't keep the user waiting for the network before showing the saved copy.
const NETWORK_TIMEOUT_MS = 3000;
// One entry per URL; servers send `Vary: Origin` / `Vary: Accept-Encoding`, which would otherwise make
// a module script (sent with an Origin header) miss the copy stored at install time.
const MATCH = { ignoreVary: true };

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // `reload` skips the HTTP cache, which GitHub Pages keeps for 10 minutes.
    await cache.addAll(PRECACHE.map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("corotena-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** Pages are stored without their query string (?v=… is only there to dodge the HTTP cache). */
const pageKey = url => {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.href;
};

async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(new Request(request.url, { cache: "no-cache", credentials: "same-origin" })).then(res => {
    if (res.ok) void cache.put(pageKey(request.url), res.clone());
    return res;
  });
  network.catch(() => {});
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    const saved = await cache.match(pageKey(request.url), MATCH)
      ?? await cache.match(new URL("./", self.registration.scope).href, MATCH);
    return saved ?? network;
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, MATCH);
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") void cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // The update check must always hit the network.
  if (url.pathname.endsWith("/version.json")) return;
  event.respondWith(request.mode === "navigate" ? page(request) : asset(request));
});
