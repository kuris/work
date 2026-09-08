/**
 * 직장인 업무도구 (work.chatgpts.kr) - 공통 유틸리티 스크립트
 */

(function () {
  'use strict';

  // 1. 패밀리 드롭다운 토글
  document.addEventListener('DOMContentLoaded', function () {
    var familyBtn = document.getElementById('family-btn');
    var familyDropdown = document.getElementById('family-dropdown');

    if (familyBtn && familyDropdown) {
      familyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        familyDropdown.classList.toggle('show');
      });

      document.addEventListener('click', function (e) {
        if (!familyDropdown.contains(e.target) && e.target !== familyBtn) {
          familyDropdown.classList.remove('show');
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          familyDropdown.classList.remove('show');
        }
      });
    }

    // 2. 현재 활성화된 메뉴 칩 자동 active 처리 (URL 매칭)
    var currentPath = location.pathname.split('/').pop() || 'index.html';
    var chips = document.querySelectorAll('.nav-chip');
    chips.forEach(function (chip) {
      var href = chip.getAttribute('href') || '';
      var chipFile = href.split('/').pop();
      if (chipFile === currentPath || (currentPath === '' && chipFile === 'index.html')) {
        chip.classList.add('active');
      }
    });
  });

  // 3. 전역 유틸리티 함수
  window.WorkUtils = {
    // 천단위 콤마 포맷
    formatNumber: function (val) {
      if (val === null || val === undefined || isNaN(val)) return '0';
      return Math.round(val).toLocaleString('ko-KR');
    },

    // 콤마 제거 및 정수 파싱
    parseNumber: function (str) {
      if (typeof str === 'number') return str;
      var clean = String(str || '').replace(/[^0-9.-]/g, '');
      var num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    },

    // 숫자를 만원/억원 단위 한글로 읽기
    formatKoreanCurrency: function (amount) {
      if (!amount || isNaN(amount)) return '0원';
      amount = Math.round(amount);
      if (amount < 10000) return amount.toLocaleString() + '원';
      
      var eok = Math.floor(amount / 100000000);
      var man = Math.floor((amount % 100000000) / 10000);
      var res = [];
      if (eok > 0) res.push(eok.toLocaleString() + '억');
      if (man > 0) res.push(man.toLocaleString() + '만');
      return res.join(' ') + '원';
    }
  };
})();
