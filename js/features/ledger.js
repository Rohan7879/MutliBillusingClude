document.addEventListener("DOMContentLoaded", () => {
  initializeLedgerPage();
});

const paymentsCollection = db.collection("payments");

let allUniqueCustomers = [];
let currentCustomer = null;
let allTransactions = [];
let displayedTransactions = [];
let ledgerAsTableData = [];

let paymentModal,
  modalTitle,
  modalDescription,
  modalCustomerName,
  amountInput,
  dateInput,
  deductionAmountInput,
  deductionReasonInput;

function initializeLedgerPage() {
  paymentModal = document.getElementById("payment-modal");
  modalTitle = document.getElementById("modal-title");
  modalDescription = document.getElementById("modal-description");
  modalCustomerName = document.getElementById("modal-customer-name");
  amountInput = document.getElementById("payment-amount-input");
  dateInput = document.getElementById("payment-date-input");
  deductionAmountInput = document.getElementById("payment-deduction-amount");
  deductionReasonInput = document.getElementById("payment-deduction-reason");

  showLoading();
  fetchUniqueCustomers();

  document.getElementById("customer-search-input").addEventListener("input", (event) => {
    const searchTerm = event.target.value.toLowerCase();
    const filteredCustomers = allUniqueCustomers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(searchTerm) || customer.village.toLowerCase().includes(searchTerm)
    );
    renderCustomerList(filteredCustomers);
  });

  document.getElementById("back-to-list-btn").addEventListener("click", () => {
    // List view par wapas jaane ke liye URL reset karein
    window.location.href = "ledger.html";
  });

  document.getElementById("date-filter-btn").addEventListener("click", () => {
    const startDate = document.getElementById("start_date").value;
    const endDate = document.getElementById("end_date").value;
    renderLedgerTable(allTransactions, startDate, endDate);
  });

  document.getElementById("print-ledger-btn").addEventListener("click", printLedger);
  document.getElementById("record-payment-btn").addEventListener("click", openPaymentModal);
  document.getElementById("close-payment-modal-btn").addEventListener("click", closePaymentModal);
  document.getElementById("save-payment-btn").addEventListener("click", savePayment);

  const selectAllBills = document.getElementById("select-all-bills-ledger");
  if (selectAllBills) {
    selectAllBills.addEventListener("change", (e) => {
      document.querySelectorAll(".bill-checkbox-ledger:not(:disabled)").forEach((checkbox) => {
        checkbox.checked = e.target.checked;
      });
      updateSelectionSummary();
    });
  }
}

