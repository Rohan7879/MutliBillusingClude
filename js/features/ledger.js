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
    document.getElementById("ledger-view").style.display = "none";
    document.getElementById("customer-selection-view").style.display = "block";
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

  document.getElementById("select-all-bills-ledger").addEventListener("change", (e) => {
    document.querySelectorAll(".bill-checkbox-ledger:not(:disabled)").forEach((checkbox) => {
      checkbox.checked = e.target.checked;
    });
    updateSelectionSummary();
  });

  showLoading();
  fetchUniqueCustomers();

  // --- Add this block to your initializeLedgerPage function ---
  document.getElementById("select-all-bills-ledger").addEventListener("change", (e) => {
    // Find all individual bill checkboxes that are not disabled
    document.querySelectorAll(".bill-checkbox-ledger:not(:disabled)").forEach((checkbox) => {
      // Set their 'checked' property to match the 'Select All' box
      checkbox.checked = e.target.checked;
    });
    // Update the "Selected bills" summary
    updateSelectionSummary();
  });
}

async function fetchUniqueCustomers() {
  try {
    const [billsSnapshot, paymentsSnapshot] = await Promise.all([billsCollection.get(), paymentsCollection.get()]);
    const customerMap = new Map();
    const processDoc = (doc) => {
      const data = doc.data();
      const customerName = data["Customer Name"] || data.customerName;
      if (customerName) {
        const village = data["Village"] || data.customerVillage || "N/A";
        const key = `${customerName.toLowerCase()}|${village.toLowerCase()}`;
        if (!customerMap.has(key)) {
          customerMap.set(key, { name: customerName, village: village });
        }
      }
    };
    billsSnapshot.docs.forEach(processDoc);
    paymentsSnapshot.docs.forEach(processDoc);
    allUniqueCustomers = Array.from(customerMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    renderCustomerList(allUniqueCustomers);
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
    customerCard.addEventListener("click", () => showCustomerLedger(customer));
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
    const [billsSnapshot, paymentsSnapshot] = await Promise.all([
      billsCollection.where("Customer Name", "==", customer.name).get(),
      paymentsCollection.where("customerName", "==", customer.name).get(),
    ]);

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

    billsSnapshot.docs.forEach((doc) => {
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
        particulars = `Payment for Bill #${serials}`;
      } else if (cashAmount > 0 && deductionAmount > 0) {
        particulars = `Cash: ${formatNumber(cashAmount)} + Ded.: ${formatNumber(deductionAmount)} (${
          payment.deductionReason
        })`;
      } else if (deductionAmount > 0) {
        particulars = `Deduction (${payment.deductionReason})`;
      }

      allTransactions.push({
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

    const totalBills = billsSnapshot.docs.length;
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
  if (!currentCustomer || !modalCustomerName) return;
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox-ledger:checked");

  modalCustomerName.textContent = currentCustomer.name;
  amountInput.value = "";
  deductionAmountInput.value = "";
  deductionReasonInput.value = "";
  dateInput.valueAsDate = new Date();

  if (selectedCheckboxes.length > 0) {
    let totalAmount = 0;
    selectedCheckboxes.forEach((cb) => (totalAmount += Number(cb.dataset.amount)));
    modalTitle.textContent = "Pay Selected Bills";
    modalDescription.innerHTML = `Enter payment for <strong>${selectedCheckboxes.length} selected bill(s)</strong>.`;
    amountInput.value = totalAmount;
  } else {
    modalTitle.textContent = "Record a General Payment";
    modalDescription.innerHTML = `Enter details for a general payment to <strong>${currentCustomer.name}</strong>.`;
  }
  paymentModal.style.display = "flex";
}

function closePaymentModal() {
  paymentModal.style.display = "none";
}

async function savePayment() {
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

  showLoading();
  try {
    const paymentDate = firebase.firestore.Timestamp.fromDate(new Date(dateStr));
    if (selectedCheckboxes.length > 0) {
      const selectedBillIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

      await paymentsCollection.add({
        customerName: currentCustomer.name,
        customerVillage: currentCustomer.village,
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
          const currentAmountPaid = billData.amountPaid || 0;
          const amountOwedOnBill = billData["Final Total"] - currentAmountPaid;
          const paymentForThisBill = Math.min(remainingCredit, amountOwedOnBill);

          const newAmountPaid = currentAmountPaid + paymentForThisBill;
          const newAmountDue = billData["Final Total"] - newAmountPaid;
          const newStatus = newAmountDue <= 0.01 ? "Paid" : "Partially Paid";

          batch.update(billRef, {
            amountPaid: newAmountPaid,
            amountDue: newAmountDue,
            paymentStatus: newStatus,
          });
          remainingCredit -= paymentForThisBill;
        }
      }
      await batch.commit();
    } else {
      await paymentsCollection.add({
        customerName: currentCustomer.name,
        customerVillage: currentCustomer.village,
        cashAmount,
        deductionAmount,
        deductionReason,
        totalCredit,
        paymentDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    closePaymentModal();
    Swal.fire("Success!", "Payment entry has been saved.", "success");
    showCustomerLedger(currentCustomer);
  } catch (error) {
    console.error("Error saving payment:", error);
    Swal.fire("Error", "Could not save the payment.", "error");
  } finally {
    hideLoading();
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
          <td>${row.Date}</td><td>${row.Particulars}</td><td>${row.Debit}</td><td>${row.Credit}</td><td>${
      row.Balance
    }</td>
        </tr>`;
  });

  const totalDebit = document.getElementById("kpi-total-debit").textContent;
  const totalCredit = document.getElementById("kpi-total-credit").textContent;
  const closingBalance = document.getElementById("kpi-balance-due").textContent;
  const openingBalance = ledgerAsTableData.length > 0 ? ledgerAsTableData[0].Balance : "₹0";

  const printHtml = `
      <html>
      <head>
        <title>${currentCustomer.name} - Statement</title>
        <link rel="stylesheet" href="print-ledger.css">
        <style> body { margin: 0; } </style>
      </head>
      <body>
        <div class="statement-info">
          <div class="customer-info">
            <h3>Account Statement</h3>
            <p><strong>${currentCustomer.name}</strong><br>${currentCustomer.village}</p>
          </div>
          <div class="statement-summary">
              <div class="summary-line"><strong>Statement Period:</strong> ${dateRange}</div>
              <div class="summary-line"><strong>Opening Balance:</strong> ${openingBalance}</div>
              <div class="summary-line"><strong>Total Debits:</strong> ${totalDebit}</div>
              <div class="summary-line"><strong>Total Credits:</strong> ${totalCredit}</div>
              <div class="summary-line closing-balance"><strong>Closing Balance:</strong> ${closingBalance}</div>
          </div>
        </div>
        <table class="print-table">
          <thead>
            <tr>
              <th>Date</th><th>Particulars</th><th>Debit</th><th>Credit</th><th>Balance</th>
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
        <div class="print-footer">
          Generated on: ${new Date().toLocaleString("en-IN")} | This is a computer-generated statement.
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
