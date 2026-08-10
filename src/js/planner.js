/* =========================================================================
 * planner.js — 학습 플래너
 *
 *  1) 과목 우선순위 = 긴급도 · 준비도 격차 · 중요도 · 오늘의 뇌 적합도
 *  2) 뽀모도로 파라미터를 뇌 컨디션에 맞춰 자동 조정
 *  3) 블록을 시간대에 배치할 때 "그 시각의 뇌 능력"을 다시 반영
 *     → 계산형은 오전으로, 창의·서술형은 저녁으로 자연스럽게 밀린다
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.BrainEngine._util;
  var clamp = U.clamp, pw = U.pw;

  /* 과목 유형별 뇌 능력 친화도 (합 = 1) */
  var TYPES = {
    memorize: {
      label: '암기형', icon: '📚', hint: '영단어 · 역사 · 생물 · 법 · 개념 암기',
      affinity: { memory: 0.55, focus: 0.25, language: 0.20 }
    },
    calculate: {
      label: '계산형', icon: '🔢', hint: '수학 · 물리 · 화학 · 회계',
      affinity: { computation: 0.50, focus: 0.30, memory: 0.20 }
    },
    reading: {
      label: '독해형', icon: '📖', hint: '국어 · 영어 독해 · 사회 · 지문 분석',
      affinity: { language: 0.50, focus: 0.28, memory: 0.22 }
    },
    creative: {
      label: '창의·서술형', icon: '✍️', hint: '논술 · 작문 · 기획 · 디자인 · 발표',
      affinity: { creativity: 0.50, language: 0.30, memory: 0.20 }
    },
    mixed: {
      label: '혼합형', icon: '🧩', hint: '유형이 섞인 과목 · 종합 복습',
      affinity: { focus: 0.25, memory: 0.25, language: 0.20, computation: 0.18, creativity: 0.12 }
    }
  };

  /* 유형 × 컨디션 수준별 학습법
   * kidsBody 는 초·중학생에게 보여 주는 쉬운 말 버전이다.
   * 방법 자체는 같고 용어만 바꿨다. */
  var METHODS = {
    memorize: {
      high: {
        title: '능동 회상 + 새 범위 진도',
        body: '오늘 입력값에서는 암기·인출 과제가 다른 유형보다 상대적으로 덜 부담스러운 것으로 추정됩니다. 새 범위를 나가되 읽기만 하지 말고, 한 단락마다 교재를 덮고 백지에 인출하세요. 빠진 부분만 다시 확인해 보세요.',
        kidsBody: '오늘은 암기 과제를 먼저 시도해 볼 수 있어요. 한 문단을 읽고 책을 덮은 다음 빈 종이에 기억나는 내용을 적어 보세요. 자기 전에 5분만 다시 확인하고, 실제로 잘 떠오르는지 기록해 보세요.'
      },
      mid: {
        title: '새 암기 60% + 복습 40%',
        body: '10분 학습 → 2분 백지 인출 루틴으로 끊어 가세요. 새 범위만 밀어붙이면 저녁에 대부분 날아갑니다. 어제·지난주 범위를 섞어 주면 같은 시간으로 유지율이 크게 올라갑니다.',
        kidsBody: '10분 외우고 2분 동안 종이에 적어 보기를 반복하세요. 어제 배운 내용도 조금씩 섞은 뒤 어느 쪽이 더 잘 떠오르는지 확인해 보세요.'
      },
      low: {
        title: '재인출 위주 · 새 암기 최소화',
        body: '오늘은 새로 넣기보다 이미 넣은 것을 꺼내는 데 쓰세요. 인출이 막히면 첫 글자만 보는 힌트 카드를 활용하고, 3번 연속 막힌 항목은 따로 빼서 컨디션 좋은 날로 넘기세요.',
        kidsBody: '오늘은 새로 외우기 힘든 날이에요. 새 걸 넣기보다 어제·저번 주에 외운 걸 다시 떠올려 보세요. 생각이 안 나면 첫 글자만 살짝 보고 맞혀 보세요. 세 번이나 막히는 건 따로 빼 두었다가 컨디션 좋은 날 하면 됩니다.'
      }
    },
    calculate: {
      high: {
        title: '실전 세트 타임어택',
        body: '오늘 입력값에서는 계산형 과제가 다른 유형보다 상대적으로 덜 부담스러운 것으로 추정됩니다. 시간을 재고 실전 세트를 풀되, 실제 체감이 다르면 난이도나 시간을 낮추세요. 채점은 세트를 끝낸 뒤 한 번에 하세요.',
        kidsBody: '오늘은 계산이 잘 되는 날이에요! 시계를 맞춰 놓고 문제를 쭉 풀어 보세요. 어려운 문제일수록 지금 푸는 게 좋아요. 채점은 한 문제씩 하지 말고 다 풀고 나서 한 번에 하세요.'
      },
      mid: {
        title: '유형별 중난도 → 고난도 1~2문항',
        body: '유형별 대표 문제로 감을 올린 뒤, 마지막 블록에서만 고난도에 도전하세요. 막히는 문항은 10분 룰(10분 넘으면 해설 확인 후 다시 풀기)을 지키면 시간이 새지 않습니다.',
        kidsBody: '보통 난이도 문제로 감을 잡은 다음, 마지막에만 어려운 문제 한두 개에 도전해 보세요. 한 문제를 10분 넘게 붙잡고 있으면 답지를 보고, 답지를 덮고 다시 풀어 보세요. 그래야 시간이 안 새요.'
      },
      low: {
        title: '오답노트 · 풀이 과정 재현',
        body: '오늘은 새 유형보다 익숙한 오답부터 시작해 보세요. 틀린 문제의 풀이를 처음부터 다시 쓰고, 어느 줄에서 틀렸는지 표시한 뒤 실제 체감을 남기세요.',
        kidsBody: '오늘 새 문제는 잘 안 풀릴 거예요. 대신 틀렸던 문제를 처음부터 다시 풀어 보고, 어디서 틀렸는지 동그라미 쳐 보세요. 힘은 덜 들면서 내가 자주 하는 실수를 찾을 수 있어요.'
      }
    },
    reading: {
      high: {
        title: '낯선 주제 장문 정독 + 요약 재구성',
        body: '오늘 입력값에서는 독해형 과제가 다른 유형보다 상대적으로 덜 부담스러운 것으로 추정됩니다. 평소 피하던 긴 지문을 잡고 문단별 한 줄 요약 → 전체 한 문장 요약 순으로 압축해 보세요.',
        kidsBody: '오늘은 글이 잘 읽히는 날이에요! 평소 어려워서 피하던 긴 글에 도전해 보세요. 문단마다 한 줄로 줄여 쓰고, 마지막엔 글 전체를 한 문장으로 줄여 보세요. 글의 뼈대가 보이기 시작합니다.'
      },
      mid: {
        title: '익숙한 주제 + 근거 문장 표시',
        body: '지문을 풀고 끝내지 말고, 틀린 문항의 근거 문장을 지문에서 직접 찾아 표시하세요. 정답 확인만 하는 복습은 거의 남지 않습니다.',
        kidsBody: '문제를 풀고 그냥 넘어가지 마세요. 틀린 문제는 답이 되는 문장을 글 속에서 찾아 밑줄을 그어 보세요. 정답만 확인하고 넘어가면 다음에 또 틀립니다.'
      },
      low: {
        title: '문장 단위 해석 + 어휘 정리',
        body: '긴 지문은 오늘 붙잡아도 눈만 굴러갑니다. 짧은 문단을 문장 단위로 끊어 해석하고 모르는 어휘를 정리하세요. 소리 내어 읽으면 이해도가 눈에 띄게 올라갑니다.',
        kidsBody: '오늘 긴 글이 부담스럽다면 짧은 글을 한 문장씩 끊어 읽고, 모르는 낱말만 따로 적어 두세요. 소리 내어 읽는 방식이 맞는지도 확인해 보세요.'
      }
    },
    creative: {
      high: {
        title: '백지에서 통째로 써 보기',
        body: '오늘 입력값과 시간대 기준으로 서술·기획 과제가 상대적으로 덜 부담스러운 것으로 추정됩니다. 먼저 답안을 써 본 다음 모범답안과 구조를 비교하세요.',
        kidsBody: '오늘은 새로운 생각이 잘 떠오르는 시간이에요! 예시 답을 보기 전에 내 생각을 먼저 쭉 써 보세요. 다 쓰고 나서 예시 답과 비교해 보면 됩니다. 순서를 바꾸면 남의 생각을 그대로 따라 쓰게 돼요.'
      },
      mid: {
        title: '개요 직접 설계 + 한 문단 완성',
        body: '먼저 스스로 뼈대를 짠 뒤 본문 한 문단을 완성해 보세요. 전체를 얕게 쓰는 방식과 한 문단을 다듬는 방식 중 어느 쪽이 맞는지 피드백으로 확인하세요.',
        kidsBody: '무엇을 쓸지 순서부터 직접 정해 보세요. 그다음 한 문단만 완성하고, 이 방식이 시작하기 편했는지 피드백을 남겨 보세요.'
      },
      low: {
        title: '우수 답안 구조 분해',
        body: '오늘은 생산보다 분석을 먼저 제안합니다. 모범답안을 목차 수준으로 분해하고, 실제 체감이 괜찮은 날 살을 붙여 보세요.',
        kidsBody: '오늘은 직접 쓰기보다 잘 쓴 글을 뜯어보는 날이에요. 예시 답이 어떤 순서로 쓰였는지 번호를 매겨 정리해 두세요. 그 틀에 내 생각을 채우는 건 컨디션 좋은 날 하면 됩니다.'
      }
    },
    mixed: {
      high: {
        title: '개념 → 적용 → 백지 요약 3단 루틴',
        body: '한 블록 안에서 개념 정리 → 문제 적용 → 백지 요약까지 한 바퀴를 돌리세요. 컨디션이 좋을 때만 소화되는 밀도 높은 루틴입니다.',
        kidsBody: '한 블록 안에서 ① 개념 읽기 → ② 문제 풀기 → ③ 빈 종이에 정리하기를 한 바퀴 돌려 보세요. 컨디션 좋은 날에만 할 수 있는 알찬 방법이에요.'
      },
      mid: {
        title: '개념 60% / 문제 40%',
        body: '블록 끝 3분은 무조건 요약에 쓰세요. 요약을 못 쓰면 그 블록은 이해하지 못한 것이므로 다음 블록에서 다시 잡아야 합니다.',
        kidsBody: '개념을 조금 더 많이 보고 문제를 풀어 보세요. 블록이 끝나기 3분 전엔 꼭 배운 걸 정리해 보세요. 정리가 안 써지면 아직 이해 못 한 거라 다음 블록에서 다시 보면 됩니다.'
      },
      low: {
        title: '목차 훑기로 예열 후 진입',
        body: '가벼운 개념 복습과 목차 훑기로 시작하세요. 20분 뒤 피로 체감을 다시 확인하고 괜찮다면 문제로 넘어갑니다.',
        kidsBody: '바로 문제가 부담스럽다면 목차와 배운 내용을 가볍게 훑으며 시작하세요. 20분 뒤 괜찮은지 확인하고 문제로 넘어가면 됩니다.'
      }
    }
  };

  /* ------------------------------------------------------- 뽀모도로 설정 */

  /* 컨디션과 무관하게 쓰고 싶은 사람을 위한 고정 길이.
   * 자동 조절이 맞지 않는다고 느끼는 사람에게 "매번 같은 길이" 는 그 자체로
   * 리듬이 된다. 피로 보정도 걸지 않는다 — 고정을 골랐으면 고정이어야 한다. */
  var FIXED_POM = { focus: 50, short: 10, long: 20, cycle: 3, name: '50/10 고정' };

  function pomodoroFor(overall, fatigue, fixed) {
    if (fixed) {
      var f = {};
      for (var k in FIXED_POM) if (FIXED_POM.hasOwnProperty(k)) f[k] = FIXED_POM[k];
      return f;
    }
    var p;
    if (overall >= 85) p = { focus: 50, short: 10, long: 20, cycle: 3, name: '딥워크 모드' };
    else if (overall >= 74) p = { focus: 45, short: 9, long: 20, cycle: 3, name: '집중 강화 모드' };
    else if (overall >= 62) p = { focus: 35, short: 7, long: 18, cycle: 4, name: '표준 플러스 모드' };
    else if (overall >= 50) p = { focus: 25, short: 5, long: 15, cycle: 4, name: '클래식 뽀모도로' };
    else if (overall >= 38) p = { focus: 20, short: 8, long: 20, cycle: 3, name: '저부하 모드' };
    else p = { focus: 15, short: 10, long: 25, cycle: 3, name: '회복 우선 모드' };

    if (fatigue >= 7) { p.short += 2; p.long += 5; }
    if (fatigue <= 2 && overall >= 70) p.short = Math.max(5, p.short - 1);
    return p;
  }

  function totalScale(overall) {
    if (overall >= 85) return { k: 1.00, note: '컨디션이 최상이라 계획한 시간을 그대로 소화할 수 있습니다.' };
    if (overall >= 74) return { k: 1.00, note: '컨디션이 좋아 계획한 학습 시간을 그대로 배정했습니다.' };
    if (overall >= 62) return { k: 0.94, note: '무난한 컨디션이라 계획 대비 약간의 여유를 두었습니다.' };
    if (overall >= 50) return { k: 0.86, note: '컨디션이 보통이라 총량을 14% 줄였습니다. 남는 시간은 회복에 쓰세요.' };
    if (overall >= 38) return { k: 0.72, note: '자기보고 입력에서 준비도가 낮게 나타나 총량을 28% 줄였습니다. 실제 피로 체감에 따라 더 줄여도 됩니다.' };
    return { k: 0.55, note: '회복이 우선인 상태라 총량을 45% 줄였습니다. 오늘은 최소한만 하고 일찍 자세요.' };
  }

  /* --------------------------------------------------------- 우선순위 계산 */

  function urgencyOf(daysLeft) {
    if (daysLeft === null || daysLeft === undefined) return 0.30;
    if (daysLeft < 0) return 0.05;
    return pw(daysLeft, [
      [0, 1.00], [1, 0.97], [2, 0.92], [3, 0.86], [4, 0.80], [5, 0.74], [7, 0.64],
      [10, 0.52], [14, 0.41], [21, 0.29], [30, 0.21], [45, 0.14], [60, 0.10], [120, 0.05]
    ]);
  }

  function capScoreAt(cap, hour) {
    return clamp(cap.baseScore * global.BrainEngine.circMultiplier(cap.id, hour), 1, 100);
  }

  /** 시각 t 에서 해당 유형이 쓰는 능력의 가중 평균 점수 (0~100, 절대값) */
  function typeScoreAt(analysis, type, hour) {
    var aff = TYPES[type].affinity, sum = 0;
    Object.keys(aff).forEach(function (capId) {
      sum += aff[capId] * capScoreAt(analysis.byId[capId], hour);
    });
    return sum;
  }

  /** 시각 t 에서 5개 능력의 평균 (0~100) */
  function capMeanAt(analysis, hour) {
    var sum = 0;
    analysis.capacities.forEach(function (cap) { sum += capScoreAt(cap, hour); });
    return sum / analysis.capacities.length;
  }

  /** 유형 점수가 평균에서 몇 점 떨어져 있는지 (부호 있는 점수) */
  function fitDevAt(analysis, type, hour) {
    return typeScoreAt(analysis, type, hour) - capMeanAt(analysis, hour);
  }

  /** 특정 시각 t 에서 해당 과목 유형의 뇌 적합도 (0~1)
   *
   *  절대 점수가 아니라 "그 시각 5개 능력 평균 대비 편차" 로 잰다.
   *  5개 능력은 수면·피로라는 같은 뿌리에서 나와 함께 오르내리기 때문에,
   *  절대값으로 재면 컨디션 나쁜 날에는 모든 과목이 한꺼번에 '궁합 나쁨' 이 되어
   *  정작 "그래서 뭘 먼저 하냐" 는 질문에 답을 주지 못한다.
   *  오늘 총량이 얼마나 되는지는 종합 점수가 따로 말해 주므로,
   *  궁합은 배분(무엇부터)만 책임진다. */
  function fitAt(analysis, type, hour) {
    // 편차가 작은 날에는 반폭 하한(4점)이 값을 0.5 근처로 눌러 준다
    var half = Math.max(4, analysis.capSpread / 2);
    return clamp(0.5 + fitDevAt(analysis, type, hour) / (2 * half), 0, 1);
  }

  var FIT_GOOD = 0.62, FIT_OK = 0.42;

  /* ------------------------------------------------ 블록 수 배분 (최대잔여법) */

  function allocateBlocks(subjects, totalBlocks) {
    if (totalBlocks <= 0) return;
    var sharp = subjects.map(function (s) { return Math.pow(s.priority, 1.6); });
    var sum = sharp.reduce(function (a, b) { return a + b; }, 0) || 1;

    var exact = sharp.map(function (v) { return v / sum * totalBlocks; });
    var base = exact.map(function (v) { return Math.floor(v); });
    var used = base.reduce(function (a, b) { return a + b; }, 0);

    var rem = exact.map(function (v, idx) { return { idx: idx, frac: v - base[idx] }; })
      .sort(function (a, b) { return b.frac - a.frac; });

    var left = totalBlocks - used, r = 0;
    while (left > 0) { base[rem[r % rem.length].idx]++; left--; r++; }

    // 0블록 과목이 있으면 가장 많이 받은 과목에서 1개를 옮겨 준다
    for (var i = 0; i < subjects.length; i++) {
      if (base[i] > 0) continue;
      var maxIdx = 0;
      for (var j = 1; j < base.length; j++) if (base[j] > base[maxIdx]) maxIdx = j;
      if (base[maxIdx] >= 2) { base[maxIdx]--; base[i] = 1; }
    }
    subjects.forEach(function (s, idx) { s.blocks = base[idx]; });
  }

  /* ------------------------------------------------------------- 취침 커퓨
   *
   *  수면을 가장 큰 변수로 쓰는 앱이 사용자를 밤새우게 스케줄하면 안 된다.
   *  목표 취침 시각을 하드 리밋으로 두고, 그 시각을 넘는 블록은 아예 만들지 않는다.
   *  화면을 끄고 잠들기까지의 완충으로 30분을 남겨 둔다. */
  var WIND_DOWN_MIN = 30;
  // 하루의 경계. 이 시각 이전에 앱을 열었다면 아직 "어제" 가 안 끝난 것으로 본다.
  var DAY_START = 5;

  /** 취침 시각을 startHour 와 같은 연속 축 위의 값으로 정규화 */
  function normalizedBedHour(startHour, bedHour) {
    if (bedHour === null || bedHour === undefined) return null;
    if (startHour < DAY_START) {
      // 새벽에 열었다 = 이미 자정을 넘겼다.
      // 저녁 취침 시각(23:30 등)은 '어젯밤' 이므로 이미 지난 시각이다.
      return bedHour >= DAY_START ? bedHour - 24 : bedHour;
    }
    return bedHour <= startHour ? bedHour + 24 : bedHour;
  }

  function fmtDur(min) {
    var m = Math.max(0, Math.round(min));
    var h = Math.floor(m / 60);
    if (!h) return m + '분';
    return m % 60 ? h + '시간 ' + (m % 60) + '분' : h + '시간';
  }

  function fmtHour(h) {
    var t = ((h % 24) + 24) % 24;
    var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /** 지금부터 취침까지 남은 분. 음수면 이미 취침 시각을 넘긴 것. null 이면 미설정 */
  function curfewMinutes(input) {
    var bed = normalizedBedHour(input.startHour, input.bedHour);
    if (bed === null) return null;
    return (bed - input.startHour) * 60 - WIND_DOWN_MIN;
  }

  /* ------------------------------------------------------- 타임라인 생성 */

  function buildTimeline(analysis, subjects, pom, startHour, hardEndHour) {
    var timeline = [];
    var t = startHour;
    var remaining = {};
    subjects.forEach(function (s) { remaining[s.id] = s.blocks; });

    var totalBlocks = subjects.reduce(function (a, s) { return a + s.blocks; }, 0);
    var last = null, done = 0;

    while (done < totalBlocks) {
      var maxRem = Math.max.apply(null, subjects.map(function (s) { return remaining[s.id]; }));
      var best = null, bestScore = -Infinity;

      subjects.forEach(function (s) {
        if (remaining[s.id] <= 0) return;
        var score = 0.46 * s.priority
                  + 0.32 * fitAt(analysis, s.type, t)
                  + 0.22 * (remaining[s.id] / (maxRem || 1));
        if (s.id === last) score -= 0.14; // 같은 과목 연속 배치를 살짝 억제 (인터리빙)
        if (score > bestScore) { bestScore = score; best = s; }
      });

      if (!best) break;

      // 취침 시각을 넘기면서까지 블록을 밀어 넣지 않는다.
      // 블록 수 추정은 사이클 평균값이라 실제 배치와 몇 분씩 어긋날 수 있어,
      // 여기서 한 번 더 잘라 줘야 타임라인이 커퓨를 넘지 않는다.
      var blockMinutes = best.blockMinutes || pom.focus;
      if (hardEndHour !== null && hardEndHour !== undefined && t + blockMinutes / 60 > hardEndHour) break;

      remaining[best.id]--; done++; last = best.id;

      timeline.push({
        kind: 'study',
        subjectId: best.id,
        subject: best.name,
        type: best.type,
        color: best.color,
        start: t,
        end: t + blockMinutes / 60,
        minutes: blockMinutes,
        fit: Math.round(fitAt(analysis, best.type, t) * 100)
      });
      t += blockMinutes / 60;

      if (done >= totalBlocks) break;

      var isLong = (done % pom.cycle === 0);
      var brk = isLong ? pom.long : pom.short;
      timeline.push({
        kind: isLong ? 'longBreak' : 'break',
        subject: isLong ? '긴 휴식' : '휴식',
        start: t, end: t + brk / 60, minutes: brk
      });
      t += brk / 60;
    }
    // 커퓨에 걸려 중간에 끊긴 경우 휴식으로 끝나 버리므로 꼬리를 잘라 낸다
    while (timeline.length && timeline[timeline.length - 1].kind !== 'study') timeline.pop();
    return timeline;
  }

  /* ------------------------------------------------------- 휴식 가이드 */

  function restGuide(analysis) {
    var i = analysis.input, out = [];

    if (i.fatigue >= 7) {
      out.push({
        icon: '😴', title: '20분 파워냅',
        text: (i.hour >= 12 && i.hour <= 16)
          ? '지금이 낮잠 골든타임(13~15시)입니다. 딱 20분만 자세요. 30분을 넘기면 깊은 수면에 들어가 오히려 더 멍해집니다.'
          : '피로도가 높습니다. 20분을 넘기지 않는 짧은 낮잠으로 각성을 되돌리세요. 15시 이후 낮잠은 밤잠을 망칩니다.'
      });
    }
    if (i.stress >= 6) {
      out.push({
        icon: '🌬️', title: '4-7-8 호흡 2분',
        text: '4초 들이쉬고 7초 멈추고 8초 내쉬기를 4회 반복하세요. 부교감신경이 올라와 코르티솔이 빠르게 내려갑니다. 스트레스가 높은 날 가장 비용 대비 효과가 큰 휴식입니다.'
      });
    }
    if (i.water <= 4) {
      out.push({ icon: '💧', title: '휴식마다 물 한 컵', text: '현재 ' + i.water + '컵입니다. 휴식 시작 신호를 물 마시는 행동과 묶어 두면 자연스럽게 채워집니다.' });
    }
    if (i.caffeine >= 4) {
      out.push({ icon: '🚫', title: '카페인 추가 섭취 주의', text: '이미 ' + i.caffeine + '잔입니다. 늦은 카페인은 일부 사람의 수면에 영향을 줄 수 있으니 추가 섭취를 피하세요.' });
    } else if (i.caffeine === 0 && i.hour < 15 && analysis.byId.focus.exact < 70) {
      out.push({ icon: '☕', title: '카페인은 선택', text: '집중 과제 적합도 참고값이 낮고 카페인 기록은 없습니다. 청소년·민감한 사람에게는 권하지 않으며, 물과 짧은 걷기를 먼저 시도하세요.' });
    }
    if (i.exercise === 0) {
      out.push({ icon: '🚶', title: '10분 빠른 걷기', text: '긴 휴식 때 가능하면 10분 정도 걸어 보세요. 몸을 움직이면 각성을 높이고 다음 블록을 준비하는 데 도움이 될 수 있습니다.' });
    }
    /* 잠든 사이의 공복까지 세면 아침마다 간식 안내가 뜬다.
     * engine 이 환산해 둔 '깨어 있는 동안의 공복' 을 기준으로 판단한다. */
    var fast = analysis.meal ? analysis.meal.fastHours : i.hoursSinceMeal;
    if (fast >= 5) {
      out.push({ icon: '🍎', title: '첫 휴식에 가벼운 간식', text: '마지막 식사 후 시간이 오래 지났습니다. 배고픔이 느껴진다면 견과류나 과일처럼 부담이 적은 간식과 물을 고려하세요.' });
    }

    // 계획표에 다음 끼니가 있으면 휴식과 함께 잡아 준다 — 휴식 시각과 식사 시각이 따로 놀지 않게
    if (analysis.meal && analysis.meal.nextMeal) {
      var nm = analysis.meal.nextMeal;
      out.push({
        icon: '🍚', title: '다음 끼니는 ' + nm.label + ' ' + fmtHour(nm.hour),
        text: '계획표에 적어 둔 시각입니다. 그 앞뒤 블록은 짧게 잡고, 식사 직후 20~30분은 가벼운 과제로 두세요.'
      });
    }
    if (i.sleep.hours < 6) {
      out.push({ icon: '🛏️', title: '오늘은 취침 시각이 최우선', text: '수면 부족이 오늘 점수를 가장 크게 끌어내렸습니다. 학습 종료 시각을 앞당겨서라도 평소보다 일찍 자는 게 내일까지 합산하면 이득입니다.' });
    }
    out.push({ icon: '📵', title: '휴식 중 화면 잠시 내려놓기', text: 'SNS·영상 대신 눈 감기, 창밖 보기, 가벼운 스트레칭처럼 자극이 적은 휴식을 시도해 보세요. 다음 블록의 집중 체감을 피드백으로 확인할 수 있습니다.' });
    return out;
  }

  /* --------------------------------------------------------- 과목별 사유 */

  /* 궁합은 "오늘 평균 대비" 라는 것이 문장에서도 드러나야 한다.
   * 절대 점수만 읊으면 종합 점수가 낮은 날 요약("계산 능력이 가장 잘 올라와 있다")과
   * 과목 카드("계산형은 궁합이 나쁘다")가 정면으로 어긋난다. */
  function fitReason(s, analysis) {
    var label = TYPES[s.type].label;
    if (!analysis.capMeaningful) {
      return '오늘은 과제 적합도 간 편차가 작아 유형 차이가 큰 변수가 아닙니다';
    }
    var dev = Math.round(Math.abs(s.fitDev) * 10) / 10;
    if (s.brainFit >= FIT_GOOD) {
      return '오늘 자기보고 입력에서 ' + label + ' 과제가 쓰는 준비도(' + s.domCapLabel + ' 중심)가 평균보다 ' + dev + '점 높게 추정됐습니다';
    }
    if (s.brainFit >= FIT_OK) {
      return '오늘 자기보고 입력에서 ' + label + ' 과제 준비도가 평균과 비슷하게 추정됐습니다';
    }
    return '오늘 자기보고 입력에서 ' + label + ' 과제 준비도(' + s.domCapLabel + ' 중심)가 평균보다 ' + dev + '점 낮게 추정됐습니다';
  }

  function reasonFor(s, analysis) {
    var parts = [];
    var drivers = [
      { k: 'urgency', v: s.urgency, txt: s.daysLeft === null
          ? '시험 일정이 없어 긴급도는 기본값으로 잡혔습니다'
          : (s.daysLeft <= 2 ? '시험이 D-' + s.daysLeft + '로 코앞이라 긴급도가 최상입니다'
             : '시험까지 ' + s.daysLeft + '일 남아 긴급도 ' + Math.round(s.urgency * 100) + '%로 계산됐습니다') },
      { k: 'gap', v: s.gap, txt: '준비도가 ' + s.readiness + '/5라 ' + (s.readiness <= 2 ? '보완 여지가 매우 큽니다' : (s.readiness >= 4 ? '이미 어느 정도 올라와 있습니다' : '중간 수준입니다')) },
      { k: 'importance', v: s.importance, txt: '중요도 ' + s.importanceRaw + '/5로 ' + (s.importanceRaw >= 4 ? '비중이 큰 과목입니다' : '비중은 보통입니다') },
      { k: 'fit', v: s.brainFit, txt: fitReason(s, analysis) }
    ].sort(function (a, b) { return b.v - a.v; });

    parts.push(drivers[0].txt);
    parts.push(drivers[1].txt);
    if (drivers[3].v < 0.4) parts.push('다만 ' + drivers[3].txt + ' (우선순위를 낮춘 요인)');

    return parts.join('. ') + '.';
  }

  /* ------------------------------------------------------------ 메인 진입 */

  function plan(analysis) {
    var input = analysis.input;
    var overall = analysis.overallExact;
    var pom = pomodoroFor(overall, input.fatigue, input.fixedPomodoro);
    var scale = totalScale(overall);

    var requestedMin = Math.max(0, input.availableHours * 60);
    var curfewMin = curfewMinutes(input);
    var bedHour = normalizedBedHour(input.startHour, input.bedHour);

    // 취침까지 남은 시간이 가용 시간보다 짧으면 취침 쪽이 이긴다
    var rawMin = requestedMin;
    var curfewCut = false;
    if (curfewMin !== null) {
      rawMin = Math.min(rawMin, Math.max(0, curfewMin));
      curfewCut = curfewMin < requestedMin;
    }

    // 커퓨를 이미 넘겼거나 한 블록도 들어가지 않으면 플랜 대신 취침을 권한다
    var bedtimeNow = curfewMin !== null && curfewMin < pom.focus;

    var targetMin = rawMin * scale.k;

    // 한 사이클(집중+휴식) 평균 길이로 나눠 실제 소화 가능한 블록 수 추정
    var avgBreak = pom.short + (pom.long - pom.short) / pom.cycle;
    var perCycle = pom.focus + avgBreak;
    var totalBlocks = Math.max(0, Math.floor(targetMin / perCycle));
    if (totalBlocks === 0 && targetMin >= pom.focus) totalBlocks = 1;

    // 과목 전처리
    var subjects = (input.subjects || []).map(function (s, idx) {
      var aff = TYPES[s.type].affinity;
      var domCap = null, domW = -1;
      Object.keys(aff).forEach(function (capId) {
        if (aff[capId] > domW) { domW = aff[capId]; domCap = capId; }
      });
      // 분석 화면과 같은 시각(input.hour)의 능력치를 기준으로 잰다
      var brainFit = fitAt(analysis, s.type, input.hour);
      var fitDev = fitDevAt(analysis, s.type, input.hour);

      var urgency = urgencyOf(s.daysLeft);
      var gap = 0.12 + 0.88 * ((5 - s.readiness) / 4);
      var importance = 0.20 + 0.80 * ((s.importance - 1) / 4);
      var preference = typeof s.preference === 'number' ? clamp(s.preference, -1, 1) : 0;
      var priority = (0.34 * urgency + 0.24 * gap + 0.24 * importance + 0.18 * brainFit) * (1 + preference * 0.12);

      return {
        id: s.id || ('s' + idx),
        name: s.name,
        type: s.type,
        typeLabel: TYPES[s.type].label,
        typeIcon: TYPES[s.type].icon,
        color: analysis.byId[domCap].color,
        daysLeft: s.daysLeft,
        examDate: s.examDate || null,
        readiness: s.readiness,
        importanceRaw: s.importance,
        urgency: urgency, gap: gap, importance: importance,
        brainFit: brainFit,
        fitDev: fitDev,
        domCap: domCap,
        domCapLabel: analysis.byId[domCap].label,
        domCapScore: analysis.byId[domCap].score,
        domCapRel: Math.round(analysis.byId[domCap].rel * 10) / 10,
        priority: priority,
        preference: preference,
        recommendationAction: s.recommendationAction || '',
        blocks: 0
      };
    });

    subjects = subjects.filter(function (s) { return s.recommendationAction !== 'exclude'; });
    if (!subjects.length) totalBlocks = 0;
    subjects.sort(function (a, b) { return b.priority - a.priority; });

    // 블록이 과목 수보다 적으면 상위 과목만 남긴다
    var active = subjects.slice(0, Math.max(1, Math.min(subjects.length, totalBlocks || 1)));
    var dropped = subjects.slice(active.length);

    allocateBlocks(active, totalBlocks);
    // 블록 길이 직접 조절. 추천은 추천일 뿐이라 과목별로 한 단계씩 줄이고 늘릴 수 있다.
    // 상한 120분은 타이머 큐 편집(pomodoro.js LIMITS.study)과 같은 값이다.
    active.forEach(function (s) {
      if (s.recommendationAction === 'shorter') s.blockMinutes = Math.max(10, pom.focus - 10);
      else if (s.recommendationAction === 'longer') s.blockMinutes = Math.min(120, pom.focus + 10);
      else s.blockMinutes = pom.focus;
    });
    active = active.filter(function (s) { return s.blocks > 0; });

    active.forEach(function (s) {
      s.minutes = s.blocks * s.blockMinutes;
      var cap = analysis.byId[s.domCap];
      var m = METHODS[s.type][cap.level];
      s.method = m.title;
      s.methodBody = m.body;
      s.methodBodyKids = m.kidsBody;
      s.reason = reasonFor(s, analysis);
    });

    var hardEnd = bedHour === null ? null : bedHour - WIND_DOWN_MIN / 60;
    var timeline = buildTimeline(analysis, active, pom, input.startHour, hardEnd);

    // 커퓨에 걸려 잘린 블록이 있으면 과목별 배정도 실제 배치에 맞춰 되돌린다.
    // 그러지 않으면 "30분 배정" 이라고 써 놓고 타임라인에는 없는 상태가 된다.
    var placed = {};
    timeline.forEach(function (b) {
      if (b.kind !== 'study') return;
      if (!placed[b.subjectId]) placed[b.subjectId] = { blocks: 0, minutes: 0 };
      placed[b.subjectId].blocks++;
      placed[b.subjectId].minutes += b.minutes;
    });
    active.forEach(function (s) {
      s.blocks = placed[s.id] ? placed[s.id].blocks : 0;
      s.minutes = placed[s.id] ? placed[s.id].minutes : 0;
    });
    dropped = dropped.concat(active.filter(function (s) { return s.blocks === 0; }));
    active = active.filter(function (s) { return s.blocks > 0; });

    var studyMin = active.reduce(function (a, s) { return a + s.minutes; }, 0);
    var breakMin = timeline.filter(function (b) { return b.kind !== 'study'; })
                           .reduce(function (a, b) { return a + b.minutes; }, 0);
    var endHour = timeline.length ? timeline[timeline.length - 1].end : input.startHour;

    // 헤드라인
    var top = analysis.top, bottom = analysis.bottom;
    var headline;
    if (bedtimeNow) {
      headline = curfewMin < 0
        ? '목표 취침 시각을 ' + fmtDur(-curfewMin) + ' 넘겼습니다. 지금은 자는 것이 오늘 할 수 있는 가장 좋은 학습입니다.'
        : '취침까지 ' + fmtDur(Math.max(0, curfewMin)) + ' 남았습니다. 새 블록을 시작하기엔 짧으니 오늘은 여기서 접으세요.';
    } else if (active.length === 0) {
      headline = '배정할 학습 블록이 없습니다. 가용 시간이나 과목을 확인해 주세요.';
    } else {
      headline = '오늘 자기보고 입력에서는 ' + top.label + '가 상대적으로 높고 ' +
                 bottom.label + '가 상대적으로 낮게 추정됐습니다. ' +
                 '그래서 ' + active[0].name + '에 가장 많은 시간(' + active[0].minutes + '분)을 배정했고, ' +
                 '기본 ' + pom.focus + '분 집중 / ' + pom.short + '분 휴식 리듬을 추천합니다.';
    }

    var scaleNote = scale.note;
    if (curfewCut && !bedtimeNow) {
      scaleNote += ' 목표 취침 ' + fmtHour(bedHour) + ' 기준으로 남은 시간이 ' + fmtDur(curfewMin) +
                   '이라, 가용 시간(' + fmtDur(requestedMin) + ') 대신 이쪽에 맞춰 잘랐습니다.';
    }

    return {
      pomodoro: pom,
      pomodoroReason: pomodoroReason(overall, input.fatigue, pom, input.fixedPomodoro),
      scaleNote: scaleNote,
      curfew: curfewMin === null ? null : {
        bedHour: bedHour,
        minutesLeft: curfewMin,
        passed: curfewMin < 0,
        bedtimeNow: bedtimeNow,
        cut: curfewCut,
        windDownMin: WIND_DOWN_MIN
      },
      requestedMin: Math.round(rawMin),
      plannedStudyMin: studyMin,
      plannedBreakMin: breakMin,
      totalBlocks: active.reduce(function (a, s) { return a + s.blocks; }, 0),
      subjects: active,
      dropped: dropped,
      timeline: timeline,
      endHour: endHour,
      rest: restGuide(analysis),
      headline: headline
    };
  }

  function pomodoroReason(overall, fatigue, pom, fixed) {
    var base;
    if (fixed) {
      base = '집중 ' + pom.focus + '분 / 휴식 ' + pom.short + '분 고정으로 설정해 두어 컨디션과 상관없이 이 길이로 계획했습니다.';
      if (overall < 50) base += ' 다만 오늘은 자기보고 입력 기반 준비도가 낮은 편이라, 힘들면 과목마다 시간을 줄여도 됩니다.';
      return base;
    }
    if (overall >= 85) base = '자기보고 입력 기반 준비도가 높은 구간이라 ' + pom.focus + '분 블록을 제안합니다.';
    else if (overall >= 74) base = '자기보고 입력 기반 준비도가 높은 편이라 ' + pom.focus + '분 블록을 제안합니다.';
    else if (overall >= 62) base = '자기보고 입력 기반 준비도가 보통 이상이라 ' + pom.focus + '분 블록을 제안합니다.';
    else if (overall >= 50) base = '자기보고 입력 기반 준비도가 보통이라 ' + pom.focus + '분 블록을 제안합니다.';
    else if (overall >= 38) base = '자기보고 입력 기반 준비도가 보통 이하라 짧은 ' + pom.focus + '분 블록을 제안합니다.';
    else base = '자기보고 입력 기반 준비도가 낮은 편이라 ' + pom.focus + '분 최소 블록만 제안합니다.';

    if (fatigue >= 7) base += ' 피로도가 ' + fatigue + '/10으로 높아 휴식을 ' + pom.short + '분으로 늘렸습니다.';
    return base;
  }

  global.BrainPlanner = {
    plan: plan, TYPES: TYPES, METHODS: METHODS, fitAt: fitAt,
    curfewMinutes: curfewMinutes, normalizedBedHour: normalizedBedHour
  };

})(window);
