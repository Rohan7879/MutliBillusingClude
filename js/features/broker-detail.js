let brokerDetailName = "";
let brokerDetailBalance = 0;
let brokerDetailBills = [];
let brokerDetailPayments = [];
let brokerDetailView = "bills";
let brokerDetailStarted = false;

function startBrokerDetail() {
  if (brokerDetailStarted || !window.currentUserProfile || !["admin", "manager", "accountant"].includes(window.currentUserProfile.role)) return;
  brokerDetailStarted = true;
  loadBrokerDetail();
}
document.addEventListener("DOMContentLoaded", () => {
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
  const identifier = new URLSearchParams(window.location.search).get("name") || "";
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
    const party = parties.docs.map((doc) => doc.data()).find((data) => data.deleted !== true && upper(data.type) === "BROKER" && upper(data.name) === upper(brokerDetailName));
    brokerDetailBills = bills.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((bill) => bill.deleted !== true && upper(bill.Broker) === upper(brokerDetailName));
    brokerDetailPayments = payments.docs.map((doc) => ({ ...doc.data(), id: doc.id })).filter((payment) => payment.deleted !== true && upper(payment.brokerName) === upper(brokerDetailName));
    if (!master && !party && !brokerDetailBills.length && !brokerDetailPayments.length) {
      document.getElementById("broker-detail-pay").hidden = true;
      status.textContent = "Broker not found";
      WorkspaceUI.state(target, { title: "This broker account was not found", message: "Choose an existing broker from your directory.", action: "Open directory", href: "broker-ledger.html" });
      return;
    }
    const dateTime = (value) => value?.toDate ? value.toDate().getTime() : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(value)) ? new Date(String(value).split("/").reverse().join("-")).getTime() : new Date(value || 0).getTime();
    brokerDetailBills.sort((a,b) => dateTime(b.Date || b.createdAt) - dateTime(a.Date || a.createdAt));
    brokerDetailPayments.sort((a,b) => dateTime(b.date || b.timestamp) - dateTime(a.date || a.timestamp));
    const commission = brokerDetailBills.reduce((sum,bill) => sum + Number(bill.BrokerCommission || 0), 0);
    const paid = brokerDetailPayments.reduce((sum,payment) => sum + Number(payment.amount || 0), 0);
    brokerDetailBalance = commission - paid;
    document.getElementById("broker-detail-name").textContent = brokerDetailName;
    document.getElementById("broker-detail-contact").textContent = [party?.mobileNumber || party?.mobile || party?.phone, party?.village].filter(Boolean).join(" · ") || `${brokerDetailBills.length} bills · ${brokerDetailPayments.length} payouts recorded`;
    document.getElementById("broker-detail-summary").innerHTML = [["Commission earned", commission], ["Paid to broker", paid], ["Balance payable", brokerDetailBalance]].map(([label,value]) => `<div class="broker-overview-card"><span>${label}</span><strong>₹${Number(value).toLocaleString("en-IN")}</strong></div>`).join("");
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
