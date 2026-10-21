// 页面先走网络，断网时用上次缓存的；这样健身房信号差也能打开。
// pose/ 下面是动作分析的识别模型（约 20MB），不会变，先用缓存，省流量。
const CACHE = 'boji-v5';
const SHELL = ['./', './index.html', './pose.html', './pose-core.js', './manifest.webmanifest', './icon-180.png', './icon-192.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/pose/')){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, {ignoreSearch:true})
        .then(r => r || (req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname) ? caches.match('./index.html') : null))
        .then(r => r || Response.error()))
  );
});
