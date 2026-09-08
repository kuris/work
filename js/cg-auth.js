/* 이 파일은 _shared/cg-auth.js 의 복사본입니다. 직접 수정하지 말고 _shared 에서 고친 뒤 sync.sh 를 실행하세요. */
/* ============================================================
   CGAuth - chatgpts.kr 공통 로그인 모듈 (Google 로그인 전용)
   ------------------------------------------------------------
   ★ 이 파일의 원본은 play_project/_shared/cg-auth.js 입니다.
     각 서비스의 js/cg-auth.js 는 복사본이므로 직접 수정하지 마세요.
     수정 후에는 _shared/sync.sh 를 실행해 8개 서비스에 배포합니다.

   대상 서비스 (8개, 같은 Supabase 프로젝트 / 같은 auth.users.id)
     hanja · voca · history · fortune · mindtest · work · money · tools

   설계 원칙
     1) 로그인은 "선택"입니다. 비로그인 사용자의 기존 기능을 절대 막지 않습니다.
     2) 모든 예외를 삼킵니다. Supabase 가 죽어도 화면은 그대로 동작합니다.
     3) 기존 클라이언트를 재사용합니다. 새로 만들지 않아 세션이 끊기지 않습니다.
     4) 공통 테이블은 항상 .schema('public') 으로 접근합니다.
        (hanja / voca 클라이언트의 기본 스키마를 오염시키지 않기 위해)
     5) Google 로그인 외의 인증 함수는 존재하지 않습니다.
        (이메일/비밀번호, 카카오, 네이버, X, GitHub 없음)

   사용법 - HTML 한 줄이면 끝납니다
     <link rel="stylesheet" href="/css/cg-auth.css?v=...">
     <script defer src="/js/cg-auth.js?v=..."
             data-service="mindtest"
             data-mount="#cg-auth-slot"></script>

   수동 초기화
     CGAuth.init({ service: 'hanja', adopt: true, mount: '.auth-box' });
   ============================================================ */

