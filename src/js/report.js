/* =========================================================================
 * report.js — 주간 학습 리포트
 *
 * 순공 시간 기록(StudyLog)과 뇌 컨디션 기록(Store.history)을 한 주 단위로
 * 합쳐서 통계와 총평을 만든다. 총평은 실제 수치에서만 도출하며,
 * 근거가 없는 문장은 만들지 않는다.
 * ========================================================================= */
(function (global) {
  'use strict';

  var S = global.Store;
  var SL = global.StudyLog;

  var TYPE_LABEL = {
    memorize: '암기형', calculate: '계산형', reading: '독해형',
    creative: '창의·서술형', mixed: '혼합형'
  };
  /* 과목 유형 색 — 서로 구분은 되어야 하지만 앱 전체 색과 따로 놀면 안 된다.
   * 파랑·초록·주황·분홍이 섞여 있던 걸 보라를 축으로 한 차가운 계열로 모았다. */
  var TYPE_COLOR = {
    memorize: '#6d4aff', calculate: '#4f8ef7', reading: '#8a6fd8',
    creative: '#a36bff', mixed: '#8b93a8'
  };

  function fmtDur(min) {
    if (min > 0 && min < 1) return Math.max(1, Math.round(min * 60)) + '초';
    var m = Math.round(min);
    var h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '시간 ' + r + '분';
    if (h) return h + '시간';
    return r + '분';
  }

  function fmtDate(d) { return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }

  function build(offset) {
    offset = offset || 0;
    var wk = SL.week(offset);
    var prev = SL.week(offset - 1);

    var profile = S.profile() || {};
    var goalMin = (profile.goal || 25) * 60;

    var studied = wk.days.filter(function (d) { return d.min > 0; });
    var elapsedDays = wk.days.filter(function (d) { return !d.isFuture; });

    var best = wk.days.slice().sort(function (a, b) { return b.min - a.min; })[0];
    var totalSubj = wk.subjects.reduce(function (s, x) { return s + x.min; }, 0) || 1;

    var subjects = wk.subjects.map(function (x) {
      return {
        name: x.name, type: x.type, min: x.min,
        pct: x.min / totalSubj * 100,
        label: TYPE_LABEL[x.type] || '혼합형',
        color: TYPE_COLOR[x.type] || '#6d4aff'
      };
    });

    // 유형별 집계
    var byType = {};
    wk.subjects.forEach(function (x) { byType[x.type] = (byType[x.type] || 0) + x.min; });

    // 뇌 컨디션 기록 (해당 주)
    var startK = S.key(wk.start), endK = S.key(wk.end);
    var brainRows = S.history().filter(function (r) { return r.date >= startK && r.date <= endK; });
    var brainAvg = brainRows.length
      ? brainRows.reduce(function (s, r) { return s + r.overall; }, 0) / brainRows.length : null;
    var sleepAvg = brainRows.length
      ? brainRows.reduce(function (s, r) { return s + (r.sleep || 0); }, 0) / brainRows.length : null;

    var deltaMin = wk.total - prev.total;
    var deltaPct = prev.total > 0 ? (deltaMin / prev.total * 100) : null;

    return {
      offset: offset,
      start: wk.start, end: wk.end,
      label: fmtDate(wk.start) + ' ~ ' + fmtDate(wk.end),
      isCurrent: offset === 0,
      days: wk.days,
      totalMin: wk.total,
      prevTotalMin: prev.total,
      deltaMin: deltaMin,
      deltaPct: deltaPct,
      goalMin: goalMin,
      goalPct: goalMin > 0 ? wk.total / goalMin * 100 : 0,
      studyDays: studied.length,
      elapsedDays: elapsedDays.length,
      dailyAvgMin: elapsedDays.length ? wk.total / elapsedDays.length : 0,
      bestDay: best && best.min > 0 ? best : null,
      subjects: subjects,
      byType: byType,
      brainRows: brainRows,
      brainAvg: brainAvg,
      sleepAvg: sleepAvg,
      streak: SL.streak(),
      summary: []
    };
  }

  /* -------------------------------------------------------------- 총평 */

  function summarize(r) {
    var out = [];

    /* 1) 목표 달성 */
    if (r.totalMin <= 0) {
      out.push({
        tone: 'warn', icon: '🌱', title: '이번 주 기록이 아직 없습니다',
        text: '타이머의 집중 블록을 돌리면 순공 시간이 자동으로 쌓입니다. 처음엔 하루 한 블록(25분)만 목표로 잡아도 충분합니다. 기록이 쌓여야 어떤 습관이 실제로 도움이 되는지 보입니다.'
      });
      return out;
    }

    var pct = Math.round(r.goalPct);
    if (pct >= 100) {
      out.push({
        tone: 'good', icon: '🎯', title: '주간 목표 달성 (' + pct + '%)',
        text: '목표 ' + fmtDur(r.goalMin) + ' 대비 ' + fmtDur(r.totalMin) + '을 채웠습니다. ' +
              '목표를 계속 넘긴다면 다음 주엔 시간을 늘리기보다 난이도를 올리는 쪽이 실력에 더 남습니다.'
      });
    } else if (pct >= 70) {
      out.push({
        tone: 'good', icon: '📈', title: '목표의 ' + pct + '% 달성',
        text: '목표 ' + fmtDur(r.goalMin) + ' 중 ' + fmtDur(r.totalMin) + '을 채웠습니다. ' +
              '남은 ' + fmtDur(r.goalMin - r.totalMin) + '은 하루 ' + Math.ceil((r.goalMin - r.totalMin) / 7) + '분씩만 더 하면 메워집니다.'
      });
    } else {
      out.push({
        tone: 'warn', icon: '📉', title: '목표의 ' + pct + '%에 머물렀습니다',
        text: '목표 ' + fmtDur(r.goalMin) + ' 대비 ' + fmtDur(r.totalMin) + '입니다. ' +
              '목표가 현실보다 높게 잡혀 있을 수도 있습니다. 달성률이 두 주 연속 70% 아래라면 목표를 ' +
              Math.max(3, Math.round(r.totalMin / 60 * 1.2)) + '시간 정도로 낮춰 잡는 편이 오히려 꾸준해집니다.'
      });
    }

    /* 2) 지난주 대비 */
    if (r.prevTotalMin > 0 && r.deltaPct !== null) {
      var d = Math.round(r.deltaPct);
      if (d >= 10) {
        out.push({ tone: 'good', icon: '🔥', title: '지난주보다 ' + d + '% 늘었습니다',
          text: '지난주 ' + fmtDur(r.prevTotalMin) + ' → 이번 주 ' + fmtDur(r.totalMin) + '. 상승세일 때 무리해서 한 번에 늘리면 다음 주에 반동이 옵니다. 이 수준을 한 주 더 유지하는 걸 목표로 잡으세요.' });
      } else if (d <= -10) {
        out.push({ tone: 'warn', icon: '⬇️', title: '지난주보다 ' + Math.abs(d) + '% 줄었습니다',
          text: '지난주 ' + fmtDur(r.prevTotalMin) + ' → 이번 주 ' + fmtDur(r.totalMin) + '. 시험이나 행사가 있었다면 자연스러운 변동입니다. 특별한 이유가 없었다면 공부를 시작하는 시각이 늦어지지 않았는지 확인해 보세요.' });
      } else {
        out.push({ tone: '', icon: '➡️', title: '지난주와 비슷한 흐름',
          text: '지난주 ' + fmtDur(r.prevTotalMin) + ' → 이번 주 ' + fmtDur(r.totalMin) + '으로 큰 변동이 없습니다. 습관이 자리 잡았다는 뜻이기도 합니다.' });
      }
    }

    /* 3) 요일 편중 */
    var done = r.days.filter(function (d) { return !d.isFuture; });
    var zero = done.filter(function (d) { return d.min <= 0; });
    if (r.bestDay && r.totalMin > 0) {
      var share = r.bestDay.min / r.totalMin * 100;
      if (share >= 45 && done.length >= 4) {
        out.push({ tone: 'warn', icon: '⚖️', title: r.bestDay.dow + '요일에 ' + Math.round(share) + '%가 몰렸습니다',
          text: '한 날에 몰아서 하면 그날 후반부는 기억에 거의 남지 않습니다. 같은 총량이라도 여러 날에 나눠 배치하면 분산 학습 효과로 유지율이 올라갑니다.' });
      } else {
        out.push({ tone: '', icon: '📅', title: '가장 많이 공부한 날은 ' + r.bestDay.dow + '요일',
          text: fmtDur(r.bestDay.min) + '을 공부했습니다. 공부가 잘 되는 요일을 알고 있으면 어려운 과목을 그날에 배치할 수 있습니다.' });
      }
    }
    if (zero.length >= 3 && done.length >= 5) {
      out.push({ tone: 'warn', icon: '🕳️', title: '공부 기록이 없는 날이 ' + zero.length + '일',
        text: zero.map(function (d) { return d.dow; }).join('·') + '요일에 기록이 없습니다. 그날 아예 못 했다면 10분짜리 최소 블록이라도 두는 편이 흐름을 지키는 데 훨씬 유리합니다.' });
    }

    /* 4) 과목 편중 */
    if (r.subjects.length >= 2) {
      var top = r.subjects[0], bottom = r.subjects[r.subjects.length - 1];
      if (top.pct >= 55) {
        out.push({ tone: 'warn', icon: '📚', title: top.name + '에 ' + Math.round(top.pct) + '% 집중',
          text: '한 과목 비중이 절반을 넘었습니다. 가장 적게 한 ' + bottom.name + '은 ' + fmtDur(bottom.min) + '에 그쳤습니다. 시험이 임박한 과목이라면 맞는 배분이지만, 아니라면 다음 주엔 균형을 맞추세요.' });
      } else {
        out.push({ tone: 'good', icon: '📚', title: '과목 배분이 고른 편입니다',
          text: '가장 많이 한 ' + top.name + '이 ' + Math.round(top.pct) + '%로, 특정 과목에 지나치게 쏠리지 않았습니다.' });
      }
    }

    /* 5) 컨디션과 공부량의 관계 */
    if (r.brainRows.length >= 3) {
      var pairs = r.brainRows.map(function (b) { return { o: b.overall, m: SL.dayTotal(b.date) }; });
      var hi = pairs.filter(function (p) { return p.o >= 65; });
      var lo = pairs.filter(function (p) { return p.o < 65; });
      if (hi.length && lo.length) {
        var hiAvg = hi.reduce(function (s, p) { return s + p.m; }, 0) / hi.length;
        var loAvg = lo.reduce(function (s, p) { return s + p.m; }, 0) / lo.length;
        if (hiAvg > loAvg * 1.25) {
          out.push({ tone: 'good', icon: '🧠', title: '컨디션 좋은 날에 실제로 더 많이 공부했습니다',
            text: '뇌 컨디션 65점 이상인 날 평균 ' + fmtDur(hiAvg) + ', 그 미만인 날 평균 ' + fmtDur(loAvg) + '. 컨디션을 관리하는 것이 곧 공부량으로 이어지고 있다는 신호입니다.' });
        } else if (loAvg > hiAvg * 1.25) {
          out.push({ tone: 'warn', icon: '🧠', title: '컨디션이 나쁜 날에 오히려 더 오래 앉아 있었습니다',
            text: '컨디션 65점 미만인 날 평균 ' + fmtDur(loAvg) + ', 65점 이상인 날 평균 ' + fmtDur(hiAvg) + '. 시간을 늘려 부족한 집중을 메우는 패턴인데, 효율이 낮아 피로만 누적되기 쉽습니다. 컨디션이 낮은 날엔 총량을 줄이고 복습 위주로 가세요.' });
        }
      }

      if (r.brainAvg !== null) {
        var extra = '';
        if (r.sleepAvg !== null) extra = ' 이번 주 평균 수면은 ' + (Math.round(r.sleepAvg * 10) / 10) + '시간이었습니다.';
        out.push({ tone: r.brainAvg >= 65 ? 'good' : 'warn', icon: '💡',
          title: '주간 평균 뇌 컨디션 ' + Math.round(r.brainAvg) + '점',
          text: (r.brainAvg >= 74 ? '전반적으로 좋은 상태를 유지했습니다.'
                : r.brainAvg >= 62 ? '무난한 수준이었습니다.'
                : '컨디션이 낮은 주였습니다. 수면 시간을 30분만 늘려도 다음 주 점수가 눈에 띄게 달라집니다.') + extra });
      }
    }

    /* 6) 연속 학습일 */
    if (r.isCurrent && r.streak >= 3) {
      out.push({ tone: 'good', icon: '🔗', title: r.streak + '일 연속 학습 중',
        text: '연속 기록은 그 자체가 강한 동기가 됩니다. 도저히 시간이 안 나는 날엔 10분만이라도 채워서 흐름을 끊지 마세요.' });
    }

    return out;
  }

  function full(offset) {
    var r = build(offset);
    r.summary = summarize(r);
    return r;
  }

  global.Report = { build: build, summarize: summarize, full: full, fmtDur: fmtDur, TYPE_LABEL: TYPE_LABEL, TYPE_COLOR: TYPE_COLOR };

})(window);
