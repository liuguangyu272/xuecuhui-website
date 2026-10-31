/* ============================================================
   内容台逻辑
   ============================================================ */

let DATA = null;
let modalSaveHandler = null;

/* ---------- 弹窗 ---------- */

function buildModal(opts) {
  const mask = document.getElementById('modalMask');
  document.getElementById('modalTitle').textContent = opts.title || '';
  document.getElementById('modalSub').textContent = opts.sub || '';

  const fieldsEl = document.getElementById('modalFields');
  fieldsEl.innerHTML = (opts.fields || []).map(f => {
    const id = 'f_' + f.key;
    const ph = esc(f.placeholder || '');

    if (f.type === 'image') {
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <div class="img-picker">
          <div class="img-picker__preview" id="prev_${f.key}">无</div>
          <div class="img-picker__ctrl">
            <div class="img-picker__row">
              <input class="input" id="${id}" data-key="${f.key}" value="${esc(f.value || '')}" placeholder="${ph}">
              <button class="btn btn--sm" type="button" data-pick="${f.key}">选择图片</button>
            </div>
            <p class="img-picker__hint">支持 PNG / JPG / GIF / WEBP，单张 ≤ 8MB。点「选择图片」上传后会自动填好地址；也可以直接粘外链。</p>
          </div>
        </div>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden id="file_${f.key}">
      </div>`;
    }

    if (f.type === 'textarea') {
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <textarea class="input" id="${id}" data-key="${f.key}" placeholder="${ph}" style="min-height:${f.tall ? 140 : 84}px">${esc(f.value || '')}</textarea></div>`;
    }
    if (f.type === 'select') {
      const o = (f.options || []).map(x => {
        const v = typeof x === 'string' ? x : x.value;
        const t = typeof x === 'string' ? x : x.text;
        return `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(t)}</option>`;
      }).join('');
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <select class="input" id="${id}" data-key="${f.key}">${o}</select></div>`;
    }
    if (f.type === 'checkbox') {
      return `<div class="field" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="${id}" data-key="${f.key}" ${f.value ? 'checked' : ''} style="width:15px;height:15px;accent-color:#14564a">
        <label for="${id}" style="margin:0;letter-spacing:0;font-size:13px;color:var(--ink-2)">${esc(f.label)}</label></div>`;
    }
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>
      <input class="input" id="${id}" data-key="${f.key}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${ph}"></div>`;
  }).join('');

  bindImagePickers(fieldsEl);

  modalSaveHandler = opts.onSave;
  mask.classList.add('is-open');
  const first = fieldsEl.querySelector('input:not([type=file]),textarea,select');
  if (first) setTimeout(() => first.focus(), 100);
}

/* ---------- 图片上传 ---------- */

function updatePreview(el, url) {
  if (!el) return;
  const u = (url || '').trim();
  if (u) {
    el.style.backgroundImage = "url('" + u.replace(/'/g, "%27") + "')";
    el.textContent = '';
    el.classList.add('has-img');
  } else {
    el.style.backgroundImage = '';
    el.textContent = '无';
    el.classList.remove('has-img');
  }
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch('api/upload', {
      method: 'POST',
      headers: { 'X-Token': CONFIG.consoleCode },
      body: fd
    });
  } catch (e) {
    throw new Error('连不上上传服务');
  }
  let json = null;
  try { json = await res.json(); } catch (e) { /* 非 JSON */ }
  if (!json) throw new Error('服务器返回异常（' + res.status + '）');
  if (!res.ok || !json.ok) throw new Error(json.error || ('上传失败 ' + res.status));
  return json.url;
}

function bindImagePickers(root) {
  root.querySelectorAll('[data-pick]').forEach(btn => {
    const key = btn.dataset.pick;
    const fileInput = root.querySelector('#file_' + key);
    const textInput = root.querySelector('[data-key="' + key + '"]');
    const prev = root.querySelector('#prev_' + key);
    if (!fileInput || !textInput) return;

    updatePreview(prev, textInput.value);
    textInput.addEventListener('input', () => updatePreview(prev, textInput.value));

    btn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const origin = btn.textContent;
      btn.disabled = true;
      btn.textContent = '上传中…';
      try {
        const url = await uploadImage(f);
        textInput.value = url;
        updatePreview(prev, url);
        btn.textContent = '已上传';
        setTimeout(() => { btn.textContent = origin; btn.disabled = false; }, 1400);
      } catch (e) {
        alert('上传失败：' + e.message +
          '\n\n可以手动填写图片地址，或确认服务器的上传服务是否在运行。');
        btn.textContent = origin;
        btn.disabled = false;
      }
      fileInput.value = '';
    });
  });
}

