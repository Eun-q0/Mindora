/* =========================================================================
 * pomodoro.js — 타임라인 기반 뽀모도로 타이머
 *
 * 플랜이 만든 timeline(집중/휴식 블록의 배열)을 그대로 큐로 삼아 진행한다.
 * 남은 시간은 setInterval 카운트가 아니라 절대 시각(endsAt) 기준으로 계산하므로
 * 탭이 백그라운드로 밀려도 시간이 밀리지 않는다.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------- 화면 꺼짐 방지
   *
   * 집중 블록이 도는 25분 동안 폰 화면이 잠기면 몰입이 그대로 끊긴다.
   * Wake Lock 은 탭이 숨겨지면 브라우저가 자동으로 해제하므로,
   * 다시 돌아왔을 때 (아직 돌아가는 중이면) 재획득해 줘야 한다.
   * 미지원 브라우저(현재 iOS 사파리 일부)에서는 조용히 아무 일도 하지 않는다. */
  var wakeLock = null, wantWakeLock = false;

  function acquireWakeLock() {
    wantWakeLock = true;
    if (!navigator.wakeLock || wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    })['catch'](function () { /* 배터리 절약 모드 등에서는 거부될 수 있다 */ });
  }

  function releaseWakeLock() {
    wantWakeLock = false;
    if (!wakeLock) return;
    var lock = wakeLock;
    wakeLock = null;
    lock.release()['catch'](function () {});
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && wantWakeLock) acquireWakeLock();
  });

  function Pomodoro(opts) {
    this.queue = [];
    this.index = 0;
    this.remainingMs = 0;
    this.endsAt = 0;
    this.running = false;
    this.tick = null;
    this.onTick = opts.onTick || function () {};
    this.onPhase = opts.onPhase || function () {};
    this.onComplete = opts.onComplete || function () {};
    this.onFinishAll = opts.onFinishAll || function () {};
  }

  Pomodoro.prototype.load = function (timeline) {
    this.stop();
    this.queue = (timeline || []).map(function (b) {
      return {
        kind: b.kind,
        label: b.kind === 'study' ? b.subject : (b.kind === 'longBreak' ? '긴 휴식' : '휴식'),
        subject: b.subject,
        type: b.type || null,
        color: b.color || null,
        minutes: b.minutes,
        ms: Math.round(b.minutes * 60 * 1000)
      };
    });
    this.index = 0;
    this.remainingMs = this.queue.length ? this.queue[0].ms : 0;
    this.emit();
  };

  Pomodoro.prototype.current = function () {
    return this.queue[this.index] || null;
  };

  Pomodoro.prototype.start = function () {
    if (this.running || !this.current()) return;
    this.running = true;
    this.endsAt = Date.now() + this.remainingMs;
    var self = this;
    this.tick = setInterval(function () { self._step(); }, 200);
    acquireWakeLock();
    this.emit();
  };

  Pomodoro.prototype.pause = function () {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endsAt - Date.now());
    this.running = false;
    clearInterval(this.tick); this.tick = null;
    releaseWakeLock();
    this.emit();
  };

  Pomodoro.prototype.toggle = function () { this.running ? this.pause() : this.start(); };

  Pomodoro.prototype.stop = function () {
    this.running = false;
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    releaseWakeLock();
  };

  Pomodoro.prototype.reset = function () {
    this.stop();
    this.index = 0;
    this.remainingMs = this.queue.length ? this.queue[0].ms : 0;
    this.emit();
  };

  /* ------------------------------------------------- 새로고침 뒤 이어하기
   *
   * 지금까지는 새로고침 한 번이면 오늘 플랜과 타이머 위치가 통째로 사라졌다.
   * 잰 순공 시간은 남지만 "3블록 중 2번째를 하던 중" 이라는 맥락이 날아가서,
   * 분석을 다시 누르고 처음 블록부터 시작해야 했다. */

  /** 지금 상태를 그대로 담아 낸다. 돌아가는 중이면 남은 시간을 지금 기준으로
   *  확정해서 담는다 — endsAt 은 절대 시각이라 다음 실행에서는 의미가 없다. */
  Pomodoro.prototype.snapshot = function () {
    return {
      queue: this.queue,
      index: this.index,
      remainingMs: this.running ? Math.max(0, this.endsAt - Date.now()) : this.remainingMs,
      running: this.running
    };
  };

  /** snapshot() 이 담아 둔 상태로 되돌린다.
   *
   *  ⚠ 항상 **멈춘 채로** 돌아온다. 앱을 닫아 둔 동안 흐른 시간은 공부한 시간이
   *    아니므로, 돌아가던 상태 그대로 이어 붙이면 하지 않은 공부가 기록된다.
   *    다시 시작하는 것은 사용자가 누르게 둔다. */
  Pomodoro.prototype.restore = function (s) {
    if (!s || !s.queue || !s.queue.length) return false;
    this.stop();

    this.queue = s.queue.map(function (b) {
      var min = Math.max(0, Number(b.minutes) || 0);
      return {
        kind: b.kind === 'study' ? 'study' : (b.kind === 'longBreak' ? 'longBreak' : 'break'),
        label: b.label || (b.kind === 'study' ? b.subject : '휴식'),
        subject: b.subject,
        type: b.type || null,
        color: b.color || null,
        minutes: min,
        ms: Math.round(min * 60 * 1000)
      };
    });

    // 큐 밖을 가리키면 "다 끝난 상태" 로 본다 (queue.length 까지 허용)
    this.index = Math.max(0, Math.min(Math.round(s.index) || 0, this.queue.length));

    var cur = this.current();
    var ms = Math.max(0, Number(s.remainingMs) || 0);
    // 저장된 남은 시간이 블록 길이보다 클 수는 없다 (블록을 줄인 뒤 저장된 경우 등)
    this.remainingMs = cur ? Math.min(ms, cur.ms) : 0;

    this.emit();
    return true;
  };

  /* 블록 길이 조절 한도 — 계획은 추천일 뿐이라 사용자가 고칠 수 있어야 한다.
   * 다만 이미 지나갔거나 지금 돌아가는 블록을 건드리면 기록이 어긋나므로 막는다. */
  /* 휴식의 하한이 0 인 것은 "이 휴식은 건너뛴다" 를 고를 수 있게 하기 위해서다.
   * 집중은 0 을 두지 않는다 — 0분짜리 집중 블록은 시작하자마자 끝나 순공 기록과
   * 공부 후 피드백에 0분짜리 빈 줄만 남긴다. */
  var LIMITS = { study: { min: 5, max: 120 }, other: { min: 0, max: 60 } };

  function limitOf(kind) { return kind === 'study' ? LIMITS.study : LIMITS.other; }

  /** index 번째 블록을 지금 고칠 수 있는가 */
  Pomodoro.prototype.canEdit = function (index) {
    if (index < 0 || index >= this.queue.length) return false;
    if (index < this.index) return false;                    // 이미 지난 블록
    if (index === this.index &&
        (this.running || this.remainingMs < this.queue[index].ms)) return false;
    // 일시정지했더라도 한 번 시작한 블록은 길이를 바꾸지 않는다.
    // 바꾸면 남은 시간이 전체 블록 길이로 되돌아가 진행 기록이 사라진다.
    return true;
  };

  /**
   * 블록 길이를 분 단위로 바꾼다. 한도를 벗어나면 잘라서 넣는다.
   * 바꾼 값(분)을 돌려주고, 못 바꾸면 null 을 돌려준다.
   */
  Pomodoro.prototype.setMinutes = function (index, minutes) {
    if (!this.canEdit(index)) return null;

    var b = this.queue[index];
    var lim = limitOf(b.kind);
    var m = Math.round(minutes);
    if (!isFinite(m)) return null;
    m = Math.min(lim.max, Math.max(lim.min, m));

    b.minutes = m;
    b.ms = m * 60 * 1000;
    // 아직 시작하지 않은 현재 블록이면 남은 시간도 함께 맞춘다
    if (index === this.index) this.remainingMs = b.ms;
    this.emit();
    return m;
  };

  Pomodoro.prototype.limitFor = function (index) {
    var b = this.queue[index];
    return b ? limitOf(b.kind) : LIMITS.other;
  };

  /** 집중 블록 합계(분) — 목표 시간 표시를 다시 계산할 때 쓴다 */
  Pomodoro.prototype.studyMinutes = function () {
    return this.queue.reduce(function (sum, b) {
      return sum + (b.kind === 'study' ? b.minutes : 0);
    }, 0);
  };

  /** 현재 블록을 끝내고 다음으로 (완료 콜백 없이 수동 이동) */
  Pomodoro.prototype.skip = function () {
    var wasRunning = this.running;
    this.stop();
    this._advance();
    if (wasRunning && this.current()) this.start(); else this.emit();
  };

  Pomodoro.prototype._advance = function () {
    this.index++;
    /* 0분으로 줄여 둔 블록은 "이건 건너뛴다" 는 뜻이다. 그냥 지나간다 —
     * 실행시키면 시작하자마자 끝나 알림음과 "휴식 종료" 토스트만 튀어나온다. */
    while (this.index < this.queue.length && !(this.queue[this.index].ms > 0)) this.index++;

    if (this.index < this.queue.length) {
      this.remainingMs = this.queue[this.index].ms;
      this.onPhase(this.current(), this.index);
      return true;
    }
    this.index = this.queue.length;
    this.remainingMs = 0;
    return false;
  };

  Pomodoro.prototype._step = function () {
    var left = this.endsAt - Date.now();
    if (left > 0) { this.remainingMs = left; this.emit(); return; }

    var finished = this.current();
    this.remainingMs = 0;
    this.emit();
    this.onComplete(finished, this.index);

    var hasNext = this._advance();
    if (hasNext) {
      this.endsAt = Date.now() + this.remainingMs;
      this.emit();
    } else {
      this.stop();
      this.emit();
      this.onFinishAll();
    }
  };

  Pomodoro.prototype.emit = function () {
    var cur = this.current();
    this.onTick({
      block: cur,
      index: this.index,
      total: this.queue.length,
      remainingMs: this.remainingMs,
      totalMs: cur ? cur.ms : 0,
      running: this.running,
      done: this.index >= this.queue.length
    });
  };

  /* ------------------------------------------------------------ 알림음 */
  var actx = null;

  function beep(kind) {
    try {
      if (!actx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();

      // 집중 종료: 상승 3음 / 휴식 종료: 하강 2음
      var notes = kind === 'study' ? [660, 880, 1320] : [880, 660];
      notes.forEach(function (f, i) {
        var t0 = actx.currentTime + i * 0.17;
        var osc = actx.createOscillator();
        var gain = actx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.30);
        osc.connect(gain); gain.connect(actx.destination);
        osc.start(t0); osc.stop(t0 + 0.32);
      });
    } catch (e) { /* 오디오 미지원 환경은 조용히 무시 */ }
  }

  global.Pomodoro = Pomodoro;
  global.Pomodoro.beep = beep;

})(window);
