/**
 * @file reports.js
 * @description All 8 reports for MandiBook
 */

let currentReport = "daily";
let allBillsCache = [];
let reportRequest = 0;

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  document.querySelectorAll("[data-report-preset]").forEach((button) => {
    button.addEventListener("click", () => setReportPreset(button.dataset.reportPreset));
  });
  ["report-start", "report-end"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    document.querySelectorAll("[data-report-preset]").forEach((button) => button.setAttribute("aria-pressed", "false"));
  }));
  document.querySelectorAll(".report-card").forEach((card) => {
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-pressed", String(card.classList.contains("active")));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); card.click(); }
    });
  });
  if (window.currentUserProfile) generateReport();
});
window.addEventListener("mandibook:access-ready", ({ detail }) => { if (detail) generateReport(); });

function setDefaultDates() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const start = document.getElementById("report-start");
  const end = document.getElementById("report-end");
  if (start) start.value = `${yyyy}-${mm}-01`;
  if (end) end.value = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, "0")}`;
}

function reportDateRange(preset, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(end);
  if (preset === "yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (preset === "month") start.setDate(1);
  if (preset === "financial") start = new Date(end.getMonth() >= 3 ? end.getFullYear() : end.getFullYear() - 1, 3, 1);
  return { start: WorkspaceUI.localDate(start), end: WorkspaceUI.localDate(end) };
}
function setReportPreset(preset) {
  const range = reportDateRange(preset);
  document.getElementById("report-start").value = range.start;
  document.getElementById("report-end").value = range.end;
  document.querySelectorAll("[data-report-preset]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.reportPreset === preset)));
  generateReport();
}
function reportBillDate(value) {
  if (value?.toDate) return WorkspaceUI.localDate(value.toDate());
  const text = String(value || "");
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function selectReport(type) {
  currentReport = type;
  document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
  document.getElementById(`rc-${type}`)?.classList.add("active");
  document.querySelectorAll(".report-card").forEach((card) => card.setAttribute("aria-pressed", String(card.classList.contains("active"))));
  generateReport();
}

// ── LOAD BILLS ────────────────────────────────────────────────────────────────
async function loadBillsInRange() {
  const startVal = document.getElementById("report-start")?.value;
  const endVal = document.getElementById("report-end")?.value;
  {
    const snap = await billsCollection.get();
    let bills = snap.docs.filter((d) => d.data().deleted !== true).map((d) => {
      const bill = { ...d.data(), id: d.id };
      const key = reportBillDate(bill.Date || bill.createdAt);
      if (key) { const [y,m,day] = key.split("-"); bill.Date = `${day}/${m}/${y}`; }
      ["Final Total", "Net Weight", "BrokerCommission", "amountPaid"].forEach((field) => { bill[field] = Number(bill[field] || 0); });
      return bill;
    });

    if (startVal && endVal) {
      bills = bills.filter((b) => {
        const key = reportBillDate(b.Date || b.createdAt);
        return key && key >= startVal && key <= endVal;
      });
    }
    return bills;
  }
}

// ── GENERATE REPORT ───────────────────────────────────────────────────────────
async function generateReport() {
  const request = ++reportRequest;
  const status = document.getElementById("reports-sync-status");
  showLoading();
  if (status) status.textContent = "Updating report…";
  try {
    const start = document.getElementById("report-start").value;
    const end = document.getElementById("report-end").value;
    if (start && end && start > end) throw new Error("Start date must be before the end date.");
    const bills = await loadBillsInRange();
    if (request !== reportRequest) return;
    allBillsCache = bills;
    document.getElementById("report-state").replaceChildren();
    const fns = { daily, supplier, product, broker, village, vehicle, monthly, payment };
    if (fns[currentReport]) fns[currentReport](bills);
    if (!bills.length) WorkspaceUI.state(document.getElementById("report-state"), {
      title: "No bills in this date range", message: "Choose a wider range to review earlier business records.",
      action: "Show this financial year", onAction: () => setReportPreset("financial"),
    });
    if (status) status.textContent = `Checked ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    if (request !== reportRequest) return;
    if (status) status.textContent = "Report could not update";
    document.getElementById("report-summary").replaceChildren();
    document.getElementById("report-chart-container").style.display = "none";
    document.getElementById("report-table-container").style.display = "none";
    WorkspaceUI.state(document.getElementById("report-state"), { title: "Could not load report", message: error.message, action: "Retry", onAction: generateReport, error: true });
  } finally {
    if (request === reportRequest) hideLoading();
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN");
}
function fmtR(n) {
  return "₹" + fmt(n);
}

