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

  /** 그 날짜·과목의 순공 시간을 직접 정한다 (분, 절대값). 0 이하면 지운다.
   *
   *  왜 필요한가
   *    타이머로만 쌓이면 두 가지가 영영 틀린 채로 남는다.
   *      · 학원·독서실에서 앱을 못 켜고 공부한 시간 → 0분으로 남는다
   *      · 타이머를 끄는 걸 잊고 밥 먹으러 간 시간 → 안 한 공부가 쌓인다
   *    랭킹·리그·배지·젤리가 전부 이 숫자 위에 서 있어서, 한 번 틀어지면
   *    사용자는 숫자 전체를 믿지 않게 된다.
   *
   *  man 표시를 남기는 이유
   *    타이머가 잰 값과 손으로 넣은 값을 화면에서 구분해 보여 주기 위해서다.
   *    리그 합계에서 빼지는 않는다 — 뺐다가는 "내가 기록했는데 왜 안 올라가지"가
   *    되고, 어차피 타이머를 켜 두기만 해도 같은 일이 되므로 막는 효과도 없다.
   *    (리그는 하루 5시간 상한이 따로 걸려 있다.)
   */
  function set(dateKey, subject, minutes, type) {
    subject = String(subject || '').trim();
    if (!dateKey || !subject) return false;

    var data = all();
    var m = Math.round(Math.max(0, Math.min(24 * 60, Number(minutes) || 0)) * 100) / 100;

    if (!(m > 0)) return remove(dateKey, subject);

    if (!data[dateKey]) data[dateKey] = {};
    var prev = data[dateKey][subject];
    data[dateKey][subject] = { t: type || (prev && prev.t) || 'mixed', m: m, man: 1 };
    S.saveSessions(data);
    return true;
  }

  /** 그 날짜의 과목 기록을 지운다. 그 날이 비면 날짜 칸도 함께 지운다. */
  function remove(dateKey, subject) {
    var data = all();
    if (!data[dateKey] || !data[dateKey][subject]) return false;
    delete data[dateKey][subject];
    if (!Object.keys(data[dateKey]).length) delete data[dateKey];
    S.saveSessions(data);
    return true;
  }

  /** 지금까지 기록에 나온 과목 이름 (최근에 쓴 순서). 직접 입력할 때 후보로 쓴다. */
  function knownSubjects() {
    var data = all();
    var seen = {}, out = [];
    Object.keys(data).sort().reverse().forEach(function (d) {
      Object.keys(data[d]).forEach(function (name) {
        if (seen[name]) return;
        seen[name] = 1;
        out.push({ name: name, type: data[d][name].t });
      });
    });
    return out;
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
      .map(function (name) { return { name: name, type: m[name].t, min: m[name].m, manual: !!m[name].man }; })
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
    add: add, set: set, remove: remove, all: all, knownSubjects: knownSubjects,
    dayTotal: dayTotal, daySubjects: daySubjects, todayTotal: todayTotal,
    rangeDays: rangeDays, rangeSubjects: rangeSubjects, rangeTotal: rangeTotal,
    week: week, weekTotal: weekTotal, streak: streak
  };

})(window);
