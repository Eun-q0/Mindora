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

  function url(path, params) {
    var q = ['KEY=' + encodeURIComponent(key()), 'Type=json'];
    Object.keys(params).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      q.push(k + '=' + encodeURIComponent(params[k]));
    });
    return BASE + path + '?' + q.join('&');
  }

  /**
   * 나이스 응답은 두 가지 모양으로 온다.
   *   정상  : { <서비스명>: [ {head:[...]}, {row:[...]} ] }
   *   무자료: { RESULT: { CODE:'INFO-200', ... } }
   * 어느 쪽이든 행 배열로 정리해서 돌려준다.
   */
  function call(path, params, service) {
    if (!hasKey()) return Promise.reject(new Error('NEIS_NO_KEY'));

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

  /** 학교 이름 일부로 검색 - 먼저 로컬에서, API 키 있으면 온라인도 시도 */
  function searchSchools(query, kind) {
    var q = String(query || '').trim();
    if (q.length < 1) return Promise.resolve([]);

    var ck = q + '|' + (kind || '');
    if (searchCache[ck]) return Promise.resolve(searchCache[ck]);

    // 로컬 데이터에서 먼저 검색
    var localResults = searchSchoolsLocal(q, kind);

    // API 키가 없으면 로컬 결과만 반환
    if (!hasKey()) {
      searchCache[ck] = localResults;
      return Promise.resolve(localResults);
    }

    // API 키가 있으면 온라인에서도 검색 시도 (로컬과 병합)
    return call('schoolInfo', {
      pIndex: 1, pSize: 30,
      SCHUL_NM: q,
      SCHUL_KND_SC_NM: (kind && kind !== '기타') ? kind : ''
    }, 'schoolInfo').then(function (rows) {
      var onlineList = rows.map(function (r) {
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
      });
      // 로컬과 온라인 결과 병합 (중복 제거)
      var merged = localResults.concat(onlineList);
      var seen = {};
      var list = [];
      merged.forEach(function (s) {
        var key = s.name + '|' + s.kind;
        if (!seen[key]) { seen[key] = true; list.push(s); }
      });
      searchCache[ck] = list;
      return list;
    }).catch(function (e) {
      // 온라인 오류시 로컬 결과만 반환
      searchCache[ck] = localResults;
      return localResults;
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

  /* 로컬 급식 샘플 데이터 - 학교별 */
  var LOCAL_MEALS = {
    '강남고등학교': {
      '중식': [
        {name:'쌀밥',allergens:[]},
        {name:'소고기미역국',allergens:[16]},
        {name:'돈까스/타르타르소스',allergens:[1,6,10]},
        {name:'깻잎지',allergens:[5]},
        {name:'배추김치',allergens:[]},
        {name:'초코에몬크림빵',allergens:[1,2,6]}
      ],
      '석식': [
        {name:'보리밥',allergens:[]},
        {name:'된장찌개',allergens:[5,6,10]},
        {name:'계란말이',allergens:[1]},
        {name:'배추김치',allergens:[]}
      ]
    },
    '한빛중학교': {
      '중식': [
        {name:'찰보리밥',allergens:[]},
        {name:'미역국',allergens:[]},
        {name:'제육볶음',allergens:[5,10]},
        {name:'어묵볶음',allergens:[9]},
        {name:'깍두기',allergens:[]},
        {name:'수수팥떡',allergens:[]}
      ]
    },
    '한빛초등학교': {
      '중식': [
        {name:'흰쌀밥',allergens:[]},
        {name:'계란국',allergens:[1]},
        {name:'불고기',allergens:[10,16]},
        {name:'야채튀김',allergens:[6]},
        {name:'배추김치',allergens:[]},
        {name:'딸기우유',allergens:[2]}
      ]
    }
  };

  /* 하루 단위 캐시 — 같은 날 같은 학교를 반복 호출하지 않는다 */
  function cacheRead() {
    try { return JSON.parse(localStorage.getItem(MEAL_CACHE) || '{}'); } catch (e) { return {}; }
  }
  function cacheWrite(o) {
    try { localStorage.setItem(MEAL_CACHE, JSON.stringify(o)); } catch (e) { /* 무시 */ }
  }

  /** 로컬 급식 데이터 반환 */
  function getMealsLocal(schoolName) {
    var meals = LOCAL_MEALS[schoolName];
    if (!meals) return {};

    var today = ymd(new Date());
    var byDate = {};
    byDate[today] = [];

    Object.keys(meals).forEach(function (type) {
      byDate[today].push({
        date: today,
        type: type,
        dishes: meals[type] || [],
        kcal: '약 600kcal',
        nutrients: [],
        origin: '국내산'
      });
    });

    return byDate;
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

    // 먼저 로컬 데이터에서 찾기
    var localData = getMealsLocal(school.name);
    if (Object.keys(localData).length > 0) {
      var c = cacheRead();
      c[ck] = { at: Date.now(), data: localData };
      cacheWrite(c);
      return Promise.resolve(localData);
    }

    // API 키가 없으면 빈 결과 반환
    if (!hasKey() || !school.eduCode || !school.schoolCode) {
      return Promise.resolve({});
    }

    // API 키가 있으면 온라인에서 조회
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
