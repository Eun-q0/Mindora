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
    schools: 'neurostudy.schools.v1',   // 예전에 입력한 학교명 (자동완성용)
    personalization: 'mindora.personalization.v1' // 블록 피드백·시험 회고·개인 실험
  };

  var MAX_HISTORY = 180;

  var ok = (function () {
    try {
      localStorage.setItem('__ns__', '1');
      localStorage.removeItem('__ns__');
      return true;
    } catch (e) { return false; }
  })();

  /* ------------------------------------------------------- 저장 공간 보호
   * localStorage 는 기본이 "지워도 되는" 저장소다. 저장 공간이 모자라면
   * 브라우저가 말없이 비우고, iOS 는 한동안 안 들어오면 알아서 정리한다.
   * 몇 달치 기록이 그렇게 사라지면 되돌릴 방법이 없으므로 영구 보관을 신청한다.
   *
   * 크롬 계열은 방문 빈도·홈 화면 설치 여부로 조용히 판단해 주고,
   * 사파리는 홈 화면에 추가돼 있으면 내어 준다. 거절당해도 앱은 그대로 돌아간다. */
  function persistStatus() {
    if (!global.navigator || !navigator.storage || !navigator.storage.persisted) {
      return Promise.resolve('unsupported');
    }
    return navigator.storage.persisted()
      .then(function (yes) { return yes ? 'persisted' : 'best-effort'; })
      ['catch'](function () { return 'unsupported'; });
  }

  function requestPersist() {
    if (!global.navigator || !navigator.storage || !navigator.storage.persist) {
      return Promise.resolve('unsupported');
    }
    return navigator.storage.persisted()
      .then(function (yes) {
        if (yes) return 'persisted';
        return navigator.storage.persist().then(function (granted) {
          return granted ? 'persisted' : 'best-effort';
        });
      })
      ['catch'](function () { return 'unsupported'; });
  }

  /** 남은 저장 공간 (지원하지 않으면 null) */
  function estimate() {
    if (!global.navigator || !navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve(null);
    }
    return navigator.storage.estimate()
      .then(function (e) { return { usage: e.usage || 0, quota: e.quota || 0 }; })
      ['catch'](function () { return null; });
  }

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

  /* --------------------------------------------------------- 개인화 기록
   * 능력 검사 결과가 아니라 실제 공부 뒤 사용자가 남긴 체감만 저장한다.
   * 추천 보정은 최근 응답을 작게 반영하며, 사용자가 직접 바꾼 과목·시간이 항상 우선한다. */

  function personalization() {
    var v = read(K.personalization, null) || {};
    if (!Array.isArray(v.feedback)) v.feedback = [];
    if (!v.reflections || typeof v.reflections !== 'object') v.reflections = {};
    if (v.experiment === undefined) v.experiment = null;
    return v;
  }

  function savePersonalization(v) { return write(K.personalization, v); }

  function addFeedback(item) {
    var v = personalization();
    var rec = {
      ts: Date.now(), date: key(),
      subject: String(item.subject || ''),
      type: item.type || 'mixed',
      minutes: Math.max(0, Number(item.minutes) || 0),
      focus: item.focus === undefined || item.focus === null ? null : Number(item.focus),
      difficulty: item.difficulty === undefined || item.difficulty === null ? null : Number(item.difficulty),
      recommendation: item.recommendation === undefined || item.recommendation === null ? null : Number(item.recommendation)
    };
    v.feedback.push(rec);
    if (v.feedback.length > 240) v.feedback = v.feedback.slice(-240);
    savePersonalization(v);
    return rec;
  }

  function feedback() { return personalization().feedback; }

  /** 최근 12개 응답의 추천 적합도 평균(-1~1). 같은 과목을 우선하고 부족하면 같은 유형을 쓴다. */
  function recommendationPreference(subject, type) {
    var rows = feedback().slice().reverse();
    var exact = rows.filter(function (r) { return r.subject === subject && typeof r.recommendation === 'number' && r.recommendation !== 0; }).slice(0, 12);
    var picked = exact.length >= 2 ? exact : rows.filter(function (r) { return r.type === type && typeof r.recommendation === 'number' && r.recommendation !== 0; }).slice(0, 12);
    if (!picked.length) return 0;
    return picked.reduce(function (s, r) { return s + r.recommendation; }, 0) / picked.length;
  }

  function saveExamReflection(examKey, value) {
    var v = personalization();
    v.reflections[String(examKey)] = { value: value, ts: Date.now() };
    savePersonalization(v);
  }

  function examReflections() { return personalization().reflections; }

  function experiment() { return personalization().experiment; }
  function saveExperiment(value) {
    var v = personalization();
    v.experiment = value || null;
    savePersonalization(v);
    return v.experiment;
  }

  /* ------------------------------------------------- 백업 (내보내기/가져오기)
   * localStorage 는 브라우저 데이터를 지우면 함께 사라진다.
   * 몇 달치 기록이 한순간에 없어지지 않도록 파일로 빼낼 수 있어야 한다.
   * 인증키는 개인 자격 증명이므로 백업에 넣지 않는다. */

  var EXPORT_VERSION = 1;
  /* 키를 더할 때 EXPORT_VERSION 은 올리지 않는다. 형식(키→JSON 문자열)이 그대로라
   * 옛 앱이 새 백업을 읽어도 모르는 키를 건너뛸 뿐이고, 버전을 올리면 오히려
   * "더 최신 버전에서 만든 백업" 이라며 통째로 거부당한다. */
  var BACKUP_KEYS = [
    K.profile, K.input, K.history, K.sessions, K.group, K.schools,
    'neurostudy.kids.v1', 'neurostudy.sound.v1',
    // 직접 만든 계획표와 몇 주에 걸쳐 올린 리그 티어도 복원할 수 없는 기록이다
    'neurostudy.vacplan.v1', 'neurostudy.league.v1', K.personalization,
    // 목표 대학·한 줄 다짐·직접 등록한 D-day — 손으로 적은 값이라 되살릴 방법이 없다
    'mindora.goal.v1', 'neurostudy.slime.v1',
    // 식사 시간 알리미 — 직접 지정한 시각은 계획표에서 되살릴 수 없다
    'mindora.mealalarm.v1'
  ];

  /* 마지막으로 백업을 내려받은 시각. 백업 자체에는 넣지 않는다 —
   * 복원한 기기에서 "이미 백업했다" 고 착각하면 안 되기 때문이다. */
  var LAST_BACKUP_KEY = 'neurostudy.lastBackup.v1';

  function lastBackupAt() { return read(LAST_BACKUP_KEY, 0) || 0; }
  function markBackedUp() { write(LAST_BACKUP_KEY, Date.now()); }

  function exportAll() {
    var out = {
      app: 'Mindora', version: EXPORT_VERSION,
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
    if (!obj || (obj.app !== 'Mindora' && obj.app !== 'NeuroStudy') || !obj.data) {
      throw new Error('Mindora 백업 파일이 아닙니다.');
    }
    if (obj.version > EXPORT_VERSION) {
      throw new Error('더 최신 버전에서 만든 백업입니다. 앱을 업데이트해 주세요.');
    }
    if (!ok) throw new Error('이 브라우저에서는 저장소를 쓸 수 없습니다.');

    var n = 0;
    Object.keys(obj.data).forEach(function (k) {
      if (BACKUP_KEYS.indexOf(k) < 0) return;   // 모르는 키는 건드리지 않는다
      var v = obj.data[k];
      try { JSON.parse(v); } catch (e) { return; }  // 깨진 값은 기존 데이터를 지우지 않고 건너뛴다
      localStorage.setItem(k, v);
      n++;
    });
    return n;
  }

  function clearAll() {
    if (!ok) return;
    [K.history, K.sessions, K.group, K.personalization].forEach(function (k) { localStorage.removeItem(k); });
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
    personalization: personalization, savePersonalization: savePersonalization,
    addFeedback: addFeedback, feedback: feedback,
    recommendationPreference: recommendationPreference,
    saveExamReflection: saveExamReflection, examReflections: examReflections,
    experiment: experiment, saveExperiment: saveExperiment,
    exportAll: exportAll, importAll: importAll, EXPORT_VERSION: EXPORT_VERSION,
    lastBackupAt: lastBackupAt, markBackedUp: markBackedUp,
    persistStatus: persistStatus, requestPersist: requestPersist, estimate: estimate,
    clearAll: clearAll
  };

})(window);
