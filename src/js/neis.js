/* =========================================================================
 * neis.js — 나이스 교육정보 개방포털 연동
 *
 *   · 학교 검색 (schoolInfo)
 *   · 급식 식단 (mealServiceDietInfo)
 *
 * 브라우저에서 직접 호출한다. 확인 결과 file:// 에서도 CORS 없이 응답한다.
 * 인터넷이 없거나 키가 없으면 호출하지 않고 오프라인 자동완성으로 되돌아간다.
 *
 * ⚠ 인증키는 소스에 넣지 않는다.
 *    이 저장소는 공개돼 있어서 키를 커밋하면 누구나 가져다 쓸 수 있다.
 *    키는 앱의 [설정 → 나이스(NEIS) 연동] 에서 입력하며 브라우저의
 *    localStorage 에만 저장된다. 발급은 https://open.neis.go.kr (무료).
 * ========================================================================= */
(function (global) {
  'use strict';

  var BASE = 'https://open.neis.go.kr/hub/';
  var KEY_STORE = 'neurostudy.neiskey.v1';
  var MEAL_CACHE = 'neurostudy.mealcache.v1';
  // 소스에는 키를 두지 않는다. 사용자가 설정 화면에서 직접 넣는다.
  var DEFAULT_KEY = '';

  /* 식품 알레르기 유발 물질 표시 번호 (교육부 고시 기준) */
  var ALLERGENS = {
    1: '난류', 2: '우유', 3: '메밀', 4: '땅콩', 5: '대두', 6: '밀', 7: '고등어',
    8: '게', 9: '새우', 10: '돼지고기', 11: '복숭아', 12: '토마토', 13: '아황산류',
    14: '호두', 15: '닭고기', 16: '쇠고기', 17: '오징어', 18: '조개류', 19: '잣'
  };

  /* ------------------------------------------------------------- 키 관리 */

  function key() {
    try {
      var k = localStorage.getItem(KEY_STORE);
      return k === null ? DEFAULT_KEY : k;   // 빈 문자열이면 "연동 안 함" 을 뜻한다
    } catch (e) { return DEFAULT_KEY; }
  }

  function setKey(k) {
    try { localStorage.setItem(KEY_STORE, String(k || '').trim()); } catch (e) { /* 무시 */ }
  }

  function hasKey() { return !!key(); }

  /* --------------------------------------------------------------- 호출 */

  /* 나이스는 인증키가 없어도 응답한다 (요청당 5건 제한).
   * 그래서 KEY 파라미터는 값이 있을 때만 붙인다 —
   * 빈 KEY= 를 보내도 통과하지만, 아예 빼는 편이 의도가 분명하다.
   * 키를 넣으면 제한이 풀려 한 번에 더 많이 받아 온다. */
  function url(path, params) {
    var q = ['Type=json'];
    if (hasKey()) q.unshift('KEY=' + encodeURIComponent(key()));
    Object.keys(params).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      q.push(k + '=' + encodeURIComponent(params[k]));
    });
    return BASE + path + '?' + q.join('&');
  }

  /** 키 없이 한 번에 받을 수 있는 최대 건수 (페이지네이션은 무시된다) */
  var FREE_LIMIT = 5;

  /**
   * 나이스 응답은 두 가지 모양으로 온다.
   *   정상  : { <서비스명>: [ {head:[...]}, {row:[...]} ] }
   *   무자료: { RESULT: { CODE:'INFO-200', ... } }
   * 어느 쪽이든 행 배열로 정리해서 돌려준다.
   */
  function call(path, params, service) {
    return fetch(url(path, params)).then(function (res) {
      if (!res.ok) throw new Error('NEIS_HTTP_' + res.status);
      return res.json();
    }).then(function (json) {
      if (json && json.RESULT) {
        var code = json.RESULT.CODE;
        if (code === 'INFO-200') return [];                       // 자료 없음은 오류가 아니다
        throw new Error(json.RESULT.MESSAGE || code || 'NEIS_ERROR');
      }
      var svc = json && json[service];
      if (!svc || !svc[1] || !svc[1].row) return [];
      var head = svc[0] && svc[0].head;
      var result = head && head[1] && head[1].RESULT;
      if (result && result.CODE && result.CODE !== 'INFO-000' && result.CODE !== 'INFO-200') {
        throw new Error(result.MESSAGE || result.CODE);
      }
      return svc[1].row;
    });
  }

  /* ---------------------------------------------------------- 학교 검색 */

  var KIND_TO_LEVEL = {
    '초등학교': '초등학교', '중학교': '중학교', '고등학교': '고등학교',
    '대학교': '대학교', '전문대학': '대학교'
  };

  /* 오프라인 학교 데이터 - 전국 인기 학교 목록 */
  var LOCAL_SCHOOLS = [
    /* 서울 */
    {name:'서울대학교',kind:'대학교',region:'서울',address:'서울 관악구'},
    {name:'고려대학교',kind:'대학교',region:'서울',address:'서울 성북구'},
    {name:'연세대학교',kind:'대학교',region:'서울',address:'서울 서대문구'},
    {name:'이화여자대학교',kind:'대학교',region:'서울',address:'서울 서대문구'},
    {name:'숙명여자대학교',kind:'대학교',region:'서울',address:'서울 용산구'},
    {name:'광운대학교',kind:'대학교',region:'서울',address:'서울 노원구'},
    {name:'서울과학기술대학교',kind:'대학교',region:'서울',address:'서울 노원구'},
    {name:'동국대학교',kind:'대학교',region:'서울',address:'서울 중구'},
    {name:'명지대학교',kind:'대학교',region:'서울',address:'서울 성북구'},
    {name:'한국외국어대학교',kind:'대학교',region:'서울',address:'서울 동대문구'},
    {name:'경희대학교',kind:'대학교',region:'서울',address:'서울 동대문구'},
    {name:'강남고등학교',kind:'고등학교',region:'서울',address:'서울 강남구'},
    {name:'서울고등학교',kind:'고등학교',region:'서울',address:'서울 중구'},
    {name:'경기고등학교',kind:'고등학교',region:'서울',address:'서울 종로구'},
    {name:'서울대학교사범대학부속고등학교',kind:'고등학교',region:'서울',address:'서울 강남구'},
    {name:'휘문고등학교',kind:'고등학교',region:'서울',address:'서울 종로구'},
    {name:'용산고등학교',kind:'고등학교',region:'서울',address:'서울 용산구'},
    {name:'신사고등학교',kind:'고등학교',region:'서울',address:'서울 강남구'},
    {name:'중앙고등학교',kind:'고등학교',region:'서울',address:'서울 은평구'},
    {name:'사대부고',kind:'고등학교',region:'서울',address:'서울 강남구'},
    /* 경기 */
    {name:'한국과학기술원',kind:'대학교',region:'대전',address:'대전 유성구'},
    {name:'수원고등학교',kind:'고등학교',region:'경기',address:'경기 수원시'},
    {name:'용인외국어고등학교',kind:'고등학교',region:'경기',address:'경기 용인시'},
    {name:'분당고등학교',kind:'고등학교',region:'경기',address:'경기 성남시'},
    {name:'판교고등학교',kind:'고등학교',region:'경기',address:'경기 성남시'},
    /* 부산 */
    {name:'부산대학교',kind:'대학교',region:'부산',address:'부산 금정구'},
    {name:'동아대학교',kind:'대학교',region:'부산',address:'부산 서구'},
    {name:'신라대학교',kind:'대학교',region:'부산',address:'부산 사상구'},
    /* 대구 */
    {name:'대구대학교',kind:'대학교',region:'대구',address:'대구 남구'},
    {name:'경북대학교',kind:'대학교',region:'대구',address:'대구 북구'},
    /* 중학교 샘플 */
    {name:'한빛중학교',kind:'중학교',region:'서울',address:'서울 강남구'},
    {name:'예일중학교',kind:'중학교',region:'서울',address:'서울 강남구'},
    {name:'영동중학교',kind:'중학교',region:'서울',address:'서울 강남구'},
    /* 초등학교 샘플 */
    {name:'한빛초등학교',kind:'초등학교',region:'서울',address:'서울 강남구'},
    {name:'신사초등학교',kind:'초등학교',region:'서울',address:'서울 강남구'},
    {name:'대곡초등학교',kind:'초등학교',region:'서울',address:'서울 강남구'}
  ];

  var searchCache = {};

  /** 로컬 데이터에서 학교 검색 */
  function searchSchoolsLocal(query, kind) {
    var q = String(query || '').trim().toLowerCase();
    if (q.length < 1) return [];

    return LOCAL_SCHOOLS.filter(function (s) {
      if (kind && kind !== '기타' && s.kind !== kind) return false;
      return s.name.toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var aq = a.name.toLowerCase().indexOf(q);
      var bq = b.name.toLowerCase().indexOf(q);
      if (aq === 0 && bq !== 0) return -1;
      if (aq !== 0 && bq === 0) return 1;
      return a.name.length - b.name.length;
    }).slice(0, 30);
  }

  function mapRow(r) {
    return {
      name: r.SCHUL_NM,
      eduCode: r.ATPT_OFCDC_SC_CODE,
      eduName: r.ATPT_OFCDC_SC_NM,
      schoolCode: r.SD_SCHUL_CODE,
      region: r.LCTN_SC_NM,
      kind: r.SCHUL_KND_SC_NM,
      level: KIND_TO_LEVEL[r.SCHUL_KND_SC_NM] || '기타',
      address: r.ORG_RDNMA || ''
    };
  }

  /**
   * 학교 이름 일부로 나이스에서 검색한다.
   *
   * 인증키가 없어도 동작한다. 대신 요청당 5건으로 잘리고 페이지네이션이 무시되므로,
   * 그 5칸을 최대한 쓸모 있게 채우는 게 관건이다.
   *   1) 사용자가 고른 학교급으로 좁힌 질의 — 대개 이게 정답을 담고 있다
   *   2) 학교급 없는 질의 — 학교급을 잘못 골랐거나 특수학교인 경우를 건진다
   * 두 결과를 합치면 무키로도 최대 10건까지 볼 수 있다.
   *
   * 키를 넣으면 한 번에 30건을 받아 오므로 1)만으로 충분하다.
   *
   * 인터넷이 없거나 나이스가 죽었을 때만 내장 목록으로 떨어진다.
   */
  function searchSchools(query, kind) {
    var q = String(query || '').trim();
    if (q.length < 1) return Promise.resolve([]);

    var ck = q + '|' + (kind || '');
    if (searchCache[ck]) return Promise.resolve(searchCache[ck]);

    var narrow = (kind && kind !== '기타') ? kind : '';
    var size = hasKey() ? 30 : FREE_LIMIT;

    var queries = [call('schoolInfo', {
      pIndex: 1, pSize: size, SCHUL_NM: q, SCHUL_KND_SC_NM: narrow
    }, 'schoolInfo')];

    // 무키 + 학교급 지정 상태라면 넓은 질의를 한 번 더 걸어 5칸을 늘린다
    if (!hasKey() && narrow) {
      queries.push(call('schoolInfo', {
        pIndex: 1, pSize: FREE_LIMIT, SCHUL_NM: q
      }, 'schoolInfo')['catch'](function () { return []; }));
    }

    return Promise.all(queries).then(function (results) {
      var seen = {}, list = [];
      results.forEach(function (rows) {
        (rows || []).forEach(function (r) {
          var s = mapRow(r);
          // 같은 학교가 두 질의에 다 걸리므로 학교 코드로 중복을 없앤다
          var k = s.schoolCode || (s.name + '|' + s.kind);
          if (seen[k]) return;
          seen[k] = true;
          list.push(s);
        });
      });

      if (!list.length) {
        // 나이스가 "자료 없음" 을 준 경우 — 내장 목록으로 한 번 더 본다
        list = searchSchoolsLocal(q, kind);
      }

      // 고른 학교급과 일치하는 학교를 위로, 그다음 검색어로 시작하는 이름 순
      list.sort(function (a, b) {
        if (narrow) {
          var ak = a.kind === narrow ? 0 : 1, bk = b.kind === narrow ? 0 : 1;
          if (ak !== bk) return ak - bk;
        }
        var as = a.name.indexOf(q) === 0 ? 0 : 1;
        var bs = b.name.indexOf(q) === 0 ? 0 : 1;
        if (as !== bs) return as - bs;
        return a.name.length - b.name.length;
      });

      searchCache[ck] = list;
      return list;
    })['catch'](function () {
      // 오프라인 — 내장 목록으로 떨어진다. 캐시에는 넣지 않는다(연결되면 다시 시도).
      return searchSchoolsLocal(q, kind);
    });
  }

  /* ------------------------------------------------------------- 급식 */

  function ymd(d) {
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  /** "*찰보리밥 <br/>*된장국 (5.6)" → [{name:'찰보리밥', allergens:[]}, ...] */
  function parseDishes(raw) {
    return String(raw || '')
      .split(/<br\s*\/?>/i)
      .map(function (s) { return s.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean)
      .map(function (s) {
        var nums = [];
        var name = s.replace(/\(([\d.\s]+)\)\s*$/, function (_, g) {
          g.split('.').forEach(function (n) {
            n = parseInt(n.trim(), 10);
            if (n && ALLERGENS[n] && nums.indexOf(n) < 0) nums.push(n);
          });
          return '';
        });
        name = name.replace(/^[*\s]+/, '').replace(/\s+$/, '');
        return { name: name, allergens: nums };
      })
      .filter(function (d) { return d.name; });
  }

  function parseNutrients(raw) {
    return String(raw || '')
      .split(/<br\s*\/?>/i)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (s) {
        var m = s.split(':');
        return { label: (m[0] || '').trim(), value: (m[1] || '').trim() };
      });
  }

  var ORDER = { '조식': 0, '중식': 1, '석식': 2 };

  /* 예전에는 인증키가 없으면 급식을 못 불러와서, 학교 몇 곳의 예시 식단을
   * 코드에 넣어 두고 그걸 보여 줬다. 지금은 키 없이도 실제 급식이 오므로
   * 그 예시 데이터는 지웠다 — 남겨 두면 이름이 우연히 겹치는 학교에
   * 실제 급식 대신 지어낸 식단을 보여 주게 된다. */

  /* 하루 단위 캐시 — 같은 날 같은 학교를 반복 호출하지 않는다 */
  function cacheRead() {
    try { return JSON.parse(localStorage.getItem(MEAL_CACHE) || '{}'); } catch (e) { return {}; }
  }
  function cacheWrite(o) {
    try { localStorage.setItem(MEAL_CACHE, JSON.stringify(o)); } catch (e) { /* 무시 */ }
  }

  /** from~to 구간의 급식을 날짜별로 묶어 돌려준다 */
  function meals(school, from, to) {
    if (!school) return Promise.resolve({});

    var f = from || ymd(new Date());
    var t = to || f;
    var ck = (school.schoolCode || school.name) + '|' + f + '|' + t;

    var cache = cacheRead();
    if (cache[ck] && (Date.now() - cache[ck].at) < 6 * 3600 * 1000) {
      return Promise.resolve(cache[ck].data);
    }

    // 학교 코드가 없으면 조회할 수 없다 (목록에서 고르지 않고 직접 입력한 경우)
    if (!school.eduCode || !school.schoolCode) {
      return Promise.resolve({});
    }

    // 나이스에서 조회 — 키가 없어도 동작한다
    return call('mealServiceDietInfo', {
      pIndex: 1, pSize: 100,
      ATPT_OFCDC_SC_CODE: school.eduCode,
      SD_SCHUL_CODE: school.schoolCode,
      MLSV_FROM_YMD: f,
      MLSV_TO_YMD: t
    }, 'mealServiceDietInfo').then(function (rows) {
      var byDate = {};
      rows.forEach(function (r) {
        var d = r.MLSV_YMD;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push({
          date: d,
          type: r.MMEAL_SC_NM,
          dishes: parseDishes(r.DDISH_NM),
          kcal: (r.CAL_INFO || '').trim(),
          nutrients: parseNutrients(r.NTR_INFO),
          origin: r.ORPLC_INFO || ''
        });
      });
      Object.keys(byDate).forEach(function (d) {
        byDate[d].sort(function (a, b) { return (ORDER[a.type] || 9) - (ORDER[b.type] || 9); });
      });

      var c = cacheRead();
      c[ck] = { at: Date.now(), data: byDate };
      // 캐시가 너무 커지지 않게 오래된 것부터 정리
      var keys = Object.keys(c);
      if (keys.length > 40) {
        keys.sort(function (a, b) { return c[a].at - c[b].at; });
        keys.slice(0, keys.length - 40).forEach(function (k) { delete c[k]; });
      }
      cacheWrite(c);
      return byDate;
    }).catch(function (e) {
      // 온라인 오류시 빈 결과 반환
      return {};
    });
  }

  function todayMeals(school) {
    var k = ymd(new Date());
    return meals(school, k, k).then(function (m) { return m[k] || []; });
  }

  /** 이번 주(월~금) 급식 */
  function weekMeals(school) {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var dow = (d.getDay() + 6) % 7;
    var mon = new Date(d.getTime()); mon.setDate(mon.getDate() - dow);
    var fri = new Date(mon.getTime()); fri.setDate(fri.getDate() + 4);
    return meals(school, ymd(mon), ymd(fri));
  }

  function clearCache() { try { localStorage.removeItem(MEAL_CACHE); } catch (e) { /* 무시 */ } }

  /** 설정 화면에서 키가 살아 있는지 확인할 때 쓴다 */
  function testKey() {
    return call('schoolInfo', { pIndex: 1, pSize: 1, SCHUL_NM: '서울' }, 'schoolInfo')
      .then(function (rows) { return { ok: true, count: rows.length }; });
  }

  global.Neis = {
    key: key, setKey: setKey, hasKey: hasKey, DEFAULT_KEY: DEFAULT_KEY,
    searchSchools: searchSchools,
    meals: meals, todayMeals: todayMeals, weekMeals: weekMeals,
    clearCache: clearCache, testKey: testKey,
    ALLERGENS: ALLERGENS, ymd: ymd
  };

})(window);
