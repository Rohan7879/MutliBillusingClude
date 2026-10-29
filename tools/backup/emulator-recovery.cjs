'use strict';

// Test-only recovery helpers. Never imported by the app and deliberately cannot
// connect to a real project. There is no user-file-to-production restore CLI.
const engine = require('../../js/core/backup-engine.js');
const clients = new WeakMap();

function assertLocalTarget(host, projectId) {
  if (!/^127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(host || '') || Number(host.split(':')[1]) > 65535) {
    throw new Error('Recovery tests require an explicit 127.0.0.1 emulator port. No cloud fallback.');
  }
  if (!/^demo-mb-drill-[a-z0-9-]{1,16}$/.test(projectId || '')) {
    throw new Error('Recovery tests require a disposable demo-mb-drill- project.');
  }
}

function connect(firebase, host, projectId, token = 'owner') {
  assertLocalTarget(host, projectId);
  const app = firebase.initializeApp({ projectId }, `drill-${projectId}-${crypto.randomUUID()}`);
  const db = app.firestore();
  // "owner" is an emulator-only test credential, not a Firebase user/secret.
  // This tool does not load auth, service accounts or application credentials.
  db.useEmulator('127.0.0.1', Number(host.split(':')[1]), token === null ? {} : { mockUserToken: token });
  clients.set(db, { host, projectId, app });
  return db;
}

function assertClient(db) {
  const client = clients.get(db);
  if (!client) throw new Error('Use only a guarded emulator client.');
  assertLocalTarget(client.host, client.projectId);
  return client;
}

async function close(db) {
  const { app } = assertClient(db);
  await db.terminate();
  await app.delete();
}

function mapReferences(value, fromProject, toProject) {
  if (!value || typeof value !== 'object') return value;
  switch (value.type) {
    case 'reference':
      if (value.projectId !== fromProject) throw new Error('Foreign or unidentified reference project: explicit owner mapping is required.');
      return { ...value, projectId: toProject };
    case 'map': return { ...value, entries: value.entries.map(([key, item]) => [key, mapReferences(item, fromProject, toProject)]) };
    case 'array': return { ...value, items: value.items.map(item => mapReferences(item, fromProject, toProject)) };
    // Date is a codec-supported value but Firestore stores it as Timestamp.
    // Reject it here rather than promise an identical typed restore.
    case 'date': throw new Error('Date-tagged values need an explicit Timestamp migration.');
    default: return value;
  }
}

async function capture(db, sdk, extra = {}) {
  const { projectId } = assertClient(db);
  return engine.capture({ ...extra, db, sdk, projectId, exportedBy: 'synthetic-recovery-drill', pageSize: 2 });
}

async function restore(backup, db, sdk, { batchSize = 100, beforeBatch = () => {} } = {}) {
  const { host, projectId } = assertClient(db);
  assertLocalTarget(host, backup?.projectId);
  const verified = await engine.verify(backup);
  if (verified.legacy || backup.projectId === projectId) throw new Error('Use a current backup and a different disposable demo target.');
  if (backup.collections.length !== engine.COLLECTIONS.length) throw new Error('The recovery drill requires every currently supported root collection, including revision and year-close history.');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Invalid restore batch size.');

  // Validate and decode ALL records before any write. Rebinding references is
  // explicit, only source -> target; foreign/missing source identities fail.
  const records = backup.collections.flatMap(name => backup.data[name].map(row => ({
    ref: db.doc(`${name}/${row.id}`),
    data: engine.decode(mapReferences(row.data, backup.projectId, projectId), sdk, db)
  })));
  for (const name of engine.COLLECTIONS) {
    if (!(await db.collection(name).limit(1).get({ source: 'server' })).empty) {
      throw new Error('Target is not empty. Nothing was overwritten; use a new disposable target.');
    }
  }
  let written = 0;
  try {
    for (let start = 0; start < records.length; start += batchSize) {
      await beforeBatch(start / batchSize);
      const chunk = records.slice(start, start + batchSize);
      await db.runTransaction(async transaction => {
        // Web SDK has no batch.create(). Read before writing to enforce that
        // original IDs cannot overwrite documents created by another client.
        const existing = await Promise.all(chunk.map(row => transaction.get(row.ref)));
        if (existing.some(snapshot => snapshot.exists)) throw new Error('Restore ID conflict; refusing to overwrite.');
        chunk.forEach(row => transaction.set(row.ref, row.data));
      }, { maxAttempts: 1 });
      written += chunk.length;
    }
  } catch (cause) {
    // A multi-batch restore is NOT atomic. Never label partial data as recovered,
    // retry into it, or delete the target automatically.
    const error = new Error(`Recovery incomplete: ${written} documents committed before failure. Keep this disposable target isolated; start again with a fresh target.`, { cause });
    error.committedDocuments = written;
    throw error;
  }
  return { written };
}

function compareContents(source, target) {
  if (source.totalDocuments !== target.totalDocuments) throw new Error('Restored document count differs.');
  for (const name of engine.COLLECTIONS) {
    const expected = source.data[name].map(row => ({ id: row.id, data: mapReferences(row.data, source.projectId, target.projectId) }));
    if (engine.canonical(expected) !== engine.canonical(target.data[name])) throw new Error(`Restored IDs/typed values differ in ${name}.`);
  }
}

module.exports = { assertLocalTarget, connect, close, capture, restore, compareContents, mapReferences };
