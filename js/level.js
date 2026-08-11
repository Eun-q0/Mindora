/* =========================================================================
 * level.js — 완주 포인트와 학습 레벨
 *
 * 집중 블록을 **건너뛰지 않고 끝까지** 마칠 때마다 포인트가 쌓이고,
 * 포인트가 모이면 레벨이 오른다. 이 레벨은 랭킹에서 같은 반 친구에게 보인다.
 *
 * 왜 순공 시간이 아니라 완주인가
 *   순공 시간은 이미 랭킹·리그·젤리가 보고 있다. 여기서 세는 것은 다른 것 —
 *   **시작한 것을 끝내는 습관**이다. 40분을 켜 두고 두 번 끊은 사람과
 *   35분 한 블록을 끝까지 앉아 있은 사람은 순공 시간이 비슷해도 다르다.
 *
 * 건너뛴 블록은 세지 않는다
 *   pomodoro.js 의 skip() 은 onComplete 를 부르지 않고 _advance() 로 바로 넘어간다.
 *   그래서 "완주만 센다" 는 규칙이 이 파일의 조건문이 아니라 타이머 구조 자체로
 *   지켜진다 — 나중에 누가 이 파일을 고쳐도 건너뛴 블록이 새어 들어오지 않는다.
 *
 * 기존 레벨들과의 관계
 *   · Kids 경험치 — 초·중 전용, 순공 1분 = 1 XP. 성장 모드 화면 안에서만 쓴다.
 *   · 모리(Slime) 레벨 — 지금 키우는 한 마리의 성장 단계. 홈으로 보내면 1로 돌아간다.
 *   · 여기 학습 레벨 — 학교급과 무관하고 줄어들지 않는다. 밖(랭킹)에 보이는 값은 이것뿐이다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'mindora.level.v1';

  /* 한 블록 완주 = 기본 10점 + 길이 보너스(5분당 1점).
   * 기본값을 크게 둔 이유: 컨디션이 나쁜 날의 15분 블록도 "끝냈다" 는 같으므로,
   * 길이로만 주면 회복 우선 모드가 손해가 되어 짧게 쉬라는 권고와 부딪힌다. */
  var BASE_POINTS = 10;
  var MIN_PER_BONUS = 5;

  /* 레벨 n → n+1 에 필요한 점수. 초반에는 하루에 한 번쯤 오르고 점점 느려진다. */
  function needFor(level) { return 40 + (level - 1) * 20; }

  function pointsFor(minutes) {
    var m = Math.max(0, Number(minutes) || 0);
    return BASE_POINTS + Math.round(m / MIN_PER_BONUS);
  }

  function blank() {
    return { points: 0, blocks: 0, lastAt: 0, pending: 0 };
  }

  function load() {
    var d = blank();
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object') return d;
      d.points = Math.max(0, Math.round(Number(o.points) || 0));
      d.blocks = Math.max(0, Math.round(Number(o.blocks) || 0));
      d.lastAt = Number(o.lastAt) || 0;
      /* 레벨업을 아직 화면에 알리지 않은 횟수. 축하는 한 번만 떠야 한다. */
      d.pending = Math.max(0, Math.round(Number(o.pending) || 0));
    } catch (e) { /* 무시 */ }
    return d;
  }

  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); return true; }
    catch (e) { return false; }
  }

  /** 누적 점수 → 레벨과 그 레벨 안에서의 진행도 */
  function levelOf(points) {
    var lv = 1, rem = Math.max(0, points || 0);
    // 400 은 안전장치다. 이 값이면 점수가 수십만이라 정상 사용으로는 닿지 않는다.
    while (lv < 400 && rem >= needFor(lv)) { rem -= needFor(lv); lv++; }
    var need = needFor(lv);
    return {
      level: lv,
      into: rem,
      need: need,
      pct: need > 0 ? Math.min(100, Math.round(rem / need * 100)) : 0
    };
  }

  /** 집중 블록 하나를 완주했다. 오른 레벨 수를 돌려준다(0 이면 그대로). */
  function award(minutes) {
    var d = load();
    var before = levelOf(d.points).level;

    d.points += pointsFor(minutes);
    d.blocks += 1;
    d.lastAt = Date.now();

    var after = levelOf(d.points).level;
    var gained = Math.max(0, after - before);
    d.pending += gained;
    save(d);
    return gained;
  }

  /** 아직 알리지 않은 레벨업이 있으면 그 횟수를 돌려주고 표시를 지운다 */
  function takeLevelUp() {
    var d = load();
    var n = d.pending;
    if (n > 0) { d.pending = 0; save(d); }
    return n;
  }

  function summary() {
    var d = load();
    var lv = levelOf(d.points);
    return {
      level: lv.level, into: lv.into, need: lv.need, pct: lv.pct,
      points: d.points, blocks: d.blocks, lastAt: d.lastAt
    };
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  }

  /* ------------------------------------------------------------ 자체 점검
   * 콘솔에서 `Level.selfTest()`. 저장소를 건드리지 않고 계산만 확인한다. */
  function selfTest() {
    var out = [];
    function check(name, cond, got) {
      out.push({ ok: !!cond, name: name, got: got });
    }

    check('15분 완주 = 13점', pointsFor(15) === 13, pointsFor(15));
    check('35분 완주 = 17점', pointsFor(35) === 17, pointsFor(35));
    check('50분 완주 = 20점', pointsFor(50) === 20, pointsFor(50));
    /* 짧은 블록이 손해가 되면 회복 우선 모드를 권하는 것과 부딪힌다.
     * 50분 한 번(20점)이 15분 두 번(26점)보다 커서는 안 된다. */
    check('짧게 여러 번이 길게 한 번보다 손해가 아니다',
      pointsFor(15) * 2 > pointsFor(50), pointsFor(15) * 2 + ' vs ' + pointsFor(50));

    check('0점은 레벨 1', levelOf(0).level === 1, levelOf(0).level);
    check('39점은 아직 레벨 1', levelOf(39).level === 1, levelOf(39).level);
    check('40점에 레벨 2', levelOf(40).level === 2, levelOf(40).level);
    check('100점(40+60)에 레벨 3', levelOf(100).level === 3, levelOf(100).level);
    check('레벨 안 진행도가 need 를 넘지 않는다',
      levelOf(99).into < levelOf(99).need, levelOf(99).into + '/' + levelOf(99).need);
    check('레벨이 오를수록 더 필요하다', needFor(1) < needFor(2) && needFor(2) < needFor(3),
      needFor(1) + ' < ' + needFor(2) + ' < ' + needFor(3));
    check('점수는 단조 증가', levelOf(1000).level > levelOf(500).level,
      levelOf(500).level + ' -> ' + levelOf(1000).level);
    check('말도 안 되는 값에도 멈춘다', levelOf(1e9).level <= 400, levelOf(1e9).level);
    check('음수·NaN 은 레벨 1', levelOf(-5).level === 1 && levelOf(NaN).level === 1);

    /* eslint-disable no-console */
    out.forEach(function (r) {
      console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.got !== undefined ? '  → ' + r.got : ''));
    });
    var bad = out.filter(function (r) { return !r.ok; }).length;
    console.log(bad ? '❌ ' + bad + '개 실패' : '✅ ' + out.length + '개 통과');
    return out;
  }

  global.Level = {
    award: award, summary: summary, levelOf: levelOf, pointsFor: pointsFor,
    needFor: needFor, takeLevelUp: takeLevelUp, reset: reset, selfTest: selfTest,
    STORAGE_KEY: KEY
  };

})(window);
