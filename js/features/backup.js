/**
 * @file backup.js
 * @description Soft delete, restore, and Excel backup for MandiBook
 */

// Archive/restore, party balance and audit evidence commit together.
function archiveAudit(action, id, before, after) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Sign in before changing archive records.");
  return { action, entityType: "bill", entityId: id, before: billAuditSnapshot(before), after: billAuditSnapshot(after),
    reason: action === "bill.deleted" ? "Soft archive" : "Restore from archive",
    actor: { uid: user.uid, email: user.email || "", displayName: window.currentUserProfile?.displayName || user.displayName || "", role: window.currentUserProfile?.role || "unknown" },
    createdAt: firebase.firestore.FieldValue.serverTimestamp() };
}
async function changeBillArchive(docId, restore) {
  if (restore && !hasRole("admin")) throw new Error("Only an Admin can restore an archived accounting record.");
  const billRef = billsCollection.doc(docId), auditRef = db.collection("auditLogs").doc();
  return db.runTransaction(async transaction => {
    // Read the bill INSIDE the transaction: double-clicks/retries cannot
    // subtract/add a balance twice using an old pre-transaction snapshot.
    const snapshot = await transaction.get(billRef);
    if (!snapshot.exists) return false;
    const bill = snapshot.data();
    if (restore ? bill.deleted !== true : bill.deleted === true) return false;
    if (!restore && (bill.locked === true || bill.workflowStatus === "locked")) throw new Error("Locked bills cannot be archived. Use an owner-approved correction.");
    const paid = Number(bill.amountPaid ?? 0);
    if (!Number.isFinite(paid) || paid < 0) throw new Error("Recorded payment amount is invalid. Nothing was changed.");
    if (paid > 0 || ["paid", "partial", "partially paid"].includes(String(bill.paymentStatus || "").toLowerCase())) throw new Error("Bills with payment evidence need owner-led reconciliation, not archive/restore.");
    const total = Number(bill["Final Total"]);
    if (!Number.isFinite(total) || total < 0) throw new Error("Bill total is invalid. Review the record before changing its archive status.");
    const partyRef = bill.customerId ? db.collection("parties").doc(bill.customerId) : null;
    const party = partyRef ? await transaction.get(partyRef) : null;
    if (partyRef && !party.exists) throw new Error("Linked party is missing. No records changed; review the bill's customer link.");
    const balance = party?.exists ? Number(party.data().currentBalance ?? 0) : 0;
    if (!Number.isFinite(balance)) throw new Error("Party balance is invalid. Nothing was changed.");
    const fields = { deleted: !restore, deletedAt: restore ? null : firebase.firestore.FieldValue.serverTimestamp() };
    transaction.update(billRef, fields);
    if (partyRef) transaction.update(partyRef, { currentBalance: roundCurrency(balance + (restore ? total : -total)), lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    transaction.set(auditRef, archiveAudit(restore ? "bill.restored" : "bill.deleted", docId, bill, { ...bill, ...fields }));
    return true;
  });
}
async function softDeleteBill(docId) {
  try {
    const changed = await changeBillArchive(docId, false);
    if (changed) Swal.fire({ icon: "success", title: "Bill archived", text: "The bill, balance adjustment and audit record were committed together.", timer: 2000, showConfirmButton: false });
    return changed;
  } catch (error) { Swal.fire({ icon: "error", title: "Archive did not complete", text: error.message }); return false; }
}
async function restoreBill(docId) {
  try {
    const changed = await changeBillArchive(docId, true);
    if (changed) Swal.fire({ icon: "success", title: "Bill restored", text: "The bill, balance adjustment and audit record were committed together.", timer: 2000, showConfirmButton: false });
    return changed;
  } catch (error) { Swal.fire({ icon: "error", title: "Restore did not complete", text: error.message }); return false; }
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
    const snap = await billsCollection.where("deleted", "==", true).get({ source: "server" });
    if (snap.empty) {
      Swal.fire({ icon: "info", title: "No deleted bills found.", confirmButtonColor: "#005a9e" });
      return;
    }
    const archiveTime = value => value?.toDate ? value.toDate().getTime() : Number(value || 0);
    const sortedDocs = snap.docs.slice().sort((a, b) => archiveTime(b.data().deletedAt) - archiveTime(a.data().deletedAt));
    const rows = sortedDocs
      .map((d) => {
        const b = d.data();
        const archivedAt = b.deletedAt?.toDate ? b.deletedAt.toDate() : new Date(b.deletedAt || 0);
        return `<tr>
        <td>${escapeHtml(b["Serial No"] || "—")}</td>
        <td>${escapeHtml(b["Date"] || "—")}</td>
        <td>${escapeHtml(b["Customer Name"] || "—")}</td>
        <td>₹${Number(b["Final Total"]).toLocaleString("en-IN")}</td>
        <td>${b.deletedAt ? escapeHtml(archivedAt.toLocaleDateString("en-IN")) : "Not recorded"}</td>
        <td><button type="button" data-restore-bill="${escapeHtml(d.id)}"
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
          <th>Total</th><th>Archived on</th><th>Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`,
      width: "800px",
      confirmButtonText: "Close",
      confirmButtonColor: "#005a9e",
      didOpen: () => {
        document.querySelectorAll("[data-restore-bill]").forEach(button => button.addEventListener("click", async () => {
          if (button.disabled) return; button.disabled = true; button.textContent = "Restoring…";
          const restored = await restoreBill(button.dataset.restoreBill);
          if (!restored) { button.disabled = false; button.textContent = "Restore"; }
        }));
      },
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

// Excel is a review report, never a lossless recovery substitute.
let excelReportBusy = false;
async function downloadExcelBackup() {
  if (excelReportBusy || window.MandiBackupCenter?.isBusy()) return;
  excelReportBusy = true;
  showLoading("Reading bill report from server…");
  try {
    if (typeof XLSX === "undefined") throw new Error("Excel library did not load. Refresh and try again.");
    const encoded = await MandiBackup.readCollection(db, firebase.firestore, "bills");
    const documents = encoded.map(doc => ({ id: doc.id, data: MandiBackup.decode(doc.data, firebase.firestore, db) }));
    const columns = ["Bill No", "Date", "Customer Name", "Village", "Vehicle No", "Broker", "Product", "Bill Type", "Weighbridge", "Net Weight", "Total Amount", "Utrai", "Freight", "Final Total", "Broker Commission", "Payment Status", "Amount Paid", "Amount Due", "Remarks", "Document ID"];
    const currencyColumns = new Set(["Total Amount", "Utrai", "Freight", "Final Total", "Broker Commission", "Amount Paid", "Amount Due"]);
    const value = field => field === undefined || field === null ? "" : field;
    const rows = records => records.map(({ id, data: b }) => ({
      "Bill No": value(b["Serial No"]), Date: b.Date?.toDate ? b.Date.toDate().toLocaleDateString("en-GB") : value(b.Date),
      "Customer Name": value(b["Customer Name"]), Village: value(b.Village), "Vehicle No": value(b["Vehicle No"]), Broker: value(b.Broker),
      Product: value(b.ProductTemplate || b.Product), "Bill Type": value(b["Bill Type"]), Weighbridge: value(b["Weighbridge Weight"]), "Net Weight": value(b["Net Weight"]),
      "Total Amount": value(b["Total Amount"]), Utrai: value(b["Utrāī"]), Freight: value(b["Truck Freight"]), "Final Total": value(b["Final Total"]),
      "Broker Commission": value(b.BrokerCommission), "Payment Status": value(b.paymentStatus), "Amount Paid": value(b.amountPaid), "Amount Due": value(b.amountDue), Remarks: value(b.Remarks), "Document ID": id
    }));
    const active = documents.filter(doc => doc.data.deleted !== true), archived = documents.filter(doc => doc.data.deleted === true);
    const workbook = XLSX.utils.book_new();
    const summary = XLSX.utils.json_to_sheet([
      { Field: "Report", Value: "MandiBook bill review report — not a full recovery backup" },
      { Field: "Source project", Value: firebase.app().options.projectId },
      { Field: "Read from", Value: "Firestore server (not offline cache)" },
      { Field: "Generated at", Value: new Date().toLocaleString("en-IN") },
      { Field: "Active bills", Value: active.length }, { Field: "Archived bills", Value: archived.length }, { Field: "Total bill documents", Value: documents.length },
      { Field: "Recovery", Value: "Use the verified JSON file for original IDs, nested fields and all app collections." },
      { Field: "Empty sheets", Value: documents.length ? "An empty sheet means there are no records in that category." : "Server returned zero bill documents. Headers are retained; no bills were silently omitted." }
    ], { header: ["Field", "Value"] });
    summary["!cols"] = [{ wch: 26 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(workbook, summary, "Report summary");
    for (const [name, records] of [["Bills", active], ["Archived bills", archived]]) {
      const sheet = XLSX.utils.json_to_sheet(rows(records), { header: columns });
      sheet["!cols"] = columns.map(column => ({ wch: ["Customer Name", "Document ID"].includes(column) ? 27 : column === "Remarks" ? 35 : Math.max(15, column.length + 2) }));
      sheet["!autofilter"] = { ref: sheet["!ref"] };
      Object.keys(sheet).filter(address => !address.startsWith("!")).forEach(address => {
        const cell = sheet[address], column = columns[XLSX.utils.decode_cell(address).c];
        if (cell.t === "n") cell.z = currencyColumns.has(column) ? '#,##0.00' : '#,##0.###';
        // Names/identifiers stay string cells: spreadsheet-looking input never
        // becomes a formula, and leading zeros in vehicle/document IDs survive.
        if (typeof cell.v === "string") { cell.t = "s"; delete cell.f; }
      });
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    const blob = new Blob([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fname = "MandiBook_BillReport_" + new Date().toISOString().replace(/[:.]/g, "-") + ".xlsx";
    hideLoading();
    await Swal.fire({
      icon: documents.length ? "info" : "warning", title: documents.length ? "Bill report ready" : "Server returned no bills",
      text: active.length + " active and " + archived.length + " archived bills. This Excel file is for review, not full recovery.",
      showCancelButton: true, confirmButtonText: "Save Excel report", showLoaderOnConfirm: true,
      preConfirm: async () => {
        try {
          if (window.showSaveFilePicker) {
            let handle;
            try { handle = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: "Excel report", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }] }); }
            catch (error) { if (error.name === "AbortError") return false; if (!["SecurityError", "NotSupportedError"].includes(error.name)) throw error; }
            if (handle) {
              let writer;
              try { writer = await handle.createWritable(); await writer.write(blob); await writer.close(); }
              catch (error) { if (writer?.abort) await writer.abort().catch(() => {}); throw error; }
              const expected = new Uint8Array(await blob.arrayBuffer()), saved = new Uint8Array(await (await handle.getFile()).arrayBuffer());
              if (expected.length !== saved.length || expected.some((byte, index) => byte !== saved[index])) throw new Error("Saved report bytes do not match. Keep your previous reports and retry.");
              return { verified: true, filename: fname };
            }
          }
          const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = fname; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
          return { verified: false, filename: fname };
        } catch (error) { Swal.showValidationMessage("Save not confirmed: " + error.message); return false; }
      }
    }).then(result => { if (result.isConfirmed && result.value) Swal.fire({ icon: result.value.verified ? "success" : "info", title: result.value.verified ? "Report file saved and read back" : "Report download requested", text: result.value.verified ? fname : "Check your browser Downloads for " + fname + ". This browser cannot confirm disk saving." }); });
  } catch (error) { hideLoading(); Swal.fire({ icon: "error", title: "Report was not created", text: error.message }); }
  finally { excelReportBusy = false; hideLoading(); }
}

// Recovery exports are built by the typed, verified backup engine.
async function downloadFullJsonBackup() { return window.MandiBackupCenter.build(); }
async function renderLastBackupReminder() { return window.MandiBackupCenter.refreshReminder(); }
window.softDeleteBill = softDeleteBill;
window.restoreBill = restoreBill;
window.showDeletedBills = showDeletedBills;
window.downloadExcelBackup = downloadExcelBackup;
window.downloadFullJsonBackup = downloadFullJsonBackup;
