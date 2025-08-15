// --- 1. FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyCjYTkXGs8_xVyi9ij7H5AS4Zk1oh1VxzU",
  authDomain: "ganeshagribilling.firebaseapp.com",
  projectId: "ganeshagribilling",
  storageBucket: "ganeshagribilling.firebasestorage.app",
  messagingSenderId: "99624726079",
  appId: "1:99624726079:web:4c5aa1f7341ff40e8cd28a",
  measurementId: "G-3XXY4BCZPL",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const billsCollection = db.collection("bills");

// --- GLOBAL VARIABLES ---
let allBillsData = [];
let currentlyDisplayedBills = [];
let currentBillIdInModal = null;

// --- 2. MAIN INITIALIZATION ---
document.addEventListener("DOMContentLoaded", function () {
  initializeDashboard();
});

function initializeDashboard() {
  fetchAllBills();
  // Attach event listeners for filter buttons
  document.getElementById("today_btn").addEventListener("click", () => filterData("today"));
  document.getElementById("last7days_btn").addEventListener("click", () => filterData("last7days"));
  document.getElementById("month_btn").addEventListener("click", () => filterData("month"));
  document.getElementById("year_btn").addEventListener("click", () => filterData("year"));
  document.getElementById("custom_date_filter_btn").addEventListener("click", () => filterData("custom"));
  document.getElementById("modal-download-btn").addEventListener("click", () => {
    if (currentBillIdInModal) {
      downloadFormattedBill(currentBillIdInModal);
    }
  });
}

// --- 3. DATA FETCHING & FILTERING ---
async function fetchAllBills() {
  try {
    const snapshot = await billsCollection.orderBy("Serial No", "desc").get();
    allBillsData = snapshot.docs.map((doc) => {
      const data = doc.data();
      const dateParts = data.Date.split("/");
      const isoDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      return { id: doc.id, ...data, jsDate: new Date(isoDate) };
    });
    updateDashboard(allBillsData);
  } catch (error) {
    console.error("Error fetching bills:", error);
    alert("Could not load bill data.");
  } finally {
    // This will run whether the fetch was successful or not
    updateSyncTime();
  }
}

