/**
 * @file broker.js
 * @description Broker Commission management
 * Per bag commission, toggle per bill, broker ledger
 */

const brokersCollection = db.collection("brokers");

// ── BROKER LEDGER PAGE ────────────────────────────────────────────────────────
async function loadBrokerLedger() {
  const container = document.getElementById("broker-list");
  if (!container) return;
  showLoading();
  try {
    const snap = await brokersCollection.orderBy("name").get();
    if (snap.empty) {
      container.innerHTML = `<div style="text-align:center;color:#6c757d;padding:30px;">No brokers found. Add commission on bills to create broker records.</div>`;
      return;
    }
    container.innerHTML = snap.docs
      .map((doc) => {
        const b = doc.data();
        return `
        <div class="broker-card" onclick="viewBrokerDetails('${doc.id}')">
          <div class="broker-name">🤝 ${b.name}</div>
          <div class="broker-stats">
            <div><span class="bs-val">₹${Number(b.totalCommission || 0).toLocaleString(
              "en-IN"
            )}</span><span class="bs-label">Total Commission</span></div>
            <div><span class="bs-val">₹${Number(b.paidAmount || 0).toLocaleString(
              "en-IN"
            )}</span><span class="bs-label">Paid</span></div>
            <div><span class="bs-val" style="color:#dc3545;">₹${Number(
              (b.totalCommission || 0) - (b.paidAmount || 0)
            ).toLocaleString("en-IN")}</span><span class="bs-label">Balance Due</span></div>
            <div><span class="bs-val">${b.totalBills || 0}</span><span class="bs-label">Bills</span></div>
          </div>
        </div>`;
      })
      .join("");
  } catch (e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

async function viewBrokerDetails(brokerId) {
  showLoading();
  try {
    const brokerDoc = await brokersCollection.doc(brokerId).get();
    const broker = brokerDoc.data();
    const billsSnap = await billsCollection.where("Broker", "==", broker.name).orderBy("Date", "desc").get();
    const billDocs = billsSnap.docs.filter((d) => d.data().deleted !== true);

    let html = `<h3 style="color:#005a9e;">🤝 ${broker.name}</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div class="kpi-card"><div class="kpi-label">Total Commission</div><div class="kpi-value">₹${Number(
          broker.totalCommission || 0
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card"><div class="kpi-label">Paid</div><div class="kpi-value" style="color:#28a745;">₹${Number(
          broker.paidAmount || 0
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card"><div class="kpi-label">Balance Due</div><div class="kpi-value" style="color:#dc3545;">₹${Number(
          (broker.totalCommission || 0) - (broker.paidAmount || 0)
        ).toLocaleString("en-IN")}</div></div>
      </div>
      <table class="blt" style="width:100%;">
        <thead><tr><th>Bill No</th><th>Date</th><th>Supplier</th><th>Bags</th><th>Commission</th></tr></thead>
        <tbody>${billDocs
          .map((d) => {
            const bill = d.data();
            const bags = [1, 2, 3, 4, 5].reduce((s, i) => s + (bill[`Vakal ${i} Katta`] || 0), 0);
            return `<tr>
            <td>${bill["Serial No"]}</td>
            <td>${bill["Date"]}</td>
            <td>${bill["Customer Name"]}</td>
            <td>${bags}</td>
            <td>₹${Number(bill["BrokerCommission"] || 0).toLocaleString("en-IN")}</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <input type="number" id="broker-pay-amount" placeholder="Payment amount" style="flex:1;padding:10px;border:1.5px solid #dee2e6;border-radius:8px;font-family:inherit;"/>
        <button onclick="recordBrokerPayment('${brokerId}')" style="padding:10px 20px;background:#28a745;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">💰 Record Payment</button>
      </div>`;

    Swal.fire({
      html,
      width: "800px",
      confirmButtonText: "Close",
      confirmButtonColor: "#005a9e",
      showClass: { popup: "swal2-show" },
    });
  } catch (e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

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
async function updateBrokerCommission(billData) {
  const brokerName = billData["Broker"];
  const commission = billData["BrokerCommission"] || 0;
  if (!brokerName || !commission) return;

  try {
    const brokerId = brokerName.toLowerCase().replace(/\s+/g, "_");
    const brokerRef = brokersCollection.doc(brokerId);
    const doc = await brokerRef.get();

    if (doc.exists) {
      await brokerRef.update({
        totalCommission: (doc.data().totalCommission || 0) + commission,
        totalBills: (doc.data().totalBills || 0) + 1,
        updatedAt: Date.now(),
      });
    } else {
      await brokerRef.set({
        name: brokerName,
        totalCommission: commission,
        paidAmount: 0,
        totalBills: 1,
        createdAt: Date.now(),
      });
    }
  } catch (e) {
    console.warn("Broker update failed:", e);
  }
}

window.loadBrokerLedger = loadBrokerLedger;
window.viewBrokerDetails = viewBrokerDetails;
window.recordBrokerPayment = recordBrokerPayment;
window.updateBrokerCommission = updateBrokerCommission;

document.addEventListener("DOMContentLoaded", loadBrokerLedger);
