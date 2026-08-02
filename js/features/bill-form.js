// --- Live "Series Preview" — shows which bill number will be created next,
// based on the currently selected product template's series prefix. Updates
// the moment window.activeTemplate changes (set by product-templates.js when
// the user picks a template), without needing to edit that file.
async function updateSeriesPreview() {
  const previewEl = document.getElementById("series-preview");
  if (!previewEl) return;

  // In edit mode the Serial No is fixed to the original bill and won't
  // change on save, so a "next bill" preview would be misleading — skip it.
  const form = document.getElementById("estimateForm");
  if (form && form.dataset.editId) {
    previewEl.textContent = "";
    return;
  }

  const now = new Date();
  let year = now.getFullYear();
  const month = now.getMonth();
  if (month < 3) year = year - 1;
  const shortYear = year.toString().slice(-2);
  const nextShortYear = (year + 1).toString().slice(-2);
  const financialYearId = `FY${shortYear}${nextShortYear}`;

  const seriesPrefix =
    window.activeTemplate && window.activeTemplate.seriesPrefix ? window.activeTemplate.seriesPrefix : null;
  const counterDocId = seriesPrefix
    ? `billCounter_${seriesPrefix}_${financialYearId}`
    : `billCounter_${financialYearId}`;

  previewEl.textContent = "⏳ Agla bill number check ho raha hai...";

  try {
    const counterDoc = await db.collection("counters").doc(counterDocId).get();
    const lastNumber = counterDoc.exists ? counterDoc.data().currentNumber : 0;
    const nextNumber = lastNumber + 1;
    const paddedNext = String(nextNumber).padStart(5, "0");
    const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
    const nextBillNo = seriesPrefix
      ? `${seriesPrefix}-${shortYear}${nextShortYear}-${paddedNext}`
      : `${shortYear}/${currentMonth}-${paddedNext}`;
    const lastBillText =
      lastNumber > 0
        ? `${seriesPrefix ? seriesPrefix + "-" + shortYear + nextShortYear + "-" : ""}${String(lastNumber).padStart(
            5,
            "0"
          )}`
        : "koi nahi (pehla bill)";

    previewEl.textContent = `📄 Yeh bill banega: ${nextBillNo}   |   Last bill: ${lastBillText}`;
  } catch (e) {
    console.warn("Could not fetch series preview:", e);
    previewEl.textContent = "";
  }
}

// Watch for any assignment to window.activeTemplate (product-templates.js
// sets this directly) and refresh the preview immediately when it changes.
(function watchActiveTemplateForSeriesPreview() {
  let _activeTemplateValue = window.activeTemplate;
  Object.defineProperty(window, "activeTemplate", {
    configurable: true,
    get() {
      return _activeTemplateValue;
    },
    set(val) {
      _activeTemplateValue = val;
      updateSeriesPreview();
    },
  });
})();

// Also show a preview immediately on load for the "Direct Bill" (no
// template selected yet) case, and again once editId data has loaded.
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(updateSeriesPreview, 300);
});

let uniqueCustomers = []; // To hold our customer list
let uniqueBrokers = []; // 🚀 YE NAYI LINE ADD KARNI HAI
async function setupAutocomplete() {
  try {
    // 1. Bina kisi strict condition ke saara data fetch karo (Safe approach)
    const snapshot = await db.collection("parties").get();

    // 2. JS mein filter karo taaki agar 'deleted' field na bhi ho toh error na aaye
    window.partiesMasterList = snapshot.docs.map((doc) => doc.data()).filter((p) => p.deleted !== true);

    // 3. Filter and Map (Spelling/Small-Capitalization ki galti handle karne ke liye)
    uniqueCustomers = window.partiesMasterList
      .filter((p) => {
        // Type ko lowercase karke check karenge taaki small/capital ka lafda na rahe
        const type = (p.type || "").toLowerCase();
        return type === "farmer" || type === "vepari" || type === "kisan" || type === "customer";
      })
      .map((p) => ({
        ...p,
        customer_name: p.name || "",
        village: p.address || "",
      }));

    // 4. Sirf Brokers ke liye ek alag list banayein
    // 4. Sirf Brokers ke liye alag list (with Village format)
    uniqueBrokers = window.partiesMasterList
      .filter((p) => {
        const type = (p.type || "").toLowerCase();
        return type === "broker";
      })
      .map((p) => {
        return {
          value: p.name || "",
          address: p.address || "",
          defaultComm: p.defaultComm || 0,
        };
      });

    // 🚀 CUSTOM JS AUTOCOMPLETE (Bilkul Customer Jaisa!)
    const brokerInput = document.getElementById("broker_name");
    const brokerSuggestionsBox = document.getElementById("broker-suggestions");

    if (brokerInput && brokerSuggestionsBox) {
      brokerInput.addEventListener("input", () => {
        const value = brokerInput.value.toLowerCase();
        brokerSuggestionsBox.innerHTML = "";

        if (!value) return;

        const filteredBrokers = uniqueBrokers.filter((broker) => broker.value.toLowerCase().includes(value));

        const suggestionsList = document.createElement("div");
        // Customer wali same CSS class laga rahe hain taaki design ekdum sundar aaye
        suggestionsList.classList.add("autocomplete-items");

        filteredBrokers.forEach((broker) => {
          const item = document.createElement("div");
          // HTML format: BOLD Naam (Gaon ka naam)
          item.innerHTML = `<strong>${broker.value}</strong> ${broker.address ? `(${broker.address})` : ""}`;

          item.addEventListener("click", () => {
            // 1. Select karne par sirf Broker ka naam dabbe me jayega
            brokerInput.value = broker.value;
            brokerSuggestionsBox.innerHTML = "";

            // 2. Agar Broker ka default commission hai toh auto-fill kar dega
            const commInput = document.querySelector('input[name="broker_commission_per_bag"]');
            const commToggle = document.getElementById("broker-commission-toggle");
            const commBox = document.getElementById("broker-commission-input");

            if (commInput && broker.defaultComm > 0) {
              commInput.value = broker.defaultComm;
              if (commToggle && !commToggle.checked) {
                commToggle.checked = true;
                if (commBox) commBox.style.display = "block";
              }
            }
          });
          suggestionsList.appendChild(item);
        });
        brokerSuggestionsBox.appendChild(suggestionsList);
      });

      // Box ke bahar click karne par dropdown band ho jaye
      document.addEventListener("click", (e) => {
        if (e.target !== brokerInput) {
          brokerSuggestionsBox.innerHTML = "";
        }
      });
    }
  } catch (error) {
    console.error("Could not fetch party list for autocomplete:", error);
  }
  // 2. Get references to the input fields (no change here)
  const nameInput = document.querySelector('input[name="customer_name"]');
  const villageInput = document.querySelector('input[name="village"]');
  const suggestionsBox = document.getElementById("autocomplete-container");

  // 3. The rest of the function stays the same
  nameInput.addEventListener("input", () => {
    const value = nameInput.value.toLowerCase();
    suggestionsBox.innerHTML = "";

    if (!value) return;

    const filteredCustomers = uniqueCustomers.filter((customer) => customer.name.toLowerCase().includes(value));

    const suggestionsList = document.createElement("div");
    suggestionsList.classList.add("autocomplete-items");
    filteredCustomers.forEach((customer) => {
      const item = document.createElement("div");
      item.innerHTML = `<strong>${customer.name}</strong> (${customer.village})`;
      item.addEventListener("click", () => {
        nameInput.value = customer.name;
        villageInput.value = customer.village;
        suggestionsBox.innerHTML = "";
      });
      suggestionsList.appendChild(item);
    });
    suggestionsBox.appendChild(suggestionsList);
  });
}
function initializeIndexPage() {
  addExpense();

  // Phase 1: Default the date field to today (user can still change it)
  const dateInput = document.getElementById("bill_date_input");
  if (dateInput && !dateInput.value) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  // Call the new autocomplete setup function
  setupAutocomplete();
  const toggle = document.getElementById("loose_supply_toggle");
  if (toggle) {
    toggle.addEventListener("change", function (event) {
      const isLoose = event.target.checked;
      document.getElementById("loose_supply_section").style.display = isLoose ? "table-row-group" : "none";
      document.getElementById("bag_supply_section").style.display = isLoose ? "none" : "table-row-group";
      document.getElementById("vakal_section").style.display = isLoose ? "none" : "table-row-group";
      document.getElementById("loose_price_input").required = isLoose;

      const supplyTypeSelector = document.querySelector(".supply-type-selector");
      if (supplyTypeSelector) {
        supplyTypeSelector.style.display = isLoose ? "none" : "flex";
      }
    });
  }

  // Logic to automatically control both deduction toggles
  const supplyTypeRadios = document.querySelectorAll('input[name="supply_type"]');
  const kantanDeductToggle = document.querySelector('input[name="deduct_kantan"]');
  const plasticDeductToggle = document.querySelector('input[name="deduct_plastic"]');

  supplyTypeRadios.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      if (kantanDeductToggle && plasticDeductToggle) {
        // If "Kantan Pack" is selected, turn OFF BOTH toggles.
        if (event.target.value === "કંતાન પેક") {
          kantanDeductToggle.checked = false;
          plasticDeductToggle.checked = false;
        }
        // Otherwise (if "Loose" is selected), turn them both back ON.
        else {
          kantanDeductToggle.checked = true;
          plasticDeductToggle.checked = true;
        }
      }
    });
  });

  const kasarDisplay = document.getElementById("kasar-percentage-display");
  if (kasarDisplay && globalSettings && typeof globalSettings.kasarPercentage !== "undefined") {
    const percentage = (globalSettings.kasarPercentage * 100).toFixed(1);
    kasarDisplay.textContent = `(${percentage}%)`;
  }

  const utraiDisplay = document.getElementById("utrai-value-display");
  if (utraiDisplay && globalSettings && typeof globalSettings.utraiPercentage !== "undefined") {
    // The Utrai value is a rate, not a percentage
    utraiDisplay.textContent = `(${globalSettings.utraiPercentage}₹/100kg)`;
  }

  const form = document.getElementById("estimateForm");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const isEditMode = form.dataset.editId;
    if (isEditMode) {
      updateData(isEditMode);
    } else {
      collectData();
    }
  });

  // Phase 3 (items #13, #14): edit mode is now driven by a ?editId= URL
  // param instead of a localStorage snapshot. This always fetches the
  // CURRENT bill data fresh from Firestore right when the form opens —
  // no risk of showing a stale cached copy from an earlier visit/tab.
  const urlParams = new URLSearchParams(window.location.search);
  const editId = urlParams.get("editId");
  if (editId) {
    showLoading("Loading bill for editing...");
    // BUG FIX: iske bina, offline-cache wala purana/pending data mil sakta
    // tha, jiska "lastUpdatedAt" save ke time transaction se fresh-padhe
    // gaye server data se match nahi karta — aur system galti se "kisi aur
    // ne bill change kar diya" (Conflict) ya "Bill not found" jaisa error
    // de deta tha, jabki asal mein kuch bhi galat nahi hua tha. Ab pehle
    // seedha server se fresh padhte hain; agar genuinely offline ho tabhi
    // cache wale purane data par fallback karte hain.
    billsCollection
      .doc(editId)
      .get({ source: "server" })
      .catch(() => billsCollection.doc(editId).get())
      .then((doc) => {
        if (doc.exists) {
          populateFormForEdit({ ...doc.data(), id: doc.id });
        } else {
          Swal.fire({
            icon: "error",
            title: "Bill not found",
            text: "This bill may have been deleted.",
            confirmButtonColor: "#005a9e",
          });
        }
      })
      .catch((err) => {
        console.error("Error loading bill for edit:", err);
        Swal.fire({ icon: "error", title: "Could not load bill", confirmButtonColor: "#005a9e" });
      })
      .finally(() => hideLoading());
  }

  // Attach a real-time listener to all bags inputs
  const bagInputs = document.querySelectorAll('#vakal_section input[name$="_katta"]');
  bagInputs.forEach((input) => {
    input.addEventListener("input", updateTotalBags);
  });

  // Update the total immediately when the page loads
  updateTotalBags();
}
// Phase 3 (item #13): Optimistic Concurrency — captures the bill's
// lastUpdatedAt timestamp at the moment the edit form is opened, so
// updateData() can detect if someone else saved a change to the SAME bill
// while this form was open (prevents silently overwriting their edit).
let editModeLastUpdatedAt = null;

