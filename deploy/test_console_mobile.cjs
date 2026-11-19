/* Run against services/upload/test_materials.py --serve, never a live site. */
const assert=require('node:assert/strict'),path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.PLAYWRIGHT_MODULE));}
(async()=>{
 const base=process.env.MATERIALS_QA_URL;if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(base||''))throw Error('Only isolated local fixture allowed');
 const browser=await chromium.launch({executablePath:process.env.MATERIALS_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const context=await browser.newContext({baseURL:new URL(base).origin,viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto('/console.html',{waitUntil:'networkidle'});await page.locator('#loginName').waitFor();
  if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:path.join(process.env.MATERIALS_QA_DIR,'login-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:path.join(process.env.MATERIALS_QA_DIR,'login-mobile.png'),fullPage:true});
  await page.locator('#loginName').fill('测试管理员');await page.locator('#loginStudentId').fill('TEST0001');await page.locator('#codeBtn').click();
  await page.locator('#consoleMobileNav').waitFor();
  assert.equal(await page.locator('#consoleMobileNav').evaluate(el=>getComputedStyle(el).position),'fixed');
  await page.locator('[data-mobile-group="workflow"]').click();await page.locator('#panel-materials').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile horizontal page overflow');
  await page.locator('[data-mobile-group="library"]').click();await page.locator('[data-mobile-tab="requirements"]').click();await page.locator('#panel-requirements').waitFor();
  await page.locator('[data-mobile-group="settings"]').click();await page.locator('[data-mobile-tab="members"]').click();await page.locator('#identityMembers tr').first().waitFor();
  assert.equal(await page.locator('#identityMembers td').first().evaluate(el=>getComputedStyle(el).display),'table-cell');
  if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:path.join(process.env.MATERIALS_QA_DIR,'console-mobile.png'),fullPage:true});
  const home=page.locator('.topnav').getByRole('link',{name:'返回主页',exact:true});await home.click();await page.waitForURL('**/index.html');
  assert((await (await page.request.get('/api/auth/session')).json()).user,'Home navigation incorrectly logged out');
  await page.goto('/console.html',{waitUntil:'networkidle'});await page.locator('#consoleMobileNav').waitFor();assert(!await page.locator('#gate').isVisible(),'Session not restored');
  const pdfPage=await context.newPage();await pdfPage.setContent('<h1>Preview verification</h1><p>Actual PDF text layer.</p><div style="break-before:page"><h1>Second page</h1></div>');const pdf=await pdfPage.pdf({format:'A4'});await pdfPage.close();
  let response=await page.request.post('/api/materials/resources',{multipart:{name:'PDF预览验收',description:'本地隔离数据',file:{name:'actual.pdf',mimeType:'application/pdf',buffer:pdf}}});assert(response.ok(),await response.text());
  const board=await (await page.request.get('/api/materials')).json();const resource=board.resources.find(r=>r.name==='PDF预览验收');assert(resource);
  await page.locator('[data-mobile-group="library"]').click();await page.locator('[data-mobile-tab="archives"]').click();await page.locator('#materialResources').getByText('PDF预览验收').waitFor();
  assert(await page.locator('#materialResources a[href*="materialFile="]').count(),'Private archive PDF preview entry missing');
  const reader=await context.newPage();await reader.goto('/reader.html?materialFile='+resource.file_id);await reader.locator('#pdfControls').waitFor();assert.equal(await reader.locator('#pdfPages').innerText(),'2');await reader.locator('#pdfNext').click();await reader.waitForFunction(()=>document.querySelector('#pdfPage').value==='2'&&document.querySelector('#readerStatus').hidden);
  if(process.env.MATERIALS_QA_DIR)await reader.screenshot({path:path.join(process.env.MATERIALS_QA_DIR,'private-pdf-mobile.png'),fullPage:true});await reader.close();
  response=await page.request.post('/api/upload-doc',{multipart:{file:{name:'public.pdf',mimeType:'application/pdf',buffer:pdf}}});const upload=await response.json();assert(response.ok(),JSON.stringify(upload));
  const before=await (await page.request.get('/api/data')).json();before.data.library.docs.push({id:'qa-public-pdf',name:'公开PDF预览验收',url:upload.url,ext:'pdf',grade:'大一',subject:'其他'});
  response=await page.request.post('/api/data',{data:before.data,headers:{'If-Match':before.revision}});assert(response.ok(),await response.text());
  const publicReader=await context.newPage();await publicReader.goto('/reader.html?id=qa-public-pdf');await publicReader.locator('#pdfControls').waitFor();assert.equal(await publicReader.locator('#pdfPages').innerText(),'2');await publicReader.close();
  await page.setViewportSize({width:1440,height:1000});
  assert(!await page.locator('#consoleMobileNav').isVisible(),'Mobile navigation leaked into desktop');
  await page.locator('#tabs [data-tab="materials"]').click();await page.locator('#panel-materials').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Desktop horizontal overflow');
  if(process.env.MATERIALS_QA_DIR)await page.screenshot({path:path.join(process.env.MATERIALS_QA_DIR,'console-desktop.png'),fullPage:true});
  await page.locator('.topnav').getByRole('button',{name:'退出登录',exact:true}).click();await page.locator('#loginName').waitFor();assert.equal((await (await page.request.get('/api/auth/session')).json()).user,null);
  const anonymous=await browser.newContext({baseURL:new URL(base).origin});assert.equal((await anonymous.request.get('/api/materials/file-info/'+resource.file_id)).status(),403);await anonymous.close();
  assert.deepEqual(errors,[]);console.log('PASS: login layouts, fixed grouped mobile navigation, session survives homepage/return, explicit logout, real public/private PDF render and page turn, unauthenticated preview rejected');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
