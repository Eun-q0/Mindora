/* =========================================================================
 * sound.js — 집중 사운드 엔진
 *
 * 모든 소리는 Web Audio API 로 그 자리에서 합성한다. 음원 파일을 담고 있지
 * 않으므로 인터넷 없이도 돌아가고, 저작권 있는 음원을 배포하지도 않는다.
 *   · 노이즈 계열 : 백색 / 핑크 / 브라운
 *   · 환경음      : 빗소리 / 파도 / 카페 / 모닥불
 *   · 연주 계열   : 재즈 무드, 로파이 비트 (코드 진행을 실시간 연주)
 *
 * 좋아하는 노래(K-pop 등)는 사용자가 자기 기기의 음원 파일을 등록해서 쓴다.
 * 파일은 IndexedDB 에 보관되며 이 브라우저 밖으로 나가지 않는다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'neurostudy.sound.v1';

  /* ------------------------------------------------------------ 트랙 정의 */

  /* lyrics : 가사가 있는가 (언어 처리와 충돌)
   * beat   : 뚜렷한 박자가 있는가 (글 읽기를 방해, 대신 각성 유지에 도움)
   * calm   : 진정 계열인가 (스트레스가 높을 때 유리) */
  var TRACKS = [
    { id: 'off', name: '사용 안 함', icon: '🔇', group: 'none', lyrics: false, beat: false, calm: true,
      desc: '소리 없이 조용히 공부합니다.' },

    { id: 'white', name: '백색소음', icon: '⚪', group: 'noise', lyrics: false, beat: false, calm: false,
      desc: '모든 음역이 고르게 섞인 소리. 갑자기 나는 소리를 덮어 줍니다.' },
    { id: 'pink', name: '핑크노이즈', icon: '🌸', group: 'noise', lyrics: false, beat: false, calm: true,
      desc: '백색소음보다 저음이 강해 덜 날카롭습니다. 오래 들어도 피로가 적어요.' },
    { id: 'brown', name: '브라운노이즈', icon: '🟤', group: 'noise', lyrics: false, beat: false, calm: true,
      desc: '저음 위주라 사람 말소리를 가장 잘 가려 줍니다. 주변이 시끄러울 때.' },

    { id: 'rain', name: '빗소리', icon: '🌧️', group: 'ambient', lyrics: false, beat: false, calm: true,
      desc: '잔잔한 비와 물방울 소리. 마음을 가라앉히는 데 좋습니다.' },
    { id: 'wave', name: '파도 소리', icon: '🌊', group: 'ambient', lyrics: false, beat: false, calm: true,
      desc: '천천히 밀려왔다 빠지는 파도. 호흡이 느려지며 긴장이 풀립니다.' },
    { id: 'cafe', name: '카페 소음', icon: '☕', group: 'ambient', lyrics: false, beat: false, calm: false,
      desc: '적당한 웅성거림과 잔 부딪히는 소리. 아이디어를 떠올릴 때 어울립니다.' },
    { id: 'fire', name: '모닥불', icon: '🔥', group: 'ambient', lyrics: false, beat: false, calm: true,
      desc: '타닥타닥 장작 소리. 늦은 밤 차분하게 공부할 때.' },

    { id: 'jazz', name: '재즈 무드', icon: '🎷', group: 'music', lyrics: false, beat: true, calm: false,
      desc: '가사 없는 재즈 코드 진행을 실시간으로 연주합니다. 외울 때 말소리와 부딪히지 않아요.' },
    { id: 'lofi', name: '로파이 비트', icon: '🎧', group: 'music', lyrics: false, beat: true, calm: false,
      desc: '느릿한 비트와 따뜻한 화음. 일정한 리듬이 문제 푸는 속도를 잡아 줍니다.' },
    { id: 'drone', name: '딥 드론', icon: '🌌', group: 'music', lyrics: false, beat: false, calm: true,
      desc: '변화가 거의 없는 낮은 지속음. 소리가 있는 줄도 잊게 되는 단순한 배경.' }
  ];

  function trackById(id) {
    if (!id) return null;
    if (id.indexOf('custom:') === 0) {
      var t = customCache.filter(function (c) { return 'custom:' + c.id === id; })[0];
      // 내가 등록한 곡은 가사와 박자가 있다고 보수적으로 가정한다
      return t ? { id: id, name: t.name, icon: '🎵', group: 'custom', lyrics: true, beat: true, calm: false,
                   desc: '내가 등록한 음악입니다.' } : null;
    }
    return TRACKS.filter(function (t) { return t.id === id; })[0] || null;
  }

  /* --------------------------------------------------------------- 설정 */

  var DEFAULT_MAP = {
    memorize: 'jazz',     // 암기형 — 가사 없는 재즈
    calculate: 'lofi',    // 계산형 — 리듬 있는 비트 (내 음악을 넣으면 그걸로 바뀜)
    reading: 'rain',      // 독해형 — 가사 있는 음악은 글 읽기와 부딪힌다
    creative: 'cafe',     // 창의형 — 적당한 웅성거림
    mixed: 'brown'        // 혼합형 — 무난한 차단용
  };

  function settings() {
    var d;
    try { d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { d = null; }
    d = d || {};
    return {
      map: Object.assign({}, DEFAULT_MAP, d.map || {}),
      volume: typeof d.volume === 'number' ? d.volume : 0.45,
      autoPlay: d.autoPlay !== false,
      breakTrack: d.breakTrack || 'off',
      followState: d.followState !== false
    };
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
  }

  function resetSettings() { try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* 무시 */ } }

  /** 이미 지워진 내 음악을 가리키는 설정을 기본값으로 되돌린다.
   *  이걸 안 하면 선택지에 없는 값이라 화면에 조용히 '사용 안 함' 으로 보인다.
   *  반드시 customCache 가 채워진 뒤(listCustom 이후)에 호출해야 한다. */
  function sanitize() {
    var s = settings(), changed = false;
    var ids = customCache.map(function (c) { return 'custom:' + c.id; });
    Object.keys(s.map).forEach(function (k) {
      if (s.map[k] && s.map[k].indexOf('custom:') === 0 && ids.indexOf(s.map[k]) < 0) {
        s.map[k] = DEFAULT_MAP[k] || 'brown';
        changed = true;
      }
    });
    if (s.breakTrack && s.breakTrack.indexOf('custom:') === 0 && ids.indexOf(s.breakTrack) < 0) {
      s.breakTrack = 'off';
      changed = true;
    }
    if (changed) saveSettings(s);
    return changed;
  }

  /* ---------------------------------------------------------- 오디오 준비 */

  var ctx = null, master = null, analyser = null, levelBuf = null;
  var current = null, currentId = 'off';

  function audio() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings().volume;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      levelBuf = new Uint8Array(analyser.fftSize);
      master.connect(analyser);
      analyser.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 지금 실제로 나가고 있는 소리의 세기(0~1). 재생 표시등과 동작 확인에 쓴다. */
  function level() {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(levelBuf);
    var sum = 0;
    for (var i = 0; i < levelBuf.length; i++) {
      var v = (levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / levelBuf.length);
  }

  function contextState() { return ctx ? ctx.state : 'none'; }

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* --------------------------------------------------------- 노이즈 버퍼 */

  var noiseCache = {};

  function noiseBuffer(kind) {
    if (noiseCache[kind]) return noiseCache[kind];
    var len = Math.floor(ctx.sampleRate * 3);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), i, w;
      if (kind === 'white') {
        for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } else if (kind === 'pink') {
        var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (i = 0; i < len; i++) {
          w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520;
          b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.0168980;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      } else { // brown
        var last = 0;
        for (i = 0; i < len; i++) {
          w = Math.random() * 2 - 1;
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    noiseCache[kind] = buf;
    return buf;
  }

  function noiseSource(kind) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(kind);
    src.loop = true;
    return src;
  }

  /** 잔향용 임펄스 응답을 난수로 만들어 쓴다 */
  function reverb(seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    var cv = ctx.createConvolver();
    cv.buffer = buf;
    return cv;
  }

  function envGain(value) {
    var g = ctx.createGain();
    g.gain.value = value;
    return g;
  }

  /* ======================================================= 사운드 생성기 == */

  /** 단순 노이즈 (필터 한 겹) */
  function playNoise(kind) {
    var src = noiseSource(kind);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'brown' ? 900 : (kind === 'pink' ? 6000 : 12000);
    var g = envGain(0);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(kind === 'brown' ? 0.55 : 0.30, ctx.currentTime + 1.2);
    return { nodes: [src], gain: g };
  }

  function playRain() {
    var src = noiseSource('white');
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    var g = envGain(0);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(0.24, ctx.currentTime + 1.5);

    // 굵은 물방울이 이따금 떨어지는 느낌
    var timer = setInterval(function () {
      if (Math.random() > 0.55) return;
      var d = ctx.createBufferSource(); d.buffer = noiseBuffer('white');
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 700 + Math.random() * 1600; bp.Q.value = 8;
      var dg = envGain(0.0001);
      d.connect(bp); bp.connect(dg); dg.connect(master);
      var t = ctx.currentTime;
      dg.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.01);
      dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      d.start(t); d.stop(t + 0.2);
    }, 260);

    return { nodes: [src], gain: g, timers: [timer] };
  }

  function playWave() {
    var src = noiseSource('brown');
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    var g = envGain(0);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(0.30, ctx.currentTime + 2);

    // 아주 느린 LFO 로 밀물·썰물을 만든다
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.085;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.20;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);

    var lfo2 = ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 0.085;
    var lfo2Gain = ctx.createGain(); lfo2Gain.gain.value = 420;
    lfo2.connect(lfo2Gain); lfo2Gain.connect(lp.frequency);

    lfo.start(); lfo2.start();
    return { nodes: [src, lfo, lfo2], gain: g };
  }

  function playCafe() {
    var src = noiseSource('brown');
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    var g = envGain(0);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(0.34, ctx.currentTime + 1.5);

    // 웅성거림: 대역이 천천히 움직이는 밴드패스
    var mur = noiseSource('pink');
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 800; bp.Q.value = 1.4;
    var mg = envGain(0.10);
    mur.connect(bp); bp.connect(mg); mg.connect(master);
    mur.start();
    var mLfo = ctx.createOscillator(); mLfo.type = 'sine'; mLfo.frequency.value = 0.12;
    var mLfoG = ctx.createGain(); mLfoG.gain.value = 300;
    mLfo.connect(mLfoG); mLfoG.connect(bp.frequency); mLfo.start();

    // 잔·수저 부딪히는 소리
    var timer = setInterval(function () {
      if (Math.random() > 0.22) return;
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = 1800 + Math.random() * 1800;
      var og = envGain(0.0001);
      o.connect(og); og.connect(master);
      var t = ctx.currentTime;
      og.gain.exponentialRampToValueAtTime(0.035, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.55);
    }, 1400);

    return { nodes: [src, mur, mLfo], gain: g, extraGains: [mg], timers: [timer] };
  }

  function playFire() {
    var src = noiseSource('brown');
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620;
    var g = envGain(0);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(0.40, ctx.currentTime + 1.2);

    var timer = setInterval(function () {
      var n = 1 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n; i++) {
        var c = ctx.createBufferSource(); c.buffer = noiseBuffer('white');
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        var cg = envGain(0.0001);
        c.connect(hp); hp.connect(cg); cg.connect(master);
        var t = ctx.currentTime + Math.random() * 0.4;
        cg.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.07, t + 0.004);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        c.start(t); c.stop(t + 0.09);
      }
    }, 420);

    return { nodes: [src], gain: g, timers: [timer] };
  }

  function playDrone() {
    var g = envGain(0);
    g.connect(master);
    var freqs = [55, 82.5, 110, 164.8];
    var oscs = freqs.map(function (f, i) {
      var o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004); // 살짝 디튠
      var og = envGain(i === 0 ? 0.5 : 0.16);
      o.connect(og); og.connect(g);
      o.start();
      return o;
    });
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    g.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 3);
    return { nodes: oscs, gain: g };
  }

  /* --------------------------------------------------- 연주 계열 (스케줄러) */

  /** 룩어헤드 스케줄러 — 박자를 미리 예약해 두어 흔들리지 않게 한다 */
  function scheduler(bpm, beatsPerBar, onBeat) {
    var beat = 0;
    var next = ctx.currentTime + 0.1;
    var spb = 60 / bpm;
    var timer = setInterval(function () {
      while (next < ctx.currentTime + 0.25) {
        onBeat(beat, next, spb);
        beat++;
        next += spb;
      }
    }, 25);
    return timer;
  }

  function tone(type, freq, t, dur, peak, dest, detune) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.08, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseHit(t, dur, peak, hpFreq, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer('white');
    var f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hpFreq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /** 재즈 무드 — ii-V-I-VI 진행, 워킹 베이스, 브러시 */
  function playJazz() {
    var out = envGain(0);
    out.connect(master);
    out.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 2);

    var rv = reverb(2.4, 2.6);
    var wet = envGain(0.32);
    rv.connect(wet); wet.connect(out);

    var dry = envGain(0.75);
    dry.connect(out);

    function send(t, d, p, type, freq) { tone(type, freq, t, d, p, dry); tone(type, freq, t, d, p * 0.7, rv); }

    // Dm7 - G7 - Cmaj7 - A7 (C 조성)
    var prog = [
      { bass: 38, notes: [62, 65, 69, 72] },
      { bass: 43, notes: [59, 65, 69, 74] },
      { bass: 36, notes: [60, 64, 67, 71] },
      { bass: 33, notes: [61, 64, 67, 73] }
    ];

    var timer = scheduler(78, 4, function (beat, t, spb) {
      var bar = Math.floor(beat / 4) % prog.length;
      var inBar = beat % 4;
      var ch = prog[bar];

      // 코드는 마디 첫 박에 부드럽게
      if (inBar === 0) {
        ch.notes.forEach(function (n, i) {
          send(t + i * 0.012, spb * 3.4, 0.055, 'triangle', midi(n));
        });
      }
      // 워킹 베이스 — 매 박
      var walk = [0, 7, 12, 5][inBar];
      send(t, spb * 0.9, 0.13, 'sine', midi(ch.bass + walk));
      // 브러시 — 2박·4박에 살짝
      if (inBar === 1 || inBar === 3) noiseHit(t, 0.16, 0.028, 4000, dry);
      // 스윙 느낌의 뒷박
      noiseHit(t + spb * 0.66, 0.09, 0.012, 6000, dry);
    });

    return { nodes: [], gain: out, timers: [timer] };
  }

  /** 로파이 비트 — 느린 드럼과 따뜻한 화음, 지직거리는 잡음 */
  function playLofi() {
    var out = envGain(0);
    out.connect(master);
    out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.6);

    var warm = ctx.createBiquadFilter();
    warm.type = 'lowpass'; warm.frequency.value = 2600; // 로파이 특유의 먹먹함
    warm.connect(out);

    var rv = reverb(1.8, 3);
    var wet = envGain(0.22);
    rv.connect(wet); wet.connect(out);

    // 바이닐 잡음
    var vin = noiseSource('pink');
    var vf = ctx.createBiquadFilter(); vf.type = 'highpass'; vf.frequency.value = 2500;
    var vg = envGain(0.02);
    vin.connect(vf); vf.connect(vg); vg.connect(out);
    vin.start();

    // Fmaj7 - Em7 - Dm7 - G7
    var prog = [
      { bass: 29, notes: [60, 65, 69, 72] },
      { bass: 28, notes: [59, 64, 67, 71] },
      { bass: 26, notes: [57, 62, 65, 69] },
      { bass: 31, notes: [59, 62, 65, 67] }
    ];

    var timer = scheduler(76, 4, function (beat, t, spb) {
      var bar = Math.floor(beat / 4) % prog.length;
      var inBar = beat % 4;
      var ch = prog[bar];

      if (inBar === 0) {
        ch.notes.forEach(function (n, i) {
          tone('triangle', midi(n), t + i * 0.02, spb * 3.6, 0.05, warm, 6);
          tone('sine', midi(n), t + i * 0.02, spb * 3.6, 0.02, rv);
        });
        tone('sine', midi(ch.bass), t, spb * 1.8, 0.20, warm);
      }
      if (inBar === 2) tone('sine', midi(ch.bass + 7), t, spb * 1.2, 0.13, warm);

      // 킥
      if (inBar === 0 || inBar === 2) {
        var k = ctx.createOscillator(); k.type = 'sine';
        var kg = ctx.createGain();
        k.frequency.setValueAtTime(110, t);
        k.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        kg.gain.setValueAtTime(0.32, t);
        kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        k.connect(kg); kg.connect(out);
        k.start(t); k.stop(t + 0.3);
      }
      // 스네어
      if (inBar === 1 || inBar === 3) {
        noiseHit(t, 0.20, 0.10, 1400, warm);
        tone('triangle', 190, t, 0.09, 0.04, warm);
      }
      // 하이햇 (8분음표, 뒷박은 약하게)
      noiseHit(t, 0.05, 0.022, 7000, out);
      noiseHit(t + spb * 0.5, 0.045, 0.012, 7000, out);
    });

    return { nodes: [vin], gain: out, extraGains: [vg], timers: [timer] };
  }

  /* ------------------------------------------------------- 내 음악 (파일) */

  var DB_NAME = 'neurostudy-audio', STORE = 'tracks';
  var customCache = [];
  var audioEl = null, audioNode = null, playlist = [], playIdx = 0;

  function openDb() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function tx(mode) {
    return openDb().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); });
  }

  function listCustom() {
    if (!global.indexedDB) return Promise.resolve([]);
    return tx('readonly').then(function (store) {
      return new Promise(function (res) {
        var out = [];
        store.openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { out.push({ id: cur.value.id, name: cur.value.name, size: cur.value.size }); cur.continue(); }
          else { customCache = out; sanitize(); res(out); }
        };
      });
    }).catch(function () { return []; });
  }

  function addCustom(file) {
    if (!global.indexedDB) return Promise.reject(new Error('이 브라우저는 파일 보관을 지원하지 않습니다.'));
    if (!/^audio\//.test(file.type)) return Promise.reject(new Error(file.name + ' 은(는) 오디오 파일이 아닙니다.'));
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error(file.name + ' 은(는) 25MB를 넘습니다.'));
    var rec = { id: 'c' + Date.now() + Math.floor(Math.random() * 1000), name: file.name.replace(/\.[^.]+$/, ''), size: file.size, blob: file };
    return tx('readwrite').then(function (store) {
      return new Promise(function (res, rej) {
        var r = store.add(rec);
        r.onsuccess = function () { res(rec); };
        r.onerror = function () { rej(r.error); };
      });
    }).then(function (r) { return listCustom().then(function () { return r; }); });
  }

  function removeCustom(id) {
    return tx('readwrite').then(function (store) {
      return new Promise(function (res) { store.delete(id).onsuccess = function () { res(); }; });
    }).then(listCustom);
  }

  function getCustomBlob(id) {
    return tx('readonly').then(function (store) {
      return new Promise(function (res, rej) {
        var r = store.get(id);
        r.onsuccess = function () { r.result ? res(r.result.blob) : rej(new Error('음악을 찾을 수 없습니다.')); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function playCustom(id) {
    // 지정한 곡부터 등록된 순서대로 이어서 재생
    var ids = customCache.map(function (c) { return c.id; });
    var start = ids.indexOf(id);
    playlist = ids.slice(start < 0 ? 0 : start).concat(ids.slice(0, start < 0 ? 0 : start));
    playIdx = 0;

    if (!audioEl) {
      audioEl = new Audio();
      audioEl.addEventListener('ended', function () {
        playIdx = (playIdx + 1) % playlist.length;
        loadTrack(playlist[playIdx]);
      });
    }
    if (!audioNode) {
      try {
        audioNode = ctx.createMediaElementSource(audioEl);
        audioNode.connect(master);
      } catch (e) { /* 이미 연결된 경우 무시 */ }
    }

    function loadTrack(cid) {
      getCustomBlob(cid).then(function (blob) {
        if (audioEl.src && audioEl.src.indexOf('blob:') === 0) URL.revokeObjectURL(audioEl.src);
        audioEl.src = URL.createObjectURL(blob);
        audioEl.play().catch(function () { /* 자동재생 차단 시 조용히 무시 */ });
      });
    }
    loadTrack(playlist[playIdx]);

    return {
      nodes: [], gain: null,
      stopExtra: function () {
        if (!audioEl) return;
        audioEl.pause();
        if (audioEl.src && audioEl.src.indexOf('blob:') === 0) URL.revokeObjectURL(audioEl.src);
        audioEl.removeAttribute('src');
      }
    };
  }

  /* ---------------------------------------------------------- 재생 제어 */

  var BUILDERS = {
    white: function () { return playNoise('white'); },
    pink: function () { return playNoise('pink'); },
    brown: function () { return playNoise('brown'); },
    rain: playRain, wave: playWave, cafe: playCafe, fire: playFire,
    jazz: playJazz, lofi: playLofi, drone: playDrone
  };

  function stop(fadeMs) {
    if (!current) { currentId = 'off'; return; }
    var c = current;
    current = null;
    currentId = 'off';

    var fade = (fadeMs == null ? 400 : fadeMs) / 1000;
    if (c.gain && ctx) {
      try {
        c.gain.gain.cancelScheduledValues(ctx.currentTime);
        c.gain.gain.setValueAtTime(Math.max(0.0001, c.gain.gain.value), ctx.currentTime);
        c.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fade);
      } catch (e) { /* 무시 */ }
    }
    (c.timers || []).forEach(clearInterval);
    if (c.stopExtra) c.stopExtra();

    setTimeout(function () {
      (c.nodes || []).forEach(function (n) { try { n.stop(); } catch (e) { /* 무시 */ } });
      try { if (c.gain) c.gain.disconnect(); } catch (e) { /* 무시 */ }
      (c.extraGains || []).forEach(function (g) { try { g.disconnect(); } catch (e) { /* 무시 */ } });
    }, fade * 1000 + 60);
  }

  function play(id) {
    if (!id || id === 'off') { stop(); return false; }
    if (!audio()) return false;
    if (currentId === id && current) return true;
    stop(220);

    setTimeout(function () {
      try {
        if (id.indexOf('custom:') === 0) current = playCustom(id.slice(7));
        else if (BUILDERS[id]) current = BUILDERS[id]();
        else return;
        currentId = id;
      } catch (e) { current = null; currentId = 'off'; }
    }, 240);
    return true;
  }

  function setVolume(v) {
    var s = settings();
    s.volume = Math.max(0, Math.min(1, v));
    saveSettings(s);
    if (master && ctx) master.gain.setTargetAtTime(s.volume, ctx.currentTime, 0.1);
    if (audioEl) audioEl.volume = 1; // 마스터 게인으로 조절하므로 요소 자체는 최대
  }

  function isPlaying() { return !!current || (currentId && currentId !== 'off'); }
  function currentTrackId() { return currentId; }

  /* ------------------------------------------------------------- 추천 */

  var TYPE_LABEL = {
    memorize: '암기형', calculate: '계산형', reading: '독해형',
    creative: '창의·서술형', mixed: '혼합형'
  };

  /**
   * 과목 유형에 설정된 사운드를 기본으로 하되,
   * 오늘 상태가 특정 조건에 걸리면 다른 소리를 제안한다.
   * 반환: { id, name, reason, override, base }
   */
  function recommend(type, analysis) {
    var s = settings();
    var baseId = s.map[type] || DEFAULT_MAP[type] || 'brown';
    var base = trackById(baseId) || trackById('brown');
    var label = TYPE_LABEL[type] || '학습';

    var result = {
      id: base.id, name: base.name, icon: base.icon,
      base: base, override: null,
      reason: label + ' 과목이라 설정해 두신 ' + base.name + '을(를) 재생합니다.'
    };

    if (!analysis || !s.followState) return result;

    var i = analysis.input || {};
    var focus = analysis.byId && analysis.byId.focus ? analysis.byId.focus.score : null;

    function suggest(id, why) {
      var t = trackById(id);
      if (!t || t.id === base.id) return false;
      result.override = t;
      result.id = t.id; result.name = t.name; result.icon = t.icon;
      result.reason = why;
      return true;
    }

    /* 오버라이드는 "지금 설정이 이 상태에 맞지 않을 때"만 건다.
     * 이미 조건에 맞는 소리를 골라 두었다면 과목별 설정을 그대로 존중한다. */

    // 1) 글을 읽을 땐 가사도 박자도 방해가 된다
    if (type === 'reading' && (base.lyrics || base.beat)) {
      return suggest('rain',
        '독해형 과목에는 가사나 뚜렷한 박자가 있는 음악이 불리합니다. 글을 읽는 뇌 영역과 겹쳐 같은 문장을 되읽게 되거든요. 빗소리로 바꿔 두었습니다.'
      ) ? result : result;
    }
    // 2) 외울 땐 가사가 특히 방해된다 (박자는 괜찮다)
    if (type === 'memorize' && base.lyrics) {
      return suggest('jazz',
        '암기할 때 가사 있는 음악은 손해가 큽니다. 가사를 처리하는 영역이 외우는 작업과 부딪히기 때문이에요. 가사 없는 재즈로 바꿔 두었습니다.'
      ) ? result : result;
    }
    // 3) 스트레스가 높은데 자극적인 소리를 고른 경우
    if (i.stress >= 7 && !base.calm) {
      return suggest('wave',
          '스트레스가 ' + i.stress + '/10로 높습니다. 지금 설정된 소리(' + base.name + ')는 자극이 있는 편이라, 천천히 오르내리는 파도 소리로 바꿔 두었습니다.'
      ) ? result : result;
    }
    // 4) 피로가 높은데 단조로운 소리라 더 처질 수 있는 경우 (독해형은 제외)
    if (i.fatigue >= 7 && !base.beat && type !== 'reading') {
      return suggest('lofi',
        '피로도가 ' + i.fatigue + '/10로 높습니다. 지금 설정된 ' + base.name + '은 단조로워 더 처질 수 있어요. 일정한 비트가 각성을 붙잡아 줍니다.'
      ) ? result : result;
    }
    // 5) 집중력이 많이 떨어진 날엔 음악보다 차단용 노이즈가 낫다
    if (focus !== null && focus <= 52 && base.group === 'music') {
      return suggest('brown',
        '오늘 집중력이 ' + focus + '점으로 낮습니다. 이런 날엔 음악보다 저음 노이즈가 주변 말소리를 가려 주면서 주의를 덜 뺏습니다.'
      ) ? result : result;
    }
    // 6) 늦은 밤엔 자극을 줄인다
    if (i.hour != null && i.hour >= 22 && !base.calm) {
      return suggest('fire',
        '늦은 시각입니다. 자극이 적은 소리로 마무리해야 이어지는 잠을 덜 방해합니다.'
      ) ? result : result;
    }
    return result;
  }

  global.Sound = {
    TRACKS: TRACKS, DEFAULT_MAP: DEFAULT_MAP, TYPE_LABEL: TYPE_LABEL,
    trackById: trackById,
    settings: settings, saveSettings: saveSettings, resetSettings: resetSettings, sanitize: sanitize,
    play: play, stop: stop, setVolume: setVolume,
    isPlaying: isPlaying, currentTrackId: currentTrackId,
    level: level, contextState: contextState,
    recommend: recommend,
    listCustom: listCustom, addCustom: addCustom, removeCustom: removeCustom,
    customCache: function () { return customCache; },
    supported: !!(global.AudioContext || global.webkitAudioContext)
  };

})(window);
