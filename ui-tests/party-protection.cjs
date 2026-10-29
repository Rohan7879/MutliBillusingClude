const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const party = read('js/features/party-master.js');
const broker = read('js/features/broker.js');
const rules = read('config/firestore.rules');
let notice;
const context = { window: { location: {} }, Swal: { fire: (...args) => { notice = args; } },
  db: { collection() { throw Error('Protection must not write or query records'); } } };
vm.createContext(context);
vm.runInContext(party.slice(party.indexOf('window.deleteParty ='), party.indexOf('// 🌟 1. Party Row')), context);
vm.runInContext(broker.slice(broker.indexOf('window.openAddBrokerModal ='), broker.indexOf('window.openBrokerPaymentModal')), context);
vm.runInContext(broker.slice(broker.indexOf('async function updateBrokerCommission('), broker.indexOf('\nwindow.loadBrokerLedger')), context);
(async () => {
  await context.window.deleteParty('linked-party');
  assert.equal(notice[0], 'Party protected');
  await context.handleDeleteParty('linked-party');
  context.window.openAddBrokerModal();
  assert.equal(context.window.location.href, 'party-master.html?type=Broker#partyForm');
  await context.updateBrokerCommission({ Broker: 'NEW', BrokerCommission: 100 });
  assert.doesNotMatch(party, /onclick="deleteParty/);
  // Static guardrails supplement, not replace, deployed rules compilation.
  const partyRules = rules.slice(rules.indexOf('match /parties/'), rules.indexOf('match /brokers/'));
  assert.match(partyRules, /allow delete: if false/);
  assert.equal((partyRules.match(/get\('deleted', false\) == false/g) || []).length, 2);
  const legacyRules = rules.slice(rules.indexOf('match /brokers/'), rules.indexOf('match /payments/'));
  assert.match(legacyRules, /allow create, delete: if false/);
  const wildcard = rules.slice(rules.indexOf('match /{collection}'));
  assert.doesNotMatch(wildcard, /'brokers'|'parties'/);
  console.log('PASS party deletion entry points blocked, broker creation redirected, commission avoids duplicate master writes, rule guardrails present.');
})().catch(error => { console.error(error); process.exitCode = 1; });
