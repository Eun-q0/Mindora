/* =========================================================================
 * avatar.js — 프로필 캐릭터 + 누적 순공 시간에 따라 열리는 테두리
 *
 * 그림은 avatar-sheet.png 한 장에 모여 있다 (4열 × 2행, 셀 200px).
 *   0..7  캐릭터 8명 — 남 3 · 여 5
 * 시트는 tools/slice-avatar.ps1 이 원본 그림(tools/avatar-source.png)에서
 * 잘라 만든다. 각 칸은 그려진 모습 그대로다 — 옷을 갈아입히거나 색을 바꾸지
 * 않으므로 원본 그림의 완성도가 그대로 남는다.
 *
 * 테두리는 그림이 아니라 CSS 링이며, 지금까지 쌓은 순공 시간이 늘면 쓸 수 있는
 * 색이 하나씩 늘어난다. 등급을 매기지는 않는다.
 *
 * 보상 기준은 kids.js 의 배지와 같다 — 실제 기록(StudyLog)에서만 판정하고,
 * 그냥 주는 것은 없다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;

  var SHEET_COLS = 4;
  var SHEET_ROWS = 2;

  /* 그림 주소는 CSS 가 아니라 여기서 붙인다.
   * CSS 안에 두면 src/css/ 기준으로 찾아 개발 서버에서만 깨지고,
   * 빌드된 index.html(스타일이 인라인)에서는 잘 되는 함정에 빠진다. */
  var SHEET_URL = 'avatar-sheet.png';

  /* ------------------------------------------------------------- 캐릭터 */

  var CHARS = [
    { id: 'm1', name: '웨이브 컷', sex: 'm', cell: 0 },
    { id: 'm2', name: '앞머리 컷', sex: 'm', cell: 1 },
    { id: 'm3', name: '뻗친 컷', sex: 'm', cell: 2 },
    { id: 'f1', name: '긴 웨이브', sex: 'f', cell: 3 },
    { id: 'f2', name: '올림머리', sex: 'f', cell: 4 },
    { id: 'f3', name: '단발', sex: 'f', cell: 5 },
    { id: 'f4', name: '긴 생머리', sex: 'f', cell: 6 },
    { id: 'f5', name: '땋은 머리', sex: 'f', cell: 7 }
  ];

  /* ------------------------------------------------------------- 테두리 색
   * 등급을 매기지 않는다. 순공 시간이 쌓이면 예쁜 색을 하나씩 더 쓸 수 있게
   * 열어 줄 뿐이고, 열린 색 중에서는 아무거나 골라도 된다. */

  var BORDERS = [
    { id: 'b1', name: '기본',   hours: 0,   cls: 'av-b1', desc: '처음부터 쓸 수 있어요' },
    { id: 'b2', name: '라벤더', hours: 10,  cls: 'av-b2', desc: '' },
    { id: 'b3', name: '스카이', hours: 30,  cls: 'av-b3', desc: '' },
    { id: 'b4', name: '로즈',   hours: 80,  cls: 'av-b4', desc: '' },
    { id: 'b5', name: '오로라', hours: 200, cls: 'av-b5', desc: '천천히 색이 도는 테두리예요' }
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* --------------------------------------------------- 누적 시간과 티어 */

  /** 지금까지 기록된 순공 시간 전체(분) */
  function lifetimeMinutes() {
    var sess = global.StudyLog ? global.StudyLog.all() : {};
    var sum = 0;
    Object.keys(sess).forEach(function (day) {
      Object.keys(sess[day]).forEach(function (sub) { sum += sess[day][sub].m || 0; });
    });
    return sum;
  }

  /** 지금까지 쌓은 시간으로 열린 마지막 테두리의 번호 */
  function borderIndexFor(minutes) {
    var h = Math.max(0, minutes || 0) / 60, idx = 0;
    for (var i = 0; i < BORDERS.length; i++) if (h >= BORDERS[i].hours) idx = i;
    return idx;
  }

  /** 다음 색까지 얼마나 남았는지 */
  function progress(minutes) {
    var min = Math.max(0, minutes || 0);
    var idx = borderIndexFor(min);
    var cur = BORDERS[idx], next = BORDERS[idx + 1] || null;
    var fromMin = cur.hours * 60;
    var toMin = next ? next.hours * 60 : fromMin;
    return {
      idx: idx, cur: cur, next: next,
      minutes: min, hours: min / 60,
      remainMin: next ? Math.max(0, toMin - min) : 0,
      pct: next ? Math.min(100, (min - fromMin) / (toMin - fromMin) * 100) : 100
    };
  }

  /** 지금 쓸 수 있는 테두리 목록 */
  function unlockedBorders(minutes) {
    var idx = borderIndexFor(minutes);
    return BORDERS.slice(0, idx + 1);
  }

  /* ------------------------------------------------------------- 설정 값 */

  function defaults() {
    return { char: CHARS[0].id, border: BORDERS[0].id };
  }

  /**
   * 저장값을 믿지 않고 항상 통과시킨다.
   * 모르는 항목은 기본값으로 되돌리고, 아직 못 연 테두리는 열린 것 중
   * 가장 높은 것으로 낮춘다. (공유 코드로 받은 남의 설정도 같은 문을 지난다)
   */
  function sanitize(cfg, minutes) {
    var d = defaults();
    cfg = cfg || {};
    var out = {
      char: byId(CHARS, cfg.char) ? cfg.char : d.char,
      border: byId(BORDERS, cfg.border) ? cfg.border : d.border
    };
    if (minutes === Infinity) return out;   // 미리보기 — 잠금을 따지지 않는다
    var open = unlockedBorders(minutes === undefined ? lifetimeMinutes() : minutes);
    var okBorder = false;
    open.forEach(function (b) { if (b.id === out.border) okBorder = true; });
    if (!okBorder) out.border = open[open.length - 1].id;
    return out;
  }

  /** 내 설정 — 프로필 안에 함께 저장된다(백업에도 그대로 담긴다) */
  function get() {
    var p = S.profile();
    return sanitize(p && p.avatar);
  }

  function save(cfg) {
    var p = S.profile();
    if (!p) return false;
    p.avatar = sanitize(cfg);
    return S.saveProfile(p);
  }

  /* --------------------------------------------------------------- 그리기 */

  /** 시트에서 그 칸만 보이도록 하는 인라인 스타일 */
  function cellStyle(cell) {
    var c = cell % SHEET_COLS, r = Math.floor(cell / SHEET_COLS);
    return 'background-image:url(' + SHEET_URL + ');background-position:' +
      (c / (SHEET_COLS - 1) * 100).toFixed(4) + '% ' +
      (r / (SHEET_ROWS - 1) * 100).toFixed(4) + '%';
  }

  /** 테두리 없이 캐릭터 그림만 */
  function figure(cfg) {
    var c = sanitize(cfg, Infinity);   // 그리기에서는 테두리 잠금을 따지지 않는다
    return '<i class="av-l" style="' + cellStyle(byId(CHARS, c.char).cell) + '"></i>';
  }

  /**
   * 테두리까지 씌운 한 덩어리.
   * minutes 를 주면 그 사람의 누적 시간으로 테두리 잠금을 판정한다.
   */
  function html(cfg, minutes, extraCls) {
    var c = sanitize(cfg, minutes === undefined ? lifetimeMinutes() : minutes);
    var b = byId(BORDERS, c.border);
    return '<span class="av ' + b.cls + (extraCls ? ' ' + extraCls : '') + '">' +
      '<span class="av-in">' + figure(c) + '</span></span>';
  }

  global.Avatar = {
    CHARS: CHARS, BORDERS: BORDERS,
    byId: byId,
    lifetimeMinutes: lifetimeMinutes,
    borderIndexFor: borderIndexFor, progress: progress, unlockedBorders: unlockedBorders,
    defaults: defaults, sanitize: sanitize, get: get, save: save,
    cellStyle: cellStyle, figure: figure, html: html
  };

})(window);
