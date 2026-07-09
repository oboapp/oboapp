// Firebase Cloud Messaging Service Worker
// This file handles background push notifications

importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js",
);

// Initialize Firebase in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyA95fRgvUbu8JeBpj_eZ2_EfbkhFqQLS-E",
  authDomain: "oborishte-map.firebaseapp.com",
  projectId: "oborishte-map",
  storageBucket: "oborishte-map.firebasestorage.app",
  messagingSenderId: "109471846934",
  appId: "1:109471846934:web:98a7b3d3907150b56adb37",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Received background message:",
    payload,
  );

  const notificationTitle = payload.data?.title || "Ново съобщение в OboApp";
  const notificationOptions = {
    body: payload.data?.body || "",
    icon: payload.data?.senderIcon || payload.data?.icon || "/icon-192x192.png",
    badge: payload.data?.badge || "/icon-72x72.png",
    tag: payload.data?.messageId || "default",
    data: {
      url: payload.data?.url || payload.fcmOptions?.link || "/",
      messageId: payload.data?.messageId,
      interestId: payload.data?.interestId,
      matchId: payload.data?.matchId,
    },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  return globalThis.registration.showNotification(
    notificationTitle,
    notificationOptions,
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log("[firebase-messaging-sw.js] Notification click received:", event);

  event.notification.close();

  // Get the URL from notification data
  const urlToOpen = event.notification.data?.url || "/";

  // Open or focus the app window
  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        // Check if there's already a window open with the app
        for (const client of clientList) {
          if (
            client.url.startsWith(globalThis.registration.scope) &&
            "focus" in client
          ) {
            // Navigate to the message and focus the window
            client.postMessage({
              type: "NOTIFICATION_CLICKED",
              messageId: event.notification.data?.messageId,
            });
            return client.focus();
          }
        }
        // No window open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
