# Form safety and mobile regression checks

## Implemented

- Shared save lock, visible progress, slow/offline feedback, and explicit server-confirmed success for bill creation/editing, Orders, ledger payments, core deductions, product templates, and print settings.
- No timeout-based automatic retry: a slow save stays locked until its promise resolves or rejects. A timeout is not proof that the server did not save.
- Orders validate every item before writing. Counter, order and variety names commit in one transaction. Existing orders are checked for concurrent changes inside that transaction.
- New bills and orders retain a request/document ID across retries and local draft restoration. Payments reuse their document ID while the same payment dialog remains open. An already-committed ID is not written twice.
- Bill follow-up errors report that the bill was saved, rather than asking the user to create it again. Linked-order/audit/sharing work remains separate from the main bill transaction; review linked records if warned.
- Bill/Order drafts are explicitly restored, not automatically submitted. Current account, project and edit/new-record context are separated; tabs use different draft keys. Changed record versions or product templates block stale restoration.
- Orders, Payment and template dialogs scroll within the viewport with reachable actions. The existing New Bill action-bar/bottom-navigation fix is preserved.

## Draft limitations

Drafts are unencrypted browser localStorage, **not a Firebase save, backup, or access-control boundary**. Avoid shared devices. Clearing site data, private browsing, storage failures, browser crashes before the debounce completes, and device loss can remove them. UID scoping prevents accidental display in another signed-in account; it does not stop someone with access to the browser's storage from reading them.

Draft status tells the user whether local storage succeeded. Closing/navigating away warns about unsubmitted changes when the browser permits it; mobile browsers may suppress unload dialogs. A visibility/pagehide flush is also attempted. No zero-data-loss guarantee is made.

After an uncertain save, review the record list. An idempotent retry opens/accepts the earlier saved record; edits made after that earlier request are not silently applied. Closing/reloading a payment dialog starts a new attempt, so check the ledger before re-entering a payment.

## Automated checks (2026-10-16)

Run from the repository root:

```sh
node ui-tests/form-safety.cjs
node ui-tests/bill-mobile-layout.cjs
node ui-tests/workspace-tests.cjs
node ui-tests/backup-tests.cjs
node payment-tests/test/test-atomicity.js
node payment-tests/test/test-rules.js
node tools/backup/check-entry-plan.cjs
git diff --check
```

Browser tests require Playwright and Chromium. `PLAYWRIGHT_MODULE` may point to an installed Playwright module directory; `CHROME_EXECUTABLE` may point to an installed Chrome executable. `LAYOUT_SCREENSHOTS` optionally stores PNG previews.

Verified results:

- Form safety: 69 checks, including duplicate submission, rejection/retry, post-commit failure, offline saves, storage-full warnings, separate-account/tab drafts, stale record/template conflicts, and mobile popup geometry.
- New Bill layout: 88 states, including Classic/Professional layouts, dock breakpoint, safe-area offsets, and landscape.
- Workspace: 35 checks.
- Backup: 87 checks.
- Atomicity: 25 mock-datastore checks.
- Rules: 54 **simulator** checks, not Firebase emulator or deployed-rule verification.
- Ten-bill calculator plan: all 10 expected cases match.

Browser fixtures load actual local HTML/CSS and feature functions, strip application bootstrap, and block external resources. Their datastore is an in-memory stub. No Firebase SDK, live authentication, production data, deployment, or live writes are involved.

## Still requires device/integration testing

On the user's test Firebase project after updating the served files: verify real login/permissions, server latency/reconnect, mobile keyboard behavior and installed-PWA refresh. Before saving any test bill, the user can check draft recovery by typing an unsaved order/bill, leaving, returning and choosing **Restore draft**. Use **Discard saved draft** only when that local copy is no longer needed. Real ten-bill testing remains deferred at the user's request.
