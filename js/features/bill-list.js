let allBillsForList = [];
let currentPageForList = 1;
const itemsPerPageForList = 25;

let billListInitialized = false;

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
    if (searchEl)
      searchEl.addEventListener(
        "input",
        debounce((e) => filterAndRenderList(e.target.value), 500)
      );
    if (prevBtn) prevBtn.addEventListener("click", goToPrevListPage);
    if (nextBtn) nextBtn.addEventListener("click", goToNextListPage);
    if (paidBtn) paidBtn.addEventListener("click", markSelectedBillsAsPaid);
  }

  // Detach any previously-active listener before attaching a new one
  if (unsubscribeBillsListener) {
    unsubscribeBillsListener();
    unsubscribeBillsListener = null;
  }

  unsubscribeBillsListener = billsCollection
    .orderBy("Serial No", "desc")
    .limit(200) // Phase 3 (item #15): cap the live list to the 200 most recent bills
    .onSnapshot((snapshot) => {
      const syncStatus = document.getElementById("sync_status");
      if (syncStatus) {
        if (snapshot.metadata.hasPendingWrites) {
          syncStatus.textContent = "Offline. Changes will sync when online.";
          syncStatus.style.color = "orange";
        } else {
          const now = new Date();
          const formattedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
          syncStatus.textContent = `All data synced. (Last sync: ${formattedTime})`;
          syncStatus.style.color = "green";
        }
      }

      allBillsForList = snapshot.docs;
      currentPageForList = 1;

      filterAndRenderList();
      hideLoading();
    });
}

