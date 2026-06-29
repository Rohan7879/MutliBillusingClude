function showLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("hidden");
    setTimeout(() => {
      loadingBar.classList.add("active");
    }, 10);
  }
}
function hideLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("active");
    setTimeout(() => {
      loadingBar.classList.add("hidden");
    }, 1500);
  }
}
function formatNumber(num) {
  if (isNaN(num) || num === "") {
    return num;
  }
  const numString = Number(num).toLocaleString("en-IN");

  if (numString.length > 10) {
    // Return a smaller font size for large numbers
    return `<span class="large-number">${numString}</span>`;
  }
  return numString;
}
function customRound(num) {
  let decimal = num - Math.floor(num);
  return decimal > 0.5 ? Math.ceil(num) : Math.floor(num);
}
async function fetchSettings() {
  try {
    const settingsDoc = await db.collection("settings").doc("deductions").get();
    if (settingsDoc.exists) {
      globalSettings = settingsDoc.data();
    } else {
      console.error("Settings document not found. Using default values.");
      globalSettings = {
        kasarPercentage: 0.003,
        kantanWeight: 0.6,
        plasticWeight: 0.2,
        utraiPercentage: 7,
      };
    }
  } catch (error) {
    console.error("Error fetching settings:", error);
  }
}
async function printSelectedBills() {
  // Find the correct checkboxes depending on which page we are on
  const selectedCheckboxes = document.querySelectorAll(
    "#bill_list_view .bill-checkbox:checked, #bill-list-section .bill-checkbox:checked"
  );

  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one bill to print.");
    return;
  }

  showLoading("Preparing bills for printing...");

  try {
    // 1. Get the IDs of all selected bills
    const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

    // 2. Fetch the full data for each selected bill from Firestore
    const billPromises = selectedIds.map((id) => billsCollection.doc(id).get());
    const billDocs = await Promise.all(billPromises);

    let billsHtml = "";
    // 3. Generate the full HTML for each bill and add it to our print string
    billDocs.forEach((doc) => {
      if (doc.exists) {
        // Use the generateBillHtmlForView function we moved to utils.js
        billsHtml += generateBillHtmlForView(doc.data());
      }
    });

    // 4. Use the reliable iframe method to create a new print-only page
    const printFrame = document.createElement("iframe");
    printFrame.style.display = "none";
    document.body.appendChild(printFrame);

    const printDocument = printFrame.contentWindow.document;
    printDocument.open();
    printDocument.write(`
      <html>
        <head>
          <title>Print Bills</title>
          <link rel="stylesheet" href="html.css">
          <style>
            /* This is the key: it forces each bill to start on a new page */
            @media print {
              .container {
                page-break-after: auto;
              }
            }
          </style>
        </head>
        <body>
          ${billsHtml}
        </body>
      </html>
    `);
    printDocument.close();

    // 5. Wait for the content to load, then print
    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
      document.body.removeChild(printFrame); // Clean up by removing the iframe
    }, 500);
  } catch (error) {
    console.error("Error preparing bills for printing:", error);
    alert("Could not prepare bills for printing.");
  } finally {
    hideLoading();
  }
}
// Replace this function in both utils.js and dashboard.js

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

  const customerDetailsHtml = `
      <div class="print-only-details" style="font-size: 11pt">
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
        <div class="detail-line" >
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
