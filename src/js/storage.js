/* =========================================================================
 * storage.js — localStorage 저장 계층 + 날짜 유틸
 * ========================================================================= */
(function (global) {
  'use strict';

  var K = {
    profile: 'neurostudy.profile.v1',
    input: 'neurostudy.input.v1',
    history: 'neurostudy.history.v1',   // 일별 뇌 컨디션
    sessions: 'neurostudy.sessions.v1', // 일별 × 과목 순공 시간(분)
    group: 'neurostudy.group.v1',       // 그룹원 기록
    schools: 'neurostudy.schools.v1'    // 예전에 입력한 학교명 (자동완성용)
  };

  var MAX_HISTORY = 180;

  var ok = (function () {
    try {
      localStorage.setItem('__ns__', '1');
      localStorage.removeItem('__ns__');
      return true;
    } catch (e) { return false; }
  })();

  function read(key, fallback) {
    if (!ok) return fallback;
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, val) {
    if (!ok) return false;
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------ 날짜 유틸 */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** 로컬 기준 YYYY-MM-DD (toISOString 은 UTC 라 날짜가 밀릴 수 있어 쓰지 않는다) */
  function key(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseKey(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  /** 그 날이 속한 주의 월요일 */
  function weekStart(d) {
    var x = new Date((d || new Date()).getTime());
    x.setHours(0, 0, 0, 0);
    var dow = (x.getDay() + 6) % 7; // 월=0 … 일=6
    return addDays(x, -dow);
  }

  var DOW = ['월', '화', '수', '목', '금', '토', '일'];

  /* ------------------------------------------------------------- 접근자 */

  function profile() { return read(K.profile, null); }
  function saveProfile(p) { return write(K.profile, p); }
  function clearProfile() { if (ok) localStorage.removeItem(K.profile); }

  function loadInput() { return read(K.input, null); }
  function saveInput(v) { return write(K.input, v); }

  function history() { return read(K.history, []); }

  /** 하루 한 줄. 같은 날짜는 덮어쓴다. */
  function pushRecord(analysis) {
    var list = history();
    var scores = {};
    analysis.capacities.forEach(function (c) { scores[c.id] = c.score; });

    var rec = {
      ts: Date.now(),
      date: key(),
      overall: analysis.overall,
      scores: scores,
      sleep: analysis.input.sleep.hours,
      stress: analysis.input.stress,
      fatigue: analysis.input.fatigue
    };

    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].date === rec.date) { idx = i; break; }
    if (idx >= 0) list[idx] = rec; else list.push(rec);

    list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (list.length > MAX_HISTORY) list = list.slice(list.length - MAX_HISTORY);

    write(K.history, list);
    return list;
  }

  function recordOn(dateKey) {
    var list = history();
    for (var i = 0; i < list.length; i++) if (list[i].date === dateKey) return list[i];
    return null;
  }

  function sessions() { return read(K.sessions, {}); }
  function saveSessions(v) { return write(K.sessions, v); }

  function group() { return read(K.group, { members: [] }); }
  function saveGroup(v) { return write(K.group, v); }

  /** 학교명 자동완성에 쓸 최근 입력 목록 (최신순, 최대 12개) */
  function recentSchools() { return read(K.schools, []); }

  function rememberSchool(name) {
    name = String(name || '').trim();
    if (!name) return;
    var list = recentSchools().filter(function (s) { return s !== name; });
    list.unshift(name);
    write(K.schools, list.slice(0, 12));
  }

  /* ------------------------------------------------- 백업 (내보내기/가져오기)
   * localStorage 는 브라우저 데이터를 지우면 함께 사라진다.
   * 몇 달치 기록이 한순간에 없어지지 않도록 파일로 빼낼 수 있어야 한다.
   * 인증키는 개인 자격 증명이므로 백업에 넣지 않는다. */

  var EXPORT_VERSION = 1;
  var BACKUP_KEYS = [
    K.profile, K.input, K.history, K.sessions, K.group, K.schools,
    'neurostudy.kids.v1', 'neurostudy.sound.v1'
  ];

  function exportAll() {
    var out = {
      app: 'NeuroStudy', version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(), data: {}
    };
    if (!ok) return out;
    BACKUP_KEYS.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v !== null) out.data[k] = v;
    });
    return out;
  }

  function importAll(obj) {
    if (!obj || obj.app !== 'NeuroStudy' || !obj.data) {
      throw new Error('NeuroStudy 백업 파일이 아닙니다.');
    }
    if (obj.version > EXPORT_VERSION) {
      throw new Error('더 최신 버전에서 만든 백업입니다. 앱을 업데이트해 주세요.');
    }
    if (!ok) throw new Error('이 브라우저에서는 저장소를 쓸 수 없습니다.');

    var n = 0;
    Object.keys(obj.data).forEach(function (k) {
      if (BACKUP_KEYS.indexOf(k) < 0) return;   // 모르는 키는 건드리지 않는다
      localStorage.setItem(k, obj.data[k]);
      n++;
    });
    return n;
  }

  function clearAll() {
    if (!ok) return;
    [K.history, K.sessions, K.group].forEach(function (k) { localStorage.removeItem(k); });
  }

  global.Store = {
    available: ok,
    key: key, parseKey: parseKey, addDays: addDays, weekStart: weekStart, pad: pad, DOW: DOW,
    profile: profile, saveProfile: saveProfile, clearProfile: clearProfile,
    loadInput: loadInput, saveInput: saveInput,
    history: history, pushRecord: pushRecord, recordOn: recordOn,
    sessions: sessions, saveSessions: saveSessions,
    group: group, saveGroup: saveGroup,
    recentSchools: recentSchools, rememberSchool: rememberSchool,
    exportAll: exportAll, importAll: importAll, EXPORT_VERSION: EXPORT_VERSION,
    clearAll: clearAll
  };

})(window);