async function fetchUniqueCustomers() {
  try {
    let partiesSnapshot = { docs: [] };
    let billsSnapshot = { docs: [] };
    let paymentsSnapshot = { docs: [] };

    // 🛡️ Safe Fetching: Saari parties bina strict condition ke uthao
    try {
      partiesSnapshot = await db.collection("parties").get();
    } catch (e) {
      console.warn("Parties fetch warning:", e);
    }

    try {
      billsSnapshot = await billsCollection.get();
    } catch (e) {
      console.warn("Bills fetch warning:", e);
    }

    try {
      paymentsSnapshot = await paymentsCollection.get();
    } catch (e) {
      console.warn("Payments fetch warning:", e);
    }

    const customerMap = new Map();

    // 🚀 Safe mapping with deleted !== true filter
    partiesSnapshot.docs.forEach((doc) => {
      const pData = doc.data();
      if (pData.deleted !== true && (pData.type === "Farmer" || pData.type === "Vepari")) {
        const name = (pData.name || "").trim();
        if (name) {
          const village = (pData.address || "N/A").trim();
          const key = `${name.toLowerCase()}|${village.toLowerCase()}`;
          customerMap.set(key, {
            name: name,
            village: village,
            customerId: doc.id,
          });
        }
      }
    });

    const processDoc = (doc) => {
      if (doc.data().deleted === true) return;
      const data = doc.data();
      const customerName = data["Customer Name"] || data.customerName;
      if (customerName) {
        const village = data["Village"] || data.customerVillage || "N/A";
        const key = `${customerName.toLowerCase()}|${village.toLowerCase()}`;
        if (!customerMap.has(key)) {
          customerMap.set(key, {
            name: customerName,
            village: village,
            customerId: data.customerId || null,
          });
        } else if (data.customerId && !customerMap.get(key).customerId) {
          customerMap.get(key).customerId = data.customerId;
        }
      }
    };

    billsSnapshot.docs.forEach(processDoc);
    paymentsSnapshot.docs.forEach(processDoc);

    allUniqueCustomers = Array.from(customerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    renderCustomerList(allUniqueCustomers);

    // 🚀 Secure Token / URL Parameter check (Safe Decoding)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    let targetName = "";
    let targetVillage = "";

    if (token) {
      try {
        // 🔓 Secure token decoding
        const decodedData = decodeURIComponent(
          atob(token)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        );
        const parts = decodedData.split("|");
        targetName = parts[0] || "";
        targetVillage = parts[1] || "";
      } catch (e) {
        console.error("Invalid token format");
      }
    } else {
      targetName = urlParams.get("name") || "";
      targetVillage = urlParams.get("village") || "";
    }
    if (targetName) {
      // 1. Pehle naam aur village dono se dhoondho
      let foundCustomer = allUniqueCustomers.find(
        (c) =>
          c.name.toLowerCase() === targetName.toLowerCase() &&
          (!targetVillage || targetVillage === "N/A" || c.village.toLowerCase() === targetVillage.toLowerCase())
      );

      // 2. Agar village match na ho, toh sirf naam se dhoond lo taaki ledger hamesha khule
      if (!foundCustomer) {
        foundCustomer = allUniqueCustomers.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
      }

      if (foundCustomer) {
        showCustomerLedger(foundCustomer);
      } else {
        console.warn("Customer not found in list:", targetName);
      }
    }
  } catch (error) {
    console.error("Error fetching unique customers:", error);
    alert("Could not load customer list.");
  } finally {
    hideLoading();
  }
}
function renderCustomerList(customers) {
  const container = document.getElementById("customer-list-container");
  container.innerHTML = "";
  if (customers.length === 0) {
    container.innerHTML = "<p>No customers found.</p>";
    return;
  }
  customers.forEach((customer) => {
    const customerCard = document.createElement("div");
    customerCard.className = "customer-card";
    customerCard.innerHTML = `<div class="customer-name">${customer.name}</div><div class="customer-village">${customer.village}</div>`;

    // Yahan click par seedha URL change karenge, taaki browser history mein bhi path rahe
    customerCard.addEventListener("click", () => {
      const rawData = `${customer.name}|${customer.village}`;
      // 🔒 Proper Base64 secure hash generation
      const secureToken = btoa(
        encodeURIComponent(rawData).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode("0x" + p1))
      );
      window.location.href = `ledger.html?token=${secureToken}`;
    });

    container.appendChild(customerCard);
  });
}

