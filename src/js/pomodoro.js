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

  /* 블록 길이 조절 한도 — 계획은 추천일 뿐이라 사용자가 고칠 수 있어야 한다.
   * 다만 이미 지나갔거나 지금 돌아가는 블록을 건드리면 기록이 어긋나므로 막는다. */
  var LIMITS = { study: { min: 5, max: 120 }, other: { min: 1, max: 60 } };

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
    if (this.index < this.queue.length - 1) {
      this.index++;
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
