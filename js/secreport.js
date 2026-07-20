/* secreport.js — 資安院報告模式
 *
 * 一種以「步驟」為單位的報告產生器：每一步是一個文字描述框 + 一張圖片上傳。
 * 可用「＋ 新增文字描述框」不斷加步驟，每一步都能刪除。
 * 文字描述框上方有「範本」下拉；選擇某個範本會把對應的樣板文字帶入該描述框。
 * 目前內建的範本「確認 IP」會帶出：
 *     目標網域 :
 *     IP :
 */
(function (global) {
  'use strict';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // ---------------- 範本註冊表 ----------------
  // 每個範本一段樣板文字；選到時帶入該步驟的描述框。新增範本只要往這裡加一列。
  const SNIPPETS = [
    { id: '',            label: '（不使用範本）', text: '' },
    { id: 'confirm-ip',  label: '確認 IP',         text: '目標網域 : \nIP : ' },
    { id: 'recon',       label: '資訊蒐集',         text: '蒐集項目 : \n使用來源 / 工具 : \n發現 : ' },
    { id: 'browse',      label: '使用瀏覽器瀏覽',    text: '瀏覽網址 : \n觀察到的功能 : \n可疑之處 : ' },
    { id: 'nmap',        label: '使用工具掃描 (Nmap)', text: '指令 : nmap -sC -sV -p- \n開放連接埠 : \n服務 / 版本 : ' },
    { id: 'tools',       label: '使用工具',         text: '工具名稱 : \n用途 : \n指令 / 參數 : \n結果 : ' },
    { id: 'burp',        label: '使用 Burp Suite',  text: '攔截的請求 : \n修改的參數 : \n觀察到的回應 : \n結論 : ' },
    { id: 'dirbust',     label: '目錄 / 檔案列舉',   text: '工具 : (gobuster / ffuf / dirb)\n使用字典 : \n找到的路徑 : ' },
    { id: 'password',    label: '嘗試密碼猜測',      text: '目標服務 : \n帳號 : \n使用字典 / 密碼 : \n工具 : (hydra / medusa)\n結果 : ' },
    { id: 'found-vuln',  label: '發現漏洞',         text: '漏洞名稱 : \n風險等級 : (高 / 中 / 低)\n影響範圍 : \n重現步驟 : \n證據 : ' },
    { id: 'exploit',     label: '漏洞利用',         text: '利用方式 : \nPayload : \n取得的權限 / 資料 : ' },
    { id: 'privesc',     label: '提權',            text: '目前權限 : \n提權手法 : \n提權後權限 : ' },
    { id: 'remediation', label: '修補建議',         text: '問題 : \n建議修補方式 : \n參考資料 : ' }
  ];
  function snippetById(id) {
    return SNIPPETS.filter(function (s) { return s.id === id; })[0] || SNIPPETS[0];
  }

  // ---------------- DOM 小工具（沿用 OSCP 表單風格）----------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function field(labelText, inputEl) {
    const f = el('div', 'oscp-field');
    f.appendChild(el('label', null, labelText));
    f.appendChild(inputEl);
    return f;
  }

  // 保留描述框裡的換行：Markdown 預設會把單一換行併成一行（軟換行），
  // 導致像「目標網域 : / IP :」到 PDF 變成同一行。這裡在非程式碼區塊的每個
  // 單一換行前補兩個空白（Markdown 硬換行），並讓 ``` 程式碼區塊原樣保留。
  function preserveBreaks(text) {
    const parts = String(text).split(/(```[\s\S]*?```)/g);
    return parts.map(function (part, i) {
      if (i % 2 === 1) return '\n\n' + part + '\n\n';         // 程式碼區塊：原樣，前後留空行
      return part.replace(/([^\n])\n(?!\n)/g, '$1  \n');       // 單一換行 → 硬換行
    }).join('').replace(/^\n+|\n+$/g, '');
  }

  // ---------------- 報告產生 ----------------
  // meta: { title, date, unit, ip, domain, vulnType, impact }；steps: [{ text, imgId }]
  // 回傳 { title, content }
  function generate(meta, steps) {
    const L = [];
    L.push('# ' + (meta.title || '報告'));
    L.push('');
    if (meta.unit) L.push('**受測單位：** ' + meta.unit + '  ');
    if (meta.domain) L.push('**目標網域：** ' + meta.domain + '  ');
    if (meta.ip) L.push('**IP：** ' + meta.ip + '  ');
    if (meta.vulnType) L.push('**弱點類型：** ' + meta.vulnType + '  ');
    if (meta.impact) L.push('**衝擊度：** ' + meta.impact + '  ');
    L.push('**日期：** ' + (meta.date || today()) + '  ');
    L.push('');
    L.push('---');
    L.push('');

    let n = 0;
    steps.forEach(function (s) {
      const text = (s.text || '').replace(/\s+$/, '');
      if (!text && !s.imgId) return;   // 整步都空就略過
      n += 1;
      L.push('## 步驟 ' + n);
      L.push('');
      if (text) { L.push(preserveBreaks(text)); L.push(''); }
      if (s.imgId) {
        L.push('![步驟 ' + n + ' 圖片](img:' + s.imgId + ')');
        L.push('');
      }
    });
    if (n === 0) { L.push('*(尚未填寫任何步驟)*'); L.push(''); }

    return { title: meta.title || '報告', content: L.join('\n') };
  }

  // ---------------- 表單 UI ----------------
  function showForm(onCreate) {
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal oscp-form sec-form');
    modal.appendChild(el('div', 'modal-title', '資安院報告模式'));
    modal.appendChild(el('div', 'oscp-hint',
      '以步驟為單位撰寫：每一步是一個文字描述框加一張圖片。可隨時「＋ 新增文字描述框」，' +
      '每一步都能刪除。描述框上方的「範本」可帶入常用樣板（如「確認 IP」）。'));

    // 基本資訊
    const titleInput = el('input');
    titleInput.type = 'text';
    titleInput.placeholder = '例如：某某系統滲透測試報告';
    titleInput.value = '資安院報告';
    modal.appendChild(field('報告標題', titleInput));

    const dateInput = el('input');
    dateInput.type = 'date';
    dateInput.value = today();
    modal.appendChild(field('日期', dateInput));

    // 步驟容器
    const stepsWrap = el('div', 'sec-steps');
    stepsWrap.dataset.list = 'steps';
    modal.appendChild(field('報告步驟', stepsWrap));

    function renumber() {
      const heads = stepsWrap.querySelectorAll('.sec-step-no');
      Array.prototype.forEach.call(heads, function (h, i) {
        h.textContent = '文字描述框 ' + (i + 1);
      });
    }

    function addStep() {
      const step = el('div', 'sec-step');

      // 標頭：編號 + 刪除
      const head = el('div', 'sec-step-head');
      head.appendChild(el('span', 'sec-step-no', '文字描述框'));
      const del = el('button', 'oscp-x', '✕');
      del.type = 'button';
      del.title = '刪除這個文字描述框';
      del.addEventListener('click', function () { step.remove(); renumber(); });
      head.appendChild(del);
      step.appendChild(head);

      // 範本下拉
      const tplSel = el('select', 'oscp-select sec-tpl');
      SNIPPETS.forEach(function (s) {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.label;
        tplSel.appendChild(o);
      });
      const tplRow = el('div', 'sec-tpl-row');
      tplRow.appendChild(el('span', 'sec-tpl-label', '範本'));
      tplRow.appendChild(tplSel);
      step.appendChild(tplRow);

      // 文字描述框
      const ta = el('textarea', 'sec-text');
      ta.placeholder = '在此描述這個步驟…';
      ta.rows = 4;
      step.appendChild(ta);

      // 選範本時把樣板文字帶入描述框（已有內容則接在後面，避免蓋掉）
      tplSel.addEventListener('change', function () {
        const snip = snippetById(tplSel.value);
        if (!snip.text) return;
        const cur = ta.value.replace(/\s+$/, '');
        ta.value = cur ? (cur + '\n' + snip.text) : snip.text;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      });

      // 圖片上傳（一張）
      const fileInput = el('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.className = 'sec-img';
      const imgRow = el('div', 'sec-img-row');
      imgRow.appendChild(el('span', 'sec-img-label', '圖片'));
      imgRow.appendChild(fileInput);
      const name = el('span', 'sec-img-name', '');
      imgRow.appendChild(name);
      fileInput.addEventListener('change', function () {
        const f = fileInput.files && fileInput.files[0];
        name.textContent = f ? f.name : '';
      });
      step.appendChild(imgRow);

      stepsWrap.appendChild(step);
      renumber();
      return { step: step, textarea: ta, fileInput: fileInput };
    }

    // 預設先給一個步驟
    addStep();

    const add = el('button', 'oscp-add', '＋ 新增文字描述框');
    add.type = 'button';
    add.addEventListener('click', function () {
      const s = addStep();
      s.textarea.focus();
    });
    modal.appendChild(add);

    // 動作列
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn modal-cancel', '取消'); cancel.type = 'button';
    const submit = el('button', 'btn btn-primary', '產生報告'); submit.type = 'button';
    actions.appendChild(cancel); actions.appendChild(submit);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    cancel.addEventListener('click', close);

    submit.addEventListener('click', function () {
      const meta = { title: titleInput.value.trim(), date: dateInput.value };
      // 逐步收集文字與圖片檔
      const rows = Array.prototype.map.call(stepsWrap.querySelectorAll('.sec-step'), function (stepEl) {
        const ta = stepEl.querySelector('.sec-text');
        const fi = stepEl.querySelector('.sec-img');
        return { text: ta ? ta.value : '', file: (fi && fi.files && fi.files[0]) || null };
      });

      submit.disabled = true;
      submit.textContent = '產生中…';

      // 一張一張上傳圖片（沒有 Store 就退化成純文字）
      const canUpload = global.Store && global.Store.putImage;
      const jobs = rows.map(function (r) {
        if (r.file && canUpload) {
          return global.Store.putImage(r.file)
            .then(function (id) { return { text: r.text, imgId: id }; })
            .catch(function () { return { text: r.text, imgId: null }; });
        }
        return Promise.resolve({ text: r.text, imgId: null });
      });

      Promise.all(jobs).then(function (steps) {
        const report = generate(meta, steps);
        close();
        if (onCreate) onCreate(report.title, report.content);
      });
    });

    setTimeout(function () { titleInput.focus(); titleInput.select(); }, 30);
  }

  global.SecReport = { showForm: showForm, generate: generate, snippets: SNIPPETS };
})(window);
