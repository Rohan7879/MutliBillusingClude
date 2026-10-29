const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const rows = {
  bills: [{ Broker: 'QA15 BROKER', BrokerCommission: 80 }, { Broker: 'QA15 BROKER', BrokerCommission: 60 }, { Broker: 'QA15 BROKER', BrokerCommission: 999, deleted: true }],
  broker_payments: [],
};
const ctx = { console, document: { addEventListener() {} }, db: { collection: key => ({ get: async () => ({ forEach: fn => rows[key].forEach(data => fn({ data: () => data })) }) }) } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/features/party-master.js'), 'utf8'), ctx);
(async () => {
  await ctx.fetchBillsSummary();
  assert.equal(vm.runInContext('brokerBalances["qa15 broker"]', ctx), 140);
  assert.equal(vm.runInContext('billsSummaryMap["qa15 broker"]', ctx), 2);
  rows.broker_payments.push({ brokerName: 'QA15 BROKER', amount: 50 }, { brokerName: 'QA15 BROKER', amount: 500, deleted: true });
  await ctx.fetchBillsSummary();
  assert.equal(vm.runInContext('brokerBalances["qa15 broker"]', ctx), 90);
  assert.equal(vm.runInContext('brokerBalancesLoaded', ctx), true);
  console.log('PASS broker balance: commission 140, payout 50, payable 90; archived entries excluded.');
})().catch(e => { console.error(e); process.exitCode = 1; });
