const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../web/assets/app.js'), 'utf8');
async function check(admin) {
  let ready, interval, renders = 0, revision = 'first', lastRequest;
  const context = {
    console, URLSearchParams, location: {search: ''},
    document: {hidden: false, getElementById: id => admin && id === 'consoleApp' ? {} : null,
      addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready = fn; }},
    setInterval: fn => { interval = fn; },
    fetch: async (url, opt) => { lastRequest = opt; return {ok: true, json: async () => ({ok: true, data: {}, revision})}; },
    renderCount: () => renders++
  };
  vm.createContext(context);
  vm.runInContext(source + '\nrenderPublicContent = renderCount; initAnnouncementFilters = () => {}; globalThis.store = Store;', context);
  await ready();
  assert.equal(renders, 1);
  assert.equal(context.store._revision, 'first');
  if (admin) assert.equal(interval, undefined, 'Never refresh an editor draft');
  else {
    revision = 'second'; await interval(); assert.equal(renders, 2);
    await interval(); assert.equal(renders, 2, 'No rerender without a content change');
    context.document.hidden = true; revision = 'third'; await interval(); assert.equal(renders, 2);
  }
  await context.store.save({});
  assert.equal(lastRequest.headers['If-Match'], admin ? 'first' : 'second');
}
(async () => { await check(false); await check(true); console.log('PASS: live refresh, hidden-page behavior, editor draft preservation and save revision'); })().catch(e => { console.error(e); process.exit(1); });
