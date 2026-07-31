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

// ═══════════════════════════════════════════════════════════════════════════
// BILL HTML GENERATOR (UPDATED TO MATCH PERFECT NATIVE LAYOUT)
// ═══════════════════════════════════════════════════════════════════════════

function generateBillHtmlForView(data) {
  const inr = (num) => Number(num || 0).toLocaleString("en-IN");

  // 1. Details Grid (Upper Boxes)
  let detailsHtml = '<div class="details-grid" style="grid-template-columns: repeat(5, 1fr);">';
  detailsHtml += `<div class="detail-item"><span class="detail-label">વેબ્રીજ</span><span class="detail-value">${inr(
    data["Weighbridge Weight"]
  )}</span></div>`;

  if ((data["Kasar"] || 0) > 0) {
    detailsHtml += `<div class="detail-item"><span class="detail-label">કાં.ક.</span><span class="detail-value">-${inr(
      data["Kasar"]
    )}</span></div>`;
  }

  if ((data["Weighbridge Moisture Kg"] || 0) > 0) {
    detailsHtml += `<div class="detail-item"><span class="detail-label">💧 મોઇ. (Moisture)</span><span class="detail-value">-${inr(
      data["Weighbridge Moisture Kg"]
    )} (${data["Weighbridge Moisture %"]}%)</span></div>`;
  }

  const appliedDeds = data["TemplateDeductionsApplied"] || [];
  const weightDeds = appliedDeds.filter((d) => d.stage === "weight");
  weightDeds.forEach((d) => {
    const sign = d.applyAs === "add" ? "+" : "-";
    detailsHtml += `<div class="detail-item"><span class="detail-label">${
      d.name
    }</span><span class="detail-value">${sign}${inr(d.impact)}</span></div>`;
  });

  if ((data["Kantan Weight"] || 0) > 0) {
    detailsHtml += `<div class="detail-item"><span class="detail-label">કંતાન</span><span class="detail-value">-${inr(
      data["Kantan Weight"]
    )}</span></div>`;
  }

  if ((data["Plastic Weight"] || 0) > 0 || (data["Bardan Weight"] || 0) > 0) {
    const label = data["Kantan Weight"] > 0 || data["Plastic Weight"] > 0 ? "પ્લાસ્ટિક" : "બારદાન";
    const val = data["Plastic Weight"] || data["Bardan Weight"] || 0;
    detailsHtml += `<div class="detail-item"><span class="detail-label">${label}</span><span class="detail-value">-${inr(
      val
    )}</span></div>`;
  }

  detailsHtml += `<div class="detail-item summary-item"><span class="detail-label">નેટ વજન</span><span class="detail-value" style="font-weight:bolder; font-size:2.5em;">${inr(
    data["Net Weight"]
  )}</span></div>`;
  detailsHtml += `</div>`;

  // 2. Vakal Table
  const anyVakalMoisture = [1, 2, 3, 4, 5].some((i) => (data[`Vakal ${i} Moisture %`] || 0) > 0);
  let tableHtml = `<table class="final-bill-table" style="margin: 10px 0;"><thead><tr><th>વકલ <span class="print-hide">(Item)</span></th><th>કટ્ટા <span class="print-hide">(Bags)</span></th><th>કિલો <span class="print-hide">(Kg)</span></th>`;
  if (anyVakalMoisture)
    tableHtml += `<th>💧 મોઇ. <span class="print-hide">(Moisture)</span></th><th>નેટ કિલો <span class="print-hide">(Net Kg)</span></th>`;
  tableHtml += `<th>ભાવ <span class="print-hide">(Price)</span></th><th>રૂપિયા <span class="print-hide">(Amount)</span></th></tr></thead><tbody>`;

  for (let i = 1; i <= 5; i++) {
    const katta = data[`Vakal ${i} Katta`];
    const kilo = data[`Vakal ${i} Kilo`];
    if (data["Bill Type"] === "Loose" && i > 1) continue;
    if (data["Bill Type"] !== "Loose" && (!katta || katta === 0) && (!kilo || kilo === 0) && i > 1) continue;

    tableHtml += `<tr><td>વકલ ${i}</td><td>${katta === "-" ? "-" : inr(katta)}</td>`;
    const mPct = data[`Vakal ${i} Moisture %`] || 0;
    const mKg = data[`Vakal ${i} Moisture Kg`] || 0;
    const rawKilo = (kilo || 0) + mKg;

    if (anyVakalMoisture) {
      tableHtml += `<td>${inr(rawKilo)}</td>`;
      if (mPct > 0 && mKg > 0) {
        tableHtml += `<td style="color:#e67e00; font-weight:700;">-${inr(
          mKg
        )}<br><small style="font-size:11px;">(${mPct}%)</small></td>`;
        tableHtml += `<td style="font-weight:700; color:#005a9e;">${inr(kilo)}</td>`;
      } else {
        tableHtml += `<td>-</td><td>${inr(kilo)}</td>`;
      }
    } else {
      tableHtml += `<td>${inr(kilo)}</td>`;
    }
    tableHtml += `<td>${inr(data[`Vakal ${i} Bhav`])}</td><td style="font-weight: bolder; font-size: 2em">${inr(
      data[`Vakal ${i} Amount`]
    )}</td></tr>`;
  }
  tableHtml += `</tbody></table>`;

  if (anyVakalMoisture) {
    const totalMoistureKg = [1, 2, 3, 4, 5].reduce((sum, i) => sum + (data[`Vakal ${i} Moisture Kg`] || 0), 0);
    tableHtml += `<div class="detail-item" style="background:#fff8e7; border:2px solid #ffe08a; border-radius:10px; padding:12px; text-align:center; margin-top:10px;">
          <span class="detail-label" style="color:#7a5700; font-weight:700;">💧 કુલ મોઇ. કપાત (Total Moisture Cut)</span>
          <span class="detail-value" style="color:#e67e00; font-size:1.8em; font-weight:800; display:block; margin-top:4px;">-${inr(
            totalMoistureKg
          )} kg</span>
      </div>`;
  }

  // Remarks
  let remarksHtml = "";
  if (data["Remarks"] && data["Remarks"].trim() !== "") {
    remarksHtml = `<div style="margin-top:14px;padding:10px 14px;background:#fffbf0;border:1.5px dashed #ffe08a;border-radius:8px;font-size:13px;color:#5a4a00;"><strong>📝 Remarks:</strong> ${data["Remarks"]}</div>`;
  }

  // 3. Supply Type & Bags
  let supplyTypeHtml = "";
  const productLabel = data["ProductTemplate"] ? `${data["ProductTemplate"]}ના કટ્ટા` : "કટ્ટા";

  if (data["Bill Type"] === "Loose") {
    supplyTypeHtml = `<h3 style="text-align: center; font-size: 2.5em; font-weight: bolder; color: #000000; margin: 20px 0 0 0;">લૂઝ</h3>`;
  } else {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    const totalKhali = (data["Khali 600"] || 0) + (data["Khali 200"] || 0);
    const grandTotal = totalBharela + totalKhali;

    let supplyText =
      data["Supply Type"] === "કંતાન પેક"
        ? `${productLabel} - ${totalBharela} કંતાન પેક`
        : `${productLabel} - ${totalBharela} લૂઝ`;
    supplyTypeHtml = `<h3 style="text-align: center; font-size: 2.5em; font-weight: bolder; color: #000000; margin: 20px 0 0 0;">${supplyText}</h3>`;

    if (grandTotal > 0) {
      supplyTypeHtml += `<div style="text-align: center; font-size: 2em; font-weight: 800; color: #003d6e; padding: 5px 0 10px;">${totalBharela} (ભરેલા) + ${totalKhali} (ખાલી) = ${grandTotal} (કુલ)</div>`;
    }
  }

  // 4. Totals Grid (Lower Boxes)
  let totalsHtml = '<div class="totals-grid">';
  totalsHtml += `<div class="detail-item"><span class="detail-label">ટોટલ રૂપિયા</span><span class="detail-value">${inr(
    data["Total Amount"]
  )}</span></div>`;
  if ((data["Utrāī"] || 0) > 0) {
    totalsHtml += `<div class="detail-item"><span class="detail-label">ઉતરાઈ</span><span class="detail-value">-${inr(
      data["Utrāī"]
    )}</span></div>`;
  }

  const expenses = (function () {
    try {
      return JSON.parse(data["Expenses"] || "[]");
    } catch (e) {
      return [];
    }
  })();
  expenses.forEach((exp) => {
    totalsHtml += `<div class="detail-item"><span class="detail-label">${
      exp.name
    }</span><span class="detail-value">-${inr(exp.amount)}</span></div>`;
  });

  const amountDeds = appliedDeds.filter((d) => d.stage !== "weight");
  amountDeds.forEach((d) => {
    const sign = d.applyAs === "add" ? "+" : "-";
    totalsHtml += `<div class="detail-item"><span class="detail-label">${
      d.name
    }</span><span class="detail-value">${sign}₹${inr(d.impact)}</span></div>`;
  });

  if ((data["Truck Freight"] || 0) > 0) {
    totalsHtml += `<div class="detail-item"><span class="detail-label">ટ્રક ભાડું (Freight)</span><span class="detail-value" style="color: #28a745;">+${inr(
      data["Truck Freight"]
    )}</span></div>`;
  }

  totalsHtml += `<div class="detail-item final-total-box" style="grid-column: 1 / -1;"><span class="detail-label">ફાઇનલ ટોટલ</span><span class="detail-value" style="font-weight:bolder; font-size: 3em;">${inr(
    data["Final Total"]
  )}</span></div>`;
  totalsHtml += `</div>`;

  const customerDetailsHtml = `
    <div class="print-only-details" style="font-size: 11pt; display:block;">
      <div class="detail-line"><span class="detail-label-enter">નામ :- </span><span class="detail-value-line">${
        data["Customer Name"] || ""
      }</span></div>
      <div class="detail-line"><span class="detail-label-enter">ગામ :- </span><span class="detail-value-line">${
        data["Village"] || ""
      }</span></div>
      <div class="detail-line"><span class="detail-label-enter">ગાડી નં :- </span><span class="detail-value-line">${
        data["Vehicle No"] || ""
      }</span></div>
      <div class="detail-line"><span class="detail-label-enter">દલાલ :- </span><span class="detail-value-line">${
        data["Broker"] || ""
      }</span></div>
    </div>
  `;

  return `<div class="container">
    <div class="header" style="display:none;"><h1>Final Bill</h1></div>
    <div class="bill-meta">
      <div class="meta-item"> <span>${data["Serial No"] || ""}</span></div>
      <div class="meta-item"><span>${data["Date"] || ""}</span></div>
    </div>
    ${customerDetailsHtml}
    ${detailsHtml}
    ${tableHtml}
    ${remarksHtml}
    ${supplyTypeHtml}
    ${totalsHtml}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-BILL PRINT (Updated with Universal Print Engine & Page Breaks)
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
        // Yahan naya Universal Print Engine lagaya hai (Amount in words + A4/A5 sizing)
        billsHtml += generateUniversalBillHTML(doc.data());
        // Har bill ke baad ek strict Page Break taaki agla bill naye paper pe aaye
        billsHtml += '<div style="page-break-after: always; break-after: page; clear: both;"></div>';
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
          <link rel="stylesheet" href="css/main.css">
          <link rel="stylesheet" href="css/print.css">
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
  "broker_box",
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
  broker_box: "🤝 દલાલ (Broker & Commission)",
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
  // 👉 Yahan Party Master jod dijiye:
  { href: "party-master.html", icon: "📖", label: "Party Master" },
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

  const connHtml =
    typeof checkFirebaseConnection === "function"
      ? `<button class="nav-conn" onclick="checkFirebaseConnection()">
         <span class="cdot" id="conn-dot"></span>
         <span id="connection_status">Check</span>
       </button>`
      : "";

  // Navbar CSS now lives ONLY in css/main.css — this used to ALSO inject
  // its own <style> block here with old values (fixed height, nowrap),
  // and because it's added to the DOM via JS (after main.css already
  // loaded), it was winning the cascade and silently undoing every fix
  // made in main.css. Removed — single source of truth now.
  root.innerHTML = `
    <nav class="top-navbar">
      <a class="navbar-brand" href="index.html">
        <img src="assets/logo.jpg" alt="Logo"/>
        <span>MandiBook</span>
      </a>
      <button class="navbar-toggle" id="navbar-toggle" aria-label="Menu" type="button">☰</button>
      <div class="navbar-links" id="navbar-links">${linksHtml}${connHtml}</div>
    </nav>`;

  // Hamburger toggle — chhoti screen par links ek dropdown ke peeche chhup
  // jaate hain, ☰ dabane par khulte hain (bade screen par ye button khud
  // hidden rehta hai, CSS se — dekho main.css ka .navbar-toggle rule).
  const toggleBtn = document.getElementById("navbar-toggle");
  const linksPanel = document.getElementById("navbar-links");
  if (toggleBtn && linksPanel) {
    toggleBtn.addEventListener("click", () => {
      linksPanel.classList.toggle("open");
    });
    // Kisi link pe click karte hi menu apne aap band ho jaye
    linksPanel.querySelectorAll("a.nav-link").forEach((a) => {
      a.addEventListener("click", () => linksPanel.classList.remove("open"));
    });
  }
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
// Safe check taaki error na aaye
const currentBillData = typeof data !== "undefined" ? data : window.currentBill || {};

// Har possible spelling/capitalization check karlo
const activeLinkedOrderId =
  currentBillData.LinkedOrderId ||
  currentBillData.linkedOrderId ||
  currentBillData.orderId ||
  new URLSearchParams(window.location.search).get("linkedOrderId");

if (activeLinkedOrderId) {
  db.collection("orders")
    .doc(activeLinkedOrderId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const orderNo = doc.data().orderNo || doc.data().orderNumber;
        const container = document.getElementById("print_ref_order_container");
        const span = document.getElementById("print_ref_order_no");
        if (container && span) {
          span.textContent = orderNo;
          container.style.display = "inline-block";
        }
      } else {
        console.log("❌ Order ID database mein mili hi nahi:", activeLinkedOrderId);
      }
    })
    .catch((err) => console.log("❌ Error fetching linked order:", err));
} else {
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-FETCH & DISPLAY LINKED ORDER REFERENCE ON BILL VIEW
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id");
  if (!billId) return;

  try {
    const billDoc = await db.collection("bills").doc(billId).get();
    if (!billDoc.exists) return;
    const billData = billDoc.data();

    const linkedId = billData.LinkedOrderId || billData.linkedOrderId || billData.orderId;
    if (!linkedId) {
      console.log("⚠️ Is bill ke sath koi Linked Order ID nahi hai.");
      return;
    }

    const orderDoc = await db.collection("orders").doc(linkedId).get();
    if (!orderDoc.exists) return;

    const orderNo = orderDoc.data().orderNo || orderDoc.data().orderNumber;
    const container = document.getElementById("print_ref_order_container");
    const span = document.getElementById("print_ref_order_no");
    if (container && span) {
      span.textContent = orderNo;
      container.style.display = "inline-block";
      console.log("✅ Ref Order No successfully displayed:", orderNo);
    }
  } catch (err) {
    console.error("❌ Error loading linked order reference:", err);
  }
});
// ==================== 10-IN-1 SMART GLOBAL LOADERS (ALL-IN-ONE) ====================
(function () {
  // 1. Get user preference from settings, default to 10 (Wheat Agri Theme)
  const savedTheme = parseInt(localStorage.getItem("mandi_loader_theme")) || 10;

  // 2. Smart Text Engine (Decides text based on which URL user is going to)
  window.getSmartText = function (url) {
    if (!url) return "Processing Data...";
    let path = url.toLowerCase();

    if (path.includes("bill-create") || path.includes("new-bill")) return "Creating Bill...";
    if (path.includes("bill")) return "Fetching Bills...";
    if (path.includes("ledger")) return "Opening Ledger...";
    if (path.includes("report")) return "Generating Report...";
    if (path.includes("order")) return "Loading Orders...";
    if (path.includes("settings")) return "Opening Settings...";
    if (path.includes("dashboard") || path.includes("index")) return "Loading Dashboard...";
    if (path.includes("broker")) return "Fetching Brokers...";

    return "Processing Data...";
  };

  // 3. Inject CSS and HTML dynamically based on selected Theme
  window.applyLoaderTheme = function (themeId) {
    let cssCode = "";
    let htmlCode = "";

    const baseCSS = `
      #global-loader-ui {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        z-index: 999999; visibility: hidden; opacity: 0;
        transition: opacity 0.3s ease, visibility 0.3s ease;
      }
      #global-loader-ui.active { visibility: visible; opacity: 1; }
      #globalLoaderText {
        margin-top: 20px; font-family: 'Poppins', sans-serif; font-size: 14px; 
        font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
        animation: pulseText 1.5s infinite;
      }
      @keyframes pulseText { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
    `;

    if (themeId === 1) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.3); backdrop-filter: blur(8px); } .glass-spinner { width: 50px; height: 50px; border: 4px solid rgba(0, 90, 158, 0.1); border-top: 4px solid #005a9e; border-radius: 50%; animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`;
      htmlCode = `<div class="glass-spinner"></div>`;
    } else if (themeId === 2) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(4px); } .dot-container { display: flex; gap: 12px; } .dot { width: 18px; height: 18px; border-radius: 50%; background: #005a9e; animation: bounce 0.5s alternate infinite cubic-bezier(.5,0.05,1,.5); } .dot:nth-child(2) { animation-delay: 0.15s; background: #e67e22; } .dot:nth-child(3) { animation-delay: 0.3s; background: #27ae60; } @keyframes bounce { to { transform: translateY(-20px); } }`;
      htmlCode = `<div class="dot-container"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
    } else if (themeId === 3) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.9); } .brand-text { font-size: 36px; font-weight: 900; font-family: 'Poppins', sans-serif; background: linear-gradient(90deg, #005a9e, #e67e22); -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: breathe 1s infinite ease-in-out alternate; letter-spacing: 2px; } @keyframes breathe { 0% { transform: scale(0.95); opacity: 0.8; } 100% { transform: scale(1.05); opacity: 1; filter: drop-shadow(0px 5px 10px rgba(230,126,34,0.4)); } }`;
      htmlCode = `<div class="brand-text">${
        globalSettings && globalSettings.companyName ? globalSettings.companyName : "MandiBook"
      }</div>`;
    } else if (themeId === 4) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(3px); } .morph-loader { width: 50px; height: 50px; background: #005a9e; animation: morph 1.5s infinite ease-in-out alternate; } @keyframes morph { 0% { border-radius: 10%; transform: rotate(0deg) scale(1); background: #005a9e; } 50% { border-radius: 50%; transform: rotate(180deg) scale(1.2); background: #e67e22; } 100% { border-radius: 10%; transform: rotate(360deg) scale(1); background: #27ae60; } }`;
      htmlCode = `<div class="morph-loader"></div>`;
    } else if (themeId === 5) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(5px); } .cube-flip { width: 45px; height: 45px; background: transparent; border: 4px solid #005a9e; border-top-color: #e67e22; border-radius: 8px; animation: spin3D 1.2s infinite cubic-bezier(0.68, -0.55, 0.265, 1.55); box-shadow: 0 10px 20px rgba(0,0,0,0.1); } @keyframes spin3D { 0% { transform: perspective(120px) rotateX(0deg) rotateY(0deg); } 50% { transform: perspective(120px) rotateX(-180.1deg) rotateY(0deg); } 100% { transform: perspective(120px) rotateX(-180deg) rotateY(-179.9deg); } }`;
      htmlCode = `<div class="cube-flip"></div>`;
    } else if (themeId === 6) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(4px); } .arc-spinner { position: relative; width: 60px; height: 60px; } .arc-spinner .arc { position: absolute; inset: 0; border-radius: 50%; border: 3px solid transparent; } .arc-spinner .arc:nth-child(1) { border-top-color: #005a9e; animation: spinArc 1s linear infinite; } .arc-spinner .arc:nth-child(2) { border-right-color: #e67e22; inset: 8px; animation: spinArc 1.5s linear infinite reverse; } .arc-spinner .arc:nth-child(3) { border-bottom-color: #27ae60; inset: 16px; animation: spinArc 2s linear infinite; } @keyframes spinArc { to { transform: rotate(360deg); } }`;
      htmlCode = `<div class="arc-spinner"><div class="arc"></div><div class="arc"></div><div class="arc"></div></div>`;
    } else if (themeId === 7) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.75); backdrop-filter: blur(6px); } .radar-spinner { width: 65px; height: 65px; border-radius: 50%; background: conic-gradient(from 0deg, transparent 60%, #005a9e 100%); animation: radar 1s linear infinite; position: relative; box-shadow: 0 0 20px rgba(0, 90, 158, 0.2); } .radar-spinner::before { content: ''; position: absolute; inset: 5px; background: #ffffff; border-radius: 50%; box-shadow: inset 0 0 10px rgba(0,0,0,0.05); } @keyframes radar { to { transform: rotate(360deg); } }`;
      htmlCode = `<div class="radar-spinner"></div>`;
    } else if (themeId === 8) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.9); } .ripple-loader { position: relative; width: 64px; height: 64px; } .ripple-loader div { position: absolute; border: 4px solid #005a9e; opacity: 1; border-radius: 50%; animation: rippleAnim 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite; } .ripple-loader div:nth-child(2) { animation-delay: -0.5s; border-color: #e67e22; } @keyframes rippleAnim { 0% { top: 32px; left: 32px; width: 0; height: 0; opacity: 0; } 5% { top: 32px; left: 32px; width: 0; height: 0; opacity: 1; } 100% { top: 0px; left: 0px; width: 64px; height: 64px; opacity: 0; } }`;
      htmlCode = `<div class="ripple-loader"><div></div><div></div></div>`;
    } else if (themeId === 9) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(5px); } .hex-loader { display: flex; gap: 8px; } .hex { width: 24px; height: 28px; background: #005a9e; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: hexPulse 1s infinite alternate; } .hex:nth-child(2) { background: #e67e22; animation-delay: 0.2s; } .hex:nth-child(3) { background: #27ae60; animation-delay: 0.4s; } @keyframes hexPulse { 0% { transform: scale(0.7); opacity: 0.4; } 100% { transform: scale(1.15); opacity: 1; } }`;
      htmlCode = `<div class="hex-loader"><div class="hex"></div><div class="hex"></div><div class="hex"></div></div>`;
    } else if (themeId === 10) {
      cssCode =
        baseCSS +
        `#global-loader-ui { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(4px); } .agri-loader-container { position: relative; width: 60px; height: 90px; } .stalk { position: absolute; left: 28px; bottom: 0; width: 4px; height: 100%; background: #e67e22; border-radius: 2px; transform-origin: bottom center; animation: stalkPulse 2s ease-in-out infinite; } .grain { position: absolute; width: 12px; height: 22px; background: #f1c40f; border-radius: 50% 50% 20% 20%; transform: scale(0); animation: grainGrow 2s ease-in-out infinite; } .gl1 { left: 16px; top: 15px; transform-origin: center right; } .gl2 { left: 16px; top: 45px; transform-origin: center right; } .gr1 { left: 32px; top: 0px; transform-origin: center left; } .gr2 { left: 32px; top: 30px; transform-origin: center left; } .gr3 { left: 32px; top: 60px; transform-origin: center left; } @keyframes stalkPulse { 0%, 100% { transform: scaleY(0.95); } 50% { transform: scaleY(1); } } @keyframes grainGrow { 0%, 100% { transform: scale(0); opacity: 0; } 10%, 90% { opacity: 1; } 50% { transform: scale(1.1); } } .gr1 { animation-delay: 0.1s; } .gl1 { animation-delay: 0.3s; } .gr2 { animation-delay: 0.5s; } .gl2 { animation-delay: 0.7s; } .gr3 { animation-delay: 0.9s; }`;
      htmlCode = `<div class="agri-loader-container"><div class="stalk"></div><div class="grain gr1"></div><div class="grain gl1"></div><div class="grain gr2"></div><div class="grain gl2"></div><div class="grain gr3"></div></div>`;
    }

    // Dynamic Text Element Injection
    let textColor = themeId === 10 || themeId === 3 ? "#d35400" : "#005a9e";
    htmlCode += `<div id="globalLoaderText" style="color: ${textColor};">Processing Data...</div>`;

    let styleTag = document.getElementById("dynamic-loader-style");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "dynamic-loader-style";
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = cssCode;

    let loaderDiv = document.getElementById("global-loader-ui");
    if (!loaderDiv) {
      loaderDiv = document.createElement("div");
      loaderDiv.id = "global-loader-ui";
      document.body.appendChild(loaderDiv);
    }
    loaderDiv.innerHTML = htmlCode;
  };

  // 4. Initialize on Page Load
  document.addEventListener("DOMContentLoaded", () => {
    window.applyLoaderTheme(savedTheme);

    // Auto-catch all navigation links for Smart Text
    document.addEventListener("click", (e) => {
      const link = e.target.closest("a");
      const targetUrl = link ? link.getAttribute("href") : null;

      if (link && targetUrl && targetUrl !== "#" && !targetUrl.startsWith("javascript")) {
        e.preventDefault();
        const customMsg = window.getSmartText(targetUrl);
        window.showLoader(customMsg);
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 400);
      }
    });
  });
})();

