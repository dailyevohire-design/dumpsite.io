self.addEventListener('push', function(event) {
  var data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch(e) {
    data = { title: 'DumpSite.io', body: event.data ? event.data.text() : 'New notification' }
  }
  var options = {
    body: data.body || 'New job available',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: data.url || '/dashboard' },
    requireInteraction: false,
    tag: 'dumpsite-notification',
    renotify: true
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'DumpSite.io', options)
      .catch(function(err) { console.error('Push notification failed:', err) })
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i]
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        if (clients.openWindow) return clients.openWindow(url)
      })
  )
})

self.addEventListener('install', function(event) {
  self.skipWaiting()
})

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim())
})
