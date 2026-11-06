const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const context={document:{addEventListener(){}},esc:s=>String(s??''),setTimeout(){}};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/assets/console.js'),'utf8')+`
DATA={activities:[{id:'test',title:'课堂',date:'2026-11-06',tags:[]}]};
buildModal=o=>{globalThis.modal=o};editActivity('test');`,context);
const form=context.modal.fields.find(f=>f.key==='signupFields');
assert.equal(form.value.split('\n').length,3,'Default fields must be separate editable lines');
assert(context.modal.fields.some(f=>f.key==='signupEnabled'));
const app={document:{addEventListener(){}},URLSearchParams};vm.createContext(app);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/assets/app.js'),'utf8'),app);
vm.runInContext(`globalThis.pdf=renderPromotionalMedia('assets/posters/test.pdf',true);globalThis.doc=renderPromotionalMedia('assets/posters/test.docx',false);globalThis.bad=renderPromotionalMedia('javascript:alert(1)',true);`,app);
assert(app.pdf.includes('<iframe'));assert(app.doc.includes('宣传文档'));assert.equal(app.bad,'');
console.log('PASS: editable multiline registration fields, PDF/document presentation and URL filtering');
