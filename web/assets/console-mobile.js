/* Mobile navigation adapts existing console tabs without replacing their routes. */
(() => {
  'use strict';
  const groups = [
    {id:'content', label:'内容', tabs:[['ann','公告'],['act','活动']], icon:'<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>'},
    {id:'library', label:'资料', tabs:[['lib','学习资料'],['archives','正式归档'],['requirements','要求与模板']], icon:'<path d="M3 5h7l2 3h9v12H3zM3 8h9"/>'},
    {id:'workflow', label:'协作', tabs:[['materials','任务与审核']], icon:'<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v3H9zM8 11l2 2 5-5M8 17h8"/>'},
    {id:'settings', label:'管理', tabs:[['dept','部门'],['site','站点设置'],['tool','小帮手'],['members','成员名单'],['audit','修改记录']], icon:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>'}
  ];
  const last = {};
  const original = tab => document.querySelector('#tabs [data-tab="'+tab+'"]');
  const available = tab => {
    const control=original(tab);
    return Boolean(control) && (!['members','audit'].includes(tab) || window.consoleIdentity?.role==='admin');
  };

  function init() {
    const app=document.getElementById('consoleApp');
    if(!app || document.getElementById('consoleMobileNav'))return;
    const sub=document.createElement('div');sub.id='consoleMobileSubnav';sub.className='cm-subnav';
    sub.innerHTML='<nav class="cm-subtabs" aria-label="当前模块"></nav><h1 class="cm-title" hidden></h1>';
    const firstPanel=app.querySelector(':scope > .panel');
    app.insertBefore(sub,firstPanel);

    const nav=document.createElement('nav');nav.id='consoleMobileNav';nav.className='cm-bottom';nav.setAttribute('aria-label','内容台模块');
    for(const group of groups) {
      const button=document.createElement('button');button.type='button';button.dataset.mobileGroup=group.id;
      button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+group.icon+'</svg><span>'+group.label+'</span>';
      button.onclick=()=>{
        const chosen=group.tabs.find(([id])=>id===last[group.id]&&available(id))||group.tabs.find(([id])=>available(id));
        if(chosen)original(chosen[0]).click();
      };
      nav.append(button);
    }
    app.append(nav);

    function sync(tab) {
      const group=groups.find(g=>g.tabs.some(([id])=>id===tab));
      if(!group)return;
      last[group.id]=tab;
      nav.querySelectorAll('button').forEach(button=>{
        const active=button.dataset.mobileGroup===group.id;
        button.classList.toggle('is-active',active);
        if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      });
      const tabs=sub.querySelector('nav');tabs.replaceChildren();
      for(const [id,label] of group.tabs) {
        if(!available(id))continue;
        const button=document.createElement('button');button.type='button';button.dataset.mobileTab=id;button.textContent=label;
        button.classList.toggle('is-active',id===tab);
        if(id===tab)button.setAttribute('aria-current','page');
        button.onclick=()=>original(id).click();tabs.append(button);
      }
      if(group.id==='settings') {
        const link=document.createElement('a');link.href='console3/';link.textContent='题库内容台';tabs.append(link);
      }
      const panel=document.getElementById('panel-'+tab), title=sub.querySelector('h1');
      const hasHeading=Boolean(panel?.querySelector(':scope > .ws-heading, :scope > h1, :scope > h2'));
      title.hidden=hasHeading;
      title.textContent=group.tabs.find(([id])=>id===tab)?.[1]||'';
      sub.classList.toggle('cm-one-tab',group.tabs.filter(([id])=>available(id)).length===1);
    }
    document.querySelectorAll('#tabs [data-tab]').forEach(button=>button.addEventListener('click',()=>sync(button.dataset.tab)));
    sync(document.querySelector('#tabs .tab.is-active')?.dataset.tab||'ann');

    // Localize wide data tables; desktop keeps its original table layout.
    app.querySelectorAll('table').forEach(table=>{
      if(table.closest('.identity-table-wrap,.cm-table-scroll'))return;
      const wrapper=document.createElement('div');wrapper.className='cm-table-scroll';wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','表格，可左右滚动');
      table.before(wrapper);wrapper.append(table);
    });
  }
  document.addEventListener('console:ready',init);
})();
