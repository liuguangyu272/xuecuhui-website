/* ============================================================
   数据层 + 通用逻辑
   纯前端版本，数据存于浏览器 localStorage。
   接后端时只需把 Store 的读写换成接口调用。
   ============================================================ */

const CONFIG = {
  siteName: '学生学习促进协会',
  siteShort: '学促会',
  siteOrg: '中国药科大学药学院 · 学生发展中心',
  siteSub: 'Study Center',
  consoleCode: '__SERVER_CONSOLE_TOKEN__',
  storageKey: 'ycuhui.data.v3',
  sessionKey: 'ycuhui.console.ok'
};

/* ---------- 初始数据 ---------- */

const SEED = {
  /* 站点信息：内容台 → 站点信息 可改 */
  site: {
    contact: {
      title: '合作与联系',
      text: '班级共建、资料共享、活动合办，或有任何建议，都可以找我们。',
      qq: '',
      email: '',
      wechat: '',
      person: ''
    },
    home: {
      eyebrow: 'Study Center · 2026 秋',
      title: '该看的公告、要听的课、要找的资料，放在**一个地方**。',
      text: '药学院学促会的学习入口。公告、小课堂、资料库与小帮手工具，都从这里进。'
    },
    join: {
      title: '欢迎加入学促会！',
      intro: '学生学习促进协会是药学院学生发展中心下面的学生组织，做三件事：把课程资料整理清楚、把小课堂和活动办起来、把学习工具做出来。下面是我们五个部门各自负责什么，看完觉得合适，就来找我们。',
      deptTitle: '部门介绍',
      deptDesc: '五个部门，按你擅长的事来选',
      howTitle: '怎么加入',
      howDesc: '招新时间与报名流程',
      howText: '招新一般在每学年秋季学期开学后两周内进行，春季学期视人员空缺补招。\n\n流程很简单：填一张报名表 → 聊十分钟 → 进部门试用一个月。我们不考试，也不看成绩排名，只看你愿不愿意把一件事做完。\n\n具体的报名表、面试时间和联系方式，会通过公告栏发布，也可以直接在页面底部找到我们的联系方式。'
    },
    publication: {
      name: '新生刊',
      issue: '2026 级',
      desc: '写给刚进药学院的你：课程地图、社团选择、避坑清单。',
      url: '',
      cover: ''
    },
    social: [
      { id: 's1', platform: 'bilibili', label: '哔哩哔哩', handle: '', url: '', note: '课程回放与经验分享' },
      { id: 's2', platform: 'xiaohongshu', label: '小红书', handle: '', url: '', note: '日常笔记与备考碎片' }
    ]
  },

  announcements: [
    {
      id: 'a1',
      date: '2026-10-21',
      title: '关于 2026-2027 学年第一学期学业帮扶计划报名的通知',
      excerpt: '面向大一至大三同学开放，按学科分组配备学业导师，报名截止 10 月 31 日。',
      tag: '教务',
      pinned: true
    },
    {
      id: 'a2',
      date: '2026-10-18',
      title: '「药化脑袋」记忆训练小程序 v1.2 更新：新增 63 个药物分子构象',
      excerpt: '本次更新补充了构象异构与药理作用分类，支持按章节自测。',
      tag: '通知',
      pinned: false
    },
    {
      id: 'a3',
      date: '2026-10-15',
      title: '第八届药学知识竞赛院内选拔开始报名',
      excerpt: '三人组队，初赛 11 月 8 日，优胜队伍代表学院参加校赛。',
      tag: '活动',
      pinned: false
    },
    {
      id: 'a4',
      date: '2026-10-12',
      title: '学习资料库开放试运行，首批收录大三专业课复习提纲',
      excerpt: '目前开放药物化学、药物分析两门课程，按年级与学科分类检索。',
      tag: '教务',
      pinned: false
    },
    {
      id: 'a5',
      date: '2026-10-09',
      title: '学促会 2026 年秋季招新结果公示',
      excerpt: '经面试与综合评议，共录取 18 名新成员，名单见附件。',
      tag: '招新',
      pinned: false
    },
    {
      id: 'a6',
      date: '2026-09-28',
      title: '关于征集「小帮手」工具需求的公告',
      excerpt: '你想让哪些学习环节自动化？欢迎提交需求，我们将按票数优先开发。',
      tag: '通知',
      pinned: false
    }
  ],

  /* 小课堂 / 特别活动：主页只展示海报与要点，点进 activity.html 看帖子全文 */
  activities: [
    {
      id: 'e1',
      title: '有机化学讲课 · 羧酸衍生物',
      date: '2026-10-24',
      timePlace: '10 月 24 日（周六）18:30–20:30 · 教学楼 E203',
      reward: '院级操行 +6pu（签到满四次发放）',
      poster: '',
      excerpt: '聚焦羧酸衍生物理化性质，梳理反应机理，辨析易混考点。',
      content: '主讲人：乔凯璇（大一有机 95+，综测专业排名前百分之三）\n\n本次内容：\n一、羧酸衍生物的结构和命名\n二、羧酸衍生物的物理和化学性质\n三、碳酸衍生物\n\n梳理反应机理、辨析易混考点，帮你掌握各类衍生物的转化规律，突破有机重难点。\n\n签到满四次发放院级操行 +6pu，扫码进群报名。',
      videoUrl: '',
      tags: ['有机', '讲课系列']
    },
    {
      id: 'e2',
      title: '特别活动 · 实验室开放日',
      date: '2026-11-02',
      timePlace: '11 月 2 日 14:00 · 药学楼 3 层',
      reward: '限额 30 人，需提前报名',
      poster: '',
      excerpt: '跟着师兄师姐进实验室，看一次完整的合成与纯化流程。',
      content: '开放日分成三站：合成区、分析区、细胞房。\n\n每站 20 分钟，由在该实验室的师兄师姐带队讲解，可以随时提问。\n\n需要穿长裤和包脚鞋，实验室会提供白大褂。',
      videoUrl: '',
      tags: ['实验', '参观']
    },
    {
      id: 'e3',
      title: '小课堂 02 · 药物分析计算题专项',
      date: '2026-11-08',
      timePlace: '11 月 8 日 19:00 · 教学楼 A105',
      reward: '现场发讲义',
      poster: '',
      excerpt: '含量测定、色谱参数、滴定计算，三类题一次讲透。',
      content: '药分计算题的错误大多集中在单位换算和有效数字上，不是不会做。\n\n这次按三类题型拆开讲，每类给两道真题当堂练，讲完对答案。',
      videoUrl: '',
      tags: ['药分', '计算']
    }
  ],

  /* 加入我们：部门介绍 */
  departments: [
    {
      id: 'd1',
      name: '教学部',
      duty: '小课堂主讲 · 课程设计',
      desc: '定小课堂的选题、备课、上台讲。学院里的讲课系列活动主要由这里出人。适合愿意把一门课讲明白、也愿意被追问的人。',
      contact: ''
    },
    {
      id: 'd2',
      name: '材料部',
      duty: '资料整理 · 讲义编纂',
      desc: '整理课程笔记、历年真题与复习提纲，编小课堂讲义。资料库里绝大部分内容出自这里，是学促会最实在的产出。',
      contact: ''
    },
    {
      id: 'd3',
      name: '答疑部',
      duty: '课后答疑 · 学业帮扶',
      desc: '运营答疑群，考期组织集中答疑，对接学业帮扶计划。不只是会做题，更要能把别人卡住的地方讲通。',
      contact: ''
    },
    {
      id: 'd4',
      name: '网宣部',
      duty: '推文 · 拍摄 · 官方号运营',
      desc: '负责活动推文、现场拍摄与视频剪辑，运营哔哩哔哩和小红书官方号。视频回放的整理也归这里。',
      contact: ''
    },
    {
      id: 'd5',
      name: '美工部',
      duty: '海报 · 视觉设计',
      desc: '做活动海报、课件版式与周边设计。你在站内看到的那种竖版长图海报，就是这里出的。',
      contact: ''
    }
  ],

  library: {
    grades: ['大一', '大二', '大三', '大四', '研究生'],
    subjects: ['药物化学', '药物分析', '药剂学', '药理学', '有机化学', '分析化学', '生物化学', '其他'],
    docs: []
  },

  tools: [
    {
      id: 't1',
      name: '药化脑袋',
      desc: '药物化学结构、构象与药理作用的记忆训练，17 章 285 个药物分子，结构式为矢量绘制。',
      mark: '药化',
      tone: 'a',
      status: 'online',
      href: 'yaohua/'
    },
    {
      id: 't2',
      name: '药分脑袋',
      desc: '药物分析常用方法、色谱条件与含量计算的分层自测。',
      mark: '药分',
      tone: 'b',
      status: 'online',
      href: 'yaofen/'
    },
    {
      id: 't2b',
      name: '药剂脑袋',
      desc: '药剂学 12 章 1242 题，含名词解释、处方分析与计算题，按教学日历范围整理。',
      mark: '药剂',
      tone: 'c',
      status: 'online',
      href: 'yaoji/'
    },
    {
      id: 't3',
      name: '脑袋内容台',
      desc: '统一管理药化脑袋、药分脑袋与药剂脑袋的题目内容，改完一键发布，支持版本回滚。',
      mark: '内容',
      tone: 'c',
      status: 'online',
      href: 'console3/'
    },
    {
      id: 't4',
      name: '待开发模块',
      desc: '后续新增的小工具会出现在这里，按使用频率排序。',
      mark: '＋',
      tone: 'd',
      status: 'soon',
      href: '#'
    }
  ]
};