// ==================== GLOBAL FUNCTIONS & OLD SYSTEM BRIDGE ====================

// Base functions to show/hide loader with text update
window.showLoader = function (textMsg) {
  const l = document.getElementById("global-loader-ui");
  const textEl = document.getElementById("globalLoaderText");

  if (textEl) {
    textEl.innerText = textMsg ? textMsg : "Processing Data...";
  }

  if (l) l.classList.add("active");
};

window.hideLoader = function () {
  const l = document.getElementById("global-loader-ui");
  if (l) l.classList.remove("active");
};

// 🔥 BRIDGE FOR OLD FILES (ledger.js, bill-list.js, reports.js) 🔥
window.showLoading = function (customText) {
  if (typeof window.showLoader === "function") {
    window.showLoader(customText || "Processing Data...");
  }
};

window.hideLoading = function () {
  if (typeof window.hideLoader === "function") {
    window.hideLoader();
  }
};

// Function for Settings Page Live Demo
window.demoAndSaveLoader = function (themeId) {
  themeId = parseInt(themeId);
  localStorage.setItem("mandi_loader_theme", themeId);
  window.applyLoaderTheme(themeId);
  window.showLoader("Saving Preference...");

  setTimeout(() => {
    window.hideLoader();
  }, 3000);
};
// ==================== GLOBAL FUNCTIONS & OLD SYSTEM BRIDGE ====================

