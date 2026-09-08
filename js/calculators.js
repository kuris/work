/**
 * 직장인 업무도구 (work.chatgpts.kr) - 5대 핵심 계산기 모듈
 */

(function () {
  'use strict';

  // ============================================================
  // 1. 계산기 기준 설정값 (세율 및 보험요율)
  // ============================================================
  var CALC_CONFIG = {
    // 2026년 최저시급 기준
    MIN_HOURLY_WAGE: 10030,
    
    // 4대 보험요율 (근로자 부담분)
    PENSION_RATE: 0.045,          // 국민연금 4.5%
    PENSION_MIN: 370000,          // 국민연금 기준소득월액 하한
    PENSION_MAX: 5900000,         // 국민연금 기준소득월액 상한
    
    HEALTH_RATE: 0.03545,         // 건강보험 3.545%
    CARE_RATE: 0.1295,            // 장기요양보험 (건강보험료의 12.95%)
    EMPLOYMENT_RATE: 0.009,       // 고용보험 0.9%
    
    DEFAULT_NON_TAXABLE: 200000,  // 식대 비과세 기본 20만원
    STANDARD_MONTHLY_HOURS: 209   // 주 40시간 근로 시 월 소정근로시간 (주휴 포함)
  };

  window.CALC_CONFIG = CALC_CONFIG;

  // ============================================================
  // 2. 연봉 / 월급 실수령액 계산
  // ============================================================
  function calculateSalary(grossAmount, isMonthly, dependents, children, nonTaxable) {
    grossAmount = Math.max(0, grossAmount || 0);
    dependents = Math.max(1, dependents || 1); // 본인 포함 최소 1명
    children = Math.max(0, children || 0);
    nonTaxable = Math.max(0, nonTaxable !== undefined ? nonTaxable : CALC_CONFIG.DEFAULT_NON_TAXABLE);

    var monthlyGross = isMonthly ? grossAmount : grossAmount / 12;
    var taxable = Math.max(0, monthlyGross - nonTaxable);

    // 1) 국민연금
    var pensionBase = Math.min(Math.max(taxable, CALC_CONFIG.PENSION_MIN), CALC_CONFIG.PENSION_MAX);
    var nationalPension = Math.round(pensionBase * CALC_CONFIG.PENSION_RATE);

    // 2) 건강보험 & 장기요양보험
    var healthInsurance = Math.round(taxable * CALC_CONFIG.HEALTH_RATE);
    var longTermCare = Math.round(healthInsurance * CALC_CONFIG.CARE_RATE);

    // 3) 고용보험
    var employmentInsurance = Math.round(taxable * CALC_CONFIG.EMPLOYMENT_RATE);

    // 4대보험 소계
    var insuranceTotal = nationalPension + healthInsurance + longTermCare + employmentInsurance;

    // 4) 근로소득세 (간이세액 근사 계산)
    // 연간 과세표준 추정 후 누진세율 적용
    var annualTaxable = taxable * 12;
    var annualTax = estimateIncomeTax(annualTaxable, dependents, children);
    var monthlyIncomeTax = Math.max(0, Math.round(annualTax / 12));
    var monthlyLocalTax = Math.round(monthlyIncomeTax * 0.1); // 지방소득세 10%

    var taxTotal = monthlyIncomeTax + monthlyLocalTax;
    var totalDeductions = insuranceTotal + taxTotal;
    var monthlyNet = Math.max(0, Math.round(monthlyGross - totalDeductions));
    var annualNet = monthlyNet * 12;

    return {
      monthlyGross: Math.round(monthlyGross),
      annualGross: Math.round(monthlyGross * 12),
      nonTaxable: nonTaxable,
      nationalPension: nationalPension,
      healthInsurance: healthInsurance,
      longTermCare: longTermCare,
      employmentInsurance: employmentInsurance,
      insuranceTotal: insuranceTotal,
      incomeTax: monthlyIncomeTax,
      localTax: monthlyLocalTax,
      taxTotal: taxTotal,
      totalDeductions: totalDeductions,
      monthlyNet: monthlyNet,
      annualNet: annualNet
    };
  }

  // 간이 소득세 근사 계산 헬퍼
  function estimateIncomeTax(annualTaxable, dependents, children) {
    if (annualTaxable <= 14000000) return 0;

    // 근로소득공제
    var earnedIncomeDeduction = 0;
    if (annualTaxable <= 5000000) earnedIncomeDeduction = annualTaxable * 0.7;
    else if (annualTaxable <= 15000000) earnedIncomeDeduction = 3500000 + (annualTaxable - 5000000) * 0.4;
    else if (annualTaxable <= 45000000) earnedIncomeDeduction = 7500000 + (annualTaxable - 15000000) * 0.15;
    else if (annualTaxable <= 100000000) earnedIncomeDeduction = 12000000 + (annualTaxable - 45000000) * 0.05;
    else earnedIncomeDeduction = 14750000 + (annualTaxable - 100000000) * 0.02;

    // 인적공제 (1인당 150만원 + 자녀 세액공제 고려)
    var personalDeduction = (dependents + children) * 1500000;
    var baseStandard = Math.max(0, annualTaxable - earnedIncomeDeduction - personalDeduction);

    // 누진세율
    var rawTax = 0;
    if (baseStandard <= 14000000) rawTax = baseStandard * 0.06;
    else if (baseStandard <= 50000000) rawTax = 840000 + (baseStandard - 14000000) * 0.15;
    else if (baseStandard <= 88000000) rawTax = 6240000 + (baseStandard - 50000000) * 0.24;
    else if (baseStandard <= 150000000) rawTax = 15360000 + (baseStandard - 88000000) * 0.35;
    else rawTax = 37060000 + (baseStandard - 150000000) * 0.38;

    // 근로소득세액공제
    var taxCredit = Math.min(740000, rawTax * 0.55);
    return Math.max(0, rawTax - taxCredit);
  }

  // ============================================================
  // 3. 퇴직금 계산기
  // ============================================================
  function calculateRetirementPay(startDateStr, endDateStr, threeMonthsWage, annualBonusAndEtc) {
    if (!startDateStr || !endDateStr) return null;

    var start = new Date(startDateStr);
    var end = new Date(endDateStr);
    var diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return { error: '퇴사일은 입사일 이후여야 합니다.' };

    var totalWorkDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    var isEligible = totalWorkDays >= 365;

    threeMonthsWage = Math.max(0, threeMonthsWage || 0);
    annualBonusAndEtc = Math.max(0, annualBonusAndEtc || 0);

    // 최근 3개월 평균 역일수: 약 91일
    var avgDays = 91;
    // 연간 상여금/연차수당 3/12 반영
    var totalBaseFor3Months = threeMonthsWage + (annualBonusAndEtc * (3 / 12));
    var dailyAverageWage = totalBaseFor3Months / avgDays;

    // 예상 퇴직금 = 1일 평균임금 × 30일 × (재직일수 / 365)
    var estimatedPay = Math.round(dailyAverageWage * 30 * (totalWorkDays / 365));

    return {
      totalWorkDays: totalWorkDays,
      isEligible: isEligible,
      dailyAverageWage: Math.round(dailyAverageWage),
      estimatedPay: estimatedPay
    };
  }

  // ============================================================
  // 4. 연차 계산기 (근로기준법 제60조 기준)
  // ============================================================
  function calculateAnnualLeave(joinDateStr, baseDateStr, usedLeave) {
    if (!joinDateStr) return null;

    var join = new Date(joinDateStr);
    var base = baseDateStr ? new Date(baseDateStr) : new Date();
    if (base < join) return { error: '기준일은 입사일 이후여야 합니다.' };

    usedLeave = Math.max(0, usedLeave || 0);

    // 근속 개월수 및 연수 계산
    var years = base.getFullYear() - join.getFullYear();
    var months = base.getMonth() - join.getMonth();
    var days = base.getDate() - join.getDate();

    if (days < 0) {
      months -= 1;
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }

    var totalMonths = (years * 12) + months;
    var totalDays = Math.floor((base - join) / (1000 * 60 * 60 * 24));

    var totalGrantedLeave = 0;
    var leaveTypeDesc = '';

    if (totalMonths < 12) {
      // 1년 미만: 1개월 개근 시 1일 (최대 11일)
      totalGrantedLeave = Math.min(11, totalMonths);
      leaveTypeDesc = '입사 1년 미만 (1개월 만근 시 1일 발생, 최대 11일)';
    } else {
      // 1년 이상: 기본 15일 + 만 3년 이상부터 2년마다 1일 가산 (최대 25일)
      var bonusYears = Math.max(0, Math.floor((years - 1) / 2));
      totalGrantedLeave = Math.min(25, 15 + bonusYears);
      leaveTypeDesc = '입사 1년 이상 정기 연차 (기본 15일 + 근속가산 연차)';
    }

    var remainingLeave = Math.max(0, totalGrantedLeave - usedLeave);

    return {
      serviceYears: years,
      serviceMonths: months,
      totalMonths: totalMonths,
      totalDays: totalDays,
      totalGrantedLeave: totalGrantedLeave,
      usedLeave: usedLeave,
      remainingLeave: remainingLeave,
      leaveTypeDesc: leaveTypeDesc
    };
  }

  // ============================================================
  // 5. 시급 / 월급 계산기 (주휴수당 포함)
  // ============================================================
  function calculateHourlyWage(hourlyWage, dailyHours, weeklyDays, includeHolidayPay) {
    hourlyWage = Math.max(0, hourlyWage || CALC_CONFIG.MIN_HOURLY_WAGE);
    dailyHours = Math.max(0, dailyHours || 8);
    weeklyDays = Math.max(0, weeklyDays || 5);

    var weeklyWorkHours = dailyHours * weeklyDays;
    // 주휴수당: 주 15시간 이상 근무 시 (주간 근로시간 / 40) * 8시간 유급 인정
    var holidayHours = (weeklyWorkHours >= 15 && includeHolidayPay) 
      ? Math.min(8, (weeklyWorkHours / 40) * 8) 
      : 0;

    var totalWeeklyPaidHours = weeklyWorkHours + holidayHours;
    var weeklyPay = Math.round(totalWeeklyPaidHours * hourlyWage);

    // 한 달 평균 주수: 4.345주 (365 / 7 / 12)
    var monthlyPaidHours = Math.round(totalWeeklyPaidHours * 4.345);
    var monthlyPay = Math.round(monthlyPaidHours * hourlyWage);

    return {
      hourlyWage: hourlyWage,
      weeklyWorkHours: weeklyWorkHours,
      holidayHours: Math.round(holidayHours * 10) / 10,
      totalWeeklyPaidHours: Math.round(totalWeeklyPaidHours * 10) / 10,
      weeklyPay: weeklyPay,
      monthlyPaidHours: monthlyPaidHours,
      monthlyPay: monthlyPay
    };
  }

  function calculateMonthlyToHourly(monthlyWage, weeklyHours) {
    monthlyWage = Math.max(0, monthlyWage || 0);
    weeklyHours = Math.max(1, weeklyHours || 40);

    var holidayHours = weeklyHours >= 15 ? (weeklyHours / 40) * 8 : 0;
    var weeklyPaid = weeklyHours + holidayHours;
    var monthlyHours = Math.round(weeklyPaid * 4.345);

    var hourlyEquivalent = monthlyHours > 0 ? Math.round(monthlyWage / monthlyHours) : 0;

    return {
      monthlyWage: monthlyWage,
      monthlyHours: monthlyHours,
      hourlyEquivalent: hourlyEquivalent
    };
  }

  // ============================================================
  // 6. 근무일수 계산기
  // ============================================================
  function calculateWorkdays(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return null;

    var start = new Date(startDateStr);
    var end = new Date(endDateStr);
    if (end < start) return { error: '종료일은 시작일 이후여야 합니다.' };

    var totalDays = 0;
    var weekdays = 0;
    var weekends = 0;

    var current = new Date(start);
    while (current <= end) {
      totalDays++;
      var dayOfWeek = current.getDay(); // 0: 일요일, 6: 토요일
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        weekends++;
      } else {
        weekdays++;
      }
      current.setDate(current.getDate() + 1);
    }

    return {
      totalDays: totalDays,
      weekdays: weekdays,
      weekends: weekends
    };
  }

  // 전역 노출
  window.WorkCalculators = {
    calculateSalary: calculateSalary,
    calculateRetirementPay: calculateRetirementPay,
    calculateAnnualLeave: calculateAnnualLeave,
    calculateHourlyWage: calculateHourlyWage,
    calculateMonthlyToHourly: calculateMonthlyToHourly,
    calculateWorkdays: calculateWorkdays
  };
})();
