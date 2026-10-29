let allBillsForList = [];
let currentPageForList = 1;
const itemsPerPageForList = 25;

let billListInitialized = false;
const billReportParams = new URLSearchParams(window.location.search);
let billReportFrom = /^\d{4}-\d{2}-\d{2}$/.test(billReportParams.get("from") || "") ? billReportParams.get("from") : "";
let billReportTo = /^\d{4}-\d{2}-\d{2}$/.test(billReportParams.get("to") || "") ? billReportParams.get("to") : "";

// Newest-first (desc) by default; ascending shows oldest bills first —
// toggle button in the toolbar flips this and reloads the list.
let billSortDirection = "desc";

// Phase 3 (item #14): keep a reference to the active onSnapshot unsubscribe
// function so we can detach it before attaching a new one — previously every
// call to showBillListView() (e.g. after delete/mark-paid) stacked up a NEW
// listener without ever removing the old one ("ghost listeners").
let unsubscribeBillsListener = null;

// Phase 3 (item #15): debounce helper for the search input (500ms) so we're
// not re-filtering the whole list on every single keystroke.
let searchDebounceTimer = null;
function debounce(fn, delayMs) {
  return (...args) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => fn(...args), delayMs);
  };
}

function showBillListView() {
  const formEl = document.getElementById("bill_creation_form");
  const listEl = document.getElementById("bill_list_view");
  if (formEl) formEl.style.display = "none";
  if (listEl) listEl.style.display = "block";
  showLoading();

  if (!billListInitialized) {
    billListInitialized = true;
    const searchEl = document.getElementById("search_input_list");
    const prevBtn = document.getElementById("prev_page_list_btn");
    const nextBtn = document.getElementById("next_page_list_btn");
    const paidBtn = document.getElementById("mark_paid_btn");
    const sortBtn = document.getElementById("sort_direction_btn");
    const statusFilter = document.getElementById("bill_status_filter");
    const dateFilter = document.getElementById("bill_date_filter");
    const requestedStatus = billReportParams.get("status");
    if (statusFilter && ["all", "due", "partial", "paid", "outstanding", "received"].includes(requestedStatus)) statusFilter.value = requestedStatus;
    const reportContext = document.getElementById("bill-report-context");
    if (reportContext && (billReportFrom || billReportTo)) {
      reportContext.hidden = false;
      const label = document.createElement("span");
      label.textContent = `Report range: ${billReportFrom || "Beginning"} to ${billReportTo || "Today"} · `;
      const clear = document.createElement("button");
      clear.type = "button"; clear.textContent = "Clear date range";
      clear.addEventListener("click", () => { billReportFrom = ""; billReportTo = ""; reportContext.hidden = true; const url = new URL(window.location.href); url.searchParams.delete("from"); url.searchParams.delete("to"); window.history.replaceState(null, "", url); currentPageForList = 1; filterAndRenderList(); });
      reportContext.replaceChildren(label, clear);
    }
    document.querySelectorAll("[data-bill-bucket]").forEach((button) => {
      button.style.textAlign = "left"; button.style.fontFamily = "inherit"; button.style.cursor = "pointer";
      button.addEventListener("click", () => { statusFilter.value = button.dataset.billBucket; currentPageForList = 1; filterAndRenderList(); document.getElementById("bill_list_view").scrollIntoView({ block: "start", behavior: "smooth" }); });
    });
    if (searchEl)
      searchEl.addEventListener(
        "input",
        debounce((e) => filterAndRenderList(e.target.value), 500)
      );
    if (prevBtn) prevBtn.addEventListener("click", goToPrevListPage);
    if (nextBtn) nextBtn.addEventListener("click", goToNextListPage);
    if (paidBtn) paidBtn.addEventListener("click", markSelectedBillsAsPaid);
    if (sortBtn) sortBtn.addEventListener("click", toggleBillSortDirection);
    if (statusFilter) statusFilter.addEventListener("change", () => { currentPageForList = 1; filterAndRenderList(); });
    if (dateFilter) dateFilter.addEventListener("change", () => { currentPageForList = 1; filterAndRenderList(); });
  }

  const sortBtnLabel = document.getElementById("sort_direction_btn");
  if (sortBtnLabel) {
    sortBtnLabel.textContent = billSortDirection === "desc" ? "⬆️ Oldest First" : "⬇️ Newest First";
  }

  // Detach any previously-active listener before attaching a new one
  if (unsubscribeBillsListener) {
    unsubscribeBillsListener();
    unsubscribeBillsListener = null;
  }

  // Keep the workspace complete: a hard 200-record cap silently omitted older
  // bills from search, totals, export selection and pagination.
  unsubscribeBillsListener = billsCollection.onSnapshot(
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) {
        setBillsSyncStatus("Waiting to sync changes", "#ffe29a");
      } else {
        const now = new Date();
        const formattedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
        setBillsSyncStatus(`Last checked ${formattedTime}`, "#d9ffea");
      }

      allBillsForList = snapshot.docs.filter((d) => d.data().deleted !== true);
      updateBillsSummary(allBillsForList);
      // 📅 Sorting with button direction support (Newest First / Oldest First)
      allBillsForList.sort((a, b) => {
        const dataA = a.data();
        const dataB = b.data();

        function getTimestamp(dateVal) {
          if (!dateVal) return 0;
          if (dateVal.toDate && typeof dateVal.toDate === "function") {
            return dateVal.toDate().getTime();
          }
          if (typeof dateVal === "string" && dateVal.includes("/")) {
            const parts = dateVal.split("/");
            if (parts.length === 3) {
              return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
            }
          }
          return new Date(dateVal).getTime() || 0;
        }

        const timeA = getTimestamp(dataA.date || dataA.billDate || dataA.createdAt);
        const timeB = getTimestamp(dataB.date || dataB.billDate || dataB.createdAt);

        // 🚀 Button ke direction ke hisab se sort karega (Ascending / Descending)
        if (typeof billSortDirection !== "undefined" && billSortDirection === "asc") {
          return timeA - timeB; // Oldest First
        } else {
          return timeB - timeA; // Newest First (Default)
        }
      });
      currentPageForList = 1;
      filterAndRenderList();
      hideLoading();
    },
    (error) => {
      console.error("Could not load bills:", error);
      setBillsSyncStatus("Could not refresh — check internet", "#ffd0d0");
      hideLoading();
    }
  );
}

