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
    weekOffset: 0,
    page: 'secInput',
    pickedSchool: null,  // 나이스에서 고른 학교 (급식 조회용 코드 포함)
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
      document.body.appendChild(toastEl);
    }
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

  var PAGES = [
    { id: 'secInput', num: '1', label: '입력', hash: 'input' },
    { id: 'secResult', num: '2', label: '뇌 분석', hash: 'result', needAnalysis: true },
    { id: 'secPlan', num: '3', label: '학습 플랜', hash: 'plan', needAnalysis: true },
    { id: 'secTimer', num: '4', label: '타이머', hash: 'timer', needAnalysis: true },
    { id: 'secKids', num: '★', label: '내 성장', hash: 'grow', kidsOnly: true },
    { id: 'secGroup', num: '5', label: '랭킹', hash: 'rank' },
    { id: 'secReport', num: '6', label: '리포트', hash: 'report' },
    { id: 'secSettings', num: '⚙', label: '설정', hash: 'settings' },
    { id: 'secAdmin', num: '👑', label: '관리자', hash: 'admin' }
  ];
  var ALL_SECTIONS = PAGES.map(function (p) { return p.id; }).concat(['secProfile']);

  function pageBy(id) { return PAGES.filter(function (p) { return p.id === id; })[0] || null; }
  function pageByHash(h) { return PAGES.filter(function (p) { return p.hash === h; })[0] || null; }

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
    $('stepNav').innerHTML = open.map(function (p) {
      return '<button type="button" class="step" data-go="' + p.id + '"><i>' + p.num + '</i><span>' + esc(p.label) + '</span></button>';
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
      if ($$('.subject-row').length <= 1) { toast('과목은 최소 1개가 필요합니다.', true); return; }
      row.remove();
    });
    $('subjectList').appendChild(row);
    return row;
  }

  function readSubjects() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return $$('.subject-row').map(function (row, i) {
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
    return {
      startHour: startHour, hour: startHour,
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

    // 오프라인 후보를 먼저 띄우고, 나이스 결과가 오면 갈아 끼운다
    var useNeis = Neis.hasKey() && q.trim().length >= 2;
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
    $('pcAvatar').textContent = Group.initial(p.nick);
    $('pcAvatar').style.background = Group.avatarColor(p.nick);
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
    renderReport();
    renderKids();
    renderSettingsPage();
    renderMeals();
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

    renderRadar(a);
    renderCapBars(a);
    renderCapDetails(a);
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

  function animateNum(el, target) {
    var dur = 900, t0 = performance.now();
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
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
    if (level === 'high') return { t: '우수', c: '#067a55', b: '#e2f8ef' };
    if (level === 'mid') return { t: '보통', c: '#0670a1', b: '#e2f4fd' };
    return { t: '저하', c: '#a35c05', b: '#fdf1de' };
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
        var willOpen = !card.classList.contains('open');
        $$('.cd').forEach(function (c) { c.classList.remove('open'); });
        if (willOpen) card.classList.add('open');
        $$('.cap-bar').forEach(function (b) { b.classList.toggle('on', b === btn && willOpen); });
        if (willOpen) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  /* -------------------------------------------------------- 산출 근거 */

  function renderCapDetails(a) {
    $('capDetails').innerHTML = a.capacities.map(function (c, i) {
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

      return '<div class="cd' + (i === 0 ? ' open' : '') + '" data-cap="' + c.id + '">' +
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

    $('subjectPlans').innerHTML = p.subjects.map(function (s) {
      var dd = s.daysLeft === null ? '' :
        '<span class="sp-chip dday' + (s.daysLeft > 7 ? ' far' : '') + '">' + (s.daysLeft < 0 ? '종료' : (s.daysLeft === 0 ? 'D-DAY' : 'D-' + s.daysLeft)) + '</span>';
      return '<div class="sp" style="--c:' + s.color + '">' +
        '<div class="sp-top"><span class="sp-name">' + esc(s.name) + '</span>' +
        '<span class="sp-chip">' + s.typeIcon + ' ' + esc(s.typeLabel) + '</span>' + dd +
        '<span class="sp-time">' + fmtDur(s.minutes) + '<small>' + s.blocks + '블록</small></span></div>' +
        '<p class="sp-reason">' + esc(s.reason) + '</p>' +
        '<div class="sp-method"><h5>' + esc(s.method) + '</h5><p>' +
          esc(kidsOn() && s.methodBodyKids ? s.methodBodyKids : s.methodBody) + '</p></div>' +
        '<div class="sp-meta">' +
          '<span><b>우선순위</b> ' + Math.round(s.priority * 100) + '</span>' +
          '<span><b>긴급도</b> ' + Math.round(s.urgency * 100) + '%</span>' +
          '<span><b>중요도</b> ' + s.importanceRaw + '/5</span>' +
          '<span><b>준비도</b> ' + s.readiness + '/5</span>' +
          '<span><b>오늘 뇌 궁합</b> ' + Math.round(s.brainFit * 100) + '% (' + esc(s.domCapLabel) + ' ' + s.domCapScore + '점)</span>' +
        '</div></div>';
    }).join('') || '<p class="tiny">배정된 과목이 없습니다. 가용 학습 시간을 늘리거나 과목을 추가해 주세요.</p>';

    $('droppedNote').innerHTML = p.dropped.length
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
    var ms = Math.max(0, Math.min(now - state.span.since, state.span.cap));
    if (ms > 1000) {
      StudyLog.add(state.span.subject, state.span.type, ms / 60000);
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
    a.download = 'neurostudy-backup-' + Store.key() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
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
        if (block && block.kind === 'study') setTimeout(awardKids, 1200);
      },
      onFinishAll: function () {
        commitSpan(true);
        Sound.stop();
        state.lastSoundKey = null;
        setTimeout(renderSoundNow, 320);
        toast(kidsOn() ? '🏁 오늘 계획한 공부를 다 끝냈어요. 정말 대단해요!' : '🎉 오늘의 학습 플랜을 모두 완료했습니다!');
        $('btnStart').textContent = '▶ 시작';
        renderLiveTotal(); renderGroup(); renderReport();
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
      dial.style.stroke = isStudy ? (s.block.color || '#6d4aff') : '#0f9d6e';
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
      return '<li class="' + cls + '">' + icon + ' ' + esc(b.label) + '<span class="qt">' + b.minutes + '분</span></li>';
    }).join('');
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
        '<select class="input sm-sel" data-type="' + type + '">' + trackOptions(sel, true) + '</select>' +
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
      $('exercise').value + '분 · 가용 ' + $('availableHours').value + '시간';
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

  function renderMeals() {
    var box = $('mealToday');
    if (!box) return;
    var p = Store.profile();

    if (!Neis.hasKey()) {
      box.innerHTML = '<div class="meal-empty">나이스 연동이 꺼져 있습니다. ' +
        '<button type="button" class="btn ghost sm" data-goto="secSettings">설정에서 켜기</button></div>';
      bindGotoIn(box);
      return;
    }
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
      renderMeals();
      renderSettingsPage();
      if (!Neis.hasKey()) neisStatus('연동을 껐습니다. 학교 검색은 오프라인 자동완성으로만 동작합니다.', 'info');
    };
    $('neisKey').addEventListener('change', save);
    $('neisKey').addEventListener('blur', save);

    $('neisTest').addEventListener('click', function () {
      Neis.setKey($('neisKey').value);
      if (!Neis.hasKey()) { neisStatus('키가 비어 있습니다. 연동이 꺼진 상태입니다.', 'info'); return; }
      neisStatus('확인 중…', 'info');
      Neis.testKey().then(function () {
        neisStatus('✅ 정상 연결됐습니다. 학교 검색과 급식을 쓸 수 있어요.', 'ok');
        renderMeals();
      }).catch(function (e) {
        neisStatus('❌ 연결 실패 — ' + esc(String(e.message || e)) + '<br>키가 맞는지, 인터넷이 연결돼 있는지 확인해 주세요.', 'bad');
      });
    });

    $('neisClearCache').addEventListener('click', function () {
      Neis.clearCache();
      renderMeals();
      toast('급식 캐시를 비웠습니다.');
    });
  }

  function renderSettingsPage() {
    var p = Store.profile();
    if (!p) return;

    var neisTag = p.neis && p.neis.schoolCode
      ? ' · <span style="color:var(--good);font-weight:600">나이스 연결됨</span>'
      : ' · <span style="color:var(--warn)">학교 미선택 (급식 없음)</span>';

    $('profileSummary').innerHTML =
      '<div class="ps-av" style="background:' + Group.avatarColor(p.nick) + '">' + esc(Group.initial(p.nick)) + '</div>' +
      '<div><div class="ps-name">' + esc(p.nick) + '</div>' +
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
      return '<div class="rank' + (m.self ? ' is-me' : '') + (m.rank === 1 ? ' top1' : '') + '">' +
        '<div class="rk-pos' + medal + '">' + badge + '</div>' +
        '<div class="rk-av" style="background:' + color + '">' + esc(Group.initial(m.nick)) + '</div>' +
        '<div class="rk-info">' +
          '<div class="rk-name">' + esc(m.nick) + (m.self ? '<span class="me-tag">나</span>' : '') +
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

  /* ================================================================ 관리자 모드 */

  var adminPin = 'eun031';  // 관리자 PIN — 변경해주세요!
  var adminState = { authenticated: false, users: [] };

  function collectAllUsers() {
    var users = [];
    var sess = Store.sessions();
    var grp = Store.group();
    var prof = Store.profile();
    var hist = Store.history();

    if (prof) {
      var totalMinutes = 0;
      Object.keys(sess).forEach(function (date) {
        var dayData = sess[date];
        Object.keys(dayData).forEach(function (subj) { totalMinutes += dayData[subj]; });
      });

      var avgScore = 0;
      if (hist.length) {
        var sum = 0;
        hist.forEach(function (h) { sum += (h.overall || 0); });
        avgScore = Math.round(sum / hist.length);
      }

      users.push({
        id: Group.memberId(prof),
        name: prof.name,
        school: prof.school,
        grade: prof.grade,
        groupId: Group.groupId(prof),
        groupLabel: Group.groupLabel(prof),
        totalMinutes: totalMinutes,
        totalHours: Math.round(totalMinutes / 60),
        sessionCount: Object.keys(sess).length,
        avgScore: avgScore,
        lastActive: hist.length ? hist[hist.length - 1].date : 'N/A'
      });
    }

    grp.members.forEach(function (m) {
      if (!users.find(function (u) { return u.id === m.id; })) {
        users.push({
          id: m.id,
          name: m.nick,
          school: m.school || 'N/A',
          grade: m.grade || 'N/A',
          groupId: m.groupId,
          groupLabel: Group.groupLabel(m),
          totalMinutes: m.todayTotal || 0,
          totalHours: Math.round((m.todayTotal || 0) / 60),
          sessionCount: 0,
          avgScore: 0,
          lastActive: m.ts ? Store.key(new Date(m.ts)) : 'N/A'
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
    $('totalUsers').textContent = stats.totalUsers;
    $('activeToday').textContent = stats.activeToday;
    $('totalStudyHours').textContent = Math.floor(stats.totalMinutes / 60) + 'h ' + (stats.totalMinutes % 60) + 'm';
    $('avgScore').textContent = stats.avgScore;
  }

  function renderAdminUsersList() {
    var searchTerm = ($('adminSearch').value || '').toLowerCase();
    var filtered = adminState.users.filter(function (u) {
      return (u.name + u.school + u.groupLabel).toLowerCase().indexOf(searchTerm) >= 0;
    });

    var html = '';
    filtered.forEach(function (u) {
      html += '<div class="admin-user-card">' +
        '<div class="auc-header">' +
          '<div>' +
            '<div class="auc-name">' + esc(u.name) + '</div>' +
            '<div class="auc-group">' + esc(u.groupLabel) + ' • ' + esc(u.school) + '</div>' +
          '</div>' +
          '<div class="auc-badge">' + u.grade + '</div>' +
        '</div>' +
        '<div class="auc-stats">' +
          '<div class="aus-item"><div class="aus-label">공부 시간</div><div class="aus-value">' + u.totalHours + 'h</div></div>' +
          '<div class="aus-item"><div class="aus-label">평균 점수</div><div class="aus-value">' + u.avgScore + '점</div></div>' +
        '</div>' +
        '<div class="auc-stats">' +
          '<div class="aus-item"><div class="aus-label">기록 수</div><div class="aus-value">' + u.sessionCount + '</div></div>' +
          '<div class="aus-item"><div class="aus-label">마지막 활동</div><div class="aus-value">' + u.lastActive + '</div></div>' +
        '</div>' +
      '</div>';
    });

    $('adminUsersList').innerHTML = html || '<div style="padding:20px; text-align:center; color: var(--muted)">사용자가 없습니다.</div>';
  }

  function authAdmin() {
    var pin = $('adminPin').value;
    if (pin === adminPin) {
      adminState.authenticated = true;
      $('adminAuthSection').classList.add('is-hidden');
      $('adminContent').classList.remove('is-hidden');
      $$('#adminStatsCard, #adminUsersCard, #adminGraphCard, #adminCapacityCard').forEach(function (el) {
        el.classList.remove('is-hidden');
      });
      renderAdminStats();
      renderAdminUsersList();
      toast('관리자 인증 완료');
    } else {
      toast('PIN 코드가 맞지 않습니다.', true);
      $('adminPin').value = '';
    }
  }

  function logoutAdmin() {
    adminState.authenticated = false;
    $('adminAuthSection').classList.remove('is-hidden');
    $('adminContent').classList.add('is-hidden');
    $$('#adminStatsCard, #adminUsersCard, #adminGraphCard, #adminCapacityCard').forEach(function (el) {
      el.classList.add('is-hidden');
    });
    $('adminPin').value = '';
    toast('관리자 로그아웃 완료');
  }

  function init() {
    initRanges(); initSegs(); initClock(); initTimer(); initSound(); initSchoolAc(); initNeis();

    // 끼니를 체크하면 급식 안내 문구도 다시 계산한다
    ['mealBreakfast', 'mealLunch', 'mealDinner'].forEach(function (id) {
      $(id).addEventListener('change', function () { renderMeals(); });
    });

    $('detailToggle').addEventListener('click', function () { toggleDetail(); });
    DETAIL_IDS.forEach(function (id) {
      $(id).addEventListener('input', updateDetailSummary);
      $(id).addEventListener('change', updateDetailSummary);
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
      if ($$('.subject-row').length >= 8) { toast('과목은 최대 8개까지 추가할 수 있습니다.', true); return; }
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
        toast(m.nick + ' 님을 그룹에 추가했습니다.');
      } catch (e) {
        toast(e.message || '코드를 읽을 수 없습니다.', true);
      }
    });

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
      renderGroup(); renderReport(); renderLiveTotal(); renderKids(); renderSettingsPage();
      toast('모든 기록을 삭제했습니다.');
    });

    // 관리자 모드 이벤트
    $('adminLogin').addEventListener('click', authAdmin);
    $('adminLogout').addEventListener('click', logoutAdmin);
    $('adminPin').addEventListener('keypress', function (e) {
      if (e.key === 'Enter') authAdmin();
    });
    $('adminSearch').addEventListener('input', renderAdminUsersList);

    // 카드 안에서 다른 페이지로 보내는 링크 버튼들
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goPage(b.dataset.goto); });
    });

    renderSettingsPage();
    renderMeals();
    renderQuickNote();
    updateDetailSummary();
    renderLiveTotal();
    renderGroup();
    renderReport();
    renderKids();
    weeklyNotice();

    if (!Store.available) toast('브라우저 저장소를 쓸 수 없어 기록이 유지되지 않습니다.', true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
