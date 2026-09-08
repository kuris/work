/* ============================================================
   직장인 업무도구 - 업무 메모 계정 동기화 (work-memo-sync.js)

   [이 파일이 하는 일]
     로그인하면 업무 메모가 계정(public.work_memos)에 보관되어
     회사 PC에서 적은 메모를 집이나 휴대폰에서도 그대로 볼 수 있습니다.

   [기존 코드를 거의 건드리지 않는 이유]
     memo.js 는 localStorage 만 쓰는 독립 모듈입니다.
     이 파일은 memo.js 가 저장하는 순간을 가로채 서버에도 함께 반영하고,
     로그인 시에는 서버 메모를 합친 뒤 memo.js 의 목록만 다시 그리게 합니다.
     → 비로그인 사용자에게는 서버 호출이 아예 일어나지 않습니다.

   의존성: cg-auth.js (window.CGAuth), memo.js (window.WorkMemo)
   ============================================================ */

(function () {
  'use strict';

  var KEY = 'work_memo_items';

  function CG() { return window.CGAuth || null; }
  function loggedIn() { return !!(CG() && CG().isLoggedIn()); }
  function warn(m, e) { try { console.warn('[메모 동기화] ' + m, e && (e.message || e)); } catch (_) {} }

  var rawSetItem = localStorage.setItem.bind(localStorage);
  function readLocal() {
    try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function writeLocalRaw(arr) {
    try { rawSetItem(KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function toRow(m) {
    return {
      local_id: String(m.id),
      title:    String(m.text || ''),
      done:     !!m.done
    };
  }

  function toLocal(r) {
    return {
      id:        isNaN(Number(r.local_id)) ? r.local_id : Number(r.local_id),
      text:      r.title || '',
      done:      !!r.done,
      createdAt: r.created_at || new Date().toISOString()
    };
  }

  // ---------- 서버 반영 (전체 맞춤) ----------
  var pushTimer = null;
  function schedulePush() {
    if (!loggedIn()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushAll, 700);
  }

  var pushing = false;
  async function pushAll() {
    if (!loggedIn() || pushing) return;
    pushing = true;
    try {
      var local = readLocal();
      var remote = await CG().listRecords('work_memos', { orderBy: 'updated_at', limit: 500 });

      var localIds = {};
      local.forEach(function (m) { localIds[String(m.id)] = true; });

      // 1) 기기에 있는 메모를 서버에 반영 (있으면 갱신, 없으면 추가)
      for (var i = 0; i < local.length; i++) {
        await CG().upsertRecord('work_memos', toRow(local[i]), 'user_id,local_id');
      }

      // 2) 기기에서 지운 메모는 서버에서도 지웁니다
      for (var j = 0; j < remote.length; j++) {
        var lid = String(remote[j].local_id);
        if (!localIds[lid]) await CG().deleteRecord('work_memos', { local_id: lid });
      }
    } catch (e) {
      warn('메모 저장 실패', e);
    } finally {
      pushing = false;
    }
  }

  // ---------- 로그인 시 서버 → 기기 병합 ----------
  var pulled = false;
  async function pullAndMerge() {
    if (!loggedIn() || pulled) return;
    pulled = true;
    try {
      var remote = await CG().listRecords('work_memos', { orderBy: 'created_at', limit: 500 });
      var local = readLocal();

      var have = {};
      local.forEach(function (m) { have[String(m.id)] = true; });

      var added = 0;
      remote.forEach(function (r) {
        if (have[String(r.local_id)]) return;
        local.push(toLocal(r));
        added++;
      });

      if (added > 0) {
        local.sort(function (a, b) {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
        writeLocalRaw(local);
        if (window.WorkMemo && window.WorkMemo.reload) window.WorkMemo.reload();
      }

      // 기기에만 있던 메모를 서버로 올립니다
      await pushAll();
    } catch (e) {
      warn('메모 불러오기 실패', e);
    }
  }

  // ---------- memo.js 의 저장을 가로챕니다 ----------
  try {
    localStorage.setItem = function (key, value) {
      rawSetItem(key, value);
      if (key === KEY && loggedIn()) {
        try { schedulePush(); } catch (e) { /* 저장 자체는 이미 끝났습니다 */ }
      }
    };
  } catch (e) {
    warn('동기화 후크 설치 실패 - 기기 저장만 사용합니다', e);
  }

  // ---------- 시작 ----------
  function start() {
    if (!CG()) return;
    CGAuth.onChange(function (s) {
      if (s.isLoggedIn) pullAndMerge();
      else pulled = false;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.WorkMemoSync = { pushAll: pushAll, pullAndMerge: pullAndMerge };
})();
