// オフライン用のキャッシュ。アプリのファイルを変えたら VERSION を上げる
const VERSION = 'v1';
const CACHE = 'kuro-pomodoro-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'serifu.json',
  'assets/bg.jpg', 'assets/char.webp', 'assets/eyes_closed.png', 'assets/mouth_open.png', 'assets/mouth_rmap.png',
  'assets/icon-192.png', 'assets/icon-512.png',
];
// 一覧ファイルは新しいほうを優先（音声やセリフを足したときにすぐ反映させる）
const FRESH = ['voice/index.json', 'serifu.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try {
      const idx = await (await fetch('voice/index.json', { cache: 'no-cache' })).json();
      await c.addAll(Object.values(idx).map(f => 'voice/' + f));
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fresh = FRESH.some(p => url.pathname.endsWith('/' + p));
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (fresh) {
      try { const r = await fetch(e.request, { cache: 'no-cache' }); c.put(e.request, r.clone()); return r; }
      catch { return (await c.match(e.request)) || Response.error(); }
    }
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const r = await fetch(e.request);
    if (r.ok) c.put(e.request, r.clone());
    return r;
  })());
});
