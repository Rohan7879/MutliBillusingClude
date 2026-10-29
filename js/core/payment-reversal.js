// Append-only correction: original payment, reversal, bill and party stay traceable.
(function (global) {
  "use strict";
  const cents = value => Math.round(value * 100);
  function validate(payment) {
    if (payment.reversalOf) throw new Error("A reversal cannot itself be reversed.");
    const { cashAmount, deductionAmount = 0, totalCredit } = payment;
    if (![cashAmount, deductionAmount, totalCredit].every(Number.isFinite)
        || cashAmount < 0 || deductionAmount < 0 || totalCredit <= 0
        || cents(cashAmount) + cents(deductionAmount) !== cents(totalCredit)) {
      throw new Error("Payment amounts need review before correction.");
    }
    const ids = payment.appliedToBills || [];
    if (!Array.isArray(ids) || ids.length > 1) {
      throw new Error("This payment covers multiple bills without saved per-bill allocations. It needs a reviewed correction.");
    }
    if (ids.some(id => typeof id !== "string" || !id || id.includes("/"))) throw new Error("Invalid bill link.");
    return ids;
  }
  async function reverse({ db, paymentId, reason, uid, timestamp }) {
    if (!uid || typeof paymentId !== "string" || !paymentId || paymentId.includes("/")) throw new Error("Sign in and select a valid payment.");
    reason = String(reason || "").trim();
    if (reason.length < 3 || reason.length > 500) throw new Error("Enter a correction reason (3–500 characters).");
    const originalRef = db.collection("payments").doc(paymentId);
    const reversalId = `reversal_${paymentId}`;
    const reversalRef = db.collection("payments").doc(reversalId);
    return db.runTransaction(async tx => {
      const original = await tx.get(originalRef);
      const existing = await tx.get(reversalRef);
      if (!original.exists) throw new Error("Payment not found.");
      if (existing.exists) return { alreadyReversed: true };
      const payment = original.data();
      const ids = validate(payment);
      const profile = await tx.get(db.collection("users").doc(uid));
      if (!profile.exists || profile.data().status !== "active" || !["admin", "accountant"].includes(profile.data().role)) {
        throw new Error("Only an active Admin or Accountant can reverse payments.");
      }
      const billRef = ids.length ? db.collection("bills").doc(ids[0]) : null;
      const billDoc = billRef ? await tx.get(billRef) : null;
      const partyRef = payment.customerId ? db.collection("parties").doc(payment.customerId) : null;
      const partyDoc = partyRef ? await tx.get(partyRef) : null;
      if (partyRef && !partyDoc.exists) throw new Error("Linked party is missing. Review the payment before correcting it.");
      const total = cents(payment.totalCredit);
      let billUpdate = null, bill = null;
      if (billRef) {
        if (!billDoc.exists) throw new Error("Linked bill is missing.");
        bill = billDoc.data();
        if (bill.deleted || bill.locked || bill.workflowStatus === "locked") throw new Error("Archived or locked bills need a reviewed correction.");
        if ((bill.customerId || null) !== (payment.customerId || null)
            || (!payment.customerId && (bill["Customer Name"] !== payment.customerName
              || (bill.Village || "N/A") !== (payment.customerVillage || "N/A")))) {
          throw new Error("Bill and payment party links do not match.");
        }
        if (![bill.amountPaid, bill["Final Total"]].every(Number.isFinite)
            || cents(bill.amountPaid) < total || bill.amountPaid > bill["Final Total"]) {
          throw new Error("Bill paid amount does not match this correction. Refresh and review the payment history.");
        }
        const paid = cents(bill.amountPaid) - total;
        const due = cents(bill["Final Total"]) - paid;
        billUpdate = { amountPaid: paid / 100, amountDue: due / 100,
          paymentStatus: due <= 1 ? "Paid" : paid > 0 ? "Partial" : "Unpaid", lastUpdatedAt: timestamp() };
      }
      const balance = partyDoc ? partyDoc.data().currentBalance : null;
      if (partyDoc && !Number.isFinite(balance)) throw new Error("Party balance needs review.");
      const reversal = {
        reversalOf: paymentId, customerId: payment.customerId || null,
        customerName: payment.customerName || "", customerVillage: payment.customerVillage || "N/A",
        cashAmount: -payment.cashAmount, deductionAmount: -(payment.deductionAmount || 0),
        totalCredit: -payment.totalCredit, paymentMethod: payment.paymentMethod || "Cash",
        appliedToBills: ids, reason, paymentDate: timestamp(), createdAt: timestamp(), createdBy: uid,
      };
      const staff = profile.data();
      tx.set(reversalRef, reversal);
      if (billRef) tx.update(billRef, billUpdate);
      if (partyRef) tx.update(partyRef, { currentBalance: (cents(balance) + total) / 100, lastUpdatedAt: timestamp() });
      tx.set(db.collection("auditLogs").doc(reversalId), {
        action: "payment.reversed", entityType: "payment", entityId: paymentId,
        before: { totalCredit: payment.totalCredit }, after: { reversalId, totalCredit: reversal.totalCredit },
        reason, actor: { uid, email: staff.email || "", displayName: staff.displayName || "", role: staff.role },
        createdAt: timestamp(),
      });
      return { alreadyReversed: false, amount: payment.totalCredit, orderId: bill?.LinkedOrderId || "",
        billSerial: bill?.["Serial No"] || "", amountDue: billUpdate?.amountDue };
    });
  }
  global.MandiPaymentReversal = Object.freeze({ validate, reverse });
  if (typeof module !== "undefined") module.exports = global.MandiPaymentReversal;
})(typeof window !== "undefined" ? window : globalThis);