/* ---------- 存储层（服务器 JSON，公开读 / 凭密令写） ---------- */

const Store = {
  _cache: null,

  /** 页面启动时调用一次；失败则退回内置示例数据，站点仍可浏览 */
  async load() {
    try {
      const r = await fetch('api/data', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && j.data) {
        this._cache = this._merge(j.data);
        return this._cache;
      }
    } catch (e) {
      console.warn('[store] 读取服务器内容失败，使用内置示例数据', e);
    }
    this._cache = JSON.parse(JSON.stringify(SEED));
    return this._cache;
  },

  /** 补齐缺失字段，兼容旧数据 */
  _merge(data) {
    const base = JSON.parse(JSON.stringify(SEED));
    for (const k of Object.keys(base)) {
      if (data[k] === undefined) data[k] = base[k];
    }
    if (!data.site) data.site = base.site;
    if (!data.site.contact) data.site.contact = base.site.contact;
    if (!data.site.publication) data.site.publication = base.site.publication;
    if (!data.site.join) data.site.join = base.site.join;
    if (!data.site.home) data.site.home = base.site.home;
    if (!Array.isArray(data.site.social)) data.site.social = base.site.social;
    return data;
  },

  read() {
    return this._cache || JSON.parse(JSON.stringify(SEED));
  },

  /** 写入服务器；抛错由调用方处理 */
  async save(data) {
    const r = await fetch('api/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': CONFIG.consoleCode
      },
      body: JSON.stringify(data)
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* 非 JSON */ }
    if (!r.ok || !j || !j.ok) {
      throw new Error((j && j.error) || ('保存失败 ' + r.status));
    }
    this._cache = data;
    return j;
  },

  /** 恢复为内置示例数据（会写回服务器） */
  async reset() {
    const fresh = JSON.parse(JSON.stringify(SEED));
    await this.save(fresh);
    this._cache = fresh;
    return fresh;
  },

  announcements() {
    return this.read().announcements.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return b.date.localeCompare(a.date);
    });
  },

  activities() {
    return this.read().activities.slice().sort((a, b) => b.date.localeCompare(a.date));
  },

  tools() {
    return this.read().tools;
  },

  library() {
    return this.read().library;
  }
};