function readModal() {
  const out = {};
  document.querySelectorAll('#modalFields [data-key]').forEach(el => {
    out[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return out;
}

function closeModal() {
  document.getElementById('modalMask').classList.remove('is-open');
  modalSaveHandler = null;
}

/* ---------- 渲染 ---------- */

function refreshStats() {
  document.getElementById('statAnn').textContent = DATA.announcements.length;
  document.getElementById('statAct').textContent = DATA.activities.length;
  document.getElementById('statTool').textContent =
    (DATA.departments || []).length + ' / ' + DATA.tools.length;
}

function renderAnnTable() {
  const tb = document.getElementById('annTable');
  const list = DATA.announcements.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return b.date.localeCompare(a.date);
  });

  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty-cell">还没有公告。</td></tr>';
    return;
  }

  tb.innerHTML = list.map(a => `
    <tr>
      <td class="mono-cell">${esc(a.date)}</td>
      <td><div class="cell-title">${esc(a.title)}</div><div class="cell-sub">${esc(a.excerpt)}</div></td>
      <td data-label="分类"><span class="tag tag--${tagClass(a.tag)}">${esc(a.tag)}</span></td>
      <td class="cell-dim" data-label="置顶">${a.pinned ? '是' : '—'}</td>
      <td class="table__actions">
        <button class="btn btn--sm" data-ann-edit="${esc(a.id)}">编辑</button>
        <button class="btn btn--sm btn--danger" data-ann-del="${esc(a.id)}">删除</button>
      </td>
    </tr>`).join('');
}

function renderActTable() {
  const tb = document.getElementById('actTable');
  if (!DATA.activities.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty-cell">还没有活动。</td></tr>';
    return;
  }
  tb.innerHTML = DATA.activities.slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => `
    <tr>
      <td class="mono-cell">${esc(a.date)}</td>
      <td><div class="cell-title">${esc(a.title)}</div>
          <div class="cell-sub">${esc(a.timePlace)}</div></td>
      <td class="cell-dim" data-label="海报">${a.poster ? '有' : '—'}</td>
      <td class="cell-dim" data-label="回放">${a.videoUrl ? '有' : '—'}</td>
      <td class="table__actions">
        <button class="btn btn--sm" data-act-edit="${esc(a.id)}">编辑</button>
        <button class="btn btn--sm btn--danger" data-act-del="${esc(a.id)}">删除</button>
      </td>
    </tr>`).join('');
}

function renderDeptTable() {
  const tb = document.getElementById('deptTable');
  const list = DATA.departments || [];
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="4" class="empty-cell">还没有部门。</td></tr>';
    return;
  }
  tb.innerHTML = list.map(d => `
    <tr>
      <td class="cell-title">${esc(d.name)}</td>
      <td class="cell-dim" data-label="职责">${esc(d.duty)}</td>
      <td class="cell-sub" style="-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">${esc(d.desc)}</td>
      <td class="table__actions">
        <button class="btn btn--sm" data-dept-edit="${esc(d.id)}">编辑</button>
        <button class="btn btn--sm btn--danger" data-dept-del="${esc(d.id)}">删除</button>
      </td>
    </tr>`).join('');
}

function renderSocialTable() {
  const tb = document.getElementById('socialTable');
  const list = (DATA.site && DATA.site.social) || [];
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty-cell">还没有社交账号。</td></tr>';
    return;
  }
  const labelOf = p => ({ bilibili: '哔哩哔哩', xiaohongshu: '小红书', wechat: '微信' })[p] || p;
  tb.innerHTML = list.map(s => `
    <tr>
      <td data-label="平台">${esc(labelOf(s.platform))}</td>
      <td data-label="显示名">${esc(s.label)}</td>
      <td class="cell-sub" data-label="账号">${esc(s.handle || '—')}</td>
      <td class="cell-sub" data-label="链接" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.url || '未填')}</td>
      <td class="table__actions">
        <button class="btn btn--sm" data-social-edit="${esc(s.id)}">编辑</button>
        <button class="btn btn--sm btn--danger" data-social-del="${esc(s.id)}">删除</button>
      </td>
    </tr>`).join('');
}

function renderToolTable() {
  const tb = document.getElementById('toolTable');
  if (!DATA.tools.length) {
    tb.innerHTML = '<tr><td colspan="4" class="empty-cell">还没有模块。</td></tr>';
    return;
  }
  tb.innerHTML = DATA.tools.map(t => `
    <tr>
      <td><div class="tool__mark tool__mark--${esc(t.tone)}" style="width:32px;height:32px;font-size:12px">${esc(t.mark)}</div></td>
      <td><div class="cell-title">${esc(t.name)}</div>
          <div class="cell-sub">${esc(t.desc)}</div>
          <div class="cell-link">${esc(t.href || '未设置链接')}</div></td>
      <td><span class="tool__status" style="${t.status === 'soon' ? 'color:var(--ink-3)' : ''}">${t.status === 'soon' ? '规划中' : '已上线'}</span></td>
      <td class="table__actions">
        <button class="btn btn--sm" data-tool-edit="${esc(t.id)}">编辑</button>
        <button class="btn btn--sm btn--danger" data-tool-del="${esc(t.id)}">删除</button>
      </td>
    </tr>`).join('');
}

