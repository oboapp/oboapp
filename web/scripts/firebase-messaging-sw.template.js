// AUTO-GENERATED AT BUILD/DEV STARTUP FROM scripts/firebase-messaging-sw.template.js
// DO NOT EDIT web/public/firebase-messaging-sw.js DIRECTLY.

importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js",
);

const firebaseConfig = __FIREBASE_CONFIG_JSON__;

let messaging = null;

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig);
  messaging = firebase.messaging();

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
} else {
  console.warn(
    "[firebase-messaging-sw.js] Firebase config missing. Background messaging is disabled.",
  );
}

self.addEventListener("notificationclick", (event) => {
  console.log("[firebase-messaging-sw.js] Notification click received:", event);

  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        for (const client of clientList) {
          if (
            client.url.startsWith(globalThis.registration.scope) &&
            "focus" in client
          ) {
            client.postMessage({
              type: "NOTIFICATION_CLICKED",
              messageId: event.notification.data?.messageId,
            });
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
