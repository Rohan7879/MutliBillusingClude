/Users/rohanvasoya/.rvm/scripts/rvm:29: operation not permitted: ps
# MandiBook — Bug & Security Audit Report

**Audit date:** 09 August 2026  
**Scope:** Local repository code review (`HTML`, `CSS`, vanilla JavaScript, Firebase/Firestore configuration)  
**Mode:** Read-only audit — is report ke liye application code ya Firebase configuration change nahi ki gayi.

## Executive summary

MandiBook ki billing, order, ledger aur party-management functionality ka source-code audit kiya gaya. JavaScript files ka syntax check pass hua; yani koi immediate parse error nahi mila. Lekin data-security aur accounting consistency se judi kuch high-risk problems mili hain.

Sabse pehle Firestore rules secure karna zaroori hai. Current rules ke hisaab se internet par koi bhi person database ka data read, create, modify ya delete kar sakta hai. Iske baad payment/balance consistency aur order-sync problems solve karni chahiye, kyunki yeh business data galat dikha sakti hain.

| Priority | Findings |
| --- | --- |
| Critical | 1 |
| High | 4 |
| Medium | 3 |
| Total | 8 |

## Audit method and limits

- Firestore rules, Firebase initialization, billing, ledger, party, order, broker, backup, and bill-view flows were reviewed.
- All standalone `.js` files passed `node --check` syntax validation.
- Findings below are source-code confirmed or directly reproducible from the shown logic.
- This was not a production penetration test and did not modify Firestore data, submit real payments, or deploy the site.

---

## 1. Firestore database is publicly writable

**Severity:** Critical  
**Area:** Security / every module  
**Evidence:** `config/firestore.rules`, lines 4–6

```js
match /{document=**} {
  allow read, write: if true;
}
```

### What happens

The rule allows every read and write request without checking Firebase authentication, user identity, ownership, or role. The login redirect in browser JavaScript is only a UI guard; it does not protect the database itself.

### Business impact

- Anyone who discovers the Firebase project can read supplier/customer records, bills, payments and ledger data.
- An attacker can create fake bills, change bills/payment amounts, reset counters, delete records, or inject harmful HTML into party/bill fields.
- Bill numbers and financial reports can become unreliable.

### How to verify safely

Review the deployed Firestore rules in Firebase Console. If they match this file, an unauthenticated Firestore request will be accepted.

### Recommended fix

At minimum require authentication for every document:

```js
allow read, write: if request.auth != null;
```

Then add role-based permissions (for example, owner/admin/accountant), validate allowed fields and types, and prevent clients from freely changing counters, balances, and deleted records. Deploy rules only after testing with actual project accounts.

---

## 2. Customer balance is written to inconsistent collections

**Severity:** High  
**Area:** Billing / ledger / party master  
**Evidence:**

- `js/features/bill-form.js`, lines 1085–1101: a new bill adds its total to `customers_master/{customerId}`.
- `js/features/ledger.js`, lines 532–544: ledger payment updates `parties/{customerId}`.
- `js/features/bill-view.js`, lines 79–89: payment from bill-detail screen also updates `parties/{customerId}`.

### What happens

Bill creation and payment collection operate on two different documents/collections:

| Action | Updated location |
| --- | --- |
| New bill | `customers_master/{customerId}` |
| Ledger payment | `parties/{customerId}` |
| Bill-detail payment | `parties/{customerId}` |

Because the bill total and payment total never meet in the same balance field, the cached balance cannot be correct.

### Example

1. Create a ₹10,000 bill for a party.
2. `customers_master.currentBalance` becomes ₹10,000.
3. Record a ₹4,000 payment.
4. `parties.currentBalance` becomes ₹-4,000 or changes from an unrelated old value.
5. Neither document reliably means “₹6,000 pending”.

### Business impact

Party Master balance, dashboard cards, future reminders, or credit-limit checks can display the wrong outstanding amount.

### Recommended fix

Choose one source for cached balances—preferably `parties/{customerId}.currentBalance` because it is the existing party master—and update it through a Firestore transaction for every bill/payment/delete/restore/edit. Keep the ledger’s live calculation as the source of truth, and provide a one-time repair script to recalculate all existing party balances.

---

