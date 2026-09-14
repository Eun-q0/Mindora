/* =========================================================================
 * notes.js — 우리 반 포스트잇
 *
 * 같은 반 사람들이 서로 보는 쪽지 벽이다. 순위표가 "얼마나 했는가" 라면
 * 이건 그냥 말을 주고받는 자리다.
 *
 * 세 가지 규칙이 이 기능의 성격을 정한다.
 *
 *   1. 오래 남지 않는다. 붙일 때 10~30분 사이에서 고른 시간이 지나면 사라진다.
 *      쌓이면 화면을 가려 못 쓰게 되는 기능이라, 지우는 일을 사람이 하게
 *      두지 않고 시간이 하게 했다.
 *   2. 엑스는 "내 화면에서만" 치운다. 남이 붙인 쪽지를 한 사람이 눌렀다고
 *      모두의 화면에서 사라지면, 그건 대화가 아니라 검열이 된다. 그래서
 *      치운 목록은 서버에 올리지 않고 이 기기에만 남는다.
 *      내가 붙인 쪽지만 [떼기]로 모두의 화면에서 없앨 수 있다.
 *   3. 걸러진 말은 붙지 않는다. 판단은 filter.js 한 곳에서만 하고,
 *      여기서는 올리기 전과 받아 온 뒤에 그 함수를 부르기만 한다.
 *      (받아 온 뒤에도 거르는 이유: 앱을 거치지 않고 올린 글이 있을 수 있다)
 * ========================================================================= */
