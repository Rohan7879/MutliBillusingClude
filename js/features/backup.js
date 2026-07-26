/**
 * @file backup.js
 * @description Soft delete, restore, and Excel backup for MandiBook
 */

// ── SOFT DELETE ───────────────────────────────────────────────────────────────
async function softDeleteBill(docId) {
  const result = await Swal.fire({
    icon: "warning", title: "Delete Bill?",
    text: "Bill 30 din tak restore ho sakta hai.",
    showCancelButton: true,
    confirmButtonColor: "#dc3545", cancelButtonColor: "#6c757d",
    confirmButtonText: "Haan, Delete Karo"
  });
  if (!result.isConfirmed) return;
  try {
    await billsCollection.doc(docId).update({
      deleted: true, deletedAt: Date.now()
    });
    Swal.fire({ icon:"success", title:"Bill deleted!", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
    return true;
  } catch(e) {
    console.error(e);
    Swal.fire({ icon:"error", title:"Could not delete.", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
    return false;
  }
}

async function restoreBill(docId) {
  try {
    await billsCollection.doc(docId).update({ deleted: false, deletedAt: null });
    Swal.fire({ icon:"success", title:"✅ Bill Restored!", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
    return true;
  } catch(e) { console.error(e); return false; }
}

async function showDeletedBills() {
  showLoading();
  try {
    const snap = await billsCollection.where("deleted","==",true).orderBy("deletedAt","desc").get();
    if (snap.empty) {
      Swal.fire({ icon:"info", title:"No deleted bills found.", confirmButtonColor:"#005a9e" });
      return;
    }
    const rows = snap.docs.map(d => {
      const b = d.data();
      const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - b.deletedAt) / 86400000));
      return `<tr>
        <td>${b["Serial No"]}</td>
        <td>${b["Date"]}</td>
        <td>${b["Customer Name"]}</td>
        <td>₹${Number(b["Final Total"]).toLocaleString("en-IN")}</td>
        <td>${daysLeft} days</td>
        <td><button onclick="restoreBill('${d.id}');Swal.close();" 
          style="padding:6px 12px;background:#28a745;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:700;">
          ↩️ Restore</button></td>
      </tr>`;
    }).join("");

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
      confirmButtonColor: "#005a9e"
    });
  } catch(e) { console.error(e); }
  finally { hideLoading(); }
}

// ── AUTO EXCEL BACKUP ─────────────────────────────────────────────────────────
async function downloadExcelBackup() {
  showLoading();
  try {
    const snap = await billsCollection.where("deleted","!=",true).orderBy("deleted").orderBy("Date","desc").get();
    const rows = snap.docs.map(d => {
      const b = d.data();
      return {
        "Bill No":       b["Serial No"] || "",
        "Date":          b["Date"]      || "",
        "Customer Name": b["Customer Name"] || "",
        "Village":       b["Village"]   || "",
        "Vehicle No":    b["Vehicle No"] || "",
        "Broker":        b["Broker"]    || "",
        "Product":       b["ProductTemplate"] || "",
        "Bill Type":     b["Bill Type"] || "",
        "Weighbridge":   b["Weighbridge Weight"] || 0,
        "Net Weight":    b["Net Weight"] || 0,
        "Total Amount":  b["Total Amount"] || 0,
        "Utrai":         b["Utrāī"] || 0,
        "Freight":       b["Truck Freight"] || 0,
        "Final Total":   b["Final Total"] || 0,
        "Broker Commission": b["BrokerCommission"] || 0,
        "Payment Status": b["paymentStatus"] || "Unpaid",
        "Amount Paid":   b["amountPaid"] || 0,
        "Remarks":       b["Remarks"] || "",
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Bills");

    const now    = new Date();
    const fname  = `MandiBook_Backup_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}.xlsx`;
    XLSX.writeFile(wb, fname);

    Swal.fire({ icon:"success", title:"✅ Backup Downloaded!", text: fname, confirmButtonColor:"#005a9e" });
  } catch(e) {
    console.error(e);
    Swal.fire({ icon:"error", title:"Backup failed!", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
  } finally { hideLoading(); }
}

// ── FIRESTORE RULES REMINDER ──────────────────────────────────────────────────
// Soft-deleted bills are filtered by adding where("deleted","!=",true) to queries
// Make sure bill-list.js and dashboard.js filter these out

window.softDeleteBill    = softDeleteBill;
window.restoreBill       = restoreBill;
window.showDeletedBills  = showDeletedBills;
window.downloadExcelBackup = downloadExcelBackup;
