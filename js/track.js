/* ============================================================
   화면 조회 로그 수집기 (track.js)

   - 관리자 페이지의 통계용으로 "화면 방문 기록"만 남기는 독립 스크립트입니다.
   - 기존 사용자 로직(script.js / auth.js / nav.js)과 어떤 변수도 공유하지 않고,
     supabase-js 라이브러리에도 의존하지 않습니다. (REST 호출만 사용)
     → 기존 인증 클라이언트와 충돌하지 않습니다.
   - 전체가 try/catch 로 감싸져 있고 네트워크 실패는 조용히 무시합니다.
     로그 저장이 실패해도 사용자 화면에는 어떤 영향도 없습니다.

   사용법 (사용자 페이지에 이 한 줄만 추가):
     <script defer src="js/track.js" data-service="history"></script>

   ※ window.SUPABASE_URL / window.SUPABASE_PUBLISHABLE_KEY 가 없으면
      아무 것도 하지 않고 조용히 종료합니다.
   ============================================================ */

(function () {
  'use strict';

  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // ---------- 0. 서비스 값 ----------
    var thisScript = document.currentScript || document.querySelector('script[data-service]');
    var SERVICE = (thisScript && thisScript.getAttribute('data-service')) || window.TRACK_SERVICE || '';
    if (!SERVICE) return;

    // ---------- 1. 관리자 페이지는 집계 제외 ----------
    var file = location.pathname.split('/').pop() || 'index.html';
    if (file === 'admin.html' || file === 'admin') return;

    // result/burnout-1.html 처럼 하위 폴더까지 포함한 경로를 기록합니다.
    var pathParts = location.pathname.replace(/^\/+/, '').split('/');
    var relPath = pathParts.filter(Boolean).join('/') || 'index.html';
    if (!/\.[a-zA-Z0-9]+$/.test(relPath)) relPath = relPath + (relPath.slice(-1) === '/' ? 'index.html' : '');
    var pagePath = '/' + relPath;

    var title = (document.title || '').split(/\s[-|｜]\s/)[0].trim() || relPath;

    // ---------- 2. KST 기준 시각 (DB 기본값과 동일 기준) ----------
    var kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    var hour = kst.getUTCHours();
    var day = kst.toISOString().slice(0, 10);

    // ---------- 3. 브라우저 로컬 통계 (오프라인 백업용) ----------
    try {
      var STATS_KEY = SERVICE + '_local_pv_stats';
      var stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{"pages":{},"hours":{},"days":{},"recent":[]}');
      stats.pages[relPath] = (stats.pages[relPath] || 0) + 1;
      stats.hours[hour] = (stats.hours[hour] || 0) + 1;
      stats.days[day] = (stats.days[day] || 0) + 1;
      stats.recent = (stats.recent || []).slice(0, 29);
      stats.recent.unshift({ path: relPath, title: title, time: new Date().toISOString() });
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) { /* localStorage 차단 환경 - 무시 */ }

    // ---------- 4. 로그인 세션 best-effort 추출 ----------
    // 기존 인증 로직을 건드리지 않고, 이미 저장된 세션을 "읽기만" 합니다.
    function readSession() {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (!key || key.indexOf('auth-token') === -1 && key.indexOf('auth_token') === -1) continue;
          var raw = localStorage.getItem(key);
          if (!raw || raw.charAt(0) !== '{') continue;
          var parsed = JSON.parse(raw);
          var token = parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token);
          var user = parsed.user || (parsed.currentSession && parsed.currentSession.user);
          if (token) return { token: token, userId: (user && user.id) || null };
        }
      } catch (e) { /* 무시 */ }
      return { token: null, userId: null };
    }

    // ---------- 5. Supabase REST 로 전송 ----------
    function send() {
      try {
        var url = window.SUPABASE_URL;
        var key = window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY;
        if (!url || !key || typeof fetch !== 'function') return;

        var session = readSession();

        fetch(url.replace(/\/+$/, '') + '/rest/v1/page_views', {
          method: 'POST',
          keepalive: true,
          headers: {
            'apikey': key,
            'Authorization': 'Bearer ' + (session.token || key),
            'Content-Type': 'application/json',
            'Content-Profile': 'public',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            service: SERVICE,
            path: pagePath,
            page_title: title,
            referrer: document.referrer || null,
            user_id: session.userId || null,
            hour: hour,
            day: day
          })
        }).catch(function () { /* 전송 실패는 사용자에게 영향 없음 */ });
      } catch (e) {
        console.warn('[track] 로그 전송을 건너뛰었습니다.', e && e.message);
      }
    }

    // 사용자 화면 렌더링과 경쟁하지 않도록 유휴 시점에 전송합니다.
    if (document.readyState === 'complete') {
      setTimeout(send, 300);
    } else {
      window.addEventListener('load', function () { setTimeout(send, 300); }, { once: true });
    }
  } catch (e) {
    console.warn('[track] 초기화를 건너뛰었습니다.', e && e.message);
  }
})();
