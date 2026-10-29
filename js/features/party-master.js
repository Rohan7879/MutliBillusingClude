let partiesList = [];
let billsSummaryMap = {}; // Feature 5: Party-wise bill counts
let brokerBalances = {};
let brokerBalancesLoaded = false;
let currentFilterType = "All";

const partyText = (value) => String(value || "").trim();
const partyKey = (value) => partyText(value).toLowerCase();
const mobileDigits = (value) => {
  const digits = partyText(value).replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
};
const isValidIndianMobile = (value) => /^[6-9]\d{9}$/.test(value) && !/^(\d)\1{9}$/.test(value);

function updatePartyOverview() {
  const total = partiesList.length;
  const countByType = (type) => partiesList.filter((party) => partyText(party.type) === type).length;
  const setText = (id, value) => {
    const target = document.getElementById(id);
    if (target) target.textContent = String(value);
  };
  setText("partyCountAll", total);
  setText("partyCountFarmers", countByType("Farmer"));
  setText("partyCountBrokers", countByType("Broker"));
  setText("partyCountBlacklisted", partiesList.filter((party) => party.isBlacklisted === true).length);
}

function setPartySyncStatus(message, isError = false) {
  const status = document.getElementById("partySyncStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("text-red-100", isError);
  status.classList.toggle("border-red-300/40", isError);
}

document.addEventListener("DOMContentLoaded", async () => {
  await fetchBillsSummary(); // Fetch bills first to calculate summary badges
  fetchParties();

  const partyTypeSelect = document.getElementById("partyType");
  const commContainer = document.getElementById("commFieldContainer");

  partyTypeSelect.addEventListener("change", function () {
    if (this.value === "Broker") {
      commContainer.style.display = "block";
    } else {
      commContainer.style.display = "none";
      document.getElementById("partyComm").value = "";
    }
  });

  // Broker directory links here instead of creating a separate name-only record.
  if (new URLSearchParams(window.location.search).get("type") === "Broker") {
    partyTypeSelect.value = "Broker";
    partyTypeSelect.dispatchEvent(new Event("change"));
    document.getElementById("partyName").focus();
  }

  document.getElementById("partyForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    await saveParty();
  });

  document.getElementById("searchInput").addEventListener("input", renderFilteredTable);
  document.getElementById("cancelBtn").addEventListener("click", resetForm);
});

// Feature 5: Calculate bill count for each party from Firestore. Balance
// itself is NOT recomputed here anymore — see the fix note in drawTable()
// below for why.
async function fetchBillsSummary() {
  try {
    const snap = await db.collection("bills").get();
    billsSummaryMap = {};
    brokerBalances = {};
    brokerBalancesLoaded = false;
    snap.forEach((doc) => {
      const data = doc.data();
      if (data.deleted === true) return;

      const cust = data["Customer Name"] || data.customer_name;
      if (cust) {
        const key = partyKey(cust);
        billsSummaryMap[key] = (billsSummaryMap[key] || 0) + 1;
      }
      const brk = data["Broker"] || data.broker;
      if (brk) {
        const key = partyKey(brk);
        billsSummaryMap[key] = (billsSummaryMap[key] || 0) + 1;
        brokerBalances[key] = (brokerBalances[key] || 0) + Number(data.BrokerCommission || 0);
      }
    });
    const payouts = await db.collection("broker_payments").get();
    payouts.forEach(doc => {
      const payment = doc.data();
      if (payment.deleted === true) return;
      const key = partyKey(payment.brokerName);
      brokerBalances[key] = (brokerBalances[key] || 0) - Number(payment.amount || 0);
    });
    brokerBalancesLoaded = true;
  } catch (e) {
    console.warn("Could not fetch bills summary:", e);
  }
}

window.applyTypeFilter = function (type, btnElement) {
  currentFilterType = type;
  document.querySelectorAll(".filter-badge").forEach((btn) => {
    btn.classList.remove("is-active");
  });
  btnElement.classList.add("is-active");
  renderFilteredTable();
};

