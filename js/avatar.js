/* =========================================================================
 * avatar.js — 프로필 캐릭터 + 누적 순공 시간에 따라 열리는 테두리
 *
 * 캐릭터 20종은 사용자가 제공한 동복·하복 이미지의 네 줄에 놓인다.
 * 각 그림에 교복이 포함되어 있으므로 옷을 따로 합성하지 않는다.
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

  /* 이미지 URL은 문서 기준. 새 파일명을 사용해 설치형 앱의 이전 이미지 캐시를 피한다. */
  var SHEET_URL = 'avatar-sheet-2026.jpeg';
  var SHEET_WIDTH = 1122, SHEET_HEIGHT = 1402;
  var PORTRAIT_X = [17, 240, 463, 683, 900];
  var PORTRAIT_Y = [72, 375, 755, 1065];

  /* ------------------------------------------------------------- 캐릭터 */

  var CHARS = [
    { id: 'f1', name: '긴 웨이브 · 동복', sex: 'f', cell: 0 },
    { id: 'f2', name: '올림머리 · 동복', sex: 'f', cell: 1 },
    { id: 'f3', name: '단발 · 동복', sex: 'f', cell: 2 },
    { id: 'f4', name: '긴 생머리 · 동복', sex: 'f', cell: 3 },
    { id: 'w5', name: '옆 땋은 머리 · 동복', sex: 'f', cell: 4 },
    { id: 'w6', name: '높은 포니테일 · 동복', sex: 'f', cell: 5 },
    { id: 'w7', name: '낮은 포니테일 · 동복', sex: 'f', cell: 6 },
    { id: 'w8', name: '낮은 번 · 동복', sex: 'f', cell: 7 },
    { id: 'w9', name: '앞머리 없는 생머리 · 동복', sex: 'f', cell: 8 },
    { id: 'w10', name: '반묶음 · 동복', sex: 'f', cell: 9 },
    { id: 's1', name: '긴 웨이브 · 하복', sex: 'f', cell: 10 },
    { id: 's2', name: '올림머리 · 하복', sex: 'f', cell: 11 },
    { id: 's3', name: '단발 · 하복', sex: 'f', cell: 12 },
    { id: 's4', name: '긴 생머리 · 하복', sex: 'f', cell: 13 },
    { id: 'f5', name: '옆 땋은 머리 · 하복', sex: 'f', cell: 14 },
    { id: 's6', name: '높은 포니테일 · 하복', sex: 'f', cell: 15 },
    { id: 's7', name: '낮은 포니테일 · 하복', sex: 'f', cell: 16 },
    { id: 's8', name: '낮은 번 · 하복', sex: 'f', cell: 17 },
    { id: 's9', name: '앞머리 없는 생머리 · 하복', sex: 'f', cell: 18 },
    { id: 's10', name: '반묶음 · 하복', sex: 'f', cell: 19 }
  ];

  var ITEMS = [
    { id: 'none', name: '착용 안 함' },
    { id: 'lily', name: '백합 핀' },
    { id: 'ribbon', name: '남색 리본' }
  ];

  /* ------------------------------------------------------- 젤리로 사는 것
   * 시간으로 열리는 테두리 5색은 그대로 둔다.
   *
   * 젤리는 순공 1분당 1개다. 결국 이것도 공부해서 여는 것이지, 그냥 주는 게 아니다.
   * 모리는 그림 시트에 칸이 없어 slime.js 가 그리는 SVG 를 그대로 쓴다 —
   * 덕분에 홈에서 키운 단계가 프로필 사진에도 그대로 나온다. */

  var SHOP_CHARS = [
    { id: 'slime', name: '모리', sex: 'x', cell: -1, cost: 300, desc: '홈에서 키운 모습 그대로 나와요' }
  ];

  var SHOP_BORDERS = [
    { id: 'j1', name: '젤리',   cost: 400,  cls: 'av-j1', desc: '모리와 같은 색이에요' },
    { id: 'j2', name: '자수정', cost: 900,  cls: 'av-j2', desc: '' },
    { id: 'j3', name: '은하수', cost: 2000, cls: 'av-j3', desc: '별가루가 흐르는 테두리예요' }
  ];

  /* ------------------------------------------------------------- 테두리 색
   * 등급을 매기지 않는다. 순공 시간이 쌓이면 예쁜 색을 하나씩 더 쓸 수 있게
   * 열어 줄 뿐이고, 열린 색 중에서는 아무거나 골라도 된다. */

  var BORDERS = [
    { id: 'b1', name: '기본',   hours: 0,   cls: 'av-b1', desc: '처음부터 쓸 수 있어요' },
    { id: 'b2', name: '안개',   hours: 10,  cls: 'av-b2', desc: '' },
    { id: 'b3', name: '물빛',   hours: 30,  cls: 'av-b3', desc: '' },
    { id: 'b4', name: '노을',   hours: 80,  cls: 'av-b4', desc: '' },
    { id: 'b5', name: '오로라', hours: 200, cls: 'av-b5', desc: '천천히 색이 도는 테두리예요' }
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* 시간으로 여는 목록과 젤리로 사는 목록을 합친 것.
   * 잠금 계산(borderIndexFor 등)은 BORDERS 만 보아야 하므로 배열을 따로 둔다 —
   * 값이 없는 hours 가 섞이면 "다음 색까지 남은 시간" 이 NaN 이 된다. */
  function allChars() { return CHARS.concat(SHOP_CHARS); }
  function allBorders() { return BORDERS.concat(SHOP_BORDERS); }

  /** 젤리로 사는 항목인가 (사지 않으면 못 고른다) */
  function shopItem(id) {
    return byId(SHOP_CHARS, id) || byId(SHOP_BORDERS, id) || null;
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
    return { char: CHARS[0].id, border: BORDERS[0].id, item: ITEMS[0].id, owned: [] };
  }

  /**
   * 저장값을 믿지 않고 항상 통과시킨다.
   * 모르는 항목은 기본값으로 되돌리고, 아직 못 연 테두리는 열린 것 중
   * 가장 높은 것으로 낮춘다. (공유 코드로 받은 남의 설정도 같은 문을 지난다)
   *
   * 젤리로 산 항목은 산 사람의 설정 안에 owned 로 함께 다닌다. 남의 캐릭터를
   * 그릴 때 내 지갑을 볼 수는 없으므로, 잠금은 그 사람이 들고 온 owned 로 본다.
   */
  function sanitize(cfg, minutes) {
    var d = defaults();
    cfg = cfg || {};
    var owned = [];
    if (Object.prototype.toString.call(cfg.owned) === '[object Array]') {
      cfg.owned.forEach(function (id) { if (shopItem(id) && owned.indexOf(id) < 0) owned.push(id); });
    }
    var out = {
      char: byId(allChars(), cfg.char) ? cfg.char : d.char,
      border: byId(allBorders(), cfg.border) ? cfg.border : d.border,
      item: byId(ITEMS, cfg.item) ? cfg.item : d.item,
      owned: owned
    };

    if (minutes === Infinity) return out;   // 미리보기 — 잠금을 따지지 않는다

    // 젤리로 사는 항목은 산 기록이 있어야 쓸 수 있다
    if (shopItem(out.char) && owned.indexOf(out.char) < 0) out.char = d.char;
    if (shopItem(out.border)) {
      if (owned.indexOf(out.border) < 0) out.border = d.border;
      return out;                            // 시간 잠금은 따지지 않는다
    }

    var open = unlockedBorders(minutes === undefined ? lifetimeMinutes() : minutes);
    var okBorder = false;
    open.forEach(function (b) { if (b.id === out.border) okBorder = true; });
    if (!okBorder) out.border = open[open.length - 1].id;
    return out;
  }

  /** 젤리로 산 항목을 소유 목록에 넣는다 (실제 결제는 부르는 쪽에서) */
  function grant(id) {
    var p = S.profile();
    if (!p || !shopItem(id)) return false;
    var cur = sanitize(p.avatar);
    if (cur.owned.indexOf(id) < 0) cur.owned.push(id);
    p.avatar = cur;
    return S.saveProfile(p);
  }

  function owns(id) {
    if (!shopItem(id)) return true;         // 상점 물건이 아니면 소유를 따지지 않는다
    return get().owned.indexOf(id) >= 0;
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

  /** 배경 그림 없이 시트의 인물 영역을 똑같은 비율로 잘라 보인다. */
  function cellStyle(cell) {
    var c = cell % 5, r = Math.floor(cell / 5);
    return 'viewBox="' + PORTRAIT_X[c] + ' ' + PORTRAIT_Y[r] + ' 220 250"';
  }

  /** 테두리 없이 캐릭터 그림만 */
  function figure(cfg) {
    var c = sanitize(cfg, Infinity);   // 그리기에서는 테두리 잠금을 따지지 않는다
    var item = c.item === 'lily'
      ? '<i class="av-item av-item-lily" aria-hidden="true">✿</i>'
      : (c.item === 'ribbon' ? '<i class="av-item av-item-ribbon" aria-hidden="true">◆</i>' : '');
    // 모리는 시트에 칸이 없다 — slime.js 가 그리는 SVG 를 그대로 넣는다.
    // 아직 slime.js 가 없는 상황(예: 옛 백업 복원 중)에서는 기본 캐릭터로 떨어진다.
    if (c.char === 'slime') {
      if (global.Slime && global.Slime.faceSvg) {
        return '<i class="av-l av-slime">' + global.Slime.faceSvg() + '</i>' + item;
      }
      c.char = defaults().char;
    }
    return '<i class="av-l"><svg class="av-portrait" ' +
      cellStyle(byId(CHARS, c.char).cell) + ' preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<image href="' + SHEET_URL + '" width="' + SHEET_WIDTH + '" height="' + SHEET_HEIGHT + '"></image>' +
      '</svg></i>' + item;
  }

  /**
   * 테두리까지 씌운 한 덩어리.
   * minutes 를 주면 그 사람의 누적 시간으로 테두리 잠금을 판정한다.
   */
  function html(cfg, minutes, extraCls) {
    var c = sanitize(cfg, minutes === undefined ? lifetimeMinutes() : minutes);
    var b = byId(allBorders(), c.border);
    return '<span class="av ' + b.cls + (extraCls ? ' ' + extraCls : '') + '">' +
      '<span class="av-in">' + figure(c) + '</span></span>';
  }

  global.Avatar = {
    CHARS: CHARS, ITEMS: ITEMS, BORDERS: BORDERS,
    SHOP_CHARS: SHOP_CHARS, SHOP_BORDERS: SHOP_BORDERS,
    allChars: allChars, allBorders: allBorders, shopItem: shopItem,
    grant: grant, owns: owns,
    byId: byId,
    lifetimeMinutes: lifetimeMinutes,
    borderIndexFor: borderIndexFor, progress: progress, unlockedBorders: unlockedBorders,
    defaults: defaults, sanitize: sanitize, get: get, save: save,
    cellStyle: cellStyle, figure: figure, html: html
  };

})(window);
