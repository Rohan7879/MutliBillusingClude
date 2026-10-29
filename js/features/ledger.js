document.addEventListener("DOMContentLoaded", () => {
  initializeLedgerPage();
});

const paymentsCollection = db.collection("payments");

let allUniqueCustomers = [];
let currentCustomer = null;
let allTransactions = [];
let displayedTransactions = [];
let ledgerAsTableData = [];
let hideReversedPayments = true;
let selectedFinancialYear = window.MandiFinancialYear.financialYearId(new Date());
let appliedPeriodLabel = "";

function ledgerBalanceLabel(cents) {
  const amount = (Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${amount} — ${cents > 0 ? "Payable by customer" : cents < 0 ? "Customer advance (credit)" : "Settled"}`;
}

function assertLedgerBillPayable(bill) {
  if (bill.revisionPending === true) throw new Error("Revision awaiting approval — payment is blocked until this bill is approved.");
}

function populateFinancialYears() {
  const selector = document.getElementById("financial-year-select");
  selector.innerHTML = '<option value="all">All dates</option>';
  const years = window.MandiFinancialYear.availableYears(allTransactions, new Date());
  if (selectedFinancialYear !== "all" && !years.includes(selectedFinancialYear)) years.push(selectedFinancialYear);
  years.sort().reverse().forEach(id => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `FY ${id}`;
    selector.appendChild(option);
  });
  selector.value = selectedFinancialYear;
}

function updateReversalVisibility() {
  const toggle = document.getElementById("hide-reversed-payments");
  if (toggle) hideReversedPayments = toggle.checked;
  const body = document.getElementById("ledger-table-body");
  if (body) body.className = hideReversedPayments ? "hide-reversed" : "";
  const count = displayedTransactions.filter(tx => tx.reversed || tx.type === "reversal").length;
  const note = document.getElementById("reversal-visibility-note");
  if (note) note.textContent = `${count} reversed entries ${hideReversedPayments ? "hidden" : "shown"}. Balances and printed/exported statements include full history.`;
}

let paymentModal,
  modalTitle,
  modalDescription,
  modalCustomerName,
  amountInput,
  paymentMethodInput,
  dateInput,
  deductionAmountInput,
  deductionReasonInput,
  saveBtn;

function ledgerDate(value) {
  if (value && typeof value.toDate === "function") value = value.toDate();
  return window.MandiFinancialYear.parseDate(value) || new Date(NaN);
}

function setLedgerSyncStatus(message, isError = false) {
  const status = document.getElementById("ledgerSyncStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function initializeLedgerPage() {
  window.MandiPaymentUI.mount();
  document.getElementById("hide-reversed-payments")?.addEventListener("change", updateReversalVisibility);
  paymentModal = document.getElementById("payment-modal");
  modalTitle = document.getElementById("modal-title");
  modalDescription = document.getElementById("modal-description");
  modalCustomerName = document.getElementById("modal-customer-name");
  amountInput = document.getElementById("payment-amount-input");
  paymentMethodInput = document.getElementById("payment-method-input");
  dateInput = document.getElementById("payment-date-input");
  deductionAmountInput = document.getElementById("payment-deduction-amount");
  deductionReasonInput = document.getElementById("payment-deduction-reason");
  saveBtn = document.getElementById("save-payment-btn");

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

  document.getElementById("financial-year-select").addEventListener("change", (event) => {
    selectedFinancialYear = event.target.value;
    // Choosing a FY resets custom dates; Apply may narrow that FY further.
    document.getElementById("start_date").value = "";
    document.getElementById("end_date").value = "";
    renderLedgerTable(allTransactions);
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
    const partyKeyById = new Map();

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
            opBal: pData.opBal,
            opBalType: pData.opBalType,
          });
          partyKeyById.set(doc.id, key);
        }
      }
    });

    const processDoc = (doc) => {
      if (doc.data().deleted === true) return;
      const data = doc.data();
      const customerName = data["Customer Name"] || data.customerName;
      if (customerName) {
        const village = data["Village"] || data.customerVillage || "N/A";
        const canonicalKey = data.customerId ? partyKeyById.get(data.customerId) : null;
        if (canonicalKey && customerMap.has(canonicalKey)) {
          const party = customerMap.get(canonicalKey);
          if ((!party.village || party.village.toUpperCase() === "N/A") && village.toUpperCase() !== "N/A") {
            party.village = village;
          }
          return;
        }
        // Legacy bills created before customerId existed are merged only when
        // Party Master has exactly one active party with that same name.
        const sameNameParties = Array.from(customerMap.values()).filter(
          (party) => party.name.trim().toLowerCase() === customerName.trim().toLowerCase()
        );
        if (sameNameParties.length === 1) return;
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
    const customerCount = document.getElementById("ledgerCustomerCount");
    const recordCount = document.getElementById("ledgerRecordCount");
    if (customerCount) customerCount.textContent = allUniqueCustomers.length;
    if (recordCount) recordCount.textContent = billsSnapshot.docs.length + paymentsSnapshot.docs.length;
    setLedgerSyncStatus(
      `Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    );

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
    setLedgerSyncStatus("Could not refresh ledger", true);
    alert("Could not load customer list.");
  } finally {
    hideLoading();
  }
}
function renderCustomerList(customers) {
  const container = document.getElementById("customer-list-container");
  container.innerHTML = "";
  if (customers.length === 0) {
    container.innerHTML = '<p class="ledger-empty">No customer accounts found yet. Add a Farmer or Vepari in Party Master, or create a bill to begin.</p>';
    return;
  }
  customers.forEach((customer) => {
    const customerCard = document.createElement("div");
    customerCard.className = "customer-card";
    customerCard.innerHTML = `<div class="customer-name">${escapeHtml(
      customer.name
    )}</div><div class="customer-village">${escapeHtml(customer.village)}</div>`;

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
    const reversedPaymentIds = new Set(paymentsSnapshot.docs.map(doc => doc.data().reversalOf).filter(Boolean));
    paymentsSnapshot.docs.forEach((doc) => {
      const payment = doc.data();
      if (payment.appliedToBills) {
        payment.appliedToBills.forEach((billId) => paidBillIds.add(billId));
      }
    });

    mergedBillDocs.forEach((doc) => {
      const bill = doc.data();
      const billDate = ledgerDate(bill.Date || bill.date || bill.billDate || bill.createdAt);
      const billTotal = Number(bill["Final Total"] || bill.total || bill.amount || 0);

      if (!Number.isNaN(billDate.getTime())) billDates.push(billDate);
      totalBillValue += billTotal;
      billIdToSerialMap.set(doc.id, bill["Serial No"]);

      allTransactions.push({
        id: doc.id,
        type: "bill",
        date: billDate,
        particulars: `Bill No: ${bill["Serial No"]}${bill.revisionPending === true ? " — Revision awaiting approval (working amount, not final)" : ""}`,
        revisionPending: bill.revisionPending === true,
        debit: billTotal,
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
      const paymentDate = ledgerDate(payment.paymentDate || payment.createdAt);
      const cashAmount = Number(payment.cashAmount || 0);
      const deductionAmount = Number(payment.deductionAmount || 0);
      const paymentMethod = payment.paymentMethod || "Cash";

      let particulars = "General Payment";
      if (payment.appliedToBills && payment.appliedToBills.length > 0) {
        const serials = payment.appliedToBills.map((id) => billIdToSerialMap.get(id) || id.slice(0, 4)).join(", #");
        if (cashAmount > 0 && deductionAmount > 0) {
          particulars = `Bill #${serials} | ${paymentMethod}: ₹${formatNumber(cashAmount)} | Kapat: ₹${formatNumber(
            deductionAmount
          )} (${payment.deductionReason || "Kapat"})`;
        } else if (deductionAmount > 0) {
          particulars = `Bill #${serials} | Kapat: ₹${formatNumber(deductionAmount)} (${
            payment.deductionReason || "Kapat"
          })`;
        } else {
          particulars = `Bill #${serials} | ${paymentMethod}: ₹${formatNumber(cashAmount)}`;
        }
      } else if (cashAmount > 0 && deductionAmount > 0) {
        particulars = `${paymentMethod}: ₹${formatNumber(cashAmount)} + Kapat: ₹${formatNumber(deductionAmount)} (${
          payment.deductionReason || "Kapat"
        })`;
      } else if (deductionAmount > 0) {
        particulars = `Kapat: ₹${formatNumber(deductionAmount)} (${payment.deductionReason || "Kapat"})`;
      }

      allTransactions.push({
        id: doc.id,
        type: payment.reversalOf ? "reversal" : "payment",
        reversed: reversedPaymentIds.has(doc.id),
        date: paymentDate,
        particulars: payment.reversalOf
          ? `Payment reversed | ${particulars} | Reason: ${payment.reason || ""}`
          : `${particulars}${reversedPaymentIds.has(doc.id) ? " | Reversed" : ""}`,
        debit: 0,
        credit: Number(payment.totalCredit || cashAmount + deductionAmount),
        sortKey: paymentDate.getTime(),
      });
    });

    allTransactions.sort((a, b) => a.sortKey - b.sortKey);
    populateFinancialYears();
    renderLedgerTable(allTransactions, document.getElementById("start_date").value, document.getElementById("end_date").value);

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
  const fy = window.MandiFinancialYear;
  let report;
  try {
    report = fy.summarize(transactions, {
      fyId: selectedFinancialYear === "all" ? null : selectedFinancialYear,
      start: startDateStr, end: endDateStr,
      initialOpeningCents: fy.partyOpeningCents(currentCustomer || {}),
    });
  } catch (error) {
    alert(error.message);
    return; // Keep the previously applied statement and print period intact.
  }
  const tableBody = document.getElementById("ledger-table-body");
  tableBody.innerHTML = "";
  displayedTransactions = [];
  ledgerAsTableData = [];

  const startDate = report.start ? fy.parseDate(report.start) : null;
  appliedPeriodLabel = `${selectedFinancialYear === "all" ? "All dates" : `FY ${selectedFinancialYear}`} · ${report.start || "Beginning"} to ${report.end || "Latest"}`;
  if (report.invalidDateCount) appliedPeriodLabel += ` · Warning: ${report.invalidDateCount} invalid-date entries excluded; balances may be incomplete`;
  document.getElementById("ledger-period-label").textContent = appliedPeriodLabel;

  const openingRow = document.createElement("tr");
  openingRow.innerHTML = `<td class="no-print"></td><td>${
    startDate ? startDate.toLocaleDateString("en-IN") : "-"
  }</td><td><strong>Opening Balance (initial + prior activity)</strong></td><td colspan="2"></td><td><strong>${ledgerBalanceLabel(report.openingCents)}</strong></td>`;
  tableBody.appendChild(openingRow);

  ledgerAsTableData.push({
    Date: startDate ? startDate.toLocaleDateString("en-IN") : "-",
    Particulars: "Opening Balance (initial + prior activity)",
    Debit: "",
    Credit: "",
    Balance: ledgerBalanceLabel(report.openingCents),
  });

  report.rows.forEach(({ transaction: tx, balanceCents, debitCents, creditCents }) => {
      displayedTransactions.push(tx);

      let checkboxHtml = '<td class="no-print"></td>';
      if (tx.type === "bill") {
        const isDisabled = tx.amountDue <= 0.01 || tx.revisionPending;
        checkboxHtml = `<td class="no-print"><input type="checkbox" class="bill-checkbox-ledger" value="${
          tx.id
        }" data-amount="${tx.amountDue}" onchange="updateSelectionSummary()" ${isDisabled ? "disabled" : ""} ${tx.revisionPending ? 'title="Revision awaiting approval — payment blocked"' : ""}></td>`;
      } else if (tx.type === "payment" && tx.id && !tx.reversed && hasRole("admin", "accountant")) {
        checkboxHtml = `<td class="no-print"><button onclick="reversePaymentEntry('${tx.id}')" style="background:#dc3545; color:white; border:none; padding:5px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:bold;">Reverse</button></td>`;
      }

      const row = document.createElement("tr");
      if (tx.reversed || tx.type === "reversal") row.className = "reversed-entry";
      const particularsHtml = tx.type === "bill"
        ? `<a href="final.html?id=${encodeURIComponent(tx.id)}" style="color:#005a9e;text-decoration:underline">${escapeHtml(tx.particulars)} ↗</a>`
        : escapeHtml(tx.particulars);
      row.innerHTML = `${checkboxHtml}<td>${tx.date.toLocaleDateString("en-IN")}</td><td>${particularsHtml}</td><td>${
        debitCents !== 0 ? formatNumber(debitCents / 100) : "-"
      }</td><td>${creditCents !== 0 ? formatNumber(creditCents / 100) : "-"}</td><td>${ledgerBalanceLabel(balanceCents)}</td>`;
      tableBody.appendChild(row);
      ledgerAsTableData.push({
        Date: tx.date.toLocaleDateString("en-IN"),
        Particulars: tx.particulars,
        Debit: debitCents !== 0 ? formatNumber(debitCents / 100) : "",
        Credit: creditCents !== 0 ? formatNumber(creditCents / 100) : "",
        Balance: ledgerBalanceLabel(balanceCents),
      });
  });

  const balanceCard = document.querySelector(".balance-card");
  const balanceValue = document.getElementById("kpi-balance-due");
  balanceCard.style.backgroundColor = report.closingCents > 0 ? "#fbeaea" : "#eafbf0";
  balanceValue.style.color = report.closingCents > 0 ? "#dc3545" : "#28a745";
  document.getElementById("kpi-total-debit").textContent = `₹${(report.debitCents / 100).toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-credit").textContent = `₹${(report.creditCents / 100).toLocaleString("en-IN")}`;
  balanceValue.textContent = ledgerBalanceLabel(report.closingCents);
  const selectAll = document.getElementById("select-all-bills-ledger");
  if (selectAll) selectAll.checked = false;
  updateSelectionSummary();
  // Visibility only: never remove corrections from balances, date ranges or exports.
  const table = document.getElementById("ledger-table-body");
  table.className = hideReversedPayments ? "hide-reversed" : "";
  const note = document.getElementById("reversal-visibility-note");
  const count = displayedTransactions.filter(tx => tx.reversed || tx.type === "reversal").length;
  if (note) note.textContent = `${count} reversed entries ${hideReversedPayments ? "hidden" : "shown"}. Balances and printed/exported statements include full history.`;
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
  if (window.MandiFormSafety?.isBusy("payment")) return;
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
  if (paymentMethodInput) paymentMethodInput.value = "Cash";
  if (deductionAmountInput) deductionAmountInput.value = "";
  if (deductionReasonInput) deductionReasonInput.value = "";
  document.getElementById("payment-reason-input").value = "";
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
      modalDescription.innerHTML = `Enter details for a general payment to <strong>${escapeHtml(currentCustomer.name)}</strong>.`;
  }

  if (paymentModal) {
    paymentModal.querySelector(".form-operation-status")?.remove();
    paymentModal.style.display = "flex";
  } else {
    console.error("Payment modal element not found in DOM!");
  }
}

let paymentAttemptRef = null;
function closePaymentModal(saved = false) {
  if (saved !== true && window.MandiFormSafety?.isBusy("payment")) return;
  paymentAttemptRef = null;
  paymentModal.style.display = "none";
}

async function savePayment() {
  if (window.MandiFormSafety.isBusy("payment")) return;
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox-ledger:checked");
  try {
    Array.from(selectedCheckboxes).forEach(cb => {
      const bill = allTransactions.find(tx => tx.type === "bill" && tx.id === cb.value);
      if (bill) assertLedgerBillPayable(bill);
    });
  } catch (error) {
    Swal.fire("Payment blocked", error.message, "warning");
    return;
  }
  const cashAmount = Number(amountInput.value);
  const paymentMethod = paymentMethodInput?.value || "Cash";
  const deductionAmount = Number(deductionAmountInput.value);
  const deductionReason = deductionReasonInput.value;
  const paymentReason = document.getElementById("payment-reason-input").value.trim();
  if (!paymentReason) { Swal.fire("Add a reference", "Enter a payment reference before saving.", "warning"); return; }
  const dateStr = dateInput.value;
  const totalCredit = cashAmount + deductionAmount;

  if (amountInput.validity.badInput || deductionAmountInput.validity.badInput || ![cashAmount, deductionAmount, totalCredit].every(Number.isFinite) || cashAmount < 0 || deductionAmount < 0 || totalCredit <= 0 || !dateStr || !Number.isFinite(new Date(dateStr).getTime())) {
    Swal.fire("Invalid Input", "Please enter a date and at least one amount.", "error");
    return;
  }
  if (deductionAmount > 0 && !deductionReason) {
    Swal.fire("Invalid Input", "Please provide a reason for the deduction.", "error");
    return;
  }

  if (selectedCheckboxes.length > 0) {
    const selectedDue = Array.from(selectedCheckboxes).reduce(
      (sum, checkbox) => sum + Math.max(0, Number(checkbox.dataset.amount || 0)),
      0
    );
    if (totalCredit > selectedDue + 0.01) {
      Swal.fire(
        "Payment exceeds pending amount",
        `Selected bills have ₹${selectedDue.toFixed(
          2
        )} pending. Record any extra amount as a separate advance payment.`,
        "error"
      );
      return;
    }
  }

  const operation = MandiFormSafety.begin("payment", { container: paymentModal.querySelector(".modal-content"), button: saveBtn, label: "Saving payment" });
  if (!operation) return;
  let committed = false;
  const paymentRef = paymentAttemptRef ||= paymentsCollection.doc();

  showLoading("Saving payment — waiting for server confirmation...");
  let orderSyncFailed = false;
  try {
    const paymentDate = firebase.firestore.Timestamp.fromDate(new Date(dateStr));
    const affectedOrderIds = new Set();
    const directOrderIds = new Set();
    const selectedBillIds = Array.from(selectedCheckboxes).map((cb) => cb.value);
    const partyRef =
      currentCustomer && currentCustomer.customerId ? db.collection("parties").doc(currentCustomer.customerId) : null;

    // 🔒 ATOMIC WRITE: payment doc + every bill's amountPaid/amountDue +
    // the party's cached balance all go through in a single Firestore
    // transaction now. Either everything above lands together, or (on any
    // failure — network drop, permission error, etc.) NONE of it does.
    // Previously these were separate awaited calls, so a failure partway
    // through could leave a payment recorded but the balance untouched
    // (or vice versa) — this is what caused the mismatch you saw.
    await db.runTransaction(async (transaction) => {
      // --- READS FIRST (Firestore transactions require this) ---
      await MandiFinancialYear.assertPostingOpen(db, transaction, [dateStr]);
      const existingPayment = await transaction.get(paymentRef);
      if (existingPayment.exists) return;
      const billRefs = selectedBillIds.map((id) => billsCollection.doc(id));
      const billDocs = await Promise.all(billRefs.map((ref) => transaction.get(ref)));
      const partyDoc = partyRef ? await transaction.get(partyRef) : null;

      // --- THEN COMPUTE ---
      const paymentPayload = {
        customerName: currentCustomer.name,
        customerVillage: currentCustomer.village,
        customerId: currentCustomer.customerId || null,
        cashAmount,
        paymentMethod,
        deductionAmount,
        deductionReason,
        reason: paymentReason,
        totalCredit,
        paymentDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (selectedBillIds.length > 0) paymentPayload.appliedToBills = selectedBillIds;

      const billUpdates = []; // { ref, billSerial }
      if (selectedBillIds.length > 0) {
        let remainingCredit = totalCredit;
        billDocs.forEach((billDoc, i) => {
          if (!billDoc.exists || billDoc.data().deleted === true) throw new Error("A selected bill is no longer available. Refresh the ledger before paying.");
          const billData = billDoc.data();
          // Re-check the server snapshot: revision may have started since this page loaded.
          assertLedgerBillPayable(billData);
          const currentAmountPaid = Number(billData.amountPaid || 0);
          const billTotal = Number(
            billData["Final Total"] ||
              billData.total ||
              billData.amount ||
              Number(billData.amountDue || 0) + currentAmountPaid ||
              0
          );
          const amountOwedOnBill = billTotal - currentAmountPaid;
          const paymentForThisBill = Math.max(0, Math.min(remainingCredit, amountOwedOnBill));
          const newAmountPaid = currentAmountPaid + paymentForThisBill;
          const newAmountDue = billTotal - newAmountPaid;
          const newStatus = newAmountDue <= 0.01 ? "Paid" : "Partial";

          billUpdates.push({
            ref: billRefs[i],
            billSerial: billData["Serial No"] || billData.serialNo,
            orderId: billData.LinkedOrderId || "",
            fields: { amountPaid: newAmountPaid, amountDue: newAmountDue, paymentStatus: newStatus },
          });
          remainingCredit -= paymentForThisBill;
        });
        if (remainingCredit > 0.01) throw new Error("The selected bills' pending amount changed. Refresh the ledger before paying.");
      }

      // --- WRITES LAST ---
      transaction.set(paymentRef, paymentPayload);
      billUpdates.forEach(({ ref, fields }) => transaction.update(ref, fields));
      if (partyRef && partyDoc && partyDoc.exists) {
        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, {
          currentBalance: currentBalance - totalCredit,
          lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      affectedOrderIds.clear();
      directOrderIds.clear();
      billUpdates.forEach(({ billSerial, orderId }) => {
        if (orderId) directOrderIds.add(orderId);
        else if (billSerial) affectedOrderIds.add(billSerial);
      });
    });
    committed = true;
    operation.message("Payment saved. Checking linked order status...", true);

    // Order-status recalculation still runs as a separate step afterwards
    // (it needs a collection query, which Firestore transactions can't do).
    // This is a display-only field, not money — but we no longer hide a
    // failure here behind a console.warn. If it fails, the payment itself
    // is still safely saved (see above), and you get a visible heads-up
    // to go check that specific order instead of finding out by accident.
    for (const orderId of directOrderIds) {
      try { await recalculateAndUpdateOrderPaymentStatus(orderId); }
      catch (error) { console.error("Linked order payment sync failed:", error); orderSyncFailed = true; }
    }
    if (affectedOrderIds.size > 0) {
      for (const billSerial of affectedOrderIds) {
        try {
          const matchingOrders = await db.collection("orders").where("linkedBillNo", "==", billSerial).get();
          const matchingOrdersArray = await db
            .collection("orders")
            .where("linkedBillNos", "array-contains", billSerial)
            .get();
          const orderIds = new Set([
            ...matchingOrders.docs.map((d) => d.id),
            ...matchingOrdersArray.docs.map((d) => d.id),
          ]);
          // No match is normal for a direct bill; legacy links still use this lookup.
          for (const ordId of orderIds) {
            await recalculateAndUpdateOrderPaymentStatus(ordId);
          }
        } catch (e) {
          console.error(`Order sync failed for bill ${billSerial}:`, e);
          orderSyncFailed = true;
        }
      }
    }

    operation.finish("Payment saved and confirmed by the server.");
    closePaymentModal(true);
    if (orderSyncFailed) {
      Swal.fire(
        "Payment Saved",
        "Payment aur balance safely save ho gaya. Lekin linked order ka status Order Book mein sync nahi ho paya — please check manually.",
        "warning"
      );
    } else {
      Swal.fire("Success!", "Payment entry has been saved.", "success");
    }
    showCustomerLedger(currentCustomer);
  } catch (error) {
    console.error("Error saving payment:", error);
    hideLoading();
    if (committed) {
      operation.finish("Payment saved; the display needs refreshing.", "warning");
      closePaymentModal(true);
      Swal.fire("Payment saved", "The payment is saved but a follow-up failed. Refresh the ledger; do not enter it again.", "warning");
    } else {
      operation.fail(error);
      Swal.fire("Payment not confirmed", error.code ? MandiFormSafety.errorMessage(error) : error.message, "error");
    }
  } finally {
    hideLoading();

    operation.finish("Save finished. Review the ledger.", "warning");
  }
}
function printLedger() {
  const dateRange = appliedPeriodLabel;

  let tableRowsHtml = "";
  ledgerAsTableData.forEach((row) => {
    const isOpening = row.Particulars.includes("Opening Balance");
    tableRowsHtml += `
        <tr class="${isOpening ? "opening-balance-row" : ""}">
          <td>${row.Date}</td>
          <td>${escapeHtml(row.Particulars)}</td>
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
let paymentReversalBusy = false;
window.reversePaymentEntry = async function (paymentId) {
  if (paymentReversalBusy) return;
  if (!hasRole("admin", "accountant")) {
    await Swal.fire("Access required", "Only an Admin or Accountant can reverse a payment.", "info");
    return;
  }
  const entry = allTransactions.find(tx => tx.id === paymentId && tx.type === "payment" && !tx.reversed);
  if (!entry) return;
  paymentReversalBusy = true;
  try {
  const confirm = await Swal.fire({
    title: `Reverse ₹${Number(entry.credit).toLocaleString("en-IN", { minimumFractionDigits: 2 })} payment?`,
    text: "This cancels the payment's effect and increases the balance due. The original payment and correction will both remain in history.",
    input: "text",
    inputPlaceholder: "Reason, e.g. payment entered by mistake",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Reverse payment",
    confirmButtonColor: "#dc3545",
    cancelButtonColor: "#6c757d",
    preConfirm: (inputValue) => {
      if (!inputValue || inputValue.trim().length < 3 || inputValue.trim().length > 500) {
        Swal.showValidationMessage("Enter a correction reason (3–500 characters).");
        return false;
      }
      return inputValue;
    },
  });

  if (!confirm.isConfirmed) return;

  showLoading("Reversing payment...");
  let orderSyncFailed = false;
  try {
    const affectedBillSerials = new Set();
    const directOrderIds = new Set();
    const correction = await MandiPaymentReversal.reverse({
      db, paymentId, reason: confirm.value, uid: firebase.auth().currentUser?.uid,
      timestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (correction.orderId) directOrderIds.add(correction.orderId);
    else if (correction.billSerial) affectedBillSerials.add(correction.billSerial);

    // Order-status recalculation — same visible-failure treatment as
    // savePayment() instead of a silent console.warn.
    for (const orderId of directOrderIds) {
      try { await recalculateAndUpdateOrderPaymentStatus(orderId); }
      catch (error) { console.error("Linked order reversal sync failed:", error); orderSyncFailed = true; }
    }
    for (const billSerial of affectedBillSerials) {
      try {
        const matchingOrders = await db.collection("orders").where("linkedBillNo", "==", billSerial).get();
        const matchingOrdersArray = await db
          .collection("orders")
          .where("linkedBillNos", "array-contains", billSerial)
          .get();
        const orderIds = new Set([
          ...matchingOrders.docs.map((d) => d.id),
          ...matchingOrdersArray.docs.map((d) => d.id),
        ]);
        for (const ordId of orderIds) {
          await recalculateAndUpdateOrderPaymentStatus(ordId);
        }
      } catch (err) {
        console.error(`Order recalculate mein dikkat (bill ${billSerial}):`, err);
        orderSyncFailed = true;
      }
    }

    hideLoading();
    if (orderSyncFailed) {
      Swal.fire(
        "Payment reversed",
        "Payment correction was saved. The linked order's payment status still needs refreshing. Do not enter the correction again.",
        "warning"
      );
    } else {
      Swal.fire(correction.alreadyReversed ? "Already reversed" : "Payment reversed",
        correction.alreadyReversed ? "This payment was already corrected; no duplicate correction was created."
          : "Balance updated. The original payment and reversal are both preserved in history.", "success");
    }

    // Ledger ko refresh karke wapas load karo
    showCustomerLedger(currentCustomer);
  } catch (error) {
    console.error("Error reversing payment:", error);
    hideLoading();
    Swal.fire("Payment reversal was not saved",
      error.code === "permission-denied"
        ? "Your account or the deployed Firebase rules do not allow this correction yet. Ask the Admin to check reversal access."
        : error.message || "Could not reverse payment. Refresh the ledger before retrying.", "error");
  }
  } finally { paymentReversalBusy = false; }
};
// Payment delete hone ke baad order ka status wapas update karne ke liye:

// 🔄 Order ke saare linked bills ko check karke sahi payment status calculate karne ka function
async function recalculateAndUpdateOrderPaymentStatus(orderId) {
  if (!orderId) return;
  if (!window.MandiOrderSync) throw new Error("Order sync module is unavailable. Reload before retrying.");
  // Only paymentStatus/updatedAt are written: accountant permissions stay intact.
  // Let failures reach the caller's already-saved warning, never report false success.
  return MandiOrderSync.sync(orderId);
}
