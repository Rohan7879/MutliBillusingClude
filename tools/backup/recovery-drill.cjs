#!/usr/bin/env node
'use strict';

// Real Firestore emulator integration test with synthetic data ONLY. Starts and
// stops its own isolated process; never reads .firebaserc or live credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const engine = require('../../js/core/backup-engine.js');
const recovery = require('./emulator-recovery.cjs');

// Snapshot scenarios, not UI-created transactions. Three unpaid, three partial,
// four paid; decimals, deductions and two installments on the last bill.
const BILL_CASES = [
  { total: 1000, cash: 0, deduction: 0 },
  { total: 2000, cash: 500, deduction: 0 },
  { total: 1500, cash: 1500, deduction: 0 },
  { total: 2500, cash: 0, deduction: 0 },
  { total: 4000, cash: 1200, deduction: 100 },
  { total: 3000, cash: 2950, deduction: 50 },
  { total: 1250.75, cash: 250.25, deduction: 0 },
  { total: 875.50, cash: 875.50, deduction: 0 },
  { total: 3200, cash: 0, deduction: 0 },
  { total: 10000, cash: 9990, deduction: 10, installments: 2 }
];
const checks = [];
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function ready(host, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Emulator exited: ${child.exitCode}`);
    try { await fetch(`http://${host}/`, { signal: AbortSignal.timeout(500), redirect: 'error' }); return; }
    catch { await delay(250); }
  }
  throw new Error('Local emulator did not start within 30 seconds.');
}
async function installRules(host, projectId, rules) {
  recovery.assertLocalTarget(host, projectId);
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
    signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  if (!response.ok) throw new Error(`Local rules setup failed: ${response.status} ${await response.text()}`);
}

function fixtures(db, sdk) {
  const data = Object.fromEntries(engine.COLLECTIONS.map(name => [name, []]));
  const add = (name, id, value) => data[name].push({ id, data: value });
  const stamp = new sdk.Timestamp(1792000000, 123456000);
  for (const [index, scenario] of BILL_CASES.entries()) {
    const n = index + 1;
    const { total, cash, deduction, installments = 1 } = scenario;
    const paid = cash + deduction, due = Math.round((total - paid) * 100) / 100;
    const paymentStatus = paid === 0 ? 'Unpaid' : due === 0 ? 'Paid' : 'Partial';
    add('parties', `party-${n}`, { name: `TEST ONLY • ખેડૂત ${n}`, currentBalance: due, openingBalance: 0, createdAt: stamp });
    add('orders', `order-${n}`, { customerId: `party-${n}`, status: 'billed', billId: `bill-${n}`, paymentStatus, createdAt: stamp });
    add('bills', `bill-${n}`, { 'Bill No': `DRILL-${String(n).padStart(4, '0')}`, 'Final Total': total, customerId: `party-${n}`, orderId: `order-${n}`,
      amountPaid: paid, amountDue: due, paymentStatus, workflowStatus: 'approved', deleted: false, brokerId: 'broker-1',
      brokerCommission: n * 10, items: [{ productId: 'grain', weight: 1, rate: total }], createdAt: stamp });
    if (paid > 0) for (let installment = 1; installment <= installments; installment++) {
      add('payments', `payment-${n}-${installment}`, { customerId: `party-${n}`, cashAmount: cash / installments, deductionAmount: deduction / installments,
        deductionReason: deduction ? 'Synthetic agreed deduction' : '', totalCredit: paid / installments, appliedToBills: [`bill-${n}`], createdAt: stamp });
    }
    add('auditLogs', `audit-${n}`, { action: 'bill.created', entityId: `bill-${n}`, actor: { uid: 'admin', role: 'admin' }, createdAt: stamp });
  }
  add('bills', 'archived', { 'Bill No': 'DRILL-ARCHIVED', 'Final Total': 250, amountPaid: 0, amountDue: 250, customerId: 'party-1', deleted: true, deletedAt: stamp });
  add('bills', 'legacy-no-date', { 'Final Total': 0, amountPaid: 0, amountDue: 0, customerId: 'party-1' });
  add('brokers', 'broker-1', { name: 'TEST ONLY Broker', commissionRate: 1 });
  add('brokers', 'broker-2', { name: 'TEST ONLY No activity' });
  add('broker_payments', 'payout-1', { brokerId: 'broker-1', amount: 20, createdAt: stamp });
  add('broker_payments', 'payout-2', { brokerId: 'broker-1', amount: 10, createdAt: stamp });
  add('products', 'grain', { name: 'TEST ઘઉં', enabled: true });
  add('products', 'empty-product', {});
  add('varieties', 'grain-standard', { productId: 'grain', name: 'Standard' });
  add('customers', 'legacy-customer', { name: 'Legacy fixture' });
  add('counters', 'bill-serial', { value: BILL_CASES.length + 2, prefix: 'DRILL' });
  for (const [id, role, status] of [['admin','admin','active'], ['viewer','viewer','active'], ['pending','viewer','pending'], ['suspended','accountant','suspended']]) {
    add('users', id, { email: `${id}@example.invalid`, displayName: `TEST ONLY ${id}`, role, status, emailVerified: true });
  }
  add('mobileDirectory', '910000000000', { uid: 'admin' });
  add('sharedBills', 'expired-share', { billId: 'bill-1', expiresAt: sdk.Timestamp.fromMillis(0), revoked: true });
  add('settings', 'core', { kasar: 0.003, bagWeight: 0.6, utrai: 7 });
  add('settings', 'billWorkflow', { printPolicy: 'approved_only' });
  add('settings', 'type-fixture', {
    stamp, point: new sdk.GeoPoint(23.0225, 72.5714), reference: db.doc('parties/party-1'),
    bytes: sdk.Blob.fromUint8Array(new Uint8Array([0, 255, 1, 128])), nan: NaN, infinity: Infinity, negativeInfinity: -Infinity, negativeZero: -0,
    text: 'ગુજરાતી / हिन्दी / 🌾\n"quoted"', nested: [null, true, { type: 'timestamp', seconds: 'ordinary user field' }], empty: {},
    'dot.field': 'not a field path', emptyArray: []
  });
  return data;
}