// Add this function somewhere in your dashboard.js file
function updateSyncTime() {
  const syncStatusElement = document.getElementById("dashboard_sync_status");
  if (syncStatusElement) {
    const now = new Date();
    const formattedTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(
      2,
      "0"
    )}:${String(now.getSeconds()).padStart(2, "0")}`;
    syncStatusElement.textContent = `Last synced: ${formattedTime}`;
    syncStatusElement.style.color = `green`;
    syncStatusElement.style.fontSize = `28px`;
    syncStatusElement.style.textAlign = `center`;
    syncStatusElement.style.fontWeight = `600`;
  }
}

function filterData(period) {
  const now = new Date();
  let startDate, endDate;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "today") {
    startDate = today;
    endDate = today;
  } else if (period === "last7days") {
    endDate = today;
    startDate = new Date(today);
    startDate.setDate(today.getDate() - 6);
  } else if (period === "month") {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (period === "year") {
    startDate = new Date(today.getFullYear(), 0, 1);
    endDate = new Date(today.getFullYear(), 11, 31);
  } else if (period === "custom") {
    const startValue = document.getElementById("start_date").value;
    const endValue = document.getElementById("end_date").value;
    if (!startValue || !endValue) {
      alert("Please select both a start and end date.");
      return;
    }
    startDate = new Date(startValue);
    endDate = new Date(endValue);
  }

  const filteredBills = allBillsData.filter((bill) => bill.jsDate >= startDate && bill.jsDate <= endDate);
  updateDashboard(filteredBills);
}

// --- 4. ANALYTICS & DASHBOARD UPDATING ---
function updateDashboard(billsToDisplay) {
  currentlyDisplayedBills = billsToDisplay;
  recalculateKPIs();
  renderBillList(billsToDisplay);
}

function recalculateKPIs() {
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox:checked");
  let billsToCalculate = [];

  if (selectedCheckboxes.length > 0) {
    const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
    billsToCalculate = currentlyDisplayedBills.filter((bill) => selectedIds.includes(bill.id));
  } else {
    billsToCalculate = currentlyDisplayedBills;
  }

  const totalPurchases = billsToCalculate.reduce((sum, bill) => sum + bill["Final Total"], 0);
  const totalWeight = billsToCalculate.reduce((sum, bill) => sum + bill["Net Weight"], 0);
  const totalBills = billsToCalculate.length;
  const avgPrice = calculateAveragePrice(billsToCalculate);

  document.getElementById("kpi-total-purchases").textContent = `₹${totalPurchases.toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-weight").textContent = `${totalWeight.toLocaleString("en-IN")} kg`;
  document.getElementById("kpi-total-bills").textContent = totalBills;
  document.getElementById("kpi-avg-price").textContent = `₹${avgPrice.toFixed(2)}`;
}

function calculateAveragePrice(bills) {
  let grandTotalAmount = 0,
    grandTotalKilos = 0;
  bills.forEach((bill) => {
    if (bill["Bill Type"] === "Loose") {
      grandTotalAmount += bill["Vakal 1 Amount"];
      grandTotalKilos += bill["Vakal 1 Kilo"];
    } else {
      for (let i = 1; i <= 5; i++) {
        if (bill[`Vakal ${i} Katta`] > 0) {
          grandTotalAmount += bill[`Vakal ${i} Amount`];
          grandTotalKilos += bill[`Vakal ${i} Kilo`];
        }
      }
    }
  });
  if (grandTotalKilos === 0) return 0;
  return (grandTotalAmount / grandTotalKilos) * 20;
}

// --- 5. UI RENDERING AND MODAL FUNCTIONS ---
function renderBillList(docs) {
  const tableBody = document.getElementById("dashboard_bill_list_body");
  tableBody.innerHTML = "";
  docs.forEach((bill) => {
    const row = document.createElement("tr");
    row.innerHTML = `
              <td><input type="checkbox" class="bill-checkbox" value="${bill.id}" onchange="recalculateKPIs()"></td>
              <td>${bill["Serial No"]}</td>
              <td>${bill["Date"]}</td>
              <td>${bill["Customer Name"]}</td>
              <td>${bill["Bill Type"]}</td>
              <td>${Number(bill["Final Total"]).toLocaleString("en-IN")}</td>
              <td class="action-buttons">
                  <button class="view-btn" onclick="viewBillInModal('${bill.id}')">View</button>
              </td>
          `;
    tableBody.appendChild(row);
  });
  document.getElementById("select_all_bills").checked = false;
}

function toggleSelectAll(source) {
  const checkboxes = document.querySelectorAll(".bill-checkbox");
  checkboxes.forEach((checkbox) => (checkbox.checked = source.checked));
  recalculateKPIs();
}

async function viewBillInModal(docId) {
  try {
    const doc = await billsCollection.doc(docId).get();
    if (doc.exists) {
      currentBillIdInModal = doc.id;
      const billData = doc.data();
      const modalContent = document.getElementById("modal-bill-content");
      const modalOverlay = document.getElementById("view-bill-modal");
      modalContent.innerHTML = generateBillHtmlForView(billData);
      modalOverlay.style.display = "flex";
    } else {
      alert("Could not find this bill.");
    }
  } catch (error) {
    console.error("Error fetching bill for view:", error);
  }
}

function closeBillView() {
  document.getElementById("view-bill-modal").style.display = "none";
  currentBillIdInModal = null;
}

async function downloadFormattedBill(docId) {
  const pdfContainer = document.getElementById("pdf-render-container");
  try {
    const [billDoc, cssResponse] = await Promise.all([billsCollection.doc(docId).get(), fetch("html.css")]);
    if (!billDoc.exists) throw new Error("Bill not found!");
    const billData = billDoc.data();
    const cssText = await cssResponse.text();
    const billHtml = generateBillHtmlForView(billData);
    pdfContainer.innerHTML = `<style>${cssText}</style>${billHtml}`;
    pdfContainer.style.position = "absolute";
    pdfContainer.style.left = "-9999px";
    pdfContainer.style.display = "block";
    const canvas = await html2canvas(pdfContainer.querySelector(".container"), { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4", true);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");
    pdf.save(`Bill No-${billData["Serial No"]}-${billData["Customer Name"]}.pdf`);
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    alert("Could not create PDF. Please try again.");
  } finally {
    pdfContainer.innerHTML = "";
    pdfContainer.style.display = "none";
    pdfContainer.style.position = "";
    pdfContainer.style.left = "";
  }
}

function generateBillHtmlForView(data) {
  let vakalRows = "";
  if (data["Bill Type"] === "Loose") {
    vakalRows = `<tr><td>Loose Supply</td><td>-</td><td>${data["Vakal 1 Kilo"]}</td><td>${
      data["Vakal 1 Bhav"]
    }</td><td style="font-weight:bolder;">${Number(data["Vakal 1 Amount"]).toLocaleString("en-IN")}</td></tr>`;
  } else {
    for (let i = 1; i <= 5; i++) {
      if (data[`Vakal ${i} Katta`] > 0) {
        vakalRows += `<tr><td>વકલ ${i}</td><td>${data[`Vakal ${i} Katta`]}</td><td>${data[`Vakal ${i} Kilo`]}</td><td>${
          data[`Vakal ${i} Bhav`]
        }</td><td style="font-weight:bolder;">${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}</td></tr>`;
      }
    }
  }
  const customerDetailsHtml = `<div class="detail-line"><span class="detail-label-enter">નામ :</span><span class="detail-value-line">${data["Customer Name"]}</span><span class="detail-label-enter">ગાડી નં :</span><span class="detail-value-line">${data["Vehicle No"]}</span></div><div class="detail-line"><span class="detail-label-enter">ગામ :</span><span class="detail-value-line">${data["Village"]}</span><span class="detail-label-enter">દલાલ :</span><span class="detail-value-line">${data["Broker"]}</span></div>`;
  return `<div class="container" style="margin:0;box-shadow:none;border:none;"><div class="header"><h1>Final Bill</h1></div><div class="bill-meta"><div class="meta-item"><span>Bill No:</span> <span>${
    data["Serial No"]
  }</span></div><div class="meta-item"><span>Date:</span> <span>${
    data["Date"]
  }</span></div></div><div class="print-only-details" style="display:block;">${customerDetailsHtml}</div><div class="details-grid"><div class="detail-item"><span class="detail-label">વેબ્રીજ વજન</span><span class="detail-value">${
    data["Weighbridge Weight"]
  }</span></div><div class="detail-item"><span class="detail-label">કાંટા કસર</span><span class="detail-value">${
    data["Kasar"]
  }</span></div><div class="detail-item"><span class="detail-label">બારદાન વજન</span><span class="detail-value">${
    data["Bardan Weight"]
  }</span></div><div class="detail-item summary-item"><span class="detail-label">નેટ વજન</span><span class="detail-value" style="font-weight:bolder;">${
    data["Net Weight"]
  }</span></div></div><table class="final-bill-table"><thead><tr><th>વકલ</th><th>કટ્ટા</th><th>કિલો</th><th>ભાવ</th><th>રૂપિયા</th></tr></thead><tbody>${vakalRows}</tbody></table><div class="totals-grid"><div class="detail-item"><span class="detail-label">ટોટલ રૂપિયા</span><span class="detail-value">${Number(
    data["Total Amount"]
  ).toLocaleString(
    "en-IN"
  )}</span></div><div class="detail-item"><span class="detail-label">ઉતરાઈ</span><span class="detail-value">${Number(
    data["Utrāī"]
  ).toLocaleString(
    "en-IN"
  )}</span></div><div class="detail-item final-total-box"><span class="detail-label">ફાઇનલ ટોટલ</span><span class="detail-value" style="font-weight:bolder;">${Number(
    data["Final Total"]
  ).toLocaleString("en-IN")}</span></div></div></div>`;
}