async function saveParty() {
  const form = document.getElementById("partyForm");
  const partyId = document.getElementById("partyId")?.value || (form ? form.dataset.editId : "") || "";

  const partyType = document.getElementById("partyType")?.value || "";
  const partyName = document.getElementById("partyName")?.value?.trim()?.toUpperCase() || "";
  const partyPhone = mobileDigits(document.getElementById("partyPhone")?.value);
  const partyAltPhone = mobileDigits(document.getElementById("partyAltPhone")?.value);
  const partyGst = document.getElementById("partyGst")?.value?.trim()?.toUpperCase() || "";
  const partyVillage = document.getElementById("partyAddress")?.value?.trim()?.toUpperCase() || "";

  if (!partyName) {
    return Swal.fire("Error", "Party name is required.", "error");
  }
  if (!partyVillage) {
    return Swal.fire("Village Required", "Party save karne ke liye Village / City mandatory hai.", "error");
  }
  if (!isValidIndianMobile(partyPhone)) {
    return Swal.fire("Invalid mobile", "Enter a valid 10-digit Indian mobile number starting with 6–9.", "error");
  }
  if (partyAltPhone && !isValidIndianMobile(partyAltPhone)) {
    return Swal.fire("Invalid alternate mobile", "Alternate mobile must be a valid 10-digit Indian mobile number.", "error");
  }
  if (partyAltPhone && partyAltPhone === partyPhone) {
    return Swal.fire("Duplicate number", "Primary and alternate mobile numbers cannot be the same.", "error");
  }

  // ── Duplicate Checks (Current editing ID ko ignore karega taaki self-duplicate error na aaye) ──
  let nameTypeExists = partiesList.find(
    (p) => p.id !== partyId && partyText(p.name).toUpperCase() === partyName && partyText(p.type) === partyType
  );
  if (nameTypeExists) {
    return Swal.fire("Duplicate Entry", `"${partyName}" is already registered as a ${partyType}.`, "error");
  }

  // A contact number belongs to exactly one party, regardless of party type.
  // Existing records are normalised before comparing, so old formatting cannot
  // accidentally bypass this check.
  const numbersToCheck = [partyPhone, partyAltPhone].filter(Boolean);
  const duplicatePhoneParty = partiesList.find((p) => {
    if (p.id === partyId) return false;
    const existingNumbers = [mobileDigits(p.phone), mobileDigits(p.altPhone)].filter(Boolean);
    return numbersToCheck.some((number) => existingNumbers.includes(number));
  });
  if (duplicatePhoneParty) {
    return Swal.fire(
      "Number already in use",
      `This mobile number is already registered under ${partyText(duplicatePhoneParty.name) || "another party"}.`,
      "error"
    );
  }

  if (partyGst) {
    let gstExists = partiesList.find((p) => p.id !== partyId && partyText(p.gst).toUpperCase() === partyGst);
    if (gstExists) {
      return Swal.fire("Duplicate GST", `This GSTIN is already registered for ${gstExists.name}.`, "error");
    }
  }

  const partyData = {
    type: partyType,
    name: partyName,
    munimName: document.getElementById("partyMunim")?.value?.trim()?.toUpperCase() || "",
    phone: partyPhone,
    altPhone: partyAltPhone,
    address: partyVillage,
    gst: partyGst,
    defaultComm: partyType === "Broker" ? parseFloat(document.getElementById("partyComm")?.value) || 0 : 0,
    creditLimit: parseFloat(document.getElementById("partyCreditLimit")?.value) || 0,
    opBal: parseFloat(document.getElementById("partyOpBal")?.value) || 0,
    opBalType: document.getElementById("partyOpBalType")?.value || "Cr",
    bankAcc: document.getElementById("partyBankAcc")?.value?.trim() || "",
    ifsc: document.getElementById("partyIfsc")?.value?.trim()?.toUpperCase() || "",
    isBlacklisted: document.getElementById("partyBlacklist")?.checked || false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add("opacity-70", "cursor-wait");
    }
    if (partyId) {
      // ✏️ Update Existing Party
      await db.collection("parties").doc(partyId).update(partyData);
      Swal.fire({
        icon: "success",
        title: "Updated!",
        text: "Party details updated successfully.",
        timer: 1500,
        showConfirmButton: false,
      });
    } else {
      // ➕ Create New Party
      partyData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection("parties").add(partyData);
      Swal.fire({
        icon: "success",
        title: "Added!",
        text: "New party added successfully.",
        timer: 1500,
        showConfirmButton: false,
      });
    }

    // Form Reset & UI cleanup
    if (form) {
      form.reset();
      delete form.dataset.editId;
    }
    const commFieldContainer = document.getElementById("commFieldContainer");
    if (commFieldContainer) commFieldContainer.style.display = "none";
    const partyIdInput = document.getElementById("partyId");
    if (partyIdInput) partyIdInput.value = "";

    const formTitle = document.getElementById("formTitle");
    if (formTitle) formTitle.innerText = "Add a party";

    if (saveBtn) saveBtn.innerText = "Save Party";

    const cancelBtn = document.getElementById("cancelBtn");
    if (cancelBtn) cancelBtn.classList.add("hidden");

    if (typeof fetchParties === "function") await fetchParties();
  } catch (err) {
    console.error("Error saving party:", err);
    Swal.fire("Error", "Could not save party. Please try again.", "error");
  } finally {
    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.classList.remove("opacity-70", "cursor-wait");
    }
  }
}

