/* =========================================================================
 * pomodoro.js — 타임라인 기반 뽀모도로 타이머
 *
 * 플랜이 만든 timeline(집중/휴식 블록의 배열)을 그대로 큐로 삼아 진행한다.
 * 남은 시간은 setInterval 카운트가 아니라 절대 시각(endsAt) 기준으로 계산하므로
 * 탭이 백그라운드로 밀려도 시간이 밀리지 않는다.
 * ========================================================================= */
(function (global) {
  'use strict';

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
    this.emit();
  };

  Pomodoro.prototype.pause = function () {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endsAt - Date.now());
    this.running = false;
    clearInterval(this.tick); this.tick = null;
    this.emit();
  };

  Pomodoro.prototype.toggle = function () { this.running ? this.pause() : this.start(); };

  Pomodoro.prototype.stop = function () {
    this.running = false;
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
  };

  Pomodoro.prototype.reset = function () {
    this.stop();
    this.index = 0;
    this.remainingMs = this.queue.length ? this.queue[0].ms : 0;
    this.emit();
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
