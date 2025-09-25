// Service Worker para Sistema de Status
// Salve este arquivo como: public/sw.js

const CACHE_NAME = 'status-system-v1';
const urlsToCache = [
    '/',
    '/status-index.html'
];

// Instalação do Service Worker
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                return cache.addAll(urlsToCache);
            })
    );
});

// Interceptar requests
self.addEventListener('fetch', function(event) {
    // Apenas para requests GET
    if (event.request.method !== 'GET') return;
    
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Retornar cache se existe
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
    );
});
