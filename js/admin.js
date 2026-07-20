/* admin.js — account administration (admins only) and the change-password screen.
 *
 * The panel shows accounts and permissions, never note contents: reading a
 * colleague's report still requires them to share it. The server enforces that
 * by simply not having an endpoint that returns anyone else's text.
 */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ---------------- change password ----------------
  // `forced` is used for the first login of a generated admin password: the app
  // stays hidden until it is replaced.
  function showChangePassword(opts) {
    const o = opts || {};
    const overlay = el('div', 'modal-overlay pw-overlay');
    const modal = el('div', 'modal pw-modal');
    modal.innerHTML =
      '<div class="modal-title">' + (o.forced ? '請先更改密碼' : '更改密碼') + '</div>' +
      (o.forced
        ? '<div class="pw-warn">這個帳號目前使用系統產生的預設密碼，而它已經被印在伺服器的終端機上。請立刻改成只有你知道的密碼。</div>'
        : '') +
      '<label class="auth-field"><span>目前的密碼</span>' +
      '<input class="pw-current" type="password" autocomplete="current-password"></label>' +
      '<label class="auth-field"><span>新密碼</span>' +
      '<input class="pw-next" type="password" autocomplete="new-password"></label>' +
      '<label class="auth-field"><span>再次輸入新密碼</span>' +
      '<input class="pw-again" type="password" autocomplete="new-password"></label>' +
      '<div class="auth-hint">至少 12 個字元。</div>' +
      '<div class="pw-error" hidden></div>' +
      '<div class="modal-actions">' +
      (o.forced ? '' : '<button class="btn pw-cancel" type="button">取消</button>') +
      '<button class="btn btn-primary pw-save" type="button">更改密碼</button>' +
      '</div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const errEl = modal.querySelector('.pw-error');
    const err = m => { errEl.textContent = m || ''; errEl.hidden = !m; };
    const save = modal.querySelector('.pw-save');

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !o.forced) { e.preventDefault(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    if (!o.forced) {
      modal.querySelector('.pw-cancel').addEventListener('click', close);
      overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    }

    save.addEventListener('click', function () {
      const cur = modal.querySelector('.pw-current').value;
      const next = modal.querySelector('.pw-next').value;
      const again = modal.querySelector('.pw-again').value;
      if (next !== again) return err('兩次輸入的新密碼不一致');
      if (next.length < 12) return err('新密碼至少需 12 個字元');
      save.disabled = true;
      Store.changePassword(cur, next).then(function () {
        close();
        if (o.onDone) o.onDone();
      }).catch(function (e) {
        save.disabled = false;
        err(e.message);
      });
    });
    setTimeout(() => modal.querySelector('.pw-current').focus(), 30);
  }

  // ---------------- admin panel ----------------
  function showPanel() {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal admin-modal');
    modal.innerHTML =
      '<div class="modal-title">👥 帳號管理</div>' +
      '<div class="admin-hint">管理員只看得到帳號與權限，<b>看不到任何人的筆記內容</b>——要讀同事的報告，仍然得請對方分享。</div>' +
      '<div class="admin-error" hidden></div>' +
      '<div class="admin-wrap"><table class="admin-table">' +
      '<thead><tr><th>帳號</th><th>權限</th><th>狀態</th><th class="num">筆記</th>' +
      '<th class="num">分享出</th><th class="num">收到</th><th>最後登入</th><th>動作</th></tr></thead>' +
      '<tbody></tbody></table></div>' +
      '<div class="modal-actions"><span class="admin-count"></span>' +
      '<button class="btn modal-cancel" type="button">關閉</button></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const tbody = modal.querySelector('tbody');
    const errEl = modal.querySelector('.admin-error');
    const err = m => { errEl.textContent = m || ''; errEl.hidden = !m; };

    function act(label, cls, fn) {
      const b = el('button', 'admin-act ' + (cls || ''), label);
      b.type = 'button';
      b.addEventListener('click', function () {
        b.disabled = true;
        err('');
        fn().then(refresh).catch(function (e) { b.disabled = false; err(e.message); });
      });
      return b;
    }

    function refresh() {
      return Store.adminListUsers().then(function (users) {
        tbody.innerHTML = '';
        users.forEach(function (u) {
          const tr = el('tr', u.disabled ? 'is-disabled' : '');
          const name = el('td');
          name.appendChild(el('span', 'admin-name', u.username));
          if (u.self) name.appendChild(el('span', 'admin-self', '（你）'));
          tr.appendChild(name);

          const role = el('td');
          role.appendChild(el('span', 'role-tag role-' + u.role, u.role === 'admin' ? '管理員' : '一般'));
          tr.appendChild(role);

          const st = el('td');
          st.appendChild(el('span', 'st-tag ' + (u.disabled ? 'st-off' : 'st-on'), u.disabled ? '已停用' : '啟用中'));
          tr.appendChild(st);

          tr.appendChild(el('td', 'num', String(u.notes)));
          tr.appendChild(el('td', 'num', String(u.sharedOut)));
          tr.appendChild(el('td', 'num', String(u.sharedIn)));
          tr.appendChild(el('td', 'admin-date', fmtDate(u.lastLogin)));

          const actions = el('td', 'admin-actions');
          if (!u.self) {
            actions.appendChild(act(u.disabled ? '啟用' : '停用', u.disabled ? '' : 'danger',
              () => Store.adminSetDisabled(u.id, !u.disabled)));
            actions.appendChild(act(u.role === 'admin' ? '取消管理員' : '設為管理員', '',
              () => Store.adminSetRole(u.id, u.role === 'admin' ? 'user' : 'admin')));
            actions.appendChild(act('刪除', 'danger', function () {
              return App.confirm({
                title: '刪除帳號',
                message: '確定刪除「' + u.username + '」？\n他的 ' + u.notes + ' 篇筆記、' +
                  u.folders + ' 個資料夾與 ' + u.images + ' 張圖片都會一併永久刪除。\n此動作無法復原。',
                ok: '刪除', danger: true
              }).then(function (yes) {
                if (!yes) return Promise.reject(new Error(''));
                return Store.adminDeleteUser(u.id);
              });
            }));
          } else {
            actions.appendChild(el('span', 'admin-nil', '—'));
          }
          tr.appendChild(actions);
          tbody.appendChild(tr);
        });
        modal.querySelector('.admin-count').textContent =
          '共 ' + users.length + ' 個帳號 · ' +
          users.filter(u => u.role === 'admin').length + ' 位管理員 · ' +
          users.filter(u => u.disabled).length + ' 個已停用';
      }).catch(function (e) {
        if (e.message) err(e.message);
      });
    }

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    modal.querySelector('.modal-cancel').addEventListener('click', close);
    refresh();
  }

  global.Admin = { showPanel: showPanel, showChangePassword: showChangePassword };
})(window);
