let partiesList = [];
let billsSummaryMap = {}; // Feature 5: Party-wise bill counts
let currentFilterType = "All";

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

  document.getElementById("partyForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    await saveParty();
  });

  document.getElementById("searchInput").addEventListener("input", renderFilteredTable);
  document.getElementById("cancelBtn").addEventListener("click", resetForm);
});

// Feature 5: Calculate bill count and business stats for each party from Firestore
async function fetchBillsSummary() {
  try {
    const snap = await db.collection("bills").get();
    billsSummaryMap = {};
    snap.forEach((doc) => {
      const data = doc.data();
      if (data.deleted === true) return;

      // Count for customer/farmer
      const cust = data["Customer Name"] || data.customer_name;
      if (cust) {
        billsSummaryMap[cust] = (billsSummaryMap[cust] || 0) + 1;
      }
      // Count for broker
      const brk = data["Broker"] || data.broker;
      if (brk) {
        billsSummaryMap[brk] = (billsSummaryMap[brk] || 0) + 1;
      }
    });
  } catch (e) {
    console.warn("Could not fetch bills summary:", e);
  }
}

window.applyTypeFilter = function (type, btnElement) {
  currentFilterType = type;
  document.querySelectorAll(".filter-badge").forEach((btn) => {
    btn.classList.remove("bg-slate-800", "text-white");
    btn.classList.add("bg-slate-100", "text-slate-600");
  });
  btnElement.classList.remove("bg-slate-100", "text-slate-600");
  btnElement.classList.add("bg-slate-800", "text-white");
  renderFilteredTable();
};

