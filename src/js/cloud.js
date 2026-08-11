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
 * 학급 대항전에 동의하면 여기에 학교급·학년·반·닉네임이 더해지고,
 * 포스트잇을 붙이면 그 쪽지의 내용·색·붙인 자리·사라질 시각이 함께 올라간다.
 * 쪽지는 길어야 30분이면 서버에서 지워진다 (supabase/schema_league_notes.sql).
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
 * 별도의 동의 스위치를 쓴다 (설정 화면의 "관리자에게 내 기록 보이기").
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
  /* 2026-08-10: 프로젝트를 옮겼다.
   * 예전 프로젝트(vtlvuhzdxoxnvsdrpfqb)는 계정을 잃어 스키마를 갱신할 수 없었다.
   * 그래서 2026-08-04 에 추가된 9-인자 report_league 가 서버에 없었고, 그날부터
   * 모든 전송이 404 로 실패하고 있었다. 새 프로젝트에 스키마를 전부 올리고 갈아탄다.
   * 예전 주차의 학교 합계는 넘어오지 않는다 — 개인 기록은 각 브라우저에 있으므로 그대로다. */
  var SUPABASE_URL = 'https://nflphvcjbpvjevcmmqoy.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mbHBodmNqYnB2amV2Y21tcW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDY2NDksImV4cCI6MjEwMTQyMjY0OX0.K-_VE14ZGQFA6jEN9PBjRs60KfE0dlyZbt13smZDixw';

  var STORE_KEY = 'neurostudy.cloud.v1';
  var DELETE_KEY = 'neurostudy.cloudDeletePending.v1';
  var TIMEOUT_MS = 8000;
  var MIN_PUSH_GAP = 60 * 1000;   // 같은 값을 계속 밀어 올리지 않는다

  function configured() { return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

  /* --------------------------------------------------------------- 상태 */

  function load() {
    var d = { enabled: false, classOn: false, hidden: false, deviceId: '', lastSync: 0, lastPush: 0, lastSig: '', lastError: '' };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return d;
      var o = JSON.parse(raw);
      return {
        enabled: !!o.enabled,
        // 학급 대항전은 학교 리그와 별개 동의다. 기본은 꺼짐이며,
        // 기존 참가자가 자동으로 켜지지 않는다 — 동의 시점의 약속이
        // "학년·반은 전송하지 않는다" 였기 때문이다.
        classOn: !!o.classOn,
        // 순위표에서 내 줄만 감춘다. 반 합계에는 그대로 들어간다 —
        // 빠지면 우리 반이 손해를 보므로, 숨기는 것과 빠지는 것은 다른 선택이다.
        hidden: !!o.hidden,
        deviceId: o.deviceId || '',
        lastSync: o.lastSync || 0,
        lastPush: o.lastPush || 0,
        lastSig: o.lastSig || '',
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

  function enabled() { return configured() && load().enabled; }

  function setEnabled(on) {
    var st = load();
    st.enabled = !!on;
    if (st.enabled && !st.deviceId) st.deviceId = uuid();
    if (!st.enabled) {
      st.lastError = '';
      // 리그를 끄면 학급 동의도 함께 내린다. 남겨 두면 나중에 리그를 다시 켤 때
      // 학년·반이 묻지도 않고 다시 올라간다.
      st.classOn = false;
    }
    save(st);
  }

  /** 학급 대항전 동의 — 학교 리그(enabled)를 켠 상태에서만 의미가 있다 */
  function classEnabled() { return enabled() && load().classOn; }

  function setClassEnabled(on) {
    var st = load();
    st.classOn = !!on;
    st.lastPush = 0;   // 다음 동기화를 미루지 않고 바로 반영(또는 삭제)되게 한다
    st.lastSig = '';
    save(st);
  }

  function status() {
    var st = load();
    var pending = pendingLoad();
    return {
      configured: configured(),
      enabled: configured() && st.enabled,
      classOn: configured() && st.enabled && st.classOn,
      deviceId: st.deviceId,
      lastSync: st.lastSync,
      lastError: st.lastError,
      pendingDelete: !!pending.league
    };
  }

  function noteError(msg) {
    var st = load();
    st.lastError = String(msg || '');
    save(st);
  }

  /* 서버 삭제가 끊기면 기기 번호를 먼저 버려서는 다시 요청할 수 없다.
   * 삭제할 범위와 번호를 별도 보관했다가 다음 앱 실행에서 재시도한다. */
  function pendingLoad() {
    try {
      var o = JSON.parse(localStorage.getItem(DELETE_KEY) || '{}');
      return { league: o.league || '', student: o.student || '' };
    } catch (e) { return { league: '', student: '' }; }
  }

  function pendingSave(o) {
    try {
      if (!o.league && !o.student) localStorage.removeItem(DELETE_KEY);
      else localStorage.setItem(DELETE_KEY, JSON.stringify(o));
    } catch (e) { /* 저장소가 막혀 있어도 앱은 계속 쓴다 */ }
  }

  function queueDelete(scope, id) {
    var p = pendingLoad();
    p[scope] = id;
    pendingSave(p);
  }

  function clearPending(scope, id) {
    var p = pendingLoad();
    if (p[scope] === id) p[scope] = '';
    pendingSave(p);
  }

  function clearUnusedDevice(id) {
    var st = load();
    if (st.deviceId !== id || st.enabled) return;
    // 관리자 공개가 켜져 있으면 같은 번호를 계속 써야 예전 행이 고아가 되지 않는다.
    if (typeof studentLoad === 'function' && studentLoad().enabled) return;
    st.deviceId = '';
    st.lastPush = 0;
    st.lastSig = '';
    save(st);
  }

  function requestDelete(scope, id) {
    if (!configured() || !id) return Promise.resolve(false);
    queueDelete(scope, id);
    var rpc = scope === 'student' ? 'delete_own_student_reports' : 'delete_own_league_reports';
    return req('/rest/v1/rpc/' + rpc, {
      method: 'POST', body: { p_device: id }
    }).then(function () {
      clearPending(scope, id);
      clearUnusedDevice(id);
      if (scope === 'league') noteError('');
      else {
        var student = studentLoad();
        student.lastError = '';
        studentSave(student);
      }
      return true;
    });
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
  function push(school, weekKey, minutes, force, cls) {
    if (!enabled()) return Promise.resolve(false);

    school = String(school || '').trim();
    if (!school) return Promise.resolve(false);

    var st = load();
    var mins = Math.max(0, Math.min(2100, Math.round(minutes || 0)));

    /* 학급 대항전에 동의한 경우에만 학년·반이 실린다.
     * 동의하지 않았을 때도 빈 값으로 항상 함께 보낸다 — 그래야 동의를 끈
     * 순간 서버에 남아 있던 학년·반이 다음 동기화에서 지워진다.
     * (schema.sql 의 7-인자 함수는 coalesce 로 붙들지 않고 그대로 덮어쓴다) */
    var useClass = !!(st.classOn && cls && cls.grade && cls.klass);
    var body = {
      p_device: deviceId(), p_week: weekKey, p_school: school, p_minutes: mins,
      p_level: useClass ? String(cls.level || '') : '',
      p_grade: useClass ? String(cls.grade || '') : '',
      p_klass: useClass ? String(cls.klass || '') : '',
      p_hidden: !!st.hidden,
      /* 순위표에 보일 이름. 학급 대항에 동의한 경우에만 싣고,
       * 아니면 빈 값을 보내 서버에 남아 있던 값을 지운다. */
      p_nickname: useClass ? String(cls.nick || '') : ''
    };

    var sig = school + '|' + weekKey + '|' + mins + '|' +
              body.p_level + '/' + body.p_grade + '/' + body.p_klass +
              '|' + (body.p_hidden ? 'h' : '') + '|' + body.p_nickname;

    if (!force && st.lastSig === sig && (Date.now() - st.lastPush) < MIN_PUSH_GAP) {
      return Promise.resolve(false);
    }

    return req('/rest/v1/rpc/report_league', {
      method: 'POST',
      body: body
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
    return requestDelete('league', st.deviceId).then(function (ok) {
      var next = load();
      next.lastPush = 0;
      next.lastSig = '';
      next.lastError = '';
      save(next);
      return ok;
    }, function (e) {
      noteError('서버 삭제 대기 — ' + (e.message || '연결 실패'));
      throw e;
    });
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
    return {
      configured: configured(), enabled: configured() && st.enabled,
      lastPush: st.lastPush, lastError: st.lastError,
      pendingDelete: !!pendingLoad().student
    };
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

  /** 관리자 공개 기록을 서버에서 삭제한다. 실패한 요청은 다음 실행에 재시도한다. */
  function forgetStudent() {
    var id = load().deviceId;
    var st = studentLoad();
    st.lastPush = 0;
    st.lastSig = '';
    studentSave(st);
    if (!id) return Promise.resolve(false);
    return requestDelete('student', id).then(function (ok) {
      var next = studentLoad();
      next.lastError = '';
      studentSave(next);
      return ok;
    }, function (e) {
      var next = studentLoad();
      next.lastError = '서버 삭제 대기 — ' + (e.message || '연결 실패');
      studentSave(next);
      throw e;
    });
  }

  function retryPendingDeletions() {
    if (!configured()) return Promise.resolve(false);
    var p = pendingLoad();
    var jobs = [];
    if (p.league) jobs.push(requestDelete('league', p.league)['catch'](function () { return false; }));
    if (p.student) jobs.push(requestDelete('student', p.student)['catch'](function () { return false; }));
    return Promise.all(jobs).then(function (rows) {
      return rows.some(function (ok) { return ok; });
    });
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

  /* 로컬에서 지우는 것만으로는 토큰이 만료(최대 1시간)까지 살아 있다.
   * 학교 공용 PC 에서 쓰는 계정이고 전교생 기록을 읽을 수 있으므로 서버에서도 폐기한다.
   * 다만 로컬 삭제를 먼저 해 둔다 — 네트워크가 죽었다고 로그인 상태로 남으면 안 된다. */
  function adminSignOut() {
    var s = adminSessionLoad();
    adminSessionSave(null);
    if (!s || !s.accessToken) return Promise.resolve(true);
    return req('/auth/v1/logout', { method: 'POST' }, s.accessToken)
      .then(function () { return true; }, function () { return true; });
  }

  /**
   * 그 주의 학생 개별 기록을 받아 온다. 로그인 세션이 없으면 빈 배열 —
   * 화면 쪽에서 "로그인하지 않음"과 구분해 처리한다.
   */
  function fetchStudentWeek(weekKey) {
    var s = adminSession();
    if (!s) return Promise.reject(Object.assign(new Error('로그인이 필요합니다.'), { status: 401 }));

    return req('/rest/v1/student_report?week=eq.' + encodeURIComponent(weekKey) +
               '&select=device_id,nickname,school,minutes,updated_at&order=minutes.desc&limit=500', {}, s.accessToken)
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            deviceId: String(r.device_id || ''),
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

  /* ------------------------------------------------------------ 반 대항 리그
   * 5명 이상 모인 반만 내려온다(서버 뷰가 걸러 준다). 학교 10곳 × 25반이면
   * 많아야 250행이라 한 번에 받아 클라이언트에서 줄 세워도 충분하다. */

  function fetchClassWeek(weekKey) {
    if (!enabled()) return Promise.resolve([]);

    return req('/rest/v1/class_week?week=eq.' + encodeURIComponent(weekKey) +
               '&select=school,level,grade,klass,total_min,members,updated_at' +
               '&order=total_min.desc&limit=500')
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            schoolName: String(r.school || '').trim(),
            level: String(r.level || '').trim(),
            grade: String(r.grade || '').trim(),
            klass: String(r.klass || '').trim(),
            total: Math.max(0, r.total_min | 0),
            active: Math.max(0, r.members | 0),
            updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0
          };
        });
      }, function () { return []; });   // 권한 전이면 조용히 빈 판
  }

  /**
   * 같은 반 사람들을 익명으로 받아 온다 — 공유 코드 없이 자동으로 묶인다.
   *
   * 이름은 오지 않는다. 주차마다 바뀌는 짧은 태그(A1B2)뿐이라 주가 넘어가면
   * 같은 사람을 계속 따라갈 수 없다. 5명이 안 되는 반은 서버가 아무것도 주지 않는다.
   */
  function fetchClassMembers(cls, weekKey) {
    if (!enabled() || !cls || !cls.school || !cls.grade || !cls.klass) {
      return Promise.resolve([]);
    }
    return req('/rest/v1/rpc/class_members', {
      method: 'POST',
      body: {
        p_school: String(cls.school || ''), p_level: String(cls.level || ''),
        p_grade: String(cls.grade || ''), p_klass: String(cls.klass || ''),
        p_week: weekKey, p_device: deviceId() || null
      }
    }).then(function (rows) {
      return (rows || []).map(function (r) {
        return {
          tag: String(r.tag || '????'),
          minutes: Math.max(0, r.minutes | 0),
          updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0,
          me: !!r.is_me,
          hidden: !!r.is_hidden
        };
      });
    }, function () { return []; });
  }

  function hiddenOn() { return !!load().hidden; }

  function setHidden(on) {
    var st = load();
    st.hidden = !!on;
    st.lastSig = '';   // 다음 동기화가 반드시 나가도록 서명을 지운다
    save(st);
  }

  /** 아직 5명이 안 모여 순위표에 못 오른 반의 참여 인원 (합계는 오지 않는다) */
  function fetchClassPending(weekKey) {
    if (!enabled()) return Promise.resolve([]);

    return req('/rest/v1/class_week_pending?week=eq.' + encodeURIComponent(weekKey) +
               '&select=school,level,grade,klass,members&limit=500')
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            schoolName: String(r.school || '').trim(),
            level: String(r.level || '').trim(),
            grade: String(r.grade || '').trim(),
            klass: String(r.klass || '').trim(),
            active: Math.max(0, r.members | 0)
          };
        });
      }, function () { return []; });
  }

  /* ══════════════════════════════════════════════════ 우리 반 포스트잇
   *
   * 같은 반 사람들이 서로 보는 쪽지 벽이다. 리그 순위와 달리 합계가 아니라
   * 사람이 쓴 글이 그대로 오간다. 그래서 학급 대항전(classEnabled)에 동의한
   * 경우에만 열린다 — 그 동의가 곧 "학년·반과 닉네임을 보낸다" 는 약속이고,
   * 쪽지는 그 위에서만 성립한다.
   *
   * 욕설을 거르는 일은 여기서 하지 않는다. 목록은 filter.js 한 곳에만 두고,
   * 부르는 쪽(app.js)이 올리기 전과 그리기 전에 각각 한 번씩 태운다. */

  function notesReady(cls) {
    return !!(classEnabled() && cls && cls.school && cls.grade && cls.klass);
  }

  /** 쪽지를 붙인다. 수명(minutes)은 서버에서도 10~30분으로 잘린다. */
  function postClassNote(cls, note) {
    if (!notesReady(cls)) return Promise.reject(new Error('학급 대항전을 켜야 포스트잇을 쓸 수 있습니다.'));

    var body = String((note && note.body) || '').trim();
    if (!body) return Promise.reject(new Error('내용을 입력하세요.'));

    return req('/rest/v1/rpc/post_class_note', {
      method: 'POST',
      body: {
        p_device: deviceId(),
        p_school: String(cls.school || ''), p_level: String(cls.level || ''),
        p_grade: String(cls.grade || ''), p_klass: String(cls.klass || ''),
        p_nick: String((note && note.nick) || ''),
        p_body: body.slice(0, 100),
        p_minutes: Math.max(10, Math.min(30, Math.round((note && note.minutes) || 15))),
        p_color: Math.max(0, Math.min(15, Math.round((note && note.color) || 0))),
        p_tilt: Math.max(-6, Math.min(6, Math.round((note && note.tilt) || 0))),
        p_x: Math.max(0, Math.min(100, Math.round((note && note.x) || 50))),
        p_y: Math.max(0, Math.min(100, Math.round((note && note.y) || 40)))
      }
    }).then(function (id) { return typeof id === 'string' ? id : ''; });
  }

  /** 아직 살아 있는 우리 반 쪽지. 실패하면 빈 벽으로 둔다(있던 쪽지를 지우진 않는다). */
  function fetchClassNotes(cls) {
    if (!notesReady(cls)) return Promise.resolve([]);

    return req('/rest/v1/rpc/fetch_class_notes', {
      method: 'POST',
      body: {
        p_school: String(cls.school || ''), p_level: String(cls.level || ''),
        p_grade: String(cls.grade || ''), p_klass: String(cls.klass || ''),
        p_device: deviceId() || null
      }
    }).then(function (rows) {
      return (rows || []).map(function (r) {
        return {
          id: String(r.id || ''),
          nick: String(r.nickname || '').trim(),
          body: String(r.body || ''),
          color: r.color | 0, tilt: r.tilt | 0,
          x: r.x | 0, y: r.y | 0,
          createdAt: r.created_at ? Date.parse(r.created_at) : 0,
          expiresAt: r.expires_at ? Date.parse(r.expires_at) : 0,
          me: !!r.is_me
        };
      }).filter(function (n) { return n.id && n.body; });
    });
  }

  /** 내가 붙인 쪽지의 자리를 옮긴다 */
  function moveClassNote(id, x, y) {
    if (!id) return Promise.resolve(false);
    return req('/rest/v1/rpc/move_class_note', {
      method: 'POST',
      body: {
        p_id: id, p_device: deviceId(),
        p_x: Math.max(0, Math.min(100, Math.round(x))),
        p_y: Math.max(0, Math.min(100, Math.round(y)))
      }
    }).then(function () { return true; });
  }

  /** 내가 붙인 쪽지를 모두의 화면에서 뗀다 (남의 쪽지는 서버가 거절한다) */
  function removeClassNote(id) {
    if (!id) return Promise.resolve(false);
    return req('/rest/v1/rpc/remove_class_note', {
      method: 'POST',
      body: { p_id: id, p_device: deviceId() }
    }).then(function () { return true; });
  }

  /**
   * 관리자가 잘못 올라온 기록을 지운다. 리그·학생 목록 양쪽에서 함께 사라진다.
   * week 를 비우면 그 기기의 모든 주차를 지운다.
   */
  function adminDeleteDevice(deviceIdValue, weekKey) {
    var s = adminSession();
    if (!s) return Promise.reject(Object.assign(new Error('로그인이 필요합니다.'), { status: 401 }));

    return req('/rest/v1/rpc/admin_delete_device', {
      method: 'POST',
      body: { p_device: deviceIdValue, p_week: weekKey || null }
    }, s.accessToken).then(function (n) {
      return typeof n === 'number' ? n : 0;
    }, function (e) {
      if (e.status === 401) adminSessionSave(null);
      throw e;
    });
  }

  /**
   * 그 주에 리그 시간을 올린 참가자를 개별로 받아 온다 (관리자 전용).
   *
   * 이 관리자 조회는 닉네임을 선택하지 않는다. 학급 대항전에 따로 동의한
   * 참가자는 league_report 에 닉네임이 있을 수 있지만, 그 값은 같은 반
   * 순위표에서만 쓴다. 관리자에게 이름을 보여 주려면 학생이 별도의
   * [관리자에게 내 기록 보이기]를 켜야 하고, 그때 student_report에 들어온다.
   *
   * schema_admin_league.sql 을 실행하지 않았다면 권한이 없어 빈 배열이 온다.
   */
  function fetchLeagueMembers(weekKey) {
    var s = adminSession();
    if (!s) return Promise.reject(Object.assign(new Error('로그인이 필요합니다.'), { status: 401 }));

    return req('/rest/v1/league_report?week=eq.' + encodeURIComponent(weekKey) +
               '&select=device_id,school,minutes,updated_at&order=minutes.desc&limit=1000', {}, s.accessToken)
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            deviceId: String(r.device_id || ''),
            schoolName: String(r.school || '').trim(),
            minutes: Math.max(0, r.minutes | 0),
            updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0
          };
        });
      }, function (e) {
        if (e.status === 401) adminSessionSave(null);
        throw e;
      });
  }

  global.Cloud = {
    configured: configured, status: status,
    enabled: enabled, setEnabled: setEnabled,
    classEnabled: classEnabled, setClassEnabled: setClassEnabled,
    deviceId: deviceId, forget: forget, retryPendingDeletions: retryPendingDeletions,
    push: push, fetchWeek: fetchWeek, test: test,

    studentShareEnabled: studentShareEnabled, setStudentShareEnabled: setStudentShareEnabled,
    studentShareStatus: studentShareStatus, pushStudent: pushStudent, forgetStudent: forgetStudent,

    adminSession: adminSession, adminSignIn: adminSignIn, adminSignOut: adminSignOut,
    fetchStudentWeek: fetchStudentWeek,
    fetchLeagueMembers: fetchLeagueMembers,
    fetchClassWeek: fetchClassWeek, fetchClassPending: fetchClassPending,
    fetchClassMembers: fetchClassMembers,
    postClassNote: postClassNote, fetchClassNotes: fetchClassNotes,
    moveClassNote: moveClassNote, removeClassNote: removeClassNote,
    hiddenOn: hiddenOn, setHidden: setHidden,
    adminDeleteDevice: adminDeleteDevice,

    /* 이 파일 밖에서 RPC 를 부를 수 있는 유일한 통로.
     * backup.js 가 쓴다 — 주소와 anon 키를 두 곳에 복사해 두면 프로젝트를 옮길 때
     * 한쪽만 고치고 넘어가게 된다(실제로 2026-08-10 에 그래서 6일을 잃었다).
     * 리그 동의(enabled)와 무관하게 열려 있다: 복구 코드 백업은 리그와 다른 기능이고,
     * 리그를 꺼 둔 사람도 기록은 지키고 싶기 때문이다. */
    rpc: function (fn, body) { return req('/rest/v1/rpc/' + fn, { method: 'POST', body: body || {} }); },

    SUPABASE_URL: SUPABASE_URL
  };

})(window);
