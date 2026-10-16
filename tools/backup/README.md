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

Automatic point-in-time cloud recovery is a separate capability: managed
Firestore backups/PITR require billing and privileged project configuration.
They are outside this free-plan workflow and are not enabled by this change.
The free workflow remains manual, with writers paused during capture and
independent protected copies retained by the owner. Auth account/password-hash
exports require a separate secure owner operation and applicable hash
configuration. Never publish Auth exports.

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

## Real local recovery drill (no paid Firebase services)

`recovery-drill.cjs` tests the actual backup engine against Google's Firestore
emulator using the Firebase Web compat SDK, not an in-memory database mock.
It creates **synthetic records only**. It does not accept a customer backup file,
read `.firebaserc`, load cloud credentials, or connect to a live Firebase project.
Both host and disposable project IDs are guarded before SDK initialization.

Requirements: Node.js 20+, Java 21+, the official Firestore emulator JAR, and
`firebase@12.17.1`. Keep these test dependencies outside the repository. For
example, install the SDK into a temporary directory:

```sh
drill_runtime=$(mktemp -d)
npm install --prefix "$drill_runtime" --cache "$drill_runtime/npm-cache" --ignore-scripts --no-audit --no-fund firebase@12.17.1
```

Obtain Java for your machine from its official distributor (a portable runtime
is sufficient) and the Firestore emulator through the Firebase CLI's
`firebase setup:emulators:firestore`. Alternatively use the official download
URL/checksum listed in the installed Firebase CLI's
`lib/emulator/downloadableEmulatorInfo.json`. Verify downloaded checksums before
execution. No Firebase login, billing upgrade, deployment or cloud backup
configuration is needed for this test.

Run with **absolute paths** to the prepared SDK directory and binaries:

```sh
MANDIBOOK_TEST_NODE_MODULES="$drill_runtime/node_modules" \
MANDIBOOK_TEST_JAVA="/absolute/path/to/java" \
MANDIBOOK_TEST_FIRESTORE_JAR="/absolute/path/to/cloud-firestore-emulator.jar" \
node tools/backup/recovery-drill.cjs
```

The script starts its own emulator on a temporary **127.0.0.1-only** port and
uses random `demo-mb-drill-*` projects. It stops the process on completion or
failure. It never clears an existing emulator, deletes live records or alters
your app configuration. A 3-minute deadline prevents indefinite SDK retries.
Temporary logs, an encrypted synthetic file and (only after success) `result.json`
are stored in the printed temporary directory. The synthetic encryption password
is intentionally discarded after the run; this test artifact is not a usable
customer recovery copy.

Coverage:

- 68 documents across all 15 known collections; ten linked party/order/bill
  scenarios (three unpaid, three partial, four paid), eight payment records
  including two installments on one bill, decimals and deductions. Also tests
  archived and undated bills, broker payouts, staff profiles,
  mobile directory, serial counter, settings, share record and audit events.
- Two-pass paginated export, encrypted disk save/reopen/decrypt/checksum, then
  multi-batch restore into a different empty emulator project.
- Every original ID and encoded field compared; references explicitly rebound
  from source to target. Timestamps at stored precision, binary values,
  locations, special numbers, nested fields and Gujarati text are exercised.
- Independent checks of the fixture's bill/payment/party relationships,
  deductions, outstanding balances, broker totals and serial counter.
- Wrong password, damaged ciphertext/checksum, missing required collections,
  foreign reference, read cap, concurrent source update, repeated restore,
  concurrent ID collision and a mid-restore interruption are rejected.
- Real project rules loaded locally: restored Admin can read audit history;
  Viewer can read bills but not audit history or write settings; pending,
  suspended and anonymous clients cannot read bills. These are smoke checks,
  **not** an exhaustive security review or a real authentication test.

The restore helper is **test-only**, limited to guarded demo clients and the
known collections. It preflights all records, rejects a populated target, and
uses read-before-write transactions to prevent overwriting an existing ID.
A multi-batch restore is not atomic: an interrupted target is explicitly
reported as incomplete and cannot be blindly retried. Use a fresh isolated
target, not a production database. No resume/delete/overwrite command is exposed.

Passing this drill demonstrates the synthetic recovery path. It does not prove
that a particular customer's downloaded file is complete, cover unknown root
collections/subcollections, recreate Authentication accounts or Storage files,
or replace a real phone/desktop download test. There is no zero-data-loss
guarantee while staff continue writing or between manual backups.

## Owner's ten-bill acceptance check

Status: **pending real entries and a saved backup file**. Local fixtures are not
evidence that the app's complete entry, print or mobile workflows have passed.

On a live business database, use genuine entries. A `TEST` name or remark does
not exclude a record from totals, audit history, reports, counters or backups.
Keep dummy experiments in an isolated environment, and do not delete real
records or reverse genuine payments to make test totals match.

