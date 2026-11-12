/* Start services/upload/test_materials.py --serve first. Local test data only. */
const assert = require('node:assert/strict');
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=require(process.env.PLAYWRIGHT_MODULE)); }

(async()=>{
  const url=process.env.MATERIALS_QA_URL;
  if(!/^http:\/\/127\.0\.0\.1:[0-9]+\//.test(url||''))throw new Error('Only the isolated loopback fixture is permitted');
  const browser=await chromium.launch({executablePath:process.env.MATERIALS_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1050}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'networkidle'});
    await page.locator('#codeInput').fill('local-test-only');await page.locator('#codeBtn').click();
    await page.locator('[data-tab="materials"]').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Desktop page overflows horizontally');
    await page.locator('#materialActor').fill('本地验收操作人');
    await page.locator('#materialCreate').click();
    await page.locator('#mw-title').fill('迎新手册制作验收');
    await page.locator('#mw-description').fill('完成编写与美工排版，必须两次提交审核。');
    await page.locator('#mw-deadline').fill('2026-11-25');
    await page.locator('#mw-material').fill('材料同学');await page.locator('#mw-design').check();
    await page.locator('#mw-designer').fill('美工同学');await page.locator('#mw-create').click();
    await page.locator('#materialDialog').waitFor({state:'hidden'});
    const task=()=>page.locator('#materialTasks').getByText('迎新手册制作验收');
    await task().click();await page.locator('#mw-submit').click();
    await page.locator('#mw-file').setInputFiles({name:'初稿.md',mimeType:'text/markdown',buffer:Buffer.from('# 实际初稿\n内容')});
    await page.locator('#mw-note').fill('完成初稿');await page.locator('#mw-send').click();
    await page.locator('#materialDialog').waitFor({state:'hidden'});
    await task().click();await page.locator('#mw-return').click();await page.locator('#mw-comment').fill('请补充数据');await page.locator('#mw-review').click();
    await page.locator('#materialDialog').waitFor({state:'hidden'});
    await task().click();await page.locator('#mw-submit').click();
    await page.locator('#mw-file').setInputFiles({name:'修改稿.md',mimeType:'text/markdown',buffer:Buffer.from('# 修改稿\n已补充数据')});
    await page.locator('#mw-note').fill('按意见补充');await page.locator('#mw-send').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await task().click();await page.locator('#mw-approve').click();await page.locator('#mw-review').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await page.locator('#materialTasks').getByText('美工处理中').waitFor();
    await task().click();await page.locator('#mw-submit').click();
    await page.locator('#mw-file').setInputFiles({name:'终稿.md',mimeType:'text/markdown',buffer:Buffer.from('# 正式终稿\n已完成排版')});
    await page.locator('#mw-note').fill('完成排版');await page.locator('#mw-send').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await task().click();await page.locator('#mw-approve').click();await page.locator('#mw-review').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await page.locator('[data-tab="archives"]').click();
    await page.locator('#materialResources [data-publish]').click();await page.locator('#mw-publish').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await page.locator('#materialResources').getByText('已发布过 · 可更新公开版').waitFor();
    const response=await page.request.get(new URL('/api/data',url).href);const data=await response.json();assert(data.data.library.docs.some(d=>d.name==='迎新手册制作验收'));
    await page.locator('[data-tab="requirements"]').click();await page.locator('#materialEditRequirements').click();await page.locator('#mw-content').fill('格式要求\n标题居中，正文统一字号。\n\n提交要求\n必须上传真实文件。');await page.locator('#mw-requirements').click();await page.locator('#materialDialog').waitFor({state:'hidden'});
    await page.locator('#materialTemplateUpload').click();await page.locator('#mw-name').fill('写作模板');await page.locator('#mw-file').setInputFiles({name:'模板.md',mimeType:'text/markdown',buffer:Buffer.from('# 模板')});await page.locator('#mw-upload').click();await page.locator('#materialDialog').waitFor({state:'hidden'});await page.locator('#materialTemplates').getByText('写作模板').waitFor();
    await page.locator('[data-tab="materials"]').click();
    if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:process.env.MATERIALS_QA_DIR+'/materials-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-tab="materials"]').click();
    await page.waitForTimeout(250);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflows horizontally');
    if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:process.env.MATERIALS_QA_DIR+'/materials-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: console login, task creation, upload, return/resubmit, two reviews, archive, explicit publication, requirements, templates, desktop/mobile');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