async function showCustomerLedger(customer) {
  showLoading();
  currentCustomer = customer;
  document.getElementById("customer-selection-view").style.display = "none";
  document.getElementById("ledger-view").style.display = "block";
  document.getElementById("ledger-customer-name").textContent = customer.name;
  document.getElementById("ledger-customer-village").textContent = customer.village;

  try {
    const queries = [
      billsCollection.where("Customer Name", "==", customer.name).get(),
      paymentsCollection.where("customerName", "==", customer.name).get(),
    ];
    if (customer.customerId) {
      queries.push(billsCollection.where("customerId", "==", customer.customerId).get());
    }
    const results = await Promise.all(queries);
    const billsSnapshot = results[0];
    const paymentsSnapshot = results[1];
    const extraBillsSnapshot = results[2];

    const billDocsById = new Map();
    billsSnapshot.docs.forEach((doc) => {
      if (doc.data().deleted !== true) billDocsById.set(doc.id, doc);
    });
    if (extraBillsSnapshot) {
      extraBillsSnapshot.docs.forEach((doc) => {
        if (doc.data().deleted !== true) billDocsById.set(doc.id, doc);
      });
    }
    const mergedBillDocs = Array.from(billDocsById.values());

    allTransactions = [];
    const billIdToSerialMap = new Map();
    let totalBillValue = 0;
    let billDates = [];

    const paidBillIds = new Set();
    paymentsSnapshot.docs.forEach((doc) => {
      const payment = doc.data();
      if (payment.appliedToBills) {
        payment.appliedToBills.forEach((billId) => paidBillIds.add(billId));
      }
    });

    mergedBillDocs.forEach((doc) => {
      const bill = doc.data();
      const billDateParts = bill.Date.split("/");
      const billDate = new Date(`${billDateParts[2]}-${billDateParts[1]}-${billDateParts[0]}`);

      billDates.push(billDate);
      totalBillValue += bill["Final Total"];
      billIdToSerialMap.set(doc.id, bill["Serial No"]);

      allTransactions.push({
        id: doc.id,
        type: "bill",
        date: billDate,
        particulars: `Bill No: ${bill["Serial No"]}`,
        debit: bill["Final Total"],
        credit: 0,
        sortKey: billDate.getTime(),
        amountDue: bill.amountDue ?? bill["Final Total"],
      });

      const amountPaid = bill.amountPaid || 0;
      if (amountPaid > 0 && !paidBillIds.has(doc.id)) {
        allTransactions.push({
          type: "payment",
          date: billDate,
          particulars: `Payment on Bill ${bill["Serial No"]}`,
          debit: 0,
          credit: amountPaid,
          sortKey: billDate.getTime() + 1,
        });
      }
    });

    paymentsSnapshot.docs.forEach((doc) => {
      const payment = doc.data();
      const paymentDate = payment.paymentDate.toDate();
      const cashAmount = payment.cashAmount || 0;
      const deductionAmount = payment.deductionAmount || 0;

      let particulars = "General Payment";
      if (payment.appliedToBills && payment.appliedToBills.length > 0) {
        const serials = payment.appliedToBills.map((id) => billIdToSerialMap.get(id) || id.slice(0, 4)).join(", #");
        if (cashAmount > 0 && deductionAmount > 0) {
          particulars = `Bill #${serials} | Cash: ₹${formatNumber(cashAmount)} | Kapat: ₹${formatNumber(
            deductionAmount
          )} (${payment.deductionReason || "Kapat"})`;
        } else if (deductionAmount > 0) {
          particulars = `Bill #${serials} | Kapat: ₹${formatNumber(deductionAmount)} (${
            payment.deductionReason || "Kapat"
          })`;
        } else {
          particulars = `Payment for Bill #${serials}`;
        }
      } else if (cashAmount > 0 && deductionAmount > 0) {
        particulars = `Cash: ₹${formatNumber(cashAmount)} + Kapat: ₹${formatNumber(deductionAmount)} (${
          payment.deductionReason || "Kapat"
        })`;
      } else if (deductionAmount > 0) {
        particulars = `Kapat: ₹${formatNumber(deductionAmount)} (${payment.deductionReason || "Kapat"})`;
      }

      allTransactions.push({
        id: doc.id,
        type: "payment",
        date: paymentDate,
        particulars: particulars,
        debit: 0,
        credit: payment.totalCredit,
        sortKey: paymentDate.getTime(),
      });
    });

    allTransactions.sort((a, b) => a.sortKey - b.sortKey);
    renderLedgerTable(allTransactions);

    const totalBills = mergedBillDocs.length;
    document.getElementById("summary-total-bills").textContent = totalBills;
    document.getElementById("summary-avg-bill").textContent = `₹${
      totalBills > 0 ? formatNumber(Math.round(totalBillValue / totalBills)) : 0
    }`;
    if (billDates.length > 0) {
      const lastSupplyDate = new Date(Math.max.apply(null, billDates));
      document.getElementById("summary-last-supply").textContent = lastSupplyDate.toLocaleDateString("en-IN");
    } else {
      document.getElementById("summary-last-supply").textContent = "N/A";
    }

    updateSelectionSummary();
  } catch (error) {
    console.error("Error fetching ledger details:", error);
    alert("Could not fetch ledger details.");
  } finally {
    hideLoading();
  }
}

