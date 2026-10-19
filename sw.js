// ── Service worker: an offline copy of Campaign Chronicle ───────────────────
// Online, everything comes from the network first — a newly published session shows up on the
// next load, exactly as without this file — and every good response refreshes the offline copy.
// Offline (or on a connection that does not answer in time), the last copy is served instead and
// marked with the "x-chronicle-offline: 1" header, so the page can say it is showing a saved copy.
//
//   • App shell, data/*.json and translations: precached on install, then network first. The Taller del
//     Cronista's scripts are not precached (visitors never use them): network first stores them on their first
//     use online, so the Taller opens offline afterwards. Its drafts live in IndexedDB, never in these caches.
//   • Small images (portraits, icons, the page textures, the 2400px map preview): stale-while-revalidate.
//   • React from unpkg and Google Fonts: cache first (versioned / immutable URLs).
//   • assets/exandria-map.jpeg (the 15 MB full-resolution map) is NEVER stored: it stays network-only.
//
// Favourites, history and preferences live in localStorage — never in these caches — so updates,
// cache clean-ups and new versions never touch them. Bump VERSION when the precache list changes
// (adding a file); old caches are deleted when the new worker activates.
const VERSION = "2026-10-18.1";
const SHELL = `chronicle-shell-${VERSION}`;
const RUNTIME = `chronicle-runtime-${VERSION}`;

const PRECACHE = [
  "./", "index.html", "support.js", "manifest.webmanifest",
  "js/chronicle-model.js", "js/chronicle-map.js", "js/chronicle-library.js", "js/chronicle-tour.js", "js/i18n.js",
  "vendor/driver.js/driver.js.iife.js", "vendor/driver.js/driver.css",
  "locales/en.js", "locales/es-AR.js",
  "data/characters.json", "data/routes.json", "data/events.json", "data/sessions.json", "data/quests.json",
  "data/npcs.json", "data/locations.json", "data/lore.json", "data/i18n/es-AR.json",
  "assets/app-icon.svg", "assets/app-icon-192.png", "assets/icon-bund-der-vier.png",
  "assets/icon-ayante.jpeg", "assets/icon-ereldra.jpeg", "assets/icon-mortis.jpeg", "assets/icon-sorfon.jpeg",
  "assets/textures/paper.webp", "assets/textures/leather.webp",
];
// The runtime (support.js) loads React from unpkg with Subresource Integrity; the same bytes from the cache pass it.
const CDN_PRECACHE = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
];
const CDN_HOSTS = ["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const NEVER_CACHE = /\/assets\/exandria-map\.jpeg$/;
const NETWORK_TIMEOUT = 6000;   // ms before a slow connection falls back to the saved copy (it still updates it when it answers)

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: "reload" skips the HTTP cache, so a new version precaches fresh files.
    await cache.addAll(PRECACHE.map(url => new Request(url, { cache: "reload" })));
    await Promise.all(CDN_PRECACHE.map(url => fetch(url, { mode: "cors", credentials: "omit" })
      .then(res => (res.ok ? caches.open(RUNTIME).then(c => c.put(url, res)) : null)).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL, RUNTIME];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("chronicle-") && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (NEVER_CACHE.test(url.pathname)) return;                        // the browser fetches it as usual
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") return event.respondWith(networkFirst(req, "./"));
    if (/\/assets\//.test(url.pathname)) return event.respondWith(staleWhileRevalidate(req));
    return event.respondWith(networkFirst(req));
  }
  if (CDN_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(req));
});

// The offline copy is returned with a marker header the page can read.
function marked(res) {
  const headers = new Headers(res.headers);
  headers.set("x-chronicle-offline", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(SHELL);
  const key = cacheKey || req.url.split("#")[0].split("?")[0];
  // Navigations cannot be re-issued with options; everything else revalidates (ETag) past the HTTP cache.
  const network = (req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req, { cache: "no-cache" }))
    .then(res => { if (res.ok && (res.type === "basic" || res.type === "default")) cache.put(key, res.clone()); return res; });
  const saved = () => cache.match(key, { ignoreSearch: true });
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(() => saved().then(hit => resolve(hit ? marked(hit) : null)), NETWORK_TIMEOUT); });
  try {
    const res = await Promise.race([network, slow.then(hit => hit || network)]);
    return res;
  } catch (err) {
    const hit = await saved();
    if (hit) return marked(hit);
    throw err;
  } finally { clearTimeout(timer); }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then(res => { if (res.ok && res.type === "basic") cache.put(req, res.clone()); return res; });
  if (hit) { update.catch(() => {}); return hit; }
  try { return await update; } catch (err) { const shell = await caches.match(req, { ignoreSearch: true }); if (shell) return shell; throw err; }
}

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // Requested with CORS (a <link> without crossorigin asks no-cors) so the response is readable and small to store.
  const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}
