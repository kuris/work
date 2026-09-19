/* 이 파일은 _shared/cg-family.js 의 복사본입니다. 직접 수정하지 말고 _shared 에서 고친 뒤 sync.sh 를 실행하세요. */
/* ============================================================
   CGFamily - 14종 "다른 놀자 서비스" 공통 드롭박스
   ★ 원본: play_project/_shared/cg-family.js (복사본 직접 수정 금지)
   수정 후 _shared/sync.sh 실행해 전 서비스에 배포합니다.
   ※ cbt(전기기사 CBT)는 개인용이므로 메뉴에서 제외합니다.

   사용법 (정적 헤더형 - 3줄):
     <link rel="stylesheet" href="css/cg-family.css?v=...">   (</head> 직전)
     <div data-cg-family data-current="tools"></div>           (기존 family 자리)
     <script defer src="js/cg-family.js?v=..."></script>       (</body> 직전)

   JS-nav형 (gram/science/book/math/playhanja/voca):
     CGFamily.renderDrawer(el, { current:'gram' })  → 모바일 서랍용 평면 리스트
     window.CG_FAMILY (데이터 배열) 직접 사용 가능

   설계: vanilla, 빌드 없음. cg-auth와 동일한 복사-배포 메커니즘.
   ============================================================ */
(function (global) {
  'use strict';

  if (global.CGFamily && global.CGFamily.__loaded) return;

  var SERVICES = [
    // 학습 (7)
    { id: 'hanja', emoji: '📖', label: '한자야 놀자',    url: 'https://hanja.chatgpts.kr',    host: 'hanja.chatgpts.kr',    cat: 'study' },
    { id: 'voca',  emoji: '⚡', label: '단어야 놀자',    url: 'https://voca.chatgpts.kr',     host: 'voca.chatgpts.kr',     cat: 'study' },
    { id: 'history', emoji: '📜', label: '역사야 놀자',  url: 'https://history.chatgpts.kr',  host: 'history.chatgpts.kr',  cat: 'study' },
    { id: 'math',  emoji: '🔢', label: '수학아 놀자',    url: 'https://math.chatgpts.kr',     host: 'math.chatgpts.kr',     cat: 'study' },
    { id: 'gram',  emoji: '✏️', label: '문법아 놀자',    url: 'https://gram.chatgpts.kr',     host: 'gram.chatgpts.kr',     cat: 'study' },
    { id: 'science', emoji: '🔬', label: '과학아 놀자',  url: 'https://science.chatgpts.kr',  host: 'science.chatgpts.kr',  cat: 'study' },
    { id: 'book',  emoji: '📚', label: '독서야 놀자',    url: 'https://book.chatgpts.kr',     host: 'book.chatgpts.kr',     cat: 'study' },
    // 마음·재미 (4)
    { id: 'maum',  emoji: '🪷', label: '마음아 놀자',    url: 'https://maum.chatgpts.kr',     host: 'maum.chatgpts.kr',     cat: 'mind' },
    { id: 'bible', emoji: '✝️', label: '성경아 놀자',    url: 'https://bible.chatgpts.kr',    host: 'bible.chatgpts.kr',    cat: 'mind' },
    { id: 'fortune', emoji: '🔮', label: '운세야 놀자',  url: 'https://fortune.chatgpts.kr',  host: 'fortune.chatgpts.kr',  cat: 'mind' },
    { id: 'mind',  emoji: '🧠', label: '마인드테스트',   url: 'https://mind.chatgpts.kr',     host: 'mind.chatgpts.kr',     cat: 'mind' },
    // 생활도구 (3)
    { id: 'work',  emoji: '💼', label: '워크야 놀자',    url: 'https://work.chatgpts.kr',     host: 'work.chatgpts.kr',     cat: 'life' },
    { id: 'money', emoji: '💰', label: '머니야 놀자',    url: 'https://money.chatgpts.kr',    host: 'money.chatgpts.kr',    cat: 'life' },
    { id: 'tools', emoji: '🛠️', label: '문서야 놀자',    url: 'https://tools.chatgpts.kr',    host: 'tools.chatgpts.kr',    cat: 'life' }
  ];

  var PORTAL = { emoji: '🏠', label: 'chatgpts.kr 전체 포털', url: 'https://chatgpts.kr' };

  var GROUPS = [
    { id: 'study', title: '📚 학습' },
    { id: 'mind',  title: '💛 마음·재미' },
    { id: 'life',  title: '🛠️ 생활도구' }
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function detectCurrent() {
    try {
      var h = (location.hostname || '').toLowerCase();
      for (var i = 0; i < SERVICES.length; i++) {
        if (h === SERVICES[i].host || h.endsWith('.' + SERVICES[i].host)) return SERVICES[i].id;
      }
      // mindtest 폴더명은 mindtest지만 호스트는 mind.chatgpts.kr
      if (h.indexOf('mindtest') !== -1) return 'mind';
    } catch (e) {}
    return null;
  }

  function itemHtml(s, current) {
    if (s.id === current) {
      return '<span class="cg-fam-item cg-fam-current" aria-current="true"><span class="cg-fam-ic">' +
        esc(s.emoji) + '</span><span>' + esc(s.label) + '</span></span>';
    }
    return '<a class="cg-fam-item" href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
      '<span class="cg-fam-ic">' + esc(s.emoji) + '</span><span>' + esc(s.label) + '</span></a>';
  }

  function panelHtml(current, opts) {
    opts = opts || {};
    var html = '';
    for (var g = 0; g < GROUPS.length; g++) {
      var grp = GROUPS[g];
      var items = SERVICES.filter(function (s) { return s.cat === grp.id; });
      // 자기자신을 숨기지 않고 '현재' 표시로 남긴다 (tools 패턴 계승)
      html += '<div class="cg-fam-sec"><div class="cg-fam-sec-t">' + esc(grp.title) + '</div>' +
        '<div class="cg-fam-grid">' +
        items.map(function (s) { return itemHtml(s, current); }).join('') +
        '</div></div>';
    }
    if (!opts.noPortal) {
      html += '<a class="cg-fam-portal" href="' + esc(PORTAL.url) + '" target="_blank" rel="noopener">' +
        '<span class="cg-fam-ic">' + esc(PORTAL.emoji) + '</span><span>' + esc(PORTAL.label) + ' →</span></a>';
    }
    return html;
  }

  function bindToggle(wrap) {
    if (!wrap || wrap.__cgFamBound) return;
    wrap.__cgFamBound = true;
    var btn = wrap.querySelector('.cg-fam-btn');
    var panel = wrap.querySelector('.cg-fam-panel');
    if (!btn || !panel) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 헤더 드롭박스 렌더: <div data-cg-family data-current="tools"></div>
  function renderInto(el, opts) {
    opts = opts || {};
    if (!el) return null;
    var current = opts.current || el.getAttribute('data-current') || detectCurrent();
    // 구버전 호스트명 별칭
    if (current === 'mindtest') current = 'mind';
    if (current === 'playhanja') current = 'hanja';
    if (current === 'magicvoca') current = 'voca';

    el.innerHTML =
      '<div class="cg-fam-wrap">' +
        '<button type="button" class="cg-fam-btn" aria-haspopup="true" aria-expanded="false">' +
          '다른 놀자 서비스 <span class="cg-fam-caret">▾</span>' +
        '</button>' +
        '<div class="cg-fam-panel" role="menu">' + panelHtml(current, opts) + '</div>' +
      '</div>';
    bindToggle(el.querySelector('.cg-fam-wrap'));
    return el;
  }

  // 모바일 서랍용 평면 리스트 (gram/science nav.js에서 사용)
  function renderDrawer(el, opts) {
    opts = opts || {};
    if (!el) return null;
    var current = opts.current || el.getAttribute('data-current') || detectCurrent();
    if (current === 'mindtest') current = 'mind';
    if (current === 'playhanja') current = 'hanja';
    if (current === 'magicvoca') current = 'voca';
    var html = '';
    for (var g = 0; g < GROUPS.length; g++) {
      var grp = GROUPS[g];
      var items = SERVICES.filter(function (s) { return s.cat === grp.id; });
      html += '<div class="cg-fam-flat-sec"><div class="cg-fam-flat-t">' + esc(grp.title) + '</div><ul class="cg-fam-flat-list">' +
        items.map(function (s) {
          if (s.id === current) return '<li><span class="cg-fam-flat-cur">' + esc(s.emoji) + ' ' + esc(s.label) + ' (현재)</span></li>';
          return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.emoji) + ' ' + esc(s.label) + '</a></li>';
        }).join('') + '</ul></div>';
    }
    el.innerHTML = html;
    return el;
  }

  function autoInit() {
    var list = document.querySelectorAll('[data-cg-family]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.__cgFamDone) continue;
      el.__cgFamDone = true;
      if (el.getAttribute('data-cg-family') === 'flat') renderDrawer(el, {});
      else renderInto(el, {});
    }
  }

  global.CGFamily = {
    __loaded: true,
    SERVICES: SERVICES,
    GROUPS: GROUPS,
    PORTAL: PORTAL,
    renderInto: renderInto,
    renderDrawer: renderDrawer,
    autoInit: autoInit,
    detectCurrent: detectCurrent
  };
  global.CG_FAMILY = SERVICES;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit, { once: true });
  else autoInit();

})(typeof window !== 'undefined' ? window : this);
