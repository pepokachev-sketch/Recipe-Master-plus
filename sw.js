/* Recipe Master Plus: offline application shell */
'use strict';
const CACHE_NAME = 'recipe-master-plus-shell-v1';
const APP_ROOT = new URL('./', self.location.href);
const APP_URL = new URL('index.html', APP_ROOT).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([APP_ROOT.href, APP_URL]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith('recipe-master-plus-shell-') && name !== CACHE_NAME
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: try the latest page first, then use the cached app shell offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_URL, response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match(APP_URL)) ||
          (await caches.match(APP_ROOT)) ||
          new Response('Recipe Master Plus не е зареден офлайн. Отвори приложението веднъж с интернет и опитай отново.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  // Keep same-origin application resources available after the first successful load.
  if (url.pathname.startsWith(APP_ROOT.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
  }
});
