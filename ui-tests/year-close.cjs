const assert = require('node:assert/strict');
const Y = require('../js/core/year-close');
const today = new Date(2026, 9, 27);
const data = { parties: [{ id:'p', name:'Farmer', type:'Farmer', opBal:100, opBalType:'Dr' }, {id:'b', name:'Broker',type:'Broker'}],
 bills:[{ id:'bill', Date:'31/03/2025', customerId:'p', 'Final Total':1000, workflowStatus:'approved', Broker:'Broker', BrokerCommission:50, amountPaid:100 }],
 payments:[{id:'pay',customerId:'p',paymentDate:'01/04/2025',cashAmount:100,totalCredit:100,appliedToBills:['bill']}],
 broker_payments:[{id:'payout',brokerName:'Broker',date:'01/04/2025',amount:20}] };
const p = Y.preview(data,'2025-2026',today);
assert.equal(p.canClose,true); assert.deepEqual(p.issues,[]);
assert.equal(p.parties[0].openingCents,110000); assert.equal(p.parties[0].closingCents,100000);
assert.equal(p.brokers[0].openingCents,5000); assert.equal(p.brokers[0].closingCents,3000);
assert.equal(Y.target('2025-2026','close',today),20260331);
assert.equal(Y.target('2025-2026','reopen',today),20250331);
assert.throws(() => Y.target('2026-2027','close',today));
assert.throws(() => Y.cutoff({closedThrough:20260401}));
for (const patch of [{workflowStatus:'draft'},{revisionPending:true},{Date:'31/02/2025'},{customerId:'missing'},{'Final Total':'oops'}]) {
 const changed = structuredClone(data); Object.assign(changed.bills[0],patch);
 assert.equal(Y.preview(changed,'2025-2026',today).canClose,false);
}
const unallocated = structuredClone(data); unallocated.payments[0].appliedToBills = [];
assert.equal(Y.preview(unallocated,'2025-2026',today).canClose,false);
console.log('PASS year preview: carry-forward, cents, broker balances, date boundaries, close/reopen cutoff, invalid/draft/revision/allocation blockers');
const FY = require('../js/core/financial-year');
const legacy = structuredClone(data); legacy.bills[0].brokerId = 'BROKER';
assert.equal(Y.preview(legacy,'2025-2026',today).brokers[0].openingCents,5000);
assert.deepEqual(Y.preview(legacy,'2025-2026',today).issues,[]);
legacy.parties.push({id:'duplicate',name:'Broker',type:'Broker'});
assert(Y.preview(legacy,'2025-2026',today).issues.some(issue=>issue.message.includes('broker party identity')));
assert.equal(FY.resolveBroker(data.parties,'unknown-id','Broker'),null);
assert.equal(FY.resolveBroker(data.parties,'b','Broker').id,'b');
assert.equal(Object.is(FY.partyOpeningCents({opBal:0,opBalType:'Cr'}),-0),false);
console.log('PASS legacy broker ID resolves only unique known name; ambiguous/unknown links stay blocked; no negative-zero opening');