/* ---------- 工具函数 ---------- */

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(str) {
  return esc(str).replace(/\n/g, '<br>');
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return { md: '--.--', y: '', full: iso };
  const p = n => String(n).padStart(2, '0');
  return {
    md: p(d.getMonth() + 1) + '.' + p(d.getDate()),
    y: d.getFullYear(),
    full: d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'
  };
}

function tagClass(tag) {
  return ['教务', '活动', '招新', '通知'].includes(tag) ? tag : '通知';
}

function qs(key) {
  return new URLSearchParams(location.search).get(key) || '';
}

/* 内联图标：一律带 width/height 属性做兜底，避免 CSS 未命中时被撑成巨图 */
const ICON_ARROW = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h11M9 4l4 4-4 4"/></svg>';

const ICON_IMAGE = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.4"/><path d="M4 17l4.5-4.5L12 16l3-3 4.5 4.5"/></svg>';

/* 社交平台图标（内联 SVG，不依赖网络） */
const SOCIAL_ICON = {
  bilibili: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="13" rx="3"/><path d="M7 3.5 9.5 7M17 3.5 14.5 7"/><circle cx="8" cy="13" r=".8" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r=".8" fill="currentColor" stroke="none"/></svg>',
  xiaohongshu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="14" rx="3"/><path d="M8 6V4.5M16 6V4.5"/><path d="M7 11h4M7 15h7M15.5 11h1.5"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9.5" cy="9.5" rx="7" ry="6"/><circle cx="7" cy="9" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r=".8" fill="currentColor" stroke="none"/><path d="M17 11.5c2.5.6 4.5 2.7 4.5 5.2 0 1.2-.5 2.3-1.3 3.2"/></svg>'
};

