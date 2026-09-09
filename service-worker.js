// Minimal service worker so Chrome/Android offers the "홈 화면에 추가"(install) prompt.
// No caching is done on purpose — the site's content (오늘의 말씀 등) updates daily
// and should always be fetched fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