async function fetchParties() {
  const tbody = document.getElementById("partyTableBody");
  tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Fetching records...</td></tr>`;

  try {
    const querySnapshot = await db.collection("parties").get();
    partiesList = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.deleted !== true) {
        partiesList.push({ id: docSnap.id, ...data });
      }
    });
    updatePartyOverview();
    setPartySyncStatus(`Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    renderFilteredTable();
  } catch (error) {
    console.error("Error fetching parties: ", error);
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Database Error.</td></tr>`;
    updatePartyOverview();
    setPartySyncStatus("Could not check records", true);
  }
}

function renderFilteredTable() {
  const query = partyKey(document.getElementById("searchInput")?.value);
  const filtered = partiesList.filter((p) => {
    const matchesSearch =
      partyKey(p.name).includes(query) ||
      partyKey(p.phone).includes(query) ||
      partyKey(p.altPhone).includes(query) ||
      partyKey(p.munimName).includes(query) ||
      partyKey(p.address).includes(query) ||
      partyKey(p.gst).includes(query);
    const matchesType = currentFilterType === "All" ? true : partyText(p.type) === currentFilterType;
    return matchesSearch && matchesType;
  });
  drawTable(filtered);
}

function drawTable(data) {
  const tbody = document.getElementById("partyTableBody");
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">No parties found.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map((rawParty) => {
      // Table cells are built with a template string, so escape every
      // user-controlled display field before inserting it into HTML.
      const p = {
        ...rawParty,
        type: escapeHtml(rawParty.type),
        name: escapeHtml(rawParty.name),
        munimName: escapeHtml(rawParty.munimName),
        address: escapeHtml(rawParty.address),
        gst: escapeHtml(rawParty.gst),
        phone: escapeHtml(rawParty.phone),
        altPhone: escapeHtml(rawParty.altPhone),
        bankAcc: escapeHtml(rawParty.bankAcc),
      };
      let flagTag = p.isBlacklisted
        ? `<span class="px-1.5 py-0.5 ml-2 bg-red-100 text-red-700 text-[10px] font-bold rounded">🚩 DEFAULTER</span>`
        : "";
      // Live balance: read currentBalance directly — this is the single
      // field every payment/bill transaction (savePayment, bill create/
      // edit, bulk mark-paid, delete/restore) keeps authoritative via
      // Firestore transactions. Previously this page re-summed every bill
      // and payment in the whole system from scratch on every load AND
      // only did so for type Farmer/Vepari — any other billable type
      // (Customer/Buyer/Supplier/Kisan, which bill-form.js's own customer-
      // matching logic treats as billable) was stuck showing the static
      // opening balance forever, never reflecting real payment activity.
      const billableTypes = ["farmer", "vepari", "kisan", "customer", "buyer", "supplier"];
      const hasLiveLedgerBalance = billableTypes.includes((rawParty.type || "").toLowerCase());
      const isBrokerParty = partyKey(rawParty.type) === "broker";
      const balanceToShow = isBrokerParty ? (brokerBalances[partyKey(rawParty.name)] || 0) : hasLiveLedgerBalance ? Number(rawParty.currentBalance || 0) : Number(rawParty.opBal || 0);
      const balColor = balanceToShow > 0 ? "text-red-600" : "text-green-600";
      const balAmount = isBrokerParty
        ? (brokerBalancesLoaded ? `₹${Math.abs(balanceToShow).toLocaleString("en-IN")} <span class="text-[10px]">${balanceToShow > 0 ? "Payable (dene hain)" : balanceToShow < 0 ? "Advance paid" : "Settled"}</span>` : "Unavailable — open Broker Khata")
        : balanceToShow !== 0
          ? `₹${Math.abs(balanceToShow).toLocaleString("en-IN")} <span class="text-[10px]">${
              balanceToShow > 0 ? "Dr" : "Cr"
            }</span>`
          : "-";

      // Feature 5: Business Summary Badge (Total bills linked)
      let totalBills = billsSummaryMap[partyKey(rawParty.name)] || 0;
      let summaryBadge =
        totalBills > 0
          ? `<span class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded">🧾 ${totalBills} Bills</span>`
          : `<span class="text-[10px] text-slate-400">No bills yet</span>`;

      // 🔗 NAYA LOGIC: Broker hai toh alag link, Farmer hai toh alag link
      let actionLink = "";
      if (p.type === "Broker") {
        actionLink = `<a href="broker-ledger.html?name=${encodeURIComponent(
          rawParty.name || ""
        )}" class="inline-block text-blue-600 hover:text-blue-800 p-1 font-bold text-xs bg-blue-50 rounded px-2 mb-1">🤝 Broker Khata</a>`;
      } else {
        actionLink = `<a href="ledger.html?id=${p.id || p.customerId || ""}&name=${encodeURIComponent(
          rawParty.name || ""
        )}" class="inline-block text-purple-600 hover:text-purple-800 p-1 font-bold text-xs bg-purple-50 rounded px-2 mb-1">📒 Ledger</a>`;
      }

      return `
      <tr class="border-b hover:bg-blue-50/60 transition cursor-pointer ${
        p.isBlacklisted ? "bg-red-50/30" : ""
      }" onclick="if(event.target.tagName !== 'BUTTON' && event.target.tagName !== 'A' && event.target.tagName !== 'I') { showPartyDetailsModal('${
        p.id
      }') }">
          <td class="p-3">
              <span class="inline-block px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-600 mb-1">${
                p.type
              }</span>
              <div class="font-bold text-slate-900 flex items-center">${p.name} ${flagTag}</div>
              ${p.munimName ? `<div class="text-[11px] text-slate-500 font-medium">👤 Munim: ${p.munimName}</div>` : ""}
              <div class="text-xs text-slate-500 font-medium mt-0.5">📍 ${p.address || "No Village"}</div>
              ${p.gst ? `<div class="text-[11px] text-slate-400 mt-0.5">GST: ${p.gst}</div>` : ""}
          </td>
          <td class="p-3">
              <div class="font-medium text-slate-700 text-sm mb-1 flex items-center gap-2">
                 📞 ${p.phone || "Not added"}
                 ${isValidIndianMobile(mobileDigits(rawParty.phone)) ? `<a href="https://wa.me/91${mobileDigits(rawParty.phone)}" target="_blank" rel="noopener" class="text-green-600 hover:text-green-700 text-xs font-bold bg-green-50 px-1.5 py-0.5 rounded">WhatsApp</a>` : ""}
              </div>
              ${p.altPhone ? `<div class="text-xs text-slate-500 mb-1">📞 Alt: ${p.altPhone}</div>` : ""}
              ${p.bankAcc ? `<div class="text-[11px] text-slate-500">🏦 A/c: ${p.bankAcc}</div>` : ""}
          </td>
          <td class="p-3">
              <div class="font-bold text-sm ${balColor}">Bal: ${balAmount}</div>
              <div class="mt-1">${summaryBadge}</div>
              ${
                p.type === "Broker" && p.defaultComm
                  ? `<div class="text-[11px] text-blue-600 font-semibold mt-0.5">Comm: ₹${p.defaultComm}/bag</div>`
                  : ""
              }
              ${
                p.creditLimit
                  ? `<div class="text-[11px] text-orange-600 mt-0.5">Limit: ₹${p.creditLimit.toLocaleString(
                      "en-IN"
                    )}</div>`
                  : ""
              }
          </td>
          <td class="p-3 text-center">
              <!-- Direct Ledger/Broker Shortcut Link -->
              ${actionLink}
              <div class="flex justify-center gap-1 mt-1">
                  <button onclick="editParty('${
                    p.id
                  }')" class="text-blue-600 hover:text-blue-800 p-1 font-bold text-xs bg-blue-50 rounded px-2">Edit</button>
                  <span title="Party records are retained to protect linked history" class="text-slate-500 p-1 text-xs">🔒 Protected</span>
              </div>
          </td>
      </tr>
  `;
    })
    .join("");
}
window.editParty = function (id) {
  const form = document.getElementById("partyForm");
  if (form) {
    form.dataset.editId = id; // Form par ID set kar rahe hain taaki save ke waqt pata chale
  }

  const partyIdInput = document.getElementById("partyId");
  if (partyIdInput) {
    partyIdInput.value = id;
  }

  // Global list se party data dhoondhein
  const p = partiesList.find((party) => party.id === id);
  if (!p) {
    console.warn("Party not found in list for editing.");
    return;
  }

  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) el.value = val;
  };

  const setCheck = (elId, checked) => {
    const el = document.getElementById(elId);
    if (el) el.checked = checked;
  };

  const commContainer = document.getElementById("commFieldContainer");
  if (commContainer) {
    if (p.type === "Broker") {
      commContainer.style.display = "block";
      setVal("partyComm", p.defaultComm || "");
    } else {
      commContainer.style.display = "none";
      setVal("partyComm", "");
    }
  }

  setVal("partyType", p.type || "Kisan (Farmer)");
  setVal("partyName", p.name || "");
  setVal("partyMunim", p.munimName || "");
  setVal("partyPhone", p.phone || "");
  setVal("partyAltPhone", p.altPhone || "");
  setVal("partyAddress", p.address || "");
  setVal("partyGst", p.gst || "");
  setVal("partyCreditLimit", p.creditLimit || "");
  setVal("partyOpBal", p.opBal || "");
  setVal("partyOpBalType", p.opBalType || "Cr");
  setVal("partyBankAcc", p.bankAcc || "");
  setVal("partyIfsc", p.ifsc || "");
  setCheck("partyBlacklist", p.isBlacklisted || false);

  const formTitle = document.getElementById("formTitle");
  if (formTitle) formTitle.innerText = "Edit party details";

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.innerText = "Update Party";

  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
};
function resetForm() {
  const form = document.getElementById("partyForm");
  form.reset();
  delete form.dataset.editId;
  document.getElementById("partyId").value = "";
  document.getElementById("commFieldContainer").style.display = "none";
  document.getElementById("formTitle").innerText = "Add a party";
  document.getElementById("saveBtn").innerText = "Save Party";
  document.getElementById("cancelBtn").classList.add("hidden");
}

