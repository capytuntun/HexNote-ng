/* auth.js — login / register gate. Shows the app only once /api/me returns a user.
 *
 * This screen is convenience, not security: the server rejects every unauthenticated
 * API call regardless of what the browser chooses to display.
 */
(function (global) {
  'use strict';

  const $ = s => document.querySelector(s);
  let onReady = null;
  let currentUser = null;
  let registerMode = 'invite';

  function show(el, on) { el.hidden = !on; }

  function setError(msg) {
    const box = $('#auth-error');
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  function busy(on) {
    $('#auth-submit').disabled = on;
    $('#auth-submit').textContent = on ? '請稍候…' : (mode === 'login' ? '登入' : '建立帳號');
  }

  let mode = 'login';
  function setMode(m) {
    mode = m;
    setError('');
    $('#auth-title').textContent = m === 'login' ? '登入' : '建立帳號';
    $('#auth-submit').textContent = m === 'login' ? '登入' : '建立帳號';
    $('#auth-toggle').textContent = m === 'login' ? '還沒有帳號？建立一個' : '已經有帳號？前往登入';
    // The invite field only matters when registering on an invite-only site.
    show($('#auth-invite-row'), m === 'register' && registerMode === 'invite');
    show($('#auth-hint'), m === 'register');
  }

  function openGate() {
    show($('#auth-screen'), true);
    show($('#app'), false);
    setTimeout(function () { $('#auth-username').focus(); }, 30);
  }

  function enterApp(user) {
    currentUser = user;
    show($('#auth-screen'), false);
    show($('#app'), true);
    const who = $('#current-user');
    if (who) who.textContent = user.username;
    // Admin-only controls. The server checks the role on every admin call too —
    // hiding the button is only tidiness, not the boundary.
    const adminBtn = $('#admin-btn');
    if (adminBtn) adminBtn.hidden = user.role !== 'admin';

    // A generated password has been printed to a terminal log; make it be replaced
    // before the app is usable.
    if (user.mustChangePassword && global.Admin) {
      Admin.showChangePassword({
        forced: true,
        onDone: function () {
          currentUser.mustChangePassword = false;
          if (onReady) { const f = onReady; onReady = null; f(currentUser); }
        }
      });
      return;
    }
    if (onReady) { const f = onReady; onReady = null; f(user); }
  }

  function submit() {
    const u = $('#auth-username').value.trim();
    const p = $('#auth-password').value;
    const inv = $('#auth-invite').value.trim();
    if (!u || !p) { setError('請輸入帳號與密碼'); return; }
    busy(true);
    const call = mode === 'login' ? Store.login(u, p) : Store.register(u, p, inv);
    call.then(function (r) {
      busy(false);
      $('#auth-password').value = '';
      enterApp(r.user);
    }).catch(function (e) {
      busy(false);
      setError(e.message || '登入失敗');
      $('#auth-password').select();
    });
  }

  function logout() {
    Store.logout().catch(function () {}).then(function () {
      // Full reload so no other user's notes can linger in memory.
      location.reload();
    });
  }

  // Called by store.js when any request comes back 401.
  function onSessionLost() {
    if (!currentUser) return;
    currentUser = null;
    alert('登入已過期，請重新登入。');
    location.reload();
  }

  // Local, so this error path cannot itself depend on another module having loaded.
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Replaces the login form when the page is not being served by our backend.
  // Guessing wrong here is expensive, so say exactly what was observed and give
  // the two commands that fix it.
  function showBackendProblem(e) {
    const box = document.querySelector('.auth-box');
    const here = location.origin + '/';
    const wrong = !!e.wrongServer;
    box.innerHTML =
      '<div class="auth-logo">報告筆記系統</div>' +
      '<div class="auth-title">' + (wrong ? '這不是本系統的伺服器' : '伺服器沒有回應') + '</div>' +
      '<div class="backend-msg">' +
      (wrong
        ? '你正連到 <code>' + esc(here) + '</code>，它送得出網頁，但 ' +
          '<code>/api/me</code> 回應 <b>' + e.status + '</b>。<br><br>' +
          '這通常表示它是一個<b>只會發送檔案的靜態伺服器</b>' +
          '（例如 <code>python -m http.server</code>、IDE 的預覽功能），' +
          '不是本系統的後端——所以登入、筆記全都不會動。'
        : '<code>' + esc(here) + '</code> 沒有回應。後端可能沒有啟動。') +
      '</div>' +
      '<div class="backend-fix">' +
      '<div class="backend-step"><b>1. 啟動後端</b><pre>cd ' +
      'report_system\nnode server/server.js</pre></div>' +
      '<div class="backend-step"><b>2. 改用它提供的網址</b><pre>http://localhost:8080</pre></div>' +
      '</div>' +
      '<button type="button" class="btn btn-primary auth-submit backend-go">前往 localhost:8080</button>' +
      '<button type="button" class="link-btn auth-toggle backend-retry">重新檢查</button>';
    box.querySelector('.backend-go').addEventListener('click', function () {
      location.href = 'http://' + location.hostname + ':8080/';
    });
    box.querySelector('.backend-retry').addEventListener('click', function () { location.reload(); });
    show(document.querySelector('#auth-screen'), true);
    show(document.querySelector('#app'), false);
  }

  function init(cb) {
    onReady = cb;
    $('#auth-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    $('#auth-toggle').addEventListener('click', function () { setMode(mode === 'login' ? 'register' : 'login'); });
    // 帳號選單：點名稱開合，點選項或點外面則關閉
    const userBtn = $('#user-btn');
    const dropdown = $('#user-dropdown');
    function closeMenu() {
      if (dropdown) dropdown.hidden = true;
      if (userBtn) userBtn.setAttribute('aria-expanded', 'false');
    }
    function toggleMenu() {
      if (!dropdown) return;
      const open = dropdown.hidden;
      dropdown.hidden = !open;
      if (userBtn) userBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (userBtn) userBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
    if (dropdown) dropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    const out = $('#logout-btn');
    if (out) out.addEventListener('click', function () { closeMenu(); logout(); });
    const adminBtn = $('#admin-btn');
    if (adminBtn) adminBtn.addEventListener('click', function () { closeMenu(); Admin.showPanel(); });
    const pwBtn = $('#passwd-btn');
    if (pwBtn) pwBtn.addEventListener('click', function () { closeMenu(); Admin.showChangePassword({}); });

    Store.ready().then(function (r) {
      registerMode = r.registerMode || 'invite';
      setMode('login');
      if (r.user) enterApp(r.user);
      else openGate();
    }).catch(function (e) {
      showBackendProblem(e);
    });
  }

  global.Auth = {
    init: init,
    logout: logout,
    onSessionLost: onSessionLost,
    user: function () { return currentUser; }
  };
})(window);
