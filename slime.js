/* =========================================================================
 * slime.js — 모리 키우기 (홈 화면의 방치형 타이쿤)
 *
 * 공부한 시간이 곧 돈이 되는 게임이다.
 *   순공 30분 → 젤리 1개  (아직 안 바꾼 시간을 '정산' 버튼으로 한 번에 받는다)
 *   젤리로 밥을 주면 모리가 자라고, 농장을 사면 자는 동안에도 젤리가 쌓인다.
 *
 * 모리는 아기 슬라임으로 태어나 5단계를 거쳐 9종류의 '말랑이' 중 하나가 된다.
 * 무엇이 될지는 태어날 때 이미 정해져 있지만 3단계에서야 겉모습으로 드러난다 —
 * 그 순간이 이 게임에서 제일 재미있는 대목이라 일부러 미뤄 두었다.
 * 다 자란 말랑이는 '말랑이 홈' 으로 보내면 거기서 함께 살고 도감에 남는다.
 *
 * 잃는 것은 모리의 경험치 하나뿐이다. 오래 안 들어오면 모리가 조금씩 작아지지만,
 * 젤리·업그레이드·도감·홈은 그대로 남는다 — 그건 모리가 아니라 키우는 사람이 쌓은 것이다.
 * 공부 기록은 어떤 경우에도 건드리지 않는다.
 * (StudyLog 는 읽기만 한다 — 게임 때문에 순공 시간이 늘거나 줄지 않는다)
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'neurostudy.slime.v1';
  var MAX_PAT_PER_DAY = 20;      // 쓰다듬기로 무한정 벌지 못하게 하루 상한을 둔다
  var HUNGRY_HOURS = 18;         // 이만큼 안 먹으면 배고픔 — 자동 생산이 절반이 된다

  /* 젤리 1개를 받는 데 필요한 순공 시간(분).
   * 이 하나만 고치면 게임 전체의 속도가 함께 움직인다 —
   * 농장도 이 값에 대한 비율로 잡혀 있어 함께 따라온다.
   * '공부 특훈' 업그레이드를 올리면 이 시간이 더 짧아진다. */
  var MIN_PER_JELLY = 1;

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
      dex: {},                // 홈으로 보낸 말랑이 도감 { 종류id: 마리수 }
      sp: '',                 // 지금 키우는 아이가 될 종류 (태어날 때 정해진다)
      raised: 0,              // 지금까지 다 키워 홈으로 보낸 마리 수
      decayNote: 0,           // 오래 안 와서 줄어든 경험치 (한 번 알려 주고 0 으로)
      lastTick: Date.now(),
      fedAt: Date.now(),
      born: Date.now()
    };
  }

  /* 옛 도감(색깔 이름 8종)을 새 말랑이 9종으로 옮긴다.
   * 같은 희귀도끼리 맞바꿔 두어 모아 둔 값어치가 그대로 남게 했다.
   * 만두 말랑이 한 자리는 비워 둔다 — 새로 모을 것이 하나는 있어야 한다. */
  var OLD_DEX_MAP = {
    grape: 'putty', sky: 'cheese', sunset: 'mango', cloud: 'potato',
    amethyst: 'bear', night: 'butter', ghost: 'soap', rainbow: 'wakku'
  };

  /* 처음 오는 사람에게도 종류는 정해져 있어야 한다.
   * blank() 가 그냥 빈 문자열을 주면 curSpecies 가 늘 첫 종류로 떨어져
   * 새로 시작한 사람은 영영 퍼티 슬라임만 만나게 된다. */
  function fresh() {
    var b = blank();
    b.sp = rollSpecies().id;
    return b;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return fresh();
      var b = blank();
      // 저장된 값이 깨져 있어도 게임이 멈추지 않게 항목별로 받아 낸다
      Object.keys(b).forEach(function (k) {
        if (k === 'ups' || k === 'dex' || k === 'sp') return;
        if (typeof d[k] === typeof b[k] && d[k] !== null) b[k] = d[k];
      });
      if (d.ups) ['farm', 'dish', 'train'].forEach(function (k) {
        if (typeof d.ups[k] === 'number' && d.ups[k] >= 0) b.ups[k] = Math.floor(d.ups[k]);
      });
      // 도감은 아는 종류만 받는다 — 손댄 저장값으로 없는 칸이 생기지 않게
      if (d.dex && typeof d.dex === 'object') {
        Object.keys(d.dex).forEach(function (id) {
          var to = speciesBy(id) ? id : OLD_DEX_MAP[id];
          var n = d.dex[id];
          if (!to || !speciesBy(to)) return;
          if (typeof n === 'number' && n > 0) b.dex[to] = (b.dex[to] || 0) + Math.floor(n);
        });
      }
      // 지금 키우는 종류. 예전 저장본에는 없으므로 그 자리에서 하나 뽑아 준다.
      b.sp = (typeof d.sp === 'string' && speciesBy(d.sp)) ? d.sp : rollSpecies().id;
      return b;
    } catch (e) { return fresh(); }
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

  /* ============================================================== 겉모습
   *
   * 몸 모양(FORMS) · 장식(DECOS) · 색(팔레트) 세 가지를 조합해 한 마리를 그린다.
   * 종류마다 SVG 를 통째로 쓰면 45장(9종 × 5단계)이 되어 손댈 수가 없다.
   * ========================================================================= */

  /* --- 팔레트. 가운데에서 바깥으로 가는 세 정거장이다. --- */
  var PURPLE    = ['#d3c2ff', '#9b7bff', '#6d4aff'];   // 아기 모리의 기본 보라
  /* 퍼티는 금속처럼 번들거려야 한다. 밝음→어두움 한 방향으로만 가면 무광 고무가 되므로
   * 흰 하이라이트 → 짙은 속 → 다시 밝은 테두리(바닥 반사) 로 다섯 정거장을 겹쳐
   * 크롬 구슬 같은 띠를 만든다. */
  var PUTTY     = ['#ffffff', '#ded1ff', '#9d80f5', '#5d3fc4', '#a184f5'];
  var WARMIX    = ['#f6dcff', '#b98cf0', '#f0a03a'];   // 보라 → 노랑 넘어가는 중
  var CHEESE    = ['#ffeaa8', '#ffcc4d', '#e0a114'];
  var BEAR      = ['#f4e4c8', '#d8bb92', '#a9855c'];   // 진한 갈색이 아니라 따뜻한 베이지
  var MANGOMIX  = ['#ffeec2', '#d9a6ee', '#f2c024'];
  var MANGO     = ['#fff4c2', '#ffd93d', '#f0a81c'];   // 주황보다 노랑 쪽으로
  var CREAM     = ['#fffaf0', '#f2e4c8', '#d4bd95'];
  /* 딸기 와꾸볼과 비누는 둘 다 분홍이라 색이 겹쳤다.
   * 와꾸볼은 따뜻한 산딸기 쪽, 비누는 차가운 장미 쪽으로 갈라 둔다. */
  var PINK      = ['#ffdee2', '#ff9aa6', '#e05f70'];
  var BLUE      = ['#dcf0ff', '#8ecbf6', '#4f96d8'];
  /* 무지개만 다섯 정거장을 쓴다 — 세 개로는 파스텔 하나로 뭉개져
   * 바로 앞 단계인 소다 와꾸볼과 구별이 안 됐다. */
  var RAINBOW   = ['#ffd9ec', '#ffe9b4', '#bff2d8', '#a8d9ff', '#cdb7ff'];
  var POTATOMIX = ['#e6d4ff', '#b294ee', '#c9a877'];
  var POTATO    = ['#f6e7cc', '#ddc296', '#ae8d59'];
  var BUTTER_L  = ['#fff7c8', '#ffe27a', '#eec33a'];
  var BUTTER    = ['#fff3b0', '#ffd63f', '#e8ae10'];
  var SOAP      = ['#ffe0f6', '#f78ac8', '#c94590'];   // 장미 비누 — 흰 거품이 잘 받는다
  var DOUGH     = ['#ffffff', '#f6efe4', '#dccdb8'];

  /* --- 몸 모양. 얼굴 자리(ey·ex·my·chy·chx)를 모양마다 함께 들고 있어야
   *     네모난 치즈에도 길쭉한 망고에도 눈코입이 제자리에 붙는다.
   *     pre 는 몸 뒤(곰 귀처럼), post 는 몸 위(치즈 구멍처럼) 에 그린다.
   *     {g} 는 그 마리의 그라데이션으로 바뀐다. --- */
  var FORMS = {
    /* 갓 태어난 물방울 — 아래는 퍼지고 위는 둥글다 */
    blob: {
      d: 'M60 34 c20 0 34 22 34 38 c0 14 -15 22 -34 22 c-19 0 -34 -8 -34 -22 c0 -16 14 -38 34 -38 z',
      ey: 66, ex: 8, my: 74, chy: 74, chx: 17, sh: [47, 52, 9, 6]
    },
    /* 낮고 둥근 돔 — 치즈알·와꾸볼·버터알 */
    dome: {
      d: 'M60 38 c21 0 35 16 35 34 c0 13 -15 22 -35 22 c-20 0 -35 -9 -35 -22 c0 -18 14 -34 35 -34 z',
      ey: 68, ex: 9, my: 77, chy: 77, chx: 19, sh: [47, 55, 10, 6]
    },
    /* 네모난 덩어리 — 치즈 블록·버터 조각·비누 */
    cube: {
      d: 'M33 46 h54 a9 9 0 0 1 9 9 v30 a9 9 0 0 1 -9 9 h-54 a9 9 0 0 1 -9 -9 v-30 a9 9 0 0 1 9 -9 z',
      ey: 68, ex: 9, my: 78, chy: 78, chx: 20, sh: [42, 56, 9, 5]
    },
    /* 곰 — 몸 뒤로 큼직하고 동그란 귀 두 개.
     * 귀가 작으면 그냥 젤리에 뿔 난 것처럼 보인다. 머리 폭의 3분의 1은 돼야 곰으로 읽힌다. */
    bear: {
      /* 세로로 긴 젤리가 아니라 옆으로 퍼진 둥근 사각형이라야 곰 머리로 읽힌다 */
      d: 'M60 40 c24 0 39 14 39 32 c0 14 -17 22 -39 22 c-22 0 -39 -8 -39 -22 c0 -18 15 -32 39 -32 z',
      pre: '<circle cx="30" cy="45" r="15" fill="{g}"/><circle cx="90" cy="45" r="15" fill="{g}"/>' +
           '<circle cx="30" cy="45" r="7.5" fill="#ffffff" opacity=".26"/>' +
           '<circle cx="90" cy="45" r="7.5" fill="#ffffff" opacity=".26"/>',
      /* 볼터치는 거의 지운다 — 진하면 곰이 아니라 인형 얼굴이 된다 */
      ey: 65, ex: 13, my: 78, chy: 78, chx: 27, sh: [43, 52, 10, 5], er: [3.6, 3.6], cho: 0.3
    },
    /* 망고 — 오른쪽으로 살짝 기운 물방울 */
    mango: {
      d: 'M64 34 c19 4 29 22 26 40 c-3 15 -19 21 -36 18 c-17 -3 -29 -13 -26 -28 c3 -18 17 -34 36 -30 z',
      ey: 68, ex: 9, my: 78, chy: 78, chx: 19, sh: [48, 52, 8, 5]
    },
    /* 감자 — 옆으로 퍼진 타원 */
    potato: {
      d: 'M60 42 c23 0 37 11 37 26 c0 16 -16 26 -37 26 c-21 0 -37 -10 -37 -26 c0 -15 14 -26 37 -26 z',
      ey: 68, ex: 9, my: 78, chy: 78, chx: 21, sh: [46, 56, 10, 5]
    },
    /* 만두 — 정수리에 주름과 꼭지 */
    bun: {
      d: 'M60 44 c22 0 37 13 37 29 c0 13 -17 21 -37 21 c-20 0 -37 -8 -37 -21 c0 -16 15 -29 37 -29 z',
      post: '<g stroke="#d9cab4" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7">' +
            '<path d="M60 47 q-9 6 -13 12"/><path d="M60 47 q0 8 0 13"/><path d="M60 47 q9 6 13 12"/></g>' +
            '<circle cx="60" cy="46" r="4.5" fill="{g}"/>',
      ey: 72, ex: 9, my: 81, chy: 81, chx: 21, sh: [45, 61, 8, 4]
    },
    /* 버터 스틱 — 네모로만 그리면 치즈·비누와 실루엣이 겹친다.
     * 윗면·옆면이 보이는 입체 막대라야 '잘라 쓰는 버터 한 개' 로 읽힌다.
     * 윗면·옆면은 몸 색 위에 흰색·검은색을 얇게 덮어 만들므로 색이 바뀌어도 따라온다. */
    stick: {
      /* 가로보다 세로가 길어야 '한 개씩 파는 버터 막대' 가 된다.
       * 정사각형에 가까우면 치즈·비누 덩어리와 실루엣이 겹친다. */
      d: 'M42 32 h36 v60 h-36 z',
      pre: '<path d="M42 32 l9 -9 h36 l-9 9 z" fill="{g}"/>' +
           '<path d="M42 32 l9 -9 h36 l-9 9 z" fill="#ffffff" opacity=".45"/>' +
           '<path d="M78 32 l9 -9 v60 l-9 9 z" fill="{g}"/>' +
           '<path d="M78 32 l9 -9 v60 l-9 9 z" fill="#000000" opacity=".15"/>',
      post: '<g fill="none" stroke="#000000" stroke-opacity=".13" stroke-width="1.5">' +
            '<path d="M42 32 l9 -9 h36 l-9 9 z"/><path d="M78 32 l9 -9 v60 l-9 9 z"/>' +
            '<path d="M42 32 h36 v60 h-36 z"/></g>',
      fx: 60, ey: 48, ex: 8, my: 57, chy: 57, chx: 13, sh: [51, 40, 5, 3], cho: 0.42
    },
    /* 퍼티 통 — 몸은 통 안을 채우고, 유리는 얼굴 위에 겹쳐 그린다 */
    jar: {
      d: 'M29 60 h62 v24 a10 10 0 0 1 -10 10 h-42 a10 10 0 0 1 -10 -10 z',
      post: '<rect x="25" y="52" width="70" height="42" rx="11" fill="#ffffff" opacity=".18"/>' +
            '<rect x="25" y="52" width="70" height="42" rx="11" fill="none" stroke="#cdbdf5" stroke-width="2.6"/>' +
            '<ellipse cx="60" cy="55" rx="35" ry="7" fill="#efe8ff" opacity=".5" stroke="#cdbdf5" stroke-width="2"/>',
      ey: 74, ex: 9, my: 82, chy: 82, chx: 21, sh: [42, 66, 8, 4]
    }
  };

  /* --- 장식. noMouth 는 그 장식이 입을 대신 그린다는 뜻이다. --- */
  var DECOS = {
    spark: {
      over: '<g fill="#ffd76a"><path d="M26 34 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z"/>' +
            '<path d="M94 44 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z"/></g>'
    },
    /* 금속 광택 — 팔레트가 만든 띠 위에 날카로운 반사 두 개를 더 얹는다.
     * 번짐 없는 또렷한 경계가 금속처럼 보이게 하는 핵심이라, 몸통 기본 하이라이트와
     * 달리 흐린 타원 대신 각진 조각으로 그린다. */
    gloss: {
      post: '<path d="M40 44 q9 -9 19 -9 q-6 6 -9 14 q-8 3 -10 -5 z" fill="#ffffff" opacity=".82"/>' +
            '<path d="M34 62 q3 -8 7 -11 q1 8 -2 14 q-5 2 -5 -3 z" fill="#ffffff" opacity=".45"/>' +
            '<path d="M31 82 q10 10 29 11" stroke="#ffffff" stroke-width="3" fill="none" ' +
            'stroke-linecap="round" opacity=".38"/>'
    },
    /* 통에 담긴 퍼티용 광택. gloss 의 좌표는 몸통 위쪽(y 35~62)을 기준으로 잡혀 있어
     * 통 안에만 몸이 있는 jar 에 그대로 쓰면 반사가 뚜껑 위 허공에 뜬다. */
    glossJar: {
      post: '<path d="M36 68 q7 -6 15 -6 q-5 5 -7 10 q-7 2 -8 -4 z" fill="#ffffff" opacity=".72"/>' +
            '<path d="M34 84 q9 7 21 8" stroke="#ffffff" stroke-width="2.6" fill="none" ' +
            'stroke-linecap="round" opacity=".32"/>'
    },
    glitter: {
      over: '<g fill="#ffffff"><circle cx="30" cy="44" r="2.4" opacity=".9"/><circle cx="93" cy="54" r="2" opacity=".85"/>' +
            '<circle cx="80" cy="32" r="1.8" opacity=".8"/><circle cx="24" cy="72" r="1.6" opacity=".8"/></g>'
    },
    /* 치즈 구멍 — 얼굴을 피해 가장자리로 돌린다 */
    cheeseHole: {
      post: '<g fill="#d99a12" opacity=".5"><ellipse cx="32" cy="62" rx="5" ry="4"/><ellipse cx="86" cy="56" rx="6" ry="5"/>' +
            '<ellipse cx="89" cy="80" rx="4" ry="3.4"/><ellipse cx="66" cy="88" rx="4.5" ry="3.4"/>' +
            '<ellipse cx="38" cy="88" rx="3.4" ry="2.8"/></g>'
    },
    /* 곰 주둥이 — 넓고 낮게. 코와 입을 함께 들고 있다.
     * 주둥이가 좁으면 강아지가 되고, 넓고 낮아야 느긋한 곰 얼굴이 된다. */
    muzzle: {
      post: '<ellipse cx="60" cy="79" rx="21" ry="13" fill="#fdf4e6" opacity=".97"/>' +
            '<path d="M53 70 h14 a5 5 0 0 1 -7 7 a5 5 0 0 1 -7 -7 z" fill="#6b4b34"/>' +
            '<path d="M60 77 v4 M60 81 q-5 4.5 -9 .5 M60 81 q5 4.5 9 .5" stroke="#6b4b34" ' +
            'stroke-width="2.2" fill="none" stroke-linecap="round"/>',
      noMouth: true
    },
    bubble: {
      over: '<circle cx="78" cy="36" r="6.5" fill="#ffffff" opacity=".85"/><circle cx="76" cy="34" r="2" fill="#ffffff"/>'
    },
    foam: {
      pre: '<g fill="#ffffff" opacity=".92"><circle cx="34" cy="45" r="7"/><circle cx="46" cy="38" r="9"/>' +
           '<circle cx="60" cy="34" r="7"/><circle cx="74" cy="39" r="8.5"/><circle cx="86" cy="46" r="6.5"/></g>',
      over: '<g fill="#ffffff" opacity=".85"><circle cx="26" cy="86" r="6"/><circle cx="95" cy="84" r="5"/>' +
            '<circle cx="36" cy="95" r="4.5"/><circle cx="86" cy="94" r="4"/></g>'
    },
    /* 버터 포장지 — stick 모양 전용. 밑으로 녹아 흐른 자국과 노란 종이에 찍힌 파란 글씨.
     *
     * 크림색 띠를 둘러 봤더니 그냥 라벨 붙인 상자였다. 실물 버터는 노란 종이 자체에
     * 파란 잉크로 바로 찍혀 있어서, 글씨를 몸 위에 얹는 편이 훨씬 버터답다.
     * 작은 칸(62px)에서는 글자가 뭉개지지만 '파란 인쇄가 있는 노란 막대' 로는 읽힌다. */
    pat: {
      pre: '<ellipse cx="62" cy="93" rx="38" ry="7.5" fill="#ffd84f" opacity=".6"/>',
      post: '<g text-anchor="middle" font-family="Arial, Helvetica, sans-serif" fill="#2f5fb8">' +
            '<text x="60" y="70" font-size="6">4oz</text>' +
            '<text x="60" y="84" font-size="7.5" font-weight="700" letter-spacing="0.3">BUTTER</text>' +
            '</g>' +
            '<g stroke="#2f5fb8" stroke-linecap="round">' +
            '<path d="M47 73.5 h26" stroke-width="1.1" opacity=".75"/>' +
            '<path d="M52 88 h16" stroke-width="1" opacity=".4"/></g>'
    },
    speck: {
      post: '<g fill="#8f6f42" opacity=".45"><circle cx="33" cy="62" r="1.8"/><circle cx="79" cy="53" r="1.6"/>' +
            '<circle cx="89" cy="73" r="2"/><circle cx="29" cy="80" r="1.7"/><circle cx="70" cy="89" r="1.6"/>' +
            '<circle cx="49" cy="89" r="1.4"/></g>'
    },
    /* 망고 꼭지와 잎 */
    leaf: {
      over: '<path d="M68 32 q4 -9 9 -11 q0 8 -5 13 z" fill="#8a5a30"/>' +
            '<path d="M66 30 q-16 -12 -28 -4 q10 12 26 8 z" fill="#7ec98f" stroke="#5aa06e" ' +
            'stroke-width="1.6" stroke-linejoin="round"/>'
    },
    steam: {
      pre: '<g stroke="#cfc4e8" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".7">' +
           '<path d="M44 34 q-5 -7 0 -13"/><path d="M60 28 q-5 -8 0 -14"/><path d="M76 34 q-5 -7 0 -13"/></g>'
    },
    /* 퍼티 신사 — 중절모와 콧수염 */
    hat: {
      /* 챙이 넓고 크라운이 낮으면 중절모가 아니라 비행접시가 된다.
       * 챙 : 크라운 = 1.5 : 1 정도에 크라운을 높게 세워야 중절모로 읽힌다. */
      over: '<ellipse cx="60" cy="50" rx="23" ry="6.5" fill="#2b2740"/>' +
            '<path d="M45 50 a15 16 0 0 1 30 0 z" fill="#3a3556"/>' +
            '<path d="M46 47 q14 6 28 0" stroke="#1f1c30" stroke-width="4.5" fill="none"/>' +
            '<ellipse cx="53" cy="40" rx="3.6" ry="2.2" fill="#ffffff" opacity=".3" transform="rotate(-22 53 40)"/>',
      post: '<path d="M52 84 q4 -4 8 -1 q4 -3 8 1 q-4 5 -8 2 q-4 3 -8 -2 z" fill="#2b2740"/>',
      noMouth: true
    }
  };

  /* --------------------------------------------------------- 성장 단계
   *
   * 아기 모리 → 5단계를 거쳐 9종류의 말랑이 중 하나가 된다.
   * 1·2단계는 어느 종류든 똑같은 보라 슬라임이고, 3단계에서 정체가 드러난다.
   *
   * 밸런스 기준 — 한 마리를 다 키우는 데 순공 10시간 안팎.
   * 순공 1분 = 젤리 1개, 밥 한 번에 22 경험치이므로 Lv.5(440 경험치)까지는
   * 스무 번 남짓 먹이면 된다. 다 키우면 홈으로 보내고 새로 받으므로, 한 판이
   * 너무 길면 도감을 모으는 재미가 사라지고 너무 짧으면 키운 것 같지가 않다. */
  var GROWN_LEVEL = 5;               // 이 레벨이 되면 다 자란 것으로 본다
  var REVEAL_LEVEL = 3;              // 이 레벨부터 무슨 말랑이인지 보인다

  /** 그 레벨을 끝내는 데 필요한 경험치 */
  function needFor(lv) { return 50 + (lv - 1) * 40; }

  function levelOf(xp) {
    var lv = 1, rem = Math.max(0, xp);
    while (lv < GROWN_LEVEL && rem >= needFor(lv)) { rem -= needFor(lv); lv++; }
    return { level: lv, inLevel: Math.round(rem), need: needFor(lv) };
  }

  function isGrown(d) { return levelOf(d.xp).level >= GROWN_LEVEL; }

  /* 1·2단계는 아홉 종류가 다 같은 얼굴이라 한 벌만 만들어 돌려 쓴다 */
  var BABY = {
    name: '아기 모리', form: 'blob', scale: 0.62, grad: PURPLE,
    line: '이제 막 태어난 작은 모리예요. 무엇이 될지는 아직 아무도 몰라요.'
  };

  /* ------------------------------------------------------------- 도감
   * 9종류의 말랑이. 다 자란 모리를 홈으로 보내면 여기 한 칸이 채워지고
   * 새 알이 온다. 무엇이 될지는 태어날 때 정해지지만 3단계까지는 숨겨 둔다.
   *
   * weight 가 뽑기 확률이고, 합이 100 이 되게 맞춰 두었다. */
  var SPECIES = [
    {
      id: 'putty', name: '퍼티 슬라임', weight: 18, rare: '흔함',
      line: '수은처럼 번들거리는 말랑이. 하루 종일 조물조물해도 안 질려요.',
      stages: [BABY,
        { name: '말랑 모리',   form: 'blob', scale: 0.80, grad: PURPLE,
          line: '밥을 잘 먹어서 제법 통통해졌어요.' },
        { name: '쫀득 퍼티',   form: 'blob', scale: 0.94, grad: PUTTY, deco: 'gloss',
          line: '표면이 금속처럼 번들거리기 시작했어요!' },
        { name: '반짝 퍼티',   form: 'dome', scale: 1.06, grad: PUTTY, deco: ['gloss', 'spark'],
          line: '빛을 받으면 거울처럼 되비쳐요.' },
        { name: '퍼티 슬라임', form: 'jar',  scale: 1.16, grad: PUTTY, deco: ['glossJar', 'hat'],
          line: '자기 통에 중절모까지 갖춘 완전한 신사예요.' }]
    },
    {
      id: 'cheese', name: '치즈 말랑이', weight: 15, rare: '흔함',
      line: '햇빛을 오래 쬐면 노릇하게 익는대요. 고소한 냄새가 나요.',
      stages: [BABY,
        { name: '동글 모리',   form: 'dome', scale: 0.80, grad: PURPLE,
          line: '동글동글하게 자리를 잡았어요.' },
        { name: '노릇 말랑이', form: 'dome', scale: 0.94, grad: WARMIX,
          line: '몸 아래쪽이 노랗게 물들기 시작했어요!' },
        { name: '치즈 말랑이', form: 'dome', scale: 1.06, grad: CHEESE,
          line: '완전히 노란 치즈색이 됐어요.' },
        { name: '치즈 블록',   form: 'cube', scale: 1.16, grad: CHEESE, deco: 'cheeseHole',
          line: '구멍까지 송송 뚫린 어엿한 치즈 한 덩이!' }]
    },
    {
      id: 'mango', name: '망고 말랑이', weight: 15, rare: '흔함',
      line: '달콤한 냄새가 폴폴 나는 말랑이. 꼭지에 잎이 하나 달려 있어요.',
      stages: [BABY,
        { name: '통통 모리',     form: 'blob',  scale: 0.80, grad: PURPLE,
          line: '한 손에 쏙 들어올 만큼 자랐어요.' },
        { name: '노을빛 말랑이', form: 'mango', scale: 0.94, grad: MANGOMIX,
          line: '몸이 해 질 녘 노을빛으로 물들었어요.' },
        { name: '망고 말랑이',   form: 'mango', scale: 1.06, grad: MANGO,
          line: '잘 익은 망고 색이 됐어요.' },
        { name: '완숙 망고',     form: 'mango', scale: 1.16, grad: MANGO, deco: 'leaf',
          line: '꼭지에 잎사귀까지 달린, 완전히 익은 망고예요.' }]
    },
    {
      id: 'potato', name: '감자 말랑이', weight: 14, rare: '흔함',
      line: '흙에서 갓 캐낸 것처럼 포슬포슬한 말랑이예요.',
      stages: [BABY,
        { name: '동글 모리',     form: 'dome',   scale: 0.80, grad: PURPLE,
          line: '몸이 동글동글해졌어요.' },
        { name: '흙빛 말랑이',   form: 'potato', scale: 0.94, grad: POTATOMIX,
          line: '아래쪽부터 흙빛으로 물들고 있어요.' },
        { name: '감자 말랑이',   form: 'potato', scale: 1.06, grad: POTATO,
          line: '영락없는 감자 모양이 됐어요.' },
        { name: '알감자',        form: 'potato', scale: 1.16, grad: POTATO, deco: 'speck',
          line: '점점이 눈까지 박힌, 잘 여문 알감자예요.' }]
    },
    {
      id: 'dumpling', name: '만두 말랑이', weight: 13, rare: '흔함',
      line: '갓 쪄낸 것처럼 김이 폴폴 나는 말랑이예요.',
      stages: [BABY,
        { name: '하얀 모리',     form: 'dome', scale: 0.80, grad: DOUGH,
          line: '색이 새하얗게 빠졌어요. 어라?' },
        { name: '만두피 말랑이', form: 'bun',  scale: 0.94, grad: DOUGH,
          line: '정수리에 만두 주름이 잡혔어요!' },
        { name: '만두 말랑이',   form: 'bun',  scale: 1.06, grad: DOUGH,
          line: '통통하게 속이 찬 만두가 됐어요.' },
        { name: '왕만두',        form: 'bun',  scale: 1.16, grad: DOUGH, deco: 'steam',
          line: '김이 모락모락 나는 커다란 왕만두!' }]
    },
    {
      id: 'bear', name: '쿠마 말랑이', weight: 10, rare: '귀함',
      line: '하루 종일 늘어져 있는 게 특기인 말랑이. 꼭 안으면 폭 하고 들어가요.',
      stages: [BABY,
        { name: '말랑 모리',       form: 'blob', scale: 0.80, grad: PURPLE,
          line: '조금 더 자랐어요.' },
        { name: '귀 돋은 말랑이',  form: 'bear', scale: 0.94, grad: PURPLE,
          line: '머리 위에 큼직하고 동그란 귀가 쏙 올라왔어요!' },
        { name: '곰 말랑이',       form: 'bear', scale: 1.06, grad: PURPLE, deco: 'muzzle',
          line: '넓적한 주둥이와 코가 생겨 곰 얼굴이 됐어요.' },
        { name: '쿠마 말랑이',     form: 'bear', scale: 1.16, grad: BEAR, deco: 'muzzle',
          line: '베이지색 쿠마가 됐어요. 오늘도 늘어져 있을 참이에요.' }]
    },
    {
      id: 'butter', name: '버터 말랑이', weight: 8, rare: '귀함',
      line: '따뜻한 곳에 두면 가장자리부터 천천히 녹아내려요.',
      stages: [BABY,
        { name: '매끈 모리',     form: 'dome', scale: 0.80, grad: PURPLE,
          line: '표면이 매끈하게 자랐어요.' },
        { name: '노란 말랑이',   form: 'dome', scale: 0.94, grad: BUTTER_L,
          line: '몸 전체가 부드러운 노란색이 됐어요.' },
        { name: '버터 말랑이',   form: 'dome', scale: 1.06, grad: BUTTER,
          line: '진한 버터색으로 반들반들해졌어요.' },
        { name: '버터 스틱',     form: 'stick', scale: 1.16, grad: BUTTER, deco: 'pat',
          line: '포장지까지 두른 버터 한 개가 됐어요. 밑이 살짝 녹고 있네요.' }]
    },
    {
      id: 'soap', name: '비누 크런치 말랑이', weight: 5, rare: '귀함',
      line: '누르면 사각사각 소리가 나는 딸기색 말랑이. 거품이 끝없이 나와요.',
      stages: [BABY,
        { name: '미끈 모리',         form: 'blob', scale: 0.80, grad: PURPLE,
          line: '표면이 미끈미끈해졌어요.' },
        { name: '거품 맺힌 말랑이',  form: 'blob', scale: 0.94, grad: SOAP, deco: 'bubble',
          line: '분홍색으로 물들더니 머리 위에 거품이 톡 맺혔어요!' },
        { name: '거품 말랑이',       form: 'dome', scale: 1.06, grad: SOAP, deco: 'foam',
          line: '온몸이 폭신한 거품에 덮였어요.' },
        { name: '비누 크런치',       form: 'cube', scale: 1.16, grad: SOAP, deco: 'foam',
          line: '네모난 비누가 됐어요. 누르면 사각! 하고 부서져요.' }]
    },
    {
      id: 'wakku', name: '와꾸볼', weight: 2, rare: '아주 귀함',
      line: '하루가 다르게 색이 바뀌는, 아주 드물게 나타나는 전설의 말랑이예요.',
      stages: [BABY,
        { name: '뽀얀 모리',     form: 'dome', scale: 0.80, grad: CREAM,
          line: '색이 뽀얗게 빠졌어요. 어라?' },
        { name: '딸기 와꾸볼',   form: 'dome', scale: 0.94, grad: PINK,
          line: '하룻밤 사이에 분홍색이 됐어요!' },
        { name: '소다 와꾸볼',   form: 'dome', scale: 1.06, grad: BLUE,
          line: '이번엔 파랑… 색이 계속 바뀌어요.' },
        { name: '와꾸볼',        form: 'dome', scale: 1.16, grad: RAINBOW, deco: 'glitter', shine: true,
          line: '모든 색을 한 몸에 담았어요. 전설의 와꾸볼!' }]
    }
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

  /** 지금 키우는 종류 (저장값이 깨졌으면 첫 종류로 떨어진다) */
  function curSpecies(d) { return speciesBy(d.sp) || SPECIES[0]; }

  /** 그 종류의 N단계 모습 */
  function stageOf(sp, level) {
    return sp.stages[Math.min(Math.max(1, level), sp.stages.length) - 1];
  }

  function nextStageOf(sp, level) {
    return level < sp.stages.length ? sp.stages[level] : null;
  }

  /** 다 자란 모습 — 도감과 홈에 서 있는 그림 */
  function finalOf(sp) { return sp.stages[sp.stages.length - 1]; }

  /* ------------------------------------------------------------ 업그레이드 */

  var UPGRADES = [
    {
      id: 'farm', icon: '🌱', name: '젤리 농장',
      desc: '자는 동안에도 젤리가 저절로 쌓입니다.',
      base: 30, mult: 1.7, max: 25,
      effect: function (n) {
        var share = farmShare(n);
        return (share / MIN_PER_JELLY * 60).toFixed(1) + ' 젤리/시간' +
          (n ? ' (공부의 ' + Math.round(share * 100) + '%)' : '');
      }
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
      /* 도감 보너스는 여기 섞지 않는다 — 이 카드는 이 업그레이드가 주는 몫만 말해야
       * 다음 레벨과 견줄 수 있다. 둘을 합친 실제 배율은 '정산 배율' 칸에 있다. */
      effect: function (n) { return '정산 ×' + (1 + n * 0.25).toFixed(2); }
    }
  ];

  function upgradeBy(id) {
    for (var i = 0; i < UPGRADES.length; i++) if (UPGRADES[i].id === id) return UPGRADES[i];
    return null;
  }

  function costOf(u, n) { return Math.round(u.base * Math.pow(u.mult, n)); }

  /* 농장(앱을 꺼 둔 동안 저절로 쌓이는 젤리)의 속도는 절대값으로 두지 않고
   * 공부로 버는 속도에 대한 비율로 잡는다.
   *
   * 절대값으로 두었더니 정산 속도를 손볼 때마다 둘의 관계가 뒤집혔다.
   * 방치가 공부를 앞지르면 "공부해서 여는 게임" 이라는 전제 자체가 무너진다.
   * 그래서 상한을 걸어 둔다 — 농장을 아무리 올려도 공부보다 빠를 수 없다.
   *
   * 게다가 무한정 쌓이지도 않는다. 접시 용량(offlineCapMin)까지만 차고 멈추므로
   * 며칠 만에 들어와서 갑자기 부자가 되는 일은 그 상한이 막는다. */
  var FARM_SHARE_PER_LEVEL = 0.15;   // 레벨마다 공부 속도의 15%
  var FARM_SHARE_MAX = 0.8;          // 다 올려도 공부의 80% 를 넘지 않는다

  function farmShare(level) { return Math.min(FARM_SHARE_MAX, level * FARM_SHARE_PER_LEVEL); }
  function farmRate(d) { return farmShare(d.ups.farm) / MIN_PER_JELLY; }   // 분당 젤리
  function offlineCapMin(d) { return (2 + d.ups.dish * 2) * 60; }
  function claimMult(d) { return 1 + d.ups.train * 0.25; }

  /* 홈에 사는 말랑이가 주는 보상.
   *
   * 자동 생산을 올려 주는 쪽이 아니라 '정산' 을 올려 주는 쪽으로 붙였다.
   * 도감을 채울수록 방치가 빨라지면 결국 공부를 안 하는 게 이득이 되는데,
   * 정산 배율에 붙이면 모을수록 공부한 시간이 더 값나가는 방향으로만 움직인다.
   * 같은 종류를 여러 마리 보내도 오르지 않는다 — 채워야 하는 건 칸이지 마릿수가 아니다. */
  var DEX_BONUS_PER_KIND = 0.02;     // 도감 한 칸에 정산 +2% (9종 다 모으면 +18%)

  function dexBonus(d) { return 1 + dexCount(d) * DEX_BONUS_PER_KIND; }

  /** 정산에 실제로 곱해지는 배율 (특훈 × 도감) */
  function totalMult(d) { return claimMult(d) * dexBonus(d); }

  /** 젤리 1개를 받는 데 필요한 순공 분 (업그레이드와 도감이 붙은 실제 값) */
  function minPerJelly(d) { return MIN_PER_JELLY / totalMult(d); }

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
  /* ------------------------------------------------------ 오래 안 오면 작아진다
   *
   * 줄어드는 것은 모리의 경험치 하나뿐이다. 젤리·업그레이드·도감·홈은 그대로 두고,
   * 공부 기록은 어떤 경우에도 건드리지 않는다 — 그건 게임이 손댈 것이 아니다.
   *
   * 사흘까지는 아무 일도 없다. 시험 기간에 며칠 못 들어왔다고 벌을 주면
   * 돌아오기가 더 싫어진다. 그 뒤로 하루에 밥 한 번(22 XP)보다 조금 적게 줄어든다.
   * 레벨이 내려가면 stageOf 가 앞 단계를 돌려주므로 모리가 실제로 작아진다. */
  var DECAY_GRACE_DAYS = 3;
  var DECAY_XP_PER_DAY = 20;

  function applyDecay(d, awayMs) {
    var days = awayMs / 86400000 - DECAY_GRACE_DAYS;
    if (!(days > 0) || !(d.xp > 0)) return 0;
    var lost = Math.min(d.xp, Math.round(days * DECAY_XP_PER_DAY));
    if (lost <= 0) return 0;
    d.xp -= lost;
    // 돌아왔을 때 한 번은 알려 줘야 한다. 말없이 작아져 있으면 버그로 보인다.
    d.decayNote = (d.decayNote || 0) + lost;
    return lost;
  }

  function accrue(d) {
    var now = Date.now();
    var last = d.lastTick || now;
    var away = now - last;

    applyDecay(d, away);

    var mins = away / 60000;
    if (!(mins > 0)) { d.lastTick = now; return 0; }
    mins = Math.min(mins, offlineCapMin(d));
    var rate = farmRate(d) * (isHungry(d) ? 0.5 : 1);
    var got = mins * rate;
    d.jelly += got;
    d.lastTick = now;
    return got;
  }

  /** 줄어든 경험치를 한 번만 알려 주고 지운다 */
  function takeDecayNote() {
    var d = load();
    var n = d.decayNote || 0;
    if (n) { d.decayNote = 0; save(d); }
    return n;
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

  /* 그라데이션 id 는 문서 전체에서 유일해야 한다. 도감·홈처럼 한 화면에 여러 마리를
   * 그릴 때 같은 id 를 쓰면 먼저 그려진 색이 나머지를 전부 덮어쓴다. */
  var svgSeq = 0;

  /* 색 정거장을 그라데이션 stop 으로 편다.
   * 세 개짜리는 가운데를 55% 에 둔다 — 한가운데(50%)에 두면 몸통이 납작해 보인다.
   * 네 개 이상은 고르게 편다(무지개). */
  function stops(grad) {
    if (grad.length === 3) {
      return '<stop offset="0%" stop-color="' + grad[0] + '"/>' +
        '<stop offset="55%" stop-color="' + grad[1] + '"/>' +
        '<stop offset="100%" stop-color="' + grad[2] + '"/>';
    }
    return grad.map(function (c, i) {
      return '<stop offset="' + Math.round(i / (grad.length - 1) * 100) + '%" stop-color="' + c + '"/>';
    }).join('');
  }

  /**
   * 말랑이 SVG. look 하나로 몸 모양·색·크기·장식이 전부 정해진다.
   *   look = SPECIES[].stages[] 의 한 칸 { name, form, scale, grad, deco, shine }
   */
  function slimeSvg(look, hungry) {
    var s = look.scale || 1;
    var uid = 'slB' + (++svgSeq);
    var g = 'url(#' + uid + ')';
    var form = FORMS[look.form] || FORMS.blob;
    var grad = look.grad || PURPLE;

    // 장식은 여러 개를 겹칠 수 있다. pre 는 몸 뒤, post 는 몸 위, over 는 맨 앞.
    var keys = !look.deco ? [] : (typeof look.deco === 'string' ? [look.deco] : look.deco);
    var pre = form.pre || '', post = form.post || '', over = '', noMouth = false;
    keys.forEach(function (k) {
      var dc = DECOS[k];
      if (!dc) return;
      if (dc.pre) pre += dc.pre;
      if (dc.post) post += dc.post;
      if (dc.over) over += dc.over;
      if (dc.noMouth) noMouth = true;
    });
    var paint = function (t) { return t.replace(/\{g\}/g, g); };

    /* 얼굴 한가운데는 몸 한가운데(60)와 다를 수 있다 — 버터 스틱처럼 입체로 그린
     * 모양은 앞면이 왼쪽으로 밀려 있어서, 60 에 맞추면 눈이 옆면으로 넘어간다. */
    var fx = form.fx || 60;
    var er = form.er || [3.4, 4.4];       // 눈 크기 (곰은 동그란 점눈)
    var cho = form.cho == null ? 0.5 : form.cho;   // 볼터치 진하기 (0 이 올 수 있어 || 를 못 쓴다)
    var eyeL = fx - form.ex, eyeR = fx + form.ex;
    var face = hungry
      ? '<path d="M' + (eyeL - 3) + ' ' + form.ey + ' q3 -5 6 0" stroke="#2b1f5e" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<path d="M' + (eyeR - 3) + ' ' + form.ey + ' q3 -5 6 0" stroke="#2b1f5e" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : '<ellipse class="sl-eye" cx="' + eyeL + '" cy="' + form.ey + '" rx="' + er[0] + '" ry="' + er[1] + '" fill="#2b1f5e"/>' +
        '<ellipse class="sl-eye" cx="' + eyeR + '" cy="' + form.ey + '" rx="' + er[0] + '" ry="' + er[1] + '" fill="#2b1f5e"/>';

    return '' +
      '<svg class="sl-svg' + (look.shine ? ' is-shine' : '') + '" viewBox="0 0 120 110" role="img" aria-label="' + esc(look.name) + '">' +
      '<defs>' +
      '<radialGradient id="' + uid + '" cx="38%" cy="30%" r="78%">' + stops(grad) +
      '</radialGradient>' +
      '</defs>' +
      '<ellipse class="sl-shadow" cx="60" cy="100" rx="' + (34 * s).toFixed(1) + '" ry="6"/>' +
      // 크기(단계)는 SVG transform 으로, 말랑거리는 움직임은 CSS transform 으로 나눠 건다.
      // 한 요소에 둘 다 걸면 애니메이션이 크기를 덮어써서 단계가 안 보인다.
      '<g transform="translate(60 96) scale(' + s.toFixed(2) + ') translate(-60 -96)">' +
      '<g class="sl-body" style="transform-origin:60px 96px">' +
      paint(pre) +
      '<path d="' + form.d + '" fill="' + g + '"/>' +
      '<ellipse cx="' + form.sh[0] + '" cy="' + form.sh[1] + '" rx="' + form.sh[2] + '" ry="' + form.sh[3] + '" fill="#fff" opacity=".36"/>' +
      face +
      '<ellipse cx="' + (fx - form.chx) + '" cy="' + form.chy + '" rx="5" ry="3" fill="#ff9dbb" opacity="' + cho + '"/>' +
      '<ellipse cx="' + (fx + form.chx) + '" cy="' + form.chy + '" rx="5" ry="3" fill="#ff9dbb" opacity="' + cho + '"/>' +
      (noMouth ? '' : '<path d="M' + (fx - 5) + ' ' + form.my + ' q5 5 10 0" stroke="#2b1f5e" stroke-width="2.4" fill="none" stroke-linecap="round"/>') +
      paint(post) +
      paint(over) +
      '</g></g></svg>';
  }

  function view() {
    var d = load();
    accrue(d);
    save(d);

    var lv = levelOf(d.xp);
    var sp = curSpecies(d);
    return {
      d: d, lv: lv, sp: sp,
      look: stageOf(sp, lv.level),
      next: nextStageOf(sp, lv.level),
      mood: moodOf(d),
      pend: pendingMin(d)
    };
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
    if (isGrown(d)) return '다 자랐어요! 이제 홈으로 갈 준비가 됐어요.';
    if (levelOf(d.xp).level === REVEAL_LEVEL - 1) return '뭔가 될 것 같은 기분이에요… 한 번만 더 먹여 주세요!';
    // 1분 공부하자마자 조르지 않도록 최소 25분은 쌓인 뒤에 말한다
    if (pendingMin(d) >= Math.max(25, minPerJelly(d))) return '공부한 시간이 쌓였어요. 정산해 주세요!';
    var i = Math.floor(Date.now() / CHEER_MS) % CHEERS.length;
    return CHEERS[i];
  }

  /* --------------------------------------------------------- 홈으로 보내기
   * 다 자란 모리는 말랑이가 되어 홈에서 살고 도감에 한 칸을 채운다.
   * 자동으로 하지 않고 버튼으로 두는 이유 — 애써 키운 걸 묻지도 않고 치워 버리면
   * 보상이 아니라 상실이 된다. 언제 보낼지는 키운 사람이 정한다. */
  function sendToHome() {
    var d = load();
    accrue(d);
    if (!isGrown(d)) { save(d); return null; }

    var sp = curSpecies(d);
    var isNew = !d.dex[sp.id];   // 도감에 처음 들어오는 종류인가
    d.dex[sp.id] = (d.dex[sp.id] || 0) + 1;
    d.raised = (d.raised || 0) + 1;

    // 새 알로 되돌린다. 젤리와 업그레이드(농장·접시·특훈)는 그대로 남는다 —
    // 그건 모리가 아니라 키우는 사람이 쌓은 것이다.
    d.xp = 0;
    d.fed = 0;
    d.sp = rollSpecies().id;      // 다음 아이가 될 종류는 지금 새로 뽑는다
    d.fedAt = Date.now();
    d.born = Date.now();
    save(d);
    return { sp: sp, fresh: isNew };
  }

  function dexCount(d) {
    var got = 0;
    SPECIES.forEach(function (s) { if (d.dex[s.id]) got++; });
    return got;
  }

  /** 홈에 사는 말랑이들 — 도감에 담긴 마릿수만큼 한 마리씩 늘어놓는다 */
  function residents(d) {
    var out = [];
    SPECIES.forEach(function (sp) {
      var n = d.dex[sp.id] || 0;
      for (var i = 0; i < n; i++) out.push(sp);
    });
    return out;
  }

  var ROOM_MAX = 24;   // 이보다 많으면 나머지는 숫자로 접는다 (홈이 화면을 다 먹지 않게)

  function homeHtml(d) {
    var res = residents(d);
    var kinds = dexCount(d);
    var shown = res.slice(0, ROOM_MAX);
    var rest = res.length - shown.length;

    return '' +
      '<div class="sl-home">' +
        '<div class="sl-dex-head"><b>🏠 말랑이 홈</b>' +
          '<span>' + (res.length ? res.length + '마리가 살고 있어요 · ' : '') +
            '도감 ' + kinds + ' / ' + SPECIES.length + ' 종' +
            (kinds ? ' · 정산 +' + Math.round(kinds * DEX_BONUS_PER_KIND * 100) + '%' : '') +
          '</span></div>' +
        (res.length
          ? '<div class="sl-room">' +
              shown.map(function (sp) {
                return '<button type="button" class="sh-one" data-sp="' + sp.id + '" ' +
                  'title="' + esc(sp.name) + '" aria-label="' + esc(sp.name) + '">' +
                  slimeSvg(finalOf(sp), false) + '</button>';
              }).join('') +
              (rest > 0 ? '<span class="sh-more">외 ' + rest + '마리</span>' : '') +
            '</div>'
          : '<p class="sl-room-empty">아직 아무도 살지 않아요.<br>' +
            '모리를 5단계까지 키워 홈으로 보내면 여기서 함께 지내요.</p>') +
        '<p class="tiny sl-home-cap">도감을 한 칸 채울 때마다 <b>정산이 2% 씩 빨라져요</b>. ' +
          '같은 종류를 또 보내도 홈 식구는 늘지만 보너스는 오르지 않아요.</p>' +
      '</div>';
  }

  function render() {
    if (!root) return;
    var v = view(), d = v.d;
    var hungry = isHungry(d);
    var pendJelly = Math.floor(v.pend / minPerJelly(d));
    var today = todayKey();
    var patsLeft = d.patDay === today ? Math.max(0, MAX_PAT_PER_DAY - d.patCount) : MAX_PAT_PER_DAY;
    var feedCost = feedCostOf(d);
    var grown = isGrown(d);
    var known = v.lv.level >= REVEAL_LEVEL;   // 3단계부터 무슨 말랑이인지 드러난다

    root.innerHTML =
      '<div class="sl-main">' +
        '<div class="sl-stage">' +
          '<p class="sl-bubble" id="slBubble">' + esc(cheerFor(d)) + '</p>' +
          '<button type="button" class="sl-tap' + (patsLeft ? '' : ' is-spent') + '" id="slTap" ' +
            'aria-label="모리 쓰다듬기">' + slimeSvg(v.look, hungry) + '</button>' +
          '<div class="sl-name"><b>' + esc(v.look.name) + '</b><span>Lv.' + v.lv.level + ' / ' + GROWN_LEVEL + '</span></div>' +
          '<p class="sl-line">' + esc(hungry ? v.mood.line : v.look.line) + '</p>' +
          (grown
            ? '<button type="button" class="btn primary sl-grad" id="slSend">🏠 홈으로 보내고 도감에 남기기</button>' +
              '<p class="tiny sl-xp-cap">홈에서 다른 말랑이들과 함께 지내게 돼요. 새 알이 곧바로 옵니다.</p>'
            : '<div class="sl-xp"><span style="width:' + Math.round(v.lv.inLevel / v.lv.need * 100) + '%"></span></div>' +
              '<p class="tiny sl-xp-cap">경험치 ' + v.lv.inLevel + ' / ' + v.lv.need +
                (v.next
                  ? ' · Lv.' + (v.lv.level + 1) + ' 에 ' +
                    (known || v.lv.level + 1 < REVEAL_LEVEL
                      ? '<b>' + esc(v.next.name) + '</b> 로 자라요'
                      : '<b>정체가 드러나요</b> 👀')
                  : '') + '</p>') +
        '</div>' +

        '<div class="sl-side">' +
          '<div class="sl-facts">' +
            '<div class="sl-fact"><span>기분</span><b>' + v.mood.emoji + ' ' + esc(v.mood.label) + '</b></div>' +
            '<div class="sl-fact"><span>자동 생산</span><b>' +
              (farmRate(d) > 0 ? (farmRate(d) * (hungry ? 0.5 : 1)).toFixed(1) + ' /분' : '없음') + '</b></div>' +
            '<div class="sl-fact"><span>정산 배율</span><b>×' + totalMult(d).toFixed(2) + '</b></div>' +
            '<div class="sl-fact"><span>밥 먹인 횟수</span><b>' + d.fed + '회</b></div>' +
          '</div>' +

          '<button type="button" class="btn primary sl-claim" id="slClaim"' + (pendJelly > 0 ? '' : ' disabled') + '>' +
            (pendJelly > 0
              ? '📚 공부 ' + esc(fmtMin(v.pend)) + ' 정산 → ✨' + fmtJelly(pendJelly)
              : '📚 정산할 공부 시간이 없어요') +
          '</button>' +
          /* 분 단위로 적으면 '공부 특훈' 을 올릴수록 0분에 수렴해 뜻이 사라진다.
           * 시간당 개수로 적으면 어느 속도에서든 그대로 읽힌다. */
          '<p class="tiny sl-claim-cap">타이머로 잰 <b>순공 1시간이 젤리 ' +
            Math.round(60 / minPerJelly(d)) + '개</b>입니다. ‘공부 특훈’ 과 도감을 채우면 더 늘어나요.</p>' +

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

      /* 홈 — 다 키워 보낸 말랑이들이 실제로 모여 있는 자리 */
      homeHtml(d) +

      /* 도감 — 아직 못 만난 종류는 실루엣으로만 보여 준다.
       * 무엇이 남았는지는 알려 주되 어떻게 생겼는지는 만나서 알게 한다. */
      '<div class="sl-dex">' +
        '<div class="sl-dex-head"><b>📖 말랑이 도감</b>' +
          '<span>' + dexCount(d) + ' / ' + SPECIES.length + ' 종 · 지금까지 ' + (d.raised || 0) + '마리</span></div>' +
        '<div class="sl-dex-grid">' +
          SPECIES.map(function (sp) {
            var n = d.dex[sp.id] || 0;
            var fig = n
              ? slimeSvg(finalOf(sp), false)
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
    var send = document.getElementById('slSend');
    if (send) send.addEventListener('click', sendOff);
    Array.prototype.forEach.call(root.querySelectorAll('.su-buy'), function (b) {
      b.addEventListener('click', function () { buy(b.dataset.up); });
    });
    // 홈 식구를 누르면 한마디 한다 — 모아 둔 게 장식이 아니라 살아 있게
    Array.prototype.forEach.call(root.querySelectorAll('.sh-one'), function (b) {
      b.addEventListener('click', function () { greet(b); });
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

    var el = root && root.querySelector('.sl-stage .sl-body');
    if (el) { el.classList.remove('is-boing'); void el.offsetWidth; el.classList.add('is-boing'); }
    popText('+' + got);
    paintJelly(d.jelly);
    // 남은 횟수·경험치 막대도 따라가야 하므로 다시 그린다 (튐 방지용으로 살짝 미룬다)
    clearTimeout(pat._t);
    pat._t = setTimeout(render, 420);
  }

  /** 홈에 사는 말랑이를 눌렀을 때 — 튕기고 한마디 */
  function greet(btn) {
    var sp = speciesBy(btn.dataset.sp);
    if (!sp) return;
    var el = btn.querySelector('.sl-body');
    if (el) { el.classList.remove('is-boing'); void el.offsetWidth; el.classList.add('is-boing'); }
    toast(sp.name + ' — ' + sp.line);
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

    var per = minPerJelly(d);
    var got = Math.floor(pend / per);
    if (got < 1) {
      toast('젤리 1개까지 ' + fmtMin(per - pend) + ' 남았어요.', true);
      save(d);
      return;
    }

    /* 자투리 시간은 버리지 않고 다음 정산으로 넘긴다.
     * 통째로 없애면 50분 공부하고 정산했을 때 20분이 조용히 사라진다. */
    var used = got * per;
    d.jelly += got;
    d.claimedMin = (d.claimedMin || 0) + used;
    save(d);
    render();
    popText('+' + fmtJelly(got));
    toast('순공 ' + fmtMin(used) + '을 젤리 ' + fmtJelly(got) + '개로 바꿨어요!', 'party');
  }

  function feed1() {
    var d = load();
    accrue(d);
    var cost = feedCostOf(d);
    if (d.jelly < cost) { toast('젤리가 모자라요. 공부 시간을 정산해 보세요.', true); save(d); return; }
    var sp = curSpecies(d);
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
      // 정체가 드러나는 3단계는 따로 알려 준다 — 이 게임에서 제일 재미있는 순간이다
      if (before < REVEAL_LEVEL && after >= REVEAL_LEVEL) {
        toast('정체가 드러났어요! ' + sp.name + ' 가 되고 있어요 ✨ — ' + sp.rare, 'party');
      } else if (after >= GROWN_LEVEL) {
        toast(sp.name + ' 로 다 자랐어요! 홈으로 보내 도감에 남겨 보세요 🎉', 'party');
      } else {
        toast('모리가 ' + stageOf(sp, after).name + ' 로 자랐어요! 🎉', 'party');
      }
    } else {
      toast('모리가 맛있게 먹었어요.');
    }
  }

  /** 다 자란 모리를 홈으로 보내고 도감에 남긴다 */
  function sendOff() {
    var d = load();
    if (!isGrown(d)) { toast('아직 다 자라지 않았어요.', true); return; }
    var sp = curSpecies(d);
    if (!confirm('다 자란 ' + sp.name + ' 를 홈으로 보낼까요?\n\n홈에서 다른 말랑이들과 함께 지내고 도감에 남습니다.\n자리에는 새 알이 오고, 젤리와 업그레이드는 그대로예요.')) return;

    var got = sendToHome();
    if (!got) return;
    render();
    popText('🏠');
    toast(got.sp.name + (got.fresh ? ' 이(가) 도감에 새로 들어왔어요!' : ' 이(가) 홈에 한 마리 더 늘었어요!') +
      ' — ' + got.sp.rare, 'party');
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
      jelly: Math.floor(d.jelly), level: lv.level, stage: stageOf(curSpecies(d), lv.level).name,
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
    return slimeSvg(stageOf(curSpecies(d), levelOf(d.xp).level), isHungry(d));
  }

  /* ------------------------------------------------- 친구에게 보여줄 도감 요약
   *
   * 랭킹에서 같은 반 친구를 누르면 그 친구의 도감을 보여준다. 그러려면 이 값이
   * 서버에 올라가야 하는데(league.js 가 report_league 로 함께 올린다),
   * 서버는 순서가 있는 배열이 편하다. SPECIES 의 순서를 그대로 쓴다.
   *
   * ⚠ 이 순서가 서버에 올라가는 순서와 화면에 다시 그리는 순서를 모두 정한다.
   *   SPECIES 앞에 새 종류를 끼워 넣으면 이미 올라간 옛 기록이 다른 종류로
   *   읽힌다 — 새 종류는 항상 배열 끝에 추가할 것.
   */
  function dexSummary() {
    var d = load();
    return {
      distinct: dexCount(d),
      total: SPECIES.length,
      /* "2,0,1,0,0,3,0,0,0" 처럼 SPECIES 순서대로 마릿수를 늘어놓는다.
       * JSON 대신 쓰는 이유는 순전히 크기다 — 최대 9개 한 자리 숫자면
       * 리그 전송 페이로드에 몇 바이트 더하지 않는다. */
      counts: SPECIES.map(function (sp) { return d.dex[sp.id] || 0; })
    };
  }

  /** "2,0,1,..." 형태를 counts 배열로. 자릿수가 안 맞거나 못 읽으면 전부 0 — 친구
   *  도감이 텅 빈 것처럼 보일 뿐 화면이 깨지지는 않는다. */
  function parseDexCsv(csv) {
    var parts = String(csv || '').split(',');
    return SPECIES.map(function (sp, i) {
      var n = parseInt(parts[i], 10);
      return isFinite(n) && n > 0 ? Math.min(999, n) : 0;
    });
  }

  /** 화면에 뿌릴 최소 정보만 — 전체 SPECIES(단계별 SVG 좌표 전부)를 밖으로
   *  내보내면 다른 화면이 내부 구조에 얽매이게 된다. */
  function speciesList() {
    return SPECIES.map(function (sp) { return { id: sp.id, name: sp.name, rare: sp.rare, line: sp.line }; });
  }

  /** 다 자란 모습의 SVG. 친구 도감·내 도감이 같은 그림을 쓴다. */
  function speciesFaceSvg(id) {
    var sp = speciesBy(id);
    return sp ? slimeSvg(finalOf(sp), false) : '';
  }

  global.Slime = {
    init: function (opt) { if (opt && opt.toast) toast = opt.toast; },
    open: open, stop: stop, render: render, touch: touch,
    summary: summary, reset: reset,
    jelly: jelly, spend: spend, faceSvg: faceSvg,
    takeDecayNote: takeDecayNote, MIN_PER_JELLY: MIN_PER_JELLY,
    dexSummary: dexSummary, parseDexCsv: parseDexCsv,
    speciesList: speciesList, speciesFaceSvg: speciesFaceSvg
  };

})(window);
