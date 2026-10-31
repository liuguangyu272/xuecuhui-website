#!/usr/bin/env node
'use strict';
/**
 * 内容台本地服务 —— 让「一键导出并更新」真的能写盘，并且每次更新都留档
 *
 * 用法：双击 `启动内容台.cmd`（或 node server.js），浏览器会自动打开 http://127.0.0.1:8788/
 *       Ctrl+C 关闭。
 *
 * 它做四件事：
 *   1. 静态托管本文件夹（index.html / content_data.js）
 *   2. POST /api/publish   写入 data_*.js、合并药化卡片（调 RDKit 脚本）、重建 content_data.js
 *   3. 每次发布前后都做快照 → _versions/vNNN_时间_备注/
 *   4. GET /api/versions、POST /api/rollback  → 版本列表与一键回滚
 *
 * 安全：只监听 127.0.0.1；写接口要求 Content-Type: application/json（跨站无法静默提交）；
 *       所有写入走 tmp+rename，写前自动快照，校验失败自动回滚。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const P2 = '/www/wwwroot/xuecuhui/yaofen';
const P3 = '/www/wwwroot/xuecuhui/yaoji';
// 药化源目录：内容台改这里的 molecules.js，发布时打包成单文件写到线上
const P1 = '/opt/xuecuhui-console/yaohua-src';
const YAOHUA_OUT = '/www/wwwroot/xuecuhui/yaohua/index.html';
const VDIR = path.join(ROOT, '_versions');
const PRE = path.join(VDIR, '.pre');
const TOKEN = process.env.CONSOLE_TOKEN;
const PORT = parseInt(process.env.CONSOLE_PORT || '8789', 10);

const YF_NEED = ['data_choice.js', 'data_blank.js', 'data_qa.js', 'data_calc.js'];
const YJ_NEED = ['data_term.js', 'data_choice.js', 'data_blank.js', 'data_qa.js', 'data_rx.js'];

const ARCHIVE = [
  { key: 'data_choice.js', abs: () => path.join(P2, 'data_choice.js') },
  { key: 'data_blank.js', abs: () => path.join(P2, 'data_blank.js') },
  { key: 'data_qa.js', abs: () => path.join(P2, 'data_qa.js') },
  { key: 'data_calc.js', abs: () => path.join(P2, 'data_calc.js') },
  { key: 'molecules.js', abs: () => path.join(P1, 'molecules.js') },
  { key: 'content_data.js', abs: () => path.join(ROOT, 'content_data.js') },
  { key: '药分脑袋-单文件.html', abs: () => path.join(P2, '药分脑袋-单文件.html') },
  // 药剂脑袋
  { key: 'yj_data_term.js', abs: () => path.join(P3, 'data_term.js') },
  { key: 'yj_data_choice.js', abs: () => path.join(P3, 'data_choice.js') },
  { key: 'yj_data_blank.js', abs: () => path.join(P3, 'data_blank.js') },
  { key: 'yj_data_qa.js', abs: () => path.join(P3, 'data_qa.js') },
  { key: 'yj_data_rx.js', abs: () => path.join(P3, 'data_rx.js') },
];

const PY_CANDIDATES = [
  '/usr/bin/python3',
  'python3', 'python',
];

let BUSY = false;
let PY = null;          // 已探测到的、带 RDKit 的解释器
let PY_TRIED = false;

/* ------------------------------ 小工具 ------------------------------ */

const ensure = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };
const exists = p => { try { return fs.existsSync(p) } catch (e) { return false } };
const nowStamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const safeName = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 24) || '未命名';

function atomicWrite(dest, text) {
  ensure(path.dirname(dest));
  const tmp = dest + '.ct-tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, dest);
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (e) { reject(new Error('JSON 解析失败')) }
    });
    req.on('error', reject);
  });
}

/* ------------------------------ 快照 ------------------------------ */

