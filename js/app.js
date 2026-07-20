/* app.js — UI orchestration: tree, editor, view modes, paste, export */
(function () {
  'use strict';

  const $ = function (sel) { return document.querySelector(sel); };
  const LS = {
    get: function (k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  const state = {
    folders: [],
    notes: [],
    currentId: null,
    mode: LS.get('mode', 'split'),
    expanded: {},
    current: null
  };

  try { state.expanded = JSON.parse(LS.get('expanded', '{}')) || {}; } catch (e) { state.expanded = {}; }

  // ---- Elements ----------------------------------------------------------
  const treeEl = $('#tree');
  const editorEl = $('#editor');
  const previewEl = $('#preview');
  const previewScrollEl = $('#preview-scroll');
  const tocEl = $('#preview-toc');
  const titleEl = $('#note-title');
  const panesEl = $('#panes');
  const emptyEl = $('#empty-state');
  const wrapEl = $('#editor-wrap');
  const statusInfo = $('#status-info');
  const statusSave = $('#status-save');
  const ctxMenu = $('#ctx-menu');
  const backlinksEl = $('#backlinks');
  const searchInput = $('#search-input');
  const searchResultsEl = $('#search-results');
  const searchClearEl = $('#search-clear');
  const shareBtn = $('#share-btn');
  const presenceEl = $('#presence');
  const editorAreaEl = $('#editor-area');
  const notePathEl = $('#note-path');

  // ---- Note links --------------------------------------------------------
  function normTitle(t) { return String(t || '').trim().toLowerCase(); }
  function findNoteByTitle(title) {
    const k = normTitle(title);
    return state.notes.filter(function (n) { return normTitle(n.title) === k; })[0] || null;
  }
  // markdown.js resolves [[…]] through this; editor.js autocompletes through it.
  MD.setNoteLookup(findNoteByTitle);
  if (window.Editor) Editor.setNoteProvider(function (query) {
    const q = normTitle(query);
    return state.notes
      .filter(function (n) { return n.id !== state.currentId && normTitle(n.title).indexOf(q) >= 0; })
      .sort(function (a, b) {
        // Prefix matches first, then most recently touched.
        const ap = normTitle(a.title).indexOf(q) === 0, bp = normTitle(b.title).indexOf(q) === 0;
        if (ap !== bp) return ap ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  });

  // ---- Init --------------------------------------------------------------
  function init() {
    applyTheme(LS.get('theme', 'light'));
    setMode(state.mode);
    setTocCollapsed(LS.get('tocCollapsed', '0') === '1');
    setSidebarCollapsed(LS.get('sidebarCollapsed', '0') === '1');
    bindEvents();
    // Nothing loads until the session is confirmed by the server.
    Auth.init(function (user) {
      loadData().then(function () {
        // Notes from before the server existed are stranded in IndexedDB — offer
        // to bring them across rather than silently leave them behind.
        if (window.Migrate) Migrate.maybeOffer(user, function () { loadData(); });
      }).catch(function (e) {
        alert('無法載入筆記：' + (e && e.message || e));
      });
    });
  }

  function loadData() {
    return Promise.all([Store.getFolders(), Store.getNotes()]).then(function (res) {
      state.folders = res[0];
      state.notes = res[1];
      renderTree();
      const last = LS.get('lastNote', null);
      if (last && state.notes.some(function (n) { return n.id === last; })) {
        openNote(last);
      } else {
        showEmpty();
      }
    });
  }

  // ---- Tree rendering ----------------------------------------------------
  function childFolders(parentId) {
    return state.folders
      .filter(function (f) { return (f.parentId || null) === parentId; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hant'); });
  }
  const isMine = n => !n.perm || n.perm === 'owner';
  function childNotes(folderId) {
    return state.notes
      .filter(function (n) { return isMine(n) && (n.folderId || null) === folderId; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }
  // Notes shared with me live in their owner's folder tree, not mine, so they get
  // their own section instead of being filed under a folder id I do not have.
  function sharedNotes() {
    return state.notes.filter(function (n) { return !isMine(n); })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function renderTree() {
    // Notes changed (created / deleted / renamed / moved), so any open result
    // list is now stale — recompute it against the current notes.
    if (search.query.trim()) runSearch(search.query);
    treeEl.innerHTML = '';
    treeEl.appendChild(buildLevel(null));
    if (!state.folders.length && !state.notes.length) {
      const hint = document.createElement('div');
      hint.className = 'tree-hint';
      hint.textContent = '尚無筆記，點上方「＋ 筆記」開始。';
      treeEl.appendChild(hint);
    }
    const shared = sharedNotes();
    if (shared.length) {
      const head = document.createElement('div');
      head.className = 'tree-section';
      head.textContent = '分享給我的（' + shared.length + '）';
      treeEl.appendChild(head);
      shared.forEach(function (n) { treeEl.appendChild(buildNoteRow(n)); });
    }
  }

  function buildLevel(parentId) {
    const frag = document.createDocumentFragment();
    childFolders(parentId).forEach(function (f) { frag.appendChild(buildFolder(f)); });
    childNotes(parentId).forEach(function (n) { frag.appendChild(buildNoteRow(n)); });
    return frag;
  }

  function buildFolder(folder) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-folder';
    const open = !!state.expanded[folder.id];

    const row = document.createElement('div');
    row.className = 'tree-row folder-row';
    row.draggable = true;
    row.dataset.type = 'folder';
    row.dataset.id = folder.id;
    row.innerHTML =
      '<span class="twisty">' + (open ? '▾' : '▸') + '</span>' +
      '<span class="ic">📁</span>' +
      '<span class="label">' + MD.escapeHtml(folder.name) + '</span>';

    // hover actions: add subfolder / add note inside this folder
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    const bFolder = document.createElement('button');
    bFolder.className = 'row-act'; bFolder.title = '新增子資料夾'; bFolder.textContent = '📁＋';
    const bNote = document.createElement('button');
    bNote.className = 'row-act'; bNote.title = '在此新增筆記'; bNote.textContent = '📄＋';
    bFolder.addEventListener('click', function (e) { e.stopPropagation(); newFolder(folder.id); });
    bNote.addEventListener('click', function (e) { e.stopPropagation(); newNote(folder.id); });
    actions.appendChild(bFolder);
    actions.appendChild(bNote);
    row.appendChild(actions);

    row.addEventListener('click', function () { toggleFolder(folder.id); });
    row.addEventListener('dblclick', function (e) { e.stopPropagation(); startRename('folder', folder.id); });
    row.addEventListener('contextmenu', function (e) { showCtx(e, 'folder', folder); });
    attachDrag(row, 'folder', folder.id);
    attachDrop(row, folder.id);
    wrap.appendChild(row);

    if (open) {
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      kids.appendChild(buildLevel(folder.id));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function buildNoteRow(note) {
    const row = document.createElement('div');
    const mine = isMine(note);
    row.className = 'tree-row note-row' + (note.id === state.currentId ? ' active' : '') +
      (mine ? '' : ' shared-row');
    row.draggable = mine;   // dragging a shared note into my folders would do nothing
    row.dataset.type = 'note';
    row.dataset.id = note.id;
    row.innerHTML =
      '<span class="ic">' + (mine ? '📄' : (note.perm === 'edit' ? '✍' : '🔒')) + '</span>' +
      '<span class="label">' + MD.escapeHtml(note.title || '未命名筆記') + '</span>' +
      (mine ? '' : '<span class="share-by">' + MD.escapeHtml(note.sharedBy || '') + '</span>');
    row.addEventListener('click', function () { openNote(note.id); });
    row.addEventListener('contextmenu', function (e) { showCtx(e, 'note', note); });
    attachDrag(row, 'note', note.id);
    return row;
  }

  function toggleFolder(id) {
    state.expanded[id] = !state.expanded[id];
    LS.set('expanded', JSON.stringify(state.expanded));
    renderTree();
  }

  // ---- Drag & drop (move items between folders) --------------------------
  let dragData = null;
  function attachDrag(el, type, id) {
    el.addEventListener('dragstart', function (e) {
      dragData = { type: type, id: id };
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });
    el.addEventListener('dragend', function () { dragData = null; clearDropHints(); });
  }
  function attachDrop(el, folderId) {
    el.addEventListener('dragover', function (e) {
      if (!dragData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-target');
      moveItem(dragData, folderId);
    });
  }
  function clearDropHints() {
    document.querySelectorAll('.drop-target').forEach(function (n) { n.classList.remove('drop-target'); });
  }

  function isDescendant(folderId, maybeAncestorId) {
    // true if folderId is the same as, or nested inside, maybeAncestorId
    let cur = folderId;
    while (cur) {
      if (cur === maybeAncestorId) return true;
      const f = state.folders.find(function (x) { return x.id === cur; });
      cur = f ? f.parentId : null;
    }
    return false;
  }

  function moveItem(data, targetFolderId) {
    if (!data) return;
    if (data.type === 'note') {
      const n = state.notes.find(function (x) { return x.id === data.id; });
      if (n && (n.folderId || null) !== (targetFolderId || null)) {
        n.folderId = targetFolderId || null;
        Store.updateNote(n).then(renderTree);
      }
    } else if (data.type === 'folder') {
      if (data.id === targetFolderId || isDescendant(targetFolderId, data.id)) return; // no cycles
      const f = state.folders.find(function (x) { return x.id === data.id; });
      if (f && (f.parentId || null) !== (targetFolderId || null)) {
        f.parentId = targetFolderId || null;
        Store.updateFolder(f).then(renderTree);
      }
    }
  }

  // Allow dropping onto empty tree area => move to root
  treeEl.addEventListener('dragover', function (e) { if (dragData) { e.preventDefault(); } });
  treeEl.addEventListener('drop', function (e) {
    if (dragData && e.target === treeEl) { e.preventDefault(); moveItem(dragData, null); }
  });

  // ---- Note open / editor ------------------------------------------------
  const secWrapEl = $('#sec-wrap');
  const perfWrapEl = $('#perf-wrap');
  // 切換頂列的「筆記模式」：開一般筆記時顯示標題與編輯按鈕，回首頁時只留 logo + 帳號。
  function noteBar(on) {
    const app = document.getElementById('app');
    if (app) app.classList.toggle('note-open', !!on);
  }

  // 資料夾路徑前綴：往上層走到根，組成「a\b\」（無資料夾時回空字串）。
  function folderPathPrefix(folderId) {
    const parts = [];
    let cur = folderId || null, guard = 0;
    while (cur && guard++ < 50) {
      const f = state.folders.find(function (x) { return x.id === cur; });
      if (!f) break;
      parts.unshift(f.name || '');
      cur = f.parentId || null;
    }
    return parts.length ? parts.join('\\') + '\\' : '';
  }
  function updateNotePath(note) {
    if (notePathEl) notePathEl.textContent = note ? folderPathPrefix(note.folderId) : '';
  }

  function showEmpty() {
    closeStream();
    noteBar(false);
    if (notePathEl) notePathEl.textContent = '';
    state.currentId = null; state.current = null;
    emptyEl.hidden = false;
    wrapEl.hidden = true;
    if (secWrapEl) secWrapEl.hidden = true;
    if (perfWrapEl) perfWrapEl.hidden = true;
    if (window.Dashboard) {
      Dashboard.render({ notes: state.notes, folders: state.folders, onOpen: openNote });
    }
  }

  // 回到首頁：先存好目前這篇，再顯示儀表板
  function goHome() {
    saveNow();
    LS.set('lastNote', '');
    showEmpty();
    renderTree();
  }

  // 點擊 #標籤：回到首頁並列出帶有該標籤的所有筆記
  function browseTag(tag) {
    if (!tag) return;
    saveNow();
    LS.set('lastNote', '');
    showEmpty();
    renderTree();
    if (window.Dashboard && Dashboard.setTag) Dashboard.setTag(tag);
  }

  // A note shared read-only must not look editable. The server would reject the
  // write anyway; this stops you wasting effort typing into a note you can't save.
  function applyReadOnly(note) {
    const ro = note.perm === 'read';
    editorEl.readOnly = ro;
    titleEl.readOnly = ro;
    wrapEl.classList.toggle('read-only', ro);
    let banner = document.getElementById('ro-banner');
    if (ro) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'ro-banner';
        banner.className = 'ro-banner';
        wrapEl.insertBefore(banner, wrapEl.firstChild);
      }
      banner.textContent = '🔒 唯讀 — 由 ' + (note.sharedBy || '其他使用者') + ' 分享給你';
      banner.hidden = false;
    } else if (banner) {
      banner.hidden = true;
    }
  }

  function openNote(id) {
    closeStream();   // stop listening to the note we're leaving
    Store.getNote(id).then(function (note) {
      if (!note) { showEmpty(); return; }
      state.currentId = id;
      state.current = note;
      // Seed the collaboration baseline: this is the version we're now in sync with.
      note._syncRev = note.rev || 0;
      note._syncContent = note.content || '';
      LS.set('lastNote', id);
      emptyEl.hidden = true;

      // 儲存後同步樹狀標題 / 記憶體中的筆記（給步驟式與表格式編輯器共用）。
      const onSaved = function (n) {
        const idx = state.notes.findIndex(function (x) { return x.id === n.id; });
        if (idx >= 0) { state.notes[idx].title = n.title; state.notes[idx].content = n.content; }
        const row = treeEl.querySelector('.note-row[data-id="' + n.id + '"] .label');
        if (row) row.textContent = n.title || '未命名筆記';
      };

      // 資安院筆記：右側整個是步驟式編輯器，沒有 md 編輯器。
      if (window.SecEditor && SecEditor.isSecNote(note)) {
        noteBar(false);   // 步驟式編輯器有自己的工具列，頂列只留 logo + 帳號
        wrapEl.hidden = true;
        if (perfWrapEl) perfWrapEl.hidden = true;
        secWrapEl.hidden = false;
        SecEditor.open(note, { onSaved: onSaved });
        renderTree();
        return;
      }

      // 成效報告筆記：右側整個是表格式編輯器。
      if (window.PerfReport && PerfReport.isPerfNote(note)) {
        noteBar(false);
        wrapEl.hidden = true;
        if (secWrapEl) secWrapEl.hidden = true;
        perfWrapEl.hidden = false;
        PerfReport.open(note, { onSaved: onSaved });
        renderTree();
        return;
      }

      noteBar(true);      // 一般 md 筆記：標題與編輯按鈕併入頂列 bar
      if (secWrapEl) secWrapEl.hidden = true;
      if (perfWrapEl) perfWrapEl.hidden = true;
      wrapEl.hidden = false;
      titleEl.value = note.title || '';
      editorEl.value = note.content || '';
      applyReadOnly(note);
      updateNotePath(note);   // 標題前綴顯示所在資料夾（如 pp\）
      // Only the owner may (re)share; recipients just see the collaborators.
      if (shareBtn) shareBtn.hidden = !isMine(note);
      if (editorEl._hlRefresh) editorEl._hlRefresh();
      renderPreview();
      updateStatus();
      renderTree();
      startStream(note);   // go live: receive others' edits + presence
      if (note.perm !== 'read') editorEl.focus();
    }).catch(function () { showEmpty(); });
  }

  let previewTimer = null;
  function renderPreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreviewNow, 120);
  }
  function renderPreviewNow() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    previewEl.innerHTML = MD.render(editorEl.value);
    MD.resolveImages(previewEl);
    buildPreviewTOC();
    renderBacklinks();
  }

  // ---- Backlinks ---------------------------------------------------------
  // Which other notes point at the open one — the other half of a two-way link.
  function renderBacklinks() {
    if (!backlinksEl) return;
    backlinksEl.innerHTML = '';
    if (!state.current) { backlinksEl.hidden = true; return; }
    const target = normTitle(titleEl.value || state.current.title);
    const refs = state.notes.filter(function (n) {
      if (n.id === state.currentId) return false;
      return MD.extractLinks(n.content).some(function (t) { return normTitle(t) === target; });
    });
    if (!refs.length) { backlinksEl.hidden = true; return; }
    backlinksEl.hidden = false;
    const head = document.createElement('div');
    head.className = 'backlinks-title';
    head.textContent = '🔗 反向連結（' + refs.length + '）';
    backlinksEl.appendChild(head);
    refs.forEach(function (n) {
      const a = document.createElement('button');
      a.className = 'backlink';
      a.textContent = n.title || '未命名筆記';
      a.addEventListener('click', function () { saveNow(); openNote(n.id); });
      backlinksEl.appendChild(a);
    });
  }

  // Follow a [[link]] from the preview; unresolved ones create the note first.
  function handleNoteLink(a) {
    const id = a.getAttribute('data-note-id');
    if (id) { saveNow(); openNote(id); return; }
    const title = a.getAttribute('data-note-title');
    if (!title) return;
    saveNow();
    Store.createNote(title, state.current ? state.current.folderId : null).then(function (n) {
      state.notes.push(n);
      renderTree();
      openNote(n.id);
    });
  }

  // ---- Preview table of contents ----------------------------------------
  function setTocCollapsed(v) {
    const pane = document.querySelector('.pane-preview');
    if (pane) pane.classList.toggle('toc-hidden', !!v);
    LS.set('tocCollapsed', v ? '1' : '0');
  }
  function buildPreviewTOC() {
    if (!tocEl) return;
    const pane = document.querySelector('.pane-preview');
    const heads = previewEl.querySelectorAll('h1, h2, h3');
    tocEl.innerHTML = '';
    if (!heads.length) { if (pane) pane.classList.add('no-toc'); return; }
    if (pane) pane.classList.remove('no-toc');
    const title = document.createElement('div');
    title.className = 'toc-title';
    const label = document.createElement('span');
    label.textContent = '目錄';
    const collapse = document.createElement('button');
    collapse.className = 'toc-collapse';
    collapse.title = '收合目錄';
    collapse.textContent = '«';
    collapse.addEventListener('click', function () { setTocCollapsed(true); });
    title.appendChild(label);
    title.appendChild(collapse);
    tocEl.appendChild(title);
    heads.forEach(function (h) {
      const a = document.createElement('a');
      a.className = 'toc-' + h.tagName.toLowerCase();
      a.textContent = h.textContent;
      a.href = '#';
      a._target = h;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      tocEl.appendChild(a);
    });
    updateTocActive();
  }
  function updateTocActive() {
    if (!tocEl || !previewScrollEl) return;
    const links = tocEl.querySelectorAll('a');
    if (!links.length) return;
    const containerTop = previewScrollEl.getBoundingClientRect().top;
    let active = links[0];
    links.forEach(function (a) {
      if (a._target && a._target.getBoundingClientRect().top - containerTop <= 40) active = a;
    });
    links.forEach(function (a) { a.classList.toggle('active', a === active); });
  }

  // ---- Live collaboration (Server-Sent Events) --------------------------
  // A note carries two extra fields while open: `_syncRev` / `_syncContent` —
  // the revision and exact text this client last agreed with the server on. They
  // are the common ancestor every merge is measured against.
  let noteStream = null;   // closer fn for the current note's event stream

  function closeStream() {
    if (noteStream) { noteStream(); noteStream = null; }
    renderPresence([]);
    clearRemoteCarets();
    lastSentPos = -1;
  }

  // Map a caret offset from the pre-merge text onto the merged text, keeping the
  // caret put when the edit landed elsewhere. Best-effort: exact within an
  // unchanged prefix/suffix, otherwise anchored at the start of the change.
  function mapCaret(oldV, newV, caret) {
    const max = Math.min(oldV.length, newV.length);
    let p = 0;
    while (p < max && oldV[p] === newV[p]) p++;
    if (caret <= p) return caret;
    let s = 0;
    while (s < max - p && oldV[oldV.length - 1 - s] === newV[newV.length - 1 - s]) s++;
    if (caret >= oldV.length - s) return caret + (newV.length - oldV.length);
    return Math.min(newV.length - s, p);
  }

  function applyMergedToEditor(merged) {
    const oldV = editorEl.value;
    if (merged === oldV) return;
    const focused = document.activeElement === editorEl;
    const caret = editorEl.selectionStart;
    const scroll = editorEl.scrollTop;
    editorEl.value = merged;
    if (focused) {
      const c = mapCaret(oldV, merged, caret);
      try { editorEl.selectionStart = editorEl.selectionEnd = c; } catch (e) {}
    }
    editorEl.scrollTop = scroll;
    if (editorEl._hlRefresh) editorEl._hlRefresh();
    scheduleCaretRender();
  }

  // Reconcile an authoritative server version (from an SSE push or a save reply)
  // with whatever is in the editor right now. Non-conflicting local edits survive.
  function applyRemoteUpdate(payload) {
    const cur = state.current;
    if (!cur || !payload || payload.rev == null) return;
    if (payload.rev <= (cur._syncRev || 0)) return;    // our own echo, or stale

    const base = cur._syncContent || '';
    const theirs = String(payload.content || '');
    const merged = (window.Merge ? Merge.merge3(base, editorEl.value, theirs) : theirs);

    cur._syncRev = payload.rev;
    cur._syncContent = theirs;          // the server's text is the new ancestor

    if (merged !== editorEl.value) {
      applyMergedToEditor(merged);
      cur.content = merged;
      const idx = state.notes.findIndex(function (n) { return n.id === cur.id; });
      if (idx >= 0) state.notes[idx].content = merged;
      renderPreview();
      updateStatus();
      // If we merged in local edits the server hasn't seen, push them back.
      if (merged !== theirs && cur.perm !== 'read') scheduleSave();
    } else {
      cur.content = merged;
    }

    // Adopt a remote title change unless the user is busy renaming.
    if (payload.title != null && document.activeElement !== titleEl && payload.title !== titleEl.value) {
      titleEl.value = payload.title;
      cur.title = payload.title;
      updateTitleInTree();
    }
  }

  // Render the avatars of other people viewing this note (self excluded).
  function renderPresence(users) {
    if (!presenceEl) return;
    const me = (window.Auth && Auth.user && Auth.user()) ? Auth.user().username : null;
    const others = (users || []).filter(function (u) { return u !== me; });
    presenceEl.innerHTML = '';
    others.slice(0, 5).forEach(function (u) {
      const dot = document.createElement('span');
      dot.className = 'presence-dot';
      dot.textContent = (u || '?').charAt(0).toUpperCase();
      dot.title = u + '  正在編輯';
      dot.style.background = presenceColor(u);
      presenceEl.appendChild(dot);
    });
    if (others.length > 5) {
      const more = document.createElement('span');
      more.className = 'presence-more';
      more.textContent = '+' + (others.length - 5);
      presenceEl.appendChild(more);
    }
    presenceEl.classList.toggle('has-people', others.length > 0);
  }
  // Stable per-name colour so the same collaborator keeps the same avatar hue.
  function presenceColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 55%, 45%)';
  }

  // ---- Remote carets -----------------------------------------------------
  // Show every other editor's caret (a coloured line with their name) inside the
  // markdown textarea. Positions are measured with a hidden mirror div that copies
  // the textarea's exact text metrics, then offset by the current scroll.
  const remoteCarets = {};     // username -> { pos, el }
  let caretMirror = null;
  let caretRAF = null;

  function ensureMirror() {
    if (caretMirror || !editorAreaEl) return caretMirror;
    caretMirror = document.createElement('div');
    caretMirror.className = 'caret-mirror';
    caretMirror.setAttribute('aria-hidden', 'true');
    editorAreaEl.appendChild(caretMirror);
    return caretMirror;
  }

  // Copy the metrics that decide where text wraps, so the mirror lays out
  // identically to the textarea. --sbw matches the reserved scrollbar gutter.
  function syncMirrorStyle() {
    if (!caretMirror) return;
    const cs = getComputedStyle(editorEl);
    const sbw = (editorEl.offsetWidth - editorEl.clientWidth) || 0;
    const st = caretMirror.style;
    // Copy longhands (the `font` shorthand reads back empty in most browsers).
    st.fontFamily = cs.fontFamily;
    st.fontSize = cs.fontSize;
    st.fontWeight = cs.fontWeight;
    st.fontStyle = cs.fontStyle;
    st.lineHeight = cs.lineHeight;
    st.letterSpacing = cs.letterSpacing;
    st.tabSize = cs.tabSize;
    st.paddingTop = cs.paddingTop;
    st.paddingBottom = cs.paddingBottom;
    st.paddingLeft = cs.paddingLeft;
    st.paddingRight = (parseFloat(cs.paddingRight) + sbw) + 'px';
  }

  // Pixel position (relative to #editor-area, scroll already applied) of a caret
  // offset in the textarea. Returns null if it cannot be measured.
  function measureCaret(pos) {
    if (!ensureMirror()) return null;
    syncMirrorStyle();
    const v = editorEl.value;
    pos = Math.max(0, Math.min(pos, v.length));
    caretMirror.textContent = v.slice(0, pos);
    const marker = document.createElement('span');
    marker.textContent = '​';
    caretMirror.appendChild(marker);
    const x = marker.offsetLeft;
    const y = marker.offsetTop - editorEl.scrollTop;
    caretMirror.removeChild(marker);
    return { x: x, y: y };
  }

  function caretLineHeight() {
    const lh = parseFloat(getComputedStyle(editorEl).lineHeight);
    return isFinite(lh) ? lh : 24;
  }

  function renderRemoteCarets() {
    caretRAF = null;
    if (wrapEl.hidden) return;               // markdown editor not on screen
    const h = caretLineHeight();
    const areaH = editorAreaEl ? editorAreaEl.clientHeight : 0;
    Object.keys(remoteCarets).forEach(function (name) {
      const rc = remoteCarets[name];
      const p = measureCaret(rc.pos);
      if (!p) { rc.el.style.display = 'none'; return; }
      // Hide when scrolled out of view (with a little slack for the label).
      if (p.y < -h || p.y > areaH + h) { rc.el.style.display = 'none'; return; }
      rc.el.style.display = 'block';
      rc.el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      rc.el.style.height = h + 'px';
      // Flip the name tag below the caret when it would be clipped at the top.
      rc.el.classList.toggle('label-below', p.y < 18);
    });
  }
  function scheduleCaretRender() {
    if (caretRAF == null) caretRAF = requestAnimationFrame(renderRemoteCarets);
  }

  function onRemoteCursor(payload) {
    if (!payload || !payload.by) return;
    const me = (window.Auth && Auth.user && Auth.user()) ? Auth.user().username : null;
    if (payload.by === me) return;           // never draw my own caret
    let rc = remoteCarets[payload.by];
    if (!rc) {
      const el = document.createElement('div');
      el.className = 'remote-caret';
      el.style.setProperty('--caret-color', presenceColor(payload.by));
      const label = document.createElement('span');
      label.className = 'remote-caret-label';
      label.textContent = payload.by;
      el.appendChild(label);
      if (editorAreaEl) editorAreaEl.appendChild(el);
      rc = remoteCarets[payload.by] = { pos: 0, el: el };
    }
    rc.pos = payload.pos || 0;
    scheduleCaretRender();
  }

  function removeRemoteCaret(name) {
    const rc = remoteCarets[name];
    if (!rc) return;
    if (rc.el && rc.el.parentNode) rc.el.parentNode.removeChild(rc.el);
    delete remoteCarets[name];
  }
  function clearRemoteCarets() {
    Object.keys(remoteCarets).forEach(removeRemoteCaret);
  }
  // Drop carets for anyone who has left (per the presence list).
  function pruneRemoteCarets(users) {
    const me = (window.Auth && Auth.user && Auth.user()) ? Auth.user().username : null;
    const live = {};
    (users || []).forEach(function (u) { if (u !== me) live[u] = true; });
    Object.keys(remoteCarets).forEach(function (name) { if (!live[name]) removeRemoteCaret(name); });
  }

  // Broadcast my own caret, throttled so a burst of keystrokes sends at most ~1/120ms.
  let cursorTimer = null, cursorPending = false, lastSentPos = -1;
  function sendMyCursor() {
    if (!state.current || !noteStream) return;
    const pos = editorEl.selectionStart;
    if (pos === lastSentPos) return;
    lastSentPos = pos;
    if (Store.sendCursor) Store.sendCursor(state.current.id, pos, editorEl.selectionEnd).catch(function () {});
  }
  // Force-send my caret (used when someone joins, so a newcomer sees me even if
  // I'm not currently moving — the caret is transient and otherwise never resent).
  function announceCursor() {
    if (!state.current || !noteStream || !Store.sendCursor) return;
    lastSentPos = -1;
    Store.sendCursor(state.current.id, editorEl.selectionStart, editorEl.selectionEnd).catch(function () {});
  }
  function scheduleSendCursor() {
    if (!noteStream) return;
    if (cursorTimer) { cursorPending = true; return; }
    sendMyCursor();
    cursorTimer = setTimeout(function () {
      cursorTimer = null;
      if (cursorPending) { cursorPending = false; sendMyCursor(); }
    }, 120);
  }

  // Open the live stream for the note now showing in the markdown editor.
  function startStream(note) {
    closeStream();
    if (!note || !Store.openNoteStream) return;
    lastSentPos = -1;
    noteStream = Store.openNoteStream(note.id, {
      onUpdate: function (payload) { if (state.current && state.current.id === note.id) applyRemoteUpdate(payload); },
      onPresence: function (users) {
        if (state.current && state.current.id !== note.id) return;
        renderPresence(users);
        pruneRemoteCarets(users);
        // Someone joined/left → re-announce my caret so newcomers see me right away.
        announceCursor();
      },
      onCursor: function (payload) { if (state.current && state.current.id === note.id) onRemoteCursor(payload); }
    });
  }

  let saveTimer = null;
  function scheduleSave() {
    if (state.current && state.current.perm === 'read') return;
    statusSave.textContent = '編輯中…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    if (!state.current || state.current.perm === 'read') return;
    state.current.title = titleEl.value || '未命名筆記';
    state.current.content = editorEl.value;
    // Tell the server which revision this edit is based on, so it can merge in
    // anyone else's concurrent changes rather than clobbering them.
    state.current.baseRev = state.current._syncRev || 0;
    state.current.baseContent = state.current._syncContent || '';
    // Keep the in-memory list in step immediately — link resolution, backlinks
    // and search all read from it and must not see a stale copy.
    const idx = state.notes.findIndex(function (n) { return n.id === state.current.id; });
    if (idx >= 0) state.notes[idx] = state.current;
    Store.updateNote(state.current).then(function (saved) {
      statusSave.textContent = '已儲存 ✓';
      // The reply is authoritative and may carry a merge of someone else's edit.
      applyRemoteUpdate({ rev: saved.rev, content: saved.content, title: saved.title });
      updateTitleInTree();
      updateStatus();
    }).catch(function (e) {
      statusSave.textContent = '⚠ 未儲存：' + (e && e.message || e);
    });
  }
  function updateTitleInTree() {
    const row = treeEl.querySelector('.note-row[data-id="' + state.currentId + '"] .label');
    if (row) row.textContent = state.current.title || '未命名筆記';
  }

  function updateStatus() {
    const text = editorEl.value || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    statusInfo.textContent = text.length + ' 字元 · ' + words + ' 詞';
  }

  // ---- 彩蛋：打字時，標題旁的小水豚會跳舞，停手約 1.4 秒後坐下 ----------
  let capyTimer = null;
  function danceCapybara() {
    const capy = $('#capybara');
    if (!capy) return;
    capy.classList.add('dancing');
    if (capyTimer) clearTimeout(capyTimer);
    capyTimer = setTimeout(function () { capy.classList.remove('dancing'); }, 1400);
  }

  // ---- View modes --------------------------------------------------------
  function setMode(mode) {
    state.mode = mode;
    LS.set('mode', mode);
    panesEl.classList.remove('mode-split', 'mode-edit', 'mode-preview');
    panesEl.classList.add('mode-' + mode);
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (mode === 'preview') renderPreview();
  }

  // ---- Paste image -------------------------------------------------------
  function handlePaste(e) {
    const items = (e.clipboardData || {}).items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.indexOf('image/') === 0) {
        e.preventDefault();
        const blob = it.getAsFile();
        Store.putImage(blob).then(function (id) {
          insertAtCursor('\n![貼上的圖片](img:' + id + ')\n');
          if (editorEl._hlRefresh) editorEl._hlRefresh();
          scheduleSave();
          renderPreviewNow();
        });
        return;
      }
    }
  }

  function insertAtCursor(text) {
    const start = editorEl.selectionStart, end = editorEl.selectionEnd;
    const v = editorEl.value;
    editorEl.value = v.slice(0, start) + text + v.slice(end);
    const pos = start + text.length;
    editorEl.selectionStart = editorEl.selectionEnd = pos;
    updateStatus();
  }

  // ---- Formatting toolbar ------------------------------------------------
  function getSel() {
    return { s: editorEl.selectionStart, e: editorEl.selectionEnd, v: editorEl.value };
  }
  function setRange(newValue, selStart, selEnd) {
    editorEl.value = newValue;
    editorEl.selectionStart = selStart;
    editorEl.selectionEnd = (selEnd == null ? selStart : selEnd);
    editorEl.focus();
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function insertAround(before, after, placeholder) {
    const g = getSel();
    const sel = g.v.slice(g.s, g.e);
    const mid = sel || placeholder || '';
    const nv = g.v.slice(0, g.s) + before + mid + after + g.v.slice(g.e);
    const start = g.s + before.length;
    setRange(nv, start, start + mid.length);
  }
  function insertBlockAround(before, after, placeholder) {
    const g = getSel();
    const pad0 = (g.s > 0 && g.v[g.s - 1] !== '\n') ? '\n' : '';
    const pad1 = (g.e < g.v.length && g.v[g.e] !== '\n') ? '\n' : '';
    const b = pad0 + before, a = after + pad1;
    const sel = g.v.slice(g.s, g.e);
    const mid = sel || placeholder || '';
    const nv = g.v.slice(0, g.s) + b + mid + a + g.v.slice(g.e);
    const start = g.s + b.length;
    setRange(nv, start, start + mid.length);
  }
  function setLinePrefix(prefix, ordered) {
    const g = getSel();
    const lineStart = g.v.lastIndexOf('\n', g.s - 1) + 1;
    let lineEnd = g.v.indexOf('\n', g.e);
    if (lineEnd < 0) lineEnd = g.v.length;
    const block = g.v.slice(lineStart, lineEnd);
    const newBlock = block.split('\n').map(function (l, i) {
      return (ordered ? (i + 1) + '. ' : prefix) + l;
    }).join('\n');
    const nv = g.v.slice(0, lineStart) + newBlock + g.v.slice(lineEnd);
    setRange(nv, lineStart, lineStart + newBlock.length);
  }
  function applyFormat(fmt) {
    switch (fmt) {
      case 'bold': return insertAround('**', '**', '粗體');
      case 'italic': return insertAround('*', '*', '斜體');
      case 'strike': return insertAround('~~', '~~', '刪除線');
      case 'code': return insertAround('`', '`', '程式碼');
      case 'link': return insertAround('[', '](url)', '文字');
      case 'notelink': return insertAround('[[', ']]', '筆記標題');
      case 'image': return insertAround('![', '](url)', '替代文字');
      case 'h1': return setLinePrefix('# ');
      case 'h2': return setLinePrefix('## ');
      case 'h3': return setLinePrefix('### ');
      case 'quote': return setLinePrefix('> ');
      case 'ul': return setLinePrefix('- ');
      case 'task': return setLinePrefix('- [ ] ');
      case 'ol': return setLinePrefix(null, true);
      case 'codeblock': return insertBlockAround('```\n', '\n```', '');
      case 'callout': return insertBlockAround('> [!NOTE]\n> ', '', '內容');
      case 'table':
        if (window.TableTool) return TableTool.showInsertPicker(editorEl, $('#edit-toolbar button[data-fmt="table"]'));
        return insertBlockAround('| 欄位 A | 欄位 B |\n| --- | --- |\n| 內容 | 內容 |', '', '');
      case 'hr': return insertBlockAround('---', '', '');
      case 'machine': return insertSnippet('machine');
      case 'adset': return insertSnippet('adset');
      case 'pdf': return pickPdf();
    }
  }

  // ---- Embed PDF ---------------------------------------------------------
  function insertPdfFile(file) {
    if (!file || file.type !== 'application/pdf') return false;
    statusSave.textContent = '上傳 PDF…';
    Store.putImage(file).then(function (id) {
      const name = (file.name || 'PDF').replace(/\.pdf$/i, '');
      editorEl.focus();
      insertAtCursor('\n![' + name + '](pdf:' + id + ')\n');
      if (editorEl._hlRefresh) editorEl._hlRefresh();
      scheduleSave();
      renderPreviewNow();
    }).catch(function (e) { statusSave.textContent = '⚠ PDF 上傳失敗：' + (e && e.message || e); });
    return true;
  }
  function pickPdf() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf';
    inp.addEventListener('change', function () {
      const f = inp.files && inp.files[0];
      if (f) insertPdfFile(f);
    });
    inp.click();
  }
  function insertSnippet(key) {
    const tpl = (window.Editor && Editor.snippets && Editor.snippets[key]) || '';
    if (!tpl) return;
    const g = getSel();
    const idx = tpl.indexOf('$CURSOR');
    const clean = tpl.replace('$CURSOR', '');
    const pad0 = (g.s > 0 && g.v[g.s - 1] !== '\n') ? '\n' : '';
    const pad1 = (g.e < g.v.length && g.v[g.e] !== '\n') ? '\n' : '';
    const text = pad0 + clean + pad1;
    const nv = g.v.slice(0, g.s) + text + g.v.slice(g.e);
    const cur = g.s + pad0.length + (idx < 0 ? clean.length : idx);
    setRange(nv, cur, cur);
  }

  // ---- Copy to clipboard (works on file://) ------------------------------
  function copyText(text, btn) {
    function done() {
      const old = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', old === '已複製' ? '複製' : old);
      btn.textContent = '已複製';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = '複製'; btn.classList.remove('copied'); }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.focus(); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }

  // ---- Modal confirm dialog ----------------------------------------------
  function showConfirm(opts) {
    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const msg = MD.escapeHtml(opts.message || '').replace(/\n/g, '<br>');
      overlay.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-title">' + MD.escapeHtml(opts.title || '確認') + '</div>' +
        '<div class="modal-body">' + msg + '</div>' +
        '<div class="modal-actions">' +
        '<button class="btn modal-cancel">' + MD.escapeHtml(opts.cancel || '取消') + '</button>' +
        '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + ' modal-ok">' +
        MD.escapeHtml(opts.ok || '確定') + '</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      function close(val) {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      }
      overlay.querySelector('.modal-cancel').addEventListener('click', function () { close(false); });
      overlay.querySelector('.modal-ok').addEventListener('click', function () { close(true); });
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { overlay.querySelector('.modal-ok').focus(); }, 30);
    });
  }

  // ---- Drag & drop image upload ------------------------------------------
  function hasFiles(e) {
    const t = e.dataTransfer && e.dataTransfer.types;
    return t && Array.prototype.indexOf.call(t, 'Files') >= 0;
  }

  function insertImageFiles(files) {
    const images = Array.prototype.filter.call(files, function (f) {
      return f.type && f.type.indexOf('image/') === 0;
    });
    if (!images.length) return false;
    statusSave.textContent = '插入圖片…';
    Promise.all(images.map(function (f) {
      return Store.putImage(f).then(function (id) {
        const name = (f.name || '圖片').replace(/\.[^.]+$/, '');
        return '![' + name + '](img:' + id + ')';
      });
    })).then(function (mds) {
      editorEl.focus();
      insertAtCursor('\n' + mds.join('\n') + '\n');
      if (editorEl._hlRefresh) editorEl._hlRefresh();
      scheduleSave();
      renderPreviewNow();
    });
    return true;
  }

  function handleEditorDrop(e) {
    if (!hasFiles(e)) return;      // let internal tree drags fall through
    e.preventDefault();
    e.stopPropagation();
    editorEl.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files && files.length) {
      insertImageFiles(files);     // handles the image/* ones
      // …and any PDFs dropped alongside them
      Array.prototype.forEach.call(files, function (f) {
        if (f.type === 'application/pdf') insertPdfFile(f);
      });
    }
  }

  // ---- Context menu ------------------------------------------------------
  function showCtx(e, type, item) {
    e.preventDefault();
    e.stopPropagation();
    const actions = [];
    if (type === 'folder') {
      actions.push({ label: '📄 在此新增筆記', fn: function () { newNote(item.id); } });
      actions.push({ label: '📁 在此新增子資料夾', fn: function () { newFolder(item.id); } });
      actions.push({ label: '✎ 重新命名', fn: function () { renameFolder(item); } });
      actions.push({ label: '🗑 刪除資料夾', fn: function () { deleteFolder(item); }, danger: true });
    } else if (item.perm && item.perm !== 'owner') {
      // Shared with me: I can copy it into my own space, or drop it. Renaming or
      // deleting someone else's note is not mine to do.
      actions.push({ label: '⧉ 複製到我的筆記', fn: function () { duplicateNote(item); } });
      actions.push({ label: '✕ 移除這個分享', fn: function () { leaveShare(item); }, danger: true });
    } else {
      actions.push({ label: '👥 分享…', fn: function () { showShareDialog(item); } });
      actions.push({ label: '✎ 重新命名', fn: function () { renameNote(item); } });
      actions.push({ label: '⧉ 複製', fn: function () { duplicateNote(item); } });
      actions.push({ label: '🗑 刪除筆記', fn: function () { deleteNote(item); }, danger: true });
    }
    ctxMenu.innerHTML = '';
    actions.forEach(function (a) {
      const b = document.createElement('button');
      b.className = 'ctx-item' + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.addEventListener('click', function () { hideCtx(); a.fn(); });
      ctxMenu.appendChild(b);
    });
    ctxMenu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - ctxMenu.offsetHeight - 10);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  }
  function hideCtx() { ctxMenu.hidden = true; }
  document.addEventListener('click', hideCtx);
  document.addEventListener('scroll', hideCtx, true);

  // ---- Sharing -----------------------------------------------------------
  function showShareDialog(note) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'modal share-modal';
    modal.innerHTML =
      '<div class="modal-title">👥 分享「' + MD.escapeHtml(note.title || '未命名筆記') + '」</div>' +
      '<div class="share-hint">輸入對方的帳號即可分享。對方會在自己的「分享給我的」看到這篇筆記。</div>' +
      '<div class="share-add">' +
      '<input class="share-user" type="text" placeholder="帳號" autocomplete="off" spellcheck="false">' +
      '<select class="share-perm">' +
      '<option value="read">唯讀</option><option value="edit">可編輯</option>' +
      '</select>' +
      '<button class="btn share-add-btn" type="button">分享</button>' +
      '</div>' +
      '<div class="share-error" hidden></div>' +
      '<div class="share-list"></div>' +
      '<div class="modal-actions"><button class="btn modal-cancel" type="button">關閉</button></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const listEl = modal.querySelector('.share-list');
    const errEl = modal.querySelector('.share-error');
    const userEl = modal.querySelector('.share-user');
    const permEl = modal.querySelector('.share-perm');

    function err(msg) { errEl.textContent = msg || ''; errEl.hidden = !msg; }

    function refresh() {
      Store.getShares(note.id).then(function (shares) {
        listEl.innerHTML = '';
        if (!shares.length) {
          listEl.innerHTML = '<div class="share-empty">尚未分享給任何人</div>';
          return;
        }
        shares.forEach(function (s) {
          const row = document.createElement('div');
          row.className = 'share-row';

          const name = document.createElement('span');
          name.className = 'share-name';
          name.textContent = s.username;
          row.appendChild(name);

          // 權限下拉：直接在這裡改唯讀／可編輯，變更即時套用（後端會覆寫既有分享）。
          const sel = document.createElement('select');
          sel.className = 'share-perm-row';
          sel.innerHTML = '<option value="read">唯讀</option><option value="edit">可編輯</option>';
          sel.value = s.perm === 'edit' ? 'edit' : 'read';
          sel.addEventListener('change', function () {
            err('');
            sel.disabled = true;
            Store.addShare(note.id, s.username, sel.value)
              .then(refresh)
              .catch(function (e) { err(e.message); refresh(); });
          });
          row.appendChild(sel);

          const rm = document.createElement('button');
          rm.className = 'share-rm';
          rm.type = 'button';
          rm.textContent = '✕';
          rm.title = '取消分享';
          rm.addEventListener('click', function () {
            Store.removeShare(note.id, s.username).then(refresh).catch(e => err(e.message));
          });
          row.appendChild(rm);
          listEl.appendChild(row);
        });
      }).catch(e => err(e.message));
    }

    function add() {
      const u = userEl.value.trim();
      if (!u) return;
      err('');
      Store.addShare(note.id, u, permEl.value).then(function () {
        userEl.value = '';
        refresh();
      }).catch(e => err(e.message));
    }
    modal.querySelector('.share-add-btn').addEventListener('click', add);
    userEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); add(); }
      e.stopPropagation();
    });

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    modal.querySelector('.modal-cancel').addEventListener('click', close);
    setTimeout(function () { userEl.focus(); }, 30);
    refresh();
  }

  // Removing myself from a share is done by the owner's endpoint — I can only ask
  // the server to drop my own row, which it allows because it is my share.
  function leaveShare(note) {
    showConfirm({
      title: '移除分享',
      message: '把「' + (note.title || '未命名筆記') + '」從你的清單移除？\n這不會刪除原始筆記，擁有者仍保有它。',
      ok: '移除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.removeShare(note.id, Auth.user().username).then(function () {
        state.notes = state.notes.filter(function (n) { return n.id !== note.id; });
        if (state.currentId === note.id) showEmpty();
        renderTree();
      }).catch(function (e) { alert('移除失敗：' + e.message); });
    });
  }

  // ---- CRUD actions ------------------------------------------------------
  function newNote(folderId) {
    Store.createNote('未命名筆記', folderId || null).then(function (n) {
      state.notes.push(n);
      if (folderId) state.expanded[folderId] = true;
      renderTree();
      openNote(n.id);
      setTimeout(function () { titleEl.select(); }, 50);
    });
  }
  // 資安院報告：先跳 modal 收集 單位 / Domain / IP / 弱點類型，確認後才建立筆記。
  // 帶 meta.secReport，開啟時走行內步驟編輯器。
  function createSecReport() {
    SecEditor.showNewDialog(function (info) {
      const blank = SecEditor.blankReport();
      blank.unit = info.unit; blank.domain = info.domain;
      blank.ip = info.ip; blank.vulnType = info.vulnType; blank.impact = info.impact;
      blank.title = SecEditor.titleFrom(info);
      Store.createNote(blank.title, null).then(function (n) {
        n.meta = Object.assign({}, n.meta, { secReport: blank });
        n.content = (window.SecReport && SecReport.generate)
          ? SecReport.generate(blank, blank.steps).content : '';
        Store.updateNote(n).then(function () {
          state.notes.push(n);
          renderTree();
          openNote(n.id);
        });
      });
    });
  }

  // 成效報告：先跳 modal 收集 單位 / 期間 / 範圍，確認後建立帶 meta.perfReport 的筆記。
  function createPerfReport() {
    PerfReport.showNewDialog(function (info) {
      const blank = PerfReport.blankReport();
      blank.unit = info.unit; blank.scope = info.scope;
      blank.periodStart = info.periodStart; blank.periodEnd = info.periodEnd;
      blank.title = PerfReport.titleFrom(info);
      Store.createNote(blank.title, null).then(function (n) {
        n.meta = Object.assign({}, n.meta, { perfReport: blank });
        n.content = PerfReport.generate(blank).content;
        Store.updateNote(n).then(function () {
          state.notes.push(n);
          renderTree();
          openNote(n.id);
        });
      });
    });
  }

  function newFolder(parentId) {
    Store.createFolder('新資料夾', parentId || null).then(function (f) {
      state.folders.push(f);
      if (parentId) state.expanded[parentId] = true;
      state.expanded[f.id] = true;
      renderTree();
      startRename('folder', f.id);
    });
  }
  function renameNote(note) { startRename('note', note.id); }
  function renameFolder(folder) { startRename('folder', folder.id); }

  // Inline rename directly in the tree (no blocking prompt() dialogs).
  function startRename(type, id) {
    const sel = type === 'folder' ? '.folder-row' : '.note-row';
    const row = treeEl.querySelector(sel + '[data-id="' + id + '"]');
    if (!row) return;
    const label = row.querySelector('.label');
    if (!label) return;
    const input = document.createElement('input');
    input.className = 'tree-edit';
    input.value = label.textContent;
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    function commit(save) {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (save && val) {
        if (type === 'folder') {
          const f = state.folders.find(function (x) { return x.id === id; });
          if (f) { f.name = val; Store.updateFolder(f).then(renderTree); return; }
        } else {
          const n = state.notes.find(function (x) { return x.id === id; });
          if (n) {
            const oldTitle = n.title;
            n.title = val;
            Store.updateNote(n).then(function () {
              if (state.currentId === id) titleEl.value = val;
              return retargetLinks(oldTitle, val);
            }).then(function () {
              renderTree();
              renderPreview();
            });
            return;
          }
        }
      }
      renderTree(); // revert / no-op
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', function () { commit(true); });
  }
  // Renaming a note would orphan every [[old title]] pointing at it, so rewrite
  // those links across all notes to follow the new title.
  function retargetLinks(oldTitle, newTitle) {
    if (normTitle(oldTitle) === normTitle(newTitle)) return Promise.resolve();
    const re = /\[\[([^\[\]|\n]+)(\|[^\[\]\n]+)?\]\]/g;
    const jobs = [];
    state.notes.forEach(function (n) {
      const next = String(n.content || '').replace(re, function (raw, target, alias) {
        return normTitle(target) === normTitle(oldTitle) ? '[[' + newTitle + (alias || '') + ']]' : raw;
      });
      if (next === n.content) return;
      n.content = next;
      if (n.id === state.currentId) {
        editorEl.value = next;
        if (state.current) state.current.content = next;
        if (editorEl._hlRefresh) editorEl._hlRefresh();
      }
      jobs.push(Store.updateNote(n));
    });
    return Promise.all(jobs);
  }

  function duplicateNote(note) {
    Store.getNote(note.id).then(function (full) {
      // A copy of someone else's note lands at my root — its folderId belongs to
      // their tree and would leave the copy invisible in mine.
      const folder = full.perm === 'owner' ? full.folderId : null;
      Store.createNote((full.title || '未命名筆記') + ' (複本)', folder).then(function (n) {
        n.content = full.content;
        Store.updateNote(n).then(function () {
          state.notes.push(n);
          renderTree();
        });
      });
    });
  }
  function deleteNote(note) {
    showConfirm({
      title: '刪除筆記',
      message: '確定刪除筆記「' + (note.title || '未命名筆記') + '」？\n此動作無法復原。',
      ok: '刪除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteNote(note.id).then(function () {
        state.notes = state.notes.filter(function (n) { return n.id !== note.id; });
        if (state.currentId === note.id) showEmpty();
        renderTree();
      });
    });
  }
  function deleteFolder(folder) {
    const folderIds = descendantFolderIds(folder.id);
    const notesInside = state.notes.filter(function (n) { return folderIds.indexOf(n.folderId) >= 0; });
    const subFolders = folderIds.length - 1;
    let detail = '含 ' + notesInside.length + ' 篇筆記';
    if (subFolders > 0) detail += '、' + subFolders + ' 個子資料夾';
    showConfirm({
      title: '刪除資料夾',
      message: '確定刪除資料夾「' + folder.name + '」？\n將一併刪除其中所有內容（' + detail + '）。\n此動作無法復原。',
      ok: '刪除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      const noteDeletes = notesInside.map(function (n) { return Store.deleteNote(n.id); });
      const folderDeletes = folderIds.map(function (id) { return Store.deleteFolder(id); });
      Promise.all(noteDeletes.concat(folderDeletes)).then(function () {
        state.notes = state.notes.filter(function (n) { return folderIds.indexOf(n.folderId) < 0; });
        state.folders = state.folders.filter(function (f) { return folderIds.indexOf(f.id) < 0; });
        if (state.current && folderIds.indexOf(state.current.folderId) >= 0) showEmpty();
        renderTree();
      });
    });
  }
  function descendantFolderIds(rootId) {
    const ids = [rootId];
    let changed = true;
    while (changed) {
      changed = false;
      state.folders.forEach(function (f) {
        if (ids.indexOf(f.parentId) >= 0 && ids.indexOf(f.id) < 0) { ids.push(f.id); changed = true; }
      });
    }
    return ids;
  }

  // ---- Export ------------------------------------------------------------
  function exportPDF() {
    if (!state.current) return;
    // Make sure preview reflects latest text before export.
    previewEl.innerHTML = MD.render(editorEl.value);
    MD.resolveImages(previewEl);
    statusSave.textContent = '準備列印預覽…';
    // small delay so images resolve
    setTimeout(function () {
      PDF.showPreview(state.current, previewEl, {
        meta: state.current.meta,
        // Cover fields live on the note. Save through here rather than from pdf.js
        // so the note's title/content stay in step with the editor.
        onMeta: function (meta) {
          if (!state.current) return;
          state.current.meta = meta;
          saveNow();
        }
      }).then(function () {
        statusSave.textContent = '';
      }).catch(function (err) {
        alert('產生列印預覽失敗：' + (err && err.message || err));
        statusSave.textContent = '';
      });
    }, 250);
  }

  // ---- Search ------------------------------------------------------------
  const search = { query: '', results: [], index: -1 };

  function renderMarkedText(parts, into) {
    parts.forEach(function (p) {
      const node = p.hit ? document.createElement('mark') : document.createTextNode(p.text);
      if (p.hit) { node.className = 'search-hit'; node.textContent = p.text; }
      into.appendChild(node);
    });
  }

  function runSearch(q) {
    const sameQuery = q === search.query;
    // Keep the caret on the note the user had highlighted when this is a
    // refresh of the same query (e.g. after opening a result), not a new one.
    const keepId = sameQuery && search.results[search.index]
      ? search.results[search.index].note.id : null;
    search.query = q;
    const active = !!q.trim();
    searchClearEl.hidden = !active;
    treeEl.hidden = active;
    searchResultsEl.hidden = !active;
    if (!active) { search.results = []; search.index = -1; searchResultsEl.innerHTML = ''; return; }
    // The open note's edits live in the textarea until the debounced save runs.
    // state.current is a separate object loaded from IndexedDB, not the array
    // element, so swap in a live copy rather than mutating state.notes here.
    let corpus = state.notes;
    if (state.current) {
      const live = Object.assign({}, state.current, {
        title: titleEl.value || '未命名筆記',
        content: editorEl.value
      });
      corpus = state.notes.map(function (n) { return n.id === live.id ? live : n; });
    }
    search.results = Search.search(q, corpus);
    let idx = -1;
    if (keepId) {
      idx = search.results.findIndex(function (r) { return r.note.id === keepId; });
    }
    search.index = idx >= 0 ? idx : (search.results.length ? 0 : -1);
    renderSearchResults();
  }

  function renderSearchResults() {
    searchResultsEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'search-count';
    head.textContent = search.results.length ? search.results.length + ' 個結果' : '找不到符合的筆記';
    searchResultsEl.appendChild(head);

    search.results.forEach(function (r, i) {
      const row = document.createElement('div');
      row.className = 'search-row' + (i === search.index ? ' active' : '') +
        (r.note.id === state.currentId ? ' current' : '');
      const title = document.createElement('div');
      title.className = 'search-row-title';
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = '📄';
      title.appendChild(ic);
      const label = document.createElement('span');
      label.className = 'label';
      renderMarkedText(r.titleParts, label);
      title.appendChild(label);
      row.appendChild(title);

      r.snippets.forEach(function (s) {
        const snip = document.createElement('div');
        snip.className = 'search-snippet';
        if (s.lead) snip.appendChild(document.createTextNode('…'));
        renderMarkedText(s.parts, snip);
        if (s.trail) snip.appendChild(document.createTextNode('…'));
        row.appendChild(snip);
      });

      row.addEventListener('click', function () { openSearchResult(i); });
      row.addEventListener('mousemove', function () {
        if (search.index === i) return;
        search.index = i;
        highlightSearchRow();
      });
      searchResultsEl.appendChild(row);
    });
  }

  function highlightSearchRow() {
    const rows = searchResultsEl.querySelectorAll('.search-row');
    Array.prototype.forEach.call(rows, function (r, i) {
      r.classList.toggle('active', i === search.index);
    });
    const active = rows[search.index];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function moveSearchSelection(dir) {
    if (!search.results.length) return;
    search.index = (search.index + dir + search.results.length) % search.results.length;
    highlightSearchRow();
  }

  function openSearchResult(i) {
    const r = search.results[i == null ? search.index : i];
    if (!r) return;
    saveNow();
    openNote(r.note.id);
  }

  function clearSearch(focusEditor) {
    searchInput.value = '';
    runSearch('');
    if (focusEditor && state.current) editorEl.focus();
  }

  // ---- Image annotation --------------------------------------------------
  function openAnnotator(id) {
    if (!id || !window.Annotate) return;
    Annotate.open(id, {
      onSaved: function () {
        statusSave.textContent = '標註已儲存 ✓';
        renderPreviewNow(); // re-read the blob through the invalidated URL cache
      }
    });
  }

  // ---- Theme -------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    LS.set('theme', theme);
    // swap hljs theme
    const link = $('#hljs-theme-light');
    if (link) link.href = theme === 'dark' ? 'vendor/hljs-github-dark.min.css' : 'vendor/hljs-github.min.css';
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    renderPreview();
  }

  // ---- Sidebar collapse --------------------------------------------------
  function setSidebarCollapsed(v) {
    const app = $('#app');
    if (app) app.classList.toggle('sidebar-collapsed', !!v);
    LS.set('sidebarCollapsed', v ? '1' : '0');
  }
  function toggleSidebar() {
    const app = $('#app');
    setSidebarCollapsed(!(app && app.classList.contains('sidebar-collapsed')));
  }

  // ---- Divider resize ----------------------------------------------------
  function initDivider() {
    const divider = $('#divider');
    let dragging = false;
    const saved = LS.get('splitRatio', null);
    if (saved) panesEl.style.setProperty('--edit-basis', saved);
    divider.addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const rect = panesEl.getBoundingClientRect();
      let ratio = (e.clientX - rect.left) / rect.width;
      ratio = Math.max(0.2, Math.min(0.8, ratio));
      const pct = (ratio * 100).toFixed(1) + '%';
      panesEl.style.setProperty('--edit-basis', pct);
      LS.set('splitRatio', pct);
    });
    window.addEventListener('mouseup', function () { dragging = false; document.body.style.cursor = ''; });
  }

  // ---- Events ------------------------------------------------------------
  function bindEvents() {
    // 點頂列 logo 回到首頁儀表板
    const logo = document.querySelector('#topbar .logo');
    if (logo) {
      logo.style.cursor = 'pointer';
      logo.title = '回到首頁';
      logo.addEventListener('click', goHome);
    }
    // 收合側邊欄後，編輯畫面左上角也提供「📓 報告筆記」回首頁鈕
    document.querySelectorAll('.home-btn').forEach(function (b) {
      b.addEventListener('click', goHome);
    });

    $('#new-note').addEventListener('click', function () { newNote(null); });
    $('#new-folder').addEventListener('click', function () { newFolder(null); });
    $('#export-pdf').addEventListener('click', exportPDF);
    $('#toggle-theme').addEventListener('click', toggleTheme);
    if (shareBtn) shareBtn.addEventListener('click', function () {
      if (state.current && isMine(state.current)) showShareDialog(state.current);
    });

    // 收合鈕現在在全域頂列、永遠可見，因此改為切換（收合 ↔ 展開）
    const collapseBtn = $('#sidebar-collapse');
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar);
    const reopenBtn = $('#sidebar-reopen');
    if (reopenBtn) reopenBtn.addEventListener('click', function () { setSidebarCollapsed(false); });

    const oscpBtn = $('#oscp-report');
    if (oscpBtn && window.OSCP) oscpBtn.addEventListener('click', function () {
      OSCP.showForm(function (title, md) {
        Store.createNote(title, null).then(function (n) {
          n.content = md;
          Store.updateNote(n).then(function () {
            state.notes.push(n);
            renderTree();
            openNote(n.id);
            setMode('split');
          });
        });
      });
    });

    const secBtn = $('#sec-report');
    if (secBtn && window.SecEditor) secBtn.addEventListener('click', createSecReport);

    const perfBtn = $('#perf-report');
    if (perfBtn && window.PerfReport) perfBtn.addEventListener('click', createPerfReport);

    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });

    // Search
    let searchTimer = null;
    searchInput.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { runSearch(searchInput.value); }, 120);
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); openSearchResult(); }
      else if (e.key === 'Escape') { e.preventDefault(); clearSearch(true); }
    });
    searchClearEl.addEventListener('click', function () { clearSearch(false); searchInput.focus(); });
    // Ctrl/Cmd+K from anywhere focuses the search box.
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      }
    });

    editorEl.addEventListener('input', function () {
      renderPreview();
      scheduleSave();
      updateStatus();
      danceCapybara();
      scheduleSendCursor();     // my caret moved
      scheduleCaretRender();    // text reflowed → reposition others' carets
    });
    editorEl.addEventListener('paste', handlePaste);
    // Broadcast my caret as it moves; reposition remote carets on scroll/resize.
    editorEl.addEventListener('keyup', scheduleSendCursor);
    editorEl.addEventListener('click', scheduleSendCursor);
    editorEl.addEventListener('focus', scheduleSendCursor);
    editorEl.addEventListener('scroll', scheduleCaretRender);
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === editorEl) scheduleSendCursor();
    });
    window.addEventListener('resize', scheduleCaretRender);
    editorEl.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+S saves
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNow();
      }
    });
    // Drag & drop image files into the editor
    editorEl.addEventListener('dragover', function (e) {
      if (hasFiles(e)) { e.preventDefault(); editorEl.classList.add('drag-over'); }
    });
    editorEl.addEventListener('dragleave', function (e) {
      if (e.target === editorEl) editorEl.classList.remove('drag-over');
    });
    editorEl.addEventListener('drop', handleEditorDrop);
    // Prevent the browser from navigating away if a file is dropped outside the editor
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) { if (hasFiles(e)) e.preventDefault(); });
    // Editor syntax-highlight backdrop + line numbers
    if (window.EditorHL) EditorHL.attach(editorEl, $('#editor-backdrop'));
    // Markdown editing helpers + autocomplete (auto-pairs, list continuation, suggestions)
    if (window.Editor) Editor.attach(editorEl);
    // Interactive table tooling (Notion-like controls + align/tidy)
    if (window.TableTool) TableTool.attach(editorEl, {
      isActive: function () { return state.mode !== 'preview' && !!state.current; }
    });

    // Formatting toolbar
    const tb = $('#edit-toolbar');
    if (tb) {
      tb.addEventListener('mousedown', function (e) {
        if (e.target.closest('button')) e.preventDefault(); // keep textarea selection/focus
      });
      tb.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (btn && btn.dataset.fmt) applyFormat(btn.dataset.fmt);
      });
    }
    // sync scroll between editor & preview in split mode (bidirectional, proportional)
    let scrollSyncing = false;
    function linkScroll(src, dst) {
      src.addEventListener('scroll', function () {
        if (state.mode !== 'split' || !src || !dst) return;
        // 對方剛被程式捲動而觸發的 scroll 事件：吃掉一次即可，避免來回震盪
        if (scrollSyncing) { scrollSyncing = false; return; }
        const sMax = src.scrollHeight - src.clientHeight;
        const dMax = dst.scrollHeight - dst.clientHeight;
        if (sMax <= 0 || dMax <= 0) return;
        const target = Math.round((src.scrollTop / sMax) * dMax);
        if (Math.abs(dst.scrollTop - target) < 1) return;   // 已對齊就別再設，免得卡住旗標
        scrollSyncing = true;
        dst.scrollTop = target;
      });
    }
    if (previewScrollEl) {
      linkScroll(editorEl, previewScrollEl);   // 左捲動 → 右跟隨
      linkScroll(previewScrollEl, editorEl);   // 右捲動 → 左跟隨
    }
    // scroll-spy: highlight the current heading in the TOC
    if (previewScrollEl) previewScrollEl.addEventListener('scroll', updateTocActive);
    // TOC show button (re-open a collapsed TOC)
    const tocShow = $('#toc-show');
    if (tocShow) tocShow.addEventListener('click', function () { setTocCollapsed(false); });
    // Copy button on code blocks
    previewEl.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      const link = e.target.closest('.note-link');
      if (link) { e.preventDefault(); handleNoteLink(link); return; }
      const tag = e.target.closest('.hashtag');
      if (tag) { e.preventDefault(); browseTag(tag.getAttribute('data-tag')); return; }
      const anno = e.target.closest('.img-annotate');
      if (anno) { e.preventDefault(); openAnnotator(anno.getAttribute('data-annotate')); return; }
      const btn = e.target.closest('.code-copy');
      if (!btn) return;
      const block = btn.closest('.code-block');
      const codeEl = block && block.querySelector('pre code');
      if (codeEl) copyText(codeEl.textContent, btn);
    });

    titleEl.addEventListener('input', scheduleSave);

    // import
    $('#import-btn').addEventListener('click', function () { $('#import-input').click(); });
    $('#import-input').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = function () {
        Store.createNote(file.name.replace(/\.(md|markdown)$/i, ''), null).then(function (n) {
          n.content = fr.result;
          Store.updateNote(n).then(function () {
            state.notes.push(n);
            renderTree();
            openNote(n.id);
          });
        });
      };
      fr.readAsText(file);
      e.target.value = '';
    });

    initDivider();
  }

  // Shared with other modules (admin.js reuses the confirm dialog).
  window.App = { confirm: showConfirm, reload: loadData };

  // Go
  init();
})();
