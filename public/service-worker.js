// Minimal service worker so Chrome/Android offers the "홈 화면에 추가"(install) prompt.
// No caching is done on purpose — the site's content (오늘의 말씀 등) updates daily
// and should always be fetched fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// ---------- 웹 푸시 알림(Firebase Cloud Messaging) ----------
// 화면이 꺼져있거나 다른 앱을 보고 있을 때(백그라운드) 알림을 띄워주는 부분.
// push-config.js와 값이 같아야 하며, 서비스워커는 페이지의 window 값을 못 읽으므로 여기 직접 적어둔다.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAENs_exymTcWYciCX1txgp6oNqUwyOXys",
  authDomain: "yongmeori-church.firebaseapp.com",
  projectId: "yongmeori-church",
  storageBucket: "yongmeori-church.firebasestorage.app",
  messagingSenderId: "900493543605",
  appId: "1:900493543605:web:ec90fd9ac9fc6e1d0156fc"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || '용머리성당';
  const body = (payload.notification && payload.notification.body) || '';
  const id = payload.data && payload.data.announcementId;
  self.registration.showNotification(title, {
    body,
    icon: 'images/icons/icon-192.png',
    badge: 'images/icons/icon-192.png',
    tag: id,
    data: { id }
  });
});

// 홈페이지 알림함에서 지우면, 페이지가 여기로 메시지를 보내 실제 휴대폰 알림도 같이 닫는다
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLOSE_NOTIFICATION' && event.data.id) {
    self.registration.getNotifications({ tag: event.data.id }).then((notifs) => {
      notifs.forEach((n) => n.close());
    });
  }
});
