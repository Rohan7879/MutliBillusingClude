# Recovery backup workflow

The app's JSON recovery copy includes all 15 known root collections, including
archived records, original document IDs, staff profiles, broker payouts,
counters and audit evidence. Excel remains a bill review report.

## Routine copy

1. Sign in as an approved Admin. Open Settings → Backup & security.
2. Pause all staff writes, not just the local tab. Confirm the pause.
3. Prepare the copy. Both server-read passes must match; a read failure or
   observed data change stops the export rather than offering a partial file.
4. Save JSON. Optional password protection uses AES-256-GCM with a random
   salt/IV and PBKDF2-SHA256. Keep the password separately. Losing it means
   losing access to that encrypted copy.
5. Verify the actual saved file. Supported native pickers read the saved file
   back automatically; mobile/fallback downloads must be selected manually.
6. Keep an off-device copy and at least one previous verified copy. Do not
   put financial recovery files, Auth exports or credentials in this repository.

A verified file is a checksum/type/count-checked copy, not proof of complete
accounting correctness or proof of the file author's identity. Verification
records the source export date, not a misleading new "fresh data" date.

## Offline verification and recovery planning

Use Node.js 20+ (Web Crypto support):

```sh
node tools/backup/verify-backup.cjs /absolute/private/path/backup.json --project=ganesh-agri-new
```

For encrypted files, verify in the app, or supply `MANDIBOOK_BACKUP_PASSWORD`
privately through the environment. Do not pass secrets in CLI arguments or
commit them. The tool has no database connections and cannot restore, delete
or overwrite anything. The app does not expose a generic JSON-to-live-database
restore bypass.

Controlled owner recovery must first be rehearsed in an isolated environment.
Use the same document IDs and the backup codec to reconstruct timestamps
(including nanoseconds), references, locations, binary values and special
numbers. Map references deliberately when changing projects. Restore Auth UIDs
before approving restored staff access; do not assume staff profile documents
recreate login accounts. Compare collection counts, document contents, payment
links, serial counters, balances and permissions before a production cutover.
There is no automatic live restore command in this repository.

## Free Firebase plan workflow

No billing upgrade, Cloud Functions, Cloud Scheduler, paid Storage bucket or
managed backup service is needed by the app's manual JSON workflow. This does
not confirm or change the project's current billing plan.

- Admins see an overdue reminder in the app. Daily is the default; 3-day and
  weekly intervals are browser/account-specific preferences. A closed app
  cannot remind, capture or download a file. There is no background scheduler.
- Reminder metadata is cached per project/account for 15 minutes. There is no
  continuous backup listener. Only verification metadata is stored in Firebase.
- Capture allows 10,000 document reads by default, shared between both passes;
  the Admin can select 2,000 or 20,000 after checking project usage. Empty
  queries count towards this allowance. Additional rules reads, retries outside
  this operation, bandwidth and other app usage are not part of this estimate.
  The allowance is NOT a measurement or reservation of remaining free quota.
  Reaching it stops the whole capture, with no partial recovery download.
- Verification history retains metadata for 12 distinct file versions, sorted
  by source export time. Verifying an older file does not replace the newest
  date; concurrent updates use a transaction. No files are retained by this
  list, and no file is ever pruned automatically. Keep at least 3 dated copies
  and a separate protected copy yourself (for example, an external drive).
- Verify the newer file, then select an earlier copy to compare locally. Counts
  show added, changed, missing and unchanged documents, including archived
  records. Both checksums and the source project must match expectations.
  Comparison supports up to 20 MB per file to limit phone memory use, uses no
  Firebase reads/writes, and does not perform a database restore.

Firestore currently includes 50,000 document reads per day on its free quota;
the whole app shares that quota. Managed backups/PITR require billing. See the
[official pricing and quota documentation](https://firebase.google.com/docs/firestore/pricing).
For larger databases, check usage and design a controlled owner export; do not
repeatedly retry exports until the app's shared free quota is exhausted.

## Recovery limits

This browser export is **not an atomic point-in-time snapshot**. Two passes
detect observed changes, but cannot guarantee consistency while other clients
continue writing. It covers known root collections, not unknown collections or
subcollections, Firebase Authentication credentials, Cloud Storage uploads,
security rules, indexes or hosting assets. App source/rules should be retained
in Git separately.

For disaster recovery while the app is in use, the owner must separately
configure managed Firestore backups/PITR and a recovery retention policy. This
may require billing and privileged project configuration; it is not enabled by
this change. Auth account/password-hash exports require a separate secure
owner operation and applicable hash configuration. Never publish Auth exports.

Official references:

- [Firestore exports and point-in-time exports](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firebase Authentication export/import](https://firebase.google.com/docs/cli/auth)
- [Query cursor pagination](https://firebase.google.com/docs/firestore/query-data/query-cursors)

## Verification tests

```sh
node ui-tests/backup-tests.cjs
node ui-tests/workspace-tests.cjs
node payment-tests/test/test-atomicity.js
node payment-tests/test/test-rules.js
```

Tests use fixtures, injected failures and in-memory transaction stores. They do
not change live financial data. Production restore drills and real-device
download tests still require an owner-controlled exercise.
