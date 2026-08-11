/* =========================================================================
 * backup.js — 복구 코드 백업 (기기를 바꿔도 기록이 따라오게)
 *
 * 왜 필요한가
 *   학습 기록은 localStorage 에만 있다. 폰을 바꾸거나 브라우저 데이터를 지우면
 *   몇 달치가 그대로 사라진다. 설정에 "백업 파일 내려받기" 가 있지만, 아무 일도
 *   없는 날 그 버튼을 스스로 누르는 학생은 거의 없다. 그래서 잃고 나서야 안다.
 *
 * 어떻게 하는가
 *   복구 코드 한 줄(MNDR-XXXX-XXXX-XXXX)로 서버에 한 칸을 잡는다.
 *   새 기기에서 그 코드만 넣으면 그대로 돌아온다. 회원가입은 여전히 없다.
 *
 * 서버는 내용을 볼 수 없다
 *   백업에는 이름·학교·학년·반이 들어 있다. 미성년자의 정보를 평문으로 서버에
 *   쌓아 두지 않기 위해, 올리기 전에 앱이 직접 암호화한다.
 *
 *     키      = PBKDF2-SHA256(복구 코드, salt = slotId, 210,000회) → AES-GCM 256
 *     본문    = base64( iv(12B) || AES-GCM 암호문 )
 *     찾는 열쇠 = SHA-256("mindora.backup.v1|" + 복구 코드) 앞 32자
 *
 *   저장되는 것은 암호문과 slotId 뿐이다. 표를 통째로 가져가도 복구 코드를
 *   되돌릴 수 없고, 따라서 복호화도 할 수 없다.
 *
 * ⚠ 코드를 잃어버리면 복구할 방법이 없다.
 *   이메일도 비밀번호 찾기도 없는 구조라 그렇다. 화면에도 그렇게 적어 둔다.
 *
 * 서버 쪽은 supabase/schema_backup.sql 이다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var KEY = 'mindora.backup.v1';
  var SALT_TAG = 'mindora.backup.v1|';
  var ITERATIONS = 210000;

  /* 사람이 받아 적을 코드다. 헷갈리는 글자(I·L·O·U·0·1)를 뺀 32자에서 뽑는다 —
   * 손으로 옮겨 적다가 O 와 0 을 바꿔 쓰면 복구가 통째로 실패하기 때문이다. */
  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ#@';
  var CODE_LEN = 12;                 // 32^12 ≈ 1.2e18

  /* 위 알파벳의 마지막 두 글자(#·@)는 자판에서 치기 나쁘다. 실제로는 30자만
   * 쓰고(30^12 ≈ 5.3e17) 나머지 두 칸은 버린다 — 여전히 추측할 수 없는 크기다. */
  var PICKABLE = 30;

  function crypto_() { return global.crypto && global.crypto.subtle ? global.crypto : null; }

  /** 이 브라우저에서 복구 코드 백업을 쓸 수 있는가.
   *  WebCrypto 는 보안 컨텍스트(https 또는 localhost)에서만 열린다. */
  function available() {
    return !!(crypto_() && global.Cloud && Cloud.configured());
  }

  function unavailableReason() {
    if (!global.Cloud || !Cloud.configured()) return '서버가 설정되지 않았습니다.';
    if (!crypto_()) {
      return global.isSecureContext === false
        ? '주소가 https 일 때만 쓸 수 있습니다. (파일을 직접 열었을 때는 백업 파일을 쓰세요)'
        : '이 브라우저는 암호화를 지원하지 않습니다.';
    }
    return '';
  }

  /* --------------------------------------------------------------- 상태 */

  function load() {
    var d = { code: '', savedAt: 0, bytes: 0, auto: true, lastError: '' };
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object') return d;
      return {
        code: normalize(o.code || ''),
        savedAt: o.savedAt || 0,
        bytes: o.bytes || 0,
        /* 코드를 한 번 만들어 둔 사람은 그 뒤로 신경 쓰고 싶지 않다.
         * 그래서 기본은 자동 저장이고, 끄는 것은 선택이다. */
        auto: o.auto !== false,
        lastError: o.lastError || ''
      };
    } catch (e) { return d; }
  }

  function save(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); return true; }
    catch (e) { return false; }
  }

  function patch(changes) {
    var s = load();
    Object.keys(changes || {}).forEach(function (k) { s[k] = changes[k]; });
    save(s);
    return s;
  }

  function linked() { return !!load().code; }

  /* ----------------------------------------------------------- 코드 다루기 */

  /** 입력한 코드를 표준형(대문자·구분선 제거)으로. 비교와 해시는 항상 이 값으로 한다.
   *
   *  ⚠ 여기서 'MNDR' 접두사를 떼면 안 된다. 코드 알파벳에 M·N·D·R 이 모두 들어 있어서
   *    우연히 MNDR 로 시작하는 코드(약 81만분의 1)의 앞 네 글자가 잘려 나간다.
   *    접두사 처리는 사람이 친 값을 받는 fromInput() 한 곳에서만, 길이로 판단한다. */
  function normalize(raw) {
    return String(raw == null ? '' : raw)
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      .slice(0, CODE_LEN);
  }

  /** 네 자씩 끊은 표기: XXXX-XXXX-XXXX */
  function group(code) {
    var c = normalize(code);
    return c ? (c.match(/.{1,4}/g) || []).join('-') : '';
  }

  /** 화면·복사용 전체 표기: MNDR-XXXX-XXXX-XXXX */
  function format(code) {
    var g = group(code);
    return g ? 'MNDR-' + g : '';
  }

  /** 사람이 치거나 붙여넣은 값에서 코드를 읽는다.
   *  접두사가 붙어 있으면 글자 수가 정확히 CODE_LEN+4 가 되므로, 그때만 떼어 낸다.
   *  (12자 코드 자체가 MNDR 로 시작하는 경우와 섞이지 않는 유일한 기준이다) */
  function fromInput(raw) {
    var s = String(raw == null ? '' : raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (s.length === CODE_LEN + 4 && s.slice(0, 4) === 'MNDR') s = s.slice(4);
    return s.slice(0, CODE_LEN);
  }

  function valid(code) { return normalize(code).length === CODE_LEN; }

  /** 새 복구 코드를 만든다. 추측을 막는 값이라 Math.random 은 쓰지 않는다. */
  function generate() {
    var c = crypto_();
    if (!c) throw new Error(unavailableReason());
    var out = '';
    /* 32로 나눈 나머지를 그대로 쓰면 앞쪽 글자가 더 자주 나온다(모듈로 편향).
     * 30 이상이 나온 바이트는 버리고 다시 뽑아 고르게 만든다. */
    while (out.length < CODE_LEN) {
      var buf = new Uint8Array(CODE_LEN * 2);
      c.getRandomValues(buf);
      for (var i = 0; i < buf.length && out.length < CODE_LEN; i++) {
        var v = buf[i] & 31;
        if (v < PICKABLE) out += ALPHABET.charAt(v);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------- 암호화 */

  function utf8(s) { return new TextEncoder().encode(s); }

  function hex(buf) {
    var b = new Uint8Array(buf), out = '';
    for (var i = 0; i < b.length; i++) out += (b[i] + 0x100).toString(16).slice(1);
    return out;
  }

  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function unb64(str) {
    var s = atob(String(str || ''));
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  /** 행을 찾는 열쇠. 코드 자체는 서버로 가지 않는다. */
  function slotId(code) {
    return crypto_().subtle.digest('SHA-256', utf8(SALT_TAG + normalize(code)))
      .then(function (d) { return hex(d).slice(0, 32); });
  }

  function deriveKey(code, slot) {
    var c = crypto_();
    return c.subtle.importKey('raw', utf8(normalize(code)), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return c.subtle.deriveKey(
          { name: 'PBKDF2', salt: utf8(slot), iterations: ITERATIONS, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encrypt(code, slot, plaintext) {
    var c = crypto_();
    var iv = new Uint8Array(12);
    c.getRandomValues(iv);
    return deriveKey(code, slot).then(function (key) {
      return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(plaintext));
    }).then(function (ct) {
      var merged = new Uint8Array(iv.length + ct.byteLength);
      merged.set(iv, 0);
      merged.set(new Uint8Array(ct), iv.length);
      return b64(merged);
    });
  }

  function decrypt(code, slot, payload) {
    var c = crypto_();
    var raw = unb64(payload);
    if (raw.length < 13) return Promise.reject(new Error('백업이 손상되었습니다.'));
    var iv = raw.slice(0, 12);
    var ct = raw.slice(12);
    return deriveKey(code, slot).then(function (key) {
      return c.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (buf) {
      return new TextDecoder().decode(buf);
    }, function () {
      /* AES-GCM 은 키가 틀리면 복호화 단계에서 실패한다. 여기 오는 경우는
       * 사실상 "코드는 맞는 칸을 찾았는데 키가 다르다" 뿐이라, 그렇게 말해 준다. */
      throw new Error('복구 코드가 이 백업과 맞지 않습니다.');
    });
  }

  /* ------------------------------------------------------------- 서버 왕복 */

  /** 지금 기록을 서버의 내 칸에 올린다(덮어쓰기). */
  function push(code) {
    code = normalize(code || load().code);
    if (!valid(code)) return Promise.reject(new Error('복구 코드가 없습니다.'));
    if (!available()) return Promise.reject(new Error(unavailableReason()));

    var plain = JSON.stringify(Store.exportAll());
    var bytes = plain.length;
    var slot;

    return slotId(code)
      .then(function (s) { slot = s; return encrypt(code, slot, plain); })
      .then(function (payload) {
        return Cloud.rpc('put_backup', { p_slot: slot, p_payload: payload, p_bytes: bytes });
      })
      .then(function () {
        var st = patch({ code: code, savedAt: Date.now(), bytes: bytes, lastError: '' });
        /* 파일 백업과 같은 취급을 한다 — 설정 화면의 "마지막 백업" 경고가
         * 서버에 올린 뒤에도 계속 떠 있으면 사용자는 실패한 줄 안다. */
        Store.markBackedUp();
        return st;
      }, function (e) {
        patch({ lastError: e.message || '올리지 못했습니다.' });
        throw e;
      });
  }

  /** 서버의 칸을 읽어 온다. 아직 복원하지는 않는다 — 미리 보고 결정하게 한다. */
  function peek(code) {
    code = normalize(code);
    if (!valid(code)) return Promise.reject(new Error('복구 코드는 12자입니다.'));
    if (!available()) return Promise.reject(new Error(unavailableReason()));

    var slot;
    return slotId(code)
      .then(function (s) { slot = s; return Cloud.rpc('get_backup', { p_slot: slot }); })
      .then(function (rows) {
        var row = rows && rows.length ? rows[0] : null;
        if (!row) throw new Error('그 복구 코드로 저장된 백업이 없습니다.');
        return decrypt(code, slot, row.payload).then(function (plain) {
          var obj;
          try { obj = JSON.parse(plain); }
          catch (e) { throw new Error('백업을 읽을 수 없습니다.'); }
          return {
            data: obj,
            savedAt: row.saved_at ? Date.parse(row.saved_at) : 0,
            bytes: row.bytes || plain.length
          };
        });
      });
  }

  /** peek 로 받아 둔 내용을 이 기기에 덮어쓴다. */
  function restore(code, found) {
    var n = Store.importAll(found.data);
    patch({ code: normalize(code), savedAt: found.savedAt || Date.now(), bytes: found.bytes || 0, lastError: '' });
    return n;
  }

  /** 서버의 칸을 지우고 이 기기의 연결도 끊는다. */
  function unlink(alsoDeleteServer) {
    var code = load().code;
    var done = function () { save({ code: '', savedAt: 0, bytes: 0, auto: true, lastError: '' }); };

    if (!alsoDeleteServer || !valid(code) || !available()) { done(); return Promise.resolve(false); }
    return slotId(code)
      .then(function (s) { return Cloud.rpc('drop_backup', { p_slot: s }); })
      .then(function () { done(); return true; },
            function (e) { done(); throw e; });   // 연결은 어쨌든 끊는다
  }

  /* --------------------------------------------------------- 자동 올리기
   * 하루에 한 번이면 충분하다. 매번 올리면 통신도 낭비고, 서버에 남는 것도
   * 어차피 마지막 한 판뿐이라 자주 올릴 이유가 없다.
   * 실패해도 조용히 넘어간다 — 지하철에서 앱을 열 때마다 오류를 띄우면
   * 사용자는 백업 자체를 꺼 버린다. */
  var DAY = 24 * 60 * 60 * 1000;

  function autoDue() {
    var s = load();
    return !!(s.code && s.auto && available() && Date.now() - s.savedAt > DAY);
  }

  function autoPush() {
    if (!autoDue()) return Promise.resolve(false);
    return push().then(function () { return true; }, function () { return false; });
  }

  /* ------------------------------------------------------------ 자체 점검
   * 콘솔에서 `Backup.selfTest()`. 서버를 거치지 않고 암호화 왕복만 본다.
   * 여기서 지키려는 불변식은 하나다 — 코드가 틀리면 절대 읽히지 않는다.
   * 이게 깨지면 남의 백업이 열린다는 뜻이라 조용히 넘어가면 안 된다. */
  function selfTest() {
    if (!crypto_()) return Promise.resolve([{ ok: false, name: 'WebCrypto', got: unavailableReason() }]);

    var out = [];
    function check(name, cond, got) { out.push({ ok: !!cond, name: name, got: got }); }

    var code = generate();
    var other = generate();
    var sample = JSON.stringify({ app: 'Mindora', data: { 'x': '한글도 그대로 왕복해야 한다' } });

    check('코드 길이 ' + CODE_LEN + '자', code.length === CODE_LEN, code.length);
    check('코드가 매번 다르다', code !== other, code + ' / ' + other);
    check('표기 왕복', fromInput(format(code)) === code, format(code));
    check('생성한 코드는 그대로', normalize(code) === code, normalize(code));
    check('구분선·소문자 섞여도 같은 코드',
      fromInput('mndr-' + code.slice(0, 4) + ' ' + code.slice(4)) === code);
    /* 코드 알파벳에 M·N·D·R 이 있다. MNDR 로 시작하는 코드의 앞 네 글자가
     * 접두사로 오인돼 잘려 나가면, 만든 사람은 영영 복구하지 못한다. */
    check('MNDR 로 시작하는 코드도 안 잘린다',
      normalize('MNDR23456789') === 'MNDR23456789' &&
      fromInput('MNDR23456789') === 'MNDR23456789' &&
      fromInput(format('MNDR23456789')) === 'MNDR23456789',
      format('MNDR23456789'));

    var slotA, slotB;
    return slotId(code)
      .then(function (s) { slotA = s; return slotId(code); })
      .then(function (s) {
        check('slotId 는 같은 코드에 항상 같다', s === slotA, slotA);
        check('slotId 는 32자 16진수', /^[0-9a-f]{32}$/.test(slotA), slotA);
        check('slotId 에 코드가 드러나지 않는다', slotA.indexOf(code.toLowerCase()) < 0);
        return slotId(other);
      })
      .then(function (s) {
        slotB = s;
        check('다른 코드는 다른 칸', slotA !== slotB);
        return encrypt(code, slotA, sample);
      })
      .then(function (payload) {
        check('암호문에 평문이 남지 않는다', payload.indexOf('Mindora') < 0 && payload.indexOf('한글') < 0);
        return decrypt(code, slotA, payload).then(function (plain) {
          check('맞는 코드로 복호화', plain === sample, plain.slice(0, 40));
          // 틀린 코드로는 반드시 실패해야 한다
          return decrypt(other, slotA, payload).then(
            function () { check('틀린 코드는 거부', false, '읽혀 버렸다'); },
            function () { check('틀린 코드는 거부', true); }
          );
        });
      })
      .then(function () {
        var bad = out.filter(function (r) { return !r.ok; });
        /* eslint-disable no-console */
        out.forEach(function (r) {
          console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.got !== undefined ? '  → ' + r.got : ''));
        });
        console.log(bad.length ? '❌ ' + bad.length + '개 실패' : '✅ ' + out.length + '개 통과');
        return out;
      });
  }

  global.Backup = {
    available: available, unavailableReason: unavailableReason,
    load: load, patch: patch, linked: linked,
    normalize: normalize, group: group, format: format, fromInput: fromInput,
    valid: valid, generate: generate,
    push: push, peek: peek, restore: restore, unlink: unlink,
    autoDue: autoDue, autoPush: autoPush, selfTest: selfTest,
    CODE_LEN: CODE_LEN, STORAGE_KEY: KEY
  };

})(window);
