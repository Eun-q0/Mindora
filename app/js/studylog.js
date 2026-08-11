/* =========================================================================
 * studylog.js — 순공(순수 공부) 시간 기록
 *
 * 타이머가 "집중" 상태로 실제 흐른 시간만 누적한다.
 * 일시정지·휴식·건너뛴 시간은 쌓이지 않는다.
 *
 * 저장 형태 (용량을 아끼려고 날짜 × 과목으로 접어서 보관)
 *   { "2026-07-27": { "미적분": { t: "calculate", m: 62.5 }, ... }, ... }
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;

  function all() { return S.sessions(); }

  /** 순공 시간 누적 (분 단위, 소수 허용)
   * atDate 를 넘기면 그 날짜에 기록한다 (기본은 오늘) — 자정을 걸친 구간을
   * 나눠 기록할 때 쓴다. 넘기지 않으면 항상 "지금"의 날짜로 기록된다. */
  function add(subject, type, minutes, atDate) {
    if (!subject || !(minutes > 0)) return;
    var data = all();
    var k = S.key(atDate);
    if (!data[k]) data[k] = {};
    if (!data[k][subject]) data[k][subject] = { t: type || 'mixed', m: 0 };
    data[k][subject].m = Math.round((data[k][subject].m + minutes) * 100) / 100;
    S.saveSessions(data);
  }

  function dayMap(dateKey) { return all()[dateKey] || {}; }

  function dayTotal(dateKey) {
    var m = dayMap(dateKey), sum = 0;
    Object.keys(m).forEach(function (k) { sum += m[k].m; });
    return sum;
  }

  function daySubjects(dateKey) {
    var m = dayMap(dateKey);
    return Object.keys(m)
      .map(function (name) { return { name: name, type: m[name].t, min: m[name].m }; })
      .sort(function (a, b) { return b.min - a.min; });
  }

  function todayTotal() { return dayTotal(S.key()); }

  /** [from, to] 구간의 날짜별 합계 */
  function rangeDays(from, to) {
    var out = [], d = new Date(from.getTime());
    var today = S.key();
    while (d <= to) {
      var k = S.key(d);
      out.push({
        date: k,
        dow: S.DOW[(d.getDay() + 6) % 7],
        min: dayTotal(k),
        isToday: k === today,
        isFuture: k > today
      });
      d = S.addDays(d, 1);
    }
    return out;
  }

  /** 구간 과목별 합계 */
  function rangeSubjects(from, to) {
    var acc = {}, d = new Date(from.getTime());
    while (d <= to) {
      var m = dayMap(S.key(d));
      Object.keys(m).forEach(function (name) {
        if (!acc[name]) acc[name] = { name: name, type: m[name].t, min: 0 };
        acc[name].min += m[name].m;
      });
      d = S.addDays(d, 1);
    }
    return Object.keys(acc).map(function (k) { return acc[k]; })
      .sort(function (a, b) { return b.min - a.min; });
  }

  function rangeTotal(from, to) {
    return rangeDays(from, to).reduce(function (s, d) { return s + d.min; }, 0);
  }

  /** offset 0 = 이번 주, -1 = 지난주 */
  function week(offset) {
    var start = S.addDays(S.weekStart(new Date()), (offset || 0) * 7);
    var end = S.addDays(start, 6);
    return { start: start, end: end, days: rangeDays(start, end), subjects: rangeSubjects(start, end), total: rangeTotal(start, end) };
  }

  function weekTotal(offset) { return week(offset).total; }

  /** 오늘(또는 어제)부터 거꾸로 세는 연속 학습일 */
  function streak() {
    var data = all();
    var d = new Date(); d.setHours(0, 0, 0, 0);
    // 오늘 아직 공부 전이면 어제부터 센다
    if (!(dayTotal(S.key(d)) > 0)) d = S.addDays(d, -1);
    var n = 0;
    while (n < 400) {
      var k = S.key(d);
      if (!data[k]) break;
      var t = 0;
      Object.keys(data[k]).forEach(function (s) { t += data[k][s].m; });
      if (!(t > 0)) break;
      n++;
      d = S.addDays(d, -1);
    }
    return n;
  }

  global.StudyLog = {
    add: add, all: all,
    dayTotal: dayTotal, daySubjects: daySubjects, todayTotal: todayTotal,
    rangeDays: rangeDays, rangeSubjects: rangeSubjects, rangeTotal: rangeTotal,
    week: week, weekTotal: weekTotal, streak: streak
  };

})(window);
