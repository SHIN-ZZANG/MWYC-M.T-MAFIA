/* sw.js — 홈 화면 앱으로 열리게 하는 서비스 워커.
   화면 · 정적 파일은 망 먼저, 끊겼을 때만 사본을 쓴다. 그래서 배포하면 바로 새 화면이 나온다.
   /api/ 는 건드리지 않는다 — 게임 상태의 원본은 서버, 오프라인 사본은 localStorage(store.js)가 맡는다. */

const CACHE = 'mwyc-mafia-v1'; // 이 이름을 올리면 옛 캐시는 activate 에서 지워진다

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => (n === CACHE ? null : caches.delete(n)))))
      .then(() => self.clients.claim()),
  );
});

// 망도 사본도 없을 때 내주는 화면. 브라우저 기본 오류 화면 대신 같은 색으로 한 줄만 적는다.
function offlinePage() {
  return new Response(
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>연결 없음</title><style>'
    + 'html,body{height:100%;margin:0}'
    + 'body{display:flex;align-items:center;justify-content:center;background:#121318;'
    + 'color:#9aa0b0;font-family:system-ui,sans-serif;font-size:15px;text-align:center;padding:24px}'
    + '</style></head><body><p>연결이 없어 화면을 불러오지 못했습니다.<br>'
    + '인터넷에 연결한 뒤 다시 열어 주세요.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // API 는 브라우저가 제 길로

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) { // 200 만 담는다. 오류를 담으면 다음에 깨진 것을 내준다
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return offlinePage();
        return Response.error();
      })),
  );
});
