/* =========================================================================
 * kids.js — 초·중학생용 성장 모드
 *
 * 학교급이 초등학교 / 중학교일 때만 켜진다.
 * 순공 시간을 경험치로 바꿔 캐릭터를 키우고, 배지·미션·도장판으로
 * "오늘 뭘 하면 되는지"를 눈에 보이는 목표로 만들어 준다.
 *
 * 모든 달성 조건은 실제 기록에서만 판정한다. 임의로 주는 보상은 없다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;
  var KEY = 'neurostudy.kids.v1';

  /* ------------------------------------------------------------- 저장소 */

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      return d || { badges: {}, bonusXp: 0, blocks: {}, missions: {} };
    } catch (e) { return { badges: {}, bonusXp: 0, blocks: {}, missions: {} }; }
  }

  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 무시 */ }
  }

  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }

  function enabled() {
    var p = S.profile();
    return !!p && (p.level === '초등학교' || p.level === '중학교');
  }

  /* -------------------------------------------------------- 레벨 · 캐릭터 */

  var XP_PER_MISSION = 30;
  var XP_PER_BADGE = 50;

  /** 그 레벨을 끝내는 데 필요한 경험치 */
  function needFor(level) { return 100 + (level - 1) * 60; }

  function levelOf(xp) {
    var lv = 1, rem = Math.max(0, xp);
    while (lv < 99 && rem >= needFor(lv)) { rem -= needFor(lv); lv++; }
    return { level: lv, inLevel: Math.round(rem), need: needFor(lv) };
  }

  var CHARS = [
    { min: 1, emoji: '🥚', name: '알 뇌', line: '이제 막 깨어나려는 중이에요.' },
    { min: 3, emoji: '🐣', name: '아기 뇌', line: '조금씩 자라고 있어요!' },
    { min: 6, emoji: '🧠', name: '튼튼 뇌', line: '이제 제법 힘이 붙었어요.' },
    { min: 10, emoji: '⚡', name: '번쩍 뇌', line: '생각이 번쩍번쩍 빨라졌어요!' },
    { min: 15, emoji: '🌟', name: '반짝 뇌', line: '어려운 문제도 척척 풀어요.' },
    { min: 20, emoji: '🚀', name: '우주 뇌', line: '최고 단계예요. 정말 대단해요!' }
  ];

  function charFor(level) {
    var c = CHARS[0];
    for (var i = 0; i < CHARS.length; i++) if (level >= CHARS[i].min) c = CHARS[i];
    return c;
  }

  function nextChar(level) {
    for (var i = 0; i < CHARS.length; i++) if (CHARS[i].min > level) return CHARS[i];
    return null;
  }

  /** 총 경험치 = 지금까지 쌓은 순공 분 + 미션·배지 보너스 */
  function totalXp() {
    var d = load();
    var sess = global.StudyLog.all();
    var minutes = 0;
    Object.keys(sess).forEach(function (day) {
      Object.keys(sess[day]).forEach(function (sub) { minutes += sess[day][sub].m; });
    });
    return Math.round(minutes) + (d.bonusXp || 0);
  }

  function state() {
    var xp = totalXp();
    var lv = levelOf(xp);
    return {
      xp: xp, level: lv.level, inLevel: lv.inLevel, need: lv.need,
      pct: lv.need > 0 ? Math.min(100, lv.inLevel / lv.need * 100) : 0,
      char: charFor(lv.level), next: nextChar(lv.level),
      todayXp: Math.round(global.StudyLog.todayTotal())
    };
  }

  /* -------------------------------------------------------- 블록 카운트 */

  function addBlock() {
    var d = load(), k = S.key();
    d.blocks[k] = (d.blocks[k] || 0) + 1;
    save(d);
  }

  function blocksToday() { return load().blocks[S.key()] || 0; }

  /* ----------------------------------------------------------- 판정 컨텍스트 */

  function context() {
    var input = S.loadInput() || {};
    var today = S.key();
    var hist = S.history();
    var todayRec = null;
    for (var i = 0; i < hist.length; i++) if (hist[i].date === today) todayRec = hist[i];

    var p = S.profile() || {};
    var goalMin = (p.goal || 25) * 60;

    var rank = null;
    try { rank = global.Group.rank('today'); } catch (e) { rank = null; }

    return {
      todayMin: global.StudyLog.todayTotal(),
      subjectsToday: global.StudyLog.daySubjects(today).length,
      blocks: blocksToday(),
      streak: global.StudyLog.streak(),
      weekSubjects: global.StudyLog.week(0).subjects.length,
      weekMin: global.StudyLog.weekTotal(0),
      goalMin: goalMin,
      input: input,
      todayRec: todayRec,
      rank: rank
    };
  }

  /* --------------------------------------------------------------- 배지 */

  var BADGES = [
    { id: 'first', icon: '🌱', name: '첫걸음', desc: '처음으로 집중 블록을 끝냈어요', check: function (c) { return c.blocks >= 1; } },
    { id: 'min25', icon: '⏰', name: '25분 클리어', desc: '하루에 25분 넘게 공부했어요', check: function (c) { return c.todayMin >= 25; } },
    { id: 'min60', icon: '💪', name: '한 시간 돌파', desc: '하루에 1시간 넘게 공부했어요', check: function (c) { return c.todayMin >= 60; } },
    { id: 'min180', icon: '🏆', name: '3시간 챔피언', desc: '하루에 3시간 넘게 공부했어요', check: function (c) { return c.todayMin >= 180; } },
    { id: 'streak3', icon: '🔥', name: '3일 연속', desc: '3일 내리 공부했어요', check: function (c) { return c.streak >= 3; } },
    { id: 'streak7', icon: '🗓️', name: '일주일 개근', desc: '7일 내리 공부했어요', check: function (c) { return c.streak >= 7; } },
    { id: 'morning', icon: '🌅', name: '아침형 뇌', desc: '오전 9시 전에 공부를 시작했어요', check: function (c) { return c.input.startHour != null && c.input.startHour < 9 && c.todayMin > 0; } },
    { id: 'night', icon: '🦉', name: '저녁 집중', desc: '저녁 8시 넘어서도 공부했어요', check: function (c) { return c.input.startHour != null && c.input.startHour >= 20 && c.todayMin > 0; } },
    { id: 'subj3', icon: '📚', name: '과목 부자', desc: '하루에 3과목 이상 공부했어요', check: function (c) { return c.subjectsToday >= 3; } },
    { id: 'sleep8', icon: '😴', name: '꿀잠 요정', desc: '8시간 넘게 잤어요', check: function (c) { return c.input.sleep && c.input.sleep.hours >= 8; } },
    { id: 'meals3', icon: '🍚', name: '밥심 충전', desc: '아침·점심·저녁을 모두 먹었어요', check: function (c) { return c.input.meals && c.input.meals.breakfast && c.input.meals.lunch && c.input.meals.dinner; } },
    { id: 'water6', icon: '💧', name: '물 마시기 왕', desc: '물을 6컵 넘게 마셨어요', check: function (c) { return c.input.water >= 6; } },
    { id: 'move', icon: '🏃', name: '움직이는 뇌', desc: '20분 넘게 운동했어요', check: function (c) { return c.input.exercise >= 20; } },
    { id: 'brain80', icon: '🧠', name: '최상 컨디션', desc: '뇌 컨디션 80점을 넘겼어요', check: function (c) { return c.todayRec && c.todayRec.overall >= 80; } },
    { id: 'goal', icon: '🎯', name: '목표 달성', desc: '이번 주 목표를 다 채웠어요', check: function (c) { return c.goalMin > 0 && c.weekMin >= c.goalMin; } },
    { id: 'top1', icon: '🥇', name: '우리 반 1등', desc: '그룹 랭킹 1위를 했어요', check: function (c) { return c.rank && c.rank.me && c.rank.me.rank === 1 && c.rank.me.value > 0 && c.rank.count >= 2; } }
  ];

  function badgeList() {
    var d = load();
    return BADGES.map(function (b) {
      return { id: b.id, icon: b.icon, name: b.name, desc: b.desc, earnedOn: d.badges[b.id] || null };
    });
  }

  /** 새로 딴 배지를 반환 (없으면 빈 배열) */
  function checkBadges() {
    var d = load(), c = context(), fresh = [];
    BADGES.forEach(function (b) {
      if (d.badges[b.id]) return;
      var got = false;
      try { got = !!b.check(c); } catch (e) { got = false; }
      if (got) {
        d.badges[b.id] = S.key();
        d.bonusXp = (d.bonusXp || 0) + XP_PER_BADGE;
        fresh.push(b);
      }
    });
    if (fresh.length) save(d);
    return fresh;
  }

  /* ------------------------------------------------------------- 미션 */

  var MISSION_POOL = [
    { id: 'm30', icon: '⏱️', text: '오늘 30분 공부하기', goal: function () { return 30; }, now: function (c) { return c.todayMin; }, unit: '분' },
    { id: 'm60', icon: '🔋', text: '오늘 1시간 공부하기', goal: function () { return 60; }, now: function (c) { return c.todayMin; }, unit: '분' },
    { id: 'b2', icon: '🎯', text: '집중 블록 2개 완주하기', goal: function () { return 2; }, now: function (c) { return c.blocks; }, unit: '개' },
    { id: 'b4', icon: '🚩', text: '집중 블록 4개 완주하기', goal: function () { return 4; }, now: function (c) { return c.blocks; }, unit: '개' },
    { id: 'w6', icon: '💧', text: '물 6컵 마시기', goal: function () { return 6; }, now: function (c) { return c.input.water || 0; }, unit: '컵' },
    { id: 'br', icon: '🌅', text: '아침 먹고 공부 시작하기', goal: function () { return 1; }, now: function (c) { return (c.input.meals && c.input.meals.breakfast) ? 1 : 0; }, unit: '' },
    { id: 'sl', icon: '😴', text: '8시간 자고 오기', goal: function () { return 8; }, now: function (c) { return (c.input.sleep && c.input.sleep.hours) || 0; }, unit: '시간' },
    { id: 's3', icon: '📚', text: '3과목 이상 공부하기', goal: function () { return 3; }, now: function (c) { return c.subjectsToday; }, unit: '과목' },
    { id: 'ex', icon: '🏃', text: '20분 이상 몸 움직이기', goal: function () { return 20; }, now: function (c) { return c.input.exercise || 0; }, unit: '분' }
  ];

  /** 날짜를 씨앗으로 매일 같은 미션 3개를 뽑는다 (하루 안에서는 바뀌지 않음) */
  function todayMissions() {
    var k = S.key(), seed = 0;
    for (var i = 0; i < k.length; i++) seed = (seed * 31 + k.charCodeAt(i)) >>> 0;

    var pool = MISSION_POOL.slice(), picked = [];
    for (var n = 0; n < 3 && pool.length; n++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      picked.push(pool.splice(seed % pool.length, 1)[0]);
    }

    var c = context();
    var d = load();
    var doneList = d.missions[k] || [];

    return picked.map(function (m) {
      var goal = m.goal(), now = m.now(c);
      var done = now >= goal;
      return {
        id: m.id, icon: m.icon, text: m.text, unit: m.unit,
        goal: goal, now: Math.round(now * 10) / 10,
        pct: Math.min(100, goal > 0 ? now / goal * 100 : 0),
        done: done, rewarded: doneList.indexOf(m.id) >= 0
      };
    });
  }

  /** 새로 달성한 미션에 보너스 경험치를 준다 */
  function checkMissions() {
    var d = load(), k = S.key();
    var doneList = d.missions[k] || [];
    var fresh = [];
    todayMissions().forEach(function (m) {
      if (m.done && doneList.indexOf(m.id) < 0) {
        doneList.push(m.id);
        d.bonusXp = (d.bonusXp || 0) + XP_PER_MISSION;
        fresh.push(m);
      }
    });
    if (fresh.length) { d.missions[k] = doneList; save(d); }
    return fresh;
  }

  /* ------------------------------------------------------------- 도장판 */

  function stamps() {
    var p = S.profile() || {};
    var daily = ((p.goal || 25) * 60) / 7;
    return global.StudyLog.week(0).days.map(function (d) {
      return {
        dow: d.dow, date: d.date, min: d.min,
        isToday: d.isToday, isFuture: d.isFuture,
        got: d.min >= daily && daily > 0,
        pct: daily > 0 ? Math.min(100, d.min / daily * 100) : 0
      };
    });
  }

  /** 분석·블록완료 후 한 번에 호출 — 새로 딴 것들을 돌려준다 */
  function evaluate() {
    if (!enabled()) return { badges: [], missions: [], levelUp: null };
    var before = levelOf(totalXp()).level;
    var m = checkMissions();
    var b = checkBadges();
    var after = levelOf(totalXp()).level;
    return { badges: b, missions: m, levelUp: after > before ? { from: before, to: after, char: charFor(after) } : null };
  }

  global.Kids = {
    enabled: enabled, state: state, levelOf: levelOf, charFor: charFor,
    badgeList: badgeList, todayMissions: todayMissions, stamps: stamps,
    addBlock: addBlock, blocksToday: blocksToday,
    evaluate: evaluate, reset: reset,
    XP_PER_MISSION: XP_PER_MISSION, XP_PER_BADGE: XP_PER_BADGE
  };

})(window);
