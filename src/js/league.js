/* =========================================================================
 * league.js — 학교 대항 주간 리그
 *
 * 개인 랭킹(group.js)이 "같은 반 친구들과의 겨루기"라면,
 * 리그는 "우리 학교 전체가 다른 학교와 겨루는" 한 단계 위의 판이다.
 *
 * ⚠ 이 앱에는 서버가 없다. 그래서 다른 학교의 실제 기록을 받아올 수 없다.
 *    상대 학교는 (내 학교명 + 그 주의 월요일) 로 고정된 난수에서 만들어 낸다.
 *    같은 주 안에서는 항상 같은 상대가 같은 속도로 자라므로 판은 일관되지만,
 *    실재하는 학교의 기록이 아니다. 화면에도 그렇게 밝혀 둔다.
 *
 * 내 학교의 누적 시간만은 진짜다.
 *   - 내 순공 시간(StudyLog)
 *   - 같은 학교 그룹원이 공유 코드로 넘겨준 기록
 *   두 값을 합치고 하루 상한을 적용해 계산한다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;

  var GROUP_SIZE = 20;          // 한 리그에 들어가는 학교 수
  var DAILY_CAP_MINUTES = 300;  // 하루에 인정되는 최대 순공 시간
  var STORE_KEY = 'neurostudy.league.v1';

  var TIERS = [
    { id: 'seed',   name: '씨앗', promote: 5, demote: 0 },
    { id: 'sprout', name: '새싹', promote: 5, demote: 4 },
    { id: 'leaf',   name: '잎새', promote: 5, demote: 4 },
    { id: 'tree',   name: '나무', promote: 4, demote: 5 },
    { id: 'forest', name: '숲',   promote: 0, demote: 5 }
  ];

  /* 상대 학교 이름 풀 — 실재 학교가 아닌 가상의 이름이다 */
  var NAMES = [
    '한빛중학교', '새얼초등학교', '동락중학교', '푸른솔초등학교', '가온중학교',
    '대현중학교', '이룸초등학교', '누리중학교', '밝음초등학교', '샘터중학교',
    '청람초등학교', '온새미초등학교', '빛고을중학교', '다올초등학교', '예람중학교',
    '하늘터초등학교', '물빛중학교', '너울초등학교', '해맑음중학교', '돌담초등학교',
    '별뫼고등학교', '한올고등학교', '슬기고등학교', '도담고등학교', '아람고등학교',
    '나린중학교', '해솔초등학교', '윤슬중학교', '가람고등학교', '너른고등학교'
  ];

  var MY_CODE = '__me__';

  /* ------------------------------------------------------------ 승강 구역 */

  /** 리그 인원이 20명이 아닐 때도 승급·강등 폭을 비율대로 유지한다 */
  function zoneSizes(tier, size) {
    var scale = size / GROUP_SIZE;
    return {
      promote: tier.promote === 0 ? 0 : Math.max(1, Math.round(tier.promote * scale)),
      demote:  tier.demote  === 0 ? 0 : Math.max(1, Math.round(tier.demote  * scale))
    };
  }

  function getZone(rank, tier, size) {
    var z = zoneSizes(tier, size);
    if (z.promote > 0 && rank <= z.promote) return 'promote';
    if (z.demote > 0 && rank > size - z.demote) return 'demote';
    return 'stay';
  }

  /** 누적 시간 → 꾸준한 인원 → 코드 순으로 줄을 세운다 */
  function rankGroup(group) {
    return group.slice()
      .sort(function (a, b) {
        if (b.total !== a.total) return b.total - a.total;
        if (b.steady !== a.steady) return b.steady - a.steady;
        return String(a.schoolCode).localeCompare(String(b.schoolCode));
      })
      .map(function (s, i) {
        var o = {};
        Object.keys(s).forEach(function (k) { o[k] = s[k]; });
        o.rank = i + 1;
        return o;
      });
  }

  /* ------------------------------------------------------------ 저장 상태 */

  function load() {
    var d = { tierIdx: 0, weekKey: '', prevRanks: {}, lastResult: null };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return d;
      var o = JSON.parse(raw);
      return {
        tierIdx: typeof o.tierIdx === 'number' ? o.tierIdx : 0,
        weekKey: o.weekKey || '',
        prevRanks: o.prevRanks || {},
        lastResult: o.lastResult || null
      };
    } catch (e) { return d; }
  }

  function save(o) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 무시 */ }
  }

  function weekKey(offset) {
    return S.key(S.addDays(S.weekStart(new Date()), (offset || 0) * 7));
  }

  /* ------------------------------------------------- 내 학교의 진짜 기록 */

  /** 하루 상한을 적용한 이번 주 내 순공 시간 */
  function myCappedWeek() {
    var start = S.weekStart(new Date());
    var sum = 0;
    for (var i = 0; i < 7; i++) {
      var m = global.StudyLog.dayTotal(S.key(S.addDays(start, i)));
      sum += Math.min(m, DAILY_CAP_MINUTES);
    }
    return sum;
  }

  /**
   * 우리 학교 기록 = 나 + 같은 학교 그룹원.
   * 그룹원 기록은 공유 코드를 받은 시점의 값이라 최신이 아닐 수 있다.
   */
  function mySchool() {
    var p = S.profile();
    if (!p) return null;

    var school = String(p.school || '').trim();
    var mine = myCappedWeek();
    var meId = global.Group.memberId(p);

    var mates = global.Group.members().filter(function (m) {
      return m.id !== meId && String(m.school || '').trim() === school;
    });

    var total = mine;
    var steady = mine > 0 ? 1 : 0;
    mates.forEach(function (m) {
      total += Math.min(m.weekMin || 0, DAILY_CAP_MINUTES * 7);
      if ((m.streak || 0) >= 3) steady++;
    });

    return {
      schoolCode: MY_CODE,
      schoolName: school || '우리 학교',
      active: mates.length + 1,
      steady: steady,
      total: Math.round(total / 25) * 25,
      real: true
    };
  }

  /* ---------------------------------------------------- 상대 학교 만들기 */

  /** 문자열 → 32비트 정수 (같은 입력이면 항상 같은 값) */
  function hash(str) {
    var h = 2166136261, s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  /** 선형 합동 생성기 — 시드가 같으면 같은 수열이 나온다 */
  function rngFrom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /** 이번 주 월요일부터 지난 날 수 (월=1 … 일=7) */
  function elapsedDays() {
    return ((new Date().getDay() + 6) % 7) + 1;
  }

  /**
   * 상대 학교를 만든다. 시드는 (내 학교 + 티어 + 그 주) 라서
   * 같은 주 안에서는 새로고침해도 상대와 기록이 그대로다.
   */
  function rivals(me, tierIdx) {
    var rnd = rngFrom(hash(me.schoolName + '|' + tierIdx + '|' + weekKey(0)));
    var days = elapsedDays();
    var pool = NAMES.filter(function (n) { return n !== me.schoolName; });
    var out = [];

    for (var i = 0; i < GROUP_SIZE - 1; i++) {
      // 이름은 겹치지 않게 풀에서 뽑아 낸다
      var pick = Math.floor(rnd() * pool.length);
      var name = pool.splice(pick, 1)[0] || ('학교 ' + (i + 1));

      var active = 3 + Math.floor(rnd() * 14);
      var pace = 0.6 + rnd() * 0.9;
      // 티어가 높을수록 상대의 기본 체력이 올라간다
      var base = (200 + rnd() * 900) * (1 + tierIdx * 0.45);

      out.push({
        schoolCode: 'R' + (i < 10 ? '0' + i : i),
        schoolName: name,
        active: active,
        steady: Math.floor(active * (0.3 + rnd() * 0.5)),
        total: Math.round((base + active * 40 * pace * days * 0.28) / 25) * 25,
        real: false
      });
    }
    return out;
  }

  /* --------------------------------------------------------------- 조회 */

  /** 이번 주 판 전체. 프로필이 없으면 null. */
  function board() {
    var me = mySchool();
    if (!me) return null;

    var st = load();
    var tierIdx = Math.max(0, Math.min(TIERS.length - 1, st.tierIdx));
    var tier = TIERS[tierIdx];

    var ranked = rankGroup([me].concat(rivals(me, tierIdx)));
    var size = ranked.length;
    var z = zoneSizes(tier, size);

    var mine = null;
    ranked.forEach(function (s) { if (s.schoolCode === MY_CODE) mine = s; });

    var myZone = getZone(mine.rank, tier, size);

    /* 승급선·강등선까지 남은 시간
     *  승급권: 나를 밀어낼 바로 아래 학교와 벌린 여유
     *  안전권: 승급선에 있는 학교를 넘어서는 데 필요한 양
     *  강등권: 강등선 바로 위 학교를 넘어서는 데 필요한 양 */
    var gap = 0;
    if (myZone === 'promote') {
      gap = mine.total - (ranked[z.promote] ? ranked[z.promote].total : 0);
    } else if (myZone === 'demote') {
      var above = ranked[size - z.demote - 1];
      gap = (above ? above.total : mine.total) - mine.total + 25;
    } else if (z.promote > 0) {
      var line = ranked[z.promote - 1];
      gap = (line ? line.total : mine.total) - mine.total + 25;
    }

    /* 지난번에 본 순위와 비교해 변동을 표시한다 */
    var deltas = {};
    ranked.forEach(function (s) {
      var p = st.prevRanks[s.schoolCode];
      if (p !== undefined && p !== s.rank) deltas[s.schoolCode] = p - s.rank;
    });

    return {
      tier: tier, tierIdx: tierIdx, tiers: TIERS,
      ranked: ranked, size: size,
      promote: z.promote, demote: z.demote,
      me: mine, myZone: myZone, gap: Math.abs(gap),
      deltas: deltas,
      daysLeft: 7 - elapsedDays(),
      todayMin: Math.min(global.StudyLog.todayTotal(), DAILY_CAP_MINUTES),
      capLeft: Math.max(0, DAILY_CAP_MINUTES - global.StudyLog.todayTotal()),
      lastResult: st.lastResult
    };
  }

  /** 지금 순위를 기억해 둔다. 다음에 열 때 ▲▼ 로 보여 주기 위해서다. */
  function snapshot(ranked) {
    var st = load();
    var snap = {};
    ranked.forEach(function (s) { snap[s.schoolCode] = s.rank; });
    st.prevRanks = snap;
    save(st);
  }

  /**
   * 주가 바뀌었으면 지난 주 결과로 티어를 올리거나 내린다.
   * 화면을 열 때 한 번 호출한다. 이미 정산한 주면 아무 일도 하지 않는다.
   */
  function settleIfNeeded() {
    var st = load();
    var wk = weekKey(0);
    if (st.weekKey === wk) return null;

    // 첫 실행이면 정산할 지난주가 없다
    if (!st.weekKey) {
      st.weekKey = wk;
      save(st);
      return null;
    }

    var b = board();
    if (!b) return null;

    var result = 'stay', from = b.tierIdx, to = b.tierIdx;
    if (b.myZone === 'promote' && b.tierIdx < TIERS.length - 1) { result = 'promote'; to = b.tierIdx + 1; }
    else if (b.myZone === 'demote' && b.tierIdx > 0) { result = 'demote'; to = b.tierIdx - 1; }

    var payload = {
      result: result, rank: b.me.rank, total: b.me.total,
      fromTier: TIERS[from].name, toTier: TIERS[to].name,
      weekKey: st.weekKey
    };

    st.tierIdx = to;
    st.weekKey = wk;
    st.prevRanks = {};
    st.lastResult = payload;
    save(st);
    return payload;
  }

  /** 정산 안내를 읽었을 때 지운다 */
  function clearResult() {
    var st = load();
    st.lastResult = null;
    save(st);
  }

  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ }
  }

  global.League = {
    TIERS: TIERS, GROUP_SIZE: GROUP_SIZE, DAILY_CAP_MINUTES: DAILY_CAP_MINUTES,
    zoneSizes: zoneSizes, getZone: getZone, rankGroup: rankGroup,
    board: board, snapshot: snapshot,
    settleIfNeeded: settleIfNeeded, clearResult: clearResult, reset: reset,
    myCappedWeek: myCappedWeek, MY_CODE: MY_CODE
  };

})(window);