/* ---------- 主页：公告 ---------- */

function renderHomeNotices(limit) {
  const box = document.getElementById('noticeList');
  if (!box) return;
  const list = Store.announcements().slice(0, limit || 4);

  box.innerHTML = list.map(item => {
    const d = fmtDate(item.date);
    return `
      <article class="notice">
        <div class="notice__date"><b>${d.md}</b>${d.y}</div>
        <div>
          <h3 class="notice__title">${esc(item.title)}</h3>
          <p class="notice__excerpt">${esc(item.excerpt)}</p>
        </div>
        <div class="notice__meta">
          ${item.pinned ? '<span class="notice__pin">置顶</span>' : ''}
          <span class="tag tag--${tagClass(item.tag)}">${esc(item.tag)}</span>
        </div>
      </article>`;
  }).join('');
}

/* ---------- 小课堂 / 特别活动 ---------- */

function activityCard(a, large) {
  const d = fmtDate(a.date);
  const poster = a.poster
    ? `<div class="act-card__poster" style="background-image:url('${esc(a.poster)}')"></div>`
    : `<div class="act-card__poster act-card__poster--empty">${ICON_IMAGE}<span>海报待上传</span></div>`;

  return `
    <a class="act-card ${large ? 'act-card--large' : ''}" href="activity.html?id=${encodeURIComponent(a.id)}">
      ${poster}
      <div class="act-card__body">
        <div class="act-card__date">${d.full}</div>
        <h3 class="act-card__title">${esc(a.title)}</h3>
        <p class="act-card__excerpt">${esc(a.excerpt)}</p>
        <div class="act-card__meta">
          <span class="act-meta">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>
            ${esc(a.timePlace)}
          </span>
          ${a.reward ? `<span class="act-meta act-meta--reward">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 6h10v7H3z"/><path d="M2 3.5h12V6H2zM8 3.5V13"/></svg>
            ${esc(a.reward)}
          </span>` : ''}
        </div>
      </div>
    </a>`;
}

