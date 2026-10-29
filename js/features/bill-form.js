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

  const now = MandiFinancialYear.parseDate(document.getElementById("bill_date_input")?.value);
  if (!now) { previewEl.textContent = "Select a valid bill date to see its financial-year series."; return; }
  let year = now.getFullYear();
  const month = now.getMonth();
  if (month < 3) year = year - 1;
  const shortYear = year.toString().slice(-2);
  const nextShortYear = (year + 1).toString().slice(-2);
  const financialYearId = `FY${shortYear}${nextShortYear}`;

  const seriesPrefix = window.activeTemplate?.seriesPrefix?.trim() || "";
  if (!seriesPrefix) {
    previewEl.textContent = "⚠️ Product template select karo — tabhi bill number generate hoga.";
    return;
  }
  const counterDocId = `billCounter_${seriesPrefix}_${financialYearId}`;

  previewEl.textContent = "⏳ Agla bill number check ho raha hai...";

  try {
    const counterDoc = await db.collection("counters").doc(counterDocId).get();
    const lastNumber = counterDoc.exists ? counterDoc.data().currentNumber : 0;
    const nextNumber = lastNumber + 1;
    const paddedNext = String(nextNumber).padStart(5, "0");
    const nextBillNo = `${seriesPrefix}-${shortYear}${nextShortYear}-${paddedNext}`;
    const lastBillText =
      lastNumber > 0
        ? `${seriesPrefix}-${shortYear}${nextShortYear}-${String(lastNumber).padStart(5, "0")}`
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

// Show the required-template prompt on load, and refresh it after a template
// or edit record is loaded.
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(updateSeriesPreview, 300);
});

let uniqueCustomers = []; // To hold our customer list
let uniqueBrokers = []; // 🚀 YE NAYI LINE ADD KARNI HAI
let billDraft = null;
let billSaveRef = null;
let billCommittedId = null;

function openConfirmedBill(url) {
  // A saved bill is safe to open even while the visual progress UI is cleaning up.
  // Manual refresh/close while a save is still pending remains protected.
  billDraft?.saved();
  window.MandiFormSafety?.allowConfirmedNavigation?.();
  window.location.href = url;
}
let billFormReady = false;
let billTemplatesReady = false;
let billEditReady = !new URLSearchParams(location.search).has("editId") && !new URLSearchParams(location.search).has("correctionOf");

function initializeBillDraft() {
  const form = document.getElementById("estimateForm");
  if (!form || billDraft || !billFormReady || !billTemplatesReady || !billEditReady) return;
  const kind = "bill:" + (form.dataset.editId ? "edit:" + form.dataset.editId : form.dataset.correctionOf ? "correction:" + form.dataset.correctionOf : "new");
  billDraft = window.MandiFormSafety?.createDraft({
    container: form, kind,
    capture: () => ({ fields: MandiFormSafety.fields(form),
      templateId: window.activeTemplate?.id || "", template: JSON.stringify(window.activeTemplate || null),
      expenses: form.querySelectorAll(".expense-row").length,
      version: JSON.stringify(editModeLastUpdatedAt), requestId: billSaveRef?.id || "",
      closeOrder: document.getElementById("close_order_checkbox")?.checked || false,
    }),
    restore: async data => {
      if (!Array.isArray(data.fields) || data.fields.length > 500 || !Number.isInteger(data.expenses) || data.expenses < 0 || data.expenses > 100) throw new Error("Invalid draft structure. Saved copy retained.");
      if (form.dataset.editId && data.version !== JSON.stringify(editModeLastUpdatedAt)) throw new Error("This bill changed since the draft was made. Review the fresh bill; the draft was not applied.");
      const template = window.getBillTemplateSnapshot?.(data.templateId);
      if (data.templateId && (!template || JSON.stringify(template) !== data.template)) throw new Error("The product template changed or is unavailable. This draft was not applied; review the template first.");
      if (data.templateId) window.selectProductTemplateForBill({ id: data.templateId });
      else {
        window.activeTemplate = null;
        renderTemplateDeductionsInForm();
      }
      const expenses = document.getElementById("expense_list");
      expenses.replaceChildren();
      for (let i = 0; i < data.expenses; i++) addExpense();
      for (const name of ["linked_order_id", "linked_supplier_idx", "linked_order_supplier_links"]) {
        if (!form.querySelector(`[name="${name}"]`) && data.fields.some(field => field.key === `name:${name}`)) {
          const field = document.createElement("input"); field.type = "hidden"; field.name = name;
          field.id = { linked_order_id: "linked-order-id", linked_supplier_idx: "linked-supplier-idx", linked_order_supplier_links: "linked-order-supplier-links" }[name];
          form.append(field);
        }
      }
      MandiFormSafety.restoreFields(form, data.fields);
      const closeOrder = document.getElementById("close_order_checkbox");
      if (closeOrder) closeOrder.checked = !!data.closeOrder;
      const linked = form.querySelector('[name="linked_order_id"]')?.value;
      const orderInfo = document.getElementById("order-link-info");
      if (orderInfo && linked) { orderInfo.style.display = "block"; orderInfo.textContent = "Linked order restored from draft. Review this order before generating the bill."; }
      const closeWrap = document.getElementById("close-order-wrap");
      if (closeWrap) closeWrap.style.display = linked ? "flex" : "none";
      if (/^[A-Za-z0-9]{20}$/.test(data.requestId || "")) billSaveRef = billsCollection.doc(data.requestId);
      updateTotalBags(); updateExpensesSubtotal(); updateLiveBillSummary();
    },
  });
}
document.addEventListener("mandibook:product-templates-ready", () => { billTemplatesReady = true; initializeBillDraft(); });
window.addEventListener("mandibook:access-ready", initializeBillDraft);
function lockSelectedCustomer(customer) {
  const name = document.querySelector('input[name="customer_name"]');
  const village = document.querySelector('input[name="village"]');
  const id = document.getElementById("selected_customer_id");
  const changeBtn = document.getElementById("change-customer-btn");
  if (!name || !village || !customer) return;
  name.value = customer.name || "";
  village.value = customer.village || customer.address || "";
  if (id) id.value = customer.id || "";
  name.readOnly = true;
  village.readOnly = true;
  if (changeBtn) changeBtn.style.display = "inline-block";
}

