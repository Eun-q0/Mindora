/* =========================================================================
 * filter.js — 포스트잇에 올라오는 말 거르기
 *
 * 같은 반 친구들이 서로 보는 벽이라, 욕설과 비하 표현은 붙기 전에 막는다.
 *
 * 어려운 점은 "시발" 을 막는 게 아니라 "시1발", "시.발", "ㅅㅣㅂㅏㄹ",
 * "시발발발" 같은 우회를 같이 막는 것이다. 그래서 글자를 그대로 비교하지 않고
 * 먼저 한 줄로 펴 놓는다.
 *
 *   1. 숫자·공백·기호를 버린다        시1발 · 시 발 · 시.발  →  시발
 *   2. 흩어진 낱자모를 다시 합친다     ㅅㅣㅂㅏㄹ            →  시발
 *   3. 3번 이상 반복은 접는다          시발발발              →  시발발
 *   4. 영문은 따로 한 번 더 편다       f0ck · fuuuck         →  fock · fuck
 *
 * 거꾸로, 이렇게 펴 놓으면 멀쩡한 말이 걸린다. "시발점", "새끼손가락",
 * "졸라매다", "한남동" 이 그렇다. 그래서 ALLOW 에 적어 둔 말은 검사 전에
 * 지워 버린다 — 정상적인 글이 막히는 쪽이 욕 하나 놓치는 것보다 나쁘다.
 * 같은 이유로 "자지"(자지 않았다)·"보지"(보지 못했다)처럼 흔한 말에
 * 그대로 들어 있는 단어는 아예 목록에 넣지 않았다.
 *
 * ⚠ 목록은 완벽할 수 없다. 새 표현이 보이면 아래 BLOCK 에 한 줄 더하면 된다.
 *   목록은 이 파일 한 곳에만 둔다. 서버(SQL)에 같은 목록을 한 벌 더 두면
 *   두 규칙이 조금씩 어긋나고, 쓰는 쪽은 느슨한 통로만 골라 쓰게 된다.
 *   그래서 서버는 길이·개수·시간만 보고, 말을 보는 일은 여기서만 한다.
 *   대신 화면에 그릴 때도 한 번 더 걸러(clean) 다른 통로로 들어온 글도 가린다.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ 낱자모 표 */

  var CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ',
             'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ',
              'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
  var JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ',
              'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  /* --------------------------------------------------------------- 목록 */

  /* 검사 전에 지워 두는 말. 아래 BLOCK 의 단어를 통째로 품고 있는 멀쩡한 낱말이다.
   * (지운 자리는 빈칸이 아니라 막음 문자로 채워 앞뒤가 붙지 않게 한다) */
  var ALLOW = [
    '시발점', '시발역', '시발택시', '시발자동차', '시바견', '시바이누',
    '새끼손가락', '새끼발가락', '새끼줄', '새끼손톱', '새끼발톱',
    '고양이새끼', '강아지새끼', '호랑이새끼', '새끼고양이', '새끼강아지', '새끼오리',
    '졸라매', '한남동', '한남대', '걸레질', '걸레받이',
    '등신대', '애자일', '고자질', '벙어리장갑', '호모사피엔스', '호모에렉투스',
    '자위대', '자위권', '호로록'
  ];

  /* 붙기 전에 막는 말. 한글은 위에서 편 형태(공백·숫자 없음)로 적는다. */
  var BLOCK = [
    /* 욕설 */
    '씨발', '시발', '씨빨', '시빨', '씨팔', '시팔', '씹할', '씹새', '씹창', '개씹',
    '쓰발', '쒸발', '슈발', '쉬발', '씨바', '썅', '쌍놈', '쌍년',
    /* "새끼" 는 그 자체로는 동물의 어린 것이기도 해서 홀로 두지 않는다.
     * ("고양이가 새끼를 낳았다" 가 걸리면 안 된다)
     * 대신 욕으로 쓰일 때 거의 항상 붙는 앞뒤 말과 함께 본다. */
    '개새', '이새끼', '저새끼', '그새끼', '니새끼', '새끼야', '새끼들', '씹새끼',
    '좆', '졷', '존나', '존내', '졸라', '지랄', '지럴', '니미', '애미', '애비',
    '미친놈', '미친년', '미친새', '또라이', '꼴통', '싸가지', '염병', '옘병',
    '제기랄', '우라질', '호로자식', '호로새끼', '후레자식', '썩을놈', '썩을년',
    '뒈져', '죽여버', '개소리', '개년', '개놈', '개자식', '지랄맞',

    /* 비하 — 장애 */
    '병신', '븅신', '빙신', '등신', '머저리', '저능아', '지진아', '정신병자',
    '애자', '찐따', '벙어리', '귀머거리', '절름발이', '앉은뱅이', '불구자', '고자',

    /* 비하 — 성별·나이·지역·인종 */
    '김치녀', '된장녀', '한남', '맘충', '급식충', '진지충', '설명충', '틀딱',
    '잼민이', '짱깨', '짱께', '쪽바리', '쪽발이', '깜둥이', '조센징', '흑형',
    '전라디언', '개쌍도',

    /* 성적 표현 */
    '섹스', '야동', '자위', '딸딸이', '꼬추', '보빨', '창녀', '매춘'
  ];

  /* 영문. 위 4번 규칙(leet 되돌리기)을 거친 뒤 비교한다. */
  var BLOCK_EN = [
    'fuck', 'fuk', 'fck', 'fock', 'fuq', 'phuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick',
    'cunt', 'whore', 'slut', 'nigger', 'nigga', 'retard', 'faggot',
    'wtf', 'stfu'
  ];

  /* 초성체. 낱자모만 늘어놓은 구간에서만 찾는다.
   * (음절까지 초성으로 바꿔 비교하면 "수박"·"사방"이 전부 걸린다) */
  var BLOCK_CHO = [
    'ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅂㅅㄴ', 'ㅈㄹ', 'ㅁㅊ', 'ㄲㅈ',
    'ㅅㄲ', 'ㄱㅅㄲ', 'ㅈㄹㄴ', 'ㅆㄺ'
  ];

  /* 영문 우회 되돌리기 — 숫자·기호를 닮은 글자로 바꾼다 */
  var LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

  var MASK = '·';   // 검사에서 제외한 자리. 어떤 목록에도 없는 글자여야 한다.

  /* 반복 접기는 글과 목록에 똑같이 해야 한다.
   * 글만 접으면 "nigga" 가 "niga" 로 바뀌어 목록의 "nigga" 와 어긋난다. */
  var KO_KEEP = 2;   // "ㅋㅋ"·"ㅜㅜ" 는 살려야 하므로 두 개까지 둔다
  var EN_KEEP = 1;   // fuuuck 을 잡으려면 하나까지 줄여야 한다

  function collapse(s, keep) {
    var out = '', run = 0;
    for (var i = 0; i < s.length; i++) {
      run = (i > 0 && s.charAt(i) === s.charAt(i - 1)) ? run + 1 : 0;
      if (run < keep) out += s.charAt(i);
    }
    return out;
  }
  function collapseList(list, keep) {
    return list.map(function (w) { return collapse(w, keep); });
  }

  ALLOW = collapseList(ALLOW, KO_KEEP);
  BLOCK = collapseList(BLOCK, KO_KEEP);
  BLOCK_CHO = collapseList(BLOCK_CHO, KO_KEEP);
  BLOCK_EN = collapseList(BLOCK_EN, EN_KEEP);

  /* ----------------------------------------------------------- 펴기(정규화)
   *
   * 원문의 어디가 걸렸는지 알아야 가릴 수 있으므로, 편 글자마다
   * 원문에서의 구간(st ~ en)을 같이 들고 다닌다. */

  function isLetter(c) { return /[a-z가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c); }

  /**
   * @param {string} text  원문
   * @param {string} mode  'ko' = 한글용, 'en' = 영문용(leet 되돌리기)
   * @return {{s:string, st:number[], en:number[]}}
   */
  function build(text, mode) {
    var src = String(text == null ? '' : text);
    try { src = src.normalize('NFC'); } catch (e) { /* 구형 브라우저 — 원문 그대로 간다 */ }

    var en2 = mode === 'en';

    /* 1) 글자만 남긴다.
     *
     *    버린 자리는 바로 앞 글자의 구간에 넣어 둔다 — "시1발" 을 가릴 때
     *    가운데 1 까지 함께 가려져야 하기 때문이다. 다만 공백은 넣지 않는다.
     *    넣으면 "시발 뭐야" 를 가릴 때 뒤 띄어쓰기까지 먹어 "○○뭐야" 가 된다.
     *
     *    띄어쓰기가 있었는지는 따로 적어 둔다(sp). 초성체를 볼 때만 쓰는데,
     *    이게 없으면 "ㅇㅈ ㄹㅇ" 이 한 덩어리로 붙어 "ㅈㄹ" 로 읽힌다. */
    var ch = [], st = [], ed = [], sp = [];
    var gapSpace = false;
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      var lc = c.toLowerCase();
      if (lc.length !== 1) lc = c;              // 길이가 바뀌는 글자는 원문 그대로 둔다
      if (en2 && LEET[lc]) lc = LEET[lc];
      if (isLetter(lc)) {
        ch.push(lc); st.push(i); ed.push(i + 1); sp.push(gapSpace);
        gapSpace = false;
      } else if (/\s/.test(c)) {
        gapSpace = true;
      } else if (ch.length) {
        ed[ed.length - 1] = i + 1;
      }
    }

    /* 2) 흩어진 낱자모를 음절로 합친다 (한글용에서만 뜻이 있다) */
    if (!en2) {
      var mc = [], ms = [], me = [], mp = [];
      var k = 0;
      while (k < ch.length) {
        var ci = CHO.indexOf(ch[k]);
        var vi = k + 1 < ch.length ? JUNG.indexOf(ch[k + 1]) : -1;
        if (ci >= 0 && vi >= 0) {
          var ti = 0;
          if (k + 2 < ch.length) {
            var t = JONG.indexOf(ch[k + 2]);
            // 다음이 모음이면 그 글자는 다음 음절의 초성이다 (ㅂㅏㄴㅏ → 바나)
            var nextIsV = k + 3 < ch.length && JUNG.indexOf(ch[k + 3]) >= 0;
            if (t > 0 && !nextIsV) ti = t;
          }
          var used = ti ? 3 : 2;
          mc.push(String.fromCharCode(0xac00 + (ci * 21 + vi) * 28 + ti));
          ms.push(st[k]);
          me.push(ed[k + used - 1]);
          mp.push(sp[k]);
          k += used;
        } else {
          mc.push(ch[k]); ms.push(st[k]); me.push(ed[k]); mp.push(sp[k]); k++;
        }
      }
      ch = mc; st = ms; ed = me; sp = mp;
    }

    /* 3) 반복을 접는다 (목록도 같은 규칙으로 접어 두었다) */
    var keep = en2 ? EN_KEEP : KO_KEEP;
    var fc = [], fs = [], fe = [], fp = [];
    for (var j = 0; j < ch.length; j++) {
      var same = 0;
      for (var q = fc.length - 1; q >= 0 && fc[q] === ch[j]; q--) same++;
      if (same >= keep) { fe[fe.length - 1] = ed[j]; continue; }
      fc.push(ch[j]); fs.push(st[j]); fe.push(ed[j]); fp.push(sp[j]);
    }

    /* 4) 멀쩡한 낱말을 검사 대상에서 빼 둔다 */
    var s = fc.join('');
    if (!en2) {
      ALLOW.forEach(function (w) {
        var at = s.indexOf(w);
        while (at >= 0) {
          var blank = '';
          for (var n = 0; n < w.length; n++) blank += MASK;
          s = s.slice(0, at) + blank + s.slice(at + w.length);
          at = s.indexOf(w, at + w.length);
        }
      });
    }

    return { s: s, st: fs, en: fe, sp: fp };
  }

  /* --------------------------------------------------------------- 찾기 */

  function scan(b, words, out) {
    words.forEach(function (w) {
      var from = 0, at;
      while ((at = b.s.indexOf(w, from)) >= 0) {
        out.push({ word: w, start: b.st[at], end: b.en[at + w.length - 1] });
        from = at + w.length;
      }
    });
  }

  /**
   * 낱자모만 늘어놓은 구간(ㅅㅂ, ㅗ)을 따로 본다.
   * 띄어쓰기에서 끊는다 — "ㅇㅈ ㄹㅇ" 은 두 덩어리지 "ㅈㄹ" 이 아니다.
   */
  function scanCho(b, out) {
    var i = 0;
    while (i < b.s.length) {
      if (!/[ㄱ-ㅎㅏ-ㅣ]/.test(b.s.charAt(i))) { i++; continue; }

      var j = i + 1;
      while (j < b.s.length && /[ㄱ-ㅎㅏ-ㅣ]/.test(b.s.charAt(j)) && !b.sp[j]) j++;

      var run = b.s.slice(i, j), hit = null;
      // 손가락 욕은 그 덩어리가 통째로 ㅗ 일 때만 본다 ("ㅗㅜㅑ" 는 감탄사다)
      if (/^ㅗ+$/.test(run)) hit = 'ㅗ';
      else {
        for (var k = 0; k < BLOCK_CHO.length; k++) {
          if (run.indexOf(BLOCK_CHO[k]) >= 0) { hit = BLOCK_CHO[k]; break; }
        }
      }
      if (hit) out.push({ word: hit, start: b.st[i], end: b.en[j - 1] });
      i = j;
    }
  }

  function findHits(text) {
    var out = [];
    var ko = build(text, 'ko');
    scan(ko, BLOCK, out);
    scanCho(ko, out);
    scan(build(text, 'en'), BLOCK_EN, out);
    return out;
  }

  /** 겹치는 구간을 하나로 합친다 */
  function merge(hits) {
    var r = hits.slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    r.forEach(function (h) {
      var last = out[out.length - 1];
      if (last && h.start <= last.end) { if (h.end > last.end) last.end = h.end; return; }
      out.push({ start: h.start, end: h.end });
    });
    return out;
  }

  /* --------------------------------------------------------------- 바깥 */

  /**
   * 올려도 되는 글인가.
   * @return {{ok:boolean, words:string[]}} words 는 걸린 표현(중복 없이)
   */
  function check(text) {
    var hits = findHits(text);
    var words = [];
    hits.forEach(function (h) { if (words.indexOf(h.word) < 0) words.push(h.word); });
    return { ok: hits.length === 0, words: words };
  }

  /**
   * 걸린 부분만 가린 글. 이미 서버에 들어온 글을 화면에 그릴 때 쓴다.
   * (앱을 거치지 않고 올린 글이 남의 화면에 그대로 뜨는 것을 막는다)
   */
  function clean(text) {
    var src = String(text == null ? '' : text);
    var spans = merge(findHits(src));
    if (!spans.length) return src;
    var out = '', at = 0;
    spans.forEach(function (s) {
      out += src.slice(at, s.start) + '○○';
      at = s.end;
    });
    return out + src.slice(at);
  }

  global.Filter = { check: check, clean: clean, BLOCK: BLOCK, ALLOW: ALLOW };

})(window);
