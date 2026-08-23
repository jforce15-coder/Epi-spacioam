/* Service worker · EPI App — cache offline tras la primera carga con éxito.
   Motivo: el app fallaba al abrir SIN wifi / con señal débil, porque las
   librerías (React, Babel, Recharts…) se pedían a los CDN en cada carga y una
   petición fallida impedía arrancar. Aquí se cachea todo lo descargado la
   primera vez que sí hay señal; después el app abre aunque no haya conexión. */
var CACHE = "epi-app-v2";

self.addEventListener("install", function (e) { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = req.url;
  if (/^chrome-extension:/.test(url)) return;

  var isLib = /unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url);
  if (isLib) {
    // Librerías versionadas (inmutables) → cache-first.
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          try { c.put(req, res.clone()); } catch (_) {}
          return res;
        });
      });
    }));
    return;
  }

  // Otros orígenes (Apps Script, Sheets, fuentes de terceros): no interceptar.
  try { if (new URL(url).origin !== self.location.origin) return; } catch (_) { return; }

  // Archivos propios del app (html/js/css) → NETWORK-FIRST: siempre se intenta la
  // versión más reciente (así un deploy nuevo se ve de inmediato), y solo si no
  // hay red se sirve de la caché. Antes era stale-while-revalidate y el app podía
  // ejecutar una copia vieja durante una carga tras cada cambio.
  e.respondWith(
    fetch(req).then(function (res) {
      caches.open(CACHE).then(function (c) { try { c.put(req, res.clone()); } catch (_) {} });
      return res;
    }).catch(function () {
      return caches.open(CACHE).then(function (c) { return c.match(req); });
    })
  );
});
