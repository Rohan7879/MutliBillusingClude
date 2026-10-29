const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fy = require('../js/core/financial-year.js');

for (const value of ['31/02/2024', '29/02/2023', '2024-04-31', '2024-13-01', '1/04/2024', '2024-4-01', '2024-04-01T00:00:00Z', ' 2024-04-01', '0000-01-01', '', null]) {
  assert.equal(fy.parseDate(value), null, String(value));
}
assert.equal(fy.dateKey('29/02/2024'), '2024-02-29');
assert.equal(fy.dateKey('2024-04-01'), '2024-04-01');
assert.equal(fy.financialYearId('31/03/2024'), '2023-2024');
assert.equal(fy.financialYearId('01/04/2024'), '2024-2025');
assert.deepEqual(fy.boundaries('2024-2025'), { start: '2024-04-01', end: '2025-03-31' });
for (const id of ['2024-2026', '2024-25', 'FY 2024-2025', '0000-0001']) assert.throws(() => fy.boundaries(id));
assert.equal(fy.toCents(1.005), 101);
assert.equal(fy.toCents(-1.005), -101);
assert.equal(fy.toCents(10.075), 1008);
assert.throws(() => fy.toCents(Infinity));
assert.equal(fy.partyOpeningCents({ opBal: '150.25', opBalType: 'Dr' }), 15025);
assert.equal(fy.partyOpeningCents({ opBal: '150.25', opBalType: 'Cr' }), -15025);
assert.equal(fy.partyOpeningCents({ opBal: 10 }), -1000);
assert.equal(fy.partyOpeningCents({ opBal: -10, opBalType: 'Cr' }), 1000);
assert.throws(() => fy.partyOpeningCents({ opBal: 1, opBalType: 'other' }));

const transactions = [
  { date: '2022-06-01', debit: 50, credit: 0 },
  { date: '31/03/2024', debit: 100.10, credit: 0 },
  { date: '2024-04-01', debit: 0.10, credit: 0, type: 'bill', id: 'a', amountDue: .10 },
  { date: '2024-04-02', debit: 0.20, credit: 0, type: 'bill', id: 'b', amountDue: .20 },
  { date: '2024-05-01', debit: 0, credit: 40, type: 'payment', reversed: true },
  { date: '2024-05-02', debit: 0, credit: -40, type: 'reversal' },
  { date: '2025-03-31', debit: 0, credit: 20 },
  { date: '2025-04-01', debit: 99, credit: 0 },
];
const original = JSON.stringify(transactions);
const report = fy.summarize(transactions, { fyId: '2024-2025', initialOpeningCents: -1000 });
assert.equal(report.openingCents, 14010);
assert.equal(report.debitCents, 30);
assert.equal(report.creditCents, 2000);
assert.equal(report.closingCents, 12040);
assert.equal(report.rows.length, 5);
assert.equal(JSON.stringify(transactions), original, 'does not mutate transactions or create carry-forward entries');
assert.deepEqual(fy.availableYears(transactions, '2026-10-24'), ['2026-2027', '2025-2026', '2024-2025', '2023-2024', '2022-2023']);
const narrowed = fy.summarize(transactions, { fyId: '2024-2025', start: '2024-04-02', end: '2024-04-02', initialOpeningCents: -1000 });
assert.equal(narrowed.openingCents, 14020);
assert.equal(narrowed.closingCents, 14040);
assert.equal(narrowed.rows.length, 1);
assert.throws(() => fy.summarize(transactions, { fyId: '2024-2025', start: '2025-04-01' }));
assert.throws(() => fy.summarize(transactions, { start: '31/02/2024' }));
const all = fy.summarize(transactions, { initialOpeningCents: -1000 });
assert.equal(all.openingCents, -1000);
assert.equal(all.rows.length, transactions.length);
assert.equal(fy.summarize([], { fyId: '2024-2025', initialOpeningCents: 123 }).closingCents, 123);
assert.equal(fy.summarize([{ date: '2024-02-31', debit: 999 }]).invalidDateCount, 1);
assert.equal(fy.summarize(transactions, { end: '2024-03-31' }).closingCents, 15010);
assert.equal(fy.summarize(transactions, { start: '2025-04-01' }).openingCents, 13040);