function showSummary(items) {
  document.getElementById("report-summary").innerHTML = items
    .map(
      (i) => `
    <a class="summary-card summary-link" href="${escapeHtml(reportSummaryHref(i.label))}">
      <div class="summary-val">${i.val}</div>
      <div class="summary-lbl">${i.label}</div>
      <span class="summary-open">View records ↗</span>
    </a>`
    )
    .join("");
}
function reportSummaryHref(label) {
  const params = new URLSearchParams({ from: document.getElementById("report-start").value, to: document.getElementById("report-end").value });
  if (label.includes("Unpaid")) params.set("status", "due");
  else if (label.includes("Partial")) params.set("status", "partial");
  else if (label.includes("Paid")) params.set("status", "paid");
  else if (label.includes("Due")) params.set("status", "outstanding");
  return `bills.html?${params}`;
}

function showTable(title, headers, rows, footers = []) {
  const container = document.getElementById("report-table-container");
  container.style.display = "block";
  document.getElementById("report-title").textContent = title;
  document.getElementById("report-thead").innerHTML = `<tr>${headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("")}</tr>`;
  // All report cells are data, including customer-provided names.
  const cell = (c) => escapeHtml(c);
  document.getElementById("report-tbody").innerHTML = rows
    .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`)
    .join("");
  document.getElementById("report-tfoot").innerHTML = footers.length
    ? `<tr>${footers.map((f) => `<td>${cell(f)}</td>`).join("")}</tr>`
    : "";
}

// ── CHART ─────────────────────────────────────────────────────────────────────
let reportChartInstance = null;
const CHART_COLORS = ["#005a9e", "#28a745", "#e8590c", "#d6336c", "#6f42c1", "#0ea5e9", "#f4a507", "#16a085"];

function showChart(title, type, labels, datasetLabel, values) {
  const container = document.getElementById("report-chart-container");
  const canvas = document.getElementById("report-chart");
  if (!labels.length || typeof Chart === "undefined") {
    container.style.display = "none";
    return;
  }
  container.style.display = "block";
  document.getElementById("report-chart-title").textContent = title;
  if (reportChartInstance) reportChartInstance.destroy();

  const isPie = type === "pie";
  reportChartInstance = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [
        {
          label: datasetLabel,
          data: values,
          backgroundColor: isPie ? CHART_COLORS : "#005a9e",
          borderColor: "#005a9e",
          borderWidth: type === "line" ? 2 : 0,
          tension: 0.3,
          fill: type === "line" ? "start" : undefined,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: type === "bar" && labels.length > 8 ? "y" : "x",
      plugins: { legend: { display: isPie } },
      scales: isPie ? {} : { y: { beginAtZero: true } },
    },
  });
}

function hideChart() {
  document.getElementById("report-chart-container").style.display = "none";
}

// ── 1. DAILY ──────────────────────────────────────────────────────────────────
function daily(bills) {
  const byDate = {};
  bills.forEach((b) => {
    byDate[b.Date] = byDate[b.Date] || { count: 0, weight: 0, amount: 0, bags: 0 };
    byDate[b.Date].count++;
    byDate[b.Date].weight += b["Net Weight"] || 0;
    byDate[b.Date].amount += b["Final Total"] || 0;
    if (b["Bill Type"] === "Loose") {
      byDate[b.Date].bags += Math.round((b["Net Weight"] || 0) / 50);
    } else {
      for (let i = 1; i <= 5; i++) byDate[b.Date].bags += Number(b[`Vakal ${i} Katta`]) || 0;
    }
  });
  const rows = Object.entries(byDate)
    .sort()
    .map(([date, d]) => [date, d.count, fmt(d.bags), fmt(d.weight) + " kg", fmtR(d.amount)]);
  const totals = Object.values(byDate);
  showSummary([
    { val: bills.length, label: "Total Bills" },
    { val: fmtR(totals.reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
    { val: fmt(totals.reduce((s, d) => s + d.weight, 0)) + " kg", label: "Total Weight" },
    { val: fmt(totals.reduce((s, d) => s + d.bags, 0)), label: "Total Bags" },
  ]);
  showTable("Daily Report", ["Date", "Bills", "Bags", "Weight", "Amount"], rows, [
    "TOTAL",
    bills.length,
    "",
    "",
    fmtR(totals.reduce((s, d) => s + d.amount, 0)),
  ]);
  const sortedEntries = Object.entries(byDate).sort();
  showChart(
    "Amount Trend",
    "line",
    sortedEntries.map(([d]) => d),
    "Amount (₹)",
    sortedEntries.map(([, d]) => d.amount)
  );
}

// ── 2. SUPPLIER ───────────────────────────────────────────────────────────────
function supplier(bills) {
  const bySupplier = {};
  bills.forEach((b) => {
    const n = b["Customer Name"] || "Unknown";
    bySupplier[n] = bySupplier[n] || { count: 0, weight: 0, amount: 0, village: b["Village"] || "" };
    bySupplier[n].count++;
    bySupplier[n].weight += b["Net Weight"] || 0;
    bySupplier[n].amount += b["Final Total"] || 0;
  });
  const rows = Object.entries(bySupplier)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, d]) => [name, d.village, d.count, fmt(d.weight) + " kg", fmtR(d.amount)]);
  showSummary([
    { val: Object.keys(bySupplier).length, label: "Suppliers" },
    { val: bills.length, label: "Total Bills" },
    { val: fmtR(Object.values(bySupplier).reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
  ]);
  showTable("Supplier Report", ["Supplier", "Village", "Bills", "Weight", "Amount"], rows, [
    "TOTAL",
    "",
    bills.length,
    "",
    fmtR(Object.values(bySupplier).reduce((s, d) => s + d.amount, 0)),
  ]);
  const top = Object.entries(bySupplier)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10);
  showChart(
    "Top Suppliers by Amount",
    "bar",
    top.map(([n]) => n),
    "Amount (₹)",
    top.map(([, d]) => d.amount)
  );
}

// ── 3. PRODUCT ────────────────────────────────────────────────────────────────
function product(bills) {
  const byProduct = {};
  bills.forEach((b) => {
    const p = b["ProductTemplate"] || "Manual";
    byProduct[p] = byProduct[p] || { count: 0, weight: 0, amount: 0, bags: 0 };
    byProduct[p].count++;
    byProduct[p].weight += b["Net Weight"] || 0;
    byProduct[p].amount += b["Final Total"] || 0;
    if (b["Bill Type"] === "Loose") {
      byProduct[p].bags += Math.round((b["Net Weight"] || 0) / 50);
    } else {
      for (let i = 1; i <= 5; i++) byProduct[p].bags += Number(b[`Vakal ${i} Katta`]) || 0;
    }
  });
  const rows = Object.entries(byProduct)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, d]) => [name, d.count, fmt(d.bags), fmt(d.weight) + " kg", fmtR(d.amount)]);
  showSummary([
    { val: Object.keys(byProduct).length, label: "Products" },
    { val: fmtR(Object.values(byProduct).reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
  ]);
  showTable("Product Report", ["Product", "Bills", "Bags", "Weight", "Amount"], rows);
  const top = Object.entries(byProduct)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10);
  showChart(
    "Amount by Product",
    "bar",
    top.map(([n]) => n),
    "Amount (₹)",
    top.map(([, d]) => d.amount)
  );
}

// ── 4. BROKER ─────────────────────────────────────────────────────────────────
function broker(bills) {
  const byBroker = {};
  bills.forEach((b) => {
    const n = b["Broker"] || "Direct";
    byBroker[n] = byBroker[n] || { count: 0, amount: 0, commission: 0, bags: 0 };
    byBroker[n].count++;
    byBroker[n].amount += b["Final Total"] || 0;
    byBroker[n].commission += b["BrokerCommission"] || 0;
    if (b["Bill Type"] === "Loose") {
      byBroker[n].bags += Math.round((b["Net Weight"] || 0) / 50);
    } else {
      for (let i = 1; i <= 5; i++) byBroker[n].bags += Number(b[`Vakal ${i} Katta`]) || 0;
    }
  });
  const rows = Object.entries(byBroker)
    .sort((a, b) => b[1].commission - a[1].commission)
    .map(([name, d]) => [name, d.count, fmt(d.bags), fmtR(d.amount), fmtR(d.commission)]);
  showSummary([
    { val: Object.keys(byBroker).length, label: "Brokers" },
    { val: fmtR(Object.values(byBroker).reduce((s, d) => s + d.commission, 0)), label: "Total Commission" },
  ]);
  showTable("Broker Report", ["Broker", "Bills", "Bags", "Amount", "Commission"], rows, [
    "TOTAL",
    bills.length,
    "",
    "",
    fmtR(Object.values(byBroker).reduce((s, d) => s + d.commission, 0)),
  ]);
  const top = Object.entries(byBroker)
    .sort((a, b) => b[1].commission - a[1].commission)
    .slice(0, 10);
  showChart(
    "Top Brokers by Commission",
    "bar",
    top.map(([n]) => n),
    "Commission (₹)",
    top.map(([, d]) => d.commission)
  );
}

// ── 5. VILLAGE ────────────────────────────────────────────────────────────────
function village(bills) {
  const byVillage = {};
  bills.forEach((b) => {
    const v = b["Village"] || "Unknown";
    byVillage[v] = byVillage[v] || { count: 0, amount: 0, weight: 0 };
    byVillage[v].count++;
    byVillage[v].amount += b["Final Total"] || 0;
    byVillage[v].weight += b["Net Weight"] || 0;
  });
  const rows = Object.entries(byVillage)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([v, d]) => [v, d.count, fmt(d.weight) + " kg", fmtR(d.amount)]);
  showSummary([
    { val: Object.keys(byVillage).length, label: "Villages" },
    { val: fmtR(Object.values(byVillage).reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
  ]);
  showTable("Village Report", ["Village", "Bills", "Weight", "Amount"], rows);
  const top = Object.entries(byVillage)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 10);
  showChart(
    "Amount by Village",
    "bar",
    top.map(([n]) => n),
    "Amount (₹)",
    top.map(([, d]) => d.amount)
  );
}

// ── 6. VEHICLE ────────────────────────────────────────────────────────────────
function vehicle(bills) {
  const byVehicle = {};
  bills.forEach((b) => {
    const v = b["Vehicle No"] || "Unknown";
    byVehicle[v] = byVehicle[v] || { count: 0, amount: 0, suppliers: new Set() };
    byVehicle[v].count++;
    byVehicle[v].amount += b["Final Total"] || 0;
    byVehicle[v].suppliers.add(b["Customer Name"]);
  });
  const rows = Object.entries(byVehicle)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([v, d]) => [v, d.count, d.suppliers.size, fmtR(d.amount)]);
  showSummary([
    { val: Object.keys(byVehicle).length, label: "Vehicles" },
    { val: bills.length, label: "Total Trips" },
  ]);
  showTable("Vehicle Report", ["Vehicle No", "Trips", "Suppliers", "Amount"], rows);
  const top = Object.entries(byVehicle)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  showChart(
    "Trips by Vehicle",
    "bar",
    top.map(([n]) => n),
    "Trips",
    top.map(([, d]) => d.count)
  );
}

// ── 7. MONTHLY ────────────────────────────────────────────────────────────────
function monthly(bills) {
  const byMonth = {};
  bills.forEach((b) => {
    const [, mm, yyyy] = String(b.Date || "").split("/");
    if (!mm || !yyyy) return;
    const key = `${yyyy}-${mm}`;
    byMonth[key] = byMonth[key] || { count: 0, amount: 0, weight: 0, bags: 0 };
    byMonth[key].count++;
    byMonth[key].amount += b["Final Total"] || 0;
    byMonth[key].weight += b["Net Weight"] || 0;
    if (b["Bill Type"] === "Loose") {
      byMonth[key].bags += Math.round((b["Net Weight"] || 0) / 50);
    } else {
      for (let i = 1; i <= 5; i++) byMonth[key].bags += Number(b[`Vakal ${i} Katta`]) || 0;
    }
  });
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows = Object.entries(byMonth)
    .sort()
    .map(([key, d]) => {
      const [y, m] = key.split("-");
      return [`${months[Number(m)]} ${y}`, d.count, fmt(d.bags), fmt(d.weight) + " kg", fmtR(d.amount)];
    });
  showSummary([
    { val: Object.keys(byMonth).length, label: "Months" },
    { val: bills.length, label: "Total Bills" },
    { val: fmtR(Object.values(byMonth).reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
  ]);
  showTable("Monthly Summary", ["Month", "Bills", "Bags", "Weight", "Amount"], rows, [
    "TOTAL",
    bills.length,
    "",
    "",
    fmtR(Object.values(byMonth).reduce((s, d) => s + d.amount, 0)),
  ]);
  const sortedEntries = Object.entries(byMonth).sort();
  showChart(
    "Monthly Amount Trend",
    "line",
    sortedEntries.map(([key]) => {
      const [y, m] = key.split("-");
      return `${months[Number(m)]} ${y}`;
    }),
    "Amount (₹)",
    sortedEntries.map(([, d]) => d.amount)
  );
}

// ── 8. PAYMENT ────────────────────────────────────────────────────────────────
function payment(bills) {
  const bucket = (b) => String(b.paymentStatus || "").toLowerCase() === "paid" || (b["Final Total"] > 0 && b.amountPaid >= b["Final Total"] - .01) ? "paid" : String(b.paymentStatus || "").toLowerCase().includes("partial") || b.amountPaid > 0 ? "partial" : "due";
  const paid = bills.filter((b) => bucket(b) === "paid");
  const partial = bills.filter((b) => bucket(b) === "partial");
  const unpaid = bills.filter((b) => bucket(b) === "due");
  const totalDue =
    unpaid.reduce((s, b) => s + (b["Final Total"] || 0), 0) +
    partial.reduce((s, b) => s + (b["Final Total"] || 0) - (b.amountPaid || 0), 0);
  const rows = [...unpaid, ...partial]
    .sort((a, b) => (a.Date > b.Date ? 1 : -1))
    .map((b) => [
      b["Serial No"],
      b.Date,
      b["Customer Name"],
      fmtR(b["Final Total"]),
      fmtR(b.amountPaid || 0),
      fmtR(Math.max(0, (b["Final Total"] || 0) - (b.amountPaid || 0))),
      b.paymentStatus || "Unpaid",
    ]);
  showSummary([
    { val: paid.length, label: "✅ Paid" },
    { val: partial.length, label: "🔄 Partial" },
    { val: unpaid.length, label: "❌ Unpaid" },
    { val: `<span style="color:#dc3545;">${fmtR(totalDue)}</span>`, label: "Total Due" },
  ]);
  showTable("Payment Report", ["Bill No", "Date", "Supplier", "Total", "Paid", "Balance", "Status"], rows);
  showChart("Payment Status Split", "pie", ["Paid", "Partial", "Unpaid"], "Bills", [
    paid.length,
    partial.length,
    unpaid.length,
  ]);
}

// ── EXPORT EXCEL ──────────────────────────────────────────────────────────────
function exportReportExcel() {
  const table = document.getElementById("report-table");
  if (!table) return;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, currentReport);
  XLSX.writeFile(wb, `MandiBook_${currentReport}_report.xlsx`);
}