function renderHomeActivities() {
  const box = document.getElementById('activityList');
  if (!box) return;
  const list = Store.activities().slice(0, 3);
  if (!list.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><p class="empty__title">暂无活动安排</p><p class="empty__desc">小课堂与特别活动会在这里预告。</p></div>`;
    return;
  }
  box.innerHTML = list.map(a => activityCard(a, false)).join('');
}

function renderActivityList() {
  const box = document.getElementById('activityFullList');
  if (!box) return;
  const list = Store.activities();
  if (!list.length) {
    box.innerHTML = `<div class="empty"><p class="empty__title">还没有活动</p><p class="empty__desc">活动发布后会出现在这里。</p></div>`;
    return;
  }
  box.innerHTML = list.map(a => activityCard(a, false)).join('');
}

function renderActivityDetail() {
  const box = document.getElementById('activityDetail');
  if (!box) return;
  const id = qs('id');
  const a = Store.activities().find(x => x.id === id);

  if (!a) {
    box.innerHTML = `<div class="empty"><p class="empty__title">找不到这条活动</p><p class="empty__desc">它可能已被删除。<br><a href="activities.html" style="color:var(--green)">返回活动列表</a></p></div>`;
    return;
  }

  document.title = a.title + ' · 学习小站';

  const d = fmtDate(a.date);
  const poster = a.poster
    ? `<div class="post__poster" style="background-image:url('${esc(a.poster)}')"></div>`
    : `<div class="post__poster post__poster--empty">${ICON_IMAGE}<span>海报待上传</span></div>`;

  box.innerHTML = `
    <article class="post">
      ${poster}
      <div class="post__body">
        <div class="post__head">
          <span class="post__date">${d.full}</span>
          ${(a.tags || []).map(t => `<span class="tag tag--通知">${esc(t)}</span>`).join('')}
        </div>
        <h1 class="post__title">${esc(a.title)}</h1>

        <div class="post__info">
          <div class="post__info-row">
            <span class="post__info-label">时间地点</span>
            <span>${esc(a.timePlace)}</span>
          </div>
          ${a.reward ? `<div class="post__info-row">
            <span class="post__info-label">参与奖励</span>
            <span>${esc(a.reward)}</span>
          </div>` : ''}
        </div>

        <div class="post__content">${nl2br(a.content)}</div>

        ${a.videoUrl ? `
          <a class="post__video" href="${esc(a.videoUrl)}" target="_blank" rel="noopener">
            <span class="post__video-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
            <span>
              <b>视频回放</b>
              <em>点击跳转观看</em>
            </span>
            ${ICON_ARROW}
          </a>` : ''}
      </div>
    </article>

    <div class="post__back">
      <a class="link-more" href="activities.html">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8H3M7 4L3 8l4 4"/></svg>
        返回活动列表
      </a>
    </div>`;
}

/* ---------- 加入我们 ---------- */

function renderDepartments() {
  const box = document.getElementById('deptGrid');
  if (!box) return;
  const list = Store.read().departments || [];
  if (!list.length) {
    box.innerHTML = `<div class="empty"><p class="empty__title">部门信息待补充</p><p class="empty__desc">内容台 → 站点信息 里可以添加。</p></div>`;
    return;
  }
  box.innerHTML = list.map((d, i) => `
    <div class="dept">
      <div class="dept__no">${String(i + 1).padStart(2, '0')}</div>
      <h3 class="dept__name">${esc(d.name)}</h3>
      <div class="dept__duty">${esc(d.duty)}</div>
      <p class="dept__desc">${esc(d.desc)}</p>
      ${d.contact ? `<div class="dept__contact">${esc(d.contact)}</div>` : ''}
    </div>`).join('');
}

/* ---------- 页脚：新生刊 / 联系 / 社交 ---------- */

function renderFooter() {
  const data = Store.read();
  const s = data.site || {};
  const pub = s.publication || {};
  const con = s.contact || {};
  const social = s.social || [];

  const pubBox = document.getElementById('footPublication');
  if (pubBox) {
    const href = pub.image || pub.url || '';
    pubBox.innerHTML = `
      <p class="foot__label">新生刊</p>
      <h4 class="foot__title">${esc(pub.name || '新生刊')} <span>${esc(pub.issue || '')}</span></h4>
      <p class="foot__desc">${esc(pub.desc || '')}</p>
      ${href
        ? `<a class="foot__link foot__link--cta" href="${esc(href)}" target="_blank" rel="noopener">阅读链接 ${ICON_ARROW}</a>`
        : `<span class="foot__pending">链接待补充</span>`}`;
  }

  const conBox = document.getElementById('footContact');
  if (conBox) {
    const rows = contactItems(con)
      .filter(i => i.value && String(i.value).trim())
      .map(i => `<li><b>${esc(i.label || '')}</b><span>${nl2br(i.value)}</span></li>`);
    conBox.innerHTML = `
      <p class="foot__label">${esc(con.title || '合作与联系')}</p>
      <p class="foot__desc">${esc(con.text || '')}</p>
      ${rows.length
        ? `<ul class="foot__contact">${rows.join('')}</ul>`
        : `<span class="foot__pending">联系方式待补充</span>`}`;
  }

  const socialBox = document.getElementById('footSocial');
  if (socialBox) {
    socialBox.innerHTML = `
      <p class="foot__label">关注我们</p>
      <div class="social-list">
        ${social.map(x => {
          const icon = SOCIAL_ICON[x.platform] || SOCIAL_ICON.wechat;
          const inner = `
            <span class="social__icon">${icon}</span>
            <span class="social__text">
              <b>${esc(x.label)}</b>
              <em>${esc(x.handle || x.note || '待补充')}</em>
            </span>`;
          return x.url
            ? `<a class="social" href="${esc(x.url)}" target="_blank" rel="noopener">${inner}${ICON_ARROW}</a>`
            : `<div class="social social--pending">${inner}</div>`;
        }).join('')}
      </div>`;
  }
}

/* ---------- 小帮手 / 统计 ---------- */

function renderIntroMeta() {
  const box = document.getElementById('introMeta');
  if (!box) return;
  const data = Store.read();
  const items = [
    { num: data.announcements.length, label: '条公告' },
    { num: (data.activities || []).length, label: '场活动' },
    { num: data.tools.filter(t => t.status === 'online').length, label: '个工具' }
  ];
  box.innerHTML = items.map(i => `
    <div class="meta-item">
      <span class="meta-num">${i.num}</span>
      <span class="meta-label">${i.label}</span>
    </div>`).join('');
}

function renderHomeTools() {
  const box = document.getElementById('toolGrid');
  if (!box) return;
  const list = Store.tools();

  box.innerHTML = list.map(t => `
    <a class="tool ${t.status === 'soon' ? 'tool--soon' : ''}" href="${esc(t.href || '#')}"
       data-name="${esc(t.name)}" data-soon="${t.status === 'soon' ? '1' : ''}">
      <div class="tool__mark tool__mark--${esc(t.tone)}">${esc(t.mark)}</div>
      <div class="tool__body">
        <h3 class="tool__name">${esc(t.name)}</h3>
        <p class="tool__desc">${esc(t.desc)}</p>
      </div>
      <span class="tool__status">${t.status === 'soon' ? '规划中' : '已上线'}</span>
    </a>`).join('');

  box.querySelectorAll('.tool').forEach(el => {
    el.addEventListener('click', e => {
      const href = el.getAttribute('href');
      if (el.dataset.soon) {
        e.preventDefault();
        alert('这个模块还在规划中。如果你有具体需求，可以在公告栏留言。');
        return;
      }
      if (!href || href === '#') {
        e.preventDefault();
        alert('「' + el.dataset.name + '」的页面地址还没配置。\n进入内容台 → 模块管理，把链接填上即可跳转。');
      }
    });
  });
}

/* ---------- 公告全览页 ---------- */

let annFilter = '全部';

function renderAnnouncements() {
  const box = document.getElementById('annList');
  if (!box) return;
  const all = Store.announcements();
  const list = annFilter === '全部' ? all : all.filter(i => i.tag === annFilter);

  const countEl = document.getElementById('annCount');
  if (countEl) countEl.textContent = list.length;

  if (!list.length) {
    box.innerHTML = `<div class="empty"><p class="empty__title">该分类下暂无公告</p><p class="empty__desc">换个分类看看，或回到主页。</p></div>`;
    return;
  }

  box.innerHTML = list.map(item => {
    const d = fmtDate(item.date);
    return `
      <article class="ann-item">
        <div class="ann-item__date">${d.full}</div>
        <div>
          <h3 class="ann-item__title">${esc(item.title)}</h3>
          <p class="ann-item__excerpt">${esc(item.excerpt)}</p>
        </div>
        <div class="notice__meta">
          ${item.pinned ? '<span class="notice__pin">置顶</span>' : ''}
          <span class="tag tag--${tagClass(item.tag)}">${esc(item.tag)}</span>
        </div>
      </article>`;
  }).join('');
}

function initAnnouncementFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      annFilter = btn.dataset.tag;
      renderAnnouncements();
    });
  });
}

/* ---------- 资料库页 ---------- */

let libGrade = '全部';
let libSubject = '全部';

function renderLibrary() {
  const sideGrades = document.getElementById('libGrades');
  const sideSubjects = document.getElementById('libSubjects');
  const grid = document.getElementById('libGrid');
  const count = document.getElementById('libCount');
  if (!grid) return;

  const lib = Store.library();

  if (sideGrades) {
    sideGrades.innerHTML = ['全部'].concat(lib.grades).map(g => `
      <li><button data-grade="${esc(g)}" class="${g === libGrade ? 'is-active' : ''}">${esc(g)}</button></li>`).join('');
    sideGrades.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { libGrade = b.dataset.grade; renderLibrary(); });
    });
  }

  if (sideSubjects) {
    sideSubjects.innerHTML = ['全部'].concat(lib.subjects).map(s => `
      <li><button data-subject="${esc(s)}" class="${s === libSubject ? 'is-active' : ''}">${esc(s)}</button></li>`).join('');
    sideSubjects.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => { libSubject = b.dataset.subject; renderLibrary(); });
    });
  }

  const docs = (lib.docs || []).filter(d =>
    (libGrade === '全部' || d.grade === libGrade) &&
    (libSubject === '全部' || d.subject === libSubject)
  );

  if (count) count.innerHTML = `共 <b>${docs.length}</b> 份资料`;

  if (!docs.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <p class="empty__title">资料正在整理中</p>
        <p class="empty__desc">
          首批资料将于近期上传，目前按「${esc(libGrade)} / ${esc(libSubject)}」筛选。<br>
          如果你有愿意共享的笔记或真题，欢迎联系学促会。
        </p>
      </div>`;
    return;
  }

  grid.innerHTML = docs.map(d => `
    <a class="doc-card" href="${esc(d.url || '#')}" ${d.url ? 'target="_blank" rel="noopener"' : ''}>
      <div class="doc-card__ext">${esc((d.ext || 'PDF').toUpperCase())}</div>
      <div class="doc-card__body">
        <h3 class="doc-card__name">${esc(d.name)}</h3>
        <div class="doc-card__meta">
          <span>${esc(d.grade)}</span><span>${esc(d.subject)}</span><span>${esc(fmtDocSize(d.size))}</span>
        </div>
      </div>
    </a>`).join('');
}

