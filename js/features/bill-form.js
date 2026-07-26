let uniqueCustomers = []; // To hold our customer list
async function setupAutocomplete() {
  // 1. Get the customer list directly from the Firestore 'customers' collection
  try {
    const snapshot = await db.collection("customers").get();
    uniqueCustomers = snapshot.docs.map((doc) => doc.data());
  } catch (error) {
    console.error("Could not fetch customer list for autocomplete:", error);
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
    billsCollection
      .doc(editId)
      .get()
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

function populateFormForEdit(data) {
  const form = document.getElementById("estimateForm");
  form.dataset.editId = data.id;
  editModeLastUpdatedAt = data.lastUpdatedAt || null;

  // Safer way to set values, provides a fallback for missing data
  document.querySelector('input[name="customer_name"]').value = (data["Customer Name"] || "").toUpperCase();
  document.querySelector('input[name="vehicle_no"]').value = (data["Vehicle No"] || "").toUpperCase();
  document.querySelector('input[name="village"]').value = (data["Village"] || "").toUpperCase();
  document.querySelector('input[name="broker"]').value = (data["Broker"] || "").toUpperCase();
  document.querySelector('input[name="weighbridge_weight"]').value = data["Weighbridge Weight"] || 0;
  document.querySelector('input[name="truck_freight"]').value = data["Truck Freight"] || 0;

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
  // so the user clearly sees they are editing an existing bill.
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
}

/**
 * Cancels edit mode and resets the form back to "New Bill" state.
 */
function cancelEditMode() {
  const form = document.getElementById("estimateForm");
  delete form.dataset.editId;
  editModeLastUpdatedAt = null;
  form.reset();

  const formCard = document.getElementById("bill_creation_form");
  if (formCard) formCard.classList.remove("edit-mode-active");

  const banner = document.getElementById("edit-mode-banner");
  if (banner) banner.remove();

  document.querySelector('button[type="submit"]').textContent = "🧾 Generate Bill";
  initializeIndexPage(); // re-apply default date, reset expense rows, etc.
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
    data["Vakal 1 Variety"] = (formData.get("vakal_1_variety") || "").trim();
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
      {
        katta: Number(formData.get("vakal_1_katta")) || 0,
        bhav: Number(formData.get("vakal_1_bhav")) || 0,
        variety: (formData.get("vakal_1_variety") || "").trim(),
      },
      {
        katta: Number(formData.get("vakal_2_katta")) || 0,
        bhav: Number(formData.get("vakal_2_bhav")) || 0,
        variety: (formData.get("vakal_2_variety") || "").trim(),
      },
      {
        katta: Number(formData.get("vakal_3_katta")) || 0,
        bhav: Number(formData.get("vakal_3_bhav")) || 0,
        variety: (formData.get("vakal_3_variety") || "").trim(),
      },
      {
        katta: Number(formData.get("vakal_4_katta")) || 0,
        bhav: Number(formData.get("vakal_4_bhav")) || 0,
        variety: (formData.get("vakal_4_variety") || "").trim(),
      },
      {
        katta: Number(formData.get("vakal_5_katta")) || 0,
        bhav: Number(formData.get("vakal_5_bhav")) || 0,
        variety: (formData.get("vakal_5_variety") || "").trim(),
      },
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
      data[`Vakal ${i + 1} Variety`] = vakals[i].variety;
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
  data["Broker"] = formData.get("broker");
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

      templateDeductions.forEach((d) => {
        let impact = 0;

        if (d.stage === "weight") {
          // Weight-based: % of Weight | Fixed/Bag | Fixed/Kg
          if (d.type === "pct_weight") {
            impact = customRound(data["Weighbridge Weight"] * (d.value / 100));
          } else if (d.type === "fixed_bag") {
            const totalBags = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
            impact = customRound(totalBags * d.value);
          } else if (d.type === "fixed_kg") {
            impact = customRound(net_vajan * d.value);
          }
          extraWeightCutKg += d.applyAs === "add" ? -impact : impact;
        } else {
          // Amount-based: % of Amount | Fixed Amount
          if (d.type === "pct_amount") {
            impact = customRound(finaltotal * (d.value / 100));
          } else if (d.type === "fixed_amt") {
            impact = d.value;
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
  const applyBrokerCommission = formData.get("apply_broker_commission") !== null;
  const commissionPerBag = Number(formData.get("broker_commission_per_bag")) || 0;
  if (applyBrokerCommission && commissionPerBag > 0 && data["Broker"]) {
    const totalBags = [1, 2, 3, 4, 5].reduce((s, i) => s + (data[`Vakal ${i} Katta`] || 0), 0);
    const totalCommission = Math.round(totalBags * commissionPerBag);
    data["BrokerCommission"] = totalCommission;
    data["BrokerCommissionPerBag"] = commissionPerBag;
    data["Final Total"] = data["Final Total"] - totalCommission;
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

    // Save or update the customer in the 'customers' collection
    const customerName = data["Customer Name"];
    const customerVillage = data["Village"];
    let customerId = null;
    if (customerName) {
      customerId = customerName.toLowerCase().replace(/\s+/g, "");
      const customerRef = db.collection("customers").doc(customerId);
      await customerRef.set(
        {
          name: customerName,
          village: customerVillage,
        },
        { merge: true }
      );
      // Phase 2 (item #10): save customerId on the bill itself so ledger.js
      // can group transactions by a stable ID instead of by Name (names can
      // have typos/casing differences across bills — the ID never drifts).
      data["customerId"] = customerId;
    }

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

    window.location.href = `final.html?id=${docRef.id}`;
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