// Feature 1: Excel Import Utility (Bulk Upload)
// 🔥 FULLY VALIDATED EXCEL IMPORT UTILITY
window.importPartiesExcel = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json(worksheet);

      if (jsonRows.length === 0) {
        return Swal.fire("Empty File", "No records found in the uploaded Excel file.", "warning");
      }

      let importedCount = 0;
      let skippedCount = 0;

      Swal.fire({
        title: "Importing & Validating...",
        text: "Checking phone numbers, GSTIN and duplicates...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
      });

      for (let row of jsonRows) {
        const type = partyText(row["Type"] || row["type"] || "Farmer");
        const name = partyText(row["Name"] || row["name"] || "").toUpperCase();
        const munimName = partyText(row["Munim / Ref"] || row["munimName"] || "").toUpperCase();
        const phone = mobileDigits(row["Mobile"] || row["mobile"] || row["Phone"] || "");
        const altPhone = mobileDigits(row["Alt Mobile"] || row["alt_mobile"] || "");
        const village = partyText(row["Village"] || row["village"] || row["Address"] || "").toUpperCase();
        const gstin = partyText(row["GSTIN"] || row["gst"] || "").toUpperCase();
        const defaultComm = parseFloat(row["Default Comm."] || row["defaultComm"] || 0) || 0;
        const creditLimit = parseFloat(row["Credit Limit"] || row["creditLimit"] || 0) || 0;
        const opBal = parseFloat(row["Opening Balance"] || row["opBal"] || 0) || 0;
        let opBalType = String(row["Dr/Cr"] || row["opBalType"] || "Cr")
          .trim()
          .toUpperCase();
        opBalType = opBalType === "DR" ? "Dr" : "Cr";

        // 1. Name Check
        if (!name) {
          skippedCount++;
          continue;
        }

        // 2. Primary Mobile Strict Validation (10 digits, starts with 6-9, not repeating)
        if (!isValidIndianMobile(phone) || (altPhone && (!isValidIndianMobile(altPhone) || altPhone === phone))) {
          skippedCount++;
          continue;
        }

        // 3. GSTIN Format Validation (if provided)
        if (gstin) {
          const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
          if (!gstinRegex.test(gstin)) {
            skippedCount++;
            continue;
          }
        }

        // 4. Batch Duplicate Checks. Contact numbers remain unique across all
        // party types, not only within Farmer/Broker/Buyer categories.
        let nameTypeExists = partiesList.find((p) => partyText(p.name).toUpperCase() === name && partyText(p.type) === type);
        let phoneExists = partiesList.find((p) => {
          const existingNumbers = [mobileDigits(p.phone), mobileDigits(p.altPhone)].filter(Boolean);
          return [phone, altPhone].filter(Boolean).some((number) => existingNumbers.includes(number));
        });
        let gstExists = gstin ? partiesList.find((p) => partyText(p.gst).toUpperCase() === gstin) : null;

        if (nameTypeExists || phoneExists || gstExists) {
          skippedCount++; // Duplicate mila toh skip kar do
          continue;
        }

        // Valid Record Payload
        const newParty = {
          type: ["Farmer", "Broker", "Buyer", "Vepari"].includes(type) ? type : "Farmer",
          name: name,
          munimName: munimName,
          phone: phone,
          altPhone: altPhone,
          address: village,
          gst: gstin,
          defaultComm: type === "Broker" ? defaultComm : 0,
          creditLimit: creditLimit,
          opBal: opBal,
          opBalType: opBalType,
          bankAcc: "",
          ifsc: "",
          isBlacklisted: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          deleted: false,
        };

        const created = await db.collection("parties").add(newParty);
        // Locally push karein taaki agar Excel mein hi same kisan 2 baar ho, toh doosri baar wo detect ho jaye
        partiesList.push({ id: created.id, ...newParty });
        importedCount++;
      }

      document.getElementById("excelFile").value = "";
      await fetchParties();
      Swal.fire(
        "Import Complete!",
        `Successfully imported ${importedCount} valid parties. (Skipped invalid/duplicates: ${skippedCount})`,
        "success"
      );
    } catch (err) {
      console.error("Excel import error:", err);
      Swal.fire("Error", "Failed to parse Excel file. Make sure columns match export headers.", "error");
    }
  };
  reader.readAsArrayBuffer(file);
};

