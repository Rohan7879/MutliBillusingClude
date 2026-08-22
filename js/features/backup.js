/**
 * @file backup.js
 * @description Soft delete, restore, and Excel backup for MandiBook
 */

// ── SOFT DELETE ───────────────────────────────────────────────────────────────
async function softDeleteBill(docId) {
  try {
    const billRef = billsCollection.doc(docId);
    const billDoc = await billRef.get();
    if (!billDoc.exists || billDoc.data().deleted === true) return false;
    const bill = billDoc.data();
    const hasRecordedPayment =
      Number(bill.amountPaid || 0) > 0 || ["Paid", "Partial", "Partially Paid"].includes(bill.paymentStatus);
    if (bill.locked === true || bill.workflowStatus === "locked") {
      Swal.fire({
        icon: "warning",
        title: "Delete blocked",
        text: "This bill is locked as a final accounting record. Create a correction bill if a change is needed.",
      });
      return false;
    }
    if (hasRecordedPayment) {
      Swal.fire({
        icon: "warning",
        title: "Delete blocked",
        text: "A partially or fully paid bill cannot be deleted because it has payment and audit records.",
      });
      return false;
    }

    // 🔒 ATOMIC — the bill's "deleted" flag and the party's balance
    // reversal now happen in one transaction, exactly like the
    // payment/bill fixes elsewhere. Previously these were two separate
    // awaited steps: if the delete succeeded but the balance step then
    // failed, the whole function's catch block fired and told the user
    // "Could not delete" — even though the bill WAS already deleted. That
    // mismatch is now structurally impossible; either both happen or
    // neither does, so the message shown always matches reality.
    const partyRef = bill.customerId ? db.collection("parties").doc(bill.customerId) : null;
    await db.runTransaction(async (transaction) => {
      const partyDoc = partyRef ? await transaction.get(partyRef) : null;
      transaction.update(billRef, { deleted: true, deletedAt: Date.now() });
      if (partyRef && partyDoc && partyDoc.exists) {
        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, {
          currentBalance: roundCurrency(currentBalance - Number(bill["Final Total"] || 0)),
          lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    await recordAudit("bill.deleted", "bill", docId, {
      before: billAuditSnapshot(bill),
      after: billAuditSnapshot({ ...bill, deleted: true }),
      reason: "Soft delete",
    });
    Swal.fire({
      icon: "success",
      title: "Bill deleted!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
    return true;
  } catch (e) {
    console.error(e);
    // Now that delete + balance are one atomic step, this catch means the
    // delete genuinely did NOT happen — the message is accurate.
    Swal.fire({
      icon: "error",
      title: "Could not delete.",
      text: "Nothing was changed — please try again.",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2500,
    });
    return false;
  }
}

async function restoreBill(docId) {
  try {
    if (typeof hasRole === "function" && !hasRole("admin")) {
      Swal.fire({
        icon: "info",
        title: "Admin approval required",
        text: "Only an Admin can restore an archived bill because it changes accounting records.",
      });
      return false;
    }
    const billRef = billsCollection.doc(docId);
    const billDoc = await billRef.get();
    if (!billDoc.exists || billDoc.data().deleted !== true) return false;
    const bill = billDoc.data();

    // 🔒 ATOMIC — same fix as delete, mirrored for restore.
    const partyRef = bill.customerId ? db.collection("parties").doc(bill.customerId) : null;
    await db.runTransaction(async (transaction) => {
      const partyDoc = partyRef ? await transaction.get(partyRef) : null;
      transaction.update(billRef, { deleted: false, deletedAt: null });
      if (partyRef && partyDoc && partyDoc.exists) {
        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, {
          currentBalance: roundCurrency(currentBalance + Number(bill["Final Total"] || 0)),
          lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    await recordAudit("bill.restored", "bill", docId, {
      before: billAuditSnapshot(bill),
      after: billAuditSnapshot({ ...bill, deleted: false }),
      reason: "Restore from archive",
    });
    Swal.fire({
      icon: "success",
      title: "✅ Bill Restored!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
    return true;
  } catch (e) {
    console.error(e);
    Swal.fire({
      icon: "error",
      title: "Could not restore.",
      text: "Nothing was changed — please try again.",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2500,
    });
    return false;
  }
}

// Wired from the deleted-bills list's Restore button. Previously this
// called restoreBill(id) WITHOUT awaiting it and closed the list modal
// immediately regardless — so if restore failed, the modal was already
// gone and the user had no idea. Now it waits for the real result before
// deciding whether to close.
async function restoreBillAndClose(docId) {
  const ok = await restoreBill(docId);
  if (ok) Swal.close();
}
window.restoreBillAndClose = restoreBillAndClose;

async function showDeletedBills() {
  showLoading();
  try {
    // Sort client-side instead of .orderBy("deletedAt") — chaining
    // where(deleted==true) with orderBy on a DIFFERENT field requires a
    // Firestore composite index that was never created, which made this
    // silently fail (caught below, nothing shown). A plain where() needs
    // no extra index.
    const snap = await billsCollection.where("deleted", "==", true).get();
    if (snap.empty) {
      Swal.fire({ icon: "info", title: "No deleted bills found.", confirmButtonColor: "#005a9e" });
      return;
    }
    const sortedDocs = snap.docs.slice().sort((a, b) => (b.data().deletedAt || 0) - (a.data().deletedAt || 0));
    const rows = sortedDocs
      .map((d) => {
        const b = d.data();
        const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - b.deletedAt) / 86400000));
        return `<tr>
        <td>${b["Serial No"]}</td>
        <td>${b["Date"]}</td>
        <td>${b["Customer Name"]}</td>
        <td>₹${Number(b["Final Total"]).toLocaleString("en-IN")}</td>
        <td>${daysLeft} days</td>
        <td><button onclick="restoreBillAndClose('${d.id}')" 
          style="padding:6px 12px;background:#28a745;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;">
          ↩️ Restore</button></td>
      </tr>`;
      })
      .join("");

    Swal.fire({
      title: "🗑️ Deleted Bills",
      html: `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:#005a9e;color:#fff;">
          <th style="padding:8px;">Bill No</th><th>Date</th><th>Name</th>
          <th>Total</th><th>Restore within</th><th>Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`,
      width: "800px",
      confirmButtonText: "Close",
      confirmButtonColor: "#005a9e",
    });
  } catch (e) {
    console.error(e);
    Swal.fire({
      icon: "error",
      title: "Could not load deleted bills.",
      text: e.message || "Please try again.",
      confirmButtonColor: "#005a9e",
    });
  } finally {
    hideLoading();
  }
}

// ── AUTO EXCEL BACKUP ─────────────────────────────────────────────────────────
async function downloadExcelBackup() {
  showLoading();
  try {
    // Fetch all and filter client-side — Firestore's where("deleted","!=",true)
    // silently EXCLUDES documents that don't have a "deleted" field at all,
    // which was wrongly dropping every bill saved before this feature
    // existed out of the backup.
    const snap = await billsCollection.orderBy("Date", "desc").get();
    const rows = snap.docs
      .filter((d) => d.data().deleted !== true)
      .map((d) => {
        const b = d.data();
        return {
          "Bill No": b["Serial No"] || "",
          Date: b["Date"] || "",
          "Customer Name": b["Customer Name"] || "",
          Village: b["Village"] || "",
          "Vehicle No": b["Vehicle No"] || "",
          Broker: b["Broker"] || "",
          Product: b["ProductTemplate"] || "",
          "Bill Type": b["Bill Type"] || "",
          Weighbridge: b["Weighbridge Weight"] || 0,
          "Net Weight": b["Net Weight"] || 0,
          "Total Amount": b["Total Amount"] || 0,
          Utrai: b["Utrāī"] || 0,
          Freight: b["Truck Freight"] || 0,
          "Final Total": b["Final Total"] || 0,
          "Broker Commission": b["BrokerCommission"] || 0,
          "Payment Status": b["paymentStatus"] || "Unpaid",
          "Amount Paid": b["amountPaid"] || 0,
          Remarks: b["Remarks"] || "",
        };
      });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Bills");

    const now = new Date();
    const fname = `MandiBook_Backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}.xlsx`;
    XLSX.writeFile(wb, fname);

    Swal.fire({ icon: "success", title: "✅ Backup Downloaded!", text: fname, confirmButtonColor: "#005a9e" });
  } catch (e) {
    console.error(e);
    Swal.fire({
      icon: "error",
      title: "Backup failed!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
  } finally {
    hideLoading();
  }
}

// ── FIRESTORE RULES REMINDER ──────────────────────────────────────────────────
// Soft-deleted bills are filtered by adding where("deleted","!=",true) to queries
// Make sure bill-list.js and dashboard.js filter these out

window.softDeleteBill = softDeleteBill;
window.restoreBill = restoreBill;
window.showDeletedBills = showDeletedBills;
window.downloadExcelBackup = downloadExcelBackup;
