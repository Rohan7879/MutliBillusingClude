'use strict';
// Offline-only: exercise the real bill calculator using the manual-entry plan.
// Expected totals in the JSON are independent acceptance targets, not calculated
// from production data. No Firebase connection, UI save or import is performed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const plan = require('./ten-bill-entry-plan.json');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/features/bill-form.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'js/core/core-engine.js'), 'utf8');
function section(text, start, end) {
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Calculator source boundary not found: ${start}`);
  return text.slice(from, to);
}
const code = section(core, 'function customRound(', '\n/**') + '\n' +
  section(source, 'function nonNegativeNumber(', 'async function collectData(');
const cents = value => Math.round(value * 100);
let final = 0, cash = 0, deductions = 0, due = 0, netKg = 0, grossKg = 0, paymentRecords = 0, commission = 0;
const states = { Unpaid: 0, Partial: 0, Paid: 0 };
for (const bill of plan.bills) {
  const fields = new Map(Object.entries({ supply_type: bill.supplyType, weighbridge_weight: bill.weighbridgeKg,
    loose_price: bill.looseRatePer20kg, bharela_600: bill.kantanFilled, khali_600: 0, bharela_200: bill.plasticFilled, khali_200: 0,
    truck_freight: bill.freight, customer_name: bill.party, village: bill.village, vehicle_no: bill.vehicle, bill_date: bill.date,
    bill_remarks: bill.ref, broker_name: bill.broker, broker_commission_per_bag: bill.brokerRatePer100kg }));
  if (bill.mode === 'Loose') fields.set('is_loose_supply', 'on');
  if (bill.brokerRatePer100kg) fields.set('apply_broker_commission', 'on');
  if (bill.weighbridgeMoisturePct) { fields.set('deduct_weighbridge_moisture', 'on'); fields.set('weighbridge_moisture_pct', bill.weighbridgeMoisturePct); }
  bill.vakals.forEach((row, i) => { fields.set(`vakal_${i+1}_katta`, row.bags); fields.set(`vakal_${i+1}_bhav`, row.ratePer20kg); fields.set(`vakal_${i+1}_variety`, row.variety); });
  const expenses = bill.expense ? [{ querySelector: selector => ({ value: selector.includes('expense_name') ? bill.expenseName : String(bill.expense) }) }] : [];
  const context = { console, document: { querySelectorAll: selector => { assert.equal(selector, '.expense-row'); return expenses; } },
    window: { activeTemplate: { name: bill.product, id: bill.product, seriesPrefix: bill.product.endsWith('WHEAT') ? 'QW' : 'QM' } },
    // All setting-dependent deductions must be OFF for this reproducible plan.
    globalSettings: { kasarPercentage: .003, kantanWeight: .6, plasticWeight: .2, utraiPercentage: 7 },
    getActiveTemplateDeductionValues: () => [], formData: { get: key => fields.has(key) ? fields.get(key) : null } };
  vm.createContext(context); vm.runInContext(code, context);
  const calculated = vm.runInContext('calculateBillData(formData)', context);
  assert.equal(calculated['Final Total'], bill.expected.final, `${bill.ref} final`);
  assert.equal(calculated['Net Weight'], bill.expected.netKg, `${bill.ref} net kg`);
  assert.equal(calculated.BrokerCommission, bill.expected.brokerCommission, `${bill.ref} commission`);
  assert.equal(calculated.Remarks, bill.ref);
  assert.equal(calculated.ProductTemplate, bill.product);
  let credited = 0;
  for (const step of bill.paymentSteps) {
    assert.equal(cents(step.cash) + cents(step.deduction), cents(step.credit));
    credited += cents(step.credit);
    assert.equal(cents(bill.expected.final) - credited, cents(step.expectedDue), `${bill.ref} installment ${step.step}`);
    assert(step.expectedDue >= 0); cash += cents(step.cash); deductions += cents(step.deduction); paymentRecords++;
  }
  assert.equal(credited, cents(bill.expected.credit));
  assert.equal(cents(bill.expected.final) - credited, cents(bill.expected.due));
  const status = credited === 0 ? 'Unpaid' : bill.expected.due === 0 ? 'Paid' : 'Partial';
  assert.equal(status, bill.expected.status); states[status]++;
  final += cents(calculated['Final Total']); due += cents(bill.expected.due); netKg += calculated['Net Weight']; grossKg += calculated['Weighbridge Weight']; commission += calculated.BrokerCommission;
  console.log(`PASS ${bill.ref}: final ${calculated['Final Total']}, credit ${bill.expected.credit}, due ${bill.expected.due}, ${status}`);
}
const totals = plan.expectedTotals;
assert.equal(plan.bills.length, totals.bills);
assert.equal(plan.bills.filter(b => b.order).length, totals.orders);
assert.equal(plan.parties.length, totals.parties);
for (const party of plan.parties) {
  const rows = plan.bills.filter(b => b.party === party.name);
  assert.deepEqual(rows.map(b => b.ref), party.bills);
  assert.equal(rows.reduce((sum,b) => sum + cents(b.expected.final), 0), cents(party.expectedFinal));
  assert.equal(rows.reduce((sum,b) => sum + cents(b.expected.credit), 0), cents(party.expectedCredit));
  assert.equal(rows.reduce((sum,b) => sum + cents(b.expected.due), 0), cents(party.expectedDue));
}
assert.equal(final, cents(totals.billFinal)); assert.equal(cash, cents(totals.cash)); assert.equal(deductions, cents(totals.deductions));
assert.equal(cash + deductions, cents(totals.credit)); assert.equal(due, cents(totals.due)); assert.equal(final - cash - deductions, due);
assert.equal(netKg, totals.netKg); assert.equal(grossKg, totals.grossKg); assert.equal(paymentRecords, totals.paymentRecords);
assert.deepEqual(states, { Unpaid: totals.unpaid, Partial: totals.partial, Paid: totals.paid });
assert.equal(commission, plan.broker.expectedCommission); assert.equal(commission - plan.broker.payout, plan.broker.expectedBalance);
console.log('PASS all 10 calculator cases, installments, party balances, statuses and aggregate targets. No database writes.');
