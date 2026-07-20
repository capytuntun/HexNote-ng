/* migrate.js — one-time import of notes left behind in the old IndexedDB store.
 *
 * Before the server existed, everything lived in the browser under
 * 'report_notes_db'. Those notes are otherwise unreachable now, so offer to
 * upload them into the logged-in account. The local copy is left untouched.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'report_notes_db';

  function openOld() {
    return new Promise(function (resolve) {
      let req;
      try { req = indexedDB.open(DB_NAME); } catch (e) { return resolve(null); }
      // If the database never existed, opening it creates an empty one — detect
      // that by the upgrade event and back out without leaving a stray db behind.
      let fresh = false;
      req.onupgradeneeded = function () { fresh = true; };
      req.onsuccess = function (e) {
        const db = e.target.result;
        if (fresh || !db.objectStoreNames.contains('notes')) { db.close(); return resolve(null); }
        resolve(db);
      };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }

  function readAll(db, store) {
    return new Promise(function (resolve) {
      if (!db.objectStoreNames.contains(store)) return resolve([]);
      try {
        const r = db.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function scan() {
    return openOld().then(function (db) {
      if (!db) return null;
      return Promise.all([readAll(db, 'notes'), readAll(db, 'folders'), readAll(db, 'images')])
        .then(function (r) {
          db.close();
          const data = { notes: r[0], folders: r[1], images: r[2] };
          return data.notes.length ? data : null;
        });
    }).catch(function () { return null; });
  }

  // Ids are reassigned by the server, so every reference has to be rewritten:
  // a note that still points at an old img: id would render a broken image.
  function upload(data, onProgress) {
    const imgMap = {}, folderMap = {};
    let done = 0;
    const total = data.images.length + data.folders.length + data.notes.length;
    const tick = () => onProgress && onProgress(++done, total);

    let chain = Promise.resolve();

    data.images.forEach(function (img) {
      chain = chain.then(function () {
        if (!img.blob) { tick(); return; }
        return Store.putImage(img.blob).then(function (newId) {
          imgMap[img.id] = newId;
          tick();
        }).catch(tick);
      });
    });

    // Parents first, so a child folder can point at an already-created parent.
    const ordered = [];
    const byId = {};
    data.folders.forEach(f => { byId[f.id] = f; });
    function place(f, seen) {
      if (!f || ordered.indexOf(f) >= 0) return;
      if (seen.indexOf(f.id) >= 0) return;         // cycle guard
      if (f.parentId && byId[f.parentId]) place(byId[f.parentId], seen.concat([f.id]));
      if (ordered.indexOf(f) < 0) ordered.push(f);
    }
    data.folders.forEach(f => place(f, []));

    ordered.forEach(function (f) {
      chain = chain.then(function () {
        return Store.createFolder(f.name, folderMap[f.parentId] || null).then(function (nf) {
          folderMap[f.id] = nf.id;
          tick();
        }).catch(tick);
      });
    });

    data.notes.forEach(function (n) {
      chain = chain.then(function () {
        let content = String(n.content || '');
        Object.keys(imgMap).forEach(function (oldId) {
          content = content.split('img:' + oldId).join('img:' + imgMap[oldId]);
        });
        return Store.createNote(n.title || '未命名筆記', folderMap[n.folderId] || null)
          .then(function (created) {
            created.content = content;
            created.meta = n.meta;
            return Store.updateNote(created);
          }).then(tick).catch(tick);
      });
    });

    return chain.then(function () { return { notes: data.notes.length }; });
  }

  // Offer once per account; "以後再說" just defers to the next login.
  function maybeOffer(user, onImported) {
    const key = 'migrated_' + user.username;
    try { if (localStorage.getItem(key)) return; } catch (e) {}

    scan().then(function (data) {
      if (!data) return;
      const bar = document.createElement('div');
      bar.className = 'migrate-bar';
      bar.innerHTML =
        '<span class="migrate-text">偵測到這台瀏覽器還存有 <b>' + data.notes.length +
        '</b> 篇舊的本機筆記（' + data.images.length + ' 張圖片）。要上傳到 <b>' +
        MD.escapeHtml(user.username) + '</b> 這個帳號嗎？</span>' +
        '<button class="btn migrate-go" type="button">上傳</button>' +
        '<button class="btn btn-ghost migrate-later" type="button">以後再說</button>' +
        '<button class="btn btn-ghost migrate-never" type="button">不再提示</button>';
      document.body.appendChild(bar);

      const text = bar.querySelector('.migrate-text');
      bar.querySelector('.migrate-later').addEventListener('click', () => bar.remove());
      bar.querySelector('.migrate-never').addEventListener('click', function () {
        try { localStorage.setItem(key, '1'); } catch (e) {}
        bar.remove();
      });
      bar.querySelector('.migrate-go').addEventListener('click', function () {
        bar.querySelectorAll('button').forEach(b => b.disabled = true);
        upload(data, function (d, t) { text.textContent = '上傳中… ' + d + ' / ' + t; })
          .then(function (r) {
            try { localStorage.setItem(key, '1'); } catch (e) {}
            text.textContent = '已上傳 ' + r.notes + ' 篇筆記。舊的本機資料仍保留著，確認無誤後可自行清除瀏覽器資料。';
            bar.querySelector('.migrate-go').remove();
            bar.querySelector('.migrate-never').remove();
            bar.querySelector('.migrate-later').disabled = false;
            bar.querySelector('.migrate-later').textContent = '關閉';
            if (onImported) onImported();
          })
          .catch(function (e) {
            text.textContent = '上傳失敗：' + (e && e.message || e);
            bar.querySelectorAll('button').forEach(b => b.disabled = false);
          });
      });
    });
  }

  global.Migrate = { maybeOffer: maybeOffer, scan: scan, upload: upload };
})(window);