/** 联系方式条目：优先用 items 数组，老数据（qq/email/wechat/person）自动转换 */
function contactItems(con) {
  if (Array.isArray(con.items)) return con.items;
  const out = [];
  if (con.qq) out.push({ label: 'QQ 群', value: con.qq });
  if (con.email) out.push({ label: '邮箱', value: con.email });
  if (con.wechat) out.push({ label: '微信', value: con.wechat });
  if (con.person) out.push({ label: '联系人', value: con.person });
  return out;
}

/** 资料大小：兼容纯字节数（320749）与已格式化文本（313 KB） */
function fmtDocSize(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  return s;
}

/** 首页首屏文案；标题里用 **词** 标记高亮 */
function renderHomeIntro() {
  const h = (Store.read().site || {}).home || {};
  const eb = document.getElementById('introEyebrow');
  if (eb && h.eyebrow && String(h.eyebrow).trim()) eb.textContent = h.eyebrow;
  const ti = document.getElementById('introTitle');
  if (ti && h.title && String(h.title).trim()) {
    ti.innerHTML = esc(h.title).replace(/\*\*([^*]+)\*\*/g, '<em>$1</em>');
  }
  const tx = document.getElementById('introText');
  if (tx && h.text && String(h.text).trim()) tx.textContent = h.text;
}

