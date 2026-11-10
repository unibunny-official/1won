// 한 번 열면 인터넷 없이도 열리게 앱 파일을 저장해 둔다.
// 앱 파일을 바꿔 올릴 때는 VERSION 을 올려야 휴대폰들이 새 파일을 받는다.
const VERSION = "dpay-web-1.4";
const FILES = ["./", "index.html", "style.css", "app.js", "engine.js", "manifest.webmanifest",
  "img/bg.jpg", "img/instagram.png", "img/favicon.png", "img/icon-192.png", "img/icon-512.png",
  "img/icon-maskable.png", "img/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 저장해 둔 것을 바로 보여 주고(신호가 약해도 하얀 화면 없이), 뒤에서 새 파일을 받아 둔다.
// 오류 응답(404·500 등)은 저장하지 않는다.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request)
      .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })
      .catch(() => hit || Response.error());
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
