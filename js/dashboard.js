/* dashboard.js — 首頁儀表板（沒有開啟筆記時顯示於右側）
 *
 * 區塊：總覽統計、活動熱力圖與關聯圖（並排，關聯圖為力導向動畫）、#標籤雲、所有筆記瀏覽器
 *（方塊／條列可切換、可進資料夾、可依標籤篩選）。
 * 全部由目前載入的 state（notes / folders）即時計算，不需額外 API。
 *
 * 用法：Dashboard.render({ notes, folders, onOpen });
 */
(function (global) {
  'use strict';

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  const isMine = function (n) { return !n.perm || n.perm === 'owner'; };
  function noteKind(n) {
    if (n.meta && n.meta.perfReport) return { icon: '📈', label: '成效報告' };
    if (n.meta && n.meta.secReport) return { icon: '🛡', label: '資安院報告' };
    return { icon: '📄', label: '筆記' };
  }

  function relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '剛剛';
    if (min < 60) return min + ' 分鐘前';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小時前';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    const mon = Math.floor(day / 30);
    if (mon < 12) return mon + ' 個月前';
    return Math.floor(mon / 12) + ' 年前';
  }

  // ---- 統計 --------------------------------------------------------------
  function buildStats(notes, folders) {
    const mine = notes.filter(isMine);
    const sec = mine.filter(function (n) { return n.meta && n.meta.secReport; }).length;
    const perf = mine.filter(function (n) { return n.meta && n.meta.perfReport; }).length;
    return [
      { n: mine.length, label: '筆記', icon: '📄' },
      { n: folders.length, label: '資料夾', icon: '📁' },
      { n: sec + perf, label: '報告（資安院/成效）', icon: '📑' }
    ];
  }

  function renderStats(notes, folders) {
    const wrap = el('div', 'dash-stats');
    buildStats(notes, folders).forEach(function (s) {
      const card = el('div', 'dash-stat');
      card.appendChild(el('div', 'dash-stat-ic', s.icon));
      card.appendChild(el('div', 'dash-stat-n', String(s.n)));
      card.appendChild(el('div', 'dash-stat-l', esc(s.label)));
      wrap.appendChild(card);
    });
    return wrap;
  }

  // ---- 活動熱力圖 --------------------------------------------------------
  const WEEKS = 26;
  const WDAY_LABELS = ['', '一', '', '三', '', '五', ''];      // 週一/三/五顯示，其餘留白
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function level(c) { return c === 0 ? 0 : c < 3 ? 1 : c < 6 ? 2 : c < 10 ? 3 : 4; }

  // 活動熱力圖：GitHub 風格貢獻圖，格子隨卡片寬度自適應、附月份／週別標籤。
  function buildHeatmapSlide(notes) {
    const counts = {};
    notes.forEach(function (n) {
      [n.updatedAt, n.createdAt].forEach(function (ts) {
        if (!ts) return;
        const d = new Date(ts); d.setHours(0, 0, 0, 0);
        const k = dayKey(d);
        counts[k] = (counts[k] || 0) + 1;
      });
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7); // 對齊到週日

    const slide = el('div', 'dash-slide dash-heat-slide');

    // 標頭：近 N 週
    const head = el('div', 'dash-heat-top');
    head.appendChild(el('span', 'dash-card-sub', '近 ' + WEEKS + ' 週活動'));
    slide.appendChild(head);

    // 圖表區：左側週別標籤欄 + 右側（月份列 + 格子）
    const plot = el('div', 'dash-heat-plot');

    const months = el('div', 'heat-months');
    let prevMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const colDate = new Date(start);
      colDate.setDate(start.getDate() + w * 7);
      const cell = el('span', 'heat-month');
      const m = colDate.getMonth();
      if (m !== prevMonth) { cell.textContent = (m + 1) + '月'; prevMonth = m; }
      months.appendChild(cell);
    }
    plot.appendChild(months);

    const wdays = el('div', 'heat-wdays');
    WDAY_LABELS.forEach(function (lbl) { wdays.appendChild(el('span', 'heat-wday', lbl)); });
    plot.appendChild(wdays);

    const grid = el('div', 'dash-heat');
    let total = 0;
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        if (date > today) { grid.appendChild(el('span', 'heat-cell heat-empty')); continue; }
        const c = counts[dayKey(date)] || 0;
        total += c;
        const cell = el('span', 'heat-cell heat-l' + level(c));
        cell.title = (date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate()) +
          '：' + c + ' 次活動';
        grid.appendChild(cell);
      }
    }
    plot.appendChild(grid);
    slide.appendChild(plot);

    // 圖例：總計 X 次 …… 少 ▢▢▢▢▢ 多
    const legend = el('div', 'dash-heat-legend');
    legend.appendChild(el('span', 'dash-card-sub', '總計 ' + total + ' 次'));
    const scale = el('span', 'heat-scale');
    scale.appendChild(el('span', 'dash-card-sub', '少'));
    [0, 1, 2, 3, 4].forEach(function (l) { scale.appendChild(el('span', 'heat-cell heat-l' + l)); });
    scale.appendChild(el('span', 'dash-card-sub', '多'));
    legend.appendChild(scale);
    slide.appendChild(legend);
    return slide;
  }

  // 關聯圖：以 [[筆記標題]] 連結建圖，力導向動畫（會晃動），可拖曳、點節點開筆記。
  function buildGraphSlide(notes, onOpen) {
    const slide = el('div', 'dash-slide dash-graph-slide');
    const mine = notes.filter(isMine);
    const byTitle = {};
    mine.forEach(function (n) { const k = String(n.title || '').trim().toLowerCase(); if (k) byTitle[k] = n; });

    const edges = [], edgeSeen = {}, linked = {};
    mine.forEach(function (n) {
      const targets = (global.MD && MD.extractLinks) ? MD.extractLinks(n.content || '') : [];
      targets.forEach(function (t) {
        const tgt = byTitle[String(t || '').trim().toLowerCase()];
        if (tgt && tgt.id !== n.id) {
          const key = n.id < tgt.id ? n.id + '|' + tgt.id : tgt.id + '|' + n.id;
          if (!edgeSeen[key]) { edgeSeen[key] = true; edges.push([n.id, tgt.id]); }
          linked[n.id] = true; linked[tgt.id] = true;
        }
      });
    });
    const nodes = mine.filter(function (n) { return linked[n.id]; });

    if (!nodes.length) {
      slide.appendChild(el('div', 'dash-empty',
        '還沒有任何筆記連結。在筆記中用 <b>[[筆記標題]]</b> 互相連結，關聯圖就會出現在這裡。'));
      return slide;
    }

    const deg = {};
    edges.forEach(function (e) { deg[e[0]] = (deg[e[0]] || 0) + 1; deg[e[1]] = (deg[e[1]] || 0) + 1; });

    // ---- 力導向動畫圖（Obsidian 風格：互斥 + 彈簧 + 持續飄動 + 可拖曳）----
    const SVGNS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs) {
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }
    const W = 480, H = 400, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 46;

    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'dash-graph', preserveAspectRatio: 'xMidYMid meet' });
    const gEdges = svgEl('g', {});
    const gNodes = svgEl('g', {});
    svg.appendChild(gEdges); svg.appendChild(gNodes);

    // 建節點：環狀起始位置 + 隨機抖動，避免一開始重疊
    const byId = {}, N = nodes.length;
    const sim = nodes.map(function (n, i) {
      const ang = i / N * 2 * Math.PI;
      const rad = R * (0.55 + 0.45 * Math.random());
      const r = 5 + Math.min(7, deg[n.id] || 1);
      const node = {
        id: n.id, title: n.title || '未命名筆記', r: r,
        x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad,
        vx: 0, vy: 0, fx: 0, fy: 0, fixed: false
      };
      byId[n.id] = node;

      const g = svgEl('g', { class: 'graph-node' });
      g.dataset.id = n.id;
      node.circle = svgEl('circle', { r: r });
      node.text = svgEl('text', { 'text-anchor': 'middle' });
      node.text.textContent = String(n.title || '未命名').slice(0, 10);
      const tt = svgEl('title', {}); tt.textContent = node.title;
      g.appendChild(node.circle); g.appendChild(node.text); g.appendChild(tt);
      gNodes.appendChild(g);
      return node;
    });

    const simEdges = edges.map(function (e) {
      const line = svgEl('line', { class: 'graph-edge' });
      gEdges.appendChild(line);
      return { a: byId[e[0]], b: byId[e[1]], line: line };
    });

    const holder = el('div', 'dash-graph-holder');
    holder.appendChild(svg);
    slide.appendChild(holder);

    const iso = mine.length - nodes.length;
    slide.appendChild(el('div', 'dash-graph-foot', '<span class="dash-card-sub">' +
      nodes.length + ' 篇 · ' + edges.length + ' 條連結（拖曳可移動、點一下開啟筆記）' +
      (iso > 0 ? ' · ' + iso + ' 篇未連結' : '') + '</span>'));

    // 物理參數
    const REP = 3200, SPRING = 0.045, REST = 78, GRAV = 0.016, DAMP = 0.9, WIG = 0.16, VMAX = 7, PAD = 22;
    let frame = 0, raf = 0, hidden = 0;

    function step() {
      frame++;
      for (let i = 0; i < sim.length; i++) { sim[i].fx = 0; sim[i].fy = 0; }
      // 節點互斥
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const a = sim[i], b = sim[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy; if (d2 < 0.01) { d2 = 0.01; dx = 0.1; }
          const d = Math.sqrt(d2), f = REP / d2, ux = dx / d, uy = dy / d;
          a.fx += ux * f; a.fy += uy * f; b.fx -= ux * f; b.fy -= uy * f;
        }
      }
      // 連線彈簧
      for (let k = 0; k < simEdges.length; k++) {
        const e = simEdges[k], a = e.a, b = e.b; if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01, f = SPRING * (d - REST);
        const ux = dx / d, uy = dy / d;
        a.fx += ux * f; a.fy += uy * f; b.fx -= ux * f; b.fy -= uy * f;
      }
      // 向心力 + 持續輕微飄動（讓圖永遠有點在晃）
      for (let i = 0; i < sim.length; i++) {
        const n = sim[i];
        n.fx += (cx - n.x) * GRAV + Math.cos(frame * 0.03 + i * 1.3) * WIG;
        n.fy += (cy - n.y) * GRAV + Math.sin(frame * 0.033 + i * 2.1) * WIG;
      }
      // 積分位移
      for (let i = 0; i < sim.length; i++) {
        const n = sim[i];
        if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
        n.vx = (n.vx + n.fx) * DAMP; n.vy = (n.vy + n.fy) * DAMP;
        if (n.vx > VMAX) n.vx = VMAX; else if (n.vx < -VMAX) n.vx = -VMAX;
        if (n.vy > VMAX) n.vy = VMAX; else if (n.vy < -VMAX) n.vy = -VMAX;
        n.x += n.vx; n.y += n.vy;
        if (n.x < PAD) n.x = PAD; else if (n.x > W - PAD) n.x = W - PAD;
        if (n.y < PAD) n.y = PAD; else if (n.y > H - PAD) n.y = H - PAD;
      }
    }

    function draw() {
      for (let i = 0; i < sim.length; i++) {
        const n = sim[i];
        n.circle.setAttribute('cx', n.x.toFixed(1));
        n.circle.setAttribute('cy', n.y.toFixed(1));
        n.text.setAttribute('x', n.x.toFixed(1));
        n.text.setAttribute('y', (n.y + n.r + 11).toFixed(1));
      }
      for (let k = 0; k < simEdges.length; k++) {
        const e = simEdges[k]; if (!e.a || !e.b) continue;
        e.line.setAttribute('x1', e.a.x.toFixed(1)); e.line.setAttribute('y1', e.a.y.toFixed(1));
        e.line.setAttribute('x2', e.b.x.toFixed(1)); e.line.setAttribute('y2', e.b.y.toFixed(1));
      }
    }

    function loop() {
      if (!holder.isConnected) return;                 // 已被移除 → 停止
      if (holder.offsetParent === null) {               // 被隱藏（例如開啟筆記）
        if (++hidden > 150) return;                     // 隱藏一陣子就停，下次會重建
        raf = requestAnimationFrame(loop); return;
      }
      hidden = 0;
      step(); draw();
      raf = requestAnimationFrame(loop);
    }

    // ---- 拖曳 / 點擊 ----
    let drag = null;
    function toXY(ev) {
      const ctm = svg.getScreenCTM(); if (!ctm) return null;
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    svg.addEventListener('pointerdown', function (ev) {
      const g = ev.target.closest && ev.target.closest('.graph-node');
      if (!g) return;
      const nd = byId[g.dataset.id]; if (!nd) return;
      drag = { nd: nd, moved: false };
      nd.fixed = true;
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      const p = toXY(ev); if (!p) return;
      drag.nd.x = p.x; drag.nd.y = p.y; drag.nd.vx = 0; drag.nd.vy = 0;
      drag.moved = true;
    });
    function endDrag(ev) {
      if (!drag) return;
      drag.nd.fixed = false;
      if (!drag.moved) onOpen(drag.nd.id);   // 沒拖動 = 點擊開筆記
      drag = null;
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    draw();
    raf = requestAnimationFrame(loop);
    return slide;
  }

  // 通用的可收合卡片：標題列可點擊收合／展開，狀態存於 lsKey。
  function collapsibleCard(lsKey, title, extraClass, buildBody) {
    const collapsed = LS.get(lsKey, '0') === '1';
    const box = el('div', 'dash-card' + (extraClass ? ' ' + extraClass : '') + (collapsed ? ' collapsed' : ''));
    const head = el('div', 'dash-card-head dash-collapsible');
    const titleWrap = el('span', 'dash-head-title');
    titleWrap.appendChild(el('span', 'dash-twisty', collapsed ? '▸' : '▾'));
    titleWrap.appendChild(el('span', 'dash-head-name', title));
    head.appendChild(titleWrap);
    head.title = collapsed ? '展開' : '收合';
    head.addEventListener('click', function () {
      LS.set(lsKey, collapsed ? '0' : '1');
      paint();
    });
    box.appendChild(head);
    if (!collapsed) box.appendChild(buildBody());
    return box;
  }

  // 左欄：總覽三框 + 活動熱力圖（同寬堆疊）；右欄：關聯圖（上移、與左欄等高，底部對齊）。
  function renderVizSplit(notes, folders, onOpen) {
    const split = el('div', 'dash-split');

    const leftCol = el('div', 'dash-split-col');
    leftCol.appendChild(renderStats(notes, folders));
    leftCol.appendChild(collapsibleCard('dashHeatCollapsed', '📅 活動熱力圖', 'dash-heat-card', function () {
      return buildHeatmapSlide(notes);
    }));
    split.appendChild(leftCol);

    split.appendChild(collapsibleCard('dashGraphCollapsed', '🕸 關聯圖', 'dash-graph-card', function () {
      return buildGraphSlide(notes, onOpen);
    }));
    return split;
  }

  // ---- 所有筆記瀏覽器 ----------------------------------------------------
  // 可在方塊 / 條列兩種檢視間切換，並可點進資料夾逐層瀏覽。
  const isMineN = isMine;
  const LS = {
    get: function (k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  let viewMode = LS.get('dashView', 'card') === 'list' ? 'list' : 'card';
  let curFolderId = null;          // 目前瀏覽到哪個資料夾（null = 最上層）
  let lastOpts = null;             // 記住最近一次 render 的資料，供導覽時重繪
  let tagFilter = null;            // 目前的 #標籤 篩選（null = 不篩選）

  function foldersIn(folders, parentId) {
    return folders
      .filter(function (f) { return (f.parentId || null) === parentId; })
      .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'); });
  }
  function notesIn(notes, folderId) {
    return notes
      .filter(function (n) { return isMineN(n) && (n.folderId || null) === folderId; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }
  function folderById(folders, id) {
    for (let i = 0; i < folders.length; i++) if (folders[i].id === id) return folders[i];
    return null;
  }
  // 資料夾內（含所有子資料夾）的筆記總數
  function countNotesDeep(notes, folders, folderId) {
    let c = notesIn(notes, folderId).length;
    foldersIn(folders, folderId).forEach(function (f) { c += countNotesDeep(notes, folders, f.id); });
    return c;
  }
  // 從最上層到目前資料夾的路徑（供麵包屑）
  function crumbPath(folders, id) {
    const path = [];
    let cur = id;
    const guard = {};
    while (cur && !guard[cur]) {
      guard[cur] = true;
      const f = folderById(folders, cur);
      if (!f) break;
      path.unshift(f);
      cur = f.parentId || null;
    }
    return path;
  }

  function navigate(folderId) {
    curFolderId = folderId || null;
    paint();
  }
  function setView(mode) {
    viewMode = mode === 'list' ? 'list' : 'card';
    LS.set('dashView', viewMode);
    paint();
  }
  function setTag(tag) {
    tagFilter = tag || null;
    paint();
  }

  // 掃描所有筆記蒐集 #標籤（大小寫合併計數，顯示首見寫法），依出現筆記數排序
  function collectTags(notes) {
    const map = {};
    notes.filter(isMine).forEach(function (n) {
      const tags = (global.MD && MD.extractTags) ? MD.extractTags(n.content || '') : [];
      tags.forEach(function (t) {
        const k = t.toLowerCase();
        if (!map[k]) map[k] = { tag: t, count: 0 };
        map[k].count++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hant'); });
  }

  function renderTagCloud(notes) {
    const tags = collectTags(notes);
    if (!tags.length) return null;
    const box = el('div', 'dash-card');
    const head = el('div', 'dash-card-head');
    head.appendChild(el('span', null, '🏷 標籤'));
    head.appendChild(el('span', 'dash-card-sub', tags.length + ' 個'));
    box.appendChild(head);
    const cloud = el('div', 'dash-tag-cloud');
    tags.forEach(function (t) {
      const active = tagFilter && tagFilter.toLowerCase() === t.tag.toLowerCase();
      const chip = el('button', 'tag-chip' + (active ? ' active' : ''));
      chip.type = 'button';
      chip.innerHTML = '#' + esc(t.tag) + '<span class="tag-count">' + t.count + '</span>';
      chip.addEventListener('click', function () { setTag(active ? null : t.tag); });
      cloud.appendChild(chip);
    });
    box.appendChild(cloud);
    return box;
  }

  // 方塊 / 條列 檢視切換（瀏覽器與標籤結果共用）
  function buildViewToggle() {
    const toggle = el('div', 'dash-view-toggle');
    const cardBtn = el('button', 'dash-view-btn' + (viewMode === 'card' ? ' active' : ''), '▦ 方塊');
    const listBtn = el('button', 'dash-view-btn' + (viewMode === 'list' ? ' active' : ''), '☰ 條列');
    cardBtn.type = 'button'; listBtn.type = 'button';
    cardBtn.title = '方塊檢視'; listBtn.title = '條列檢視';
    cardBtn.addEventListener('click', function () { setView('card'); });
    listBtn.addEventListener('click', function () { setView('list'); });
    toggle.appendChild(cardBtn); toggle.appendChild(listBtn);
    return toggle;
  }

  function makeFolderEl(folder, count) {
    const label = esc(folder.name || '未命名資料夾');
    const sub = count + ' 筆記';
    let elm;
    if (viewMode === 'card') {
      elm = el('button', 'dash-tile dash-tile-folder');
      elm.innerHTML =
        '<span class="dash-tile-ic">📁</span>' +
        '<span class="dash-tile-title">' + label + '</span>' +
        '<span class="dash-tile-sub">' + sub + '</span>';
    } else {
      elm = el('button', 'dash-row');
      elm.innerHTML =
        '<span class="dash-row-ic">📁</span>' +
        '<span class="dash-row-title">' + label + '</span>' +
        '<span class="dash-row-time">' + sub + '</span>';
    }
    elm.type = 'button';
    elm.addEventListener('click', function () { navigate(folder.id); });
    return elm;
  }
  function makeNoteEl(note, onOpen) {
    const k = noteKind(note);
    const title = esc(note.title || '未命名筆記');
    const time = esc(relTime(note.updatedAt));
    let elm;
    if (viewMode === 'card') {
      elm = el('button', 'dash-tile dash-tile-note');
      elm.innerHTML =
        '<span class="dash-tile-ic">' + k.icon + '</span>' +
        '<span class="dash-tile-title">' + title + '</span>' +
        '<span class="dash-tile-sub">' + time + '</span>';
    } else {
      elm = el('button', 'dash-row');
      elm.innerHTML =
        '<span class="dash-row-ic">' + k.icon + '</span>' +
        '<span class="dash-row-title">' + title + '</span>' +
        '<span class="dash-row-time">' + time + '</span>';
    }
    elm.type = 'button';
    elm.addEventListener('click', function () { onOpen(note.id); });
    return elm;
  }

  function renderBrowser(notes, folders, onOpen) {
    // 標籤篩選模式：忽略資料夾，平列所有帶該標籤的筆記
    if (tagFilter) return renderTagResults(notes, onOpen);

    // 目前資料夾若已被刪除，退回最上層
    if (curFolderId && !folderById(folders, curFolderId)) curFolderId = null;

    const box = el('div', 'dash-card');
    const head = el('div', 'dash-card-head dash-browser-head');

    // 左側：標題 + 麵包屑
    const nav = el('div', 'dash-crumbs');
    nav.appendChild(el('span', 'dash-crumb-home', '🗂 所有筆記'));
    const rootCrumb = el('button', 'dash-crumb' + (curFolderId ? '' : ' current'), '全部');
    rootCrumb.type = 'button';
    rootCrumb.addEventListener('click', function () { navigate(null); });
    nav.appendChild(rootCrumb);
    crumbPath(folders, curFolderId).forEach(function (f, i, arr) {
      nav.appendChild(el('span', 'dash-crumb-sep', '/'));
      const isLast = i === arr.length - 1;
      const c = el('button', 'dash-crumb' + (isLast ? ' current' : ''), esc(f.name || '未命名資料夾'));
      c.type = 'button';
      c.addEventListener('click', function () { navigate(f.id); });
      nav.appendChild(c);
    });
    head.appendChild(nav);

    // 右側：檢視切換
    head.appendChild(buildViewToggle());
    box.appendChild(head);

    // 內容
    const subs = foldersIn(folders, curFolderId);
    const ns = notesIn(notes, curFolderId);
    const body = el('div', viewMode === 'card' ? 'dash-grid' : 'dash-list');
    if (!subs.length && !ns.length) {
      body.appendChild(el('div', 'dash-empty', curFolderId ?
        '這個資料夾還是空的。' :
        '還沒有筆記，從左側「＋ 筆記」或上方的報告模式開始吧。'));
    }
    subs.forEach(function (f) { body.appendChild(makeFolderEl(f, countNotesDeep(notes, folders, f.id))); });
    ns.forEach(function (n) { body.appendChild(makeNoteEl(n, onOpen)); });
    box.appendChild(body);
    return box;
  }

  // 標籤篩選結果（平列所有帶 tagFilter 的筆記）
  function renderTagResults(notes, onOpen) {
    const box = el('div', 'dash-card');
    const head = el('div', 'dash-card-head dash-browser-head');
    const banner = el('div', 'dash-tag-banner');
    banner.innerHTML = '🏷 標籤：<b>#' + esc(tagFilter) + '</b>';
    const clear = el('button', 'dash-tag-clear', '✕ 清除篩選');
    clear.type = 'button';
    clear.addEventListener('click', function () { setTag(null); });
    banner.appendChild(clear);
    head.appendChild(banner);
    head.appendChild(buildViewToggle());
    box.appendChild(head);

    const key = tagFilter.toLowerCase();
    const matches = notes.filter(function (n) {
      if (!isMine(n)) return false;
      const tags = (global.MD && MD.extractTags) ? MD.extractTags(n.content || '') : [];
      return tags.some(function (t) { return t.toLowerCase() === key; });
    }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });

    const body = el('div', viewMode === 'card' ? 'dash-grid' : 'dash-list');
    if (!matches.length) {
      body.appendChild(el('div', 'dash-empty', '沒有帶有 #' + esc(tagFilter) + ' 的筆記。'));
    }
    matches.forEach(function (n) { body.appendChild(makeNoteEl(n, onOpen)); });
    box.appendChild(body);
    return box;
  }

  // ---- 進入點 ------------------------------------------------------------
  // paint() 依目前狀態（資料夾、檢視、標籤、輪播）重繪；render() 是外部入口，
  // 每次都會清掉標籤篩選（回到首頁 = 顯示全部）。
  function paint() {
    const root = document.getElementById('dashboard');
    if (!root || !lastOpts) return;
    const notes = lastOpts.notes, folders = lastOpts.folders, onOpen = lastOpts.onOpen;
    root.innerHTML = '';
    root.appendChild(el('div', 'dash-title', '📊 總覽'));
    root.appendChild(renderVizSplit(notes, folders, onOpen));
    const cloud = renderTagCloud(notes);
    if (cloud) root.appendChild(cloud);
    root.appendChild(renderBrowser(notes, folders, onOpen));
  }
  function render(opts) {
    const notes = (opts && opts.notes) || [];
    const folders = (opts && opts.folders) || [];
    const onOpen = (opts && opts.onOpen) || function () {};
    lastOpts = { notes: notes, folders: folders, onOpen: onOpen };
    tagFilter = null;
    paint();
  }

  global.Dashboard = { render: render, setTag: setTag };
})(window);