function financialSnapshot(backup) {
  const rows = name => backup.data[name].map(row => ({ id: row.id, ...engine.decode(row.data) }));
  const bills = rows('bills').filter(row => row.deleted !== true);
  const payments = rows('payments');
  const cents = value => Math.round(Number(value) * 100);
  const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field] || 0), 0);
  for (let n = 1; n <= BILL_CASES.length; n++) {
    const bill = bills.find(row => row.id === `bill-${n}`);
    const party = rows('parties').find(row => row.id === bill.customerId);
    const order = rows('orders').find(row => row.id === bill.orderId);
    const credits = payments.filter(row => row.appliedToBills.includes(bill.id));
    assert.equal(sum(credits, 'totalCredit'), cents(bill.amountPaid));
    assert.equal(cents(bill['Final Total']) - cents(bill.amountPaid), cents(bill.amountDue));
    assert.equal(cents(party.currentBalance), cents(bill.amountDue));
    assert.equal(order.billId, bill.id);
    assert.equal(order.customerId, bill.customerId);
    assert.equal(order.paymentStatus, bill.paymentStatus);
    const expectedStatus = cents(bill.amountPaid) === 0 ? 'Unpaid' : cents(bill.amountDue) === 0 ? 'Paid' : 'Partial';
    assert.equal(bill.paymentStatus, expectedStatus);
  }
  return {
    billTotal: sum(bills, 'Final Total'), cash: sum(payments, 'cashAmount'), deductions: sum(payments, 'deductionAmount'),
    credited: sum(payments, 'totalCredit'), due: sum(bills, 'amountDue'), partyBalance: sum(rows('parties'), 'currentBalance'),
    brokerCommission: sum(bills, 'brokerCommission'), brokerPaid: sum(rows('broker_payments'), 'amount')
  };
}

async function resign(backup) {
  for (const name of backup.collections) backup.manifest[name] = { documents: backup.data[name].length, sha256: await engine.hash(engine.canonical(backup.data[name])) };
  const { integrity, ...payload } = backup;
  backup.integrity = { algorithm: 'SHA-256', payloadHash: await engine.hash(engine.canonical(payload)) };
  return backup;
}