function renderCatChips() {
  const g = document.getElementById('gradeChips');
  const s = document.getElementById('subjectChips');
  if (!g || !s) return;

  g.innerHTML = DATA.library.grades.map(x =>
    `<span class="chip">${esc(x)} <b class="chip-x" data-drop-grade="${esc(x)}">×</b></span>`).join('');
  s.innerHTML = DATA.library.subjects.map(x =>
    `<span class="chip">${esc(x)} <b class="chip-x" data-drop-subject="${esc(x)}">×</b></span>`).join('');
}

/** 联系方式编辑表：每行 = 名称 + 内容 */
function renderContactTable(items) {
  const tb = document.getElementById('contactTable');
  if (!tb) return;
  const list = (items && items.length) ? items : [{ label: 'QQ 群', value: '' }];
  tb.innerHTML = list.map(it => `
    <tr>
      <td><input class="input" data-c-label value="${esc(it.label || '')}" placeholder="如：QQ 群"></td>
      <td><textarea class="input" data-c-value style="min-height:40px" placeholder="支持多行，一行一个">${esc(it.value || '')}</textarea></td>
      <td><button class="btn btn--sm btn--danger" data-c-del type="button">删除</button></td>
    </tr>`).join('');
}

function collectContactItems() {
  const items = [];
  document.querySelectorAll('#contactTable tr').forEach(tr => {
    const labelEl = tr.querySelector('[data-c-label]');
    const valEl = tr.querySelector('[data-c-value]');
    if (!labelEl || !valEl) return;
    const label = (labelEl.value || '').trim();
    const value = (valEl.value || '').trim();
    if (label || value) items.push({ label, value });
  });
  return items;
}