window.cancelEditMode = function () {
  console.log("Cancel Edit trigger hua! 🚀"); // Debugging ke liye (console mein check karna)

  // 1. Form ko saaf (reset) karo aur Edit ID hatao
  const form = document.getElementById("estimateForm");
  if (form) {
    form.reset();
    if (form.dataset.editId) {
      delete form.dataset.editId;
    }
  }

  // 2. Orange wala banner screen se hatao
  const banner = document.getElementById("edit-mode-banner");
  if (banner) {
    banner.remove();
  }

  // 3. Form ke chaaro taraf se orange border (class) hatao
  const formCard = document.getElementById("bill_creation_form");
  if (formCard) {
    formCard.classList.remove("edit-mode-active");
  }

  // 4. Edit mode ka time reset karo (taaki naya bill ban sake)
  if (typeof editModeLastUpdatedAt !== "undefined") {
    editModeLastUpdatedAt = null;
  }

  // 🔓 5. Cancel karne par Product/Template dropdown ko wapas khol do
  const templateDropdown = document.querySelector('#product, #productTemplate, #productId, select[name="product"]');
  if (templateDropdown) {
    templateDropdown.disabled = false;
    templateDropdown.title = "";
  }
};

function populateFormForEdit(data) {
  const form = document.getElementById("estimateForm");
  form.dataset.editId = data.id;
  editModeLastUpdatedAt = data.lastUpdatedAt || null;
  updateSeriesPreview(); // now that editId is set, this will correctly clear itself

  // 🛡️ Safer way to set values: Agar koi field HTML mein missing ho toh crash nahi hoga
  // 🛡️ Super Safe Way: ID aur Name dono dhoondhega, aur database ki alag-alag spelling bhi check karega
  const setSafeValue = (selector, val) => {
    const el = document.querySelector(selector);
    if (el) el.value = val;
  };

  // Customer Name
  let custName = data["Customer Name"] || data.customer_name || data.customerName || "";
  setSafeValue('#customer_name, [name="customer_name"]', custName.toUpperCase());

  // Vehicle No (Gadi Number)
  let vehicleNo = data["Vehicle No"] || data.vehicle_no || data.vehicleNo || "";
  setSafeValue('#vehicle_no, [name="vehicle_no"]', vehicleNo.toUpperCase());

  // Village (Gaam)
  let village = data["Village"] || data.village || "";
  setSafeValue('#village, [name="village"]', village.toUpperCase());

  // Broker (Dalal) - Dropdown ke liye Special Code (Case In-sensitive match)
  let broker = data["Broker"] || data.broker || "";
  let brokerEl = document.querySelector('#broker, [name="broker"]');

  if (brokerEl && broker) {
    // Pehle direct set karne ki koshish karo
    brokerEl.value = broker;

    // Agar direct set nahi hua (spelling/case mismatch), toh ek-ek option check karo
    if (brokerEl.selectedIndex <= 0) {
      // 0 matlab 'Select karein...'
      for (let i = 0; i < brokerEl.options.length; i++) {
        let optionText = brokerEl.options[i].text.toLowerCase();
        let optionValue = brokerEl.options[i].value.toLowerCase();
        let dbBroker = broker.toLowerCase();

        // Agar Text ya Value match kar jaye toh usko select kar do
        if (optionText === dbBroker || optionValue === dbBroker) {
          brokerEl.selectedIndex = i;
          break;
        }
      }
    }
  }
  // Weights & Freight
  setSafeValue(
    '#weighbridge_weight, [name="weighbridge_weight"]',
    data["Weighbridge Weight"] || data.weighbridge_weight || 0
  );
  setSafeValue('#truck_freight, [name="truck_freight"]', data["Truck Freight"] || data.truck_freight || 0);

  // Phase 1: Pre-fill date (convert DD/MM/YYYY -> YYYY-MM-DD for the date input)
  const dateInput = document.getElementById("bill_date_input");
  if (dateInput && data["Date"]) {
    const parts = data["Date"].split("/"); // [DD, MM, YYYY]
    if (parts.length === 3) {
      dateInput.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  // Phase 1: Pre-fill remarks
  const remarksInput = document.querySelector('textarea[name="bill_remarks"]');
  if (remarksInput) remarksInput.value = data["Remarks"] || "";

  if (data["Bill Type"] === "Loose") {
    document.getElementById("loose_supply_toggle").checked = true;
    document.getElementById("loose_supply_toggle").dispatchEvent(new Event("change"));
    document.querySelector('input[name="loose_price"]').value = data["Vakal 1 Bhav"] || 0;
  } else {
    // Populate Vakal fields for Bag bills
    for (let i = 1; i <= 5; i++) {
      document.querySelector(`input[name="vakal_${i}_katta"]`).value = data[`Vakal ${i} Katta`] || "";
      document.querySelector(`input[name="vakal_${i}_bhav"]`).value = data[`Vakal ${i} Bhav`] || "";
    }
  }

  // Populate expenses
  if (data["Expenses"]) {
    try {
      const expenses = JSON.parse(data["Expenses"]);
      const expenseList = document.getElementById("expense_list");
      expenseList.innerHTML = ""; // Clear existing empty expense row
      if (expenses.length > 0) {
        expenses.forEach((exp) => addExpense(exp.name, exp.amount));
      }
      addExpense(); // Add a final empty row
    } catch (e) {
      console.error("Could not parse expenses for editing.");
    }
  }

  document.querySelector('button[type="submit"]').textContent = "✏️ Update Bill";

  // ── Phase 2: Edit mode visual feedback ──
  // Scroll the form into view and highlight it with an orange border
  const formCard = document.getElementById("bill_creation_form");
  if (formCard) {
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
    formCard.classList.add("edit-mode-active");
  }

  // Show an "editing bill #X" banner at the top of the form
  let banner = document.getElementById("edit-mode-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "edit-mode-banner";
    banner.className = "edit-mode-banner";
    formCard.prepend(banner);
  }
  banner.innerHTML = `✏️ Editing Bill <strong>#${data["Serial No"] || ""}</strong> —
    <button type="button" onclick="cancelEditMode()" class="edit-cancel-btn">Cancel Edit</button>`;

  // 🔒 Edit mode mein Product/Template dropdown ko disable kar do taaki koi change na kar sake
  const templateDropdown = document.querySelector('#product, #productTemplate, #productId, select[name="product"]');
  if (templateDropdown) {
    templateDropdown.disabled = true;
    templateDropdown.title = "Edit mode mein product template change nahi kar sakte";
  }

  // --- Yeh sabse last mein daalna hai, function ke khatam hone se pehle ---
  const loader = document.getElementById("global-loader-ui");
  if (loader) {
    loader.style.display = "none";
  }
}

function updateTotalBags() {
  let total = 0;
  const bagInputs = document.querySelectorAll('#vakal_section input[name$="_katta"]');
  bagInputs.forEach((input) => {
    total += Number(input.value) || 0;
  });
  document.getElementById("total-bags-count").textContent = total;

  // Live warning if vakal bags > bharela bags
  const bharela600 = Number(document.querySelector('input[name="bharela_600"]')?.value) || 0;
  const bharela200 = Number(document.querySelector('input[name="bharela_200"]')?.value) || 0;
  const totalBharela = bharela600 + bharela200;

  const bagsBadge = document.getElementById("total-bags-count");
  const warningEl = document.getElementById("vakal-bag-warning");

  if (totalBharela > 0 && total > totalBharela) {
    if (bagsBadge) bagsBadge.style.color = "#dc3545";
    if (warningEl) {
      warningEl.style.display = "block";
      warningEl.textContent = `⚠️ વકલ (${total}) > ભરેલા (${totalBharela}) — ${
        total - totalBharela
      } bag(s) zyada hain!`;
    }
  } else {
    if (bagsBadge) bagsBadge.style.color = "";
    if (warningEl) warningEl.style.display = "none";
  }
}
function updateExpensesSubtotal() {
  let total = 0;
  const expenseAmountInputs = document.querySelectorAll('input[name="expense_amount"]');
  expenseAmountInputs.forEach((input) => {
    total += Number(input.value) || 0;
  });
  document.getElementById("expenses-subtotal").textContent = `₹${total.toLocaleString("en-IN")}`;
}
function addExpense(name = "", amount = "") {
  const expenseList = document.getElementById("expense_list");
  if (!expenseList) return;
  const newRow = document.createElement("div");
  newRow.classList.add("expense-row");
  newRow.innerHTML = `
        <input type="text" name="expense_name" placeholder="ખર્ચનું નામ (Expense Name)" value="${name}">
        <input type="number" name="expense_amount" placeholder="રકમ (Amount)" value="${amount}">
        <button type="button" class="remove-expense-btn" onclick="this.parentElement.remove(); updateExpensesSubtotal();">Remove</button>
    `;
  expenseList.appendChild(newRow);

  // Add a real-time listener to the new amount input
  const newAmountInput = newRow.querySelector('input[name="expense_amount"]');
  newAmountInput.addEventListener("input", updateExpensesSubtotal);

  // Update the total immediately
  updateExpensesSubtotal();
}
// ═══════════════════════════════════════════════════════════════════════
// CUSTOM DEDUCTION FORMULA EVALUATOR
// Settings mein "Custom (apna formula)" deduction banate waqt user jo bhi
// formula type karta hai (e.g. "bags * 2" ya "(amount * 1.5) / 100"), use
// yahan evaluate karte hain. raw eval() ke bajaye new Function() use kiya
// hai — isse formula ko sirf wahi variables dikhte hain jo hum explicitly
// pass karte hain, baaki poore app ke variables/functions tak uski pahunch
// nahi hoti (thoda zyada surakshit, bilkul foolproof nahi — Settings sirf
// business-owner khud edit karta hai, is liye ye level kaafi hai).
function evaluateCustomFormula(formula, vars) {
  if (!formula || typeof formula !== "string") return 0;
  try {
    const keys = Object.keys(vars);
    const values = Object.values(vars);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${formula});`);
    const result = fn(...values);
    return typeof result === "number" && isFinite(result) ? result : 0;
  } catch (e) {
    console.error(`Custom formula error in "${formula}":`, e);
    return 0;
  }
}

function calculateBillData(formData) {
  let data = {}; // This object will hold all our results

  // --- Get Form Values ---
  const isLooseSupply = formData.get("is_loose_supply") !== null;
  data["Supply Type"] = formData.get("supply_type");
  const deductKasar = formData.get("deduct_kasar") !== null;
  const deductKantan = formData.get("deduct_kantan") !== null;
  const deductPlastic = formData.get("deduct_plastic") !== null;
  const deductUtrai = formData.get("deduct_utrai") !== null;

  // --- MOISTURE DEDUCTIONS ---
  const deductWeighbridgeMoisture = formData.get("deduct_weighbridge_moisture") !== null;
  const weighbridgeMoisturePct = Number(formData.get("weighbridge_moisture_pct")) || 0;
  const deductVakalMoisture = formData.get("deduct_vakal_moisture") !== null;

  const bharela_600 = Number(formData.get("bharela_600")) || 0;
  const khali_600 = Number(formData.get("khali_600")) || 0;
  const bharela_200 = Number(formData.get("bharela_200")) || 0;
  const khali_200 = Number(formData.get("khali_200")) || 0;

  // --- NEW: Save bag counts to the data object ---
  data["Bharela 600"] = bharela_600;
  data["Khali 600"] = khali_600;
  data["Bharela 200"] = bharela_200;
  data["Khali 200"] = khali_200;

  data["Supply Type"] = formData.get("supply_type");
  // If it's a loose supply bill, ALWAYS set the type to 'લૂઝ'
  if (isLooseSupply) {
    data["Supply Type"] = "લૂઝ";
  }

  let expenses = [];
  const expenseRows = document.querySelectorAll(".expense-row");
  expenseRows.forEach((row) => {
    const name = row.querySelector(`input[name^="expense_name"]`).value;
    const amount = Number(row.querySelector(`input[name^="expense_amount"]`).value);
    if (name && amount > 0) {
      expenses.push({ name, amount });
    }
  });
  data["Expenses"] = JSON.stringify(expenses);

  let net_vajan = 0;
  let total = 0;
  let finalutrai = 0;

  // --- Perform Calculations ---
  if (isLooseSupply) {
    data["Bill Type"] = "Loose";
    const weight = Number(formData.get("weighbridge_weight")) || 0;
    const price = Number(formData.get("loose_price")) || 0;
    const katta_kasar = deductKasar ? customRound(weight * globalSettings.kasarPercentage) : 0;
    const wb_moisture_kg = deductWeighbridgeMoisture ? customRound(weight * (weighbridgeMoisturePct / 100)) : 0;
    net_vajan = customRound(weight - katta_kasar - wb_moisture_kg);

    // Vakal moisture for loose
    const vakal_moisture_pct_1 = deductVakalMoisture ? Number(formData.get("vakal_1_moisture")) || 0 : 0;
    const vakal_moisture_kg_1 = customRound(net_vajan * (vakal_moisture_pct_1 / 100));
    const net_vajan_after_vakal_moisture = customRound(net_vajan - vakal_moisture_kg_1);
    total = customRound((net_vajan_after_vakal_moisture / 20) * price);

    data["Weighbridge Weight"] = weight;
    data["Kasar"] = katta_kasar;
    data["Weighbridge Moisture %"] = weighbridgeMoisturePct;
    data["Weighbridge Moisture Kg"] = wb_moisture_kg;
    data["Vakal 1 Moisture %"] = vakal_moisture_pct_1;
    data["Vakal 1 Moisture Kg"] = vakal_moisture_kg_1;
    data["Bardan Weight"] = 0;
    data["Kantan Weight"] = 0; // Add this
    data["Plastic Weight"] = 0; // Add this
    data["Vakal 1 Katta"] = "-";
    data["Vakal 1 Kilo"] = net_vajan_after_vakal_moisture;
    data["Vakal 1 Bhav"] = price;
    data["Vakal 1 Amount"] = total;
    for (let i = 2; i <= 5; i++) {
      data[`Vakal ${i} Katta`] = 0;
      data[`Vakal ${i} Kilo`] = 0;
      data[`Vakal ${i} Bhav`] = 0;
      data[`Vakal ${i} Amount`] = 0;
    }
  } else {
    data["Bill Type"] = "Bag";
    const weighbridge_weight = Number(formData.get("weighbridge_weight")) || 0;
    const bharela_600 = Number(formData.get("bharela_600")) || 0;
    const khali_600 = Number(formData.get("khali_600")) || 0;
    const bharela_200 = Number(formData.get("bharela_200")) || 0;
    const khali_200 = Number(formData.get("khali_200")) || 0;

    const bardanWeightKantan = deductKantan ? customRound((bharela_600 + khali_600) * globalSettings.kantanWeight) : 0;
    const bardanWeightPlastic = deductPlastic
      ? customRound((bharela_200 + khali_200) * globalSettings.plasticWeight)
      : 0;
    const Bardan = bardanWeightKantan + bardanWeightPlastic;
    data["Kantan Weight"] = bardanWeightKantan; // Save Kantan weight
    data["Plastic Weight"] = bardanWeightPlastic; // Save Plastic weight
    data["Bardan Weight"] = Bardan; // Still save the total for calculation
    const katta_kasar = deductKasar ? customRound(weighbridge_weight * globalSettings.kasarPercentage) : 0;
    const wb_moisture_kg = deductWeighbridgeMoisture
      ? customRound(weighbridge_weight * (weighbridgeMoisturePct / 100))
      : 0;
    net_vajan = customRound(weighbridge_weight - katta_kasar - Bardan - wb_moisture_kg);

    data["Weighbridge Weight"] = weighbridge_weight;
    data["Kasar"] = katta_kasar;
    data["Weighbridge Moisture %"] = weighbridgeMoisturePct;
    data["Weighbridge Moisture Kg"] = wb_moisture_kg;
    data["Bardan Weight"] = Bardan;

    const vakals = [
      { katta: Number(formData.get("vakal_1_katta")) || 0, bhav: Number(formData.get("vakal_1_bhav")) || 0 },
      { katta: Number(formData.get("vakal_2_katta")) || 0, bhav: Number(formData.get("vakal_2_bhav")) || 0 },
      { katta: Number(formData.get("vakal_3_katta")) || 0, bhav: Number(formData.get("vakal_3_bhav")) || 0 },
      { katta: Number(formData.get("vakal_4_katta")) || 0, bhav: Number(formData.get("vakal_4_bhav")) || 0 },
      { katta: Number(formData.get("vakal_5_katta")) || 0, bhav: Number(formData.get("vakal_5_bhav")) || 0 },
    ];

    // ── VALIDATION: Vakal bags cannot exceed total bharela bags ──
    const totalBharela = bharela_600 + bharela_200;
    const totalVakalEntered = vakals.reduce((sum, v) => sum + v.katta, 0);
    if (totalVakalEntered > totalBharela) {
      throw new Error(`VALIDATION_ERROR: વકલમાં કુલ કટ્ટા (${totalVakalEntered}) ભરેલા કટ્ટા (${totalBharela}) કરતાં વધારે છે!

Vakal total bags (${totalVakalEntered}) cannot be more than Bharela bags (${totalBharela}).`);
    }

    let totalVakalBags = vakals.reduce((sum, v) => sum + v.katta, 0);
    let perUnitWeight = totalVakalBags ? net_vajan / totalVakalBags : 0;
    let calculatedKilosSum = 0;
    let lastActiveVakalIndex = vakals.map((v) => v.katta > 0).lastIndexOf(true);

    for (let i = 0; i < vakals.length; i++) {
      let kilo = 0;
      if (vakals[i].katta > 0) {
        if (i === lastActiveVakalIndex) {
          kilo = net_vajan - calculatedKilosSum;
        } else {
          kilo = customRound(perUnitWeight * vakals[i].katta);
          calculatedKilosSum += kilo;
        }
      }
      data[`Vakal ${i + 1} Katta`] = vakals[i].katta;
      // Per vakal moisture
      const vakalMoisturePct = deductVakalMoisture ? Number(formData.get(`vakal_${i + 1}_moisture`)) || 0 : 0;
      const vakalMoistureKg = vakals[i].katta > 0 ? customRound(kilo * (vakalMoisturePct / 100)) : 0;
      const kiloAfterMoisture = kilo - vakalMoistureKg;
      data[`Vakal ${i + 1} Moisture %`] = vakalMoisturePct;
      data[`Vakal ${i + 1} Moisture Kg`] = vakalMoistureKg;
      data[`Vakal ${i + 1} Kilo`] = kiloAfterMoisture;
      data[`Vakal ${i + 1} Bhav`] = vakals[i].bhav;
      const amount = customRound((kiloAfterMoisture / 20) * vakals[i].bhav);
      data[`Vakal ${i + 1} Amount`] = amount;
      total += amount;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2 — Utrai rounding order fix (checklist item #7)
  // Utrai's job is to round the bill to the nearest ₹10. Previously it was
  // calculated against `total` BEFORE Expenses/Truck Freight were added, so
  // the actual Final Total (after expenses+freight) often did NOT land on
  // a round ₹10 — defeating the purpose. Now: compute everything else
  // first, then apply the ₹10-rounding Utrai adjustment last.
  // ═══════════════════════════════════════════════════════════════════════
  const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const truckFreight = Number(formData.get("truck_freight")) || 0;

  // Everything except Utrai, combined first:
  const preUtraiTotal = total - totalExpenses + truckFreight;

  if (deductUtrai) {
    let utrai_base = customRound((net_vajan / 100) * globalSettings.utraiPercentage);
    let diff = (preUtraiTotal % 10) - (utrai_base % 10);
    if (diff > 5) finalutrai = utrai_base + diff - 10;
    else if (diff < -5) finalutrai = utrai_base + diff + 10;
    else if (diff === 5 || diff === -5) finalutrai = utrai_base - 5;
    else finalutrai = utrai_base + diff;
  }

  const finaltotal = preUtraiTotal - finalutrai;

  // --- Populate the rest of the data object ---
  data["Customer Name"] = formData.get("customer_name");
  data["Vehicle No"] = formData.get("vehicle_no");
  data["Village"] = formData.get("village");
  data["Broker"] = formData.get("broker_name");
  const brokerName = formData.get("broker_name") ? formData.get("broker_name").trim() : "";
  data["brokerId"] = brokerName ? brokerName.toUpperCase().replace(/\s+/g, "_") : "";
  data["Net Weight"] = net_vajan;
  data["Total Amount"] = total;
  data["Utrāī"] = finalutrai;

  // 3. Save the Truck Freight value to the data object
  data["Truck Freight"] = truckFreight;
  data["Final Total"] = finaltotal;
  data["DeductionSettings"] = {
    kasarPercentage: globalSettings.kasarPercentage,
    kantanWeight: globalSettings.kantanWeight,
    plasticWeight: globalSettings.plasticWeight,
    utraiPercentage: globalSettings.utraiPercentage,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCT TEMPLATE (Phase 1 addition)
  // Applied ON TOP of the core calculation above — core logic is untouched.
  // Weight-stage deductions adjust Net Weight (informational re-calc).
  // Amount-stage deductions adjust Final Total directly.
  // The product name is saved whenever a template is selected, even if it
  // has zero extra deductions — this is what drives the bill's product
  // label (e.g. "ગ્રાઉન્ડનટના કટ્ટા") instead of a hardcoded "ઘઉં" (wheat).
  // ═══════════════════════════════════════════════════════════════════════
  if (window.activeTemplate) {
    data["ProductTemplate"] = window.activeTemplate.name || "";
  }

  if (typeof getActiveTemplateDeductionValues === "function") {
    const templateDeductions = getActiveTemplateDeductionValues();

    if (templateDeductions.length > 0) {
      let extraWeightCutKg = 0;
      let extraAmountChange = 0;
      const appliedLog = [];

      // Custom formula ke liye available variables. Ye poori list Settings
      const totalBags = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
      // "Bag" type mein har Vakal row ka apna alag bhav ho sakta hai, isliye
      // ek single "price" nikalne ke liye average rate (₹ per 20kg) nikalte
      // hain. Loose type mein loose_price seedha use hota hai.
      const avgPricePer20Kg = isLooseSupply
        ? Number(formData.get("loose_price")) || 0
        : net_vajan > 0
        ? customRound((total / net_vajan) * 20)
        : 0;

      // Custom formula ke liye MAXIMUM possible relevant variables — dono
      // stage (weight aur amount) ko poora set milta hai, taaki formula
      // kisi bhi combination mein likha ja sake (jaise "amount * bags" ya
      // "weight - kasar"). Ye poori list Settings ke cheat-sheet mein bhi
      // dikhti hai (product-templates.js). "karda" = isi template mein ab
      // tak isi stage mein kitna deduction ho chuka hai (Admixture/Kachra
      // jaisa concept) — loop aage badhte hi ye value update hoti rehti hai.
      const buildFormulaVars = () => ({
        bags: totalBags,
        bags600: data["Bharela 600"] || 0,
        bags200: data["Bharela 200"] || 0,
        weight: customRound(data["Net Weight"] - extraWeightCutKg), // is loop ke ab tak ke weight-cuts sameit
        grossWeight: data["Weighbridge Weight"] || 0,
        kasar: data["Kasar"] || 0,
        moisture: data["Weighbridge Moisture Kg"] || 0,
        amount: customRound(data["Final Total"] + extraAmountChange), // is loop ke ab tak ke amount-cuts sameit
        price: avgPricePer20Kg,
        freight: truckFreight || 0,
        utrai: finalutrai || 0,
        karda: 0, // niche stage ke hisaab se overwrite hota hai
      });

      templateDeductions.forEach((d) => {
        let impact = 0;

        if (d.stage === "weight") {
          // Weight-based: % of Weight | Fixed/Bag | Fixed/Kg | Custom
          if (d.type === "pct_weight") {
            impact = customRound(data["Weighbridge Weight"] * (d.value / 100));
          } else if (d.type === "fixed_bag") {
            impact = customRound(totalBags * d.value);
          } else if (d.type === "fixed_kg") {
            impact = customRound(net_vajan * d.value);
          } else if (d.type === "custom") {
            impact = customRound(
              evaluateCustomFormula(d.customFormula, { ...buildFormulaVars(), karda: extraWeightCutKg })
            );
          }
          extraWeightCutKg += d.applyAs === "add" ? -impact : impact;
        } else {
          // Amount-based: % of Amount | Fixed Amount | Custom
          if (d.type === "pct_amount") {
            impact = customRound(finaltotal * (d.value / 100));
          } else if (d.type === "fixed_amt") {
            impact = d.value;
          } else if (d.type === "custom") {
            impact = customRound(
              evaluateCustomFormula(d.customFormula, { ...buildFormulaVars(), karda: extraAmountChange })
            );
          }
          extraAmountChange += d.applyAs === "add" ? impact : -impact;
        }

        appliedLog.push({
          name: d.name,
          type: d.type,
          value: d.value,
          applyAs: d.applyAs,
          stage: d.stage,
          impact: impact,
        });
      });

      // Apply extra weight-stage cut to Net Weight (informational)
      if (extraWeightCutKg !== 0) {
        data["Net Weight"] = customRound(data["Net Weight"] - extraWeightCutKg);
      }

      // Apply extra amount-stage change to Final Total
      if (extraAmountChange !== 0) {
        data["Final Total"] = customRound(data["Final Total"] + extraAmountChange);
      }

      data["TemplateDeductionsApplied"] = appliedLog;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: Date & Remarks
  // Date defaults to today (set by initializeIndexPage) but the user can
  // change it — useful for late entries. Works for both new bills and edits.
  // ═══════════════════════════════════════════════════════════════════════
  const selectedDateValue = formData.get("bill_date"); // "YYYY-MM-DD"
  if (selectedDateValue) {
    const [yyyy, mm, dd] = selectedDateValue.split("-");
    data["Date"] = `${dd}/${mm}/${yyyy}`;
  } else {
    const now = new Date();
    data["Date"] = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}/${now.getFullYear()}`;
  }
  data["Remarks"] = formData.get("bill_remarks") || "";

  // ── Broker Commission ──
  // --- Broker Commission (Safe against Loose/Bag & NaN) ---
  // ── 🤝 REVISED BROKER COMMISSION LOGIC (Bug-free & Direct) ──
  const applyBrokerCommission = formData.get("apply_broker_commission") !== null;
  // Fallback: Agar per-bag diya hai ya fir 100kg ka rate hai, dono handle karega
  const commissionRate = Number(formData.get("broker_commission_per_bag") || formData.get("broker_commission")) || 0;

  // Agar broker ka naam hai, aur commission rate > 0 hai (Chahe toggle on ho ya off, agar broker hai toh kaat lo taaki galti na ho)
  if (commissionRate > 0 && data["Broker"]) {
    let totalBagsOrWeight = 0;

    // Total weight kg mein utha lo
    const netWeightKg = Number(data["Net Weight"]) || 0;

    // Simple Calculation: (Total Kg / 100) * Rate per 100kg
    // (Agar aap per-bag chahte hain toh total bags se multiply kar sakte hain)
    let totalCommission = (netWeightKg / 100) * commissionRate;

    totalCommission = Math.round(totalCommission * 100) / 100;

    data["BrokerCommission"] = totalCommission;
    data["BrokerCommissionPerBag"] = commissionRate;

    const currentFinal = Number(data["Final Total"]) || 0;
    data["Final Total"] = customRound(currentFinal - totalCommission);
  } else {
    data["BrokerCommission"] = 0;
  }
  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5 (items #21, #22) — New items[] schema + supplierName alias.
  // ADDITIVE ONLY: every flat "Vakal N ..." field above is left completely
  // unchanged, so reports.js, ledger.js, dashboard.js, generateBillHtmlForView,
  // WhatsApp/PDF/Excel export — none of them need to change, they keep
  // reading the flat fields exactly as before. This `items` array is for
  // FUTURE consumers only. Per explicit decision: OLD bills are NOT migrated
  // — any new code reading `items` must treat its absence as "this is an
  // old-format bill" and fall back to the flat Vakal-N-* fields instead.
  //
  // BUG FIX: this block used to run BEFORE "Customer Name" and
  // "ProductTemplate" were set on `data`, so supplierName was always
  // `undefined` — and Firestore rejects undefined field values, so EVERY
  // bill save/edit failed. Moved to the very end, after everything else on
  // `data` is finalized.
  // ═══════════════════════════════════════════════════════════════════════
  data["supplierName"] = data["Customer Name"] || "";
  const items = [];
  if (data["Bill Type"] === "Loose") {
    items.push({
      product: data["ProductTemplate"] || null,
      variety: data["Vakal 1 Variety"] || "",
      quantity: data["Vakal 1 Kilo"] || 0,
      unit: "kg",
      rate: data["Vakal 1 Bhav"] || 0,
      amount: data["Vakal 1 Amount"] || 0,
    });
  } else {
    for (let i = 1; i <= 5; i++) {
      const katta = data[`Vakal ${i} Katta`];
      if (katta && katta > 0) {
        items.push({
          product: data["ProductTemplate"] || null,
          variety: data[`Vakal ${i} Variety`] || "",
          quantity: katta,
          unit: "bags",
          rate: data[`Vakal ${i} Bhav`] || 0,
          amount: data[`Vakal ${i} Amount`] || 0,
        });
      }
    }
  }
  data["items"] = items;

  // --- Return the final calculated data ---
  return data;
}
async function collectData() {
  showLoading();
  const form = document.getElementById("estimateForm");
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    // 1. Determine the current financial year
    const now = new Date();
    let year = now.getFullYear();
    const month = now.getMonth(); // 0 = January, 3 = April

    if (month < 3) {
      // If the month is Jan, Feb, or Mar...
      year = year - 1; // ...it's part of the previous financial year
    }
    const shortYear = year.toString().slice(-2);
    const nextShortYear = (year + 1).toString().slice(-2);
    const financialYearId = `FY${shortYear}${nextShortYear}`; // e.g., "FY2526"

    // --- Phase 1: Use product template's series prefix if one is selected ---
    const seriesPrefix =
      window.activeTemplate && window.activeTemplate.seriesPrefix ? window.activeTemplate.seriesPrefix : null;
    // Each product series gets its own independent counter so numbering
    // doesn't clash between e.g. Wheat (WH-...) and Groundnut (GN-...).
    const counterDocId = seriesPrefix
      ? `billCounter_${seriesPrefix}_${financialYearId}`
      : `billCounter_${financialYearId}`;

    // 2. Set the correct counter document reference
    const counterRef = db.collection("counters").doc(counterDocId);

    const formData = new FormData(form);
    let data = calculateBillData(formData);

    // 📍 Yahin par (calculateBillData ke turant baad) ye 3 line daal deni hain:
    const customerId = formData.get("customer_id") || data.customerId || "";
    const customerName = formData.get("Customer Name") || data["Customer Name"] || "";
    const customerVillage = formData.get("Village") || data["Village"] || "N/A";

    // Save or update the customer in the 'customers' collection

    // --- UPDATED TRANSACTION LOGIC ---
    const newSerialNo = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      if (!counterDoc.exists) {
        // If the counter for the new year doesn't exist, create it and start at 1
        transaction.set(counterRef, { currentNumber: 1 });
        return 1;
      } else {
        // If the counter already exists, just increment it
        const newCounterValue = counterDoc.data().currentNumber + 1;
        transaction.update(counterRef, { currentNumber: newCounterValue });
        return newCounterValue;
      }
    });

    // --- MODIFIED BILL NUMBER FORMATTING ---
    // Get the current month (1-12) and pad with a leading zero if needed
    const currentMonth = String(now.getMonth() + 1).padStart(2, "0");

    // Format the new bill number with the month (e.g., "25/09-00001")
    const paddedSerialNo = String(newSerialNo).padStart(5, "0");
    const formattedBillNo = seriesPrefix
      ? `${seriesPrefix}-${shortYear}${nextShortYear}-${paddedSerialNo}`
      : `${shortYear}/${currentMonth}-${paddedSerialNo}`;

    data["Serial No"] = formattedBillNo;
    // Save linked order reference if any
    data["LinkedOrderId"] = formData.get("linked_order_id") || "";
    data["LinkedSupplierIdx"] = formData.get("linked_supplier_idx") || "";
    // Note: Date and Remarks are already set inside calculateBillData() above.
    // Phase 2 (item #11): server-side timestamp for reliable chronological
    // sorting in the ledger — the "Date" field above is a display string
    // (DD/MM/YYYY) picked by the user and isn't safe to sort by directly.
    data["createdAt"] = firebase.firestore.FieldValue.serverTimestamp();
    data["lastUpdatedAt"] = firebase.firestore.FieldValue.serverTimestamp();

    const docRef = await billsCollection.add(data);

    // --- 🔗 Order Link Update ---
    if (data["LinkedOrderId"]) {
      await db
        .collection("orders")
        .doc(data["LinkedOrderId"])
        .update({
          status: "Completed",
          linkedBillNos: firebase.firestore.FieldValue.arrayUnion(data["Serial No"]), // Array mein save hoga
          updatedAt: Date.now(),
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2 (item #10) — Master Ledger Balance
    // Keep a running currentBalance on customers_master/{customerId} via a
    // Transaction, so a customer's outstanding balance can be looked up in
    // one read instead of scanning every bill/payment. This is a best-effort
    // CACHE, not the source of truth — ledger.js still computes the real
    // balance live from bills+payments, so if this update ever fails it
    // does NOT affect the actual bill save or ledger accuracy.
    // ═══════════════════════════════════════════════════════════════════
    if (customerId) {
      try {
        const masterRef = db.collection("customers_master").doc(customerId);
        await db.runTransaction(async (transaction) => {
          const masterDoc = await transaction.get(masterRef);
          const prevBalance = masterDoc.exists ? masterDoc.data().currentBalance || 0 : 0;
          const newBalance = prevBalance + (data["Final Total"] || 0);
          transaction.set(
            masterRef,
            {
              name: customerName,
              village: customerVillage,
              currentBalance: newBalance,
              lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });
      } catch (masterErr) {
        console.warn("customers_master balance update failed (non-critical — bill was still saved):", masterErr);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 4 (items #16, #17) — Automated Order Book Sync
    // updateOrderDeliveredQty() already existed in order-integration.js but
    // was never actually called anywhere — order delivered-quantity tracking
    // was effectively dead. Wiring it in here, with the manual "Close this
    // Order" checkbox as an override.
    // ═══════════════════════════════════════════════════════════════════
    if (data["LinkedOrderId"] && typeof updateOrderDeliveredQty === "function") {
      const closeOrderOverride = document.getElementById("close_order_checkbox")?.checked || false;
      await updateOrderDeliveredQty(data, closeOrderOverride);
    }
    if (typeof updateBrokerCommission === "function") {
      await updateBrokerCommission(data);
    }

    window.location.href = `final.html?id=${docRef.id}`;
    // ==================== SMART WHATSAPP AUTOMATION (WITH ON-THE-FLY NUMBER PROMPT) ====================

    window.checkAndSendWhatsApp = function (billData) {
      const isAutoSendOn = localStorage.getItem("whatsapp_auto_send") === "true";
      if (!isAutoSendOn) return; // Agar toggle OFF hai toh kuch mat karo

      let phone = billData.farmerPhone;

      // 🔍 AGAR PHONE NUMBER NAHI HAI, TOH WAHIN SE POPUP MEIN MAANG LO!
      if (!phone || phone.trim() === "" || phone === "undefined" || phone.length < 10) {
        Swal.fire({
          title: "📱 Kisan ka Number Darj Nahi Hai",
          text: "Kya aap WhatsApp par parchi bhejne ke liye kisan ka 10-digit mobile number yahan enter karna chahte hain?",
          input: "text",
          inputPlaceholder: "Enter 10-digit mobile number...",
          showCancelButton: true,
          confirmButtonText: "Send WhatsApp",
          cancelButtonText: "Skip",
          confirmButtonColor: "#27ae60",
          cancelButtonColor: "#e74c3c",
        }).then((result) => {
          if (result.isConfirmed && result.value) {
            let enteredPhone = result.value.trim();
            if (enteredPhone.length >= 10) {
              billData.farmerPhone = enteredPhone;
              executeWhatsAppSend(billData);
            } else {
              Swal.fire({
                icon: "error",
                title: "Invalid Number",
                text: "Kripya sahi 10-digit mobile number dalein.",
              });
            }
          }
        });
        return;
      }

      // Agar number pehle se hi form mein hai, toh seedha bhej do
      executeWhatsAppSend(billData);
    };

    // Internal helper to trigger WhatsApp URL
    function executeWhatsAppSend(billData) {
      let message =
        `Namaste Kisan Ji, ${
          globalSettings && globalSettings.companyName ? globalSettings.companyName : "Hamari Company"
        } mein aapka swagat hai. 🙏\n\n` +
        +`📋 *Bill No:* ${billData.billNo}\n` +
        `🌾 *Item:* ${billData.itemName}\n` +
        `⚖️ *Weight / Bori:* ${billData.bags} Bori (${billData.weight} Quintal)\n` +
        `💰 *Rate:* ₹${billData.rate} / Quintal\n` +
        `💵 *Total Amount:* ₹${billData.totalAmount}\n\n` +
        `Aapka maal darj ho chuka hai. Dhanyawad! - ${
          globalSettings && globalSettings.companyName ? globalSettings.companyName : "Company"
        }`;

      let encodedMessage = encodeURIComponent(message);
      let whatsappUrl = `https://wa.me/91${billData.farmerPhone}?text=${encodedMessage}`;

      window.open(whatsappUrl, "_blank");
    }
  } catch (error) {
    if (error.message && error.message.startsWith("VALIDATION_ERROR:")) {
      const msg = error.message.replace("VALIDATION_ERROR: ", "");
      Swal.fire({ icon: "error", title: "⚠️ Validation Error", text: msg, confirmButtonColor: "#005a9e" });
    } else {
      console.error("Transaction failed or error adding document: ", error);
      alert("Could not save the bill. Please try again.");
    }
  } finally {
    submitButton.disabled = false;
    hideLoading();
  }
}
async function updateData(docId) {
  showLoading("Updating bill...");
  const form = document.getElementById("estimateForm");
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  const billRef = billsCollection.doc(docId);
  try {
    const formData = new FormData(form);
    let newData = calculateBillData(formData);
    newData["lastUpdatedAt"] = firebase.firestore.FieldValue.serverTimestamp();

    let originalData; // captured inside the transaction for the bags-count logic below

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3 (item #13) — Optimistic Concurrency
    // Re-read the bill INSIDE the transaction and compare its lastUpdatedAt
    // to the value captured when this edit form was opened. If they differ,
    // someone else saved a change to this same bill in the meantime — abort
    // rather than silently overwriting their edit.
    // ═══════════════════════════════════════════════════════════════════
    await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(billRef);
      if (!freshDoc.exists) throw new Error("NOT_FOUND: Original bill not found!");
      originalData = freshDoc.data();

      const currentTimestamp = originalData.lastUpdatedAt || null;
      const capturedTimestamp = editModeLastUpdatedAt || null;
      const bothHaveTimestamps = currentTimestamp && capturedTimestamp;
      const timestampsDiffer = bothHaveTimestamps
        ? !currentTimestamp.isEqual(capturedTimestamp)
        : currentTimestamp !== capturedTimestamp; // true only if exactly one is null

      if (timestampsDiffer) {
        throw new Error(
          "CONFLICT: This bill was edited by someone else since you opened it. Please reload and try again."
        );
      }

      newData["Serial No"] = originalData["Serial No"];
      // Phase 1: Date and Remarks now come from calculateBillData() itself
      // (already reads the form's date input + remarks textarea), so we
      // no longer force-overwrite Date here — only Serial No stays fixed.

      transaction.update(billRef, newData);
    });

    // Calculate bags in the original bill
    let bagsInOriginalBill = 0;
    if (originalData["Bill Type"] === "Bag") {
      for (let i = 1; i <= 5; i++) {
        bagsInOriginalBill += originalData[`Vakal ${i} Katta`] || 0;
      }
    }

    window.location.href = `final.html?id=${docId}`;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.startsWith("VALIDATION_ERROR:")) {
      const msg = message.replace("VALIDATION_ERROR: ", "");
      Swal.fire({ icon: "error", title: "⚠️ Validation Error", text: msg, confirmButtonColor: "#005a9e" });
    } else if (message.startsWith("CONFLICT:")) {
      Swal.fire({
        icon: "warning",
        title: "⚠️ Bill Changed by Someone Else",
        text: message.replace("CONFLICT: ", ""),
        confirmButtonText: "Reload Bill",
        confirmButtonColor: "#005a9e",
      }).then(() => {
        window.location.href = `bill-create.html?editId=${docId}`;
      });
    } else if (message.startsWith("NOT_FOUND:")) {
      Swal.fire({
        icon: "error",
        title: "Bill Not Found",
        text: "This bill may have been deleted.",
        confirmButtonColor: "#005a9e",
      });
    } else {
      console.error("Error updating document: ", error);
      alert("Could not update the bill. Please try again.");
    }
  } finally {
    submitButton.disabled = false;
    hideLoading();
  }
}
// At the bottom of bill-form.js

document.addEventListener("DOMContentLoaded", async () => {
  await fetchSettings(); // 1. Wait for the settings to load
  initializeIndexPage(); // 2. Then, set up the rest of the page
});
document.addEventListener("DOMContentLoaded", () => {
  const bInput = document.getElementById("broker_name");
  const bBox = document.getElementById("broker-suggestions");

  if (bInput && bBox) {
    // async hata diya kyunki ab Firebase call nahi karna padega
    bInput.addEventListener("input", function () {
      const val = this.value.trim().toUpperCase();
      if (!val) {
        bBox.style.display = "none";
        return;
      }

      try {
        // Agar Master List abhi load nahi hui hai toh wapas jao
        if (!window.partiesMasterList) return;

        const uniqueBrokers = new Map();

        // Seedha memory (partiesMasterList) se filter karo, DB call ki zaroorat nahi
        window.partiesMasterList.forEach((data) => {
          // Sirf 'Broker' ko check karo jo deleted nahi hain
          if (data.type === "Broker" && data.deleted !== true) {
            const name = (data.name || "").trim();
            if (!name) return;

            const brokerId = name.toUpperCase().replace(/\s+/g, "_");

            if (name.toUpperCase().includes(val)) {
              // Pura object save kar rahe hain taaki commission bhi mil jaye
              uniqueBrokers.set(brokerId, data);
            }
          }
        });

        const matches = Array.from(uniqueBrokers.values());

        if (matches.length > 0) {
          bBox.innerHTML = matches
            .map(
              (m) => `
            <div style="padding: 9px 14px; cursor: pointer; border-bottom: 1.5px solid #f0f0f0; background: white; font-weight: 600; color: #333;" 
                 onmousedown="applyBrokerDetails('${m.name}', ${m.defaultComm || 0})">
              🤝 ${m.name} ${
                m.defaultComm ? `<small style="color:gray; font-weight:normal;">(₹${m.defaultComm}/Bag)</small>` : ""
              }
            </div>`
            )
            .join("");
          bBox.style.display = "block";
        } else {
          bBox.style.display = "none";
        }
      } catch (e) {
        console.error("Broker autocomplete error:", e);
      }
    });

    bInput.addEventListener("blur", () => {
      setTimeout(() => {
        bBox.style.display = "none";
      }, 200);
    });
  }
});

// Yeh function Broker ka naam aur Commission dono set karega
window.applyBrokerDetails = function (brokerName, commission) {
  // 1. Naam set karo
  // BUG FIX: id "broker_input_field" kabhi bana hi nahi — asal input ka id
  // "broker_name" hai. Galat id se .value set karne ki koshish turant crash
  // (TypeError) deti thi, isliye niche wala commission auto-fill code kabhi
  // chal hi nahi paata tha.
  document.getElementById("broker_name").value = brokerName;
  document.getElementById("broker-suggestions").style.display = "none";

  // 2. Commission auto-fill karo (Agar form mein commission input hai)
  // BUG FIX: pehle yahan galat name ("broker_commission") aur galat id
  // ("broker-commission-input" — jo asal mein wrapper <div> ka id hai, us
  // div ke andar wale <input> ka nahi) dhoondha ja raha tha, isliye rate
  // field kabhi bharta hi nahi tha — checkbox ON ho jaata tha lekin rate 0
  // reh jaata, isliye commission kabhi kata hi nahi. Asal field ka naam
  // "broker_commission_per_bag" hai (bill-create.html se confirm kiya).
  const commInput = document.querySelector('input[name="broker_commission_per_bag"]');

  if (commInput && commission > 0) {
    commInput.value = commission;

    // 3. Toggle ON karo
    const toggle = document.getElementById("broker-commission-toggle");
    if (toggle && !toggle.checked) {
      toggle.checked = true;
      // JS se .checked set karne par "change" event khud nahi chalta, isliye
      // commission-box wrapper (jo us event par show/hide hota hai) visually
      // chhupa hi reh jaata tha — seedha yahin dikha dete hain.
      const wrapper = document.getElementById("broker-commission-input");
      if (wrapper) wrapper.style.display = "block";
      // Agar aapka koi calculation function total_amount wgera calculate karta hai, toh use call kar do
      if (typeof calculateTotals === "function") calculateTotals();
    }
  }
};
// Jab bill successfully save ho jaye, tab yeh function call karein:
function checkAndSendWhatsApp(billData) {
  // Check karo ki user ne settings mein toggle ON rakha hai ya nahi
  const isAutoSendOn = localStorage.getItem("whatsapp_auto_send") === "true";

  if (!isAutoSendOn) {
    console.log("WhatsApp automation is OFF by user.");
    return; // Agar OFF hai toh kuch mat karo, seedha bahar aajao
  }

  // Kisan ka phone number aur details uthao
  let phone = billData.farmerPhone; // Jaise "9876543210"
  if (!phone) {
    alert("Kisan ka phone number nahi mila!");
    return;
  }

  // Message format jo kisan ke paas jayega
  let message =
    `Namaste Kisan Ji, ${
      globalSettings && globalSettings.companyName ? globalSettings.companyName : "Hamari Company"
    } mein aapka swagat hai. 🙏\n\n` +
    +`📋 *Bill No:* ${billData.billNo}\n` +
    `🌾 *Item:* ${billData.itemName}\n` +
    `⚖️ *Weight / Bori:* ${billData.bags} Bori (${billData.weight} Quintal)\n` +
    `💰 *Rate:* ₹${billData.rate} / Quintal\n` +
    `💵 *Total Amount:* ₹${billData.totalAmount}\n\n` +
    `Aapka maal darj ho chuka hai. Dhanyawad! - ${
      globalSettings && globalSettings.companyName ? globalSettings.companyName : "Company"
    }`;

  // URL encode karke WhatsApp Web ya API open kar do
  let encodedMessage = encodeURIComponent(message);
  let whatsappUrl = `https://wa.me/91${phone}?text=${encodedMessage}`;

  // Naye tab mein WhatsApp khol dega jisse 1 click mein message send ho jayega
  window.open(whatsappUrl, "_blank");
}

// 3. Page load par dono function chalao
document.addEventListener("DOMContentLoaded", () => {
  if (typeof setupBrokerAutoCommission === "function") setupBrokerAutoCommission();
  if (typeof setupCustomerAutoVillage === "function") setupCustomerAutoVillage();
});

// 🚨 STRICT PARTY MASTER VALIDATION (Customer + Broker)
document.addEventListener("DOMContentLoaded", () => {
  const billForm = document.getElementById("estimateForm");

  if (billForm) {
    billForm.addEventListener(
      "submit",
      function (e) {
        // Agar master list load nahi hui hai toh aage badhne do (failsafe)
        if (!window.partiesMasterList || window.partiesMasterList.length === 0) return;

        // ==========================================
        // 1. CUSTOMER / VEPARI CHECK
        // ==========================================
        const nameInput = document.querySelector('input[name="customer_name"]');
        if (nameInput) {
          const enteredName = nameInput.value.trim();
          if (enteredName) {
            const isPartyValid = window.partiesMasterList.some(
              (party) =>
                (party.type === "Farmer" || party.type === "Vepari") &&
                party.name.toLowerCase() === enteredName.toLowerCase()
            );

            if (!isPartyValid) {
              e.preventDefault();
              e.stopImmediatePropagation();
              Swal.fire({
                icon: "error",
                title: "Invalid Customer! 🚫",
                text: `"${enteredName}" Party Master mein nahi hai. Kripya sahi naam select karein.`,
                confirmButtonColor: "#d33",
              });
              return; // Galti milte hi yahin ruk jao, aage check mat karo
            }
          }
        }

        // ==========================================
        // 2. BROKER CHECK
        // ==========================================
        // (Aapke html mein jo ID/Name hai dono cover kar liye hain)
        const brokerInput =
          document.getElementById("broker_input_field") || document.querySelector('input[name="broker_name"]');

        if (brokerInput) {
          const enteredBroker = brokerInput.value.trim();

          // Sirf tab check karo jab box mein kuch likha ho (Khali box allowed hai)
          if (enteredBroker) {
            const isBrokerValid = window.partiesMasterList.some(
              (party) => party.type === "Broker" && party.name.toLowerCase() === enteredBroker.toLowerCase()
            );

            if (!isBrokerValid) {
              e.preventDefault();
              e.stopImmediatePropagation();
              Swal.fire({
                icon: "error",
                title: "Invalid Broker! 🤝🚫",
                text: `"${enteredBroker}" Broker list mein nahi hai. Kripya list me se chunein ya box khali chhod dein.`,
                confirmButtonColor: "#d33",
              });
              return; // Galti milte hi yahin ruk jao
            }
          }
        }
      },
      true // Capture phase - sabse pehle ye check hoga!
    );
  }
});
// 🚚 SMART VEHICLE NUMBER FORMATTER (Auto-Hyphen)
document.addEventListener("DOMContentLoaded", () => {
  const vehicleInput = document.querySelector('input[name="vehicle_no"]');

  if (vehicleInput) {
    vehicleInput.addEventListener("input", function () {
      // 1. Sabse pehle jo bhi likha hai usko UPPERCASE kar do
      let val = this.value.toUpperCase();

      // 2. Beech ke saare spaces aur purane hyphens hata do (Clean string)
      let clean = val.replace(/[^A-Z0-9]/g, "");

      // 3. Check karo ki kya yeh standard Indian format jaisa lag raha hai?
      // (e.g., GJ 11 AB 1234 => 2 Letters + 2 Numbers + 1-3 Letters + 4 Numbers)
      let match = clean.match(/^([A-Z]{1,2})([0-9]{1,2})?([A-Z]{1,3})?([0-9]{1,4})?$/);

      if (match) {
        // Agar standard format hai, toh apne aap hyphen (-) laga do
        let res = match[1];
        if (match[2]) res += "-" + match[2];
        if (match[3]) res += "-" + match[3];
        if (match[4]) res += "-" + match[4];
        this.value = res;
      } else {
        // 🛑 AGAR NON-STANDARD HAI (e.g. TRACTOR): Toh bina hyphen ke waisa hi rehne do
        this.value = val;
      }
    });
  }
});
// --- 🚀 HELPER FUNCTION: List mein color highlight karne ke liye ---
function setActiveItem(items, index) {
  for (let i = 0; i < items.length; i++) {
    items[i].style.background = "#fff"; // Default color
    items[i].style.color = "#333";
  }
  if (index > -1 && index < items.length) {
    items[index].style.background = "#e7f3ff"; // Select karne par Nila background
    items[index].style.color = "#005a9e";
  }
}

// ==========================================
// 1. CUSTOMER AUTOCOMPLETE (With Keyboard Support)
// ==========================================
const nameInput = document.querySelector('input[name="customer_name"]');
const villageInput = document.querySelector('input[name="village"]');
const suggestionsBox = document.getElementById("autocomplete-container");
let currentCustFocus = -1; // Keyboard index track karne ke liye

if (nameInput) {
  nameInput.addEventListener("input", () => {
    const value = nameInput.value.toLowerCase();
    suggestionsBox.innerHTML = "";
    currentCustFocus = -1; // Naya type karne par reset

    if (!value) return;

    const filteredCustomers = uniqueCustomers.filter((customer) => customer.name.toLowerCase().includes(value));

    const suggestionsList = document.createElement("div");
    suggestionsList.classList.add("autocomplete-items");
    filteredCustomers.forEach((customer) => {
      const item = document.createElement("div");
      item.innerHTML = `<strong>${customer.name}</strong> (${customer.village})`;
      item.addEventListener("click", () => {
        nameInput.value = customer.name;
        villageInput.value = customer.village;
        suggestionsBox.innerHTML = "";
      });
      suggestionsList.appendChild(item);
    });
    suggestionsBox.appendChild(suggestionsList);
  });

  // ⌨️ Customer Keyboard Controls
  nameInput.addEventListener("keydown", function (e) {
    const listDiv = suggestionsBox.querySelector(".autocomplete-items");
    if (!listDiv) return;
    const items = listDiv.getElementsByTagName("div");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      currentCustFocus++;
      if (currentCustFocus >= items.length) currentCustFocus = 0; // Wapas upar
      setActiveItem(items, currentCustFocus);
    } else if (e.key === "ArrowUp") {
      currentCustFocus--;
      if (currentCustFocus < 0) currentCustFocus = items.length - 1; // Sabse neeche
      setActiveItem(items, currentCustFocus);
    } else if (e.key === "Enter") {
      e.preventDefault(); // Enter dabane par bill form submit na ho jaye!
      if (currentCustFocus > -1) {
        items[currentCustFocus].click(); // Jo highlight hai usko click karo
      } else {
        items[0].click(); // Agar arrow use nahi kiya toh by default 1st wala select kar lo
      }
    }
  });
}

// ==========================================
// 2. BROKER AUTOCOMPLETE (With Keyboard Support)
// ==========================================
const brokerInput = document.getElementById("broker_name");
const brokerSuggestionsBox = document.getElementById("broker-suggestions");
let currentBrokerFocus = -1;

if (brokerInput && brokerSuggestionsBox) {
  brokerInput.addEventListener("input", () => {
    const value = brokerInput.value.toLowerCase();
    brokerSuggestionsBox.innerHTML = "";
    currentBrokerFocus = -1;

    if (!value) return;

    const filteredBrokers = uniqueBrokers.filter((broker) => broker.value.toLowerCase().includes(value));

    const suggestionsList = document.createElement("div");
    suggestionsList.classList.add("autocomplete-items");

    filteredBrokers.forEach((broker) => {
      const item = document.createElement("div");
      item.innerHTML = `<strong>${broker.value}</strong> ${broker.address ? `(${broker.address})` : ""}`;

      item.addEventListener("click", () => {
        brokerInput.value = broker.value;
        brokerSuggestionsBox.innerHTML = "";

        const commInput = document.querySelector('input[name="broker_commission_per_bag"]');
        const commToggle = document.getElementById("broker-commission-toggle");
        const commBox = document.getElementById("broker-commission-input");

        if (commInput && broker.defaultComm > 0) {
          commInput.value = broker.defaultComm;
          if (commToggle && !commToggle.checked) {
            commToggle.checked = true;
            if (commBox) commBox.style.display = "block";
          }
        }
      });
      suggestionsList.appendChild(item);
    });
    brokerSuggestionsBox.appendChild(suggestionsList);
  });

  // ⌨️ Broker Keyboard Controls
  brokerInput.addEventListener("keydown", function (e) {
    const listDiv = brokerSuggestionsBox.querySelector(".autocomplete-items");
    if (!listDiv) return;
    const items = listDiv.getElementsByTagName("div");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      currentBrokerFocus++;
      if (currentBrokerFocus >= items.length) currentBrokerFocus = 0;
      setActiveItem(items, currentBrokerFocus);
    } else if (e.key === "ArrowUp") {
      currentBrokerFocus--;
      if (currentBrokerFocus < 0) currentBrokerFocus = items.length - 1;
      setActiveItem(items, currentBrokerFocus);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentBrokerFocus > -1) {
        items[currentBrokerFocus].click();
      } else {
        items[0].click();
      }
    }
  });

  // Kahin aur click karne par dropdown hide karna
  document.addEventListener("click", (e) => {
    if (e.target !== brokerInput && brokerSuggestionsBox) {
      brokerSuggestionsBox.innerHTML = "";
    }
  });
}