function unlockCustomerSelection() {
  const name = document.querySelector('input[name="customer_name"]');
  const village = document.querySelector('input[name="village"]');
  const id = document.getElementById("selected_customer_id");
  const changeBtn = document.getElementById("change-customer-btn");
  if (name) {
    name.readOnly = false;
    name.value = "";
    name.focus();
  }
  if (village) {
    village.readOnly = true;
    village.value = "";
  }
  if (id) id.value = "";
  if (changeBtn) changeBtn.style.display = "none";
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("change-customer-btn")?.addEventListener("click", unlockCustomerSelection);
});
async function setupAutocomplete() {
  try {
    // 1. Bina kisi strict condition ke saara data fetch karo (Safe approach)
    const snapshot = await db.collection("parties").get();

    // 2. JS mein filter karo taaki agar 'deleted' field na bhi ho toh error na aaye
    window.partiesMasterList = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((p) => p.deleted !== true);

    // 3. Filter and Map (Spelling/Small-Capitalization ki galti handle karne ke liye)
    uniqueCustomers = window.partiesMasterList
      .filter((p) => {
        // Type ko lowercase karke check karenge taaki small/capital ka lafda na rahe
        const type = (p.type || "").toLowerCase();
        return ["farmer", "vepari", "kisan", "customer", "buyer", "supplier"].includes(type);
      })
      .map((p) => ({
        ...p,
        customer_name: p.name || "",
        village: p.address || "",
      }));

    // Broker directory stores records separately from Party Master.
    const brokerSnapshot = await db.collection("brokers").get();
    const brokerMap = new Map();
    const records = [
      ...window.partiesMasterList.filter(p => String(p.type || "").trim().toLowerCase() === "broker"),
      ...brokerSnapshot.docs.map(doc => doc.data()),
    ];
    records.forEach(p => {
      const name = String(p.name || "").trim();
      if (!name || p.deleted === true) return;
      const key = name.toUpperCase().replace(/\s+/g, " ");
      if (!brokerMap.has(key)) brokerMap.set(key, {
        value: name, address: p.address || "", defaultComm: Number(p.defaultComm) || 0,
      });
    });
    uniqueBrokers = Array.from(brokerMap.values());
    const brokerInput = document.getElementById("broker_name");
    const box = document.getElementById("broker-suggestions");
    if (brokerInput && box) {
      const showSuggestions = () => {
        const value = brokerInput.value.trim().toLowerCase();
        box.innerHTML = "";
        const matches = uniqueBrokers.filter(broker => broker.value.toLowerCase().includes(value));
        box.style.display = "block";
        const list = document.createElement("div");
        list.className = "autocomplete-items";
        if (!matches.length) {
          const empty = document.createElement("div");
          empty.textContent = "No matching saved broker.";
          list.appendChild(empty);
        }
        matches.forEach(broker => {
          const item = document.createElement("button");
          item.type = "button";
          item.style.cssText = "display:block;width:100%;text-align:left;padding:10px 14px;background:white;color:#005a9e;border:0;border-bottom:1px solid #e6edf4;cursor:pointer";
          item.textContent = broker.value + (broker.address ? " (" + broker.address + ")" : "");
          item.addEventListener("click", () => {
            window.applyBrokerDetails(broker.value, broker.defaultComm);
            brokerInput.dispatchEvent(new Event("change", { bubbles: true }));
          });
          list.appendChild(item);
        });
        box.appendChild(list);
      };
      brokerInput.addEventListener("input", showSuggestions);
      brokerInput.addEventListener("focus", showSuggestions);
      document.addEventListener("click", event => {
        if (event.target !== brokerInput && !box.contains(event.target)) box.style.display = "none";
      });
      document.addEventListener("focusin", event => {
        if (event.target !== brokerInput && !box.contains(event.target)) box.style.display = "none";
      });
      brokerInput.addEventListener("keydown", event => {
        if (event.key === "Escape") box.style.display = "none";
      });
      if (document.activeElement === brokerInput) showSuggestions();
    }
  } catch (error) {
    console.error("Could not fetch party list for autocomplete:", error);
    const box = document.getElementById("broker-suggestions");
    if (box) {
      box.textContent = "Broker list could not load. Please reload the page and try again.";
      box.style.display = "block";
    }
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
      item.innerHTML = `<strong>${escapeHtml(customer.name)}</strong> (${escapeHtml(customer.village)})`;
      item.addEventListener("click", () => {
        lockSelectedCustomer(customer);
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
  dateInput?.addEventListener("change", updateSeriesPreview);
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
  const correctionOf = urlParams.get("correctionOf");
  if (editId || correctionOf) {
    const sourceBillId = editId || correctionOf;
    const loadingMessage = editId ? "Loading bill for editing..." : "Loading bill to create a correction...";
    showLoading(loadingMessage);
    // BUG FIX: iske bina, offline-cache wala purana/pending data mil sakta
    // tha, jiska "lastUpdatedAt" save ke time transaction se fresh-padhe
    // gaye server data se match nahi karta — aur system galti se "kisi aur
    // ne bill change kar diya" (Conflict) ya "Bill not found" jaisa error
    // de deta tha, jabki asal mein kuch bhi galat nahi hua tha. Ab pehle
    // seedha server se fresh padhte hain; agar genuinely offline ho tabhi
    // cache wale purane data par fallback karte hain.
    billsCollection
      .doc(sourceBillId)
      .get({ source: "server" })
      .catch(() => billsCollection.doc(sourceBillId).get())
      .then((doc) => {
        if (doc.exists) {
          const saved = doc.data();
          if (editId && (saved.locked === true || ['approved', 'locked'].includes(saved.workflowStatus))) {
            Swal.fire("Approved bill protected", "Approved bills cannot be edited. The original date, items and amounts must remain unchanged.", "info");
            document.getElementById("estimateForm")?.querySelector('[type="submit"]')?.setAttribute("disabled", "disabled");
            window.location.replace(`final.html?id=${encodeURIComponent(doc.id)}`);
            return;
          }
          populateFormForEdit({ ...doc.data(), id: doc.id }, { correction: Boolean(correctionOf) });
          billEditReady = true;
          initializeBillDraft();
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
  billFormReady = true;
  initializeBillDraft();
}

function updateLiveBillSummary() {
  const form = document.getElementById("estimateForm");
  const status = document.getElementById("live-bill-status");
  const netWeight = document.getElementById("live-net-weight");
  const finalTotal = document.getElementById("live-final-total");
  if (!form || !status || !netWeight || !finalTotal) return;

  const weight = Number(form.elements.weighbridge_weight?.value || 0);
  if (!weight) {
    status.textContent = "Add weight and item details to preview totals.";
    netWeight.textContent = "0 kg";
    finalTotal.textContent = "₹0";
    return;
  }

  try {
    const data = calculateBillData(new FormData(form));
    const net = Number(data["Net Weight"] || 0);
    const total = Number(data["Final Total"] || 0);
    netWeight.textContent = `${net.toLocaleString("en-IN")} kg`;
    finalTotal.textContent = `₹${total.toLocaleString("en-IN")}`;
    status.textContent = "Preview only — final total is checked again when you save.";
  } catch (error) {
    netWeight.textContent = "—";
    finalTotal.textContent = "—";
    status.textContent = "Complete the required details to preview the final total.";
  }
}

// Keep the last fields reachable beneath the phone action bar even when its
// status text, totals, orientation or preferred text size changes.
function initializeBillActionLayout() {
  const workspace = document.querySelector(".bill-workspace");
  const actions = workspace?.querySelector(".form-submit-area");
  if (!workspace || !actions || actions.dataset.layoutObserved) return;
  actions.dataset.layoutObserved = "true";
  const measure = () => {
    workspace.style.setProperty("--bill-actions-height", `${Math.ceil(actions.getBoundingClientRect().height)}px`);
  };
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
  } else {
    window.addEventListener("resize", measure);
  }
  measure();
}

function initializeBillWorkspace() {
  const form = document.getElementById("estimateForm");
  if (!form) return;
  const workspace = document.querySelector(".bill-workspace");
  const layoutPicker = document.getElementById("bill-layout-picker");
  const classicLayoutSwitch = document.getElementById("classic-layout-switch");
  const savedLayout = localStorage.getItem("mandibook_bill_layout") || "professional";
  const applyLayout = (layout) => {
    const selected = layout === "classic" ? "classic" : "professional";
    document.body.dataset.billLayout = selected;
    if (workspace) workspace.dataset.layout = selected;
    if (layoutPicker) layoutPicker.value = selected;
  };
  applyLayout(savedLayout);
  initializeBillActionLayout();
  if (layoutPicker) {
    layoutPicker.addEventListener("change", () => {
      const selected = layoutPicker.value === "classic" ? "classic" : "professional";
      localStorage.setItem("mandibook_bill_layout", selected);
      applyLayout(selected);
    });
  }
  if (classicLayoutSwitch) {
    classicLayoutSwitch.addEventListener("click", () => {
      localStorage.setItem("mandibook_bill_layout", "professional");
      applyLayout("professional");
    });
  }
  const refresh = () => window.requestAnimationFrame(updateLiveBillSummary);
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  updateLiveBillSummary();
}
// Phase 3 (item #13): Optimistic Concurrency — captures the bill's
// lastUpdatedAt timestamp at the moment the edit form is opened, so
// updateData() can detect if someone else saved a change to the SAME bill
// while this form was open (prevents silently overwriting their edit).
let editModeLastUpdatedAt = null;

window.cancelEditMode = function () {
  if (window.MandiFormSafety?.isBusy("bill")) return;
  if (billDraft && !billDraft.confirmLeave()) return;
  billDraft?.dispose(); billDraft = null;
  // Start with a fresh form and URL; don't mix edit/correction drafts into new bills.
  window.location.href = "bill-create.html";
  return;
  console.log("Cancel Edit trigger hua! 🚀"); // Debugging ke liye (console mein check karna)

};

function populateFormForEdit(data, options = {}) {
  const form = document.getElementById("estimateForm");
  const isCorrection = options.correction === true;
  if (isCorrection) {
    form.dataset.correctionOf = data.id;
    delete form.dataset.editId;
  } else {
    form.dataset.editId = data.id;
    editModeLastUpdatedAt = data.lastUpdatedAt || null;
  }
  updateSeriesPreview();
  const selectSavedTemplate = () =>
    typeof window.selectProductTemplateForBill === "function" &&
    window.selectProductTemplateForBill({ id: data.ProductTemplateId || "", name: data["ProductTemplate"] || "" });
  if (!selectSavedTemplate()) {
    document.addEventListener("mandibook:product-templates-ready", selectSavedTemplate, { once: true });
  }

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
      const varietyInput = document.querySelector(`input[name="vakal_${i}_variety"]`);
      if (varietyInput) varietyInput.value = data[`Vakal ${i} Variety`] || "";
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

  document.querySelector('button[type="submit"]').textContent = isCorrection
    ? "📝 Create Correction Bill"
    : "✏️ Update Bill";

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
  banner.innerHTML = isCorrection
    ? `📝 Correction for locked Bill <strong>#${data["Serial No"] || ""}</strong> — a new bill number will be created.
      <button type="button" onclick="cancelEditMode()" class="edit-cancel-btn">Cancel Correction</button>`
    : `✏️ Editing Bill <strong>#${data["Serial No"] || ""}</strong> —
      <button type="button" onclick="cancelEditMode()" class="edit-cancel-btn">Cancel Edit</button>`;

  // 🔒 Edit mode mein Product/Template dropdown ko disable kar do taaki koi change na kar sake
  const templateDropdown = document.querySelector('#product, #productTemplate, #productId, select[name="product"]');
  if (templateDropdown && !isCorrection) {
    templateDropdown.disabled = true;
    templateDropdown.title = "Edit mode mein product template change nahi kar sakte";
  }

  // --- Yeh sabse last mein daalna hai, function ke khatam hone se pehle ---
  if (!isCorrection && data.revisionPending) {
    const note = document.createElement("p");
    note.textContent = `Revision ${data.revisionNumber}: ${data.revisionReason}. Save, then review and re-approve on the bill page.`;
    banner.appendChild(note);
    if (Number(data.amountPaid || 0) > 0 || ["Paid", "Partial", "Partially Paid"].includes(data.paymentStatus)) {
      form.dataset.metadataRevision = "true";
      form.querySelectorAll("input, select, textarea").forEach(el => {
        if (el.id !== "bill_date_input" && el.name !== "bill_remarks") el.disabled = true;
      });
      note.textContent += " Payments exist: only date and remarks can change.";
    }
  }
  const loader = document.getElementById("global-loader-ui");
  if (loader) {
    loader.style.display = "none";
  }
}

function updateTotalBags() {
  let total = 0;
  const bagInputs = document.querySelectorAll('#vakal_section input[name$="_katta"]');
  bagInputs.forEach((input) => {
    // Match the save-time guard (nonNegativeNumber in calculateBillData) —
    // otherwise this live preview can show a misleading negative total
    // while typing, even though a negative value never actually makes it
    // into the saved bill.
    const val = Number(input.value);
    total += !isFinite(val) || val < 0 ? 0 : val;
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
    const val = Number(input.value);
    total += !isFinite(val) || val < 0 ? 0 : val;
  });
  document.getElementById("expenses-subtotal").textContent = `₹${total.toLocaleString("en-IN")}`;
}
function addExpense(name = "", amount = "") {
  const expenseList = document.getElementById("expense_list");
  if (!expenseList) return;
  const newRow = document.createElement("div");
  newRow.classList.add("expense-row");
  newRow.innerHTML = `
        <input type="text" name="expense_name" placeholder="ખર્ચનું નામ (Expense Name)" value="${escapeHtml(name)}">
        <input type="number" name="expense_amount" min="0" placeholder="રકમ (Amount)" value="${escapeHtml(amount)}">
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

// Defense-in-depth: the HTML min="0" attribute on rate/quantity fields
// stops normal typing, but doesn't stop a bypassed/scripted form submit.
// This clamps any negative value to 0 before it ever reaches a bill
// total — so a negative Katta/Bhav/Price can never silently produce a
// wrong (or fraudulently reduced) Final Total.
function nonNegativeNumber(value) {
  const n = Number(value);
  return !isFinite(n) || n < 0 ? 0 : n;
}

// Same idea, but also caps at 100 — for moisture/percentage fields, where
// a value above 100% is just as nonsensical as a negative one and could
// otherwise blow up a bill's deductions.
function clampPercent(value) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
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
  const weighbridgeMoisturePct = clampPercent(formData.get("weighbridge_moisture_pct"));
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
    const weight = nonNegativeNumber(formData.get("weighbridge_weight"));
    const price = nonNegativeNumber(formData.get("loose_price"));
    const katta_kasar = deductKasar ? customRound(weight * globalSettings.kasarPercentage) : 0;
    const wb_moisture_kg = deductWeighbridgeMoisture ? customRound(weight * (weighbridgeMoisturePct / 100)) : 0;
    net_vajan = customRound(weight - katta_kasar - wb_moisture_kg);

    // Vakal moisture for loose
    const vakal_moisture_pct_1 = deductVakalMoisture ? clampPercent(formData.get("vakal_1_moisture")) : 0;
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
    const weighbridge_weight = nonNegativeNumber(formData.get("weighbridge_weight"));
    const bharela_600 = nonNegativeNumber(formData.get("bharela_600"));
    const khali_600 = nonNegativeNumber(formData.get("khali_600"));
    const bharela_200 = nonNegativeNumber(formData.get("bharela_200"));
    const khali_200 = nonNegativeNumber(formData.get("khali_200"));

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
        katta: nonNegativeNumber(formData.get("vakal_1_katta")),
        bhav: nonNegativeNumber(formData.get("vakal_1_bhav")),
        variety: formData.get("vakal_1_variety") || "",
      },
      {
        katta: nonNegativeNumber(formData.get("vakal_2_katta")),
        bhav: nonNegativeNumber(formData.get("vakal_2_bhav")),
        variety: formData.get("vakal_2_variety") || "",
      },
      {
        katta: nonNegativeNumber(formData.get("vakal_3_katta")),
        bhav: nonNegativeNumber(formData.get("vakal_3_bhav")),
        variety: formData.get("vakal_3_variety") || "",
      },
      {
        katta: nonNegativeNumber(formData.get("vakal_4_katta")),
        bhav: nonNegativeNumber(formData.get("vakal_4_bhav")),
        variety: formData.get("vakal_4_variety") || "",
      },
      {
        katta: nonNegativeNumber(formData.get("vakal_5_katta")),
        bhav: nonNegativeNumber(formData.get("vakal_5_bhav")),
        variety: formData.get("vakal_5_variety") || "",
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
      data[`Vakal ${i + 1} Variety`] = vakals[i].variety.trim();
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
  const truckFreight = nonNegativeNumber(formData.get("truck_freight"));

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
    data.ProductTemplateId = window.activeTemplate.id || "";
    data.ProductTemplatePrefix = window.activeTemplate.seriesPrefix || "";
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
        ? nonNegativeNumber(formData.get("loose_price"))
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
    const now = MandiFinancialYear.parseDate(document.getElementById("bill_date_input")?.value);
    if (!now) throw new Error("VALIDATION_ERROR: Select a valid bill date.");
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
  if (billCommittedId) { openConfirmedBill(`final.html?id=${billCommittedId}`); return; }
  const form = document.getElementById("estimateForm");
  const isNewBill = !form.dataset.editId && !form.dataset.correctionOf;
  const selectedTemplate = window.activeTemplate;
  if (isNewBill && (!selectedTemplate?.id || !selectedTemplate.seriesPrefix?.trim())) {
    const productSelect = document.getElementById("product-template-select");
    Swal.fire({
      icon: "warning",
      title: "Product template required",
      text: "Bill banane se pehle product template select karo. Isi template ki series se bill number generate hoga.",
      confirmButtonColor: "#005a9e",
    }).then(() => productSelect?.focus());
    return;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  const operation = MandiFormSafety.begin("bill", { container: form, button: submitButton, label: "Saving bill" });
  if (!operation) return;
  showLoading("Saving bill — waiting for server confirmation...");

  try {
    // Use the bill date, never the computer date, for its number series.
    const now = MandiFinancialYear.parseDate(document.getElementById("bill_date_input")?.value);
    if (!now) throw new Error("VALIDATION_ERROR: Select a valid bill date.");
    let year = now.getFullYear();
    const month = now.getMonth(); // 0 = January, 3 = April

    if (month < 3) {
      // If the month is Jan, Feb, or Mar...
      year = year - 1; // ...it's part of the previous financial year
    }
    const shortYear = year.toString().slice(-2);
    const nextShortYear = (year + 1).toString().slice(-2);
    const financialYearId = `FY${shortYear}${nextShortYear}`; // e.g., "FY2526"

    // --- Phase 1: A product template and its series prefix are mandatory. ---
    // This defensive guard prevents a caller/draft from ever falling back to
    // the old generic YY/MM series after the form-level validation above.
    const seriesPrefix = window.activeTemplate?.seriesPrefix?.trim() || "";
    if (!seriesPrefix) throw new Error("VALIDATION_ERROR: Select a product template with a bill series before generating the bill.");
    // Each product series gets its own independent counter so numbering
    // doesn't clash between e.g. Wheat (WH-...) and Groundnut (GN-...).
    const counterDocId = `billCounter_${seriesPrefix}_${financialYearId}`;

    // 2. Set the correct counter document reference
    const counterRef = db.collection("counters").doc(counterDocId);

    const formData = new FormData(form);
    let data = calculateBillData(formData);
    const correctionOf = form.dataset.correctionOf || "";
    let correctionSource = null;
    if (correctionOf) {
      const sourceBill = await billsCollection
        .doc(correctionOf)
        .get({ source: "server" })
        .catch(() => billsCollection.doc(correctionOf).get());
      if (!sourceBill.exists) throw new Error("VALIDATION_ERROR: Original bill for this correction was not found.");
      correctionSource = sourceBill.data();
      if (correctionSource.locked !== true && correctionSource.workflowStatus !== "locked") {
        throw new Error("VALIDATION_ERROR: Corrections can only be created from a locked bill.");
      }
    }

    // 📍 Yahin par (calculateBillData ke turant baad) ye 3 line daal deni hain:
    const matchedCustomer = (window.partiesMasterList || []).find((party) => {
      const type = (party.type || "").toLowerCase();
      return (
        ["farmer", "vepari", "kisan", "customer", "buyer", "supplier"].includes(type) &&
        (party.name || "").trim().toLowerCase() === (data["Customer Name"] || "").trim().toLowerCase()
      );
    });
    const customerId = formData.get("customer_id") || data.customerId || (matchedCustomer && matchedCustomer.id) || "";
    const customerName = formData.get("customer_name") || data["Customer Name"] || "";
    const customerVillage = formData.get("village") || data["Village"] || "N/A";
    data.customerId = customerId;

    // Save or update the customer in the 'customers' collection

    // --- 🔒 ATOMIC: counter increment + bill creation + party balance,
    // all in one transaction. Previously the counter/serial-number step
    // was its own transaction, then billsCollection.add() ran separately,
    // then the party-balance update ran as a THIRD separate step (only
    // wrapped in its own try/catch that just logged a warning on
    // failure). A crash/network drop between any of those could leave a
    // bill created with the customer's balance never updated to match —
    // same bug class already fixed for payments, now closed here too. ---
    const billRef = billSaveRef ||= billsCollection.doc();
    billDraft?.touch(); billDraft?.flush();
    const partyRef = customerId ? db.collection("parties").doc(customerId) : null;
    const linkedOrderId = formData.get("linked_order_id") || "";
    const linkedOrderRef = linkedOrderId ? db.collection("orders").doc(linkedOrderId) : null;

    const { alreadySaved = false } = await db.runTransaction(async (transaction) => {
      await MandiFinancialYear.assertPostingOpen(db, transaction, [data.Date]);
      // READS FIRST (Firestore transactions require this)
      const existing = await transaction.get(billRef);
      if (existing.exists) return { alreadySaved: true };
      const counterDoc = await transaction.get(counterRef);
      const partyDoc = partyRef ? await transaction.get(partyRef) : null;
      const linkedOrder = linkedOrderRef ? await transaction.get(linkedOrderRef) : null;
      if (linkedOrderRef && (!linkedOrder.exists || !["Pending", "Partial"].includes(linkedOrder.data().status))) {
        throw new Error("VALIDATION_ERROR: This order is no longer pending/partial. Reload and review it before billing.");
      }

      // COMPUTE
      const newCounterValue = counterDoc.exists ? counterDoc.data().currentNumber + 1 : 1;
      const paddedSerialNo = String(newCounterValue).padStart(5, "0");
      const formattedBillNo = `${seriesPrefix}-${shortYear}${nextShortYear}-${paddedSerialNo}`;

      data["Serial No"] = formattedBillNo;
      data["LinkedOrderId"] = formData.get("linked_order_id") || "";
      data["LinkedSupplierIdx"] = formData.get("linked_supplier_idx") || "";
      try {
        data.OrderSupplierLinks = JSON.parse(formData.get("linked_order_supplier_links") || "[]");
      } catch (_) {
        data.OrderSupplierLinks = [];
      }
      if (correctionOf) {
        data.correctsBillId = correctionOf;
        data["Corrects Bill No"] = correctionSource["Serial No"] || "";
      }
      data.workflowStatus = "draft";
      data.locked = false;
      data["createdAt"] = firebase.firestore.FieldValue.serverTimestamp();
      data["lastUpdatedAt"] = firebase.firestore.FieldValue.serverTimestamp();

      if (linkedOrder) {
        if (!window.MandiOrderSync) throw new Error("Order sync module is unavailable. Reload the page.");
        // Reject ambiguous mappings / Loose bills against Bag orders before saving.
        MandiOrderSync.deliveredSuppliers(linkedOrder.data(), [data]);
      }

      // WRITES LAST
      transaction.set(counterRef, { currentNumber: newCounterValue });
      transaction.set(billRef, data);
      if (linkedOrderRef) {
        // The bill and its order index commit together; a failed follow-up cannot
        // leave a saved bill invisible to the order's payment/delivery summaries.
        transaction.update(linkedOrderRef, {
          linkedBillNos: MandiOrderSync.serials(linkedOrder.data(), data["Serial No"]),
          updatedAt: Date.now(),
        });
      }

      let didUpdateBalance = false;
      if (partyRef && partyDoc && partyDoc.exists) {
        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, {
          currentBalance: roundCurrency(currentBalance + Number(data["Final Total"] || 0)),
          lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        didUpdateBalance = true;
      }

      return { newSerialNo: newCounterValue, balanceUpdated: didUpdateBalance };
    });

    billCommittedId = billRef.id;
    billDraft?.saved();
    operation.message("Bill saved. Finishing linked updates; do not create it again.", true);
    if (alreadySaved) {
      operation.finish("This bill was already saved. Opening its details.");
      openConfirmedBill(`final.html?id=${billRef.id}`);
      return;
    }

    const docRef = billRef;
    await recordAudit(correctionOf ? "bill.correction_created" : "bill.created", "bill", docRef.id, {
      after: billAuditSnapshot(data),
      reason: correctionOf ? `Correction of bill ${data["Corrects Bill No"] || correctionOf}` : "",
    });

    if (data["LinkedOrderId"]) {
      const closeOrderOverride = document.getElementById("close_order_checkbox")?.checked || false;
      await updateOrderDeliveredQty(data, closeOrderOverride);
    }
    if (typeof updateBrokerCommission === "function") {
      await updateBrokerCommission(data);
    }

    await checkAndSendWhatsApp(data, docRef.id);
    openConfirmedBill(`final.html?id=${docRef.id}`);
  } catch (error) {
    hideLoading();
    if (billCommittedId) {
      operation.finish("Bill saved; a follow-up update needs review.", "warning");
      await Swal.fire("Bill saved — follow-up needs review", "The bill is saved. A linked order, commission or sharing update did not finish. Do not create this bill again; review its details and linked records.", "warning");
      openConfirmedBill(`final.html?id=${billCommittedId}`);
      return;
    }
    operation.fail(error);
    if (error.message && error.message.startsWith("VALIDATION_ERROR:")) {
      const msg = error.message.replace("VALIDATION_ERROR: ", "");
      Swal.fire({ icon: "error", title: "⚠️ Validation Error", text: msg, confirmButtonColor: "#005a9e" });
    } else {
      console.error("Transaction failed or error adding document: ", error);
      Swal.fire("Bill not confirmed", MandiFormSafety.errorMessage(error), "error");
    }
  } finally {
    operation.finish(billCommittedId ? "Bill saved and confirmed by the server." : "Review your inputs before retrying.", billCommittedId ? "success" : "error");
    hideLoading();
  }
}
async function updateData(docId) {
  if (billCommittedId) { openConfirmedBill(`final.html?id=${billCommittedId}`); return; }
  const form = document.getElementById("estimateForm");
  const submitButton = form.querySelector('button[type="submit"]');
  const operation = MandiFormSafety.begin("bill", { container: form, button: submitButton, label: "Updating bill" });
  if (!operation) return;
  billDraft?.flush();
  showLoading("Updating bill — waiting for server confirmation...");

  const billRef = billsCollection.doc(docId);
  try {
    const formData = new FormData(form);
    let newData = form.dataset.metadataRevision === "true"
      ? { Date: document.getElementById("bill_date_input").value.split("-").reverse().join("/"), Remarks: formData.get("bill_remarks") || "" }
      : calculateBillData(formData);
    const matchedCustomer = (window.partiesMasterList || []).find((party) => {
      const type = (party.type || "").toLowerCase();
      return (
        ["farmer", "vepari", "kisan", "customer", "buyer", "supplier"].includes(type) &&
        (party.name || "").trim().toLowerCase() === (newData["Customer Name"] || "").trim().toLowerCase()
      );
    });
    newData.customerId = formData.get("customer_id") || (matchedCustomer && matchedCustomer.id) || "";
    newData["lastUpdatedAt"] = firebase.firestore.FieldValue.serverTimestamp();

    let originalData; // Preserve the saved order mapping when recalculating an edit.

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 3 (item #13) — Optimistic Concurrency
    // Re-read the bill INSIDE the transaction and compare its lastUpdatedAt
    // to the value captured when this edit form was opened. If they differ,
    // someone else saved a change to this same bill in the meantime — abort
    // rather than silently overwriting their edit.
    // ═══════════════════════════════════════════════════════════════════
    //
    // 🔒 ATOMIC: this transaction now ALSO reconciles the customer's cached
    // balance (including the old-customer/new-customer split when the
    // customer is changed on edit) — previously that ran as a separate
    // step afterwards, only wrapped in a try/catch that logged a warning
    // on failure. The customer-switch case was the riskiest: if the debit
    // from the old customer succeeded but the credit to the new customer
    // then failed, money effectively vanished from the ledger. Folding
    // both into the same transaction as the bill write makes that
    // impossible — everything commits together or nothing does.
    await db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(billRef);
      if (!freshDoc.exists) throw new Error("NOT_FOUND: Original bill not found!");
      originalData = freshDoc.data();
      await MandiFinancialYear.assertPostingOpen(db, transaction, [originalData.Date, newData.Date]);
      if (originalData.locked === true || ['approved', 'locked'].includes(originalData.workflowStatus)) {
        throw new Error("LOCKED: Approved bills cannot be edited. Keep the original bill unchanged and use a reviewed correction.");
      }

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

      if (MandiFinancialYear.financialYearId(originalData.Date) !== MandiFinancialYear.financialYearId(newData.Date)) {
        throw new Error("VALIDATION_ERROR: A bill cannot move to another financial year under its existing bill number. Review a cancellation/replacement instead.");
      }
      if (originalData.revisionPending && (Number(originalData.amountPaid || 0) > 0 || ["Paid", "Partial", "Partially Paid"].includes(originalData.paymentStatus))) {
        newData = { Date: newData.Date, Remarks: newData.Remarks, lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        transaction.update(billRef, newData);
        return;
      }
      if (!Number(originalData.amountPaid || 0)) newData.amountDue = newData["Final Total"];

      newData["Serial No"] = originalData["Serial No"];
      // Phase 1: Date and Remarks now come from calculateBillData() itself
      // (already reads the form's date input + remarks textarea), so we
      // no longer force-overwrite Date here — only Serial No stays fixed.

      // --- Party balance reconciliation reads (must happen before any
      // writes, per Firestore transaction rules) ---
      const oldCustomerId = originalData.customerId || "";
      const newCustomerId = newData.customerId || oldCustomerId;
      const oldTotal = Number(originalData["Final Total"] || 0);
      const newTotal = Number(newData["Final Total"] || 0);
      const sameCustomer = oldCustomerId && oldCustomerId === newCustomerId;

      const oldPartyRef = oldCustomerId ? db.collection("parties").doc(oldCustomerId) : null;
      const newPartyRef = !sameCustomer && newCustomerId ? db.collection("parties").doc(newCustomerId) : null;
      const oldPartyDoc = oldPartyRef ? await transaction.get(oldPartyRef) : null;
      const newPartyDoc = newPartyRef ? await transaction.get(newPartyRef) : null;
      if (originalData.LinkedOrderId) {
        const orderDoc = await transaction.get(db.collection("orders").doc(originalData.LinkedOrderId));
        if (!orderDoc.exists) throw new Error("VALIDATION_ERROR: The linked order is missing. Review its link first.");
        if (!window.MandiOrderSync) throw new Error("Order sync module is unavailable. Reload the page.");
        MandiOrderSync.deliveredSuppliers(orderDoc.data(), [{ ...originalData, ...newData }]);
      }

      // --- Writes ---
      transaction.update(billRef, newData);

      if (sameCustomer) {
        if (oldPartyDoc && oldPartyDoc.exists) {
          const currentBalance = Number(oldPartyDoc.data().currentBalance || 0);
          transaction.update(oldPartyRef, {
            currentBalance: roundCurrency(currentBalance + (newTotal - oldTotal)),
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      } else {
        if (oldPartyRef && oldPartyDoc && oldPartyDoc.exists) {
          const currentBalance = Number(oldPartyDoc.data().currentBalance || 0);
          transaction.update(oldPartyRef, {
            currentBalance: roundCurrency(currentBalance - oldTotal),
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
        if (newPartyRef && newPartyDoc && newPartyDoc.exists) {
          const currentBalance = Number(newPartyDoc.data().currentBalance || 0);
          transaction.update(newPartyRef, {
            currentBalance: roundCurrency(currentBalance + newTotal),
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    });
    billCommittedId = docId;
    billDraft?.saved();
    operation.message("Bill update saved. Finishing follow-up work; do not submit again.", true);
    await recordAudit("bill.updated", "bill", docId, {
      before: billAuditSnapshot(originalData),
      after: billAuditSnapshot({ ...originalData, ...newData }),
    });

    // Recalculate from saved bills, including changed bags/weight/amount. Payment
    // and delivery status are independent; editing must not leave stale totals.
    if (originalData.LinkedOrderId) await updateOrderDeliveredQty({ ...originalData, ...newData });

    openConfirmedBill(`final.html?id=${docId}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    hideLoading();
    if (billCommittedId) {
      operation.finish("Bill update saved; a follow-up needs review.", "warning");
      await Swal.fire("Bill updated", "The bill update is saved, but a follow-up did not finish. Do not submit it again. Review its details.", "warning");
      openConfirmedBill(`final.html?id=${docId}`);
      return;
    }
    operation.fail(error);
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
    } else if (message.startsWith("LOCKED:")) {
      Swal.fire({
        icon: "warning",
        title: "Bill Locked",
        text: message.replace("LOCKED: ", ""),
        confirmButtonColor: "#005a9e",
      });
    } else {
      console.error("Error updating document: ", error);
      Swal.fire("Update not confirmed", MandiFormSafety.errorMessage(error), "error");
    }
  } finally {
    operation.finish(billCommittedId ? "Bill update confirmed by the server." : "Review your inputs before retrying.", billCommittedId ? "success" : "error");
    hideLoading();
  }
}
// At the bottom of bill-form.js

document.addEventListener("DOMContentLoaded", async () => {
  await fetchSettings(); // 1. Wait for the settings to load
  initializeIndexPage(); // 2. Then, set up the rest of the page
  initializeBillWorkspace();
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
async function checkAndSendWhatsApp(billData, billId) {
  // Check karo ki user ne settings mein toggle ON rakha hai ya nahi
  const isAutoSendOn = localStorage.getItem("whatsapp_auto_send") === "true";

  if (!isAutoSendOn) {
    console.log("WhatsApp automation is OFF by user.");
    return; // Agar OFF hai toh kuch mat karo, seedha bahar aajao
  }

  // Kisan ka phone number aur details uthao
  const matchedParty = (window.partiesMasterList || []).find(
    (party) => (party.name || "").trim().toLowerCase() === (billData["Customer Name"] || "").trim().toLowerCase()
  );
  let phone = billData.farmerPhone || billData.phone || (matchedParty && matchedParty.phone);
  if (!phone) {
    alert("Kisan ka phone number nahi mila!");
    return;
  }

  let downloadLink = "";
  if (billId && typeof createPublicBillShare === "function") {
    try {
      downloadLink = await createPublicBillShare(billId, billData);
    } catch (error) {
      console.warn("Could not create WhatsApp bill share link:", error);
    }
  }

  const companyName = window.companyProfile?.name || globalSettings?.companyName || "MandiBook";
  const activeVakals = Array.from({ length: 5 }, (_, index) =>
    Number(billData[`Vakal ${index + 1} Katta`] || 0)
  ).filter((katta) => katta > 0);
  const totalKatta = activeVakals.reduce((total, katta) => total + katta, 0);
  const vakalLine = totalKatta > 0 ? `Total Katta   : ${totalKatta} Katta (${activeVakals.length} Vakal)` : "";
  const finalAmount = Number(billData["Final Total"] || 0).toLocaleString("en-IN");

  const message = [
    `Dear ${billData["Customer Name"] || "Customer"},`,
    "",
    "--------------------------------",
    "BILL RECEIPT",
    "--------------------------------",
    `Bill No.       : ${billData["Serial No"] || "-"}`,
    `Date           : ${billData["Date"] || "-"}`,
    `Product        : ${billData["ProductTemplate"] || "-"}`,
    vakalLine,
    `Net Weight     : ${billData["Net Weight"] || 0} kg`,
    "--------------------------------",
    `FINAL AMOUNT   : Rs. ${finalAmount}`,
    "--------------------------------",
    "",
    downloadLink ? `View / Download Bill:\n${downloadLink}` : "",
    "",
    "Regards,",
    companyName,
  ]
    .filter((line) => line !== "")
    .join("\n");

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
            const selectedParty = window.partiesMasterList.find(
              (party) =>
                ["farmer", "vepari", "kisan", "customer", "buyer", "supplier"].includes(
                  (party.type || "").toLowerCase()
                ) && (party.name || "").toLowerCase() === enteredName.toLowerCase()
            );

            if (!selectedParty) {
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

            const masterVillage = (selectedParty.address || "").trim().toUpperCase();
            const villageInput = document.querySelector('input[name="village"]');
            const enteredVillage = (villageInput?.value || "").trim().toUpperCase();
            if (!masterVillage) {
              e.preventDefault();
              e.stopImmediatePropagation();
              Swal.fire({
                icon: "error",
                title: "Village Missing! 📍",
                text: `"${enteredName}" ke Party Master record mein Village / City add karo, phir bill banao.`,
                confirmButtonColor: "#d33",
              });
              return;
            }
            if (!enteredVillage || enteredVillage !== masterVillage) {
              e.preventDefault();
              e.stopImmediatePropagation();
              Swal.fire({
                icon: "error",
                title: "Village Must Match Party Master",
                text: `Is bill ke liye Village "${masterVillage}" hona chahiye.`,
                confirmButtonColor: "#d33",
              });
              return;
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
      item.innerHTML = `<strong>${escapeHtml(customer.name)}</strong> (${escapeHtml(customer.village)})`;
      item.addEventListener("click", () => {
        lockSelectedCustomer(customer);
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
      item.innerHTML = `<strong>${escapeHtml(broker.value)}</strong> ${
        broker.address ? `(${escapeHtml(broker.address)})` : ""
      }`;

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