async function main() {
  // All three paths must be explicitly provided; no auto-download, global SDK,
  // default Firebase project or production endpoint can be selected here.
  const { MANDIBOOK_TEST_NODE_MODULES: modules, MANDIBOOK_TEST_JAVA: java, MANDIBOOK_TEST_FIRESTORE_JAR: jar } = process.env;
  if (![modules, java, jar].every(value => value && path.isAbsolute(value))) {
    throw new Error('Set absolute MANDIBOOK_TEST_NODE_MODULES, MANDIBOOK_TEST_JAVA and MANDIBOOK_TEST_FIRESTORE_JAR paths. See tools/backup/README.md.');
  }
  await Promise.all([fs.access(java), fs.access(jar)]);
  const firebase = require(require.resolve('firebase/compat/app', { paths: [path.dirname(modules)] }));
  require(require.resolve('firebase/compat/firestore', { paths: [path.dirname(modules)] }));
  const sdk = firebase.firestore;
  const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  const sourceId = `demo-mb-drill-${runId}-src`, targetId = `demo-mb-drill-${runId}-dst`;
  const host = `127.0.0.1:${await freePort()}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'mandibook-recovery-drill-'));
  const rules = await fs.readFile(path.join(__dirname, '../../config/firestore.rules'), 'utf8');
  const rulesHash = await engine.hash(rules);
  const javaLog = await fs.open(path.join(output, 'emulator.log'), 'wx', 0o600);
  // single_project_mode is a presence flag in this emulator version; do not
  // pass the string "false" (which enables it and produces spurious warnings).
  const child = spawn(java, ['-Xmx512m', '-Djava.net.preferIPv4Stack=true', '-jar', jar, '--host', '127.0.0.1', '--port', host.split(':')[1], '--project_id', sourceId], {
    cwd: output, stdio: ['ignore', javaLog.fd, javaLog.fd]
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const interrupted = () => { child.kill('SIGKILL'); process.exit(130); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const dbs = [];
  const connect = (project, token) => { const db = recovery.connect(firebase, host, project, token); dbs.push(db); return db; };
  // Hard deadline ensures an offline SDK retry never leaves this drill hanging.
  const watchdog = setTimeout(() => { console.error('FAIL Recovery drill timed out; no success report created.'); child.kill('SIGKILL'); process.exit(1); }, 180000);
  console.log(`Synthetic-only recovery drill. Output: ${output}`);
  try {
    await ready(host, child);
    if (spawnError) throw spawnError;
    const source = connect(sourceId), target = connect(targetId);
    await installRules(host, sourceId, rules);
    await installRules(host, targetId, rules);

    await check('Live project and non-loopback targets rejected before connecting', () => {
      for (const address of ['firestore.googleapis.com:443', 'localhost:8080', '127.0.0.1:65536', 'http://127.0.0.1:8080', '127.0.0.1.evil:8080']) assert.throws(() => recovery.assertLocalTarget(address, sourceId));
      assert.throws(() => recovery.assertLocalTarget(host, 'ganesh-agri-new'));
      assert.throws(() => recovery.assertLocalTarget(host, 'demo-another-project'));
    });
    const fixture = fixtures(source, sdk);
    const batch = source.batch();
    Object.entries(fixture).forEach(([name, rows]) => rows.forEach(row => batch.set(source.doc(`${name}/${row.id}`), row.data)));
    await batch.commit();
    const backup = await recovery.capture(source, sdk);
    await check('All 15 collections captured from real emulator with pagination and two passes', () => {
      assert.equal(backup.collections.length, 15);
      assert.equal(backup.totalDocuments, Object.values(fixture).flat().length);
      assert(backup.readUsage.documentReads >= backup.totalDocuments * 2);
      assert.deepEqual(engine.reviewRecords(backup), []);
    });

    const password = crypto.randomUUID(); // Synthetic temporary password, never printed or retained.
    const filename = path.join(output, 'synthetic-encrypted-backup.json');
    await fs.writeFile(filename, JSON.stringify(await engine.encrypt(JSON.stringify(backup), password)), { flag: 'wx', mode: 0o600 });
    const diskEnvelope = JSON.parse(await fs.readFile(filename, 'utf8'));
    const readBack = JSON.parse(await engine.decrypt(diskEnvelope, password));
    await check('Encrypted backup is actually saved, reopened, decrypted and verified', async () => {
      assert.equal((await engine.verify(readBack, sourceId)).projectMatches, true);
      assert.equal(readBack.integrity.payloadHash, backup.integrity.payloadHash);
    });
    await check('Wrong password and damaged ciphertext are rejected', async () => {
      await assert.rejects(() => engine.decrypt(diskEnvelope, 'wrong-password-at-least-12'), /Incorrect password/);
      const damaged = { ...diskEnvelope, ciphertext: (diskEnvelope.ciphertext[0] === 'A' ? 'B' : 'A') + diskEnvelope.ciphertext.slice(1) };
      await assert.rejects(() => engine.decrypt(damaged, password), /damaged/);
    });
    await check('Checksum corruption, missing collection and unknown reference block restore', async () => {
      const corrupt = structuredClone(readBack); corrupt.data.bills.pop();
      await assert.rejects(() => recovery.restore(corrupt, target, sdk), /checksum/);
      const missing = structuredClone(readBack);
      missing.collections = missing.collections.filter(name => name !== 'payments');
      missing.totalDocuments -= missing.data.payments.length;
      delete missing.data.payments; delete missing.manifest.payments;
      await resign(missing); // Even an internally consistent but incomplete file fails.
      await assert.rejects(() => recovery.restore(missing, target, sdk), /missing required/);
      const foreign = structuredClone(readBack);
      foreign.data.settings.find(row => row.id === 'type-fixture').data.entries.find(([key]) => key === 'reference')[1].projectId = 'foreign-project';
      await resign(foreign);
      await assert.rejects(() => recovery.restore(foreign, target, sdk), /reference project/);
      assert.equal((await recovery.capture(target, sdk)).totalDocuments, 0);
    });

    await check('Read allowance and concurrent source changes cannot produce a successful copy', async () => {
      await assert.rejects(() => recovery.capture(source, sdk, { readLimit: 30 }), /allowance reached/);
      let changed = false;
      // The engine calls guard synchronously. Schedule a server change before
      // the second pass query, and await it in the query wrapper below.
      const observedDB = {
        waitForPendingWrites: () => source.waitForPendingWrites(),
        collection(name) {
          const query = source.collection(name);
          if (!changed && name === 'bills' && observedDB.firstPassFinished) {
            changed = true;
            observedDB.pending = source.doc('bills/bill-1').update({ testChanged: true });
          }
          const wrap = q => ({ orderBy: (...args) => wrap(q.orderBy(...args)), limit: size => wrap(q.limit(size)), startAfter: doc => wrap(q.startAfter(doc)),
            async get(options) { await observedDB.pending; return q.get(options); } });
          return wrap(query);
        }
      };
      await assert.rejects(() => engine.capture({ db: observedDB, sdk, projectId: sourceId, exportedBy: 'synthetic-recovery-drill',
        onProgress: progress => { if (progress.pass === 2) observedDB.firstPassFinished = true; } }), /changed during backup/);
      assert.equal(changed, true);
      await source.doc('bills/bill-1').update({ testChanged: sdk.FieldValue.delete() });
      recovery.compareContents(readBack, await recovery.capture(source, sdk));
    });

    const restored = await recovery.restore(readBack, target, sdk, { batchSize: 7 });
    const targetBackup = await recovery.capture(target, sdk);
    await check('Multi-batch restore preserves every original ID and typed field', () => {
      assert.equal(restored.written, backup.totalDocuments);
      recovery.compareContents(readBack, targetBackup);
    });
    await check('Ten linked scenarios preserve payments, deductions, dues and broker totals', () => {
      const expected = { billTotal: 2932625, cash: 1726575, deductions: 16000, credited: 1742575, due: 1190050, partyBalance: 1190050, brokerCommission: 55000, brokerPaid: 3000 };
      assert.deepEqual(financialSnapshot(readBack), expected);
      assert.deepEqual(financialSnapshot(targetBackup), expected);
    });
    await check('Unpaid/partial/paid states, decimal balances and installment links survive', () => {
      const bills = targetBackup.data.bills.filter(row => /^bill-\d+$/.test(row.id)).map(row => engine.decode(row.data));
      assert.equal(bills.length, 10);
      assert.deepEqual(bills.reduce((counts, bill) => { counts[bill.paymentStatus]++; return counts; }, { Unpaid: 0, Partial: 0, Paid: 0 }), { Unpaid: 3, Partial: 3, Paid: 4 });
      const payments = targetBackup.data.payments.map(row => engine.decode(row.data));
      assert.equal(payments.length, 8);
      assert.equal(payments.filter(row => row.appliedToBills.includes('bill-10')).length, 2);
      assert.equal(engine.decode(targetBackup.data.bills.find(row => row.id === 'bill-7').data).amountDue, 1000.50);
    });
    await check('Archived/missing-date bills, staff roles and serial counter survive', () => {
      assert.equal(engine.decode(targetBackup.data.bills.find(row => row.id === 'archived').data).deleted, true);
      assert(targetBackup.data.bills.some(row => row.id === 'legacy-no-date'));
      assert.equal(engine.decode(targetBackup.data.counters[0].data).value, 12);
      assert.equal(targetBackup.data.users.length, 4);
    });
    await check('SDK Timestamp, GeoPoint, bytes, text and rebound reference survive', () => {
      const data = engine.decode(targetBackup.data.settings.find(row => row.id === 'type-fixture').data, sdk, target);
      assert.equal(data.stamp.nanoseconds, 123456000);
      assert.equal(data.point.latitude, 23.0225);
      assert.deepEqual([...data.bytes.toUint8Array()], [0, 255, 1, 128]);
      assert.equal(data.reference.path, 'parties/party-1');
      assert.equal(data.reference.firestore.app.options.projectId, targetId);
      assert(Number.isNaN(data.nan)); assert.equal(data.infinity, Infinity); assert.equal(data.negativeInfinity, -Infinity);
      assert.equal(data.nested[2].seconds, 'ordinary user field');
    });
    await check('Duplicate restore refuses populated target without changing its contents', async () => {
      await assert.rejects(() => recovery.restore(readBack, target, sdk), /not empty/);
      recovery.compareContents(readBack, await recovery.capture(target, sdk));
    });
    await check('Mid-restore interruption reports partial data and blocks blind retry', async () => {
      const partial = connect(`demo-mb-drill-${runId}-part`);
      await assert.rejects(() => recovery.restore(readBack, partial, sdk, { batchSize: 7, beforeBatch: index => { if (index === 1) throw new Error('Injected connection interruption'); } }), error => error.committedDocuments === 7 && /incomplete/.test(error.message));
      assert.equal((await recovery.capture(partial, sdk)).totalDocuments, 7);
      await assert.rejects(() => recovery.restore(readBack, partial, sdk), /not empty/);
    });
    await check('Concurrent ID conflict is never overwritten', async () => {
      const conflict = connect(`demo-mb-drill-${runId}-race`);
      const id = readBack.data.bills[0].id;
      await assert.rejects(() => recovery.restore(readBack, conflict, sdk, { beforeBatch: async index => { if (index === 0) await conflict.doc(`bills/${id}`).set({ sentinel: 'keep me' }); } }), error => error.committedDocuments === 0 && /conflict/.test(error.cause.message));
      assert.deepEqual((await conflict.doc(`bills/${id}`).get()).data(), { sentinel: 'keep me' });
      assert.equal((await recovery.capture(conflict, sdk)).totalDocuments, 1);
    });

    await check('Restored profiles enforce basic read roles under actual project rules', async () => {
      const roleClient = uid => connect(targetId, { sub: uid, email: `${uid}@example.invalid`, email_verified: true });
      const admin = roleClient('admin'), viewer = roleClient('viewer');
      assert.equal((await admin.collection('auditLogs').get({ source: 'server' })).size, 10);
      assert.equal((await viewer.collection('bills').get({ source: 'server' })).size, 12);
      for (const db of [roleClient('pending'), roleClient('suspended'), connect(targetId, null)]) {
        await assert.rejects(() => db.collection('bills').get({ source: 'server' }), error => error.code === 'permission-denied');
      }
      await assert.rejects(() => viewer.collection('auditLogs').get({ source: 'server' }), error => error.code === 'permission-denied');
      await assert.rejects(() => viewer.doc('settings/core').set({ overwrite: true }), error => error.code === 'permission-denied');
      recovery.compareContents(readBack, await recovery.capture(target, sdk));
    });
    const report = {
      status: 'passed', scope: 'synthetic-only real Firestore emulator recovery drill', completedAt: new Date().toISOString(),
      sdkVersion: firebase.SDK_VERSION, rulesSha256: rulesHash, sourceProject: sourceId, targetProject: targetId,
      collections: backup.collections.length, documents: backup.totalDocuments, financialAmountsInPaise: financialSnapshot(targetBackup), checks,
      limitations: ['No live customer backup or production restore tested', 'No Firebase Authentication accounts or Cloud Storage files restored', 'No real phone download tested', 'Read-role smoke checks are not a complete security audit', 'Multi-batch restore is not atomic; partial targets must remain isolated']
    };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`\nPASS ${checks.length} checks; ${backup.totalDocuments} documents / ${backup.collections.length} collections. Report: ${path.join(output, 'result.json')}`);
    console.log('No live data, credentials, billing settings or cloud resources used.');
  } finally {
    await Promise.allSettled(dbs.map(db => recovery.close(db)));
    const ended = once(child, 'exit').catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([ended, delay(4000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([ended, delay(1000)]); }
    }
    clearTimeout(watchdog);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await javaLog.close();
  }
}

main().catch(error => { console.error('FAIL', error.message, error.cause?.message || ''); process.exitCode = 1; });
