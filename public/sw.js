// 서비스워커: 최신 화면을 우선 보여주고(network-first), 오프라인일 때만 저장된 화면을 사용합니다.
// GitHub Pages 처럼 하위 경로(/drink/)에서도 동작하도록 모든 주소를 상대 경로로 씁니다.
const CACHE = 'sulsul-v4';
const SHELL = [
  './',
  'styles.css',
  'manifest.webmanifest',
  'config.json',
  'icons/icon.svg',
  'vendor/leaflet/leaflet.css',
  'js/app.js',
  'js/cities.js',
  'js/data.js',
  'js/location.js',
  'js/map.js',
  'js/place.js',
  'js/render.js',
  'js/sheets.js',
  'js/snap.js',
  'js/local-vision.js',
  'js/lib/label.js',
  'js/lib/world.js',
  'js/content/brands.js',
  'js/state.js',
  'js/util.js',
  'js/view-find.js',
  'js/view-guide.js',
  'js/view-nearby.js',
  'js/view-prices.js',
  'js/api.js',
  'js/lib/prices.js',
  'js/lib/geo.js',
  'js/lib/identify.js',
  'js/lib/nearby.js',
  'js/lib/quiz.js',
  'js/lib/search.js',
  'js/content/index.js',
  'js/content/channels.js',
  'js/content/glossary.js',
  'js/content/guides.js',
  'js/content/products.js',
  'js/content/categories/asian.js',
  'js/content/categories/beer.js',
  'js/content/categories/liqueur.js',
  'js/content/categories/spirits.js',
  'js/content/categories/whisky.js',
  'js/content/categories/wine.js',
  'data/stores.json',
  'data/prices.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./');
        return new Response(JSON.stringify({ error: '오프라인 상태예요.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }),
  );
});
