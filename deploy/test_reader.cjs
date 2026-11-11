/* Browser integration tests. Only an isolated local API is mutated. */
const {chromium} = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = process.env.READER_QA_DIR || path.join(require('os').tmpdir(), 'xuecuhui-reader-qa');
fs.mkdirSync(out, {recursive: true});
const original = JSON.parse(fs.readFileSync(path.join(root, 'resources/content.json'), 'utf8'));
let data = structuredClone(original);
data.library.docs = [
  {id: 'math', name: '高数十月复习资料', grade: '大一', subject: '高等数学', ext: 'md', url: 'assets/docs/math.md'},
  {id: 'mixed', name: '公式、结构式与代码', grade: '大一', subject: '有机化学', ext: 'md', url: 'assets/docs/mixed.md'},
  {id: 'pdf', name: 'PDF 阅读测试', grade: '大二', subject: '药物化学', ext: 'pdf', url: 'assets/docs/test.pdf'},
  {id: 'broken', name: '损坏的 PDF', ext: 'pdf', url: 'assets/docs/broken.pdf'},
  {id: 'missing', name: '丢失的文件', ext: 'md', url: 'assets/docs/missing.md'}
];
let revision = 1, failSave = false, uploadCount = 0;
const uploads = new Map();
const mixed = '# 混合材料\n\n## 数学与化学\n\n行内 $E=mc^2$ 与 \\(a+b\\)。\n\n$$\\frac{1}{2}+\\sqrt{x}$$\n\n$$\\ce{CH3COOH <=> H+ + CH3COO-}$$\n\n```smiles\nCC(=O)O\n```\n\n```python\nprint("$x$")\n```\n\n| 标题 | 内容 |\n| --- | --- |\n| 项目 | **加粗** |\n\n[相对附件](other.pdf)\n\n<script>window.injected=true</script>\n\n[危险](javascript:alert(1))';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.md':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.bcmap':'application/octet-stream','.wasm':'application/wasm','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.pdf':'application/pdf'};
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const json = (value, code = 200) => {res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(value));};
  if (pathname === '/api/data') {
    if (req.method === 'POST') {
      const parts = []; for await (const part of req) parts.push(part);
      if (req.headers['x-token'] !== 'test-only') return json({ok:false,error:'unauthorized'},401);
      if (failSave) {failSave=false; return json({ok:false,error:'simulated conflict'},409);}
      assert.equal(req.headers['if-match'], String(revision));
      data = JSON.parse(Buffer.concat(parts).toString()); revision++;
    }
    return json({ok:true,data,revision:String(revision)});
  }
  if (pathname === '/api/upload-doc') {
    const parts=[]; for await (const part of req) parts.push(part);
    const body=Buffer.concat(parts).toString('utf8');
    const content=body.split('\r\n\r\n')[1].split('\r\n--')[0];
    const url='assets/docs/upload-'+(++uploadCount)+'.md'; uploads.set('/'+url, content);
    return json({ok:true,url,ext:'md',size:Buffer.byteLength(content),original:'material.md'});
  }
  if (uploads.has(pathname)) {res.setHeader('Content-Type',mime['.md']); return res.end(uploads.get(pathname));}
  if (pathname === '/assets/docs/math.md') return res.end(fs.readFileSync(path.join(root,'resources/assets/docs/477e841f37722e16.md')));
  if (pathname === '/assets/docs/mixed.md') return res.end(mixed);
  if (pathname === '/assets/docs/test.pdf') {res.setHeader('Content-Type','application/pdf'); return res.end(fs.readFileSync(path.join(out,'test.pdf')));}
  if (pathname === '/assets/docs/broken.pdf') return res.end('not a pdf');
  const file = path.resolve(root,'web','.'+pathname);
  if (!file.startsWith(path.join(root,'web')+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {res.statusCode=404; return res.end('missing');}
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  let content = fs.readFileSync(file);
  if (pathname.endsWith('/app.js')) content=Buffer.from(content.toString().replaceAll("'__SERVER_CONSOLE_TOKEN__'", "'test-only'"));
  res.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const insecure = process.env.READER_INSECURE === '1';
  const base='http://'+(insecure ? 'reader.test' : '127.0.0.1')+':'+server.address().port;
  const browser=await chromium.launch({channel: process.env.READER_BROWSER || 'msedge',headless:true,
    args: insecure ? ['--host-resolver-rules=MAP reader.test 127.0.0.1','--no-proxy-server'] : []});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:950}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.dismiss());
    await page.setContent('<html><body><h1>PDF reader verification</h1><p>Page one: selectable text</p><div style="break-before:page"><h1>Second page</h1><p>Page two: watermark survives navigation.</p></div></body></html>');
    await page.pdf({path:path.join(out,'test.pdf'),format:'A4'});
    await page.goto(base+'/library.html');
    await page.locator('.doc-card').first().waitFor();
    assert.match(await page.locator('.doc-card').first().getAttribute('href'),/^reader.html\?id=/);
    await page.goto(base+'/reader.html?id=math');
    await page.waitForFunction(()=>document.querySelector('#readerStatus').hidden);
    assert.ok(await page.locator('.katex').count()>50);
    assert.equal(await page.locator('.katex-error').count(),0);
    assert.equal(await page.locator('.reader-watermark').count(),1);
    await page.screenshot({path:path.join(out,'markdown-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'markdown-mobile.png')});
    await page.setViewportSize({width:1280,height:950});
    await page.goto(base+'/reader.html?id=mixed');
    await page.waitForFunction(()=>document.querySelector('#readerStatus').hidden);
    assert.equal(await page.locator('.katex-error').count(),0);
    assert.ok(await page.locator('.molecule svg :is(path,line,polygon)').count()>0,'SMILES structure was drawn');
    assert.match(await page.locator('pre code').innerText(),/print\("\$x\$"\)/);
    assert.equal(await page.locator('article script').count(),0);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
    assert.equal(await page.getByText('相对附件',{exact:true}).getAttribute('href'),base+'/assets/docs/other.pdf');
    await page.screenshot({path:path.join(out,'mixed.png')});
    await page.goto(base+'/reader.html?id=pdf');
    await page.waitForFunction(()=>document.querySelector('#readerStatus').hidden,{},{timeout:30000});
    assert.equal(await page.locator('#pdfPages').innerText(),'2');
    assert.match(await page.locator('.textLayer').innerText(),/Page one/);
    assert.equal(await page.locator('.reader-watermark').count(),1);
    await page.click('#pdfNext');
    await page.waitForFunction(()=>document.querySelector('#pdfPage').value==='2'&&document.querySelector('#readerStatus').hidden);
    assert.match(await page.locator('.textLayer').innerText(),/Page two/);
    await page.click('#pdfZoomIn');
    await page.waitForFunction(()=>document.querySelector('#pdfZoom').textContent==='125%'&&document.querySelector('#readerStatus').hidden);
    assert.equal(await page.locator('.reader-watermark').count(),1);
    await page.screenshot({path:path.join(out,'pdf-desktop.png')});
    await page.setViewportSize({width:390,height:844}); await page.click('#pdfFit');
    await page.waitForFunction(()=>document.querySelector('#pdfZoom').textContent==='适合宽度'&&document.querySelector('#readerStatus').hidden);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,'pdf-mobile.png')});
    await page.setViewportSize({width:1280,height:950});
    await page.goto(base+'/reader.html?id=does-not-exist');
    await page.getByText('这份资料不存在或已被移除，请返回资料库重新选择。').waitFor();
    await page.goto(base+'/reader.html?id=missing'); await page.getByText('资料加载失败（404），请稍后重试。').waitFor();
    await page.goto(base+'/reader.html?id=broken'); await page.getByText('暂时无法打开资料',{exact:true}).waitFor();
    await page.goto(base+'/console.html'); await page.fill('#codeInput','test-only'); await page.click('#codeBtn');
    await page.click('[data-tab="lib"]');
    await page.fill('#readerWatermarkText','测试水印 <tag>'); await page.click('#saveReaderWatermark');
    await page.getByText('已保存',{exact:true}).first().waitFor();
    await page.fill('#docName','新增 Markdown'); await page.fill('#markdownSource',mixed);
    await page.click('#previewMarkdown'); assert.equal(await page.locator('#markdownPreview .reader-watermark').count(),1);
    await page.click('#saveMarkdown'); await page.getByText('已保存到资料库',{exact:true}).waitFor();
    assert.equal(data.library.docs.length,6);
    const added=data.library.docs.find(doc=>doc.name==='新增 Markdown'); assert.ok(added?.url);
    await page.locator('[data-doc-markdown="'+added.id+'"]').click();
    await page.waitForFunction(()=>document.querySelector('#markdownState').textContent==='');
    await page.fill('#markdownSource','# 修订后\n\n正文 $x^2$');
    failSave=true; await page.click('#saveMarkdown'); await page.getByText('发布未成功，正文已保留，请重试保存。',{exact:true}).waitFor();
    assert.equal(await page.locator('#markdownSource').inputValue(),'# 修订后\n\n正文 $x^2$');
    await page.click('#saveMarkdown'); await page.getByText('已保存到资料库',{exact:true}).waitFor();
    assert.equal(data.library.docs.length,6,'retry/edit must not create duplicate entries');
    await page.locator('[data-doc-settings="'+added.id+'"]').click();
    await page.selectOption('#f_watermarkMode','off'); await page.click('#modalSave');
    await page.waitForFunction(()=>!document.querySelector('#modalMask').classList.contains('is-open'));
    await page.goto(base+'/reader.html?id='+added.id); await page.waitForFunction(()=>document.querySelector('#readerStatus').hidden);
    assert.equal(await page.locator('.reader-watermark').count(),0,'per-document watermark override');
    await page.goto(base+'/reader.html?id=math'); await page.waitForFunction(()=>document.querySelector('#readerStatus').hidden);
    assert.equal(await page.locator('.reader-watermark').count(),1,'global watermark is inherited by old documents');
    const bg=await page.locator('.reader-watermark').evaluate(el=>el.style.backgroundImage);
    assert.ok(decodeURIComponent(bg).includes('&lt;tag&gt;'),'watermark text must remain text');
    assert.deepEqual(errors,[]);
    console.log('PASS: math/chemistry/SMILES/code, XSS and relative links; desktop/mobile MD/PDF, pagination, zoom, text selection; admin preview/save/edit/retry and watermark overrides.');
    console.log('Screenshots: '+out);
  } finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
