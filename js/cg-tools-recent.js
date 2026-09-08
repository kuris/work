/* 이 파일은 _shared/cg-auth.js 의 복사본입니다. 직접 수정하지 말고 _shared 에서 고친 뒤 sync.sh 를 실행하세요. */
/* ============================================================
   최근 사용한 도구 / 계산 기록  (cg-tools-recent.js)
   ★ 원본: play_project/_shared/cg-tools-recent.js (복사본 직접 수정 금지)

   [이 파일이 하는 일]
     계산기·도구형 서비스(work / money / tools)에 "로그인할 이유"를 만들어 줍니다.
       · 최근 사용한 도구를 기억해 홈에서 바로 이어서 쓸 수 있게 합니다
       · 자주 쓰는 도구를 위쪽에 칩으로 모아 줍니다
       · 계산 결과를 저장해 두고 나중에 다시 볼 수 있습니다 (saveCalc)

   [비로그인 사용자]
     서버 호출이 아예 일어나지 않습니다. 모든 계산기·도구는 지금과 100% 동일합니다.

   사용법
     <script defer src="js/cg-tools-recent.js?v=..."></script>
     홈에 <div id="cg-recent-tools"></div> 한 줄만 넣으면 패널이 그려집니다.

     계산 결과 저장 (원하는 계산기에서 호출):
       CGToolsRecent.saveCalc({ id:'deposit', title:'예금 1,000만원 3.5% 12개월',
                                meta:{ principal:10000000, rate:3.5, months:12, result:10350000 } });

   의존성: cg-auth.js (window.CGAuth)
   ============================================================ */

(function () {
  'use strict';

  function CG() { return window.CGAuth || null; }
  function loggedIn() { return !!(CG() && CG().isLoggedIn()); }

  // ---------- 현재 도구 식별 ----------
  function pageKey() {
    var file = (location.pathname || '/').split('/').pop().replace(/\.html$/i, '');
    if (!file || file === 'index') return null;      // 홈은 기록하지 않습니다
    return file;
  }

  function pageTitle() {
    // "연차 계산기 - 직장인 업무도구" → "연차 계산기"
    var t = (document.title || '').split(/\s+[-|·]\s+/)[0].trim();
    return t || pageKey();
  }

  function pageUrl() {
    var k = pageKey();
    return k ? k + '.html' : null;
  }

  // ---------- 사용 기록 ----------
  function markUsed() {
    if (!loggedIn()) return;
    var k = pageKey();
    if (!k) return;
    CG().touchRecent({ kind: 'tool', id: k, title: pageTitle(), url: pageUrl() });
  }

  // ---------- 계산 결과 저장 ----------
  //  같은 입력으로 다시 계산하면 새 줄이 생기지 않고 횟수만 늘어납니다.
  //  입력이 달라지면 별개의 기록으로 남아 "여러 상품 비교" 가 가능합니다.
  function hashOf(v) {
    var str;
    try { str = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { str = String(v); }
    if (!str) return '0';
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h).toString(36);
  }

  async function saveCalc(o) {
    if (!loggedIn() || !o || !o.id) return false;
    var key = o.key || hashOf(o.meta && o.meta.input ? o.meta.input : (o.meta || o.title));
    return CG().touchRecent({
      kind: 'calc',
      id: String(o.id) + '::' + key,
      title: o.title || pageTitle(),
      url: o.url || pageUrl(),
      meta: o.meta || null
    });
  }

  // ---------- 패널 ----------
  function mount() {
    var host = document.getElementById('cg-recent-tools');
    if (!host || !CG() || !CGAuth.mountRecentPanel) return;

    CGAuth.mountRecentPanel(host, {
      title: '🕘 최근 사용한 도구',
      guestText: 'Google 로그인하면 자주 쓰는 도구와 계산 기록이 계정에 저장돼, 다음에 바로 이어서 쓸 수 있어요.',
      emptyText: '아직 사용 기록이 없어요. 도구를 하나 써보면 여기에 쌓입니다.',
      limit: 8,
      showFrequent: true,
      loader: async function () {
        var rows = await CGAuth.listRecent({ limit: 8 });
        return rows.map(function (r) {
          var sub = '';
          if (r.kind === 'calc') sub = '계산 기록';
          else if (r.hit_count > 1) sub = r.hit_count + '회';
          return { title: r.title || r.item_id, subtitle: sub, url: r.url, updated_at: r.updated_at };
        });
      }
    });
  }

  function start() {
    if (!CG()) return;
    mount();
    CGAuth.onChange(function (s) { if (s.isLoggedIn) markUsed(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.CGToolsRecent = { saveCalc: saveCalc, markUsed: markUsed };
})();
