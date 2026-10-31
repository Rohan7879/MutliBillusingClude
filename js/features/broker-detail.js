let brokerDetailName = "";
let brokerDetailBalance = 0;
let brokerDetailBills = [];
let brokerDetailPayments = [];
let brokerDetailView = "bills";
let brokerDetailStarted = false;
let brokerYear = new URLSearchParams(location.search).get("fy") || "all";
let brokerStatement = null;
if (brokerYear !== "all") brokerDetailView = "ledger";

function startBrokerDetail() {
  if (brokerDetailStarted || !window.currentUserProfile || !["admin", "manager", "accountant"].includes(window.currentUserProfile.role)) return;
  brokerDetailStarted = true;
  loadBrokerDetail();
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("broker-fy").addEventListener("change", event => {
    brokerYear = event.target.value;
    const url = new URL(location.href); if (brokerYear === "all") url.searchParams.delete("fy"); else url.searchParams.set("fy", brokerYear);
    history.replaceState(null, "", url); loadBrokerDetail();
  });
  document.querySelectorAll("[data-broker-view]").forEach((button) => button.addEventListener("click", () => {
    brokerDetailView = button.dataset.brokerView;
    document.querySelectorAll("[data-broker-view]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    renderBrokerDetail();
  }));
  document.getElementById("broker-detail-pay").addEventListener("click", () => openBrokerPaymentModal(brokerDetailName, Math.max(0, brokerDetailBalance)));
  startBrokerDetail();
});
window.addEventListener("mandibook:access-ready", startBrokerDetail);
window.addEventListener("mandibook:broker-payment-saved", loadBrokerDetail);

