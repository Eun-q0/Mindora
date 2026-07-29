/* =========================================================================
 * cloud.js — 학교 리그 동기화 (Supabase)
 *
 * 이 앱에서 유일하게 사용자의 학습 데이터를 밖으로 내보내는 곳이다.
 * 그래서 무엇이 나가는지 한 눈에 보이도록 여기 한 파일에 모아 뒀다.
 *
 * 나가는 것 (전부)
 *   · 학교명        — 프로필에 입력한 학교
 *   · 주차          — 그 주 월요일 날짜
 *   · 순공 시간(분) — 하루 300분 상한을 적용한 그 주 내 합계
 *   · 기기 ID       — 무작위 UUID. 같은 사람을 두 번 더하지 않으려고 쓴다.
 *                     이름·학년·반과 아무 관계가 없고 언제든 새로 받을 수 있다.
 *
 * 나가지 않는 것
 *   학년, 반, 과목, 시험 일정, 뇌 컨디션 점수, 수면·스트레스 같은 입력값,
 *   배지, 사운드 설정, 나이스 인증키 — 전부 기기에만 남는다.
 *
 * 기본값은 "꺼짐" 이다. 설정에서 켜야 처음으로 통신이 일어난다.
 * SDK 를 쓰지 않고 REST 로 직접 호출한다. 빌드가 단일 파일이라 의존성을 늘리지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * 관리자용 개별 학생 추적 (선택 기능, 리그와 별도 동의)
 *
 * 위의 "학교 리그"는 학교 합계만 다뤄 누가 누군지 알 수 없다.
 * 이 아래 기능은 그 반대다 — 관리자가 "지민 · 3시간 20분" 처럼
 * 닉네임으로 개인을 식별해서 본다. 그래서 리그와는 완전히 분리된
 * 별도의 동의 스위치를 쓴다 (설정 화면의 "선생님에게 내 기록 보이기").
 *
 *   나가는 것: 닉네임, 학교명, 주차, 순공 시간(분), 기기 ID
 *   보는 사람: admins 테이블에 등록된 계정으로 로그인한 사람뿐.
 *             익명 키로는 개별 기록을 절대 읽을 수 없다 (RLS).
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- 설정
   * Supabase 프로젝트를 만든 뒤 [Settings → API] 의 두 값을 여기에 넣는다.
   * anon 키는 공개되는 값이다 (정적 사이트라 소스에 들어갈 수밖에 없다).
   * 그래서 서버 쪽에서 RLS 로 잠그고 검증 함수 하나만 열어 뒀다 —
   * supabase/schema.sql 참고.
   * 두 값이 비어 있으면 동기화 기능 자체가 꺼진 것처럼 동작한다. */
  var SUPABASE_URL = 'https://vtlvuhzdxoxnvsdrpfqb.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0bHZ1aHpkeG94bnZzZHJwZnFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMTg4NzcsImV4cCI6MjEwMDg5NDg3N30.6-If6Q47kXkdOxmkt8QNiYzxhqWMDl3dnGC1pMYQLGQ';

  var STORE_KEY = 'neurostudy.cloud.v1';
  var TIMEOUT_MS = 8000;
  var MIN_PUSH_GAP = 60 * 1000;   // 같은 값을 계속 밀어 올리지 않는다

  function configured() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

  /* --------------------------------------------------------------- 상태 */

  function load() {
    var d = { enabled: false, deviceId: '', lastSync: 0, lastPush: 0, lastError: '' };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return d;
      var o = JSON.parse(raw);
      return {
        enabled: !!o.enabled,
        deviceId: o.deviceId || '',
        lastSync: o.lastSync || 0,
        lastPush: o.lastPush || 0,
        lastError: o.lastError || ''
      };
    } catch (e) { return d; }
  }

  function save(o) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 무시 */ }
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // 구형 브라우저용 대체 — 충돌 확률이 중요한 값이 아니라 이 정도면 충분하다
    var b = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
           h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  /** 기기 ID 는 처음 켤 때 만들어진다. 끄고 지우면 서버와의 연결 고리가 사라진다. */
  function deviceId() {
    var st = load();
    if (!st.deviceId) {
      st.deviceId = uuid();
      save(st);
    }
    return st.deviceId;
  }

  function resetDeviceId() {
    var st = load();
    st.deviceId = uuid();
    st.lastPush = 0;
    save(st);
    return st.deviceId;
  }

  function enabled() { return configured() && load().enabled; }

  function setEnabled(on) {
    var st = load();
    st.enabled = !!on;
    if (st.enabled && !st.deviceId) st.deviceId = uuid();
    if (!st.enabled) st.lastError = '';
    save(st);
  }

  function status() {
    var st = load();
    return {
      configured: configured(),
      enabled: configured() && st.enabled,
      deviceId: st.deviceId,
      lastSync: st.lastSync,
      lastError: st.lastError
    };
  }

  function noteError(msg) {
    var st = load();
    st.lastError = String(msg || '');
    save(st);
  }

  /* --------------------------------------------------------------- 통신 */

  /**
   * bearer 를 안 주면 anon 키로 호출한다(학생 쪽 — 로그인 없음).
   * 관리자 조회는 로그인한 사람의 access_token 을 bearer 로 넘긴다 —
   * apikey 는 프로젝트 식별용으로 항상 anon 을 쓰고, Authorization 만 바뀐다.
   * 어느 쪽이든 401 이 오면 그대로 올려서 호출부가 "권한 없음"을 구분하게 한다.
   */
  function req(path, opts, bearer) {
    opts = opts || {};
    var ctrl = global.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    return fetch(SUPABASE_URL.replace(/\/+$/, '') + path, {
      method: opts.method || 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (bearer || SUPABASE_ANON_KEY),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (t) {
          var err = new Error('HTTP ' + res.status + (t ? ' — ' + t.slice(0, 160) : ''));
          err.status = res.status;
          throw err;
        });
      }
      return res.status === 204 ? null : res.json();
    }, function (e) {
      clearTimeout(timer);
      throw new Error(e && e.name === 'AbortError' ? '응답이 없어 중단했습니다.' : (e.message || '연결에 실패했습니다.'));
    });
  }

  /**
   * 내 주간 순공 시간을 올린다.
   * 값이 그대로면 굳이 다시 보내지 않는다.
   */
  function push(school, weekKey, minutes, force) {
    if (!enabled()) return Promise.resolve(false);

    school = String(school || '').trim();
    if (!school) return Promise.resolve(false);

    var st = load();
    var mins = Math.max(0, Math.min(2100, Math.round(minutes || 0)));
    var sig = school + '|' + weekKey + '|' + mins;

    if (!force && st.lastSig === sig && (Date.now() - st.lastPush) < MIN_PUSH_GAP) {
      return Promise.resolve(false);
    }

    return req('/rest/v1/rpc/report_league', {
      method: 'POST',
      body: { p_device: deviceId(), p_week: weekKey, p_school: school, p_minutes: mins }
    }).then(function () {
      var s = load();
      s.lastPush = Date.now();
      s.lastSig = sig;
      s.lastError = '';
      save(s);
      return true;
    }, function (e) {
      noteError(e.message);
      throw e;
    });
  }

  /** 그 주의 학교별 합계를 받아 온다 */
  function fetchWeek(weekKey) {
    if (!enabled()) return Promise.resolve([]);

    return req('/rest/v1/school_week?week=eq.' + encodeURIComponent(weekKey) +
               '&select=school,total_min,members,updated_at&order=total_min.desc&limit=200')
      .then(function (rows) {
        var st = load();
        st.lastSync = Date.now();
        st.lastError = '';
        save(st);
        return (rows || []).map(function (r) {
          return {
            schoolName: String(r.school || '').trim(),
            total: Math.max(0, r.total_min | 0),
            active: Math.max(0, r.members | 0),
            updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0
          };
        }).filter(function (r) { return r.schoolName; });
      }, function (e) {
        noteError(e.message);
        throw e;
      });
  }

  /** 설정 화면의 [연결 확인] — 실제로 한 번 읽어 본다 */
  function test(weekKey) {
    if (!configured()) return Promise.reject(new Error('서버 주소와 키가 설정돼 있지 않습니다.'));
    return req('/rest/v1/school_week?week=eq.' + encodeURIComponent(weekKey) + '&select=school&limit=1')
      .then(function () { return true; });
  }

  /** 서버에서 내 기록을 지운다. 리그를 끌 때 함께 부른다. */
  function forget() {
    if (!configured()) return Promise.resolve(false);
    var st = load();
    if (!st.deviceId) return Promise.resolve(false);
    // 분을 0 으로 만들 수는 없다(감소 불가). 대신 기기 ID 를 버려 연결을 끊는다.
    st.deviceId = '';
    st.lastPush = 0;
    st.lastSig = '';
    save(st);
    return Promise.resolve(true);
  }

  /* ===================================================== 학생 개별 공유
   * 리그(enabled)와 별개인 스위치다. 리그만 켜고 이건 꺼 둘 수 있다 —
   * 그러면 학교 합계에는 잡히지만 관리자에게 "누구"인지는 보이지 않는다. */

  var STUDENT_KEY = 'neurostudy.studentShare.v1';

  function studentLoad() {
    try {
      var raw = localStorage.getItem(STUDENT_KEY);
      var o = raw ? JSON.parse(raw) : {};
      return { enabled: !!o.enabled, lastPush: o.lastPush || 0, lastSig: o.lastSig || '', lastError: o.lastError || '' };
    } catch (e) { return { enabled: false, lastPush: 0, lastSig: '', lastError: '' }; }
  }

  function studentSave(o) {
    try { localStorage.setItem(STUDENT_KEY, JSON.stringify(o)); } catch (e) { /* 무시 */ }
  }

  function studentShareEnabled() { return configured() && studentLoad().enabled; }

  function setStudentShareEnabled(on) {
    var st = studentLoad();
    st.enabled = !!on;
    if (!st.enabled) st.lastError = '';
    studentSave(st);
  }

  function studentShareStatus() {
    var st = studentLoad();
    return { configured: configured(), enabled: configured() && st.enabled, lastPush: st.lastPush, lastError: st.lastError };
  }

  /** 닉네임을 포함해 개별 기록을 올린다. 학생 쪽은 로그인이 필요 없다(anon 키). */
  function pushStudent(nickname, school, weekKey, minutes, force) {
    if (!studentShareEnabled()) return Promise.resolve(false);

    nickname = String(nickname || '').trim();
    school = String(school || '').trim();
    if (!nickname || !school) return Promise.resolve(false);

    var st = studentLoad();
    var mins = Math.max(0, Math.min(2100, Math.round(minutes || 0)));
    var sig = nickname + '|' + school + '|' + weekKey + '|' + mins;

    if (!force && st.lastSig === sig && (Date.now() - st.lastPush) < MIN_PUSH_GAP) {
      return Promise.resolve(false);
    }

    return req('/rest/v1/rpc/report_student', {
      method: 'POST',
      body: { p_device: deviceId(), p_week: weekKey, p_nickname: nickname, p_school: school, p_minutes: mins }
    }).then(function () {
      var s = studentLoad();
      s.lastPush = Date.now();
      s.lastSig = sig;
      s.lastError = '';
      studentSave(s);
      return true;
    }, function (e) {
      var s = studentLoad();
      s.lastError = e.message;
      studentSave(s);
      throw e;
    });
  }

  /** 리그와 마찬가지로, 기기 ID 를 버려 서버 기록과의 연결을 끊는다. */
  function forgetStudent() {
    var st = studentLoad();
    st.lastPush = 0;
    st.lastSig = '';
    studentSave(st);
    return Promise.resolve(true);
  }

  /* ============================================================ 관리자 로그인
   * Supabase Auth 의 이메일·비밀번호 로그인이다. 계정 자체는 Supabase 대시보드
   * [Authentication → Users] 에서 직접 만든다 — 이 앱은 가입 화면을 두지 않는다.
   * (누구나 가입할 수 있게 열어 두면 공격면이 넓어지고, 어차피 admins 테이블에
   *  없으면 아무것도 못 읽으니 가입 화면 자체가 불필요하다.) */

  var ADMIN_SESSION_KEY = 'neurostudy.adminSession.v1';

  function adminSessionLoad() {
    try {
      var raw = localStorage.getItem(ADMIN_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function adminSessionSave(s) {
    try {
      if (s) localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(ADMIN_SESSION_KEY);
    } catch (e) { /* 무시 */ }
  }

  function adminSession() {
    var s = adminSessionLoad();
    if (!s || !s.accessToken || !s.expiresAt) return null;
    if (Date.now() > s.expiresAt) { adminSessionSave(null); return null; }
    return s;
  }

  function adminSignIn(email, password) {
    if (!configured()) return Promise.reject(new Error('서버가 설정돼 있지 않습니다.'));
    email = String(email || '').trim();
    if (!email || !password) return Promise.reject(new Error('이메일과 비밀번호를 입력하세요.'));

    return req('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email: email, password: password }
    }).then(function (r) {
      if (!r || !r.access_token) throw new Error('로그인에 실패했습니다.');
      adminSessionSave({
        accessToken: r.access_token,
        email: (r.user && r.user.email) || email,
        expiresAt: Date.now() + (Math.max(60, r.expires_in || 3600) - 30) * 1000
      });
      return true;
    }, function (e) {
      // Supabase 는 잘못된 자격 증명도 400 으로 준다 — 사용자에게는 뭉뚱그려 안내한다
      throw new Error(e.status === 400 || e.status === 401
        ? '이메일 또는 비밀번호가 올바르지 않습니다.' : (e.message || '로그인에 실패했습니다.'));
    });
  }

  function adminSignOut() {
    adminSessionSave(null);
    return Promise.resolve(true);
  }

  /**
   * 그 주의 학생 개별 기록을 받아 온다. 로그인 세션이 없으면 빈 배열 —
   * 화면 쪽에서 "로그인하지 않음"과 구분해 처리한다.
   */
  function fetchStudentWeek(weekKey) {
    var s = adminSession();
    if (!s) return Promise.reject(Object.assign(new Error('로그인이 필요합니다.'), { status: 401 }));

    return req('/rest/v1/student_report?week=eq.' + encodeURIComponent(weekKey) +
               '&select=nickname,school,minutes,updated_at&order=minutes.desc&limit=500', {}, s.accessToken)
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            nickname: String(r.nickname || '').trim(),
            schoolName: String(r.school || '').trim(),
            minutes: Math.max(0, r.minutes | 0),
            updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0
          };
        });
      }, function (e) {
        if (e.status === 401) adminSessionSave(null);   // 세션이 만료·무효 — 다시 로그인해야 한다
        throw e;
      });
  }

  global.Cloud = {
    configured: configured, status: status,
    enabled: enabled, setEnabled: setEnabled,
    deviceId: deviceId, resetDeviceId: resetDeviceId, forget: forget,
    push: push, fetchWeek: fetchWeek, test: test,

    studentShareEnabled: studentShareEnabled, setStudentShareEnabled: setStudentShareEnabled,
    studentShareStatus: studentShareStatus, pushStudent: pushStudent, forgetStudent: forgetStudent,

    adminSession: adminSession, adminSignIn: adminSignIn, adminSignOut: adminSignOut,
    fetchStudentWeek: fetchStudentWeek,

    SUPABASE_URL: SUPABASE_URL
  };

})(window);
