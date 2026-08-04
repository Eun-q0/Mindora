/* =========================================================================
 * app.js — UI 바인딩 및 렌더링
 * ========================================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = {
    analysis: null,
    plan: null,
    timer: null,
    rankRange: 'today',
    leagueMode: 'class',  // 기본 판은 반 대항
    lgSchool: '', lgGrade: '',
    weekOffset: 0,
    queueEdit: false,   // 타이머 진행 순서에서 블록 길이를 고치는 중인가
    page: 'secInput',
    pickedSchool: null,  // 나이스에서 고른 학교 (급식 조회용 코드 포함)
    vacplan: null,      // 방학 계획표 모델
    span: null,        // 진행 중인 순공 구간
    lastFlush: 0,
    lastSoundKey: null // 같은 상태에서 사운드를 다시 트는 것을 막는다
  };

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtHour(h) {
    var t = ((h % 24) + 24) % 24;
    var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
    return pad(hh) + ':' + pad(mm);
  }
  function fmtDur(min) {
    var m = Math.round(min);
    var h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '시간 ' + r + '분';
    if (h) return h + '시간';
    return r + '분';
  }
  /* 가중치는 손으로 정한 값이라 소수점 표기는 없는 정밀도를 있는 것처럼 보이게 한다.
   * 정수로 반올림해서 보여 준다. */
  function signed(v) {
    var n = Math.round(v);
    if (n === 0) return v === 0 ? '0' : (v > 0 ? '+0' : '−0');
    return (n > 0 ? '+' : '−') + Math.abs(n);
  }

  /** "3시간 전" 처럼 상대 시각으로 (그룹 기록이 얼마나 낡았는지 정직하게 보여준다) */
  function agoText(ts) {
    if (!ts) return '시각 미상';
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 2) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '시간 전';
    return Math.floor(h / 24) + '일 전';
  }

  /** 1분 미만도 버리지 않는 표기 — 순공 시간은 초 단위 체감이 중요하다 */
  function fmtDurFine(min) {
    var sec = Math.round(min * 60);
    if (sec <= 0) return '0분';
    if (sec < 60) return sec + '초';
    var m = Math.floor(sec / 60), h = Math.floor(m / 60), r = m % 60;
    if (!h) return m + '분';
    return r ? (h + '시간 ' + r + '분') : (h + '시간');
  }

  /** 숫자는 크게, 단위는 작게 */
  function durHtml(min) {
    var sec = Math.round(min * 60);
    if (sec < 60) return sec + '<small>초</small>';
    var m = Math.floor(sec / 60), h = Math.floor(m / 60), r = m % 60;
    if (!h) return m + '<small>분</small>';
    return r ? (h + '<small>시간</small> ' + r + '<small>분</small>') : (h + '<small>시간</small>');
  }

  var toastEl = null, toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      // 화면을 못 보는 사용자도 알림을 들을 수 있어야 한다.
      // 오류는 즉시(assertive), 나머지는 하던 말이 끝난 뒤(polite) 읽힌다.
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.setAttribute('aria-live', (kind === true || kind === 'err') ? 'assertive' : 'polite');
    var extra = kind === true || kind === 'err' ? ' err' : (kind === 'party' ? ' party' : '');
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + extra;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast' + extra; }, kind === 'party' ? 4200 : 3200);
  }

  /** 축하할 게 여러 개면 하나씩 순서대로 띄운다 */
  function celebrate(list) {
    if (!list.length) return;
    list.forEach(function (msg, i) {
      setTimeout(function () { toast(msg, 'party'); }, i * 2300);
    });
  }

  function kidsOn() { return Kids.enabled(); }

  /* ============================================================ 라우팅 ==
   * 한 번에 한 페이지만 보여 준다. 길게 스크롤할 필요가 없도록
   * 상단 탭으로 전환하고 주소창 해시(#timer 등)로도 이동할 수 있게 한다. */

  /* 상단 탭은 두 묶음이다.
   *   번호가 붙은 앞의 넷 — 순서대로 밟는 실제 단계 (입력 → 분석 → 플랜 → 타이머)
   *   tool 로 표시한 뒤쪽   — 아무 때나 열어 보는 기능들 (번호도 이모지도 안 붙인다)
   * 예전에는 숫자와 이모지가 1 2 3 4 📅 ★ 5 🏆 6 ⚙ 처럼 섞여 있어서
   * 무엇이 순서고 무엇이 기능인지 한눈에 들어오지 않았다. */
  var PAGES = [
    { id: 'secInput', num: '1', label: '입력', hash: 'input' },
    { id: 'secResult', num: '2', label: '뇌 분석', hash: 'result', needAnalysis: true },
    { id: 'secPlan', num: '3', label: '학습 플랜', hash: 'plan', needAnalysis: true },
    { id: 'secTimer', num: '4', label: '타이머', hash: 'timer', needAnalysis: true },
    { id: 'secVacPlan', label: '계획표', hash: 'vacplan', tool: true },
    { id: 'secKids', label: '내 성장', hash: 'grow', kidsOnly: true, tool: true },
    { id: 'secGroup', label: '랭킹', hash: 'rank', tool: true },
    { id: 'secLeague', label: '리그', hash: 'league', tool: true },
    { id: 'secReport', label: '리포트', hash: 'report', tool: true },
    { id: 'secSettings', label: '설정', hash: 'settings', tool: true }
  ];

  /* 상단 탭에는 없지만 이동은 되는 페이지들.
   * 관리자 화면은 학생이 쓸 일이 없어 탭에서 빼고 [설정] 맨 아래에서만 들어간다. */
  var HIDDEN_PAGES = [
    { id: 'secAdmin', label: '관리자', hash: 'admin', tool: true },
    // 캐릭터 꾸미기는 매일 열 화면이 아니라 [설정 → 내 프로필] 에서만 들어간다
    { id: 'secAvatar', label: '캐릭터 꾸미기', hash: 'avatar', tool: true }
  ];

  var ALL_PAGES = PAGES.concat(HIDDEN_PAGES);
  var ALL_SECTIONS = ALL_PAGES.map(function (p) { return p.id; }).concat(['secProfile']);

  function pageBy(id) { return ALL_PAGES.filter(function (p) { return p.id === id; })[0] || null; }
  function pageByHash(h) { return ALL_PAGES.filter(function (p) { return p.hash === h; })[0] || null; }

  /** 지금 열 수 있는 페이지 목록 (프로필 없음 → 없음 / 분석 전 → 일부 잠금) */
  function openPages() {
    if (!Store.profile()) return [];
    return PAGES.filter(function (p) {
      if (p.kidsOnly && !kidsOn()) return false;
      if (p.needAnalysis && !state.analysis) return false;
      return true;
    });
  }

  function renderNav() {
    var open = openPages();
    var dividerDone = false;

    $('stepNav').innerHTML = open.map(function (p) {
      // 단계와 기능 사이에 한 번만 선을 그어 두 묶음을 구분한다
      var div = '';
      if (p.tool && !dividerDone) { div = '<span class="step-div" aria-hidden="true"></span>'; dividerDone = true; }
      return div + '<button type="button" class="step' + (p.tool ? ' is-tool' : '') + '" data-go="' + p.id + '">' +
        (p.tool ? '' : '<i>' + p.num + '</i>') +
        '<span>' + esc(p.label) + '</span></button>';
    }).join('');
    $$('.step').forEach(function (b) {
      b.addEventListener('click', function () { goPage(b.dataset.go); });
    });
    setActiveStep(state.page);
  }

  function setActiveStep(id) {
    $$('.step').forEach(function (b) {
      var on = b.dataset.go === id;
      b.classList.toggle('is-active', on);
      if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function renderPageNav() {
    var open = openPages();
    var idx = -1;
    open.forEach(function (p, i) { if (p.id === state.page) idx = i; });
    if (idx < 0) { $('pageNav').innerHTML = ''; return; }

    var prev = open[idx - 1], next = open[idx + 1];

    // 분석 전 입력 화면에서는 '분석하기' 버튼이 다음 단계이므로 하단 이동을 감춘다
    if (state.page === 'secInput' && !state.analysis) { $('pageNav').innerHTML = ''; return; }
    $('pageNav').innerHTML =
      (prev ? '<button type="button" class="pn prev" data-go="' + prev.id + '"><span class="arw">←</span>' +
        '<span><span class="k">이전</span><span class="v">' + esc(prev.label) + '</span></span></button>' : '') +
      (next ? '<button type="button" class="pn next" data-go="' + next.id + '">' +
        '<span><span class="k">다음</span><span class="v">' + esc(next.label) + '</span></span><span class="arw">→</span></button>' : '');

    $$('#pageNav .pn').forEach(function (b) {
      b.addEventListener('click', function () { goPage(b.dataset.go); });
    });
  }

  /** 실제 페이지 전환 */
  function goPage(id, skipHash) {
    var open = openPages();
    var allowed = open.some(function (p) { return p.id === id; });

    if (id === 'secProfile') allowed = true; // 프로필 편집은 언제나 가능
    // 탭에 없는 페이지(관리자)는 프로필만 있으면 들어갈 수 있다.
    // 실제 자물쇠는 화면 안의 로그인이지 이 라우팅이 아니다.
    if (!allowed && Store.profile() && HIDDEN_PAGES.some(function (p) { return p.id === id; })) allowed = true;

    if (!allowed) {
      var p = pageBy(id);
      if (p && p.needAnalysis) toast('먼저 오늘의 데이터를 분석해 주세요.', true);
      else if (p && p.kidsOnly) toast('초등학교·중학교를 선택한 경우에만 열립니다.', true);
      return;
    }

    ALL_SECTIONS.forEach(function (sid) {
      var el = $(sid);
      if (!el) return;
      el.classList.add('is-hidden');
      el.classList.remove('is-active');
    });
    var el = $(id);
    el.classList.remove('is-hidden');
    // 애니메이션을 매번 다시 걸기 위해 리플로우를 한 번 강제한다
    void el.offsetWidth;
    el.classList.add('is-active');

    state.page = id;
    setActiveStep(id);
    renderPageNav();

    // 들어올 때마다 최신 값으로 다시 그린다
    if (id === 'secLeague') { renderLeague(); leagueSync(false); }
    if (id === 'secAdmin' && Cloud.adminSession()) { renderAdminServer(); renderAdminLocal(); }
    if (id === 'secAvatar') openAvatarPage();
    // 저장 상태·마지막 백업 날짜가 지난 화면 그대로 남지 않게 한다
    if (id === 'secSettings') renderSettingsPage();

    var pg = pageBy(id);
    if (!skipHash && pg) {
      try { history.replaceState(null, '', '#' + pg.hash); } catch (e) { location.hash = pg.hash; }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  var goto = goPage; // 기존 호출부 호환

  function show(id) { /* 페이지 방식에서는 renderNav 가 노출을 결정한다 */ }
  function hide(id) { var el = $(id); if (el) el.classList.add('is-hidden'); }
  function visible(id) { return !$(id).classList.contains('is-hidden'); }

  /* --------------------------------------------------------------- 입력 UI */

  function paintRange(el) {
    var min = parseFloat(el.min), max = parseFloat(el.max), v = parseFloat(el.value);
    el.style.setProperty('--pct', ((v - min) / (max - min) * 100) + '%');
  }

  var RANGE_FMT = {
    sleepHours: function (v) { return v + '시간'; },
    stress: function (v) { return v + ' / 10'; },
    fatigue: function (v) { return v + ' / 10'; },
    hoursSinceMeal: function (v) { return v + '시간'; },
    water: function (v) { return v + '컵'; },
    caffeine: function (v) { return v + '잔'; },
    exercise: function (v) { return v + '분'; },
    availableHours: function (v) { return v + '시간'; },
    pfGoal: function (v) { return v + '시간'; },
    sndVol: function (v) { return v + '%'; }
  };

  function initRanges() {
    $$('input[type="range"]').forEach(function (el) {
      var out = $(el.dataset.out);
      var fmt = RANGE_FMT[el.id] || function (v) { return v; };
      var sync = function () { paintRange(el); if (out) out.textContent = fmt(el.value); };
      el.addEventListener('input', sync);
      sync();
    });
  }

  function syncAllRanges() {
    $$('input[type="range"]').forEach(function (el) { el.dispatchEvent(new Event('input')); });
  }

  function paintSegs() {
    $$('.seg').forEach(function (seg) {
      var hidden = $(seg.dataset.target);
      $$('button', seg).forEach(function (b) { b.classList.toggle('on', b.dataset.v === hidden.value); });
    });
  }

  function initSegs() {
    $$('.seg').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        $(seg.dataset.target).value = b.dataset.v;
        paintSegs();
      });
    });
    paintSegs();
  }

  /* ------------------------------------------------------------ 과목 행 */

  function addSubjectRow(data) {
    var row = $('subjectRowTpl').content.cloneNode(true).querySelector('.subject-row');
    if (data) {
      row.querySelector('.s-name').value = data.name || '';
      row.querySelector('.s-type').value = data.type || 'mixed';
      row.querySelector('.s-date').value = data.examDate || '';
      row.querySelector('.s-imp').value = String(data.importance || 3);
      row.querySelector('.s-ready').value = String(data.readiness || 3);
    }
    row.querySelector('.s-del').addEventListener('click', function () {
      if ($$('.subject-row', $('subjectList')).length <= 1) { toast('과목은 최소 1개가 필요합니다.', true); return; }
      row.remove();
    });
    $('subjectList').appendChild(row);
    return row;
  }

  function readSubjects() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return $$('.subject-row', $('subjectList')).map(function (row, i) {
      var name = row.querySelector('.s-name').value.trim();
      if (!name) return null;
      var dv = row.querySelector('.s-date').value;
      var daysLeft = null;
      if (dv) {
        var d = new Date(dv + 'T00:00:00');
        if (!isNaN(d)) daysLeft = Math.round((d - today) / 86400000);
      }
      return {
        id: 'sub' + i, name: name,
        type: row.querySelector('.s-type').value,
        examDate: dv || null, daysLeft: daysLeft,
        importance: parseInt(row.querySelector('.s-imp').value, 10),
        readiness: parseInt(row.querySelector('.s-ready').value, 10)
      };
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------- 입력 수집 */

  function collectInput() {
    var st = $('startTime').value, startHour;
    if (st) {
      var p = st.split(':');
      startHour = parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
    } else {
      var now = new Date();
      startHour = now.getHours() + now.getMinutes() / 60;
    }
    var bt = $('bedTime').value, bedHour = null;
    if (bt) {
      var q = bt.split(':');
      bedHour = parseInt(q[0], 10) + parseInt(q[1], 10) / 60;
    }
    return {
      startHour: startHour, hour: startHour, bedHour: bedHour,
      sleep: {
        hours: parseFloat($('sleepHours').value),
        quality: parseInt($('sleepQuality').value, 10),
        regularity: parseInt($('sleepRegularity').value, 10)
      },
      stress: parseInt($('stress').value, 10),
      fatigue: parseInt($('fatigue').value, 10),
      mood: parseInt($('mood').value, 10),
      meals: {
        breakfast: $('mealBreakfast').checked,
        lunch: $('mealLunch').checked,
        dinner: $('mealDinner').checked
      },
      hoursSinceMeal: parseFloat($('hoursSinceMeal').value),
      water: parseInt($('water').value, 10),
      caffeine: parseInt($('caffeine').value, 10),
      exercise: parseInt($('exercise').value, 10),
      availableHours: parseFloat($('availableHours').value),
      subjects: readSubjects()
    };
  }

  function applyInput(inp) {
    if (!inp) return;
    $('sleepHours').value = inp.sleep.hours;
    $('sleepQuality').value = inp.sleep.quality;
    $('sleepRegularity').value = inp.sleep.regularity;
    $('stress').value = inp.stress;
    $('fatigue').value = inp.fatigue;
    $('mood').value = inp.mood;
    $('mealBreakfast').checked = !!inp.meals.breakfast;
    $('mealLunch').checked = !!inp.meals.lunch;
    $('mealDinner').checked = !!inp.meals.dinner;
    $('hoursSinceMeal').value = inp.hoursSinceMeal;
    $('water').value = inp.water;
    $('caffeine').value = inp.caffeine;
    $('exercise').value = inp.exercise;
    $('availableHours').value = inp.availableHours;
    // 취침 시각은 나중에 추가된 항목이라 예전 기록에는 없다 — 기본값을 유지한다
    if (inp.bedHour !== null && inp.bedHour !== undefined) {
      $('bedTime').value = pad(Math.floor(inp.bedHour)) + ':' + pad(Math.round((inp.bedHour % 1) * 60));
    }

    $('subjectList').innerHTML = '';
    (inp.subjects && inp.subjects.length ? inp.subjects : [null, null]).forEach(addSubjectRow);

    syncAllRanges();
    paintSegs();
  }

  /* ============================================================ 프로필 == */

  function fillGradeOptions(keepValue) {
    var level = $('pfLevel').value;
    var list = Group.GRADES[level] || Group.GRADES['고등학교'];
    $('pfGrade').innerHTML = list.map(function (g) {
      return '<option value="' + esc(g) + '">' + esc(g === '해당 없음' ? g : g + '학년') + '</option>';
    }).join('');
    if (keepValue && list.indexOf(keepValue) >= 0) $('pfGrade').value = keepValue;
  }

  /* ------------------------------------------------- 학교명 자동완성 ---- */

  var acIndex = -1, acTimer = null, acSeq = 0;

  function acItems() { return $$('#schoolAc .ac-item'); }

  function closeAc() { $('schoolAc').classList.add('is-hidden'); acIndex = -1; }

  function pickAc(btn) {
    $('pfSchool').value = btn.dataset.name;
    if (btn.dataset.school) {
      // 나이스에서 고른 학교 — 급식 조회에 쓸 코드를 함께 보관한다
      state.pickedSchool = {
        name: btn.dataset.name,
        eduCode: btn.dataset.edu,
        schoolCode: btn.dataset.school,
        region: btn.dataset.region || '',
        kind: btn.dataset.kind || ''
      };
      if (btn.dataset.level && Group.GRADES[btn.dataset.level]) {
        $('pfLevel').value = btn.dataset.level;
        fillGradeOptions($('pfGrade').value);
      }
    } else {
      state.pickedSchool = null; // 직접 입력한 이름은 코드가 없다
    }
    closeAc();
    $('pfSchool').focus();
  }

  function acRow(o) {
    var qq = $('pfSchool').value.trim();
    var shown = esc(o.name);
    if (qq && o.name.indexOf(qq) === 0) shown = '<b>' + esc(qq) + '</b>' + esc(o.name.slice(qq.length));

    var attrs = ' data-name="' + esc(o.name) + '"';
    var sub = '', tag = '', icon = '🏫';

    if (o.schoolCode) {
      attrs += ' data-school="' + esc(o.schoolCode) + '" data-edu="' + esc(o.eduCode) + '"' +
               ' data-region="' + esc(o.region) + '" data-kind="' + esc(o.kind) + '" data-level="' + esc(o.level) + '"';
      sub = '<span class="asub">' + esc(o.region) + ' · ' + esc(o.kind) + '</span>';
      tag = '나이스';
    } else if (o.kind === 'recent') { icon = '🕘'; tag = '이전 입력'; }
    else { tag = '완성'; }

    return '<button type="button" class="ac-item"' + attrs + '>' +
      '<span class="ai">' + icon + '</span>' +
      '<span class="an">' + shown + sub + '</span>' +
      '<span class="at">' + tag + '</span></button>';
  }

  function paintAc(list, loading) {
    if (!list.length && !loading) { closeAc(); return; }
    $('schoolAc').innerHTML = list.map(acRow).join('') +
      (loading ? '<div class="ac-loading">🔎 나이스에서 학교를 찾는 중…</div>'
               : '<div class="ac-hint">목록에 없으면 전체 이름을 직접 입력하셔도 됩니다.</div>');
    acItems().forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); pickAc(b); });
    });
    $('schoolAc').classList.remove('is-hidden');
    acIndex = -1;
  }

  function openAc() {
    var q = $('pfSchool').value;
    var level = $('pfLevel').value;
    var offline = Group.schoolSuggestions(q, level);

    /* 나이스는 인증키가 없어도 실제 학교를 돌려준다.
     * 예전에는 키가 있을 때만 물어봐서, 키 없는 사용자에게는
     * "직접 입력한 학교 + 접미사 붙인 추측" 만 보였다.
     * 이제 두 글자만 쳐도 실제 학교 목록을 받아 온다. */
    var useNeis = q.trim().length >= 2;
    paintAc(offline, useNeis);
    if (!useNeis) return;

    clearTimeout(acTimer);
    var seq = ++acSeq;
    acTimer = setTimeout(function () {
      // 결과가 도착했을 때 아직 유효한 요청인지 판단한다.
      // 포커스로 판정하면 창이 잠깐 focus 를 잃어도 결과가 사라지므로,
      // "더 최근 입력이 없고, 목록이 아직 열려 있고, 입력값이 그대로인가" 로 본다.
      var stillValid = function () {
        return seq === acSeq &&
               !$('schoolAc').classList.contains('is-hidden') &&
               $('pfSchool').value === q;
      };
      Neis.searchSchools(q, level).then(function (rows) {
        if (!stillValid()) return;
        paintAc(rows.length ? rows.slice(0, 8) : offline, false);
      }).catch(function () {
        if (!stillValid()) return;
        paintAc(offline, false);                          // 실패하면 오프라인 후보 유지
      });
    }, 280);
  }

  function initSchoolAc() {
    var inp = $('pfSchool');
    inp.addEventListener('input', function () { state.pickedSchool = null; openAc(); });
    inp.addEventListener('focus', openAc);
    inp.addEventListener('blur', function () { setTimeout(closeAc, 150); });
    $('pfLevel').addEventListener('change', function () { if (document.activeElement === inp) openAc(); });

    inp.addEventListener('keydown', function (e) {
      var items = acItems();
      if ($('schoolAc').classList.contains('is-hidden') || !items.length) {
        if (e.key === 'ArrowDown') openAc();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        acIndex += (e.key === 'ArrowDown' ? 1 : -1);
        if (acIndex < 0) acIndex = items.length - 1;
        if (acIndex >= items.length) acIndex = 0;
        items.forEach(function (b, i) { b.classList.toggle('on', i === acIndex); });
        items[acIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && acIndex >= 0) {
        e.preventDefault();
        pickAc(items[acIndex]);
      } else if (e.key === 'Escape') {
        closeAc();
      }
    });
  }

  function renderProfileChip() {
    var p = Store.profile();
    var chip = $('profileChip');
    if (!p) { chip.classList.add('is-hidden'); return; }
    chip.classList.remove('is-hidden');
    $('pcAvatar').innerHTML = Avatar.html(Avatar.get(), Avatar.lifetimeMinutes(), 'av-xs');
    $('pcName').textContent = p.nick;
    $('pcGroup').textContent = Group.groupLabel(p);
  }

  function openProfile(edit) {
    var p = Store.profile();
    if (p) {
      $('pfNick').value = p.nick || '';
      $('pfSchool').value = p.school || '';
      $('pfLevel').value = p.level || '고등학교';
      fillGradeOptions(p.grade);
      $('pfClass').value = p.klass || '';
      $('pfGoal').value = p.goal || 25;
      syncAllRanges();
    } else {
      fillGradeOptions();
    }
    renderCloudSettings(); // pfLeague 체크박스를 지금의 Cloud 상태로 맞춘다
    $('cancelProfile').style.display = p ? '' : 'none';
    goPage('secProfile');
  }

  function saveProfile() {
    var nick = $('pfNick').value.trim();
    var school = $('pfSchool').value.trim();
    if (!nick) { toast('이름 또는 닉네임을 입력해 주세요.', true); $('pfNick').focus(); return; }
    if (!school) { toast('학교명을 입력해 주세요.', true); $('pfSchool').focus(); return; }

    var prev = Store.profile();
    var p = {
      nick: nick, school: school,
      level: $('pfLevel').value,
      grade: $('pfGrade').value,
      klass: $('pfClass').value.trim(),
      goal: parseInt($('pfGoal').value, 10)
    };

    // 프로필 폼은 아바타를 다루지 않는다. 여기서 넘겨받지 않으면 저장할 때마다 꾸민 게 초기화된다.
    if (prev && prev.avatar) p.avatar = prev.avatar;

    // 나이스에서 고른 학교면 급식 조회용 코드를 함께 저장한다.
    // 이름을 바꿨는데 코드가 그대로면 엉뚱한 학교 급식이 뜨므로 이름이 같을 때만 유지.
    if (state.pickedSchool && state.pickedSchool.name === school) p.neis = state.pickedSchool;
    else if (prev && prev.neis && prev.neis.name === school) p.neis = prev.neis;

    // 그룹이 바뀌면 이전 내 기록은 새 id 로 옮겨야 하므로 옛 항목을 지운다
    if (prev && Group.memberId(prev) !== Group.memberId(p)) Group.remove(Group.memberId(prev));

    Store.saveProfile(p);
    Store.rememberSchool(school);
    Group.syncSelf();
    renderProfileChip();
    unlockApp();
    renderGroup();
    renderLeague();
    renderReport();
    renderKids();
    renderSettingsPage();
    renderMeals();
    fillTtGradeOptions(p.grade);
    $('ttClass').value = p.klass || '';
    renderTimetable();
    // 계획표 제목을 손대지 않았다면 새 이름을 따라가게 한다
    if (state.vacplan && state.vacplan.titleAuto !== false) {
      state.vacplan.title = nick + '의 계획표';
      vpSave();
      if ($('vpTitle')) $('vpTitle').value = state.vacplan.title;
      vpRenderPreview();
    }
    // 리그 참가를 프로필이 없던 시점(첫 화면)에 이미 켰다면 그때는 보낼 학교가 없어
    // 조용히 넘어갔었다 — 이제 프로필이 생겼으니 한 번 밀어 준다.
    if (Cloud.enabled()) leagueSync(true);
    toast(Group.groupLabel(p) + ' 그룹으로 설정했습니다.');
    goPage(prev ? 'secSettings' : 'secInput');
  }

  function unlockApp() { renderNav(); renderPageNav(); }

  /* ------------------------------------------------------- 결과 렌더링 */

  function renderResult(a) {
    var now = new Date();
    $('analyzedAt').textContent =
      now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' +
      fmtHour(a.input.hour) + ' 기준 · 입력한 ' + Object.keys(a.factors).length + '개 생체·심리·생활 지표로 산출';

    var C = 2 * Math.PI * 92;
    var fill = $('gaugeFill');
    fill.style.strokeDasharray = C;
    fill.style.strokeDashoffset = C;
    setTimeout(function () { fill.style.strokeDashoffset = C * (1 - a.overall / 100); }, 60);

    animateNum($('overallScore'), a.overall);
    $('overallState').textContent = a.state.label;
    $('overallState').className = 'g-state ' + a.state.tone;

    // 5개 능력은 같은 뿌리(수면·피로)에서 나와 서로 붙어 움직인다.
    // 편차가 충분히 벌어졌을 때만 "무엇이 낫다" 고 말한다.
    $('heroTitle').textContent = a.capMeaningful
      ? '오늘은 ' + a.top.label + '이 상대적으로 가장 잘 올라와 있고, ' + a.bottom.label + '이 가장 처져 있습니다.'
      : '오늘은 능력별 편차가 크지 않습니다. 어떤 과목을 해도 조건은 비슷합니다.';
    $('heroLine').textContent = a.state.line + ' ' + dominantDriver(a);

    $('alertList').innerHTML = a.alerts.map(function (x) {
      return '<div class="alert ' + x.level + '"><b>' + (x.level === 'bad' ? '⚠' : '!') + '</b><span>' + esc(x.text) + '</span></div>';
    }).join('') || '<div class="alert warn"><b>✓</b><span>특별한 위험 신호는 없습니다. 계획대로 진행하세요.</span></div>';

    $('aiBriefingLine').textContent = buildAiBriefing(a);

    renderCapStrip(a);
    renderRadar(a);
    renderCapBars(a);
    renderCapDetails(a);
    collapseResultDetail();
  }

  /* ------------------------------------------------------- AI 브리핑 한 줄
   * 점수만 늘어놓지 않고, 어제 대비 변화 + 오늘 먼저/뒤로 할 과목 유형까지
   * 한 문장으로 묶어 "AI가 나를 보고 말해준다"는 느낌을 준다. */

  function bestTypeFor(capId) {
    var best = null, bestW = -1;
    Object.keys(BrainPlanner.TYPES).forEach(function (id) {
      if (id === 'mixed') return;
      var w = BrainPlanner.TYPES[id].affinity[capId] || 0;
      if (w > bestW) { bestW = w; best = id; }
    });
    return best ? BrainPlanner.TYPES[best] : null;
  }

  function buildAiBriefing(a) {
    var yKey = Store.key(new Date(Date.now() - 86400000));
    var y = Store.recordOn(yKey);

    var trend = '';
    if (y) {
      var sleepDiff = a.input.sleep.hours - y.sleep;
      var overallDiff = a.overall - y.overall;
      if (Math.abs(sleepDiff) >= 0.4) {
        trend = '어제보다 수면이 ' + round1(Math.abs(sleepDiff)) + '시간 ' + (sleepDiff < 0 ? '부족합니다.' : '늘었습니다.') + ' ';
      } else if (Math.abs(overallDiff) >= 5) {
        trend = '어제보다 종합 컨디션이 ' + Math.abs(overallDiff) + '점 ' + (overallDiff < 0 ? '떨어졌습니다.' : '올라왔습니다.') + ' ';
      }
    }

    var advice;
    if (a.capMeaningful) {
      var good = bestTypeFor(a.top.id);
      var bad = bestTypeFor(a.bottom.id);
      advice = '오늘은 ' + good.label + '(' + good.hint.split(' · ')[0] + ' 등)을 먼저 하고, ' +
        bad.label + '은 뒤로 미루는 것이 좋습니다.';
    } else {
      advice = a.state.line;
    }

    return trend + advice;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* -------------------------------------------------- 결과 요약 스트립
   * 결과 화면이 길어 한눈에 안 들어온다는 이야기가 있어,
   * 기본은 점수 5개까지만 보여 주고 근거는 눌렀을 때 펼치도록 했다. */

  function renderCapStrip(a) {
    var mean = Math.round(a.capMean);

    $('capStrip').innerHTML = a.capacities.map(function (c) {
      var rel = Math.round(c.rel);
      var relCls = rel >= 2 ? 'up' : (rel <= -2 ? 'dn' : 'flat');
      var relTxt = rel === 0 ? '±0' : (rel > 0 ? '+' + rel : '−' + Math.abs(rel));
      var isTop = a.capMeaningful && c.id === a.top.id;

      return '<button type="button" class="cap-chip' + (isTop ? ' is-top' : '') + '"' +
        ' data-cap="' + c.id + '" aria-label="' + esc(c.label) + ' ' + c.score + '점, 자세히 보기">' +
        '<span class="cc-ic">' + c.icon + '</span>' +
        '<span class="cc-score" style="color:' + c.color + '">' + c.score + '</span>' +
        '<span class="cc-name">' + esc(c.short) + '</span>' +
        '<span class="cc-track"><i class="cc-fill" data-w="' + c.score + '" style="width:0;background:' + c.color + '"></i></span>' +
        '<span class="cc-rel ' + relCls + '">' + relTxt + '</span>' +
      '</button>';
    }).join('');

    $('capStripNote').innerHTML = a.capMeaningful
      ? '오늘 평균은 <b>' + mean + '점</b>이고 능력 간 차이가 ' + Math.round(a.capSpread) + '점으로 벌어져 있습니다. ' +
        '아래 숫자는 평균 대비 편차입니다 — <b>' + esc(a.top.label) + '</b>을 쓰는 과목을 먼저 배치하세요.'
      : '오늘 평균은 <b>' + mean + '점</b>이고 최고·최저 차이가 ' + Math.round(a.capSpread) + '점뿐입니다. ' +
        '<b>어떤 과목이 특별히 유리하다고 말하기 어려우니</b> 총량만 조절하세요.';

    setTimeout(function () {
      $$('.cc-fill').forEach(function (el) { el.style.width = el.dataset.w + '%'; });
    }, 80);

    // 칩을 누르면 상세를 펼치고 그 능력의 근거 카드로 데려간다
    $$('.cap-chip').forEach(function (chip) {
      chip.addEventListener('click', function () { openCapDetail(chip.dataset.cap); });
    });
  }

  function detailOpen() { return !$('resultDetail').classList.contains('is-hidden'); }

  function collapseResultDetail() {
    $('resultDetail').classList.add('is-hidden');
    $('resultMore').setAttribute('aria-expanded', 'false');
    $('resultMore').querySelector('.rm-txt').textContent = '자세한 분석 보기';
    $$('.cd').forEach(function (c) { c.classList.remove('open'); });
    $$('.cap-bar').forEach(function (b) { b.classList.remove('on'); });
  }

  function expandResultDetail() {
    $('resultDetail').classList.remove('is-hidden');
    $('resultMore').setAttribute('aria-expanded', 'true');
    $('resultMore').querySelector('.rm-txt').textContent = '자세한 분석 접기';
    // 숨어 있는 동안 막대 애니메이션이 돌지 않았을 수 있어 다시 채운다
    $$('.cb-fill').forEach(function (el) { el.style.width = el.dataset.w + '%'; });
  }

  function toggleResultDetail() {
    if (detailOpen()) collapseResultDetail();
    else expandResultDetail();
  }

  /** 특정 능력의 근거 카드를 펼쳐 보여 준다 */
  function openCapDetail(capId) {
    expandResultDetail();

    var card = document.querySelector('.cd[data-cap="' + capId + '"]');
    if (!card) return;

    $$('.cd').forEach(function (c) { c.classList.remove('open'); });
    card.classList.add('open');
    $$('.cap-bar').forEach(function (b) { b.classList.toggle('on', b.dataset.cap === capId); });

    // 레이아웃이 잡힌 뒤에 스크롤해야 위치가 맞는다
    setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  }

  function dominantDriver(a) {
    var totals = {};
    a.capacities.forEach(function (cap) {
      var w = BrainEngine.OVERALL_WEIGHTS[cap.id];
      cap.contribs.forEach(function (c) { totals[c.id] = (totals[c.id] || 0) + w * c.points; });
    });
    var arr = Object.keys(totals).map(function (k) { return { id: k, v: totals[k] }; })
      .sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); });
    if (!arr.length) return '';
    var f = a.factors[arr[0].id];
    return '종합 점수를 가장 크게 움직인 것은 ' + f.label + '(' + f.display + ')이며, 종합에 ' + signed(arr[0].v) + '점만큼 작용했습니다.';
  }

  // 카운트업은 장식이므로 값을 먼저 확정해 둔다.
  // 백그라운드 탭에서는 rAF 가 한 번도 돌지 않아서, 애니메이션에만 의존하면
  // 분석 직후 앱을 전환한 사용자는 돌아왔을 때 0 점에서 굳은 화면을 보게 된다.
  function animateNum(el, target) {
    var final = Math.round(target);
    el.textContent = final;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || document.hidden) return;

    var dur = 900, t0 = performance.now(), done = false;

    function finish() {
      if (done) return;
      done = true;
      el.textContent = final;
      document.removeEventListener('visibilitychange', onHide);
    }
    function onHide() { if (document.hidden) finish(); }
    document.addEventListener('visibilitychange', onHide);

    el.textContent = '0';
    function step(t) {
      if (done) return;
      var p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(final * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
      else finish();
    }
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------- 레이더 */

  function renderRadar(a) {
    var cx = 170, cy = 152, R = 104, n = a.capacities.length;
    var svg = [];

    function pt(i, r) {
      var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    }

    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var pts = [];
      for (var i = 0; i < n; i++) pts.push(pt(i, R * k).map(function (v) { return v.toFixed(1); }).join(','));
      svg.push('<polygon points="' + pts.join(' ') + '" fill="none" stroke="rgba(22,26,39,0.10)" stroke-width="1"/>');
    });
    for (var i = 0; i < n; i++) {
      var p = pt(i, R);
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="rgba(22,26,39,0.10)" stroke-width="1"/>');
    }

    var dpts = a.capacities.map(function (c, idx) {
      return pt(idx, R * (c.score / 100)).map(function (v) { return v.toFixed(1); }).join(',');
    });
    svg.push('<defs><radialGradient id="radarGrad"><stop offset="0%" stop-color="rgba(109,74,255,0.42)"/><stop offset="100%" stop-color="rgba(8,145,178,0.16)"/></radialGradient></defs>');
    svg.push('<polygon points="' + dpts.join(' ') + '" fill="url(#radarGrad)" stroke="#6d4aff" stroke-width="2" stroke-linejoin="round"/>');

    a.capacities.forEach(function (c, idx) {
      var p2 = pt(idx, R * (c.score / 100));
      svg.push('<circle cx="' + p2[0].toFixed(1) + '" cy="' + p2[1].toFixed(1) + '" r="4.5" fill="' + c.color + '" stroke="#ffffff" stroke-width="2"/>');
      var lp = pt(idx, R + 26);
      var anchor = lp[0] > cx + 12 ? 'start' : (lp[0] < cx - 12 ? 'end' : 'middle');
      svg.push('<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" text-anchor="' + anchor + '" fill="#5b6579" font-size="11.5" font-weight="600">' + esc(c.short) + '</text>');
      svg.push('<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 14).toFixed(1) + '" text-anchor="' + anchor + '" fill="' + c.color + '" font-size="12.5" font-weight="800">' + c.score + '</text>');
    });

    $('radar').innerHTML = svg.join('');
    $('radarLegend').innerHTML = a.capacities.map(function (c) {
      return '<span><i style="background:' + c.color + '"></i>' + esc(c.label) + '</span>';
    }).join('');
  }

  /* ---------------------------------------------------------- 능력 카드 */

  function levelTag(level) {
    // 앱 전체 색과 같은 계열로 — 초록·주황 대신 --good/--warn 토큰과 맞춘 파랑·로즈브라운
    if (level === 'high') return { t: '우수', c: '#2a55a8', b: '#eaf1fc' };
    if (level === 'mid') return { t: '보통', c: '#3f5bc4', b: '#eaeeff' };
    return { t: '저하', c: '#7a4f3b', b: '#f6efec' };
  }

  function renderCapBars(a) {
    var mean = Math.round(a.capMean);
    $('capBars').innerHTML = a.capacities.map(function (c) {
      var tg = levelTag(c.level);
      var rel = Math.round(c.rel);
      var relCls = rel >= 2 ? 'up' : (rel <= -2 ? 'dn' : 'flat');
      var relTxt = rel === 0 ? '평균' : (rel > 0 ? '+' + rel : '−' + Math.abs(rel));
      return '<button type="button" class="cap-bar" data-cap="' + c.id + '">' +
        '<div class="cb-top"><span>' + c.icon + '</span><span class="cb-name">' + esc(c.label) + '</span>' +
        '<span class="cb-tag" style="color:' + tg.c + ';background:' + tg.b + '">' + tg.t + '</span>' +
        '<span class="cb-rel ' + relCls + '" title="오늘 5개 능력 평균(' + mean + '점) 대비">' + relTxt + '</span>' +
        '<span class="cb-score" style="color:' + c.color + '">' + c.score + '</span></div>' +
        '<div class="cb-track"><div class="cb-fill" data-w="' + c.score + '" style="background:linear-gradient(90deg,' + c.color + '99,' + c.color + ')"></div>' +
        '<div class="cb-mean" style="left:calc(' + mean + '% - 1px)" title="오늘 평균 ' + mean + '점"></div></div>' +
        '<div class="cb-desc">' + esc(kidsOn() && c.kidsDesc ? c.kidsDesc : c.desc) + '</div></button>';
    }).join('') +
      '<p class="tiny">세로선은 오늘 5개 능력의 평균(' + mean + '점)입니다. 5개 능력은 수면·피로라는 같은 뿌리에서 나오기 때문에 함께 오르내립니다. ' +
      (a.capMeaningful
        ? '오늘은 능력 간 차이가 ' + Math.round(a.capSpread) + '점으로 벌어져 있어 <b>평균 대비 편차</b>를 보고 과목을 고르면 됩니다.'
        : '오늘은 최고·최저 차이가 ' + Math.round(a.capSpread) + '점뿐이라 <b>어떤 과목이 특별히 유리하다고 말하기 어렵습니다.</b> 절대 점수(종합 컨디션)를 기준으로 총량만 조절하세요.') + '</p>';

    setTimeout(function () { $$('.cb-fill').forEach(function (el) { el.style.width = el.dataset.w + '%'; }); }, 80);

    $$('.cap-bar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = document.querySelector('.cd[data-cap="' + btn.dataset.cap + '"]');
        if (!card) return;
        // 이미 열려 있으면 접는다
        if (card.classList.contains('open')) {
          card.classList.remove('open');
          btn.classList.remove('on');
          return;
        }
        openCapDetail(btn.dataset.cap);
      });
    });
  }

  /* -------------------------------------------------------- 산출 근거 */

  function renderCapDetails(a) {
    $('capDetails').innerHTML = a.capacities.map(function (c) {
      var maxAbs = Math.max.apply(null, c.contribs.map(function (x) { return Math.abs(x.points); }).concat([1]));

      var rows = c.contribs.map(function (ct) {
        var pos = ct.points >= 0;
        var w = (Math.abs(ct.points) / maxAbs) * 50;
        return '<div class="ct">' +
          '<div class="ct-label">' + ct.icon + '<b>' + esc(ct.label) + '</b></div>' +
          '<div class="ct-mid"><div class="ct-bar ' + (pos ? 'pos' : 'neg') + '" style="width:' + w.toFixed(1) + '%"></div></div>' +
          '<div class="ct-val ' + (pos ? 'pos' : 'neg') + '">' + signed(ct.points) + '</div>' +
          '<div class="ct-note"><b>' + esc(ct.display) + '</b> · 가중치 ' + Math.round(ct.weight * 100) + '% — ' + esc(ct.note) + '</div>' +
        '</div>';
      }).join('');

      var circPct = Math.round((c.circMult - 1) * 100);
      var atTime = '지금 시각(' + fmtHour(a.input.hour) + ')은';
      var circText = circPct === 0
        ? atTime + ' ' + c.label + '의 평균 구간이라 보정이 없습니다.'
        : (circPct > 0
            ? atTime + ' ' + c.label + '이 상대적으로 잘 올라오는 시간대라 ' + circPct + '% 가산됐습니다.'
            : atTime + ' ' + c.label + '의 일주기 저점에 가까워 ' + Math.abs(circPct) + '% 감산됐습니다.');

      return '<div class="cd" data-cap="' + c.id + '">' +
        '<button type="button" class="cd-head">' +
          '<span class="dot" style="background:' + c.color + '"></span>' +
          '<span class="nm">' + c.icon + ' ' + esc(c.label) + '</span>' +
          '<span class="sc" style="color:' + c.color + '">' + c.score + '점</span>' +
          '<span class="chev">▼</span></button>' +
        '<div class="cd-body">' +
          '<div class="contrib">' + rows + '</div>' +
          '<div class="calc-line"><span>기준점 (모든 지표가 중립일 때)</span><span class="v">50.0</span></div>' +
          '<div class="calc-line"><span>입력 데이터 기여 합계</span><span class="v">' + signed(c.baseScore - 50) + '</span></div>' +
          '<div class="calc-line"><span>소계</span><span class="v">' + c.baseScore.toFixed(1) + '</span></div>' +
          '<div class="calc-line"><span>생체리듬 보정 (' + fmtHour(a.input.hour) + ' 기준 ×' + c.circMult.toFixed(2) + ')</span><span class="v">' + signed(c.circPoints) + '</span></div>' +
          '<div class="calc-line total"><span>최종 ' + esc(c.label) + '</span><span class="v">' + c.score + '점</span></div>' +
          '<div class="why">' + whyText(c, circText) + '</div>' +
        '</div></div>';
    }).join('');

    $$('.cd-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var cd = h.parentElement, wasOpen = cd.classList.contains('open');
        $$('.cd').forEach(function (x) { x.classList.remove('open'); });
        if (!wasOpen) cd.classList.add('open');
      });
    });
  }

  function whyText(c, circText) {
    var pos = c.contribs.filter(function (x) { return x.points > 0.4; });
    var neg = c.contribs.filter(function (x) { return x.points < -0.4; });
    var parts = ['<b>왜 ' + esc(c.label) + '이 ' + c.score + '점인가?</b>'];

    if (neg.length) {
      parts.push(esc(c.label) + '을 가장 크게 끌어내린 것은 <b>' + esc(neg[0].label) + '(' + esc(neg[0].display) + ')</b>으로 ' + signed(neg[0].points) + '점이며' +
        (neg[1] ? ', 그다음은 <b>' + esc(neg[1].label) + '(' + esc(neg[1].display) + ')</b>의 ' + signed(neg[1].points) + '점입니다' : '') + '.');
    }
    if (pos.length) {
      parts.push('반대로 <b>' + esc(pos[0].label) + '(' + esc(pos[0].display) + ')</b>이 ' + signed(pos[0].points) + '점으로 가장 크게 받쳐 줬고' +
        (pos[1] ? ', <b>' + esc(pos[1].label) + '</b>도 ' + signed(pos[1].points) + '점 기여했습니다' : '습니다') + '.');
    }
    if (!pos.length && !neg.length) parts.push('모든 지표가 중립에 가까워 큰 가감 요인이 없습니다.');
    parts.push(circText);

    if (c.level === 'high') parts.push('→ 오늘 <b>' + esc(c.label) + '을 요구하는 과제를 우선 배치</b>하는 것이 유리합니다.');
    else if (c.level === 'low') parts.push('→ ' + esc(c.label) + '에 크게 의존하는 과제는 <b>오늘 효율이 떨어집니다.</b> 비중을 줄이거나 뒤로 미루세요.');

    return parts.join(' ');
  }

  /* --------------------------------------------------------- 플랜 렌더링 */

  function renderPlan(p) {
    $('planHeadline').textContent = p.headline;
    renderCurfew(p);

    $('pomSummary').innerHTML =
      '<div class="pm hi"><div class="pm-k">추천 모드</div><div class="pm-v" style="font-size:17px">' + esc(p.pomodoro.name) + '</div></div>' +
      '<div class="pm"><div class="pm-k">집중 / 휴식</div><div class="pm-v">' + p.pomodoro.focus + '<small>분</small> / ' + p.pomodoro.short + '<small>분</small></div></div>' +
      '<div class="pm"><div class="pm-k">총 학습 시간</div><div class="pm-v">' + Math.floor(p.plannedStudyMin / 60) + '<small>시간</small> ' + (p.plannedStudyMin % 60) + '<small>분</small></div></div>' +
      '<div class="pm"><div class="pm-k">집중 블록</div><div class="pm-v">' + p.totalBlocks + '<small>개</small></div></div>' +
      '<div class="pom-note">⚙️ ' + esc(p.pomodoroReason) + ' ' + esc(p.scaleNote) +
        ' 긴 휴식은 ' + p.pomodoro.cycle + '블록마다 ' + p.pomodoro.long + '분으로 배치했습니다.</div>';

    var total = p.plannedStudyMin || 1;
    $('allocBar').innerHTML = p.subjects.map(function (s) {
      var pct = s.minutes / total * 100;
      return '<div class="ab" style="width:' + pct.toFixed(2) + '%;background:' + s.color + '" title="' + esc(s.name) + ' ' + s.minutes + '분">' +
        (pct > 11 ? esc(s.name) : '') + '</div>';
    }).join('');

    /* 과목마다 근거·공부법·지표를 다 펼쳐 두면 화면이 너무 길어진다.
     * 기본은 "무엇을 얼마나" 한 줄만 두고, 누르면 이유가 펼쳐지게 한다. */
    $('subjectPlans').innerHTML = p.subjects.map(function (s) {
      var dd = s.daysLeft === null ? '' :
        '<span class="sp-chip dday' + (s.daysLeft > 7 ? ' far' : '') + '">' + (s.daysLeft < 0 ? '종료' : (s.daysLeft === 0 ? 'D-DAY' : 'D-' + s.daysLeft)) + '</span>';
      return '<div class="sp" style="--c:' + s.color + '" data-subj="' + esc(s.name) + '">' +
        '<button type="button" class="sp-top" aria-expanded="false">' +
          '<span class="sp-lead">' +
            '<span class="sp-name">' + esc(s.name) + '</span>' +
            '<span class="sp-chip">' + s.typeIcon + ' ' + esc(s.typeLabel) + '</span>' + dd +
          '</span>' +
          '<span class="sp-time">' + fmtDur(s.minutes) + '<small>' + s.blocks + '블록</small></span>' +
          '<span class="sp-arw" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="sp-body">' +
          '<p class="sp-reason">' + esc(s.reason) + '</p>' +
          '<div class="sp-method"><h5>' + esc(s.method) + '</h5><p>' +
            esc(kidsOn() && s.methodBodyKids ? s.methodBodyKids : s.methodBody) + '</p></div>' +
          '<div class="sp-meta">' +
            '<span><b>우선순위</b> ' + Math.round(s.priority * 100) + '</span>' +
            '<span><b>긴급도</b> ' + Math.round(s.urgency * 100) + '%</span>' +
            '<span><b>중요도</b> ' + s.importanceRaw + '/5</span>' +
            '<span><b>준비도</b> ' + s.readiness + '/5</span>' +
            '<span><b>오늘 뇌 궁합</b> ' + Math.round(s.brainFit * 100) + '% (' + esc(s.domCapLabel) + ' ' + s.domCapScore + '점 · 평균 대비 ' + signed(s.domCapRel) + ')</span>' +
          '</div>' +
        '</div></div>';
    }).join('') || '<p class="tiny">' + (p.curfew && p.curfew.bedtimeNow
      ? '취침 시각이 지나 오늘은 블록을 배정하지 않았습니다.'
      : '배정된 과목이 없습니다. 가용 학습 시간을 늘리거나 과목을 추가해 주세요.') + '</p>';

    $('planTapHint').style.display = p.subjects.length ? '' : 'none';
    // 커퓨를 넘긴 상태에서 "이 플랜으로 시작" 을 눌러 봐야 돌릴 블록이 없다
    $('startTimerBtn').style.display = p.subjects.length ? '' : 'none';

    // 한 번에 하나만 펼친다 — 여러 개가 열리면 접은 의미가 없다
    $$('#subjectPlans .sp-top').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.parentElement;
        var willOpen = !card.classList.contains('open');
        $$('#subjectPlans .sp').forEach(function (c) {
          c.classList.remove('open');
          c.querySelector('.sp-top').setAttribute('aria-expanded', 'false');
        });
        if (willOpen) {
          card.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    // 커퓨로 전부 빠진 경우는 배너가 이미 설명하고 있어 중복이다
    $('droppedNote').innerHTML = (p.dropped.length && !(p.curfew && p.curfew.bedtimeNow))
      ? '<p class="tiny">⏸ 오늘 가용 시간으로는 ' + esc(p.dropped.map(function (d) { return d.name; }).join(', ')) +
        ' 까지 배정할 수 없었습니다. 우선순위가 낮아 내일로 미루는 편이 전체 성과에 유리합니다.</p>' : '';

    $('timeline').innerHTML = p.timeline.map(function (b) {
      if (b.kind === 'study') {
        return '<div class="tl study" style="--c:' + b.color + '"><span class="tl-time">' + fmtHour(b.start) + ' – ' + fmtHour(b.end) + '</span>' +
          '<span class="tl-name">' + esc(b.subject) + '<span class="fit">뇌 궁합 ' + b.fit + '%</span></span></div>';
      }
      return '<div class="tl ' + b.kind + '"><span class="tl-time">' + fmtHour(b.start) + ' – ' + fmtHour(b.end) + '</span>' +
        '<span class="tl-name">' + (b.kind === 'longBreak' ? '🌿 긴 휴식' : '☕ 휴식') + ' ' + b.minutes + '분</span></div>';
    }).join('');

    if (p.timeline.length) {
      $('timeline').insertAdjacentHTML('beforeend',
        '<p class="tiny">🏁 예상 종료 ' + fmtHour(p.endHour) + ' · 순공 ' + fmtDur(p.plannedStudyMin) + ' + 휴식 ' + fmtDur(p.plannedBreakMin) +
        '. 같은 과목을 연달아 붙이지 않고 번갈아 배치했습니다(인터리빙). 시간대별 뇌 능력에 맞춰 순서를 조정했습니다.</p>');
    }

    $('restList').innerHTML = p.rest.map(function (r) {
      return '<div class="rest"><div class="ri">' + r.icon + '</div><div><h5>' + esc(r.title) + '</h5><p>' + esc(r.text) + '</p></div></div>';
    }).join('');

    collapsePlanDetail();
  }

  /* 취침 커퓨 안내.
   * 수면을 최대 변수로 쓰는 앱이 "일찍 자라" 고 조언하면서 동시에 새벽까지
   * 타임라인을 깔면 조언 두 개가 정면으로 부딪힌다. 커퓨를 넘긴 시점에는
   * 플랜 대신 취침을 1순위로 내세운다. */
  function renderCurfew(p) {
    var el = $('curfewBanner');
    var c = p.curfew;
    if (!c || (!c.bedtimeNow && !c.cut)) { el.className = 'is-hidden'; el.innerHTML = ''; return; }

    if (c.bedtimeNow) {
      el.className = 'curfew now';
      el.innerHTML =
        '<div class="cf-ic">🛏️</div>' +
        '<div><h4>' + (c.passed ? '지금은 자야 할 시간입니다' : '오늘은 여기까지가 좋습니다') + '</h4>' +
        '<p>' + (c.passed
          ? '목표 취침 ' + fmtHour(c.bedHour) + '을(를) ' + fmtDur(-c.minutesLeft) + ' 넘겼습니다. ' +
            '지금 한 블록을 더 하는 것보다, 자고 일어나 내일 아침에 하는 편이 같은 시간으로 더 많이 남습니다.'
          : '취침까지 ' + fmtDur(c.minutesLeft) + ' 남았습니다. 새 집중 블록을 시작하기엔 짧습니다.') +
        ' 알람을 맞추고 아침에 다시 열어 주세요.</p>' +
        '<p class="tiny">취침 시각을 바꾸려면 <b>[입력] → 수면 리듬 · 학습 시간</b>에서 조정하세요.</p></div>';
      return;
    }

    el.className = 'curfew cut';
    el.innerHTML =
      '<div class="cf-ic">⏳</div>' +
      '<div><h4>취침 시각에 맞춰 잘랐습니다</h4>' +
      '<p>목표 취침 ' + fmtHour(c.bedHour) + ' 기준으로 잠들기 전 ' + c.windDownMin + '분을 비워 두면 ' +
      fmtDur(c.minutesLeft) + '이 남습니다. 가용 시간보다 짧아 이쪽에 맞춰 플랜을 줄였습니다.</p></div>';
  }

  /* 타임라인·휴식 가이드는 계획을 세울 때보다 실제로 돌릴 때 필요한 정보다.
   * 기본은 접어 두고 필요할 때 펼친다. */

  function collapsePlanDetail() {
    if (!$('planDetail')) return;
    $('planDetail').classList.add('is-hidden');
    $('planMore').setAttribute('aria-expanded', 'false');
    $('planMore').querySelector('.rm-txt').textContent = '타임라인 · 휴식 가이드 보기';
  }

  function togglePlanDetail() {
    var open = !$('planDetail').classList.contains('is-hidden');
    if (open) { collapsePlanDetail(); return; }
    $('planDetail').classList.remove('is-hidden');
    $('planMore').setAttribute('aria-expanded', 'true');
    $('planMore').querySelector('.rm-txt').textContent = '타임라인 · 휴식 가이드 접기';
  }

  /* ======================================================= 순공 시간 == */

  /** 집중 구간을 열고 닫으며 실제 흐른 시간만 기록한다 */
  function openSpan(block) {
    state.span = { subject: block.subject, type: block.type, since: Date.now(), cap: block.ms };
    state.lastFlush = Date.now();
  }

  function commitSpan(close) {
    if (!state.span) return;
    var now = Date.now();
    var since = state.span.since;
    var ms = Math.max(0, Math.min(now - since, state.span.cap));
    if (ms > 1000) {
      var end = since + ms;
      var sinceDate = new Date(since);
      // 탭이 백그라운드에서 오래 멈춰 있다 자정을 넘겨 돌아온 경우,
      // 흐른 시간을 자정 기준으로 어제·오늘 몫으로 나눠 기록한다.
      var nextMidnight = new Date(sinceDate.getFullYear(), sinceDate.getMonth(), sinceDate.getDate() + 1).getTime();
      if (end > nextMidnight) {
        StudyLog.add(state.span.subject, state.span.type, (nextMidnight - since) / 60000, sinceDate);
        StudyLog.add(state.span.subject, state.span.type, (end - nextMidnight) / 60000, new Date(nextMidnight));
      } else {
        StudyLog.add(state.span.subject, state.span.type, ms / 60000, sinceDate);
      }
      Group.syncSelf();
      renderLiveTotal();
      if (kidsOn()) renderKids();
    }
    if (close) state.span = null;
    else { state.span.since = now; state.lastFlush = now; }
  }

  function trackStudy(s) {
    var isStudy = s.running && s.block && s.block.kind === 'study' && !s.done;
    if (isStudy) {
      if (!state.span || state.span.subject !== s.block.subject) { commitSpan(true); openSpan(s.block); }
      else if (Date.now() - state.lastFlush > 20000) commitSpan(false); // 중간 저장
    } else if (state.span) {
      commitSpan(true);
    }
  }

  function renderLiveTotal() {
    var todayMin = StudyLog.todayTotal();
    var subs = StudyLog.daySubjects(Store.key());

    $('todayTotal').innerHTML = durHtml(todayMin);

    var p = Store.profile();
    var goal = state.plan ? state.plan.plannedStudyMin : ((p ? p.goal : 25) * 60 / 7);
    var pct = goal > 0 ? Math.min(100, todayMin / goal * 100) : 0;
    $('goalText').textContent = fmtDur(goal) + ' 중 ' + Math.round(pct) + '%';
    $('goalFill').style.width = pct.toFixed(1) + '%';

    $('todayBreakdown').innerHTML = subs.length
      ? subs.map(function (s) { return esc(s.name) + ' ' + fmtDurFine(s.min); }).join(' · ')
      : '아직 기록된 순공 시간이 없습니다.';

    $('recDot').className = 'rec-dot' + (state.span ? ' live' : '');
  }

  /* ------------------------------------------------------------- 타이머 */

  /* ------------------------------------------------- 백그라운드 알림 ---- */

  /** 다른 탭을 보고 있어도 블록이 끝난 걸 알 수 있게 한다 */
  function notify(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (!document.hidden) return;              // 화면을 보고 있으면 토스트로 충분
      if (Notification.permission !== 'granted') return;
      var n = new Notification(title, { body: body, tag: 'neurostudy-block', icon: undefined });
      n.onclick = function () { window.focus(); n.close(); };
    } catch (e) { /* 지원하지 않는 환경은 조용히 무시 */ }
  }

  function askNotifyPermission() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'default') return;
      Notification.requestPermission();
    } catch (e) { /* 무시 */ }
  }

  /* -------------------------------------------------- 백업 (파일 입출력) */

  function exportData() {
    var payload = Store.exportAll();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mindora-backup-' + Store.key() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    Store.markBackedUp();
    renderSettingsPage();
    toast('백업 파일을 내려받았습니다. 인증키는 포함되지 않습니다.');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); }
      catch (e) { toast('JSON 파일을 읽을 수 없습니다.', true); return; }

      var when = obj && obj.exportedAt ? new Date(obj.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
      if (!confirm('백업을 불러오면 지금 기기의 기록·프로필·그룹이 모두 덮어써집니다.\n\n백업 시점: ' + when + '\n\n계속할까요?')) return;

      try {
        var n = Store.importAll(obj);
        toast(n + '개 항목을 복원했습니다. 새로고침합니다.');
        setTimeout(function () { location.reload(); }, 900);
      } catch (e) {
        toast(e.message || '복원에 실패했습니다.', true);
      }
    };
    reader.onerror = function () { toast('파일을 읽지 못했습니다.', true); };
    reader.readAsText(file);
  }

  function initTimer() {
    state.timer = new Pomodoro({
      onTick: function (s) { trackStudy(s); renderTimer(s); syncSound(s); },
      onComplete: function (block) {
        commitSpan(true);
        if ($('soundOn').checked) Pomodoro.beep(block ? block.kind : 'study');
        if (block && block.kind === 'study') Kids.addBlock();
        if (block) {
          var msg = block.kind === 'study'
            ? (kidsOn()
                ? '🎉 ' + block.subject + ' ' + block.minutes + '분 완주! +' + block.minutes + ' XP'
                : '집중 블록 완료 — ' + block.subject)
            : '휴식 종료 — 다시 집중할 시간입니다';
          toast(msg);
          notify(block.kind === 'study' ? '집중 블록 완료' : '휴식 종료', msg);
        }
        renderLiveTotal();
        renderGroup();
        renderLeague();
        if (block && block.kind === 'study') setTimeout(awardKids, 1200);
      },
      onFinishAll: function () {
        commitSpan(true);
        Sound.stop();
        state.lastSoundKey = null;
        setTimeout(renderSoundNow, 320);
        toast(kidsOn() ? '🏁 오늘 계획한 공부를 다 끝냈어요. 정말 대단해요!' : '🎉 오늘의 학습 플랜을 모두 완료했습니다!');
        $('btnStart').textContent = '▶ 시작';
        renderLiveTotal(); renderGroup(); renderLeague(); renderReport();
        setTimeout(awardKids, 1200);
      }
    });

    $('btnStart').addEventListener('click', function () {
      if (!state.timer.queue.length) { toast('먼저 플랜을 생성해 주세요.', true); return; }
      askNotifyPermission();   // 사용자가 직접 누른 시점에만 요청한다
      if (state.timer.index >= state.timer.queue.length) state.timer.reset();
      state.timer.toggle();
    });
    $('btnSkip').addEventListener('click', function () { commitSpan(true); state.timer.skip(); });
    $('btnReset').addEventListener('click', function () {
      commitSpan(true);
      state.timer.reset();
      state.lastSoundKey = null;
      Sound.stop();
      $('btnStart').textContent = '▶ 시작';
      setTimeout(renderSoundNow, 320);
      toast('타이머를 처음으로 되돌렸습니다. (기록된 순공 시간은 그대로 유지됩니다)');
    });

    // 탭을 닫거나 숨길 때 진행 중인 구간을 저장
    window.addEventListener('beforeunload', function () { commitSpan(true); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) commitSpan(false); });
  }

  function renderTimer(s) {
    var C = 2 * Math.PI * 112;
    var dial = $('dialFill');
    dial.style.strokeDasharray = C;

    if (s.done || !s.block) {
      $('phaseLabel').textContent = s.total ? '완료' : '대기 중';
      $('timeLeft').textContent = '00:00';
      $('currentSubject').textContent = s.total ? '모든 블록을 마쳤습니다' : '플랜을 만들면 여기에 표시됩니다';
      dial.style.strokeDashoffset = C;
    } else {
      var isStudy = s.block.kind === 'study';
      var sec = Math.ceil(s.remainingMs / 1000);
      $('timeLeft').textContent = pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
      $('phaseLabel').textContent = isStudy ? '집중' : (s.block.kind === 'longBreak' ? '긴 휴식' : '휴식');
      $('currentSubject').textContent = isStudy
        ? s.block.subject + ' · ' + s.block.minutes + '분 블록'
        : '화면에서 눈을 떼고 몸을 움직이세요';
      dial.style.strokeDashoffset = C * (1 - (s.totalMs ? s.remainingMs / s.totalMs : 0));
      dial.style.stroke = isStudy ? (s.block.color || '#6d4aff') : '#3f6fd1';
    }

    $('btnStart').textContent = s.running ? '⏸ 일시정지' : '▶ 시작';
    $('recDot').className = 'rec-dot' + (state.span ? ' live' : '');

    var studyBlocks = state.timer.queue.filter(function (b) { return b.kind === 'study'; });
    var doneCount = state.timer.queue.slice(0, s.index).filter(function (b) { return b.kind === 'study'; }).length;
    $('progressDots').innerHTML = studyBlocks.map(function (b, i) {
      var cls = i < doneCount ? 'done' : (i === doneCount && !s.done ? 'now' : '');
      return '<span class="pd ' + cls + '" title="' + esc(b.subject) + '"></span>';
    }).join('');

    $('queueList').innerHTML = state.timer.queue.map(function (b, i) {
      var cls = i < s.index ? 'done' : (i === s.index ? 'now' : '');
      var icon = b.kind === 'study' ? '📖' : (b.kind === 'longBreak' ? '🌿' : '☕');
      var editable = state.queueEdit && state.timer.canEdit(i);
      var lim = state.timer.limitFor(i);

      var tail = editable
        ? '<span class="qe">' +
            '<button type="button" class="qe-b" data-qi="' + i + '" data-qd="-5"' +
              (b.minutes <= lim.min ? ' disabled' : '') + ' aria-label="' + esc(b.label) + ' 5분 줄이기">−</button>' +
            '<span class="qe-v">' + b.minutes + '<small>분</small></span>' +
            '<button type="button" class="qe-b" data-qi="' + i + '" data-qd="5"' +
              (b.minutes >= lim.max ? ' disabled' : '') + ' aria-label="' + esc(b.label) + ' 5분 늘리기">＋</button>' +
          '</span>'
        : '<span class="qt">' + b.minutes + '분</span>';

      return '<li class="' + cls + (editable ? ' editable' : '') + '">' +
        '<span class="q-name">' + icon + ' ' + esc(b.label) + '</span>' + tail + '</li>';
    }).join('');

    if (state.queueEdit) {
      $$('#queueList .qe-b').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = +btn.dataset.qi, d = +btn.dataset.qd;
          var cur = state.timer.queue[i];
          if (!cur) return;
          var next = state.timer.setMinutes(i, cur.minutes + d);
          if (next === null) { toast('이미 지났거나 진행 중인 블록은 바꿀 수 없어요.', true); return; }
          // setMinutes 안에서 emit() 이 돌아 목록은 이미 다시 그려졌다.
          // 여기서는 바뀐 길이에 맞춰 목표 시간만 갱신한다.
          renderQueueTotals();
        });
      });
    }
  }

  /** 블록 길이를 바꾸면 목표 시간과 타임라인 표기도 같이 움직여야 한다 */
  function renderQueueTotals() {
    if (state.plan) {
      state.plan.plannedStudyMin = state.timer.studyMinutes();
      state.plan.plannedBreakMin = state.timer.queue.reduce(function (s, b) {
        return s + (b.kind === 'study' ? 0 : b.minutes);
      }, 0);
    }
    renderLiveTotal();
  }

  function toggleQueueEdit() {
    state.queueEdit = !state.queueEdit;
    $('queueEditBtn').textContent = state.queueEdit ? '완료' : '시간 조절';
    $('queueEditBtn').classList.toggle('on', state.queueEdit);
    $('queueEditHint').classList.toggle('is-hidden', !state.queueEdit);
    // renderTimer 는 타이머 상태 스냅숏을 인자로 받는다.
    // emit() 이 그 스냅숏을 만들어 onTick 으로 넘겨 주므로 이걸 쓴다.
    state.timer.emit();
  }

  /* ======================================================== 집중 사운드 == */

  /** 지금 재생해야 할 사운드를 과목 유형 + 오늘 상태로 결정 */
  function soundFor(subjectType) {
    return Sound.recommend(subjectType || 'mixed', state.analysis);
  }

  function currentBlockType() {
    var b = state.timer && state.timer.current();
    return b && b.kind === 'study' ? (b.type || 'mixed') : null;
  }

  function renderSoundNow() {
    var type = currentBlockType();
    var rec = soundFor(type || (state.plan && state.plan.subjects[0] ? state.plan.subjects[0].type : 'mixed'));
    var playing = Sound.currentTrackId();
    var live = playing && playing !== 'off';
    var shown = live ? (Sound.trackById(playing) || rec) : rec;

    $('sndNow').innerHTML =
      '<div class="sn-icon' + (live ? ' on' : '') + '">' + (shown.icon || '🎧') + '</div>' +
      '<div><div class="sn-name">' + esc(shown.name) +
        (live ? '<span class="sn-tag">재생 중</span>' : '') +
        (!live && rec.override ? '<span class="sn-tag auto">상태 맞춤</span>' : '') + '</div>' +
        '<p class="sn-reason">' + esc(live ? (shown.desc || '') : rec.reason) + '</p></div>';

    $('sndToggle').textContent = live ? '■ 정지' : '▶ 재생';
    renderSoundPicker();
  }

  function renderSoundPicker() {
    var cur = Sound.currentTrackId();
    var items = Sound.TRACKS.concat(Sound.customCache().map(function (c) {
      return { id: 'custom:' + c.id, name: c.name, icon: '🎵' };
    }));
    $('sndPicker').innerHTML = items.map(function (t) {
      return '<button type="button" class="snd-chip' + (cur === t.id ? ' on' : '') + '" data-track="' + esc(t.id) + '">' +
        t.icon + ' ' + esc(t.name) + '</button>';
    }).join('');

    $$('#sndPicker .snd-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.track;
        if (id === 'off') { Sound.stop(); toast('사운드를 껐습니다.'); }
        else if (!Sound.play(id)) { toast('이 브라우저에서는 사운드를 재생할 수 없습니다.', true); return; }
        else toast((Sound.trackById(id) || {}).name + ' 재생');
        setTimeout(renderSoundNow, 320);
      });
    });
  }

  function trackOptions(selected, includeOff) {
    var items = (includeOff ? Sound.TRACKS : Sound.TRACKS.filter(function (t) { return t.id !== 'off'; }))
      .concat(Sound.customCache().map(function (c) { return { id: 'custom:' + c.id, name: '🎵 ' + c.name, icon: '' }; }));
    return items.map(function (t) {
      var label = (t.icon ? t.icon + ' ' : '') + t.name;
      return '<option value="' + esc(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function renderSoundSettings() {
    var s = Sound.settings();

    $('sndMap').innerHTML = Object.keys(Sound.TYPE_LABEL).map(function (type) {
      var sel = s.map[type];
      var t = Sound.trackById(sel);
      var warn = (t && t.lyrics && (type === 'reading' || type === 'memorize'))
        ? '<div class="sm-warn">⚠ 가사 있는 음악은 글 읽기·암기와 뇌의 언어 영역이 겹쳐 방해가 됩니다. 가사 없는 소리를 권합니다.</div>' : '';
      return '<div class="sm-row">' +
        '<span class="sm-label">' + esc(Sound.TYPE_LABEL[type]) + '</span>' +
        '<select class="input sm-sel" data-type="' + type + '"' +
          ' aria-label="' + esc(Sound.TYPE_LABEL[type]) + ' 과목에 재생할 사운드">' +
          trackOptions(sel, true) + '</select>' +
        '</div>' + warn;
    }).join('');

    $$('.sm-sel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var st = Sound.settings();
        st.map[sel.dataset.type] = sel.value;
        Sound.saveSettings(st);
        renderSoundSettings();
        renderSoundNow();
        toast(Sound.TYPE_LABEL[sel.dataset.type] + ' → ' + (Sound.trackById(sel.value) || {}).name);
      });
    });

    $('sndBreak').innerHTML = trackOptions(s.breakTrack, true);
    $('sndAuto').checked = s.autoPlay;
    $('sndFollow').checked = s.followState;
    $('sndVol').value = Math.round(s.volume * 100);
    $('sndVol').dispatchEvent(new Event('input'));

    renderCustomList();
  }

  function fileSize(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(bytes / 1024)) + 'KB';
  }

  function renderCustomList() {
    var list = Sound.customCache();
    $('customList').innerHTML = list.length
      ? list.map(function (c) {
          return '<div class="custom-item"><span>🎵</span>' +
            '<span class="cn">' + esc(c.name) + '</span>' +
            '<span class="cs">' + fileSize(c.size) + '</span>' +
            '<button type="button" class="icon-btn snd-del" data-id="' + esc(c.id) + '" title="삭제">✕</button></div>';
        }).join('')
      : '<div class="custom-empty">등록된 음악이 없습니다. 파일을 추가하면 위의 과목별 설정에서 고를 수 있어요.<br>여러 곡을 넣으면 순서대로 이어서 재생됩니다.</div>';

    $$('.snd-del').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = Sound.customCache().filter(function (x) { return x.id === b.dataset.id; })[0];
        if (!c || !confirm('"' + c.name + '" 을(를) 삭제할까요?')) return;
        if (Sound.currentTrackId() === 'custom:' + c.id) Sound.stop();
        Sound.removeCustom(c.id).then(function () {
          // 이 곡을 쓰던 과목 설정은 기본값으로 되돌린다
          var st = Sound.settings(), changed = false;
          Object.keys(st.map).forEach(function (k) {
            if (st.map[k] === 'custom:' + c.id) { st.map[k] = Sound.DEFAULT_MAP[k]; changed = true; }
          });
          if (st.breakTrack === 'custom:' + c.id) { st.breakTrack = 'off'; changed = true; }
          if (changed) Sound.saveSettings(st);
          renderSoundSettings(); renderSoundNow();
          toast('삭제했습니다.');
        });
      });
    });
  }

  function initSound() {
    if (!Sound.supported) {
      $('sndNow').innerHTML = '<div class="sn-icon">🔇</div><div><div class="sn-name">사운드를 쓸 수 없는 브라우저입니다</div>' +
        '<p class="sn-reason">Web Audio 를 지원하는 최신 브라우저에서 열어 주세요.</p></div>';
      $('sndToggle').disabled = true;
      return;
    }

    $('sndToggle').addEventListener('click', function () {
      if (Sound.isPlaying()) { Sound.stop(); setTimeout(renderSoundNow, 300); return; }
      var rec = soundFor(currentBlockType() || (state.plan && state.plan.subjects[0] ? state.plan.subjects[0].type : 'mixed'));
      Sound.play(rec.id);
      setTimeout(renderSoundNow, 320);
    });

    $('sndVol').addEventListener('input', function () { Sound.setVolume(parseInt($('sndVol').value, 10) / 100); });

    $('sndBreak').addEventListener('change', function () {
      var s = Sound.settings(); s.breakTrack = $('sndBreak').value; Sound.saveSettings(s);
    });
    $('sndAuto').addEventListener('change', function () {
      var s = Sound.settings(); s.autoPlay = $('sndAuto').checked; Sound.saveSettings(s);
    });
    $('sndFollow').addEventListener('change', function () {
      var s = Sound.settings(); s.followState = $('sndFollow').checked; Sound.saveSettings(s);
      renderSoundNow();
    });

    $('sndFile').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      if (!files.length) return;
      var okCount = 0;
      files.reduce(function (chain, f) {
        return chain.then(function () {
          return Sound.addCustom(f).then(function () { okCount++; },
            function (err) { toast(err.message || (f.name + ' 추가 실패'), true); });
        });
      }, Promise.resolve()).then(function () {
        e.target.value = '';
        renderSoundSettings(); renderSoundNow();
        if (okCount) toast(okCount + '곡을 추가했습니다. 과목별 설정에서 고를 수 있어요.');
      });
    });

    Sound.listCustom().then(function () { renderSoundSettings(); renderSoundNow(); });
  }

  /** 타이머 상태가 바뀔 때 사운드를 따라가게 한다 */
  function syncSound(s) {
    var set = Sound.settings();
    if (!set.autoPlay || !Sound.supported) return;

    var key = (s.done || !s.block) ? 'none' : (s.block.kind + ':' + (s.block.subject || '') + ':' + (s.running ? 'run' : 'pause'));
    if (key === state.lastSoundKey) return;
    state.lastSoundKey = key;

    if (s.done || !s.block || !s.running) {
      if (!s.running && Sound.isPlaying()) Sound.stop();
      setTimeout(renderSoundNow, 320);
      return;
    }
    if (s.block.kind === 'study') Sound.play(soundFor(s.block.type || 'mixed').id);
    else Sound.play(set.breakTrack);
    setTimeout(renderSoundNow, 340);
  }

  /* ================================================ 입력 부담 줄이기 == */

  /* 매일 바뀌는 항목은 5~8개뿐인데 전에는 15개를 다 만져야 했다.
   * 자주 안 바뀌는 항목은 접어 두고, 지난 입력을 그대로 쓸 수 있게 한다. */

  var DETAIL_IDS = ['water', 'caffeine', 'exercise', 'sleepRegularity', 'availableHours'];

  function toggleDetail(open) {
    var wrap = $('detailToggle').parentElement;
    var body = $('detailBody');
    var willOpen = open === undefined ? body.classList.contains('is-hidden') : open;
    body.classList.toggle('is-hidden', !willOpen);
    wrap.classList.toggle('open', willOpen);
    $('detailToggle').setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    $('detailToggle').querySelector('.ch-icon').textContent = willOpen ? '−' : '＋';
  }

  /** 접힌 영역에 지금 어떤 값이 들어 있는지 한 줄로 보여 준다 */
  function updateDetailSummary() {
    var t = $('detailToggle');
    if (!t) return;
    var span = t.querySelector('.ch-text span');
    span.textContent = '수분 ' + $('water').value + '컵 · 카페인 ' + $('caffeine').value + '잔 · 운동 ' +
      $('exercise').value + '분 · 가용 ' + $('availableHours').value + '시간' +
      ($('bedTime').value ? ' · 취침 ' + $('bedTime').value : '');
  }

  /* 분석을 돌리기 전에도 "취침까지 몇 시간 남았는지" 를 보여 준다.
   * 가용 시간을 6시간으로 잡아 놓고 취침까지 2시간뿐인 상황을 입력 단계에서 알 수 있다. */
  function updateCurfewHint() {
    var el = $('curfewHint');
    if (!el) return;
    var inp = { startHour: 0, bedHour: null };

    var st = $('startTime').value;
    if (st) {
      var p = st.split(':');
      inp.startHour = parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
    } else {
      var now = new Date();
      inp.startHour = now.getHours() + now.getMinutes() / 60;
    }
    var bt = $('bedTime').value;
    if (!bt) { el.textContent = ''; el.className = 'tiny'; return; }
    var q = bt.split(':');
    inp.bedHour = parseInt(q[0], 10) + parseInt(q[1], 10) / 60;

    var left = BrainPlanner.curfewMinutes(inp);
    var want = parseFloat($('availableHours').value) * 60;

    if (left < 0) {
      el.className = 'tiny warn';
      el.textContent = '⚠ 목표 취침 시각을 ' + fmtDur(-left) + ' 넘겼습니다. 오늘은 플랜 대신 취침을 권합니다.';
    } else if (left < want) {
      el.className = 'tiny warn';
      el.textContent = '⚠ 취침까지 ' + fmtDur(left) + '뿐입니다(잠들기 전 30분 제외). 플랜은 이 시간에 맞춰 줄어듭니다.';
    } else {
      el.className = 'tiny';
      el.textContent = '취침까지 ' + fmtDur(left) + ' 사용할 수 있습니다(잠들기 전 30분 제외).';
    }
  }

  function renderQuickNote() {
    var box = $('quickNote');
    var saved = Store.loadInput();
    if (!saved || !saved._date) { box.innerHTML = ''; box.className = ''; return; }

    var today = Store.key();
    var same = saved._date === today;
    var d = Store.parseKey(saved._date);
    var days = Math.round((Store.parseKey(today) - d) / 86400000);
    var when = same ? '오늘' : (days === 1 ? '어제' : days + '일 전');

    box.className = 'quick-note';
    box.innerHTML =
      '<div class="qn-icon">' + (same ? '✅' : '🕘') + '</div>' +
      '<div><div class="qn-title">' + when + ' 입력값을 불러왔습니다</div>' +
      '<div class="qn-sub">수면 <b>' + saved.sleep.hours + '시간</b> · 스트레스 <b>' + saved.stress +
      '</b> · 피로 <b>' + saved.fatigue + '</b> · 가용 <b>' + saved.availableHours + '시간</b><br>' +
      (same ? '오늘 이미 입력한 값입니다. 바뀐 것만 고치고 다시 분석하면 됩니다.'
            : '<b>오늘 컨디션</b>만 고쳐서 바로 분석하세요. 세부 항목은 그대로 둬도 됩니다.') + '</div></div>' +
      '<button type="button" class="btn primary sm" id="quickAnalyze">그대로 분석 →</button>';

    $('quickAnalyze').addEventListener('click', runAnalysis);
  }

  /* ============================================================ 급식 == */

  var MEAL_FIELD = { '조식': 'mealBreakfast', '중식': 'mealLunch', '석식': 'mealDinner' };
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

  function renderMeals() {
    var box = $('mealToday');
    if (!box) return;
    var p = Store.profile();

    /* 나이스는 키가 없어도 급식을 준다. 그래서 더 이상 "연동을 켜라" 고 막지 않는다.
     * 대신 학교를 목록에서 골라야 학교 코드를 알 수 있으므로 그건 그대로 요구한다. */
    if (!p || !p.neis || !p.neis.schoolCode) {
      box.innerHTML = '<div class="meal-empty">급식을 보려면 프로필에서 <b>학교를 검색해 목록에서 선택</b>해 주세요. ' +
        '직접 입력한 이름만으로는 학교를 특정할 수 없습니다. ' +
        '<button type="button" class="btn ghost sm" id="mealGoProfile">학교 다시 고르기</button></div>';
      var b = $('mealGoProfile');
      if (b) b.addEventListener('click', function () { openProfile(true); });
      return;
    }

    box.innerHTML = '<div class="meal-loading">🍱 오늘 급식을 불러오는 중…</div>';

    Neis.todayMeals(p.neis).then(function (list) {
      if (!list.length) {
        box.innerHTML = '<div class="meal-empty">오늘(' + Store.key() + ')은 등록된 급식이 없습니다. ' +
          '주말이거나 방학·재량휴업일일 수 있어요.</div>';
        return;
      }

      box.innerHTML = list.map(function (m) {
        var dishes = m.dishes.map(function (d) {
          var al = d.allergens.length ? '<i title="' + d.allergens.map(function (n) { return Neis.ALLERGENS[n]; }).join(', ') + '">' +
            d.allergens.join('.') + '</i>' : '';
          return '<span class="mc-dish">' + esc(d.name) + al + '</span>';
        }).join('');
        var alSet = {};
        m.dishes.forEach(function (d) { d.allergens.forEach(function (n) { alSet[n] = 1; }); });
        var alNames = Object.keys(alSet).map(function (n) { return n + ' ' + Neis.ALLERGENS[n]; });

        return '<div class="meal-card">' +
          '<div class="mc-head"><span class="mc-type ' + esc(m.type) + '">' + esc(m.type) + '</span>' +
          (m.kcal ? '<span class="mc-kcal">' + esc(m.kcal) + '</span>' : '') + '</div>' +
          '<div class="mc-body"><div class="mc-dishes">' + dishes + '</div>' +
          (alNames.length ? '<p class="mc-note">알레르기 유발 — ' + esc(alNames.join(' · ')) + '</p>' : '') +
          '</div></div>';
      }).join('');

      // 급식이 있는데 그 끼니를 체크하지 않았으면 살짝 알려 준다
      var unchecked = list.filter(function (m) {
        var f = MEAL_FIELD[m.type];
        return f && $(f) && !$(f).checked;
      }).map(function (m) { return m.type; });

      if (unchecked.length) {
        box.insertAdjacentHTML('beforeend',
          '<p class="mc-note">💡 오늘 ' + esc(unchecked.join('·')) + ' 급식이 있습니다. 먹었다면 위에서 체크해 주세요.</p>');
      }
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      box.innerHTML = '<div class="meal-empty">급식을 불러오지 못했습니다 — ' + esc(msg) + '<br>' +
        '<b>인터넷 연결이나 설정의 API 키를 확인해 주세요.</b></div>';
    });
  }

  /* ============================================================ 시간표 == */

  function fillTtGradeOptions(keepValue) {
    var p = Store.profile();
    var level = p ? p.level : $('pfLevel').value;
    var list = Group.GRADES[level] || Group.GRADES['고등학교'];
    $('ttGrade').innerHTML = list.map(function (g) {
      return '<option value="' + esc(g) + '">' + esc(g === '해당 없음' ? g : g + '학년') + '</option>';
    }).join('');
    if (keepValue && list.indexOf(keepValue) >= 0) $('ttGrade').value = keepValue;
  }

  function renderTimetable() {
    var box = $('ttToday');
    if (!box) return;
    var p = Store.profile();
    if (!p) return;

    if (!Neis.hasTimetable(p.level)) {
      box.innerHTML = '<div class="meal-empty">' + esc(p.level) + '은(는) 나이스 시간표 조회를 지원하지 않습니다.</div>';
      return;
    }

    if (!p.neis || !p.neis.schoolCode) {
      box.innerHTML = '<div class="meal-empty">시간표를 보려면 프로필에서 <b>학교를 검색해 목록에서 선택</b>해 주세요. ' +
        '직접 입력한 이름만으로는 학교를 특정할 수 없습니다. ' +
        '<button type="button" class="btn ghost sm" id="ttGoProfile">학교 다시 고르기</button></div>';
      var b = $('ttGoProfile');
      if (b) b.addEventListener('click', function () { openProfile(true); });
      return;
    }

    var grade = $('ttGrade').value || p.grade;
    var klass = $('ttClass').value.trim() || p.klass;
    if (!klass) {
      box.innerHTML = '<div class="meal-empty">반을 입력하면 그 반의 시간표를 볼 수 있습니다. 위에 <b>반</b>을 입력해 주세요.</div>';
      return;
    }

    box.innerHTML = '<div class="meal-loading">🗓️ 이번 주 시간표를 불러오는 중…</div>';

    Neis.weekTimetable(p.neis, grade, klass).then(function (byDate) {
      var dates = Object.keys(byDate).sort();
      if (!dates.length) {
        box.innerHTML = '<div class="meal-empty">이번 주 ' + esc(grade) + '학년 ' + esc(klass) + '반은 등록된 시간표가 없습니다. ' +
          '방학·재량휴업일일 수 있어요.</div>';
        return;
      }

      var todayKey = Store.key();
      box.innerHTML = dates.map(function (d) {
        var list = byDate[d];
        if (!list.length) return '';
        var ymdKey = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
        var dow = DOW_KO[new Date(d.slice(0, 4), d.slice(4, 6) - 1, d.slice(6, 8)).getDay()];
        var label = (d.slice(4, 6).replace(/^0/, '')) + '/' + (d.slice(6, 8).replace(/^0/, '')) + '(' + dow + ')' +
          (ymdKey === todayKey ? ' · 오늘' : '');

        return '<div class="meal-card' + (ymdKey === todayKey ? ' tt-today' : '') + '">' +
          '<div class="mc-head"><span class="mc-type 중식">' + esc(label) + '</span></div>' +
          '<div class="mc-body"><div class="tt-list">' +
          list.map(function (t) {
            return '<div class="tt-row"><span class="tt-period">' + esc(t.period || '') + '교시</span>' +
              '<span class="tt-subject">' + esc(t.subject || '-') + '</span>' +
              (t.classroom ? '<span class="tt-room">' + esc(t.classroom) + '</span>' : '') + '</div>';
          }).join('') + '</div></div></div>';
      }).join('');
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      box.innerHTML = '<div class="meal-empty">시간표를 불러오지 못했습니다 — ' + esc(msg) + '<br>' +
        '<b>인터넷 연결이나 설정의 API 키를 확인해 주세요.</b></div>';
    });
  }

  function initTimetable() {
    fillTtGradeOptions();
    $('ttGrade').addEventListener('change', renderTimetable);
    $('ttClass').addEventListener('change', renderTimetable);
  }

  /* ====================================================== 방학 계획표 == */

  var VP_KEY = 'neurostudy.vacplan.v1';

  /* 귀여운 글씨체는 구글 폰트(무료·상업적 사용 가능)를 쓴다 — index.html <head> 에서 미리 불러온다.
   * family 가 있으면 이미지로 저장하기 전에 그 폰트가 실제로 로드됐는지 기다린다 —
   * 안 그러면 캔버스가 폰트 로드 전에 그려져 기본 서체로 찍히는 경우가 있다. */
  var VP_FONTS = [
    { id: 'sans', label: '기본 고딕 — 깔끔한 기본', family: 'Noto Sans KR', css: "'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif" },
    { id: 'cute4', label: '통통체 — 또렷하고 진한', family: 'Do Hyeon', css: "'Do Hyeon','Malgun Gothic',sans-serif" },
    { id: 'cute2', label: '동글동글체 — 귀여운', family: 'Jua', css: "'Jua','Malgun Gothic',sans-serif" },
    { id: 'cute1', label: '말랑 손글씨 — 손으로 쓴', family: 'Gaegu', css: "'Gaegu','Malgun Gothic',cursive" }
  ];

  /* 머리글(요일 줄) 파스텔톤 8색 */
  var VP_COLORS = ['#ffb3ba', '#ffdfba', '#fdf5ba', '#baffc9', '#bae1ff', '#d0baff', '#ffbae5', '#c4fff0'];

  /* 색 조합(팔레트) — 하나를 고르면 과목 색이 한꺼번에 바뀐다.
   *
   *   head   : 요일 줄 색
   *   colors : 과목에 처음 나온 순서대로 배정되는 칸 색
   *
   * 글자를 #2f2f2f 로 얹으므로 칸 색은 모두 밝게 잡았다.
   *
   * 순서는 많이 쓸 것 같은 순이다 — 맨 앞이 새로 만들 때의 기본값이 된다.
   * 참고한 계획표들도 채도 낮은 쪽이 많아서 무채색·차분한 조합을 앞에 뒀다. */
  var VP_PALETTES = [
    {
      id: 'mono', name: '모노 그레이', head: '#cfd4da',
      colors: ['#f0f1f3', '#e4e7ea', '#eceae7', '#dcdfe2', '#f2efec', '#e8eaec', '#d6d9dc', '#f5f5f5']
    },
    {
      id: 'night', name: '밤하늘', head: '#aab8d8',
      colors: ['#e0e5f2', '#e6e2f0', '#dde6ef', '#e9e9f3', '#d9e2ee', '#e4dfec', '#eef0f6', '#e2e6ea']
    },
    {
      id: 'berrymatcha', name: '딸기 말차', head: '#c3d9a8',
      colors: ['#fbdce2', '#e8f0d8', '#f7c9d3', '#d5e3bd', '#fdf3e7', '#f0dde1', '#dfe9cd', '#f6ece0']
    },
    {
      id: 'peach', name: '피치 크림', head: '#ffb5a7',
      colors: ['#ffe5d9', '#fcd5ce', '#fae1dd', '#ffeadd', '#f8edeb', '#fde2c8', '#f4dcd6', '#f0efeb']
    },
    {
      id: 'milk', name: '딸기 우유', head: '#f8bbd0',
      colors: ['#fde3ec', '#fbe0e0', '#fdeee4', '#f7e2f0', '#f4e6f7', '#fdf0e6', '#f0e4e8', '#f7f1f0']
    },
    {
      id: 'sea', name: '바다 유리', head: '#a7d8de',
      colors: ['#d6f0f2', '#dcecfa', '#e2e8f8', '#d4eae6', '#e6f4f1', '#dde7f0', '#eaf2f8', '#e9e4dc']
    },
    {
      id: 'forest', name: '숲속 아침', head: '#a3c9a8',
      colors: ['#dceccd', '#e8f2dc', '#d6e8d5', '#eef1dd', '#dfe9de', '#e6ecd9', '#f0f2e4', '#e5e0d2']
    },
    {
      id: 'autumn', name: '가을 산책', head: '#e0b1a0',
      colors: ['#f8ddd0', '#fbeacd', '#f0e6c8', '#dfe5d0', '#e9dcd2', '#f5d9d2', '#e3dbc9', '#f6f0e8']
    },
    {
      id: 'spring', name: '봄 소풍', head: '#b7e4c7',
      colors: ['#d8f3dc', '#fdf8dc', '#ffe5d4', '#d7ecfa', '#e8ddf7', '#e4f0d9', '#fde2e4', '#f6f2e7']
    }
  ];

  function vpPalette(id) {
    return VP_PALETTES.filter(function (p) { return p.id === id; })[0] || VP_PALETTES[0];
  }

  function vpFont(id) {
    return VP_FONTS.filter(function (x) { return x.id === id; })[0] || VP_FONTS[0];
  }

  function vpFontCss(id) { return vpFont(id).css; }

  /** 귀여운 폰트를 고른 경우, 이미지를 그리기 전에 실제 로드를 기다린다 */
  function vpEnsureFontLoaded(id) {
    var f = vpFont(id);
    if (!f.family || !document.fonts || !document.fonts.load) return Promise.resolve();
    // 캔버스에서 실제로 쓰는 굵기·크기를 모두 미리 받아 둔다
    return Promise.all([
      document.fonts.load("700 27px '" + f.family + "'"),
      document.fonts.load("700 12.5px '" + f.family + "'"),
      document.fonts.load("600 11.5px '" + f.family + "'")
    ]).catch(function () { /* 폰트 서버에 연결 안 되면 기본 서체로 대체된다 */ });
  }

  /** 07:00~23:00 빈 줄만 만든다.
   *  예시 내용을 채워 두지 않는 이유는, AI 계획표가 먼저 큰 틀을 세우고
   *  사용자가 그 위에서 다듬는 순서이기 때문이다. 남의 계획을 지우는 일부터
   *  시키면 시작 문턱만 높아진다. */
  function vpEmptyRows() {
    var rows = [];
    for (var h = 7; h <= 23; h++) rows.push({ time: pad(h) + ':00', cells: ['', '', '', '', '', '', ''] });
    return rows;
  }

  /** 시간표에 사용자가 쓴 내용이 하나라도 있는지 */
  function vpHasContent(m) {
    return m.rows.some(function (r) {
      return r.cells.some(function (c) { return String(c || '').trim(); });
    });
  }

  function vpDefaultModel() {
    // 프로필에 적어 둔 이름을 그대로 써서 "지민의 계획표" 처럼 만들어 준다
    var p = Store.profile();
    var nick = p && String(p.nick || '').trim();
    return {
      subtitle: '여름방학',
      title: nick ? nick + '의 계획표' : '나의 계획표',
      titleAuto: true,   // 사용자가 제목을 직접 고치면 false 가 된다
      font: 'sans',
      palette: VP_PALETTES[0].id,
      color: VP_PALETTES[0].head,
      days: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'],
      colors: {},
      rows: vpEmptyRows()
    };
  }

  function vpLoad() {
    try {
      var raw = localStorage.getItem(VP_KEY);
      if (!raw) return vpDefaultModel();
      var m = JSON.parse(raw);
      if (!m || !m.rows || !m.days || !m.rows.length || !m.days.length) return vpDefaultModel();
      // 옛 저장본에는 없던 항목들을 채워 준다
      if (typeof m.subtitle !== 'string') m.subtitle = '';
      if (!m.colors || typeof m.colors !== 'object') m.colors = {};
      if (!VP_PALETTES.some(function (p) { return p.id === m.palette; })) m.palette = VP_PALETTES[0].id;
      // 목록에서 사라진 글씨체를 저장해 뒀다면 기본값으로 되돌린다
      if (!VP_FONTS.some(function (f) { return f.id === m.font; })) m.font = VP_FONTS[0].id;
      return m;
    } catch (e) { return vpDefaultModel(); }
  }

  /** 새로 등장한 과목에 지금 팔레트의 색을 차례로 배정한다 (이미 정해진 색은 건드리지 않는다) */
  function vpEnsureColors(m) {
    if (!m.colors) m.colors = {};
    var pal = vpPalette(m.palette).colors;
    var idx = Object.keys(m.colors).length;
    m.rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        var t = String(c || '').trim();
        if (!t || m.colors[t]) return;
        m.colors[t] = pal[idx % pal.length];
        idx++;
      });
    });
  }

  /** 색 조합을 고르면 요일 줄 색과 과목 색을 그 조합으로 전부 다시 칠한다 */
  function vpApplyPalette(id) {
    var m = state.vacplan;
    var p = vpPalette(id);
    m.palette = p.id;
    m.color = p.head;
    m.colors = {};          // 비워 두면 vpEnsureColors 가 새 조합으로 다시 배정한다
    vpEnsureColors(m);
    vpSave();

    renderVpPalettes();
    paintVpSwatches();
    buildVpTable();
    renderVpLegend();
    vpRenderPreview();
  }

  function renderVpPalettes() {
    var wrap = $('vpPalettes');
    if (!wrap) return;
    var m = state.vacplan;

    wrap.innerHTML = VP_PALETTES.map(function (p) {
      var chips = [p.head].concat(p.colors.slice(0, 5)).map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join('');
      return '<button type="button" class="vp-pal' + (p.id === m.palette ? ' on' : '') + '">' +
        '<span class="vp-pal-chips">' + chips + '</span>' +
        '<span class="vp-pal-name">' + esc(p.name) + '</span></button>';
    }).join('');

    $$('.vp-pal', wrap).forEach(function (b, i) {
      b.addEventListener('click', function () { vpApplyPalette(VP_PALETTES[i].id); });
    });
  }

  /** 표에 쓰인 과목을 처음 나온 순서대로 (중복 없이) 모은다 */
  function vpActivities(m) {
    var seen = {}, list = [];
    m.rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        var t = String(c || '').trim();
        if (!t || seen[t]) return;
        seen[t] = true;
        list.push(t);
      });
    });
    return list;
  }

  /**
   * 붙어 있는 같은 내용의 칸을 하나의 큰 블록으로 합친다.
   * 인스타 계획표들이 "국어" 를 세 시간짜리 한 칸으로 그리는 그 모양을 만드는 부분이다.
   * 가로로 먼저 늘리고, 그 폭 그대로 아래로 늘려서 직사각형만 만든다.
   * 빈 칸은 합치지 않는다 — 합쳐 버리면 개별로 채워 넣을 수 없다.
   */
  function vpMergeRects(m) {
    var rows = m.rows;
    var R = rows.length, C = m.days.length;
    var used = [], r, c;
    for (r = 0; r < R; r++) { used.push([]); for (c = 0; c < C; c++) used[r].push(false); }

    var txtAt = function (rr, cc) { return String(rows[rr].cells[cc] || '').trim(); };
    var rects = [];

    for (r = 0; r < R; r++) {
      for (c = 0; c < C; c++) {
        if (used[r][c]) continue;
        var txt = txtAt(r, c);
        if (!txt) { used[r][c] = true; rects.push({ r: r, c: c, rs: 1, cs: 1, text: '' }); continue; }

        var cs = 1;
        while (c + cs < C && !used[r][c + cs] && txtAt(r, c + cs) === txt) cs++;

        var rs = 1, canGrow = true;
        while (canGrow && r + rs < R) {
          for (var k = 0; k < cs; k++) {
            if (used[r + rs][c + k] || txtAt(r + rs, c + k) !== txt) { canGrow = false; break; }
          }
          if (canGrow) rs++;
        }

        for (var a = 0; a < rs; a++) for (var b = 0; b < cs; b++) used[r + a][c + b] = true;
        rects.push({ r: r, c: c, rs: rs, cs: cs, text: txt });
      }
    }
    return rects;
  }

  function vpSave() {
    try { localStorage.setItem(VP_KEY, JSON.stringify(state.vacplan)); } catch (e) { /* 무시 */ }
  }

  function vpHexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 109, g: 74, b: 255 };
  }

  function vpContrast(hex) {
    var c = vpHexToRgb(hex);
    var lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    return lum > 150 ? '#141414' : '#ffffff';
  }

  function vpTint(hex, alpha) {
    var c = vpHexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  function buildVpTable() {
    var table = $('vpTable');
    if (!table) return;
    var m = state.vacplan;
    var acc = m.color || '#6d4aff';
    var fg = vpContrast(acc);
    var tint = vpTint(acc, 0.12);

    table.innerHTML =
      '<thead><tr><th class="vp-corner"></th>' +
      m.days.map(function (d, i) {
        return '<th class="vp-day" data-day="' + i + '" contenteditable="true" spellcheck="false"></th>';
      }).join('') + '<th class="vp-corner"></th></tr></thead>' +
      '<tbody>' + m.rows.map(function (r, ri) {
        return '<tr data-row="' + ri + '">' +
          '<td class="vp-time" contenteditable="true" spellcheck="false"></td>' +
          r.cells.map(function (c, ci) {
            return '<td class="vp-cell" data-col="' + ci + '" contenteditable="true" spellcheck="false"></td>';
          }).join('') +
          // 시간대는 시각 순서대로 이어지는 목록이라 중간을 빼면 표에 구멍이 생긴다.
          // 그래서 지우는 건 맨 끝에서만 — 칸 자체는 남겨 둬야 열이 어긋나지 않는다.
          '<td class="vp-rowdel">' +
            (ri === m.rows.length - 1
              ? '<button type="button" class="vp-del" data-row="' + ri + '" title="마지막 시간대 삭제">✕</button>'
              : '') +
          '</td></tr>';
      }).join('') + '</tbody>';

    $$('.vp-day', table).forEach(function (th, i) {
      th.textContent = m.days[i] || '';
      th.style.background = acc;
      th.style.color = fg;
      th.addEventListener('input', function () { m.days[i] = th.textContent.trim(); vpSave(); });
    });
    $$('.vp-time', table).forEach(function (td, i) {
      td.textContent = m.rows[i].time || '';
      td.style.background = tint;
      td.addEventListener('input', function () { m.rows[i].time = td.textContent.trim(); vpSave(); });
    });
    vpEnsureColors(m);
    $$('.vp-cell', table).forEach(function (td) {
      var tr = td.closest('tr'); var ri = parseInt(tr.dataset.row, 10);
      var ci = parseInt(td.dataset.col, 10);
      var val = m.rows[ri].cells[ci] || '';
      td.textContent = val;
      td.style.background = val ? (m.colors[val.trim()] || '#ffffff') : '#ffffff';
      td.addEventListener('input', function () {
        m.rows[ri].cells[ci] = td.textContent.trim();
        vpSave();
        vpRefresh();
      });
    });
    $$('.vp-del', table).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (m.rows.length <= 1) { toast('시간대는 최소 1개가 필요합니다.', true); return; }
        var row = m.rows[parseInt(btn.dataset.row, 10)];
        var label = row && row.time ? row.time + ' 시간대' : '이 시간대';
        if (!confirm(label + '를 삭제할까요? 되돌릴 수 없습니다.')) return;
        m.rows.splice(parseInt(btn.dataset.row, 10), 1);
        vpSave();
        buildVpTable();
        vpRenderPreview();
        renderVpLegend();
      });
    });

    table.style.fontFamily = vpFontCss(m.font);
    table.style.setProperty('--vp-accent', acc);
  }

  /* 칸을 고칠 때마다 표 전체를 다시 만들면 입력 중 커서가 튄다.
   * 그래서 편집 중에는 미리보기와 색상 목록만 다시 그린다. */
  var vpRefreshTimer = null;
  function vpRefresh() {
    clearTimeout(vpRefreshTimer);
    vpRefreshTimer = setTimeout(function () {
      vpRenderPreview();
      renderVpLegend();
    }, 260);
  }

  function renderVpLegend() {
    var wrap = $('vpLegend');
    if (!wrap) return;
    var m = state.vacplan;
    vpEnsureColors(m);
    var list = vpActivities(m);

    if (!list.length) {
      wrap.innerHTML = '<p class="tiny" style="margin:0">칸을 채우면 과목별 색상을 여기서 고를 수 있습니다.</p>';
      return;
    }

    wrap.innerHTML = list.map(function (t) {
      return '<span class="vp-lg"><input type="color" value="' + esc(m.colors[t]) + '" aria-label="' + esc(t) + ' 색상 고르기">' +
        '<button type="button" class="vp-lg-name">' + esc(t) + '</button></span>';
    }).join('');

    // 과목 이름을 속성에 넣으면 따옴표·꺾쇠 때문에 깨질 수 있어 순서(index)로 잇는다
    $$('.vp-lg', wrap).forEach(function (row, i) {
      var name = list[i];
      row.querySelector('input[type="color"]').addEventListener('input', function (e) {
        m.colors[name] = e.target.value;
        vpSave();
        buildVpTable();
        vpRenderPreview();
      });
      row.querySelector('.vp-lg-name').addEventListener('click', function () {
        var next = prompt('과목명을 바꿉니다. 이 이름이 들어간 모든 칸이 함께 바뀝니다.', name);
        if (next === null) return;
        next = next.trim();
        if (!next || next === name) return;
        vpRenameActivity(name, next);
      });
    });
  }

  /** 과목별 색상 목록에서 이름을 바꾸면, 시간표 안의 같은 이름을 쓰는 모든 칸을 한 번에 바꾼다 */
  function vpRenameActivity(oldName, newName) {
    var m = state.vacplan;
    m.rows.forEach(function (r) {
      r.cells = r.cells.map(function (c) { return c === oldName ? newName : c; });
    });
    if (m.colors[oldName] && !m.colors[newName]) m.colors[newName] = m.colors[oldName];
    delete m.colors[oldName];
    vpSave();
    buildVpTable();
    renderVpLegend();
    vpRenderPreview();
    toast('"' + oldName + '"을(를) "' + newName + '"(으)로 모두 바꿨습니다.');
  }

  function paintVpSwatches() {
    var wrap = $('vpSwatches');
    if (!wrap) return;
    var m = state.vacplan;
    wrap.innerHTML = VP_COLORS.map(function (c) {
      return '<button type="button" class="vp-swatch' + (c === m.color ? ' on' : '') + '" style="background:' +
        c + '" data-c="' + c + '" title="' + c + '" aria-label="' + c + '"></button>';
    }).join('') +
      '<input type="color" id="vpColorCustom" class="vp-swatch vp-swatch-custom" value="' + (m.color || '#6d4aff') + '" title="직접 선택">';

    $$('.vp-swatch[data-c]', wrap).forEach(function (b) {
      b.addEventListener('click', function () {
        m.color = b.dataset.c;
        vpSave();
        paintVpSwatches();
        buildVpTable();
        vpRenderPreview();
      });
    });
    $('vpColorCustom').addEventListener('input', function () {
      m.color = this.value;
      vpSave();
      buildVpTable();
      vpRenderPreview();
      $$('.vp-swatch[data-c]', wrap).forEach(function (b) { b.classList.toggle('on', b.dataset.c === m.color); });
    });
  }

  /** 칸 안에 가운데 정렬로 줄바꿈해 그린다. 넘치면 마지막 줄을 말줄임 처리한다. */
  function vpWrapText(ctx, text, cx, cy, maxWidth, lineHeight, maxLines) {
    if (!text) return;
    var limit = maxLines || 3;
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';

    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > maxWidth) { lines.push(cur); cur = w; }
      else { cur = test; }
      while (ctx.measureText(cur).width > maxWidth && cur.length > 1) {
        var i = cur.length - 1;
        while (i > 1 && ctx.measureText(cur.slice(0, i)).width > maxWidth) i--;
        lines.push(cur.slice(0, i));
        cur = cur.slice(i);
      }
    });
    if (cur) lines.push(cur);

    if (lines.length > limit) {
      lines = lines.slice(0, limit);
      var last = lines[limit - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[limit - 1] = last + '…';
    }

    var startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach(function (l, i) { ctx.fillText(l, cx, startY + i * lineHeight); });
  }

  /**
   * 계획표를 캔버스에 그린다. 화면 미리보기와 저장되는 이미지가 같은 함수를 쓰므로
   * 미리보기에 보이는 그대로가 파일로 나간다.
   */
  function vpDraw(canvas) {
    var m = state.vacplan;
    vpEnsureColors(m);

    var acc = m.color || VP_COLORS[4];
    var fontCss = vpFontCss(m.font);
    var days = m.days, rows = m.rows;

    var leftW = 76, colW = 112, rowH = 30, headH = 32;
    var padX = 26, padTop = 20, padBottom = 26, gap = 14;
    var sub = String(m.subtitle || '').trim();
    var subH = sub ? 22 : 0;
    var titleH = 40;

    var gridW = leftW + days.length * colW;
    var gridH = headH + rows.length * rowH;
    var W = padX * 2 + gridW;
    var H = padTop + subH + titleH + gap + gridH + padBottom;

    var dpr = 2;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    /* 머리말 — 작은 부제 위, 큰 제목 아래 */
    if (sub) {
      ctx.fillStyle = '#8a8a8a';
      ctx.font = '700 14px ' + fontCss;
      ctx.fillText(sub, W / 2, padTop + subH / 2);
    }
    ctx.fillStyle = '#1a1a1a';
    ctx.font = '700 27px ' + fontCss;
    ctx.fillText(String(m.title || '일일 계획표'), W / 2, padTop + subH + titleH / 2);

    var gx = padX, gy = padTop + subH + titleH + gap;

    /* 요일 머리줄 */
    ctx.fillStyle = acc;
    ctx.fillRect(gx, gy, gridW, headH);
    ctx.fillStyle = vpContrast(acc);
    ctx.font = '700 12.5px ' + fontCss;
    days.forEach(function (d, i) {
      vpWrapText(ctx, d, gx + leftW + i * colW + colW / 2, gy + headH / 2, colW - 8, 13, 1);
    });
    ctx.fillStyle = vpContrast(acc);
    ctx.font = '700 12.5px ' + fontCss;
    ctx.fillText('시간', gx + leftW / 2, gy + headH / 2);

    /* 시간 열 */
    var bodyTop = gy + headH;
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(gx, bodyTop, leftW, rows.length * rowH);
    ctx.fillStyle = '#4a4a4a';
    ctx.font = '600 11.5px ' + fontCss;
    rows.forEach(function (r, ri) {
      vpWrapText(ctx, r.time || '', gx + leftW / 2, bodyTop + ri * rowH + rowH / 2, leftW - 8, 12, 2);
    });

    /* 본문 — 붙어 있는 같은 내용은 하나의 블록으로 */
    var rects = vpMergeRects(m);
    rects.forEach(function (rc) {
      var x = gx + leftW + rc.c * colW;
      var y = bodyTop + rc.r * rowH;
      var w = rc.cs * colW, h = rc.rs * rowH;

      ctx.fillStyle = rc.text ? (m.colors[rc.text] || '#ffffff') : '#ffffff';
      ctx.fillRect(x, y, w, h);

      if (rc.text) {
        ctx.fillStyle = '#2f2f2f';
        ctx.font = '600 11.5px ' + fontCss;
        vpWrapText(ctx, rc.text, x + w / 2, y + h / 2, w - 10, 13, Math.max(1, Math.floor(h / 13)));
      }
    });

    /* 격자 — 합쳐진 블록은 테두리를 그리지 않아 하나로 보인다 */
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 1;
    var line = function (x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
      ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
      ctx.stroke();
    };

    rects.forEach(function (rc) {
      var x = gx + leftW + rc.c * colW;
      var y = bodyTop + rc.r * rowH;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, rc.cs * colW, rc.rs * rowH);
    });
    rows.forEach(function (r, ri) {
      line(gx, bodyTop + ri * rowH, gx + leftW, bodyTop + ri * rowH);
    });
    line(gx, bodyTop + rows.length * rowH, gx + leftW, bodyTop + rows.length * rowH);
    line(gx + leftW, gy, gx + leftW, bodyTop + rows.length * rowH);
    days.forEach(function (d, i) {
      var x = gx + leftW + (i + 1) * colW;
      line(x, gy, x, gy + headH);
    });

    /* 바깥 테두리 */
    ctx.strokeStyle = '#9a9a9a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, gy, gridW, gridH);

    return canvas;
  }

  function vpRenderPreview() {
    var canvas = $('vpPreview');
    if (!canvas) return;
    vpDraw(canvas);
  }

  function exportVacPlanImage() {
    var btn = $('vpDownload');
    if (btn) { btn.disabled = true; btn.textContent = '이미지 준비 중…'; }

    vpEnsureFontLoaded(state.vacplan.font).then(function () {
      var canvas = vpDraw($('vpPreview') || document.createElement('canvas'));
      var m = state.vacplan;
      var name = [String(m.subtitle || '').trim(), String(m.title || '계획표').trim()]
        .filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, '').trim() || '계획표';

      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = name + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();

      toast('이미지로 저장했습니다.');
      if (btn) { btn.disabled = false; btn.textContent = '🖼️ 이미지로 저장'; }
    });
  }

  /* ------------------------------------------------------- AI 계획표 자동 채우기 */

  /* 요일 칩은 시간표의 열과 1:1로 맞아야 하므로 열 이름에서 직접 만든다.
   * 사용자가 요일 이름을 고쳐 뒀다면 칩도 그 이름을 따라간다. */
  var VP_DAY_SHORT = ['월', '화', '수', '목', '금', '토', '일'];

  function vpDayShort(i) {
    var d = String((state.vacplan && state.vacplan.days && state.vacplan.days[i]) || '').trim();
    return d ? d.slice(0, 1) : (VP_DAY_SHORT[i] || String(i + 1));
  }

  function addVpAiAcademyRow(data) {
    var row = $('vpAiAcademyRowTpl').content.cloneNode(true).querySelector('.vpai-academy-row');
    var picked = (data && data.days) || [0, 1, 2, 3, 4];   // 기본은 평일
    row.querySelector('.va-days').innerHTML = state.vacplan.days.map(function (d, i) {
      return '<label class="va-day"><input type="checkbox"' + (picked.indexOf(i) >= 0 ? ' checked' : '') +
        ' aria-label="' + esc(d) + '"><span>' + esc(vpDayShort(i)) + '</span></label>';
    }).join('');
    if (data) {
      row.querySelector('.va-name').value = data.name || '';
      row.querySelector('.va-start').value = data.start || '';
      row.querySelector('.va-end').value = data.end || '';
    }
    row.querySelector('.va-del').addEventListener('click', function () { row.remove(); });
    $('vpAiAcademyList').appendChild(row);
    return row;
  }

  /** "HH:MM" → 시(소수). 못 읽으면 fallback */
  function vpAiParseTime(str, fallback) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (!m) return fallback;
    var h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    return h + parseInt(m[2], 10) / 60;
  }

  function addVpAiSubjectRow(data) {
    var row = $('vpAiSubjectRowTpl').content.cloneNode(true).querySelector('.vpai-subject-row');
    if (data) {
      row.querySelector('.vs-name').value = data.name || '';
      row.querySelector('.vs-hours').value = String(data.hours || 5);
    }
    row.querySelector('.vs-del').addEventListener('click', function () {
      row.remove();
      renderVpAiSubjectTotal();
    });
    $('vpAiSubjectList').appendChild(row);
    renderVpAiSubjectTotal();
    return row;
  }

  function vpAiReadSubjects() {
    return $$('.vpai-subject-row').map(function (row) {
      var name = row.querySelector('.vs-name').value.trim();
      var hours = Math.max(0, Math.min(80, parseInt(row.querySelector('.vs-hours').value, 10) || 0));
      if (!name || !hours) return null;
      return { name: name, hours: hours };
    }).filter(Boolean);
  }

  function renderVpAiSubjectTotal() {
    var el = $('vpAiSubjectTotal');
    if (!el) return;
    var total = vpAiReadSubjects().reduce(function (a, s) { return a + s.hours; }, 0);
    el.innerHTML = total
      ? '주간 목표 합계 <b>' + total + '시간</b>. 빈 시간이 남으면 자유 시간으로 두고, 모자라면 비율대로 줄여서 넣습니다.'
      : '과목과 시간을 넣으면 고정 일정을 뺀 자리에 그만큼 배정합니다.';
  }

  /** 주간 목표 시간을 실제로 남은 칸 수(capacity)에 맞춰 확정한다.
   *
   *  요청이 넘치면 비율대로 줄이되 최대잔여법으로 합을 정확히 맞추고,
   *  모자라면 남은 만큼을 '자유 시간' 으로 만들어 같은 저울에 올린다.
   *  자유 시간을 따로 빼 두지 않고 함께 섞어야 특정 요일만 통째로 비지 않는다. */
  function vpAiAllocate(subjects, capacity) {
    var pool = subjects.map(function (s) { return { name: s.name, slots: s.hours }; });
    var want = pool.reduce(function (a, p) { return a + p.slots; }, 0);
    if (!pool.length || capacity <= 0) return { pool: [], want: want, capacity: capacity, scaled: false };

    if (want > capacity) {
      var exact = pool.map(function (p) { return p.slots / want * capacity; });
      var base = exact.map(function (v) { return Math.floor(v); });
      var used = base.reduce(function (a, b) { return a + b; }, 0);
      var rem = exact.map(function (v, i) { return { i: i, f: v - base[i] }; })
                     .sort(function (a, b) { return b.f - a.f; });
      for (var k = 0; used < capacity; k++, used++) base[rem[k % rem.length].i]++;
      pool.forEach(function (p, i) { p.slots = base[i]; });
    } else if (want < capacity) {
      pool.push({ name: '자유 시간', slots: capacity - want });
    }
    return {
      pool: pool.filter(function (p) { return p.slots > 0; }),
      want: want, capacity: capacity, scaled: want > capacity
    };
  }

  /** 기상~취침을 뺀 나머지 = 실제로 잘 수 있는 시간 */
  function vpAiSleepHours() {
    var wake = vpAiParseTime($('vpAiWake').value, 7);
    var bed = vpAiParseTime($('vpAiSleep').value, 23);
    var h = ((wake - bed) % 24 + 24) % 24;
    return h === 0 ? 24 : h;
  }

  /** 목표 등급 상승폭과 실제 수면 시간으로 "몇 시간 공부하고 한 시간 쉴지" 를 정한다.
   *
   *  올리려는 폭이 클수록 휴식을 줄이지만, 잠이 모자라면 다시 늘린다.
   *  수면이 부족한 상태로 몰아붙이는 계획은 어차피 지켜지지 않고,
   *  이 앱이 수면을 가장 큰 변수로 쓰는 이상 계획표만 예외일 수는 없다. */
  function vpAiRestPlan() {
    var now = parseInt($('vpAiGradeNow').value, 10) || 4;
    var goal = parseInt($('vpAiGradeGoal').value, 10) || 2;
    var gap = Math.max(0, now - goal);
    var sleepH = vpAiSleepHours();

    var run = gap >= 4 ? 4 : (gap >= 2 ? 3 : 2);
    var why = gap >= 4 ? '등급을 ' + gap + '단계 올리는 목표라 휴식을 최소로 줄였습니다'
            : gap >= 2 ? '등급을 ' + gap + '단계 올리는 목표라 휴식을 한 칸 줄였습니다'
            : gap === 1 ? '한 단계 목표라 표준 리듬으로 잡았습니다'
            : '지금 등급을 지키는 목표라 표준 리듬으로 잡았습니다';

    // 수면은 목표보다 세게 잡는다. 잠이 모자란 채로 몰아붙이는 계획은 지켜지지 않는다.
    // 반대로 늘려 주는 쪽은 9시간부터 — 8시간은 넉넉한 게 아니라 정상이라 기준이 될 수 없다.
    if (sleepH < 6) {
      run = Math.max(2, run - 1);
      why += '. 다만 잘 수 있는 시간이 ' + fmtDur(sleepH * 60) + '뿐이라 휴식을 되돌렸습니다';
    } else if (sleepH >= 9 && gap >= 2) {
      run += 1;
      why += '. 수면 ' + fmtDur(sleepH * 60) + '으로 넉넉해 더 몰아서 배치했습니다';
    }

    // 식사가 이미 하루를 3~4칸씩 토막 내 놓기 때문에, 4시간을 넘겨 잡으면
    // 어차피 연속 공부가 그만큼 이어지지 않아 계획이 더 빡세지지도 않는다.
    // 숫자만 커지고 결과가 같은 구간을 만들지 않으려고 여기서 끊는다.
    run = Math.min(4, Math.max(2, run));
    return { run: run, why: why, sleepH: sleepH, gap: gap };
  }

  function renderVpAiIntensity() {
    var el = $('vpAiIntensity');
    if (!el) return;
    if (!$('vpAiAutoRest').checked) {
      el.innerHTML = '휴식 자동 배치를 껐습니다. 고정 일정을 뺀 시간을 모두 공부로 채웁니다.';
      return;
    }
    var p = vpAiRestPlan();
    var tail = p.run >= 4
      // 식사로 이미 끊기는 하루라, 4시간 기준에서는 쉬는 칸이 거의 안 생긴다.
      // 그걸 숨기면 "휴식을 켰는데 왜 없냐" 는 말이 나온다.
      ? ' 이 강도에서는 쉬는 칸이 거의 생기지 않고, 식사 시간이 사실상 유일한 휴식이 됩니다.'
      : '';
    el.innerHTML = '잘 수 있는 시간 <b>' + fmtDur(p.sleepH * 60) + '</b> · 목표 <b>' +
      (p.gap ? p.gap + '단계 상승' : '현상 유지') + '</b> → <b>' + p.run +
      '시간 공부마다 1시간 휴식</b>으로 배치합니다. ' + p.why + '.' + tail;
  }

  /** 기상·취침·식사·학원 시간을 입력받아 시간표 칸을 자동으로 채운다.
   *  나머지 빈 칸은 입력한 과목을 돌아가며 채우고, 켜져 있으면 2시간마다 휴식을 끼워 넣는다. */
  function vpAiGenerate() {
    var wake = vpAiParseTime($('vpAiWake').value, 7);
    var sleepRaw = vpAiParseTime($('vpAiSleep').value, 23);
    var sleep = sleepRaw <= wake ? sleepRaw + 24 : sleepRaw;

    // 취침 시각 자체가 마지막 줄이 된다. 23:00 취침이면 23:00 칸에 '취침' 이 적혀야
    // 사용자가 입력한 시각과 계획표가 어긋나지 않는다.
    var startH = Math.floor(wake);
    var bedH = Math.floor(sleep);
    if (bedH - startH < 1) { toast('기상 시각과 취침 시각을 확인해 주세요.', true); return; }
    if (bedH - startH > 22) { toast('기상~취침 시간이 너무 깁니다. 시각을 확인해 주세요.', true); return; }

    var meals = [];
    if ($('vpAiBreakfastOn').checked) meals.push({ name: '아침식사', hour: Math.floor(vpAiParseTime($('vpAiBreakfastTime').value, 8)) });
    if ($('vpAiLunchOn').checked) meals.push({ name: '점심식사', hour: Math.floor(vpAiParseTime($('vpAiLunchTime').value, 12)) });
    if ($('vpAiDinnerOn').checked) meals.push({ name: '저녁식사', hour: Math.floor(vpAiParseTime($('vpAiDinnerTime').value, 18)) });

    var academies = $$('.vpai-academy-row').map(function (row) {
      var name = row.querySelector('.va-name').value.trim();
      var s = row.querySelector('.va-start').value;
      var e = row.querySelector('.va-end').value;
      if (!name || !s || !e) return null;
      var sh = vpAiParseTime(s, null), eh = vpAiParseTime(e, null);
      if (sh === null || eh === null || eh <= sh) return null;
      var cols = [];
      $$('.va-day input', row).forEach(function (cb, i) { if (cb.checked) cols.push(i); });
      if (!cols.length) return null;   // 요일을 하나도 안 고르면 없는 일정으로 본다
      return { name: name, startHour: Math.floor(sh), endHour: Math.ceil(eh), cols: cols };
    }).filter(Boolean);

    var subjects = vpAiReadSubjects();
    var autoRest = $('vpAiAutoRest').checked;
    var restPlan = vpAiRestPlan();

    // 빈 표라면 지울 것이 없으니 굳이 되묻지 않는다
    if (vpHasContent(state.vacplan) &&
        !confirm('지금 시간표 내용을 지우고 AI로 새로 세울까요? 되돌릴 수 없습니다.')) return;

    var days = state.vacplan.days;
    var hours = [];
    for (var h = startH; h <= bedH; h++) hours.push(h);
    var grid = hours.map(function () { return days.map(function () { return ''; }); });

    function setCell(hourAbs, col, text) {
      var idx = hourAbs - startH;
      if (idx >= 0 && idx < grid.length) grid[idx][col] = text;
    }

    // 기상 / 취침
    for (var c = 0; c < days.length; c++) {
      setCell(startH, c, '기상');
      setCell(bedH, c, '취침');
    }

    // 식사 (기상 시각과 겹치면 합쳐서 적는다)
    meals.forEach(function (meal) {
      var hourAbs = meal.hour < startH ? meal.hour + 24 : meal.hour;
      var idx = hourAbs - startH;
      var merged = (idx >= 0 && idx < grid.length && grid[idx][0] === '기상') ? '기상 및 ' + meal.name : meal.name;
      for (var c2 = 0; c2 < days.length; c2++) setCell(hourAbs, c2, merged);
    });

    // 학원 · 과외 (식사보다 우선해서 그 위에 덮어쓴다)
    academies.forEach(function (ac) {
      var s2 = ac.startHour < startH ? ac.startHour + 24 : ac.startHour;
      var e2 = ac.endHour <= s2 ? ac.endHour + 24 : ac.endHour;
      for (var hh = s2; hh < e2; hh++) {
        ac.cols.forEach(function (col) { setCell(hh, col, ac.name); });
      }
    });

    /* 남는 칸을 과목별 "부족한 정도" 에 비례해 나눠 준다.
     *
     * 부드러운 가중 라운드로빈(각 칸마다 가중치만큼 저울에 얹고, 가장 무거운
     * 과목을 뽑은 뒤 총합만큼 덜어 낸다). 단순히 순서대로 돌리면 5점짜리와
     * 1점짜리가 같은 시간을 가져가고, 몫을 미리 세어 한 과목씩 몰아 넣으면
     * 하루가 통째로 한 과목이 된다. 이 방식은 비율을 지키면서도 과목이
     * 고르게 흩어진다.
     *
     * 저울은 주 전체에서 한 번만 초기화한다(열마다 새로 시작하지 않는다).
     * 그래야 주간 목표 비율이 정확히 맞는다 — 대신 매일 아침 첫 칸이
     * 항상 같은 과목은 아니고 요일마다 돌아가며 바뀐다. */
    /* 1) 먼저 어느 칸이 휴식인지 정한다. 휴식은 과목과 무관하게 연속 공부 시간만으로
     *    결정되므로 미리 계산할 수 있고, 그래야 "실제로 공부에 쓸 수 있는 칸" 이
     *    몇 개인지 세어 주간 목표 시간과 맞출 수 있다. */
    var studySlots = [];
    for (var col = 0; col < days.length; col++) {
      var streak = 0;
      for (var r = 0; r < grid.length; r++) {
        if (grid[r][col]) { streak = 0; continue; }          // 고정 일정은 연속 공부를 끊어 준다
        if (autoRest && streak >= restPlan.run) { grid[r][col] = '휴식'; streak = 0; continue; }
        studySlots.push([r, col]);
        streak++;
      }
    }

    // 2) 주간 목표 시간을 남은 칸 수에 맞춰 확정한다
    var alloc = vpAiAllocate(subjects, studySlots.length);

    /* 3) 부드러운 가중 라운드로빈으로 흩뿌린다.
     *    몫을 세어 한 과목씩 몰아 넣으면 하루가 통째로 한 과목이 되고,
     *    단순 순환은 시간 비율을 못 지킨다. 이 방식은 둘 다 피한다. */
    var totalW = alloc.pool.reduce(function (a, p) { return a + p.slots; }, 0) || 1;
    var credit = alloc.pool.map(function () { return 0; });
    var left = alloc.pool.map(function (p) { return p.slots; });

    studySlots.forEach(function (pos) {
      var i, best = -1;
      for (i = 0; i < alloc.pool.length; i++) if (left[i] > 0) credit[i] += alloc.pool[i].slots;
      for (i = 0; i < alloc.pool.length; i++) {
        if (left[i] <= 0) continue;
        if (best < 0 || credit[i] > credit[best]) best = i;
      }
      // 과목을 하나도 안 넣었을 때만 여기로 온다
      if (best < 0) { grid[pos[0]][pos[1]] = '자기주도학습'; return; }
      credit[best] -= totalW;
      left[best]--;
      grid[pos[0]][pos[1]] = alloc.pool[best].name;
    });

    state.vacplan.rows = hours.map(function (h2, i) {
      return { time: pad(h2 % 24) + ':00', cells: grid[i] };
    });
    state.vacplan.colors = {};   // 과목 구성이 바뀌었을 수 있으니 색은 새로 배정한다
    vpSave();
    renderVacPlanPage();

    if (alloc.scaled) {
      toast('목표 ' + alloc.want + '시간이 남는 ' + alloc.capacity + '시간을 넘어 비율대로 줄였습니다.', true);
    } else if (alloc.want && alloc.want < alloc.capacity) {
      toast('주 ' + alloc.want + '시간을 배치하고 남은 ' + (alloc.capacity - alloc.want) + '시간은 자유 시간으로 두었습니다.');
    } else {
      toast('큰 틀을 세웠습니다. 이제 칸을 눌러 자유롭게 다듬으세요.');
    }
  }

  function renderVacPlanPage() {
    var m = state.vacplan;
    $('vpTitle').value = m.title || '';
    $('vpSubtitle').value = m.subtitle || '';
    $('vpFont').value = m.font;
    renderVpPalettes();
    paintVpSwatches();
    buildVpTable();
    renderVpLegend();
    vpRenderPreview();
  }

  function initVacPlan() {
    state.vacplan = vpLoad();

    $('vpFont').innerHTML = VP_FONTS.map(function (f) {
      return '<option value="' + f.id + '">' + esc(f.label) + '</option>';
    }).join('');

    $('vpTitle').addEventListener('input', function () {
      state.vacplan.title = $('vpTitle').value;
      state.vacplan.titleAuto = false;   // 직접 고쳤으니 이름이 바뀌어도 건드리지 않는다
      vpSave();
      vpRefresh();
    });
    $('vpSubtitle').addEventListener('input', function () {
      state.vacplan.subtitle = $('vpSubtitle').value;
      vpSave();
      vpRefresh();
    });
    $('vpFont').addEventListener('change', function () {
      state.vacplan.font = $('vpFont').value;
      vpSave();
      buildVpTable();
      // 웹폰트는 처음 고를 때 아직 안 받아졌을 수 있어 로드를 기다린 뒤 다시 그린다
      vpEnsureFontLoaded(state.vacplan.font).then(vpRenderPreview);
    });
    $('vpAddRow').addEventListener('click', function () {
      state.vacplan.rows.push({ time: '', cells: state.vacplan.days.map(function () { return ''; }) });
      vpSave();
      buildVpTable();
      vpRenderPreview();
    });
    var gradeOpts = '';
    for (var g = 1; g <= 9; g++) gradeOpts += '<option value="' + g + '">' + g + '등급</option>';
    $('vpAiGradeNow').innerHTML = gradeOpts;
    $('vpAiGradeGoal').innerHTML = gradeOpts;
    $('vpAiGradeNow').value = '4';
    $('vpAiGradeGoal').value = '3';

    addVpAiAcademyRow();
    $('vpAiAcademyAdd').addEventListener('click', function () { addVpAiAcademyRow(); });
    addVpAiSubjectRow(); addVpAiSubjectRow(); addVpAiSubjectRow();
    $('vpAiSubjectAdd').addEventListener('click', function () { addVpAiSubjectRow(); });
    $('vpAiSubjectList').addEventListener('input', renderVpAiSubjectTotal);
    $('vpAiGenerate').addEventListener('click', vpAiGenerate);

    ['vpAiWake', 'vpAiSleep', 'vpAiGradeNow', 'vpAiGradeGoal', 'vpAiAutoRest'].forEach(function (id) {
      $(id).addEventListener('change', renderVpAiIntensity);
    });
    renderVpAiIntensity();

    [
      ['vpAiToggle', 'vpAiBody'],
      ['vpPaletteToggle', 'vpPalettes'],
      ['vpPreviewToggle', 'vpPreviewBody']
    ].forEach(function (pair) {
      var btn = $(pair[0]), body = $(pair[1]);
      var txt = btn.querySelector('.rm-txt') ? null : btn; // res-more 버튼은 화살표 회전만으로 상태를 보여 준다
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        body.classList.toggle('is-hidden', open);
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (txt) txt.textContent = open ? '펼치기' : '접기';
      });
    });

    $('vpDownload').addEventListener('click', exportVacPlanImage);
    $('vpReset').addEventListener('click', function () {
      if (!confirm('계획표를 빈 표로 되돌릴까요? 지금까지 입력한 내용이 사라집니다.')) return;
      state.vacplan = vpDefaultModel();
      vpSave();
      renderVacPlanPage();
      toast('빈 표로 되돌렸습니다. AI 계획표 세우기로 다시 시작해 보세요.');
    });

    renderVacPlanPage();
    // 아직 아무것도 안 짠 상태라면 첫 화면에서 바로 AI 카드를 펼쳐 준다.
    // 빈 표만 덩그러니 보여 주면 무엇부터 해야 할지 알 수 없다.
    if (!vpHasContent(state.vacplan)) {
      $('vpAiBody').classList.remove('is-hidden');
      $('vpAiToggle').setAttribute('aria-expanded', 'true');
      $('vpAiToggle').textContent = '접기';
    }
    // 저장된 글씨체가 웹폰트면 로드된 뒤 미리보기를 한 번 더 그린다
    vpEnsureFontLoaded(state.vacplan.font).then(vpRenderPreview);
  }

  function bindGotoIn(root) {
    $$('[data-goto]', root).forEach(function (b) {
      b.addEventListener('click', function () { goPage(b.dataset.goto); });
    });
  }

  /* ========================================================= 설정 페이지 == */

  function neisStatus(msg, kind) {
    var el = $('neisStatus');
    el.className = 'neis-status show ' + (kind || 'info');
    el.innerHTML = msg;
  }

  function initNeis() {
    $('neisKey').value = Neis.key();

    var save = function () {
      Neis.setKey($('neisKey').value);
      Neis.clearCache();
      Neis.clearTimetableCache();
      renderMeals();
      renderTimetable();
      renderSettingsPage();
      if (!Neis.hasKey()) neisStatus('키를 비웠습니다. 학교 검색과 급식은 계속 되지만 한 번에 5건까지만 받아 옵니다.', 'info');
    };
    $('neisKey').addEventListener('change', save);
    $('neisKey').addEventListener('blur', save);

    $('neisTest').addEventListener('click', function () {
      Neis.setKey($('neisKey').value);
      neisStatus('확인 중…', 'info');
      Neis.testKey().then(function (r) {
        neisStatus(Neis.hasKey()
          ? '✅ 키가 정상입니다. 한 번에 30건까지 받아 옵니다.'
          : '✅ 키 없이도 연결됩니다. 한 번에 5건까지 받아 오며, 키를 넣으면 30건으로 늘어납니다.', 'ok');
        renderMeals();
        renderTimetable();
      }).catch(function (e) {
        neisStatus('❌ 연결 실패 — ' + esc(String(e.message || e)) +
          '<br>키가 맞는지, 인터넷이 연결돼 있는지 확인해 주세요.', 'bad');
      });
    });

    $('neisClearCache').addEventListener('click', function () {
      Neis.clearCache();
      Neis.clearTimetableCache();
      renderMeals();
      renderTimetable();
      toast('급식·시간표 캐시를 비웠습니다.');
    });
  }

  function renderSettingsPage() {
    var p = Store.profile();
    if (!p) return;

    var neisTag = p.neis && p.neis.schoolCode
      ? ' · <span style="color:var(--good);font-weight:600">나이스 연결됨</span>'
      : ' · <span style="color:var(--warn)">학교 미선택 (급식 없음)</span>';

    var myMin = Avatar.lifetimeMinutes();
    $('profileSummary').innerHTML =
      Avatar.html(Avatar.get(), myMin, 'av-lg') +
      '<div><div class="ps-name">' + esc(p.nick) + ' ' + Avatar.tierChip(myMin) + '</div>' +
      '<div class="ps-meta">' + esc(Group.groupLabel(p)) +
        (p.neis && p.neis.region ? ' <span style="color:var(--dim)">(' + esc(p.neis.region) + ')</span>' : '') + '</div>' +
      '<div class="ps-goal">주간 목표 ' + (p.goal || 25) + '시간' +
        (kidsOn() ? ' · 초·중 성장 모드 켜짐' : '') + neisTag + '</div></div>';

    var sess = StudyLog.all();
    var days = Object.keys(sess).length;
    var totalMin = 0;
    Object.keys(sess).forEach(function (d) {
      Object.keys(sess[d]).forEach(function (s) { totalMin += sess[d][s].m; });
    });

    $('dataSummary').innerHTML =
      '<div class="ds"><div class="k">기록된 학습일</div><div class="v">' + days + '<small style="font-size:12px;color:var(--muted)">일</small></div></div>' +
      '<div class="ds"><div class="k">누적 순공 시간</div><div class="v">' + Math.round(totalMin / 60) + '<small style="font-size:12px;color:var(--muted)">시간</small></div></div>' +
      '<div class="ds"><div class="k">뇌 컨디션 기록</div><div class="v">' + Store.history().length + '<small style="font-size:12px;color:var(--muted)">건</small></div></div>' +
      '<div class="ds"><div class="k">그룹원</div><div class="v">' + Group.members().length + '<small style="font-size:12px;color:var(--muted)">명</small></div></div>';

    renderStorageStatus();
  }

  /* 기록이 몇 달치 쌓이는 앱이라, 저장이 안전한 상태인지 스스로 알려 준다.
   * 브라우저가 공간을 회수할 수 있는 상태라면 그 사실을 숨기지 않는다. */
  function renderStorageStatus() {
    var el = $('storageStatus');
    if (!el) return;

    var last = Store.lastBackupAt();
    var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    var hasData = Store.history().length > 0 || StudyLog.todayTotal() > 0;

    var backup = last
      ? (days <= 0 ? '오늘 백업했습니다.' : days + '일 전에 백업했습니다.')
      : '아직 백업한 적이 없습니다.';
    var warn = (!last && hasData) || (days !== null && days >= 14);

    Store.persistStatus().then(function (st) {
      var line, cls;
      if (st === 'persisted') {
        line = '✅ <b>영구 보관 중</b> — 저장 공간이 모자라도 브라우저가 이 앱 기록을 지우지 않습니다.';
        cls = 'ok';
      } else if (st === 'best-effort') {
        line = '⚠️ <b>임시 보관 상태</b> — 저장 공간이 부족하면 브라우저가 기록을 지울 수 있습니다. ' +
               '홈 화면에 추가하고 자주 열면 영구 보관으로 바뀝니다.';
        cls = 'warn';
      } else {
        line = 'ℹ️ 이 브라우저는 보관 상태를 알려 주지 않습니다. 백업 파일을 더 자주 내려받아 두세요.';
        cls = '';
      }
      el.className = 'store-status ' + cls;
      el.innerHTML = line + '<br><span class="ss-backup' + (warn ? ' warn' : '') + '">' +
        (warn ? '📥 ' : '') + esc(backup) +
        (warn ? ' 지금 내려받아 두세요 — 기기를 잃어버리면 되돌릴 수 없습니다.' : '') + '</span>';
    });
  }

  /* ================================================== 캐릭터 꾸미기 ==
   *
   * 고른 내용은 [저장하기] 를 눌러야 프로필에 들어간다.
   * 그전까지는 avDraft 에만 있으므로, 이것저것 눌러 보다 나가도 원래대로 남는다. */

  var avDraft = null;

  function avMin() { return Avatar.lifetimeMinutes(); }

  function openAvatarPage() {
    avDraft = Avatar.get();
    renderAvatar();
  }

  function renderAvatar() {
    if (!avDraft) avDraft = Avatar.get();
    renderAvatarStage();
    renderAvatarPicks();
    renderAvatarTiers();
  }

  function renderAvatarStage() {
    var p = Store.profile() || {};
    var min = avMin();
    var t = Avatar.tierFor(min);

    $('avStage').innerHTML =
      '<div class="av-stage-fig">' + Avatar.html(avDraft, min, 'av-xl') + '</div>' +
      '<div class="av-stage-txt">' +
        '<div class="av-stage-name">' + esc(p.nick || '나') + ' ' + Avatar.tierChip(min) + '</div>' +
        '<p class="av-stage-sub">지금까지 쌓은 순공 시간 <b>' + fmtDurFine(min) + '</b></p>' +
        '<div class="av-prog">' +
          '<div class="av-prog-top"><span>' + esc(t.tier.name) + '</span>' +
            '<span>' + (t.next ? esc(t.next.name) + '까지 ' + fmtDurFine(t.remainMin) : '최고 티어 달성') + '</span></div>' +
          '<div class="av-prog-track"><i style="width:' + t.pct.toFixed(1) + '%"></i></div>' +
        '</div>' +
        '<p class="tiny" style="margin:10px 0 0">이 모습 그대로 <b>그룹 랭킹</b>과 상단 프로필에 표시됩니다.</p>' +
      '</div>';
  }

  /** 옵션 하나 — 그 항목만 바꿔 본 미리보기를 그대로 그린다 */
  function avOption(kind, item, on, locked, note) {
    var preview = {};
    Object.keys(avDraft).forEach(function (k) { preview[k] = avDraft[k]; });
    preview[kind] = item.id;

    var fig = kind === 'border'
      ? Avatar.html(preview, Infinity, 'av-sm')
      : '<span class="av av-plain av-sm"><span class="av-in">' + Avatar.svg(preview) + '</span></span>';

    return '<button type="button" class="av-opt' + (on ? ' on' : '') + (locked ? ' locked' : '') + '"' +
      (locked ? ' aria-disabled="true"' : '') +
      ' data-kind="' + kind + '" data-id="' + esc(item.id) + '">' +
      '<span class="av-opt-fig">' + fig + (locked ? '<span class="av-lock">🔒</span>' : '') + '</span>' +
      '<span class="av-opt-name">' + esc(item.name) + '</span>' +
      (note ? '<span class="av-opt-note">' + esc(note) + '</span>' : '') +
      '</button>';
  }

  function avGroup(title, hint, body) {
    return '<div class="av-group"><div class="av-group-head"><b>' + esc(title) + '</b>' +
      (hint ? '<em>' + esc(hint) + '</em>' : '') + '</div>' +
      '<div class="av-opts">' + body + '</div></div>';
  }

  function renderAvatarPicks() {
    var min = avMin();
    var myTier = Avatar.tierIndexFor(min);

    function bySex(list, sex) { return list.filter(function (x) { return x.sex === sex; }); }
    function opts(kind, list) {
      return list.map(function (it) { return avOption(kind, it, avDraft[kind] === it.id); }).join('');
    }

    var html =
      avGroup('피부 톤', '3종', opts('skin', Avatar.SKINS)) +
      avGroup('머리 — 남성형', '3종', opts('hair', bySex(Avatar.HAIRS, 'm'))) +
      avGroup('머리 — 여성형', '5종', opts('hair', bySex(Avatar.HAIRS, 'f'))) +
      avGroup('옷 — 남성형', '5종', opts('outfit', bySex(Avatar.OUTFITS, 'm'))) +
      avGroup('옷 — 여성형', '5종', opts('outfit', bySex(Avatar.OUTFITS, 'f'))) +
      avGroup('테두리', '순공 시간으로 열립니다', Avatar.BORDERS.map(function (b) {
        var locked = b.tier > myTier;
        return avOption('border', b, avDraft.border === b.id, locked,
          locked ? '누적 ' + Avatar.TIERS[b.tier].hours + '시간' : Avatar.TIERS[b.tier].name);
      }).join(''));

    $('avPicks').innerHTML = html;

    $$('#avPicks .av-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('locked')) {
          var need = Avatar.TIERS[Avatar.byId(Avatar.BORDERS, b.dataset.id).tier];
          toast(need.icon + ' ' + need.name + ' 티어(누적 ' + need.hours + '시간)가 되면 열립니다.', true);
          return;
        }
        avDraft[b.dataset.kind] = b.dataset.id;
        renderAvatar();
      });
    });
  }

  function renderAvatarTiers() {
    var min = avMin();
    var myTier = Avatar.tierIndexFor(min);
    $('avTierCount').innerHTML = '<span class="sp-chip">' + (myTier + 1) + ' / ' + Avatar.TIERS.length + ' 달성</span>';

    $('avTierList').innerHTML = Avatar.TIERS.map(function (t, i) {
      var got = i <= myTier;
      var b = Avatar.BORDERS[i];
      var remain = Math.max(0, t.hours * 60 - min);
      return '<div class="av-tier' + (got ? ' got' : '') + (i === myTier ? ' now' : '') + '">' +
        '<span class="av-tier-ring ' + b.cls + '"><i></i></span>' +
        '<div class="av-tier-txt">' +
          '<div class="av-tier-name">' + t.icon + ' ' + esc(t.name) +
            (i === myTier ? '<span class="me-tag">지금</span>' : '') + '</div>' +
          '<div class="av-tier-sub">' + esc(b.name) + ' · 누적 ' + t.hours + '시간</div>' +
        '</div>' +
        '<div class="av-tier-state">' + (got ? '✅ 획득' : '남은 ' + fmtDurFine(remain)) + '</div>' +
      '</div>';
    }).join('');
  }

  function initAvatarPage() {
    $('openAvatar').addEventListener('click', function () { goPage('secAvatar'); });

    $('avRandom').addEventListener('click', function () {
      function pick(list) { return list[Math.floor(Math.random() * list.length)].id; }
      avDraft.skin = pick(Avatar.SKINS);
      avDraft.hair = pick(Avatar.HAIRS);
      avDraft.outfit = pick(Avatar.OUTFITS);
      renderAvatar();
    });

    $('avSave').addEventListener('click', function () {
      if (!Avatar.save(avDraft)) { toast('저장에 실패했습니다.', true); return; }
      avDraft = Avatar.get();
      Group.syncSelf();            // 공유 코드에도 바뀐 모습이 실리도록
      renderAvatar();
      renderProfileChip();
      renderSettingsPage();
      renderGroup();
      toast('캐릭터를 저장했습니다.');
    });

    $('avRevert').addEventListener('click', function () {
      avDraft = Avatar.get();
      renderAvatar();
      toast('저장된 모습으로 되돌렸습니다.');
    });
  }

  /* ==================================================== 초·중 성장 모드 == */

  function renderKids() {
    if (!kidsOn()) return;
    var k = Kids.state();

    $('kidHero').innerHTML =
      '<div class="kh-char">' + k.char.emoji + '</div>' +
      '<div>' +
        '<div class="kh-top"><span class="kh-name">' + esc(k.char.name) + '</span>' +
        '<span class="kh-lv">Lv.' + k.level + '</span></div>' +
        '<p class="kh-line">' + esc(k.char.line) +
          (k.next ? ' Lv.' + k.next.min + '이 되면 ' + esc(k.next.name) + '(' + k.next.emoji + ')로 자라요!' : '') + '</p>' +
        '<div class="xp-top"><span>경험치</span><span>' + k.inLevel + ' / ' + k.need + ' XP</span></div>' +
        '<div class="xp-track"><div class="xp-fill" id="xpFill"></div></div>' +
        '<div class="kh-stats">' +
          '<span>오늘 모은 경험치 <b>+' + k.todayXp + ' XP</b></span>' +
          '<span>지금까지 <b>' + k.xp + ' XP</b></span>' +
          '<span>연속 학습 <b>' + StudyLog.streak() + '일</b></span>' +
        '</div>' +
      '</div>';
    setTimeout(function () { if ($('xpFill')) $('xpFill').style.width = k.pct.toFixed(1) + '%'; }, 80);

    var missions = Kids.todayMissions();
    var doneCount = missions.filter(function (m) { return m.done; }).length;
    $('missionCount').innerHTML = '<span class="sp-chip">' + doneCount + ' / ' + missions.length + ' 완료</span>';
    $('missionList').innerHTML = missions.map(function (m) {
      var nowTxt = (Math.round(m.now * 10) / 10) + (m.unit || '');
      var goalTxt = m.goal + (m.unit || '');
      return '<div class="mission' + (m.done ? ' done' : '') + '">' +
        '<div class="ms-icon">' + m.icon + '</div>' +
        '<div><div class="ms-text">' + esc(m.text) + '</div>' +
        '<div class="ms-track"><div class="ms-fill" style="width:' + m.pct.toFixed(1) + '%"></div></div>' +
        '<div class="ms-num">' + esc(nowTxt) + ' / ' + esc(goalTxt) + '</div></div>' +
        '<div class="ms-state">' + (m.done ? '✅<small>+30 XP</small>' : '⬜') + '</div>' +
      '</div>';
    }).join('');

    var st = Kids.stamps();
    var got = st.filter(function (s) { return s.got; }).length;
    $('stampBoard').innerHTML = st.map(function (s) {
      var cls = (s.got ? ' got' : '') + (s.isToday ? ' today' : '') + (s.isFuture ? ' future' : '');
      return '<div class="stamp' + cls + '" title="' + esc(s.date) + ' · ' + fmtDurFine(s.min) + '">' +
        '<div class="sc">' + (s.got ? '⭐' : (s.isFuture ? '' : '·')) + '</div>' +
        '<div class="sd">' + s.dow + '</div></div>';
    }).join('');

    var p = Store.profile() || {};
    var daily = ((p.goal || 25) * 60) / 7;
    $('stampNote').textContent = '하루 ' + fmtDurFine(daily) + ' 이상 공부하면 도장을 받아요. 이번 주에 ' + got + '개 모았어요!';

    var badges = Kids.badgeList();
    var earned = badges.filter(function (b) { return b.earnedOn; }).length;
    $('badgeCount').innerHTML = '<span class="sp-chip">' + earned + ' / ' + badges.length + ' 획득</span>';
    $('badgeGrid').innerHTML = badges.map(function (b) {
      return '<div class="badge' + (b.earnedOn ? ' got' : '') + '" title="' + esc(b.desc) + '">' +
        '<div class="bi">' + b.icon + '</div>' +
        '<div class="bn">' + esc(b.name) + '</div>' +
        '<div class="bd">' + esc(b.earnedOn ? b.earnedOn + ' 획득' : b.desc) + '</div></div>';
    }).join('');
  }

  /** 미션·배지·레벨업을 판정하고 축하 메시지를 띄운다 */
  function awardKids() {
    if (!kidsOn()) return;
    var res = Kids.evaluate();
    var msgs = [];
    res.missions.forEach(function (m) { msgs.push('🎯 미션 완료! ' + m.text + ' (+' + Kids.XP_PER_MISSION + ' XP)'); });
    res.badges.forEach(function (b) { msgs.push(b.icon + ' 배지 획득! ' + b.name + ' (+' + Kids.XP_PER_BADGE + ' XP)'); });
    if (res.levelUp) msgs.push('🎉 레벨 업! Lv.' + res.levelUp.to + ' ' + res.levelUp.char.name + ' ' + res.levelUp.char.emoji);
    renderKids();
    celebrate(msgs);
  }

  /* ========================================================== 그룹 랭킹 == */

  /* ------------------------------------------------- 같은 반 자동 랭킹
   *
   * 공유 코드를 주고받는 방식은 번거로워서 결국 아무도 안 쓴다.
   * 같은 학교·학년·반이면 등록 없이 같은 판에 놓되, 서로에게는 익명으로만 보인다.
   * 태그(A1B2)는 주마다 바뀌므로 주가 넘어가면 같은 사람을 계속 따라갈 수 없다.
   *
   * 서버가 꺼져 있거나 5명이 안 모였으면 아무것도 그리지 않고,
   * 예전처럼 이 브라우저가 아는 그룹원 목록이 그대로 남는다. */
  function renderClassRank() {
    var p = Store.profile();
    if (!p || !Cloud.enabled() || !Cloud.classEnabled()) return;

    var cid = League.myClassId(p);
    if (!cid) return;

    var wk = Store.key(Store.weekStart(new Date()));
    Cloud.fetchClassMembers(cid, wk).then(function (rows) {
      if (!rows.length) return;   // 5명 미만이면 서버가 아무것도 주지 않는다

      // 내 줄만 실시간 값으로 바꾼다. 서버 값은 마지막 동기화 시점이라 뒤처져 있다.
      var mine = League.myCappedWeek();
      rows.forEach(function (r) { if (r.me) r.minutes = Math.max(r.minutes, mine); });
      rows.sort(function (a, b) { return b.minutes - a.minutes; });

      var max = rows.reduce(function (m, r) { return Math.max(m, r.minutes); }, 0);

      $('rankList').innerHTML = rows.map(function (r, i) {
        var rank = i + 1;
        var medal = rank <= 3 ? ' m' + rank : '';
        var badge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        var w = max > 0 ? (r.minutes / max * 100) : 0;
        var color = Group.avatarColor(r.tag);
        return '<div class="rank' + (r.me ? ' is-me' : '') + (rank === 1 ? ' top1' : '') + '">' +
          '<div class="rk-pos' + medal + '">' + badge + '</div>' +
          '<div class="rk-av" style="background:' + color + '">' + esc(r.tag.slice(0, 1)) + '</div>' +
          '<div class="rk-info">' +
            '<div class="rk-name">' + (r.me ? '나' : '익명 ' + esc(r.tag)) +
              (r.me && r.hidden ? '<span class="me-tag">숨김</span>' : '') + '</div>' +
            '<div class="rk-track"><div class="rk-fill" style="width:' + w.toFixed(1) + '%;background:' + color + '"></div></div>' +
            '<div class="rk-date">' + (r.me ? '실시간 반영' : agoText(r.updatedAt)) + '</div>' +
          '</div>' +
          '<div class="rk-time">' + durHtml(r.minutes) + '</div>' +
        '</div>';
      }).join('');

      $('groupHero').innerHTML =
        '<div><p class="gh-name">' + esc(cid.label) + '</p>' +
        '<p class="gh-sub">' + rows.length + '명 참여 · 이번 주 합계 ' +
          fmtDurFine(rows.reduce(function (s, r) { return s + r.minutes; }, 0)) +
          ' · 서로 <b>익명</b>으로 보입니다</p></div>' +
        '<div class="gh-stats">' +
          '<div class="gh-stat"><div class="k">내 순위</div><div class="v">' +
            (rows.findIndex ? (rows.findIndex(function (r) { return r.me; }) + 1) : 0) + '<small>위</small></div></div>' +
          '<div class="gh-stat"><div class="k">내 주간 순공</div><div class="v">' + durHtml(mine) + '</div></div>' +
          '<div class="gh-stat"><div class="k">연속 학습</div><div class="v">' + StudyLog.streak() + '<small>일</small></div></div>' +
        '</div>';
    }, function () { /* 못 받아 오면 로컬 목록을 그대로 둔다 */ });
  }

  function renderGroup() {
    var p = Store.profile();
    if (!p) return;
    Group.syncSelf();

    var r = Group.rank(state.rankRange);
    var isWeek = state.rankRange === 'week';
    var myRank = r.me ? r.me.rank : null;

    $('groupHero').innerHTML =
      '<div><p class="gh-name">' + esc(Group.groupLabel(p)) + '</p>' +
      '<p class="gh-sub">' + r.count + '명 · ' + (isWeek ? '이번 주' : '오늘') + ' 합계 ' + fmtDurFine(r.total) +
      (r.count > 1 ? ' · 평균 ' + fmtDurFine(r.avg) : '') + '</p></div>' +
      '<div class="gh-stats">' +
        '<div class="gh-stat"><div class="k">내 순위</div><div class="v">' + (myRank ? myRank + '<small>위</small>' : '—') + '</div></div>' +
        '<div class="gh-stat"><div class="k">' + (isWeek ? '내 주간 순공' : '내 오늘 순공') + '</div><div class="v">' + durHtml(r.me ? r.me.value : 0) + '</div></div>' +
        '<div class="gh-stat"><div class="k">연속 학습</div><div class="v">' + StudyLog.streak() + '<small>일</small></div></div>' +
      '</div>';

    $('rankList').innerHTML = r.list.length ? r.list.map(function (m) {
      var medal = m.rank <= 3 ? ' m' + m.rank : '';
      var badge = m.rank === 1 ? '🥇' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : m.rank;
      var w = r.max > 0 ? (m.value / r.max * 100) : 0;
      var color = Group.avatarColor(m.nick);
      var stale = m.date !== Store.key();
      /* 캐릭터와 티어. 내 것은 실시간이고, 그룹원은 코드를 받은 시점의 값이다.
       * lifeMin 이 없는 옛 코드로 들어온 사람은 티어를 지어내지 않고 배지를 빼 둔다. */
      var lifeMin = m.self ? Avatar.lifetimeMinutes() : m.lifeMin;
      var av = m.self ? Avatar.get() : m.avatar;
      return '<div class="rank' + (m.self ? ' is-me' : '') + (m.rank === 1 ? ' top1' : '') + '">' +
        '<div class="rk-pos' + medal + '">' + badge + '</div>' +
        Avatar.html(av, lifeMin || 0, 'rk-av') +
        '<div class="rk-info">' +
          '<div class="rk-name">' + esc(m.nick) + (m.self ? '<span class="me-tag">나</span>' : '') +
            (lifeMin != null ? Avatar.tierChip(lifeMin, true) : '') +
            (m.overall != null ? '<span class="brain">🧠 ' + m.overall + '</span>' : '') + '</div>' +
          '<div class="rk-track"><div class="rk-fill" style="width:' + w.toFixed(1) + '%;background:' + color + '"></div></div>' +
          '<div class="rk-date">' + (m.self ? '실시간 반영'
            : (stale ? '⚠ ' + esc(m.date) + ' 기록 (' + agoText(m.ts) + ')' : '코드 받은 시점 · ' + agoText(m.ts))) +
            (m.streak ? ' · 연속 ' + m.streak + '일' : '') + '</div>' +
        '</div>' +
        '<div class="rk-time">' + durHtml(m.value) + '</div>' +
        (m.self ? '<span></span>' : '<button type="button" class="icon-btn rk-del" data-id="' + esc(m.id) + '" title="그룹에서 제외">✕</button>') +
      '</div>';
    }).join('')
      : '<div class="m-empty">아직 그룹원이 없습니다.<br>아래 <b>공유 코드</b>를 친구에게 보내고, 친구 코드를 받아 넣으면 랭킹이 만들어집니다.</div>';

    if (r.list.length > 1) {
      $('rankList').insertAdjacentHTML('beforeend',
        '<p class="tiny">⚠ 친구 기록은 <b>코드를 받은 시점에 멈춰 있습니다.</b> 서버가 없어 자동으로 갱신되지 않으니, ' +
        '정확한 비교를 원하면 새 코드를 다시 주고받으세요.</p>');
    }

    $$('.rk-del').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = Group.members().filter(function (x) { return x.id === b.dataset.id; })[0];
        if (!m || !confirm(m.nick + ' 님을 그룹에서 제외할까요?')) return;
        Group.remove(b.dataset.id);
        renderGroup();
        toast(m.nick + ' 님을 제외했습니다.');
      });
    });

    renderGroupCompare();
    $('myCode').value = Group.encodeSelf();

    // 서버에서 같은 반 명단을 받아 오면 위 목록을 익명 랭킹으로 갈아 끼운다
    renderClassRank();
  }

  function renderGroupCompare() {
    var ga = Group.capacityAverage();
    var mine = Store.history();
    mine = mine.length ? mine[mine.length - 1] : null;

    if (!ga || !mine || ga.count < 2) {
      $('groupCompare').innerHTML = '<div class="m-empty">' +
        (!mine ? '먼저 오늘의 뇌 상태를 분석해 주세요.' : '그룹원이 2명 이상이면 능력별 평균과 비교해 드립니다.') + '</div>';
      return;
    }

    $('groupCompare').innerHTML = BrainEngine.CAPACITIES.map(function (c) {
      var my = mine.scores[c.id] || 0;
      var avg = ga.avg[c.id] || 0;
      var diff = Math.round(my - avg);
      return '<div class="gc">' +
        '<div class="gc-top"><span class="nm">' + c.icon + ' ' + esc(c.label) + '</span>' +
        '<span style="color:' + c.color + ';font-weight:800">' + my + '</span>' +
        '<span class="df ' + (diff >= 0 ? 'up' : 'dn') + '">평균 ' + Math.round(avg) + ' 대비 ' + (diff >= 0 ? '+' : '') + diff + '</span></div>' +
        '<div class="gc-track"><div class="gc-mine" style="width:' + my + '%;background:' + c.color + '"></div>' +
        '<div class="gc-avg" style="left:calc(' + avg.toFixed(1) + '% - 1px)"></div></div></div>';
    }).join('') + '<div class="gc-legend"><span><i class="bar"></i>내 점수</span><span><i class="tick"></i>그룹 평균 (' + ga.count + '명)</span></div>';
  }

  /* ========================================================= 주간 리포트 == */

  function renderReport() {
    if (!Store.profile()) return;
    var r = Report.full(state.weekOffset);

    $('weekLabel').textContent = r.label + (r.isCurrent ? ' (이번 주)' : '');
    $('reportRange').textContent = r.isCurrent
      ? '이번 주 학습 상태입니다. 매주 월요일에 지난주 리포트를 확인하면 흐름이 잘 보입니다.'
      : r.label + ' 주간 리포트입니다.';
    $('nextWeek').disabled = state.weekOffset >= 0;

    var dPct = r.deltaPct === null ? null : Math.round(r.deltaPct);
    $('repStats').innerHTML =
      '<div class="rs hi"><div class="rs-k">주간 총 순공 시간</div><div class="rs-v">' +
        Math.floor(r.totalMin / 60) + '<small>시간</small> ' + Math.round(r.totalMin % 60) + '<small>분</small></div>' +
        (dPct === null ? '<div class="rs-d flat">비교할 지난주 기록 없음</div>'
          : '<div class="rs-d ' + (dPct > 0 ? 'up' : dPct < 0 ? 'dn' : 'flat') + '">지난주 대비 ' + (dPct > 0 ? '+' : '') + dPct + '%</div>') +
      '</div>' +
      '<div class="rs"><div class="rs-k">목표 달성률</div><div class="rs-v">' + Math.round(r.goalPct) + '<small>%</small></div>' +
        '<div class="rs-d flat">목표 ' + (r.goalMin / 60) + '시간</div></div>' +
      '<div class="rs"><div class="rs-k">학습한 날</div><div class="rs-v">' + r.studyDays + '<small>일</small></div>' +
        '<div class="rs-d flat">하루 평균 ' + fmtDur(r.dailyAvgMin) + '</div></div>' +
      '<div class="rs"><div class="rs-k">평균 뇌 컨디션</div><div class="rs-v">' +
        (r.brainAvg === null ? '—' : Math.round(r.brainAvg)) + (r.brainAvg === null ? '' : '<small>점</small>') + '</div>' +
        '<div class="rs-d flat">' + (r.brainRows.length ? r.brainRows.length + '일 기록' : '기록 없음') + '</div></div>';

    var maxDay = Math.max.apply(null, r.days.map(function (d) { return d.min; }).concat([1]));
    $('weekBars').innerHTML = r.days.map(function (d) {
      var h = d.min > 0 ? Math.max(4, d.min / maxDay * 100) : 2;
      return '<div class="wb' + (d.isToday ? ' today' : '') + (d.min <= 0 ? ' zero' : '') + '">' +
        '<div class="wb-col">' + (d.min > 0 ? '<div class="wb-val">' + Math.round(d.min) + '분</div>' : '') +
        '<div class="wb-bar" style="height:' + h.toFixed(1) + '%"></div></div>' +
        '<div class="wb-day">' + d.dow + '</div></div>';
    }).join('');

    var dailyGoal = r.goalMin / 7;
    $('weekBarsNote').textContent = '주간 목표를 7일로 나누면 하루 ' + fmtDur(dailyGoal) + '입니다. ' +
      (r.bestDay ? '가장 많이 한 날은 ' + r.bestDay.dow + '요일(' + fmtDur(r.bestDay.min) + ')입니다.' : '아직 기록된 날이 없습니다.');

    $('subjSplit').innerHTML = r.subjects.length ? r.subjects.map(function (s) {
      return '<div class="ss">' +
        '<div class="ss-name"><i style="background:' + s.color + '"></i><b>' + esc(s.name) + '</b>' +
        '<span style="color:var(--dim);font-size:11px">' + esc(s.label) + '</span></div>' +
        '<div class="ss-time">' + fmtDur(s.min) + ' · ' + Math.round(s.pct) + '%</div>' +
        '<div class="ss-track"><div class="ss-fill" style="width:' + s.pct.toFixed(1) + '%;background:' + s.color + '"></div></div>' +
      '</div>';
    }).join('') : '<div class="m-empty">이 주에 기록된 학습이 없습니다.</div>';

    renderHistoryChart(r);

    $('repSummary').innerHTML = r.summary.map(function (s) {
      return '<div class="rsum ' + (s.tone || '') + '"><div class="ri">' + s.icon + '</div>' +
        '<div><h5>' + esc(s.title) + '</h5><p>' + esc(s.text) + '</p></div></div>';
    }).join('');
  }

  function renderHistoryChart(r) {
    var rows = r.brainRows;
    if (!rows.length) {
      $('historyChart').innerHTML = '<text x="360" y="120" text-anchor="middle" fill="#8b93a8" font-size="13">이 주에 기록된 뇌 컨디션이 없습니다</text>';
      $('historyNote').textContent = '매일 데이터를 입력하면 컨디션 변화와 공부량의 관계가 보입니다.';
      return;
    }

    var W = 720, H = 240, pd = { l: 36, r: 16, t: 16, b: 30 };
    var iw = W - pd.l - pd.r, ih = H - pd.t - pd.b;
    var svg = [];

    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = pd.t + ih * (1 - v / 100);
      svg.push('<line x1="' + pd.l + '" y1="' + y + '" x2="' + (W - pd.r) + '" y2="' + y + '" stroke="rgba(22,26,39,0.08)" stroke-width="1"/>');
      svg.push('<text x="' + (pd.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="#8b93a8" font-size="10">' + v + '</text>');
    });

    var n = rows.length;
    var xOf = function (i) { return pd.l + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
    var yOf = function (v) { return pd.t + ih * (1 - v / 100); };
    var pts = rows.map(function (x, i) { return xOf(i) + ',' + yOf(x.overall); });

    svg.push('<defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(109,74,255,0.28)"/><stop offset="100%" stop-color="rgba(109,74,255,0)"/></linearGradient></defs>');
    svg.push('<polygon points="' + xOf(0) + ',' + (pd.t + ih) + ' ' + pts.join(' ') + ' ' + xOf(n - 1) + ',' + (pd.t + ih) + '" fill="url(#hg)"/>');
    svg.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#6d4aff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>');

    rows.forEach(function (x, i) {
      svg.push('<circle cx="' + xOf(i) + '" cy="' + yOf(x.overall) + '" r="4.5" fill="#ffffff" stroke="#6d4aff" stroke-width="2.5"><title>' + x.date + ' · ' + x.overall + '점</title></circle>');
      svg.push('<text x="' + xOf(i) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#8b93a8" font-size="10">' + x.date.slice(5) + '</text>');
    });
    $('historyChart').innerHTML = svg.join('');

    if (rows.length === 1) {
      $('historyNote').textContent = '이 주에는 ' + rows[0].date + ' 하루만 기록됐습니다 (' + rows[0].overall +
        '점, 수면 ' + rows[0].sleep + '시간). 며칠 더 쌓이면 수면과 컨디션의 관계가 드러납니다.';
      return;
    }
    var sorted = rows.slice().sort(function (a, b) { return b.overall - a.overall; });
    var hi = sorted[0], lo = sorted[sorted.length - 1];
    $('historyNote').textContent = '가장 좋았던 날은 ' + hi.date + '(' + hi.overall + '점, 수면 ' + hi.sleep + '시간), ' +
      '가장 낮았던 날은 ' + lo.date + '(' + lo.overall + '점, 수면 ' + lo.sleep + '시간)입니다.' +
      (hi.sleep > lo.sleep ? ' 수면이 길었던 날의 컨디션이 더 좋았습니다.' : '');
  }

  /* ---------------------------------------------------------------- 실행 */

  function runAnalysis() {
    var input = collectInput();
    if (!input.subjects.length) {
      toast('과목명을 최소 1개 입력해 주세요.', true);
      $('subjectList').querySelector('.s-name').focus();
      return;
    }

    var a = BrainEngine.analyze(input);
    var p = BrainPlanner.plan(a);
    state.analysis = a; state.plan = p;

    renderResult(a);
    renderPlan(p);
    state.timer.load(p.timeline);

    input._date = Store.key();   // 언제 입력한 값인지 기억해 다음 방문에 안내한다
    Store.saveInput(input);
    Store.pushRecord(a);
    Group.syncSelf();

    renderLiveTotal();
    renderGroup();
    renderLeague();
    renderReport();
    renderKids();
    renderSoundNow();
    renderSettingsPage();
    renderQuickNote();

    renderNav();
    goPage('secResult');
    toast('분석 완료 — 종합 뇌 컨디션 ' + a.overall + '점');
    setTimeout(awardKids, 1600);
  }

  function dateAfter(d) {
    var t = new Date(); t.setDate(t.getDate() + d);
    return Store.key(t);
  }

  var SAMPLE = {
    sleep: { hours: 5.5, quality: 2, regularity: 2 },
    stress: 7, fatigue: 7, mood: 2,
    meals: { breakfast: false, lunch: true, dinner: false },
    hoursSinceMeal: 5, water: 3, caffeine: 3, exercise: 0,
    availableHours: 6,
    subjects: [
      { name: '미적분', type: 'calculate', examDate: dateAfter(3), importance: 5, readiness: 2 },
      { name: '영어 단어', type: 'memorize', examDate: dateAfter(10), importance: 4, readiness: 3 },
      { name: '국어 비문학', type: 'reading', examDate: dateAfter(3), importance: 4, readiness: 3 },
      { name: '수리논술', type: 'creative', examDate: dateAfter(24), importance: 3, readiness: 2 }
    ]
  };

  function initClock() {
    var tick = function () {
      var n = new Date();
      $('clock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
    };
    tick(); setInterval(tick, 20000);
  }

  /** 월요일이면 지난주 리포트를 안내한다 */
  function weeklyNotice() {
    if (new Date().getDay() !== 1) return;
    if (StudyLog.weekTotal(-1) <= 0) return;
    setTimeout(function () {
      toast('📊 지난주 리포트가 준비됐습니다 — 총 ' + fmtDur(StudyLog.weekTotal(-1)) + ' 공부했어요');
    }, 1400);
  }

  /* ================================================================= 학교 리그
   * 티어는 골라 들어가는 게 아니라 매주 정산으로 오르내린다.
   * 그래서 레일은 고를 수 있는 탭이 아니라 진행 상황을 보여 주는 눈금으로 쓴다. */

  var LG_ROW_H = 56;

  /** 받침 유무에 따라 을/를, 이/가 를 고른다 */
  function josa(word, withBatchim, without) {
    var s = String(word || '');
    var last = s.charCodeAt(s.length - 1);
    // 한글 음절이 아니면 받침을 알 수 없으니 없는 쪽으로 둔다
    if (!(last >= 0xac00 && last <= 0xd7a3)) return without;
    return ((last - 0xac00) % 28) ? withBatchim : without;
  }

  /* 판을 좁혀 보는 필터. 순위 자체는 전체 기준으로 매기고, 보여 줄 때만 추린다 —
   * 학년별로 다시 1위를 매기면 "우리 학년 1등" 과 "리그 1등" 이 뒤섞여 헷갈린다. */
  function lgFilterRows(b) {
    if (b.mode !== 'class') return b.ranked;
    var sc = state.lgSchool || '', gr = state.lgGrade || '';
    return b.ranked.filter(function (r) {
      if (sc && r.schoolOnly !== sc) return false;
      if (gr && r.grade !== gr) return false;
      return true;
    });
  }

  function renderLeagueFilters(b) {
    var wrap = $('lgFilters');
    if (!wrap) return;
    wrap.classList.toggle('is-hidden', b.mode !== 'class');
    if (b.mode !== 'class') return;

    var schools = [], grades = [];
    b.ranked.forEach(function (r) {
      if (r.schoolOnly && schools.indexOf(r.schoolOnly) < 0) schools.push(r.schoolOnly);
      if (r.grade && grades.indexOf(r.grade) < 0) grades.push(r.grade);
    });
    schools.sort();
    grades.sort(function (x, y) { return parseInt(x, 10) - parseInt(y, 10); });

    var sSel = $('lgFilterSchool'), gSel = $('lgFilterGrade');
    sSel.innerHTML = '<option value="">전체 학교</option>' + schools.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    gSel.innerHTML = '<option value="">전체 학년</option>' + grades.map(function (g) {
      return '<option value="' + esc(g) + '">' + esc(g) + '학년</option>';
    }).join('');
    sSel.value = state.lgSchool || '';
    gSel.value = state.lgGrade || '';
  }

  function renderLeague() {
    if (!$('lgBoard')) return;

    var b = League.board(state.leagueMode);
    if (!b) return;                        // 프로필 전에는 그릴 게 없다

    $$('#lgModes .lg-mode').forEach(function (btn) {
      btn.classList.toggle('on', btn.dataset.mode === b.mode);
    });
    renderLeagueFilters(b);

    /* 아직 5명이 안 모여 순위표에 못 오른 반이면, 사라지는 대신 이유를 말해 준다.
     * 합계는 보여 주지 않는다 — 2명짜리 반에서 내 시간을 빼면 나머지 한 명이 드러난다. */
    var pend = $('lgPending');
    if (pend) {
      if (b.mode === 'class' && b.pending) {
        pend.classList.remove('is-hidden');
        pend.innerHTML = '👥 <b>' + esc(b.pending.label) + '</b> — 지금 ' + b.pending.active +
          '명 참여 중입니다. <b>' + b.pending.need + '명</b> 더 모이면 순위표에 올라갑니다.' +
          '<span class="lp-why">인원이 적으면 합계가 사실상 한 사람의 공부 시간이 되기 때문에, 5명부터 공개합니다.</span>';
      } else {
        pend.classList.add('is-hidden');
      }
    }

    /* 티어 눈금 */
    $('lgRail').innerHTML = b.tiers.map(function (t, i) {
      return '<button type="button" role="tab" disabled aria-selected="' + (i === b.tierIdx) + '"' +
        ' class="' + (i === b.tierIdx ? 'on' : '') + '">' + esc(t.name) + '</button>';
    }).join('');

    /* 내 학교 카드 */
    $('lgDaysLeft').textContent = b.daysLeft > 0 ? (b.daysLeft + '일 남음') : '오늘 마감';
    $('lgSchoolName').textContent = b.me.schoolName;
    $('lgMyRank').textContent = b.me.rank;
    $('lgMyTotal').textContent = b.me.total.toLocaleString();
    $('lgMyActive').textContent = b.me.active;
    $('lgMySteady').textContent = b.me.steady;

    /* 참가 학교 수에 따라 할 수 있는 말이 다르다.
     * 상대가 없는데 승급을 이야기하면 없는 경쟁을 지어내는 셈이다. */
    var unit = b.unit;                       // '반' 또는 '학교'
    var countUnit = b.mode === 'class' ? '개 반' : '개교';
    var gapTxt, gapCls = b.myZone;
    if (b.solo) {
      gapTxt = b.mode === 'class'
        ? '아직 우리 반만 참가하고 있어요. 같은 학교 다른 반 친구가 참가하면 순위가 생깁니다.'
        : '아직 우리 학교만 참가하고 있어요. 다른 학교 친구가 참가하면 순위가 생깁니다.';
      gapCls = 'stay';
    } else if (!b.ranked3) {
      gapTxt = b.ahead
        ? b.ahead.schoolName + josa(b.ahead.schoolName, '을', '를') +
          ' 앞서려면 ' + b.aheadGap.toLocaleString() + '분 더 필요해요'
        : '지금 1위예요. ' + b.size + countUnit + '이 참가 중입니다';
      gapCls = 'stay';
    } else if (b.myZone === 'promote') {
      gapTxt = '승급권 안에 있어요. ' + (b.promote + 1) + '위와 ' + b.gap.toLocaleString() + '분 차이';
    } else if (b.myZone === 'demote') {
      gapTxt = '강등권이에요. ' + b.gap.toLocaleString() + '분 더 모으면 안전해져요';
    } else if (b.promote > 0) {
      gapTxt = '승급까지 ' + b.gap.toLocaleString() + '분 남았어요';
    } else {
      gapTxt = '최상위 리그예요. 자리를 지키는 중';
    }
    $('lgGapNote').textContent = gapTxt;
    $('lgGapNote').className = 'lg-gap ' + gapCls;

    /* 서버 연동 상태 — 지금 보는 순위가 어디까지 반영된 것인지 밝힌다 */
    var cs = Cloud.status();
    var badge = cs.enabled
      ? '<span class="lg-cloud">🔗 ' + (cs.lastSync ? agoText(cs.lastSync) + ' 동기화' : '동기화 중') + '</span>'
      : '<span class="lg-cloud off">📴 이 기기만</span>';
    $('lgTierLabel').innerHTML = esc(b.tier.name) + ' 리그 · ' + b.size + '개교 참가' + badge;

    /* 승강 안내 */
    $('lgZoneNote').textContent = !b.ranked3
      ? b.minField + countUnit + ' 이상 모이면 승급·강등이 시작됩니다'
      : (b.tier.promote > 0 ? '상위 ' + b.promote + countUnit + ' 승급' : '최상위 리그') +
        (b.demote > 0 ? ' · 하위 ' + b.demote + countUnit + ' 강등' : ' · 강등 없음');

    /* 순위표 — 각 행을 제 순위 자리로 옮긴다.
     * 필터를 걸면 자리가 비므로 화면상 위치는 다시 촘촘히 매기되,
     * 번호는 전체 기준 순위를 그대로 보여 준다. */
    var shown = lgFilterRows(b);
    var filtered = shown.length !== b.ranked.length;

    var rows = shown.map(function (s, i) {
      var slot = filtered ? i : (s.rank - 1);
      // 판이 작아 승강선을 그리지 않을 때는 행에도 색을 넣지 않는다
      var zone = (b.promote || b.demote)
        ? League.getZone(s.rank, { promote: b.promote, demote: b.demote }, b.size)
        : 'stay';
      var isMe = s.schoolCode === League.MY_CODE;
      var d = b.deltas[s.schoolCode];
      var deltaCls = d > 0 ? ' up' : (d < 0 ? ' down' : '');
      var deltaTxt = d ? (d > 0 ? '▲' + d : '▼' + (-d)) : '·';

      return '<div class="lg-row z-' + zone + (isMe ? ' is-me' : '') + '"' +
        ' style="transform:translateY(' + (slot * LG_ROW_H + 6) + 'px)">' +
        '<span class="r-rank">' + s.rank + '</span>' +
        '<span class="r-name">' + esc(s.schoolName) +
          '<span class="r-sub">참여 ' + s.active + '명 · 꾸준 ' + s.steady + '명</span>' +
        '</span>' +
        '<span class="r-total">' + s.total.toLocaleString() + '분</span>' +
        '<span class="r-delta' + deltaCls + '">' + deltaTxt + '</span>' +
      '</div>';
    }).join('');

    /* 승급·강등선은 전체 판의 자리를 가리키므로, 추려 보는 중에는 그리지 않는다.
     * 그대로 두면 엉뚱한 줄 사이에 선이 그어져 오히려 잘못 읽힌다. */
    var cuts = '';
    if (!filtered && b.promote > 0) {
      cuts += '<div class="lg-cut promote" style="transform:translateY(' +
        (b.promote * LG_ROW_H + 6) + 'px)"><span><i>승급선</i></span></div>';
    }
    if (!filtered && b.demote > 0) {
      cuts += '<div class="lg-cut demote" style="transform:translateY(' +
        ((b.size - b.demote) * LG_ROW_H + 6) + 'px)"><span><i>강등선</i></span></div>';
    }

    /* 상대가 없거나, 필터로 다 걸러졌을 때 빈 판만 보여 주지 않는다 */
    var hint = '';
    if (b.solo) {
      hint = '<div class="lg-solo">아직 <b>' + (b.mode === 'class' ? '우리 반' : '우리 학교') +
        '</b>만 참가하고 있습니다.<br>같은 학교 친구들이 리그를 켜면 자동으로 판에 들어옵니다.</div>';
    } else if (!shown.length) {
      hint = '<div class="lg-solo">고른 조건에 맞는 반이 없습니다.<br>학교나 학년을 <b>전체</b>로 바꿔 보세요.</div>';
    }

    var slots = shown.length || 0;
    $('lgBoard').style.height = (slots * LG_ROW_H + 12 + (hint ? 96 : 0)) + 'px';
    $('lgBoard').innerHTML = rows + cuts + hint;

    /* 오늘 인정된 시간 */
    var used = Math.round(b.todayMin);
    var cap = League.DAILY_CAP_MINUTES;
    $('lgCapText').innerHTML = '오늘 인정된 시간 <b>' + used + '</b> / ' + cap + '분' +
      (b.capLeft <= 0 ? ' — 오늘 상한을 채웠어요. 내일 또 만나요' : '');
    $('lgCapBar').style.width = Math.min(100, (used / cap) * 100) + '%';

    League.snapshot(b.ranked);
  }

  /* ------------------------------------------------------- 리그 서버 연동 */

  /* 리그 참가 스위치는 두 곳에 있다 — 첫 프로필 작성 화면(pfLeague)과
   * 설정 화면(cloudOn). 둘 다 같은 Cloud 상태를 반영해야 하므로
   * 여기서 한 번에 그린다. */
  function renderCloudSettings() {
    if (!$('cloudOn') && !$('pfLeague')) return;
    var s = Cloud.status();

    ['cloudOn', 'pfLeague'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.checked = s.enabled;
      el.disabled = !s.configured;
    });

    if ($('pfLeagueNote')) {
      $('pfLeagueNote').innerHTML = s.configured
        ? '학교명과 주간 학습 시간(분)만 서버로 전송됩니다. 이름·시험·수면 같은 개인 기록은 전송되지 않습니다. ' +
          '학년·반은 <b>설정 → 학급 대항전</b>을 따로 켠 경우에만 함께 전송됩니다. ' +
          '<b>만 14세 미만이라면 보호자와 함께 결정하세요.</b> 나중에 <b>설정 → 학교 리그 참가</b>에서 언제든 켜고 끌 수 있습니다.'
        : '서버가 아직 연결돼 있지 않아 지금은 켤 수 없습니다. 나중에 <b>설정</b> 화면에서 다시 시도해 주세요.';
    }

    // 학급 대항전은 학교 리그가 켜져 있을 때만 켤 수 있다
    if ($('classEventOn')) {
      $('classEventOn').checked = s.classOn;
      $('classEventOn').disabled = !s.configured || !s.enabled;
    }
    if ($('classEventBox')) $('classEventBox').classList.toggle('is-off', !s.enabled);

    if ($('cloudHidden')) {
      $('cloudHidden').checked = Cloud.hiddenOn();
      $('cloudHidden').disabled = !s.configured || !s.enabled;
    }

    ['cloudTest', 'cloudSync'].forEach(function (id) {
      if ($(id)) $(id).disabled = !s.configured;
    });

    var el = $('cloudStatus');
    if (!el) return;
    if (!s.configured) {
      el.className = 'neis-status show warn';
      el.innerHTML = '서버가 아직 연결돼 있지 않습니다. ' +
        '<b>supabase/schema.sql</b> 을 실행하고 <b>src/js/cloud.js</b> 상단에 프로젝트 주소와 anon 키를 넣으면 켜집니다. ' +
        '그때까지 리그는 이 브라우저가 아는 학교만 보여 줍니다.';
      return;
    }
    if (!s.enabled) {
      el.className = 'neis-status show';
      el.textContent = '전송이 꺼져 있습니다. 이 기기의 기록은 밖으로 나가지 않습니다.';
      return;
    }
    el.className = 'neis-status show ok';
    el.innerHTML = '참가 중 · 기기 번호 <b>' + esc(String(s.deviceId).slice(0, 8)) + '…</b>' +
      (s.lastSync ? ' · 마지막 동기화 ' + agoText(s.lastSync) : ' · 아직 동기화 전') +
      (s.lastError ? '<br><span style="color:var(--bad)">최근 오류 — ' + esc(s.lastError) + '</span>' : '');
  }

  /** 서버에 올리고 받아 온 뒤 리그를 다시 그린다. 학생 개별 공유도 같은 타이밍에 함께 올린다. */
  function leagueSync(force) {
    studentShareSync(force);   // 리그와 별개 스위치지만, 동기화 타이밍은 같이 탄다

    if (!Cloud.enabled()) return;
    League.syncNow(force).then(function (ok) {
      if (ok) { renderLeague(); renderCloudSettings(); }
    }, function () {
      renderCloudSettings();   // 실패해도 화면은 그대로 두고 사유만 남긴다
    });
  }

  /* pfLeague(프로필 화면)·cloudOn(설정 화면) 둘 다 이 로직을 그대로 쓴다.
   * 프로필을 처음 쓰는 중이라 Store.profile() 이 아직 없어도 안전하다 —
   * leagueSync 내부의 League.syncNow/studentShareSync 는 프로필이 없으면
   * 조용히 아무것도 하지 않고, saveProfile() 이 저장 직후 한 번 더 불러 준다. */
  function wireLeagueToggle(id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (this.checked) {
        if (!confirm('학교명과 주간 학습 시간이 외부 서버로 전송됩니다.\n' +
                     '이름·학년·반과 개인 기록은 전송되지 않습니다.\n\n' +
                     '만 14세 미만이라면 보호자와 함께 결정하세요.\n\n참가할까요?')) {
          this.checked = false;
          return;
        }
        Cloud.setEnabled(true);
        renderCloudSettings();
        toast('학교 리그에 참가합니다. 동기화를 시작합니다.');
        leagueSync(true);
      } else {
        /* 학급 대항전을 켜 둔 상태였다면, 리그를 끄기 전에 학년·반을 지우는
         * 요청을 한 번 보낸다. 그냥 끄면 기기 번호만 버려질 뿐 서버에는
         * 학년·반이 남아 정리(60일) 때까지 떠 있게 된다. */
        var offNow = function () {
          Cloud.setEnabled(false);
          Cloud.forget();
          League.setCloudRows([], '');
          renderCloudSettings();
          renderLeague();
          toast('전송을 껐습니다. 기기 번호도 버려 서버 기록과의 연결을 끊었습니다.');
        };

        if (Cloud.classEnabled()) {
          Cloud.setClassEnabled(false);
          League.syncNow(true).then(offNow, offNow);   // 실패해도 끄는 건 그대로 진행한다
        } else {
          offNow();
        }
      }
    });
  }

  function initCloud() {
    if (!$('cloudOn') && !$('pfLeague')) return;

    wireLeagueToggle('cloudOn');
    wireLeagueToggle('pfLeague');

    if (!$('cloudOn')) { renderCloudSettings(); return; }

    $('classEventOn').addEventListener('change', function () {
      if (this.checked) {
        if (!Cloud.enabled()) {
          this.checked = false;
          toast('학교 리그를 먼저 켜 주세요.', true);
          return;
        }
        if (!confirm('학년·반이 학교명과 함께 서버로 전송됩니다.\n' +
                     '학급 순위를 집계하기 위한 것이며, 이름은 전송되지 않습니다.\n\n' +
                     '만 14세 미만이라면 보호자와 함께 결정하세요.\n\n참가할까요?')) {
          this.checked = false;
          return;
        }
        Cloud.setClassEnabled(true);
        renderCloudSettings();
        toast('학급 대항전에 참가합니다.');
        leagueSync(true);
      } else {
        Cloud.setClassEnabled(false);
        renderCloudSettings();
        // 끄는 것으로 끝내지 않는다. 빈 값을 올려 서버에 남은 학년·반을 지운다.
        leagueSync(true);
        toast('학급 대항전을 껐습니다. 서버에 저장된 학년·반도 지웁니다.');
      }
    });

    $('cloudHidden').addEventListener('change', function () {
      Cloud.setHidden(this.checked);
      renderCloudSettings();
      // 숨김 상태는 서버가 알아야 남에게 안 보인다. 바로 올린다.
      leagueSync(true);
      toast(this.checked
        ? '순위표에서 내 기록을 숨깁니다. 반 합계에는 그대로 들어가요.'
        : '순위표에 내 기록을 다시 표시합니다.');
    });

    $('cloudTest').addEventListener('click', function () {
      var el = $('cloudStatus');
      el.className = 'neis-status show';
      el.textContent = '확인 중…';
      Cloud.test(Store.key(Store.weekStart(new Date()))).then(function () {
        el.className = 'neis-status show ok';
        el.textContent = '서버에 연결됐습니다.';
      }, function (e) {
        el.className = 'neis-status show err';
        el.textContent = '연결하지 못했습니다 — ' + (e.message || '알 수 없는 오류');
      });
    });

    $$('#lgModes .lg-mode').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.leagueMode = btn.dataset.mode;
        state.lgSchool = ''; state.lgGrade = '';   // 판이 바뀌면 필터도 푼다
        renderLeague();
      });
    });
    $('lgFilterSchool').addEventListener('change', function () {
      state.lgSchool = $('lgFilterSchool').value; renderLeague();
    });
    $('lgFilterGrade').addEventListener('change', function () {
      state.lgGrade = $('lgFilterGrade').value; renderLeague();
    });

    $('cloudSync').addEventListener('click', function () {
      if (!Cloud.enabled()) { toast('먼저 리그 참가를 켜 주세요.', true); return; }
      toast('동기화 중…');
      leagueSync(true);
    });

    renderCloudSettings();
    initStudentShare();
  }

  /* ============================================================ 링크 공유
   * 친구를 부르려면 앱 주소를 보내면 된다. 그런데 그 주소를 직접 치게 하면
   * 아무도 안 한다. 그래서 한 번 눌러 바로 보낼 수 있게 해 둔다. */

  /** 지금 열려 있는 주소에서 해시·쿼리를 떼어 낸 "앱 주소" */
  function appUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  var SHARE_TEXT = '🧠 Mindora — 오늘 내 뇌 컨디션에 맞는 공부 계획을 짜 주는 앱이야.\n' +
                   '순공 시간으로 친구들이랑 겨루는 학교 리그도 있어. 설치 없이 링크만 열면 돼!';

  /** execCommand 는 사라지는 중이고 clipboard 는 권한이 필요하다 — 둘 다 시도한다 */
  function copyText(text, okMsg) {
    function done(ok) {
      toast(ok ? okMsg : '복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
      return;
    }
    fallback();

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
  }

  function initShare() {
    if (!$('shareUrl')) return;

    var url = appUrl();
    $('shareUrl').value = url;

    /* 모바일에는 OS 공유 시트가 있다. 있으면 그걸 쓰는 게 압도적으로 편하다.
     * 데스크톱 브라우저 대부분은 없으므로 복사로 대체한다.
     * 이때 두 버튼이 모두 "복사"가 되면 뭐가 다른지 알 수 없으니 라벨을 갈라 준다. */
    var canShare = !!(navigator.share);
    $('shareApp').textContent = canShare ? '📤 공유하기' : '📋 초대 메시지 복사';
    $('copyUrl').textContent = canShare ? '주소 복사' : '🔗 주소만';
    $('shareHint').textContent = canShare
      ? '카카오톡·문자·인스타 어디로든 보낼 수 있어요.'
      : '초대 메시지에는 앱 소개와 주소가 함께 담깁니다.';

    $('shareApp').addEventListener('click', function () {
      if (canShare) {
        navigator.share({ title: 'Mindora', text: SHARE_TEXT, url: url })
          .catch(function () { /* 사용자가 취소한 경우 — 아무 말도 하지 않는다 */ });
      } else {
        copyText(SHARE_TEXT + '\n' + url, '초대 메시지를 복사했어요!');
      }
    });

    $('copyUrl').addEventListener('click', function () {
      copyText(url, '앱 주소를 복사했어요!');
    });

    $('shareUrl').addEventListener('focus', function () { this.select(); });
  }

  /* --------------------------------------------------- 학생 개별 공유 옵트인
   * 리그(cloudOn)와는 별개의 스위치다. 여긴 닉네임이 그대로 나가므로
   * 동의 문구도, 되돌리는 방법도 리그보다 한 단계 더 명확하게 짚는다. */

  function renderStudentShareSettings() {
    if (!$('studentShareOn')) return;
    var s = Cloud.studentShareStatus();

    $('studentShareOn').checked = s.enabled;
    $('studentShareOn').disabled = !s.configured;

    var el = $('studentShareStatus');
    if (!s.configured) {
      el.className = 'neis-status show';
      el.textContent = '서버가 연결되지 않아 이 기능을 쓸 수 없습니다.';
      return;
    }
    el.className = s.enabled ? 'neis-status show ok' : 'neis-status show';
    el.innerHTML = s.enabled
      ? '공유 중 · ' + (s.lastPush ? '마지막 전송 ' + agoText(s.lastPush) : '아직 전송 전') +
        (s.lastError ? '<br><span style="color:var(--bad)">오류 — ' + esc(s.lastError) + '</span>' : '')
      : '꺼져 있습니다. 닉네임이 서버로 나가지 않습니다.';
  }

  function studentShareSync(force) {
    if (!Cloud.studentShareEnabled()) return;
    var p = Store.profile();
    if (!p) return;
    var wk = Store.key(Store.weekStart(new Date()));
    Cloud.pushStudent(p.nick, p.school, wk, League.myCappedWeek(), force)
      .then(function () { renderStudentShareSettings(); },
            function () { renderStudentShareSettings(); });
  }

  function initStudentShare() {
    if (!$('studentShareOn')) return;

    $('studentShareOn').addEventListener('change', function () {
      if (this.checked) {
        if (!confirm('내 닉네임과 학교명, 주간 학습 시간이 관리자 계정에 그대로 보입니다.\n' +
                     '(익명 처리되지 않습니다 — 관리자는 "누구"인지 압니다)\n\n' +
                     '만 14세 미만이라면 반드시 보호자와 함께 결정하세요.\n\n동의하고 켤까요?')) {
          this.checked = false;
          return;
        }
        Cloud.setStudentShareEnabled(true);
        renderStudentShareSettings();
        toast('관리자에게 내 기록을 보여줍니다.');
        studentShareSync(true);
      } else {
        Cloud.setStudentShareEnabled(false);
        Cloud.forgetStudent();
        renderStudentShareSettings();
        toast('공유를 껐습니다. 앞으로 닉네임이 전송되지 않습니다.');
      }
    });

    renderStudentShareSettings();
  }

  /** 주가 바뀌었으면 승급·강등을 정산하고 결과를 한 번 보여 준다 */
  function leagueSettle() {
    League.settleIfNeeded();

    var b = League.board();
    if (!b || !b.lastResult) return;

    var r = b.lastResult;
    var el = document.createElement('div');
    el.className = 'lg-settle ' + r.result;
    el.textContent = r.result === 'promote'
      ? '지난주 ' + r.rank + '위 — ' + r.toTier + ' 리그로 올라갔어요!'
      : r.result === 'demote'
        ? '지난주 ' + r.rank + '위 — ' + r.toTier + ' 리그로 내려갔어요. 이번 주에 다시 올라가요'
        : '지난주 ' + r.rank + '위 — ' + r.toTier + ' 리그를 지켰어요';

    var host = $('secLeague');
    if (host) host.insertBefore(el, $('lgRail'));

    if (r.result === 'promote') toast('🏆 ' + r.toTier + ' 리그로 승급했습니다!', 'party');
    League.clearResult();
  }

  /* ================================================================ 관리자 모드
   * 두 층으로 나뉜다.
   *   ① 서버 목록(학생이 "관리자에게 내 기록 보이기"를 켰을 때만) — 실제 로그인 필요
   *   ② 이 기기 기록(예전부터 있던 것) — 로그인 없이도 "나"와 공유 코드 그룹원만 보임
   * ①은 여러 기기를 아우르는 진짜 데이터고, ②는 이 브라우저 하나에 갇힌 데이터다.
   * 화면에서도 구분해 보여 준다. */

  var adminState = { users: [], students: [], schoolAgg: [], leagueMembers: [] };

  function collectAllUsers() {
    var users = [];
    var sess = Store.sessions();
    var grp = Store.group();
    var prof = Store.profile();
    var hist = Store.history();

    if (prof) {
      /* sessions 는 { 날짜: { 과목: {t: 유형, m: 분} } } 구조라
       * 과목 객체의 m 을 꺼내야 한다. */
      var totalMinutes = 0, activeDays = 0;
      Object.keys(sess).forEach(function (date) {
        var dayData = sess[date], dayMin = 0;
        Object.keys(dayData).forEach(function (subj) { dayMin += (dayData[subj].m || 0); });
        totalMinutes += dayMin;
        if (dayMin > 0) activeDays++;
      });

      var avgScore = 0;
      if (hist.length) {
        var sum = 0;
        hist.forEach(function (h) { sum += (h.overall || 0); });
        avgScore = Math.round(sum / hist.length);
      }

      /* 마지막 활동 = 공부 기록과 컨디션 기록 중 더 최근 날짜 */
      var lastStudy = Object.keys(sess).sort().pop() || '';
      var lastHist = hist.length ? hist[hist.length - 1].date : '';
      var last = lastStudy > lastHist ? lastStudy : lastHist;

      users.push({
        id: Group.memberId(prof),
        name: prof.nick,
        school: prof.school,
        badge: prof.level,           // 학년은 groupLabel 에 이미 들어 있다
        groupId: Group.groupId(prof),
        groupLabel: Group.groupLabel(prof),
        totalMinutes: totalMinutes,
        totalHours: Math.round(totalMinutes / 60),
        sessionCount: activeDays,
        avgScore: avgScore,
        lastActive: last || 'N/A',
        self: true
      });
    }

    grp.members.forEach(function (m) {
      var dup = users.filter(function (u) { return u.id === m.id; }).length > 0;
      if (!dup) {
        users.push({
          id: m.id,
          name: m.nick,
          school: m.school || 'N/A',
          badge: m.level || '기타',
          groupId: m.groupId,
          groupLabel: Group.groupLabel(m),
          /* 공유 코드에는 누적 기록이 없다. 받은 시점의 주간 합계가 최선이다. */
          totalMinutes: m.weekMin || 0,
          totalHours: Math.round((m.weekMin || 0) / 60),
          sessionCount: m.streak || 0,
          avgScore: m.overall || 0,
          lastActive: m.date || (m.ts ? Store.key(new Date(m.ts)) : 'N/A'),
          self: false
        });
      }
    });

    return users;
  }

  function calculateAdminStats() {
    var users = collectAllUsers();
    var stats = {
      totalUsers: users.length,
      activeToday: 0,
      totalMinutes: 0,
      avgScore: 0
    };

    var today = Store.key();
    var scoreSum = 0, scoreCount = 0;

    users.forEach(function (u) {
      stats.totalMinutes += u.totalMinutes;
      if (u.lastActive === today) stats.activeToday++;
      if (u.avgScore > 0) { scoreSum += u.avgScore; scoreCount++; }
    });

    if (scoreCount) stats.avgScore = Math.round(scoreSum / scoreCount);

    adminState.users = users;
    return stats;
  }

  function renderAdminStats() {
    var stats = calculateAdminStats();
    var m = Math.round(stats.totalMinutes);
    $('totalUsers').textContent = stats.totalUsers;
    $('activeToday').textContent = stats.activeToday;
    $('totalStudyHours').textContent = Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    $('avgScore').textContent = stats.avgScore || '—';
  }

  function renderAdminUsersList() {
    var searchTerm = ($('adminSearch').value || '').toLowerCase();
    var filtered = adminState.users.filter(function (u) {
      return (u.name + u.school + u.groupLabel).toLowerCase().indexOf(searchTerm) >= 0;
    });

    var html = filtered.map(function (u) {
      /* 내 기록은 누적 전체, 그룹원은 코드를 받은 시점의 주간 합계다.
       * 같은 칸에 다른 뜻을 넣으면 헷갈리므로 라벨을 나눈다. */
      return '<div class="admin-user-card">' +
        '<div class="auc-header">' +
          '<div>' +
            '<div class="auc-name">' + esc(u.name) + (u.self ? ' (나)' : '') + '</div>' +
            '<div class="auc-group">' + esc(u.groupLabel) + '</div>' +
          '</div>' +
          '<div class="auc-badge">' + esc(u.badge) + '</div>' +
        '</div>' +
        '<div class="auc-stats">' +
          '<div class="aus-item"><div class="aus-label">' + (u.self ? '누적 공부' : '이번 주') + '</div>' +
            '<div class="aus-value">' + fmtDur(u.totalMinutes) + '</div></div>' +
          '<div class="aus-item"><div class="aus-label">' + (u.self ? '평균 컨디션' : '최근 컨디션') + '</div>' +
            '<div class="aus-value">' + (u.avgScore ? u.avgScore + '점' : '—') + '</div></div>' +
        '</div>' +
        '<div class="auc-stats">' +
          '<div class="aus-item"><div class="aus-label">' + (u.self ? '공부한 날' : '연속 학습') + '</div>' +
            '<div class="aus-value">' + u.sessionCount + '일</div></div>' +
          '<div class="aus-item"><div class="aus-label">마지막 활동</div>' +
            '<div class="aus-value">' + esc(u.lastActive) + '</div></div>' +
        '</div>' +
      '</div>';
    }).join('');

    $('adminUsersList').innerHTML = html || '<div class="adm-empty">조건에 맞는 사용자가 없습니다.</div>';
  }

  /** 날짜별로 무엇을 얼마나 했는지 — 내 실제 기록이 근거다 */
  function renderAdminTimeline() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var from = Store.addDays(today, -13);
    var days = StudyLog.rangeDays(from, today);
    var max = Math.max.apply(null, days.map(function (d) { return d.min; }).concat([1]));

    var html = days.slice().reverse().map(function (d) {
      var subs = StudyLog.daySubjects(d.date);
      var rec = Store.recordOn(d.date);
      var md = d.date.slice(5).replace('-', '.');

      return '<div class="adm-day' + (d.min > 0 ? '' : ' empty') + '">' +
        '<div class="d-date">' + md + '<small>' + d.dow + '요일' + (d.isToday ? ' · 오늘' : '') + '</small></div>' +
        '<div>' +
          '<div class="d-bar"><i style="width:' + (d.min > 0 ? Math.max(3, (d.min / max) * 100) : 0) + '%"></i></div>' +
          '<div class="d-subs">' + (subs.length
            ? subs.map(function (s) { return esc(s.name) + ' ' + Math.round(s.min) + '분'; }).join(' · ')
            : '기록 없음') + '</div>' +
        '</div>' +
        '<div><span class="d-min">' + (d.min > 0 ? fmtDur(d.min) : '—') + '</span>' +
          '<span class="d-score">' + (rec ? '컨디션 ' + rec.overall + '점' : '&nbsp;') + '</span></div>' +
      '</div>';
    }).join('');

    $('adminTimeline').innerHTML = html;
  }

  /** 최근에 무슨 일이 있었는지 시간순으로 */
  function renderAdminFeed() {
    var events = [];
    var p = Store.profile();
    var meId = p ? Group.memberId(p) : null;

    // 내 뇌 컨디션 기록
    Store.history().forEach(function (h) {
      events.push({
        ts: h.ts, icon: '🧠',
        text: '<b>' + esc(p ? p.nick : '나') + '</b> 님이 컨디션을 분석했습니다',
        sub: '종합 ' + h.overall + '점 · 수면 ' + h.sleep + '시간 · 스트레스 ' + h.stress
      });
    });

    // 그룹원이 코드를 넘겨준 시점의 스냅숏
    Group.members().forEach(function (m) {
      if (m.id === meId) return;
      events.push({
        ts: m.ts, icon: '👤',
        text: '<b>' + esc(m.nick) + '</b> 님의 기록이 들어왔습니다',
        sub: Group.groupLabel(m) + ' · 오늘 ' + fmtDur(m.todayMin || 0) +
             ' · 이번 주 ' + fmtDur(m.weekMin || 0) +
             (m.streak ? ' · ' + m.streak + '일 연속' : '')
      });
    });

    events.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });

    if (!events.length) {
      $('adminFeed').innerHTML = '<div class="adm-empty">아직 기록된 활동이 없습니다.</div>';
      return;
    }

    $('adminFeed').innerHTML = events.slice(0, 30).map(function (e) {
      return '<div class="adm-ev">' +
        '<span class="e-ic">' + e.icon + '</span>' +
        '<span class="e-txt">' + e.text + '<span class="e-sub">' + esc(e.sub) + '</span></span>' +
        '<span class="e-ago">' + agoText(e.ts) + '</span>' +
      '</div>';
    }).join('');
  }

  var ADMIN_LOCAL_CARDS = '#adminStatsCard, #adminUsersCard, #adminActivityCard, #adminFeedCard, #adminScopeNote';
  var ADMIN_SERVER_CARDS = '#adminStudentsCard, #adminLeagueMembersCard, #adminSchoolAggCard, #adminServerScopeNote';

  function renderAdminLocal() {
    renderAdminStats();
    renderAdminUsersList();
    renderAdminTimeline();
    renderAdminFeed();
  }

  /** 서버에 등록된 학생 개별 기록 — 로그인된 관리자만 부를 수 있다 */
  function renderAdminStudents() {
    var wk = Store.key(Store.weekStart(new Date()));
    var statusEl = $('adminStudentsStatus');
    statusEl.textContent = '불러오는 중…';

    return Cloud.fetchStudentWeek(wk).then(function (rows) {
      adminState.students = rows;
      statusEl.textContent = rows.length
        ? rows.length + '명 · 방금 갱신'
        : '아직 아무도 공유하지 않았습니다.';
      drawAdminStudents();
    }, function (e) {
      if (e.status === 401) {
        statusEl.textContent = '';
        adminShowLoggedOut('세션이 만료됐습니다. 다시 로그인해 주세요.');
      } else {
        statusEl.textContent = '불러오지 못했습니다 — ' + (e.message || '알 수 없는 오류');
      }
    });
  }

  function drawAdminStudents() {
    var q = ($('adminStudentSearch').value || '').toLowerCase();
    var rows = adminState.students.filter(function (r) {
      return (r.nickname + r.schoolName).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return b.minutes - a.minutes; });

    var html = rows.map(function (r) {
      return '<div class="admin-user-card">' +
        '<div class="auc-header">' +
          '<div>' +
            '<div class="auc-name">' + esc(r.nickname) + '</div>' +
            '<div class="auc-group">' + esc(r.schoolName) + '</div>' +
          '</div>' +
          '<div class="auc-badge">' + esc(agoText(r.updatedAt)) + '</div>' +
        '</div>' +
        '<div class="auc-stats">' +
          '<div class="aus-item"><div class="aus-label">이번 주 순공</div>' +
            '<div class="aus-value">' + fmtDur(r.minutes) + '</div></div>' +
        '</div>' +
        '<div class="auc-act">' +
          '<button type="button" class="btn ghost sm adm-del" data-device="' + esc(r.deviceId) +
            '" data-label="' + esc(r.nickname + ' · ' + r.schoolName) + '">기록 삭제</button>' +
        '</div>' +
      '</div>';
    }).join('');

    $('adminStudentsList').innerHTML = html || '<div class="adm-empty">조건에 맞는 학생이 없습니다.</div>';
    bindAdminDelete($('adminStudentsList'));
  }

  /** 학교 리그(익명 합계)도 관리자 화면에 같이 보여 준다 — 개인 목록과의 차이를 비교하도록 */
  function renderAdminSchoolAgg() {
    var wk = Store.key(Store.weekStart(new Date()));
    return Cloud.fetchWeek(wk).then(function (rows) {
      adminState.schoolAgg = rows;
      if (!rows.length) {
        $('adminSchoolAgg').innerHTML = '<div class="adm-empty">아직 리그에 참가한 학교가 없습니다.</div>';
        return;
      }
      $('adminSchoolAgg').innerHTML = rows
        .sort(function (a, b) { return b.total - a.total; })
        .map(function (r) {
          return '<div class="adm-ev">' +
            '<span class="e-ic">🏫</span>' +
            '<span class="e-txt"><b>' + esc(r.schoolName) + '</b>' +
              '<span class="e-sub">참여 ' + r.active + '명 · ' + agoText(r.updatedAt) + '</span></span>' +
            '<span class="e-ago">' + fmtDur(r.total) + '</span>' +
          '</div>';
        }).join('');
    }, function () { /* 리그를 안 켰으면 자연스럽게 비어 있다 — 조용히 둔다 */ });
  }

  /* 잘못 올라온 기록을 지운다. 거짓 정보나 오류로 들어온 값을 운영자가 정리할
   * 수 있어야 판이 굴러간다. 리그와 학생 목록 양쪽에서 함께 사라진다. */
  function bindAdminDelete(root) {
    $$('.adm-del', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var label = btn.dataset.label || '이 기록';
        var wk = Store.key(Store.weekStart(new Date()));
        if (!confirm(label + '\n\n이번 주 기록을 삭제할까요?\n' +
                     '리그 순위와 학생 목록 양쪽에서 사라지며 되돌릴 수 없습니다.\n\n' +
                     '※ 그 학생이 앱을 계속 쓰면 다음 동기화 때 다시 올라옵니다.')) return;

        btn.disabled = true;
        Cloud.adminDeleteDevice(btn.dataset.device, wk).then(function (n) {
          toast(n + '개 기록을 삭제했습니다.');
          renderAdminServer();
        }, function (e) {
          btn.disabled = false;
          toast('삭제하지 못했습니다 — ' + (e.message || '알 수 없는 오류'), true);
        });
      });
    });
  }

  /* 리그에만 참가한 학생들. 이름이 없으므로 기기 번호 앞자리로만 구분한다.
   * 같은 사람을 계속 알아볼 수는 있어도 누구인지는 알 수 없다 — 의도한 선이다. */
  function renderAdminLeagueMembers() {
    var wk = Store.key(Store.weekStart(new Date()));
    var statusEl = $('adminLeagueStatus');
    var listEl = $('adminLeagueMembers');
    statusEl.textContent = '불러오는 중…';

    return Cloud.fetchLeagueMembers(wk).then(function (rows) {
      adminState.leagueMembers = rows;
      var sum = rows.reduce(function (a, r) { return a + r.minutes; }, 0);
      statusEl.textContent = rows.length
        ? rows.length + '명 · 합계 ' + fmtDur(sum) + ' · 방금 갱신'
        : '이번 주에 리그 시간을 올린 참가자가 아직 없습니다.';

      listEl.innerHTML = rows.map(function (r) {
        return '<div class="adm-ev">' +
          '<span class="e-ic">🙈</span>' +
          '<span class="e-txt"><b>익명 ' + esc(r.deviceId.slice(0, 4).toUpperCase()) + '</b>' +
            '<span class="e-sub">' + esc(r.schoolName) + ' · ' + esc(agoText(r.updatedAt)) + '</span></span>' +
          '<span class="e-ago">' + fmtDur(r.minutes) + '</span>' +
          '<button type="button" class="icon-btn adm-del" data-device="' + esc(r.deviceId) +
            '" data-label="' + esc(r.schoolName + ' · 익명 ' + r.deviceId.slice(0, 4).toUpperCase()) +
            '" title="이 기록 삭제">✕</button>' +
        '</div>';
      }).join('') || '<div class="adm-empty">아직 참가자가 없습니다.</div>';

      bindAdminDelete(listEl);
    }, function (e) {
      if (e.status === 401) {
        statusEl.textContent = '';
        adminShowLoggedOut('세션이 만료됐습니다. 다시 로그인해 주세요.');
        return;
      }
      listEl.innerHTML = '';
      /* 권한이 없으면 PostgREST 가 401/403 을 준다 — 대개 SQL 을 아직 안 돌린 경우다.
       * "오류" 로만 적어 두면 무엇을 해야 하는지 알 수 없어 파일 이름까지 적는다. */
      statusEl.textContent = (e.status === 403 || e.status === 401)
        ? '권한이 없습니다 — Supabase SQL Editor 에서 supabase/schema_admin_league.sql 을 한 번 실행해 주세요.'
        : '불러오지 못했습니다 — ' + (e.message || '알 수 없는 오류');
    });
  }

  function renderAdminServer() {
    renderAdminStudents();
    renderAdminLeagueMembers();
    renderAdminSchoolAgg();
  }

  /** 로그인 화면으로 되돌린다. 세션 만료 때도 이걸 쓴다. */
  function adminShowLoggedOut(msg) {
    $('adminAuthSection').classList.remove('is-hidden');
    $('adminContent').classList.add('is-hidden');
    $$(ADMIN_SERVER_CARDS).forEach(function (el) { el.classList.add('is-hidden'); });
    $$(ADMIN_LOCAL_CARDS).forEach(function (el) { el.classList.add('is-hidden'); });
    if (msg) { $('adminAuthStatus').className = 'neis-status show warn'; $('adminAuthStatus').textContent = msg; }
  }

  function adminShowLoggedIn() {
    var s = Cloud.adminSession();
    $('adminAuthSection').classList.add('is-hidden');
    $('adminContent').classList.remove('is-hidden');
    $('adminWhoAmI').textContent = s ? ('로그인: ' + s.email) : '';
    $$(ADMIN_SERVER_CARDS).forEach(function (el) { el.classList.remove('is-hidden'); });
    $$(ADMIN_LOCAL_CARDS).forEach(function (el) { el.classList.remove('is-hidden'); });
    renderAdminServer();
    renderAdminLocal();
  }

  function adminLogin() {
    var email = $('adminEmail').value;
    var pw = $('adminPassword').value;
    var statusEl = $('adminAuthStatus');
    statusEl.className = 'neis-status show';
    statusEl.textContent = '로그인 중…';

    Cloud.adminSignIn(email, pw).then(function () {
      $('adminPassword').value = '';
      statusEl.className = 'neis-status';
      statusEl.textContent = '';
      adminShowLoggedIn();
      toast('관리자로 로그인했습니다.');
    }, function (e) {
      statusEl.className = 'neis-status show err';
      statusEl.textContent = e.message || '로그인에 실패했습니다.';
    });
  }

  function logoutAdmin() {
    Cloud.adminSignOut();
    adminShowLoggedOut();
    toast('로그아웃했습니다.');
  }

  /** 앱을 새로 열었을 때 세션이 남아 있으면 로그인 화면을 건너뛴다 */
  function initAdminSession() {
    if (!$('adminAuthSection')) return;
    if (Cloud.adminSession()) adminShowLoggedIn();
    else adminShowLoggedOut();
  }

  function init() {
    initRanges(); initSegs(); initClock(); initTimer(); initSound(); initSchoolAc(); initNeis(); initCloud(); initTimetable(); initVacPlan();

    /* 저장 공간 영구 보관을 신청한다. 거절돼도 앱 동작에는 영향이 없고,
     * 크롬 계열은 방문이 쌓이면 나중에 조용히 승격시켜 준다. */
    Store.requestPersist().then(function () { renderStorageStatus(); });

    // 끼니를 체크하면 급식 안내 문구도 다시 계산한다
    ['mealBreakfast', 'mealLunch', 'mealDinner'].forEach(function (id) {
      $(id).addEventListener('change', function () { renderMeals(); });
    });

    $('detailToggle').addEventListener('click', function () { toggleDetail(); });
    $('resultMore').addEventListener('click', toggleResultDetail);
    $('planMore').addEventListener('click', togglePlanDetail);
    $('queueEditBtn').addEventListener('click', toggleQueueEdit);
    DETAIL_IDS.forEach(function (id) {
      $(id).addEventListener('input', updateDetailSummary);
      $(id).addEventListener('change', updateDetailSummary);
    });
    ['startTime', 'bedTime', 'availableHours'].forEach(function (id) {
      $(id).addEventListener('input', updateCurfewHint);
      $(id).addEventListener('change', updateCurfewHint);
    });

    var now = new Date();
    $('startTime').value = pad(now.getHours()) + ':' + pad(Math.floor(now.getMinutes() / 5) * 5);

    var saved = Store.loadInput();
    if (saved) applyInput(saved);
    else { addSubjectRow({ name: '', type: 'calculate' }); addSubjectRow({ name: '', type: 'memorize' }); }

    /* 프로필 게이트 */
    $('pfLevel').addEventListener('change', function () { fillGradeOptions(); });
    $('saveProfile').addEventListener('click', saveProfile);
    $('cancelProfile').addEventListener('click', function () { goPage(Store.profile() ? 'secSettings' : 'secProfile'); });
    $('profileChip').addEventListener('click', function () { openProfile(true); });

    $('editProfile').addEventListener('click', function () { openProfile(true); });
    initAvatarPage();

    if (Store.profile()) {
      renderProfileChip();
      renderNav();
      // 주소창 해시가 있으면 그 페이지로, 없으면 입력 화면으로 시작
      var pg = pageByHash((location.hash || '').replace('#', ''));
      goPage(pg ? pg.id : 'secInput', true);
    } else {
      fillGradeOptions();
      $('cancelProfile').style.display = 'none';
      renderNav();
      goPage('secProfile', true);
    }

    window.addEventListener('hashchange', function () {
      var pg = pageByHash((location.hash || '').replace('#', ''));
      if (pg && pg.id !== state.page) goPage(pg.id, true);
    });

    /* 입력 */
    $('addSubject').addEventListener('click', function () {
      if ($$('.subject-row', $('subjectList')).length >= 8) { toast('과목은 최대 8개까지 추가할 수 있습니다.', true); return; }
      addSubjectRow().querySelector('.s-name').focus();
    });
    $('analyzeBtn').addEventListener('click', runAnalysis);
    $('sampleBtn').addEventListener('click', function () {
      applyInput(SAMPLE);
      toast('예시 데이터를 채웠습니다 — 수면 부족·고스트레스 시나리오');
    });
    $('resetBtn').addEventListener('click', function () {
      if (!confirm('입력값을 초기화할까요? (저장된 학습 기록과 그룹은 유지됩니다)')) return;
      applyInput({
        sleep: { hours: 7, quality: 3, regularity: 3 },
        stress: 4, fatigue: 4, mood: 3,
        meals: { breakfast: true, lunch: true, dinner: false },
        hoursSinceMeal: 2, water: 4, caffeine: 1, exercise: 0,
        availableHours: 4, subjects: []
      });
      toast('초기화했습니다.');
    });

    $('startTimerBtn').addEventListener('click', function () {
      goto('secTimer');
      setTimeout(function () { if (!state.timer.running) state.timer.start(); }, 500);
    });

    /* 랭킹 */
    $$('#rankTabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.rankRange = b.dataset.range;
        $$('#rankTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderGroup();
      });
    });
    $('copyCode').addEventListener('click', function () {
      var el = $('myCode');
      el.select(); el.setSelectionRange(0, 99999);
      var okCopy = false;
      try { okCopy = document.execCommand('copy'); } catch (e) { okCopy = false; }
      if (navigator.clipboard && !okCopy) {
        navigator.clipboard.writeText(el.value).then(function () { toast('공유 코드를 복사했습니다.'); },
          function () { toast('복사에 실패했습니다. 직접 선택해 복사해 주세요.', true); });
      } else {
        toast(okCopy ? '공유 코드를 복사했습니다.' : '복사에 실패했습니다. 직접 선택해 복사해 주세요.', !okCopy);
      }
    });
    $('addMember').addEventListener('click', function () {
      var p = Store.profile();
      try {
        var m = Group.decode($('joinCode').value);
        if (m.id === Group.memberId(p)) { toast('본인 코드는 추가할 수 없습니다.', true); return; }
        if (m.groupId !== Group.groupId(p)) {
          if (!confirm(m.nick + ' 님은 다른 그룹(' + Group.groupLabel(m) + ')입니다.\n그래도 추가할까요? 랭킹에는 같은 그룹만 표시됩니다.')) return;
        }
        Group.upsert(m);
        $('joinCode').value = '';
        renderGroup();
        renderLeague();
        toast(m.nick + ' 님을 그룹에 추가했습니다.');
      } catch (e) {
        toast(e.message || '코드를 읽을 수 없습니다.', true);
      }
    });

    initShare();

    /* 리포트 */
    $('prevWeek').addEventListener('click', function () { state.weekOffset--; renderReport(); });
    $('nextWeek').addEventListener('click', function () { if (state.weekOffset < 0) { state.weekOffset++; renderReport(); } });
    $('thisWeek').addEventListener('click', function () { state.weekOffset = 0; renderReport(); });
    $('exportData').addEventListener('click', exportData);
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importData(f);
    });

    $('clearHistory').addEventListener('click', function () {
      if (!confirm('학습 기록·뇌 컨디션 기록·그룹원을 모두 삭제할까요?\n모은 배지와 경험치도 함께 사라지며 되돌릴 수 없습니다.')) return;
      Store.clearAll();
      Kids.reset();
      League.reset();
      renderGroup(); renderReport(); renderLiveTotal(); renderKids(); renderSettingsPage();
      renderLeague();
      toast('모든 기록을 삭제했습니다.');
    });

    // 관리자 모드 이벤트
    $('adminLogin').addEventListener('click', adminLogin);
    $('adminLogout').addEventListener('click', logoutAdmin);
    $('adminPassword').addEventListener('keypress', function (e) {
      if (e.key === 'Enter') adminLogin();
    });
    $('adminSearch').addEventListener('input', renderAdminUsersList);
    $('adminStudentSearch').addEventListener('input', drawAdminStudents);
    $('adminStudentRefresh').addEventListener('click', renderAdminStudents);
    $('adminLeagueRefresh').addEventListener('click', renderAdminLeagueMembers);
    /* 들어갈 때마다 세션을 다시 본다. 한 번만 확인하면, 토큰이 만료된 뒤
     * 다시 들어왔을 때 지난번 학생 목록이 화면에 그대로 남는다.
     * 겸사겸사 목록도 새로 받아 오게 된다. */
    $('openAdmin').addEventListener('click', function () {
      goPage('secAdmin');
      initAdminSession();
    });
    initAdminSession();

    // 카드 안에서 다른 페이지로 보내는 링크 버튼들
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goPage(b.dataset.goto); });
    });

    renderSettingsPage();
    renderMeals();
    if (Store.profile()) { fillTtGradeOptions(Store.profile().grade); $('ttClass').value = Store.profile().klass || ''; }
    renderTimetable();
    renderQuickNote();
    updateDetailSummary();
    updateCurfewHint();
    renderLiveTotal();
    renderGroup();
    renderReport();
    renderKids();
    if (Store.profile()) { leagueSettle(); renderLeague(); leagueSync(false); }
    weeklyNotice();

    if (!Store.available) toast('브라우저 저장소를 쓸 수 없어 기록이 유지되지 않습니다.', true);

    initIntro();
    initInstallPrompt();
    registerServiceWorker();
  }

  /* 서비스 워커 — 홈 화면 설치와 오프라인 실행을 위해 필요하다.
   * file:// 로 열었을 때는 등록 자체가 불가능하므로 조용히 건너뛴다.
   * (README 대로 index.html 을 더블클릭해서 쓰는 경로가 살아 있어야 한다) */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js')['catch'](function () {
      // 등록에 실패해도 앱 동작에는 지장이 없다 — 설치·오프라인만 빠진다
    });
  }

  /* ============================================================ 홈 화면 설치
   *
   * 매일 여는 앱은 홈 화면 아이콘이 있어야 실제로 매일 열린다.
   * 안드로이드·크롬은 beforeinstallprompt 로 설치 창을 띄울 수 있지만,
   * iOS 사파리는 그 이벤트가 없어서 "공유 → 홈 화면에 추가" 를 직접 안내해야 한다.
   * 이미 설치해서 standalone 으로 열었다면 아무것도 보여 주지 않는다. */

  var deferredInstall = null;
  var INSTALL_DISMISS_KEY = 'neurostudy.installDismissed.v1';

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  function installDismissed() {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function dismissInstall() {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) { /* 무시 */ }
    var el = $('installBar');
    if (el) el.classList.add('is-hidden');
  }

  function showInstallBar(mode) {
    var el = $('installBar');
    if (!el || isStandalone() || installDismissed()) return;

    $('installText').innerHTML = mode === 'ios'
      ? '홈 화면에 추가하면 앱처럼 바로 열 수 있어요 — 아래 <b>공유 <span aria-hidden="true">⎋</span></b> 를 누르고 <b>“홈 화면에 추가”</b>를 고르세요.'
      : '홈 화면에 추가하면 앱처럼 바로 열 수 있어요.';

    $('installGo').classList.toggle('is-hidden', mode === 'ios');
    el.classList.remove('is-hidden');
  }

  /* ================================================================= 인트로
   *
   * 앱 화면에 들어가기 전에 소개를 한 번 보여 준다.
   * 매번 뜨면 매일 쓰는 사람에게는 방해가 되므로, 이미 본 사람에게는
   * 건너뛴다. (다시 보게 하려면 아래 키를 지우면 된다) */

  var INTRO_SEEN_KEY = 'neurostudy.introSeen.v1';

  function introSeen() {
    try { return localStorage.getItem(INTRO_SEEN_KEY) === '1'; } catch (e) { return false; }
  }

  function closeIntro() {
    var el = $('intro');
    if (!el || el.hidden) return;
    try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch (e) { /* 무시 */ }
    el.classList.add('is-out');
    document.body.classList.remove('intro-open');
    var done = function () { el.hidden = true; el.classList.remove('is-out'); };
    // transitionend 가 오지 않는 환경(모션 축소 등)에서도 반드시 닫히게 한다
    var t = setTimeout(done, 400);
    el.addEventListener('transitionend', function () { clearTimeout(t); done(); }, { once: true });
  }

  function initIntro() {
    var el = $('intro');
    if (!el) return;
    $('introGo').addEventListener('click', closeIntro);
    if (introSeen()) return;
    el.hidden = false;
    document.body.classList.add('intro-open');
    $('introGo').focus();
  }

  function initInstallPrompt() {
    if (!$('installBar')) return;

    $('installClose').addEventListener('click', dismissInstall);
    $('installGo').addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function (r) {
        if (r && r.outcome === 'accepted') dismissInstall();
        deferredInstall = null;
      });
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();          // 크롬 기본 배너 대신 우리 배너를 쓴다
      deferredInstall = e;
      showInstallBar('prompt');
    });

    window.addEventListener('appinstalled', function () { dismissInstall(); });

    // iOS 는 beforeinstallprompt 가 없다 — 안내만 띄운다
    if (isIOS() && !isStandalone()) setTimeout(function () { showInstallBar('ios'); }, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
