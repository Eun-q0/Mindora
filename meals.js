/* =========================================================================
 * meals.js — 계획표에서 읽은 식사 시각 + 식사 시간 알리미
 *
 * 이 파일이 "오늘 몇 시에 무엇을 먹기로 했는가" 의 유일한 출처다.
 * 두 곳에서 같은 답을 쓴다.
 *
 *   1) 알리미  — 그 시각이 되면 알려 준다
 *   2) 준비도  — engine.js 의 식사 요인이 이 시각을 기준으로 채점한다
 *
 * 시각을 정하는 순서 (앞이 이기면 뒤는 보지 않는다)
 *
 *   ① 설정에서 직접 넣은 시각            source: 'manual'
 *   ② 계획표(오늘 요일 칸)에 적힌 식사    source: 'plan'
 *   ③ 계획표의 다른 요일에 적힌 식사      source: 'plan-other'
 *   ④ 계획표는 있는데 그 끼니만 없음      source: 'unplanned'  ← 채점도 알림도 하지 않는다
 *   ⑤ 계획표 자체가 없음                  source: 'default'    ← 표준 시각으로 채점만 한다
 *
 * ④ 가 핵심이다. "저녁은 원래 안 먹는다" 는 사람에게 저녁 결식을 감점하면
 * 그 점수는 그 사람에게 아무 의미가 없다.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* 계획표 모델의 저장 키. app.js 의 VP_KEY 와 같은 값이어야 한다. */
  var VP_KEY = 'neurostudy.vacplan.v1';
  var KEY = 'mindora.mealalarm.v1';

  /* 알림이 늦게 울리는 것을 어디까지 허용할지.
   * 화면을 닫아 두면 타이머가 멈추므로, 다시 열었을 때 지난 알림을 한 번 따라잡는다.
   * 두 시간 지난 "점심 드세요" 는 알림이 아니라 잔소리라서 그 뒤로는 조용히 넘긴다. */
  var LATE_H = 1.5;

  var MEALS = [
    { id: 'breakfast', label: '아침', icon: '🌅', words: ['아침', '조식'], fallback: 8.0, weight: 0.40 },
    { id: 'lunch', label: '점심', icon: '🌞', words: ['점심', '중식'], fallback: 12.5, weight: 0.35 },
    { id: 'dinner', label: '저녁', icon: '🌙', words: ['저녁', '석식'], fallback: 18.5, weight: 0.25 }
  ];

  /* 계획표에서 이 끼니를 못 찾았을 때 쓰는 표준 시각(fallback)에 engine.js 의
   * 유예 30분을 더하면 8:30 / 13:00 / 19:00 — 계획표를 쓰지 않는 사용자는
   * 기존과 똑같은 기준으로 채점된다. */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function clampHour(h) { return Math.max(0, Math.min(23.99, h)); }

  /** 소수 시각 → "HH:MM" */
  function fmtHour(h) {
    var t = ((h % 24) + 24) % 24;
    var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
    return pad(hh) + ':' + pad(mm);
  }

  /** "HH:MM" → 소수 시각. 못 읽으면 null */
  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
    return h + mi / 60;
  }

  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ------------------------------------------------------ 계획표 읽기 */

  /** 계획표 칸의 글자가 어떤 끼니인지. 식사가 아니면 null.
   *
   *  '아침' 한 글자만 보고 판단하면 '아침 운동' 까지 식사로 잡힌다.
   *  그래서 끼니 낱말이 통째로 칸을 이루거나(= '아침'),
   *  먹는다는 표시가 함께 있을 때만(= '아침식사', '저녁 먹기') 식사로 본다.
   *  조식·중식·석식은 그 자체가 식사를 뜻하므로 바로 통과시킨다. */
  var EAT_MARKS = ['식사', '급식', '밥', '먹', '식당'];

  function mealIdOf(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!t) return null;
    for (var i = 0; i < MEALS.length; i++) {
      var words = MEALS[i].words;
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (t.indexOf(w) < 0) continue;
        if (w.charAt(1) === '식') return MEALS[i].id;   // 조식 · 중식 · 석식
        if (t === w) return MEALS[i].id;                // '아침' · '점심' · '저녁'
        for (var k = 0; k < EAT_MARKS.length; k++) {
          if (t.indexOf(EAT_MARKS[k]) >= 0) return MEALS[i].id;
        }
      }
    }
    return null;
  }

  function isWake(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, '');
    return !!t && t.indexOf('기상') >= 0;
  }

  function planModel() {
    try {
      var raw = localStorage.getItem(VP_KEY);
      if (!raw) return null;
      var m = JSON.parse(raw);
      if (!m || !m.rows || !m.rows.length || !m.days || !m.days.length) return null;
      if (!m.rows[0] || !m.rows[0].cells) return null;
      return m;
    } catch (e) { return null; }
  }

  /** 계획표의 열 번호 (0 = 월요일). 요일 수가 7개가 아니어도 넘치지 않게 자른다. */
  function columnOf(model, date) {
    var idx = ((date || new Date()).getDay() + 6) % 7;   // 일=0 → 6
    return Math.min(idx, model.days.length - 1);
  }

  /** 주어진 열들에서 끼니별 가장 이른 시각을 모은다 */
  function scan(model, cols) {
    var out = {};
    model.rows.forEach(function (r) {
      var t = parseHM(r && r.time);
      if (t === null || !r.cells) return;
      cols.forEach(function (c) {
        var cell = r.cells[c];
        var id = mealIdOf(cell);
        if (id && (out[id] === undefined || t < out[id])) out[id] = t;
        if (isWake(cell) && (out.wake === undefined || t < out.wake)) out.wake = t;
      });
    });
    return out;
  }

  /** 계획표에서 읽은 오늘의 시각들. 계획표가 없으면 빈 객체. */
  function planTimes(date) {
    var m = planModel();
    if (!m) return { found: false };

    var col = columnOf(m, date);
    var allCols = [];
    for (var i = 0; i < m.days.length; i++) allCols.push(i);

    var mine = scan(m, [col]);
    var any = scan(m, allCols);

    var out = { found: true, wake: mine.wake !== undefined ? mine.wake : any.wake };
    var hasMeal = false;
    MEALS.forEach(function (def) {
      if (mine[def.id] !== undefined) { out[def.id] = { hour: mine[def.id], source: 'plan' }; hasMeal = true; }
      else if (any[def.id] !== undefined) { out[def.id] = { hour: any[def.id], source: 'plan-other' }; hasMeal = true; }
    });
    out.hasMeal = hasMeal;
    return out;
  }

  /* ------------------------------------------------------------- 설정 */

  function defaults() {
    return {
      on: true,
      leadMin: 0,                                       // 몇 분 전에 알릴지
      sound: false,                                     // 소리는 사용자가 켜야 난다
      times: { breakfast: '', lunch: '', dinner: '' },  // 비우면 계획표를 따른다
      enabled: { breakfast: true, lunch: true, dinner: true },
      fired: { date: '', ids: [] }                      // 오늘 이미 울린 끼니
    };
  }

  var LEADS = [0, 5, 10, 30];

  function settings() {
    var d = defaults(), v = null;
    try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { v = null; }
    if (!v || typeof v !== 'object') return d;

    if (typeof v.on === 'boolean') d.on = v.on;
    if (typeof v.sound === 'boolean') d.sound = v.sound;
    if (LEADS.indexOf(v.leadMin) >= 0) d.leadMin = v.leadMin;
    MEALS.forEach(function (m) {
      if (v.times && parseHM(v.times[m.id]) !== null) d.times[m.id] = String(v.times[m.id]).trim();
      if (v.enabled && typeof v.enabled[m.id] === 'boolean') d.enabled[m.id] = v.enabled[m.id];
    });
    if (v.fired && typeof v.fired.date === 'string' && v.fired.ids instanceof Array) {
      d.fired = { date: v.fired.date, ids: v.fired.ids.slice(0, 8) };
    }
    return d;
  }

  function save(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  /** 설정 일부만 바꿔 저장한다 */
  function patch(changes) {
    var s = settings();
    Object.keys(changes || {}).forEach(function (k) {
      if (k === 'times' || k === 'enabled') {
        Object.keys(changes[k]).forEach(function (id) { s[k][id] = changes[k][id]; });
      } else {
        s[k] = changes[k];
      }
    });
    save(s);
    return s;
  }

  /* --------------------------------------------------------- 오늘 일정 */

  /** 오늘의 식사 시각. 알리미와 준비도가 같은 값을 본다. */
  function schedule(date) {
    date = date || new Date();
    var s = settings();
    var p = planTimes(date);

    var meals = MEALS.map(function (def) {
      var manual = parseHM(s.times[def.id]);
      var hour, source;

      if (manual !== null) { hour = manual; source = 'manual'; }
      else if (p[def.id]) { hour = p[def.id].hour; source = p[def.id].source; }
      else if (p.hasMeal) { hour = def.fallback; source = 'unplanned'; }
      else { hour = def.fallback; source = 'default'; }

      return {
        id: def.id, label: def.label, icon: def.icon, weight: def.weight,
        hour: clampHour(hour), source: source,
        /* 채점 대상인가. 계획표에 다른 끼니는 적어 두고 이 끼니만 빠져 있다면
         * 안 먹기로 한 것이므로 결식으로 세지 않는다. */
        counts: source !== 'unplanned',
        /* 알림 대상인가. 표준 시각은 우리가 찍어 준 값이라 알림까지 울리지 않는다 —
         * 사용자가 계획표에 적었거나 직접 시각을 넣은 끼니만 알려 준다. */
        alarmable: source === 'manual' || source === 'plan' || source === 'plan-other',
        on: s.enabled[def.id] !== false
      };
    });

    meals.sort(function (a, b) { return a.hour - b.hour; });

    return {
      meals: meals,
      wakeHour: p.wake === undefined ? null : p.wake,
      hasPlan: !!p.found,
      planHasMeal: !!p.hasMeal,
      /* 알림을 걸 수 있는 끼니가 하나도 없으면 화면에서 이유를 알려 줘야 한다 */
      alarmable: meals.filter(function (m) { return m.alarmable; }).length
    };
  }

  /** engine.js 의 식사 요인에 넘길 형태 */
  function engineInput(date) {
    var sc = schedule(date);
    return {
      wakeHour: sc.wakeHour,
      hasPlan: sc.hasPlan,
      meals: sc.meals.map(function (m) {
        return { id: m.id, label: m.label, hour: m.hour, weight: m.weight, counts: m.counts, source: m.source };
      })
    };
  }

  /** 지금 기준 다음 끼니. 오늘 남은 게 없으면 내일 첫 끼니를 준다. */
  function next(date) {
    date = date || new Date();
    var nowH = date.getHours() + date.getMinutes() / 60;
    var sc = schedule(date);
    var list = sc.meals.filter(function (m) { return m.counts; });
    if (!list.length) return null;

    for (var i = 0; i < list.length; i++) {
      if (list[i].hour > nowH) return { meal: list[i], inHours: list[i].hour - nowH, tomorrow: false };
    }
    var first = list[0];
    return { meal: first, inHours: 24 - nowH + first.hour, tomorrow: true };
  }

  /* --------------------------------------------------------- 알리미 */

  var timer = null, hooks = {};

  function firedToday(s, date) {
    var dk = dateKey(date);
    return (s.fired && s.fired.date === dk) ? s.fired.ids : [];
  }

  function markFired(id, date) {
    var s = settings();
    var dk = dateKey(date);
    var ids = (s.fired && s.fired.date === dk) ? s.fired.ids.slice() : [];
    if (ids.indexOf(id) < 0) ids.push(id);
    s.fired = { date: dk, ids: ids };
    save(s);
  }

  /** 오늘 이 끼니 알림을 이미 처리했는지 (테스트·되돌리기용) */
  function resetFired(date) {
    var s = settings();
    s.fired = { date: dateKey(date), ids: [] };
    save(s);
  }

  /** 지금 울려야 할 끼니가 있는지 확인한다. 30초마다, 그리고 화면이 돌아올 때마다 부른다. */
  function check(date) {
    date = date || new Date();
    var s = settings();
    if (!s.on) return;

    var nowH = date.getHours() + date.getMinutes() / 60;
    var done = firedToday(s, date);
    var sc = schedule(date);

    sc.meals.forEach(function (m) {
      if (!m.alarmable || !m.on) return;
      if (done.indexOf(m.id) >= 0) return;

      var at = m.hour - (s.leadMin || 0) / 60;
      if (nowH < at) return;

      // 여기까지 왔으면 오늘 이 끼니는 한 번만 다룬다 — 늦었든, 이미 먹었든, 울리든.
      markFired(m.id, date);
      if (nowH > at + LATE_H) return;                          // 너무 늦게 열었다
      if (hooks.isEaten && hooks.isEaten(m.id)) return;        // 이미 먹었다고 체크해 뒀다
      if (hooks.onFire) hooks.onFire(m, { leadMin: s.leadMin || 0, sound: !!s.sound, at: at });
    });
  }

  function start(opts) {
    hooks = opts || {};
    stop();
    timer = setInterval(function () { check(); }, 30000);
    check();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  global.MealPlan = {
    MEALS: MEALS, LEADS: LEADS, LATE_H: LATE_H,
    settings: settings, save: save, patch: patch,
    schedule: schedule, engineInput: engineInput, next: next,
    planTimes: planTimes, mealIdOf: mealIdOf,
    start: start, stop: stop, check: check,
    markFired: markFired, resetFired: resetFired,
    fmtHour: fmtHour, parseHM: parseHM, STORAGE_KEY: KEY
  };

})(window);
