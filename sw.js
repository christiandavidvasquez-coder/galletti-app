/* Alba: guarda la aplicación para abrir rápido y sin conexión. Los datos siempre vienen de la base en línea. */
const CACHE = 'galletti-app-v3';
const ARCHIVOS = ['./', './index.html', './alba.css', './alba-core.js', './alba-sup.js', './alba-esc.js', './alba-ops.js', './seed-kits.js', './seed-sup.js', './config.js', './vendor/supabase.js', './manifest.webmanifest', './icons/alba-192.png', './icons/alba-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; }).catch(() => caches.match(e.request)));
});
