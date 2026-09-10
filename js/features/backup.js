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
    if (typeof XLSX === "undefined") {
      throw new Error("Excel export library did not load. Please check your internet connection and refresh the page.");
    }
    // Fetch WITHOUT orderBy("Date") — Firestore's orderBy silently EXCLUDES
    // any document missing that field entirely from the results (same bug
    // class as the where("deleted","!=",true) issue noted below). Sorting
    // client-side instead means a bill with a missing/malformed Date still
    // shows up in the backup (just sorted last) instead of vanishing.
    const snap = await billsCollection.get();
    function parseDDMMYYYY(s) {
      const parts = String(s || "").split("/");
      if (parts.length !== 3) return 0;
      const [dd, mm, yyyy] = parts.map(Number);
      if (!dd || !mm || !yyyy) return 0;
      return new Date(yyyy, mm - 1, dd).getTime();
    }
    const afterDeletedFilter = snap.docs.filter((d) => d.data().deleted !== true);
    const rows = afterDeletedFilter
      .sort((a, b) => parseDDMMYYYY(b.data()["Date"]) - parseDDMMYYYY(a.data()["Date"]))
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
    // json_to_sheet([]) creates a genuinely blank worksheet. Supplying an
    // explicit header ensures a useful Excel template is downloaded even
    // when there are currently no active bills.
    const columns = [
      "Bill No",
      "Date",
      "Customer Name",
      "Village",
      "Vehicle No",
      "Broker",
      "Product",
      "Bill Type",
      "Weighbridge",
      "Net Weight",
      "Total Amount",
      "Utrai",
      "Freight",
      "Final Total",
      "Broker Commission",
      "Payment Status",
      "Amount Paid",
      "Remarks",
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
    ws["!cols"] = columns.map((column) => ({ wch: Math.max(13, column.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, "Bills");

    const summaryRows = [
      { Field: "Generated at", Value: new Date().toLocaleString("en-IN") },
      { Field: "Active bills exported", Value: rows.length },
      { Field: "Archived bills excluded", Value: snap.size - rows.length },
      { Field: "Total bill documents read", Value: snap.size },
      { Field: "Note", Value: rows.length ? "All active bills are in the Bills sheet." : "No active bills exist yet; the Bills sheet contains headers for verification." },
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ["Field", "Value"] });
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Backup Summary");

    const now = new Date();
    const fname = `MandiBook_Backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}.xlsx`;

    // Manual Blob + explicit <a download> instead of XLSX.writeFile()'s
    // own internal trigger — in some dev-server/local environments the
    // browser doesn't honor the filename XLSX.writeFile() tries to set
    // (saves it as a random UUID with no extension instead). This is the
    // more robust, standard pattern and works reliably everywhere.
    const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbOut], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // Prefer the native Save-As picker (Chrome/Edge) — the filename you
    // set here is exactly what shows in the OS save dialog and what gets
    // saved, with zero chance of a browser/extension silently renaming it
    // to a random blob ID (which is what a plain <a download> click was
    // doing in this environment). Falls back to the anchor-click method
    // for browsers without this API (Firefox, Safari).
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [
            {
              description: "Excel Workbook",
              accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        Swal.fire({ icon: "success", title: "✅ Backup Downloaded!", text: fname, confirmButtonColor: "#005a9e" });
        return;
      } catch (pickerErr) {
        if (pickerErr.name === "AbortError") {
          // User cancelled the save dialog — not an error, just stop.
          return;
        }
        console.warn("Save picker failed, falling back to direct download:", pickerErr);
        // fall through to the <a download> method below
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fname;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

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

// ── JSON FULL BACKUP (controlled disaster-recovery export) ───────────────────
// The Excel export above is a human-readable REPORT — good for reviewing/
// sharing, but lossy for restore purposes (nested data like the Expenses
// array, and dozens of raw per-Vakal fields, don't round-trip through a flat
// spreadsheet). This captures the EXACT raw Firestore data for every
// collection that matters, with original document IDs, so it can genuinely
// reconstruct the business's data if something goes wrong. Restore is kept out
// of the browser: Firestore rules cannot distinguish a genuine recovery from a
// compromised admin browser session. Recovery must be a controlled owner task.
function serialiseBackupValue(value) {
  if (value instanceof firebase.firestore.Timestamp) {
    return { __mandiBookType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof firebase.firestore.GeoPoint) {
    return { __mandiBookType: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof firebase.firestore.DocumentReference) {
    return { __mandiBookType: "documentReference", path: value.path };
  }
  if (Array.isArray(value)) return value.map(serialiseBackupValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialiseBackupValue(item)]));
  }
  return value;
}

async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) return "unavailable";
  const bytes = new TextEncoder().encode(text);
  const hash = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function downloadFullJsonBackup() {
  showLoading("Preparing full backup...");
  try {
    const collectionsToBackup = ["bills", "payments", "parties", "orders", "settings"];
    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: (window.currentUserProfile && window.currentUserProfile.email) || "unknown",
      format: "mandibook-firestore-backup",
      version: 2,
      collections: collectionsToBackup,
    };

    for (const col of collectionsToBackup) {
      const snap = await db.collection(col).get();
      backup[col] = snap.docs.map((d) => ({ id: d.id, data: serialiseBackupValue(d.data()) }));
    }

    const counts = collectionsToBackup.map((c) => `${backup[c].length} ${c}`).join(", ");
    const confirmResult = await Swal.fire({
      icon: "question",
      title: "Full backup ready",
      html: `Isme yeh sab hoga:<br><b>${counts}</b><br><br>Yeh file safe jagah rakho — isse poora business data restore ho sakta hai.`,
      showCancelButton: true,
      confirmButtonText: "Download karo",
      cancelButtonText: "Cancel",
    });
    if (!confirmResult.isConfirmed) return;

    const now = new Date();
    const fname = `MandiBook_FullBackup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}.json`;
    const backupPayload = JSON.stringify(backup, null, 2);
    backup.integrity = { algorithm: "SHA-256", payloadHash: await sha256Hex(backupPayload) };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: "JSON Backup", accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        await recordLastBackupTime();
        Swal.fire({ icon: "success", title: "✅ Full Backup Downloaded!", text: fname, confirmButtonColor: "#005a9e" });
        return;
      } catch (pickerErr) {
        if (pickerErr.name === "AbortError") return;
        console.warn("Save picker failed, falling back:", pickerErr);
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fname;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await recordLastBackupTime();
    Swal.fire({ icon: "success", title: "✅ Full Backup Downloaded!", text: fname, confirmButtonColor: "#005a9e" });
  } catch (e) {
    console.error("Full backup error:", e);
    Swal.fire({ icon: "error", title: "Backup failed!", text: e.message });
  } finally {
    hideLoading();
  }
}

// ── LAST BACKUP REMINDER ───────────────────────────────────────────────────────
// Tracks when a (full) backup was last taken, so Settings can show a gentle
// reminder if it's been a while — small, self-contained doc, admin-only.
async function recordLastBackupTime() {
  try {
    await db
      .collection("settings")
      .doc("backupInfo")
      .set(
        {
          lastBackupAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastBackupBy: (window.currentUserProfile && window.currentUserProfile.email) || "unknown",
        },
        { merge: true }
      );
  } catch (e) {
    console.warn("Could not record last-backup timestamp:", e);
  }
}

async function renderLastBackupReminder() {
  const el = document.getElementById("last-backup-reminder");
  if (!el) return;
  try {
    const doc = await db.collection("settings").doc("backupInfo").get();
    if (!doc.exists || !doc.data().lastBackupAt) {
      el.innerHTML = `⚠️ Abhi tak koi backup nahi liya gaya.`;
      el.style.color = "#c0392b";
      return;
    }
    const lastDate = doc.data().lastBackupAt.toDate();
    const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0) {
      el.innerHTML = `✅ Aaj backup liya gaya hai.`;
      el.style.color = "#1a7f4b";
    } else {
      el.innerHTML = `Last backup: <b>${daysAgo} din pehle</b> (${lastDate.toLocaleDateString("en-IN")})`;
      el.style.color = daysAgo > 14 ? "#c0392b" : "#5d7187";
    }
  } catch (e) {
    console.warn("Could not load last-backup info:", e);
  }
}
document.addEventListener("DOMContentLoaded", renderLastBackupReminder);

// ── FIRESTORE RULES REMINDER ──────────────────────────────────────────────────
// Soft-deleted bills are filtered by adding where("deleted","!=",true) to queries
// Make sure bill-list.js and dashboard.js filter these out

window.softDeleteBill = softDeleteBill;
window.restoreBill = restoreBill;
window.showDeletedBills = showDeletedBills;
window.downloadExcelBackup = downloadExcelBackup;
window.downloadFullJsonBackup = downloadFullJsonBackup;