window.exportPartiesExcel = function () {
  if (partiesList.length === 0) return Swal.fire("No Data", "No parties found to export.", "info");

  const excelData = partiesList.map((p) => ({
    Type: p.type,
    Name: p.name,
    "Munim / Ref": p.munimName || "",
    Mobile: p.phone,
    "Alt Mobile": p.altPhone || "",
    Village: p.address || "",
    GSTIN: p.gst || "",
    "Default Comm.": p.defaultComm || 0,
    "Credit Limit": p.creditLimit || 0,
    "Opening Balance": p.opBal ? `${p.opBal} ${p.opBalType}` : "0",
    "Bank A/C": p.bankAcc || "",
    IFSC: p.ifsc || "",
    Defaulter: p.isBlacklisted ? "YES" : "NO",
  }));

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Parties Directory");
  XLSX.writeFile(workbook, "MandiBook_Parties_Master.xlsx");
  Swal.fire("Success", "Parties exported to Excel successfully!", "success");
};

// Keep stale callers safe: directory records are retained for linked history.
window.deleteParty = async function () {
  return Swal.fire("Party protected", "Party deletion is disabled to protect bills, orders and payment history. You can edit its details.", "info");
};
async function handleDeleteParty() {
  return window.deleteParty();
}
// 🌟 1. Party Row Click karne par Popup Modal dikhane ka function
window.showPartyDetailsModal = function (id) {
  const p = partiesList.find((x) => x.id === id);
  if (!p) return;

  const safe = {
    name: escapeHtml(p.name),
    type: escapeHtml(p.type),
    phone: escapeHtml(p.phone),
    altPhone: escapeHtml(p.altPhone),
    address: escapeHtml(p.address),
    munimName: escapeHtml(p.munimName),
    bankAcc: escapeHtml(p.bankAcc),
    ifsc: escapeHtml(p.ifsc),
    gst: escapeHtml(p.gst),
  };

  const balanceType = p.opBalType || "Cr";
  const balColorClass = balanceType === "Dr" ? "text-red-600" : "text-green-600";

  Swal.fire({
    title: `<span class="text-slate-800 text-lg font-bold">👤 ${safe.name}</span>`,
    html: `
      <div class="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm space-y-2.5">
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Type:</span> <span class="font-bold text-blue-600">${
          safe.type
        }</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Mobile:</span> <span class="font-bold">${
          safe.phone
        } ${p.altPhone ? "/ " + safe.altPhone : ""}</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Village / Address:</span> <span class="font-bold">${
          safe.address || "N/A"
        }</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Munim Name:</span> <span class="font-bold">${
          safe.munimName || "N/A"
        }</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Opening Balance:</span> <span class="font-bold ${balColorClass}">₹${
      p.opBal || 0
    } (${balanceType})</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Credit Limit:</span> <span class="font-bold text-orange-600">₹${
          p.creditLimit || 0
        }</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">Bank A/C Number:</span> <span class="font-bold">${
          safe.bankAcc || "N/A"
        }</span></div>
        <div class="flex justify-between border-b pb-1.5"><span class="text-slate-500 font-medium">IFSC Code:</span> <span class="font-bold uppercase">${
          safe.ifsc || "N/A"
        }</span></div>
        <div class="flex justify-between"><span class="text-slate-500 font-medium">GSTIN:</span> <span class="font-bold uppercase">${
          safe.gst || "N/A"
        }</span></div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: "💬 Share via WhatsApp",
    confirmButtonColor: "#16a34a", // Green WhatsApp color
    cancelButtonText: "Close",
    cancelButtonColor: "#64748b",
    width: "450px",
  }).then((result) => {
    if (result.isConfirmed) {
      sharePartyDetails(p);
    }
  });
};

// 💬 2. WhatsApp par formatted text bhejne ka function
window.sharePartyDetails = function (p) {
  const balanceType = p.opBalType || "Cr";
  const text = `📋 *Party Details - MandiBook*
----------------------------------
*Name:* ${p.name}
*Village:* ${p.address || "N/A"}
*Mobile:* ${p.phone}
*Type:* ${p.type}
*Balance:* ₹${p.opBal || 0} (${balanceType})
*Bank A/C:* ${p.bankAcc || "N/A"} (${p.ifsc || "N/A"})
----------------------------------
*Ganesh Agri Industries*`;

  const encodedText = encodeURIComponent(text);
  const whatsappUrl = `https://wa.me/91${p.phone}?text=${encodedText}`;
  window.open(whatsappUrl, "_blank");
};
