/* ============================================================
   직장인 업무도구 - 계산 기록 남기기 (work-calc-log.js)

   [이 파일이 하는 일]
     로그인한 사용자가 계산기를 쓰면 "무엇을 얼마로 계산했는지" 를 기록해 두고,
     홈의 「최근 사용한 도구」에서 다시 꺼내 볼 수 있게 합니다.
     예) 연봉 실수령액 · 5,000만원 (부양 1명)

   [기존 코드를 건드리지 않는 이유]
     계산 호출부가 각 HTML 안에 인라인으로 흩어져 있습니다.
     그래서 페이지를 고치는 대신 window.WorkCalculators 의 함수를 감싸서
     계산이 끝난 직후에만 기록을 남깁니다. 계산 결과는 그대로 반환합니다.
     → 비로그인 사용자는 서버 호출이 일어나지 않고 동작도 완전히 같습니다.

   의존성: calculators.js, cg-auth.js, cg-tools-recent.js
   ============================================================ */

(function () {
  'use strict';

  function ready() {
    return !!(window.CGToolsRecent && window.CGAuth && window.CGAuth.isLoggedIn());
  }

  function won(n) {
    n = Number(n);
    if (!isFinite(n) || n === 0) return '';
    if (n >= 100000000) return (Math.round(n / 10000000) / 10) + '억원';
    if (n >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  // 계산기별로 "제목"과 "입력값" 을 만드는 방법
  var SPECS = {
    calculateSalary: {
      id: 'salary',
      title: function (a) {
        return '연봉 실수령액 · ' + won(a[0]) + (a[1] ? ' (월급 기준)' : '') +
               (a[2] > 1 ? ' · 부양 ' + a[2] + '명' : '');
      },
      input: function (a) {
        return { gross: a[0], isMonthly: !!a[1], dependents: a[2], children: a[3], nonTaxable: a[4] };
      }
    },
    calculateRetirementPay: {
      id: 'retirement',
      title: function (a) { return '퇴직금 · ' + (a[0] || '') + ' ~ ' + (a[1] || ''); },
      input: function (a) { return { start: a[0], end: a[1], threeMonthsWage: a[2], bonus: a[3] }; }
    },
    calculateAnnualLeave: {
      id: 'annual-leave',
      title: function (a) { return '연차 계산 · 입사 ' + (a[0] || ''); },
      input: function (a) { return { joinDate: a[0], baseDate: a[1], used: a[2] }; }
    },
    calculateHourlyWage: {
      id: 'hourly',
      title: function (a) {
        return '시급 계산 · ' + Number(a[0] || 0).toLocaleString('ko-KR') + '원 · 주 ' + (a[2] || 0) + '일';
      },
      input: function (a) { return { hourly: a[0], dailyHours: a[1], weeklyDays: a[2], holidayPay: !!a[3] }; }
    },
    calculateMonthlyToHourly: {
      id: 'hourly',
      title: function (a) { return '월급→시급 · ' + won(a[0]); },
      input: function (a) { return { monthly: a[0], weeklyHours: a[1] }; }
    },
    calculateWorkdays: {
      id: 'workdays',
      title: function (a) { return '근무일수 · ' + (a[0] || '') + ' ~ ' + (a[1] || ''); },
      input: function (a) { return { start: a[0], end: a[1] }; }
    }
  };

  function wrapAll() {
    var C = window.WorkCalculators;
    if (!C || C.__cgLogged) return;
    C.__cgLogged = true;

    Object.keys(SPECS).forEach(function (name) {
      var orig = C[name];
      if (typeof orig !== 'function') return;
      var spec = SPECS[name];

      C[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var out = orig.apply(this, args);          // 계산은 원래 함수가 그대로 합니다
        try {
          if (ready()) {
            window.CGToolsRecent.saveCalc({
              id: spec.id,
              title: spec.title(args),
              url: spec.id + '.html',
              meta: { input: spec.input(args), result: out }
            });
          }
        } catch (e) {
          try { console.warn('[계산 기록] 저장 실패', e && (e.message || e)); } catch (_) {}
        }
        return out;
      };
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapAll, { once: true });
  else wrapAll();
})();
