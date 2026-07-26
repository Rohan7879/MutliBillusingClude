/**
 * @file core-engine.js
 * @description MandiBook — SINGLE SOURCE OF TRUTH for shared logic.
 *              Consolidates functions that were previously duplicated
 *              across utils.js, dashboard.js, bill-list.js, and bill-view.js.
 *
 *              LOAD ORDER: this file must load AFTER firebase-init.js
 *              and BEFORE any feature file (bill-form.js, dashboard.js, etc.)
 *              <script src="js/core/firebase-init.js"></script>
 *              <script src="js/core/core-engine.js"></script>
 *              <script src="js/features/....js" defer></script>
 *
 * @project MandiBook
 * @phase 1 of refactor — confirmed-safe duplicate consolidation
 *
 * CONSOLIDATED FROM (verified identical/near-identical before merging):
 *   - showLoading / hideLoading        <- utils.js
 *   - formatNumber                     <- utils.js
 *   - customRound                      <- utils.js
 *   - fetchSettings                    <- utils.js (was ALSO duplicated in bill-view.js)
 *   - generateBillHtmlForView          <- utils.js (was ALSO duplicated in dashboard.js)
 *   - printSelectedBills               <- utils.js
 *   - getStatusHtml                    <- was duplicated in dashboard.js AND bill-list.js (byte-identical)
 *
 * NOT YET MOVED HERE (need full file review before merging):
 *   - updateSelectionSummary()  -> exists in bill-list.js (bill totals) AND
 *     ledger.js (customer/transaction totals) with DIFFERENT logic despite
 *     the same name. Do NOT merge blindly — will address in a later pass
 *     once ledger.js is fully reviewed line-by-line.
 */

// ═══════════════════════════════════════════════════════════════════════════
// LOADING INDICATOR
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// NUMBER FORMATTING & ROUNDING
// ═══════════════════════════════════════════════════════════════════════════

function formatNumber(num) {
  if (isNaN(num) || num === "") {
    return num;
  }
  const numString = Number(num).toLocaleString("en-IN");
  if (numString.length > 10) {
    return `<span class="large-number">${numString}</span>`;
  }
  return numString;
}

/**
 * Weight/bag-style rounding (round-half-up to nearest whole number).
 * Used for things like Net Weight adjustments. NOT for currency —
 * use roundCurrency() below for money math.
 */
function customRound(num) {
  let decimal = num - Math.floor(num);
  return decimal > 0.5 ? Math.ceil(num) : Math.floor(num);
}

/**
 * Strict 2-decimal currency rounding, per accounting-accuracy checklist item.
 * Use this for every rupee-amount calculation (Final Total, deductions,
 * broker commission, payments) to avoid floating-point drift.
 * NOTE: not yet wired into bill-form.js's calculateBillData() — that needs
 * a full read of that function before we safely swap its rounding calls.
 */