// Exercise the real ledger rendering and print adapter with an offline DOM.
const elements = new Map();
function element() {
  return { value: '', textContent: '', style: {}, children: [], checked: false,
    appendChild(child) { this.children.push(child); }, addEventListener() {},
    classList: { toggle() {} },
    set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html || ''; },
  };
}
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
let printHtml = '', writes = 0;
const document = {
  addEventListener() {}, getElementById: get, querySelector: get, querySelectorAll: () => [],
  body: { appendChild() {}, removeChild() {} },
  createElement(tag) {
    const node = element();
    if (tag === 'iframe') node.contentWindow = { document: { open() {}, write(html) { printHtml = html; }, close() {} } };
    return node;
  },
};
const context = {
  document, console, Date, URLSearchParams, setTimeout() {},
  db: { collection() { return { add() { writes++; }, doc() { writes++; } }; } },
  MandiFinancialYear: fy, formatNumber: n => String(n), escapeHtml: s => String(s).replaceAll('<', '&lt;'),
  hasRole: () => false, alert(message) { context.lastAlert = message; }, globalSettings: {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/features/ledger.js'), 'utf8'), context);
assert.equal(vm.runInContext('selectedFinancialYear', context), fy.financialYearId(new Date()));
context.fixtures = transactions.map(tx => ({ ...tx, date: fy.parseDate(tx.date), particulars: '<test>' }));
vm.runInContext(`currentCustomer = { name: 'Test', opBal: 10, opBalType: 'Cr' };
  allTransactions = fixtures; selectedFinancialYear = '2024-2025';
  populateFinancialYears(); renderLedgerTable(allTransactions);`, context);
assert.equal(get('financial-year-select').value, '2024-2025');
assert.equal(get('kpi-balance-due').textContent, '₹120.40 — Payable by customer');
assert.equal(get('ledger-table-body').children.length, 6, 'one derived opening row, five movements');
assert.equal(vm.runInContext('displayedTransactions.length', context), 5);
assert.match(get('ledger-period-label').textContent, /FY 2024-2025 · 2024-04-01 to 2025-03-31/);
get('start_date').value = '2030-01-01'; // Unapplied input must not alter printed period.
context.printLedger();
assert.match(printHtml, /FY 2024-2025 · 2024-04-01 to 2025-03-31/);
assert.match(printHtml, /Customer advance|Payable by customer/);
assert.match(printHtml, /&lt;test>/);
assert.equal((printHtml.match(/&lt;test>/g) || []).length, 5, 'print includes hidden reversed entries');
vm.runInContext(`renderLedgerTable(allTransactions, '2024-04-02', '2024-04-02')`, context);
assert.equal(get('kpi-balance-due').textContent, '₹140.40 — Payable by customer');
vm.runInContext(`renderLedgerTable(allTransactions, '2025-04-01')`, context);
assert.match(context.lastAlert, /outside/);
assert.equal(get('kpi-balance-due').textContent, '₹140.40 — Payable by customer', 'invalid filter preserves prior statement');
vm.runInContext(`selectedFinancialYear = 'all'; renderLedgerTable(allTransactions)`, context);
assert.equal(get('ledger-table-body').children.length, transactions.length + 1);
assert.match(get('ledger-table-body').children[0].innerHTML, /₹10.00 — Customer advance/);
vm.runInContext(`renderLedgerTable(allTransactions)`, context);
assert.equal(get('ledger-table-body').children.length, transactions.length + 1, 'repeat render never duplicates opening');
assert.equal(writes, 0);
assert.throws(() => context.assertLedgerBillPayable({ revisionPending: true, workflow: 'draft' }), /Revision awaiting approval/);
assert.doesNotThrow(() => context.assertLedgerBillPayable({ revisionPending: false }));
context.fixtures[2].revisionPending = true;
context.fixtures[2].particulars = 'Bill No: A — Revision awaiting approval (working amount, not final)';
vm.runInContext(`selectedFinancialYear = '2024-2025'; renderLedgerTable(allTransactions)`, context);
assert.match(get('ledger-table-body').children[1].innerHTML, /disabled/);
assert.match(get('ledger-table-body').children[1].innerHTML, /Revision awaiting approval/);
assert.equal(get('kpi-balance-due').textContent, '₹120.40 — Payable by customer', 'pending revision working amount remains in ledger');
context.printLedger();
assert.match(printHtml, /Revision awaiting approval \(working amount, not final\)/);
const html = fs.readFileSync(path.join(__dirname, '../ledger.html'), 'utf8');
assert.ok(html.indexOf('js/core/financial-year.js') < html.indexOf('js/features/ledger.js'));
console.log('PASS financial-year: strict dates, FY boundaries/options, cents, Dr/Cr opening, prior history, filters, reversal history, ledger/print, no writes.');
