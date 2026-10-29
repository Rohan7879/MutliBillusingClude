const assert = require('node:assert/strict');
const { MockFirestore } = require('../payment-tests/test/mock-firestore');
const Revision = require('../js/core/bill-revision');
const original = { 'Serial No': 'QW-2627-00001', Date: '17/10/2026', 'Final Total': 5000, amountPaid: 1255, workflowStatus: 'approved', locked: false };
(async () => {
  for (const failAt of ['get:1', 'get:2', 'set:1', 'update:1', 'commit']) {
    const db = new MockFirestore({ bills: { one: original } });
    const run = db.runTransaction.bind(db); db.runTransaction = fn => run(fn, { failAt });
    await assert.rejects(Revision.client(db, 'admin', () => 'STAMP').request('one', 'Correct mistaken date', original));
    assert.deepEqual(db.store, { bills: { one: original } });
  }
  const db = new MockFirestore({ bills: { one: original }, users: { admin: { role:'admin',status:'active' } } }), api = Revision.client(db, 'admin', () => 'STAMP');
  await assert.rejects(api.request('one', 'short', original));
  await assert.rejects(api.request('one', 'Correct mistaken date', { ...original, amountPaid: 0 }));
  const id = await api.request('one', 'Correct mistaken date', {id:'one', ...original});
  assert.equal(id, 'one_r1'); assert.deepEqual(db.store.billRevisions[id].snapshot, original);
  assert.equal(db.store.bills.one.amountPaid, 1255); assert.equal(db.store.bills.one.revisionPending, true);
  await assert.rejects(api.request('one', 'Duplicate correction request', db.store.bills.one));
  await assert.rejects(api.approve('one', original));
  const reviewed = { ...db.store.bills.one };
  await api.approve('one', reviewed);
  assert.equal(db.store.bills.one.workflowStatus, 'approved'); assert.equal(db.store.bills.one.revisionPending, false);
  assert.deepEqual(db.store.billRevisionApprovals[id].snapshot, reviewed);
  await api.request('one', 'Second reviewed correction', db.store.bills.one);
  assert.equal(db.store.bills.one.revisionNumber, 2);
  assert.equal(Object.keys(db.store.bills).length, 1);
  console.log('PASS revisions: snapshots, reasons, concurrency, approval, repeated revisions, one bill identity, atomic failure paths');
})().catch(e => { console.error(e); process.exitCode = 1; });
