/* Requires financial-year.js. No balance snapshots or party balance writes.
 * SECURITY CONTRACT: deployed rules must deny ALL financial writes while
 * accountingControl.maintenance is true (including admin/import/delete paths).
 * Only the owning admin/token may release the gate. Final cutoff and event
 * must be committed together; yearCloseEvents are create-only. No auto-expiry.
 */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./financial-year.js") : root.MandiFinancialYear);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MandiYearClose = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (FY) {
  "use strict";
  const collections = ["parties", "bills", "payments", "broker_payments"];
  const norm = value => String(value || "").trim().toLowerCase();
  const active = row => row.deleted !== true;
  function date(value) {
    try { return FY.dateKey(value?.toDate ? value.toDate() : value); } catch (_) { return null; }
  }
  const key = value => Number(value.replaceAll("-", ""));
  function amount(value, optional = false) {
    if (optional && value == null) return 0;
    if (!(["number", "string"].includes(typeof value)) || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("Malformed amount");
    return FY.toCents(value);
  }
  function cutoff(control = {}) {
    const value = control.closedThrough ?? 0;
    if (value !== 0 && (!Number.isInteger(value) || !/^\d{4}0331$/.test(String(value)))) throw new Error("Invalid existing cutoff; administrator review required.");
    return value;
  }
  function target(fyId, action, today = new Date()) {
    const bounds = FY.boundaries(fyId);
    if (action === "close") {
      if (bounds.end >= FY.dateKey(today)) throw new Error("Only a completed financial year can be closed (after March 31).");
      return key(bounds.end);
    }
    if (action !== "reopen") throw new Error("Unknown action.");
    return Number(bounds.start.slice(0, 4) + "0331");
  }
  function preview(data, fyId, today = new Date()) {
    const bounds = FY.boundaries(fyId), issues = [], transactions = [], partyRows = [], brokerRows = [];
    const end = key(bounds.end), start = key(bounds.start);
    const report = (collection, row, message) => issues.push({ collection, id: row.id || "(missing ID)", message });
    const parties = (data.parties || []).filter(active);
    const resolve = (id, name, broker = false) => {
      if (broker) return FY.resolveBroker(parties, id, name);
      const candidates = parties.filter(p => (norm(p.type) === "broker") === broker && (id ? p.id === id : norm(p.name) === norm(name)));
      return candidates.length === 1 && (id || norm(name)) ? candidates[0] : null;
    };
    const partyTx = new Map(), brokerTx = new Map();
    parties.forEach(p => {
      if (!p.id || !norm(p.name)) report("parties", p, "Missing party identity.");
      try {
        if (amount(p.opBal, true) < 0) throw new Error("Opening amount must be nonnegative; use Dr/Cr.");
        FY.partyOpeningCents(p);
      } catch (e) { report("parties", p, e.message); }
    });
    const push = (map, party, d, debit, credit) => {
      if (!party) return;
      if (!map.has(party.id)) map.set(party.id, []);
      map.get(party.id).push({ date: d, debit: debit / 100, credit: credit / 100 });
    };
    function inspect(collection, row, rawDate, callback) {
      if (!row.id) report(collection, row, "Missing record identity.");
      const d = date(rawDate);
      if (!d) { report(collection, row, "Malformed or missing accounting date."); return; }
      transactions.push({ date: d });
      // All historical rows are read, not just the selected or previous year.
      if (key(d) > end) return;
      try { callback(d); } catch (e) { report(collection, row, e.message); }
    }
    const bills = (data.bills || []).filter(active), payments = (data.payments || []).filter(active);
    const billById = new Map(bills.map(b => [b.id, b]));
    const linkedBills = new Set(payments.flatMap(p => Array.isArray(p.appliedToBills) ? p.appliedToBills : []));
    bills.forEach(b => inspect("bills", b, b.Date ?? b.date ?? b.billDate, d => {
      const workflow = norm(b.workflowStatus || (b.locked ? "locked" : "draft"));
      if (!["approved", "locked"].includes(workflow) || b.pendingRevision || b.revisionPending || b.pendingRevisionId || norm(b.revisionStatus) === "pending") report("bills", b, "Draft or pending revision must be resolved before close.");
      const total = amount(b["Final Total"] ?? b.total ?? b.amount);
      if (total < 0) throw new Error("Negative bill amount needs review.");
      const party = resolve(b.customerId, b["Customer Name"] || b.customerName);
      if (!party) report("bills", b, "Missing, unmatched or ambiguous customer identity.");
      push(partyTx, party, d, total, 0);
      const paid = amount(b.amountPaid, true);
      if (paid < 0 || paid > total) report("bills", b, "Invalid bill paid amount.");
      if (paid && !linkedBills.has(b.id)) {
        // Show the legacy ledger credit, but never certify its undated payment.
        push(partyTx, party, d, 0, paid);
        report("bills", b, "Embedded paid amount has no dated payment record; review before closing.");
      }
      const commission = amount(b.BrokerCommission, true);
      if (commission < 0) throw new Error("Negative broker commission needs review.");
      if (commission) {
        const broker = resolve(b.brokerId, b.Broker, true);
        if (!broker) report("bills", b, "Commission has no unique broker party identity.");
        push(brokerTx, broker, d, commission, 0);
      }
    }));
    payments.forEach(p => inspect("payments", p, p.paymentDate ?? p.date ?? p.createdAt, d => {
      const cash = amount(p.cashAmount), deduction = amount(p.deductionAmount, true), credit = amount(p.totalCredit);
      if (cash + deduction !== credit || (!p.reversalOf && (cash < 0 || deduction < 0 || credit <= 0))) throw new Error("Payment amounts do not reconcile.");
      const party = resolve(p.customerId, p.customerName);
      if (!party) report("payments", p, "Missing, unmatched or ambiguous customer identity.");
      const links = p.appliedToBills;
      if (!Array.isArray(links) || !links.length) report("payments", p, "Unallocated payment requires review before closing.");
      else if (new Set(links).size !== links.length || links.some(id => {
        const bill = billById.get(id);
        return !bill || resolve(bill.customerId, bill["Customer Name"] || bill.customerName)?.id !== party?.id || !date(bill.Date ?? bill.date ?? bill.billDate) || date(bill.Date ?? bill.date ?? bill.billDate) > d;
      })) report("payments", p, "Payment allocation is missing, duplicated, predates bill or belongs to another party.");
      if (p.reversalOf) {
        const original = payments.find(row => row.id === p.reversalOf);
        if (!original || original.reversalOf || amount(original.totalCredit) !== -credit || amount(original.cashAmount) !== -cash || amount(original.deductionAmount, true) !== -deduction || resolve(original.customerId, original.customerName)?.id !== party?.id || payments.filter(row => row.reversalOf === p.reversalOf).length !== 1 || !date(original.paymentDate ?? original.date ?? original.createdAt) || date(original.paymentDate ?? original.date ?? original.createdAt) > d) report("payments", p, "Invalid or unmatched payment reversal.");
      }
      push(partyTx, party, d, 0, credit);
    }));
    (data.broker_payments || []).filter(active).forEach(p => inspect("broker_payments", p, p.date, d => {
      const paid = amount(p.amount);
      if (paid <= 0) throw new Error("Broker payout must be positive.");
      const broker = resolve(p.brokerId, p.brokerName, true);
      if (!broker) report("broker_payments", p, "Payout has no unique broker party identity.");
      push(brokerTx, broker, d, 0, paid);
    }));
    parties.forEach(p => {
      const broker = norm(p.type) === "broker";
      try {
        // Customer Dr is receivable; broker Cr is payable, so invert for payable view.
        const summary = FY.summarize((broker ? brokerTx : partyTx).get(p.id) || [], { fyId, initialOpeningCents: FY.partyOpeningCents(p) * (broker ? -1 : 1) });
        const { rows, ...totals } = summary;
        (broker ? brokerRows : partyRows).push({ id: p.id, name: p.name || "Unnamed party", ...totals });
      } catch (e) { report("parties", p, e.message); }
    });
    const current = FY.financialYearId(today);
    return { fyId, start: bounds.start, end: bounds.end, cutoff: end, issues, parties: partyRows, brokers: brokerRows,
      years: FY.availableYears(transactions, today).filter(id => id <= current), canClose: !issues.length && bounds.end < FY.dateKey(today),
      note: "Derived preview, not a snapshot certificate. Initial opening plus all historical rows before April 1. No balances are written." };
  }
  async function readRecords(db) {
    const snapshots = await Promise.all(collections.map(name => db.collection(name).get({ source: "server" })));
    if (snapshots.some(s => s.metadata?.fromCache || s.metadata?.hasPendingWrites)) throw new Error("Server-confirmed records required; pending/offline data cannot close a year.");
    return Object.fromEntries(collections.map((name, i) => [name, snapshots[i].docs.map(doc => ({ ...doc.data(), id: doc.id }))]));
  }
  function client({ db, uid, timestamp, removeField }) {
    const ref = db.collection("settings").doc("accountingControl");
    async function admin(tx) {
      const user = await tx.get(db.collection("users").doc(uid));
      if (!user.exists || user.data().status !== "active" || user.data().role !== "admin") throw new Error("Only an active administrator can change year locks.");
    }
    async function release(token) {
      return db.runTransaction(async tx => {
        await admin(tx);
        const snap = await tx.get(ref), control = snap.exists ? snap.data() : {};
        if (!control.maintenance || control.maintenanceToken !== token || control.maintenanceOwner !== uid) return false;
        tx.update(ref, { maintenance: false, maintenanceToken: removeField(), maintenanceOwner: removeField(), maintenanceStartedAt: removeField() });
        return true;
      });
    }
    async function change({ fyId, action, reason, expectedCutoff, today = new Date() }) {
      reason = String(reason || "").trim();
      if (reason.length < 10 || reason.length > 1000) throw new Error("Enter a reason of 10–1000 characters.");
      const next = target(fyId, action, today);
      if (action === "close" ? next <= expectedCutoff : next >= expectedCutoff) throw new Error("Selected action does not change the cutoff in the required direction.");
      const event = db.collection("yearCloseEvents").doc(), token = event.id;
      try {
        await db.runTransaction(async tx => {
          await admin(tx);
          const snap = await tx.get(ref), control = snap.exists ? snap.data() : {};
          if (cutoff(control) !== expectedCutoff) throw new Error("Cutoff changed since preview. Refresh and review again.");
          if (control.maintenance) throw new Error("Another preparation is active. Do not bypass its maintenance gate.");
          tx.set(ref, { closedThrough: expectedCutoff, maintenance: true, maintenanceToken: token, maintenanceOwner: uid, maintenanceStartedAt: timestamp() }, { merge: true });
        });
        // These sequential server-confirmed reads are consistent only because the
        // rules-enforced maintenance gate has already committed. SDK cache is forbidden.
        const prepared = preview(await readRecords(db), fyId, today);
        if (action === "close" && !prepared.canClose) {
          const error = new Error(`Close blocked by ${prepared.issues.length} validation issue(s). Refresh the preview to review them.`);
          error.issues = prepared.issues; throw error;
        }
        await db.runTransaction(async tx => {
          await admin(tx);
          const snap = await tx.get(ref), existing = await tx.get(event), control = snap.exists ? snap.data() : {};
          if (existing.exists || !control.maintenance || control.maintenanceOwner !== uid || control.maintenanceToken !== token || cutoff(control) !== expectedCutoff) throw new Error("Preparation ownership or cutoff changed. Nothing finalized.");
          tx.set(ref, { closedThrough: next, reason, updatedAt: timestamp(), updatedBy: uid, eventId: token,
            maintenance: false, maintenanceToken: removeField(), maintenanceOwner: removeField(), maintenanceStartedAt: removeField() }, { merge: true });
          tx.set(event, { closedThrough: next, previousClosedThrough: expectedCutoff, reason, actorId: uid, createdAt: timestamp() });
        });
        return { eventId: token, closedThrough: next, preview: prepared };
      } catch (error) {
        try { await release(token); } catch (_) { error.message += " Maintenance release could not be confirmed. Refresh; the owning admin must release the interrupted preparation before financial work resumes."; }
        throw error;
      }
    }
    return { change, release };
  }
  return Object.freeze({ preview, target, cutoff, readRecords, client });
});