function filterAndRenderList(searchTerm = null) {
  // ✅ NAYA LOGIC: Saare bills mein se 'Cancelled' bills ko pehle hi hata do
  let activeBills = allBillsForList.filter((doc) => {
    const bill = doc.data();
    return bill.isCancelled !== true; // Sirf wahi bills rakho jo cancel NAHI hue hain
  });

  let billsToDisplay = activeBills;

  // Search wala purana logic
  if (searchTerm) {
    const lowerCaseSearch = searchTerm.toLowerCase();
    billsToDisplay = activeBills.filter((doc) => {
      const bill = doc.data();
      const searchString = [bill["Serial No"], bill["Customer Name"], bill["Village"], bill["Vehicle No"]]
        .join(" ")
        .toLowerCase();
      return searchString.includes(lowerCaseSearch);
    });
  }

  const start = (currentPageForList - 1) * itemsPerPageForList;
  const end = start + itemsPerPageForList;
  const billsForCurrentPage = billsToDisplay.slice(start, end);

  renderBillList(billsForCurrentPage);
  renderListPaginationControls(billsToDisplay.length);
}
async function markSelectedBillsAsPaid() {
  const selectedCheckboxes = document.querySelectorAll("#bill_list_view .bill-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    Swal.fire("No Bills Selected", "Please select one or more bills to mark as paid.", "info");
    return;
  }

  const result = await Swal.fire({
    title: "Are you sure?",
    text: `You are about to mark ${selectedCheckboxes.length} bill(s) as Paid.`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#28a745",
    confirmButtonText: "Yes, mark as Paid!",
  });

  if (result.isConfirmed) {
    showLoading("Updating bills...");

    try {
      const batch = db.batch();
      const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

      // --- CORRECTED PART ---
      // Ensure we use 'allBillsForList', which is the correct variable for this page
      const billsToUpdate = allBillsForList.filter((bill) => selectedIds.includes(bill.id));

      billsToUpdate.forEach((bill) => {
        const billRef = billsCollection.doc(bill.id);
        batch.update(billRef, {
          paymentStatus: "Paid",
          amountPaid: bill["Final Total"],
          amountDue: 0,
        });
      });

      await batch.commit();

      Swal.fire("Success!", `${selectedCheckboxes.length} bill(s) have been marked as Paid.`, "success");
    } catch (error) {
      console.error("Error marking bills as paid:", error);
      Swal.fire("Error", "Could not update the bills.", "error");
    } finally {
      hideLoading();
    }
  }
}
// REMOVED: showBillCreationForm() — this was leftover from the old single-page
// (index.html) architecture where the form and list lived on the same page and
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
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No bills found.</td></tr>';
    return;
  }

  docs.forEach((doc) => {
    const bill = doc.data();
    const row = document.createElement("tr");
    row.innerHTML = `
     <td><input type="checkbox" class="bill-checkbox" value="${doc.id}" onchange="updateSelectionSummary()"></td>
      <td>${bill["Serial No"]}</td>
      <td>${bill["Date"]}</td>
      <td>${bill["Customer Name"]}</td>
      <td>${getStatusHtml(bill)}</td>
      <td>${bill["Bill Type"]}</td>
      <td>${formatNumber(bill["Final Total"])}</td>
      <td class="action-buttons">
          <button class="view-btn" data-id="${doc.id}">View</button>
          <button class="edit-btn" data-id="${doc.id}" ${bill.paymentStatus === "Paid" ? "disabled" : ""}>Edit</button>
          <button class="delete-btn" data-id="${doc.id}" data-serial="${bill["Serial No"]}">Delete</button>
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
  // We get the total number of items from the currently filtered list to calculate total pages
  const searchTerm = document.getElementById("search_input_list")?.value || "";
  const filteredList = searchTerm
    ? allBillsForList.filter((doc) => JSON.stringify(doc.data()).toLowerCase().includes(searchTerm.toLowerCase()))
    : allBillsForList;
  const totalPages = Math.ceil(filteredList.length / itemsPerPageForList);

  if (currentPageForList < totalPages) {
    currentPageForList++;
    filterAndRenderList(searchTerm);
  }
}

function goToPrevListPage() {
  if (currentPageForList > 1) {
    currentPageForList--;
    filterAndRenderList(document.getElementById("search_input_list").value);
  }
}
function viewBill(docId) {
  window.location.href = `final.html?id=${docId}`;
}
function editBill(docId) {
  // Phase 3 (item #14): no more pre-fetch + localStorage — bill-create.html
  // fetches the bill fresh itself using ?editId=, so it's always up to date.
  window.location.href = `bill-create.html?editId=${docId}`;
}
async function deleteBill(docId, serialNo) {
  const result = await Swal.fire({
    title: "Are you sure?",
    text: `You are about to cancel Bill No. ${serialNo}. This cannot be undone.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc3545", // Red color for the confirm button
    cancelButtonColor: "#6c757d", // Gray for cancel
    confirmButtonText: "Yes, cancel it!",
  });

  // If the user clicked the "Yes, cancel it!" button
  if (result.isConfirmed) {
    showLoading("Canceling bill...");
    try {
      // ✅ YAHAN CHANGE HUA HAI: Hard delete ki jagah Update (Soft Delete) lagaya hai
      await billsCollection.doc(docId).update({
        isCancelled: true,
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(), // Cancel hone ka time bhi save hoga
      });

      Swal.fire({
        title: "Cancelled!",
        text: `Bill No. ${serialNo} has been cancelled.`,
        icon: "success",
        timer: 2000, // Automatically close after 2 seconds
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error cancelling document: ", error);
      Swal.fire("Error!", "Could not cancel the bill. Please try again when online.", "error");
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

  doc.text("Ganesh Agri Industries - Bill Report", 14, 15);
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
  statusElement.textContent = statusMsg;
  statusElement.style.color = errorCount === 0 && missingSerialCount === 0 ? "green" : "orange";

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

    const totalAmount = selectedBills.reduce((sum, bill) => sum + bill["Final Total"], 0);

    summaryElement.innerHTML = `Selected ${
      selectedBills.length
    } bill(s) | Total: <span style="color: #005a9e;">${formatNumber(totalAmount)}</span>`;
  } else {
    summaryElement.innerHTML = ""; // Clear the summary if nothing is selected
  }
}

// Ye code page load hote hi bills fetch karna shuru kar dega
document.addEventListener("DOMContentLoaded", () => {
  // Check karega ki hum bills.html par hain ya nahi
  if (document.getElementById("bill_list_view")) {
    showBillListView();
  }
});