function nextSeq() {
  ensure(VDIR);
  let max = 0;
  for (const name of fs.readdirSync(VDIR)) {
    const m = /^v(\d{3})_/.exec(name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** 把当前 6 个数据文件复制到 dir；返回实际归档到的文件名列表 */
function snapshotInto(dir) {
  ensure(dir);
  const got = [];
  for (const f of ARCHIVE) {
    const src = f.abs();
    if (!exists(src)) continue;
    fs.copyFileSync(src, path.join(dir, f.key));
    got.push(f.key);
  }
  return got;
}

/** 正式版本快照：_versions/vNNN_时间_备注/  内含 manifest.json */
function makeVersion(note, extra) {
  ensure(VDIR);
  const seq = nextSeq();
  const id = `v${String(seq).padStart(3, '0')}_${nowStamp()}_${safeName(note)}`;
  const dir = path.join(VDIR, id);
  const files = snapshotInto(dir);
  const stat = {};
  for (const k of files) stat[k] = fs.statSync(path.join(dir, k)).size;
  const manifest = { id, seq, at: new Date().toISOString(), note: note || '', files: stat, ...(extra || {}) };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
  return { id, dir, manifest };
}

function preSnapshot() {
  ensure(VDIR);
  if (exists(PRE)) fs.rmSync(PRE, { recursive: true, force: true });
  snapshotInto(PRE);
  return PRE;
}

function restoreFrom(dir) {
  for (const f of ARCHIVE) {
    const src = path.join(dir, f.key);
    if (exists(src)) fs.copyFileSync(src, f.abs());
  }
}

/* ------------------------------ 校验 ------------------------------ */

function verifyAll() {
  const out = { ok: true, detail: {} };
  const runJs = (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(text, ctx, { filename: path.basename(file), timeout: 8000 });
    return ctx;
  };
  for (const name of ['data_choice.js', 'data_blank.js', 'data_qa.js', 'data_calc.js']) {
    try {
      const ctx = runJs(path.join(P2, name));
      const n = (ctx.window.QB || []).length;
      out.detail[name] = n;
      if (!n) { out.ok = false; out.detail[name] = '0 题'; }
    } catch (e) { out.ok = false; out.detail[name] = '解析失败: ' + e.message }
  }
  // 药剂
  for (const name of YJ_NEED) {
    const fp = path.join(P3, name);
    if (!exists(fp)) continue;
    try {
      const ctx = runJs(fp);
      const n = (ctx.window.QB || []).length;
      out.detail['yj/' + name] = n;
      if (!n) { out.ok = false; out.detail['yj/' + name] = '0 题'; }
    } catch (e) { out.ok = false; out.detail['yj/' + name] = '解析失败: ' + e.message }
  }
  try {
    const text = fs.readFileSync(path.join(P1, 'molecules.js'), 'utf8')
      + '\n;globalThis.__M = MOLECULES; globalThis.__C = CHAPTERS;';
    const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(text, ctx, { filename: 'molecules.js', timeout: 15000 });
    const n = ctx.__M.length;
    out.detail['molecules.js'] = n;
    if (!n) { out.ok = false; out.detail['molecules.js'] = '0 张' }
    const bad = ctx.__M.filter(m => !m.svg || !m.smi || !m.cn).length;
    if (bad) { out.ok = false; out.detail['molecules.js.bad'] = bad }
  } catch (e) { out.ok = false; out.detail['molecules.js'] = '解析失败: ' + e.message }
  try {
    const ctx = runJs(path.join(ROOT, 'content_data.js'));
    const init = ctx.window.CT_INIT || {};
    out.detail['content_data.js'] = `${(init.pharm || []).length} 题 / ${(init.cards || []).length} 卡`;
    if (!(init.pharm || []).length) { out.ok = false }
  } catch (e) { out.ok = false; out.detail['content_data.js'] = '解析失败: ' + e.message }
  return out;
}

/* ------------------------------ 子进程 ------------------------------ */

function findPython() {
  if (PY_TRIED) return PY;
  PY_TRIED = true;
  for (const cand of PY_CANDIDATES) {
    if (cand.includes('\\') && !exists(cand)) continue;
    try {
      const r = spawnSync(cand, ['-c', 'import rdkit;print(1)'], { encoding: 'utf8', timeout: 20000 });
      if (r.status === 0 && String(r.stdout).includes('1')) { PY = cand; break }
    } catch (e) { /* 继续试下一个 */ }
  }
  return PY;
}

function runMerge(cards, remove) {
  const py = findPython();
  if (!py) return { ok: false, log: '找不到带 RDKit 的 Python 解释器，药化卡片这次没并进去' };
  const tmp = path.join(ROOT, '_tmp_cards.json');
  fs.writeFileSync(tmp, JSON.stringify(cards || [], null, 1), 'utf8');
  const args = ['merge_cards.py', tmp];
  if (remove && remove.length) args.push('--remove=' + remove.join(','));
  const r = spawnSync(py, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
  });
  try { fs.unlinkSync(tmp) } catch (e) { }
  const log = ((r.stdout || '') + (r.stderr || '')).trim();
  return { ok: r.status === 0, log: log.slice(-4000) };
}

function runGenData() {
  const r = spawnSync(process.execPath, ['gen_data.js'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
  });
  return { ok: r.status === 0, log: ((r.stdout || '') + (r.stderr || '')).trim().slice(-2000) };
}

/** 药分脑袋的单文件版（双击即用）顺手重建一次，免得跟 data_*.js 不一致 */
function buildSingleFile() {
  const idx = path.join(P2, 'index.html'), out = path.join(P2, '药分脑袋-单文件.html');
  if (!exists(idx) || !exists(out)) return null;
  let html = fs.readFileSync(idx, 'utf8'), n = 0;
  for (const f of ['data_choice.js', 'data_blank.js', 'data_qa.js', 'data_calc.js']) {
    const tag = `<script src="${f}"></script>`;
    if (!html.includes(tag)) continue;
    html = html.replace(tag, `<script>\n${fs.readFileSync(path.join(P2, f), 'utf8')}\n</script>`);
    n++;
  }
  if (!n) return null;
  atomicWrite(out, html);
  return out;
}

/** 药化：把源目录（index.html + molecules.js + img/）打包成单文件，写到线上 yaohua/index.html */
function buildYaohuaSingle() {
  const script = path.join(ROOT, 'build_single.py');
  if (!exists(script)) return { ok: false, error: 'build_single.py 缺失' };
  const r = spawnSync('/usr/bin/python3', [script], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
  });
  const out = String(r.stdout || '').trim();
  try {
    return JSON.parse(out);
  } catch (e) {
    return { ok: false, error: (out || String(r.stderr || '')).slice(-600) };
  }
}

/* ------------------------------ 发布 ------------------------------ */

function publish(payload) {
  const files = payload.files || {};
  // key 形如 yf/data_choice.js 或 yj/data_term.js；也兼容旧的裸文件名（默认药分）
  const entries = [];
  for (const k of Object.keys(files)) {
    let dir = null, name = k;
    if (k.startsWith('yj/')) { dir = P3; name = k.slice(3) }
    else if (k.startsWith('yf/')) { dir = P2; name = k.slice(3) }
    else if (YF_NEED.includes(k)) { dir = P2 }
    if (!dir) return { ok: false, error: '未知文件：' + k };
    if (name.includes('/') || name.includes('..')) return { ok: false, error: '非法文件名：' + k };
    const t = files[k];
    if (typeof t !== 'string' || !t.includes('QB.push')) {
      return { ok: false, error: `缺少或格式不对：${k}` };
    }
    entries.push({ key: k, dest: path.join(dir, name) });
  }
  if (!entries.length) return { ok: false, error: '没有要写入的文件' };
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const remove = Array.isArray(payload.remove) ? payload.remove : [];
  const note = (payload.note || '').trim() || '内容更新';
  const t0 = Date.now();

  preSnapshot();                       // ① 动手之前先留一份
  if (listVersions().length === 0) {
    // 第一次更新：把"没被改过的原始状态"也永久存一份，之后随时能退回到这儿
    makeVersion('初始状态', { counts: null, initial: true });
  }
  const wrote = [];
  for (const it of entries) {
    atomicWrite(it.dest, files[it.key]);
    wrote.push(it.key);
  }

  let merge = null;
  if (cards.length || remove.length) {
    merge = runMerge(cards, remove);
    if (!merge.ok) {                   // 合并失败 → 立刻还原
      restoreFrom(PRE);
      return { ok: false, error: '药化卡片合并失败，已还原到更新前的状态', log: merge.log };
    }
  }

  const gen = runGenData();            // ② 重建内容台启动数据
  let single = null;
  try { single = buildSingleFile() } catch (e) { /* 单文件重建失败不影响主流程 */ }
  const ver = verifyAll();             // ③ 校验
  if (!ver.ok || !gen.ok) {
    restoreFrom(PRE);
    runGenData();
    return {
      ok: false,
      error: '写入后校验没通过，已自动还原到更新前的状态',
      detail: ver.detail, log: (gen.log || ''),
    };
  }

  const snap = makeVersion(note, {               // ④ 这次发布留档
    counts: payload.counts || {},
    filesWritten: wrote,
    singleFile: !!single,
    cards: cards.length,
    removed: remove.length,
    merge: merge ? (merge.log || '').split('\n').filter(l => l.trim()).slice(0, 40) : [],
  });

  // ⑤ 药化单文件重建（校验已通过才做，失败只告警不回滚）
  let yaohua = null;
  if (cards.length || remove.length) {
    yaohua = buildYaohuaSingle();
  }

  return {
    ok: true,
    version: snap.id,
    dir: path.relative(ROOT, snap.dir),
    counts: payload.counts || {},
    cardsMerged: cards.length,
    cardsRemoved: remove.length,
    verify: ver.detail,
    mergeLog: merge ? merge.log : '',
    yaohua,
    ms: Date.now() - t0,
  };
}

function rollback(id) {
  const dir = path.join(VDIR, id);
  if (!exists(dir) || !exists(path.join(dir, 'manifest.json'))) {
    return { ok: false, error: '找不到这个版本' };
  }
  preSnapshot();
  restoreFrom(dir);
  const ver = verifyAll();
  if (!ver.ok) {
    restoreFrom(PRE);
    return { ok: false, error: '回滚后校验没通过，已还原到回滚前', detail: ver.detail };
  }
  const snap = makeVersion('回滚至-' + id.split('_')[0], { rolledBackTo: id, counts: null });
  return { ok: true, version: snap.id, verify: ver.detail };
}

function listVersions() {
  ensure(VDIR);
  const out = [];
  for (const name of fs.readdirSync(VDIR)) {
    if (name.startsWith('.')) continue;
    const mf = path.join(VDIR, name, 'manifest.json');
    if (!exists(mf)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      let size = 0;
      for (const f of m.files ? Object.keys(m.files) : []) size += m.files[f] || 0;
      out.push({
        id: m.id, at: m.at, note: m.note, seq: m.seq,
        counts: m.counts || null, size, rolledBackTo: m.rolledBackTo || null,
      });
    } catch (e) { /* 坏快照跳过 */ }
  }
  return out.sort((a, b) => b.seq - a.seq);
}

/* ------------------------------ HTTP ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT) || !exists(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  // 鉴权：经 nginx 反代后 Host 不再是 127.0.0.1，改用口令校验
  if (String(req.headers['x-token'] || '') !== TOKEN) {
    return json(res, 403, { ok: false, error: '密令不正确' });
  }

  try {
    if (req.method === 'GET' && p === '/api/status') {
      return json(res, 200, {
        ok: true, mode: 'server', python: !!findPython(),
        targets: { p1: exists(path.join(P1, 'molecules.js')), p2: exists(path.join(P2, 'data_choice.js')) },
        versions: listVersions().length, busy: BUSY,
      });
    }
    if (req.method === 'GET' && p === '/api/versions') {
      return json(res, 200, { ok: true, versions: listVersions() });
    }
    if (req.method === 'POST' && p === '/api/publish') {
      if (BUSY) return json(res, 429, { ok: false, error: '上一次更新还没结束，稍等一下' });
      const ct = String(req.headers['content-type'] || '');
      if (!ct.includes('application/json')) return json(res, 415, { ok: false, error: '需要 application/json' });
      const body = await readBody(req);
      BUSY = true;
      try { return json(res, 200, publish(body)) }
      finally { BUSY = false }
    }
    if (req.method === 'POST' && p === '/api/snapshot') {
      const body = await readBody(req);
      const snap = makeVersion((body.note || '').trim() || '手动存档', { counts: body.counts || null, manual: true });
      return json(res, 200, { ok: true, version: snap.id });
    }
    if (req.method === 'POST' && p === '/api/rollback') {
      if (BUSY) return json(res, 429, { ok: false, error: '正在写入，稍等' });
      const body = await readBody(req);
      if (!body.version) return json(res, 400, { ok: false, error: '缺少 version' });
      BUSY = true;
      try { return json(res, 200, rollback(String(body.version))) }
      finally { BUSY = false }
    }
    return json(res, 404, { ok: false, error: '没有这个接口' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
});

server.once('error', err => {
  console.error('[console3] ' + err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log('');
  console.log('  脑袋内容台 · 服务已启动');
  console.log('  ' + url);
  console.log('  数据目录：' + P2);
  console.log('  版本留档：' + VDIR);
  console.log('');
});
