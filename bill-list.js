let allBillsForList = [];
let currentPageForList = 1;
const itemsPerPageForList = 25;

let billListInitialized = false;

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
    if (searchEl) searchEl.addEventListener("input", (e) => filterAndRenderList(e.target.value));
    if (prevBtn) prevBtn.addEventListener("click", goToPrevListPage);
    if (nextBtn) nextBtn.addEventListener("click", goToNextListPage);
    if (paidBtn) paidBtn.addEventListener("click", markSelectedBillsAsPaid);
  }

  billsCollection.orderBy("Serial No", "desc").onSnapshot((snapshot) => {
    const syncStatus = document.getElementById("sync_status");
    if (snapshot.metadata.hasPendingWrites) {
      syncStatus.textContent = "Offline. Changes will sync when online.";
      syncStatus.style.color = "orange";
    } else {
      const now = new Date();
      const formattedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
      syncStatus.textContent = `All data synced. (Last sync: ${formattedTime})`;
      syncStatus.style.color = "green";
    }

    allBillsForList = snapshot.docs;
    currentPageForList = 1;

    filterAndRenderList();
    hideLoading();
  });
}

function filterAndRenderList(searchTerm = null) {
  let billsToDisplay = allBillsForList;

  if (searchTerm) {
    const lowerCaseSearch = searchTerm.toLowerCase();
    billsToDisplay = allBillsForList.filter((doc) => {
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
function showBillCreationForm() {
  document.getElementById("bill_list_view").style.display = "none";
  document.getElementById("bill_creation_form").style.display = "block";
}
// Add this new function to bill-list.js and dashboard.js

function getStatusHtml(bill) {
  const status = bill.paymentStatus || "Unpaid";
  const amountPaid = bill.amountPaid || 0;
  const finalTotal = bill["Final Total"] || 0;
  // Use a helper function to format numbers, assuming you have one in utils.js
  const formattedAmountPaid = typeof formatNumber === "function" ? formatNumber(amountPaid) : amountPaid;
  const formattedFinalTotal = typeof formatNumber === "function" ? formatNumber(finalTotal) : finalTotal;

  const dotClass = status.toLowerCase().replace(" ", "-");

  switch (status) {
    case "Paid":
      return `<span class="status-dot ${dotClass}"></span> Paid`;
    case "Partially Paid":
      return `<span class="status-dot ${dotClass}"></span> Partial<br><small>(${formattedAmountPaid} / ${formattedFinalTotal})</small>`;
    case "Unpaid":
    default:
      return `<span class="status-dot unpaid"></span> Unpaid`;
  }
}
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
  document.getElementById("page_info_list").textContent = `Page ${currentPageForList} of ${totalPages}`;
  document.getElementById("prev_page_list_btn").disabled = currentPageForList === 1;
  document.getElementById("next_page_list_btn").disabled = currentPageForList >= totalPages;
}

function goToNextListPage() {
  // We get the total number of items from the currently filtered list to calculate total pages
  const searchTerm = document.getElementById("search_input_list").value;
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
  showLoading("Fetching bill for editing...");
  billsCollection
    .doc(docId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        localStorage.setItem("editBillData", JSON.stringify({ ...doc.data(), id: doc.id }));
        window.location.href = "index.html";
      } else {
        alert("Could not find this bill. It might not be synced yet.");
      }
    })
    .catch((error) => {
      console.error("Error fetching bill for edit:", error);
      alert("Could not load the bill. Please try again.");
    })
    .finally(() => {
      hideLoading();
    });
}
async function deleteBill(docId, serialNo) {
  const result = await Swal.fire({
    title: "Are you sure?",
    text: `You are about to delete Bill No. ${serialNo}. This cannot be undone.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#dc3545", // Red color for the confirm button
    cancelButtonColor: "#6c757d", // Gray for cancel
    confirmButtonText: "Yes, delete it!",
  });

  // If the user clicked the "Yes, delete it!" button
  if (result.isConfirmed) {
    showLoading("Deleting bill...");
    try {
      await billsCollection.doc(docId).delete();
      Swal.fire({
        title: "Deleted!",
        text: `Bill No. ${serialNo} has been deleted.`,
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

  doc.text("Ganesh Agri Industries - Bill Report", 14, 15);
  doc.save("GaneshAgri_Bills.pdf");
}
function checkFirebaseConnection() {
  showLoading("Checking connection...");
  const connectionStatus = document.getElementById("connection_status");
  // Force the get() call to check the server directly
  billsCollection
    .limit(1)
    .get({ source: "server" })
    .then(() => {
      connectionStatus.textContent = "Connected!";
      connectionStatus.className = "connected"; // Set a class for green color
    })
    .catch(() => {
      connectionStatus.textContent = "Disconnected.";
      connectionStatus.className = "disconnected"; // Set a class for red color
    })
    .finally(() => {
      hideLoading();
    });
}
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
async function processUploadedBills(bills, statusElement) {
  let successCount = 0;
  let errorCount = 0;
  const lastSerialNo = Number(localStorage.getItem("lastSerialNo")) || 0;
  let currentSerialNo = lastSerialNo;

  for (const bill of bills) {
    currentSerialNo++;

    // Remap data from the Excel file columns to the database schema
    const billData = {
      "Serial No": currentSerialNo,
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
      Date: bill["Date"] || new Date().toLocaleDateString("en-IN"),
    };

    try {
      await billsCollection.add(billData);
      successCount++;
    } catch (error) {
      console.error("Error adding uploaded bill:", bill, error);
      errorCount++;
    }
  }

  // Update last serial number
  localStorage.setItem("lastSerialNo", currentSerialNo);

  statusElement.textContent = `Upload complete: ${successCount} bills added, ${errorCount} bills failed.`;
  statusElement.style.color = errorCount === 0 ? "green" : "red";

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
