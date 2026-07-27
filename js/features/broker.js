/**
 * @file broker.js
 * @description Broker Commission management
 * Per bag commission, toggle per bill, broker ledger
 */

const brokersCollection = db.collection("brokers");

// ── BROKER LEDGER PAGE ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// BROKER MASTER LEDGER & DATABASE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  loadBrokerLedger();
});

async function loadBrokerLedger() {
  const container = document.getElementById("broker-list");
  if (!container) return;
  showLoading();

  try {
    const billsSnap = await billsCollection.get();
    const paymentsSnap = await db.collection("broker_payments").get();
    const brokersMasterSnap = await db.collection("brokers").get();

    // 1. Collect unique brokers from existing bills & sync to master collection
    const brokerNamesSet = new Set();
    billsSnap.docs.forEach((doc) => {
      const b = doc.data();
      if (b.deleted === true) return;
      const rawBroker = b["Broker"] ? b["Broker"].trim() : "";
      if (rawBroker && rawBroker.toUpperCase() !== "DIRECT") {
        brokerNamesSet.add(rawBroker);
      }
    });

    // Also include from master collection
    // Also include from master collection
    brokersMasterSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data && data.name) {
        brokerNamesSet.add(data.name.trim());
      }
    });

    // Auto-sync missing brokers into 'brokers' master collection
    for (let name of brokerNamesSet) {
      const upper = name.toUpperCase();
      const querySnap = await db.collection("brokers").where("nameUpper", "==", upper).get();
      if (querySnap.empty) {
        await db.collection("brokers").add({
          name: name,
          nameUpper: upper,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // 2. Fetch final Master Brokers list
    const masterSnap = await db.collection("brokers").orderBy("name").get();
    const brokerMap = {};

    masterSnap.docs.forEach((doc) => {
      const d = doc.data();
      const name = d.name;
      brokerMap[name.toUpperCase()] = { displayName: name, totalCommission: 0, paidAmount: 0, totalBills: 0 };
    });

    // 3. Calculate Totals from Bills
    billsSnap.docs.forEach((doc) => {
      const b = doc.data();
      if (b.deleted === true) return;
      const rawBroker = b["Broker"] ? b["Broker"].trim().toUpperCase() : "";
      if (brokerMap[rawBroker]) {
        brokerMap[rawBroker].totalCommission += Number(b["BrokerCommission"] || 0);
        brokerMap[rawBroker].totalBills += 1;
      }
    });

    // 4. Calculate Paid from Broker Payments
    paymentsSnap.docs.forEach((doc) => {
      const p = doc.data();
      if (p.deleted === true) return;
      const brokerId = (p.brokerName || "").trim().toUpperCase();
      if (brokerMap[brokerId]) {
        brokerMap[brokerId].paidAmount += Number(p.amount || 0);
      }
    });

    const brokerKeys = Object.keys(brokerMap);

    let htmlContent = `
      <div style="margin-bottom:16px; text-align:right;">
        <button onclick="openAddBrokerModal()" style="background:linear-gradient(135deg, #005a9e, #003d6e); color:white; padding:10px 20px; border-radius:8px; border:none; font-weight:700; cursor:pointer; font-family:inherit; box-shadow:0 4px 10px rgba(0,90,158,0.2);">+ Add New Broker</button>
      </div>
    `;

    if (brokerKeys.length === 0) {
      container.innerHTML =
        htmlContent +
        `<div style="text-align:center; color:#6c757d; padding:30px;">No brokers found in master list. Click above to add one.</div>`;
      hideLoading();
      return;
    }

    htmlContent += brokerKeys
      .map((key) => {
        const b = brokerMap[key];
        const balanceDue = b.totalCommission - (b.paidAmount || 0);
        return `
        <div class="broker-card" onclick="viewBrokerDetails('${
          b.displayName
        }')" style="cursor:pointer; background:#fff; border:1.5px solid #dee2e6; border-radius:12px; padding:18px; margin-bottom:14px; box-shadow:0 2px 8px rgba(0,90,158,0.07); transition:all 0.2s;">
          <div class="broker-name" style="font-weight:800; font-size:17px; color:#005a9e; margin-bottom:10px;">🤝 ${
            b.displayName
          }</div>
          <div class="broker-stats" style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; text-align:center;">
            <div><span class="bs-val" style="font-weight:800; font-size:15px; color:#343a40; display:block;">₹${Number(
              b.totalCommission
            ).toLocaleString(
              "en-IN"
            )}</span><span class="bs-label" style="font-size:11px; color:#6c757d; font-weight:600;">Total Commission</span></div>
            <div><span class="bs-val" style="font-weight:800; font-size:15px; color:#28a745; display:block;">₹${Number(
              b.paidAmount || 0
            ).toLocaleString(
              "en-IN"
            )}</span><span class="bs-label" style="font-size:11px; color:#6c757d; font-weight:600;">Paid</span></div>
            <div><span class="bs-val" style="font-weight:800; font-size:15px; color:#dc3545; display:block;">₹${Number(
              balanceDue
            ).toLocaleString(
              "en-IN"
            )}</span><span class="bs-label" style="font-size:11px; color:#6c757d; font-weight:600;">Balance Due</span></div>
            <div><span class="bs-val" style="font-weight:800; font-size:15px; color:#005a9e; display:block;">${
              b.totalBills
            }</span><span class="bs-label" style="font-size:11px; color:#6c757d; font-weight:600;">Bills</span></div>
          </div>
        </div>`;
      })
      .join("");

    container.innerHTML = htmlContent;
  } catch (e) {
    console.error("Error loading broker ledger:", e);
  } finally {
    hideLoading();
  }
}

// Add New Broker Modal
window.openAddBrokerModal = function () {
  Swal.fire({
    title: "➕ Add New Broker",
    html: `
      <input type="text" id="swal-broker-name" class="swal2-input" placeholder="Enter Broker Name" style="margin:0; width:100%; box-sizing:border-box;">
    `,
    showCancelButton: true,
    confirmButtonText: "Save Broker",
    confirmButtonColor: "#005a9e",
    preConfirm: () => {
      const name = document.getElementById("swal-broker-name").value.trim();
      if (!name) {
        Swal.showValidationMessage("Please enter broker name");
      }
      return name;
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      showLoading("Saving broker...");
      try {
        const name = result.value;
        const upper = name.toUpperCase();

        const check = await db.collection("brokers").where("nameUpper", "==", upper).get();
        if (!check.empty) {
          hideLoading();
          Swal.fire("Error", "Broker already exists in master list!", "error");
          return;
        }

        await db.collection("brokers").add({
          name: name,
          nameUpper: upper,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        hideLoading();
        Swal.fire("Success!", "Broker added to master list.", "success");
        loadBrokerLedger();
      } catch (e) {
        hideLoading();
        console.error(e);
        Swal.fire("Error", "Could not save broker.", "error");
      }
    }
  });
};

async function viewBrokerDetails(brokerName) {
  showLoading();
  try {
    const snap = await billsCollection.get();
    const billDocs = snap.docs.filter((d) => {
      const b = d.data();
      if (b.deleted === true) return;
      const bName = (b["Broker"] || "").trim().toUpperCase();
      return bName === brokerName.toUpperCase();
    });

    let totalComm = 0;
    billDocs.forEach((d) => (totalComm += Number(d.data()["BrokerCommission"] || 0)));

    let totalPaid = 0;
    let paymentsList = [];
    try {
      const paySnap = await db.collection("broker_payments").where("brokerName", "==", brokerName.toUpperCase()).get();
      paySnap.docs.forEach((pDoc) => {
        const pData = pDoc.data();
        if (pData.deleted !== true) {
          totalPaid += Number(pData.amount || 0);
          paymentsList.push({ id: pDoc.id, ...pData });
        }
      });
    } catch (err) {
      console.log("No payments found");
    }

    const balanceDue = totalComm - totalPaid;

    let html = `<h3 style="color:#005a9e; margin-top:0;">🤝 ${brokerName}</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Total Commission</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#005a9e;">₹${Number(
          totalComm
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Paid</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#28a745;">₹${Number(
          totalPaid
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Balance Due</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#dc3545;">₹${Number(
          balanceDue
        ).toLocaleString("en-IN")}</div></div>
      </div>
      
      <div style="margin-bottom:14px; text-align:right;">
        <button onclick="openBrokerPaymentModal('${brokerName}', ${balanceDue})" style="background:linear-gradient(135deg, #28a745, #1e7e34); color:white; padding:9px 18px; border-radius:8px; border:none; font-weight:700; cursor:pointer; font-family:inherit;">💰 Record Payment</button>
      </div>

      <h4 style="color:#005a9e; margin:14px 0 6px; text-align:left; font-size:13px; text-transform:uppercase;">Bills List</h4>
      <table class="blt" style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px;">
        <thead><tr style="background:#005a9e; color:white;"><th style="padding:8px; text-align:left;">Bill No</th><th style="padding:8px; text-align:left;">Date</th><th style="padding:8px; text-align:left;">Supplier</th><th style="padding:8px; text-align:right;">Bags</th><th style="padding:8px; text-align:right;">Commission</th></tr></thead>
        <tbody>${billDocs
          .map((d) => {
            const bill = d.data();
            const bags =
              bill["Bill Type"] === "Loose"
                ? Math.round((bill["Net Weight"] || 0) / 50)
                : [1, 2, 3, 4, 5].reduce((s, i) => s + (Number(bill[`Vakal ${i} Katta`]) || 0), 0);
            return `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:8px;">${bill["Serial No"]}</td>
            <td style="padding:8px;">${bill["Date"]}</td>
            <td style="padding:8px;">${bill["Customer Name"]}</td>
            <td style="padding:8px; text-align:right;">${bags}</td>
            <td style="padding:8px; text-align:right; font-weight:700; color:#005a9e;">₹${Number(
              bill["BrokerCommission"] || 0
            ).toLocaleString("en-IN")}</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>`;

    if (paymentsList.length > 0) {
      html += `<h4 style="color:#28a745; margin:14px 0 6px; text-align:left; font-size:13px; text-transform:uppercase;">Payment History</h4>
        <table class="blt" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead><tr style="background:#28a745; color:white;"><th style="padding:8px; text-align:left;">Date</th><th style="padding:8px; text-align:right;">Amount</th><th style="padding:8px; text-align:center;">Action</th></tr></thead>
          <tbody>${paymentsList
            .map(
              (p) => `
            <tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:8px;">${p.date}</td>
              <td style="padding:8px; text-align:right; color:#28a745; font-weight:700;">₹${Number(
                p.amount
              ).toLocaleString("en-IN")}</td>
              <td style="padding:8px; text-align:center;"><button onclick="deleteBrokerPayment('${
                p.id
              }', '${brokerName}')" style="background:#dc3545; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:700;">Delete</button></td>
            </tr>`
            )
            .join("")}</tbody>
        </table>`;
    }

    Swal.fire({
      html,
      width: "850px",
      confirmButtonText: "Close",
      confirmButtonColor: "#005a9e",
    });
  } catch (e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

window.openBrokerPaymentModal = function (brokerName, defaultAmount) {
  Swal.fire({
    title: `💰 Pay to ${brokerName}`,
    html: `
      <label style="display:block; text-align:left; font-weight:700; font-size:13px; margin-bottom:5px;">Payment Amount (₹)</label>
      <input type="number" id="swal-pay-amount" class="swal2-input" placeholder="Enter amount" value="${
        defaultAmount > 0 ? defaultAmount : ""
      }" style="margin:0 0 12px 0; width:100%; box-sizing:border-box;">
      
      <label style="display:block; text-align:left; font-weight:700; font-size:13px; margin-bottom:5px;">Payment Date</label>
      <input type="date" id="swal-pay-date" class="swal2-input" value="${
        new Date().toISOString().split("T")[0]
      }" style="margin:0; width:100%; box-sizing:border-box;">
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Save Payment",
    confirmButtonColor: "#28a745",
    preConfirm: () => {
      const amount = document.getElementById("swal-pay-amount").value;
      const date = document.getElementById("swal-pay-date").value;
      if (!amount || Number(amount) <= 0) {
        Swal.showValidationMessage("Please enter a valid amount");
      }
      return { amount: Number(amount), date };
    },
  }).then(async (result) => {
    if (result.isConfirmed) {
      showLoading("Saving payment...");
      try {
        const [yyyy, mm, dd] = result.value.date.split("-");
        const formattedDate = `${dd}/${mm}/${yyyy}`;

        await db.collection("broker_payments").add({
          brokerName: brokerName.toUpperCase(),
          amount: result.value.amount,
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
        Swal.fire("Error", "Could not save payment.", "error");
      }
    }
  });
};

window.deleteBrokerPayment = async function (paymentId, brokerName) {
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
      loadBrokerLedger();
      viewBrokerDetails(brokerName);
    } catch (e) {
      hideLoading();
      Swal.fire("Error", "Could not delete payment.", "error");
    }
  }
};

window.viewBrokerDetails = viewBrokerDetails;
async function viewBrokerDetails(brokerIdentifier) {
  showLoading();
  try {
    let brokerName = "";
    let totalComm = 0;
    let brokerData = {};

    // Check karo ki identifier ID hai ya direct Broker Name hai
    const brokerDoc = await db.collection("brokers").doc(brokerIdentifier).get();
    if (brokerDoc.exists) {
      brokerData = brokerDoc.data() || {};
      brokerName = brokerData.name || brokerIdentifier;
    } else {
      brokerName = brokerIdentifier;
    }

    // Bills fetch karo (Safe query)
    const snap = await billsCollection.get();
    const billDocs = snap.docs.filter((d) => {
      const b = d.data();
      if (b.deleted === true) return;
      const bName = (b["Broker"] || "").trim().toUpperCase();
      return bName === brokerName.trim().toUpperCase();
    });

    billDocs.forEach((d) => (totalComm += Number(d.data()["BrokerCommission"] || 0)));

    // Payments fetch karo
    let totalPaid = 0;
    let paymentsList = [];
    try {
      const paySnap = await db
        .collection("broker_payments")
        .where("brokerName", "==", brokerName.trim().toUpperCase())
        .get();
      paySnap.docs.forEach((pDoc) => {
        const pData = pDoc.data();
        if (pData.deleted !== true) {
          totalPaid += Number(pData.amount || 0);
          paymentsList.push({ id: pDoc.id, ...pData });
        }
      });
    } catch (err) {
      console.log("No payments collection yet");
    }

    const balanceDue = totalComm - totalPaid;

    let html = `<h3 style="color:#005a9e; margin-top:0;">🤝 ${brokerName}</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Total Commission</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#005a9e;">₹${Number(
          totalComm
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Paid</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#28a745;">₹${Number(
          totalPaid
        ).toLocaleString("en-IN")}</div></div>
        <div class="kpi-card" style="background:#f8f9fa; padding:12px; border-radius:10px; border:1px solid #dee2e6;"><div class="kpi-label" style="font-size:12px; color:#6c757d;">Balance Due</div><div class="kpi-value" style="font-size:1.3em; font-weight:800; color:#dc3545;">₹${Number(
          balanceDue
        ).toLocaleString("en-IN")}</div></div>
      </div>
      
      <div style="margin-bottom:14px; display:flex; gap:10px;">
        <input type="number" id="broker-pay-amount" placeholder="Payment amount" style="flex:1;padding:10px;border:1.5px solid #dee2e6;border-radius:8px;font-family:inherit;box-sizing:border-box;"/>
        <button onclick="recordBrokerPaymentByName('${brokerName}', ${balanceDue})" style="padding:10px 20px;background:linear-gradient(135deg, #28a745, #1e7e34);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">💰 Record Payment</button>
      </div>

      <h4 style="color:#005a9e; margin:14px 0 6px; text-align:left; font-size:13px; text-transform:uppercase;">Bills List</h4>
      <table class="blt" style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:13px;">
        <thead><tr style="background:#005a9e; color:white;"><th style="padding:8px; text-align:left;">Bill No</th><th style="padding:8px; text-align:left;">Date</th><th style="padding:8px; text-align:left;">Supplier</th><th style="padding:8px; text-align:right;">Bags</th><th style="padding:8px; text-align:right;">Commission</th></tr></thead>
        <tbody>${billDocs
          .map((d) => {
            const bill = d.data();
            const bags =
              bill["Bill Type"] === "Loose"
                ? Math.round((bill["Net Weight"] || 0) / 50)
                : [1, 2, 3, 4, 5].reduce((s, i) => s + (Number(bill[`Vakal ${i} Katta`]) || 0), 0);
            return `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:8px;">${bill["Serial No"]}</td>
            <td style="padding:8px;">${bill["Date"]}</td>
            <td style="padding:8px;">${bill["Customer Name"]}</td>
            <td style="padding:8px; text-align:right;">${bags}</td>
            <td style="padding:8px; text-align:right; font-weight:700; color:#005a9e;">₹${Number(
              bill["BrokerCommission"] || 0
            ).toLocaleString("en-IN")}</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>`;

    if (paymentsList.length > 0) {
      html += `<h4 style="color:#28a745; margin:14px 0 6px; text-align:left; font-size:13px; text-transform:uppercase;">Payment History</h4>
        <table class="blt" style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead><tr style="background:#28a745; color:white;"><th style="padding:8px; text-align:left;">Date</th><th style="padding:8px; text-align:right;">Amount</th><th style="padding:8px; text-align:center;">Action</th></tr></thead>
          <tbody>${paymentsList
            .map(
              (p) => `
            <tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:8px;">${p.date}</td>
              <td style="padding:8px; text-align:right; color:#28a745; font-weight:700;">₹${Number(
                p.amount
              ).toLocaleString("en-IN")}</td>
              <td style="padding:8px; text-align:center;"><button onclick="deleteBrokerPayment('${
                p.id
              }', '${brokerName}')" style="background:#dc3545; color:white; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:700;">Delete</button></td>
            </tr>`
            )
            .join("")}</tbody>
        </table>`;
    }

    Swal.fire({
      html,
      width: "850px",
      confirmButtonText: "Close",
      confirmButtonColor: "#005a9e",
    });
  } catch (e) {
    console.error("View broker error:", e);
  } finally {
    hideLoading();
  }
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
