const {
  billPaymentUpdater,
  paymentsCreate,
  partiesUpdate,
  ordersUpdate,
  billEditor,
  usersSelfUpdate,
} = require("./rules-simulator");

let pass = 0,
  fail = 0;
function check(name, condition, expected) {
  const ok = condition === expected;
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}  (expected ${expected}, got ${condition})`);
  }
}

const admin = { role: "admin", status: "active" };
const accountant = { role: "accountant", status: "active" };
const manager = { role: "manager", status: "active" };
const biller = { role: "biller", status: "active" };
const viewer = { role: "viewer", status: "active" };
const inactiveAdmin = { role: "admin", status: "pending" };
const noProfile = null;

console.log("\n=== 1. bills.update — billPaymentUpdater() ===\n");

{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "LEGIT: accountant records a normal partial payment",
    billPaymentUpdater({ profile: accountant, before, after }),
    true
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  const after = { "Final Total": 1000, amountPaid: 1000, amountDue: 0, paymentStatus: "Paid" };
  check("LEGIT: admin marks bill fully paid", billPaymentUpdater({ profile: admin, before, after }), true);
}
{
  const before = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  const after = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  check(
    "LEGIT: payment deletion reverses amountPaid back down",
    billPaymentUpdater({ profile: admin, before, after }),
    true
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 999999, amountDue: -998999, paymentStatus: "Paid" };
  check(
    "ATTACK: fabricate a huge amountPaid far beyond Final Total",
    billPaymentUpdater({ profile: accountant, before, after }),
    false
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: -500, amountDue: 1500, paymentStatus: "Unpaid" };
  check("ATTACK: negative amountPaid", billPaymentUpdater({ profile: accountant, before, after }), false);
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 999, paymentStatus: "Partial" };
  check(
    "ATTACK: amountPaid + amountDue don't add up to Final Total (drift)",
    billPaymentUpdater({ profile: accountant, before, after }),
    false
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 50000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "ATTACK: sneak a Final Total change into a 'payment' write",
    billPaymentUpdater({ profile: accountant, before, after }),
    false
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "ATTACK: manager (not admin/accountant) tries to record a payment",
    billPaymentUpdater({ profile: manager, before, after }),
    false
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check("ATTACK: biller tries to record a payment", billPaymentUpdater({ profile: biller, before, after }), false);
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check("ATTACK: viewer role tries to record a payment", billPaymentUpdater({ profile: viewer, before, after }), false);
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "ATTACK: account not yet approved/active tries to record a payment",
    billPaymentUpdater({ profile: inactiveAdmin, before, after }),
    false
  );
}
{
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check("ATTACK: unauthenticated / no profile", billPaymentUpdater({ profile: noProfile, before, after }), false);
}
{
  // Approval workflow enabled, bill still in draft
  const before = {
    "Final Total": 1000,
    amountPaid: 0,
    amountDue: 1000,
    paymentStatus: "Unpaid",
    workflowStatus: "draft",
  };
  const after = { ...before, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "ATTACK: payment on an unapproved draft bill when approval workflow is on",
    billPaymentUpdater({ profile: accountant, before, after, approvalRequired: true }),
    false
  );
}
{
  const before = {
    "Final Total": 1000,
    amountPaid: 0,
    amountDue: 1000,
    paymentStatus: "Unpaid",
    workflowStatus: "approved",
  };
  const after = { ...before, amountPaid: 400, amountDue: 600, paymentStatus: "Partial" };
  check(
    "LEGIT: payment on an approved bill when approval workflow is on",
    billPaymentUpdater({ profile: accountant, before, after, approvalRequired: true }),
    true
  );
}
{
  // Piggyback attack: try to also flip "locked" while recording a payment
  const before = { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid", locked: false };
  const after = { "Final Total": 1000, amountPaid: 400, amountDue: 600, paymentStatus: "Partial", locked: true };
  check(
    "ATTACK: smuggle a 'locked' flag change inside a payment write",
    billPaymentUpdater({ profile: admin, before, after }),
    false
  );
}
{
  // Floating point rounding tolerance should still pass
  const before = { "Final Total": 999.99, amountPaid: 0, amountDue: 999.99, paymentStatus: "Unpaid" };
  const after = { "Final Total": 999.99, amountPaid: 999.995, amountDue: 0, paymentStatus: "Paid" };
  check(
    "EDGE: tiny floating-point rounding still within tolerance",
    billPaymentUpdater({ profile: admin, before, after }),
    true
  );
}

console.log("\n=== 2. payments.create — validPaymentDoc() ===\n");

{
  const doc = { cashAmount: 400, deductionAmount: 0, totalCredit: 400 };
  check("LEGIT: accountant creates a normal cash payment", paymentsCreate({ profile: accountant, doc }), true);
}
{
  const doc = { cashAmount: 300, deductionAmount: 100, totalCredit: 400 };
  check("LEGIT: admin creates payment with a deduction", paymentsCreate({ profile: admin, doc }), true);
}
{
  const doc = { cashAmount: -500, deductionAmount: 0, totalCredit: -500 };
  check("ATTACK: negative cashAmount", paymentsCreate({ profile: accountant, doc }), false);
}
{
  const doc = { cashAmount: 100, deductionAmount: 0, totalCredit: 100000 };
  check(
    "ATTACK: totalCredit doesn't match cash+deduction (inflated ledger entry)",
    paymentsCreate({ profile: accountant, doc }),
    false
  );
}
{
  const doc = { cashAmount: 400, deductionAmount: 0, totalCredit: 400 };
  check("ATTACK: manager tries to create a payment record directly", paymentsCreate({ profile: manager, doc }), false);
}
{
  const doc = { cashAmount: 400, deductionAmount: 0, totalCredit: 400 };
  check("ATTACK: biller tries to create a payment record directly", paymentsCreate({ profile: biller, doc }), false);
}
{
  const doc = { cashAmount: "400", deductionAmount: 0, totalCredit: 400 };
  check("ATTACK: cashAmount sent as a string instead of number", paymentsCreate({ profile: admin, doc }), false);
}
{
  const doc = { deductionAmount: 0, totalCredit: 400 }; // cashAmount missing entirely
  check("ATTACK: cashAmount field omitted entirely", paymentsCreate({ profile: admin, doc }), false);
}

console.log("\n=== 3. parties.update — balance side-effect vs full edit ===\n");

{
  const before = { name: "Ramesh", currentBalance: 1000 };
  const after = { name: "Ramesh", currentBalance: 600, lastUpdatedAt: "now" };
  check(
    "LEGIT: accountant updates only the cached balance after a payment",
    partiesUpdate({ profile: accountant, before, after }),
    true
  );
}
{
  const before = { name: "Ramesh", currentBalance: 1000 };
  const after = { name: "Ramesh Bhai", currentBalance: 1000 };
  check("LEGIT: manager edits the party's profile fields", partiesUpdate({ profile: manager, before, after }), true);
}
{
  const before = { name: "Ramesh", currentBalance: 1000 };
  const after = { name: "Ramesh Bhai", currentBalance: 600 };
  check(
    "ATTACK: accountant tries to change name + balance in one write (privilege creep)",
    partiesUpdate({ profile: accountant, before, after }),
    false
  );
}
{
  const before = { name: "Ramesh", currentBalance: 1000 };
  const after = { name: "Ramesh", currentBalance: "600" };
  check("ATTACK: currentBalance sent as a string", partiesUpdate({ profile: accountant, before, after }), false);
}
{
  const before = { name: "Ramesh", currentBalance: 1000 };
  const after = { name: "Ramesh", currentBalance: 600, lastUpdatedAt: "now" };
  check("ATTACK: viewer role tries to touch balance", partiesUpdate({ profile: viewer, before, after }), false);
}

console.log("\n=== 4. orders.update — payment-status side-effect vs full edit ===\n");

{
  const before = { paymentStatus: "Unpaid", supplier: "X" };
  const after = { paymentStatus: "Paid", supplier: "X", updatedAt: 123 };
  check(
    "LEGIT: accountant recalculates order paymentStatus after a payment",
    ordersUpdate({ profile: accountant, before, after }),
    true
  );
}
{
  const before = { paymentStatus: "Unpaid", supplier: "X" };
  const after = { paymentStatus: "Paid", supplier: "Y", updatedAt: 123 };
  check(
    "ATTACK: accountant sneaks a supplier-field change into a status update",
    ordersUpdate({ profile: accountant, before, after }),
    false
  );
}
{
  const before = { paymentStatus: "Unpaid", supplier: "X" };
  const after = { paymentStatus: "Paid", supplier: "X", updatedAt: 123 };
  check("ATTACK: viewer tries to update order payment status", ordersUpdate({ profile: viewer, before, after }), false);
}

console.log("\n=== 5. bills.update — billEditor() can no longer touch payment fields ===\n");

{
  const before = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 0,
    amountDue: 1000,
    paymentStatus: "Unpaid",
  };
  const after = {
    "Final Total": 1200,
    "Customer Name": "Ramesh",
    amountPaid: 0,
    amountDue: 1000,
    paymentStatus: "Unpaid",
  };
  check(
    "LEGIT: manager does a normal item/total edit, payment fields untouched",
    billEditor({ profile: manager, before, after }),
    true
  );
}
{
  const before = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 0,
    amountDue: 1000,
    paymentStatus: "Unpaid",
  };
  const after = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 1000,
    amountDue: 0,
    paymentStatus: "Paid",
  };
  check(
    "ATTACK (the exact gap found): manager smuggles amountPaid into an otherwise-normal edit",
    billEditor({ profile: manager, before, after }),
    false
  );
}
{
  const before = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 400,
    amountDue: 600,
    paymentStatus: "Partial",
  };
  const after = {
    "Final Total": 1000,
    "Customer Name": "Ramesh Bhai",
    amountPaid: 400,
    amountDue: 600,
    paymentStatus: "Partial",
  };
  check(
    "LEGIT: biller renames customer on the bill without touching payment state",
    billEditor({ profile: biller, before, after }),
    true
  );
}
{
  const before = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 400,
    amountDue: 600,
    paymentStatus: "Partial",
  };
  const after = {
    "Final Total": 1000,
    "Customer Name": "Ramesh",
    amountPaid: 400,
    amountDue: 0,
    paymentStatus: "Paid",
  };
  check(
    "ATTACK: biller tries to flip just paymentStatus (mark Paid) via a normal edit",
    billEditor({ profile: biller, before, after }),
    false
  );
}

console.log("\n=== 6. users.update — self metadata refresh now includes email backfill ===\n");

{
  const before = { displayName: "Ramesh", email: "", providerIds: ["phone"] };
  const after = { displayName: "Ramesh", email: "ramesh@gmail.com", providerIds: ["phone", "google.com"] };
  check(
    "LEGIT: phone-first user links Google, email backfills on self-update",
    usersSelfUpdate({ requesterUid: "u1", targetUid: "u1", isAdmin: false, before, after }),
    true
  );
}
{
  const before = { displayName: "Ramesh", email: "", providerIds: ["phone"], lastSignInAt: "t0" };
  const after = { displayName: "Ramesh", email: "", providerIds: ["phone"], lastSignInAt: "t1" };
  check(
    "LEGIT: routine phone-only sign-in refresh, email stays empty (not touched)",
    usersSelfUpdate({ requesterUid: "u1", targetUid: "u1", isAdmin: false, before, after }),
    true
  );
}
{
  const before = { displayName: "Ramesh", email: "ramesh@gmail.com" };
  const after = { displayName: "Ramesh", email: "ramesh@gmail.com", role: "admin" };
  check(
    "ATTACK: user tries to smuggle a role change into their own metadata self-update",
    usersSelfUpdate({ requesterUid: "u1", targetUid: "u1", isAdmin: false, before, after }),
    false
  );
}
{
  const before = { displayName: "Ramesh", email: "ramesh@gmail.com" };
  const after = { displayName: "Ramesh", email: "someone-else@gmail.com" };
  check(
    "LEGIT: self-update of own email field is still allowed (Auth-sourced value)",
    usersSelfUpdate({ requesterUid: "u1", targetUid: "u1", isAdmin: false, before, after }),
    true
  );
}
{
  const before = { displayName: "Ramesh", email: "ramesh@gmail.com" };
  const after = { displayName: "Ramesh", email: "hacked@evil.com" };
  check(
    "ATTACK: a DIFFERENT user tries to update someone else's profile",
    usersSelfUpdate({ requesterUid: "attacker", targetUid: "u1", isAdmin: false, before, after }),
    false
  );
}

console.log("\n=== 7. Negative-value guards — nonNegativeNumber() / clampPercent() ===\n");
const { nonNegativeNumber, clampPercent } = require("./rules-simulator");

check("nonNegativeNumber: normal positive value passes through", nonNegativeNumber("500") === 500, true);
check(
  "nonNegativeNumber: negative value clamped to 0 (the exact bug from the screenshot)",
  nonNegativeNumber("-1") === 0,
  true
);
check("nonNegativeNumber: empty string clamped to 0", nonNegativeNumber("") === 0, true);
check("nonNegativeNumber: non-numeric junk clamped to 0", nonNegativeNumber("abc") === 0, true);
check("nonNegativeNumber: zero stays zero", nonNegativeNumber("0") === 0, true);
check("clampPercent: normal 0-100 value passes through", clampPercent("12.5") === 12.5, true);
check("clampPercent: negative percent clamped to 0", clampPercent("-5") === 0, true);
check("clampPercent: over-100 percent clamped to 100", clampPercent("150") === 100, true);

console.log("\n=== 8. Recovery protection — no browser-side restore bypass ===\n");
const fs = require("fs");
const rulesSource = fs.readFileSync("config/firestore.rules", "utf8");
const backupSource = fs.readFileSync("js/features/backup.js", "utf8");
check("ATTACK: no admin restore bypass exists in Firestore rules", rulesSource.includes("disasterRecoveryRestore"), false);
check("ATTACK: browser cannot directly restore JSON into Firestore", backupSource.includes("restoreFromJsonBackup"), false);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (out of ${pass + fail}) ===\n`);
process.exit(fail > 0 ? 1 : 0);
