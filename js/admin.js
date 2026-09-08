/* ============================================================
   공통 관리자 센터 스크립트 (admin.js)

   - playhanja/js/admin.js 를 기준 템플릿으로 이식했습니다.
   - 4개 서비스(voca / history / fortune / mindtest)가 이 파일을 그대로 공유하고,
     서비스별 차이는 admin.html 이 정의하는 window.ADMIN_CONFIG 로만 처리합니다.

   의존성 (admin.html 에서 미리 준비해 주어야 하는 것)
     window.sbAdmin      : supabase-js 클라이언트 (관리자 페이지 전용)
     window.ADMIN_CONFIG : 서비스 설정 객체

   ※ 이 파일은 admin.html 에서만 로드됩니다.
      사용자 화면(script.js / auth.js / nav.js 등)과 어떤 것도 공유하지 않습니다.
   ============================================================ */

(function () {
  'use strict';

  const CFG = window.ADMIN_CONFIG || {};
  const SERVICE = CFG.service || 'unknown';
  const ADMIN_EMAILS = (CFG.adminEmails || ['phiskim@gmail.com']).map(e => e.toLowerCase().trim());

  // PostgREST 는 한 번에 최대 1000행까지만 돌려줍니다 (max_rows=1000).
  // 차트용 원본은 페이지네이션으로 최대 5000행까지 모으고,
  // 헤드라인 숫자는 count 쿼리로 정확한 전체 건수를 따로 받아옵니다.
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 5;

  // 다른 프로젝트 관리자 페이지 목록 (서비스 전환용)
  const SERVICES = [
    { key: 'hanja',    name: '한자야 놀자',   emoji: '漢', url: 'https://hanja.chatgpts.kr/admin' },
    { key: 'voca',     name: '단어야 놀자',   emoji: '單', url: 'https://voca.chatgpts.kr/admin' },
    { key: 'history',  name: '역사야 놀자',   emoji: '史', url: 'https://history.chatgpts.kr/admin' },
    { key: 'fortune',  name: '운세야 놀자',   emoji: '運', url: 'https://fortune.chatgpts.kr/admin' },
    { key: 'mindtest', name: '마인드테스트',  emoji: '心', url: 'https://mindtest.chatgpts.kr/admin' },
    { key: 'work',     name: '워크야 놀자',   emoji: '職', url: 'https://work.chatgpts.kr/admin' },
    { key: 'money',    name: '머니야 놀자',   emoji: '財', url: 'https://money.chatgpts.kr/admin' },
    { key: 'tools',    name: '문서야 놀자',   emoji: '文', url: 'https://tools.chatgpts.kr/admin' }
  ];

  const sb = () => window.sbAdmin || null;

  // ---------- DOM ----------
  const loadingView   = document.getElementById('admin-loading');
  const authView      = document.getElementById('admin-auth-view');
  const deniedView    = document.getElementById('admin-denied-view');
  const dashboardView = document.getElementById('admin-dashboard-view');
  const deniedEmailEl = document.getElementById('denied-user-email');
  const adminEmailEl  = document.getElementById('admin-current-email');
  const loginForm     = document.getElementById('admin-login-form');
  const googleBtn     = document.getElementById('admin-google-btn');
  const authMsg       = document.getElementById('admin-auth-msg');

  // ---------- 상태 ----------
  let currentUser     = null;
  let accessGranted   = false;
  let cachedPageViews = [];
  let cachedCounts    = { total: 0, today: 0, week: 0, month: 0 };
  let cachedMembers   = [];
  let membersSource   = 'service_members';   // 'service_members' | 'logs'
  let cachedActivity  = [];

  let selectedPeriod   = 'all';   // all | month | week | today
  let selectedTimeSlot = 'all';   // all | morning | afternoon | evening | night
  let selectedExactHour = null;   // null | 0~23

  // ============================================================
  // 0. 유틸리티
  // ============================================================

  // 로그의 day/hour 는 KST 기준으로 저장되므로 클라이언트도 KST 로 계산합니다.
  function kstNow() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000);
  }
  function kstDateStr(offsetDays) {
    const d = kstNow();
    if (offsetDays) d.setTime(d.getTime() + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function kstHour() {
    return kstNow().getUTCHours();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    const diff = Date.now() - d.getTime();
    if (diff < 0) return '방금 전';
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금 전';
    if (min < 60) return min + '분 전';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + '시간 전';
    const days = Math.floor(hr / 24);
    if (days < 7) return days + '일 전';
    return d.toISOString().slice(0, 10);
  }

  function num(n) {
    return Number(n || 0).toLocaleString();
  }

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function setHtml(id, html) {
    const node = el(id);
    if (node) node.innerHTML = html;
  }

  function emptyBox(message, sub) {
    return `
      <div class="admin-empty">
        <div class="admin-empty-icon"><i class="fa-solid fa-inbox"></i></div>
        <div>${escapeHtml(message)}</div>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
      </div>`;
  }

  function emptyRow(colspan, message, sub) {
    return `<tr><td colspan="${colspan}">${emptyBox(message, sub)}</td></tr>`;
  }

  // 경로 정규화
  // Vercel cleanUrls 때문에 같은 화면이 '/quiz' 와 '/quiz.html' 로 나뉘어 기록될 수
  // 있습니다. 표시·집계 단계에서 '.html' 형태로 통일해 하나로 합칩니다.
  // (track.js 수정 이전에 쌓인 로그도 함께 병합됩니다)
  function normalizePath(path) {
    let clean = String(path || '').replace(/^\/+/, '');
    if (clean === '' || clean.slice(-1) === '/') clean += 'index.html';
    else if (!/\.[a-zA-Z0-9]+$/.test(clean)) clean += '.html';
    return clean;
  }

  // 화면 경로 → 사람이 읽는 이름
  function pageTitleOf(path, fallbackTitle) {
    const clean = normalizePath(path);
    const map = CFG.pageTitles || {};
    if (map[clean]) return map[clean];
    // result/burnout-1.html 처럼 하위 폴더인 경우 폴더 규칙으로 한 번 더 시도
    const dir = clean.split('/')[0];
    if (dir !== clean && map[dir + '/']) return map[dir + '/'];
    return fallbackTitle || clean;
  }

  // page_views 는 public 스키마에 있습니다. (voca/fortune/mindtest 스키마는 API 미노출)
  function tbl(name) {
    return sb().schema('public').from(name);
  }

  // ============================================================
  // 1. 권한 확인 및 화면 전환
  //    - 비로그인      → 로그인 안내 화면
  //    - 권한 없는 계정 → 권한 없음 화면 (데이터 요청 자체를 하지 않음)
  //    - 관리자        → 대시보드
  // ============================================================
  // ---------- 관리자 판정 (공통 기준) ----------
  //   1순위: public.profiles.role === 'admin'
  //   2순위: ADMIN_CONFIG.adminEmails 목록
  //          profiles 마이그레이션 전이거나 조회에 실패해도 관리자가 잠기지 않도록
  //          기존 이메일 기준을 폴백으로 남겨 둡니다.
  let currentRole = null;

  async function fetchRole(user) {
    if (!user || !sb()) return null;
    try {
      const { data, error } = await sb()
        .from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (error) throw error;
      return (data && data.role) || null;
    } catch (e) {
      console.warn('[admin] profiles.role 조회 실패 - 이메일 기준으로 판정합니다:', e.message || e);
      return null;
    }
  }

  function isAdminUser(user) {
    if (!user) return false;
    if (currentRole === 'admin') return true;
    const email = (user.email || '').toLowerCase().trim();
    return ADMIN_EMAILS.indexOf(email) !== -1;
  }

  async function applyAccessState(user) {
    currentUser = user || null;
    currentRole = user ? await fetchRole(user) : null;
    if (loadingView) loadingView.style.display = 'none';

    if (!user) {
      accessGranted = false;
      if (authView) authView.style.display = 'block';
      if (deniedView) deniedView.style.display = 'none';
      if (dashboardView) dashboardView.style.display = 'none';
      return;
    }

    const email = (user.email || '').toLowerCase().trim();

    if (!isAdminUser(user)) {
      accessGranted = false;
      if (authView) authView.style.display = 'none';
      if (deniedView) deniedView.style.display = 'block';
      if (dashboardView) dashboardView.style.display = 'none';
      if (deniedEmailEl) deniedEmailEl.textContent = email;
      return;   // ← 데이터 로딩을 호출하지 않습니다.
    }

    if (accessGranted) return;   // 이미 열려 있으면 재로딩하지 않음
    accessGranted = true;
    if (authView) authView.style.display = 'none';
    if (deniedView) deniedView.style.display = 'none';
    if (dashboardView) dashboardView.style.display = 'block';
    if (adminEmailEl) adminEmailEl.textContent = email;
    loadAllDashboardData();
  }

  function showMsg(text, type) {
    if (!authMsg) return;
    authMsg.className = 'admin-msg show ' + (type || 'info');
    authMsg.textContent = text;
  }

  // ============================================================
  // 2. 로그인 / 로그아웃
  // ============================================================
  // ---------- 이메일/비밀번호 로그인은 사용하지 않습니다 ----------
  // 관리자도 Google 로그인만 사용합니다. (admin.html 에서도 폼을 제거했지만,
  // 혹시 남아 있는 화면이 있어도 동작하지 않도록 여기서 한 번 더 숨깁니다)
  if (loginForm) loginForm.style.display = 'none';

  if (googleBtn) {
    googleBtn.addEventListener('click', async function () {
      if (!sb()) { showMsg('서버 연결을 준비하지 못했습니다.', 'error'); return; }
      try {
        showMsg('Google 로그인 창으로 이동합니다...', 'info');
        const { error } = await sb().auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + '/admin.html' }
        });
        if (error) throw error;
      } catch (err) {
        showMsg(err.message || 'Google 로그인에 실패했습니다.', 'error');
      }
    });
  }

  document.querySelectorAll('.js-admin-logout').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try { if (sb()) await sb().auth.signOut(); } catch (e) { /* 무시 */ }
      location.reload();
    });
  });

  // ============================================================
  // 3. 헤더 · 탭 · 서비스 전환
  // ============================================================
  function renderServiceSwitcher() {
    const menu = el('admin-switch-menu');
    if (!menu) return;

    const items = SERVICES.map(function (s) {
      const isCurrent = s.key === SERVICE;
      if (isCurrent) {
        return `
          <div class="admin-switch-item is-current">
            <span class="admin-switch-emoji">${s.emoji}</span>
            <span>
              <span class="admin-switch-name">${escapeHtml(s.name)}</span><br>
              <span class="admin-switch-host">${escapeHtml(s.url.replace('https://', ''))}</span>
            </span>
            <span class="admin-switch-current-tag">현재 위치</span>
          </div>`;
      }
      return `
        <a class="admin-switch-item" href="${s.url}">
          <span class="admin-switch-emoji">${s.emoji}</span>
          <span>
            <span class="admin-switch-name">${escapeHtml(s.name)}</span><br>
            <span class="admin-switch-host">${escapeHtml(s.url.replace('https://', ''))}</span>
          </span>
        </a>`;
    }).join('');

    menu.innerHTML = `
      <div class="admin-switch-menu-head">관리자 페이지 전환</div>
      ${items}
      <div class="admin-switch-note">
        서비스마다 도메인이 다르므로, 이동한 사이트에서 관리자 로그인을 한 번 더 해야 할 수 있습니다.
      </div>`;

    const wrap = el('admin-switch');
    const btn = el('admin-switch-btn');
    if (btn && wrap) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        wrap.classList.toggle('open');
      });
      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) wrap.classList.remove('open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') wrap.classList.remove('open');
      });
    }
  }

  function setupTabs() {
    const tabBtns = document.querySelectorAll('.admin-tab-btn');
    const tabPanels = document.querySelectorAll('.admin-tab-panel');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => { p.style.display = 'none'; });
        btn.classList.add('active');
        const panel = el('panel-' + btn.dataset.tab);
        if (panel) panel.style.display = 'block';
      });
    });
  }

  function setupRefresh() {
    const refreshBtn = el('admin-refresh-btn');
    if (!refreshBtn) return;
    refreshBtn.addEventListener('click', function () {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 갱신 중';
      loadAllDashboardData().finally(function () {
        setTimeout(function () {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 새로고침';
        }, 400);
      });
    });
  }

  function setupCopySql() {
    const copyBtn = el('admin-copy-sql');
    const codeEl = el('admin-sql-code');
    if (!copyBtn || !codeEl) return;
    copyBtn.addEventListener('click', function () {
      const code = codeEl.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () {
          copyBtn.textContent = '복사 완료! ✓';
          setTimeout(function () { copyBtn.textContent = 'SQL 복사'; }, 2000);
        }, function () {
          copyBtn.textContent = '복사 실패';
          setTimeout(function () { copyBtn.textContent = 'SQL 복사'; }, 2000);
        });
      }
    });
  }

  // ============================================================
  // 4. 데이터 로딩
  // ============================================================
  async function loadAllDashboardData() {
    // 회원 탭은 service_members 가 비었을 때 페이지뷰 로그로 대체하므로,
    // 트래픽 로그를 먼저 받아온 뒤에 회원/활동을 처리합니다. (경합 방지)
    await loadTrafficAndAnalytics();
    await Promise.allSettled([
      loadMembersData(),
      loadActivityData()
    ]);
    // admin.html 의 content.stats compute() 에서 참조할 수 있도록 공개합니다.
    window.ADMIN_STATE = {
      pageViews: cachedPageViews,
      counts: cachedCounts,
      members: cachedMembers,
      activity: cachedActivity
    };
    loadContentSummary();
  }

  // ---------- 4-1. 페이지뷰 로그 ----------
  async function fetchPageViewPages() {
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await tbl('page_views')
        .select('*')
        .eq('service', SERVICE)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push.apply(rows, data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async function countPageViews(applyFilter) {
    let q = tbl('page_views').select('*', { count: 'exact', head: true }).eq('service', SERVICE);
    q = applyFilter ? applyFilter(q) : q;
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  }

  async function loadTrafficAndAnalytics() {
    if (!sb()) { renderTrafficEmpty('Supabase 연결을 준비하지 못했습니다.'); return; }

    const today = kstDateStr(0);
    const weekAgo = kstDateStr(-6);     // 오늘 포함 7일
    const monthAgo = kstDateStr(-29);   // 오늘 포함 30일

    try {
      const results = await Promise.all([
        fetchPageViewPages(),
        countPageViews(null),
        countPageViews(q => q.eq('day', today)),
        countPageViews(q => q.gte('day', weekAgo)),
        countPageViews(q => q.gte('day', monthAgo))
      ]);

      cachedPageViews = results[0];
      cachedCounts = { total: results[1], today: results[2], week: results[3], month: results[4] };
    } catch (e) {
      console.warn('[admin] page_views 조회 실패:', e.message || e);
      cachedPageViews = [];
      cachedCounts = { total: 0, today: 0, week: 0, month: 0 };
      renderTrafficEmpty('로그 조회 중 오류가 발생했습니다. SQL 가이드 탭의 page_views 테이블 생성 여부를 확인해 주세요.');
      return;
    }

    applyTrafficFilters();
  }

  function renderTrafficEmpty(reason) {
    setText('stat-total-pv', '0회');
    setText('stat-today-pv', '0회');
    setText('stat-week-pv', '0회');
    setText('stat-peak-hour', '—');
    setHtml('admin-hourly-chart', emptyBox('아직 수집된 데이터가 없습니다.', reason));
    setHtml('admin-daily-chart', emptyBox('아직 수집된 데이터가 없습니다.', reason));
    setHtml('admin-page-ranking', emptyBox('아직 수집된 데이터가 없습니다.', reason));
    setHtml('admin-recent-visits', emptyBox('최근 방문 내역이 없습니다.', reason));
    const tbody = el('admin-screen-tbody');
    if (tbody) tbody.innerHTML = emptyRow(5, '아직 수집된 데이터가 없습니다.', reason);
  }

  function setupFilters() {
    const periodPills = document.querySelectorAll('#admin-period-filter .admin-pill-btn');
    periodPills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        periodPills.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPeriod = btn.dataset.period;
        selectedExactHour = null;
        applyTrafficFilters();
      });
    });

    const slotPills = document.querySelectorAll('#admin-time-slot-filter .admin-pill-btn');
    slotPills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        slotPills.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedTimeSlot = btn.dataset.slot;
        selectedExactHour = null;
        applyTrafficFilters();
      });
    });
  }

  function dayOf(row) {
    return row.day || String(row.created_at || '').slice(0, 10);
  }

  function applyTrafficFilters() {
    const today = kstDateStr(0);
    let list = cachedPageViews.slice();

    // 1) 기간
    if (selectedPeriod === 'today') {
      list = list.filter(r => dayOf(r) === today);
    } else if (selectedPeriod === 'week') {
      const from = kstDateStr(-6);
      list = list.filter(r => dayOf(r) >= from);
    } else if (selectedPeriod === 'month') {
      const from = kstDateStr(-29);
      list = list.filter(r => dayOf(r) >= from);
    }

    // 2) 시간대
    if (selectedExactHour !== null) {
      list = list.filter(r => Number(r.hour) === selectedExactHour);
    } else if (selectedTimeSlot === 'morning') {
      list = list.filter(r => Number(r.hour) >= 6 && Number(r.hour) < 12);
    } else if (selectedTimeSlot === 'afternoon') {
      list = list.filter(r => Number(r.hour) >= 12 && Number(r.hour) < 18);
    } else if (selectedTimeSlot === 'evening') {
      list = list.filter(r => Number(r.hour) >= 18 && Number(r.hour) < 24);
    } else if (selectedTimeSlot === 'night') {
      list = list.filter(r => Number(r.hour) >= 0 && Number(r.hour) < 6);
    }

    updateFilterSummary(list.length);
    renderTrafficAnalytics(list);
  }

  function updateFilterSummary(count) {
    const periodNames = { all: '전체 누적', month: '최근 30일(월간)', week: '최근 7일(주간)', today: '오늘 당일' };
    const slotNames = {
      all: '전 시간대', morning: '아침(06~12시)', afternoon: '오후(12~18시)',
      evening: '저녁/밤(18~24시)', night: '새벽(00~06시)'
    };
    let label = '[' + (periodNames[selectedPeriod] || '전체') + ']';
    if (selectedExactHour !== null) {
      label += ' · [' + selectedExactHour + '시 정밀 조회]';
    } else if (selectedTimeSlot !== 'all') {
      label += ' · [' + slotNames[selectedTimeSlot] + ']';
    }
    label += ' 조건 결과: 총 ' + num(count) + '회 조회';
    if (cachedCounts.total > cachedPageViews.length) {
      label += ' (차트는 최근 ' + num(cachedPageViews.length) + '건 기준, 상단 누적 수치는 전체 기준)';
    }
    if (selectedExactHour !== null) {
      label += ' — 시간대 막대를 다시 누르면 해제됩니다.';
    }
    setText('admin-filter-summary', label);
  }

  function renderTrafficAnalytics(list) {
    const today = kstDateStr(0);
    const pagesMap = {};
    const hoursMap = new Array(24).fill(0);
    const daysMap = {};

    list.forEach(function (r) {
      const p = normalizePath(r.path);
      if (!pagesMap[p]) {
        pagesMap[p] = { path: p, title: r.page_title || '', count: 0, users: {}, last: r.created_at };
      }
      const bucket = pagesMap[p];
      bucket.count++;
      if (r.user_id) bucket.users[r.user_id] = 1;
      if (r.created_at > bucket.last) bucket.last = r.created_at;

      const h = Number(r.hour);
      if (!isNaN(h) && h >= 0 && h < 24) hoursMap[h]++;

      const d = dayOf(r);
      if (d) daysMap[d] = (daysMap[d] || 0) + 1;
    });

    // 헤드라인 숫자: 필터가 '전체'일 때는 서버 count(정확값), 아니면 필터 결과 건수
    const isAll = selectedPeriod === 'all' && selectedTimeSlot === 'all' && selectedExactHour === null;
    const totalPv = isAll ? cachedCounts.total : list.length;

    setText('stat-total-pv', num(cachedCounts.total) + '회');
    setText('stat-today-pv', num(cachedCounts.today) + '회');
    setText('stat-week-pv', num(cachedCounts.week) + '회 / ' + num(cachedCounts.month) + '회');

    // 최다 접속 시간대
    let peakHour = -1, peakVal = 0;
    hoursMap.forEach(function (v, h) { if (v > peakVal) { peakVal = v; peakHour = h; } });
    setText('stat-peak-hour', peakVal > 0
      ? String(peakHour).padStart(2, '0') + '시 ~ ' + String((peakHour + 1) % 24).padStart(2, '0') + '시'
      : '—');

    renderHourlyChart(hoursMap, peakVal);
    renderDailyChart(daysMap, today);
    renderPageRanking(Object.values(pagesMap), list.length);
    renderRecentVisits(list);
    renderScreenTable(Object.values(pagesMap), list.length);
  }

  function renderHourlyChart(hoursMap, maxVal) {
    const chartEl = el('admin-hourly-chart');
    if (!chartEl) return;

    if (maxVal === 0) {
      chartEl.innerHTML = emptyBox('아직 수집된 데이터가 없습니다.', '사용자가 화면을 방문하면 시간대별 분포가 여기에 표시됩니다.');
      return;
    }

    chartEl.innerHTML = hoursMap.map(function (cnt, h) {
      const pct = Math.max(4, Math.round((cnt / maxVal) * 100));
      const isPeak = cnt === maxVal && maxVal > 0;
      const isSelected = selectedExactHour === h;
      return `
        <div class="admin-hour-bar-wrap" title="${h}시: ${cnt}회 조회 (클릭하면 이 시간대만 필터링)">
          <span class="admin-hour-count">${cnt > 0 ? cnt : ''}</span>
          <div class="admin-hour-bar${isPeak ? ' is-peak' : ''}${isSelected ? ' is-selected' : ''}" data-hour="${h}" style="height:${pct}%;"></div>
          <span class="admin-hour-label">${h}</span>
        </div>`;
    }).join('');

    chartEl.querySelectorAll('.admin-hour-bar').forEach(function (bar) {
      bar.addEventListener('click', function () {
        const h = Number(bar.dataset.hour);
        selectedExactHour = (selectedExactHour === h) ? null : h;
        applyTrafficFilters();
      });
    });
  }

  function renderDailyChart(daysMap, today) {
    const node = el('admin-daily-chart');
    if (!node) return;

    const days = Object.keys(daysMap).sort().reverse().slice(0, 14);
    if (days.length === 0) {
      node.innerHTML = emptyBox('아직 일자별 누적 데이터가 없습니다.');
      return;
    }
    const maxVal = Math.max.apply(null, days.map(d => daysMap[d]).concat([1]));

    node.innerHTML = days.map(function (d) {
      const cnt = daysMap[d];
      const pct = Math.max(5, Math.round((cnt / maxVal) * 100));
      const isToday = d === today;
      return `
        <div class="admin-daily-row">
          <span class="admin-daily-date${isToday ? ' is-today' : ''}">
            ${d}${isToday ? '<span class="admin-today-tag">오늘</span>' : ''}
          </span>
          <div class="admin-daily-track">
            <div class="admin-daily-fill${isToday ? ' is-today' : ''}" style="width:${pct}%;"></div>
          </div>
          <span class="admin-daily-val">${num(cnt)}회</span>
        </div>`;
    }).join('');
  }

  function renderPageRanking(pages, totalInView) {
    const node = el('admin-page-ranking');
    if (!node) return;

    if (pages.length === 0) {
      node.innerHTML = emptyBox('아직 수집된 데이터가 없습니다.', '화면 방문 기록이 쌓이면 순위가 표시됩니다.');
      return;
    }

    pages.sort((a, b) => b.count - a.count);
    node.innerHTML = pages.slice(0, 10).map(function (p, idx) {
      const share = totalInView > 0 ? Math.round((p.count / totalInView) * 100) : 0;
      return `
        <div class="admin-page-rank-item">
          <span class="admin-rank-num">${idx + 1}</span>
          <div class="admin-rank-info">
            <div class="admin-rank-title">${escapeHtml(pageTitleOf(p.path, p.title))}</div>
            <div class="admin-rank-path">/${escapeHtml(p.path)}</div>
          </div>
          <div class="admin-rank-bar-bg" title="점유율 ${share}%">
            <div class="admin-rank-bar-fill" style="width:${share}%;"></div>
          </div>
          <span class="admin-rank-val">${num(p.count)}회 <small style="color:#64748b;font-weight:400;">(${share}%)</small></span>
        </div>`;
    }).join('');
  }

  function renderRecentVisits(list) {
    const node = el('admin-recent-visits');
    if (!node) return;

    if (list.length === 0) {
      node.innerHTML = emptyBox('최근 방문 내역이 없습니다.');
      return;
    }

    node.innerHTML = list.slice(0, 20).map(function (r) {
      const p = normalizePath(r.path);
      return `
        <div class="admin-feed-item">
          <div>
            <strong>${escapeHtml(pageTitleOf(p, r.page_title))}</strong>
            <span class="admin-feed-path">/${escapeHtml(p)}</span>
          </div>
          <span class="admin-feed-time">${escapeHtml(formatTimeAgo(r.created_at))}</span>
        </div>`;
    }).join('');
  }

  // 탭3: 화면별 상세 통계 표
  function renderScreenTable(pages, totalInView) {
    const tbody = el('admin-screen-tbody');
    if (!tbody) return;

    if (pages.length === 0) {
      tbody.innerHTML = emptyRow(5, '아직 수집된 데이터가 없습니다.', '사용자가 화면을 방문하면 여기에 집계됩니다.');
      setText('stat-screen-count', '0개');
      setText('stat-screen-users', '0명');
      return;
    }

    pages.sort((a, b) => b.count - a.count);
    const allUsers = {};
    pages.forEach(p => Object.keys(p.users).forEach(u => { allUsers[u] = 1; }));

    setText('stat-screen-count', num(pages.length) + '개');
    setText('stat-screen-users', num(Object.keys(allUsers).length) + '명');

    tbody.innerHTML = pages.map(function (p) {
      const share = totalInView > 0 ? Math.round((p.count / totalInView) * 100) : 0;
      return `
        <tr>
          <td><strong>${escapeHtml(pageTitleOf(p.path, p.title))}</strong></td>
          <td><code>/${escapeHtml(p.path)}</code></td>
          <td>${num(p.count)}회 <small style="color:#94a3b8;">(${share}%)</small></td>
          <td>${num(Object.keys(p.users).length)}명</td>
          <td><span title="${escapeHtml(p.last || '')}">${escapeHtml(formatTimeAgo(p.last))}</span></td>
        </tr>`;
    }).join('');
  }

  // ---------- 4-2. 회원 및 접속 현황 ----------
  async function loadMembersData() {
    if (!sb()) { renderMembersTable([]); return; }
    try {
      const { data, error } = await tbl('service_members')
        .select('*')
        .eq('service', SERVICE)
        .order('last_seen_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      cachedMembers = data || [];
      membersSource = 'service_members';
    } catch (e) {
      console.warn('[admin] service_members 조회 실패:', e.message || e);
      cachedMembers = [];
      membersSource = 'service_members';
    }
    renderMembersTable(cachedMembers);
  }

  function renderMembersTable(members) {
    const tbody = el('admin-members-tbody');

    // service_members 에 기록이 없는 서비스는 페이지뷰 로그의 로그인 사용자로 대체합니다.
    if (members.length === 0) {
      membersSource = 'logs';
      const byUser = {};
      cachedPageViews.forEach(function (r) {
        if (!r.user_id) return;
        if (!byUser[r.user_id]) byUser[r.user_id] = { user_id: r.user_id, views: 0, last: r.created_at, first: r.created_at };
        const b = byUser[r.user_id];
        b.views++;
        if (r.created_at > b.last) b.last = r.created_at;
        if (r.created_at < b.first) b.first = r.created_at;
      });
      const rows = Object.values(byUser).sort((a, b) => (a.last < b.last ? 1 : -1));

      const now = Date.now();
      let activeToday = 0, active7 = 0;
      rows.forEach(function (r) {
        const diff = now - new Date(r.last).getTime();
        if (diff <= 86400000) activeToday++;
        if (diff <= 7 * 86400000) active7++;
      });

      setText('stat-total-users', num(rows.length) + '명');
      setText('stat-active-today', num(activeToday) + '명');
      setText('stat-active-week', num(active7) + '명');

      const note = el('admin-members-note');
      if (note) {
        note.innerHTML = `
          <div class="admin-callout is-warn">
            <div class="admin-callout-icon"><i class="fa-solid fa-circle-info"></i></div>
            <div class="admin-callout-body">
              <h4>로그 기반 접속자 통계로 표시 중입니다</h4>
              <p>이 서비스는 <code>public.service_members</code> 에 가입 기록을 남기지 않습니다.
                 기존 로그인 로직을 바꾸지 않기 위해, 페이지뷰 로그에 남은 로그인 사용자(user_id)를 기준으로 집계했습니다.</p>
            </div>
          </div>`;
      }

      if (!tbody) return;
      if (rows.length === 0) {
        tbody.innerHTML = emptyRow(6, '아직 수집된 데이터가 없습니다.',
          '로그인한 사용자가 화면을 방문하면 여기에 표시됩니다. (비로그인 방문은 user_id 가 없어 집계되지 않습니다)');
        return;
      }

      tbody.innerHTML = rows.map(function (r) {
        return `
          <tr>
            <td><strong>로그인 사용자</strong></td>
            <td><code title="${escapeHtml(r.user_id)}">${escapeHtml(String(r.user_id).slice(0, 8))}…</code></td>
            <td><span class="admin-badge admin-badge-info">${num(r.views)}회 조회</span></td>
            <td><span class="admin-badge admin-badge-gray">로그 기반</span></td>
            <td><span title="${escapeHtml(r.first)}">${escapeHtml(formatTimeAgo(r.first))}</span></td>
            <td><span title="${escapeHtml(r.last)}">${escapeHtml(formatTimeAgo(r.last))}</span></td>
          </tr>`;
      }).join('');
      return;
    }

    // service_members 기반 (voca)
    const note = el('admin-members-note');
    if (note) note.innerHTML = '';

    const now = Date.now();
    let activeToday = 0, active7 = 0;
    members.forEach(function (m) {
      if (!m.last_seen_at) return;
      const diff = now - new Date(m.last_seen_at).getTime();
      if (diff <= 86400000) activeToday++;
      if (diff <= 7 * 86400000) active7++;
    });

    setText('stat-total-users', num(members.length) + '명');
    setText('stat-active-today', num(activeToday) + '명');
    setText('stat-active-week', num(active7) + '명');

    if (!tbody) return;
    tbody.innerHTML = members.map(function (m) {
      const isAdm = m.role === 'admin';
      const statusBadge = m.status === 'suspended'
        ? '<span class="admin-badge admin-badge-danger">정지됨</span>'
        : '<span class="admin-badge admin-badge-success">정상 활성</span>';
      const roleBadge = isAdm
        ? '<span class="admin-badge admin-badge-warning"><i class="fa-solid fa-crown"></i> 관리자</span>'
        : '<span class="admin-badge admin-badge-gray">일반회원</span>';
      return `
        <tr>
          <td><strong>${escapeHtml(m.nickname || '익명')}</strong>${isAdm ? ' 👑' : ''}</td>
          <td><code title="${escapeHtml(m.user_id)}">${escapeHtml(String(m.user_id || '').slice(0, 8))}…</code></td>
          <td>${statusBadge}</td>
          <td>${roleBadge}</td>
          <td><span title="${escapeHtml(m.joined_at || '')}">${escapeHtml(formatTimeAgo(m.joined_at))}</span></td>
          <td><span title="${escapeHtml(m.last_seen_at || '')}">${m.last_seen_at ? escapeHtml(formatTimeAgo(m.last_seen_at)) : '접속 기록 없음'}</span></td>
        </tr>`;
    }).join('');
  }

  const memberSearch = el('admin-member-search');
  if (memberSearch) {
    memberSearch.addEventListener('input', function (e) {
      const q = (e.target.value || '').toLowerCase().trim();
      if (membersSource !== 'service_members') return;   // 로그 기반 표에서는 검색 미적용
      const filtered = cachedMembers.filter(function (m) {
        return (m.nickname || '').toLowerCase().indexOf(q) !== -1 ||
               (m.user_id || '').toLowerCase().indexOf(q) !== -1;
      });
      // 검색 결과가 0건일 때 로그 폴백 표로 바뀌지 않도록 직접 렌더합니다.
      if (filtered.length === 0) {
        const tbody = el('admin-members-tbody');
        if (tbody) tbody.innerHTML = emptyRow(6, '검색 결과가 없습니다.', '“' + q + '” 와 일치하는 회원을 찾지 못했습니다.');
        return;
      }
      renderMembersTable(filtered);
    });
  }

  // ---------- 4-3. 학습/활동 로그 (서비스별 선택) ----------
  async function loadActivityData() {
    const kind = (CFG.activity && CFG.activity.kind) || 'none';
    if (kind === 'none' || !sb()) return;

    try {
      if (kind === 'quiz_attempts') {
        const { data, error } = await tbl('quiz_attempts')
          .select('*').order('answered_at', { ascending: false }).limit(200);
        if (error) throw error;
        cachedActivity = data || [];
        renderQuizAttempts(cachedActivity);
      }
    } catch (e) {
      console.warn('[admin] 활동 로그 조회 실패:', e.message || e);
      renderQuizAttempts([]);
    }
  }

  function renderQuizAttempts(rows) {
    const tbody = el('admin-activity-tbody');
    setText('stat-activity-count', num(rows.length) + '건');
    const correct = rows.filter(r => r.is_correct).length;
    setText('stat-activity-rate', rows.length ? Math.round((correct / rows.length) * 100) + '%' : '—');

    if (!tbody) return;
    if (rows.length === 0) {
      tbody.innerHTML = emptyRow(4, '아직 수집된 데이터가 없습니다.', '사용자가 퀴즈·시험을 풀면 여기에 기록됩니다.');
      return;
    }

    tbody.innerHTML = rows.slice(0, 100).map(function (r) {
      const src = r.source === 'exam'
        ? '<span class="admin-badge admin-badge-warning">모의고사</span>'
        : '<span class="admin-badge admin-badge-info">퀴즈</span>';
      const ok = r.is_correct
        ? '<span class="admin-badge admin-badge-success">정답</span>'
        : '<span class="admin-badge admin-badge-danger">오답</span>';
      return `
        <tr>
          <td><span title="${escapeHtml(r.answered_at || '')}">${escapeHtml(formatTimeAgo(r.answered_at))}</span></td>
          <td>${src}</td>
          <td><code>${escapeHtml(r.question_id)}</code></td>
          <td>${ok}</td>
        </tr>`;
    }).join('');
  }

  // ---------- 4-4. 콘텐츠 현황 & 검색기 ----------
  function loadContentSummary() {
    const content = CFG.content || {};

    // 콘텐츠 수치 카드 (admin.html 이 정의한 값을 그대로 반영)
    (content.stats || []).forEach(function (s) {
      let value = s.value;
      if (typeof s.compute === 'function') {
        try { value = s.compute(); } catch (e) { value = s.value; }
      }
      setText(s.id, value == null ? '—' : String(value));
    });

    const kind = content.searchKind || 'pages';
    const input = el('admin-content-query');
    const btn = el('admin-content-search-btn');
    const resultEl = el('admin-content-result');
    if (!input || !resultEl) return;
    if (input.dataset.bound === '1') return;   // 새로고침 시 중복 바인딩 방지
    input.dataset.bound = '1';

    function runSearch() {
      const q = (input.value || '').trim();
      if (!q) { resultEl.innerHTML = ''; return; }

      let items = [];
      if (kind === 'voca') items = searchVoca(q);
      else if (kind === 'mindtest') items = searchMindtest(q);
      else items = searchPages(q);

      if (items.length === 0) {
        resultEl.innerHTML = `
          <div class="admin-callout">
            <div class="admin-callout-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
            <div class="admin-callout-body">
              <h4>검색 결과가 없습니다</h4>
              <p>“${escapeHtml(q)}” 와 일치하는 항목을 찾지 못했습니다.</p>
            </div>
          </div>`;
        return;
      }

      resultEl.innerHTML = `
        <div class="admin-result-card">
          <div style="font-weight:900;margin-bottom:10px;">
            “${escapeHtml(q)}” 검색 결과 ${num(items.length)}건 <small style="color:#64748b;font-weight:400;">(최대 40건 표시)</small>
          </div>
          <ul class="admin-result-list">
            ${items.slice(0, 40).map(t => '<li>' + t + '</li>').join('')}
          </ul>
        </div>`;
    }

    if (btn) btn.addEventListener('click', runSearch);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(); });
  }

  // window.VOCA_DATA 는 { toeic:[...], toefl:[...], ... } 형태의 카테고리 묶음입니다.
  function vocaWords() {
    const data = window.VOCA_DATA;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    let out = [];
    Object.keys(data).forEach(function (k) {
      if (Array.isArray(data[k])) out = out.concat(data[k]);
    });
    return out;
  }

  function searchVoca(q) {
    const words = vocaWords();
    const lower = q.toLowerCase();
    return words.filter(function (w) {
      return String(w.word || '').toLowerCase().indexOf(lower) !== -1 ||
             String(w.meaning || '').indexOf(q) !== -1;
    }).map(function (w) {
      return `<strong>${escapeHtml(w.word)}</strong> — ${escapeHtml(w.meaning)} <small style="color:#94a3b8;">[${escapeHtml(w.cat || w.lang || '')}]</small>`;
    });
  }

  function searchMindtest(q) {
    const tests = window.MINDTEST_ALL_TESTS || [];
    const lower = q.toLowerCase();
    const out = [];
    tests.forEach(function (t) {
      if (!t) return;
      const title = t.title || t.id || '';
      if (String(title).toLowerCase().indexOf(lower) !== -1) {
        out.push(`<strong>${escapeHtml(title)}</strong> — 테스트 (문항 ${(t.questions || []).length}개)`);
      }
      (t.questions || []).forEach(function (qq, i) {
        const text = qq.q || qq.text || '';
        if (String(text).indexOf(q) !== -1) {
          out.push(`<strong>${escapeHtml(title)}</strong> ${i + 1}번 문항 — ${escapeHtml(String(text).slice(0, 60))}`);
        }
      });
      // 결과는 두 가지 형태가 있습니다: grades(점수형 배열) / results(유형형 객체)
      const resultList = Array.isArray(t.grades)
        ? t.grades
        : (t.results ? Object.keys(t.results).map(k => t.results[k]) : []);
      resultList.forEach(function (r) {
        const rt = (r && (r.title || r.name || r.label)) || '';
        if (String(rt).indexOf(q) !== -1) {
          out.push(`<strong>${escapeHtml(title)}</strong> 결과 — ${escapeHtml(rt)}`);
        }
      });
    });
    return out;
  }

  function searchPages(q) {
    const lower = q.toLowerCase();
    const seen = {};
    const out = [];
    cachedPageViews.forEach(function (r) {
      const p = normalizePath(r.path);
      if (seen[p]) return;
      const title = pageTitleOf(p, r.page_title);
      if (p.toLowerCase().indexOf(lower) === -1 && String(title).indexOf(q) === -1) return;
      seen[p] = 1;
      const count = cachedPageViews.filter(x => normalizePath(x.path) === p).length;
      out.push(`<strong>${escapeHtml(title)}</strong> <code>/${escapeHtml(p)}</code> — 최근 로그 ${num(count)}회`);
    });
    // 로그에 없더라도 설정된 화면 목록에서 이름으로 찾기
    const map = CFG.pageTitles || {};
    Object.keys(map).forEach(function (p) {
      if (seen[p]) return;
      if (p.toLowerCase().indexOf(lower) === -1 && String(map[p]).indexOf(q) === -1) return;
      seen[p] = 1;
      out.push(`<strong>${escapeHtml(map[p])}</strong> <code>/${escapeHtml(p)}</code> — <span style="color:#94a3b8;">아직 조회 로그 없음</span>`);
    });
    return out;
  }

  // ============================================================
  // 5. 초기 실행
  // ============================================================
  function boot() {
    renderServiceSwitcher();
    setupTabs();
    setupFilters();
    setupRefresh();
    setupCopySql();

    if (!sb()) {
      if (loadingView) loadingView.style.display = 'none';
      if (authView) authView.style.display = 'block';
      showMsg('Supabase 연결을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.', 'error');
      return;
    }

    // 기존 세션 복원 후 권한 판정
    sb().auth.getSession().then(function (res) {
      const user = (res && res.data && res.data.session && res.data.session.user) || null;
      applyAccessState(user);
    }, function () {
      applyAccessState(null);
    });

    // 로그인/로그아웃 상태 변화 추적
    sb().auth.onAuthStateChange(function (event, session) {
      applyAccessState((session && session.user) || null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