(function (global) {
  'use strict';

  if (global.CGAuth && global.CGAuth.__loaded) return;   // 중복 로드 방지

  var VERSION = '1.0.0';
  var PROJECT_REF = 'ybhiznlelnpwaicyoifa';
  var SUPABASE_URL = 'https://' + PROJECT_REF + '.supabase.co';
  var DEFAULT_KEY = 'sb_publishable_H4gFRiLEjE8h8s_EX4tKzg__ZKpsBR1';

  // 관리자 판정 폴백 - profiles.role 이 아직 채워지지 않았거나
  // 프로필 조회에 실패했을 때도 관리자가 잠기지 않도록 남겨 둡니다.
  var LEGACY_ADMIN_EMAILS = ['phiskim@gmail.com'];

  // "내 기록" 링크가 이미 존재하는 서비스
  var MY_PAGE = {
    hanja: 'login.html',
    voca: 'login.html',
    history: 'login.html',
    fortune: 'login.html'
    // mindtest / work / money / tools 는 아직 내 기록 페이지가 없어 링크를 숨깁니다
  };

  var DEFAULT_HINT = '로그인하면 기록과 결과를 저장할 수 있어요.';

  // ---------- 내부 상태 ----------
  var opts = null;
  var client = null;
  var user = null;
  var profile = null;
  var entitlements = null;
  var listeners = [];
  var mounts = [];
  var started = false;
  var resolved = false;         // 세션 확인이 끝났는지
  var readyResolve = null;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  // ============================================================
  // 유틸
  // ============================================================
  function warn(msg, e) {
    try { console.warn('[CGAuth] ' + msg, e && (e.message || e)); } catch (_) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isLocal() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local');
  }

  // 로그인 후 돌아올 주소 = 지금 보고 있는 페이지 (토큰 파편 제거)
  function currentCleanUrl() {
    try {
      var u = new URL(location.href);
      u.hash = '';
      u.searchParams.delete('code');
      u.searchParams.delete('error');
      u.searchParams.delete('error_description');
      var qs = u.searchParams.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    } catch (e) {
      return location.origin + location.pathname;
    }
  }

  // 주소창의 #access_token=... / ?code=... 정리
  function cleanCallbackUrl() {
    try {
      var h = location.hash || '';
      if (h.indexOf('access_token=') !== -1 || h.indexOf('refresh_token=') !== -1 || h.indexOf('error=') !== -1) {
        history.replaceState(null, '', location.pathname + location.search);
      }
      if ((location.search || '').indexOf('code=') !== -1) {
        var u = new URL(location.href);
        u.searchParams.delete('code');
        var qs = u.searchParams.toString();
        history.replaceState(null, '', u.pathname + (qs ? '?' + qs : '') + u.hash);
      }
    } catch (e) { /* 무시 */ }
  }

  // ============================================================
  // Supabase 클라이언트 확보
  //   우선순위: 넘겨받은 client > window.sb > 직접 생성
  //   history / fortune 은 script.js 가 DOMContentLoaded 에서 클라이언트를
  //   만들기 때문에, 잠시 기다렸다가 그 클라이언트를 그대로 씁니다.
  //   (같은 storageKey 로 두 개를 만들면 토큰 갱신이 충돌합니다)
  // ============================================================
  function storageKey() {
    if (opts && opts.storageKey) return opts.storageKey;
    if (global.SUPABASE_AUTH_STORAGE_KEY) return global.SUPABASE_AUTH_STORAGE_KEY;
    return 'sb-' + PROJECT_REF + '-auth-token';
  }

  function createOwnClient() {
    if (!global.supabase || typeof global.supabase.createClient !== 'function') return null;
    var authOpts = {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    };
    var sk = storageKey();
    if (sk) authOpts.storageKey = sk;
    try {
      return global.supabase.createClient(
        (global.SUPABASE_URL || SUPABASE_URL),
        (global.SUPABASE_PUBLISHABLE_KEY || DEFAULT_KEY),
        { db: { schema: 'public' }, auth: authOpts }
      );
    } catch (e) {
      warn('클라이언트 생성 실패', e);
      return null;
    }
  }

  function looksLikeClient(c) {
    return !!(c && c.auth && typeof c.auth.getSession === 'function');
  }

  function resolveClient() {
    return new Promise(function (done) {
      if (looksLikeClient(opts.client)) return done(opts.client);
      if (looksLikeClient(global.sb)) return done(global.sb);

      if (!opts.adopt) return done(createOwnClient());

      // adopt 모드: 기존 클라이언트가 나타날 때까지 최대 8초 대기
      var waited = 0;
      var timer = setInterval(function () {
        if (looksLikeClient(global.sb)) {
          clearInterval(timer);
          return done(global.sb);
        }
        waited += 80;
        if (waited >= 8000) {
          clearInterval(timer);
          warn('기존 Supabase 클라이언트를 찾지 못해 전용 클라이언트를 생성합니다.');
          done(createOwnClient());
        }
      }, 80);
    });
  }

  // 공통(public) 스키마 테이블 접근용
  function pub() {
    if (!client) return null;
    try {
      return (typeof client.schema === 'function') ? client.schema('public') : client;
    } catch (e) {
      return client;
    }
  }

  // ============================================================
  // localStorage 에 남아 있는 세션으로 첫 화면을 즉시 그립니다
  //   (로그인한 사용자에게 "로그인" 버튼이 잠깐 보이는 깜빡임 방지)
  // ============================================================
  function peekStoredUser() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      var p = JSON.parse(raw);
      var u = p.user || (p.currentSession && p.currentSession.user) || null;
      if (!u || !u.id) return null;
      return u;
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 인증 (Google 전용)
  // ============================================================
  async function signInWithGoogle(redirectTo) {
    if (!client) {
      warn('로그인 준비가 아직 끝나지 않았습니다.');
      return false;
    }
    try {
      var target = redirectTo || opts.redirectTo || currentCleanUrl();
      var res = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: target,
          queryParams: { prompt: 'select_account' }
        }
      });
      if (res && res.error) throw res.error;
      return true;
    } catch (e) {
      warn('Google 로그인 실패', e);
      alertOnce('로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }

  var alerted = false;
  function alertOnce(msg) {
    if (alerted) return;
    alerted = true;
    try { console.warn('[CGAuth] ' + msg); } catch (_) {}
  }

  async function signOut() {
    if (!client) return;
    try { await client.auth.signOut(); } catch (e) { warn('로그아웃 실패', e); }
    setUser(null);
  }

  // ============================================================
  // 프로필 / 권한
  // ============================================================
  async function loadProfile(force) {
    if (!user || !client) { profile = null; return null; }
    if (profile && !force) return profile;
    var db = pub();
    if (!db) return null;
    try {
      var r = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (r.error) throw r.error;
      profile = r.data || null;

      // 프로필이 아직 없으면 만들어 줍니다 (트리거가 실패했거나 구 계정)
      if (!profile) {
        var meta = user.user_metadata || {};
        var row = {
          id: user.id,
          email: user.email || null,
          nickname: meta.nickname || meta.full_name || meta.name ||
                    String(user.email || '').split('@')[0] || null,
          avatar_url: meta.avatar_url || meta.picture || null
        };
        var ins = await db.from('profiles').upsert(row, { onConflict: 'id' }).select().maybeSingle();
        profile = (ins && ins.data) || row;
      } else {
        // 구글 프로필 사진/이름이 바뀌었으면 조용히 동기화
        var m = user.user_metadata || {};
        var patch = {};
        if (!profile.email && user.email) patch.email = user.email;
        if (!profile.avatar_url && (m.avatar_url || m.picture)) patch.avatar_url = m.avatar_url || m.picture;
        if (!profile.nickname && (m.full_name || m.name)) patch.nickname = m.full_name || m.name;
        if (Object.keys(patch).length) {
          db.from('profiles').update(patch).eq('id', user.id).then(function () {}, function () {});
          Object.assign(profile, patch);
        }
      }
    } catch (e) {
      warn('프로필 조회 실패', e);
      profile = profile || null;
    }
    return profile;
  }

  async function loadEntitlements(force) {
    if (!user || !client) { entitlements = []; return entitlements; }
    if (entitlements && !force) return entitlements;
    var db = pub();
    if (!db) return [];
    try {
      var r = await db.from('user_entitlements').select('*').eq('user_id', user.id);
      if (r.error) throw r.error;
      entitlements = r.data || [];
    } catch (e) {
      warn('권한 조회 실패', e);
      entitlements = [];
    }
    return entitlements;
  }

  function entitlementActive(row) {
    if (!row || !row.value) return false;
    if (row.service && opts && row.service !== opts.service) return false;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false;
    return true;
  }

  function hasEntitlement(key) {
    if (!entitlements) return false;
    for (var i = 0; i < entitlements.length; i++) {
      if (entitlements[i].key === key && entitlementActive(entitlements[i])) return true;
    }
    return false;
  }

  function legacyAdminEmail() {
    if (!user) return false;
    var em = String(user.email || '').toLowerCase().trim();
    return LEGACY_ADMIN_EMAILS.indexOf(em) !== -1;
  }

  function isAdmin() {
    if (!user) return false;
    if (profile && profile.role === 'admin') return true;
    return legacyAdminEmail();          // 폴백: profiles 미반영 시에도 잠기지 않도록
  }

  function isPremium() {
    if (!user) return false;
    if (profile && (profile.plan === 'premium' || profile.plan === 'supporter')) return true;
    return hasEntitlement('premium');
  }

  function isAdsDisabled() {
    return !!(user && profile && profile.ads_disabled);
  }

  function isAdFree() {
    if (!user) return false;
    return isAdmin() || isAdsDisabled() || isPremium() || hasEntitlement('ad_free');
  }

  function displayName() {
    if (!user) return '';
    if (profile && profile.nickname) return profile.nickname;
    var m = user.user_metadata || {};
    return m.nickname || m.full_name || m.name ||
           String(user.email || '').split('@')[0] || '회원';
  }

  function avatarUrl() {
    if (profile && profile.avatar_url) return profile.avatar_url;
    var m = (user && user.user_metadata) || {};
    return m.avatar_url || m.picture || '';
  }

  // ============================================================
  // 기록 저장 헬퍼
  //   비로그인이면 조용히 false 를 돌려줍니다. 절대 throw 하지 않습니다.
  // ============================================================
  async function saveRecord(table, row) {
    if (!user || !client) return false;
    var db = pub();
    if (!db) return false;
    try {
      var payload = Object.assign({}, row, { user_id: user.id });
      var r = await db.from(table).insert(payload);
      if (r.error) throw r.error;
      return true;
    } catch (e) {
      warn('기록 저장 실패 (' + table + ')', e);
      return false;
    }
  }

  async function upsertRecord(table, row, onConflict) {
    if (!user || !client) return false;
    var db = pub();
    if (!db) return false;
    try {
      var payload = Object.assign({}, row, { user_id: user.id });
      var q = db.from(table).upsert(payload, onConflict ? { onConflict: onConflict } : undefined);
      var r = await q;
      if (r.error) throw r.error;
      return true;
    } catch (e) {
      warn('기록 저장 실패 (' + table + ')', e);
      return false;
    }
  }

  async function listRecords(table, o) {
    if (!user || !client) return [];
    var db = pub();
    if (!db) return [];
    o = o || {};
    try {
      var q = db.from(table).select(o.select || '*').eq('user_id', user.id);
      if (o.match) {
        for (var k in o.match) { if (Object.prototype.hasOwnProperty.call(o.match, k)) q = q.eq(k, o.match[k]); }
      }
      q = q.order(o.orderBy || 'created_at', { ascending: !!o.ascending });
      if (o.limit) q = q.limit(o.limit);
      var r = await q;
      if (r.error) throw r.error;
      return r.data || [];
    } catch (e) {
      warn('기록 조회 실패 (' + table + ')', e);
      return [];
    }
  }

  async function deleteRecord(table, match) {
    if (!user || !client) return false;
    var db = pub();
    if (!db) return false;
    try {
      var q = db.from(table).delete().eq('user_id', user.id);
      for (var k in match) { if (Object.prototype.hasOwnProperty.call(match, k)) q = q.eq(k, match[k]); }
      var r = await q;
      if (r.error) throw r.error;
      return true;
    } catch (e) {
      warn('기록 삭제 실패 (' + table + ')', e);
      return false;
    }
  }

  // ============================================================
  // 로그인 UI
  // ============================================================
  var G_SVG =
    '<svg class="cg-g" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
    '</svg>';

  function badgeHtml() {
    if (isAdmin()) return '<span class="cg-badge cg-badge-admin">관리자</span>';
    if (isPremium()) return '<span class="cg-badge cg-badge-premium">Premium</span>';
    if (isAdsDisabled() || hasEntitlement('ad_free')) return '<span class="cg-badge cg-badge-adfree">광고 제거 적용 중</span>';
    return '';
  }

  function myPageUrl() {
    if (opts && opts.myPageUrl !== undefined) return opts.myPageUrl;   // null 이면 숨김
    return MY_PAGE[opts && opts.service] || null;
  }

  function boxHtml(loggedIn) {
    if (!loggedIn) {
      var hint = (opts && opts.hint) || DEFAULT_HINT;
      return '' +
        '<button type="button" class="cg-auth-google" data-cg="login"' +
          (hint ? ' title="' + esc(hint) + '"' : '') + '>' +
          G_SVG + '<span>Google로 로그인</span>' +
        '</button>' +
        (hint ? '<span class="cg-auth-hint">' + esc(hint) + '</span>' : '');
    }

    var name = displayName();
    var av = avatarUrl();
    var my = myPageUrl();
    return '' +
      '<span class="cg-auth-user" title="' + esc(user.email || name) + '">' +
        (av
          ? '<img class="cg-auth-avatar" src="' + esc(av) + '" alt="" referrerpolicy="no-referrer">'
          : '<span class="cg-auth-avatar cg-auth-avatar--txt">' + esc((name[0] || '?').toUpperCase()) + '</span>') +
        '<span class="cg-auth-name">' + esc(name) + '</span>' +
      '</span>' +
      badgeHtml() +
      (my ? '<a class="cg-auth-mine" href="' + esc(my) + '">내 기록</a>' : '') +
      (isAdmin() ? '<a class="cg-auth-admin" href="admin.html">관리자</a>' : '') +
      '<button type="button" class="cg-auth-out" data-cg="logout">로그아웃</button>';
  }

  function paint() {
    for (var i = 0; i < mounts.length; i++) {
      var box = mounts[i];
      if (!box || !box.isConnected) continue;
      var loggedIn = !!user;

      // 서비스가 이미 훌륭한 "로그인 상태" 헤더를 가지고 있는 경우(voca 등)
      // 로그인 후에는 공통 UI 를 감춰 기존 화면을 그대로 둡니다.
      if (opts && opts.hideWhenLoggedIn && loggedIn) {
        box.innerHTML = '';
        box.style.display = 'none';
        continue;
      }
      box.style.display = '';

      box.className = 'cg-auth' + (loggedIn ? ' cg-auth--in' : ' cg-auth--out') +
                      (resolved ? '' : ' cg-auth--pending');
      box.innerHTML = boxHtml(loggedIn);
    }
    scheduleFit();
  }

  // ---------- 헤더 줄바꿈 방지 ----------
  // 안내 문구까지 넣으면 헤더가 두 줄로 늘어나는 서비스(단어야 놀자 등)가 있습니다.
  // 문구를 넣었을 때 헤더 높이가 커지면 문구만 조용히 접습니다.
  // (기존 헤더 레이아웃을 바꾸지 않기 위한 조치이며, 문구는 버튼 title 로 남습니다)
  function fitHints() {
    for (var i = 0; i < mounts.length; i++) {
      var box = mounts[i];
      if (!box || !box.isConnected) continue;
      var hint = box.querySelector('.cg-auth-hint');
      if (!hint) continue;
      var host = (box.closest && box.closest('header')) || box.parentElement;
      if (!host) continue;
      try {
        hint.style.display = 'none';
        var base = host.getBoundingClientRect().height;
        hint.style.display = '';
        var full = host.getBoundingClientRect().height;
        if (full > base + 1) hint.style.display = 'none';
      } catch (e) { /* 무시 */ }
    }
  }

  var fitTimer = null;
  function scheduleFit() {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      try { requestAnimationFrame(fitHints); } catch (e) { fitHints(); }
    }, 60);
  }

  function bindResize() {
    if (bindResize.done) return;
    bindResize.done = true;
    window.addEventListener('resize', scheduleFit, { passive: true });
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(scheduleFit, function () {});
    }
  }

  function bindDelegates() {
    if (bindDelegates.done) return;
    bindDelegates.done = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest && ev.target.closest('[data-cg]');
      if (!t) return;
      var act = t.getAttribute('data-cg');
      if (act === 'login') { ev.preventDefault(); signInWithGoogle(); }
      else if (act === 'logout') { ev.preventDefault(); signOut(); }
    }, false);
  }

  function resolveMountTarget(sel) {
    if (!sel) return null;
    if (sel.nodeType === 1) return sel;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function mountAuthUI(target, o) {
    o = o || {};
    var host = resolveMountTarget(target);
    if (!host) return null;

    var box;
    // 이미 cg-auth 컨테이너면 그대로 사용 (hanja/voca 의 .auth-box 등)
    if (host.classList && host.classList.contains('cg-auth')) {
      box = host;
    } else {
      box = host.querySelector(':scope > .cg-auth');
      if (!box) {
        box = document.createElement('div');
        box.className = 'cg-auth cg-auth--pending';
        var mode = o.mode || 'append';
        if (mode === 'prepend') host.insertBefore(box, host.firstChild);
        else if (mode === 'before') host.parentNode.insertBefore(box, host);
        else if (mode === 'after') host.parentNode.insertBefore(box, host.nextSibling);
        else host.appendChild(box);
      }
    }
    if (mounts.indexOf(box) === -1) mounts.push(box);
    bindDelegates();
    bindResize();
    paint();
    return box;
  }

  // ============================================================
  // 상태 변경 통지
  // ============================================================
  function setUser(u) {
    var prev = user && user.id;
    user = u || null;
    if (!user || user.id !== prev) { profile = null; entitlements = null; }
    paint();
    emit();
  }

  function emit() {
    var detail = {
      user: user,
      profile: profile,
      service: opts && opts.service,
      isLoggedIn: !!user,
      isAdmin: isAdmin(),
      isAdFree: isAdFree()
    };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](detail); } catch (e) { warn('onChange 콜백 오류', e); }
    }
    try {
      document.dispatchEvent(new CustomEvent('cg:auth-changed', { detail: detail }));
    } catch (e) { /* 무시 */ }
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    if (resolved) { try { cb({ user: user, profile: profile, isLoggedIn: !!user, isAdmin: isAdmin(), isAdFree: isAdFree() }); } catch (e) {} }
    return function () { off(cb); };
  }

  function off(cb) {
    var i = listeners.indexOf(cb);
    if (i !== -1) listeners.splice(i, 1);
  }

  // 광고 제거 여부를 다음 방문 때 즉시 알 수 있도록 캐시
  function cacheAdFree() {
    try {
      if (!user) { localStorage.removeItem('cg_adfree'); return; }
      if (isAdFree()) localStorage.setItem('cg_adfree', '1');
      else localStorage.removeItem('cg_adfree');
    } catch (e) { /* 무시 */ }
  }

  function adFreeHint() {   // 동기 판정용 (네트워크 대기 없음)
    try { return localStorage.getItem('cg_adfree') === '1'; } catch (e) { return false; }
  }

  // ============================================================
  // 관리자 가드
  // ============================================================
  async function requireAdmin(o) {
    o = o || {};
    await ready();
    if (isAdmin()) return true;
    if (typeof o.onDenied === 'function') { o.onDenied(user); return false; }
    return false;
  }

  // ============================================================
  // 초기화
  // ============================================================
  async function boot() {
    client = await resolveClient();

    if (!client) {
      warn('Supabase 를 사용할 수 없어 비로그인 상태로 동작합니다.');
      resolved = true;
      paint();
      emit();
      readyResolve(false);
      return;
    }

    try {
      var s = await client.auth.getSession();
      user = (s && s.data && s.data.session && s.data.session.user) || null;
    } catch (e) {
      warn('세션 확인 실패', e);
      user = null;
    }

    resolved = true;
    paint();

    if (user) {
      cleanCallbackUrl();
      await loadProfile(true);
      await loadEntitlements(true);
      cacheAdFree();
      paint();
    } else {
      cacheAdFree();
    }
    emit();
    readyResolve(true);

    try {
      client.auth.onAuthStateChange(async function (event, session) {
        if (event === 'PASSWORD_RECOVERY') return;   // 이 모듈은 비밀번호를 다루지 않습니다
        var next = (session && session.user) || null;
        var changed = (next && next.id) !== (user && user.id);
        user = next;
        if (changed) {
          profile = null; entitlements = null;
          if (user) {
            cleanCallbackUrl();
            paint();
            await loadProfile(true);
            await loadEntitlements(true);
          }
          cacheAdFree();
        }
        paint();
        emit();
      });
    } catch (e) {
      warn('인증 상태 감지 등록 실패', e);
    }
  }

  function ready() { return readyPromise; }

  function init(o) {
    o = o || {};
    if (started) {
      if (o.mount) mountAuthUI(o.mount, o);
      return readyPromise;
    }
    started = true;
    opts = {
      service: o.service || (global.CG_SERVICE || 'unknown'),
      client: o.client || null,
      adopt: o.adopt !== undefined ? !!o.adopt : false,
      storageKey: o.storageKey || null,
      mount: o.mount || null,
      mountMode: o.mountMode || 'append',
      hint: o.hint !== undefined ? o.hint : DEFAULT_HINT,
      myPageUrl: o.myPageUrl,
      redirectTo: o.redirectTo || null,
      hideWhenLoggedIn: !!o.hideWhenLoggedIn
    };

    // localStorage 세션으로 첫 화면을 미리 정확하게 그립니다
    user = peekStoredUser();

    function domReady(fn) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
      else fn();
    }

    domReady(function () {
      if (opts.mount) mountAuthUI(opts.mount, { mode: opts.mountMode });
      // data-cg-auth 속성이 붙은 요소도 자동으로 마운트합니다
      var autos = document.querySelectorAll('[data-cg-auth]');
      for (var i = 0; i < autos.length; i++) mountAuthUI(autos[i], { mode: autos[i].getAttribute('data-cg-auth-mode') || 'append' });
      boot();
    });

    return readyPromise;
  }

  // ---------- <script data-service="..."> 자동 초기화 ----------
  function autoInit() {
    var s = document.currentScript;
    if (!s) {
      var list = document.querySelectorAll('script[src*="cg-auth.js"][data-service]');
      s = list[list.length - 1] || null;
    }
    if (!s) return;
    var svc = s.getAttribute('data-service');
    if (!svc) return;
    init({
      service: svc,
      adopt: s.getAttribute('data-adopt') === 'true',
      mount: s.getAttribute('data-mount') || null,
      mountMode: s.getAttribute('data-mount-mode') || 'append',
      hint: s.hasAttribute('data-hint') ? s.getAttribute('data-hint') : undefined,
      myPageUrl: s.hasAttribute('data-my-page')
        ? (s.getAttribute('data-my-page') || null)
        : undefined,
      hideWhenLoggedIn: s.getAttribute('data-hide-when-logged-in') === 'true'
    });
  }

  // ============================================================
  // 공개 API - Google 로그인 외의 인증 함수는 의도적으로 없습니다
  // ============================================================
  global.CGAuth = {
    __loaded: true,
    VERSION: VERSION,

    init: init,
    ready: ready,
    getClient: function () { return client; },
    getPublicDb: pub,
    getService: function () { return opts && opts.service; },

    // 인증 (Google 전용)
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,

    // 사용자
    getUser: function () { return user; },
    getUserId: function () { return user ? user.id : null; },
    isLoggedIn: function () { return !!user; },
    isResolved: function () { return resolved; },
    displayName: displayName,
    avatarUrl: avatarUrl,

    // 프로필 / 권한
    getProfile: function () { return profile; },
    loadProfile: loadProfile,
    refreshProfile: function () { return loadProfile(true); },
    getEntitlements: function () { return entitlements || []; },
    loadEntitlements: loadEntitlements,
    hasEntitlement: hasEntitlement,
    isAdmin: isAdmin,
    isPremium: isPremium,
    isAdsDisabled: isAdsDisabled,
    isAdFree: isAdFree,
    adFreeHint: adFreeHint,
    requireAdmin: requireAdmin,
    LEGACY_ADMIN_EMAILS: LEGACY_ADMIN_EMAILS,

    // 기록
    saveRecord: saveRecord,
    upsertRecord: upsertRecord,
    listRecords: listRecords,
    deleteRecord: deleteRecord,

    // UI
    mountAuthUI: mountAuthUI,
    refreshUI: paint,
    onChange: onChange,
    off: off
  };

  autoInit();

})(typeof window !== 'undefined' ? window : this);
