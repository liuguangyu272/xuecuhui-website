/* Account settings and audit history. All authorization is enforced by the API. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let members=[],offset=0,hasMore=false;
  const beijing=value=>{if(!value)return '';const stamp=String(value).includes('T')?String(value):String(value).replace(' ','T');const date=new Date(/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(stamp)?stamp:stamp+'Z');return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
  async function api(path,body) {
    const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
    const response=await fetch('/api/auth/'+path,options);
    const result=await response.json().catch(()=>({error:'服务器响应异常'}));
    if(!response.ok||!result.ok)throw Error(result.error||'请求未完成，请重试');
    return result;
  }
  function setState(id,message) {$(id).textContent=message;}
  function showDialog(title,body,buttonText,onSubmit) {
    $('identityDialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='identityDialog';dialog.className='ws-dialog';
    dialog.innerHTML=`<header class="ws-dialog-head"><h2>${esc(title)}</h2><button class="btn" id="identityDialogClose" aria-label="关闭">×</button></header><form class="ws-dialog-body" id="identityForm">${body}<p class="ws-error" id="identityError" hidden role="alert"></p><div class="ws-actions"><button class="btn" type="button" id="identityDialogCancel">取消</button>${buttonText?`<button class="btn btn--primary" id="identitySubmit">${esc(buttonText)}</button>`:''}</div></form>`;
    document.body.append(dialog);
    $('identityDialogClose').onclick=$('identityDialogCancel').onclick=()=>dialog.close();
    $('identityForm').onsubmit=async event=>{
      event.preventDefault();if(!onSubmit)return;
      const button=$('identitySubmit');button.disabled=true;$('identityError').hidden=true;
      try {await onSubmit();dialog.close();}
      catch(error){$('identityError').textContent=error.message;$('identityError').hidden=false;}
      finally{button.disabled=false;}
    };
    dialog.showModal();return dialog;
  }
  const field=(id,label,value='',type='text')=>`<label class="field"><span>${esc(label)}</span><input class="input" id="${id}" value="${esc(value)}" type="${type}" required></label>`;
  async function loadMembers(){
    setState('identityMemberState','正在读取…');
    try {const data=await api('members');members=data.members||[];renderMembers();setState('identityMemberState',`共 ${members.length} 名成员`);}
    catch(error){setState('identityMemberState',error.message);}
  }
  function renderMembers(){
    const query=$('identityMemberSearch').value.trim().toLowerCase();
    const list=members.filter(member=>(member.name+member.studentId+member.department+member.position).toLowerCase().includes(query));
    $('identityMembers').innerHTML=list.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.studentId)}</td><td>${esc(m.department)}</td><td>${esc(m.position)}</td><td>${m.role==='admin'?'管理员':'成员'}</td><td>${m.enabled?'启用':'停用'}</td><td><button class="btn btn--sm" data-member-edit="${m.id}">编辑</button>${m.isOwner?'':` <button class="btn btn--sm" data-member-toggle="${m.id}">${m.enabled?'停用':'启用'}</button>`}</td></tr>`).join('')||'<tr><td colspan="7">没有匹配的成员</td></tr>';
    $('identityMembers').querySelectorAll('[data-member-edit]').forEach(button=>button.onclick=()=>editMember(members.find(m=>String(m.id)===button.dataset.memberEdit)));
    $('identityMembers').querySelectorAll('[data-member-toggle]').forEach(button=>button.onclick=()=>toggleMember(members.find(m=>String(m.id)===button.dataset.memberToggle)));
  }
  function editMember(member={}){
    const primary=Boolean(member.isOwner);
    const dialog=showDialog(member.id?'编辑成员':'新增成员',field('imName','姓名',member.name)+field('imStudent','学号',member.studentId)+field('imDepartment','部门',member.department)+`<label class="field"><span>职务</span><input class="input" id="imPosition" value="${esc(member.position)}"></label><label class="field"><span>权限</span><select class="input" id="imRole" ${primary?'disabled':''}><option value="member" ${member.role!=='admin'?'selected':''}>成员</option><option value="admin" ${member.role==='admin'?'selected':''}>管理员</option></select></label><label class="field"><input type="checkbox" id="imEnabled" ${member.enabled!==false?'checked':''} ${primary?'disabled':''}> 启用账号</label>`,'保存',async()=>{
      await api('members',{...(member.id?{id:member.id}:{}),name:$('imName').value.trim(),studentId:$('imStudent').value.trim(),department:$('imDepartment').value.trim(),position:$('imPosition').value.trim(),role:$('imRole').value,enabled:$('imEnabled').checked});
      await loadMembers();
    });
    if(primary){$('imStudent').readOnly=true;}
  }
  function toggleMember(member){
    const enabled=!member.enabled;
    showDialog(enabled?'启用成员':'停用成员',`<p>${esc(member.name)}（${esc(member.studentId)}）</p><p>${enabled?'启用后可以登录内容台。':'停用后无法登录，现有登录状态也会失效。'}</p>`,enabled?'启用':'停用',async()=>{await api('members',{...member,enabled});await loadMembers();});
  }
  function parseSnapshot(value){
    if(value===null||value===undefined)return null;
    if(typeof value!=='string')return value;
    try{return JSON.parse(value);}catch{return value;}
  }
  function auditDetail(event){
    const before=parseSnapshot(event.before_json??event.before),after=parseSnapshot(event.after_json??event.after);
    const changes=Array.isArray(event.changes)?event.changes:parseSnapshot(event.changes_json);
    const details=Array.isArray(changes)&&changes.length?changes.map(change=>`<h3>${esc(change.path||change.field||'修改内容')}</h3><div class="identity-change"><div><small>修改前</small><pre class="identity-diff">${esc(JSON.stringify(change.before??change.old??null,null,2))}</pre></div><div><small>修改后</small><pre class="identity-diff">${esc(JSON.stringify(change.after??change.new??null,null,2))}</pre></div></div>`).join(''):`<h3>修改前</h3><pre class="identity-diff">${esc(before===null?'无':JSON.stringify(before,null,2))}</pre><h3>修改后</h3><pre class="identity-diff">${esc(after===null?'无':JSON.stringify(after,null,2))}</pre>`;
    showDialog('修改详情',`<p>${esc(event.actor_name||event.actorName||event.userName||event.user_name||'')} · ${esc(beijing(event.created_at||event.createdAt))}</p>${details}`,'');
  }
  async function loadAudit(){
    setState('identityAuditState','正在读取…');
    try{
      const data=await api('audit?offset='+offset+'&limit=30');const events=data.events||data.entries||data.logs||[];hasMore=Boolean(data.hasMore??data.has_more??(offset+events.length<Number(data.total||0)));
      $('identityAudit').innerHTML=events.map((e,index)=>`<tr><td>${esc(beijing(e.created_at||e.createdAt))}</td><td>${esc(e.actor_name||e.actorName||e.userName||e.user_name||'')}<small class="identity-subtext">${esc(e.actor_student_id||e.actorStudentId||e.studentId||'')}</small></td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td><button class="btn btn--sm" data-audit-detail="${index}">查看</button></td></tr>`).join('')||'<tr><td colspan="5">暂无修改记录</td></tr>';
      $('identityAudit').querySelectorAll('[data-audit-detail]').forEach(button=>button.onclick=()=>auditDetail(events[Number(button.dataset.auditDetail)]));
      $('identityAuditPrevious').disabled=offset===0;$('identityAuditNext').disabled=!hasMore;$('identityAuditPage').textContent='第 '+(Math.floor(offset/30)+1)+' 页';setState('identityAuditState','');
    }catch(error){setState('identityAuditState',error.message);}
  }
  document.addEventListener('console:ready',()=>{
    const admin=window.consoleIdentity?.role==='admin';document.querySelectorAll('.identity-admin-only').forEach(el=>el.hidden=!admin);
    if(!admin)return;
    $('identityAddMember').onclick=()=>editMember();$('identityMemberSearch').oninput=renderMembers;
    document.querySelector('[data-tab="members"]').addEventListener('click',loadMembers);
    document.querySelector('[data-tab="audit"]').addEventListener('click',()=>{offset=0;loadAudit();});
    $('identityAuditRefresh').onclick=()=>{offset=0;loadAudit();};
    $('identityAuditPrevious').onclick=()=>{offset=Math.max(0,offset-30);loadAudit();};$('identityAuditNext').onclick=()=>{if(hasMore){offset+=30;loadAudit();}};
  });
})();
