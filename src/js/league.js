/* =========================================================================
 * league.js — 학교 대항 주간 리그
 *
 * 개인 랭킹(group.js)이 "같은 반 친구들과의 겨루기"라면,
 * 리그는 "우리 학교 전체가 다른 학교와 겨루는" 한 단계 위의 판이다.
 *
 * 순위에 오르는 학교는 전부 실제 기록이 있는 학교다.
 *   · 우리 학교  — 내 순공 시간(StudyLog) + 같은 학교 그룹원
 *   · 다른 학교  — 공유 코드를 받아 등록한 다른 학교 사용자들
 * 지어낸 상대는 넣지 않는다. 그래서 아무도 등록하지 않았으면
 * 리그에는 우리 학교 하나만 뜨고, 화면이 그 사실을 그대로 말해 준다.
 *
 * ⚠ 서버가 없어 자동 동기화는 되지 않는다. 다른 학교가 판에 들어오려면
 *   그 학교 사용자의 공유 코드를 [랭킹] 화면에서 등록해야 한다.
 *   그룹원 수치는 코드를 받은 시점의 값이다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;

  var DAILY_CAP_MINUTES = 300;  // 하루에 인정되는 최대 순공 시간
  var GROUP_SIZE = 20;          // 승급·강등 폭의 기준이 되는 표준 리그 크기
  var MIN_FIELD = 5;            // 이보다 작으면 승급·강등을 따지지 않는다
  var STORE_KEY = 'neurostudy.league.v1';

  var TIERS = [
    { id: 'seed',   name: '씨앗', promote: 5, demote: 0 },
    { id: 'sprout', name: '새싹', promote: 5, demote: 4 },
    { id: 'leaf',   name: '잎새', promote: 5, demote: 4 },
    { id: 'tree',   name: '나무', promote: 4, demote: 5 },
    { id: 'forest', name: '숲',   promote: 0, demote: 5 }
  ];

  var MY_CODE = '__me__';

  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }

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

  /** 이번 주 월요일부터 지난 날 수 (월=1 … 일=7) */
  function elapsedDays() {
    return ((new Date().getDay() + 6) % 7) + 1;
  }

  /* ------------------------------------------------------ 학교별로 묶기 */

  /**
   * 이 브라우저가 아는 사람들을 학교 단위로 모은다.
   * 나와 그룹원이 전부이므로, 다른 학교가 판에 들어오려면
   * 그 학교 사용자의 공유 코드를 등록해야 한다.
   */
  function schools() {
    var p = S.profile();
    if (!p) return [];

    var meId = global.Group.memberId(p);
    var myName = norm(p.school) || '우리 학교';
    var acc = {};

    function bucket(name) {
      var k = name || '(학교 미상)';
      if (!acc[k]) {
        acc[k] = {
          schoolCode: k === myName ? MY_CODE : 'S:' + k,
          schoolName: k, active: 0, steady: 0, total: 0,
          mine: k === myName, staleAt: 0
        };
      }
      return acc[k];
    }

    // 나 — 유일하게 실시간인 값이다
    var mine = myCappedWeek();
    var b = bucket(myName);
    b.active++;
    b.total += mine;
    if (global.StudyLog.streak() >= 3) b.steady++;

    // 그룹원 — 공유 코드를 받은 시점의 스냅숏
    global.Group.members().forEach(function (m) {
      if (m.id === meId) return;
      var bb = bucket(norm(m.school));
      bb.active++;
      bb.total += Math.min(m.weekMin || 0, DAILY_CAP_MINUTES * 7);
      if ((m.streak || 0) >= 3) bb.steady++;
      if (m.ts && m.ts > bb.staleAt) bb.staleAt = m.ts;
    });

    var local = Object.keys(acc).map(function (k) {
      var s = acc[k];
      s.total = Math.round(s.total / 25) * 25;
      return s;
    });

    return mergeCloud(local, myName);
  }

  /* ------------------------------------------------------------ 서버 병합
   * 리그를 켜면 다른 학교의 집계가 서버에서 내려온다.
   * 서버를 쓰지 않거나 아직 못 받았으면 cloudRows 가 비어 있고,
   * 그때는 예전처럼 이 브라우저가 아는 학교만 나온다. */

  var cloudRows = [];   // [{schoolName, total, active, updatedAt}]
  var cloudWeek = '';

  function setCloudRows(rows, wk) {
    cloudRows = Array.isArray(rows) ? rows : [];
    cloudWeek = wk || '';
  }

  function mergeCloud(local, myName) {
    if (!cloudRows.length || cloudWeek !== weekKey(0)) return local;

    var byName = {};
    local.forEach(function (s) { byName[s.schoolName] = s; });

    cloudRows.forEach(function (r) {
      var cur = byName[r.schoolName];
      if (!cur) {
        byName[r.schoolName] = {
          schoolCode: r.schoolName === myName ? MY_CODE : 'S:' + r.schoolName,
          schoolName: r.schoolName,
          active: r.active, steady: 0,
          total: Math.round(r.total / 25) * 25,
          mine: r.schoolName === myName,
          staleAt: r.updatedAt, fromCloud: true
        };
        return;
      }
      /* 이 브라우저가 아는 값과 서버 값이 다를 수 있다.
       * 서버에는 리그를 켠 사람만 올라오고, 여기에는 공유 코드를 준 사람만 있다.
       * 어느 쪽도 전부가 아니므로 더 큰 쪽을 쓴다. */
      var cloudTotal = Math.round(r.total / 25) * 25;
      if (cloudTotal > cur.total) cur.total = cloudTotal;
      if (r.active > cur.active) cur.active = r.active;
      if (r.updatedAt > cur.staleAt) cur.staleAt = r.updatedAt;
      cur.fromCloud = true;
    });

    return Object.keys(byName).map(function (k) { return byName[k]; });
  }

  /**
   * 서버에 내 기록을 올리고 그 주의 집계를 받아 온다.
   * 리그가 꺼져 있으면 아무 일도 하지 않는다.
   */
  function syncNow(force) {
    var C = global.Cloud;
    if (!C || !C.enabled()) return Promise.resolve(false);

    var p = S.profile();
    if (!p) return Promise.resolve(false);

    var wk = weekKey(0);
    var school = norm(p.school);

    // 학급 정보는 Cloud 쪽에서 동의 여부를 보고 실을지 결정한다
    var cls = { level: p.level, grade: p.grade, klass: norm(p.klass) };

    return C.push(school, wk, myCappedWeek(), force, cls)
      .catch(function () { return false; })          // 못 올려도 읽기는 시도한다
      .then(function () { return C.fetchWeek(wk); })
      .then(function (rows) {
        setCloudRows(rows, wk);
        return true;
      });
  }

  /* --------------------------------------------------------------- 조회 */

  /** 이번 주 판 전체. 프로필이 없으면 null. */
  function board() {
    var list = schools();
    if (!list.length) return null;

    var st = load();
    var tierIdx = Math.max(0, Math.min(TIERS.length - 1, st.tierIdx));
    var tier = TIERS[tierIdx];

    var ranked = rankGroup(list);
    var size = ranked.length;

    /* 참가 학교가 몇 곳 안 되면 승급·강등은 뜻이 없다.
     * 1개교뿐인데 1위라고 승급시키는 것은 눈속임이다. */
    var ranked3 = size >= MIN_FIELD;
    var z = ranked3 ? zoneSizes(tier, size) : { promote: 0, demote: 0 };
    // 승급권과 강등권이 판 전체를 덮으면 가운데가 없어져 선이 의미를 잃는다
    if (z.promote + z.demote >= size) { z.promote = 0; z.demote = 0; }

    var mine = null;
    ranked.forEach(function (s) { if (s.schoolCode === MY_CODE) mine = s; });
    if (!mine) return null;

    var myZone = z.promote || z.demote ? getZone(mine.rank, { promote: z.promote, demote: z.demote }, size) : 'stay';

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

    /* 나보다 바로 앞선 학교 — 판이 작아 승강이 없을 때 보여 줄 목표 */
    var ahead = mine.rank > 1 ? ranked[mine.rank - 2] : null;

    return {
      tier: tier, tierIdx: tierIdx, tiers: TIERS,
      ranked: ranked, size: size,
      promote: z.promote, demote: z.demote,
      ranked3: ranked3, minField: MIN_FIELD,
      solo: size < 2,
      me: mine, myZone: myZone, gap: Math.abs(gap),
      ahead: ahead,
      aheadGap: ahead ? (ahead.total - mine.total + 25) : 0,
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

    /* 참가 학교가 MIN_FIELD 미만이면 겨룬 상대가 없는 것이나 마찬가지다.
     * 이런 주는 티어를 건드리지 않고 넘어간다. */
    if (!b.ranked3) {
      st.weekKey = wk;
      st.prevRanks = {};
      save(st);
      return null;
    }

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
    MIN_FIELD: MIN_FIELD,
    zoneSizes: zoneSizes, getZone: getZone, rankGroup: rankGroup,
    schools: schools, board: board, snapshot: snapshot,
    syncNow: syncNow, setCloudRows: setCloudRows,
    settleIfNeeded: settleIfNeeded, clearResult: clearResult, reset: reset,
    myCappedWeek: myCappedWeek, MY_CODE: MY_CODE
  };

})(window);
