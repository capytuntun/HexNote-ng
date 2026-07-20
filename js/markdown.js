/* markdown.js — GitHub-flavored markdown + callouts + syntax highlight + image refs */
(function (global) {
  'use strict';

  const CALLOUTS = {
    note:      { title: 'Note' },
    tip:       { title: 'Tip' },
    important: { title: 'Important' },
    warning:   { title: 'Warning' },
    caution:   { title: 'Caution' }
  };

  // Findings written as `> [!RISK:HIGH] Title`. rank drives the summary sort.
  const RISK_LEVELS = {
    critical: { label: 'Critical', rank: 0 },
    high:     { label: 'High',     rank: 1 },
    medium:   { label: 'Medium',   rank: 2 },
    low:      { label: 'Low',      rank: 3 },
    info:     { label: 'Info',     rank: 4 }
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(text) {
    let slug = String(text)
      .toLowerCase()
      .trim()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\w一-鿿\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
    // Ensure the id is a valid CSS selector (must not start with a digit or '-'),
    // otherwise paged.js target-counter resolution (querySelector('#'+id)) throws.
    if (/^[0-9-]/.test(slug)) slug = 'sec-' + slug;
    return slug;
  }

  // ---- Callout block extension -------------------------------------------
  const calloutExtension = {
    name: 'callout',
    level: 'block',
    start: function (src) {
      const m = src.match(/^ {0,3}> ?\[!/m);
      return m ? m.index : undefined;
    },
    tokenizer: function (src) {
      const rule = /^( {0,3}> ?\[!(note|tip|important|warning|caution)\]([^\n]*)(?:\n|$)((?: {0,3}>[^\n]*(?:\n|$))*))/i;
      const match = rule.exec(src);
      if (!match) return;
      const type = match[2].toLowerCase();
      const title = (match[3] || '').trim();
      const lines = match[0].replace(/\n+$/, '').split('\n');
      lines.shift(); // drop the [!TYPE] marker line
      const body = lines.map(function (l) { return l.replace(/^ {0,3}> ?/, ''); }).join('\n');
      const token = {
        type: 'callout',
        raw: match[0],
        calloutType: type,
        title: title,
        tokens: []
      };
      this.lexer.blockTokens(body, token.tokens);
      return token;
    },
    renderer: function (token) {
      const meta = CALLOUTS[token.calloutType] || CALLOUTS.note;
      const title = token.title ? token.title : meta.title;
      const inner = this.parser.parse(token.tokens);
      return '<div class="callout callout-' + token.calloutType + '">' +
        '<div class="callout-title">' + escapeHtml(title) + '</div>' +
        '<div class="callout-content">' + inner + '</div></div>\n';
    }
  };

  // ---- Risk finding block: > [!RISK:HIGH] Title ---------------------------
  // Each finding gets a stable id so the PDF summary table can point at it and
  // resolve its page number with target-counter().
  let findingSeq = 0;   // reset per render, like usedSlugs below

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  const riskExtension = {
    name: 'risk',
    level: 'block',
    start: function (src) {
      const m = src.match(/^ {0,3}> ?\[!RISK:/im);
      return m ? m.index : undefined;
    },
    tokenizer: function (src) {
      const rule = /^( {0,3}> ?\[!RISK:(critical|high|medium|low|info)\]([^\n]*)(?:\n|$)((?: {0,3}>[^\n]*(?:\n|$))*))/i;
      const match = rule.exec(src);
      if (!match) return;
      const level = match[2].toLowerCase();
      const lines = match[0].replace(/\n+$/, '').split('\n');
      lines.shift(); // drop the [!RISK:x] marker line
      const body = lines.map(function (l) { return l.replace(/^ {0,3}> ?/, ''); }).join('\n');
      const token = {
        type: 'risk',
        raw: match[0],
        level: level,
        title: (match[3] || '').trim(),
        tokens: []
      };
      this.lexer.blockTokens(body, token.tokens);
      return token;
    },
    renderer: function (token) {
      const meta = RISK_LEVELS[token.level] || RISK_LEVELS.info;
      const n = ++findingSeq;
      const id = 'finding-' + n;
      const title = token.title || (meta.label + ' finding');
      const inner = this.parser.parse(token.tokens);
      return '<div class="finding finding-' + token.level + '" id="' + id + '"' +
        ' data-risk="' + token.level + '" data-finding="' + n + '">' +
        '<div class="finding-head">' +
        '<span class="risk-badge">' + escapeHtml(meta.label.toUpperCase()) + '</span>' +
        '<span class="finding-no">F-' + pad2(n) + '</span>' +
        '<span class="finding-title">' + escapeHtml(title) + '</span>' +
        '</div>' +
        '<div class="finding-content">' + inner + '</div></div>\n';
    }
  };

  // Pull the findings out of rendered HTML: [{id, level, rank, no, title}]
  function extractFindings(container) {
    return Array.prototype.map.call(container.querySelectorAll('.finding'), function (f) {
      const level = f.getAttribute('data-risk') || 'info';
      const meta = RISK_LEVELS[level] || RISK_LEVELS.info;
      const titleEl = f.querySelector('.finding-title');
      return {
        id: f.id,
        level: level,
        label: meta.label,
        rank: meta.rank,
        no: parseInt(f.getAttribute('data-finding'), 10) || 0,
        title: titleEl ? titleEl.textContent : ''
      };
    });
  }

  // ---- Wiki-link extension: [[筆記標題]] / [[筆記標題|顯示文字]] ------------
  // Resolution needs the live note list, which lives in app.js. It hands us a
  // lookup(title) -> note|null here; without one, links render as unresolved.
  let noteLookup = null;
  function setNoteLookup(fn) { noteLookup = fn; }

  const WIKI_RE = /^\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/;

  const wikiLinkExtension = {
    name: 'wikilink',
    level: 'inline',
    start: function (src) {
      const m = src.match(/\[\[/);
      return m ? m.index : undefined;
    },
    tokenizer: function (src) {
      const m = WIKI_RE.exec(src);
      if (!m) return;
      return {
        type: 'wikilink',
        raw: m[0],
        target: m[1].trim(),
        alias: (m[2] || '').trim()
      };
    },
    renderer: function (token) {
      const text = escapeHtml(token.alias || token.target);
      const note = noteLookup ? noteLookup(token.target) : null;
      if (note) {
        return '<a class="note-link" href="#" data-note-id="' + escapeHtml(note.id) + '"' +
          ' title="' + escapeHtml(note.title || '') + '">' + text + '</a>';
      }
      return '<a class="note-link missing" href="#" data-note-title="' + escapeHtml(token.target) + '"' +
        ' title="筆記「' + escapeHtml(token.target) + '」不存在——點擊建立">' + text + '</a>';
    }
  };

  // ---- Hashtag extension: #標籤 / #tag ------------------------------------
  // 標籤字元：英數、底線、連字號、斜線，以及中日文。須至少含一個「字母」，
  // 以排除 #123 這類純數字（純數字通常是 issue 編號而非標籤）。
  const TAG_CH = '0-9A-Za-z_/\\-\\u00c0-\\u024f\\u4e00-\\u9fff\\u3040-\\u30ff';
  const TAG_L  = 'A-Za-z_\\u00c0-\\u024f\\u4e00-\\u9fff\\u3040-\\u30ff';
  const HASHTAG_RE = new RegExp('^#([' + TAG_CH + ']*[' + TAG_L + '][' + TAG_CH + ']*)');

  const hashtagExtension = {
    name: 'hashtag',
    level: 'inline',
    start: function (src) {
      const m = src.match(/#/);
      return m ? m.index : undefined;
    },
    tokenizer: function (src) {
      const m = HASHTAG_RE.exec(src);
      if (!m) return;
      return { type: 'hashtag', raw: m[0], tag: m[1] };
    },
    renderer: function (token) {
      const t = escapeHtml(token.tag);
      return '<a class="hashtag" href="#" data-tag="' + t + '">#' + t + '</a>';
    }
  };

  // Collect every #tag in a markdown source (deduped, in first-seen order).
  // Requires a boundary before '#' so mid-word '#' (URLs, C#) is ignored.
  function extractTags(md) {
    const stripped = String(md || '')
      .replace(/```[\s\S]*?(?:```|$)/g, '')
      .replace(/`[^`\n]*`/g, '');
    const re = new RegExp('(^|[\\s(\\[（【「\'"])#([' + TAG_CH + ']*[' + TAG_L + '][' + TAG_CH + ']*)', 'g');
    const out = [], seen = {};
    let m;
    while ((m = re.exec(stripped))) {
      const tag = m[2];
      const key = tag.toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(tag); }
    }
    return out;
  }

  // Collect every [[target]] in a markdown source, in document order.
  // Fenced / inline code is stripped first so sample code never yields links.
  function extractLinks(md) {
    const stripped = String(md || '')
      .replace(/```[\s\S]*?(?:```|$)/g, '')
      .replace(/`[^`\n]*`/g, '');
    const re = /\[\[([^\[\]|\n]+)(?:\|[^\[\]\n]+)?\]\]/g;
    const out = [];
    let m;
    while ((m = re.exec(stripped))) out.push(m[1].trim());
    return out;
  }

  // ---- Custom renderer overrides -----------------------------------------
  const usedSlugs = {};
  const renderer = {
    heading: function (text, level) {
      let base = slugify(text);
      let slug = base, i = 1;
      while (usedSlugs[slug]) { slug = base + '-' + (i++); }
      usedSlugs[slug] = true;
      return '<h' + level + ' id="' + slug + '">' + text + '</h' + level + '>\n';
    },
    code: function (code, infostring) {
      // CodiMD-style options in the info string: ```js=  or  ```js=10  (line numbers, optional start)
      const info = (infostring || '').trim();
      let requested = info, lineNumbers = false, startLine = 1;
      const opt = info.match(/^([^\s=]*)=(\d*)$/);
      if (opt) {
        requested = opt[1];
        lineNumbers = true;
        if (opt[2]) startLine = parseInt(opt[2], 10);
      }
      // ```linux（含 linux=）當成 shell 高亮，避免 highlightAuto 誤判成 graphql，
      // 並標記 code-linux 讓 CSS 套用 Kali 終端配色。
      const ALIAS = { linux: 'bash', kali: 'bash' };
      const isKali = requested === 'linux' || requested === 'kali';
      const hlLang = ALIAS[requested] || requested;
      let out, lang = requested;
      try {
        if (hlLang && global.hljs && global.hljs.getLanguage(hlLang)) {
          out = global.hljs.highlight(code, { language: hlLang }).value;
          lang = requested;               // 顯示使用者寫的標籤（linux）
        } else if (global.hljs) {
          const r = global.hljs.highlightAuto(code);
          out = r.value;
          lang = r.language || '';
        } else {
          out = escapeHtml(code);
        }
      } catch (e) {
        out = escapeHtml(code);
      }
      const langSpan = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
      const tools = '<div class="code-tools">' +
        '<button class="code-copy" type="button" title="複製程式碼">複製</button>' + langSpan + '</div>';
      const kaliCls = isKali ? ' code-linux' : '';
      if (lineNumbers) {
        const count = code.replace(/\n$/, '').split('\n').length;
        const nums = [];
        for (let i = 0; i < count; i++) nums.push(startLine + i);
        const gutter = '<span class="ln-gutter" aria-hidden="true">' + nums.join('\n') + '</span>';
        return '<div class="code-block code-ln' + kaliCls + '">' + tools +
          '<pre class="code-pre">' + gutter +
          '<code class="hljs language-' + escapeHtml(lang) + '">' + out + '</code></pre></div>\n';
      }
      return '<div class="code-block' + kaliCls + '">' + tools +
        '<pre><code class="hljs language-' + escapeHtml(lang) + '">' + out + '</code></pre></div>\n';
    },
    image: function (href, title, text) {
      // Embedded PDF attachment: ![檔名](pdf:<id>) → same-origin <iframe> viewer.
      if (href && href.indexOf('pdf:') === 0) {
        const id = href.slice(4);
        const name = escapeHtml(text || 'PDF');
        return '<span class="pdf-embed">' +
          '<span class="pdf-embed-bar">' +
          '<span class="pdf-embed-name">📎 ' + name + '</span>' +
          '<a class="pdf-embed-open" data-pdf-id="' + escapeHtml(id) + '" href="#" target="_blank" rel="noopener">在新分頁開啟 ↗</a>' +
          '</span>' +
          '<iframe class="pdf-embed-frame" data-pdf-id="' + escapeHtml(id) + '" title="' + name + '" loading="lazy"></iframe>' +
          '</span>';
      }
      if (href && href.indexOf('img:') === 0) {
        const id = href.slice(4);
        const isLogo = (text === '__cover_logo__');
        const img = '<img data-img-id="' + escapeHtml(id) + '"' + (isLogo ? ' class="cover-logo"' : '') +
          ' alt="' + escapeHtml(text || '') + '"' +
          (title ? ' title="' + escapeHtml(title) + '"' : '') + '>';
        // The cover logo is centred as a block and never annotated, so leave it bare.
        if (isLogo) return img;
        // Stored images get a wrapper so the annotate button can sit over them.
        return '<span class="img-wrap">' + img +
          '<button class="img-annotate" type="button" data-annotate="' + escapeHtml(id) +
          '" title="標註這張圖片">✎ 標註</button></span>';
      }
      return '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(text || '') + '"' +
        (title ? ' title="' + escapeHtml(title) + '"' : '') + '>';
    }
  };

  marked.use({
    gfm: true, breaks: false,
    extensions: [riskExtension, calloutExtension, wikiLinkExtension, hashtagExtension],
    renderer: renderer
  });

  // ---- Public render -----------------------------------------------------
  function render(md) {
    for (const k in usedSlugs) delete usedSlugs[k]; // reset per render
    findingSeq = 0;
    const raw = marked.parse(md || '');
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ['id', 'data-img-id', 'data-note-id', 'data-note-title', 'data-annotate',
        'data-risk', 'data-finding', 'type', 'target', 'data-pdf-id', 'loading', 'data-tag'],
      ADD_TAGS: ['input', 'button', 'iframe'] // checkboxes, annotate button, PDF embed
    });
  }

  // Resolve <img data-img-id> placeholders to object URLs from IndexedDB.
  const urlCache = {}; // id -> objectURL

  // Drop a cached object URL so the next render re-reads the blob. The
  // annotation editor calls this after saving, otherwise the stale URL would
  // keep showing the un-annotated picture.
  function invalidateImage(id) {
    if (!urlCache[id]) return;
    try { URL.revokeObjectURL(urlCache[id]); } catch (e) {}
    delete urlCache[id];
  }

  function resolveImages(container) {
    const imgs = container.querySelectorAll('img[data-img-id]');
    imgs.forEach(function (img) {
      const id = img.getAttribute('data-img-id');
      if (!id) return;
      if (urlCache[id]) { img.src = urlCache[id]; return; }
      Store.getImage(id).then(function (rec) {
        if (rec && rec.blob) {
          const url = URL.createObjectURL(rec.blob);
          urlCache[id] = url;
          img.src = url;
        } else {
          img.alt = '[遺失的圖片]';
        }
      });
    });
    // Embedded PDFs load straight from the same-origin API URL (works with the
    // frame-src 'self' CSP; the browser sends the session cookie automatically).
    container.querySelectorAll('iframe[data-pdf-id]').forEach(function (f) {
      const id = f.getAttribute('data-pdf-id');
      if (id && !f.src) f.src = '/api/images/' + encodeURIComponent(id);
    });
    container.querySelectorAll('a[data-pdf-id]').forEach(function (a) {
      const id = a.getAttribute('data-pdf-id');
      if (id) a.href = '/api/images/' + encodeURIComponent(id);
    });
  }

  // Build TOC entries from rendered container: [{level, text, id}]
  function extractHeadings(container) {
    const nodes = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const list = [];
    nodes.forEach(function (h) {
      list.push({ level: parseInt(h.tagName.slice(1), 10), text: h.textContent, id: h.id });
    });
    return list;
  }

  // Convert data-img-id images inside a cloned node to data: URLs (for PDF export)
  function inlineImagesAsDataURL(container) {
    const imgs = Array.prototype.slice.call(container.querySelectorAll('img[data-img-id]'));
    return Promise.all(imgs.map(function (img) {
      const id = img.getAttribute('data-img-id');
      return Store.getImage(id).then(function (rec) {
        if (!rec || !rec.blob) return;
        return blobToDataURL(rec.blob).then(function (durl) {
          img.setAttribute('src', durl);
          img.removeAttribute('data-img-id');
        });
      });
    }));
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  global.MD = {
    render: render,
    resolveImages: resolveImages,
    extractHeadings: extractHeadings,
    inlineImagesAsDataURL: inlineImagesAsDataURL,
    slugify: slugify,
    escapeHtml: escapeHtml,
    setNoteLookup: setNoteLookup,
    extractLinks: extractLinks,
    extractTags: extractTags,
    invalidateImage: invalidateImage,
    extractFindings: extractFindings,
    riskLevels: RISK_LEVELS
  };
})(window);