async function loadBrokerDetail() {
  const target = document.getElementById("broker-detail-content");
  const status = document.getElementById("broker-detail-sync");
  const params = new URLSearchParams(window.location.search);
  const partyId = params.get("partyId");
  const identifier = partyId || params.get("name") || "";
  if (!identifier) {
    status.textContent = "Select a broker";
    WorkspaceUI.state(target, { title: "Choose a broker first", message: "Open an account from your broker directory.", action: "Open directory", href: "broker-ledger.html" });
    return;
  }
  status.textContent = "Updating account…";
  try {
    const [bills, payments, brokers, parties] = await Promise.all([
      billsCollection.get(), db.collection("broker_payments").get(), db.collection("brokers").get(), db.collection("parties").get(),
    ]);
    const upper = (value) => String(value || "").trim().toUpperCase();
    const master = brokers.docs.find((doc) => doc.id === identifier || upper(doc.data().name) === upper(identifier));
    brokerDetailName = master?.data().name || identifier;
    const partyRows = parties.docs.map(doc => ({...doc.data(), id:doc.id}));
    const party = MandiFinancialYear.resolveBroker(partyRows, partyId || "", brokerDetailName);
    if (partyId && !party) throw new Error("The selected broker Party Master record was not found.");
    if (party) brokerDetailName = party.name;
    const matches = (id, name) => party ? MandiFinancialYear.resolveBroker(partyRows, id, name)?.id === party.id : upper(name) === upper(brokerDetailName);
    brokerDetailBills = bills.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((bill) => bill.deleted !== true && matches(bill.brokerId, bill.Broker));
    brokerDetailPayments = payments.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((payment) => payment.deleted !== true && matches(payment.brokerId, payment.brokerName));
    if (!master && !party && !brokerDetailBills.length && !brokerDetailPayments.length) {
      document.getElementById("broker-detail-pay").hidden = true;
      status.textContent = "Broker not found";
      WorkspaceUI.state(target, { title: "This broker account was not found", message: "Choose an existing broker from your directory.", action: "Open directory", href: "broker-ledger.html" });
      return;
    }
    const dateTime = (value) => value?.toDate ? value.toDate().getTime() : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value)) ? new Date(String(value).split("/").reverse().join("-")).getTime() : new Date(value || 0).getTime();
    brokerDetailBills.sort((a,b) => dateTime(b.Date || b.createdAt) - dateTime(a.Date || a.createdAt));
    brokerDetailPayments.sort((a,b) => dateTime(b.date || b.timestamp) - dateTime(a.date || a.timestamp));
    const transactions = [
      ...brokerDetailBills.map(b => ({date:b.Date, debit:Number(b.BrokerCommission || 0), credit:0, label:`Bill ${b['Serial No'] || b.id}`, billId:b.id})),
      ...brokerDetailPayments.map(p => ({date:p.date, debit:0, credit:Number(p.amount || 0), label:`Payout · ${p.paymentMethod || ''} · ${p.reference || p.id}`}))
    ];
    const years = MandiFinancialYear.availableYears(transactions, new Date());
    if (brokerYear !== "all") { MandiFinancialYear.boundaries(brokerYear); if (!years.includes(brokerYear)) years.push(brokerYear); }
    const selector = document.getElementById("broker-fy"); selector.replaceChildren();
    ["all", ...years.sort().reverse()].forEach(year => { const option=document.createElement("option"); option.value=year; option.textContent=year === 'all' ? 'All dates' : `FY ${year}`; selector.append(option); }); selector.value=brokerYear;
    brokerStatement = MandiFinancialYear.summarize(transactions, {fyId:brokerYear === 'all' ? null : brokerYear, initialOpeningCents: -MandiFinancialYear.partyOpeningCents(party || {})});
    if (brokerStatement.invalidDateCount) throw new Error("Some broker entries have invalid dates. Review them before using a year-wise balance.");
    // Payout action uses the full account balance, never a historical year's closing.
    brokerDetailBalance = MandiFinancialYear.summarize(transactions, {initialOpeningCents:-MandiFinancialYear.partyOpeningCents(party || {})}).closingCents / 100;
    const commission = brokerStatement.debitCents / 100, paid = brokerStatement.creditCents / 100;
    const inYear = value => brokerYear === 'all' || MandiFinancialYear.financialYearId(value) === brokerYear;
    brokerDetailBills = brokerDetailBills.filter(b => inYear(b.Date));
    brokerDetailPayments = brokerDetailPayments.filter(p => inYear(p.date));
    document.getElementById("broker-detail-name").textContent = brokerDetailName;
    document.getElementById("broker-detail-contact").textContent = [party?.mobileNumber || party?.mobile || party?.phone, party?.village].filter(Boolean).join(" · ") || `${brokerDetailBills.length} bills · ${brokerDetailPayments.length} payouts recorded`;
    document.getElementById("broker-detail-summary").innerHTML = [["Opening payable", brokerStatement.openingCents / 100], ["Commission earned", commission], ["Paid to broker", paid], ["Closing payable / negative = advance", brokerStatement.closingCents / 100]].map(([label,value]) => `<div class="broker-overview-card"><span>${label}</span><strong>₹${Number(value || 0).toLocaleString("en-IN")}</strong></div>`).join("");
    document.getElementById("broker-detail-pay").hidden = !hasRole("admin", "accountant");
    status.textContent = `Checked ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    renderBrokerDetail();
  } catch (error) {
    status.textContent = "Account could not update";
    document.getElementById("broker-detail-pay").hidden = true;
    WorkspaceUI.state(target, { title: "Could not load broker account", message: error.message, action: "Retry", onAction: loadBrokerDetail, error: true });
  }
}
function renderBrokerDetail() {
  const target = document.getElementById("broker-detail-content");
  document.querySelectorAll('[data-broker-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.brokerView === brokerDetailView)));
  if (brokerDetailView === "ledger" && brokerStatement) {
    const money = cents => `₹${((cents || 0)/100).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    target.innerHTML = `<h2>Broker ledger · ${escapeHtml(brokerYear === 'all' ? 'All dates' : 'FY '+brokerYear)}</h2><div style="overflow-x:auto"><table class="workspace-detail-table"><thead><tr><th>Date</th><th>Particulars</th><th>Commission</th><th>Payout</th><th>Balance payable</th></tr></thead><tbody><tr><td>Opening</td><td>Balance brought forward</td><td>—</td><td>—</td><td>${money(brokerStatement.openingCents)}</td></tr>${brokerStatement.rows.map(row => `<tr><td>${escapeHtml(row.key)}</td><td>${row.transaction.billId ? `<a href="final.html?id=${encodeURIComponent(row.transaction.billId)}">${escapeHtml(row.transaction.label)}</a>` : escapeHtml(row.transaction.label)}</td><td>${money(row.debitCents)}</td><td>${money(row.creditCents)}</td><td>${money(row.balanceCents)}</td></tr>`).join('')}<tr><td>Closing</td><td></td><td>${money(brokerStatement.debitCents)}</td><td>${money(brokerStatement.creditCents)}</td><td>${money(brokerStatement.closingCents)}</td></tr></tbody></table></div>`;
    return;
  }
  if (brokerDetailView === "payments") {
    if (!brokerDetailPayments.length) { WorkspaceUI.state(target, { title: "No payouts recorded", message: "Recorded payouts will appear here with their date and amount.", action: "View commission bills", onAction: () => document.querySelector('[data-broker-view="bills"]').click() }); return; }
    const canManage = hasRole("admin", "accountant");
    target.innerHTML = `<h2>Payout history</h2><table class="workspace-detail-table"><thead><tr><th>Date</th><th>Amount</th><th>Reference</th>${canManage ? '<th>Action</th>' : ''}</tr></thead><tbody>${brokerDetailPayments.map((payment) => `<tr><td data-label="Date">${escapeHtml(payment.date || "—")}</td><td data-label="Amount">₹${Number(payment.amount || 0).toLocaleString("en-IN")}</td><td data-label="Reference">${escapeHtml(payment.reference || payment.id)}</td>${canManage ? `<td data-label="Action"><button type="button" class="workspace-action" data-delete-payout="${escapeHtml(payment.id)}">Delete payout</button></td>` : ''}</tr>`).join("")}</tbody></table>`;
    target.querySelectorAll('[data-delete-payout]').forEach(button => button.addEventListener('click', () => deleteBrokerPayment(button.dataset.deletePayout, brokerDetailName)));
    return;
  }
  if (!brokerDetailBills.length) { WorkspaceUI.state(target, { title: "No commission bills yet", message: "Bills assigned to this broker will appear here automatically.", action: "Open all bills", href: "bills.html" }); return; }
  target.innerHTML = `<h2>Commission bills</h2><table class="workspace-detail-table"><thead><tr><th>Bill</th><th>Date</th><th>Supplier</th><th>Commission</th><th></th></tr></thead><tbody>${brokerDetailBills.map((bill) => `<tr><td data-label="Bill">${escapeHtml(bill["Serial No"] || "Bill")}</td><td data-label="Date">${escapeHtml(bill.Date || "—")}</td><td data-label="Supplier">${escapeHtml(bill["Customer Name"] || "—")}</td><td data-label="Commission">₹${Number(bill.BrokerCommission || 0).toLocaleString("en-IN")}</td><td data-label="Open"><a class="workspace-action" href="final.html?id=${encodeURIComponent(bill.id)}">View bill ↗</a></td></tr>`).join("")}</tbody></table>`;
}