## 3. Bill edit, delete and restore do not reconcile cached balances

**Severity:** High  
**Area:** Billing / balances  
**Evidence:**

- `js/features/bill-form.js`, lines 1085–1103: balance is incremented only after creating a bill.
- `js/features/bill-form.js`, lines 1180–1243: editing a bill updates only the bill document.
- `js/features/backup.js`, lines 7–46: soft delete marks a bill deleted without changing balance/order/broker cache.
- `js/features/backup.js`, restore flow: restore simply marks `deleted: false`.

### What happens

The application adds a bill’s final total to the cached balance when a bill is created, but it does not subtract/re-add the difference when that bill is edited, deleted, or restored.

### Example

1. Create a ₹10,000 bill.
2. Edit it to ₹8,000.
3. The cached balance remains ₹10,000 instead of ₹8,000.
4. Delete it; cache still remains unchanged.

### Business impact

The gap grows over time and makes party outstanding figures unreliable. Related cached values such as broker totals and order delivered quantity may also drift because their reverse/update flows are missing.

### Recommended fix

Before an edit/delete/restore, read the existing bill and calculate a delta:

- Edit: `newFinalTotal - oldFinalTotal`
- Delete: `-oldFinalTotal`
- Restore: `+restoredFinalTotal`

Apply the bill change and balance adjustment in one transaction or carefully ordered server-side function. Recalculate linked order delivery and broker summary from bills whenever an associated bill changes status.

---

## 4. Bill detail page accepts overpayments

**Severity:** High  
**Area:** Payment collection from `final.html` / `download.html`  
**Evidence:** `js/features/bill-view.js`, lines 40–89

### What happens

The page validates only that entered cash is greater than zero. It does not compare the cash amount to the current bill due amount before saving:

```js
const newAmountPaid = currentAmountPaid + cashAmount;
const newAmountDue = finalTotal - newAmountPaid;
```

Therefore a payment larger than the outstanding amount produces a negative `amountDue` and records the full excessive payment.

### Example

For a ₹1,000 bill with ₹0 already paid, enter ₹1,500 through the bill payment modal. The system saves:

- `amountPaid: 1500`
- `amountDue: -500`
- payment entry: ₹1,500

### Business impact

Ledger credit is overstated and the next calculations cannot distinguish a genuine advance from a mistaken excess payment.

### Recommended fix

Reject payment when `cashAmount > amountDue` (with a small rounding tolerance), or explicitly support customer advances as a separate, labelled transaction. Use a Firestore transaction so two users cannot both pay the final pending amount at the same time.

---

## 5. Ledger selected-bill payment can record unapplied surplus credit

**Severity:** High  
**Area:** Ledger payment  
**Evidence:** `js/features/ledger.js`, lines 585–651

### What happens

The full `totalCredit` is first stored in the `payments` collection. The later bill-allocation loop caps each bill allocation with `Math.min(remainingCredit, amountOwedOnBill)`. If payment exceeds the total selected due, `remainingCredit` is left over, but there is no advance-payment record or warning.

### Example

1. Select bills with combined due ₹1,000.
2. Enter cash/deduction credit of ₹1,500.
3. Payment document stores `totalCredit: 1500` and is linked to those bills.
4. Only ₹1,000 can be added to their `amountPaid` fields.
5. The extra ₹500 is neither applied to a bill nor explicitly classified as advance.

### Business impact

Payment history says ₹1,500 was paid against selected bills but bill records show only ₹1,000. This causes audit and customer-balance confusion.

### Recommended fix

Before saving, calculate selected bills’ total current due. Either:

- do not allow a payment above that total; or
- create a separate `advance`/`unallocatedCredit` field and display it clearly in the ledger.

Create the payment record and bill updates in one Firestore transaction or a retry-safe server function.

---

## 6. Deleting one bill asks for confirmation twice

**Severity:** Medium  
**Area:** Bill list / soft delete UX  
**Evidence:**

- `js/features/bill-list.js`, lines 289–321: `deleteBill()` asks “Are you sure?”.
- `js/features/backup.js`, lines 7–46: `softDeleteBill()` asks again before setting `deleted: true`.

### What happens

When backup functionality is loaded (as on the bills screen), `deleteBill()` calls `softDeleteBill()`. Both functions present a confirmation modal.

