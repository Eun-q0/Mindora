/* =========================================================================
 * sw.js — 서비스 워커
 *
 * 목적은 두 가지다.
 *   1) 홈 화면에 설치할 수 있게 한다 (PWA 최소 요건)
 *   2) 지하철·학교처럼 신호가 나쁜 곳에서도 앱이 열리게 한다
 *
 * 앱은 단일 index.html 이라 캐시할 것도 사실상 그것 하나다.
 *
 * ⚠ 문서(HTML)는 반드시 네트워크 우선이어야 한다.
 *   캐시 우선으로 두면 배포해도 사용자가 옛날 버전에 갇힌다.
 *   네트워크가 죽었을 때만 캐시로 떨어진다.
 *
 * ⚠ 서버로 나가는 요청(Supabase·나이스)은 절대 캐시하지 않는다.
 *   급식·리그 순위가 옛날 값으로 굳으면 안 된다.
 * ========================================================================= */
'use strict';

/* 정책을 바꿀 때마다 올린다. activate 에서 옛 버전 캐시를 통째로 지운다. */
var VERSION = 'neurostudy-v6';
var SHELL = ['./', './index.html', './manifest.webmanifest',
             './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png',
             './icon.svg', './icon-maskable.svg',
             // 프로필 캐릭터 그림 — 이것만 없으면 랭킹·설정 화면이 텅 비어 보인다
             './avatar-sheet.png',
             './landing/', './landing/index.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      // 하나라도 실패하면 설치 전체가 실패하므로 개별로 담는다
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return c.add(u)['catch'](function () { /* 없는 파일은 건너뛴다 */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === VERSION ? null : caches['delete'](k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 외부 API(Supabase·나이스)는 손대지 않고 그대로 통과시킨다
  if (url.origin !== self.location.origin) return;

  // 문서: 네트워크 우선 → 실패 시 캐시
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put('./index.html', copy); });
          return res;
        })
        ['catch'](function () {
          return caches.match('./index.html').then(function (hit) {
            return hit || caches.match('./');
          });
        })
    );
    return;
  }

  /* 코드(js·css)는 캐시 우선으로 두면 안 된다.
   * 배포본은 index.html 에 전부 인라인돼 있어 문서만 갱신하면 되지만,
   * 개발 서버(src/)는 파일이 분리돼 있어 한 번 캐시되면 코드를 고쳐도
   * 옛 버전이 계속 돌아간다 — 실제로 이 함정에 빠져 한참 헤맸다.
   * 그래서 코드는 "네트워크 먼저, 실패하면 캐시" 로 뒤집는다.
   * 아이콘·매니페스트 같은 정적 자원만 캐시 우선을 유지한다. */
  var isCode = /\.(?:js|css)(?:$|\?)/.test(url.pathname);

  if (isCode) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return caches.match(req); })
    );
    return;
  }

  // 그 외 같은 출처 자원(아이콘 등): 캐시 우선 → 없으면 네트워크
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