window.loaderTimeout = null; // Failsafe Timer Variable

// Base functions to show/hide loader with text update
window.showLoader = function (textMsg) {
  const l = document.getElementById("global-loader-ui");
  const textEl = document.getElementById("globalLoaderText");

  if (textEl) {
    textEl.style.color = ""; // Reset color in case it was red earlier
    textEl.innerText = textMsg ? textMsg : "Processing Data...";
  }

  if (l) l.classList.add("active");

  // 🔥 15-SECOND FAILSAFE (ANTI-HANG SYSTEM) 🔥
  clearTimeout(window.loaderTimeout);
  window.loaderTimeout = setTimeout(() => {
    // Agar 15 second baad bhi loader chal raha hai
    if (l && l.classList.contains("active")) {
      if (textEl) {
        textEl.style.color = "#e74c3c"; // Alert ke liye Red color
        textEl.innerText = "Network slow. Please try again.";
      }
      // 2.5 seconds message dikhane ke baad loader hata do
      setTimeout(() => {
        window.hideLoader();
      }, 2500);
    }
  }, 15000); // 15000 ms = 15 Seconds
};

window.hideLoader = function () {
  const l = document.getElementById("global-loader-ui");
  if (l) l.classList.remove("active");

  // Agar 15 second se pehle data aa gaya, toh failsafe timer cancel kar do
  clearTimeout(window.loaderTimeout);
};

// 🔥 BRIDGE FOR OLD FILES (ledger.js, bill-list.js, reports.js) 🔥
window.showLoading = function (customText) {
  if (typeof window.showLoader === "function") {
    window.showLoader(customText || "Processing Data...");
  }
};

window.hideLoading = function () {
  if (typeof window.hideLoader === "function") {
    window.hideLoader();
  }
};

// Function for Settings Page Live Demo
window.demoAndSaveLoader = function (themeId) {
  themeId = parseInt(themeId);
  localStorage.setItem("mandi_loader_theme", themeId);
  window.applyLoaderTheme(themeId);
  window.showLoader("Saving Preference...");

  setTimeout(() => {
    window.hideLoader();
  }, 3000);
};
