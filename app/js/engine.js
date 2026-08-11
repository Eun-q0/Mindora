/* =========================================================================
 * engine.js — 학습 준비도 참고값 산출 엔진
 *
 * 설계 원칙
 *  1) 결정론적 규칙 기반: 같은 입력 → 항상 같은 결과 (재현 가능)
 *  2) 완전 분해 가능: 최종 점수 = 기준점(50) + Σ(요인별 기여) → × 생체리듬 보정
 *     따라서 "왜 이 점수인가"를 숫자로 정확히 되짚을 수 있다.
 *  3) 능력마다 가중치와 일주기(circadian) 곡선이 다르다.
 *     같은 컨디션이라도 계산 능력과 창의력의 최적 시간대는 다르다.
 *
 * 보정(calibration) 규칙
 *   모든 요인은 0~1로 정규화되며 **0.5 = 중립**(가점도 감점도 아님)이다.
 *   따라서 각 곡선의 0.5 지점은 "그 지표의 무난한 수준"에 맞춰야 한다.
 *   예: 수면은 6.4시간 부근이 0.5 — 그보다 적으면 실제로 감점이 찍힌다.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- utils */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 구간 선형보간. pts = [[x,y], ...] (x 오름차순) */
  function pw(x, pts) {
    if (!isFinite(x)) x = 0;
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      var x0 = pts[i - 1][0], y0 = pts[i - 1][1];
      var x1 = pts[i][0], y1 = pts[i][1];
      if (x <= x1) {
        var span = (x1 - x0) || 1;
        return y0 + (y1 - y0) * ((x - x0) / span);
      }
    }
    return pts[pts.length - 1][1];
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* -------------------------------------------------------------- 요인 정의
   * 각 요인은 사용자의 자기보고 입력을 0~1 사이의 상대적 적합도로 변환한다.
   * 0.5 = 중립. 0.5보다 높으면 가점, 낮으면 감점으로 해석된다.
   */

  var FACTORS = {

    sleepDuration: {
      label: '수면 시간',
      icon: '🛏️',
      display: function (i) { return round1(i.sleep.hours) + '시간'; },
      value: function (i) {
        // 0.5(중립) ≈ 6.4시간. 권장 7~9시간에서 1.0에 도달한다.
        return pw(i.sleep.hours, [
          [0, 0.02], [3, 0.08], [4, 0.15], [5, 0.26], [5.5, 0.33], [6, 0.42],
          [6.5, 0.54], [7, 0.72], [7.5, 0.88], [8, 0.97], [8.5, 1.00],
          [9, 0.94], [10, 0.78], [11, 0.66], [14, 0.52]
        ]);
      },
      note: function (i) {
        var h = i.sleep.hours;
        if (h < 4) return '입력한 수면 시간이 매우 짧습니다. 오늘은 짧고 쉬운 과제부터 시작하고 휴식을 충분히 두세요.';
        if (h < 6) return '입력한 수면 시간이 권장 범위보다 짧습니다. 긴 집중 블록보다 복습처럼 부담이 낮은 과제를 먼저 권합니다.';
        if (h < 7) return '입력한 수면 시간이 약간 짧습니다. 피로 체감을 확인하며 집중 블록을 짧게 조정해 보세요.';
        if (h <= 9) return '입력한 수면 시간이 일반적인 권장 범위에 있습니다. 다른 자기보고 입력과 함께 계획에 참고합니다.';
        if (h <= 10) return '평소보다 긴 수면이에요. 나쁘진 않지만 완전한 각성까지 시간이 걸릴 수 있습니다.';
        return '과다 수면은 오히려 수면 관성(무기력)을 부릅니다. 가벼운 활동으로 각성을 올려주세요.';
      }
    },

    sleepQuality: {
      label: '수면의 질',
      icon: '🌙',
      display: function (i) { return i.sleep.quality + ' / 5'; },
      value: function (i) { return (i.sleep.quality - 1) / 4; },
      note: function (i) {
        var q = i.sleep.quality;
        if (q <= 1) return '거의 못 잔 것과 비슷한 수면의 질입니다. 깊은 수면(서파수면) 구간이 부족했을 가능성이 큽니다.';
        if (q === 2) return '자주 깨거나 얕게 잔 수면이에요. 시간은 채웠어도 회복은 덜 된 상태입니다.';
        if (q === 3) return '보통 수준의 수면의 질입니다. 큰 문제도, 큰 도움도 되지 않는 구간이에요.';
        if (q === 4) return '깊게 잘 잔 편이에요. 기억 공고화와 정서 조절에 유리합니다.';
        return '매우 좋은 수면의 질입니다. 창의적 연결과 장기 기억 형성에 유리할 수 있는 조건이에요.';
      }
    },

    sleepRegularity: {
      label: '수면 규칙성',
      icon: '⏰',
      display: function (i) { return i.sleep.regularity + ' / 5'; },
      value: function (i) { return (i.sleep.regularity - 1) / 4; },
      note: function (i) {
        var r = i.sleep.regularity;
        if (r <= 2) return '취침·기상 시각이 들쭉날쭉하다고 입력했습니다. 오늘 피로 체감을 살피고 가능한 범위에서 일정한 수면 시각을 시도해 보세요.';
        if (r === 3) return '수면 리듬이 보통입니다. 주말·평일 편차를 1시간 이내로 줄이면 체감이 큽니다.';
        return '규칙적인 수면 리듬이에요. 생체시계가 안정되어 시간대별 컨디션 예측이 잘 맞습니다.';
      }
    },

    /* 스트레스는 능력에 따라 정반대로 작용하므로 두 갈래로 나눈다. */
    stressCalm: {
      label: '스트레스 (부담)',
      icon: '😖',
      display: function (i) { return i.stress + ' / 10'; },
      value: function (i) { return clamp(1 - i.stress / 10, 0, 1); },
      note: function (i) {
        var s = i.stress;
        if (s >= 8) return '매우 높은 스트레스입니다. 기억 형성과 유연한 사고에 불리할 수 있어요.';
        if (s >= 6) return '스트레스가 높은 편이에요. 암기와 창의적 사고에 특히 불리합니다.';
        if (s >= 4) return '중간 정도의 스트레스입니다. 심각하진 않지만 여유로운 사고에는 약간 부담이 돼요.';
        if (s >= 2) return '스트레스가 낮은 편이에요. 새로운 연결을 만드는 사고에 유리합니다.';
        return '스트레스가 거의 없습니다. 정서적 여유가 창의적·언어적 사고를 뒷받침해요.';
      }
    },

    stressArousal: {
      label: '스트레스 (각성)',
      icon: '⚡',
      display: function (i) { return i.stress + ' / 10'; },
      value: function (i) {
        // 여키스-도슨 법칙: 적당한 각성(3~4)이 집중·수행에 최적
        return pw(i.stress, [
          [0, 0.70], [1, 0.82], [2, 0.92], [3, 0.99], [3.5, 1.00], [4, 0.99],
          [5, 0.90], [6, 0.74], [7, 0.58], [8, 0.40], [9, 0.24], [10, 0.12]
        ]);
      },
      note: function (i) {
        var s = i.stress;
        if (s >= 8) return '스트레스 체감이 높은 편입니다. 오늘은 한 번에 처리할 양을 줄이고 짧은 과제부터 시작하세요.';
        if (s >= 6) return '각성이 최적 구간을 넘었어요. 압박감이 실수와 되읽기를 늘립니다.';
        if (s >= 2 && s <= 5) return '이 모델이 적정 긴장으로 보는 구간이에요. 적당한 긴장은 집중에 도움이 될 수 있습니다.';
        return '각성이 낮아 늘어지기 쉬운 상태예요. 마감 타이머나 목표 설정으로 긴장을 살짝 올리면 좋습니다.';
      }
    },

    fatigue: {
      label: '피로도',
      icon: '🔋',
      display: function (i) { return i.fatigue + ' / 10'; },
      value: function (i) {
        // 0.5(중립) ≈ 5.4 / 10
        return pw(i.fatigue, [
          [0, 1.00], [1, 0.95], [2, 0.89], [3, 0.80], [4, 0.68], [5, 0.55],
          [6, 0.43], [7, 0.31], [8, 0.20], [9, 0.11], [10, 0.04]
        ]);
      },
      note: function (i) {
        var f = i.fatigue;
        if (f >= 8) return '탈진에 가까운 피로입니다. 이 상태의 학습은 입력은 되지만 저장이 거의 되지 않아요.';
        if (f >= 6) return '피로 체감이 높은 편입니다. 긴 집중 블록보다 짧게 끊었을 때 실제로 더 편한지 확인해 보세요.';
        if (f >= 4) return '중간 정도의 피로예요. 표준 길이의 집중 블록은 소화할 수 있습니다.';
        if (f >= 2) return '피로가 낮은 편입니다. 긴 딥워크 블록을 감당할 수 있어요.';
        return '피로가 거의 없습니다. 오늘 가장 어려운 과제를 배치하기 좋은 조건이에요.';
      }
    },

    nutrition: {
      label: '식사 / 혈당',
      icon: '🍚',
      display: function (i) {
        var m = [];
        if (i.meals.breakfast) m.push('아침');
        if (i.meals.lunch) m.push('점심');
        if (i.meals.dinner) m.push('저녁');
        var eaten = m.length ? m.join('·') + ' 섭취' : '결식';
        return eaten + ' · 마지막 식사 ' + round1(i.hoursSinceMeal) + '시간 전';
      },
      value: function (i) {
        var h = i.hour, due = 0, ate = 0;
        if (h >= 8.5) { due += 0.40; if (i.meals.breakfast) ate += 0.40; }
        if (h >= 13.0) { due += 0.35; if (i.meals.lunch) ate += 0.35; }
        if (h >= 19.0) { due += 0.25; if (i.meals.dinner) ate += 0.25; }
        var mealScore = due > 0 ? ate / due : (i.meals.breakfast ? 1 : 0.72);
        var blood = pw(i.hoursSinceMeal, [
          [0, 0.86], [0.5, 0.94], [1, 1.00], [2, 1.00], [3, 0.96], [4, 0.87],
          [5, 0.75], [6, 0.62], [8, 0.44], [10, 0.32], [14, 0.20]
        ]);
        return clamp(0.58 * mealScore + 0.42 * blood, 0, 1);
      },
      note: function (i) {
        var skipped = [];
        var h = i.hour;
        if (h >= 8.5 && !i.meals.breakfast) skipped.push('아침');
        if (h >= 13.0 && !i.meals.lunch) skipped.push('점심');
        if (h >= 19.0 && !i.meals.dinner) skipped.push('저녁');
        var t = i.hoursSinceMeal;
        if (skipped.length >= 2) return skipped.join('·') + '을 걸렀습니다. 긴 공복은 일부 사람에게 집중과 작업기억에 불리할 수 있어요.';
        if (skipped.length === 1) return skipped[0] + ' 식사 기록이 없습니다. 배고픔이 느껴진다면 과제 전에 가벼운 간식과 물을 고려하세요.';
        if (t >= 6) return '마지막 식사 후 ' + round1(t) + '시간이 지났습니다. 배고픔이 느껴진다면 가벼운 간식과 물을 고려하세요.';
        if (t <= 0.5) return '식사 직후라 소화로 혈류가 몰리는 시간대예요. 20~30분 뒤가 집중에 더 유리합니다.';
        return '입력한 식사 간격은 무난한 편입니다. 실제 배고픔과 몸 상태를 함께 확인하세요.';
      }
    },

    hydration: {
      label: '수분 섭취',
      icon: '💧',
      display: function (i) { return i.water + '컵 (약 ' + (i.water * 0.25).toFixed(1) + 'L)'; },
      value: function (i) {
        // 0.5(중립) ≈ 3.4컵. 권장 6~8컵에서 1.0.
        return pw(i.water, [
          [0, 0.18], [1, 0.26], [2, 0.36], [3, 0.46], [4, 0.58], [5, 0.70],
          [6, 0.82], [7, 0.92], [8, 1.00], [10, 1.00], [12, 0.92], [14, 0.86]
        ]);
      },
      note: function (i) {
        var w = i.water;
        if (w <= 2) return '탈수에 가깝습니다. 체수분 2% 손실만으로도 주의력과 단기 기억이 눈에 띄게 떨어져요.';
        if (w <= 4) return '수분이 다소 부족합니다. 휴식마다 물 한 컵을 채우는 것만으로 체감이 달라져요.';
        if (w <= 9) return '입력한 수분 섭취량은 무난한 편입니다. 목마름과 몸 상태를 함께 확인하세요.';
        return '수분은 충분합니다. 다만 화장실 때문에 집중이 끊기지 않도록 블록 사이에 맞춰 마시세요.';
      }
    },

    caffeineAlert: {
      label: '카페인 (각성 효과)',
      icon: '☕',
      display: function (i) { return i.caffeine + '잔'; },
      value: function (i) {
        // 0잔 = 중립(0.5). 1~2잔이 최적, 4잔부터 각성 이득이 사라진다.
        return pw(i.caffeine, [
          [0, 0.50], [1, 0.82], [2, 0.96], [2.5, 1.00], [3, 0.86],
          [4, 0.62], [5, 0.42], [6, 0.30], [8, 0.18]
        ]);
      },
      note: function (i) {
        var c = i.caffeine;
        if (c === 0) return '카페인 없음. 각성을 끌어올릴 여지가 남아 있어요 (오후 3시 이전 1잔 권장).';
        if (c <= 2) return '카페인이 각성에 가장 잘 작용하는 구간입니다. 아데노신 차단 효과가 최적이에요.';
        if (c === 3) return '카페인 섭취가 평소보다 많다면 추가 섭취를 피하고 잠들기 불편하지 않은지 기록해 보세요.';
        return '카페인 과다입니다. 손떨림·불안이 작업기억을 오히려 갉아먹고, 오늘 밤 수면까지 망가뜨립니다.';
      }
    },

    caffeineCalm: {
      label: '카페인 (심리 안정)',
      icon: '☕',
      display: function (i) { return i.caffeine + '잔'; },
      value: function (i) {
        // 창의력은 과각성에 취약하다 — 고용량 카페인은 확산적 사고를 좁힌다.
        // 0.5(중립) ≈ 3잔.
        return pw(i.caffeine, [
          [0, 0.72], [1, 0.78], [2, 0.66], [3, 0.50], [4, 0.34], [5, 0.22], [8, 0.08]
        ]);
      },
      note: function (i) {
        var c = i.caffeine;
        if (c >= 4) return '카페인 과다는 주의를 좁힙니다. 집중엔 몰라도 창의적 연결에는 확실히 불리해요.';
        if (c >= 3) return '카페인이 다소 많습니다. 확산적 사고가 필요한 작업은 잠시 뒤로 미루세요.';
        if (c <= 1) return '카페인이 적어 사고가 넓게 퍼질 수 있는 상태입니다. 창의적 과제에 유리해요.';
        return '카페인이 적당합니다. 창의적 사고를 크게 방해하지 않는 수준이에요.';
      }
    },

    exercise: {
      label: '운동',
      icon: '🏃',
      display: function (i) { return i.exercise + '분'; },
      value: function (i) {
        return pw(i.exercise, [
          [0, 0.48], [10, 0.66], [20, 0.84], [30, 0.94], [45, 1.00], [60, 1.00],
          [90, 0.92], [120, 0.80], [180, 0.60]
        ]);
      },
      note: function (i) {
        var e = i.exercise;
        if (e === 0) return '오늘 운동 기록이 없습니다. 10분 정도 빠르게 걸으면 각성을 높이고 다음 공부를 준비하는 데 도움이 될 수 있어요.';
        if (e < 20) return '가벼운 활동이 있었습니다. 무리가 없다면 평소 활동량을 조금씩 늘려 보세요.';
        if (e <= 60) return '적당한 유산소 운동을 한 날입니다. 기분 전환과 주의 전환에 도움이 될 수 있어요.';
        return '운동량이 많은 편이에요. 근피로가 집중을 방해할 수 있으니 회복 시간을 충분히 두세요.';
      }
    },

    mood: {
      label: '기분 / 정서',
      icon: '🙂',
      display: function (i) { return i.mood + ' / 5'; },
      value: function (i) { return 0.08 + 0.90 * ((i.mood - 1) / 4); }, // 0.5(중립) = 보통(3)
      note: function (i) {
        var m = i.mood;
        if (m <= 1) return '기분이 매우 가라앉아 있습니다. 이 상태에서는 새로운 시도보다 익숙한 반복 작업이 안전해요.';
        if (m === 2) return '기분이 저조합니다. 확산적 사고와 언어 표현이 특히 위축되는 구간이에요.';
        if (m === 3) return '기분이 보통입니다. 학습에 방해도, 도움도 크지 않아요.';
        if (m === 4) return '긍정적인 정서 상태입니다. 사고의 폭이 넓어져 창의적 과제에 유리해요.';
        return '매우 좋은 정서 상태입니다. 긍정 정서는 주의의 범위를 넓혀 새로운 연결을 잘 만들어냅니다.';
      }
    }
  };

  /* --------------------------------------------------------- 일주기 곡선 */

  var CIRC = {
    focus: [[0, 0.34], [3, 0.24], [5, 0.32], [6, 0.44], [7, 0.58], [8, 0.74], [9, 0.90],
            [10, 1.00], [11, 0.99], [12, 0.90], [13, 0.76], [14, 0.68], [15, 0.75],
            [16, 0.86], [17, 0.91], [18, 0.88], [19, 0.84], [20, 0.79], [21, 0.71],
            [22, 0.60], [23, 0.46], [24, 0.34]],

    memory: [[0, 0.36], [3, 0.26], [5, 0.34], [6, 0.48], [7, 0.66], [8, 0.84], [9, 0.97],
             [10, 1.00], [11, 0.96], [12, 0.86], [13, 0.74], [14, 0.70], [15, 0.76],
             [16, 0.84], [17, 0.86], [18, 0.84], [19, 0.83], [20, 0.86], [21, 0.89],
             [22, 0.78], [23, 0.58], [24, 0.36]],

    computation: [[0, 0.30], [3, 0.20], [5, 0.28], [6, 0.40], [7, 0.56], [8, 0.76], [9, 0.92],
                  [10, 1.00], [11, 1.00], [12, 0.88], [13, 0.70], [14, 0.62], [15, 0.72],
                  [16, 0.84], [17, 0.88], [18, 0.84], [19, 0.78], [20, 0.72], [21, 0.62],
                  [22, 0.50], [23, 0.40], [24, 0.30]],

    // 창의력은 "덜 각성된" 시간대에 오히려 높다 (Wieth & Zacks, 2011)
    creativity: [[0, 0.78], [1, 0.72], [3, 0.62], [5, 0.66], [7, 0.76], [8, 0.80], [9, 0.82],
                 [10, 0.82], [11, 0.84], [12, 0.88], [13, 0.92], [14, 0.97], [15, 0.94],
                 [16, 0.88], [17, 0.86], [18, 0.90], [19, 0.94], [20, 0.97], [21, 1.00],
                 [22, 0.98], [23, 0.90], [24, 0.78]],

    language: [[0, 0.38], [3, 0.28], [5, 0.36], [6, 0.50], [7, 0.64], [8, 0.78], [9, 0.90],
               [10, 0.97], [11, 1.00], [12, 0.90], [13, 0.78], [14, 0.74], [15, 0.82],
               [16, 0.92], [17, 0.96], [18, 0.93], [19, 0.90], [20, 0.85], [21, 0.76],
               [22, 0.64], [23, 0.50], [24, 0.38]]
  };

  var CIRC_FLOOR = 0.75; // 생체리듬 보정은 최대 25%까지만 최종 점수를 흔든다

  function circMultiplier(capId, hour) {
    return CIRC_FLOOR + (1 - CIRC_FLOOR) * pw(hour, CIRC[capId]);
  }

  /* ---------------------------------------------------------- 능력 정의 */

  var CAPACITIES = [
    {
      id: 'focus',
      label: '집중 과제 적합도',
      short: '집중 과제',
      icon: '🎯',
      color: '#7c5cff',
      desc: '오늘 한 과제를 이어가기 상대적으로 수월할지 추정한 참고값입니다.',
      kidsDesc: '오늘 한 가지 공부를 이어가기 얼마나 수월할지 보여 주는 참고값이에요.',
      weights: {
        sleepDuration: 0.24, fatigue: 0.22, stressArousal: 0.13, sleepQuality: 0.12,
        nutrition: 0.09, caffeineAlert: 0.09, hydration: 0.05, mood: 0.04, sleepRegularity: 0.02
      }
    },
    {
      id: 'memory',
      label: '기억 과제 적합도',
      short: '기억 과제',
      icon: '🧠',
      color: '#4f8ef7',
      desc: '오늘 암기·인출 과제를 하기 상대적으로 수월할지 추정한 참고값입니다.',
      kidsDesc: '오늘 외우기와 복습이 얼마나 수월할지 보여 주는 참고값이에요.',
      weights: {
        sleepDuration: 0.28, sleepQuality: 0.19, stressCalm: 0.14, fatigue: 0.11,
        exercise: 0.09, nutrition: 0.07, sleepRegularity: 0.06, hydration: 0.03, mood: 0.03
      }
    },
    {
      id: 'computation',
      label: '계산 과제 적합도',
      short: '계산 과제',
      icon: '🔢',
      color: '#8a6fd8',
      desc: '오늘 여러 단계의 계산 과제를 하기 상대적으로 수월할지 추정한 참고값입니다.',
      kidsDesc: '오늘 계산 문제를 풀기 얼마나 수월할지 보여 주는 참고값이에요.',
      weights: {
        fatigue: 0.23, sleepDuration: 0.21, stressArousal: 0.14, nutrition: 0.13,
        caffeineAlert: 0.10, sleepQuality: 0.09, hydration: 0.05, mood: 0.05
      }
    },
    {
      id: 'creativity',
      label: '창의 과제 적합도',
      short: '창의 과제',
      icon: '💡',
      color: '#b566d9',
      desc: '오늘 서술·기획 과제를 하기 상대적으로 수월할지 추정한 참고값입니다.',
      kidsDesc: '오늘 생각을 펼쳐 쓰는 공부가 얼마나 수월할지 보여 주는 참고값이에요.',
      weights: {
        mood: 0.23, stressCalm: 0.21, sleepQuality: 0.16, sleepDuration: 0.11,
        exercise: 0.09, caffeineCalm: 0.08, fatigue: 0.06, nutrition: 0.04, hydration: 0.02
      }
    },
    {
      id: 'language',
      label: '독해 과제 적합도',
      short: '독해 과제',
      icon: '📖',
      color: '#6f7fc4',
      desc: '오늘 긴 글을 읽고 정리하기 상대적으로 수월할지 추정한 참고값입니다.',
      kidsDesc: '오늘 긴 글을 읽고 정리하기 얼마나 수월할지 보여 주는 참고값이에요.',
      weights: {
        sleepDuration: 0.19, fatigue: 0.19, sleepQuality: 0.13, stressCalm: 0.12,
        mood: 0.12, nutrition: 0.10, hydration: 0.06, caffeineAlert: 0.05, sleepRegularity: 0.04
      }
    }
  ];

  var OVERALL_WEIGHTS = {
    focus: 0.26, memory: 0.24, computation: 0.18, language: 0.18, creativity: 0.14
  };

  var STATES = [
    { min: 85, label: '높음', tone: 'excellent', line: '자기보고 입력 기준으로 긴 집중 블록을 시도해 볼 수 있는 상태입니다.' },
    { min: 74, label: '높음', tone: 'good', line: '자기보고 입력 기준으로 평소보다 긴 블록을 시도해 볼 수 있습니다.' },
    { min: 62, label: '보통 이상', tone: 'fair', line: '오늘 입력값은 표준 루틴을 시작하기 무난한 범위입니다.' },
    { min: 50, label: '보통', tone: 'fair', line: '오늘은 블록을 조금 짧게 잡고 체감을 확인하세요.' },
    { min: 38, label: '보통 이하', tone: 'low', line: '오늘은 새 진도보다 익숙한 복습부터 시작하는 편을 권합니다.' },
    { min: 0, label: '낮음', tone: 'critical', line: '오늘은 짧은 최소 목표만 시도하고 회복을 우선해 보세요.' }
  ];

  function stateOf(score) {
    for (var i = 0; i < STATES.length; i++) if (score >= STATES[i].min) return STATES[i];
    return STATES[STATES.length - 1];
  }

  /* ------------------------------------------------------------- 경고 생성 */

  function buildAlerts(i) {
    var out = [];
    if (i.sleep.hours < 5) out.push({ level: 'bad', text: '수면 ' + round1(i.sleep.hours) + '시간 — 오늘 학습 총량보다 회복이 우선입니다.' });
    else if (i.sleep.hours < 6.5) out.push({ level: 'warn', text: '입력한 수면 시간이 짧습니다 — 후반 블록은 실제 피로 체감을 보며 줄이세요.' });

    if (i.stress >= 8) out.push({ level: 'bad', text: '스트레스 체감 ' + i.stress + '/10 — 새 과제보다 익숙한 복습을 짧게 시작해 보세요.' });
    if (i.fatigue >= 8) out.push({ level: 'bad', text: '피로 체감 ' + i.fatigue + '/10 — 집중 시간을 줄이고 충분히 쉬어도 괜찮습니다.' });

    var h = i.hour, skipped = [];
    if (h >= 8.5 && !i.meals.breakfast) skipped.push('아침');
    if (h >= 13 && !i.meals.lunch) skipped.push('점심');
    if (h >= 19 && !i.meals.dinner) skipped.push('저녁');
    if (skipped.length) out.push({ level: skipped.length >= 2 ? 'bad' : 'warn', text: skipped.join('·') + ' 식사 기록 없음 — 배고픔이 느껴지면 부담이 적은 간식과 물을 고려하세요.' });

    if (i.hoursSinceMeal >= 6) out.push({ level: 'warn', text: '마지막 식사 후 ' + round1(i.hoursSinceMeal) + '시간 — 첫 휴식 때 간단히라도 먹으세요.' });
    if (i.caffeine >= 4) out.push({ level: 'warn', text: '카페인 ' + i.caffeine + '잔 — 오늘은 추가 섭취를 피하고 잠드는 데 불편함이 없는지 기록해 보세요.' });
    if (i.water <= 2) out.push({ level: 'warn', text: '수분 ' + i.water + '컵 — 목마름이나 두통이 있다면 물을 조금씩 보충하세요.' });
    if (i.mood <= 2) out.push({ level: 'warn', text: '기분 체감이 낮은 편입니다 — 새 개념보다 익숙한 복습을 짧게 시작해 보세요.' });

    var urgent = (i.subjects || []).filter(function (s) {
      return s.daysLeft !== null && s.daysLeft >= 0 && s.daysLeft <= 2;
    });
    if (urgent.length) {
      out.push({
        level: 'bad',
        text: urgent.map(function (s) { return s.name + ' D-' + s.daysLeft; }).join(', ') + ' — 시험이 코앞입니다. 새 범위보다 인출 연습에 집중하세요.'
      });
    }
    if (i.hour >= 22) out.push({ level: 'warn', text: '늦은 시각 학습 — 잠들기 불편하다면 종료 후 화면 밝기와 자극을 줄여 보세요.' });
    return out;
  }

  /* ------------------------------------------------------------- 메인 분석 */

  function analyze(input) {
    // 1) 요인 값 계산
    var factors = {};
    Object.keys(FACTORS).forEach(function (key) {
      var def = FACTORS[key];
      var v = clamp(def.value(input), 0, 1);
      factors[key] = {
        id: key,
        label: def.label,
        icon: def.icon,
        value: v,
        display: def.display(input),
        note: def.note(input, v)
      };
    });

    // 2) 능력별 점수 + 완전 분해된 기여도
    var capacities = CAPACITIES.map(function (def) {
      var contribs = [];
      var base = 50;

      Object.keys(def.weights).forEach(function (fid) {
        var w = def.weights[fid];
        var f = factors[fid];
        var c = 100 * w * (f.value - 0.5); // 중립(0.5) 대비 기여 점수
        base += c;
        contribs.push({
          id: fid, label: f.label, icon: f.icon, display: f.display,
          note: f.note, weight: w, value: f.value, points: c
        });
      });

      contribs.sort(function (a, b) { return Math.abs(b.points) - Math.abs(a.points); });

      var mult = circMultiplier(def.id, input.hour);
      var raw = base * mult;
      var score = clamp(raw, 1, 100);

      return {
        id: def.id, label: def.label, short: def.short, icon: def.icon,
        color: def.color, desc: def.desc, kidsDesc: def.kidsDesc,
        score: Math.round(score),
        exact: score,
        baseScore: base,              // 생체리듬 보정 전 소계
        circMult: mult,
        circPoints: raw - base,       // 시간대가 준 가감점
        clamped: Math.abs(raw - score) > 0.5,
        contribs: contribs,
        level: score >= 72 ? 'high' : (score >= 55 ? 'mid' : 'low')
      };
    });

    var byId = {};
    capacities.forEach(function (c) { byId[c.id] = c; });

    // 3) 종합 뇌 컨디션
    var overall = 0;
    Object.keys(OVERALL_WEIGHTS).forEach(function (id) {
      overall += OVERALL_WEIGHTS[id] * byId[id].exact;
    });
    overall = clamp(overall, 1, 100);

    var sorted = capacities.slice().sort(function (a, b) { return b.exact - a.exact; });

    /* 5개 능력은 수면·피로라는 같은 뿌리에서 나오기 때문에 절대 점수는 서로
     * 강하게 붙어 움직인다(실측 평균 상관 0.85). 그래서 "오늘 뭐가 강한가" 는
     * 절대값이 아니라 오늘 평균 대비 편차로 봐야 의미가 있다. */
    var mean = capacities.reduce(function (s, c) { return s + c.exact; }, 0) / capacities.length;
    capacities.forEach(function (c) { c.rel = c.exact - mean; });
    var spread = sorted[0].exact - sorted[sorted.length - 1].exact;

    return {
      input: input,
      factors: factors,
      capacities: capacities,
      byId: byId,
      overall: Math.round(overall),
      overallExact: overall,
      state: stateOf(overall),
      top: sorted[0],
      bottom: sorted[sorted.length - 1],
      ranked: sorted,
      capMean: mean,
      capSpread: spread,
      // 편차가 이 정도는 돼야 "오늘은 A가 낫다" 고 말할 근거가 생긴다
      capMeaningful: spread >= 8,
      alerts: buildAlerts(input),
      circMultAt: circMultiplier
    };
  }

  /* 모델을 손댈 때 조용히 깨질 수 있는 불변식을 검사한다.
   * 콘솔에서 BrainEngine.selfTest() 로 확인. */
  function selfTest() {
    var issues = [];

    CAPACITIES.forEach(function (def) {
      var sum = 0;
      Object.keys(def.weights).forEach(function (fid) {
        sum += def.weights[fid];
        if (!FACTORS[fid]) issues.push(def.id + ': 존재하지 않는 요인 ' + fid);
      });
      if (Math.abs(sum - 1) > 1e-9) issues.push(def.id + ': 가중치 합이 ' + sum.toFixed(6));
      if (!CIRC[def.id]) issues.push(def.id + ': 일주기 곡선 없음');
    });

    var ow = 0;
    Object.keys(OVERALL_WEIGHTS).forEach(function (id) {
      ow += OVERALL_WEIGHTS[id];
      if (!CAPACITIES.some(function (c) { return c.id === id; })) issues.push('종합 가중치에 알 수 없는 능력 ' + id);
    });
    if (Math.abs(ow - 1) > 1e-9) issues.push('종합 가중치 합이 ' + ow.toFixed(6));

    // 여러 시각·조건에서 점수 분해가 정확히 맞아떨어지는지
    [3, 9, 14, 22].forEach(function (h) {
      [[3, 1, 9, 9], [7.5, 4, 3, 2], [10, 5, 0, 0]].forEach(function (v) {
        var a = analyze({
          startHour: h, hour: h,
          sleep: { hours: v[0], quality: v[1], regularity: 3 },
          stress: v[2], fatigue: v[3], mood: 3,
          meals: { breakfast: true, lunch: true, dinner: false },
          hoursSinceMeal: 2, water: 5, caffeine: 1, exercise: 20,
          availableHours: 4, subjects: []
        });
        a.capacities.forEach(function (c) {
          var s = 50;
          c.contribs.forEach(function (x) { s += x.points; });
          if (Math.abs(s - c.baseScore) > 1e-9) issues.push(c.id + '@' + h + 'h: 기여 합계 불일치');
          if (!c.clamped && Math.abs(c.baseScore * c.circMult - c.exact) > 1e-9) {
            issues.push(c.id + '@' + h + 'h: 생체리듬 보정 불일치');
          }
          if (c.score < 1 || c.score > 100) issues.push(c.id + '@' + h + 'h: 점수 범위 이탈 ' + c.score);
        });
        if (a.overall < 1 || a.overall > 100) issues.push('종합 점수 범위 이탈 ' + a.overall);
      });
    });

    // 요인 곡선이 0~1 을 벗어나지 않는지
    Object.keys(FACTORS).forEach(function (fid) {
      for (var t = 0; t <= 24; t += 2) {
        var v = FACTORS[fid].value({
          hour: t, sleep: { hours: t / 2, quality: 3, regularity: 3 },
          stress: t % 11, fatigue: t % 11, mood: 3,
          meals: { breakfast: true, lunch: false, dinner: false },
          hoursSinceMeal: t / 2, water: t % 15, caffeine: t % 9, exercise: t * 7
        });
        if (!(v >= 0 && v <= 1)) { issues.push(fid + ': 0~1 범위를 벗어남 (' + v + ')'); break; }
      }
    });

    return { ok: issues.length === 0, checked: CAPACITIES.length, issues: issues };
  }

  global.BrainEngine = {
    analyze: analyze, selfTest: selfTest,
    CAPACITIES: CAPACITIES,
    FACTORS: FACTORS,
    OVERALL_WEIGHTS: OVERALL_WEIGHTS,
    circMultiplier: circMultiplier,
    _util: { clamp: clamp, pw: pw, round1: round1 }
  };

})(window);
