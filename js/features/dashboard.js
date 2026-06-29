// --- GLOBAL VARIABLES ---
let allBillsData = [];
let currentlyDisplayedBills = [];
let currentBillIdInModal = null;
let currentPage = 1;
const itemsPerPage = 20;

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
  document.getElementById("search_input").addEventListener("input", (event) => filterData(null, event.target.value));

  // Pagination event listeners
  document.getElementById("prev_page_btn").addEventListener("click", goToPreviousPage);
  document.getElementById("next_page_btn").addEventListener("click", goToNextPage);
}

async function fetchAllBills() {
  try {
    // This part stays the same: fetch all bill summaries
    const snapshot = await billsCollection.orderBy("Serial No", "desc").get();

    allBillsData = snapshot.docs.map((doc) => {
      const data = doc.data();
      return { id: doc.id, ...data };
    });

    // --- NEW: Filter for the current month immediately after fetching ---
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // getMonth() is 0-11, so we add 1

    const currentMonthBills = allBillsData.filter((bill) => {
      const [billDay, billMonth, billYear] = bill.Date.split("/").map(Number);
      return billYear === currentYear && billMonth === currentMonth;
    });
    updateDashboard(currentMonthBills);
  } catch (error) {
    console.error("Error fetching bills:", error);
    alert("Could not load bill data.");
  } finally {
    updateSyncTime();
  }
}

function filterData(period, searchTerm = null) {
  let filteredBills = allBillsData;
  currentPage = 1; // Reset to page 1 for new filters

  // 1. Filter by Date
  const now = new Date();
  let startDate, endDate;
  const today = resetTime(new Date());

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
    startDate = resetTime(new Date(startValue));
    endDate = resetTime(new Date(endValue));
  }

  // Apply date filter if a period is selected
  if (period) {
    filteredBills = allBillsData.filter((bill) => {
      const dateParts = bill.Date.split("/");
      const billDate = new Date(dateParts[2], dateParts[1] - 1, dateParts[0]);
      const billDateMidnight = resetTime(billDate);
      return billDateMidnight >= startDate && billDateMidnight <= endDate;
    });
  }

  // 2. Filter by Search Term
  if (searchTerm) {
    const lowerCaseSearch = searchTerm.toLowerCase();
    filteredBills = filteredBills.filter((bill) => {
      const name = bill["Customer Name"] ? bill["Customer Name"].toLowerCase() : "";
      const village = bill["Village"] ? bill["Village"].toLowerCase() : "";
      const broker = bill["Broker"] ? bill["Broker"].toLowerCase() : "";
      const billType = bill["Bill Type"] ? bill["Bill Type"].toLowerCase() : "";
      const vehicle = (bill["Vehicle No"] || "").toLowerCase();
      const serialNo = String(bill["Serial No"]);
      const WeighbridgeWeight = String(bill["Weighbridge Weight"]);

      return (
        name.includes(lowerCaseSearch) ||
        village.includes(lowerCaseSearch) ||
        broker.includes(lowerCaseSearch) ||
        billType.includes(lowerCaseSearch) ||
        serialNo.includes(lowerCaseSearch) ||
        vehicle.includes(lowerCaseSearch) ||
        WeighbridgeWeight.includes(lowerCaseSearch)
      );
    });
  }

  updateDashboard(filteredBills);
}
function updateDashboard(billsToDisplay) {
  currentlyDisplayedBills = billsToDisplay;
  updateKPIs(billsToDisplay);
  renderBillList();
  renderPaginationControls();
  recalculateKPIs();
}
function calculateAveragePrice(bills) {
  let grandFinalTotal = 0;
  grandTotalKilos = 0;
  bills.forEach((bill) => {
    // Sum the final total and net weight for each bill
    grandFinalTotal += bill["Final Total"];
    grandTotalKilos += bill["Net Weight"];
  });

  // Check to avoid division by zero
  if (grandTotalKilos === 0) return 0;

  // Return the total price divided by total kilos, multiplied by 20
  return (grandFinalTotal / grandTotalKilos) * 20;
}

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

