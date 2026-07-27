/**
 * @file reports.js
 * @description All 8 reports for MandiBook
 */

let currentReport = "daily";
let allBillsCache = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setDefaultDates();
  generateReport();
});

function setDefaultDates() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const start = document.getElementById("report-start");
  const end = document.getElementById("report-end");
  if (start) start.value = `${yyyy}-${mm}-01`;
  if (end) end.value = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, "0")}`;
}

function selectReport(type) {
  currentReport = type;
  document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
  document.getElementById(`rc-${type}`)?.classList.add("active");
  generateReport();
}

// ── LOAD BILLS ────────────────────────────────────────────────────────────────
async function loadBillsInRange() {
  const startVal = document.getElementById("report-start")?.value;
  const endVal = document.getElementById("report-end")?.value;
  showLoading();
  try {
    const snap = await billsCollection.orderBy("Date").get();
    let bills = snap.docs.filter((d) => d.data().deleted !== true).map((d) => ({ id: d.id, ...d.data() }));

    if (startVal && endVal) {
      const s = new Date(startVal);
      const e = new Date(endVal);
      e.setHours(23, 59, 59);
      bills = bills.filter((b) => {
        const [dd, mm, yyyy] = b.Date.split("/");
        const bd = new Date(`${yyyy}-${mm}-${dd}`);
        return bd >= s && bd <= e;
      });
    }
    allBillsCache = bills;
    return bills;
  } finally {
    hideLoading();
  }
}

// ── GENERATE REPORT ───────────────────────────────────────────────────────────
async function generateReport() {
  const bills = await loadBillsInRange();
  const fns = { daily, supplier, product, broker, village, vehicle, monthly, payment };
  if (fns[currentReport]) fns[currentReport](bills);
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
    <div class="summary-card">
      <div class="summary-val">${i.val}</div>
      <div class="summary-lbl">${i.label}</div>
    </div>`
    )
    .join("");
}

function showTable(title, headers, rows, footers = []) {
  const container = document.getElementById("report-table-container");
  container.style.display = "block";
  document.getElementById("report-title").textContent = title;
  document.getElementById("report-thead").innerHTML = `<tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>`;
  document.getElementById("report-tbody").innerHTML = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  document.getElementById("report-tfoot").innerHTML = footers.length
    ? `<tr>${footers.map((f) => `<td>${f}</td>`).join("")}</tr>`
    : "";
}

// ── 1. DAILY ──────────────────────────────────────────────────────────────────
function daily(bills) {
  const byDate = {};
  bills.forEach((b) => {
    byDate[b.Date] = byDate[b.Date] || { count: 0, weight: 0, amount: 0, bags: 0 };
    byDate[b.Date].count++;
    byDate[b.Date].weight += b["Net Weight"] || 0;
    byDate[b.Date].amount += b["Final Total"] || 0;
    for (let i = 1; i <= 5; i++) byDate[b.Date].bags += b[`Vakal ${i} Katta`] || 0;
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
    for (let i = 1; i <= 5; i++) byProduct[p].bags += b[`Vakal ${i} Katta`] || 0;
  });
  const rows = Object.entries(byProduct)
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([name, d]) => [name, d.count, fmt(d.bags), fmt(d.weight) + " kg", fmtR(d.amount)]);
  showSummary([
    { val: Object.keys(byProduct).length, label: "Products" },
    { val: fmtR(Object.values(byProduct).reduce((s, d) => s + d.amount, 0)), label: "Total Amount" },
  ]);
  showTable("Product Report", ["Product", "Bills", "Bags", "Weight", "Amount"], rows);
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
    for (let i = 1; i <= 5; i++) byBroker[n].bags += b[`Vakal ${i} Katta`] || 0;
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
}

// ── 7. MONTHLY ────────────────────────────────────────────────────────────────
function monthly(bills) {
  const byMonth = {};
  bills.forEach((b) => {
    const [, mm, yyyy] = b.Date.split("/");
    const key = `${yyyy}-${mm}`;
    byMonth[key] = byMonth[key] || { count: 0, amount: 0, weight: 0, bags: 0 };
    byMonth[key].count++;
    byMonth[key].amount += b["Final Total"] || 0;
    byMonth[key].weight += b["Net Weight"] || 0;
    for (let i = 1; i <= 5; i++) byMonth[key].bags += b[`Vakal ${i} Katta`] || 0;
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
}

// ── 8. PAYMENT ────────────────────────────────────────────────────────────────
function payment(bills) {
  const paid = bills.filter((b) => b.paymentStatus === "Paid");
  const partial = bills.filter((b) => b.paymentStatus === "Partially Paid");
  const unpaid = bills.filter((b) => !b.paymentStatus || b.paymentStatus === "Unpaid");
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
      `<span style="color:#dc3545;font-weight:700;">${fmtR((b["Final Total"] || 0) - (b.amountPaid || 0))}</span>`,
      b.paymentStatus || "Unpaid",
    ]);
  showSummary([
    { val: paid.length, label: "✅ Paid" },
    { val: partial.length, label: "🔄 Partial" },
    { val: unpaid.length, label: "❌ Unpaid" },
    { val: `<span style="color:#dc3545;">${fmtR(totalDue)}</span>`, label: "Total Due" },
  ]);
  showTable("Payment Report", ["Bill No", "Date", "Supplier", "Total", "Paid", "Balance", "Status"], rows);
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
