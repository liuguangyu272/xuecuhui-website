let markdownEditingId = null;
let markdownLoadedSource = '';
let markdownLoadVersion = 0;
let markdownSaving = false;

function editDocSettings(doc) {
  if (!doc) return;
  buildModal({title: '资料设置', sub: '水印只影响站内阅读，原文件保留。', fields: [
    {key: 'name', label: '资料名称', value: doc.name},
    {key: 'grade', label: '年级段', type: 'select', options: DATA.library.grades, value: doc.grade},
    {key: 'subject', label: '学科', type: 'select', options: DATA.library.subjects, value: doc.subject},
    {key: 'note', label: '备注', value: doc.note},
    {key: 'watermarkMode', label: '阅读水印', type: 'select', value: typeof doc.watermark?.enabled === 'boolean' ? (doc.watermark.enabled ? 'on' : 'off') : 'inherit',
      options: [{value: 'inherit', text: '跟随资料库设置'}, {value: 'on', text: '显示'}, {value: 'off', text: '不显示'}]},
    {key: 'watermarkText', label: '单独水印文字（留空跟随资料库）', value: doc.watermark?.text || ''}
  ], async onSave() {
    const value = readModal();
    if (!value.name) return alert('资料名称不能为空');
    if (value.watermarkText.length > 80) return alert('水印文字最多 80 字');
    const watermark = {};
    if (value.watermarkMode !== 'inherit') watermark.enabled = value.watermarkMode === 'on';
    if (value.watermarkText) watermark.text = value.watermarkText;
    Object.assign(doc, {name: value.name, grade: value.grade, subject: value.subject, note: value.note, watermark});
    if (await save()) { renderDocTable(); closeModal(); }
  }});
}

async function loadMarkdownEditor(doc) {
  if (!doc || markdownSaving) return;
  const source = document.getElementById('markdownSource');
  if (source.value !== markdownLoadedSource && !confirm('有尚未保存的正文，是否切换到另一份资料？')) return;
  const generation = ++markdownLoadVersion;
  const state = document.getElementById('markdownState');
  state.textContent = '正在加载正文…';
  try {
    const url = new URL(doc.url, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('资料地址无效');
    const response = await fetch(url.href);
    if (!response.ok) throw Error('正文加载失败');
    const text = await response.text();
    if (generation !== markdownLoadVersion) return;
    if (text.length > 5 * 1024 * 1024) throw Error('正文超过在线编辑大小，请编辑原文件后上传');
    markdownEditingId = doc.id; markdownLoadedSource = text; source.value = text;
    document.getElementById('docName').value = doc.name;
    document.getElementById('docGrade').value = doc.grade;
    document.getElementById('docSubject').value = doc.subject;
    document.getElementById('docNote').value = doc.note || '';
    document.getElementById('markdownEditing').textContent = '正在编辑：' + doc.name;
    document.getElementById('markdownEditorBlock').scrollIntoView({behavior: 'smooth', block: 'start'});
    state.textContent = ''; previewMarkdownEditor();
  } catch (error) { if (generation === markdownLoadVersion) state.textContent = error.message; }
}

function previewMarkdownEditor() {
  const source = document.getElementById('markdownSource').value;
  if (source.length > 5 * 1024 * 1024) { document.getElementById('markdownState').textContent = '正文较大，请编辑原文件后上传。'; return; }
  const doc = (DATA.library.docs || []).find(item => item.id === markdownEditingId) || {};
  document.getElementById('markdownPreview').hidden = false;
  ReaderEngine.renderMarkdown(document.getElementById('markdownPreviewContent'), source, new URL(doc.url || 'assets/docs/material.md', location.href).href);
  ReaderEngine.applyWatermark(document.getElementById('markdownPreviewSheet'), ReaderEngine.watermarkSettings(DATA.library, doc));
}

function initReaderConsole() {
  const $ = id => document.getElementById(id);
  const watermark = ReaderEngine.watermarkSettings(DATA.library);
  $('readerWatermarkEnabled').checked = watermark.enabled; $('readerWatermarkText').value = watermark.text;
  $('saveReaderWatermark').onclick = async () => {
    const text = $('readerWatermarkText').value.trim();
    if (!text || text.length > 80) return alert('请填写 1–80 字的水印文字');
    DATA.library.watermark = {enabled: $('readerWatermarkEnabled').checked, text};
    if (await save()) { $('readerWatermarkState').textContent = '已保存'; if (!$('markdownPreview').hidden) previewMarkdownEditor(); }
  };
  $('previewMarkdown').onclick = previewMarkdownEditor;
  let previewTimer;
  $('markdownSource').oninput = () => {
    ++markdownLoadVersion;
    $('markdownState').textContent = '正文尚未保存';
    if (!$('markdownPreview').hidden) {clearTimeout(previewTimer); previewTimer = setTimeout(previewMarkdownEditor, 400);}
  };
  $('newMarkdown').onclick = () => {
    if (markdownSaving) return;
    if ($('markdownSource').value !== markdownLoadedSource && !confirm('正文尚未保存，确定清空吗？')) return;
    ++markdownLoadVersion; markdownEditingId = null; markdownLoadedSource = ''; $('markdownSource').value = '';
    $('markdownEditing').textContent = '正在编写新资料'; $('markdownState').textContent = ''; $('markdownPreview').hidden = true;
  };
  $('saveMarkdown').onclick = async () => {
    const source = $('markdownSource').value, name = $('docName').value.trim();
    if (!name || !source.trim()) return alert('请填写上方资料名称及正文');
    if (new Blob([source]).size > 5 * 1024 * 1024) return alert('在线编辑最多支持 5MB 正文');
    const metadata = {name, grade: $('docGrade').value, subject: $('docSubject').value, note: $('docNote').value.trim()};
    ++markdownLoadVersion; markdownSaving = true;
    const button = $('saveMarkdown'); button.disabled = true; $('markdownState').textContent = '正在保存…';
    try {
      const uploaded = await uploadDoc(new File([source], 'material.md', {type: 'text/markdown;charset=utf-8'}));
      const docs = DATA.library.docs || (DATA.library.docs = []);
      let doc = docs.find(item => item.id === markdownEditingId);
      if (!doc) { doc = {id: 'doc' + Date.now()}; docs.push(doc); markdownEditingId = doc.id; }
      Object.assign(doc, metadata, {
        url: uploaded.url, ext: 'md', size: fmtSize(uploaded.size), date: new Date().toISOString().slice(0, 10)});
      if (!await save()) throw Error('发布未成功，正文已保留，请重试保存。');
      markdownLoadedSource = source;
      $('markdownEditing').textContent = '正在编辑：' + name;
      $('markdownState').textContent = '已保存到资料库'; renderDocTable(); previewMarkdownEditor();
    } catch (error) { $('markdownState').textContent = error.message; }
    finally { button.disabled = false; markdownSaving = false; }
  };
  window.addEventListener('beforeunload', event => {
    if ($('markdownSource').value !== markdownLoadedSource) { event.preventDefault(); event.returnValue = ''; }
  });
}
