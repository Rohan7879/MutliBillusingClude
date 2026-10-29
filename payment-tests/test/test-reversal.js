// Tests the production correction function with buffered transaction failures.
const assert = require("node:assert/strict");
const { MockFirestore } = require("./mock-firestore");
const { reverse } = require("../../js/core/payment-reversal");
const seed = () => ({
  users: { owner: { role: "admin", status: "active", email: "test@example.test", displayName: "Test" } },
  parties: { farmer: { currentBalance: 4000 } },
  bills: { bill: { "Final Total": 5255, amountPaid: 1255, amountDue: 4000, paymentStatus: "Partial",
    workflowStatus: "approved", customerId: "farmer", "Serial No": "QM-2627-00001", LinkedOrderId: "order" } },
  payments: { payment: { customerName: "QA15 FARMER D", customerVillage: "QA15 VILLAGE D", customerId: "farmer",
    cashAmount: 1255, deductionAmount: 0, totalCredit: 1255, appliedToBills: ["bill"], paymentMethod: "Cash" } },
});
const run = db => reverse({ db, paymentId: "payment", reason: "Entered by mistake", uid: "owner", timestamp: () => 123 });
let passed = 0;
async function test(name, action) { await action(); passed++; console.log("PASS", name); }
(async () => {
  await test("1255 reversal restores 5255 due and retains original evidence", async () => {
    const db = new MockFirestore(seed()), original = structuredClone(db.store.payments.payment);
    const result = await run(db);
    assert.equal(result.amountDue, 5255);
    assert.equal(result.orderId, "order");
    assert.equal(db.store.bills.bill.amountPaid, 0);
    assert.equal(db.store.bills.bill.paymentStatus, "Unpaid");
    assert.equal(db.store.parties.farmer.currentBalance, 5255);
    assert.deepEqual(db.store.payments.payment, original);
    assert.equal(db.store.payments.reversal_payment.totalCredit, -1255);
    assert.equal(db.store.auditLogs.reversal_payment.action, "payment.reversed");
    assert.equal(Object.values(db.store.payments).reduce((s, p) => s + p.totalCredit, 0), 0);
    const once = structuredClone(db.store);
    assert.equal((await run(db)).alreadyReversed, true);
    assert.deepEqual(db.store, once);
  });
  for (const failure of ["get:1", "get:5", "set:1", "set:2", "update:1", "update:2", "commit"]) {
    await test(`Failure at ${failure} leaves all records unchanged`, async () => {
      const db = new MockFirestore(seed()), before = structuredClone(db.store);
      const transaction = db.runTransaction.bind(db);
      db.runTransaction = fn => transaction(fn, { failAt: failure });
      await assert.rejects(run(db));
      assert.deepEqual(db.store, before);
    });
  }
  for (const [name, mutate] of [
    ["viewer cannot reverse", s => { s.users.owner.role = "viewer"; }],
    ["inactive user cannot reverse", s => { s.users.owner.status = "pending"; }],
    ["paid amount mismatch blocks correction", s => { s.bills.bill.amountPaid = 100; }],
    ["foreign party blocks correction", s => { s.bills.bill.customerId = "other"; }],
    ["archived bill blocks correction", s => { s.bills.bill.deleted = true; }],
    ["locked bill blocks correction", s => { s.bills.bill.locked = true; }],
    ["missing party blocks correction", s => { delete s.parties.farmer; }],
    ["missing bill blocks correction", s => { delete s.bills.bill; }],
    ["unknown legacy allocations are never guessed", s => { s.payments.payment.appliedToBills.push("another"); }],
    ["counter-entry cannot be reversed again", s => { s.payments.payment.reversalOf = "original"; }],
    ["invalid payment totals are rejected", s => { s.payments.payment.cashAmount = 4000; }],
  ]) {
    await test(name, async () => {
      const data = seed(); mutate(data);
      const db = new MockFirestore(data), before = structuredClone(db.store);
      await assert.rejects(run(db));
      assert.deepEqual(db.store, before);
    });
  }
  await test("decimal payment and deduction reverse together; later payments retained", async () => {
    const s = seed();
    Object.assign(s.payments.payment, { cashAmount: 1200.25, deductionAmount: 55.25, totalCredit: 1255.5 });
    Object.assign(s.bills.bill, { amountPaid: 1500.5, amountDue: 3754.5 });
    s.parties.farmer.currentBalance = 3754.5;
    const db = new MockFirestore(s);
    await run(db);
    assert.equal(db.store.bills.bill.amountPaid, 245);
    assert.equal(db.store.bills.bill.amountDue, 5010);
    assert.equal(db.store.bills.bill.paymentStatus, "Partial");
    assert.equal(db.store.payments.reversal_payment.deductionAmount, -55.25);
  });
  await test("general payment reversal adjusts only party and history", async () => {
    const s = seed(); s.payments.payment.appliedToBills = [];
    const db = new MockFirestore(s), before = structuredClone(db.store.bills);
    await run(db);
    assert.deepEqual(db.store.bills, before);
    assert.equal(db.store.parties.farmer.currentBalance, 5255);
  });
  await test("ledger and exported rows show correction and net credit correctly", async () => {
    const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
    const elements = new Map();
    const element = () => ({ style: {}, children: [], appendChild(child) { this.children.push(child); } });
    const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const ctx = { Date, db: { collection: () => ({}) }, console, hasRole: () => true,
      escapeHtml: value => String(value), formatNumber: value => Number(value).toLocaleString("en-IN"),
      document: { addEventListener() {}, getElementById: get, createElement: element, querySelector: get, querySelectorAll: () => [] } };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/core/financial-year.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/features/ledger.js"), "utf8"), ctx);
    ctx.renderLedgerTable([
      { id: "bill", type: "bill", date: new Date(), particulars: "Bill", debit: 5255, credit: 0, amountDue: 5255 },
      { id: "payment", type: "payment", reversed: true, date: new Date(), particulars: "Original | Reversed", debit: 0, credit: 1255 },
      { id: "reversal_payment", type: "reversal", date: new Date(), particulars: "Payment reversed", debit: 0, credit: -1255 },
    ]);
    assert.equal(get("kpi-total-credit").textContent, "₹0");
    assert.equal(get("kpi-balance-due").textContent, "₹5,255.00 — Payable by customer");
    const html = get("ledger-table-body").children.map(row => row.innerHTML).join("");
    assert.match(html, /-1,255/);
    assert.doesNotMatch(html, /onclick=/);
    assert.equal(vm.runInContext("ledgerAsTableData[3].Credit", ctx), "-1,255");
    assert.equal(get("ledger-table-body").className, "hide-reversed");
    assert.equal(get("ledger-table-body").children[1].className, undefined);
    assert.equal(get("ledger-table-body").children[2].className, "reversed-entry");
    assert.equal(get("ledger-table-body").children[3].className, "reversed-entry");
    assert.match(get("reversal-visibility-note").textContent, /2 reversed entries hidden/);
    get("hide-reversed-payments").checked = false;
    ctx.updateReversalVisibility();
    assert.equal(get("ledger-table-body").className, "");
    assert.match(get("reversal-visibility-note").textContent, /2 reversed entries shown/);
    assert.equal(get("kpi-balance-due").textContent, "₹5,255.00 — Payable by customer");
    assert.equal(vm.runInContext("ledgerAsTableData.length", ctx), 4);
    get("hide-reversed-payments").checked = true;
    ctx.updateReversalVisibility();
    assert.equal(get("ledger-table-body").className, "hide-reversed");
    // A date filter containing only the reversal must still count its negative credit.
    ctx.renderLedgerTable([
      { type: "payment", reversed: true, date: new Date(2026, 9, 17), particulars: "Original", debit: 0, credit: 1255 },
      { type: "reversal", date: new Date(2026, 9, 21), particulars: "Correction", debit: 0, credit: -1255 },
    ], "2026-10-21", "2026-10-21");
    assert.equal(get("kpi-total-credit").textContent, "₹-1,255");
    assert.equal(get("kpi-balance-due").textContent, "₹0.00 — Settled");
    assert.match(get("reversal-visibility-note").textContent, /1 reversed entries hidden/);
    assert.equal(vm.runInContext("ledgerAsTableData.length", ctx), 2);
  });
  console.log(`${passed} reversal checks passed. No Firebase connection or real records.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