function roundCurrency(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS (deduction defaults)
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT STATUS BADGE (was duplicated verbatim in dashboard.js + bill-list.js)
// ═══════════════════════════════════════════════════════════════════════════

function getStatusHtml(bill) {
  const status = bill.paymentStatus || "Unpaid";
  const amountPaid = bill.amountPaid || 0;
  const finalTotal = bill["Final Total"] || 0;
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

// ═══════════════════════════════════════════════════════════════════════════
// BILL HTML GENERATOR (was duplicated verbatim in utils.js + dashboard.js)
// Used for: bill view/print, WhatsApp share prep, multi-bill print
// ═══════════════════════════════════════════════════════════════════════════

function generateBillHtmlForView(data) {
  const deductionSettings = data.DeductionSettings || {
    kasarPercentage: 0.003,
    kantanWeight: 0.6,
    plasticWeight: 0.2,
    utraiPercentage: 7,
  };
  let vakalRows = "";
  const kasarLabel = `કાંટા`;
  const utraiLabel = `ઉતરાઈ`;

  let bardanHtml;
  if (data["Kantan Weight"] !== undefined && data["Plastic Weight"] !== undefined) {
    const kantanLabel = `કંતાન`;
    const plasticLabel = `પ્લાસ્ટિક`;
    bardanHtml = `
      <div class="detail-item"><span class="detail-label">${kantanLabel}</span><span class="detail-value">-${data["Kantan Weight"]}</span></div>
      <div class="detail-item"><span class="detail-label">${plasticLabel}</span><span class="detail-value">-${data["Plastic Weight"]}</span></div>
    `;
  } else {
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
        const varietyLabel = data[`Vakal ${i} Variety`]
          ? ` <small style="font-weight:400;">(${data[`Vakal ${i} Variety`]})</small>`
          : "";
        vakalRows += `<tr><td>વકલ ${i}${varietyLabel}</td><td>${data[`Vakal ${i} Katta`]}</td><td>${
          data[`Vakal ${i} Kilo`]
        }</td><td>${data[`Vakal ${i} Bhav`]}</td><td style="font-weight:bolder;">${Number(
          data[`Vakal ${i} Amount`]
        ).toLocaleString("en-IN")}</td></tr>`;
      }
    }
  }

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
  const productLabel = data["ProductTemplate"] ? `${data["ProductTemplate"]}ના કટ્ટા` : "કટ્ટા";

  if (data["Bill Type"] === "Loose") {
    displayText = "લૂઝ";
  } else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "કંતાન પેક") {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    displayText = `${productLabel} - ${totalBharela} કંતાન પેક`;
  } else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "લૂઝ") {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    displayText = `${productLabel} - ${totalBharela} લૂઝ`;
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

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-BILL PRINT (was in utils.js)
// ═══════════════════════════════════════════════════════════════════════════

async function printSelectedBills() {
  const selectedCheckboxes = document.querySelectorAll(
    "#bill_list_view .bill-checkbox:checked, #bill-list-section .bill-checkbox:checked"
  );

  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one bill to print.");
    return;
  }

  showLoading("Preparing bills for printing...");

  try {
    const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
    const billPromises = selectedIds.map((id) => billsCollection.doc(id).get());
    const billDocs = await Promise.all(billPromises);

    let billsHtml = "";
    billDocs.forEach((doc) => {
      if (doc.exists) {
        billsHtml += generateBillHtmlForView(doc.data());
      }
    });

    const printFrame = document.createElement("iframe");
    printFrame.style.display = "none";
    document.body.appendChild(printFrame);

    const printDocument = printFrame.contentWindow.document;
    printDocument.open();
    printDocument.write(`
      <html>
        <head>
          <title>Print Bills</title>
          <link rel="stylesheet" href="css/print.css">
          <style>
            @media print {
              .container { page-break-after: auto; }
            }
          </style>
        </head>
        <body>
          ${billsHtml}
        </body>
      </html>
    `);
    printDocument.close();

    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
      document.body.removeChild(printFrame);
    }, 500);
  } catch (error) {
    console.error("Error preparing bills for printing:", error);
    alert("Could not prepare bills for printing.");
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE CONNECTION CHECK (moved here from bill-list.js — the navbar's
// connection-check button needs this on every page, not just bill-list pages)
// ═══════════════════════════════════════════════════════════════════════════

function checkFirebaseConnection() {
  showLoading("Checking connection...");
  const connectionStatus = document.getElementById("connection_status");
  billsCollection
    .limit(1)
    .get({ source: "server" })
    .then(() => {
      connectionStatus.textContent = "Connected!";
      connectionStatus.className = "connected";
    })
    .catch(() => {
      connectionStatus.textContent = "Disconnected.";
      connectionStatus.className = "disconnected";
    })
    .finally(() => {
      hideLoading();
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PRINT LAYOUT ORDER (user-configurable box ordering, set in Settings)
// Lets Rohan drag/reorder which box appears where in the weight-side and
// amount-side grids, instead of a hardcoded position. Order is saved once
// in Firestore and applied to every bill's print/screen view.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_DETAILS_GRID_ORDER = [
  "weighbridge_box",
  "kasar_box",
  "wb_moisture_box",
  "template_deductions_weight",
  "kantan_box",
  "plastic_box",
  "netweight_box",
];
const DEFAULT_TOTALS_GRID_ORDER = [
  "total_amount_box",
  "utrai_box",
  "expenses_container",
  "template_deductions_amount",
  "freight_item",
  "final_total_box_container",
];

// Human-readable labels, used by the Settings reorder UI
const PRINT_LAYOUT_LABELS = {
  weighbridge_box: "વેબ્રીજ (Weighbridge)",
  kasar_box: "કાં.ક. (Kasar)",
  wb_moisture_box: "💧 Moisture",
  template_deductions_weight: "Template Deductions — Weight (Admixture, etc.)",
  kantan_box: "કંતાન (Kantan)",
  plastic_box: "પ્લાસ્ટિક (Plastic)",
  netweight_box: "નેટ વજન (Net Weight)",
  total_amount_box: "ટોટલ રૂપિયા (Total Amount)",
  utrai_box: "ઉતરાઈ (Utrai)",
  expenses_container: "Expenses (Kholai, etc.)",
  template_deductions_amount: "Template Deductions — Amount (GST, etc.)",
  freight_item: "ટ્રક ભાડું (Truck Freight)",
  final_total_box_container: "ફાઇનલ ટોટલ (Final Total)",
};

/**
 * Moves each existing element matching `order` (by id, or by dynamicClass
 * for the group of dynamically-created deduction boxes) to the end of the
 * grid, IN the given sequence — appendChild on an existing DOM node moves
 * it, so iterating the order array in sequence achieves the exact final
 * visual order.
 */
function reorderGrid(gridSelector, order, dynamicClass, dynamicKey) {
  const grid = document.querySelector(gridSelector);
  if (!grid) return;
  order.forEach((key) => {
    if (key === dynamicKey) {
      grid.querySelectorAll("." + dynamicClass).forEach((el) => grid.appendChild(el));
    } else {
      const el = document.getElementById(key);
      if (el && grid.contains(el)) grid.appendChild(el);
    }
  });
}

/**
 * Loads the saved print-layout order from Firestore (settings/printLayout)
 * and applies it to the currently-displayed bill's details-grid and
 * totals-grid. Falls back to the default order if nothing saved yet.
 * Call this AFTER the bill's values (and any template-deduction boxes)
 * have already been rendered into the DOM.
 */
async function applyPrintLayoutOrder() {
  let layout = null;
  try {
    const doc = await db.collection("settings").doc("printLayout").get();
    if (doc.exists) layout = doc.data();
  } catch (e) {
    console.warn("Could not load print layout order (using default):", e);
  }
  const detailsOrder = (layout && layout.detailsGridOrder) || DEFAULT_DETAILS_GRID_ORDER;
  const totalsOrder = (layout && layout.totalsGridOrder) || DEFAULT_TOTALS_GRID_ORDER;

  reorderGrid(".details-grid", detailsOrder, "tda-weight-item", "template_deductions_weight");
  reorderGrid(".totals-grid", totalsOrder, "tda-amount-item", "template_deductions_amount");
}
// Replaces the hardcoded <nav class="top-navbar">...</nav> block that was
// copy-pasted into every HTML file (index, bill-create, bills, dashboard,
// reports, broker-ledger, ledger, order-book, core_settings).
// ═══════════════════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { href: "bill-create.html", icon: "🧾", label: "New Bill" },
  { href: "bills.html", icon: "📋", label: "Bills" },
  { href: "dashboard.html", icon: "📊", label: "Dashboard" },
  { href: "reports.html", icon: "📈", label: "Reports" },
  { href: "broker-ledger.html", icon: "🤝", label: "Brokers" },
  { href: "ledger.html", icon: "📒", label: "Ledger" },
  { href: "order-book.html", icon: "📦", label: "Orders" },
  { href: "core_settings.html", icon: "⚙️", label: "Settings" },
];

/**
 * Renders the top navbar into #navbar-root (add this empty div at the top
 * of <body> in every page instead of the hardcoded <nav> block).
 * Active state is auto-detected from the current URL — no more manually
 * adding class="active" to the right <a> tag on every page.
 */
function renderNavbar() {
  const root = document.getElementById("navbar-root");
  if (!root) {
    console.warn(
      'core-engine: #navbar-root not found — navbar not rendered. Add <div id="navbar-root"></div> at top of <body>.'
    );
    return;
  }

  const currentFile = window.location.pathname.split("/").pop() || "index.html";

  const linksHtml = NAV_ITEMS.map((item) => {
    const isActive = item.href === currentFile;
    return `<a class="nav-link${isActive ? " active" : ""}" href="${item.href}">${item.icon} <span>${
      item.label
    }</span></a>`;
  }).join("");

  // Only include the connection-check button on pages that actually define
  // checkFirebaseConnection() (e.g. bill-list.js pages) — avoids a dead button.
  const connHtml =
    typeof checkFirebaseConnection === "function"
      ? `<button class="nav-conn" onclick="checkFirebaseConnection()">
         <span class="cdot" id="conn-dot"></span>
         <span id="connection_status">Check</span>
       </button>`
      : "";

  root.innerHTML = `
    <nav class="top-navbar">
      <a class="navbar-brand" href="index.html">
        <img src="assets/logo.jpg" alt="Logo"/>
        <span>MandiBook</span>
      </a>
      <div class="navbar-links">${linksHtml}${connHtml}</div>
    </nav>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — AMOUNT IN WORDS (legal requirement on printed bills)
// Indian numbering system (Lakh/Crore), e.g. 123456 -> "One Lakh Twenty
// Three Thousand Four Hundred Fifty Six Rupees Only"
// ═══════════════════════════════════════════════════════════════════════════

function numberToWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return "Zero Rupees Only";

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  }
  function threeDigits(n) {
    if (n < 100) return twoDigits(n);
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigits(n % 100) : "");
  }

  let result = "";
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = num;

  if (crore) result += threeDigits(crore) + " Crore ";
  if (lakh) result += threeDigits(lakh) + " Lakh ";
  if (thousand) result += threeDigits(thousand) + " Thousand ";
  if (hundred) result += threeDigits(hundred);

  return result.trim() + " Rupees Only";
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — UNIVERSAL PRINT ENGINE
// Wraps generateBillHtmlForView() and adds:
//   - Dynamic page size: A4 if (vakal rows + expense rows) > 8, else A5
//   - page-break-inside: avoid on every <tr> so a row never tears mid-page
//   - Amount-in-words footer (Item #6)
// This does NOT replace generateBillHtmlForView (still used for on-screen
// modals / WhatsApp prep) — it wraps it for the actual print document.
// ═══════════════════════════════════════════════════════════════════════════

function generateUniversalBillHTML(data) {
  const bodyHtml = generateBillHtmlForView(data);

  // Content-weight count for page-size decision (same rule as
  // applyUniversalPrintSettings in bill-view.js) — includes Template
  // Deductions, Weighbridge Moisture, and Remarks, not just vakal/expenses.
  let vakalRowCount = 0;
  if (data["Bill Type"] === "Loose") {
    vakalRowCount = 1;
  } else {
    for (let i = 1; i <= 5; i++) {
      if ((data[`Vakal ${i} Katta`] || 0) > 0 || (data[`Vakal ${i} Kilo`] || 0) > 0) vakalRowCount++;
    }
  }
  let expenseRowCount = 0;
  if (data["Expenses"]) {
    try {
      expenseRowCount = (JSON.parse(data["Expenses"]) || []).length;
    } catch (e) {
      expenseRowCount = 0;
    }
  }
  const templateDeductionCount = (data["TemplateDeductionsApplied"] || []).length;
  const hasWeighbridgeMoisture = (data["Weighbridge Moisture Kg"] || 0) > 0 ? 1 : 0;
  const hasRemarks = data["Remarks"] && data["Remarks"].trim() !== "" ? 2 : 0;

  const totalWeight =
    vakalRowCount + expenseRowCount + templateDeductionCount * 1.5 + hasWeighbridgeMoisture + hasRemarks;

  const pageSize = totalWeight > 6 ? "A4" : "A5";

  const amountInWords = numberToWords(data["Final Total"]);

  return `
    <style>
      @page { size: ${pageSize} portrait; margin: ${pageSize === "A4" ? "10mm" : "0.5cm"}; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      .amount-in-words {
        font-size: 8pt; font-style: italic; color: #333;
        border-top: 1px dashed #aaa; padding-top: 3px; margin-top: 4px;
      }
    </style>
    ${bodyHtml.replace("</div>", `<div class="amount-in-words">Amount in words: ${amountInWords}</div></div>`)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-INIT — runs navbar render automatically once DOM is ready, so pages
// only need to include this script + <div id="navbar-root"></div>, no need
// to call renderNavbar() manually on every page.
// ═══════════════════════════════════════════════════════════════════════════
function initNavbarOnLoad() {
  if (document.getElementById("navbar-root")) {
    renderNavbar();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNavbarOnLoad);
} else {
  // DOM is already ready (script loaded/executed after parsing finished) —
  // run immediately instead of waiting for an event that already fired.
  initNavbarOnLoad();
}
