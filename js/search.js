/* search.js — full-text search across note titles and content */
(function (global) {
  'use strict';

  const SNIPPET_BEFORE = 24;   // chars of context kept before a match
  const SNIPPET_AFTER = 46;    // …and after
  const MAX_SNIPPETS = 2;      // per note, so long notes don't dominate the list

  function fold(s) { return String(s || '').toLowerCase(); }

  // Split on whitespace: every term must appear somewhere in the note (AND),
  // which makes "nmap ad" usefully narrow rather than flooding results.
  function terms(query) {
    return fold(query).split(/\s+/).filter(function (t) { return t.length > 0; });
  }

  // Find every occurrence of a term. Plain indexOf, not regex — a note about
  // regex syntax or a `$1.50` price shouldn't blow up or silently match nothing.
  function positions(haystack, term) {
    const out = [];
    let i = haystack.indexOf(term);
    while (i >= 0) {
      out.push(i);
      i = haystack.indexOf(term, i + term.length);
    }
    return out;
  }

  // Rank: title hits beat body hits, earlier hits beat later, more hits beat fewer.
  // Recency breaks ties so the note you just touched surfaces first.
  function score(note, ts) {
    const title = fold(note.title);
    const body = fold(note.content);
    let total = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const inTitle = title.indexOf(t);
      const bodyHits = positions(body, t);
      if (inTitle < 0 && !bodyHits.length) return null; // AND: every term must hit
      if (inTitle >= 0) {
        total += 100;
        if (inTitle === 0) total += 50;                       // title starts with it
        if (title === t) total += 100;                        // exact title
      }
      total += Math.min(bodyHits.length, 5) * 4;
      if (bodyHits.length) total += Math.max(0, 10 - Math.floor(bodyHits[0] / 400));
    }
    return total;
  }

  // Pull readable context around the first matches, marking hit ranges so the
  // UI can highlight without re-searching (and without us building HTML here).
  function snippets(content, ts) {
    const body = String(content || '');
    const low = fold(body);
    const hits = [];
    ts.forEach(function (t) {
      positions(low, t).slice(0, MAX_SNIPPETS).forEach(function (at) {
        hits.push({ at: at, len: t.length });
      });
    });
    hits.sort(function (a, b) { return a.at - b.at; });

    const out = [];
    hits.forEach(function (h) {
      // Skip a hit already visible inside the previous snippet's window.
      const last = out[out.length - 1];
      if (last && h.at < last.end) {
        if (h.at + h.len <= last.end) last.marks.push({ at: h.at, len: h.len });
        return;
      }
      if (out.length >= MAX_SNIPPETS) return;
      out.push({
        start: Math.max(0, h.at - SNIPPET_BEFORE),
        end: Math.min(body.length, h.at + h.len + SNIPPET_AFTER),
        marks: [{ at: h.at, len: h.len }]
      });
    });

    return out.map(function (w) {
      // Collapse newlines so a snippet stays one tidy line in the sidebar.
      const text = body.slice(w.start, w.end);
      const parts = [];
      let cur = w.start;
      w.marks.forEach(function (m) {
        parts.push({ text: body.slice(cur, m.at), hit: false });
        parts.push({ text: body.slice(m.at, m.at + m.len), hit: true });
        cur = m.at + m.len;
      });
      parts.push({ text: body.slice(cur, w.end), hit: false });
      return {
        lead: w.start > 0,
        trail: w.end < body.length,
        parts: parts.filter(function (p) { return p.text.length; })
          .map(function (p) { return { text: p.text.replace(/\s+/g, ' '), hit: p.hit }; }),
        _len: text.length
      };
    });
  }

  // Mark hit ranges in a title the same way, for consistent highlighting.
  function titleParts(title, ts) {
    const t = String(title || '');
    const low = fold(t);
    const marks = [];
    ts.forEach(function (term) {
      positions(low, term).forEach(function (at) { marks.push({ at: at, len: term.length }); });
    });
    marks.sort(function (a, b) { return a.at - b.at; });
    const parts = [];
    let cur = 0;
    marks.forEach(function (m) {
      if (m.at < cur) return; // overlapping terms: keep the first
      if (m.at > cur) parts.push({ text: t.slice(cur, m.at), hit: false });
      parts.push({ text: t.slice(m.at, m.at + m.len), hit: true });
      cur = m.at + m.len;
    });
    if (cur < t.length) parts.push({ text: t.slice(cur), hit: false });
    return parts.length ? parts : [{ text: t, hit: false }];
  }

  // -> [{ note, score, titleParts, snippets }], best first
  function search(query, notes) {
    const ts = terms(query);
    if (!ts.length) return [];
    const out = [];
    (notes || []).forEach(function (n) {
      const s = score(n, ts);
      if (s == null) return;
      out.push({
        note: n,
        score: s,
        titleParts: titleParts(n.title || '未命名筆記', ts),
        snippets: snippets(n.content, ts)
      });
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.note.updatedAt || 0) - (a.note.updatedAt || 0);
    });
    return out;
  }

  global.Search = {
    search: search,
    terms: terms,
    snippets: snippets,
    titleParts: titleParts
  };
})(window);