function setBillsSyncStatus(message, color) {
  const syncStatus = document.getElementById("sync_status");
  if (!syncStatus) return;
  syncStatus.textContent = message;
  syncStatus.style.color = color;
}
function toggleBillSortDirection() {
  billSortDirection = billSortDirection === "desc" ? "asc" : "desc";
  showBillListView();
}
function filterAndRenderList(searchTerm = null) {
  const billsToDisplay = getFilteredBills(searchTerm);

  const start = (currentPageForList - 1) * itemsPerPageForList;
  const end = start + itemsPerPageForList;
  const billsForCurrentPage = billsToDisplay.slice(start, end);

  renderBillList(billsForCurrentPage);
  renderListPaginationControls(billsToDisplay.length);
}

function getFilteredBills(searchTerm = null) {
  const searchValue = searchTerm === null ? document.getElementById("search_input_list")?.value || "" : searchTerm;
  const statusValue = document.getElementById("bill_status_filter")?.value || "all";
  const dateValue = document.getElementById("bill_date_filter")?.value || "";
  let billsToDisplay = allBillsForList;

  if (searchValue) {
    const lowerCaseSearch = searchValue.toLowerCase();
    billsToDisplay = allBillsForList.filter((doc) => {
      const bill = doc.data();
      const searchString = [bill["Serial No"], bill["Customer Name"], bill["Village"], bill["Vehicle No"]]
        .join(" ")
        .toLowerCase();
      return searchString.includes(lowerCaseSearch);
    });
  }

  if (statusValue !== "all") {
    billsToDisplay = billsToDisplay.filter((doc) => {
      const bucket = getBillPaymentBucket(doc.data());
      if (statusValue === "outstanding") return bucket !== "paid";
      if (statusValue === "received") return bucket === "paid" || Number(doc.data().amountPaid || 0) > 0;
      return bucket === statusValue;
    });
  }
  if (billReportFrom || billReportTo) billsToDisplay = billsToDisplay.filter((doc) => {
    const key = toInputDate(doc.data().Date || doc.data().createdAt);
    return key && (!billReportFrom || key >= billReportFrom) && (!billReportTo || key <= billReportTo);
  });

  if (dateValue) {
    billsToDisplay = billsToDisplay.filter((doc) => toInputDate(doc.data()["Date"]) === dateValue);
  }

  return billsToDisplay;
}