### User impact

Users must confirm the same delete action twice. This looks like a bug and slows routine billing work.

### Recommended fix

Keep the confirmation in only one function. A clean design is to let `deleteBill()` handle confirmation and make `softDeleteBill(docId)` perform only the update, or pass an explicit `alreadyConfirmed` option.

---

## 7. WhatsApp message construction has a `NaN` defect and duplicate function definitions

**Severity:** Medium  
**Area:** Billing automation  
**Evidence:** `js/features/bill-form.js`, around lines 1126–1180 and 1395–1434

### What happens

`checkAndSendWhatsApp` is declared twice. Both message builders contain this pattern:

```js
`... welcome ...` +
+`📋 *Bill No:* ...`
```

The second `+` is a unary-plus operation on a string. JavaScript converts that string to `NaN`, so message output can contain `NaN` where the Bill No section should be. The later function declaration replaces the earlier one, making maintenance and expected behavior confusing.

There is also no call to `checkAndSendWhatsApp(data)` in the bill-save success flow visible in this code path, so enabling auto-send may not actually trigger automation.

### User impact

WhatsApp messages may be malformed or auto-send may not run at all.

### Recommended fix

- Keep one `checkAndSendWhatsApp` implementation.
- Remove the unary `+`.
- Build message fields from the actual saved data names (for example `Serial No`, `Final Total`).
- Call it deliberately after a successful save, preferably before navigating away or from the final-bill page after a user gesture; browsers may block popups opened outside a click event.

---

## 8. User data is inserted into HTML without escaping (stored XSS risk)

**Severity:** Medium  
**Area:** Party master, bill list, bill detail, autocomplete  
**Evidence:**

- `js/features/party-master.js`, lines 216 onward: party `name`, address, phone, etc. are inserted using template-string `innerHTML`.
- `js/features/bill-list.js`, lines 228 onward: bill customer name and serial fields are inserted with `row.innerHTML`.
- `js/features/bill-view.js`, lines 544–565: remarks and expense names are inserted into `innerHTML`.
- `js/features/bill-form.js`, autocomplete sections around lines 134–140 and 1573–1579: party data is written into HTML.

### What happens

If a stored value contains HTML such as an image tag with an event handler, the browser treats it as markup when rendered. It is not displayed as plain text.

### Why this is more serious here

Because Firestore currently permits unrestricted writes (Finding 1), an external attacker could inject that value directly into a party/bill document and it would execute for a staff user who opens the relevant page.

### Recommended fix

- Use `textContent` for all plain values.
- When a HTML template is required, escape every dynamic value with a tested `escapeHtml()` helper before interpolation.
- Avoid dynamic inline `onclick` handlers; attach listeners with `addEventListener` and keep IDs/data attributes safely encoded.
- After fixing Firestore rules, sanitize/inspect existing stored records for unexpected markup.

---

## Recommended remediation order

1. **Immediately secure Firestore rules** and deploy tested authenticated/role-based access control.
2. **Choose one balance document and one source of truth**; repair existing cached balances from live bill/payment records.
3. **Fix payment validation and atomicity** to stop overpayment/unallocated-credit errors.
4. **Reconcile edit/delete/restore flows** for balances, linked orders and broker summaries.
5. **Fix WhatsApp function** and test a real message using a test bill.
6. **Remove duplicate delete confirmation**.
7. **Replace unsafe `innerHTML` rendering** for user-controlled fields.

## Regression test checklist after fixes

- Unauthenticated user cannot read/write Firestore data.
- Authenticated non-admin cannot manipulate counters, deleted flags, or another user’s data.
- New bill, partial payment, full payment, edit, delete and restore all result in the same party balance as the ledger’s live calculation.
- A ₹1,000 bill cannot receive ₹1,001 unless it is saved as an explicit advance credit.
- Ledger payment above selected due is blocked or saved transparently as an advance.
- Partially delivered order stays `Partial`; completed order changes only when actual delivered quantity meets ordered quantity or user confirms override.
- Bill delete has one confirmation only.
- WhatsApp message contains bill number, item, weight, rate and amount; it never contains `NaN`.
- A party name/remark containing `<script>` or HTML is displayed as text, never executed.