/** 加入我们页：用数据覆盖默认文案（留空则保留 HTML 里的原文） */
function renderJoinPage() {
  const j = (Store.read().site || {}).join || {};
  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el && v && String(v).trim()) el.textContent = v;
  };
  setText('joinTitle', j.title);
  setText('joinIntro', j.intro);
  setText('joinDeptTitle', j.deptTitle);
  setText('joinDeptDesc', j.deptDesc);
  setText('joinHowTitle', j.howTitle);
  setText('joinHowDesc', j.howDesc);
  const howEl = document.getElementById('joinHowText');
  if (howEl && j.howText && String(j.howText).trim()) howEl.innerHTML = nl2br(j.howText);
}

/* ---------- 内容台：密令 ---------- */

function consoleUnlocked() {
  return sessionStorage.getItem(CONFIG.sessionKey) === '1';
}

function lockConsole() {
  sessionStorage.removeItem(CONFIG.sessionKey);
  location.href = 'index.html';
}

function mountGate(onPass) {
  const gate = document.getElementById('gate');
  const app = document.getElementById('consoleApp');
  const input = document.getElementById('codeInput');
  const btn = document.getElementById('codeBtn');
  const err = document.getElementById('codeError');

  if (consoleUnlocked()) {
    if (gate) gate.style.display = 'none';
    if (app) app.style.display = 'block';
    onPass && onPass();
    return;
  }

  if (gate) gate.style.display = 'block';
  if (app) app.style.display = 'none';
  if (input) setTimeout(() => input.focus(), 120);

  const submit = () => {
    const val = (input.value || '').trim();
    if (val === CONFIG.consoleCode) {
      sessionStorage.setItem(CONFIG.sessionKey, '1');
      if (gate) gate.style.display = 'none';
      if (app) app.style.display = 'block';
      onPass && onPass();
    } else {
      if (err) err.classList.add('is-on');
      input.value = '';
      input.focus();
    }
  };

  if (btn) btn.addEventListener('click', submit);
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', () => err && err.classList.remove('is-on'));
  }
}

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  await Store.load();
  renderIntroMeta();
  renderHomeNotices(4);
  renderHomeActivities();
  renderHomeTools();
  renderFooter();
  renderDepartments();
  renderJoinPage();
  renderHomeIntro();
  renderAnnouncements();
  initAnnouncementFilters();
  renderActivityList();
  renderActivityDetail();
  renderLibrary();
});
