function showBillListView() {
  document.getElementById("bill_creation_form").style.display = "none";
  document.getElementById("view_all_bills_btn").style.display = "none";
  document.getElementById("bill_list_view").style.display = "block";
  showLoading();

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

    const serverBills = snapshot.docs.map((doc) => doc.data());
    const lastServerNo = serverBills.reduce((max, bill) => Math.max(max, bill["Serial No"]), 0);
    if (lastServerNo > 0) {
      localStorage.setItem("lastSerialNo", lastServerNo);
    }

    renderBillList(snapshot.docs);
    hideLoading();
  });
}
function showBillCreationForm() {
  document.getElementById("bill_list_view").style.display = "none";
  document.getElementById("bill_creation_form").style.display = "block";
  document.getElementById("view_all_bills_btn").style.display = "block";
}
function renderBillList(docs) {
  const tableBody = document.getElementById("bill_list_body");
  tableBody.innerHTML = "";
  if (docs.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No bills saved yet.</td></tr>';
    return;
  }

  docs.forEach((doc) => {
    const bill = doc.data();
    const row = document.createElement("tr");
    row.innerHTML = `
              <td><input type="checkbox" class="bill-checkbox" value="${doc.id}"></td>
              <td>${bill["Serial No"]}</td>
              <td>${bill["Date"]}</td>
              <td>${bill["Customer Name"]}</td>
              <td>${bill["Bill Type"]}</td>
              <td>${formatNumber(bill["Final Total"])}</td>
              <td class="action-buttons">
                  <button class="view-btn" onclick="viewBill('${doc.id}')">View</button>
                  <button class="edit-btn" onclick="editBill('${doc.id}')">Edit</button>
                  <button class="delete-btn" onclick="deleteBill('${doc.id}', ${bill["Serial No"]})">Delete</button>
              </td>
          `;
    tableBody.appendChild(row);
  });
}
function viewBill(docId) {
  showLoading("Fetching bill details...");
  billsCollection
    .doc(docId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        localStorage.setItem("currentBill", JSON.stringify({ ...doc.data(), id: doc.id }));
        window.location.href = `final.html?id=${docId}`;
      } else {
        alert("Could not find this bill. It might not be synced yet.");
      }
    })
    .catch((error) => {
      console.error("Error fetching bill for view:", error);
      alert("Could not load the bill. Please try again.");
    })
    .finally(() => {
      hideLoading();
    });
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
function deleteBill(docId, serialNo) {
  if (confirm(`Are you sure you want to delete Bill No. ${serialNo}? This cannot be undone.`)) {
    showLoading("Deleting bill...");
    billsCollection
      .doc(docId)
      .delete()
      .catch((error) => {
        console.error("Error removing document: ", error);
        alert("Could not delete the bill. Please try again when online.");
      })
      .finally(() => {
        hideLoading();
      });
  }
}
function toggleSelectAll(source) {
  const checkboxes = document.querySelectorAll(".bill-checkbox");
  for (let i = 0; i < checkboxes.length; i++) {
    checkboxes[i].checked = source.checked;
  }
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