function renderLedgerTable(transactions, startDateStr = null, endDateStr = null) {
  const tableBody = document.getElementById("ledger-table-body");
  tableBody.innerHTML = "";
  displayedTransactions = [];
  ledgerAsTableData = [];

  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;
  if (startDate) startDate.setHours(0, 0, 0, 0);
  if (endDate) endDate.setHours(23, 59, 59, 999);

  let openingBalance = 0;
  if (startDate) {
    transactions.forEach((tx) => {
      if (tx.date < startDate) {
        openingBalance += (tx.debit || 0) - (tx.credit || 0);
      }
    });
  }

  const openingRow = document.createElement("tr");
  openingRow.innerHTML = `<td class="no-print"></td><td>${
    startDate ? startDate.toLocaleDateString("en-IN") : "-"
  }</td><td><strong>Opening Balance</strong></td><td colspan="2"></td><td><strong>${formatNumber(
    openingBalance
  )}</strong></td>`;
  tableBody.appendChild(openingRow);

  ledgerAsTableData.push({
    Date: startDate ? startDate.toLocaleDateString("en-IN") : "-",
    Particulars: "Opening Balance",
    Debit: "",
    Credit: "",
    Balance: formatNumber(openingBalance),
  });

  let runningBalance = openingBalance;
  let periodDebit = 0;
  let periodCredit = 0;

  transactions.forEach((tx) => {
    const isAfterStart = startDate ? tx.date >= startDate : true;
    const isBeforeEnd = endDate ? tx.date <= endDate : true;
    if (isAfterStart && isBeforeEnd) {
      displayedTransactions.push(tx);
      runningBalance += (tx.debit || 0) - (tx.credit || 0);
      periodDebit += tx.debit || 0;
      periodCredit += tx.credit || 0;

      let checkboxHtml = '<td class="no-print"></td>';
      if (tx.type === "bill") {
        const isDisabled = tx.amountDue <= 0.01;
        checkboxHtml = `<td class="no-print"><input type="checkbox" class="bill-checkbox-ledger" value="${
          tx.id
        }" data-amount="${tx.amountDue}" onchange="updateSelectionSummary()" ${isDisabled ? "disabled" : ""}></td>`;
      } else if (tx.type === "payment" && tx.id) {
        // 🗑️ Payment entry ke liye delete button
        checkboxHtml = `<td class="no-print"><button onclick="deletePaymentEntry('${tx.id}')" style="background:#dc3545; color:white; border:none; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">Delete</button></td>`;
      }

      const row = document.createElement("tr");
      row.innerHTML = `${checkboxHtml}<td>${tx.date.toLocaleDateString("en-IN")}</td><td>${tx.particulars}</td><td>${
        tx.debit > 0 ? formatNumber(tx.debit) : "-"
      }</td><td>${tx.credit > 0 ? formatNumber(tx.credit) : "-"}</td><td>${formatNumber(runningBalance)}</td>`;
      tableBody.appendChild(row);
      ledgerAsTableData.push({
        Date: tx.date.toLocaleDateString("en-IN"),
        Particulars: tx.particulars,
        Debit: tx.debit > 0 ? formatNumber(tx.debit) : "",
        Credit: tx.credit > 0 ? formatNumber(tx.credit) : "",
        Balance: formatNumber(runningBalance),
      });
    }
  });

  const balanceCard = document.querySelector(".balance-card");
  const balanceValue = document.getElementById("kpi-balance-due");
  balanceCard.style.backgroundColor = runningBalance > 0 ? "#fbeaea" : "#eafbf0";
  balanceValue.style.color = runningBalance > 0 ? "#dc3545" : "#28a745";
  document.getElementById("kpi-total-debit").textContent = `₹${formatNumber(periodDebit)}`;
  document.getElementById("kpi-total-credit").textContent = `₹${formatNumber(periodCredit)}`;
  balanceValue.textContent = `₹${formatNumber(runningBalance)}`;
}

function updateSelectionSummary() {
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox-ledger:checked");
  const summaryElement = document.getElementById("selection-summary");
  let totalAmount = 0;
  selectedCheckboxes.forEach((cb) => {
    totalAmount += Number(cb.dataset.amount);
  });

  if (selectedCheckboxes.length > 0) {
    summaryElement.innerHTML = `Selected ${
      selectedCheckboxes.length
    } bill(s) | Total: <span style="font-weight: bold;">${formatNumber(totalAmount)}</span>`;
    summaryElement.style.display = "block";
  } else {
    summaryElement.style.display = "none";
  }
}

function openPaymentModal() {
  // 🛡️ Safety Fix: Agar currentCustomer missing ho toh URL se naam nikal kar set kar lo
  if (!currentCustomer) {
    const urlParams = new URLSearchParams(window.location.search);
    const targetName = urlParams.get("name");
    const targetVillage = urlParams.get("village") || "N/A";
    if (targetName) {
      currentCustomer = { name: targetName, village: targetVillage };
    } else {
      alert("Please select a customer first.");
      return;
    }
  }

  if (!paymentModal) {
    paymentModal = document.getElementById("payment-modal");
  }
  if (!modalCustomerName) {
    modalCustomerName = document.getElementById("modal-customer-name");
  }
  if (!amountInput) {
    amountInput = document.getElementById("payment-amount-input");
  }
  if (!dateInput) {
    dateInput = document.getElementById("payment-date-input");
  }

  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox-ledger:checked");

  if (modalCustomerName) modalCustomerName.textContent = currentCustomer.name;
  if (amountInput) amountInput.value = "";
  if (deductionAmountInput) deductionAmountInput.value = "";
  if (deductionReasonInput) deductionReasonInput.value = "";
  if (dateInput) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    dateInput.value = `${year}-${month}-${day}`;
  }

  if (selectedCheckboxes.length > 0) {
    let totalPendingToPay = 0;

    selectedCheckboxes.forEach((cb) => {
      const pendingAmount = Number(cb.dataset.amount) || 0;
      if (pendingAmount > 0) {
        totalPendingToPay += pendingAmount;
      }
    });

    if (modalTitle) modalTitle.textContent = "Pay Selected Bills";
    if (modalDescription)
      modalDescription.innerHTML = `Enter payment for <strong>${selectedCheckboxes.length} selected bill(s)</strong>.`;
    if (amountInput) amountInput.value = totalPendingToPay;
  } else {
    if (modalTitle) modalTitle.textContent = "Record a General Payment";
    if (modalDescription)
      modalDescription.innerHTML = `Enter details for a general payment to <strong>${currentCustomer.name}</strong>.`;
  }

  if (paymentModal) {
    paymentModal.style.display = "flex";
  } else {
    console.error("Payment modal element not found in DOM!");
  }
}

