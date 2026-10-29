/* Revisions retain one bill identity. Snapshots and approvals are append-only. */
(function (root) {
  "use strict";
  function sameVersion(a, b) {
    const clean = value => {
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, clean(value[key])]));
      return value;
    };
    const reviewed = { ...b };
    // final.html adds the Firestore document ID for navigation, not as bill data.
    if (!Object.prototype.hasOwnProperty.call(a, "id")) delete reviewed.id;
    return JSON.stringify(clean(JSON.parse(JSON.stringify(a)))) === JSON.stringify(clean(JSON.parse(JSON.stringify(reviewed))));
  }
  function client(db, uid, stamp) {
    async function request(billId, reason, reviewed) {
      reason = String(reason || "").trim();
      if (reason.length < 10 || reason.length > 1000) throw new Error("Enter a correction reason of 10–1000 characters.");
      const ref = db.collection("bills").doc(billId);
      return db.runTransaction(async tx => {
        const doc = await tx.get(ref);
        if (!doc.exists) throw new Error("Bill not found.");
        const bill = doc.data();
        if (root.MandiFinancialYear) await root.MandiFinancialYear.assertPostingOpen(db, tx, [bill.Date]);
        if (!sameVersion(bill, reviewed)) throw new Error("Bill changed. Reload and review it again.");
        if (bill.deleted || bill.locked || bill.workflowStatus !== "approved") throw new Error("Only an active, unlocked Approved bill can enter revision.");
        const number = (bill.revisionNumber || 0) + 1;
        const snapshotRef = db.collection("billRevisions").doc(`${billId}_r${number}`);
        if ((await tx.get(snapshotRef)).exists) throw new Error("Revision already exists. Reload the bill.");
        tx.set(snapshotRef, { billId, revisionNumber: number, snapshot: bill, reason, createdBy: uid, createdAt: stamp() });
        tx.update(ref, { workflowStatus: "draft", revisionPending: true, revisionNumber: number,
          revisionSnapshotId: snapshotRef.id, revisionReason: reason, revisionRequestedBy: uid,
          revisionRequestedAt: stamp(), lastUpdatedAt: stamp() });
        return snapshotRef.id;
      });
    }
    async function approve(billId, reviewed) {
      const ref = db.collection("bills").doc(billId);
      const auditRef = db.collection("auditLogs").doc();
      return db.runTransaction(async tx => {
        const doc = await tx.get(ref);
        const staff = await tx.get(db.collection("users").doc(uid));
        if (!staff.exists || staff.data().status !== "active" || !["admin", "manager"].includes(staff.data().role)) throw new Error("Only an active Admin or Manager can approve bills.");
        if (!doc.exists) throw new Error("Bill not found.");
        const bill = doc.data();
        if (root.MandiFinancialYear) await root.MandiFinancialYear.assertPostingOpen(db, tx, [bill.Date]);
        if (!sameVersion(bill, reviewed)) throw new Error("Bill changed after review. Reload and review again.");
        if (bill.deleted || bill.locked || (bill.workflowStatus || "draft") !== "draft") throw new Error("Only an active Draft can be approved.");
        const update = { workflowStatus: "approved", approvedBy: uid, approvedAt: stamp(), lastUpdatedAt: stamp() };
        if (bill.revisionPending) {
          const history = db.collection("billRevisionApprovals").doc(bill.revisionSnapshotId);
          if ((await tx.get(history)).exists) throw new Error("Revision already approved.");
          tx.set(history, { billId, revisionNumber: bill.revisionNumber, snapshot: bill, approvedBy: uid, approvedAt: stamp() });
          update.revisionPending = false;
        }
        tx.update(ref, update);
        const profile = staff.data();
        tx.set(auditRef, { action: "bill.approved", entityType: "bill", entityId: billId,
          before: { workflowStatus: "draft", revisionNumber: bill.revisionNumber || 0 },
          after: { workflowStatus: "approved", revisionNumber: bill.revisionNumber || 0 },
          reason: bill.revisionPending ? `Re-approved: ${bill.revisionReason}` : "Bill reviewed and approved",
          actor: { uid, email: profile.email || "", displayName: profile.displayName || "", role: profile.role }, createdAt: stamp() });
      });
    }
    return { request, approve };
  }
  const api = { client, sameVersion };
  root.MandiBillRevision = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
