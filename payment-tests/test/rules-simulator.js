// Faithful JS re-implementation of config/firestore.rules for the payment-
// related paths (bills.update via billPaymentUpdater, payments.create,
// parties.update, orders.update). Mirrors the .rules file line-for-line so
// we can exhaustively test the security logic without a live Firestore
// project (this sandbox can't reach storage.googleapis.com to fetch the
// real emulator jar). Any change to firestore.rules should be mirrored
// here before trusting these results.

function hasOnly(keys, allowed) {
  return keys.every((k) => allowed.includes(k));
}
function diffKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  keys.forEach((k) => {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  });
  return changed;
}
function get(obj, key, fallback) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
}

function anyRole(profile, roles) {
  return !!profile && profile.status === "active" && roles.includes(profile.role);
}

// --- bills.update via billPaymentUpdater ---
function billPaymentUpdater({ profile, before, after, approvalRequired = false }) {
  const finalTotal = get(before, "Final Total", 0);
  const newPaid = get(after, "amountPaid", -1);
  const newDue = get(after, "amountDue", -1);
  const billApprovedForRelease =
    !approvalRequired ||
    ["approved", "locked"].includes(get(before, "workflowStatus", "draft")) ||
    get(before, "locked", false) === true;

  const changedKeys = diffKeys(before, after);
  return (
    anyRole(profile, ["admin", "accountant"]) &&
    billApprovedForRelease &&
    hasOnly(changedKeys, ["amountPaid", "amountDue", "paymentStatus", "lastUpdatedAt"]) &&
    typeof newPaid === "number" &&
    typeof newDue === "number" &&
    newPaid >= -0.01 &&
    newPaid <= finalTotal + 0.01 &&
    newDue >= -0.01 &&
    newPaid + newDue >= finalTotal - 0.01 &&
    newPaid + newDue <= finalTotal + 0.01
  );
}

// --- payments.create via validPaymentDoc ---
function paymentsCreate({ profile, doc }) {
  const cash = get(doc, "cashAmount", -1);
  const ded = get(doc, "deductionAmount", -1);
  const total = get(doc, "totalCredit", -1);
  const validPaymentDoc =
    typeof cash === "number" &&
    typeof ded === "number" &&
    typeof total === "number" &&
    cash >= 0 &&
    ded >= 0 &&
    total >= 0 &&
    total >= cash + ded - 0.01 &&
    total <= cash + ded + 0.01;
  return anyRole(profile, ["admin", "accountant"]) && validPaymentDoc;
}

// --- parties.update via partyBalanceUpdater (or full-edit roles) ---
function partiesUpdate({ profile, before, after }) {
  const changedKeys = diffKeys(before, after);
  const fullEdit = anyRole(profile, ["admin", "manager", "biller"]);
  const balanceOnly =
    anyRole(profile, ["admin", "manager", "biller", "accountant"]) &&
    hasOnly(changedKeys, ["currentBalance", "lastUpdatedAt"]) &&
    typeof get(after, "currentBalance", "invalid") === "number";
  return fullEdit || balanceOnly;
}

// --- orders.update via orderPaymentStatusUpdater (or full-edit roles) ---
function ordersUpdate({ profile, before, after }) {
  const changedKeys = diffKeys(before, after);
  const fullEdit = anyRole(profile, ["admin", "manager", "biller"]);
  const statusOnly =
    anyRole(profile, ["admin", "manager", "biller", "accountant"]) &&
    hasOnly(changedKeys, ["paymentStatus", "updatedAt"]);
  return fullEdit || statusOnly;
}

// --- bills.update via billEditor (normal, non-payment edits) ---
function billEditor({ profile, before, after }) {
  const changedKeys = diffKeys(before, after);
  const openBill = get(before, "locked", false) !== true && get(before, "workflowStatus", "draft") !== "locked";
  const deletedNow = get(after, "deleted", false) === true;
  const hadPayment =
    get(before, "amountPaid", 0) > 0 ||
    ["Paid", "Partial", "Partially Paid"].includes(get(before, "paymentStatus", "Unpaid"));
  return (
    anyRole(profile, ["admin", "manager", "biller"]) &&
    openBill &&
    get(before, "deleted", false) === false &&
    get(after, "locked", false) === get(before, "locked", false) &&
    get(after, "workflowStatus", "draft") === get(before, "workflowStatus", "draft") &&
    !(deletedNow && hadPayment) &&
    !changedKeys.some((k) => ["amountPaid", "amountDue", "paymentStatus"].includes(k))
  );
}

// --- users.update — self metadata refresh (includes new 'email' field) ---
function usersSelfUpdate({ requesterUid, targetUid, isAdmin, before, after }) {
  const changedKeys = diffKeys(before, after);
  const selfAllowed = ["displayName", "mobileNumber", "mobileKey", "providerIds", "lastSignInAt", "updatedAt", "email"];
  return isAdmin || (requesterUid === targetUid && hasOnly(changedKeys, selfAllowed));
}

function nonNegativeNumber(value) {
  const n = Number(value);
  return !isFinite(n) || n < 0 ? 0 : n;
}
function clampPercent(value) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

module.exports = {
  billPaymentUpdater,
  paymentsCreate,
  partiesUpdate,
  ordersUpdate,
  billEditor,
  usersSelfUpdate,
  nonNegativeNumber,
  clampPercent,
  anyRole,
};
