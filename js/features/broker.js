/**
 * @file broker.js
 * @description Broker Commission management
 * Per bag commission, toggle per bill, broker ledger
 */

const brokersCollection = db.collection("brokers");
let brokerDirectoryStarted = false;
function startBrokerDirectory() {
  if (brokerDirectoryStarted || !window.currentUserProfile || !document.getElementById("broker-list")) return;
  brokerDirectoryStarted = true;
  loadBrokerLedger();
}

// ── BROKER LEDGER PAGE ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// BROKER MASTER LEDGER & DATABASE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("broker-search")?.addEventListener("input", filterBrokerCards);
  startBrokerDirectory();
});
window.addEventListener("mandibook:access-ready", startBrokerDirectory);

function filterBrokerCards() {
  const query = (document.getElementById("broker-search")?.value || "").trim().toLowerCase();
  const cards = [...document.querySelectorAll("#broker-list [data-broker-name]")];
  cards.forEach((card) => { card.hidden = !card.dataset.brokerName.toLowerCase().includes(query); });
  const label = document.getElementById("broker-result-label");
  if (label) label.textContent = `${cards.filter((card) => !card.hidden).length} of ${cards.length} brokers`;
  const empty = document.getElementById("broker-search-empty");
  if (empty) {
    empty.hidden = !(cards.length && cards.every((card) => card.hidden));
    if (!empty.hidden) WorkspaceUI.state(empty, { title: "No matching brokers", message: "Try another name or clear your search.", action: "Clear search", onAction: () => { document.getElementById("broker-search").value = ""; filterBrokerCards(); } });
  }
}

