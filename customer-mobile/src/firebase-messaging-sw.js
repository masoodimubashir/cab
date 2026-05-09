/* global importScripts, firebase */

// FCM web service worker — handles push notifications when the page is in the background.
// Must be served from the site root (`/firebase-messaging-sw.js`).
// Keep these versions in sync with the `firebase` package in package.json.

importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCCpdahYlxnjogTRS1ZSaF3sQ6cF9DTbVY',
  authDomain: 'dreamcabs-c851f.firebaseapp.com',
  projectId: 'dreamcabs-c851f',
  storageBucket: 'dreamcabs-c851f.firebasestorage.app',
  messagingSenderId: '862449587825',
  appId: '1:862449587825:web:cc8f4f7d2df4a1d8ac2dd0',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'DreamCabs';
  const body = (payload.notification && payload.notification.body) || '';
  const data = payload.data || {};
  self.registration.showNotification(title, {
    body,
    icon: '/assets/icon/favicon.png',
    data,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const tripId = data.trip_id;
  const targetUrl = tripId ? `/customer-tabs/trip/${tripId}` : '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return null;
      })
  );
});