function renderBillList() {
  const tableBody = document.getElementById("dashboard_bill_list_body");
  tableBody.innerHTML = "";

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const billsOnPage = currentlyDisplayedBills.slice(start, end);

  billsOnPage.forEach((bill) => {
    const row = document.createElement("tr");
    row.innerHTML = `
              <td><input type="checkbox" class="bill-checkbox" value="${bill.id}" onchange="recalculateKPIs()"></td>
              <td>${bill["Serial No"]}</td>
              <td>${bill["Date"]}</td>
              <td>${bill["Customer Name"]}</td>
              <td>${getStatusHtml(bill)}</td>
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
function renderPaginationControls() {
  const totalPages = Math.ceil(currentlyDisplayedBills.length / itemsPerPage);
  document.getElementById("page_info").textContent = `Page ${currentPage} of ${totalPages}`;

  document.getElementById("prev_page_btn").disabled = currentPage === 1;
  document.getElementById("next_page_btn").disabled = currentPage === totalPages;
}

function goToNextPage() {
  const totalPages = Math.ceil(currentlyDisplayedBills.length / itemsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderBillList();
    renderPaginationControls();
  }
}

function goToPreviousPage() {
  if (currentPage > 1) {
    currentPage--;
    renderBillList();
    renderPaginationControls();
  }
}

async function viewBillInModal(docId) {
  try {
    // Show a loading indicator in the modal
    const modalContent = document.getElementById("modal-bill-content");
    modalContent.innerHTML = "<h3>Loading bill...</h3>";
    const modalOverlay = document.getElementById("view-bill-modal");
    modalOverlay.style.display = "flex";

    // --- NEW: Fetch the FULL document from Firestore ---
    const doc = await billsCollection.doc(docId).get();

    if (doc.exists) {
      currentBillIdInModal = doc.id;
      const billData = doc.data();

      // We need to manually add the truck freight box if it exists
      // because the modal's HTML is generated dynamically
      let finalHtml = generateBillHtmlForView(billData);
      if (billData["Truck Freight"] && billData["Truck Freight"] > 0) {
        // This part is a simplified version of the logic from bill-view.js
        // to add the freight cost to the dynamically generated HTML
        const freightHtml = `
            <div class="detail-item">
              <span class="detail-label">ટ્રક ભાડું (Freight)</span>
              <span class="detail-value" style="color: #28a745;">
                +${Number(billData["Truck Freight"]).toLocaleString("en-IN", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>`;
        // Insert freightHtml before the final total box in the generated string
        finalHtml = finalHtml.replace(
          '<div class="detail-item final-total-box">',
          freightHtml + '<div class="detail-item final-total-box">'
        );
      }

      modalContent.innerHTML = finalHtml;
    } else {
      modalContent.innerHTML = "<h3>Error: Bill not found.</h3>";
    }
  } catch (error) {
    console.error("Error fetching bill for view:", error);
    modalContent.innerHTML = "<h3>Could not load bill details.</h3>";
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

// function generateBillHtmlForView(data) {
//   const deductionSettings = data.DeductionSettings || {
//     kasarPercentage: 0.003,
//     kantanWeight: 0.6,
//     plasticWeight: 0.2,
//     utraiPercentage: 7,
//   };
//   let vakalRows = "";
//   // New variables are defined at the top of the function
//   const kasarLabel = `કાંટા કસર`;
//   const utraiLabel = `ઉતરાઈ`;

//   let bardanHtml;
//   // If the new fields exist, show separate boxes
//   if (data["Kantan Weight"] !== undefined && data["Plastic Weight"] !== undefined) {
//     const kantanLabel = `કંતાન`;
//     const plasticLabel = `પ્લાસ્ટિક`;
//     bardanHtml = `
//       <div class="detail-item"><span class="detail-label">${kantanLabel}</span><span class="detail-value">-${data["Kantan Weight"]}</span></div>
//       <div class="detail-item"><span class="detail-label">${plasticLabel}</span><span class="detail-value">-${data["Plastic Weight"]}</span></div>
//     `;
//   } else {
//     // Fallback for old bills: show combined bardan weight
//     const bardanLabel = `બારદાન વજન`;
//     bardanHtml = `<div class="detail-item"><span class="detail-label">${bardanLabel}</span><span class="detail-value">-${data["Bardan Weight"]}</span></div>`;
//   }

//   if (data["Bill Type"] === "Loose") {
//     vakalRows = `<tr><td>Loose Supply</td><td>-</td><td>${data["Vakal 1 Kilo"]}</td><td>${
//       data["Vakal 1 Bhav"]
//     }</td><td style="font-weight:bolder;">${Number(data["Vakal 1 Amount"]).toLocaleString("en-IN")}</td></tr>`;
//   } else {
//     for (let i = 1; i <= 5; i++) {
//       const kattaValue = data[`Vakal ${i} Katta`];
//       const kiloValue = data[`Vakal ${i} Kilo`];
//       if (kattaValue > 0 || kiloValue > 0) {
//         vakalRows += `<tr><td>વકલ ${i}</td><td>${data[`Vakal ${i} Katta`]}</td><td>${data[`Vakal ${i} Kilo`]}</td><td>${
//           data[`Vakal ${i} Bhav`]
//         }</td><td style="font-weight:bolder;">${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}</td></tr>`;
//       }
//     }
//   }

//   // Code to dynamically generate expenses HTML
//   let expensesHtml = "";
//   if (data["Expenses"]) {
//     try {
//       const expenses = JSON.parse(data["Expenses"]);
//       if (expenses.length > 0) {
//         expensesHtml = `<div class="totals-grid expenses-grid">`;
//         expenses.forEach((exp) => {
//           expensesHtml += `<div class="detail-item"><span class="detail-label">${exp.name}</span><span class="detail-value">-${exp.amount}</span></div>`;
//         });
//         expensesHtml += `</div>`;
//       }
//     } catch (e) {
//       console.error("Error parsing expenses:", e);
//     }
//   }

//   let headerBagCountHtml = "";
//   if (data["Bill Type"] === "Bag") {
//     const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
//     const totalKhali = (data["Khali 600"] || 0) + (data["Khali 200"] || 0);
//     const grandTotal = totalBharela + totalKhali;

//     if (grandTotal > 0) {
//       headerBagCountHtml = `
//             <div class="meta-item bag-count-header">
//                 <span>${totalBharela} (ભરેલા)</span> +
//                 <span>${totalKhali} (ખાલી)</span> =
//                 <span>${grandTotal} (કુલ)</span>
//             </div>
//         `;
//     }
//   }

//   const customerDetailsHtml = `<div class="detail-line" style="display: flex; justify-content: space-between; align-items: center;"><span class="detail-label-enter" style="width: auto;">નામ :</span><span class="detail-value-line" style="width: 30%;">${data["Customer Name"]}</span><span class="detail-label-enter" style="width: auto; margin-left: 20px;">ગાડી નં :</span><span class="detail-value-line" style="width: 30%;">${data["Vehicle No"]}</span></div><div class="detail-line" style="display: flex; justify-content: space-between; align-items: center;"><span class="detail-label-enter" style="width: auto;">ગામ :</span><span class="detail-value-line" style="width: 30%;">${data["Village"]}</span><span class="detail-label-enter" style="width: auto; margin-left: 20px;">દલાલ :</span><span class="detail-value-line" style="width: 30%;">${data["Broker"]}</span></div>`;
//   return `<div class="container" style="margin:0;box-shadow:none;border:none;">
//     <div class="header"><h1>Final Bill</h1></div>
//      <div class="bill-meta">
//       <div class="meta-item"><span>Bill No:</span> <span>${data["Serial No"]}</span></div>
//       ${headerBagCountHtml}
//       <div class="meta-item"><span>Date:</span> <span>${data["Date"]}</span></div>
//     </div>
//     <div class="print-only-details" style="display:block;">${customerDetailsHtml}</div>
//     <div class="details-grid" style="grid-template-columns: repeat(5, 1fr);">
//       <div class="detail-item"><span class="detail-label">વેબ્રીજ વજન</span><span class="detail-value">${
//         data["Weighbridge Weight"]
//       }</span></div>
//       <div class="detail-item"><span class="detail-label">${kasarLabel}</span><span class="detail-value">-${
//     data["Kasar"]
//   }</span></div>
//       ${bardanHtml}
//       <div class="detail-item summary-item"><span class="detail-label">નેટ વજન</span><span class="detail-value" style="font-weight:bolder;">${
//         data["Net Weight"]
//       }</span></div>
//     </div>
//     <table class="final-bill-table"><thead><tr><th>વકલ</th><th>કટ્ટા</th><th>કિલો</th><th>ભાવ</th><th>રૂપિયા</th></tr></thead><tbody>${vakalRows}</tbody></table>
//     <div class="totals-grid">
//       <div class="detail-item"><span class="detail-label">ટોટલ રૂપિયા</span><span class="detail-value">${Number(
//         data["Total Amount"]
//       ).toLocaleString("en-IN")}</span></div>
//       <div class="detail-item"><span class="detail-label">${utraiLabel}</span><span class="detail-value">-${Number(
//     data["Utrāī"]
//   ).toLocaleString("en-IN")}</span></div>
//       ${expensesHtml}
//       <div class="detail-item final-total-box"><span class="detail-label">ફાઇનલ ટોટલ</span><span class="detail-value" style="font-weight:bolder;">${Number(
//         data["Final Total"]
//       ).toLocaleString("en-IN")}</span></div>
//     </div>
//   </div>`;
// }

function generateBillHtmlForView(data) {
  const deductionSettings = data.DeductionSettings || {
    kasarPercentage: 0.003,
    kantanWeight: 0.6,
    plasticWeight: 0.2,
    utraiPercentage: 7,
  };
  let vakalRows = "";
  // New variables are defined at the top of the function
  const kasarLabel = `કાંટા`;
  const utraiLabel = `ઉતરાઈ`;

  let bardanHtml;
  // If the new fields exist, show separate boxes
  if (data["Kantan Weight"] !== undefined && data["Plastic Weight"] !== undefined) {
    const kantanLabel = `કંતાન`;
    const plasticLabel = `પ્લાસ્ટિક`;
    bardanHtml = `
      <div class="detail-item"><span class="detail-label">${kantanLabel}</span><span class="detail-value">-${data["Kantan Weight"]}</span></div>
      <div class="detail-item"><span class="detail-label">${plasticLabel}</span><span class="detail-value">-${data["Plastic Weight"]}</span></div>
    `;
  } else {
    // Fallback for old bills: show combined bardan weight
    const bardanLabel = `બારદાન`;
    bardanHtml = `<div class="detail-item"><span class="detail-label">${bardanLabel}</span><span class="detail-value">-${data["Bardan Weight"]}</span></div>`;
  }

  if (data["Bill Type"] === "Loose") {
    vakalRows = `<tr><td>Loose Supply</td><td>-</td><td>${data["Vakal 1 Kilo"]}</td><td>${
      data["Vakal 1 Bhav"]
    }</td><td style="font-weight:bolder;">${Number(data["Vakal 1 Amount"]).toLocaleString("en-IN")}</td></tr>`;
  } else {
    for (let i = 1; i <= 5; i++) {
      const kattaValue = data[`Vakal ${i} Katta`];
      const kiloValue = data[`Vakal ${i} Kilo`];
      if (kattaValue > 0 || kiloValue > 0) {
        vakalRows += `<tr><td>વકલ ${i}</td><td>${data[`Vakal ${i} Katta`]}</td><td>${data[`Vakal ${i} Kilo`]}</td><td>${
          data[`Vakal ${i} Bhav`]
        }</td><td style="font-weight:bolder;">${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}</td></tr>`;
      }
    }
  }

  // Code to dynamically generate expenses HTML
  let expensesHtml = "";
  if (data["Expenses"]) {
    try {
      const expenses = JSON.parse(data["Expenses"]);
      if (expenses.length > 0) {
        expensesHtml = `<div class="totals-grid expenses-grid">`;
        expenses.forEach((exp) => {
          expensesHtml += `<div class="detail-item"><span class="detail-label">${exp.name}</span><span class="detail-value">-${exp.amount}</span></div>`;
        });
        expensesHtml += `</div>`;
      }
    } catch (e) {
      console.error("Error parsing expenses:", e);
    }
  }

  let headerBagCountHtml = "";
  if (data["Bill Type"] === "Bag") {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    const totalKhali = (data["Khali 600"] || 0) + (data["Khali 200"] || 0);
    const grandTotal = totalBharela + totalKhali;

    if (grandTotal > 0) {
      headerBagCountHtml = `
            <div class="meta-item bag-count-header" style="text-align: center; font-size: x-large">
                <span>${totalBharela} (ભરેલા)</span> + 
                <span>${totalKhali} (ખાલી)</span> = 
                <span>${grandTotal} (કુલ)</span>
            </div>
        `;
    }
  }

  let supplyTypeHtml = "";
  let displayText = "";

  // Case 1: A true "Loose Supply" bill
  if (data["Bill Type"] === "Loose") {
    displayText = "લૂઝ";
  }
  // Case 2: A "Kantan Pack" bag bill
  else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "કંતાન પેક") {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    displayText = `ઘઉંના કટ્ટા - ${totalBharela} કંતાન પેક`;
  }
  // Case 3: A "Loose" description for a "Bag" bill
  else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "લૂઝ") {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    displayText = `ઘઉંના કટ્ટા - ${totalBharela} લૂઝ`;
  }

  if (displayText) {
    supplyTypeHtml = `<h3 style="text-align: center; font-size: 2.5em;font-weight: bolder; color: #000000; margin: auto;">${displayText}</h3>`;
  }

  const customerDetailsHtml = `  <div class="print-only-details" style="font-size: 11pt">
        <div class="detail-line">
          <span class="detail-label-enter">નામ :- </span>
          <span class="detail-value-line">${data["Customer Name"]}</span>
        </div>
        <div class="detail-line">
        <span class="detail-label-enter">ગામ :- </span>
        <span class="detail-value-line">${data["Village"]}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label-enter">ગાડી નં :- </span>
          <span class="detail-value-line">${data["Vehicle No"]}</span>
        </div>
        <div class="detail-line">
          <span class="detail-label-enter">દલાલ :- </span>
          <span class="detail-value-line">${data["Broker"]}</span>
        </div>
      </div>
     ${headerBagCountHtml}`;
  return `<div class="container" style="margin:0;box-shadow:none;border:none;">
    <div class="header"><h1>Final Bill</h1></div>
     <div class="bill-meta">
      <div class="meta-item"> <span>${data["Serial No"]}</span></div>
     
      <div class="meta-item"><span>${data["Date"]}</span></div>
    </div>
    
    <div class="print-only-details" style="display:block;">${customerDetailsHtml}</div>
    <div class="details-grid" style="grid-template-columns: repeat(5, 1fr);">
      <div class="detail-item"><span class="detail-label">વેબ્રીજ</span><span class="detail-value">${
        data["Weighbridge Weight"]
      }</span></div>
      <div class="detail-item"><span class="detail-label">${kasarLabel}</span><span class="detail-value">-${
    data["Kasar"]
  }</span></div>
      ${bardanHtml} 
      <div class="detail-item summary-item"><span class="detail-label">નેટ વજન</span><span class="detail-value" style="font-weight:bolder;">${
        data["Net Weight"]
      }</span></div>
    </div>
    <table class="final-bill-table"><thead><tr><th>વકલ</th><th>કટ્ટા</th><th>કિલો</th><th>ભાવ</th><th>રૂપિયા</th></tr></thead><tbody>${vakalRows}</tbody></table>
     ${supplyTypeHtml}
    <div class="totals-grid">
      <div class="detail-item"><span class="detail-label">ટોટલ રૂપિયા</span><span class="detail-value">${Number(
        data["Total Amount"]
      ).toLocaleString("en-IN")}</span></div>
      <div class="detail-item"><span class="detail-label">${utraiLabel}</span><span class="detail-value">-${Number(
    data["Utrāī"]
  ).toLocaleString("en-IN")}</span></div>
      ${expensesHtml}
      <div class="detail-item final-total-box"><span class="detail-label">ફાઇનલ ટોટલ</span><span class="detail-value" style="font-weight:bolder;">${Number(
        data["Final Total"]
      ).toLocaleString("en-IN")}</span></div>
    </div>
  </div>`;
}

function updateSyncTime() {
  const syncStatusElement = document.getElementById("dashboard_sync_status");
  if (syncStatusElement) {
    const now = new Date();
    const formattedTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(
      2,
      "0"
    )}:${String(now.getSeconds()).padStart(2, "0")}`;
    syncStatusElement.textContent = `Last synced: ${formattedTime}`;
  }
}

function resetTime(date) {
  if (!date) return null;
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
}
document.getElementById("month_filter_btn").addEventListener("click", filterByMonth);
function filterByMonth() {
  const monthYearInput = document.getElementById("month_year_input").value;
  let filteredBills;

  if (monthYearInput) {
    // --- Case 1: A month and year ARE selected ---

    // The input gives us a string like "2025-02". We split it.
    const [year, month] = monthYearInput.split("-").map(Number);

    filteredBills = allBillsData.filter((bill) => {
      // The bill date is a string like "30/08/2025". We split it.
      const [billDay, billMonth, billYear] = bill.Date.split("/").map(Number);

      // Return true only if the year and month match
      return billYear === year && billMonth === month;
    });
  } else {
    // --- Case 2: No month is selected (show current month) ---

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // getMonth() is 0-11, so we add 1

    filteredBills = allBillsData.filter((bill) => {
      const [billDay, billMonth, billYear] = bill.Date.split("/").map(Number);

      // Return true only if the bill is from the current year and month
      return billYear === currentYear && billMonth === currentMonth;
    });
  }

  // Update the dashboard with the filtered results
  updateDashboard(filteredBills);
}

function updateKPIs(billsToDisplay) {
  const totalPurchases = billsToDisplay.reduce((sum, bill) => sum + bill["Final Total"], 0);
  const totalWeight = billsToDisplay.reduce((sum, bill) => sum + bill["Net Weight"], 0);
  const totalBills = billsToDisplay.length;
  const totalUtrai = billsToDisplay.reduce((sum, bill) => sum + bill["Utrāī"], 0);
  const totalAmountDue = billsToDisplay.reduce((sum, bill) => {
    // If the bill has the new 'amountDue' field, use it.
    if (typeof bill.amountDue === "number") {
      return sum + bill.amountDue;
    }
    // If it's an old bill and hasn't been marked as 'Paid', assume the full amount is due.
    if (bill.paymentStatus !== "Paid") {
      return sum + bill["Final Total"];
    }
    // Otherwise (it's an old bill that might have been marked 'Paid'), the amount due is 0.
    return sum;
  }, 0);

  const totalBags = billsToDisplay.reduce((sum, bill) => {
    let bagsInBill = 0;
    if (bill["Bill Type"] === "Bag") {
      // For "Bag" bills, sum the 'Katta' fields
      for (let i = 1; i <= 5; i++) {
        bagsInBill += bill[`Vakal ${i} Katta`] || 0;
      }
    } else if (bill["Bill Type"] === "Loose") {
      // For "Loose" bills, calculate bags from weight (1 bag per 50kg)
      const netWeight = bill["Net Weight"] || 0;
      bagsInBill = Math.round(netWeight / 50);
    }
    return sum + bagsInBill;
  }, 0);
  document.getElementById("kpi-total-due").textContent = `₹${totalAmountDue.toLocaleString("en-IN")}`;
  const avgPrice = calculateAveragePrice(billsToDisplay);

  // Update the KPI cards
  document.getElementById("kpi-total-purchases").textContent = `₹${totalPurchases.toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-weight").textContent = `${totalWeight.toLocaleString("en-IN")} kg`;
  document.getElementById("kpi-total-bills").textContent = totalBills;
  document.getElementById("kpi-total-utrai").textContent = `₹${totalUtrai.toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-bags").textContent = totalBags.toLocaleString("en-IN");
  document.getElementById("kpi-avg-price").textContent = `₹${avgPrice.toFixed(2)}`;
}

function recalculateKPIs() {
  // Find all the checkboxes that are currently checked
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox:checked");
  let billsToCalculate = [];

  if (selectedCheckboxes.length > 0) {
    // If some boxes are checked, build a list of the selected bills
    const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
    billsToCalculate = currentlyDisplayedBills.filter((bill) => selectedIds.includes(bill.id));
  } else {
    // If NO boxes are checked, use all the bills currently displayed on the page
    billsToCalculate = currentlyDisplayedBills;
  }

  // Calculate the totals for the selected (or displayed) bills
  const totalPurchases = billsToCalculate.reduce((sum, bill) => sum + bill["Final Total"], 0);
  const totalWeight = billsToCalculate.reduce((sum, bill) => sum + bill["Net Weight"], 0);
  const totalBills = billsToCalculate.length;
  const totalUtrai = billsToCalculate.reduce((sum, bill) => sum + bill["Utrāī"], 0);
  const totalBags = billsToCalculate.reduce((sum, bill) => {
    let bagsInBill = 0;
    if (bill["Bill Type"] === "Bag") {
      // For "Bag" bills, sum the 'Katta' fields
      for (let i = 1; i <= 5; i++) {
        bagsInBill += bill[`Vakal ${i} Katta`] || 0;
      }
    } else if (bill["Bill Type"] === "Loose") {
      // For "Loose" bills, calculate bags from weight (1 bag per 50kg)
      const netWeight = bill["Net Weight"] || 0;
      bagsInBill = Math.round(netWeight / 50);
    }
    return sum + bagsInBill;
  }, 0);
  const avgPrice = calculateAveragePrice(billsToCalculate);

  // Update the KPI cards on the screen
  document.getElementById("kpi-total-purchases").textContent = `₹${totalPurchases.toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-weight").textContent = `${totalWeight.toLocaleString("en-IN")} kg`;
  document.getElementById("kpi-total-bills").textContent = totalBills;
  document.getElementById("kpi-total-utrai").textContent = `₹${totalUtrai.toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-bags").textContent = totalBags.toLocaleString("en-IN");
  document.getElementById("kpi-avg-price").textContent = `₹${avgPrice.toFixed(2)}`;
}