async function loadBrokerLedger() {
  const container = document.getElementById("broker-list");
  const overview = document.getElementById("broker-overview");
  const status = document.getElementById("broker-sync-status");
  if (!container) return;
  showLoading();
  if (status) status.textContent = "Updating brokers…";

  try {
    const billsSnap = await billsCollection.get();
    const paymentsSnap = await db.collection("broker_payments").get();
    const brokersMasterSnap = await db.collection("brokers").get();
    const partiesSnap = await db.collection("parties").get(); // 🚀 Party Master se saare records uthane ke liye

    const brokerNamesSet = new Set();

    // 1. Party Master se jinka type "Broker" hai unhe add karein
    partiesSnap.docs.forEach((doc) => {
      const p = doc.data();
      if (p.deleted === true) return;
      const pType = (p.type || "").trim();
      const pName = (p.name || "").trim();

      // Agar party type Broker hai, toh seedha master list mein le lo
      if (pName && (pType.toLowerCase() === "broker" || pType === "Broker")) {
        brokerNamesSet.add(pName);
      }
    });

    // 2. Bills se unique brokers collect karein (agar kisi bill mein purana broker ho)
    billsSnap.docs.forEach((doc) => {
      const b = doc.data();
      if (b.deleted === true) return;
      const rawBroker = b["Broker"] ? b["Broker"].trim() : "";
      if (rawBroker && rawBroker.toUpperCase() !== "DIRECT") {
        brokerNamesSet.add(rawBroker);
      }
    });

    // 3. Purane brokers collection se bhi le lein
    brokersMasterSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data && data.name) {
        brokerNamesSet.add(data.name.trim());
      }
    });

    // Build the directory locally. Simply opening this page must never create Firestore records.
    const brokerMap = {};
    brokersMasterSnap.docs.forEach((doc) => {
      const d = doc.data();
      const name = String(d.name || "").trim();
      if (name) brokerMap[name.toUpperCase()] = { displayName: name, totalCommission: 0, paidAmount: 0, totalBills: 0 };
    });
    brokerNamesSet.forEach((name) => {
      const upper = name.toUpperCase();
      if (!brokerMap[upper]) brokerMap[upper] = { displayName: name, totalCommission: 0, paidAmount: 0, totalBills: 0 };
    });

    // 5. Calculate Totals from Bills
    billsSnap.docs.forEach((doc) => {
      const b = doc.data();
      if (b.deleted === true) return;
      const rawBroker = b["Broker"] ? b["Broker"].trim().toUpperCase() : "";
      if (brokerMap[rawBroker]) {
        brokerMap[rawBroker].totalCommission += Number(b["BrokerCommission"] || 0);
        brokerMap[rawBroker].totalBills += 1;
      }
    });

    // 6. Calculate Paid from Broker Payments
    paymentsSnap.docs.forEach((doc) => {
      const p = doc.data();
      if (p.deleted === true) return;
      const brokerId = (p.brokerName || "").trim().toUpperCase();
      if (brokerMap[brokerId]) {
        brokerMap[brokerId].paidAmount += Number(p.amount || 0);
      }
    });

    const brokerKeys = Object.keys(brokerMap).sort((a, b) => brokerMap[a].displayName.localeCompare(brokerMap[b].displayName));
    const totalCommission = brokerKeys.reduce((sum, key) => sum + brokerMap[key].totalCommission, 0);
    const totalPaid = brokerKeys.reduce((sum, key) => sum + brokerMap[key].paidAmount, 0);
    const totalDue = totalCommission - totalPaid;
    if (status) status.textContent = `Checked ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    if (overview) {
      overview.innerHTML = `<div class="broker-overview-card"><span>Listed brokers</span><strong>${brokerKeys.length}</strong></div><div class="broker-overview-card"><span>Total commission</span><strong>₹${Number(totalCommission).toLocaleString("en-IN")}</strong></div><div class="broker-overview-card"><span>Balance payable</span><strong>₹${Number(totalDue).toLocaleString("en-IN")}</strong></div>`;
    }

    let htmlContent = "";

    if (brokerKeys.length === 0) {
      WorkspaceUI.state(container, { title: "Your broker directory is empty", message: "Add a broker to start tracking commission and payouts.", action: "Add broker", onAction: openAddBrokerModal });
      hideLoading();
      filterBrokerCards();
      return;
    }

    htmlContent += brokerKeys
      .map((key) => {
        const b = brokerMap[key];
        const balanceDue = b.totalCommission - (b.paidAmount || 0);
        return `
        <button class="broker-card" type="button" data-broker-name="${escapeHtml(b.displayName)}">
          <div class="broker-name">🤝 ${escapeHtml(b.displayName)}</div>
          <div class="broker-stats">
            <div><span class="bs-val">₹${Number(
              b.totalCommission
            ).toLocaleString("en-IN")}</span><span class="bs-label">Total Commission</span></div>
            <div><span class="bs-val" style="color:#188754;">₹${Number(
              b.paidAmount || 0
            ).toLocaleString("en-IN")}</span><span class="bs-label">Paid</span></div>
            <div><span class="bs-val" style="color:#c84b4b;">₹${Number(
              balanceDue
            ).toLocaleString("en-IN")}</span><span class="bs-label">Balance Due</span></div>
            <div><span class="bs-val">${b.totalBills}</span><span class="bs-label">Bills</span></div>
          </div>
        </button>`;
      })
      .join("");

    container.innerHTML = htmlContent;
    container.querySelectorAll("[data-broker-name]").forEach((card) => {
      card.addEventListener("click", () => viewBrokerDetails(card.dataset.brokerName));
    });
    filterBrokerCards();

    const urlParams = new URLSearchParams(window.location.search);
    const targetBrokerName = urlParams.get("name");

    if (targetBrokerName) {
      setTimeout(() => {
        viewBrokerDetails(targetBrokerName);
        window.history.replaceState(null, "", window.location.pathname);
      }, 400);
    }
  } catch (e) {
    console.error("Error loading broker ledger:", e);
    WorkspaceUI.state(container, { title: "Could not load brokers", message: e.message, action: "Retry", onAction: loadBrokerLedger, error: true });
    if (status) status.textContent = "Update could not complete";
  } finally {
    hideLoading();
  }
}

// Keep existing callers compatible; all new brokers are created in Party Master.
window.openAddBrokerModal = function () {
  window.location.href = "party-master.html?type=Broker#partyForm";
};

window.openBrokerPaymentModal = function (brokerName, defaultAmount) {
  if (!hasRole("admin", "accountant")) { Swal.fire("Not allowed", "Only an Admin or Accountant can record payouts.", "error"); return; }
  Swal.fire({
    titleText: `Record payment — ${brokerName}`,
    customClass: { popup: 'mb-payment-popup' },
    html: window.MandiPaymentUI.fields(true),
    didOpen: () => {
      document.getElementById('bulk-payment-cash').value = defaultAmount > 0 ? defaultAmount : '';
      // Broker payouts settle commission; customer settlement deductions do not apply.
      ['bulk-payment-deduction', 'bulk-payment-deduction-reason'].forEach(id => {
        document.querySelector('label[for="' + id + '"]')?.remove();
        document.getElementById(id)?.remove();
      });
    },
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Save Payment",
    confirmButtonColor: "#28a745",
    preConfirm: () => {
      const amount = document.getElementById("bulk-payment-cash").value;
      const date = document.getElementById("bulk-payment-date").value;
      const reference = document.getElementById("bulk-payment-reason").value.trim();
      const paymentMethod = document.getElementById("bulk-payment-method").value;
      if (!reference) { Swal.showValidationMessage("Enter a payment reference."); return false; }
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !date) {
        Swal.showValidationMessage("Please enter a valid amount");
        return false;
      }
      return { amount: Number(amount), date, reference, paymentMethod };
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      showLoading("Saving payment...");
      try {
        const [yyyy, mm, dd] = result.value.date.split("-");
        const formattedDate = `${dd}/${mm}/${yyyy}`;

        await MandiFinancialYear.assertPostingOpen(db, null, [formattedDate]);

        await db.collection("broker_payments").add({
          brokerName: brokerName.toUpperCase(),
          amount: result.value.amount,
          reference: result.value.reference,
          paymentMethod: result.value.paymentMethod,
          date: formattedDate,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });

        hideLoading();
        Swal.fire("Success!", "Payment recorded successfully.", "success");
        if (document.getElementById("broker-detail-content")) window.dispatchEvent(new Event("mandibook:broker-payment-saved"));
        else loadBrokerLedger();
      } catch (e) {
        hideLoading();
        console.error(e);
        Swal.fire("Error", "Could not save payment.", "error");
      }
    }
  });
};

window.deleteBrokerPayment = async function (paymentId, brokerName) {
  if (!hasRole("admin", "accountant")) return;
  const confirm = await Swal.fire({
    title: "Delete Payment?",
    text: "This payment record will be deleted.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Yes, delete",
    confirmButtonColor: "#dc3545",
  });

  if (confirm.isConfirmed) {
    showLoading();
    try {
      await db.collection("broker_payments").doc(paymentId).delete();
      hideLoading();
      Swal.fire("Deleted!", "Payment removed.", "success");
      if (document.getElementById("broker-detail-content")) window.dispatchEvent(new Event("mandibook:broker-payment-saved"));
      else { loadBrokerLedger(); viewBrokerDetails(brokerName); }
    } catch (e) {
      hideLoading();
      Swal.fire("Error", "Could not delete payment.", "error");
    }
  }
};

window.viewBrokerDetails = viewBrokerDetails;
function viewBrokerDetails(brokerIdentifier) {
  window.location.href = `broker-detail.html?name=${encodeURIComponent(brokerIdentifier)}`;
}

window.recordBrokerPaymentByName = async function (brokerName) {
  const amountInput = document.getElementById("broker-pay-amount");
  const amount = amountInput ? Number(amountInput.value) : 0;
  if (!amount || amount <= 0) {
    Swal.showValidationMessage?.("Please enter a valid amount");
    alert("Please enter a valid amount");
    return;
  }

  showLoading("Saving payment...");
  try {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    const formattedDate = `${dd}/${mm}/${yyyy}`;

    await db.collection("broker_payments").add({
      brokerName: brokerName.toUpperCase(),
      amount: amount,
      date: formattedDate,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });

    hideLoading();
    Swal.fire("Success!", "Payment recorded successfully.", "success");
    loadBrokerLedger();
    viewBrokerDetails(brokerName);
  } catch (e) {
    hideLoading();
    console.error(e);
    alert("Could not save payment.");
  }
};

window.viewBrokerDetails = viewBrokerDetails;
async function recordBrokerPayment(brokerId) {
  const amount = Number(document.getElementById("broker-pay-amount")?.value) || 0;
  if (!amount) return;
  try {
    const doc = await brokersCollection.doc(brokerId).get();
    const data = doc.data();
    await brokersCollection.doc(brokerId).update({
      paidAmount: (data.paidAmount || 0) + amount,
      updatedAt: Date.now(),
    });
    Swal.fire({
      icon: "success",
      title: "Payment recorded!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
    loadBrokerLedger();
  } catch (e) {
    console.error(e);
  }
}

// ── UPDATE BROKER RECORD WHEN BILL SAVED ─────────────────────────────────────
async function updateBrokerCommission() {
  // Commission is derived from active bills by loadBrokerLedger().
  // Never create a second name-only directory or increment duplicate totals here.
}

window.loadBrokerLedger = loadBrokerLedger;
window.viewBrokerDetails = viewBrokerDetails;
window.recordBrokerPayment = recordBrokerPayment;
window.updateBrokerCommission = updateBrokerCommission;
