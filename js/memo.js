/**
 * 직장인 업무도구 (work.chatgpts.kr) - 업무 메모 & 체크리스트 모듈
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'work_memo_items';

  function getMemos() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveMemos(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      /* localStorage 차단 환경 */
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var memoInput = document.getElementById('memo-input');
    var memoAddBtn = document.getElementById('memo-add-btn');
    var memoList = document.getElementById('memo-list');
    var memoCountText = document.getElementById('memo-count-text');
    var memoClearDoneBtn = document.getElementById('memo-clear-done-btn');

    if (!memoInput || !memoList) return;

    var memos = getMemos();

    function render() {
      memoList.innerHTML = '';
      if (!memos.length) {
        memoList.innerHTML = '<div class="memo-empty">📝 등록된 업무 메모가 없습니다.<br>오늘 해야 할 중요한 일을 추가해 보세요!</div>';
        if (memoCountText) memoCountText.textContent = '0개 항목';
        return;
      }

      var completedCount = 0;

      memos.forEach(function (item, index) {
        if (item.done) completedCount++;

        var itemEl = document.createElement('div');
        itemEl.className = 'memo-item' + (item.done ? ' done' : '');
        itemEl.innerHTML = `
          <input type="checkbox" class="memo-checkbox" ${item.done ? 'checked' : ''} aria-label="완료 체크">
          <span class="memo-text">${escapeHtml(item.text)}</span>
          <button type="button" class="memo-delete-btn" aria-label="삭제"><i class="fa-solid fa-trash-can"></i></button>
        `;

        var chk = itemEl.querySelector('.memo-checkbox');
        chk.addEventListener('change', function () {
          memos[index].done = chk.checked;
          saveMemos(memos);
          render();
        });

        var delBtn = itemEl.querySelector('.memo-delete-btn');
        delBtn.addEventListener('click', function () {
          memos.splice(index, 1);
          saveMemos(memos);
          render();
        });

        memoList.appendChild(itemEl);
      });

      if (memoCountText) {
        memoCountText.textContent = `전체 ${memos.length}개 중 ${completedCount}개 완료`;
      }
    }

    function addMemo() {
      var text = memoInput.value.trim();
      if (!text) {
        memoInput.focus();
        return;
      }

      memos.unshift({
        id: Date.now(),
        text: text,
        done: false,
        createdAt: new Date().toISOString()
      });

      saveMemos(memos);
      memoInput.value = '';
      memoInput.focus();
      render();
    }

    memoAddBtn.addEventListener('click', addMemo);
    memoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        addMemo();
      }
    });

    if (memoClearDoneBtn) {
      memoClearDoneBtn.addEventListener('click', function () {
        memos = memos.filter(function (m) { return !m.done; });
        saveMemos(memos);
        render();
      });
    }

    render();

    // 계정 동기화 모듈(work-memo-sync.js)이 서버에서 메모를 받아온 뒤
    // 목록을 다시 그릴 수 있도록 최소한의 창구만 열어 둡니다.
    // (로그인하지 않으면 아무도 호출하지 않으므로 기존 동작과 동일합니다)
    window.WorkMemo = {
      reload: function () { memos = getMemos(); render(); },
      getAll: function () { return memos.slice(); }
    };
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
