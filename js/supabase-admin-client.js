/* ============================================================
   관리자 페이지 전용 Supabase 클라이언트 (supabase-admin-client.js)
   - admin.html 에서만 로드됩니다.
   ============================================================ */

(function () {
  if (typeof window === 'undefined') return;

  var url = window.SUPABASE_URL;
  var key = window.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.warn('[admin] Supabase 상수를 찾지 못했습니다. supabase-config.js 로드 순서를 확인해 주세요.');
    window.sbAdmin = null;
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('[admin] supabase-js 로드 실패 - 관리자 화면을 열 수 없습니다.');
    window.sbAdmin = null;
    return;
  }

  var authOptions = {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  };
  if (window.SUPABASE_AUTH_STORAGE_KEY) {
    authOptions.storageKey = window.SUPABASE_AUTH_STORAGE_KEY;
  }

  window.sbAdmin = window.supabase.createClient(url, key, {
    db: { schema: 'public' },
    auth: authOptions
  });
})();
