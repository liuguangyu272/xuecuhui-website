const fs = require('fs'), vm = require('vm'), path = require('path');

const P1 = '/www/wwwroot/xuecuhui/yaohua';
const P2 = '/www/wwwroot/xuecuhui/yaofen';
const P3 = '/www/wwwroot/xuecuhui/yaoji';
const ROOT = __dirname;

const YF_FILES = ['data_choice.js', 'data_blank.js', 'data_qa.js', 'data_calc.js'];
const YJ_FILES = ['data_term.js', 'data_choice.js', 'data_blank.js', 'data_qa.js', 'data_rx.js'];

function readQB(dir, files) {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return (ctx.window.QB || []).map(q => {
    const o = { id: q.id, type: q.type, chap: q.chap, q: q.q };
    if (q.no) o.no = String(q.no);
    if (q.ch) o.ch = q.ch;
    if (q.opts) o.opts = q.opts;
    if (q.ans) o.ans = q.ans;
    if (q.a) o.a = q.a;
    if (q.exp) o.exp = q.exp;
    return o;
  });
}

const QB = readQB(P2, YF_FILES);
const YJQB = readQB(P3, YJ_FILES);

// 药化
const src = fs.readFileSync(path.join(P1, 'molecules.js'), 'utf8').replace(/^const /gm, 'globalThis.');
const c2 = {}; vm.createContext(c2); vm.runInContext(src, c2, { filename: 'molecules.js' });
const CARDS = c2.MOLECULES.map(m => ({ id: m.id, cn: m.cn, en: m.en, group: m.group, chapter: m.chapter, klass: m.klass, effect: m.effect, smi: m.smi }));

const CHAPS = JSON.parse(fs.readFileSync(path.join(P2, 'chaps.json'), 'utf8'));
const MCHAPS = c2.CHAPTERS;

// 药剂学章节（与 yaoji/index.html 的 CHAPS 保持一致）
const YJ_CHAPS = [
  { id: 'c1',  no: 1,  wk: '1',     name: '绪论',                 btn: '绪论',        short: '绪论' },
  { id: 'c2',  no: 2,  wk: '2',     name: '药物制剂的设计',       btn: '制剂设计',    short: '药物制剂的设计' },
  { id: 'c3',  no: 3,  wk: '3',     name: '药物制剂的稳定性',     btn: '稳定性',      short: '药物制剂的稳定性' },
  { id: 'c4',  no: 4,  wk: '4',     name: '药用辅料',             btn: '药用辅料',    short: '药用辅料' },
  { id: 'c5',  no: 5,  wk: '5–6',   name: '液体制剂',             btn: '液体制剂',    short: '液体制剂' },
  { id: 'c6',  no: 6,  wk: '7–8',   name: '无菌制剂',             btn: '无菌制剂',    short: '无菌制剂' },
  { id: 'c7',  no: 7,  wk: '8–11',  name: '固体制剂与片剂',       btn: '固体制剂·片剂', short: '固体制剂与片剂' },
  { id: 'c9',  no: 9,  wk: '12',    name: '半固体制剂',           btn: '半固体制剂',  short: '半固体制剂' },
  { id: 'c10', no: 10, wk: '13',    name: '雾化制剂',             btn: '雾化制剂',    short: '雾化制剂' },
  { id: 'c11', no: 11, wk: '14',    name: '制剂新技术',           btn: '制剂新技术',  short: '制剂新技术' },
  { id: 'c12', no: 12, wk: '15–16', name: '缓释与控释制剂',       btn: '缓控释',      short: '缓释与控释制剂' },
  { id: 'c13', no: 13, wk: '17',    name: '靶向制剂与经皮制剂',   btn: '靶向·经皮',   short: '靶向与经皮制剂' },
];

const out = {
  pharm: QB,
  yaoji: YJQB,
  cards: CARDS,
  chaps: CHAPS,
  chapsYj: YJ_CHAPS,
  mchaps: MCHAPS,
  max: { c: 59, b: 60, q: 82, n: 36 }
};
fs.writeFileSync(path.join(ROOT, 'content_data.js'), 'window.CT_INIT = ' + JSON.stringify(out) + ';\n', 'utf8');
console.log('药分', QB.length, '药剂', YJQB.length, '药化卡片', CARDS.length,
            'size KB', Math.round(JSON.stringify(out).length / 1024));
