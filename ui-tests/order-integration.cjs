"use strict";
// Actual app sync/import entry points, synthetic in-memory records only.
// A mock checks transaction read/write ordering; it is not a Firestore emulator.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

function fixture(initial = {}) {
  const state = { data: structuredClone(initial), writes: [], transactions: 0, queries: 0, beforeTransaction: null, fail: false };
  let nextId = 0;
  const snapshot = (collection, id) => ({ id, exists: !!state.data[collection]?.[id], data: () => structuredClone(state.data[collection]?.[id]) });
  const ref = (collection, id) => ({ collection, id, get: async () => snapshot(collection, id) });
  const query = (collection, filters = []) => ({
    doc: id => ref(collection, id || "auto-" + ++nextId),
    where: (key, operator, value) => query(collection, [...filters, [key, operator, value]]),
    orderBy: () => query(collection, filters),
    get: async () => {
      state.queries++;
      const docs = Object.entries(state.data[collection] || {}).filter(([, item]) => filters.every(([key, operator, value]) => {
        if (operator === "==") return item[key] === value;
        if (operator === "in") return value.includes(item[key]);
        if (operator === "array-contains") return item[key]?.includes(value);
        throw new Error("Unsupported mock query " + operator);
      })).map(([id]) => snapshot(collection, id));
      return { docs, empty: !docs.length, forEach: fn => docs.forEach(fn) };
    },
  });
  state.db = { collection: name => query(name), runTransaction: async fn => {
    state.transactions++;
    if (state.beforeTransaction) await state.beforeTransaction(state);
    const writes = [];
    const result = await fn({
      get: async r => { if (writes.length) throw new Error("Read after write"); return snapshot(r.collection, r.id); },
      update: (r, data) => writes.push(["update", r, structuredClone(data)]),
      set: (r, data) => writes.push(["set", r, structuredClone(data)]),
      delete: r => writes.push(["delete", r]),
    });
    if (state.fail) throw Object.assign(new Error("Fixture permission denied"), { code: "permission-denied" });
    for (const [op, r, data] of writes) {
      const collection = state.data[r.collection] ||= {};
      if (op === "delete") delete collection[r.id];
      else collection[r.id] = op === "set" ? data : { ...collection[r.id], ...data };
      state.writes.push({ collection: r.collection, id: r.id, fields: data });
    }
    return result;
  } };
  return state;
}
function runtime(store) {
  const context = vm.createContext({ console, db: store.db, document: { addEventListener() {} } });
  context.window = context;
  vm.runInContext(read("js/core/order-sync.js"), context);
  vm.runInContext(read("js/features/order-integration.js"), context);
  const ledger = read("js/features/ledger.js");
  vm.runInContext(ledger.slice(ledger.indexOf("async function recalculateAndUpdateOrderPaymentStatus(")), context);
  return context;
}
async function run({ plan, calculatedBills }) {
  let checks = 0;
  const check = (name, actual, expected) => { assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, name); checks++; console.log("PASS", name); };
  const rejects = async (name, fn, pattern) => { await assert.rejects(fn, pattern); checks++; console.log("PASS", name); };
  const embedded = JSON.parse(read("tools/backup/entry-guide.html").match(/<script id="entry-plan" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  check("HTML guide and JSON plan stay identical", embedded, plan);
  check("Three orders have explicit checkpoints", plan.orderChecks.length, 3);
  for (const target of plan.orderChecks) {
    const i = plan.bills.findIndex(b => b.ref === target.billRef), b = plan.bills[i];
    const bill = { ...calculatedBills[i], "Serial No": b.ref, LinkedOrderId: "o1", LinkedSupplierIdx: 0,
      OrderSupplierLinks: b.vakals.map((_, supplierIdx) => ({ supplierIdx, vakalIndex: supplierIdx + 1 })), amountPaid: 0 };
    const order = { status: "Pending", paymentStatus: "Unpaid", linkedBillNos: [b.ref],
      suppliers: b.vakals.map(v => ({ unit: "Bag", quantity: v.bags, delivered: 0, variety: v.variety })) };
    const store = fixture({ orders: { o1: order }, bills: { b1: bill } }), app = runtime(store);
    await app.updateOrderDeliveredQty(bill);
    const result = store.data.orders.o1;
    check(b.ref + " actual bags, not kg / 20", result.suppliers.map(s => s.delivered), target.delivered);
    check(b.ref + " remaining", result.suppliers.map(s => Math.max(0, s.quantity - s.delivered)), target.remaining);
    check(b.ref + " delivery independent of unpaid status", [result.status, result.paymentStatus], [target.deliveryStatus, target.paymentBefore]);
    await app.updateOrderDeliveredQty(bill);
    check(b.ref + " repeated sync does not double count", store.data.orders.o1.suppliers.map(s => s.delivered), target.delivered);
    store.data.bills.b1.amountPaid = b.expected.credit;
    await app.recalculateAndUpdateOrderPaymentStatus("o1");
    check(b.ref + " payment after cash + deduction", [store.data.orders.o1.status, store.data.orders.o1.paymentStatus, b.expected.final - store.data.bills.b1.amountPaid],
      [target.deliveryStatus, target.paymentAfter, target.dueAfter]);
    check(b.ref + " accountant sync touches payment fields only", Object.keys(store.writes.at(-1).fields).sort(), ["paymentStatus", "updatedAt"]);
  }
  const makeBill = (id, bags, kg, amount = 5000) => ({ "Serial No": id, "Bill Type": "Bag", LinkedOrderId: "o1", LinkedSupplierIdx: 0,
    "Vakal 1 Katta": bags, "Vakal 1 Kilo": kg, "Net Weight": kg, "Final Total": amount, amountPaid: 0,
    OrderSupplierLinks: [{ supplierIdx: 0, vakalIndex: 1 }] });
  const fresh = () => fixture({ orders: { o1: { status: "Pending", suppliers: [{ unit: "Bag", quantity: 10 }], linkedBillNos: ["x1"] } }, bills: { x1: makeBill("x1", 4, 200) } });
  const store = fresh(), app = runtime(store), split = plan.splitOrderCheck;
  await app.updateOrderDeliveredQty(store.data.bills.x1);
  check("Split truck 1: 4 delivered / 6 remaining / Partial", [store.data.orders.o1.suppliers[0].delivered, store.data.orders.o1.status], [split.trucks[0].delivered, split.trucks[0].deliveryStatus]);
  store.data.bills.x1.amountPaid = split.trucks[0].initialCash;
  await app.recalculateAndUpdateOrderPaymentStatus("o1");
  check("First partial cash payment", store.data.orders.o1.paymentStatus, "Partial");
  store.data.bills.x2 = makeBill("x2", 6, 300, 7500); store.data.orders.o1.linkedBillNos.push("x2");
  await app.updateOrderDeliveredQty(store.data.bills.x2);
  check("Split truck 2: completed delivery but partial payment", [store.data.orders.o1.suppliers[0].delivered, store.data.orders.o1.status, store.data.orders.o1.paymentStatus], [10, "Completed", "Partial"]);
  store.data.bills.x1.amountPaid = 5000; store.data.bills.x2.amountPaid = 7500;
  await app.recalculateAndUpdateOrderPaymentStatus("o1");
  check("Two truck payments settle the whole order", store.data.orders.o1.paymentStatus, "Paid");
  store.data.bills.x2.amountPaid = 0;
  await app.recalculateAndUpdateOrderPaymentStatus("o1");
  check("Payment reversal recalculates to Partial", store.data.orders.o1.paymentStatus, "Partial");
  store.data.bills.x2["Vakal 1 Katta"] = 2; store.data.bills.x2["Vakal 1 Kilo"] = 100;
  await app.updateOrderDeliveredQty(store.data.bills.x2);
  check("Bill edit reduces completed delivery back to Partial", [store.data.orders.o1.suppliers[0].delivered, store.data.orders.o1.status], [6, "Partial"]);
  store.data.bills.x2.deleted = true;
  await app.updateOrderDeliveredQty(store.data.bills.x2);
  check("Archived bill excluded from delivery and payment totals", [store.data.orders.o1.suppliers[0].delivered, store.data.orders.o1.paymentStatus], [4, "Paid"]);
  check("Archived bill is removed from active order badge links", store.data.orders.o1.linkedBillNos, ["x1"]);
  store.data.bills.x1.deleted = true;
  await app.updateOrderDeliveredQty(store.data.bills.x1);
  check("All archived resets automatic order summaries", [store.data.orders.o1.suppliers[0].delivered, store.data.orders.o1.status, store.data.orders.o1.paymentStatus], [0, "Pending", "Unpaid"]);
  check("All archived removes active order badge links", store.data.orders.o1.linkedBillNos, []);
  store.data.bills.x1.deleted = false;
  await app.updateOrderDeliveredQty(store.data.bills.x1, true);
  await app.updateOrderDeliveredQty(store.data.bills.x1);
  check("Explicit manual close survives later recalculation", [store.data.orders.o1.status, store.data.orders.o1.deliveryClosedManually], ["Completed", true]);
  store.data.orders.o1.status = "Cancelled";
  await app.updateOrderDeliveredQty(store.data.bills.x1);
  check("Sync never reopens cancelled order", store.data.orders.o1.status, "Cancelled");
  for (const [unit, expected] of [["Man", 10], ["Khadi", .5], ["Quintal", 2]]) {
    const unitStore = fresh(); unitStore.data.orders.o1.suppliers[0].unit = unit;
    await runtime(unitStore).updateOrderDeliveredQty(unitStore.data.bills.x1);
    check(unit + " uses its own kg divisor", unitStore.data.orders.o1.suppliers[0].delivered, expected);
  }
  const legacy = fresh(); legacy.data.orders.o1.linkedBillNo = "x1"; legacy.data.orders.o1.linkedBillNos = [];
  delete legacy.data.bills.x1.OrderSupplierLinks;
  await runtime(legacy).updateOrderDeliveredQty(legacy.data.bills.x1);
  check("Legacy scalar link and supplier index keep actual bags", legacy.data.orders.o1.suppliers[0].delivered, 4);
  const race = fresh();
  race.beforeTransaction = state => { state.beforeTransaction = null; state.data.bills.x2 = makeBill("x2", 6, 300); state.data.orders.o1.linkedBillNos.push("x2"); };
  await runtime(race).updateOrderDeliveredQty(race.data.bills.x1);
  check("Concurrent link rediscovered without losing either bill", [race.transactions, race.data.orders.o1.linkedBillNos, race.data.orders.o1.suppliers[0].delivered], [2, ["x1", "x2"], 10]);
  const changed = fresh(); changed.beforeTransaction = state => { state.beforeTransaction = null; state.data.bills.x1["Vakal 1 Katta"] = 3; state.data.bills.x1.amountPaid = 5000; };
  await runtime(changed).updateOrderDeliveredQty(changed.data.bills.x1);
  check("Fresh transaction reads catch bill/payment change after query", [changed.data.orders.o1.suppliers[0].delivered, changed.data.orders.o1.paymentStatus], [3, "Paid"]);
  const cases = [
    ["Missing linked bill", s => s.data.orders.o1.linkedBillNos.push("missing"), /could not be read/],
    ["Foreign order bill", s => s.data.bills.x1.LinkedOrderId = "another-order", /different order/],
    ["Duplicate serial", s => s.data.bills.x2 = { ...s.data.bills.x1 }, /duplicate bill number/],
    ["Invalid Vakal mapping", s => s.data.bills.x1.OrderSupplierLinks[0].vakalIndex = 6, /Vakal/],
    ["Duplicate Vakal mapping", s => s.data.bills.x1.OrderSupplierLinks.push({ supplierIdx: 0, vakalIndex: 1 }), /Vakal/],
    ["Missing legacy supplier index", s => { delete s.data.bills.x1.OrderSupplierLinks; s.data.bills.x1.LinkedSupplierIdx = ""; }, /mapping/],
    ["Unknown order unit", s => s.data.orders.o1.suppliers[0].unit = "Unknown", /unsupported/],
    ["Loose bill against Bag order", s => s.data.bills.x1["Bill Type"] = "Loose", /actual bag counts/],
    ["Permission error", s => s.fail = true, /permission denied/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const failed = fresh(); mutate(failed); const before = structuredClone(failed.data.orders);
    // Call the shared sync using the intended order ID. The foreign-link case
    // deliberately changes the bill's own ID and must not accidentally test a
    // missing target order instead.
    await rejects(name + " reaches caller", () => runtime(failed).MandiOrderSync.sync("o1", { delivery: true }), pattern);
    check(name + " cannot write partial summary", failed.data.orders, before);
  }
  const paymentFailure = fresh(); paymentFailure.fail = true;
  await rejects("Payment sync failure is not swallowed", () => runtime(paymentFailure).recalculateAndUpdateOrderPaymentStatus("o1"), /permission denied/);
  const empty = fresh(); delete empty.data.orders.o1;
  await rejects("Missing order is visible failure", () => runtime(empty).updateOrderDeliveredQty(empty.data.bills.x1), /no longer exists/);
  const retry = fresh(); retry.beforeTransaction = s => s.data.orders.o1.linkedBillNos.push("new-" + s.transactions);
  await rejects("Concurrent-link retries are bounded", () => runtime(retry).updateOrderDeliveredQty(retry.data.bills.x1), /links changed/);
  check("Retry bound", retry.transactions, 3);
  console.log(`PASS ${checks} order integration checks; no Firebase SDK, network or real records.`);
}
module.exports = { run, fixture };
if (require.main === module) run(require("../tools/backup/check-entry-plan.cjs")).catch(error => { console.error(error); process.exitCode = 1; });