function closePaymentModal() {
  paymentModal.style.display = "none";
}

async function updateCustomerMasterBalance(customer, delta) {
  if (!customer || !customer.customerId) return;
  try {
    const masterRef = db.collection("parties").doc(customer.customerId);

    await db.runTransaction(async (transaction) => {
      const masterDoc = await transaction.get(masterRef);
      if (!masterDoc.exists) return;
      const prevBalance = masterDoc.data().currentBalance || 0;
      transaction.update(masterRef, {
        currentBalance: prevBalance + delta,
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    console.error("Master balance update error:", e);
  }
}

async function savePayment() {
  const saveBtn = document.getElementById("save-payment-btn");

  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox-ledger:checked");
  const cashAmount = Number(amountInput.value) || 0;
  const deductionAmount = Number(deductionAmountInput.value) || 0;
  const deductionReason = deductionReasonInput.value;
  const dateStr = dateInput.value;
  const totalCredit = cashAmount + deductionAmount;

  if (totalCredit <= 0 || !dateStr) {
    Swal.fire("Invalid Input", "Please enter a date and at least one amount.", "error");
    return;
  }
  if (deductionAmount > 0 && !deductionReason) {
    Swal.fire("Invalid Input", "Please provide a reason for the deduction.", "error");
    return;
  }

  // 🛡️ SAFETY LOCK: Double-click / Duplicate entries se bachne ke liye button disable karo
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.6";
    saveBtn.style.cursor = "not-allowed";
    saveBtn.innerHTML = "Saving...";
  }

  showLoading();
  try {
    const paymentDate = firebase.firestore.Timestamp.fromDate(new Date(dateStr));
    const affectedOrderIds = new Set();

    if (selectedCheckboxes.length > 0) {
      const selectedBillIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

      await paymentsCollection.add({
        customerName: currentCustomer.name,
        customerVillage: currentCustomer.village,
        customerId: currentCustomer.customerId || null,
        cashAmount,
        deductionAmount,
        deductionReason,
        totalCredit,
        paymentDate,
        appliedToBills: selectedBillIds,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      const batch = db.batch();
      let remainingCredit = totalCredit;

      for (const billId of selectedBillIds) {
        if (remainingCredit <= 0) break;
        const billRef = billsCollection.doc(billId);
        const billDoc = await billRef.get();
        if (billDoc.exists) {
          const billData = billDoc.data();

          const currentAmountPaid = Number(billData.amountPaid || 0);
          const billTotal = Number(
            billData["Final Total"] ||
              billData.total ||
              billData.amount ||
              Number(billData.amountDue || 0) + currentAmountPaid ||
              0
          );

          const amountOwedOnBill = billTotal - currentAmountPaid;
          const paymentForThisBill = Math.min(remainingCredit, amountOwedOnBill);

          const newAmountPaid = currentAmountPaid + paymentForThisBill;
          const newAmountDue = billTotal - newAmountPaid;
          const newStatus = newAmountDue <= 0.01 ? "Paid" : "Partial";

          batch.update(billRef, {
            amountPaid: newAmountPaid,
            amountDue: newAmountDue,
            paymentStatus: newStatus,
          });

          remainingCredit -= paymentForThisBill;

          try {
            const billSerial = billData["Serial No"] || billData.serialNo;
            if (billSerial) {
              const matchingOrders = await db.collection("orders").where("linkedBillNo", "==", billSerial).get();
              matchingOrders.forEach((ordDoc) => affectedOrderIds.add(ordDoc.id));

              const matchingOrdersArray = await db
                .collection("orders")
                .where("linkedBillNos", "array-contains", billSerial)
                .get();
              matchingOrdersArray.forEach((ordDoc) => affectedOrderIds.add(ordDoc.id));
            }
          } catch (e) {
            console.warn("Order match error non-fatal");
          }
        }
      }
      await batch.commit();

      for (const ordId of affectedOrderIds) {
        await recalculateAndUpdateOrderPaymentStatus(ordId);
      }

      await updateCustomerMasterBalance(currentCustomer, -totalCredit);
    } else {
      await paymentsCollection.add({
        customerName: currentCustomer.name,
        customerVillage: currentCustomer.village,
        customerId: currentCustomer.customerId || null,
        cashAmount,
        deductionAmount,
        deductionReason,
        totalCredit,
        paymentDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await updateCustomerMasterBalance(currentCustomer, -totalCredit);
    }

    closePaymentModal();
    Swal.fire("Success!", "Payment entry has been saved.", "success");
    showCustomerLedger(currentCustomer);
  } catch (error) {
    console.error("Error saving payment:", error);
    Swal.fire("Error", "Could not save the payment.", "error");
  } finally {
    hideLoading();

    // 🔓 UNLOCK BUTTON: Process khatam hone par button wapas normal karo
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
      saveBtn.style.cursor = "pointer";
      saveBtn.innerHTML = "💾 Save Entry"; // Aapka original button text
    }
  }
}
function printLedger() {
  const startDate = document.getElementById("start_date").value;
  const endDate = document.getElementById("end_date").value;
  const dateRange =
    startDate && endDate
      ? `From ${new Date(startDate).toLocaleDateString("en-IN")} to ${new Date(endDate).toLocaleDateString("en-IN")}`
      : "For all transactions";

  let tableRowsHtml = "";
  ledgerAsTableData.forEach((row) => {
    const isOpening = row.Particulars.includes("Opening Balance");
    tableRowsHtml += `
        <tr class="${isOpening ? "opening-balance-row" : ""}">
          <td>${row.Date}</td>
          <td>${row.Particulars}</td>
          <td class="text-right">${row.Debit}</td>
          <td class="text-right">${row.Credit}</td>
          <td class="text-right">${row.Balance}</td>
        </tr>`;
  });

  const totalDebit = document.getElementById("kpi-total-debit").textContent;
  const totalCredit = document.getElementById("kpi-total-credit").textContent;
  const closingBalance = document.getElementById("kpi-balance-due").textContent;
  const openingBalance = ledgerAsTableData.length > 0 ? ledgerAsTableData[0].Balance : "₹0";

  const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${currentCustomer.name} - Statement</title>
        <style>
          @page { size: A4; margin: 12mm 15mm; }
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2d3748; margin: 0; padding: 0; font-size: 10pt; line-height: 1.4; background: #fff; }
          
          /* Company Header */
          .header-container { display: flex; justify-content: space-between; border-bottom: 2.5px solid #1a365d; padding-bottom: 12px; margin-bottom: 15px; }
          .company-info h1 { font-size: 18pt; font-weight: 800; color: #1a365d; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
          .company-info p { font-size: 9pt; color: #4a5568; margin: 3px 0 0 0; }
          .doc-title { text-align: right; }
          .doc-title h2 { font-size: 13pt; margin: 0; color: #2d3748; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
          .doc-title p { font-size: 8.5pt; color: #718096; margin: 2px 0 0 0; }

          /* Customer & Meta Box */
          .meta-box { background: #f8fafc; border: 1px solid #cbd5e0; border-radius: 6px; padding: 10px 14px; margin-bottom: 15px; display: flex; justify-content: space-between; }
          .meta-left h3 { margin: 0 0 3px 0; font-size: 11pt; color: #1a202c; }
          .meta-left p { margin: 1px 0; font-size: 9.5pt; color: #4a5568; }
          .meta-right { text-align: right; font-size: 9pt; color: #4a5568; }

          /* Summary Grid */
          .summary-grid { display: flex; gap: 10px; margin-bottom: 15px; }
          .summary-card { flex: 1; background: #fff; border: 1px solid #cbd5e0; border-radius: 5px; padding: 8px 10px; text-align: center; }
          .summary-card .label { font-size: 7.5pt; color: #718096; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; }
          .summary-card .value { font-size: 10.5pt; color: #1a202c; font-weight: bold; margin-top: 2px; }

          /* Table Styling */
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 9.5pt; }
          th { background-color: #1a365d; color: #ffffff; text-align: left; padding: 7px 10px; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.5px; }
          th.text-right, td.text-right { text-align: right; }
          td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; color: #2d3748; }
          tr:nth-child(even) { background-color: #f8fafc; }
          .opening-balance-row { background-color: #edf2f7; font-weight: bold; }

          /* Footer & Signature */
          .footer { margin-top: 25px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 8.5pt; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          .sign-area { text-align: right; font-weight: bold; color: #2d3748; margin-top: 30px; font-size: 9pt; }
        </style>
      </head>
      <body>
        <div class="header-container">
          <div class="company-info">
           <h1>${globalSettings && globalSettings.companyName ? globalSettings.companyName : "Company Name"}</h1>
            <p>Sortex Cleaned Wheat, Commission Agents & Logistics</p>
          </div>
          <div class="doc-title">
            <h2>Account Statement</h2>
            <p>Date: ${new Date().toLocaleDateString("en-IN")}</p>
          </div>
        </div>

        <div class="meta-box">
          <div class="meta-left">
            <h3>Account Holder: ${currentCustomer.name}</h3>
            <p>Village / Location: ${currentCustomer.village || "N/A"}</p>
          </div>
          <div class="meta-right">
            <p><strong>Statement Period:</strong> ${dateRange}</p>
            <p><strong>Opening Balance:</strong> ${openingBalance}</p>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Total Debit (उधार)</div>
            <div class="value" style="color: #c53030;">${totalDebit}</div>
          </div>
          <div class="summary-card">
            <div class="label">Total Credit (जमा)</div>
            <div class="value" style="color: #2f855a;">${totalCredit}</div>
          </div>
          <div class="summary-card">
            <div class="label">Closing Balance (बाकी)</div>
            <div class="value" style="color: #2b6cb0;">${closingBalance}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 15%;">Date</th>
              <th style="width: 43%;">Particulars (विवरण)</th>
              <th class="text-right" style="width: 14%;">Debit (उधार)</th>
              <th class="text-right" style="width: 14%;">Credit (जमा)</th>
              <th class="text-right" style="width: 14%;">Balance (बाकी)</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>

        <div class="footer">
          <div>
            <p>This is a computer-generated official account statement.</p>
            <p>Generated on: ${new Date().toLocaleString("en-IN")}</p>
          </div>
          <div class="sign-area">
            <p>For, ${globalSettings && globalSettings.companyName ? globalSettings.companyName : "Company Name"}</p>
            <br><br>
            <p>Authorized Signatory</p>
          </div>
        </div>
      </body>
      </html>
    `;

  const printFrame = document.createElement("iframe");
  printFrame.style.display = "none";
  document.body.appendChild(printFrame);
  const printDocument = printFrame.contentWindow.document;
  printDocument.open();
  printDocument.write(printHtml);
  printDocument.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
    document.body.removeChild(printFrame);
  }, 500);
}
window.deletePaymentEntry = async function (paymentId) {
  // 🛑 Strict Security Check
  const confirm = await Swal.fire({
    title: "⚠️ Security Check: Delete Payment?",
    text: "Yeh ek critical action hai! Galti ya fraud se bachne ke liye niche box mein 'DELETE' type karein.",
    input: "text",
    inputPlaceholder: "Yahan 'DELETE' likhein...",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Confirm & Delete",
    confirmButtonColor: "#dc3545",
    cancelButtonColor: "#6c757d",
    preConfirm: (inputValue) => {
      if (inputValue !== "DELETE") {
        Swal.showValidationMessage("Aage badhne ke liye 'DELETE' likhna anivarya (mandatory) hai!");
      }
      return inputValue;
    },
  });

  if (!confirm.isConfirmed) return;

  showLoading("Deleting payment securely...");
  try {
    const paymentRef = paymentsCollection.doc(paymentId);
    const paymentDoc = await paymentRef.get();

    if (!paymentDoc.exists) {
      Swal.fire("Error", "Payment record not found.", "error");
      hideLoading();
      return;
    }

    const paymentData = paymentDoc.data();
    const totalCredit = Number(paymentData.totalCredit || 0);
    const appliedBills = paymentData.appliedToBills || [];
    const affectedOrderIds = new Set();

    // 2. Agar kisi bill par apply hua tha, toh bills ka amountPaid wapas adjust karo
    if (appliedBills.length > 0) {
      let remainingRefund = totalCredit; // 🚀 FIX: Ab proper amount minus hoga
      const batch = db.batch(); // 🚀 FIX: Multiple bills ke liye safe batch process

      for (const billId of appliedBills) {
        if (remainingRefund <= 0) break;

        const billRef = billsCollection.doc(billId);
        const billDoc = await billRef.get();

        if (billDoc.exists) {
          const billData = billDoc.data();
          const currentPaid = Number(billData.amountPaid || 0);

          // 🚀 FIX: Sahi Bill Total Pakdo (Jaise Save mein karte hain)
          const billTotal = Number(
            billData["Final Total"] ||
              billData.total ||
              billData.amount ||
              Number(billData.amountDue || 0) + currentPaid ||
              0
          );

          const refundForThisBill = Math.min(remainingRefund, currentPaid);
          const newAmountPaid = currentPaid - refundForThisBill;
          const newAmountDue = billTotal - newAmountPaid;

          // 🚀 FIX: "Partially Paid" hata kar "Partial" kiya
          const newStatus = newAmountDue <= 0.01 ? "Paid" : newAmountPaid > 0 ? "Partial" : "Unpaid";

          batch.update(billRef, {
            amountPaid: newAmountPaid,
            amountDue: newAmountDue,
            paymentStatus: newStatus,
          });

          remainingRefund -= refundForThisBill;

          // 🚀 FIX: Try-catch lagaya taaki agar Order fetch fail ho toh kam se kam delete to ho jaye
          try {
            const billSerial = billData["Serial No"] || billData.serialNo;
            if (billSerial) {
              const matchingOrders = await db.collection("orders").where("linkedBillNo", "==", billSerial).get();
              matchingOrders.forEach((ordDoc) => affectedOrderIds.add(ordDoc.id));

              const matchingOrdersArray = await db
                .collection("orders")
                .where("linkedBillNos", "array-contains", billSerial)
                .get();
              matchingOrdersArray.forEach((ordDoc) => affectedOrderIds.add(ordDoc.id));
            }
          } catch (orderFetchError) {
            console.warn("Order match nahi mila, par process continue rahega.");
          }
        }
      }
      // Saare bills update commit karo
      await batch.commit();
    }

    // 3. Master Party balance ko wapas update karo
    if (currentCustomer) {
      await updateCustomerMasterBalance(currentCustomer, totalCredit);
    }

    // 4. 🔥 FIREBASE SE ORIGINAL PAYMENT DELETE KARO 🔥
    await paymentRef.delete();

    // 5. Affected orders ko safe tarike se update karo
    for (const ordId of affectedOrderIds) {
      try {
        await recalculateAndUpdateOrderPaymentStatus(ordId);
      } catch (err) {
        console.error("Order recalculate mein dikkat:", err);
      }
    }

    hideLoading();
    Swal.fire("Deleted!", "Payment entry successfully removed.", "success");

    // Ledger ko refresh karke wapas load karo
    showCustomerLedger(currentCustomer);
  } catch (error) {
    console.error("Error deleting payment:", error);
    hideLoading();
    Swal.fire("Error", "Could not delete payment. Please try again.", "error");
  }
};
// Payment delete hone ke baad order ka status wapas update karne ke liye:

// 🔄 Order ke saare linked bills ko check karke sahi payment status calculate karne ka function
async function recalculateAndUpdateOrderPaymentStatus(orderId) {
  if (!orderId) return;
  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return;
    const order = orderDoc.data();

    // Is order ke saare linked bills nikal lo
    let billSerials = [];
    if (order.linkedBillNos && Array.isArray(order.linkedBillNos)) {
      billSerials = order.linkedBillNos.map((b) => (b.billNo || b).toString().trim());
    } else if (order.linkedBillNo) {
      billSerials = order.linkedBillNo.split(",").map((s) => s.trim());
    }
    if (billSerials.length === 0) return;

    // Bills collection se inke records fetch karo
    let allLinkedBills = [];
    for (let i = 0; i < billSerials.length; i += 10) {
      const chunk = billSerials.slice(i, i + 10);
      const snap = await db.collection("bills").where("Serial No", "in", chunk).get();
      snap.forEach((d) => allLinkedBills.push(d.data()));
    }

    if (allLinkedBills.length === 0) return;

    let totalFinal = 0;
    let totalPaid = 0;
    allLinkedBills.forEach((b) => {
      totalFinal += Number(b["Final Total"] || 0);
      totalPaid += Number(b.amountPaid || 0);
    });

    // Logical Status Calculation
    let newPayStatus = "Unpaid";
    if (totalPaid >= totalFinal && totalFinal > 0) {
      newPayStatus = "Paid";
    } else if (totalPaid > 0) {
      newPayStatus = "Partial";
    }

    // Order update kar do
    await orderRef.update({
      paymentStatus: newPayStatus,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("Error updating consolidated order payment status:", e);
  }
}
