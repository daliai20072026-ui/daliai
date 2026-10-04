const CACHE_NAME = "dali-ai-v16";
const APP_SHELL = [
    "./",
    "./index.html",
    "./chat.html",
    "./chat.css?v=16",
    "./chat.js?v=26",
    "./style.css",
    "./Features.html",
    "./download.html",
    "./logo.png",
    "./sed.png",
    "./sw.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
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

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy).catch(() => {}));
                    return response;
                })
                .catch(() =>
                    caches.match(request).then(cached => cached || caches.match("./chat.html"))
                )
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response && (response.ok || response.type === "opaque")) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy).catch(() => {}));
                }
                return response;
            });
        })
    );
});
