// 앱 화면 파일만 캐시해 오프라인에서도 열리게 한다. 날씨 API 요청은 건드리지 않는다.
const CACHE = "inhaler-v1.5.0";
const SHELL = ["./", "index.html", "style.css", "app.js", "analysis.js", "store.js", "weather.js", "report.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // 새 버전을 먼저 받아 보고(3초 안에), 안 되면 저장해 둔 화면으로 연다 → 업데이트 즉시 반영 + 오프라인 실행
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = () => c.match(e.request, { ignoreSearch: true });
    try {
      const r = await Promise.race([fetch(e.request), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await hit()) || Response.error();
    }
  }));
});