function toInputDate(dateValue) {
  if (!dateValue) return "";
  if (typeof dateValue === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateValue)) {
    const [day, month, year] = dateValue.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = dateValue.toDate && typeof dateValue.toDate === "function" ? dateValue.toDate() : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getBillPaymentBucket(bill) {
  const total = Number(bill["Final Total"] || 0);
  const paid = Number(bill.amountPaid || 0);
  const status = String(bill.paymentStatus || "").toLowerCase();
  if (status === "paid" || (total > 0 && paid >= total - 0.01)) return "paid";
  if (status.includes("partial") || paid > 0) return "partial";
  return "due";
}

function updateBillsSummary(docs) {
  const totals = docs.reduce(
    (summary, doc) => {
      const bill = doc.data();
      const total = Number(bill["Final Total"] || 0);
      const paid = Math.min(total, Math.max(0, Number(bill.amountPaid || (String(bill.paymentStatus).toLowerCase() === "paid" ? total : 0))));
      summary.total += total;
      summary.paid += paid;
      return summary;
    },
    { total: 0, paid: 0 }
  );
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  set("bills-summary-count", docs.length.toLocaleString("en-IN"));
  set("bills-summary-total", `₹${totals.total.toLocaleString("en-IN")}`);
  set("bills-summary-due", `₹${Math.max(0, totals.total - totals.paid).toLocaleString("en-IN")}`);
  set("bills-summary-paid", `₹${totals.paid.toLocaleString("en-IN")}`);
}

async function markSelectedBillsAsPaid() {
  if (!hasRole("admin", "accountant")) {
    Swal.fire("Not allowed", "Only an Admin or Accountant can mark payments as paid.", "error");
    return;
  }
  const selectedCheckboxes = document.querySelectorAll("#bill_list_view .bill-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    Swal.fire("No Bills Selected", "Select one or more bills before recording a payment.", "info");
    return;
  }

  const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
  const selectedBills = allBillsForList.filter((billDoc) => selectedIds.includes(billDoc.id));
  const approvalNeeded = selectedBills.filter((billDoc) => {
    const bill = billDoc.data();
    const workflow = String(bill.workflowStatus || (bill.locked ? "locked" : "draft")).toLowerCase();
    return !["approved", "locked"].includes(workflow);
  });
  if (approvalNeeded.length > 0) {
    const billNumbers = approvalNeeded
      .map((billDoc) => billDoc.data()["Serial No"] || "an unnamed bill")
      .join(", ");
    Swal.fire({
      icon: "info",
      title: "Payment not saved",
      html: `<p style="margin:0 0 10px">${approvalNeeded.length === 1 ? "This bill is" : "These bills are"} still <strong>Draft</strong>:</p><p style="margin:0 0 14px;font-weight:800;color:#075a9c">${escapeHtml(billNumbers)}</p><p style="margin:0">Open the bill, choose <strong>Approve Bill</strong>, then record payment. No payment was created.</p>`,
      confirmButtonColor: "#005a9e",
    });
    return;
  }
  const selectedDue = selectedBills.reduce((total, billDoc) => {
    const bill = billDoc.data();
    const finalTotal = Number(bill["Final Total"] || 0);
    const paid = Math.max(0, Number(bill.amountPaid || 0));
    return total + Math.max(0, finalTotal - paid);
  }, 0);
  if (selectedDue <= 0.01) {
    Swal.fire("Nothing due", "All selected bills are already fully paid.", "info");
    return;
  }

  const result = await Swal.fire({
    title: "Record payment",
    customClass: { popup: "mb-payment-popup" },
    html: `<p>Payment will be allocated across ${selectedBills.length} selected bill(s).</p>` + window.MandiPaymentUI.fields(true),
    didOpen: () => { document.getElementById("bulk-payment-cash").value = selectedDue.toFixed(2); },
    showCancelButton: true,
    confirmButtonColor: "#28a745",
    confirmButtonText: "Save payment",
    preConfirm: () => {
      const cashAmount = Number(document.getElementById("bulk-payment-cash")?.value || 0);
      const deductionAmount = Number(document.getElementById("bulk-payment-deduction")?.value || 0);
      const paymentDate = document.getElementById("bulk-payment-date")?.value || "";
      const paymentMethod = document.getElementById("bulk-payment-method")?.value || "Cash";
      const deductionReason = document.getElementById("bulk-payment-deduction-reason")?.value.trim() || "";
      const reason = document.getElementById("bulk-payment-reason")?.value.trim() || "";
      const totalCredit = cashAmount + deductionAmount;
      if (![cashAmount, deductionAmount, totalCredit].every(Number.isFinite) || cashAmount < 0 || deductionAmount < 0 || totalCredit <= 0) {
        Swal.showValidationMessage("Enter a valid received amount or deduction."); return false;
      }
      if (totalCredit > selectedDue + 0.01) {
        Swal.showValidationMessage(`Selected bills have only ₹${selectedDue.toFixed(2)} pending.`); return false;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || !Number.isFinite(new Date(`${paymentDate}T12:00:00`).getTime())) {
        Swal.showValidationMessage("Choose a valid payment date."); return false;
      }
      if (deductionAmount > 0 && !deductionReason) {
        Swal.showValidationMessage("Enter a deduction reason."); return false;
      }
      if (!reason) { Swal.showValidationMessage("Enter a payment reference."); return false; }
      return { cashAmount, deductionAmount, paymentDate, paymentMethod, deductionReason, reason };
    },
  });

  if (result.isConfirmed) {
    showLoading("Updating bills and recording payments...");
    let failedCount = 0;
    let alreadyPaidCount = 0;
    let unallocatedCount = 0;
    let approvalRequiredCount = 0;

    try {
      const billsToUpdate = selectedBills;
      let remainingCash = result.value.cashAmount;
      let remainingDeduction = result.value.deductionAmount;

      for (const billDoc of billsToUpdate) {
        const billId = billDoc.id;
        try {
          // 🔒 ATOMIC — bill update + payment record + party balance, all
          // in one transaction per bill. Previously this bulk action did
          // two separate awaited writes per bill (bill, then payment doc)
          // with NO transaction and — more importantly — never touched
          // the customer's cached balance at all, so bulk-marking bills
          // paid silently left every affected customer's Ledger/Party
          // Master balance wrong. Each bill gets its own transaction (not
          // one transaction for the whole batch) so one bill failing
          // doesn't roll back bills that already succeeded, while each
          // individual bill is still fully all-or-nothing.
          const billRef = billsCollection.doc(billId);
          const paymentRef = db.collection("payments").doc();

          const paymentCreated = await db.runTransaction(async (transaction) => {
            await MandiFinancialYear.assertPostingOpen(db, transaction, [result.value.paymentDate]);
            const freshBillDoc = await transaction.get(billRef);
            if (!freshBillDoc.exists) throw new Error("Bill not found");
            const billData = freshBillDoc.data();
            const workflow = String(billData.workflowStatus || (billData.locked ? "locked" : "draft")).toLowerCase();
            if (!["approved", "locked"].includes(workflow)) return { skipped: "approvalRequired" };
            const currentPaid = Number(billData.amountPaid || 0);
            const finalTotal = Number(billData["Final Total"] || 0);
            const remainingDue = Math.max(0, finalTotal - currentPaid);
            if (remainingDue <= 0.01) return { skipped: "alreadyPaid" }; // no payment/audit should be created

            const creditAvailable = remainingCash + remainingDeduction;
            if (creditAvailable <= 0.01) return { skipped: "unallocated" };
            const creditForBill = Math.min(remainingDue, creditAvailable);
            const deductionForBill = Math.min(remainingDeduction, creditForBill);
            const cashForBill = creditForBill - deductionForBill;

            const partyRef = billData.customerId ? db.collection("parties").doc(billData.customerId) : null;
            const partyDoc = partyRef ? await transaction.get(partyRef) : null;

            transaction.update(billRef, {
              paymentStatus: currentPaid + creditForBill >= finalTotal - 0.01 ? "Paid" : "Partial",
              amountPaid: roundCurrency(currentPaid + creditForBill),
              amountDue: roundCurrency(Math.max(0, finalTotal - currentPaid - creditForBill)),
              lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            transaction.set(paymentRef, {
              customerName: billData["Customer Name"] || "",
              customerVillage: billData["Village"] || "N/A",
              customerId: billData.customerId || null,
              cashAmount: cashForBill,
              paymentMethod: result.value.paymentMethod,
              deductionAmount: deductionForBill,
              deductionReason: deductionForBill > 0 ? result.value.deductionReason : "",
              totalCredit: creditForBill,
              paymentDate: firebase.firestore.Timestamp.fromDate(new Date(`${result.value.paymentDate}T12:00:00`)),
              appliedToBills: [billId],
              reason: result.value.reason,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

            if (partyRef && partyDoc && partyDoc.exists) {
              const currentBalance = Number(partyDoc.data().currentBalance || 0);
              transaction.update(partyRef, {
                currentBalance: roundCurrency(currentBalance - creditForBill),
                lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              });
            }
            return { cashForBill, deductionForBill, creditForBill };
          });

          if (paymentCreated?.skipped === "alreadyPaid") {
            alreadyPaidCount++;
          } else if (paymentCreated?.skipped === "approvalRequired") {
            approvalRequiredCount++;
          } else if (paymentCreated?.skipped === "unallocated") {
            unallocatedCount++;
          } else if (paymentCreated) {
            remainingCash -= paymentCreated.cashForBill;
            remainingDeduction -= paymentCreated.deductionForBill;
            await recordAudit("payment.created", "payment", paymentRef.id, {
              before: billAuditSnapshot(billDoc.data()),
              after: {
                billId,
                serialNo: billDoc.data()["Serial No"] || "",
                paymentStatus: paymentCreated.creditForBill >= Number(billDoc.data()["Final Total"] || 0) - Number(billDoc.data().amountPaid || 0) - 0.01 ? "Paid" : "Partial",
                cashAmount: paymentCreated.cashForBill,
                deductionAmount: paymentCreated.deductionForBill,
                paymentMethod: result.value.paymentMethod,
              },
              reason: result.value.reason,
            });
          }
        } catch (billError) {
          console.error(`Could not mark bill ${billId} as paid:`, billError);
          failedCount++;
        }
      }

      const updatedCount = selectedCheckboxes.length - failedCount - alreadyPaidCount - unallocatedCount - approvalRequiredCount;
      if (failedCount === 0 && alreadyPaidCount === 0 && unallocatedCount === 0) {
        Swal.fire(
          "Success!",
          `${updatedCount} bill(s) payment saved. ${remainingCash + remainingDeduction > 0.01 ? `₹${(remainingCash + remainingDeduction).toFixed(2)} was not applied because selected bill dues changed.` : ""}`,
          "success"
        );
      } else if (updatedCount === 0 && approvalRequiredCount > 0) {
        Swal.fire("Payment not saved", `${approvalRequiredCount} selected bill(s) are Draft. Approve the bill first, then record payment. No payment was created.`, "info");
      } else {
        Swal.fire(
          "Partially completed",
          `${updatedCount} bill(s) payment saved.${alreadyPaidCount ? ` ${alreadyPaidCount} already paid tha, isliye duplicate payment nahi banaya.` : ""}${
            unallocatedCount ? ` ${unallocatedCount} bill(s) unpaid raha because entered payment amount unke due tak nahi pahuncha.` : ""
          }${
            approvalRequiredCount ? ` ${approvalRequiredCount} bill(s) Draft tha; approve karne ke baad hi payment hoga.` : ""
          }${
            failedCount ? ` ${failedCount} failed — inmein koi half-update nahi hua.` : ""
          }`,
          "warning"
        );
      }
      showBillListView();
    } catch (error) {
      console.error("Error marking bills as paid:", error);
      Swal.fire("Error", "Could not update the bills.", "error");
    } finally {
      hideLoading();
    }
  }
}
// REMOVED: showBillCreationForm() — this was leftover from the old single-page
// ── BULK DELETE ─────────────────────────────────────────────────────────────
// Reuses the already-safe softDeleteBill() from backup.js (atomic bill+balance
// update, blocks locked bills and bills with a recorded payment) once per
// selected bill — not a separate/parallel deletion path, so it inherits all
// the same safety checks with zero duplicated logic.
async function deleteSelectedBills() {
  const selectedCheckboxes = document.querySelectorAll("#bill_list_view .bill-checkbox:checked");
  if (selectedCheckboxes.length === 0) {
    Swal.fire("No Bills Selected", "Please select one or more bills to delete.", "info");
    return;
  }

  const result = await Swal.fire({
    title: `Archive ${selectedCheckboxes.length} bill(s)?`,
    text: "Records stay in the recovery backup. Locked/paid bills will be skipped; eligible unpaid bills can be restored by an Admin.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc3545",
    confirmButtonText: "Yes, archive",
  });
  if (!result.isConfirmed) return;

  showLoading("Deleting selected bills...");
  const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
  let deletedCount = 0;
  let skippedCount = 0;

  try {
    for (const billId of selectedIds) {
      // softDeleteBill() already shows its own error popup for a hard
      // failure (e.g. permission/network) — here we only need to tell
      // deleted apart from skipped-by-design (locked / has payment).
      const ok = await softDeleteBillSilently(billId);
      if (ok) deletedCount++;
      else skippedCount++;
    }
    Swal.fire(
      "Done",
      `${deletedCount} bill(s) archived.` +
        (skippedCount > 0 ? ` ${skippedCount} not archived (locked, paid, already archived or update failed).` : ""),
      deletedCount > 0 ? "success" : "info"
    );
    showBillListView();
  } finally {
    hideLoading();
  }
}
window.deleteSelectedBills = deleteSelectedBills;

// Use the same atomic archive transition for bulk operations without mutating
// the global dialog handler or suppressing unrelated save/error dialogs.
async function softDeleteBillSilently(docId) {
  try {
    if (typeof changeBillArchive !== "function") throw new Error("Safe archive module is unavailable; reload before archiving.");
    const result = await changeBillArchive(docId, false);
    return result?.changed === true;
  } catch (error) { console.warn("One bill was not archived:", error.message); return false; }
}

// were toggled via style.display. It had NO null-check on #bill_list_view /
// #bill_creation_form, so calling it on bill-create.html (which no longer has
// #bill_list_view) would throw "Cannot set properties of null". It also had
// no remaining callers in the codebase — confirmed dead code.
//
// Now that bill-create.html and bills.html are separate pages, navigate with
// a real page load instead of a display toggle:
function goToBillCreate() {
  window.location.href = "bill-create.html";
}
// MOVED to core-engine.js — getStatusHtml() is now a shared utility.

function renderBillList(docs) {
  const tableBody = document.getElementById("bill_list_body");
  tableBody.innerHTML = "";
  if (docs.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9" class="empty-bills-state">No bills match the selected filters.</td></tr>';
    return;
  }

  docs.forEach((doc) => {
    const bill = doc.data();
    const hasRecordedPayment =
      Number(bill.amountPaid || 0) > 0 || ["Paid", "Partial", "Partially Paid"].includes(bill.paymentStatus);
    const row = document.createElement("tr");
    const serialNo = escapeHtml(bill["Serial No"]);
    const billDate = escapeHtml(bill["Date"]);
    const customerName = escapeHtml(bill["Customer Name"]);
    const billType = escapeHtml(bill["Bill Type"]);
    const workflow =
      bill.locked === true || bill.workflowStatus === "locked"
        ? "🔒 Locked"
        : bill.workflowStatus === "approved"
        ? "✓ Approved"
        : "✎ Draft";
    row.innerHTML = `
     <td><input type="checkbox" class="bill-checkbox" value="${doc.id}" onchange="updateSelectionSummary()"></td>
      <td>${serialNo}</td>
      <td>${billDate}</td>
      <td>${customerName}</td>
      <td>${getStatusHtml(bill)}</td>
      <td><strong style="color:${
        workflow.includes("Locked") ? "#343a40" : workflow.includes("Approved") ? "#6f42c1" : "#6c757d"
      };">${workflow}</strong></td>
      <td>${billType}</td>
      <td>${formatNumber(bill["Final Total"])}</td>
      <td class="action-buttons">
          <button class="view-btn" data-id="${doc.id}">View</button>
          <button class="edit-btn" data-id="${doc.id}" ${
      bill.paymentStatus === "Paid" || bill.locked === true || ['approved', 'locked'].includes(bill.workflowStatus) ? "disabled" : ""
    }>Edit</button>
          <button class="delete-btn" data-id="${doc.id}" data-serial="${serialNo}">Delete</button>
      </td>
    `;
    row.querySelector(".view-btn").addEventListener("click", (event) => viewBill(event.target.dataset.id));
    row.querySelector(".edit-btn").addEventListener("click", (event) => editBill(event.target.dataset.id));
    row
      .querySelector(".delete-btn")
      .addEventListener("click", (event) => deleteBill(event.target.dataset.id, event.target.dataset.serial));
    tableBody.appendChild(row);
  });
}

function renderListPaginationControls(totalItems) {
  const totalPages = Math.ceil(totalItems / itemsPerPageForList) || 1;
  const pageInfoEl = document.getElementById("page_info_list");
  const prevBtnEl = document.getElementById("prev_page_list_btn");
  const nextBtnEl = document.getElementById("next_page_list_btn");
  if (pageInfoEl) pageInfoEl.textContent = `Page ${currentPageForList} of ${totalPages}`;
  if (prevBtnEl) prevBtnEl.disabled = currentPageForList === 1;
  if (nextBtnEl) nextBtnEl.disabled = currentPageForList >= totalPages;
}

function goToNextListPage() {
  const filteredList = getFilteredBills();
  const totalPages = Math.ceil(filteredList.length / itemsPerPageForList);

  if (currentPageForList < totalPages) {
    currentPageForList++;
    filterAndRenderList();
  }
}

function goToPrevListPage() {
  if (currentPageForList > 1) {
    currentPageForList--;
    filterAndRenderList();
  }
}
function viewBill(docId) {
  window.location.href = `final.html?id=${docId}`;
}
function editBill(docId) {
  const entry = allBillsForList.find(doc => doc.id === docId);
  const bill = entry?.data();
  if (bill && (bill.locked === true || ['approved', 'locked'].includes(bill.workflowStatus))) {
    Swal.fire("Approved bill protected", "Approved bills cannot be edited. The original date, items and amounts must remain unchanged.", "info");
    return;
  }
  // Phase 3 (item #14): no more pre-fetch + localStorage — bill-create.html
  // fetches the bill fresh itself using ?editId=, so it's always up to date.
  window.location.href = `bill-create.html?editId=${docId}`;
}
async function deleteBill(docId, serialNo) {
  try {
    const billDoc = await billsCollection.doc(docId).get();
    const bill = billDoc.exists ? billDoc.data() : null;
    const hasRecordedPayment =
      bill && (Number(bill.amountPaid || 0) > 0 || ["Paid", "Partial", "Partially Paid"].includes(bill.paymentStatus));
    if (bill && (bill.locked === true || ['approved', 'locked'].includes(bill.workflowStatus))) {
      Swal.fire(
        "Delete blocked",
        "This bill is locked as a final accounting record. Create a correction bill if a change is needed.",
        "warning"
      );
      return;
    }
    if (hasRecordedPayment) {
      Swal.fire(
        "Delete blocked",
        "A partially or fully paid bill cannot be deleted. Keep it for payment and audit records.",
        "warning"
      );
      return;
    }
  } catch (error) {
    Swal.fire("Could not verify bill", "Please try again when the connection is available.", "error");
    return;
  }
  const result = await Swal.fire({
    title: "Are you sure?",
    text: `Archive Bill No. ${serialNo}? The record stays in the recovery backup and an Admin can restore eligible unpaid bills.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc3545", // Red color for the confirm button
    cancelButtonColor: "#6c757d", // Gray for cancel
    confirmButtonText: "Yes, archive it",
  });

  // If the user clicked the "Yes, delete it!" button
  if (result.isConfirmed) {
    showLoading("Deleting bill...");
    try {
      // Never fall back to permanent deletion if the archive module fails.
      if (typeof softDeleteBill === "function") {
        const done = await softDeleteBill(docId);
        if (!done) return;
      } else {
        throw new Error("Safe archive module did not load. Reload the page; nothing was permanently deleted.");
      }
      Swal.fire({
        title: "Archived",
        text: `Bill No. ${serialNo} is archived, not permanently deleted.`,
        icon: "success",
        timer: 2000, // Automatically close after 2 seconds
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error removing document: ", error);
      Swal.fire("Error!", "Could not delete the bill. Please try again when online.", "error");
    } finally {
      hideLoading();
    }
  }
}
function toggleSelectAll(source) {
  const checkboxes = document.querySelectorAll(".bill-checkbox");
  for (let i = 0; i < checkboxes.length; i++) {
    checkboxes[i].checked = source.checked;
  }
  updateSelectionSummary();
}
async function exportSelectedBills() {
  showLoading("Preparing download...");
  const format = document.getElementById("export_format").value;
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one bill to download.");
    hideLoading();
    return;
  }

  const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

  const billPromises = selectedIds.map((id) => billsCollection.doc(id).get());
  const billDocs = await Promise.all(billPromises);
  const billsData = billDocs.map((doc) => doc.data());

  if (format === "excel") {
    downloadAsExcel(billsData);
  } else if (format === "pdf") {
    downloadAsPDF(billsData);
  }

  hideLoading();
}
function downloadAsExcel(billsData) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(billsData);
  XLSX.utils.book_append_sheet(wb, ws, "Bills");
  XLSX.writeFile(wb, "GaneshAgri_Bills.xlsx");
}
function downloadAsPDF(billsData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const tableColumns = ["Bill No.", "Date", "Customer Name", "Bill Type", "Final Total"];
  const tableRows = [];

  billsData.forEach((bill) => {
    const billData = [
      bill["Serial No"],
      bill["Date"],
      bill["Customer Name"],
      bill["Bill Type"],
      formatNumber(bill["Final Total"]),
    ];
    tableRows.push(billData);
  });

  doc.autoTable({
    head: [tableColumns],
    body: tableRows,
    startY: 20,
  });

  doc.text(
    "`${globalSettings && globalSettings.companyName ? globalSettings.companyName : 'Company'} - Bill Report",
    14,
    15
  );
  doc.save("GaneshAgri_Bills.pdf");
}
// MOVED to core-engine.js — checkFirebaseConnection() is now a shared utility
// since the navbar's connection button needs it on every page, not just here.
function uploadBills() {
  const fileInput = document.getElementById("upload_file_input");
  const file = fileInput.files[0];
  const uploadStatus = document.getElementById("upload_status");

  if (!file) {
    uploadStatus.textContent = "Please select a file to upload.";
    uploadStatus.style.color = "red";
    return;
  }

  showLoading("Uploading bills...");
  uploadStatus.textContent = "Uploading...";
  uploadStatus.style.color = "orange";

  const reader = new FileReader();
  reader.onload = function (event) {
    const data = new Uint8Array(event.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonBills = XLSX.utils.sheet_to_json(worksheet);

    if (jsonBills.length === 0) {
      uploadStatus.textContent = "The selected file is empty or not in the correct format.";
      uploadStatus.style.color = "red";
      hideLoading();
      return;
    }

    processUploadedBills(jsonBills, uploadStatus);
  };
  reader.readAsArrayBuffer(file);
}
/**
 * Phase 4 (item #19): Excel stores dates as serial numbers (days since
 * 1899-12-30) OR as native JS Date objects (depending on the cell format
 * SheetJS detected) — neither is the "DD/MM/YYYY" string this app expects
 * everywhere else. This converts either form back to that string; if the
 * value is already a plain string, it's returned as-is.
 */
function excelDateToDDMMYYYY(value) {
  if (!value) return new Date().toLocaleDateString("en-IN");
  if (typeof value === "string") return value; // already a string — trust it
  let dateObj;
  if (value instanceof Date) {
    dateObj = value;
  } else if (typeof value === "number") {
    // Excel serial date -> JS Date (Excel's epoch is 1899-12-30)
    dateObj = new Date(Math.round((value - 25569) * 86400 * 1000));
  } else {
    return new Date().toLocaleDateString("en-IN");
  }
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function processUploadedBills(bills, statusElement) {
  let successCount = 0;
  let errorCount = 0;
  let missingSerialCount = 0;
  let duplicateCount = 0;
  const duplicateNumbers = [];

  // Build a set of every Serial No already in the database — including
  // soft-deleted bills, since a deleted bill's number should never be
  // reused either — so we can catch collisions before importing.
  const existingSerialsSnap = await billsCollection.get();
  const existingSerials = new Set();
  existingSerialsSnap.docs.forEach((d) => {
    const sn = d.data()["Serial No"];
    if (sn) existingSerials.add(String(sn));
  });

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];

    // Phase 4 (item #19, plus item #12's spirit): do NOT invent Serial
    // Numbers here via a local counter — that could collide with the live
    // Firestore transactional counter used by the normal bill-creation flow.
    // Preserve whatever Serial No the file already has (supports both
    // "Serial No" and "Bill No" column names, since the Excel backup export
    // in backup.js writes the column as "Bill No"). If a row has neither,
    // flag it clearly instead of guessing a number.
    const originalSerial = bill["Serial No"] || bill["Bill No"];
    const serialNo = originalSerial || `IMPORT-NEEDS-REVIEW-${i + 1}`;
    if (!originalSerial) missingSerialCount++;

    // Duplicate check — a number already used by ANY bill (active or
    // soft-deleted) is skipped rather than silently creating a second bill
    // with the same Serial No.
    if (originalSerial && existingSerials.has(String(serialNo))) {
      duplicateCount++;
      duplicateNumbers.push(String(serialNo));
      continue;
    }

    // Remap data from the Excel file columns to the database schema
    const billData = {
      "Serial No": serialNo,
      "Customer Name": bill["Customer Name"] || "",
      "Vehicle No": bill["Vehicle No"] || "",
      Village: bill["Village"] || "",
      Broker: bill["Broker"] || "",
      "Bill Type": bill["Bill Type"] || "Bag",
      "Weighbridge Weight": bill["Weighbridge Weight"] || 0,
      Kasar: bill["Kasar"] || 0,
      "Bardan Weight": bill["Bardan Weight"] || 0,
      "Net Weight": bill["Net Weight"] || 0,
      "Vakal 1 Katta": bill["Vakal 1 Katta"] || 0,
      "Vakal 1 Kilo": bill["Vakal 1 Kilo"] || 0,
      "Vakal 1 Bhav": bill["Vakal 1 Bhav"] || 0,
      "Vakal 1 Amount": bill["Vakal 1 Amount"] || 0,
      // ... include all other vakals and fields from your schema
      "Total Amount": bill["Total Amount"] || 0,
      Utrāī: bill["Utrāī"] || 0,
      "Final Total": bill["Final Total"] || 0,
      Expenses: JSON.stringify(bill["Expenses"] || []),
      Date: excelDateToDDMMYYYY(bill["Date"]),
      importedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await billsCollection.add(billData);
      existingSerials.add(String(serialNo)); // catches duplicates within the same file too
      successCount++;
    } catch (error) {
      console.error("Error adding uploaded bill:", bill, error);
      errorCount++;
    }
  }

  let statusMsg = `Upload complete: ${successCount} bills added, ${errorCount} bills failed.`;
  if (missingSerialCount > 0) {
    statusMsg += ` ⚠️ ${missingSerialCount} bill(s) had no Serial No in the file — marked "IMPORT-NEEDS-REVIEW-#", please fix manually.`;
  }
  if (duplicateCount > 0) {
    statusMsg += ` ⚠️ ${duplicateCount} bill(s) skipped — Serial No already used (${duplicateNumbers
      .slice(0, 10)
      .join(", ")}${duplicateNumbers.length > 10 ? ", ..." : ""}).`;
  }
  statusElement.textContent = statusMsg;
  statusElement.style.color = errorCount === 0 && missingSerialCount === 0 && duplicateCount === 0 ? "green" : "orange";

  hideLoading();
  // Reload the bill list to show new data
  showBillListView();
}
function filterData(period, searchTerm = null) {
  let filteredBills = allBillsForList;

  if (searchTerm) {
    const lowerCaseSearch = searchTerm.toLowerCase();
    filteredBills = allBillsForList.filter((bill) => {
      const name = (bill["Customer Name"] || "").toLowerCase();
      const village = (bill["Village"] || "").toLowerCase();
      const vehicle = (bill["Vehicle No"] || "").toLowerCase();
      const serial = String(bill["Serial No"] || "").toLowerCase();
      const broker = bill["Broker"] ? bill["Broker"].toLowerCase() : "";
      const billType = bill["Bill Type"] ? bill["Bill Type"].toLowerCase() : "";
      const WeighbridgeWeight = String(bill["Weighbridge Weight"]);

      return (
        name.includes(lowerCaseSearch) ||
        village.includes(lowerCaseSearch) ||
        vehicle.includes(lowerCaseSearch) ||
        broker.includes(lowerCaseSearch) ||
        billType.includes(lowerCaseSearch) ||
        WeighbridgeWeight.includes(lowerCaseSearch) ||
        serial.includes(lowerCaseSearch)
      );
    });
  }

  renderBillList(filteredBills.map((bill) => ({ id: bill.id, data: () => bill })));
}
// Add this new function to both bill-list.js and dashboard.js

function updateSelectionSummary() {
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox:checked");
  const summaryElement = document.getElementById("selection-summary");

  if (selectedCheckboxes.length > 0) {
    const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

    // Use the correct global variable for each page
    const billSource = typeof allBillsForList !== "undefined" ? allBillsForList : currentlyDisplayedBills;

    const selectedBills = billSource.filter((bill) => selectedIds.includes(bill.id));

    const totalAmount = selectedBills.reduce((sum, bill) => sum + Number(bill.data()["Final Total"] || 0), 0);

    summaryElement.style.display = "block";
    summaryElement.innerHTML = `Selected ${
      selectedBills.length
    } bill(s) | Total: <span style="color: #005a9e;">${formatNumber(totalAmount)}</span>`;
  } else {
    summaryElement.innerHTML = ""; // Clear the summary if nothing is selected
    summaryElement.style.display = "none";
  }
}

// Ye code page load hote hi bills fetch karna shuru kar dega
document.addEventListener("DOMContentLoaded", () => {
  // Check karega ki hum bills.html par hain ya nahi
  if (document.getElementById("bill_list_view")) {
    showBillListView();
  }
});
