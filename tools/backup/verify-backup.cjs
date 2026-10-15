#!/usr/bin/env node
// Offline-only: no Firebase credentials, network calls or restoration writes.
const fs = require('node:fs/promises');
const engine = require('../../js/core/backup-engine.js');
async function main() {
  const file = process.argv[2];
  if (!file || process.argv.slice(3).some(arg => !arg.startsWith('--project='))) throw new Error('Usage: node tools/backup/verify-backup.cjs /absolute/path/backup.json [--project=ganesh-agri-new]');
  const expectedProject = process.argv.slice(3).find(arg => arg.startsWith('--project='))?.slice(10) || null;
  const info = await fs.stat(file);
  if (info.size > engine.MAX_FILE_BYTES) throw new Error('File exceeds this verifier\'s 200 MB limit. Use an owner-managed export/recovery workflow.');
  let input = JSON.parse(await fs.readFile(file, 'utf8'));
  if (input.format === 'mandibook-encrypted-backup') {
    // Password is supplied privately via environment, never a CLI argument.
    const password = process.env.MANDIBOOK_BACKUP_PASSWORD;
    if (!password) throw new Error('Encrypted file: supply MANDIBOOK_BACKUP_PASSWORD securely, or verify it in the app. Never commit the password.');
    input = JSON.parse(await engine.decrypt(input, password));
  }
  const result = await engine.verify(input, expectedProject);
  if (expectedProject && !result.projectMatches) throw new Error('Source project mismatch (or legacy source unknown). This is not a recovery copy for the requested project.');
  console.log(JSON.stringify({ verified: true, version: result.backup.version, sourceProject: result.backup.projectId || 'unknown', exportedAt: result.backup.exportedAt, documents: result.totalDocuments, collections: result.counts,
    missingCollections: result.missingCollections, integrityHash: result.backup.integrity.payloadHash, recordWarningCount: engine.reviewRecords(result.backup).length,
    scope: result.backup.scope || 'Legacy five-collection export; incomplete for current app',
    recoveryPlan: ['Keep this file and an independent protected copy.', 'Pause writers. Recover into an isolated emulator/staging project first.', 'Preserve document IDs, typed values and reference source project; never flatten JSON through Excel.', 'Restore login accounts separately with the original UIDs; Firestore staff profiles are not Auth credentials.', 'Compare counts, relationships and balances before approving any production recovery.'],
    databaseConnections: 0, restoreWrites: 0 }, null, 2));
}
main().catch(error => { console.error('NOT VERIFIED:', error.message); process.exitCode = 1; });
