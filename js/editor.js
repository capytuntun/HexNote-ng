/* editor.js — lightweight markdown editing helpers + autocomplete for a textarea */
(function (global) {
  'use strict';

  const OPENERS = { '(': ')', '[': ']', '{': '}', '"': '"' };
  const WRAPPERS = { '*': '*', '_': '_', '`': '`', '~': '~' };
  const CLOSERS = { ')': true, ']': true, '}': true, '"': true };

  const CALLOUTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION',
    'RISK:CRITICAL', 'RISK:HIGH', 'RISK:MEDIUM', 'RISK:LOW', 'RISK:INFO'];
  const LANGS = ['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'python', 'java', 'c',
    'cpp', 'csharp', 'go', 'rust', 'ruby', 'php', 'kotlin', 'swift', 'dart', 'scala', 'r',
    'html', 'xml', 'css', 'scss', 'less', 'json', 'yaml', 'toml', 'ini', 'markdown', 'sql',
    'bash', 'shell', 'powershell', 'dockerfile', 'makefile', 'lua', 'perl', 'haskell',
    'diff', 'graphql', 'plaintext'];
  const MACHINE_SNIPPET = [
    '## $CURSOR — [IP]',
    '',
    '### Service Enumeration',
    '',
    '| Host | Ports Open |',
    '| --- | --- |',
    '| [IP] | **TCP:** <br> **UDP:** |',
    '',
    '```bash=',
    'nmap -sC -sV -p- [IP]',
    '```',
    '',
    '### Initial Access',
    '',
    '### local.txt',
    '```',
    '[ 在此貼上 local.txt 內容 ]',
    '```',
    '',
    '### Privilege Escalation',
    '',
    '### proof.txt',
    '```',
    '[ 在此貼上 proof.txt 內容 ]',
    '```',
    ''
  ].join('\n');
  const ADSET_SNIPPET = [
    '# Active Directory Set',
    '',
    '**Domain:** `$CURSOR`',
    '',
    '## Overview',
    '',
    '### Host Enumeration',
    '| Hostname | IP | Ports Open |',
    '| --- | --- | --- |',
    '| [HOST] | [IP] | **TCP:** |',
    '',
    '## AD Host — [HOST] ([IP])',
    '',
    '### Enumeration',
    '```bash=',
    'nmap -sC -sV [IP]',
    '```',
    '',
    '### Exploitation / Access',
    '',
    '### Credentials Collected',
    '',
    '### Proof',
    '```',
    '[ 在此貼上 proof 內容 ]',
    '```',
    '',
    '## Domain Compromise',
    ''
  ].join('\n');
  // Supplies note titles for the [[…]] autocomplete. app.js owns the note list
  // and registers a provider(query) -> [{id, title}] here.
  let noteProvider = null;
  function setNoteProvider(fn) { noteProvider = fn; }

  const SNIPPETS = [
    { cmd: 'machine', hint: '新增機器區塊', text: MACHINE_SNIPPET },
    { cmd: 'wiki', hint: '連結到其他筆記', text: '[[$CURSOR]]' },
    { cmd: 'adset', hint: '新增 AD Set 區塊', text: ADSET_SNIPPET },
    { cmd: 'risk', hint: '弱點（會列入總覽表）', text: '> [!RISK:HIGH] $CURSOR\n> ' },
    { cmd: 'note', hint: 'Note callout', text: '> [!NOTE]\n> $CURSOR' },
    { cmd: 'tip', hint: 'Tip callout', text: '> [!TIP]\n> $CURSOR' },
    { cmd: 'important', hint: 'Important callout', text: '> [!IMPORTANT]\n> $CURSOR' },
    { cmd: 'warning', hint: 'Warning callout', text: '> [!WARNING]\n> $CURSOR' },
    { cmd: 'caution', hint: 'Caution callout', text: '> [!CAUTION]\n> $CURSOR' },
    { cmd: 'code', hint: '程式碼區塊', text: '```$CURSOR\n\n```' },
    { cmd: 'codeln', hint: '程式碼（含行號）', text: '```$CURSOR=\n\n```' },
    { cmd: 'table', hint: '表格', text: '| 欄位 A | 欄位 B |\n| --- | --- |\n| $CURSOR |  |' },
    { cmd: 'todo', hint: '待辦清單', text: '- [ ] $CURSOR' },
    { cmd: 'quote', hint: '引用', text: '> $CURSOR' },
    { cmd: 'hr', hint: '分隔線', text: '\n---\n\n$CURSOR' },
    { cmd: 'h1', hint: '標題 1', text: '# $CURSOR' },
    { cmd: 'h2', hint: '標題 2', text: '## $CURSOR' },
    { cmd: 'h3', hint: '標題 3', text: '### $CURSOR' },
    { cmd: 'link', hint: '連結', text: '[$CURSOR](url)' },
    { cmd: 'image', hint: '圖片', text: '![$CURSOR](url)' },
    { cmd: 'bold', hint: '粗體', text: '**$CURSOR**' },
    { cmd: 'italic', hint: '斜體', text: '*$CURSOR*' }
  ];

  function attach(ta) {
    let popup = null;      // DOM element
    let items = [];        // current suggestions
    let index = 0;         // active suggestion
    let ctx = null;        // {type, query, from, to}

    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('input', onInput);
    ta.addEventListener('blur', function () { setTimeout(closePopup, 150); });
    ta.addEventListener('scroll', closePopup);
    ta.addEventListener('click', closePopup);

    let suppressAC = false; // don't reopen the popup for programmatic edits

    function fireChange() { ta.dispatchEvent(new Event('input', { bubbles: true })); }

    function replaceRange(start, end, text, curStart, curEnd) {
      const v = ta.value;
      ta.value = v.slice(0, start) + text + v.slice(end);
      const cs = (curStart == null) ? start + text.length : curStart;
      ta.selectionStart = cs;
      ta.selectionEnd = (curEnd == null) ? cs : curEnd;
      suppressAC = true;
      fireChange();          // runs onInput synchronously
      suppressAC = false;
    }

    // ---------------- key handling ----------------
    function onKeyDown(e) {
      if (popup) {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
        if (e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
        if (e.key === 'Tab') { e.preventDefault(); accept(items[index]); return; }
        if (e.key === 'Enter') {
          // For the bare-'>' popup, Enter continues the quote normally (pick with Tab/click).
          if (ctx && ctx.mode === 'quote') { closePopup(); }
          else { e.preventDefault(); accept(items[index]); return; }
        }
      }

      const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      const key = e.key;
      const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

      // Enter → smart list / quote continuation
      if (key === 'Enter' && !e.shiftKey && !popup) {
        if (smartEnter(v, s, en)) { e.preventDefault(); return; }
      }

      // Tab → indent / insert spaces
      if (key === 'Tab') {
        e.preventDefault();
        handleTab(e.shiftKey, v, s, en);
        return;
      }

      // Backspace → delete empty auto-pair
      if (key === 'Backspace' && s === en && s > 0) {
        const before = v[s - 1], after = v[s];
        if ((OPENERS[before] && OPENERS[before] === after) ||
            (before === '`' && after === '`') || (before === '"' && after === '"')) {
          e.preventDefault();
          replaceRange(s - 1, s + 1, '', s - 1, s - 1);
          return;
        }
      }

      if (!printable) return;

      // Over-type an auto-inserted closing char
      if (CLOSERS[key] && s === en && v[s] === key) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = s + 1;
        return;
      }

      // Wrap selection with * _ ` ~
      if (WRAPPERS[key] && s !== en) {
        e.preventDefault();
        const sel = v.slice(s, en);
        replaceRange(s, en, key + sel + WRAPPERS[key], s + 1, en + 1);
        return;
      }

      // Auto-pair brackets / quotes
      if (OPENERS[key]) {
        e.preventDefault();
        if (s !== en) {
          const sel = v.slice(s, en);
          replaceRange(s, en, key + sel + OPENERS[key], s + 1, en + 1);
        } else {
          // don't pair a quote right after a word char
          if (key === '"' && /\w/.test(v[s - 1] || '')) return void replaceRange(s, en, key);
          replaceRange(s, en, key + OPENERS[key], s + 1, s + 1);
        }
        return;
      }
    }

    function smartEnter(v, s, en) {
      if (s !== en) return false;
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(lineStart, s);
      let m;
      // task list
      if ((m = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/))) {
        if (m[4].trim() === '') { replaceRange(lineStart, s, m[1]); return true; }
        replaceRange(s, s, '\n' + m[1] + m[2] + ' [ ] '); return true;
      }
      // bullet list
      if ((m = line.match(/^(\s*)([-*+])\s+(.*)$/))) {
        if (m[3].trim() === '') { replaceRange(lineStart, s, m[1]); return true; }
        replaceRange(s, s, '\n' + m[1] + m[2] + ' '); return true;
      }
      // ordered list
      if ((m = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/))) {
        if (m[4].trim() === '') { replaceRange(lineStart, s, m[1]); return true; }
        replaceRange(s, s, '\n' + m[1] + (parseInt(m[2], 10) + 1) + m[3] + ' '); return true;
      }
      // blockquote (incl. callout body)
      if ((m = line.match(/^(\s*)((?:>\s?)+)(.*)$/))) {
        if (m[3].trim() === '') { replaceRange(lineStart, s, m[1]); return true; }
        const prefix = m[2].replace(/\s*$/, ' ');
        replaceRange(s, s, '\n' + m[1] + prefix); return true;
      }
      return false;
    }

    function handleTab(shift, v, s, en) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const multi = v.slice(s, en).indexOf('\n') >= 0;
      if (!shift && !multi && s === en) { replaceRange(s, en, '  '); return; }
      // indent / outdent affected lines
      const endLine = v.indexOf('\n', en);
      const blockEnd = endLine === -1 ? v.length : endLine;
      const block = v.slice(lineStart, blockEnd);
      let changed;
      if (shift) {
        changed = block.replace(/^ {1,2}/gm, '');
      } else {
        changed = block.replace(/^/gm, '  ');
      }
      replaceRange(lineStart, blockEnd, changed, lineStart, lineStart + changed.length);
    }

    // ---------------- autocomplete ----------------
    function onInput() {
      if (suppressAC) return; // ignore edits we made programmatically
      ctx = detectContext();
      if (!ctx) { closePopup(); return; }
      items = buildItems(ctx);
      if (!items.length) { closePopup(); return; }
      index = 0;
      openPopup();
    }

    function detectContext() {
      const caret = ta.selectionStart;
      if (caret !== ta.selectionEnd) return null;
      const v = ta.value;
      const lineStart = v.lastIndexOf('\n', caret - 1) + 1;
      const line = v.slice(lineStart, caret);
      let m;
      if ((m = line.match(/^```([a-zA-Z0-9+#.-]*)$/))) {
        return { type: 'lang', query: m[1].toLowerCase(), from: lineStart + 3, to: caret };
      }
      // '[[' -> offer note titles to link to
      if ((m = line.match(/\[\[([^\[\]|\n]*)$/))) {
        return { type: 'note', query: m[1], from: caret - m[1].length, to: caret };
      }
      // Fresh blockquote line ('>' or '> ') -> offer callout types
      if ((m = line.match(/^([ \t]*)>[ \t]*$/))) {
        return { type: 'callout', mode: 'quote', query: '', indent: m[1], lineStart: lineStart, from: caret, to: caret };
      }
      // Explicit '[!' partial -> filter callout types (':' so RISK:HIGH matches)
      if ((m = line.match(/\[!([a-zA-Z:]*)$/))) {
        return { type: 'callout', mode: 'bracket', query: m[1].toUpperCase(), from: caret - m[1].length, to: caret };
      }
      if ((m = line.match(/(?:^|\s)\/([a-zA-Z0-9]*)$/))) {
        return { type: 'slash', query: m[1].toLowerCase(), from: caret - m[1].length - 1, to: caret };
      }
      return null;
    }

    function buildItems(c) {
      if (c.type === 'lang') {
        return LANGS.filter(function (l) { return l.indexOf(c.query) === 0; })
          .slice(0, 8).map(function (l) { return { label: l, hint: 'language', kind: 'lang' }; });
      }
      if (c.type === 'callout') {
        return CALLOUTS.filter(function (l) { return l.indexOf(c.query) === 0; })
          .map(function (l) { return { label: l, hint: 'callout', kind: 'callout' }; });
      }
      if (c.type === 'slash') {
        return SNIPPETS.filter(function (sn) { return sn.cmd.indexOf(c.query) === 0; })
          .slice(0, 8).map(function (sn) { return { label: '/' + sn.cmd, hint: sn.hint, kind: 'slash', snip: sn }; });
      }
      if (c.type === 'note') {
        if (!noteProvider) return [];
        return noteProvider(c.query).slice(0, 8).map(function (n) {
          return { label: n.title || '未命名筆記', hint: '筆記', kind: 'note' };
        });
      }
      return [];
    }

    function accept(item) {
      if (!item || !ctx) { closePopup(); return; }
      if (item.kind === 'lang') {
        const from = ctx.from, to = ctx.to;
        const text = item.label + '\n\n```';
        replaceRange(from, to, text, from + item.label.length + 1, from + item.label.length + 1);
      } else if (item.kind === 'callout') {
        if (ctx.mode === 'quote') {
          // Replace the whole '> ' line with a complete callout header + body line.
          const text = ctx.indent + '> [!' + item.label + ']\n' + ctx.indent + '> ';
          replaceRange(ctx.lineStart, ctx.to, text);
        } else {
          // Absorb an already-present closing bracket (e.g. from auto-pairing '[')
          // so we don't leave a stray ']' behind.
          let to = ctx.to;
          if (ta.value[to] === ']') to += 1;
          replaceRange(ctx.from, to, item.label + ']\n> ');
        }
      } else if (item.kind === 'note') {
        // Swallow the ']]' auto-pairing already left behind, so we don't end up
        // with '[[Title]]]]', and drop the caret after the closing brackets.
        let to = ctx.to;
        if (ta.value.slice(to, to + 2) === ']]') to += 2;
        else if (ta.value[to] === ']') to += 1;
        replaceRange(ctx.from, to, item.label + ']]');
      } else if (item.kind === 'slash') {
        const t = item.snip.text;
        const idx = t.indexOf('$CURSOR');
        const clean = t.replace('$CURSOR', '');
        const cur = ctx.from + (idx < 0 ? clean.length : idx);
        replaceRange(ctx.from, ctx.to, clean, cur, cur);
      }
      closePopup();
    }

    function move(dir) {
      index = (index + dir + items.length) % items.length;
      renderPopup();
    }

    function openPopup() {
      if (!popup) {
        popup = document.createElement('div');
        popup.className = 'ac-popup';
        document.body.appendChild(popup);
      }
      renderPopup();
      positionPopup();
    }

    function renderPopup() {
      if (!popup) return;
      popup.innerHTML = '';
      items.forEach(function (it, i) {
        const el = document.createElement('div');
        el.className = 'ac-item' + (i === index ? ' active' : '');
        el.innerHTML = '<span>' + it.label + '</span><span class="hint">' + it.hint + '</span>';
        el.addEventListener('mousedown', function (e) { e.preventDefault(); accept(it); });
        el.addEventListener('mousemove', function () { index = i; highlight(); });
        popup.appendChild(el);
      });
    }
    function highlight() {
      if (!popup) return;
      Array.prototype.forEach.call(popup.children, function (c, i) {
        c.classList.toggle('active', i === index);
      });
    }

    function positionPopup() {
      const coords = caretCoords(ta, ta.selectionStart);
      const rect = ta.getBoundingClientRect();
      let left = rect.left + coords.left - ta.scrollLeft;
      let top = rect.top + coords.top - ta.scrollTop + coords.height + 4;
      left = Math.min(left, window.innerWidth - 220);
      if (top + 240 > window.innerHeight) top = rect.top + coords.top - ta.scrollTop - 244;
      popup.style.left = Math.max(8, left) + 'px';
      popup.style.top = Math.max(8, top) + 'px';
    }

    function closePopup() {
      if (popup) { popup.remove(); popup = null; }
      items = []; ctx = null;
    }
  }

  // ---- caret coordinates via mirror div ----
  const MIRROR_PROPS = ['boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
    'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace'];

  function caretCoords(el, position) {
    let div = caretCoords._div;
    if (!div) {
      div = document.createElement('div');
      caretCoords._div = div;
      document.body.appendChild(div);
    }
    const style = div.style;
    const computed = getComputedStyle(el);
    style.position = 'absolute';
    style.visibility = 'hidden';
    style.whiteSpace = 'pre-wrap';
    style.wordWrap = 'break-word';
    MIRROR_PROPS.forEach(function (p) { style[p] = computed[p]; });
    style.overflow = 'hidden';
    div.textContent = el.value.substring(0, position);
    const span = document.createElement('span');
    span.textContent = el.value.substring(position) || '.';
    div.appendChild(span);
    const coords = {
      top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
      left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
      height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) * 1.4
    };
    div.textContent = '';
    return coords;
  }

  global.Editor = {
    attach: attach,
    setNoteProvider: setNoteProvider,
    snippets: { machine: MACHINE_SNIPPET, adset: ADSET_SNIPPET }
  };
})(window);
