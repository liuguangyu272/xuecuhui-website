/* Material workflow inside the existing content console. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {tasks:[],resources:[],templates:[],requirements:'',filter:'all'};
  let currentTask = null;
  const size = n => n > 1048576 ? (n / 1048576).toFixed(1)+' MB' : Math.max(1,Math.round(n/1024))+' KB';
  const when = value => value ? value.replace('T',' ').slice(0,16) : '—';
  const owner = task => task.stage === 'design' ? task.designer : task.material;
  const status = task => task.status==='done'?['已归档','done']:task.status==='review'?[task.stage==='material'?'待材料审核':'待终审','review']:task.status==='returned'?['已退回','returned']:task.stage==='design'?['美工处理中','design']:['材料编写中','assigned'];
  function notify(message) { document.querySelector('.ws-toast')?.remove();const el=document.createElement('div');el.className='ws-toast';el.role='status';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),3500); }
  async function api(path='',body) {
    const options={headers:{'X-Token':CONFIG.consoleCode}};
    if(body!==undefined){options.method='POST';options.body=body instanceof FormData?body:JSON.stringify(body);if(!(body instanceof FormData))options.headers['Content-Type']='application/json';}
    const response=await fetch('/api/materials'+path,options);
    const data=await response.json().catch(()=>({error:'服务器响应异常'}));
    if(!response.ok||!data.ok)throw new Error(data.error||'操作失败');
    return data;
  }
  async function download(file) {
    try { const response=await fetch('/api/materials/files/'+file.id,{headers:{'X-Token':CONFIG.consoleCode}});if(!response.ok){const error=await response.json();throw new Error(error.error||'文件下载失败');}const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
    catch(error){notify(error.message);}
  }
  const fileHtml = file => `<div class="ws-attachment"><span class="ws-file">${escape(file.ext.toUpperCase())}</span><div><strong>${escape(file.name)}</strong><small>${size(file.size)}${file.active===0?' · 已被替换':''}</small></div>${file.active===0?'':`<button class="btn btn--sm" data-file="${file.id}">下载</button>`}</div>`;
  function wireFiles(root, files) { root.querySelectorAll('[data-file]').forEach(button=>button.onclick=()=>download(files.find(f=>f.id===Number(button.dataset.file)))); }
  function field(key,label,value='',type='text',options) {
    const control=type==='textarea'?`<textarea class="input" id="mw-${key}" style="min-height:${key==='content'?320:95}px">${escape(value)}</textarea>`:type==='select'?`<select class="input" id="mw-${key}">${options.map(o=>`<option value="${escape(o.value)}" ${String(value)===String(o.value)?'selected':''}>${escape(o.label)}</option>`).join('')}</select>`:`<input class="input" id="mw-${key}" type="${type}" value="${type==='file'?'':escape(value)}" ${type==='file'?'accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.rar,.7z,.md,.txt,.png,.jpg,.jpeg,.gif,.webp"':''}>`;
    return `<label class="field" style="display:block"><span>${escape(label)}</span>${control}</label>`;
  }
  const value = key => $('mw-'+key).value.trim();
  function dialog(title,body,buttons) {
    $('materialDialog')?.remove();const el=document.createElement('dialog');el.id='materialDialog';el.className='ws-dialog';
    el.innerHTML=`<header class="ws-dialog-head"><h2>${title}</h2><button class="btn btn--sm" id="mw-close" aria-label="关闭">×</button></header><div class="ws-dialog-body">${body}<div id="mw-error" class="ws-error" hidden role="alert"></div><div class="ws-actions">${buttons}</div></div>`;
    document.body.append(el);$('mw-close').onclick=()=>el.close();el.showModal();return el;
  }
  function action(id, fn) {
    $(id).onclick=async()=>{const button=$(id);button.disabled=true;$('mw-error').hidden=true;try{await fn();}catch(error){if($('mw-error')){$('mw-error').textContent=error.message;$('mw-error').hidden=false;}else notify(error.message);}finally{button.disabled=false;}};
  }
  async function load() { const data=await api();Object.assign(state,data);render(); }
  function render() {
    const counts=[['进行中',state.tasks.filter(t=>['assigned','returned'].includes(t.status)).length],['待审核',state.tasks.filter(t=>t.status==='review').length],['已完成',state.tasks.filter(t=>t.status==='done').length],['正式资料',state.resources.length]];
    $('materialMetrics').innerHTML=counts.map(([label,n])=>`<div class="ws-metric"><span>${label}</span><b>${n}</b></div>`).join('');
    const tasks=state.tasks.filter(t=>state.filter==='all'||t.status===state.filter);
    $('materialTasks').innerHTML=tasks.map(t=>{const [label,klass]=status(t);return `<button class="ws-task" data-task="${t.id}"><span class="ws-file">${t.stage==='design'?'美工':'材料'}</span><span><strong>${escape(t.title)}</strong><small>${escape(t.description.slice(0,70))}</small></span><span class="ws-task-owner">${escape(owner(t))}<small>当前负责人</small></span><span class="ws-task-deadline">${escape(t.deadline)}<small>截止日期</small></span><span class="ws-pill ${klass}">${label}</span><span class="ws-arrow">›</span></button>`;}).join('')||'<div class="ws-empty"><b>暂无相关任务</b>分配任务后，在这里上传成果、审核和交接。</div>';
    $('materialTasks').querySelectorAll('[data-task]').forEach(button=>button.onclick=()=>detail(Number(button.dataset.task)).catch(e=>notify(e.message)));
    renderResources();
    $('materialRequirements').textContent=state.requirements;
    $('materialTemplates').innerHTML=state.templates.map(t=>`<div style="padding:0 20px"><h4>${escape(t.name)}</h4>${fileHtml(t.file)}</div>`).join('')||'<div class="ws-empty">暂无模板，请上传实际文件。</div>';
    wireFiles($('materialTemplates'),state.templates.map(t=>t.file));
  }
  function renderResources() {
    const query=$('materialSearch').value.trim().toLowerCase();const list=state.resources.filter(r=>(r.name+r.description).toLowerCase().includes(query));
    $('materialResources').innerHTML=list.map(r=>`<article class="ws-resource"><span class="ws-file">${escape(r.file.ext.toUpperCase())}</span><h3>${escape(r.name)}</h3><p>${escape(r.description)}</p><p>${escape(r.file.name)} · ${size(r.file.size)}</p><span class="ws-pill ${r.published_id?'done':''}">${r.published_id?'已发布过 · 可更新公开版':'内部归档'}</span><footer><button class="btn btn--sm" data-download="${r.id}">下载</button><button class="btn btn--sm" data-versions="${r.id}">旧文件</button><button class="btn btn--primary btn--sm" data-publish="${r.id}">${r.published_id?'更新公开版':'发布到学习小站'}</button></footer></article>`).join('')||'<div class="ws-empty"><b>暂无正式资料</b>任务终审通过后会归档到这里，也可以直接上传已有正式资料。</div>';
    $('materialResources').querySelectorAll('[data-download]').forEach(b=>b.onclick=()=>download(state.resources.find(r=>r.id===Number(b.dataset.download)).file));
    $('materialResources').querySelectorAll('[data-publish]').forEach(b=>b.onclick=()=>publishDialog(Number(b.dataset.publish)));
    $('materialResources').querySelectorAll('[data-versions]').forEach(b=>b.onclick=async()=>{try{const data=await api('/versions/'+b.dataset.versions);const files=data.versions.map(v=>({id:v.file_id,name:v.name,size:v.size,ext:v.ext}));const el=dialog('保留的旧文件',files.map(fileHtml).join('')||'<div class="ws-empty">没有保留的旧文件</div>','');wireFiles(el,files);}catch(e){notify(e.message);}});
  }
  function actor() { const name=$('materialActor').value.trim();if(!name)throw new Error('请先填写操作人姓名');return name; }
  async function detail(id) {
    const data=await api('/tasks/'+id),task=data.task;currentTask=data;
    const [label,klass]=status(task);const steps=task.designer?['材料编写','材料审核','美工处理','终审归档']:['材料编写','审核归档'];const active=task.status==='done'?steps.length:task.stage==='design'?(task.status==='review'?3:2):(task.status==='review'?1:0);
    const files=data.submissions.map(s=>s.file);const reference=state.templates.find(t=>t.id===task.reference_id);if(reference)files.push(reference.file);
    const history=data.submissions.map(s=>`<article class="ws-history"><span class="ws-pill ${s.status==='pending'?'review':s.status==='returned'?'returned':'done'}">${s.status==='pending'?'待审核':s.status==='returned'?'已退回':'已通过'}</span><p><b>${escape(s.actor)}</b> · ${s.stage==='material'?'材料提交':'美工提交'} · ${when(s.created_at)}</p><p>${escape(s.note)}</p>${fileHtml(s.file)}${s.reviewer?`<div class="ws-review-note">${escape(s.reviewer)} · ${when(s.reviewed_at)}<br>${escape(s.comment||'审核通过')}</div>`:''}</article>`).join('')||'<div class="ws-empty">尚未提交成果文件。</div>';
    const buttons=task.status==='review'?'<button class="btn" id="mw-return">退回修改</button><button class="btn btn--primary" id="mw-approve">通过审核</button>':task.status!=='done'?'<button class="btn btn--primary" id="mw-submit">上传成果并提交审核</button>':'';
    const el=dialog(escape(task.title),`<span class="ws-pill ${klass}">${label}</span><p class="ws-readonly">${escape(task.description)}</p><div class="ws-detail-meta"><div><small>当前负责人</small>${escape(owner(task))}</div><div><small>截止日期</small>${escape(task.deadline)}</div><div><small>材料负责人</small>${escape(task.material)}</div><div><small>美工负责人</small>${escape(task.designer||'不需要美工处理')}</div></div><div class="ws-flow">${steps.map((step,i)=>`<span class="${i===active?'active':''}">${i<active?'✓ ':''}${step}</span>`).join('')}</div>${reference?`<h3>参考模板</h3>${fileHtml(reference.file)}`:''}<h3>提交与审核记录</h3>${history}`,buttons);
    wireFiles(el,files);
    if($('mw-submit'))$('mw-submit').onclick=()=>submitDialog(task);
    if($('mw-return'))$('mw-return').onclick=()=>reviewDialog(task,data.submissions[0],'return');
    if($('mw-approve'))$('mw-approve').onclick=()=>reviewDialog(task,data.submissions[0],'approve');
  }
  function createTask() {
    const options=items=>[{value:'',label:'无'},...items.map(i=>({value:i.id,label:i.name}))];
    dialog('分配材料任务',field('title','任务标题')+field('description','任务要求','','textarea')+field('deadline','截止日期','','date')+field('material','材料部负责人')+'<label class="field" style="display:flex;gap:8px"><input id="mw-design" type="checkbox">需要美工排版、封面或上章</label>'+field('designer','美工部负责人（需要美工时必填）')+field('reference','相关模板','','select',options(state.templates))+field('resource','更新已有正式资料（选填）','','select',options(state.resources)),'<button class="btn btn--primary" id="mw-create">确认分配</button>');
    action('mw-create',async()=>{await api('/tasks',{actor:actor(),title:value('title'),description:value('description'),deadline:value('deadline'),material:value('material'),designer:value('designer'),designRequired:$('mw-design').checked,referenceId:value('reference'),resourceId:value('resource')});$('materialDialog').close();await load();notify('任务已分配');});
  }
  function submitDialog(task) {
    dialog('上传成果并提交审核',`<p class="ws-identity-note">${escape(owner(task))}负责 · 提交后需等待审核通过。</p>`+field('file','成果文件（最大 50MB）','','file')+field('note','本次修改说明','','textarea'),'<button class="btn btn--primary" id="mw-send">提交审核</button>');
    action('mw-send',async()=>{const name=actor(),file=$('mw-file').files[0];if(!file||!value('note'))throw new Error('请选择成果文件并填写修改说明');const form=new FormData();form.append('file',file);form.append('actor',name);form.append('note',value('note'));await api('/tasks/'+task.id+'/submit',form);$('materialDialog').close();await load();notify('实际文件已提交，等待审核');});
  }
  function reviewDialog(task,submission,decision) {
    const final=task.stage==='design'||!task.designer;
    const el=dialog(decision==='return'?'退回修改':'审核成果',fileHtml(submission.file)+`<p class="ws-readonly">${escape(submission.note)}</p>`+field('comment',decision==='return'?'退回意见（必填）':'审核意见（选填）','','textarea')+(decision==='approve'&&final?'<label class="field" style="display:flex;gap:8px"><input id="mw-keep" type="checkbox">保留被替换的旧正式文件（默认不保留）</label>':'')+`<p class="ws-identity-note">${decision==='return'?'退回后可以修改并重新上传。':final?'通过后归入内部正式资料，可另行发布到学习小站。':'通过后交给 '+escape(task.designer)+' 进行美工处理。'}</p>`,'<button class="btn btn--primary" id="mw-review">确认'+(decision==='return'?'退回':'通过')+'</button>');
    wireFiles(el,[submission.file]);action('mw-review',async()=>{await api('/submissions/'+submission.id+'/review',{actor:actor(),action:decision,comment:value('comment'),keepOld:!!$('mw-keep')?.checked});$('materialDialog').close();await load();notify(decision==='return'?'已退回，修改意见已保存':final?'终审通过，已归档':'材料审核通过，已交给美工负责人');});
  }
  function uploadDialog(kind) {
    dialog(kind==='templates'?'上传模板':'上传已有正式资料',field('name','名称')+field('description','说明','','textarea')+field('file','实际文件（最大 50MB）','','file'),'<button class="btn btn--primary" id="mw-upload">确认上传</button>');
    action('mw-upload',async()=>{const file=$('mw-file').files[0];if(!file||!value('name'))throw new Error('请填写名称并选择文件');const form=new FormData();form.append('file',file);form.append('name',value('name'));form.append('description',value('description'));await api('/'+kind,form);$('materialDialog').close();await load();notify('文件已上传并保存');});
  }
  async function publishDialog(id) {
    try {
      const response=await fetch('/api/data');const data=await response.json();const lib=data.data?.library||{};
      const resource=state.resources.find(r=>r.id===id);const choices=items=>(items||[]).map(s=>({value:s,label:s}));
      dialog('发布到学生资料库',`<p class="ws-readonly">${escape(resource.name)}<br>公开后所有学生可阅读和下载当前正式文件。</p>`+field('grade','适用年级','','select',choices(lib.grades))+field('subject','学科','','select',choices(lib.subjects)),'<button class="btn btn--primary" id="mw-publish">确认发布</button>');
      action('mw-publish',async()=>{await api('/resources/'+id+'/publish',{grade:value('grade'),subject:value('subject')});$('materialDialog').close();await load();await Store.load();DATA=Store.read();renderDocTable();notify('已发布到学习小站资料库');});
    }catch(error){notify(error.message);}
  }
  document.addEventListener('console:ready',()=>{
    document.querySelectorAll('#tabs [data-tab]').forEach(button=>button.addEventListener('click',()=>document.body.classList.toggle('material-view',['materials','archives','requirements'].includes(button.dataset.tab))));
    try{$('materialActor').value=localStorage.getItem('materials.actor')||'';}catch{}
    $('materialActor').oninput=()=>{try{localStorage.setItem('materials.actor',$('materialActor').value);}catch{}};
    $('materialCreate').onclick=createTask;$('materialUpload').onclick=()=>uploadDialog('resources');$('materialTemplateUpload').onclick=()=>uploadDialog('templates');
    $('materialRefresh').onclick=()=>load().catch(e=>notify(e.message));$('materialSearch').oninput=renderResources;
    $('materialFilters').onclick=event=>{const filter=event.target.dataset.filter;if(!filter)return;state.filter=filter;$('materialFilters').querySelectorAll('button').forEach(b=>b.classList.toggle('is-active',b.dataset.filter===filter));render();};
    $('materialEditRequirements').onclick=()=>{dialog('编辑材料要求',field('content','要求内容',state.requirements,'textarea'),'<button class="btn btn--primary" id="mw-requirements">保存要求</button>');action('mw-requirements',async()=>{await api('/requirements',{content:value('content')});$('materialDialog').close();await load();notify('要求已保存');});};
    document.querySelectorAll('[data-tab="materials"],[data-tab="archives"],[data-tab="requirements"]').forEach(b=>b.addEventListener('click',()=>load().catch(e=>notify(e.message))));
    load().catch(e=>notify(e.message));
  });
})();
