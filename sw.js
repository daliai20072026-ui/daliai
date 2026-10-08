const CACHE_NAME = "dali-ai-v39";

const APP_SHELL = [
    "./",
    "./index.html",
    "./chat.html",
    "./chat.css?v=29",
    "./chat.js?v=54",
    "./style.css",
    "./Features.html",
    "./download.html",
    "./logo.png",
    "./sed.png",
    "./sw.js"
];

async function cacheOne(cache, url) {
    try {
        const response = await fetch(url, { cache: "no-store" });
        if (response && response.ok) {
            await cache.put(url, response);
        }
    } catch (error) {
        // One unavailable asset must never prevent the new service worker
        // from installing. The network will be used when it becomes available.
    }
}

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.all(APP_SHELL.map(url => cacheOne(cache, url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Never interfere with APIs or third-party resources.
    if (url.origin !== self.location.origin) return;

    // HTML/navigation: network first so every Vercel update appears
    // immediately. Use the cached page only when offline.
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request, { cache: "no-store" })
                .then(response => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, copy))
                            .catch(() => {});
                    }
                    return response;
                })
                .catch(() =>
                    caches.match(request).then(cached =>
                        cached || caches.match("./chat.html")
                    )
                )
        );
        return;
    }

    // CSS/JS/images: network first as well. This prevents an old
    // deployment asset from surviving a Git/Vercel update.
    event.respondWith(
        fetch(request, { cache: "no-store" })
            .then(response => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, copy))
                        .catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