1. Note the bill numbers/IDs for ten genuine entries, the chosen date range and
   the current app account/project. Note starting balances for any existing
   parties. Do not assume an existing party starts at zero.
2. If genuine transactions allow it, cover unpaid, partial and paid bills,
   a payment with an agreed deduction, two installments on one bill, a decimal
   amount, more than one product, a broker, and an order-linked bill. Do not
   invent real payments solely to fill a test category.
3. Check bill totals, paid amounts and remaining dues against the entries.
   Check each order's bill link, the party ledger's opening balance and new
   movements, broker commission/payouts, Dashboard, Reports and Daily Closing.
   Use identical dates and filters when comparing screens. Unpaid bills should
   not require a zero-value payment record.
4. Open bill print/PDF previews and confirm party/product/amount details.
   Do not send WhatsApp messages to real recipients just for this check.
5. When entries are finished and synced, pause writes on ALL devices. Prepare,
   save and reopen the full JSON backup; verify the actual saved file. Its
   bill count can exceed ten because it includes earlier and archived records.
   Excel is a bill report, not a full recovery copy.
6. Check the ten noted original IDs and financial amounts in the verified
   backup without restoring into production. Preserve an independent copy.
   Do not put private backups, customer details or passwords in Git or this
   checklist. Supply only the local file path for an owner-assisted check.
7. Repeat the real save/reopen/verify steps on the owner's phone. Record any
   stuck loading state, permission/download error or mismatch with the relevant
   screen and bill number. A desktop emulator does not replace this check.

No production restore, destructive cleanup, role change or message sending is
part of this acceptance check. Complete it before claiming real-data readiness.

### Initial five-case local run — 15 October 2026

The drill passed all **14 integration checks**, restoring **45 synthetic
documents / 15 collections**. Fixture amounts matched before and after:
₹15,000 active bill total, ₹3,750 cash plus ₹50 deductions, ₹11,200 outstanding
and party balance; ₹150 broker commission and ₹30 payouts. Archived records
were retained without adding their value to the active-bill totals.

Environment: Node 24.19.0, portable Java 21.0.12.1, Firestore emulator 1.22.0,
Firebase npm package 12.17.1 (the SDK's own runtime version string is 12.17.0).
Downloaded runtime/emulator checksums were verified. The emulator shut down
after the checks. Existing backup (87), workspace (35), mocked atomicity (25)
and rules/model (54) checks also passed. Production data was not accessed or
changed; no deployment or billing change was made for this test-only work.

### Expanded ten-case local run — 15 October 2026

All **15 integration checks passed**, with **68 documents / 15 collections**:
ten main bills (3 unpaid, 3 partial, 4 paid), two additional archive/legacy
bills, ten parties, ten orders and eight payment records. Two payments settle
the tenth bill; deductions and decimal amounts are preserved. These are seeded
recovery fixtures, not ten transactions entered through the app's UI.

Before/after totals matched: ₹29,326.25 active bill total, ₹17,265.75 cash,
₹160 deductions, ₹17,425.75 total credit, ₹11,900.50 due/party balance,
₹550 commission and ₹30 broker payouts. The backup (87) and workspace (35)
checks were rerun and passed. The emulator shut down; no live data was changed.
The owner's real-entry, PDF, mobile and saved-file acceptance checks remain
pending; they must not be marked passed from these local results.

### Exact manual-entry dataset — 16 October 2026

For the owner's requested mixed-entry values, use [TEN-BILL-ENTRY-GUIDE.md](TEN-BILL-ENTRY-GUIDE.md).
If chat-side file previews do not open, open `tools/backup/entry-guide.html`
directly in Chrome (File → Open File). It is self-contained and works without
a local server. Its embedded synthetic plan matches the JSON below. The page
does not connect to Firebase or save entries. Browser checks passed for all ten
bill selectors/expected amounts, setup/results tabs and a 390px viewport.
The reproducible synthetic plan is `ten-bill-entry-plan.json`, ID
`MB-QA-20261015-v1`. Its fixed transaction date is 15 October 2026.
It is different from the seeded recovery fixture above: ten bills, five farmer
parties, three linked orders, one broker and eight farmer payments.

Run `node tools/backup/check-entry-plan.cjs` from the repository root. It executes
the real local bill calculator offline and checks independent final/net/commission
targets plus installment arithmetic and party/aggregate balances. All ten cases
passed: ₹1,22,165 final, ₹74,695.50 cash, ₹2,120 deductions, ₹45,349.50 due.
Broker commission ₹140 and payout ₹50 are separate from farmer credit.

This does not exercise the actual payment-save implementation or prove UI,
order-import, PDF, mobile or downloaded-backup correctness. Enter dummy data only
in an isolated test database; localhost can still use production Firebase.
No automatic seed, live write, message, cleanup, restore or deployment is part
of this plan.
