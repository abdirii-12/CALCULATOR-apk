// Service Worker for Offline-First Calculator PWA
const CACHE_NAME = 'calculator-offline-v2';
const CACHE_VERSION = '2.0.0';
const OFFLINE_URL = 'offline.html';

// App shell resources - MUST BE LOCAL FILES
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './font-awesome.css'
];

// Installation - Cache core assets
self.addEventListener('install', event => {
  console.log('📦 Installing Service Worker v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Caching core app shell');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        console.log('✅ Skip waiting on install');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ Cache addAll error:', error);
      })
  );
});

// Activation - Clean up old caches
self.addEventListener('activate', event => {
  console.log('⚡ Activating Service Worker v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('✅ Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch - Offline-first strategy
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip chrome-extension requests
  if (event.request.url.startsWith('chrome-extension://')) return;
  
  // Handle API requests differently
  if (event.request.url.includes('/api/')) {
    // For API calls, try network first, then cache
    event.respondWith(networkThenCache(event));
    return;
  }
  
  // For all other requests: Cache First, then Network
  event.respondWith(cacheFirstStrategy(event));
});

// Cache First Strategy
function cacheFirstStrategy(event) {
  return caches.match(event.request, { ignoreSearch: true })
    .then(cachedResponse => {
      // Return cached response if found
      if (cachedResponse) {
        console.log('📁 Serving from cache:', event.request.url);
        return cachedResponse;
      }
      
      // Otherwise fetch from network
      return fetch(event.request)
        .then(response => {
          // Don't cache if not a successful response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone response for cache
          const responseToCache = response.clone();
          
          // Add to cache for future
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
              console.log('💾 Cached new resource:', event.request.url);
            });
          
          return response;
        })
        .catch(error => {
          console.log('🌐 Network error, showing offline fallback:', error);
          
          // If request is for HTML, show offline page
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match(OFFLINE_URL)
              .then(offlineResponse => offlineResponse || new Response('You are offline. Calculator works offline!'));
          }
          
          // For images, show a placeholder
          if (event.request.destination === 'image') {
            return caches.match('./icon.png');
          }
          
          return new Response('Offline content not available', {
            status: 408,
            statusText: 'Offline'
          });
        });
    });
}

// Network Then Cache Strategy (for dynamic content)
function networkThenCache(event) {
  return fetch(event.request)
    .then(response => {
      // Cache the response
      const responseToCache = response.clone();
      caches.open(CACHE_NAME)
        .then(cache => cache.put(event.request, responseToCache));
      
      return response;
    })
    .catch(() => {
      // Network failed, try cache
      return caches.match(event.request);
    });
}

// Background Sync
self.addEventListener('sync', event => {
  console.log('🔄 Background sync:', event.tag);
  
  if (event.tag === 'sync-calculations') {
    event.waitUntil(syncCalculations());
  }
});

// Sync pending calculations when online
function syncCalculations() {
  return new Promise((resolve) => {
    const pending = JSON.parse(localStorage.getItem('pendingCalculations') || '[]');
    
    if (pending.length === 0) {
      console.log('✅ No pending calculations to sync');
      return resolve();
    }
    
    console.log(`🔄 Syncing ${pending.length} calculations`);
    
    // Clear pending after successful sync
    localStorage.setItem('pendingCalculations', '[]');
    resolve();
  });
}

// Push Notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Calculator Update';
  const options = {
    body: data.body || 'New features available!',
    icon: './icon.png',
    badge: './icon.png',
    tag: 'calculator-update',
    data: {
      url: data.url || './'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing window if available
        for (const client of windowClients) {
          if (client.url === event.notification.data.url && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url);
        }
      })
  );
});

// Periodic background sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', event => {
    if (event.tag === 'update-cache') {
      console.log('🔄 Periodic sync triggered');
      event.waitUntil(updateCache());
    }
  });
}

// Update cache in background
function updateCache() {
  return caches.open(CACHE_NAME)
    .then(cache => {
      return cache.addAll(CORE_ASSETS);
    })
    .then(() => {
      console.log('✅ Cache updated in background');
    });
}

// Message handling from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_CACHE_INFO') {
    caches.open(CACHE_NAME)
      .then(cache => cache.keys())
      .then(keys => {
        event.ports[0].postMessage({
          cacheSize: keys.length,
          cacheName: CACHE_NAME,
          version: CACHE_VERSION
        });
      });
  }
});
