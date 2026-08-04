/* =========================================================================
 * avatar.js — 프로필 캐릭터 꾸미기 + 누적 순공 시간 티어
 *
 * 캐릭터는 그림 파일이 아니라 그 자리에서 그리는 SVG 다.
 * 이 앱은 index.html 한 장으로 배포되고 인터넷 없이도 돌아가야 하므로,
 * 사운드(sound.js)가 음원을 합성하듯 캐릭터도 좌표로 만든다.
 *
 * 고르는 것 ─ 피부 3종 · 머리 8종(남 3 · 여 5) · 옷 10종(남 5 · 여 5)
 *   남/여 표시는 분류일 뿐 잠금이 아니다. 누구나 아무거나 고를 수 있다.
 *
 * 받는 것 ─ 프로필 테두리 10종
 *   지금까지 쌓은 순공 시간으로 티어가 오르고, 티어마다 테두리가 하나씩 열린다.
 *   게임 티어처럼 랭킹에도 표시된다. 아직 못 연 테두리는 고를 수 없다.
 *
 * 보상 기준은 kids.js 의 배지와 같다 — 실제 기록(StudyLog)에서만 판정하고,
 * 그냥 주는 것은 없다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;

  /* ------------------------------------------------------------- 피부 톤 */

  var SKINS = [
    { id: 'light',  name: '밝은 톤', base: '#f6d8bd', shade: '#e7bd9b' },
    { id: 'medium', name: '중간 톤', base: '#dda87b', shade: '#c48d61' },
    { id: 'deep',   name: '진한 톤', base: '#9c6644', shade: '#82533a' }
  ];

  /* ------------------------------------------------------------- 머리 모양
   * 머리카락은 뒷머리(back)와 앞머리(front)로 나뉜다.
   * 얼굴을 그리기 전에 back, 그린 뒤에 front 를 얹어야 앞머리가 이마를 덮는다. */

  var HC = '#3b3048';   // 머리카락
  var HT = '#4d3f60';   // 머리카락 밝은 면

  var HAIRS = [
    { id: 'm-crop', name: '숏컷', sex: 'm', back: '',
      front: '<path d="M29 47 C29 27 39 20 50 20 C61 20 71 27 71 47 C70 39 66 34 60 33 C55 32 45 32 40 33 C34 34 30 39 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M40 25 C46 22 56 22 62 26" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round"/>' },

    { id: 'm-part', name: '가르마', sex: 'm', back: '',
      front: '<path d="M29 47 C29 27 39 20 50 20 C61 20 71 27 71 47 C70 38 67 33 62 32 C58 39 48 41 42 36 C36 37 31 41 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M60 24 C56 30 50 33 44 33" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round"/>' },

    { id: 'm-curl', name: '곱슬', sex: 'm', back: '',
      front: '<path d="M30 47 C30 29 39 22 50 22 C61 22 70 29 70 47 C68 39 64 34 58 33 C52 32 46 32 41 34 C35 36 32 41 30 47 Z" fill="' + HC + '"/>' +
             '<circle cx="36" cy="30" r="7" fill="' + HC + '"/><circle cx="46" cy="25" r="8" fill="' + HC + '"/>' +
             '<circle cx="57" cy="26" r="8" fill="' + HC + '"/><circle cx="65" cy="32" r="6.5" fill="' + HC + '"/>' },

    { id: 'f-long', name: '긴 생머리', sex: 'f',
      back: '<path d="M26 42 C26 19 74 19 74 42 L74 92 L62 92 L62 50 L38 50 L38 92 L26 92 Z" fill="' + HC + '"/>',
      front: '<path d="M29 47 C29 26 39 19 50 19 C61 19 71 26 71 47 C70 38 66 33 60 32 C54 31 46 31 40 32 C34 33 30 38 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M31 92 L31 52" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".55"/>' +
             '<path d="M69 92 L69 52" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".55"/>' },

    { id: 'f-bob', name: '단발', sex: 'f',
      back: '<path d="M27 43 C27 20 73 20 73 43 L73 68 Q73 72 68 71 L62 70 L62 50 L38 50 L38 70 L32 71 Q27 72 27 68 Z" fill="' + HC + '"/>',
      front: '<path d="M29 47 C29 26 39 19 50 19 C61 19 71 26 71 47 C70 38 66 33 60 32 C54 31 46 31 40 32 C34 33 30 38 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M33 68 C31 60 31 54 32 50" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".55"/>' },

    { id: 'f-pony', name: '포니테일', sex: 'f',
      back: '<ellipse cx="77" cy="62" rx="9" ry="17" fill="' + HC + '"/>' +
            '<path d="M28 44 C28 21 72 21 72 44 L72 58 L62 58 L62 50 L38 50 L38 58 L28 58 Z" fill="' + HC + '"/>' +
            '<rect x="66" y="41" width="8" height="6" rx="3" fill="#8b5a9c"/>',
      front: '<path d="M29 47 C29 26 39 19 50 19 C61 19 71 26 71 47 C70 38 66 33 60 32 C54 31 46 31 40 32 C34 33 30 38 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M42 22 C50 20 60 22 66 28" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round"/>' },

    { id: 'f-twin', name: '양갈래', sex: 'f',
      back: '<ellipse cx="23" cy="66" rx="8" ry="15" fill="' + HC + '"/><ellipse cx="77" cy="66" rx="8" ry="15" fill="' + HC + '"/>' +
            '<path d="M27 44 C27 21 73 21 73 44 L73 56 L62 56 L62 50 L38 50 L38 56 L27 56 Z" fill="' + HC + '"/>' +
            '<rect x="20" y="46" width="7" height="6" rx="3" fill="#8b5a9c"/><rect x="73" y="46" width="7" height="6" rx="3" fill="#8b5a9c"/>',
      front: '<path d="M29 47 C29 26 39 19 50 19 C61 19 71 26 71 47 C70 38 66 33 60 32 C54 31 46 31 40 32 C34 33 30 38 29 47 Z" fill="' + HC + '"/>' },

    { id: 'f-wave', name: '웨이브', sex: 'f',
      back: '<path d="M26 42 C26 19 74 19 74 42 C74 52 79 58 74 66 C69 74 79 82 73 93 L61 93 L61 50 L39 50 L39 93 L27 93 C21 82 31 74 26 66 C21 58 26 52 26 42 Z" fill="' + HC + '"/>',
      front: '<path d="M29 47 C29 26 39 19 50 19 C61 19 71 26 71 47 C70 38 65 33 58 33 C52 37 44 37 39 33 C34 35 30 39 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M32 56 C36 62 30 68 34 76" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".5"/>' +
             '<path d="M68 56 C64 62 70 68 66 76" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".5"/>' }
  ];

  /* --------------------------------------------------------------- 옷
   * sex 는 분류일 뿐이고 목록은 하나다 — 남녀가 같은 옷을 고를 수 있다. */

  var BODY = 'M12 100 C12 79 29 69 50 69 C71 69 88 79 88 100 Z';

  /** 옷깃 사이로 보이는 목·가슴 — 피부색은 고른 톤을 따라간다 */
  function neckHole(skin) {
    return '<path d="M41 69 C44 78 56 78 59 69 Z" fill="' + skin.base + '"/>';
  }

  var OUTFITS = [
    { id: 'm-uniform', name: '교복 (넥타이)', sex: 'm', draw: function () {
        return '<path d="' + BODY + '" fill="#2f3457"/>' +
          '<path d="M39 70 L50 86 L61 70 L56 68.5 L50 79 L44 68.5 Z" fill="#f2f4fb"/>' +
          '<path d="M50 82 L54.5 86 L52.5 100 L47.5 100 L45.5 86 Z" fill="#8f3a53"/>' +
          '<path d="M22 100 C22 86 30 78 38 75" stroke="#3d4470" stroke-width="2" fill="none"/>' +
          '<path d="M78 100 C78 86 70 78 62 75" stroke="#3d4470" stroke-width="2" fill="none"/>';
      } },
    { id: 'm-hoodie', name: '후드티', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#4a54a8"/>' + neckHole(skin) +
          '<path d="M33 72 C36 86 64 86 67 72 C62 69 38 69 33 72 Z" fill="#3f489a"/>' +
          '<path d="M45 82 L44 95" stroke="#e8ecfb" stroke-width="2" stroke-linecap="round"/>' +
          '<path d="M55 82 L56 95" stroke="#e8ecfb" stroke-width="2" stroke-linecap="round"/>';
      } },
    { id: 'm-tee', name: '라운드 티셔츠', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#7c5cff"/>' + neckHole(skin) +
          '<path d="M40 69 C44 79 56 79 60 69" stroke="#6a4ae6" stroke-width="2" fill="none"/>' +
          '<path d="M24 100 C24 88 28 80 34 76" stroke="#6a4ae6" stroke-width="2" fill="none"/>' +
          '<path d="M76 100 C76 88 72 80 66 76" stroke="#6a4ae6" stroke-width="2" fill="none"/>';
      } },
    { id: 'm-cardi', name: '셔츠 + 가디건', sex: 'm', draw: function () {
        return '<path d="' + BODY + '" fill="#6b7186"/>' +
          '<path d="M40 70 L50 84 L60 70 L56 68.5 L50 77 L44 68.5 Z" fill="#f4f6fb"/>' +
          '<path d="M44 76 L50 84 L56 76 L56 100 L44 100 Z" fill="#f4f6fb"/>' +
          '<path d="M43 74 L43 100" stroke="#5b6076" stroke-width="2" fill="none"/>' +
          '<path d="M57 74 L57 100" stroke="#5b6076" stroke-width="2" fill="none"/>';
      } },
    { id: 'm-track', name: '체육복', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#39457e"/>' + neckHole(skin) +
          '<path d="M41 69 C44 78 56 78 59 69" stroke="#f2f4fb" stroke-width="2.4" fill="none"/>' +
          '<path d="M26 100 C26 88 30 80 35 76" stroke="#f2f4fb" stroke-width="3" fill="none"/>' +
          '<path d="M74 100 C74 88 70 80 65 76" stroke="#f2f4fb" stroke-width="3" fill="none"/>';
      } },

    { id: 'f-uniform', name: '교복 (리본)', sex: 'f', draw: function () {
        return '<path d="' + BODY + '" fill="#2f3457"/>' +
          '<path d="M38 70 L50 88 L62 70 L57 68.5 L50 80 L43 68.5 Z" fill="#f2f4fb"/>' +
          '<path d="M36 72 L44 78 L36 84 Z" fill="#4a5486" opacity=".9"/>' +
          '<path d="M64 72 L56 78 L64 84 Z" fill="#4a5486" opacity=".9"/>' +
          '<path d="M44 82 L50 86 L56 82 L54 90 L46 90 Z" fill="#b34a68"/>' +
          '<circle cx="50" cy="85.5" r="2.4" fill="#8f3a53"/>';
      } },
    { id: 'f-cardi', name: '가디건', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#a89bd8"/>' + neckHole(skin) +
          '<path d="M44 72 L50 82 L56 72 L56 100 L44 100 Z" fill="#f4f2fd"/>' +
          '<path d="M43 71 L43 100" stroke="#9184c8" stroke-width="2" fill="none"/>' +
          '<path d="M57 71 L57 100" stroke="#9184c8" stroke-width="2" fill="none"/>' +
          '<circle cx="50" cy="90" r="1.6" fill="#9184c8"/><circle cx="50" cy="97" r="1.6" fill="#9184c8"/>';
      } },
    { id: 'f-dress', name: '카라 원피스', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#c4708c"/>' + neckHole(skin) +
          '<path d="M39 70 L50 82 L61 70 L56 68 L50 75 L44 68 Z" fill="#fdf4f7"/>' +
          '<path d="M34 74 C38 82 62 82 66 74" stroke="#ad5f7a" stroke-width="2" fill="none"/>' +
          '<circle cx="50" cy="86" r="2" fill="#fdf4f7"/><circle cx="50" cy="94" r="2" fill="#fdf4f7"/>';
      } },
    { id: 'f-hoodie', name: '후드티', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#d1799a"/>' + neckHole(skin) +
          '<path d="M33 72 C36 86 64 86 67 72 C62 69 38 69 33 72 Z" fill="#c26a8c"/>' +
          '<path d="M45 82 L44 95" stroke="#fdf1f5" stroke-width="2" stroke-linecap="round"/>' +
          '<path d="M55 82 L56 95" stroke="#fdf1f5" stroke-width="2" stroke-linecap="round"/>';
      } },
    { id: 'f-knit', name: '니트', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#9d8fd6"/>' + neckHole(skin) +
          '<path d="M40 69 C44 79 56 79 60 69" stroke="#8a7bc6" stroke-width="3" fill="none"/>' +
          '<path d="M30 84 C40 80 60 80 70 84" stroke="#8a7bc6" stroke-width="1.6" fill="none"/>' +
          '<path d="M27 92 C40 88 60 88 73 92" stroke="#8a7bc6" stroke-width="1.6" fill="none"/>';
      } }
  ];

  /* ---------------------------------------------------------------- 티어
   * 기준은 "지금까지 쌓인 순공 시간" 하나뿐이다.
   * 티어가 오르면 같은 번호의 테두리가 열린다 (티어 10개 = 테두리 10개). */

  var TIERS = [
    { id: 't1',  name: '새내기',     icon: '🔰', hours: 0,    border: '기본 테두리' },
    { id: 't2',  name: '브론즈',     icon: '🥉', hours: 10,   border: '브론즈 링' },
    { id: 't3',  name: '실버',       icon: '🥈', hours: 25,   border: '실버 링' },
    { id: 't4',  name: '골드',       icon: '🥇', hours: 50,   border: '골드 링' },
    { id: 't5',  name: '플래티넘',   icon: '💠', hours: 100,  border: '플래티넘 링' },
    { id: 't6',  name: '자수정',     icon: '🔮', hours: 180,  border: '자수정 오라' },
    { id: 't7',  name: '사파이어',   icon: '💎', hours: 300,  border: '사파이어 오라' },
    { id: 't8',  name: '마스터',     icon: '🏅', hours: 500,  border: '마스터 글로우' },
    { id: 't9',  name: '그랜드마스터', icon: '👑', hours: 750, border: '그랜드마스터 오라' },
    { id: 't10', name: '레전드',     icon: '🌟', hours: 1000, border: '레전드 오라' }
  ];

  /** 테두리는 티어와 1:1 이다. cls 는 CSS 에 정의된 링 모양. */
  var BORDERS = TIERS.map(function (t, i) {
    return { id: 'b' + (i + 1), name: t.border, cls: 'av-b' + (i + 1), tier: i, hours: t.hours };
  });

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

  function tierIndexFor(minutes) {
    var h = Math.max(0, minutes || 0) / 60, idx = 0;
    for (var i = 0; i < TIERS.length; i++) if (h >= TIERS[i].hours) idx = i;
    return idx;
  }

  /** 티어와 다음 티어까지 남은 양 */
  function tierFor(minutes) {
    var min = Math.max(0, minutes || 0);
    var idx = tierIndexFor(min);
    var cur = TIERS[idx], next = TIERS[idx + 1] || null;
    var fromMin = cur.hours * 60;
    var toMin = next ? next.hours * 60 : fromMin;
    return {
      idx: idx, tier: cur, next: next,
      minutes: min, hours: min / 60,
      remainMin: next ? Math.max(0, toMin - min) : 0,
      pct: next ? Math.min(100, (min - fromMin) / (toMin - fromMin) * 100) : 100
    };
  }

  /** 그 티어에서 열려 있는 테두리 목록 */
  function unlockedBorders(minutes) {
    var idx = tierIndexFor(minutes);
    return BORDERS.filter(function (b) { return b.tier <= idx; });
  }

  /* ------------------------------------------------------------- 설정 값 */

  function defaults() {
    return { skin: SKINS[0].id, hair: HAIRS[0].id, outfit: OUTFITS[0].id, border: BORDERS[0].id };
  }

  /**
   * 저장값을 믿지 않고 항상 통과시킨다.
   * 모르는 항목은 기본값으로 되돌리고, 아직 못 연 테두리는 열린 것 중 가장 높은 것으로 낮춘다.
   * (공유 코드로 받은 남의 설정도 같은 문을 지난다)
   */
  function sanitize(cfg, minutes) {
    var d = defaults();
    cfg = cfg || {};
    var out = {
      skin: byId(SKINS, cfg.skin) ? cfg.skin : d.skin,
      hair: byId(HAIRS, cfg.hair) ? cfg.hair : d.hair,
      outfit: byId(OUTFITS, cfg.outfit) ? cfg.outfit : d.outfit,
      border: byId(BORDERS, cfg.border) ? cfg.border : d.border
    };
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

  /** 캐릭터 SVG (100×100 좌표계, 크기는 CSS 가 정한다) */
  function svg(cfg) {
    var c = sanitize(cfg, Infinity);   // 그리기에서는 테두리 잠금을 따지지 않는다
    var skin = byId(SKINS, c.skin), hair = byId(HAIRS, c.hair), fit = byId(OUTFITS, c.outfit);

    var head =
      '<ellipse cx="31.5" cy="47" rx="3.6" ry="4.6" fill="' + skin.shade + '"/>' +
      '<ellipse cx="68.5" cy="47" rx="3.6" ry="4.6" fill="' + skin.shade + '"/>' +
      '<path d="M43 55 h14 v13 q-7 5 -14 0 Z" fill="' + skin.shade + '"/>' +
      '<ellipse cx="50" cy="44" rx="18.5" ry="20.5" fill="' + skin.base + '"/>';

    var face =
      '<path d="M38.5 39.5 C41 37.8 45.5 37.8 47.5 39.6" stroke="#4c3d5a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<path d="M52.5 39.6 C54.5 37.8 59 37.8 61.5 39.5" stroke="#4c3d5a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="42.5" cy="46.5" rx="2.5" ry="3.2" fill="#2f2740"/>' +
      '<ellipse cx="57.5" cy="46.5" rx="2.5" ry="3.2" fill="#2f2740"/>' +
      '<circle cx="43.5" cy="45.3" r="0.9" fill="#fff" opacity=".85"/>' +
      '<circle cx="58.5" cy="45.3" r="0.9" fill="#fff" opacity=".85"/>' +
      '<ellipse cx="35.5" cy="52.5" rx="4" ry="2.4" fill="#e08a92" opacity=".35"/>' +
      '<ellipse cx="64.5" cy="52.5" rx="4" ry="2.4" fill="#e08a92" opacity=".35"/>' +
      '<path d="M46.5 55 C48.5 57.6 51.5 57.6 53.5 55" stroke="#a4535f" stroke-width="1.8" fill="none" stroke-linecap="round"/>';

    return '<svg class="av-svg" viewBox="0 0 100 100" role="img" aria-label="프로필 캐릭터" focusable="false">' +
      hair.back + head + face + hair.front + fit.draw(skin) +
      '</svg>';
  }

  /**
   * 링(테두리)까지 씌운 한 덩어리.
   * minutes 를 주면 그 사람의 누적 시간으로 테두리 잠금을 판정한다.
   */
  function html(cfg, minutes, extraCls) {
    var c = sanitize(cfg, minutes === undefined ? lifetimeMinutes() : minutes);
    var b = byId(BORDERS, c.border);
    return '<span class="av ' + b.cls + (extraCls ? ' ' + extraCls : '') + '">' +
      '<span class="av-in">' + svg(c) + '</span></span>';
  }

  /** 랭킹에 붙는 티어 배지 */
  function tierChip(minutes, small) {
    var t = tierFor(minutes);
    return '<span class="tier-chip tc' + (t.idx + 1) + (small ? ' sm' : '') + '">' +
      t.tier.icon + ' ' + t.tier.name + '</span>';
  }

  global.Avatar = {
    SKINS: SKINS, HAIRS: HAIRS, OUTFITS: OUTFITS, BORDERS: BORDERS, TIERS: TIERS,
    byId: byId,
    lifetimeMinutes: lifetimeMinutes,
    tierIndexFor: tierIndexFor, tierFor: tierFor, unlockedBorders: unlockedBorders,
    defaults: defaults, sanitize: sanitize, get: get, save: save,
    svg: svg, html: html, tierChip: tierChip
  };

})(window);
