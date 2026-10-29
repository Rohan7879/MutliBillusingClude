const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/features/bill-form.js'), 'utf8');
const setup = source.slice(source.indexOf('async function setupAutocomplete()'), source.indexOf('function initializeIndexPage()'));
const elements = new Map();
function element() {
  return { value: '', style: {}, children: [], handlers: {}, classList: { add() {} },
    set innerHTML(value) { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.handlers[name] = callback; },
    dispatchEvent() {}, contains() { return false; } };
}
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const parties = [{ name: 'QA15 BROKER', type: ' broker ', defaultComm: 3 },
  { name: 'Removed', type: 'Broker', deleted: true }, { name: 'Farmer', type: 'Farmer' }];
const brokers = [{ name: 'qa15 broker' }, { name: "O'Brien <Broker>" },
  { name: 'TEST BROKER 01' }, { name: 'Archived', deleted: true }];
let selection;
const ctx = { console, Event: class {}, uniqueBrokers: [], uniqueCustomers: [],
  db: { collection: name => ({ get: async () => ({ docs: (name === 'parties' ? parties : brokers).map((p, i) => ({ id: String(i), data: () => p })) }) }) },
  document: { getElementById: get, querySelector: get, createElement: element, addEventListener() {} },
};
ctx.window = ctx;
ctx.applyBrokerDetails = (name, rate) => { selection = { name, rate }; };
vm.createContext(ctx);
vm.runInContext(setup, ctx);
(async () => {
  await ctx.setupAutocomplete();
  assert.equal(ctx.uniqueBrokers.length, 3, 'merge both sources, deduplicate and exclude deleted');
  const input = get('broker_name'), box = get('broker-suggestions');
  input.value = 'q'; input.handlers.input();
  assert.equal(box.style.display, 'block');
  assert.equal(box.children[0].children.length, 1);
  box.children[0].children[0].handlers.click();
  assert.deepEqual(selection, { name: 'QA15 BROKER', rate: 3 });
  input.value = 'test'; input.handlers.input();
  assert.equal(box.children[0].children[0].textContent, 'TEST BROKER 01');
  input.value = "O'"; input.handlers.input();
  assert.equal(box.children[0].children[0].textContent, "O'Brien <Broker>");
  box.children[0].children[0].handlers.click();
  assert.equal(selection.name, "O'Brien <Broker>");
  input.value = ''; input.handlers.focus();
  assert.equal(box.children[0].children.length, 3);
  input.handlers.keydown({ key: 'Escape' });
  assert.equal(box.style.display, 'none');
  input.value = 'not found'; input.handlers.input();
  assert.equal(box.children[0].children[0].textContent, 'No matching saved broker.');
  console.log('PASS broker sources, search, selection, commission, escaping, focus and empty state. No database writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