(function (global) {
  'use strict';

  var HIDDEN_KEY = 'mindora.notes.hidden.v1';   // 내 화면에서 치운 쪽지
  var WALL_KEY   = 'mindora.notes.wall.v1';     // 벽을 띄워 둘지
  var DRAFT_KEY  = 'mindora.notes.draft.v1';    // 마지막으로 고른 색·시간

  /* 팔레트 — 실제 색은 CSS(.pin.c0 …)에 있다. 여기에는 번호와 이름만 둔다.
   * 초록·노랑을 뺀 것은 이 앱 전체의 규칙이다(styles.css 머리말 참고).
   * 그래서 흔한 노란 포스트잇 대신 보라·파랑·분홍 계열로 여덟 가지를 골랐다. */
  var COLORS = [
    { id: 0, name: '라벤더' },
    { id: 1, name: '페리윙클' },
    { id: 2, name: '스카이' },
    { id: 3, name: '아쿠아' },
    { id: 4, name: '로즈' },
    { id: 5, name: '코랄' },
    { id: 6, name: '피치' },
    { id: 7, name: '라일락' }
  ];

  var LIFE = [10, 15, 20, 30];   // 고를 수 있는 수명(분)
  var MAX_LEN = 100;

  var cache = [];        // 마지막으로 받아 온 쪽지 (만료·치움 반영 전)
  var lastFetch = 0;

  /* ------------------------------------------------------------ 저장 상태 */

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 무시 */ }
  }

  /** 내가 치운 쪽지 { id: 사라질시각 }. 사라질 시각이 지나면 목록에서도 턴다. */
  function hiddenMap() {
    var m = readJson(HIDDEN_KEY, {}) || {};
    var now = Date.now(), changed = false;
    Object.keys(m).forEach(function (id) {
      if (!m[id] || m[id] < now) { delete m[id]; changed = true; }
    });
    if (changed) writeJson(HIDDEN_KEY, m);
    return m;
  }

  function dismiss(id, expiresAt) {
    if (!id) return;
    var m = hiddenMap();
    // 만료 시각을 같이 적어 두어야, 그 쪽지가 사라진 뒤 이 목록도 스스로 줄어든다
    m[id] = expiresAt || (Date.now() + 31 * 60 * 1000);
    writeJson(HIDDEN_KEY, m);
  }

  function dismissed(id) { return !!hiddenMap()[id]; }

  /** 치운 쪽지를 다시 불러온다 (아직 살아 있는 것만 돌아온다) */
  function restoreAll() {
    var n = Object.keys(hiddenMap()).length;
    writeJson(HIDDEN_KEY, {});
    return n;
  }

  /** 지금 내가 치워 둔 쪽지 수 */
  function hiddenCount() {
    var hid = hiddenMap(), now = Date.now(), n = 0;
    cache.forEach(function (c) { if (hid[c.id] && c.expiresAt > now) n++; });
    return n;
  }

  function wallOn() {
    var o = readJson(WALL_KEY, null);
    return o ? !!o.on : true;      // 처음에는 켜져 있다
  }
  function setWallOn(on) { writeJson(WALL_KEY, { on: !!on }); }

  /** 마지막으로 고른 색·시간을 기억한다 (매번 다시 고르게 하지 않으려고) */
  function draft() {
    var o = readJson(DRAFT_KEY, null) || {};
    var life = LIFE.indexOf(o.life | 0) >= 0 ? (o.life | 0) : 15;
    var color = (o.color | 0) >= 0 && (o.color | 0) < COLORS.length ? (o.color | 0) : -1;
    return { color: color, life: life };   // color -1 = 아무 색이나
  }
  function setDraft(color, life) { writeJson(DRAFT_KEY, { color: color, life: life }); }

  /* ------------------------------------------------------------ 벽 상태 */

  /** 지금 화면에 있어야 할 쪽지 — 만료된 것과 내가 치운 것을 뺀다 */
  function list() {
    var now = Date.now();
    var hid = hiddenMap();
    return cache.filter(function (n) {
      return n.expiresAt > now && !hid[n.id];
    });
  }

  /** 서버에서 받아 온 그대로(치움만 반영 안 함) — 내 쪽지 수를 셀 때 쓴다 */
  function mine() {
    var now = Date.now();
    return cache.filter(function (n) { return n.me && n.expiresAt > now; });
  }

  function remain(note) { return Math.max(0, (note.expiresAt || 0) - Date.now()); }

  /** "12분 남음" · "40초 남음" */
  function remainText(note) {
    var ms = remain(note);
    if (ms <= 0) return '사라지는 중';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + '초 남음';
    return Math.ceil(s / 60) + '분 남음';
  }

  /* 삐뚤게 붙은 각도. 자리와 함께 저장해 두어야 모두의 화면에서 같게 보인다. */
  function pickTilt() { return Math.round((Math.random() * 12) - 6); }
  function pickColor() { return Math.floor(Math.random() * COLORS.length); }

  /* ------------------------------------------------------------ 서버 오가기 */

  function clean(rows) {
    var F = global.Filter;
    return (rows || []).map(function (n) {
      // 앱을 거치지 않고 올라온 글이 남의 화면에 그대로 뜨지 않게 한 번 더 거른다
      if (F) n.body = F.clean(n.body);
      return n;
    });
  }

  function refresh(cls) {
    var C = global.Cloud;
    if (!C || !C.fetchClassNotes) return Promise.resolve([]);
    return C.fetchClassNotes(cls).then(function (rows) {
      cache = clean(rows);
      lastFetch = Date.now();
      return list();
    }, function () {
      return list();   // 못 받아 왔다고 붙어 있던 쪽지를 걷어내진 않는다
    });
  }

  /**
   * 쪽지를 붙인다. 걸러진 말이면 서버에 가지 않고 여기서 막는다.
   * @return {Promise<{ok:boolean, words?:string[]}>}
   */
  function post(cls, note) {
    var F = global.Filter;
    var body = String((note && note.body) || '').trim().slice(0, MAX_LEN);
    if (!body) return Promise.reject(new Error('내용을 입력하세요.'));

    if (F) {
      var v = F.check(body);
      if (!v.ok) {
        var err = new Error('욕설이나 비하하는 말은 붙일 수 없어요.');
        err.words = v.words;
        err.filtered = true;
        return Promise.reject(err);
      }
    }

    var payload = {
      body: body,
      nick: note.nick || '',
      minutes: LIFE.indexOf(note.minutes | 0) >= 0 ? (note.minutes | 0) : 15,
      color: (note.color | 0) >= 0 ? (note.color | 0) : pickColor(),
      tilt: typeof note.tilt === 'number' ? note.tilt : pickTilt(),
      x: note.x, y: note.y
    };

    return global.Cloud.postClassNote(cls, payload).then(function (id) {
      /* 서버가 준 번호로 내 쪽지를 바로 벽에 올린다.
       * 다음 새로고침을 기다리면 붙인 게 잠깐 사라진 것처럼 보인다. */
      if (id) {
        cache.push({
          id: id, nick: payload.nick, body: payload.body,
          color: payload.color, tilt: payload.tilt, x: payload.x, y: payload.y,
          createdAt: Date.now(), expiresAt: Date.now() + payload.minutes * 60000,
          me: true
        });
      }
      return { ok: true, id: id };
    });
  }

  /** 내 쪽지 자리 옮기기 — 화면을 먼저 바꾸고 서버에 알린다 */
  function move(id, x, y) {
    cache.forEach(function (n) { if (n.id === id) { n.x = x; n.y = y; } });
    return global.Cloud.moveClassNote(id, x, y).then(null, function () { return false; });
  }

  /** 내 쪽지를 모두의 화면에서 뗀다 */
  function remove(id) {
    cache = cache.filter(function (n) { return n.id !== id; });
    return global.Cloud.removeClassNote(id).then(null, function () { return false; });
  }

  function reset() {
    cache = [];
    lastFetch = 0;
    try {
      localStorage.removeItem(HIDDEN_KEY);
      localStorage.removeItem(WALL_KEY);
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* 무시 */ }
  }

  global.Notes = {
    COLORS: COLORS, LIFE: LIFE, MAX_LEN: MAX_LEN,
    list: list, mine: mine, refresh: refresh, post: post, move: move, remove: remove,
    dismiss: dismiss, dismissed: dismissed, restoreAll: restoreAll, hiddenCount: hiddenCount,
    wallOn: wallOn, setWallOn: setWallOn, draft: draft, setDraft: setDraft,
    remain: remain, remainText: remainText,
    pickTilt: pickTilt, pickColor: pickColor,
    lastFetch: function () { return lastFetch; },
    reset: reset
  };

})(window);
