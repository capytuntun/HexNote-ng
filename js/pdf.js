/* pdf.js — paginate a note with paged.js, preview it in-app, then print / save as PDF.
 *
 * The preview renders the very same document that gets printed: it is written into
 * an iframe rather than a popup, so theme and watermark changes can be re-rendered
 * in place instead of spawning a window per attempt.
 */
(function (global) {
  'use strict';

  function baseHref() {
    // Absolute base URL of the app so the print document can load local vendor assets.
    return location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---------------- themes ----------------
  // Each theme only re-skins the cover and the accent colour; the content rules
  // below are shared so a note paginates identically whichever theme is picked.
  const THEMES = [
    {
      id: 'tech', name: '科技風（淺色）',
      accent: '#0068d6', rule: '#ccd6e0', wm: 'rgba(15, 27, 40, .07)',
      cover: [
        '.pdf-cover { background: #f3f6f9; color: #0f1b28;',
        '  border-left: 10mm solid #0068d6; }',
        '.pdf-cover .kicker { color: #0068d6; }',
        '.pdf-cover h1 { font-weight: 700; }',
        '.pdf-cover .rule { background: #0068d6; }',
        '.pdf-cover .meta { color: #5b6b7c; }',
        '.pdf-cover-logo { background: #fff; border: 1px solid #ccd6e0; }'
      ]
    },
    {
      id: 'blue', name: '經典藍（漸層）',
      accent: '#1f6feb', rule: '#d0d7de', wm: 'rgba(31, 35, 40, .08)',
      cover: [
        '.pdf-cover { background: linear-gradient(135deg, #1f6feb 0%, #0b3d91 100%); color: #fff; }',
        '.pdf-cover .kicker { opacity: .8; }',
        '.pdf-cover .rule { background: #fff; opacity: .8; }',
        '.pdf-cover .meta { opacity: .9; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'mono', name: '極簡黑白',
      accent: '#111111', rule: '#cccccc', wm: 'rgba(0, 0, 0, .07)',
      cover: [
        '.pdf-cover { background: #fff; color: #111; border-top: 3pt solid #111;',
        '  border-bottom: 3pt solid #111; }',
        '.pdf-cover .kicker { color: #666; }',
        '.pdf-cover h1 { font-weight: 700; }',
        '.pdf-cover .rule { background: #111; }',
        '.pdf-cover .meta { color: #555; }',
        '.pdf-cover-logo { background: #fff; border: 1px solid #ddd; }'
      ]
    },
    {
      id: 'dark', name: '深色封面',
      accent: '#1f6feb', rule: '#d0d7de', wm: 'rgba(15, 27, 40, .08)',
      cover: [
        '.pdf-cover { background: #0b1017; color: #e8f1fb; }',
        '.pdf-cover .kicker { color: #3d9bff; }',
        '.pdf-cover .rule { background: #3d9bff; }',
        '.pdf-cover .meta { color: #8496a8; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'red', name: '紅隊（暗紅）',
      accent: '#c62828', rule: '#e0cccc', wm: 'rgba(120, 20, 25, .09)',
      cover: [
        '.pdf-cover { background: linear-gradient(160deg, #1b0508 0%, #4a0d15 100%); color: #ffe9ea;',
        '  border-left: 10mm solid #c62828; }',
        '.pdf-cover .kicker { color: #ff6b6b; }',
        '.pdf-cover h1 { font-weight: 800; }',
        '.pdf-cover .rule { background: #c62828; }',
        '.pdf-cover .meta { color: #d9a3a6; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'corporate', name: '企業襯線（白底）',
      accent: '#1a4d8f', rule: '#d5dce5', wm: 'rgba(26, 77, 143, .08)',
      cover: [
        '.pdf-cover { background: #fff; color: #14243a; justify-content: flex-start;',
        '  padding-top: 60mm; border-bottom: 16mm solid #1a4d8f; }',
        '.pdf-cover .kicker { color: #1a4d8f; font-size: 10pt; }',
        '.pdf-cover h1 { font-size: 30pt; font-weight: 400; letter-spacing: .01em;',
        '  font-family: Georgia, "Times New Roman", "Noto Serif CJK TC", "Songti TC", "PMingLiU", serif; }',
        '.pdf-cover .rule { background: #1a4d8f; height: 2pt; width: 90pt; }',
        '.pdf-cover .meta { color: #5a6c85;',
        '  font-family: Georgia, "Times New Roman", "Noto Serif CJK TC", "Songti TC", "PMingLiU", serif; }',
        '.pdf-cover-logo { background: #fff; border: 1px solid #d5dce5; }'
      ]
    },
    {
      id: 'terminal', name: '終端機（等寬綠字）',
      accent: '#12813f', rule: '#cfd8d2', wm: 'rgba(10, 40, 20, .08)',
      cover: [
        '.pdf-cover { background: #05080a; color: #7ee787;',
        '  background-image: repeating-linear-gradient(0deg, rgba(126,231,135,.05) 0 1px, transparent 1px 4px); }',
        '.pdf-cover .kicker { color: #3fb950; letter-spacing: .18em;',
        '  font-family: "SFMono-Regular", Consolas, monospace; }',
        '.pdf-cover .kicker::before { content: "> "; }',
        '.pdf-cover h1 { font-size: 28pt; font-weight: 700;',
        '  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }',
        '.pdf-cover .rule { background: #3fb950; }',
        '.pdf-cover .meta { color: #6e9a76; font-family: "SFMono-Regular", Consolas, monospace; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'teal', name: '青綠漸層',
      accent: '#0a7ea4', rule: '#cfe0e6', wm: 'rgba(10, 78, 92, .08)',
      cover: [
        '.pdf-cover { background: linear-gradient(135deg, #0a7ea4 0%, #05323f 100%); color: #eafcff; }',
        '.pdf-cover .kicker { color: #7fdbe8; }',
        '.pdf-cover .rule { background: #7fdbe8; }',
        '.pdf-cover .meta { color: #a9d8e2; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'blueprint', name: '藍圖格線',
      accent: '#0d3b66', rule: '#ccd8e4', wm: 'rgba(13, 59, 102, .09)',
      cover: [
        '.pdf-cover { background: #0d3b66; color: #eaf3ff;',
        '  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.13) 0 1px, transparent 1px 10mm),',
        '                    repeating-linear-gradient(90deg, rgba(255,255,255,.13) 0 1px, transparent 1px 10mm); }',
        '.pdf-cover .kicker { color: #9ec5ef; font-family: "SFMono-Regular", Consolas, monospace; }',
        '.pdf-cover h1 { font-weight: 700; }',
        '.pdf-cover .rule { background: #eaf3ff; }',
        '.pdf-cover .meta { color: #b9d3ee; font-family: "SFMono-Regular", Consolas, monospace; }',
        '.pdf-cover-logo { background: #fff; }'
      ]
    },
    {
      id: 'frame', name: '框線（正式）',
      accent: '#333333', rule: '#d4d4d4', wm: 'rgba(0, 0, 0, .06)',
      cover: [
        '.pdf-cover { background: #fff; color: #1a1a1a; align-items: center; text-align: center;',
        '  outline: 1pt solid #1a1a1a; outline-offset: -14mm;',
        '  border: 4pt double #1a1a1a; }',
        '.pdf-cover .kicker { color: #777; }',
        '.pdf-cover h1 { font-size: 28pt; font-weight: 600;',
        '  font-family: Georgia, "Times New Roman", "Noto Serif CJK TC", "Songti TC", "PMingLiU", serif; }',
        '.pdf-cover .rule { background: #1a1a1a; height: 1pt; width: 120pt; }',
        '.pdf-cover .meta { color: #555; }',
        '.pdf-cover-logo { background: #fff; align-self: center; border: 1px solid #e0e0e0; }'
      ]
    },
    {
      id: 'amber', name: '琥珀（暖色）',
      accent: '#a56a09', rule: '#e8dcc4', wm: 'rgba(120, 80, 10, .08)',
      cover: [
        '.pdf-cover { background: #fdf6e7; color: #3d2c0a;',
        '  border-top: 12mm solid #a56a09; }',
        '.pdf-cover .kicker { color: #a56a09; }',
        '.pdf-cover h1 { font-weight: 700; }',
        '.pdf-cover .rule { background: #a56a09; }',
        '.pdf-cover .meta { color: #7a6435; }',
        '.pdf-cover-logo { background: #fff; border: 1px solid #e8dcc4; }'
      ]
    }
  ];
  function themeById(id) {
    return THEMES.filter(function (t) { return t.id === id; })[0] || THEMES[0];
  }

  const WATERMARK_PRESETS = ['DRAFT', 'CONFIDENTIAL', 'INTERNAL USE ONLY'];

  // FIRST's TLP 2.0 標準配色：一律黑底，文字顏色代表等級。
  // `color` is the official on-black badge colour used on the cover. `ink` is for
  // the page header, which prints straight onto white paper — a page margin box
  // fills its entire area, so giving it a black background paints a slab across
  // the top of every page. TLP:CLEAR therefore needs black ink, not white.
  const TLP = [
    { id: '', label: '無' },
    { id: 'TLP:CLEAR', label: 'TLP:CLEAR', color: '#ffffff', ink: '#111111' },
    { id: 'TLP:GREEN', label: 'TLP:GREEN', color: '#33ff00', ink: '#0f7a1e' },
    { id: 'TLP:AMBER', label: 'TLP:AMBER', color: '#ffc000', ink: '#a06b00' },
    { id: 'TLP:AMBER+STRICT', label: 'TLP:AMBER+STRICT', color: '#ffc000', ink: '#a06b00' },
    { id: 'TLP:RED', label: 'TLP:RED', color: '#ff2b2b', ink: '#d40b12' }
  ];
  function tlpById(id) { return TLP.filter(function (t) { return t.id === id; })[0] || TLP[0]; }

  const RISK_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
  const RISK_PRINT = {
    critical: { bg: '#fdeaea', border: '#f0a9a9', fg: '#a01019' },
    high:     { bg: '#fdeee4', border: '#f3bd97', fg: '#c0480a' },
    medium:   { bg: '#fdf3dc', border: '#eccb79', fg: '#a56a09' },
    low:      { bg: '#e9f3fd', border: '#a9cdf0', fg: '#17609e' },
    info:     { bg: '#eef1f4', border: '#c3ced9', fg: '#566878' }
  };

  // Findings summary: severity-ordered table whose page numbers resolve through
  // the same target-counter() mechanism the TOC uses.
  function buildFindingsSummary(clone) {
    const items = MD.extractFindings(clone);
    if (!items.length) return '';
    items.sort(function (a, b) { return a.rank - b.rank || a.no - b.no; });
    const counts = {};
    items.forEach(function (f) { counts[f.level] = (counts[f.level] || 0) + 1; });

    let html = '<section class="pdf-summary"><h1 class="summary-heading">Findings Summary</h1>';
    html += '<div class="summary-counts">';
    RISK_ORDER.forEach(function (lvl) {
      if (!counts[lvl]) return;
      html += '<span class="sc sc-' + lvl + '"><b>' + counts[lvl] + '</b> ' +
        MD.escapeHtml(MD.riskLevels[lvl].label) + '</span>';
    });
    html += '</div>';
    html += '<table class="summary-table"><thead><tr>' +
      '<th class="c-no">#</th><th class="c-sev">Severity</th>' +
      '<th class="c-title">Finding</th><th class="c-page">Page</th>' +
      '</tr></thead><tbody>';
    items.forEach(function (f) {
      html += '<tr>' +
        '<td class="c-no">F-' + (f.no < 10 ? '0' + f.no : f.no) + '</td>' +
        '<td class="c-sev"><span class="sev sev-' + f.level + '">' +
        MD.escapeHtml(f.label.toUpperCase()) + '</span></td>' +
        '<td class="c-title"><a href="#' + f.id + '">' + MD.escapeHtml(f.title) + '</a></td>' +
        '<td class="c-page"><a class="pageref" href="#' + f.id + '"></a></td>' +
        '</tr>';
    });
    html += '</tbody></table></section>';
    return html;
  }

  function buildTOC(headings) {
    // Only include h1-h3 in the TOC to keep it clean.
    const items = headings.filter(function (h) { return h.level <= 3 && h.id; });
    if (!items.length) return '';
    let html = '<nav class="pdf-toc"><h1 class="toc-heading">目錄</h1><ul class="toc">';
    items.forEach(function (h) {
      html += '<li class="toc-l' + h.level + '">' +
        '<a href="#' + h.id + '">' +
        '<span class="toc-text">' + MD.escapeHtml(h.text) + '</span>' +
        '<span class="toc-leader"></span>' +
        '</a></li>';
    });
    html += '</ul></nav>';
    return html;
  }

  // A CSS string literal — quotes and backslashes would otherwise break out of content:"".
  function cssString(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  // paged.js renders each sheet as a .pagedjs_page element, so the watermark is a
  // pseudo-element on those rather than an @page background (which browsers ignore).
  //
  // This CSS is injected only once paged.js has finished laying out — it rewrites
  // the stylesheets it is given, and drops the :first-of-type exclusion on the way
  // through, which stamped the watermark across the cover too.
  function watermarkCSS(text, theme) {
    if (!text) return '';
    return [
      '.pagedjs_page { position: relative; }',
      '.pagedjs_page::after {',
      '  content: ' + cssString(text) + ';',
      '  position: absolute; top: 50%; left: 50%;',
      '  transform: translate(-50%, -50%) rotate(-35deg);',
      '  font-size: 64pt; font-weight: 800; letter-spacing: .06em; white-space: nowrap;',
      '  color: ' + theme.wm + '; pointer-events: none; z-index: 400;',
      '  -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      /* the cover has its own artwork — stamping it there just muddies the design */
      '.pagedjs_page:first-of-type::after { content: none; }'
    ].join('\n');
  }

  // Print CSS driving paged.js pagination, cover, TOC leaders, page numbers.
  function printCSS(title, theme, opts) {
    const safe = String(title).replace(/["\\]/g, '');
    const tlp = tlpById(opts.tlp);
    const tlpHeader = tlp.id
      ? '  @top-left { content: "' + tlp.id.replace(/["\\]/g, '') + '"; font-size: 8pt;' +
        ' font-weight: 700; letter-spacing: .04em; color: ' + tlp.ink + '; }'
      : '';
    return [
      ':root { --pdf-accent: ' + theme.accent + '; --pdf-rule: ' + theme.rule + '; }',
      '@page {',
      '  size: A4;',
      '  margin: 22mm 20mm 20mm 20mm;',
      '  @bottom-center { content: counter(page); font-size: 9pt; color: #888; }',
      '  @top-right { content: "' + safe + '"; font-size: 8pt; color: #bbb; }',
      tlpHeader,
      '}',
      '@page cover { margin: 0; @top-right { content: none; } @bottom-center { content: none; }',
      '  @top-left { content: none; } }',
      '@page toc { @top-right { content: none; } @bottom-center { content: none; } }',
      /* optional:每個 H1 大章節從新的一頁開始（第一個除外，否則會多一張空白頁） */
      (opts.breakH1 ? '.pdf-content h1 { break-before: page; }' : ''),
      (opts.breakH1 ? '.pdf-content > h1:first-child { break-before: avoid; }' : ''),
      'html, body { margin: 0; padding: 0; }',
      'body { font-family: -apple-system, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif;',
      '  color: #24292f; font-size: 11pt; line-height: 1.7;',
      '  -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      /* cover — the skin comes from the theme block appended below */
      '.pdf-cover { page: cover; break-after: page; height: 100vh; display: flex;',
      '  flex-direction: column; justify-content: center; align-items: flex-start;',
      '  padding: 40mm 24mm; box-sizing: border-box; }',
      '.pdf-cover-logo { max-height: 78pt; max-width: 60%; margin-bottom: 22pt;',
      '  padding: 8pt 12pt; border-radius: 0; align-self: flex-start; }',
      '.pdf-cover .kicker { font-size: 12pt; letter-spacing: .3em; text-transform: uppercase; }',
      '.pdf-cover h1 { font-size: 34pt; line-height: 1.2; margin: 14pt 0 0; border: 0; }',
      '.pdf-cover .meta { margin-top: 28pt; font-size: 11pt; }',
      /* fixed label column so the two dates line up despite unequal label lengths */
      '.pdf-cover .meta .k { display: inline-block; min-width: 96pt; letter-spacing: .04em;',
      '  text-transform: uppercase; font-size: 9pt; opacity: .75; }',
      '.pdf-cover .meta .v { font-variant-numeric: tabular-nums; }',
      '.pdf-cover .rule { width: 60pt; height: 4pt; margin: 18pt 0; }',
      /* toc */
      '.pdf-toc { page: toc; break-after: page; }',
      /* restart page numbering at the first content page (cover + toc are not counted) */
      '.pdf-content { counter-reset: page 1; }',
      '.toc-heading { font-size: 20pt; border-bottom: 2px solid var(--pdf-accent); padding-bottom: 6pt; }',
      'ul.toc { list-style: none; padding: 0; margin: 16pt 0 0; }',
      'ul.toc li { margin: 0; }',
      'ul.toc a { display: flex; align-items: flex-end; text-decoration: none; color: #24292f;',
      '  padding: 4pt 0; font-size: 11pt; }',
      'ul.toc .toc-leader { flex: 1; border-bottom: 1px dotted #b0b0b0; margin: 0 6px 3px; }',
      'ul.toc a::after { content: target-counter(attr(href), page); color: #555; font-variant-numeric: tabular-nums; }',
      'ul.toc .toc-l1 > a { font-weight: 600; }',
      'ul.toc .toc-l2 > a { padding-left: 14pt; }',
      'ul.toc .toc-l3 > a { padding-left: 28pt; font-size: 10pt; color: #57606a; }',
      /* content — mirror the on-screen markdown-body but tuned for print */
      '.pdf-content h1, .pdf-content h2 { border-bottom: 1px solid var(--pdf-rule); padding-bottom: 4pt; }',
      '.pdf-content h1 { font-size: 20pt; margin: 22pt 0 10pt; }',
      '.pdf-content h2 { font-size: 16pt; margin: 20pt 0 8pt; }',
      '.pdf-content h3 { font-size: 13pt; margin: 16pt 0 6pt; }',
      '.pdf-content h1, .pdf-content h2, .pdf-content h3 { break-after: avoid; }',
      '.pdf-content a { color: var(--pdf-accent); text-decoration: none; }',
      '.pdf-content p, .pdf-content li { orphans: 2; widows: 2; }',
      '.pdf-content img { max-width: 100%; }',
      '.pdf-content .code-block { position: relative; margin: 0 0 10pt; break-inside: avoid; }',
      '.pdf-content .code-block .code-tools { position: absolute; top: 0; right: 0; }',
      '.pdf-content .code-copy, .pdf-content .img-annotate { display: none; }',
      '.pdf-content .code-block .code-lang {',
      '  font-size: 7pt; padding: 2pt 6pt; color: #6a737d; background: #eaeef2;',
      '  border-radius: 0; text-transform: uppercase; letter-spacing: .05em; }',
      '.pdf-content pre { background: #f6f8fa; padding: 10pt; border-radius: 0; margin: 0;',
      '  font-size: 9pt; white-space: pre-wrap; word-wrap: break-word; break-inside: avoid; }',
      '.pdf-content pre.code-pre { display: flex; white-space: pre; }',
      '.pdf-content .ln-gutter { flex: 0 0 auto; text-align: right; padding-right: 8pt;',
      '  margin-right: 8pt; border-right: 1px solid #d0d7de; color: #9aa5b1; }',
      '.pdf-content .code-pre > code { flex: 1 1 auto; white-space: pre-wrap; word-wrap: break-word; }',
      '.pdf-content code { font-family: "SFMono-Regular", Consolas, monospace; }',
      '.pdf-content p code, .pdf-content li code { background: rgba(175,184,193,.2);',
      '  padding: .1em .3em; border-radius: 0; font-size: 9.5pt; }',
      '.pdf-content blockquote { margin: 8pt 0; padding: 0 12pt; color: #57606a;',
      '  border-left: 3px solid #d0d7de; }',
      '.pdf-content table { border-collapse: collapse; width: 100%; font-size: 10pt; break-inside: avoid; }',
      '.pdf-content th, .pdf-content td { border: 1px solid #d0d7de; padding: 5pt 8pt; }',
      '.pdf-content th { background: #f6f8fa; }',
      /* callouts in print — kept in step with the on-screen palette in app.css:
         no border, no left bar, rounded corners */
      '.pdf-content .callout { border: 0; border-radius: 6px;',
      '  padding: 8pt 12pt; margin: 10pt 0; break-inside: avoid; }',
      '.pdf-content .callout-title { font-weight: 700; margin-bottom: 3pt; font-size: 10.5pt; }',
      '.pdf-content .callout-note { background: #e4f0fe; }',
      '.pdf-content .callout-note .callout-title { color: #0b63c5; }',
      '.pdf-content .callout-tip { background: #e2f6e9; }',
      '.pdf-content .callout-tip .callout-title { color: #12813f; }',
      '.pdf-content .callout-important { background: #efe7fc; }',
      '.pdf-content .callout-important .callout-title { color: #6b35c9; }',
      '.pdf-content .callout-warning { background: #fdf1dc; }',
      '.pdf-content .callout-warning .callout-title { color: #a56a09; }',
      '.pdf-content .callout-caution { background: #fde7e7; }',
      '.pdf-content .callout-caution .callout-title { color: #c62828; }',
      '.pdf-content .callout-content > :first-child { margin-top: 0; }',
      '.pdf-content .callout-content > :last-child { margin-bottom: 0; }',
      /* TLP badge on the cover */
      '.pdf-cover { position: relative; }',
      '.tlp-badge { position: absolute; top: 16mm; right: 16mm; background: #000;',
      '  font-family: "SFMono-Regular", Consolas, monospace; font-weight: 700; font-size: 10pt;',
      '  letter-spacing: .06em; padding: 4pt 9pt; }',
      /* findings summary page */
      '.pdf-summary { page: toc; break-after: page; }',
      '.summary-heading { font-size: 20pt; border-bottom: 2px solid var(--pdf-accent); padding-bottom: 6pt; }',
      '.summary-counts { display: flex; gap: 8pt; flex-wrap: wrap; margin: 14pt 0 12pt; }',
      '.summary-counts .sc { font-size: 9pt; padding: 3pt 8pt; border: 1px solid; }',
      '.summary-counts .sc b { font-size: 11pt; }',
      '.summary-table { border-collapse: collapse; width: 100%; font-size: 10pt; }',
      '.summary-table th, .summary-table td { border: 1px solid #d0d7de; padding: 5pt 8pt; text-align: left; }',
      '.summary-table th { background: #f6f8fa; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; }',
      '.summary-table .c-no { width: 44pt; font-family: "SFMono-Regular", Consolas, monospace; }',
      '.summary-table .c-sev { width: 74pt; }',
      '.summary-table .c-page { width: 40pt; text-align: right; font-variant-numeric: tabular-nums; }',
      '.summary-table a { color: #24292f; text-decoration: none; }',
      '.summary-table a.pageref::after { content: target-counter(attr(href), page); }',
      '.summary-table .sev { font-size: 8pt; font-weight: 800; letter-spacing: .06em; color: #fff;',
      '  padding: 2pt 6pt; font-family: "SFMono-Regular", Consolas, monospace; }',
      /* findings in the body */
      '.pdf-content .finding { border: 1px solid; border-left-width: 4pt; margin: 0 0 12pt;',
      '  break-inside: avoid; }',
      '.pdf-content .finding-head { display: flex; align-items: center; gap: 8pt;',
      '  padding: 6pt 10pt; border-bottom: 1px solid; }',
      '.pdf-content .risk-badge { color: #fff; font-size: 7.5pt; font-weight: 800; letter-spacing: .08em;',
      '  padding: 2pt 6pt; font-family: "SFMono-Regular", Consolas, monospace; }',
      '.pdf-content .finding-no { font-family: "SFMono-Regular", Consolas, monospace; font-size: 8.5pt;',
      '  font-weight: 700; }',
      '.pdf-content .finding-title { font-weight: 700; font-size: 11pt; }',
      '.pdf-content .finding-content { padding: 8pt 10pt; }',
      '.pdf-content .finding-content > :first-child { margin-top: 0; }',
      '.pdf-content .finding-content > :last-child { margin-bottom: 0; }'
    ].concat(RISK_ORDER.map(function (lvl) {
      const c = RISK_PRINT[lvl];
      return '.pdf-content .finding-' + lvl + ' { background: ' + c.bg + '; border-color: ' + c.border +
        '; border-left-color: ' + c.fg + '; }\n' +
        '.pdf-content .finding-' + lvl + ' .finding-head { border-bottom-color: ' + c.border + '; }\n' +
        '.pdf-content .finding-' + lvl + ' .risk-badge { background: ' + c.fg + '; }\n' +
        '.pdf-content .finding-' + lvl + ' .finding-no { color: ' + c.fg + '; }\n' +
        '.summary-table .sev-' + lvl + ' { background: ' + c.fg + '; }\n' +
        '.summary-counts .sc-' + lvl + ' { background: ' + c.bg + '; border-color: ' + c.border +
        '; color: ' + c.fg + '; }';
    })).concat(theme.cover).join('\n');
  }

  // Build the printable document.
  //
  // Note there is no inline <script> here: the Content-Security-Policy forbids
  // inline scripts, and this document inherits the policy of the page that
  // creates it. boot() below installs paged.js from the outside instead.
  function buildDoc(parts, opts) {
    const theme = themeById(opts.theme);
    const base = baseHref();
    const title = parts.title;
    const meta = opts.meta || {};
    const tlp = tlpById(opts.tlp);

    // Only the fields that were actually filled in reach the cover.
    const rows = [];
    if (meta.client) rows.push(['Client', meta.client]);
    if (meta.version) rows.push(['Version', meta.version]);
    if (meta.author) rows.push(['Author', meta.author]);
    rows.push(['Generated', parts.created]);
    rows.push(['Last Updated', parts.updated]);
    const metaHTML = rows.map(function (r) {
      return '<span class="k">' + MD.escapeHtml(r[0]) + '</span>' +
        '<span class="v">' + MD.escapeHtml(r[1]) + '</span>';
    }).join('<br>');

    return '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">' +
      '<base href="' + base + '">' +
      '<title>' + MD.escapeHtml(title) + '</title>' +
      '<link rel="stylesheet" href="' + base + 'vendor/hljs-github.min.css">' +
      '<style>' + printCSS(title, theme, opts) + '</style>' +
      '</head><body>' +
      '<section class="pdf-cover">' +
      (tlp.id ? '<div class="tlp-badge" style="color:' + tlp.color + '">' +
        MD.escapeHtml(tlp.id) + '</div>' : '') +
      (parts.logoSrc ? '<img class="pdf-cover-logo" src="' + parts.logoSrc + '">' : '') +
      '<div class="kicker">Report</div>' +
      '<h1>' + MD.escapeHtml(title) + '</h1>' +
      '<div class="rule"></div>' +
      '<div class="meta">' + metaHTML + '</div>' +
      '</section>' +
      parts.toc +
      parts.summary +
      '<article class="pdf-content markdown-body">' + parts.contentHTML + '</article>' +
      '</body></html>';
  }

  // Write `html` into a same-origin document and start paged.js on it from here.
  //
  // Doing it from the outside means the print document needs no inline script (CSP
  // forbids those) and lets us hand paged.js real function references instead of
  // serialising callbacks into a string.
  function boot(doc, html, opts, onDone) {
    const theme = themeById(opts.theme);
    const wmCSS = watermarkCSS(opts.watermark, theme);
    doc.open();
    doc.write(html);
    doc.close();
    const win = doc.defaultView;
    win.PagedConfig = {
      auto: true,
      after: function () {
        // Injected only once pagination is done — paged.js rewrites the
        // stylesheets it is handed and drops the cover exclusion on the way.
        if (wmCSS) {
          const s = doc.createElement('style');
          s.textContent = wmCSS;
          doc.head.appendChild(s);
        }
        if (opts.autoPrint) setTimeout(function () { win.focus(); win.print(); }, 400);
        if (onDone) onDone(doc);
      }
    };
    const s = doc.createElement('script');
    s.src = baseHref() + 'vendor/paged.polyfill.js';
    doc.head.appendChild(s);
  }

  // Snapshot the rendered preview into everything the print document needs.
  function prepare(note, previewEl) {
    const clone = previewEl.cloneNode(true);
    // strip interactive controls from the export
    Array.prototype.forEach.call(clone.querySelectorAll('.code-copy, .img-annotate'),
      function (b) { b.remove(); });
    return MD.inlineImagesAsDataURL(clone).then(function () {
      // pull the cover logo out of the body and onto the cover page
      let logoSrc = null;
      const logoImg = clone.querySelector('img.cover-logo');
      if (logoImg) { logoSrc = logoImg.getAttribute('src'); logoImg.remove(); }
      return {
        title: note.title || '未命名筆記',
        logoSrc: logoSrc,
        toc: buildTOC(MD.extractHeadings(clone)),
        summary: buildFindingsSummary(clone),
        findings: MD.extractFindings(clone).length,
        contentHTML: clone.innerHTML,
        created: formatDate(Date.now()),
        updated: formatDate(note.updatedAt || Date.now())
      };
    });
  }

  // ---------------- preview dialog ----------------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const LS_THEME = 'pdfTheme', LS_WM = 'pdfWatermark', LS_H1 = 'pdfBreakH1';
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // opts: { meta, onMeta } — cover fields live on the note, so they are handed in
  // and saved back through app.js rather than written to the store from here.
  function showPreview(note, previewEl, opts) {
    return prepare(note, previewEl).then(function (parts) {
      buildPreviewUI(parts, opts || {});
    });
  }

  function buildPreviewUI(parts, o) {
    let theme = lsGet(LS_THEME, 'tech');
    let watermark = lsGet(LS_WM, '');
    let breakH1 = lsGet(LS_H1, '0') === '1';
    const meta = Object.assign({ client: '', version: '', author: '', tlp: '' }, o.meta || {});

    const overlay = el('div', 'modal-overlay pv-overlay');
    const modal = el('div', 'modal pv-modal');

    const head = el('div', 'pv-head');
    head.appendChild(el('div', 'modal-title', '列印預覽'));
    const pages = el('div', 'pv-pages', '排版中…');
    head.appendChild(pages);
    modal.appendChild(head);

    // ---- controls ----
    const bar = el('div', 'pv-bar');

    const themeWrap = el('label', 'pv-ctl');
    themeWrap.appendChild(el('span', null, '樣式'));
    const themeSel = document.createElement('select');
    THEMES.forEach(function (t) {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.name;
      themeSel.appendChild(o);
    });
    themeSel.value = theme;
    themeWrap.appendChild(themeSel);
    bar.appendChild(themeWrap);

    const wmWrap = el('label', 'pv-ctl');
    wmWrap.appendChild(el('span', null, '浮水印'));
    const wmSel = document.createElement('select');
    [['', '無']].concat(WATERMARK_PRESETS.map(function (w) { return [w, w]; }))
      .concat([['__custom', '自訂…']])
      .forEach(function (p) {
        const o = document.createElement('option');
        o.value = p[0]; o.textContent = p[1];
        wmSel.appendChild(o);
      });
    const isPreset = !watermark || WATERMARK_PRESETS.indexOf(watermark) >= 0;
    wmSel.value = isPreset ? watermark : '__custom';
    wmWrap.appendChild(wmSel);
    bar.appendChild(wmWrap);

    const wmText = el('input', 'pv-wm-text');
    wmText.type = 'text';
    wmText.placeholder = '浮水印文字';
    wmText.value = isPreset ? '' : watermark;
    wmText.hidden = isPreset;
    bar.appendChild(wmText);

    const tlpWrap = el('label', 'pv-ctl');
    tlpWrap.appendChild(el('span', null, 'TLP'));
    const tlpSel = document.createElement('select');
    TLP.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.label;
      tlpSel.appendChild(opt);
    });
    tlpSel.value = meta.tlp || '';
    tlpWrap.appendChild(tlpSel);
    bar.appendChild(tlpWrap);

    const h1Wrap = el('label', 'pv-check');
    const h1Box = document.createElement('input');
    h1Box.type = 'checkbox';
    h1Box.checked = breakH1;
    h1Wrap.appendChild(h1Box);
    h1Wrap.appendChild(document.createTextNode(' H1 章節從新頁開始'));
    bar.appendChild(h1Wrap);
    modal.appendChild(bar);

    // ---- cover fields ----
    const cover = el('div', 'pv-bar pv-cover-bar');
    cover.appendChild(el('span', 'pv-bar-label', '封面欄位'));
    const fields = {};
    [['client', '客戶名稱'], ['version', '版本（如 v1.0）'], ['author', '作者']].forEach(function (f) {
      const i = el('input', 'pv-meta-input');
      i.type = 'text';
      i.placeholder = f[1];
      i.value = meta[f[0]] || '';
      fields[f[0]] = i;
      cover.appendChild(i);
    });
    modal.appendChild(cover);

    // ---- preview surface ----
    const stage = el('div', 'pv-stage');
    const frame = document.createElement('iframe');
    frame.className = 'pv-frame';
    frame.setAttribute('title', '列印預覽');
    stage.appendChild(frame);
    modal.appendChild(stage);

    const actions = el('div', 'modal-actions');
    const hint = el('span', 'pv-hint', '在列印視窗選擇「另存為 PDF」');
    actions.appendChild(hint);
    const cancel = el('button', 'btn modal-cancel', '關閉');
    const print = el('button', 'btn btn-primary', '⭳ 列印 / 另存 PDF');
    [cancel, print].forEach(function (b) { b.type = 'button'; actions.appendChild(b); });
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // ---- render ----
    let renderToken = 0;
    function render() {
      const mine = ++renderToken;
      pages.textContent = '排版中…';
      print.disabled = true;
      const opts = {
        theme: theme, watermark: watermark, autoPrint: false,
        tlp: meta.tlp, breakH1: breakH1, meta: meta
      };
      // document.write (rather than srcdoc) keeps the frame same-origin, so the
      // vendor script loads under the app's own policy.
      boot(frame.contentDocument, buildDoc(parts, opts), opts, function (doc) {
        if (mine !== renderToken) return;   // a newer render superseded this one
        const n = doc.querySelectorAll('.pagedjs_page').length;
        pages.textContent = (n ? '共 ' + n + ' 頁' : '') +
          (parts.findings ? ' · ' + parts.findings + ' 個弱點' : '');
        print.disabled = false;
      });
    }

    themeSel.addEventListener('change', function () {
      theme = themeSel.value;
      lsSet(LS_THEME, theme);
      render();
    });
    function applyWatermark() {
      watermark = (wmSel.value === '__custom') ? wmText.value.trim() : wmSel.value;
      lsSet(LS_WM, watermark);
      render();
    }
    wmSel.addEventListener('change', function () {
      wmText.hidden = wmSel.value !== '__custom';
      if (wmSel.value === '__custom') { wmText.focus(); if (!wmText.value.trim()) return; }
      applyWatermark();
    });
    let wmTimer = null;
    wmText.addEventListener('input', function () {
      if (wmTimer) clearTimeout(wmTimer);
      wmTimer = setTimeout(applyWatermark, 400);
    });

    h1Box.addEventListener('change', function () {
      breakH1 = h1Box.checked;
      lsSet(LS_H1, breakH1 ? '1' : '0');
      render();
    });

    // Cover fields and TLP belong to the note, so they persist through app.js.
    function saveMeta() {
      if (o.onMeta) o.onMeta(Object.assign({}, meta));
    }
    tlpSel.addEventListener('change', function () {
      meta.tlp = tlpSel.value;
      saveMeta();
      render();
    });
    let metaTimer = null;
    Object.keys(fields).forEach(function (k) {
      fields[k].addEventListener('input', function () {
        meta[k] = fields[k].value.trim();
        if (metaTimer) clearTimeout(metaTimer);
        metaTimer = setTimeout(function () { saveMeta(); render(); }, 400);
      });
    });

    print.addEventListener('click', function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    });

    function close() {
      renderToken++;              // ignore any in-flight paged.js callback
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.target && e.target.tagName === 'INPUT') return; // let text fields handle keys
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    cancel.addEventListener('click', close);

    render();
  }

  // Legacy direct path: paginate in a popup and print immediately, no preview.
  function exportNote(note, previewEl) {
    return prepare(note, previewEl).then(function (parts) {
      const meta = note.meta || {};
      const opts = {
        theme: lsGet(LS_THEME, 'tech'), watermark: lsGet(LS_WM, ''), autoPrint: true,
        tlp: meta.tlp, breakH1: lsGet(LS_H1, '0') === '1', meta: meta
      };
      const w = global.open('', '_blank');
      if (!w) throw new Error('無法開啟新視窗，請允許彈出視窗後再試。');
      boot(w.document, buildDoc(parts, opts), opts, null);
    });
  }

  global.PDF = {
    showPreview: showPreview,
    exportNote: exportNote,
    themes: THEMES,
    watermarks: WATERMARK_PRESETS
  };
})(window);
