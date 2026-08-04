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
    { id: 'light',  name: '밝은 톤', base: '#f8e3d3', shade: '#eec9b3' },
    { id: 'medium', name: '중간 톤', base: '#eabe98', shade: '#d7a67d' },
    { id: 'deep',   name: '진한 톤', base: '#c48a64', shade: '#ab7251' }
  ];

  /* ------------------------------------------------------------- 머리 모양
   * 머리카락은 뒷머리(back)와 앞머리(front)로 나뉜다.
   * 얼굴을 그리기 전에 back, 그린 뒤에 front 를 얹어야 앞머리가 이마를 덮는다. */

  var HC = '#4b3327';   // 머리카락 — 따뜻한 다크 브라운
  var HT = '#6b4a35';   // 결·하이라이트

  var HAIRS = [
    /* ── 남성형 3종 ─────────────────────────────────────────────── */

    { id: 'm-wave', name: '곱슬 웨이브', sex: 'm',
      back: '<path d="M27 49 C25 27 38 17 50 17 C62 17 75 27 73 49 C72 55 67 56 65 50 L35 50 C33 56 28 55 27 49 Z" fill="' + HC + '"/>',
      front: '<path d="M29 47 C29 26 38 19 50 19 C62 19 71 26 71 47 C70 40 68 35 64 33 C61 38 56 39 52 36 C48 40 43 40 39 36 C34 38 31 41 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M37 25 C42 22 47 23 50 26" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>' +
             '<path d="M56 24 C61 25 65 28 67 32" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>' },

    { id: 'm-fringe', name: '앞머리 숏컷', sex: 'm',
      back: '<path d="M28 48 C27 26 38 17 50 17 C62 17 73 26 72 48 C71 53 67 54 65 49 L35 49 C33 54 29 53 28 48 Z" fill="' + HC + '"/>',
      front: '<path d="M29 46 C29 25 38 18 50 18 C62 18 71 25 71 46 C71 43 70 39 69 37 C60 40 40 40 31 37 C30 39 29 43 29 46 Z" fill="' + HC + '"/>' +
             '<path d="M40 23 C46 21 54 21 60 24" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round" opacity=".75"/>' },

    { id: 'm-spiky', name: '짧은 뻗친 머리', sex: 'm',
      back: '<path d="M29 48 C28 27 38 18 50 18 C62 18 72 27 71 48 C70 52 67 53 65 49 L35 49 C33 53 30 52 29 48 Z" fill="' + HC + '"/>',
      front: '<path d="M30 45 C30 27 38 20 50 20 C62 20 70 27 70 45 C69 39 66 34 61 32 C56 31 44 31 39 32 C34 34 31 39 30 45 Z" fill="' + HC + '"/>' +
             '<path d="M34 30 L33 21 L40 27 Z" fill="' + HC + '"/><path d="M43 25 L44 16 L50 24 Z" fill="' + HC + '"/>' +
             '<path d="M54 24 L60 17 L59 27 Z" fill="' + HC + '"/><path d="M63 29 L69 24 L67 33 Z" fill="' + HC + '"/>' },

    /* ── 여성형 5종 ─────────────────────────────────────────────── */

    { id: 'f-wave', name: '긴 웨이브', sex: 'f',
      back: '<path d="M25 43 C25 18 75 18 75 43 C77 53 72 59 76 69 C80 79 72 86 76 95 L61 95 L61 50 L39 50 L39 95 L24 95 C28 86 20 79 24 69 C28 59 23 53 25 43 Z" fill="' + HC + '"/>',
      front: '<path d="M29 47 C29 25 38 18 50 18 C62 18 71 25 71 47 C70 39 67 34 62 32 C57 37 46 38 40 34 C34 36 30 40 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M30 58 C34 64 28 70 32 78" stroke="' + HT + '" stroke-width="2.2" fill="none" opacity=".55"/>' +
             '<path d="M70 58 C66 64 72 70 68 78" stroke="' + HT + '" stroke-width="2.2" fill="none" opacity=".55"/>' },

    { id: 'f-bun', name: '올림머리', sex: 'f',
      back: '<circle cx="50" cy="15" r="9.5" fill="' + HC + '"/>' +
            '<path d="M29 47 C28 27 38 19 50 19 C62 19 72 27 71 47 C70 51 67 52 65 48 L35 48 C33 52 30 51 29 47 Z" fill="' + HC + '"/>',
      front: '<path d="M30 45 C30 25 39 18 50 18 C61 18 70 25 70 45 C69 38 66 33 60 31 C56 35 44 35 40 31 C34 33 31 38 30 45 Z" fill="' + HC + '"/>' +
             '<path d="M31 43 C29 51 30 58 33 63" stroke="' + HC + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
             '<path d="M69 43 C71 51 70 58 67 63" stroke="' + HC + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
             '<path d="M45 10 C50 8 56 10 58 14" stroke="' + HT + '" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>' },

    { id: 'f-bob', name: '단발', sex: 'f',
      back: '<path d="M27 43 C27 19 73 19 73 43 L73 66 Q73 71 68 70 L62 68 L62 50 L38 50 L38 68 L32 70 Q27 71 27 66 Z" fill="' + HC + '"/>',
      front: '<path d="M29 46 C29 24 38 18 50 18 C62 18 71 24 71 46 C71 42 70 38 69 36 C60 40 40 40 31 36 C30 38 29 42 29 46 Z" fill="' + HC + '"/>' +
             '<path d="M33 66 C31 58 31 52 32 47" stroke="' + HT + '" stroke-width="2" fill="none" opacity=".5"/>' },

    { id: 'f-long', name: '긴 생머리', sex: 'f',
      back: '<path d="M26 42 C26 18 74 18 74 42 L74 93 L61 93 L61 50 L39 50 L39 93 L26 93 Z" fill="' + HC + '"/>',
      front: '<path d="M29 46 C29 24 38 18 50 18 C62 18 71 24 71 46 C71 42 70 38 69 36 C60 40 40 40 31 36 C30 38 29 42 29 46 Z" fill="' + HC + '"/>' +
             '<path d="M31 93 L31 52" stroke="' + HT + '" stroke-width="2.2" fill="none" opacity=".5"/>' +
             '<path d="M69 93 L69 52" stroke="' + HT + '" stroke-width="2.2" fill="none" opacity=".5"/>' },

    { id: 'f-braid', name: '땋은 머리', sex: 'f',
      back: '<path d="M27 43 C27 19 73 19 73 43 L73 60 L62 60 L62 50 L38 50 L38 60 L27 60 Z" fill="' + HC + '"/>' +
            '<ellipse cx="70" cy="62" rx="6" ry="5" fill="' + HC + '"/><ellipse cx="73" cy="70" rx="6" ry="5" fill="' + HC + '"/>' +
            '<ellipse cx="71" cy="78" rx="5.5" ry="5" fill="' + HC + '"/><ellipse cx="74" cy="85" rx="5" ry="4.5" fill="' + HC + '"/>' +
            '<path d="M66 62 C74 66 68 72 76 76" stroke="' + HT + '" stroke-width="1.6" fill="none" opacity=".6"/>' +
            '<rect x="70" y="88" width="7" height="5" rx="2.5" fill="#c99aa6"/>',
      front: '<path d="M29 47 C29 25 38 18 50 18 C62 18 71 25 71 47 C70 39 67 34 62 32 C57 37 46 38 40 34 C34 36 30 40 29 47 Z" fill="' + HC + '"/>' +
             '<path d="M31 46 C30 53 31 58 33 62" stroke="' + HC + '" stroke-width="3" fill="none" stroke-linecap="round"/>' }
  ];

  /* --------------------------------------------------------------- 옷
   * sex 는 분류일 뿐이고 목록은 하나다 — 남녀가 같은 옷을 고를 수 있다. */

  var BODY = 'M12 100 C12 79 29 69 50 69 C71 69 88 79 88 100 Z';

  /** 옷깃 사이로 보이는 목·가슴 — 피부색은 고른 톤을 따라간다 */
  function neckHole(skin) {
    return '<path d="M41 69 C44 78 56 78 59 69 Z" fill="' + skin.base + '"/>';
  }

  /** 셔츠 깃 — 목 아래로 벌어진 두 장 */
  function collar(inner, edge) {
    return '<path d="M40 69 L50 84 L44 70 Z" fill="' + inner + '"/>' +
      '<path d="M60 69 L50 84 L56 70 Z" fill="' + inner + '"/>' +
      '<path d="M40 69 L50 84 L60 69" stroke="' + edge + '" stroke-width="1.1" fill="none" stroke-linejoin="round"/>';
  }

  var OUTFITS = [
    /* ── 남성형 5종 ─────────────────────────────────────────────── */

    { id: 'm-shirt', name: '크림 셔츠', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#f2e7d6"/>' + neckHole(skin) +
          '<path d="M42 69 L50 82 L58 69 L55 68 L50 76 L45 68 Z" fill="#e6d8c1"/>' +
          collar('#fbf5ea', '#ddcdb4') +
          '<path d="M50 84 L50 100" stroke="#ddcdb4" stroke-width="1.2"/>' +
          '<rect x="59" y="86" width="9" height="8.5" rx="1.5" fill="none" stroke="#ddcdb4" stroke-width="1.2"/>';
      } },
    { id: 'm-hoodie', name: '회색 후드티', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#c8ccd4"/>' + neckHole(skin) +
          '<path d="M32 72 C35 87 65 87 68 72 C62 68 38 68 32 72 Z" fill="#b6bbc5"/>' +
          '<path d="M45 84 L44 96" stroke="#f4f6f9" stroke-width="2.2" stroke-linecap="round"/>' +
          '<path d="M55 84 L56 96" stroke="#f4f6f9" stroke-width="2.2" stroke-linecap="round"/>' +
          '<path d="M32 95 C40 92 60 92 68 95" stroke="#b6bbc5" stroke-width="1.4" fill="none"/>';
      } },
    { id: 'm-knit', name: '네이비 니트', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#333e5e"/>' + neckHole(skin) +
          '<path d="M41 69 L50 83 L59 69 L55 67.5 L50 76 L45 67.5 Z" fill="#f7f8fb"/>' +
          collar('#f7f8fb', '#d8dceb') +
          '<path d="M40 70 C44 82 56 82 60 70" stroke="#28314c" stroke-width="2.4" fill="none"/>' +
          '<path d="M24 100 C25 89 28 82 33 78" stroke="#28314c" stroke-width="1.6" fill="none"/>' +
          '<path d="M76 100 C75 89 72 82 67 78" stroke="#28314c" stroke-width="1.6" fill="none"/>';
      } },
    { id: 'm-cardi', name: '베이지 가디건', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#ddc9ab"/>' + neckHole(skin) +
          '<path d="M44 73 L50 84 L56 73 L56 100 L44 100 Z" fill="#f8f3e8"/>' +
          '<path d="M43 71 L43 100" stroke="#c9b18e" stroke-width="1.6" fill="none"/>' +
          '<path d="M57 71 L57 100" stroke="#c9b18e" stroke-width="1.6" fill="none"/>' +
          '<path d="M40 69 L50 84 L60 69" stroke="#c9b18e" stroke-width="1.2" fill="none"/>' +
          '<circle cx="50" cy="89" r="1.6" fill="#c9b18e"/><circle cx="50" cy="96" r="1.6" fill="#c9b18e"/>';
      } },
    { id: 'm-jacket', name: '블랙 셔츠 재킷', sex: 'm', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#2e2e34"/>' + neckHole(skin) +
          '<path d="M42 69 L50 82 L58 69 L55 68 L50 76 L45 68 Z" fill="#25252a"/>' +
          collar('#3a3a42', '#4c4c56') +
          '<path d="M50 84 L50 100" stroke="#4c4c56" stroke-width="1.2"/>' +
          '<rect x="31" y="86" width="10" height="9" rx="1.5" fill="none" stroke="#4c4c56" stroke-width="1.2"/>' +
          '<rect x="59" y="86" width="10" height="9" rx="1.5" fill="none" stroke="#4c4c56" stroke-width="1.2"/>';
      } },

    /* ── 여성형 5종 ─────────────────────────────────────────────── */

    { id: 'f-blouse', name: '리본 블라우스', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#f6ece0"/>' + neckHole(skin) +
          '<path d="M39 70 C42 79 58 79 61 70 C57 67 43 67 39 70 Z" fill="#fcf7ef"/>' +
          '<path d="M39 70 C42 79 58 79 61 70" stroke="#e3d5c0" stroke-width="1.2" fill="none"/>' +
          '<path d="M44 78 L50 82 L56 78 L53 87 L47 87 Z" fill="#efdcc6"/>' +
          '<circle cx="50" cy="81.5" r="2.2" fill="#e0c9ab"/>' +
          '<rect x="58" y="87" width="8" height="7.5" rx="1.5" fill="none" stroke="#e3d5c0" stroke-width="1.1"/>';
      } },
    { id: 'f-cardi', name: '핑크 가디건', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#eec4cc"/>' + neckHole(skin) +
          '<path d="M44 73 L50 84 L56 73 L56 100 L44 100 Z" fill="#fbf3f4"/>' +
          '<path d="M43 71 L43 100" stroke="#dda9b4" stroke-width="1.6" fill="none"/>' +
          '<path d="M57 71 L57 100" stroke="#dda9b4" stroke-width="1.6" fill="none"/>' +
          '<path d="M40 69 L50 84 L60 69" stroke="#dda9b4" stroke-width="1.2" fill="none"/>' +
          '<circle cx="50" cy="89" r="1.6" fill="#dda9b4"/><circle cx="50" cy="96" r="1.6" fill="#dda9b4"/>';
      } },
    { id: 'f-sweater', name: '하늘색 스웨터', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#bad0e6"/>' + neckHole(skin) +
          '<path d="M40 69 C44 80 56 80 60 69" stroke="#a3bcd6" stroke-width="3" fill="none"/>' +
          '<path d="M30 86 C40 82 60 82 70 86" stroke="#a3bcd6" stroke-width="1.4" fill="none"/>' +
          '<path d="M27 94 C40 90 60 90 73 94" stroke="#a3bcd6" stroke-width="1.4" fill="none"/>';
      } },
    { id: 'f-tie', name: '화이트 셔츠 (리본타이)', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#f7f7fa"/>' + neckHole(skin) +
          '<path d="M42 69 L50 82 L58 69 L55 68 L50 76 L45 68 Z" fill="#eceef4"/>' +
          collar('#fdfdff', '#d9dce6') +
          '<path d="M50 84 L50 100" stroke="#d9dce6" stroke-width="1.2"/>' +
          '<path d="M45 79 L50 83 L55 79 L53 88 L47 88 Z" fill="#2f2f36"/>' +
          '<circle cx="50" cy="82.5" r="2" fill="#1f1f25"/>';
      } },
    { id: 'f-shirt', name: '올리브 셔츠', sex: 'f', draw: function (skin) {
        return '<path d="' + BODY + '" fill="#9aa383"/>' + neckHole(skin) +
          '<path d="M42 69 L50 82 L58 69 L55 68 L50 76 L45 68 Z" fill="#8a9374"/>' +
          collar('#a7b090', '#7d8768') +
          '<path d="M50 84 L50 100" stroke="#7d8768" stroke-width="1.2"/>' +
          '<circle cx="50" cy="89" r="1.5" fill="#e9ecdf"/><circle cx="50" cy="96" r="1.5" fill="#e9ecdf"/>' +
          '<rect x="59" y="86" width="9" height="8" rx="1.5" fill="none" stroke="#7d8768" stroke-width="1.1"/>';
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
      '<ellipse cx="31" cy="48" rx="3.5" ry="4.5" fill="' + skin.shade + '"/>' +
      '<ellipse cx="69" cy="48" rx="3.5" ry="4.5" fill="' + skin.shade + '"/>' +
      '<path d="M43 56 h14 v13 q-7 5 -14 0 Z" fill="' + skin.shade + '"/>' +
      '<ellipse cx="50" cy="45" rx="19" ry="20.5" fill="' + skin.base + '"/>';

    /* 눈은 크고 둥글게, 위쪽에 굵은 속눈썹 선을 하나 얹는다.
     * 하이라이트 두 점(큰 것 위 · 작은 것 아래)이 이 그림체의 핵심이다. */
    function eye(cx) {
      return '<path d="M' + (cx - 3.6) + ' 43.6 C' + (cx - 2.6) + ' 41.8 ' + (cx + 2.6) + ' 41.8 ' + (cx + 3.6) + ' 43.6" ' +
          'stroke="#3d2a22" stroke-width="1.9" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="' + cx + '" cy="47.4" rx="3.3" ry="4.2" fill="#3d2a22"/>' +
        '<circle cx="' + (cx - 1.1) + '" cy="45.8" r="1.45" fill="#fff" opacity=".95"/>' +
        '<circle cx="' + (cx + 1.3) + '" cy="49.2" r="0.75" fill="#fff" opacity=".7"/>';
    }

    var face =
      '<path d="M38 39.6 C40.6 37.9 45 37.9 47 39.7" stroke="#6b4a35" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".85"/>' +
      '<path d="M53 39.7 C55 37.9 59.4 37.9 62 39.6" stroke="#6b4a35" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".85"/>' +
      eye(42.2) + eye(57.8) +
      '<ellipse cx="34.8" cy="53.5" rx="4.4" ry="2.5" fill="#ee9d9c" opacity=".45"/>' +
      '<ellipse cx="65.2" cy="53.5" rx="4.4" ry="2.5" fill="#ee9d9c" opacity=".45"/>' +
      '<path d="M47.6 56.2 C49 58 51 58 52.4 56.2" stroke="#b5645d" stroke-width="1.6" fill="none" stroke-linecap="round"/>';

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