function bindContactTable() {
  const tb = document.getElementById('contactTable');
  const btn = document.getElementById('btnAddContact');
  if (!tb || !btn) return;
  btn.onclick = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="input" data-c-label placeholder="如：邮箱"></td>
      <td><textarea class="input" data-c-value style="min-height:40px" placeholder="支持多行，一行一个"></textarea></td>
      <td><button class="btn btn--sm btn--danger" data-c-del type="button">删除</button></td>`;
    tb.appendChild(tr);
    const first = tr.querySelector('[data-c-label]');
    if (first) first.focus();
  };
  tb.addEventListener('click', e => {
    const btnDel = e.target.closest('[data-c-del]');
    if (btnDel) btnDel.closest('tr').remove();
  });
}

/** 首页首屏文案 */
function fillHomeForm() {
  const h = (DATA.site && DATA.site.home) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('homeEyebrow2', h.eyebrow);
  set('homeTitle2', h.title);
  set('homeText2', h.text);
}

function saveHomeForm() {
  const get = id => (document.getElementById(id) || {}).value || '';
  DATA.site = DATA.site || {};
  DATA.site.home = {
    eyebrow: get('homeEyebrow2').trim(),
    title: get('homeTitle2').trim(),
    text: get('homeText2').trim()
  };
  const btn = document.getElementById('btnSaveHome');
  save().then(() => {
    if (btn) {
      btn.textContent = '已保存';
      setTimeout(() => { btn.textContent = '保存首屏文案'; }, 1500);
    }
  });
}

/** 加入我们页的文案 */
function fillJoinForm() {
  const j = (DATA.site && DATA.site.join) || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('joinTitle2', j.title);
  set('joinIntro2', j.intro);
  set('joinDeptTitle2', j.deptTitle);
  set('joinDeptDesc2', j.deptDesc);
  set('joinHowTitle2', j.howTitle);
  set('joinHowDesc2', j.howDesc);
  set('joinHowText2', j.howText);
}

function saveJoinForm() {
  const get = id => (document.getElementById(id) || {}).value || '';
  DATA.site = DATA.site || {};
  DATA.site.join = {
    title: get('joinTitle2').trim(),
    intro: get('joinIntro2').trim(),
    deptTitle: get('joinDeptTitle2').trim(),
    deptDesc: get('joinDeptDesc2').trim(),
    howTitle: get('joinHowTitle2').trim(),
    howDesc: get('joinHowDesc2').trim(),
    howText: get('joinHowText2').trim()
  };
  const btn = document.getElementById('btnSaveJoin');
  save().then(() => {
    if (btn) {
      btn.textContent = '已保存';
      setTimeout(() => { btn.textContent = '保存页面文字'; }, 1500);
    }
  });
}

function fillSiteForm() {
  const s = DATA.site || {};
  const c = s.contact || {};
  const p = s.publication || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('siteContactTitle', c.title);
  set('siteContactText', c.text);
  renderContactTable(contactItems(c));
  set('sitePubName', p.name);
  set('sitePubIssue', p.issue);
  set('sitePubDesc', p.desc);
  set('sitePubUrl', p.url);
  const issueState = document.getElementById('issueState');
  if (issueState) {
    issueState.style.color = p.image ? 'var(--green)' : 'var(--ink-3)';
    issueState.textContent = p.image ? '已有图片（重新上传会直接替换）' : '未上传';
  }
  pendingIssue = p.image || null;
}

function saveSiteForm() {
  const get = id => (document.getElementById(id) || {}).value || '';
  DATA.site = DATA.site || {};
  DATA.site.contact = {
    title: get('siteContactTitle').trim(),
    text: get('siteContactText').trim(),
    items: collectContactItems()
  };
  DATA.site.publication = {
    name: get('sitePubName').trim(),
    issue: get('sitePubIssue').trim(),
    desc: get('sitePubDesc').trim(),
    url: get('sitePubUrl').trim(),
    image: pendingIssue || (DATA.site.publication && DATA.site.publication.image) || '',
    cover: (DATA.site.publication && DATA.site.publication.cover) || ''
  };
  const btn = document.getElementById('btnSaveSite');
  save().then(() => {
    if (btn) {
      const origin = '保存站点信息';
      btn.textContent = '已保存';
      setTimeout(() => { btn.textContent = origin; }, 1500);
    }
  });
}

/* ---------- 保存（串行队列，避免并发覆盖） ---------- */

let saveQueue = Promise.resolve();

function setSaveState(state, msg) {
  const el = document.getElementById('saveState');
  if (!el) return;
  const map = {
    saving: ['保存中…', 'var(--ink-3)'],
    saved: ['已保存', 'var(--green)'],
    error: ['保存失败', 'var(--clay)']
  };
  const pair = map[state] || ['', ''];
  el.textContent = msg || pair[0];
  el.style.color = pair[1];
}

function save() {
  refreshStats();
  setSaveState('saving');
  saveQueue = saveQueue
    .then(() => Store.save(DATA))
    .then(() => setSaveState('saved'))
    .catch(e => {
      setSaveState('error');
      alert('保存失败：' + e.message + '\n\n可能是网络中断或服务器接口异常。你的修改还在当前页面，刷新会丢失。');
    });
  return saveQueue;
}

function refreshAll() {
  refreshStats();
  renderAnnTable();
  renderActTable();
  renderDeptTable();
  renderSocialTable();
  renderToolTable();
  renderCatChips();
  fillJoinForm();
  fillHomeForm();
  fillDocSelects();
  renderDocTable();
  fillSiteForm();
}

/* ---------- 资料库：上传与列表 ---------- */

let pendingDoc = null;

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fillDocSelects() {
  const g = document.getElementById('docGrade');
  const sj = document.getElementById('docSubject');
  if (!g || !sj) return;
  const lib = (DATA && DATA.library) || {};
  g.innerHTML = (lib.grades || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  sj.innerHTML = (lib.subjects || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
}

function renderDocTable() {
  const tb = document.getElementById('docTable');
  const cnt = document.getElementById('docCount');
  if (!tb) return;
  const docs = (DATA && DATA.library && DATA.library.docs) || [];
  if (cnt) cnt.textContent = `（共 ${docs.length} 份）`;
  if (!docs.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty-cell">还没有资料。在上方选择一个文件上传。</td></tr>';
    return;
  }
  tb.innerHTML = docs.map(d => `
    <tr>
      <td>
        <div class="cell-title">${esc(d.name)}</div>
        <div class="cell-sub">${esc((d.ext || '').toUpperCase())}　${esc(d.note || '')}</div>
      </td>
      <td class="cell-dim">${esc(d.grade || '—')}</td>
      <td class="cell-dim">${esc(d.subject || '—')}</td>
      <td class="cell-dim">${esc(d.size || '')}</td>
      <td class="table__actions">
        <button class="btn btn--sm" data-doc-open="${esc(d.id)}">打开</button>
        <button class="btn btn--sm btn--danger" data-doc-del="${esc(d.id)}">删除</button>
      </td>
    </tr>`).join('');
}

async function uploadDoc(file) {
  const fd = new FormData();
  fd.append('file', file);
  let r;
  try {
    r = await fetch('api/upload-doc', {
      method: 'POST',
      headers: { 'X-Token': CONFIG.consoleCode },
      body: fd
    });
  } catch (e) {
    throw new Error('连不上上传服务');
  }
  let j = null;
  try { j = await r.json() } catch (e) {}
  if (!j) throw new Error('服务器返回异常（' + r.status + '）');
  if (!r.ok || !j.ok) throw new Error(j.error || ('上传失败 ' + r.status));
  return j;
}

function initDocUpload() {
  const fileInput = document.getElementById('docFile');
  const btnPick = document.getElementById('btnPickDoc');
  const btnUp = document.getElementById('btnDocUpload');
  const btnSave = document.getElementById('btnDocSave');
  const nameEl = document.getElementById('docName');
  const pickEl = document.getElementById('docPickName');
  const stateEl = document.getElementById('docUploadState');
  if (!fileInput || !btnPick) return;

  btnPick.onclick = () => fileInput.click();

  fileInput.onchange = () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    pickEl.textContent = f.name + '　' + fmtSize(f.size);
    btnUp.disabled = false;
    btnSave.disabled = true;
    stateEl.textContent = '';
    pendingDoc = null;
  };

  btnUp.onclick = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    btnUp.disabled = true;
    btnUp.textContent = '上传中…';
    stateEl.style.color = 'var(--ink-3)';
    stateEl.textContent = '';
    try {
      const r = await uploadDoc(f);
      pendingDoc = r;
      nameEl.value = String(r.original || f.name).replace(/\.[^.]+$/, '');
      stateEl.style.color = 'var(--green)';
      stateEl.textContent = '已上传，核对分类后点「保存到资料库」';
      btnSave.disabled = false;
    } catch (e) {
      stateEl.style.color = 'var(--clay)';
      stateEl.textContent = e.message;
    }
    btnUp.disabled = false;
    btnUp.textContent = '上传';
  };

  btnSave.onclick = () => {
    if (!pendingDoc) return;
    const name = nameEl.value.trim();
    if (!name) { alert('资料名称不能为空'); return; }
    DATA.library = DATA.library || {};
    DATA.library.docs = DATA.library.docs || [];
    DATA.library.docs.push({
      id: 'doc' + Date.now(),
      name,
      grade: document.getElementById('docGrade').value,
      subject: document.getElementById('docSubject').value,
      note: document.getElementById('docNote').value.trim(),
      ext: pendingDoc.ext,
      size: fmtSize(pendingDoc.size),
      url: pendingDoc.url,
      date: new Date().toISOString().slice(0, 10)
    });
    save();
    renderDocTable();
    pendingDoc = null;
    fileInput.value = '';
    pickEl.textContent = '未选择文件';
    stateEl.textContent = '';
    document.getElementById('docNote').value = '';
    btnSave.disabled = true;
  };

  document.getElementById('docTable').onclick = e => {
    const oid = e.target.dataset.docOpen;
    const did = e.target.dataset.docDel;
    const docs = (DATA.library && DATA.library.docs) || [];
    if (oid) {
      const d = docs.find(x => x.id === oid);
      if (d && d.url) window.open(d.url, '_blank');
    }
    if (did) {
      const d = docs.find(x => x.id === did);
      if (d && confirm('从资料库移除「' + d.name + '」？\n（服务器上的文件不会被删除）')) {
        DATA.library.docs = docs.filter(x => x.id !== did);
        save();
        renderDocTable();
      }
    }
  };
}

/* ---------- 公告 ---------- */

function editAnnouncement(id) {
  const isNew = !id;
  const item = isNew
    ? { id: '', date: new Date().toISOString().slice(0, 10), title: '', tag: '通知', excerpt: '', pinned: false }
    : DATA.announcements.find(a => a.id === id);
  if (!item) return;

  buildModal({
    title: isNew ? '新建公告' : '编辑公告',
    sub: '标题显示在列表首位，摘要控制在一行内。',
    fields: [
      { key: 'date', label: '日期', type: 'date', value: item.date },
      { key: 'title', label: '标题', value: item.title, placeholder: '例：关于期末复习资料共享的通知' },
      { key: 'tag', label: '分类', type: 'select', options: ['教务', '活动', '招新', '通知'], value: item.tag },
      { key: 'excerpt', label: '摘要', type: 'textarea', value: item.excerpt, placeholder: '一两句话说明要点' },
      { key: 'pinned', label: '置顶显示', type: 'checkbox', value: item.pinned }
    ],
    onSave() {
      const v = readModal();
      if (!v.title) { alert('标题不能为空'); return; }
      const payload = {
        date: v.date || item.date,
        title: v.title,
        tag: v.tag || '通知',
        excerpt: v.excerpt,
        pinned: !!v.pinned
      };
      if (isNew) DATA.announcements.push(Object.assign({ id: 'a' + Date.now() }, payload));
      else Object.assign(item, payload);
      save(); renderAnnTable(); closeModal();
    }
  });
}

/* ---------- 活动 ---------- */

function editActivity(id) {
  const isNew = !id;
  const item = isNew
    ? { id: '', title: '', date: new Date().toISOString().slice(0, 10), timePlace: '', reward: '', poster: '', excerpt: '', content: '', videoUrl: '', tags: [] }
    : DATA.activities.find(a => a.id === id);
  if (!item) return;

  buildModal({
    title: isNew ? '新建活动' : '编辑活动',
    sub: '海报与回放链接可留空，前台会自动处理。',
    fields: [
      { key: 'title', label: '活动标题', value: item.title, placeholder: '例：小课堂 03 · 药剂学计算专题' },
      { key: 'date', label: '日期', type: 'date', value: item.date },
      { key: 'timePlace', label: '时间地点', value: item.timePlace, placeholder: '10 月 25 日 19:00 · 教学楼 B203' },
      { key: 'reward', label: '参与奖励 / 限额', value: item.reward, placeholder: '参与可得学习积分 2 分' },
      { key: 'excerpt', label: '一句话简介', type: 'textarea', value: item.excerpt, placeholder: '列表卡片上显示的两行摘要' },
      { key: 'content', label: '正文', type: 'textarea', tall: true, value: item.content, placeholder: '支持换行，前台按段落显示' },
      { key: 'poster', label: '海报图片', type: 'image', value: item.poster, placeholder: '点右侧按钮上传，或粘贴图片地址' },
      { key: 'videoUrl', label: '视频回放链接', value: item.videoUrl, placeholder: 'https://www.bilibili.com/video/…' },
      { key: 'tags', label: '标签（逗号分隔）', value: (item.tags || []).join(','), placeholder: '药化,期中' }
    ],
    onSave() {
      const v = readModal();
      if (!v.title) { alert('活动标题不能为空'); return; }
      const payload = {
        title: v.title,
        date: v.date || item.date,
        timePlace: v.timePlace,
        reward: v.reward,
        excerpt: v.excerpt,
        content: v.content,
        poster: v.poster,
        videoUrl: v.videoUrl,
        tags: (v.tags || '').split(/[,，]/).map(x => x.trim()).filter(Boolean)
      };
      if (isNew) DATA.activities.push(Object.assign({ id: 'e' + Date.now() }, payload));
      else Object.assign(item, payload);
      save(); renderActTable(); closeModal();
    }
  });
}

/* ---------- 部门 ---------- */

function editDept(id) {
  const isNew = !id;
  const item = isNew
    ? { id: '', name: '', duty: '', desc: '', contact: '' }
    : (DATA.departments || []).find(d => d.id === id);
  if (!item) return;

  buildModal({
    title: isNew ? '新建部门' : '编辑部门',
    sub: '职责是一行小字，说明是正文段落。',
    fields: [
      { key: 'name', label: '部门名称', value: item.name, placeholder: '例：外联部' },
      { key: 'duty', label: '一句话职责', value: item.duty, placeholder: '合作 · 赞助' },
      { key: 'desc', label: '说明', type: 'textarea', value: item.desc, placeholder: '这个部门具体做什么、适合什么人' },
      { key: 'contact', label: '联系方式（可选）', value: item.contact, placeholder: '负责人微信 / 邮箱' }
    ],
    onSave() {
      const v = readModal();
      if (!v.name) { alert('部门名称不能为空'); return; }
      const payload = { name: v.name, duty: v.duty, desc: v.desc, contact: v.contact };
      if (isNew) {
        DATA.departments = DATA.departments || [];
        DATA.departments.push(Object.assign({ id: 'd' + Date.now() }, payload));
      } else Object.assign(item, payload);
      save(); renderDeptTable(); closeModal();
    }
  });
}

/* ---------- 社交账号 ---------- */

function editSocial(id) {
  const isNew = !id;
  const list = (DATA.site && DATA.site.social) || [];
  const item = isNew
    ? { id: '', platform: 'bilibili', label: '哔哩哔哩', handle: '', url: '', note: '' }
    : list.find(s => s.id === id);
  if (!item) return;

  buildModal({
    title: isNew ? '新增社交账号' : '编辑社交账号',
    sub: '链接留空时，页底显示为待补充状态（不可点击）。',
    fields: [
      { key: 'platform', label: '平台', type: 'select', value: item.platform,
        options: [{ value: 'bilibili', text: '哔哩哔哩' }, { value: 'xiaohongshu', text: '小红书' }, { value: 'wechat', text: '微信' }] },
      { key: 'label', label: '显示名', value: item.label, placeholder: '哔哩哔哩' },
      { key: 'handle', label: '账号 / 说明', value: item.handle, placeholder: '@CPU学促会' },
      { key: 'url', label: '主页链接', value: item.url, placeholder: 'https://space.bilibili.com/…' },
      { key: 'note', label: '补充说明（可选）', value: item.note, placeholder: '课程回放与经验分享' }
    ],
    onSave() {
      const v = readModal();
      const payload = { platform: v.platform, label: v.label, handle: v.handle, url: v.url, note: v.note };
      DATA.site.social = DATA.site.social || [];
      if (isNew) DATA.site.social.push(Object.assign({ id: 's' + Date.now() }, payload));
      else Object.assign(item, payload);
      save(); renderSocialTable(); closeModal();
    }
  });
}

/* ---------- 模块 ---------- */

function editTool(id) {
  const isNew = !id;
  const item = isNew
    ? { id: '', name: '', desc: '', mark: '新', tone: 'd', status: 'soon', href: '' }
    : DATA.tools.find(t => t.id === id);
  if (!item) return;

  buildModal({
    title: isNew ? '新增模块' : '编辑模块',
    sub: '标识是卡片左上角的方块文字，建议 2 个字。',
    fields: [
      { key: 'name', label: '模块名称', value: item.name, placeholder: '例：药理脑袋' },
      { key: 'desc', label: '一句话说明', type: 'textarea', value: item.desc },
      { key: 'mark', label: '标识文字', value: item.mark, placeholder: '例：药理' },
      { key: 'tone', label: '配色', type: 'select', options: ['a', 'b', 'c', 'd'], value: item.tone },
      { key: 'status', label: '状态', type: 'select', options: [{ value: 'online', text: '已上线' }, { value: 'soon', text: '规划中' }], value: item.status },
      { key: 'href', label: '链接地址', value: item.href, placeholder: 'yaohua/ 或 https://…' }
    ],
    onSave() {
      const v = readModal();
      if (!v.name) { alert('模块名称不能为空'); return; }
      const payload = {
        name: v.name, desc: v.desc,
        mark: v.mark || v.name.slice(0, 2),
        tone: v.tone, status: v.status,
        href: v.href || '#'
      };
      if (isNew) DATA.tools.push(Object.assign({ id: 't' + Date.now() }, payload));
      else Object.assign(item, payload);
      save(); renderToolTable(); closeModal();
    }
  });
}

/* ---------- 初始化 ---------- */

async function initConsole() {
  setSaveState('saving', '读取中…');
  await Store.load();
  DATA = Store.read();
  setSaveState('saved', '');

  document.getElementById('btnReset').addEventListener('click', async () => {
    if (!confirm('恢复为内置示例数据？\n\n服务器上当前的内容会被覆盖，其他人刷新后也会看到示例数据。')) return;
    try {
      DATA = await Store.reset();
      refreshAll();
      setSaveState('saved', '已恢复示例数据');
    } catch (e) {
      alert('恢复失败：' + e.message);
    }
  });

  document.getElementById('btnLock').addEventListener('click', () => lockConsole());

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      if (panel) panel.classList.add('is-active');
    });
  });

  document.getElementById('btnAddAnn').addEventListener('click', () => editAnnouncement(null));
  document.getElementById('btnAddAct').addEventListener('click', () => editActivity(null));
  document.getElementById('btnAddDept').addEventListener('click', () => editDept(null));
  document.getElementById('btnAddSocial').addEventListener('click', () => editSocial(null));
  document.getElementById('btnAddTool').addEventListener('click', () => editTool(null));
  document.getElementById('btnSaveSite').addEventListener('click', saveSiteForm);

  document.getElementById('annTable').addEventListener('click', e => {
    const eid = e.target.dataset.annEdit, did = e.target.dataset.annDel;
    if (eid) editAnnouncement(eid);
    if (did) {
      const item = DATA.announcements.find(a => a.id === did);
      if (item && confirm('删除公告「' + item.title + '」？')) {
        DATA.announcements = DATA.announcements.filter(a => a.id !== did);
        save(); renderAnnTable();
      }
    }
  });

  document.getElementById('actTable').addEventListener('click', e => {
    const eid = e.target.dataset.actEdit, did = e.target.dataset.actDel;
    if (eid) editActivity(eid);
    if (did) {
      const item = DATA.activities.find(a => a.id === did);
      if (item && confirm('删除活动「' + item.title + '」？')) {
        DATA.activities = DATA.activities.filter(a => a.id !== did);
        save(); renderActTable();
      }
    }
  });

  document.getElementById('deptTable').addEventListener('click', e => {
    const eid = e.target.dataset.deptEdit, did = e.target.dataset.deptDel;
    if (eid) editDept(eid);
    if (did) {
      const item = (DATA.departments || []).find(d => d.id === did);
      if (item && confirm('删除部门「' + item.name + '」？')) {
        DATA.departments = DATA.departments.filter(d => d.id !== did);
        save(); renderDeptTable();
      }
    }
  });

  document.getElementById('socialTable').addEventListener('click', e => {
    const eid = e.target.dataset.socialEdit, did = e.target.dataset.socialDel;
    if (eid) editSocial(eid);
    if (did) {
      const item = (DATA.site.social || []).find(s => s.id === did);
      if (item && confirm('删除账号「' + item.label + '」？')) {
        DATA.site.social = DATA.site.social.filter(s => s.id !== did);
        save(); renderSocialTable();
      }
    }
  });

  document.getElementById('toolTable').addEventListener('click', e => {
    const eid = e.target.dataset.toolEdit, did = e.target.dataset.toolDel;
    if (eid) editTool(eid);
    if (did) {
      const item = DATA.tools.find(t => t.id === did);
      if (item && confirm('删除模块「' + item.name + '」？')) {
        DATA.tools = DATA.tools.filter(t => t.id !== did);
        save(); renderToolTable();
      }
    }
  });

  document.getElementById('gradeChips').addEventListener('click', e => {
    const g = e.target.dataset.dropGrade;
    if (g && confirm('删除年级段「' + g + '」？')) {
      DATA.library.grades = DATA.library.grades.filter(x => x !== g);
      save(); renderCatChips();
    }
  });

  document.getElementById('subjectChips').addEventListener('click', e => {
    const s = e.target.dataset.dropSubject;
    if (s && confirm('删除学科「' + s + '」？')) {
      DATA.library.subjects = DATA.library.subjects.filter(x => x !== s);
      save(); renderCatChips();
    }
  });

  document.getElementById('btnAddGrade').addEventListener('click', () => {
    const input = document.getElementById('gradeInput');
    const v = input.value.trim();
    if (!v) return;
    if (DATA.library.grades.includes(v)) { alert('已存在'); return; }
    DATA.library.grades.push(v);
    input.value = '';
    save(); renderCatChips();
  });

  document.getElementById('btnAddSubject').addEventListener('click', () => {
    const input = document.getElementById('subjectInput');
    const v = input.value.trim();
    if (!v) return;
    if (DATA.library.subjects.includes(v)) { alert('已存在'); return; }
    DATA.library.subjects.push(v);
    input.value = '';
    save(); renderCatChips();
  });

  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', () => modalSaveHandler && modalSaveHandler());
  document.getElementById('modalMask').addEventListener('click', e => {
    if (e.target.id === 'modalMask') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  initDocUpload();
  initIssueUpload();
  bindContactTable();
  document.getElementById('btnSaveJoin').addEventListener('click', saveJoinForm);
  document.getElementById('btnSaveHome').addEventListener('click', saveHomeForm);
  refreshAll();
}

/* ---------- 新生刊图片上传（覆盖式，只留最新一张） ---------- */

let pendingIssue = null;

function initIssueUpload() {
  const fileInput = document.getElementById('issueFile');
  const btnPick = document.getElementById('btnIssuePick');
  const stateEl = document.getElementById('issueState');
  if (!fileInput || !btnPick) return;

  btnPick.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const origin = btnPick.textContent;
    btnPick.disabled = true;
    btnPick.textContent = '上传中…';
    stateEl.style.color = 'var(--ink-3)';
    stateEl.textContent = '';
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('api/upload-issue', {
        method: 'POST',
        headers: { 'X-Token': CONFIG.consoleCode },
        body: fd
      });
      let j = null;
      try { j = await r.json() } catch (e) {}
      if (!j) throw new Error('服务器返回异常（' + r.status + '）');
      if (!r.ok || !j.ok) throw new Error(j.error || ('上传失败 ' + r.status));
      pendingIssue = j.url;
      stateEl.style.color = 'var(--green)';
      stateEl.textContent = '已上传，点下方「保存站点信息」生效';
      btnPick.textContent = '已上传';
      setTimeout(() => { btnPick.textContent = origin; btnPick.disabled = false; }, 1400);
    } catch (e) {
      stateEl.style.color = 'var(--clay)';
      stateEl.textContent = e.message;
      btnPick.textContent = origin;
      btnPick.disabled = false;
    }
    fileInput.value = '';
  };
}

document.addEventListener('DOMContentLoaded', () => {
  mountGate(initConsole);
});
