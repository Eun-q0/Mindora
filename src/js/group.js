/* =========================================================================
 * group.js — 학교·학년 기반 스터디 그룹과 순공 시간 랭킹
 *
 * 이 앱은 서버가 없다. 그래서 그룹원 기록은 "공유 코드"(Base64 문자열)를
 * 주고받아 각자의 브라우저에 저장하는 방식으로 모은다.
 * 자동 동기화는 되지 않지만, 코드를 교환하면 실제로 함께 랭킹을 볼 수 있다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;
  var PREFIX = 'NS1.';

  var GRADES = {
    '초등학교': ['1', '2', '3', '4', '5', '6'],
    '중학교': ['1', '2', '3'],
    '고등학교': ['1', '2', '3'],
    '대학교': ['1', '2', '3', '4', '5', '6'],
    '기타': ['해당 없음']
  };

  /* 아바타 색은 앱 전체 색과 맞춰 보라~인디고 안에서만 고른다.
   * 예전에는 초록·주황·분홍까지 섞여 있어서 목록이 알록달록했다. */
  var AV_COLORS = ['#6d4aff', '#5b7cff', '#8257e6', '#4f63d8', '#9a5fe0', '#6a5ae0', '#7c5cff', '#5a4fd4'];

  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }

  function groupId(p) {
    if (!p) return '';
    return [norm(p.school), p.level, p.grade, norm(p.klass)].join('|');
  }

  function groupLabel(p) {
    if (!p) return '';
    var g = p.level === '기타' ? '' : ' ' + p.grade + '학년';
    var c = norm(p.klass) ? ' ' + norm(p.klass) + '반' : '';
    return norm(p.school) + g + c;
  }

  /** 이름에서 안정적인 아바타 색을 뽑는다 */
  function avatarColor(seed) {
    var h = 0, s = String(seed || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }

  function initial(nick) { return String(nick || '?').trim().charAt(0).toUpperCase() || '?'; }

  /* ----------------------------------------------------------- Base64 UTF-8 */

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* --------------------------------------------------------------- 멤버 */

  function members() {
    var g = S.group();
    return Array.isArray(g.members) ? g.members : [];
  }

  function saveMembers(list) { S.saveGroup({ members: list }); }

  function memberId(p) { return groupId(p) + '#' + norm(p.nick); }

  /** 내 최신 기록으로 멤버 레코드를 만든다 */
  function selfRecord() {
    var p = S.profile();
    if (!p) return null;
    var last = S.history();
    var rec = last.length ? last[last.length - 1] : null;
    var today = S.key();

    return {
      id: memberId(p),
      nick: norm(p.nick),
      school: norm(p.school),
      level: p.level,
      grade: p.grade,
      klass: norm(p.klass),
      groupId: groupId(p),
      goal: p.goal || 25,
      /* 랭킹에 캐릭터와 티어를 함께 띄우기 위해 꾸민 내용과 누적 순공 시간을 싣는다.
       * lifeMin 이 없는 옛 코드는 티어 없이 기본 캐릭터로 보인다. */
      avatar: global.Avatar ? global.Avatar.get() : null,
      lifeMin: global.Avatar ? Math.round(global.Avatar.lifetimeMinutes()) : 0,
      todayMin: Math.round(global.StudyLog.todayTotal() * 10) / 10,
      weekMin: Math.round(global.StudyLog.weekTotal(0) * 10) / 10,
      streak: global.StudyLog.streak(),
      overall: rec && rec.date === today ? rec.overall : (rec ? rec.overall : null),
      scores: rec ? rec.scores : null,
      date: today,
      ts: Date.now(),
      self: true
    };
  }

  /** 내 기록을 그룹 목록에 반영 */
  function syncSelf() {
    var me = selfRecord();
    if (!me) return members();
    var list = members().filter(function (m) { return m.id !== me.id; });
    list.push(me);
    saveMembers(list);
    return list;
  }

  function upsert(m) {
    var list = members().filter(function (x) { return x.id !== m.id; });
    m.self = false;
    list.push(m);
    saveMembers(list);
    return list;
  }

  function remove(id) {
    saveMembers(members().filter(function (m) { return m.id !== id; }));
    return members();
  }

  /* ---------------------------------------------------------- 공유 코드 */

  function encodeSelf() {
    var me = selfRecord();
    if (!me) return '';
    delete me.self;
    return PREFIX + b64encode(JSON.stringify(me));
  }

  function decode(code) {
    var raw = String(code || '').trim().replace(/\s+/g, '');
    if (!raw) throw new Error('코드가 비어 있습니다.');
    if (raw.indexOf(PREFIX) !== 0) throw new Error('Mindora 공유 코드 형식이 아닙니다.');
    var obj;
    try {
      obj = JSON.parse(b64decode(raw.slice(PREFIX.length)));
    } catch (e) {
      throw new Error('코드가 손상되었습니다. 전체를 다시 복사해 주세요.');
    }
    if (!obj || !obj.nick || !obj.groupId) throw new Error('코드에 필요한 정보가 없습니다.');
    // 코드는 손으로 고쳐 만들 수 있으므로, 학교 리그와 같은 상한을 걸어
    // 부풀린 값이 반 랭킹을 흔들지 못하게 한다.
    var cap = global.League ? global.League.DAILY_CAP_MINUTES : 300;
    obj.todayMin = clampMin(obj.todayMin, cap);
    obj.weekMin = clampMin(obj.weekMin, cap * 7);
    obj.streak = clampMin(obj.streak, 400);
    /* 누적 시간은 티어(테두리)를 정하므로 같은 상한을 씌운다.
     * 하루 5시간 × 400일이 한 사람이 정직하게 쌓을 수 있는 현실적인 최대치다. */
    obj.lifeMin = clampMin(obj.lifeMin, cap * 400);
    if (global.Avatar) obj.avatar = global.Avatar.sanitize(obj.avatar, obj.lifeMin);
    return obj;
  }

  function clampMin(v, max) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, max);
  }

  /* ------------------------------------------------------------- 랭킹 */

  /** range: 'today' | 'week' — 같은 그룹만 추려 순위를 매긴다 */
  function rank(range) {
    var p = S.profile();
    var gid = groupId(p);
    var field = range === 'week' ? 'weekMin' : 'todayMin';

    var list = members()
      .filter(function (m) { return m.groupId === gid; })
      .map(function (m) {
        return Object.assign({}, m, { value: m[field] || 0, self: p && m.id === memberId(p) });
      })
      .sort(function (a, b) {
        if (b.value !== a.value) return b.value - a.value;
        return String(a.nick).localeCompare(String(b.nick), 'ko');
      });

    // 동점은 같은 순위를 공유한다
    var pos = 0, prev = null;
    list.forEach(function (m, i) {
      if (prev === null || m.value !== prev) pos = i + 1;
      m.rank = pos;
      prev = m.value;
    });

    var max = list.length ? Math.max.apply(null, list.map(function (m) { return m.value; })) : 0;
    var total = list.reduce(function (s, m) { return s + m.value; }, 0);
    var me = list.filter(function (m) { return m.self; })[0] || null;

    return {
      list: list, max: max, total: total,
      avg: list.length ? total / list.length : 0,
      me: me, count: list.length
    };
  }

  /** 5대 능력의 그룹 평균 (오늘 기록이 있는 멤버만) */
  function capacityAverage() {
    var p = S.profile(), gid = groupId(p);
    var rows = members().filter(function (m) { return m.groupId === gid && m.scores; });
    if (!rows.length) return null;
    var acc = {}, n = rows.length;
    rows.forEach(function (m) {
      Object.keys(m.scores).forEach(function (k) { acc[k] = (acc[k] || 0) + m.scores[k]; });
    });
    Object.keys(acc).forEach(function (k) { acc[k] = acc[k] / n; });
    return { avg: acc, count: n };
  }

  /* ------------------------------------------------- 학교명 자동완성 ---- */

  /* 학교급별로 붙는 정식 접미사 */
  var SUFFIX = {
    '초등학교': ['초등학교'],
    '중학교': ['중학교', '여자중학교'],
    '고등학교': ['고등학교', '여자고등학교'],
    '대학교': ['대학교'],
    '기타': ['고등학교', '중학교', '초등학교', '대학교']
  };

  /* 입력 도중에 나올 수 있는 부분 접미사 — 긴 것부터 잘라 낸다 */
  var PARTIAL = [
    '여자고등학교', '여자중학교', '고등학교', '중학교', '초등학교', '대학교',
    '여자고등학', '여자중학', '여자고등', '여자중', '고등학', '초등학', '중학', '대학',
    '여고', '여중', '고등', '초등', '여자', '고', '중', '초', '대', '여'
  ];

  /** "한빛고" → "한빛" 처럼 학교 이름의 몸통만 남긴다 */
  function stemOf(q) {
    for (var i = 0; i < PARTIAL.length; i++) {
      var p = PARTIAL[i];
      if (q.length > p.length && q.slice(-p.length) === p) return q.slice(0, -p.length);
    }
    return q;
  }

  /**
   * 학교명 후보를 만든다.
   *  1) 전에 입력했던 학교와 그룹원들의 학교 중 검색어에 맞는 것
   *  2) 입력한 몸통에 학교급 접미사를 붙인 완성형
   * 인터넷 없이 도는 앱이라 전국 학교 목록을 갖고 있지는 않다.
   * 대신 타이핑을 줄여 주는 데 초점을 맞춘다.
   */
  function schoolSuggestions(query, level) {
    var q = norm(query);
    var known = S.recentSchools().concat(members().map(function (m) { return m.school; }));
    var seen = {}, out = [];

    function push(name, kind) {
      name = norm(name);
      if (!name || seen[name]) return;
      seen[name] = 1;
      out.push({ name: name, kind: kind });
    }

    if (!q) {
      known.forEach(function (n) { push(n, 'recent'); });
      return out.slice(0, 6);
    }

    // 1) 아는 학교 중 검색어를 포함하는 것 먼저
    known.forEach(function (n) { if (norm(n).indexOf(q) === 0) push(n, 'recent'); });
    known.forEach(function (n) { if (norm(n).indexOf(q) > 0) push(n, 'recent'); });

    // 2) 접미사를 붙인 완성형
    var stem = stemOf(q);
    if (stem) {
      var sufs = SUFFIX[level] || SUFFIX['고등학교'];
      sufs.forEach(function (suf) { push(stem + suf, 'complete'); });
    }

    // 이미 정확히 입력한 값은 후보에서 뺀다
    return out.filter(function (o) { return o.name !== q; }).slice(0, 6);
  }

  global.Group = {
    GRADES: GRADES, SUFFIX: SUFFIX, stemOf: stemOf, schoolSuggestions: schoolSuggestions,
    groupId: groupId, groupLabel: groupLabel, memberId: memberId,
    avatarColor: avatarColor, initial: initial,
    members: members, selfRecord: selfRecord, syncSelf: syncSelf,
    upsert: upsert, remove: remove,
    encodeSelf: encodeSelf, decode: decode,
    rank: rank, capacityAverage: capacityAverage
  };

})(window);