async function saveParty() {
  const form = document.getElementById("partyForm");
  const partyId = document.getElementById("partyId")?.value || (form ? form.dataset.editId : "") || "";

  const partyType = document.getElementById("partyType")?.value || "";
  const partyName = document.getElementById("partyName")?.value?.trim()?.toUpperCase() || "";
  const partyPhone = document.getElementById("partyPhone")?.value?.trim() || "";
  const partyAltPhone = document.getElementById("partyAltPhone")?.value?.trim() || "";
  const partyGst = document.getElementById("partyGst")?.value?.trim()?.toUpperCase() || "";

  if (!partyName) {
    return Swal.fire("Error", "Party name is required.", "error");
  }

  // ── Duplicate Checks (Current editing ID ko ignore karega taaki self-duplicate error na aaye) ──
  let nameTypeExists = partiesList.find((p) => p.id !== partyId && p.name === partyName && p.type === partyType);
  if (nameTypeExists) {
    return Swal.fire("Duplicate Entry", `"${partyName}" is already registered as a ${partyType}.`, "error");
  }

  if (partyPhone) {
    let phoneTypeExists = partiesList.find(
      (p) => p.id !== partyId && (p.phone === partyPhone || p.altPhone === partyPhone) && p.type === partyType
    );
    if (phoneTypeExists) {
      return Swal.fire(
        "Duplicate Number",
        `Mobile number ${partyPhone} is already registered under ${phoneTypeExists.name}.`,
        "error"
      );
    }
  }

  if (partyGst) {
    let gstExists = partiesList.find((p) => p.id !== partyId && p.gst === partyGst);
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
    address: document.getElementById("partyAddress")?.value?.trim()?.toUpperCase() || "",
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
    const partyIdInput = document.getElementById("partyId");
    if (partyIdInput) partyIdInput.value = "";

    const formTitle = document.getElementById("formTitle");
    if (formTitle) formTitle.innerText = "+ Add New Party";

    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) saveBtn.innerText = "Save Party";

    const cancelBtn = document.getElementById("cancelBtn");
    if (cancelBtn) cancelBtn.classList.add("hidden");

    if (typeof fetchParties === "function") {
      fetchParties();
    }
  } catch (err) {
    console.error("Error saving party:", err);
    Swal.fire("Error", "Could not save party. Please try again.", "error");
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
    renderFilteredTable();
  } catch (error) {
    console.error("Error fetching parties: ", error);
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Database Error.</td></tr>`;
  }
}

function renderFilteredTable() {
  const query = document.getElementById("searchInput").value.toLowerCase();
  const filtered = partiesList.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(query) ||
      p.phone.includes(query) ||
      (p.altPhone && p.altPhone.includes(query)) ||
      (p.munimName && p.munimName.toLowerCase().includes(query)) ||
      (p.address && p.address.toLowerCase().includes(query));
    const matchesType = currentFilterType === "All" ? true : p.type === currentFilterType;
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
    .map((p) => {
      let flagTag = p.isBlacklisted
        ? `<span class="px-1.5 py-0.5 ml-2 bg-red-100 text-red-700 text-[10px] font-bold rounded">🚩 DEFAULTER</span>`
        : "";
      let balColor = p.opBalType === "Dr" ? "text-red-600" : "text-green-600";
      let balAmount =
        p.opBal > 0 ? `₹${p.opBal.toLocaleString("en-IN")} <span class="text-[10px]">${p.opBalType}</span>` : "-";

      // Feature 5: Business Summary Badge (Total bills linked)
      let totalBills = billsSummaryMap[p.name] || 0;
      let summaryBadge =
        totalBills > 0
          ? `<span class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded">🧾 ${totalBills} Bills</span>`
          : `<span class="text-[10px] text-slate-400">No bills yet</span>`;

      // 🔗 NAYA LOGIC: Broker hai toh alag link, Farmer hai toh alag link
      let actionLink = "";
      if (p.type === "Broker") {
        actionLink = `<a href="broker-ledger.html?name=${encodeURIComponent(
          p.name
        )}" class="inline-block text-blue-600 hover:text-blue-800 p-1 font-bold text-xs bg-blue-50 rounded px-2 mb-1">🤝 Broker Khata</a>`;
      } else {
        actionLink = `<a href="ledger.html?id=${p.id || p.customerId || ""}&name=${encodeURIComponent(
          p.name
        )}" class="inline-block text-purple-600 hover:text-purple-800 p-1 font-bold text-xs bg-purple-50 rounded px-2 mb-1">📒 Ledger</a>`;
      }

      return `
        <tr class="border-b hover:bg-slate-50 transition ${p.isBlacklisted ? "bg-red-50/30" : ""}">
            <td class="p-3">
                <span class="inline-block px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-600 mb-1">${
                  p.type
                }</span>
                <div class="font-bold text-slate-900 flex items-center">${p.name} ${flagTag}</div>
                ${
                  p.munimName
                    ? `<div class="text-[11px] text-slate-500 font-medium">👤 Munim: ${p.munimName}</div>`
                    : ""
                }
                <div class="text-xs text-slate-500 font-medium mt-0.5">📍 ${p.address || "No Village"}</div>
                ${p.gst ? `<div class="text-[11px] text-slate-400 mt-0.5">GST: ${p.gst}</div>` : ""}
            </td>
            <td class="p-3">
                <div class="font-medium text-slate-700 text-sm mb-1 flex items-center gap-2">
                   📞 ${p.phone}
                   <a href="https://wa.me/91${
                     p.phone
                   }" target="_blank" class="text-green-600 hover:text-green-700 text-xs font-bold bg-green-50 px-1.5 py-0.5 rounded">💬 WA</a>
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
                    <button onclick="deleteParty('${
                      p.id
                    }')" class="text-red-500 hover:text-red-700 p-1 font-bold text-xs bg-red-50 rounded px-2">Delete</button>
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

  const commContainer = document.getElementById("commContainer");
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
  if (formTitle) formTitle.innerText = "✏️ Edit Party Details";

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.innerText = "Update Party";

  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });
};
function resetForm() {
  document.getElementById("partyForm").reset();
  document.getElementById("partyId").value = "";
  document.getElementById("commFieldContainer").style.display = "none";
  document.getElementById("formTitle").innerText = "➕ Add New Party";
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
        const type = (row["Type"] || row["type"] || "Farmer").trim();
        const name = (row["Name"] || row["name"] || "").trim().toUpperCase();
        const munimName = (row["Munim / Ref"] || row["munimName"] || "").trim().toUpperCase();
        const phone = String(row["Mobile"] || row["mobile"] || row["Phone"] || "").trim();
        const altPhone = String(row["Alt Mobile"] || row["alt_mobile"] || "").trim();
        const village = (row["Village"] || row["village"] || row["Address"] || "").trim().toUpperCase();
        const gstin = (row["GSTIN"] || row["gst"] || "").trim().toUpperCase();
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
        if (phone.length !== 10 || isNaN(phone) || !/^[6-9]\d{9}$/.test(phone) || /^(\d)\1{9}$/.test(phone)) {
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

        // 4. Role-based & Batch Duplicate Checks
        let nameTypeExists = partiesList.find((p) => p.name === name && p.type === type);
        let phoneTypeExists = partiesList.find((p) => (p.phone === phone || p.altPhone === phone) && p.type === type);
        let gstExists = gstin ? partiesList.find((p) => p.gst === gstin) : null;

        if (nameTypeExists || phoneTypeExists || gstExists) {
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

        await db.collection("parties").add(newParty);
        // Locally push karein taaki agar Excel mein hi same kisan 2 baar ho, toh doosri baar wo detect ho jaye
        partiesList.push(newParty);
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

window.deleteParty = async function (id) {
  const p = partiesList.find((x) => x.id === id);
  if (!p) return;

  try {
    const isCustomer = await db.collection("bills").where("customer_name", "==", p.name).limit(1).get();
    const isBroker = await db.collection("bills").where("broker", "==", p.name).limit(1).get();

    if (!isCustomer.empty || !isBroker.empty) {
      return Swal.fire({
        title: "Cannot Delete ⛔",
        text: `Bills are already generated under the name "${p.name}". Deleting this will corrupt old bills.`,
        icon: "warning",
        confirmButtonColor: "#3085d6",
      });
    }
  } catch (e) {
    console.warn("Dependency check failed:", e);
  }

  const confirm = await Swal.fire({
    title: "Are you sure?",
    text: `Do you want to permanently remove ${p.name} from the master list?`,
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    confirmButtonText: "Yes, delete it!",
  });

  if (confirm.isConfirmed) {
    try {
      // 1. Party ka data nikalein
      const partyDoc = await db.collection("parties").doc(id).get();
      const partyData = partyDoc.exists ? partyDoc.data() : {};
      const partyName = (partyData.name || "").trim().toLowerCase();

      // 2. Bills collection ke saare bills fetch karein
      const billsSnapshot = await db.collection("bills").get();
      let hasActiveBills = false;

      // 3. JavaScript mein loop chala kar check karein ki kisi bhi bill mein ye party hai ya nahi
      billsSnapshot.forEach((doc) => {
        const bill = doc.data();
        // Bill ke andar jitni bhi values hain, unhe string mein convert karke check kar lo
        const billValues = Object.values(bill).map((v) => String(v).trim().toLowerCase());

        const matchesId = billValues.includes(id.toLowerCase());
        const matchesName = partyName && billValues.includes(partyName);

        if (matchesId || matchesName) {
          hasActiveBills = true;
        }
      });

      // 4. Agar bill mil gaya, toh yahin rok do
      if (hasActiveBills) {
        Swal.fire(
          "Error!",
          "Yeh party delete nahi ho sakti, kyunki iska bill bana hua hai aur paisa dena baaki hai!",
          "error"
        );
        return;
      }

      console.log("-> ALLOWED: No bills found anywhere, proceeding to delete.");
      // 5. Agar sach mein koi bill nahi hai, tabhi delete hone do
      await db.collection("parties").doc(id).update({ deleted: true });
      Swal.fire("Deleted!", "Party removed successfully.", "success");
      fetchParties();
    } catch (error) {
      console.error("DELETE ERROR:", error);
      Swal.fire("Error", "Could not delete party.", "error");
    }
  }
};
async function handleDeleteParty(partyId, partyName) {
  try {
    console.log("Checking bills for Party ID:", partyId, "Name:", partyName);

    // 1. Check karein bills collection mein
    const checkById = await db.collection("bills").where("partyId", "==", partyId).get();
    const checkByName = await db.collection("bills").where("partyName", "==", partyName).get();

    console.log("Bills found by ID:", checkById.size);
    console.log("Bills found by Name:", checkByName.size);

    // 2. Agar koi bhi bill mil gaya, toh rok do
    if (!checkById.empty || !checkByName.empty) {
      alert(`⚠️ Error: "${partyName}" ko delete nahi kiya ja sakta, kyunki is party ke bills active hain!`);
      return;
    }

    // 3. Agar bill nahi hai tabhi delete hone do
    const confirmDelete = confirm(`Kya aap sach mein "${partyName}" ko delete karna chahte hain?`);
    if (!confirmDelete) return;

    await db.collection("parties").doc(partyId).update({
      deleted: true,
      updatedAt: new Date().toISOString(),
    });

    alert("Party successfully deleted.");
    loadParties();
  } catch (error) {
    console.error("Error deleting party:", error);
    alert("Delete karne mein error aaya. Console check karein.");
  }
}
