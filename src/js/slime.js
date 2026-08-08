/* =========================================================================
 * slime.js — 모리 키우기 (홈 화면의 방치형 타이쿤)
 *
 * 공부한 시간이 곧 돈이 되는 게임이다.
 *   순공 1분 → 젤리 1개  (아직 안 바꾼 시간을 '정산' 버튼으로 한 번에 받는다)
 *   젤리로 밥을 주면 모리가 자라고, 농장을 사면 자는 동안에도 젤리가 쌓인다.
 *
 * "안 하면 손해" 로 몰지 않는 게 원칙이다. 오래 안 들어와도 잃는 건 없고,
 * 오프라인 생산이 접시 용량까지만 차서 멈출 뿐이다. 공부 기록을 건드리지도 않는다.
 * (StudyLog 는 읽기만 한다 — 게임 때문에 순공 시간이 늘어나는 일은 없다)
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'neurostudy.slime.v1';
  var MAX_PAT_PER_DAY = 20;      // 쓰다듬기로 무한정 벌지 못하게 하루 상한을 둔다
  var HUNGRY_HOURS = 18;         // 이만큼 안 먹으면 배고픔 — 자동 생산이 절반이 된다

  var toast = function () { /* app.js 가 init 에서 꽂아 준다 */ };
  var root = null;
  var timer = null;

  /* ------------------------------------------------------------- 저장소 */

  function blank() {
    return {
      v: 1,
      jelly: 0,
      xp: 0,
      fed: 0,
      claimedMin: 0,          // 지금까지 젤리로 바꾼 순공 분(누적)
      pats: 0,
      patDay: '',
      patCount: 0,
      ups: { farm: 0, dish: 0, train: 0 },
      dex: {},                // 떠나보낸 모리 도감 { 종류id: 마리수 }
      raised: 0,              // 지금까지 다 키워 떠나보낸 마리 수
      lastTick: Date.now(),
      fedAt: Date.now(),
      born: Date.now()
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return blank();
      var b = blank();
      // 저장된 값이 깨져 있어도 게임이 멈추지 않게 항목별로 받아 낸다
      Object.keys(b).forEach(function (k) {
        if (k === 'ups' || k === 'dex') return;
        if (typeof d[k] === typeof b[k] && d[k] !== null) b[k] = d[k];
      });
      if (d.ups) ['farm', 'dish', 'train'].forEach(function (k) {
        if (typeof d.ups[k] === 'number' && d.ups[k] >= 0) b.ups[k] = Math.floor(d.ups[k]);
      });
      // 도감은 아는 종류만 받는다 — 손댄 저장값으로 없는 칸이 생기지 않게
      if (d.dex && typeof d.dex === 'object') {
        SPECIES.forEach(function (s) {
          var n = d.dex[s.id];
          if (typeof n === 'number' && n > 0) b.dex[s.id] = Math.floor(n);
        });
      }
      return b;
    } catch (e) { return blank(); }
  }

  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ }
  }

  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }

  /* 하루 상한은 앱의 다른 날짜 계산과 같은 기준(현지 시각)을 써야 한다.
   * toISOString 은 UTC 라 한국에서는 오전 9시에 날이 바뀌어 버린다. */
  function todayKey() {
    if (global.Store && global.Store.key) return global.Store.key();
    var t = new Date();
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  }

  /* --------------------------------------------------------- 성장 단계 */

  /* 밸런스 기준 — 한 마리를 다 키우는 데 순공 10시간 안팎.
   * 순공 1분 = 젤리 1개, 밥 한 번에 22 경험치이므로 Lv.6(450 경험치)까지는
   * 스무 번 남짓 먹이면 된다. 다 키우면 떠나보내고 새로 받으므로, 한 판이
   * 너무 길면 도감을 모으는 재미가 사라지고 너무 짧으면 키운 것 같지가 않다. */
  var GROWN_LEVEL = 6;               // 이 레벨이 되면 다 자란 것으로 본다

  /** 그 레벨을 끝내는 데 필요한 경험치 */
  function needFor(lv) { return 40 + (lv - 1) * 25; }

  function levelOf(xp) {
    var lv = 1, rem = Math.max(0, xp);
    while (lv < GROWN_LEVEL && rem >= needFor(lv)) { rem -= needFor(lv); lv++; }
    return { level: lv, inLevel: Math.round(rem), need: needFor(lv) };
  }

  function isGrown(d) { return levelOf(d.xp).level >= GROWN_LEVEL; }

  /* 겉모습은 단계마다 달라진다 — scale 은 몸 크기, deco 는 머리 위 장식.
   * SVG 를 통째로 갈아 끼우는 대신 값만 바꾼다. */
  var STAGES = [
    { min: 1, name: '아기 모리', scale: 0.78, deco: 'none',  line: '이제 막 태어난 말랑한 슬라임이에요.' },
    { min: 2, name: '통통 모리', scale: 0.86, deco: 'leaf',  line: '밥을 잘 먹어서 제법 통통해졌어요.' },
    { min: 3, name: '반짝 모리', scale: 0.94, deco: 'spark', line: '몸에서 반짝반짝 빛이 나기 시작했어요!' },
    { min: 4, name: '별빛 모리', scale: 1.02, deco: 'star',  line: '머리 위에 작은 별이 앉았어요.' },
    { min: 5, name: '왕관 모리', scale: 1.09, deco: 'crown', line: '슬라임 왕국의 왕이 되었어요.' },
    { min: 6, name: '다 자란 모리', scale: 1.16, deco: 'halo', line: '다 자랐어요! 이제 어떤 모리가 될지 정해집니다.' }
  ];

  /* ------------------------------------------------------------- 도감
   * 다 자란 모리를 떠나보내면 이 중 하나가 되어 도감에 남고, 새 알이 온다.
   * 무엇이 될지는 떠나보내는 순간에 정해진다 — 키우는 동안에는 아무도 모른다.
   *
   * 색은 앱의 보라 축을 벗어나지 않는 선에서 고른다(초록·노랑 계열은 쓰지 않는다).
   * weight 가 뽑기 확률이고, 합이 100 이 되게 맞춰 두었다. */
  var SPECIES = [
    { id: 'grape',   name: '포도 모리',   weight: 22, rare: '흔함',
      grad: ['#d3c2ff', '#9b7bff', '#6d4aff'], deco: 'none',
      line: '가장 흔하지만 가장 든든한 모리예요.' },
    { id: 'sky',     name: '하늘 모리',   weight: 20, rare: '흔함',
      grad: ['#c3d6ff', '#8aa6ff', '#4f6ce0'], deco: 'none',
      line: '맑은 날 하늘을 닮았어요.' },
    { id: 'sunset',  name: '노을 모리',   weight: 18, rare: '흔함',
      grad: ['#ffd0e0', '#ff9ab5', '#d4506a'], deco: 'none',
      line: '해 질 녘 하늘빛을 그대로 머금었어요.' },
    { id: 'cloud',   name: '구름 모리',   weight: 15, rare: '흔함',
      grad: ['#f3efff', '#dcd2ff', '#b6a6f0'], deco: 'none',
      line: '만지면 폭신폭신할 것 같아요.' },
    { id: 'amethyst', name: '자수정 모리', weight: 10, rare: '귀함',
      grad: ['#e6d4ff', '#a86fe8', '#5b2ea6'], deco: 'spark',
      line: '몸이 보석처럼 단단하게 빛나요.' },
    { id: 'night',   name: '밤하늘 모리', weight: 8, rare: '귀함',
      grad: ['#4a4a8f', '#2a2560', '#141033'], deco: 'star',
      line: '몸 안에 작은 별들이 떠 있어요.' },
    { id: 'ghost',   name: '유령 모리',   weight: 5, rare: '귀함',
      grad: ['#ffffff', '#e4dcff', '#b9a9ee'], deco: 'none', ghost: true,
      line: '반쯤 비쳐 보여요. 밤에만 나타난대요.' },
    { id: 'rainbow', name: '무지개 모리', weight: 2, rare: '아주 귀함',
      grad: ['#ffd0e0', '#c6a4ff', '#7aa2ff'], deco: 'halo', shine: true,
      line: '아주 드물게 나타나는 전설의 모리예요.' }
  ];

  function speciesBy(id) {
    for (var i = 0; i < SPECIES.length; i++) if (SPECIES[i].id === id) return SPECIES[i];
    return null;
  }

  /** 무게를 실은 뽑기 */
  function rollSpecies() {
    var total = 0;
    SPECIES.forEach(function (s) { total += s.weight; });
    var r = Math.random() * total;
    for (var i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].weight;
      if (r < 0) return SPECIES[i];
    }
    return SPECIES[0];
  }

  function stageFor(level) {
    var s = STAGES[0];
    STAGES.forEach(function (x) { if (level >= x.min) s = x; });
    return s;
  }

  function nextStage(level) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].min > level) return STAGES[i];
    return null;
  }

  /* ------------------------------------------------------------ 업그레이드 */

  var UPGRADES = [
    {
      id: 'farm', icon: '🌱', name: '젤리 농장',
      desc: '자는 동안에도 젤리가 저절로 쌓입니다.',
      base: 30, mult: 1.7, max: 25,
      effect: function (n) { return (n * 0.6).toFixed(1) + ' 젤리/분'; }
    },
    {
      id: 'dish', icon: '🥣', name: '큰 접시',
      desc: '앱을 닫아 둔 동안 농장이 채울 수 있는 시간이 늘어납니다.',
      base: 60, mult: 1.8, max: 10,
      effect: function (n) { return (2 + n * 2) + '시간까지 보관'; }
    },
    {
      id: 'train', icon: '📖', name: '공부 특훈',
      desc: '순공 시간을 정산할 때 받는 젤리가 늘어납니다.',
      base: 80, mult: 1.9, max: 12,
      effect: function (n) { return '정산 ×' + (1 + n * 0.25).toFixed(2); }
    }
  ];

  function upgradeBy(id) {
    for (var i = 0; i < UPGRADES.length; i++) if (UPGRADES[i].id === id) return UPGRADES[i];
    return null;
  }

  function costOf(u, n) { return Math.round(u.base * Math.pow(u.mult, n)); }

  function farmRate(d) { return d.ups.farm * 0.6; }          // 분당 젤리
  function offlineCapMin(d) { return (2 + d.ups.dish * 2) * 60; }
  function claimMult(d) { return 1 + d.ups.train * 0.25; }

  /* ------------------------------------------------------- 배고픔·자동 생산 */

  function hoursSinceFed(d) { return (Date.now() - (d.fedAt || Date.now())) / 3600000; }
  function isHungry(d) { return hoursSinceFed(d) >= HUNGRY_HOURS; }

  function moodOf(d) {
    var h = hoursSinceFed(d);
    if (h < 6) return { emoji: '😊', label: '배부름', line: '기분이 아주 좋아요.' };
    if (h < HUNGRY_HOURS) return { emoji: '🙂', label: '보통', line: '슬슬 간식 생각이 나요.' };
    return { emoji: '🥺', label: '배고픔', line: '배가 고파서 젤리를 반밖에 못 모아요.' };
  }

  /** 마지막으로 본 시각부터 지금까지 농장이 모은 젤리를 넣어 준다.
   * 접시 용량(offlineCapMin)을 넘는 시간은 버린다 — 며칠 만에 들어와서
   * 갑자기 부자가 되면 공부로 버는 쪽이 의미를 잃는다. */
  function accrue(d) {
    var now = Date.now();
    var last = d.lastTick || now;
    var mins = (now - last) / 60000;
    if (!(mins > 0)) { d.lastTick = now; return 0; }
    mins = Math.min(mins, offlineCapMin(d));
    var rate = farmRate(d) * (isHungry(d) ? 0.5 : 1);
    var got = mins * rate;
    d.jelly += got;
    d.lastTick = now;
    return got;
  }

  /* ---------------------------------------------------- 순공 시간 정산 */

  /** 기록에 남은 순공 시간 전체(분) */
  function totalStudyMin() {
    var all = global.StudyLog ? global.StudyLog.all() : {};
    var sum = 0;
    Object.keys(all).forEach(function (day) {
      var m = all[day];
      Object.keys(m).forEach(function (s) { sum += (m[s] && m[s].m) || 0; });
    });
    return sum;
  }

  function pendingMin(d) { return Math.max(0, totalStudyMin() - (d.claimedMin || 0)); }

  /* ------------------------------------------------------------ 그리기 */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtJelly(n) {
    n = Math.floor(n);
    if (n >= 100000) return Math.floor(n / 1000) + 'k';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtMin(m) {
    m = Math.round(m);
    if (m < 60) return m + '분';
    return Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
  }

  /* 그라데이션 id 는 문서 전체에서 유일해야 한다. 도감처럼 한 화면에 여러 마리를
   * 그릴 때 같은 id 를 쓰면 먼저 그려진 색이 나머지를 전부 덮어쓴다. */
  var svgSeq = 0;

  /**
   * 슬라임 SVG.
   *   stage    — 크기와 머리 장식 (키우는 중)
   *   species  — 도감 종류. 주면 몸 색과 장식을 그쪽으로 덮어쓴다.
   */
  function slimeSvg(stage, hungry, species) {
    var s = stage.scale;
    var uid = 'slB' + (++svgSeq);
    var grad = (species && species.grad) || ['#c9b6ff', '#9b7bff', '#6d4aff'];
    var decoKind = species ? (species.deco || 'none') : stage.deco;
    var label = species ? species.name : stage.name;

    var deco = '';
    if (decoKind === 'leaf') {
      deco = '<path d="M60 22 q10 -12 20 -6 q-4 12 -18 12 z" fill="#7ec98f" opacity=".9"/>' +
        '<path d="M60 22 q-2 6 0 8" stroke="#4f8f5f" stroke-width="2" fill="none"/>';
    } else if (decoKind === 'spark') {
      deco = '<g fill="#ffd76a"><path d="M28 26 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z"/>' +
        '<path d="M92 34 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z"/></g>';
    } else if (decoKind === 'star') {
      deco = '<path d="M60 8 l4.6 9.6 10.4 1.5 -7.5 7.4 1.8 10.5 -9.3 -5 -9.3 5 1.8 -10.5 -7.5 -7.4 10.4 -1.5 z" ' +
        'fill="#ffd76a" stroke="#e0ae2f" stroke-width="1.5" stroke-linejoin="round"/>';
    } else if (decoKind === 'crown') {
      deco = '<path d="M42 30 l0 -16 10 8 8 -12 8 12 10 -8 0 16 z" fill="#ffcf5a" stroke="#dfa72c" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="60" cy="22" r="2.6" fill="#ff7fa6"/>';
    } else if (decoKind === 'halo') {
      deco = '<ellipse cx="60" cy="18" rx="26" ry="7" fill="none" stroke="#ffd76a" stroke-width="4" opacity=".95"/>' +
        '<g fill="#fff" opacity=".85"><circle cx="24" cy="44" r="2"/><circle cx="98" cy="52" r="2.4"/><circle cx="16" cy="70" r="1.6"/></g>';
    }

    return '' +
      '<svg class="sl-svg' + (species && species.shine ? ' is-shine' : '') + '" viewBox="0 0 120 110" role="img" aria-label="' + esc(label) + '">' +
      '<defs>' +
      '<radialGradient id="' + uid + '" cx="38%" cy="30%" r="78%">' +
      '<stop offset="0%" stop-color="' + grad[0] + '"/>' +
      '<stop offset="55%" stop-color="' + grad[1] + '"/>' +
      '<stop offset="100%" stop-color="' + grad[2] + '"/>' +
      '</radialGradient>' +
      '</defs>' +
      '<ellipse class="sl-shadow" cx="60" cy="100" rx="' + (34 * s).toFixed(1) + '" ry="6"/>' +
      deco +
      // 크기(단계)는 SVG transform 으로, 말랑거리는 움직임은 CSS transform 으로 나눠 건다.
      // 한 요소에 둘 다 걸면 애니메이션이 크기를 덮어써서 단계가 안 보인다.
      '<g transform="translate(60 96) scale(' + s.toFixed(2) + ') translate(-60 -96)">' +
      '<g class="sl-body" style="transform-origin:60px 96px"' +
        (species && species.ghost ? ' opacity=".62"' : '') + '>' +
      // 몸통 — 아래는 퍼지고 위는 둥근 물방울
      '<path d="M60 34 c20 0 34 22 34 38 c0 14 -15 22 -34 22 c-19 0 -34 -8 -34 -22 c0 -16 14 -38 34 -38 z" fill="url(#' + uid + ')"/>' +
      '<ellipse cx="47" cy="52" rx="9" ry="6" fill="#fff" opacity=".38"/>' +
      (hungry
        ? '<path d="M50 66 q3 -5 6 0" stroke="#2b1f5e" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M64 66 q3 -5 6 0" stroke="#2b1f5e" stroke-width="3" fill="none" stroke-linecap="round"/>'
        : '<ellipse class="sl-eye" cx="52" cy="66" rx="3.4" ry="4.4" fill="#2b1f5e"/>' +
          '<ellipse class="sl-eye" cx="68" cy="66" rx="3.4" ry="4.4" fill="#2b1f5e"/>') +
      '<ellipse cx="43" cy="74" rx="5" ry="3" fill="#ff9dbb" opacity=".55"/>' +
      '<ellipse cx="77" cy="74" rx="5" ry="3" fill="#ff9dbb" opacity=".55"/>' +
      '<path d="M55 74 q5 5 10 0" stroke="#2b1f5e" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      '</g></g></svg>';
  }

  function view() {
    var d = load();
    accrue(d);
    save(d);

    var lv = levelOf(d.xp);
    var stage = stageFor(lv.level);
    var nx = nextStage(lv.level);
    var mood = moodOf(d);
    var pend = pendingMin(d);
    return { d: d, lv: lv, stage: stage, next: nx, mood: mood, pend: pend };
  }

  /* ------------------------------------------------------- 응원 말풍선
   * 모리가 머리 위로 한마디 한다. 지금 해야 할 일이 있으면 그것부터 말하고,
   * 없으면 응원 문구를 돌린다. 12초마다 바뀌어 살아 있는 느낌을 준다.
   *
   * 공부를 안 했다고 타박하지 않는다 — 다그치는 캐릭터는 앱을 열기 싫게 만든다. */
  var CHEERS = [
    '오늘도 와 줘서 고마워요!',
    '한 블록만 해 봐요. 제가 옆에 있을게요.',
    '조금씩 해도 쌓이면 커져요. 저처럼요!',
    '집중한 시간은 저를 자라게 해요.',
    '쉬는 것도 공부의 일부예요.',
    '어제보다 1분만 더 해 봐요.',
    '잘하고 있어요. 진짜로요.',
    '책상 앞에 앉은 것만으로 절반은 온 거예요.',
    '오늘 못 해도 괜찮아요. 내일 또 만나요.',
    '물 한 잔 마시고 올까요?',
    '어깨 한 번 펴 볼까요?',
    '당신이 공부하면 저는 젤리를 먹어요. 같이 힘내요!'
  ];
  var CHEER_MS = 12000;

  function cheerFor(d) {
    if (isHungry(d)) return '배고파요… 밥 주세요!';
    if (isGrown(d)) return '다 자랐어요! 이제 떠날 준비가 됐어요.';
    if (pendingMin(d) >= 25) return '공부한 시간이 쌓였어요. 정산해 주세요!';
    var i = Math.floor(Date.now() / CHEER_MS) % CHEERS.length;
    return CHEERS[i];
  }

  /* --------------------------------------------------------- 떠나보내기
   * 다 자란 모리는 어떤 종류가 될지 정해져 도감에 남고, 자리에는 새 알이 온다.
   * 자동으로 하지 않고 버튼으로 두는 이유 — 애써 키운 걸 묻지도 않고 치워 버리면
   * 보상이 아니라 상실이 된다. 언제 보낼지는 키운 사람이 정한다. */
  function graduate() {
    var d = load();
    accrue(d);
    if (!isGrown(d)) { save(d); return null; }

    var sp = rollSpecies();
    d.dex[sp.id] = (d.dex[sp.id] || 0) + 1;
    d.raised = (d.raised || 0) + 1;

    // 새 알로 되돌린다. 젤리와 업그레이드(농장·접시·특훈)는 그대로 남는다 —
    // 그건 모리가 아니라 키우는 사람이 쌓은 것이다.
    d.xp = 0;
    d.fed = 0;
    d.fedAt = Date.now();
    d.born = Date.now();
    save(d);
    return sp;
  }

  function dexCount(d) {
    var got = 0;
    SPECIES.forEach(function (s) { if (d.dex[s.id]) got++; });
    return got;
  }

  function render() {
    if (!root) return;
    var v = view(), d = v.d;
    var hungry = isHungry(d);
    var pendJelly = Math.floor(v.pend * claimMult(d));
    var today = todayKey();
    var patsLeft = d.patDay === today ? Math.max(0, MAX_PAT_PER_DAY - d.patCount) : MAX_PAT_PER_DAY;
    var feedCost = feedCostOf(d);

    var grown = isGrown(d);

    root.innerHTML =
      '<div class="sl-main">' +
        '<div class="sl-stage">' +
          '<p class="sl-bubble" id="slBubble">' + esc(cheerFor(d)) + '</p>' +
          '<button type="button" class="sl-tap' + (patsLeft ? '' : ' is-spent') + '" id="slTap" ' +
            'aria-label="모리 쓰다듬기">' + slimeSvg(v.stage, hungry) + '</button>' +
          '<div class="sl-name"><b>' + esc(v.stage.name) + '</b><span>Lv.' + v.lv.level + '</span></div>' +
          '<p class="sl-line">' + esc(hungry ? v.mood.line : v.stage.line) + '</p>' +
          (grown
            ? '<button type="button" class="btn primary sl-grad" id="slGrad">🎓 떠나보내고 도감에 남기기</button>' +
              '<p class="tiny sl-xp-cap">어떤 모리가 될지는 보내는 순간 정해져요. 새 알이 곧바로 옵니다.</p>'
            : '<div class="sl-xp"><span style="width:' + Math.round(v.lv.inLevel / v.lv.need * 100) + '%"></span></div>' +
              '<p class="tiny sl-xp-cap">경험치 ' + v.lv.inLevel + ' / ' + v.lv.need +
                (v.next ? ' · Lv.' + v.next.min + ' 에 <b>' + esc(v.next.name) + '</b> 로 자라요' : '') + '</p>') +
        '</div>' +

        '<div class="sl-side">' +
          '<div class="sl-facts">' +
            '<div class="sl-fact"><span>기분</span><b>' + v.mood.emoji + ' ' + esc(v.mood.label) + '</b></div>' +
            '<div class="sl-fact"><span>자동 생산</span><b>' +
              (farmRate(d) > 0 ? (farmRate(d) * (hungry ? 0.5 : 1)).toFixed(1) + ' /분' : '없음') + '</b></div>' +
            '<div class="sl-fact"><span>정산 배율</span><b>×' + claimMult(d).toFixed(2) + '</b></div>' +
            '<div class="sl-fact"><span>밥 먹인 횟수</span><b>' + d.fed + '회</b></div>' +
          '</div>' +

          '<button type="button" class="btn primary sl-claim" id="slClaim"' + (pendJelly > 0 ? '' : ' disabled') + '>' +
            (pendJelly > 0
              ? '📚 공부 ' + esc(fmtMin(v.pend)) + ' 정산 → ✨' + fmtJelly(pendJelly)
              : '📚 정산할 공부 시간이 없어요') +
          '</button>' +
          '<p class="tiny sl-claim-cap">타이머로 잰 순공 시간 <b>1분이 젤리 1개</b>입니다. 공부하고 와서 정산하세요.</p>' +

          '<div class="sl-acts">' +
            '<button type="button" class="btn sl-feed" id="slFeed"' + (d.jelly >= feedCost ? '' : ' disabled') + '>' +
              '🍮 밥 주기 <em>✨' + fmtJelly(feedCost) + '</em></button>' +
            '<span class="tiny sl-pat-left">쓰다듬기 ' + patsLeft + '회 남음</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="sl-shop">' +
        UPGRADES.map(function (u) {
          var n = d.ups[u.id];
          var maxed = n >= u.max;
          var c = costOf(u, n);
          return '<div class="sl-up' + (maxed ? ' is-max' : '') + '">' +
            '<div class="su-head"><span class="su-icon">' + u.icon + '</span>' +
              '<div><b>' + esc(u.name) + '</b><span class="su-lv">Lv.' + n + '</span></div></div>' +
            '<p class="su-desc">' + esc(u.desc) + '</p>' +
            '<p class="su-now">지금 · <b>' + esc(u.effect(n)) + '</b>' +
              (maxed ? '' : ' → ' + esc(u.effect(n + 1))) + '</p>' +
            (maxed
              ? '<button type="button" class="btn ghost sm" disabled>최대</button>'
              : '<button type="button" class="btn sm su-buy" data-up="' + u.id + '"' +
                (d.jelly >= c ? '' : ' disabled') + '>✨' + fmtJelly(c) + '</button>') +
            '</div>';
        }).join('') +
      '</div>' +

      /* 도감 — 아직 못 만난 종류는 실루엣으로만 보여 준다.
       * 무엇이 남았는지는 알려 주되 어떻게 생겼는지는 만나서 알게 한다. */
      '<div class="sl-dex">' +
        '<div class="sl-dex-head"><b>📖 모리 도감</b>' +
          '<span>' + dexCount(d) + ' / ' + SPECIES.length + ' 종 · 지금까지 ' + (d.raised || 0) + '마리</span></div>' +
        '<div class="sl-dex-grid">' +
          SPECIES.map(function (sp) {
            var n = d.dex[sp.id] || 0;
            var fig = n
              ? slimeSvg({ scale: 0.95, deco: sp.deco, name: sp.name }, false, sp)
              : '<span class="sd-unknown" aria-hidden="true">?</span>';
            return '<div class="sd-cell' + (n ? ' got' : '') + '"' +
              (n ? ' title="' + esc(sp.line) + '"' : '') + '>' +
              '<div class="sd-fig">' + fig + (n > 1 ? '<span class="sd-n">×' + n + '</span>' : '') + '</div>' +
              '<b>' + (n ? esc(sp.name) : '???') + '</b>' +
              '<span class="sd-rare">' + esc(sp.rare) + '</span>' +
              '</div>';
          }).join('') +
        '</div>' +
      '</div>';

    var tap = document.getElementById('slTap');
    if (tap) tap.addEventListener('click', pat);
    var claim = document.getElementById('slClaim');
    if (claim) claim.addEventListener('click', claim1);
    var feed = document.getElementById('slFeed');
    if (feed) feed.addEventListener('click', feed1);
    var grad = document.getElementById('slGrad');
    if (grad) grad.addEventListener('click', sendOff);
    Array.prototype.forEach.call(root.querySelectorAll('.su-buy'), function (b) {
      b.addEventListener('click', function () { buy(b.dataset.up); });
    });

    paintJelly(d.jelly);
  }

  /** 말풍선만 갈아 끼운다 — 12초마다 화면 전체를 다시 그릴 이유가 없다 */
  function paintBubble() {
    var el = document.getElementById('slBubble');
    if (!el) return;
    var t = cheerFor(load());
    if (el.textContent === t) return;
    el.textContent = t;
    el.classList.remove('is-new');
    void el.offsetWidth;
    el.classList.add('is-new');
  }

  /** 젤리 숫자만 갱신한다 — 1초마다 화면 전체를 다시 그리면 버튼 포커스가 튄다 */
  function paintJelly(n) {
    var el = document.getElementById('slJelly');
    if (el) el.textContent = '✨ ' + fmtJelly(n);
  }

  /** 밥값은 먹일수록 오르되 60에서 멈춘다 — 끝없이 오르면 후반이 벽이 된다 */
  function feedCostOf(d) { return Math.min(60, 10 + d.fed * 2); }
  var XP_PER_FEED = 22;

  /* ------------------------------------------------------------ 동작 */

  function pat() {
    var d = load();
    accrue(d);
    var today = todayKey();
    if (d.patDay !== today) { d.patDay = today; d.patCount = 0; }
    if (d.patCount >= MAX_PAT_PER_DAY) {
      toast('오늘은 충분히 쓰다듬었어요. 젤리는 공부해서 모아 주세요!');
      save(d);
      return;
    }
    var got = 1 + Math.floor(Math.random() * 3);
    d.patCount++; d.pats++;
    d.jelly += got;
    d.xp += 1;
    save(d);

    var el = root && root.querySelector('.sl-body');
    if (el) { el.classList.remove('is-boing'); void el.offsetWidth; el.classList.add('is-boing'); }
    popText('+' + got);
    paintJelly(d.jelly);
    // 남은 횟수·경험치 막대도 따라가야 하므로 다시 그린다 (튐 방지용으로 살짝 미룬다)
    clearTimeout(pat._t);
    pat._t = setTimeout(render, 420);
  }

  function popText(txt) {
    if (!root) return;
    var stage = root.querySelector('.sl-stage');
    if (!stage) return;
    var s = document.createElement('span');
    s.className = 'sl-pop';
    s.textContent = txt;
    s.style.left = (38 + Math.random() * 24) + '%';
    stage.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 900);
  }

  function claim1() {
    var d = load();
    accrue(d);
    var pend = pendingMin(d);
    if (!(pend > 0)) { toast('아직 정산할 순공 시간이 없습니다. 타이머로 공부부터!', true); save(d); return; }
    var got = Math.floor(pend * claimMult(d));
    d.jelly += got;
    d.claimedMin = totalStudyMin();
    save(d);
    render();
    popText('+' + fmtJelly(got));
    toast('순공 ' + fmtMin(pend) + '을 젤리 ' + fmtJelly(got) + '개로 바꿨어요!', 'party');
  }

  function feed1() {
    var d = load();
    accrue(d);
    var cost = feedCostOf(d);
    if (d.jelly < cost) { toast('젤리가 모자라요. 공부 시간을 정산해 보세요.', true); save(d); return; }
    var before = levelOf(d.xp).level;
    d.jelly -= cost;
    d.fed++;
    d.fedAt = Date.now();
    d.xp += XP_PER_FEED;
    save(d);
    var after = levelOf(d.xp).level;
    render();
    popText('🍮');
    if (after > before) {
      var st = stageFor(after), prev = stageFor(before);
      if (st.name !== prev.name) toast('모리가 ' + st.name + ' 로 자랐어요! 🎉', 'party');
      else toast('레벨 ' + after + ' 이 됐어요!', 'party');
    } else {
      toast('모리가 맛있게 먹었어요.');
    }
  }

  /** 다 자란 모리를 떠나보내고 도감에 남긴다 */
  function sendOff() {
    var d = load();
    if (!isGrown(d)) { toast('아직 다 자라지 않았어요.', true); return; }
    if (!confirm('다 자란 모리를 떠나보낼까요?\n\n어떤 종류가 될지 지금 정해져 도감에 남고,\n자리에는 새 알이 옵니다. 젤리와 업그레이드는 그대로예요.')) return;

    var sp = graduate();
    if (!sp) return;
    render();
    popText('🎓');
    var again = (load().dex[sp.id] || 0) > 1;
    toast(sp.name + (again ? ' 이(가) 또 나왔어요!' : ' 이(가) 도감에 새로 들어왔어요!') + ' — ' + sp.rare, 'party');
  }

  function buy(id) {
    var u = upgradeBy(id);
    if (!u) return;
    var d = load();
    accrue(d);
    var n = d.ups[id];
    if (n >= u.max) { save(d); return; }
    var c = costOf(u, n);
    if (d.jelly < c) { toast('젤리가 모자라요.', true); save(d); return; }
    d.jelly -= c;
    d.ups[id] = n + 1;
    save(d);
    render();
    toast(u.name + ' Lv.' + (n + 1) + ' — ' + u.effect(n + 1));
  }

  /* ------------------------------------------------------------ 수명주기 */

  /** 홈 화면에 들어올 때 부른다 */
  function open(el) {
    root = el || root;
    render();
    stop();
    // 자동 생산이 쌓이는 걸 눈으로 보게 한다. 화면 전체가 아니라 숫자만 바꾼다.
    timer = setInterval(function () {
      var d = load();
      var got = accrue(d);
      if (got > 0) { save(d); paintJelly(d.jelly); }
      paintBubble();   // 응원 문구는 12초마다 바뀐다 (내용이 바뀔 때만 손댄다)
    }, 5000);
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  /** 홈에 안 들어가도 오프라인 생산 기준 시각은 살아 있어야 한다 */
  function touch() { var d = load(); accrue(d); save(d); }

  function summary() {
    var d = load();
    var lv = levelOf(d.xp);
    return {
      jelly: Math.floor(d.jelly), level: lv.level, stage: stageFor(lv.level).name,
      pending: Math.round(pendingMin(d)), grown: isGrown(d),
      dex: dexCount(d), dexTotal: SPECIES.length, raised: d.raised || 0
    };
  }

  /* ------------------------------------------- 다른 화면에서 젤리 쓰기
   * 꾸미기 화면에서 아바타를 사려면 젤리 잔액을 보고 깎을 수 있어야 한다.
   * 깎는 문은 여기 하나로 두어, 자동 생산 정산(accrue)을 빠뜨린 채
   * 옛날 잔액에서 빼는 일이 생기지 않게 한다. */

  function jelly() { var d = load(); accrue(d); save(d); return Math.floor(d.jelly); }

  /** 살 수 있으면 깎고 true. 모자라면 아무것도 하지 않고 false. */
  function spend(n) {
    n = Math.max(0, Math.round(n || 0));
    var d = load();
    accrue(d);
    if (d.jelly < n) { save(d); return false; }
    d.jelly -= n;
    save(d);
    paintJelly(d.jelly);
    return true;
  }

  /** 지금 모리의 모습 — 프로필 캐릭터로 쓸 수 있게 그림만 떼어 준다.
   * 레벨이 오르면 프로필 사진도 같이 자란다. */
  function faceSvg() {
    var d = load();
    var stage = stageFor(levelOf(d.xp).level);
    return slimeSvg(stage, isHungry(d));
  }

  global.Slime = {
    init: function (opt) { if (opt && opt.toast) toast = opt.toast; },
    open: open, stop: stop, render: render, touch: touch,
    summary: summary, reset: reset,
    jelly: jelly, spend: spend, faceSvg: faceSvg
  };

})(window);
