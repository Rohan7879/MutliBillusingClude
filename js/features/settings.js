/**
 * @file settings.js
 * @description MandiBook Settings — Core deductions + Product Templates manager.
 * @project MandiBook — Agricultural Purchase Billing System
 * @version 1.1.0
 */

// ─── App Version ───────────────────────────────────────────────────────────────
const APP_VERSION = {
  number: "1.1.0",
  phase: "Phase 1",
  label: "Product Templates + Flexible Deductions",
  date: "28 June 2026",
};

// ─── Deduction Types ───────────────────────────────────────────────────────────
const DEDUCTION_TYPES = [
  { value: "pct_weight", label: "% of Weight → kg katega", stage: "weight" },
  { value: "fixed_bag", label: "Fixed per Bag → bag × rate", stage: "weight" },
  { value: "fixed_kg", label: "Fixed per Kg → kg × rate", stage: "weight" },
  { value: "pct_amount", label: "% of Amount → ₹ katega/badhega", stage: "amount" },
  { value: "fixed_amt", label: "Fixed Amount → seedha value", stage: "amount" },
  { value: "custom", label: "Custom (apna formula)", stage: "custom" },
];

// ─── Firestore Refs ────────────────────────────────────────────────────────────
const deductionsRef = db.collection("settings").doc("deductions");
const templatesRef = db.collection("settings").doc("productTemplates");
const versionRef = db.collection("settings").doc("appVersion");
const savedFormulasRef = db.collection("settings").doc("savedFormulas");

// Formula Builder aur cheat-sheet dono isi list ko use karte hain, taaki
// kahi bhi naya variable add karna ho to sirf yahi ek jagah badalni pade.
const FORMULA_VARIABLES = [
  { value: "bags", label: "bags — total bags" },
  { value: "weight", label: "weight — Net Weight (kg)" },
  { value: "grossWeight", label: "grossWeight — Weighbridge Weight (kg)" },
  { value: "amount", label: "amount — Gross Amount (₹)" },
  { value: "price", label: "price — average rate (₹/20kg)" },
  { value: "freight", label: "freight — Truck Freight (₹)" },
  { value: "utrai", label: "utrai — Utrai amount (₹)" },
  { value: "kasar", label: "kasar — Kasar cut (kg)" },
  { value: "moisture", label: "moisture — Moisture cut (kg)" },
  { value: "karda", label: "karda — pichhle deductions ka total" },
];
function formulaVarOptions(selected) {
  return FORMULA_VARIABLES.map(
    (v) => `<option value="${v.value}" ${v.value === selected ? "selected" : ""}>${v.label}</option>`
  ).join("");
}

// Settings page ke andar (bill-form.js se alag) formula ko test karne ke
// liye — ye actual bill calculation mein use NAHI hota, sirf "test karke
// dekho" aur "risky formula warning" ke liye hai.
function evaluateFormulaClientSide(formula, vars) {
  try {
    const keys = Object.keys(vars);
    const values = Object.values(vars);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${formula});`);
    return fn(...values);
  } catch (e) {
    return undefined;
  }
}

// Test-calculator ke liye ek realistic sample bill jaisa default data
const DEFAULT_TEST_VALUES = {
  bags: 45,
  weight: 2000,
  grossWeight: 2050,
  amount: 50000,
  price: 450,
  freight: 500,
  utrai: 200,
  kasar: 15,
  moisture: 10,
  karda: 0,
};

// "Purane bill se test karo" ke liye — recent bills ki list ek baar fetch
// karke cache kar lete hain (baar-baar Firestore query na maarni pade).
let recentBillsForTestCache = null;
async function populateBillPicker(pickerEl) {
  if (!recentBillsForTestCache) {
    try {
      const snap = await billsCollection.orderBy("Serial No", "desc").limit(30).get();
      recentBillsForTestCache = snap.docs
        .filter((d) => d.data().deleted !== true)
        .map((d) => ({ id: d.id, serialNo: d.data()["Serial No"], name: d.data()["Customer Name"] }));
    } catch (e) {
      console.error("Error loading bills for test:", e);
      recentBillsForTestCache = [];
    }
  }
  pickerEl.innerHTML =
    `<option value="">-- Bill select karo --</option>` +
    recentBillsForTestCache.map((b) => `<option value="${b.id}">${b.serialNo} — ${b.name}</option>`).join("");
}

async function fetchBillForTest(billId) {
  try {
    const doc = await billsCollection.doc(billId).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    console.error("Error fetching bill for test:", e);
    return null;
  }
}

function mapBillToFormulaVars(b) {
  const weight = b["Net Weight"] || 0;
  const amount = b["Total Amount"] || b["Final Total"] || 0;
  return {
    bags: (b["Bharela 600"] || 0) + (b["Bharela 200"] || 0),
    weight,
    grossWeight: b["Weighbridge Weight"] || 0,
    amount,
    price: weight > 0 ? Math.round((amount / weight) * 20 * 100) / 100 : 0,
    freight: b["Truck Freight"] || 0,
    utrai: b["Utrāī"] || 0,
    kasar: b["Kasar"] || 0,
    moisture: b["Weighbridge Moisture Kg"] || 0,
    karda: 0,
  };
}

// ─── State ─────────────────────────────────────────────────────────────────────
let currentTemplates = {};
let activeTemplateId = null;
let dragSrcIndex = null;
let savedFormulasList = [];

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  showVersionInfo();
  await loadDeductionSettings();
  await loadTemplates();
  await loadPrintLayoutSettings();
  await loadSavedFormulas();
  setupDeductionForm();
  saveVersionToFirestore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT LAYOUT ORDER — lets Rohan reorder which box appears where on the
// printed/on-screen bill, via up/down arrows. Saved to settings/printLayout.
// ═══════════════════════════════════════════════════════════════════════════════

let printLayoutState = {
  detailsGridOrder: [...DEFAULT_DETAILS_GRID_ORDER],
  totalsGridOrder: [...DEFAULT_TOTALS_GRID_ORDER],
};

/**
 * @file settings.js
 * @description MandiBook Settings — Core deductions + Product Templates manager.
 * @project MandiBook — Agricultural Purchase Billing System
 * @version 1.1.0
 */

async function loadPrintLayoutSettings() {
  try {
    const doc = await db.collection("settings").doc("printLayout").get();
    if (doc.exists) {
      const data = doc.data();
      if (data.detailsGridOrder) {
        printLayoutState.detailsGridOrder = mergeInNewDefaultKeys(data.detailsGridOrder, DEFAULT_DETAILS_GRID_ORDER);
      }
      if (data.totalsGridOrder) {
        printLayoutState.totalsGridOrder = mergeInNewDefaultKeys(data.totalsGridOrder, DEFAULT_TOTALS_GRID_ORDER);
      }
    }
  } catch (e) {
    console.warn("Could not load print layout order:", e);
  }
  renderPrintLayoutLists();
}

/**
 * If new box types (like "freight_item") get added to the DEFAULT order
 * later, a previously-SAVED order won't have them — appendChild-style merge:
 * keep the user's saved order as-is, then append any default key that's
 * missing from it, so new boxes don't silently disappear.
 */
function mergeInNewDefaultKeys(savedOrder, defaultOrder) {
  const missing = defaultOrder.filter((key) => !savedOrder.includes(key));
  return [...savedOrder, ...missing];
}

function renderPrintLayoutLists() {
  renderPrintLayoutList("details", printLayoutState.detailsGridOrder, "print-layout-details-list");
  renderPrintLayoutList("totals", printLayoutState.totalsGridOrder, "print-layout-totals-list");
}

function renderPrintLayoutList(gridKey, order, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = order
    .map(
      (key, idx) => `
    <div class="pl-row">
      <span class="pl-label">${PRINT_LAYOUT_LABELS[key] || key}</span>
      <div class="pl-arrows">
        <button type="button" ${
          idx === 0 ? "disabled" : ""
        } onclick="movePrintLayoutItem('${gridKey}', ${idx}, -1)">⬆️</button>
        <button type="button" ${
          idx === order.length - 1 ? "disabled" : ""
        } onclick="movePrintLayoutItem('${gridKey}', ${idx}, 1)">⬇️</button>
      </div>
    </div>`
    )
    .join("");
}

function movePrintLayoutItem(gridKey, index, direction) {
  const order = gridKey === "details" ? printLayoutState.detailsGridOrder : printLayoutState.totalsGridOrder;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= order.length) return;
  [order[index], order[newIndex]] = [order[newIndex], order[index]];
  renderPrintLayoutLists();
}

async function savePrintLayoutSettings() {
  try {
    await db.collection("settings").doc("printLayout").set({
      detailsGridOrder: printLayoutState.detailsGridOrder,
      totalsGridOrder: printLayoutState.totalsGridOrder,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast("✅ Print layout order saved!");
  } catch (e) {
    console.error("Error saving print layout order:", e);
    showToast("Could not save layout order.", "error");
  }
}
window.movePrintLayoutItem = movePrintLayoutItem;
window.savePrintLayoutSettings = savePrintLayoutSettings;

// ═══════════════════════════════════════════════════════════════════════════════
// SAVED FORMULAS — Rohan ne jo custom formula ek baar bana ke kaam mein le
// liya, use naam dekar save kar sakta hai, taaki dobara likhna/yaad na
// rakhna pade. Sab templates mein, har custom-formula row ke saath ye
// dikhte hain.
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSavedFormulas() {
  try {
    const doc = await savedFormulasRef.get();
    savedFormulasList = doc.exists ? doc.data().list || [] : [];
  } catch (e) {
    console.error("Error loading saved formulas:", e);
    savedFormulasList = [];
  }
}

async function saveFormulaToLibrary(formula) {
  if (!formula || !formula.trim()) {
    showToast("Pehle formula box mein kuch likho ya Builder se banao.", "error");
    return;
  }
  const { value: formValues } = await Swal.fire({
    title: "💾 Formula Save Karo",
    html: `
      <input id="swal-formula-name" class="swal2-input" placeholder="Naam (e.g. Wheat ka slab rate)">
      <textarea id="swal-formula-note" class="swal2-textarea" placeholder="Note (optional) — jaise 'sirf Dec-Jan mein use karna'"></textarea>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Save",
    confirmButtonColor: "#005a9e",
    preConfirm: () => ({
      name: document.getElementById("swal-formula-name").value,
      note: document.getElementById("swal-formula-note").value,
    }),
  });
  if (!formValues || !formValues.name || !formValues.name.trim()) return;

  savedFormulasList.push({
    name: formValues.name.trim(),
    formula: formula.trim(),
    note: (formValues.note || "").trim(),
  });
  try {
    await savedFormulasRef.set({ list: savedFormulasList });
    showToast("✅ Formula save ho gaya!");
    renderAllSavedFormulasLists();
  } catch (e) {
    console.error("Error saving formula:", e);
    savedFormulasList.pop(); // rollback local list agar save fail ho jaye
    showToast("Save nahi ho paya, dobara try karo.", "error");
  }
}

async function deleteSavedFormula(index) {
  const confirm = await Swal.fire({
    title: "Delete karein?",
    text: `"${savedFormulasList[index]?.name}" hamesha ke liye mit jayega.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#e74c3c",
    confirmButtonText: "Haan, delete karo",
  });
  if (!confirm.isConfirmed) return;

  const removed = savedFormulasList.splice(index, 1);
  try {
    await savedFormulasRef.set({ list: savedFormulasList });
    renderAllSavedFormulasLists();
  } catch (e) {
    console.error("Error deleting formula:", e);
    savedFormulasList.splice(index, 0, ...removed); // rollback
    showToast("Delete nahi ho paya, dobara try karo.", "error");
  }
}

// Screen par jitni bhi custom-formula rows abhi khuli hain, sabki saved-list
// ek saath refresh kar do (naya save/delete hone ke baad).
function renderAllSavedFormulasLists() {
  document.querySelectorAll(".ded-row").forEach((row) => renderSavedFormulasInRow(row));
}

function renderSavedFormulasInRow(row) {
  const listEl = row.querySelector(".ded-saved-list");
  if (!listEl) return;
  const customInput = row.querySelector(".ded-custom-formula");

  if (savedFormulasList.length === 0) {
    listEl.innerHTML = `<span class="ded-saved-empty">Abhi koi save nahi kiya</span>`;
  } else {
    listEl.innerHTML = savedFormulasList
      .map(
        (f, i) => `
        <div class="ded-saved-item">
          <button type="button" class="ded-saved-use-btn" data-idx="${i}" title="${(f.note || "").replace(
          /"/g,
          "&quot;"
        )}${f.note ? "\n" : ""}Formula: ${f.formula}">${f.name}${f.note ? " 📝" : ""}</button>
          <button type="button" class="ded-saved-del-btn" data-idx="${i}" title="Delete">🗑️</button>
        </div>`
      )
      .join("");

    listEl.querySelectorAll(".ded-saved-use-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = savedFormulasList[Number(btn.dataset.idx)];
        if (f && customInput) {
          customInput.value = f.formula;
          customInput.focus();
          customInput.dispatchEvent(new Event("input"));
        }
      });
    });
    listEl.querySelectorAll(".ded-saved-del-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteSavedFormula(Number(btn.dataset.idx)));
    });
  }

  // ── Export: saari saved formulas ek .json file mein download ──
  const exportBtn = row.querySelector(".ded-export-formulas-btn");
  if (exportBtn && !exportBtn.dataset.wired) {
    exportBtn.dataset.wired = "1";
    exportBtn.addEventListener("click", () => {
      if (savedFormulasList.length === 0) {
        showToast("Export karne ke liye pehle kuch save karo.", "error");
        return;
      }
      const blob = new Blob([JSON.stringify(savedFormulasList, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mandibook-saved-formulas-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════════════════════

function showVersionInfo() {
  const el = document.getElementById("version-display");
  if (!el) return;
  el.innerHTML = `
    <span class="version-badge">v${APP_VERSION.number}</span>
    <span class="version-label">${APP_VERSION.phase} — ${APP_VERSION.label}</span>
    <span class="version-date">📅 ${APP_VERSION.date}</span>
  `;
}

async function saveVersionToFirestore() {
  try {
    await versionRef.set(APP_VERSION, { merge: true });
  } catch (e) {
    console.warn("Version save failed:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE DEDUCTION SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadDeductionSettings() {
  try {
    const doc = await deductionsRef.get();
    if (!doc.exists) return;
    const d = doc.data();
    setVal("kasarPercentage", d.kasarPercentage);
    setVal("kantanWeight", d.kantanWeight);
    setVal("plasticWeight", d.plasticWeight);
    setVal("utraiPercentage", d.utraiPercentage);
  } catch (e) {
    console.error("Error loading settings:", e);
    showToast("Could not load settings.", "error");
  }
}

function setupDeductionForm() {
  const form = document.getElementById("settingsForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await deductionsRef.set({
        kasarPercentage: Number(getVal("kasarPercentage")),
        kantanWeight: Number(getVal("kantanWeight")),
        plasticWeight: Number(getVal("plasticWeight")),
        utraiPercentage: Number(getVal("utraiPercentage")),
      });
      showToast("✅ Core settings saved!", "success");
    } catch (e) {
      showToast("Could not save settings.", "error");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES — LOAD & RENDER
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTemplates() {
  try {
    const doc = await templatesRef.get();
    currentTemplates = doc.exists ? doc.data().templates || {} : {};
    renderTemplateList();
  } catch (e) {
    console.error("Error loading templates:", e);
    showToast("Could not load templates.", "error");
  }
}

function renderTemplateList() {
  const container = document.getElementById("template-list");
  if (!container) return;
  const ids = Object.keys(currentTemplates);

  if (ids.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>📭 No templates yet. Create your first product template!</p>
      </div>`;
    return;
  }

  container.innerHTML = ids
    .map((id) => {
      const t = currentTemplates[id];
      const dedCount = (t.deductions || []).length;
      return `
      <div class="template-card">
        <div class="template-card-header">
          <div>
            <div class="template-name">🌾 ${t.name}</div>
            <div class="template-meta">
              Series: <strong>${t.seriesPrefix || "—"}</strong> &nbsp;|&nbsp;
              Price: <strong>${t.priceUnit || "20kg"}</strong> &nbsp;|&nbsp;
              ${dedCount} deduction(s)
            </div>
          </div>
          <div class="template-actions">
            <button class="tbtn tbtn-edit"   onclick="editTemplate('${id}')">✏️ Edit</button>
            <button class="tbtn tbtn-delete" onclick="deleteTemplate('${id}')">🗑️ Delete</button>
          </div>
        </div>
        <div class="deduction-pills">
          ${(t.deductions || [])
            .map(
              (d) => `
            <span class="ded-pill ${d.applyAs === "add" ? "pill-add" : "pill-minus"}">
              <span class="pill-stage stage-${d.stage || "weight"}">${d.stage === "amount" ? "💰" : "⚖️"}</span>
              ${d.applyAs === "add" ? "➕" : "➖"} ${d.name}
              ${d.type === "custom" ? `(${d.customFormula || "custom"})` : d.value ? `(${d.value})` : ""}
              ${d.optional ? "<em>(optional)</em>" : ""}
            </span>`
            )
            .join("")}
        </div>
      </div>`;
    })
    .join("");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES — MODAL OPEN/CLOSE
// ═══════════════════════════════════════════════════════════════════════════════

function openNewTemplateModal() {
  activeTemplateId = null;
  document.getElementById("modal-template-name").value = "";
  document.getElementById("modal-series-prefix").value = "";
  document.getElementById("modal-price-unit").value = "20kg";
  document.getElementById("modal-title").textContent = "➕ New Product Template";
  document.getElementById("ded-list").innerHTML = "";
  document.getElementById("template-modal").style.display = "flex";
}

function editTemplate(id) {
  const t = currentTemplates[id];
  if (!t) return;
  activeTemplateId = id;
  document.getElementById("modal-template-name").value = t.name || "";
  document.getElementById("modal-series-prefix").value = t.seriesPrefix || "";
  document.getElementById("modal-price-unit").value = t.priceUnit || "20kg";
  document.getElementById("modal-title").textContent = "✏️ Edit — " + t.name;
  document.getElementById("ded-list").innerHTML = "";
  (t.deductions || []).forEach((d) => addDeductionRow(d));
  document.getElementById("template-modal").style.display = "flex";
}

function closeTemplateModal() {
  document.getElementById("template-modal").style.display = "none";
  activeTemplateId = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUCTION ROWS
// ═══════════════════════════════════════════════════════════════════════════════

function addDeductionRow(data = {}) {
  const list = document.getElementById("ded-list");
  const idx = list.children.length;
  const row = document.createElement("div");
  row.className = "ded-row";
  row.draggable = true;
  row.dataset.idx = idx;

  const typeOpts = DEDUCTION_TYPES.map(
    (t) => `<option value="${t.value}" ${data.type === t.value ? "selected" : ""}>${t.label}</option>`
  ).join("");

  const isCustom = data.type === "custom";
  const stage = DEDUCTION_TYPES.find((t) => t.value === data.type)?.stage || "weight";

  row.innerHTML = `
    <span class="ded-drag-handle" title="Drag to reorder">⠿⠿</span>
    <div class="ded-fields">
      <span class="ded-stage-badge stage-${stage}" data-role="stage-badge">
        ${stage === "weight" ? "⚖️ WEIGHT" : stage === "amount" ? "💰 AMOUNT" : "❓ SET"}
      </span>
      <input type="text"   class="ded-name"  placeholder="Name (e.g. Moisture)" value="${data.name || ""}"/>
      <select class="ded-type">${typeOpts}</select>
      <input type="number" class="ded-value" placeholder="Value" value="${data.value || ""}"
        step="any" min="0" style="${isCustom ? "display:none;" : ""}"/>
      <input type="text" class="ded-custom-formula" placeholder="e.g. bags * 2  ya  (amount * 1.5) / 100"
        value="${data.customFormula || ""}" style="${isCustom ? "" : "display:none;"}"/>
      <button type="button" class="ded-save-formula-btn" style="${
        isCustom ? "" : "display:none;"
      }">💾 Isko Save Karo (dobara use karne ke liye)</button>
      <button type="button" class="ded-copy-to-template-btn" style="${
        isCustom ? "" : "display:none;"
      }">📋 Doosre template mein copy karo</button>
      <select class="ded-custom-stage" style="${isCustom ? "" : "display:none;"}">
        <option value="weight" ${data.customStage === "weight" ? "selected" : ""}>⚖️ Cuts from Weight</option>
        <option value="amount" ${data.customStage !== "weight" ? "selected" : ""}>💰 Cuts from Amount</option>
      </select>
      <div class="ded-formula-tools" style="${isCustom ? "" : "display:none;"}">

        <!-- ═══ FORMULA BUILDER — kuch type nahi karna, sirf choose karo ═══ -->
        <div class="ded-builder-box">
          <div class="ded-builder-title">🛠️ Formula Builder</div>
          <div class="ded-builder-mode-tabs">
            <button type="button" class="ded-mode-btn active" data-mode="simple">Simple</button>
            <button type="button" class="ded-mode-btn" data-mode="combine">Do Jodo</button>
            <button type="button" class="ded-mode-btn" data-mode="condition">Agar / Warna</button>
          </div>

          <div class="ded-builder-mode" data-mode-panel="simple">
            <select class="db-var">${formulaVarOptions()}</select>
            <select class="db-op">
              <option value="*">× guna</option>
              <option value="/">÷ bhaag</option>
              <option value="+">+ jodo</option>
              <option value="-">− ghatao</option>
            </select>
            <input type="number" class="db-num" placeholder="number" step="any"/>
          </div>

          <div class="ded-builder-mode" data-mode-panel="combine" style="display:none">
            <div class="db-combine-part">
              <select class="db-var-1">${formulaVarOptions()}</select>
              <select class="db-op-1">
                <option value="*">× guna</option><option value="/">÷ bhaag</option>
                <option value="+">+ jodo</option><option value="-">− ghatao</option>
              </select>
              <input type="number" class="db-num-1" placeholder="number" step="any"/>
            </div>
            <select class="db-combine-op">
              <option value="+">+ dono jodo</option>
              <option value="-">− pehla mein se doosra ghatao</option>
            </select>
            <div class="db-combine-part">
              <select class="db-var-2">${formulaVarOptions()}</select>
              <select class="db-op-2">
                <option value="*">× guna</option><option value="/">÷ bhaag</option>
                <option value="+">+ jodo</option><option value="-">− ghatao</option>
              </select>
              <input type="number" class="db-num-2" placeholder="number" step="any"/>
            </div>
          </div>

          <div class="ded-builder-mode" data-mode-panel="condition" style="display:none">
            <div class="db-tier-list">
              <div class="db-tier">
                <div class="db-tier-header">
                  <b>Tier 1 — Agar</b>
                </div>
                <div class="db-tier-cond">
                  <select class="db-cond-var">${formulaVarOptions()}</select>
                  <select class="db-cond-comp">
                    <option value=">=">&ge; (ya usse zyada)</option>
                    <option value="<=">&le; (ya usse kam)</option>
                    <option value=">">&gt; (zyada)</option>
                    <option value="<">&lt; (kam)</option>
                    <option value="==">== (barabar)</option>
                  </select>
                  <input type="number" class="db-cond-num" placeholder="number" step="any"/>
                </div>
                <div class="db-tier-then">
                  <span>Tab</span>
                  <select class="db-then-var">${formulaVarOptions()}</select>
                  <select class="db-then-op">
                    <option value="*">× guna</option><option value="/">÷ bhaag</option>
                    <option value="+">+ jodo</option><option value="-">− ghatao</option>
                  </select>
                  <input type="number" class="db-then-num" placeholder="number" step="any"/>
                </div>
              </div>
            </div>
            <button type="button" class="db-add-tier-btn">➕ Ek aur tier jodo</button>
            <div class="db-else-row">
              <span>Warna (baaki sab)</span>
              <select class="db-else-var">${formulaVarOptions()}</select>
              <select class="db-else-op">
                <option value="*">× guna</option><option value="/">÷ bhaag</option>
                <option value="+">+ jodo</option><option value="-">− ghatao</option>
              </select>
              <input type="number" class="db-else-num" placeholder="number" step="any"/>
            </div>
          </div>

          <div class="ded-builder-preview">Banega: <code class="db-preview-text">weight * 1</code></div>
          <div class="ded-builder-warning" style="display:none"></div>

          <div class="ded-builder-test-box">
            <div class="ded-test-title">🧮 Test karke dekho (save karne se pehle)</div>
            <div class="ded-test-mode-row">
              <button type="button" class="ded-test-manual-btn active" data-testmode="manual">✍️ Khud numbers daalo</button>
              <button type="button" class="ded-test-real-btn" data-testmode="real">📄 Purane bill se test karo</button>
            </div>
            <select class="ded-test-bill-picker" style="display:none"><option value="">-- Bill select karo --</option></select>
            <div class="ded-test-inputs"></div>
            <div class="ded-test-result">Result: <code class="ded-test-result-text">—</code></div>
          </div>

          <button type="button" class="ded-builder-apply-btn">✅ Ye formula box mein bharo</button>
        </div>

        <!-- ═══ SAVED FORMULAS — apne pehle bane formulas dobara use karo ═══ -->
        <div class="ded-saved-formulas">
          <div class="ded-saved-header-row">
            <div class="ded-saved-title">📂 Mere Saved Formulas</div>
            <button type="button" class="ded-export-formulas-btn">⬇️ Export</button>
          </div>
          <div class="ded-saved-list"><span class="ded-saved-empty">Abhi koi save nahi kiya</span></div>
        </div>

      </div>
      <details class="ded-formula-cheatsheet" style="${isCustom ? "" : "display:none;"}">
        <summary>ℹ️ Formula mein kaunse words use kar sakte ho? (hover karke example dekho)</summary>
        <div class="ded-cheatsheet-body">
          <div class="ded-quick-templates">
            <div class="ded-quick-title">👇 Formula khud likhne ki zaroorat nahi — ek pattern choose karo, bas numbers badal do:</div>
            <button type="button" class="ded-quick-btn" data-formula="bags >= 50 ? bags * 3 : bags * 5">
              📊 Zyada quantity pe alag rate
            </button>
            <button type="button" class="ded-quick-btn" data-formula="(bags * 2) + (amount * 0.01)">
              ➕ Do charges ek saath jodo
            </button>
            <button type="button" class="ded-quick-btn" data-formula="weight * 0.3">
              ⚖️ Weight ke hisaab se charge
            </button>
            <button type="button" class="ded-quick-btn" data-formula="price < 400 ? weight * 0.03 : weight * 0.01">
              💰 Price kam ho to zyada kasar
            </button>
          </div>
          <div class="ded-var-chip" data-example="bags * 2"><code>bags</code> — total bags (600+200)</div>
          <div class="ded-var-chip" data-example="weight * 0.5"><code>weight</code> — Net Weight (kg)</div>
          <div class="ded-var-chip" data-example="grossWeight * 0.01"><code>grossWeight</code> — Weighbridge Weight (kg)</div>
          <div class="ded-var-chip" data-example="amount * 0.02"><code>amount</code> — Gross Amount (₹)</div>
          <div class="ded-var-chip" data-example="price * bags"><code>price</code> — average rate (₹ per 20kg)</div>
          <div class="ded-var-chip" data-example="freight / bags"><code>freight</code> — Truck Freight (₹)</div>
          <div class="ded-var-chip" data-example="utrai * 0.1"><code>utrai</code> — Utrai amount (₹)</div>
          <div class="ded-var-chip" data-example="kasar * 2"><code>kasar</code> — Kasar cut (kg)</div>
          <div class="ded-var-chip" data-example="moisture * 3"><code>moisture</code> — Moisture cut (kg)</div>
          <div class="ded-var-chip" data-example="karda * 0.05"><code>karda</code> — pichhle deductions ka total, isi list mein</div>
          <div class="ded-cheatsheet-examples">
            <b>Example:</b> <code class="ded-example-text">bags * 2</code>
          </div>
        </div>
      </details>
      <select class="ded-apply">
        <option value="minus" ${data.applyAs !== "add" ? "selected" : ""}>➖ Deduct</option>
        <option value="add"   ${data.applyAs === "add" ? "selected" : ""}>➕ Add</option>
      </select>
      <label class="ded-optional-wrap">
        <input type="checkbox" class="ded-optional" ${data.optional ? "checked" : ""}/>
        <span>Optional per bill</span>
      </label>
    </div>
    <button type="button" class="ded-remove-btn" onclick="this.parentElement.remove()">✕</button>`;

  // ── Show/hide custom fields + update stage badge live ──
  const typeSelect = row.querySelector(".ded-type");
  const valueInput = row.querySelector(".ded-value");
  const customInput = row.querySelector(".ded-custom-formula");
  const customStage = row.querySelector(".ded-custom-stage");
  const stageBadge = row.querySelector('[data-role="stage-badge"]');

  function refreshStageBadge() {
    const selected = typeSelect.value;
    if (selected === "custom") {
      const s = customStage.value;
      stageBadge.className = `ded-stage-badge stage-${s}`;
      stageBadge.textContent = s === "weight" ? "⚖️ WEIGHT" : "💰 AMOUNT";
    } else {
      const s = DEDUCTION_TYPES.find((t) => t.value === selected)?.stage || "weight";
      stageBadge.className = `ded-stage-badge stage-${s}`;
      stageBadge.textContent = s === "weight" ? "⚖️ WEIGHT" : "💰 AMOUNT";
    }
  }

  typeSelect.addEventListener("change", () => {
    const custom = typeSelect.value === "custom";
    valueInput.style.display = custom ? "none" : "";
    customInput.style.display = custom ? "" : "none";
    customStage.style.display = custom ? "" : "none";
    const cheatsheet = row.querySelector(".ded-formula-cheatsheet");
    if (cheatsheet) cheatsheet.style.display = custom ? "" : "none";
    const tools = row.querySelector(".ded-formula-tools");
    if (tools) tools.style.display = custom ? "" : "none";
    const saveBtn = row.querySelector(".ded-save-formula-btn");
    if (saveBtn) saveBtn.style.display = custom ? "" : "none";
    const copyBtn = row.querySelector(".ded-copy-to-template-btn");
    if (copyBtn) copyBtn.style.display = custom ? "" : "none";
    refreshStageBadge();
  });
  customStage.addEventListener("change", refreshStageBadge);

  // ── Cheat-sheet: hover over a variable, its example updates below ──
  const exampleText = row.querySelector(".ded-example-text");
  row.querySelectorAll(".ded-var-chip").forEach((chip) => {
    chip.addEventListener("mouseenter", () => {
      if (exampleText) exampleText.textContent = chip.dataset.example || "";
    });
  });

  // ── Quick Templates: ek click mein poora formula bhar do, taaki user ko
  // khud syntax likhna na pade — bas numbers dhoondh ke badal de ──
  row.querySelectorAll(".ded-quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      customInput.value = btn.dataset.formula;
      customInput.focus();
      // Formula ke andar jitne bhi numbers hain, unhe select kar do —
      // taaki user ko turant dikhe ki yahi cheezein badalni hain
      customInput.select();
    });
  });

  // ── Formula Builder: dropdown/number bharo, formula khud ban jaye ──
  const builderBox = row.querySelector(".ded-builder-box");
  if (builderBox) {
    const modeBtns = builderBox.querySelectorAll(".ded-mode-btn");
    const modePanels = builderBox.querySelectorAll(".ded-builder-mode");
    const previewText = builderBox.querySelector(".db-preview-text");
    let activeMode = "simple";

    function opSymbol(op) {
      return { "*": "*", "/": "/", "+": "+", "-": "-" }[op] || "*";
    }
    function part(varSel, opSel, numInput) {
      const v = varSel.value;
      const n = numInput.value === "" ? "1" : numInput.value;
      return `${v} ${opSymbol(opSel.value)} ${n}`;
    }

    // ── Multi-tier (slab) rows: "+ Ek aur tier jodo" se jitne bhi tier
    // add ho jayein, sabko yahan se handle karte hain ──
    const tierList = builderBox.querySelector(".db-tier-list");
    const addTierBtn = builderBox.querySelector(".db-add-tier-btn");

    function tierHtml(n) {
      return `
        <div class="db-tier">
          <div class="db-tier-header">
            <b>Tier ${n} — Agar</b>
            <button type="button" class="db-remove-tier-btn" title="Ye tier hatao">✕</button>
          </div>
          <div class="db-tier-cond">
            <select class="db-cond-var">${formulaVarOptions()}</select>
            <select class="db-cond-comp">
              <option value=">=">&ge; (ya usse zyada)</option>
              <option value="<=">&le; (ya usse kam)</option>
              <option value=">">&gt; (zyada)</option>
              <option value="<">&lt; (kam)</option>
              <option value="==">== (barabar)</option>
            </select>
            <input type="number" class="db-cond-num" placeholder="number" step="any"/>
          </div>
          <div class="db-tier-then">
            <span>Tab</span>
            <select class="db-then-var">${formulaVarOptions()}</select>
            <select class="db-then-op">
              <option value="*">× guna</option><option value="/">÷ bhaag</option>
              <option value="+">+ jodo</option><option value="-">− ghatao</option>
            </select>
            <input type="number" class="db-then-num" placeholder="number" step="any"/>
          </div>
        </div>`;
    }

    function renumberTiers() {
      tierList.querySelectorAll(".db-tier").forEach((t, i) => {
        t.querySelector(".db-tier-header b").textContent = `Tier ${i + 1} — Agar`;
        const removeBtn = t.querySelector(".db-remove-tier-btn");
        if (removeBtn) removeBtn.style.display = i === 0 ? "none" : "";
      });
    }

    function wireTier(tierEl) {
      tierEl.querySelectorAll("select, input").forEach((el) => {
        el.addEventListener("input", buildPreview);
        el.addEventListener("change", buildPreview);
      });
      const removeBtn = tierEl.querySelector(".db-remove-tier-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          tierEl.remove();
          renumberTiers();
          buildPreview();
        });
      }
    }

    if (addTierBtn) {
      addTierBtn.addEventListener("click", () => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = tierHtml(tierList.querySelectorAll(".db-tier").length + 1);
        const newTier = wrapper.firstElementChild;
        tierList.appendChild(newTier);
        wireTier(newTier);
        renumberTiers();
        buildPreview();
      });
    }
    tierList?.querySelectorAll(".db-tier").forEach(wireTier);

    function buildPreview() {
      let formula = "";
      if (activeMode === "simple") {
        formula = part(
          builderBox.querySelector(".db-var"),
          builderBox.querySelector(".db-op"),
          builderBox.querySelector(".db-num")
        );
      } else if (activeMode === "combine") {
        const p1 = part(
          builderBox.querySelector(".db-var-1"),
          builderBox.querySelector(".db-op-1"),
          builderBox.querySelector(".db-num-1")
        );
        const p2 = part(
          builderBox.querySelector(".db-var-2"),
          builderBox.querySelector(".db-op-2"),
          builderBox.querySelector(".db-num-2")
        );
        const combineOp = builderBox.querySelector(".db-combine-op").value;
        formula = `(${p1}) ${combineOp === "+" ? "+" : "-"} (${p2})`;
      } else if (activeMode === "condition") {
        const tiers = Array.from(tierList.querySelectorAll(".db-tier"));
        const conditions = tiers.map((t) => {
          const condVar = t.querySelector(".db-cond-var").value;
          const condComp = t.querySelector(".db-cond-comp").value;
          const condNum = t.querySelector(".db-cond-num").value || "0";
          const thenPart = part(
            t.querySelector(".db-then-var"),
            t.querySelector(".db-then-op"),
            t.querySelector(".db-then-num")
          );
          return `${condVar} ${condComp} ${condNum} ? (${thenPart}) : `;
        });
        const elsePart = part(
          builderBox.querySelector(".db-else-var"),
          builderBox.querySelector(".db-else-op"),
          builderBox.querySelector(".db-else-num")
        );
        formula = conditions.join("") + `(${elsePart})`;
      }
      if (previewText) previewText.textContent = formula;
      checkFormulaWarning(formula);
      return formula;
    }

    // ── Risky-formula warning ──
    const warningBox = builderBox.querySelector(".ded-builder-warning");
    function customRoundLocal(n) {
      return Math.round(n * 100) / 100;
    }
    function checkFormulaWarning(formula) {
      if (!warningBox || !formula) return;
      const result = evaluateFormulaClientSide(formula, DEFAULT_TEST_VALUES);
      if (result === undefined || Number.isNaN(result) || !Number.isFinite(result)) {
        warningBox.style.display = "";
        warningBox.textContent = "⚠️ Ye formula galat result de raha hai (shayad ÷0 ho gaya) — check karo.";
      } else if (result < 0) {
        warningBox.style.display = "";
        warningBox.textContent = `⚠️ Sample data se ye formula negative (-${Math.abs(
          customRoundLocal(result)
        )}) result de raha hai — check karo.`;
      } else {
        warningBox.style.display = "none";
      }
    }

    // ── Live test-calculator: manual numbers YA ek asli purane bill se ──
    const testInputsBox = builderBox.querySelector(".ded-test-inputs");
    const testResultText = builderBox.querySelector(".ded-test-result-text");
    const billPicker = builderBox.querySelector(".ded-test-bill-picker");
    const testManualBtn = builderBox.querySelector(".ded-test-manual-btn");
    const testRealBtn = builderBox.querySelector(".ded-test-real-btn");
    let testMode = "manual";

    if (testInputsBox) {
      testInputsBox.innerHTML = FORMULA_VARIABLES.map(
        (v) => `<label class="ded-test-field">${v.value}
          <input type="number" class="ded-test-input" data-var="${v.value}" value="${
          DEFAULT_TEST_VALUES[v.value]
        }" step="any"/>
        </label>`
      ).join("");

      function runTest() {
        const testVars = {};
        testInputsBox.querySelectorAll(".ded-test-input").forEach((inp) => {
          testVars[inp.dataset.var] = Number(inp.value) || 0;
        });
        const formula = customInput.value;
        const result = evaluateFormulaClientSide(formula, testVars);
        if (testResultText) {
          testResultText.textContent =
            result === undefined || Number.isNaN(result) || !Number.isFinite(result)
              ? "❌ Formula mein galti hai"
              : customRoundLocal(result);
        }
      }
      testInputsBox.querySelectorAll(".ded-test-input").forEach((inp) => inp.addEventListener("input", runTest));
      customInput.addEventListener("input", runTest);
      runTest();
      row._runFormulaTest = runTest; // taaki bill-picker se bhi refresh kar sakein

      // ── Manual / Real-bill mode toggle ──
      if (testManualBtn && testRealBtn && billPicker) {
        testManualBtn.addEventListener("click", async () => {
          testMode = "manual";
          testManualBtn.classList.add("active");
          testRealBtn.classList.remove("active");
          billPicker.style.display = "none";
          testInputsBox.querySelectorAll(".ded-test-input").forEach((inp) => (inp.disabled = false));
          runTest();
        });
        testRealBtn.addEventListener("click", async () => {
          testMode = "real";
          testRealBtn.classList.add("active");
          testManualBtn.classList.remove("active");
          billPicker.style.display = "";
          testInputsBox.querySelectorAll(".ded-test-input").forEach((inp) => (inp.disabled = true));
          await populateBillPicker(billPicker);
        });
        billPicker.addEventListener("change", async () => {
          if (!billPicker.value) return;
          const billData = await fetchBillForTest(billPicker.value);
          if (!billData) return;
          const mapped = mapBillToFormulaVars(billData);
          testInputsBox.querySelectorAll(".ded-test-input").forEach((inp) => {
            if (mapped[inp.dataset.var] !== undefined) inp.value = mapped[inp.dataset.var];
          });
          runTest();
        });
      }
    }

    modeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeMode = btn.dataset.mode;
        modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
        modePanels.forEach((p) => (p.style.display = p.dataset.modePanel === activeMode ? "" : "none"));
        buildPreview();
      });
    });

    builderBox.querySelectorAll("select, input").forEach((el) => {
      el.addEventListener("input", buildPreview);
      el.addEventListener("change", buildPreview);
    });

    builderBox.querySelector(".ded-builder-apply-btn").addEventListener("click", () => {
      customInput.value = buildPreview();
      customInput.focus();
      customInput.select();
      customInput.dispatchEvent(new Event("input"));
    });

    buildPreview(); // initial preview dikhao
  }

  // ── Save button: current formula ko naam dekar library mein save karo ──
  const saveFormulaBtn = row.querySelector(".ded-save-formula-btn");
  if (saveFormulaBtn) {
    saveFormulaBtn.addEventListener("click", () => saveFormulaToLibrary(customInput.value));
  }

  // ── Copy to another template: is poore deduction (naam, formula, stage,
  // add/deduct) ko ek click mein kisi doosre template mein bhej do ──
  const copyToTemplateBtn = row.querySelector(".ded-copy-to-template-btn");
  if (copyToTemplateBtn) {
    copyToTemplateBtn.addEventListener("click", async () => {
      const otherTemplates = Object.entries(currentTemplates).filter(([id]) => id !== activeTemplateId);
      if (otherTemplates.length === 0) {
        showToast("Copy karne ke liye koi doosra template nahi hai.", "error");
        return;
      }
      const options = otherTemplates.map(([id, t]) => `<option value="${id}">${t.name}</option>`).join("");
      const { value: targetId } = await Swal.fire({
        title: "📋 Kis template mein copy karein?",
        input: "select",
        inputOptions: Object.fromEntries(otherTemplates.map(([id, t]) => [id, t.name])),
        showCancelButton: true,
        confirmButtonText: "Copy Karo",
        confirmButtonColor: "#005a9e",
      });
      if (!targetId) return;

      const dedToCopy = {
        name: row.querySelector(".ded-name").value.trim(),
        type: typeSelect.value,
        value: parseFloat(valueInput.value) || 0,
        customFormula: customInput.value,
        customStage: customStage.value,
        applyAs: row.querySelector(".ded-apply").value,
        optional: row.querySelector(".ded-optional").checked,
        stage: customStage.value,
      };
      if (!dedToCopy.name) {
        showToast("Pehle deduction ka naam bharo.", "error");
        return;
      }

      if (!currentTemplates[targetId].deductions) currentTemplates[targetId].deductions = [];
      currentTemplates[targetId].deductions.push(dedToCopy);
      try {
        await templatesRef.set({ templates: currentTemplates });
        showToast(`✅ "${currentTemplates[targetId].name}" mein copy ho gaya!`);
      } catch (e) {
        console.error("Error copying deduction:", e);
        currentTemplates[targetId].deductions.pop(); // rollback
        showToast("Copy nahi ho paya, dobara try karo.", "error");
      }
    });
  }

  // ── Saved formulas ki list is row mein dikhao (naye row ke liye bhi) ──
  renderSavedFormulasInRow(row);

  // ── Drag & drop reordering ──
  row.addEventListener("dragstart", () => {
    dragSrcIndex = Number(row.dataset.idx);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    document.querySelectorAll(".ded-row").forEach((r) => r.classList.remove("drag-over"));
  });
  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drag-over");
    reorderDeductions(dragSrcIndex, Number(row.dataset.idx));
  });

  list.appendChild(row);
}

/**
 * Reorders deduction rows after a drag-and-drop action.
 * Re-reads each row's current field values so nothing is lost,
 * rebuilds the list, and re-attaches fresh listeners via addDeductionRow.
 * @param {number} from - Source index
 * @param {number} to   - Target index
 */
function reorderDeductions(from, to) {
  if (from === to || from === null || from === undefined) return;

  const list = document.getElementById("ded-list");
  const rows = Array.from(list.children);

  // Snapshot current values of every row before rebuilding
  const snapshot = rows.map((row) => ({
    name: row.querySelector(".ded-name").value,
    type: row.querySelector(".ded-type").value,
    value: row.querySelector(".ded-value").value,
    customFormula: row.querySelector(".ded-custom-formula").value,
    customStage: row.querySelector(".ded-custom-stage").value,
    applyAs: row.querySelector(".ded-apply").value,
    optional: row.querySelector(".ded-optional").checked,
  }));

  // Move the dragged item to its new position
  const moved = snapshot.splice(from, 1)[0];
  snapshot.splice(to, 0, moved);

  // Rebuild rows in new order
  list.innerHTML = "";
  snapshot.forEach((data) => addDeductionRow(data));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES — SAVE & DELETE
// ═══════════════════════════════════════════════════════════════════════════════

async function saveTemplate() {
  const name = document.getElementById("modal-template-name").value.trim();
  const prefix = document.getElementById("modal-series-prefix").value.trim().toUpperCase();
  const priceUnit = document.getElementById("modal-price-unit").value;

  if (!name) {
    showToast("Template name is required!", "error");
    return;
  }

  // ── Block reserved names already handled by Core Settings ──
  // Kasar, Kantan, Plastic, Utrai, and Moisture are all calculated by
  // the core calculation engine itself (see bill-form.js + index.html's
  // built-in Weighbridge/Vakal Moisture fields). If a template also had
  // a deduction with these names, the bill would be cut twice.
  const RESERVED_NAMES = ["kasar", "kantan", "plastic", "utrai", "utraī", "bardan", "moisture", "moichar", "ભેજ"];

  const deductions = [];
  let hasReservedNameConflict = false;

  document.querySelectorAll(".ded-row").forEach((row) => {
    const dedName = row.querySelector(".ded-name").value.trim();
    if (RESERVED_NAMES.includes(dedName.toLowerCase())) {
      hasReservedNameConflict = true;
      return; // skip — will block save below
    }

    const type = row.querySelector(".ded-type").value;
    const ded = {
      name: dedName,
      type: type,
      value: type === "custom" ? 0 : Number(row.querySelector(".ded-value").value) || 0,
      customFormula: type === "custom" ? row.querySelector(".ded-custom-formula").value.trim() : "",
      customStage: type === "custom" ? row.querySelector(".ded-custom-stage").value : "",
      applyAs: row.querySelector(".ded-apply").value,
      optional: row.querySelector(".ded-optional").checked,
      // stage tells the calculation engine WHERE to cut this from:
      // "weight" = cuts from Net Weight (before vakal amount is calculated)
      // "amount" = cuts from Final Total (after vakal amount is calculated)
      stage:
        type === "custom"
          ? row.querySelector(".ded-custom-stage").value
          : DEDUCTION_TYPES.find((t) => t.value === type)?.stage || "weight",
    };
    if (ded.name) deductions.push(ded);
  });

  if (hasReservedNameConflict) {
    Swal.fire({
      icon: "error",
      title: "⚠️ Reserved Deduction Name",
      html: `<strong>Kasar, Kantan, Plastic, Bardan, Utrai,</strong> and <strong>Moisture</strong>
              are already handled automatically — Kasar/Kantan/Plastic/Utrai from Core Settings,
              and Moisture from the built-in Weighbridge/Vakal Moisture fields on the bill form.<br><br>
              These cut once per bill no matter what — adding them again in a
              product template would cut the same amount <strong>twice</strong>.<br><br>
              Please rename or remove that row, and only add deductions that are
              <em>extra</em> for this product (e.g. Admixture, GST, Cleaning charge).`,
      confirmButtonColor: "#005a9e",
    });
    return;
  }

  const id = activeTemplateId || `tpl_${Date.now()}`;
  currentTemplates[id] = { name, seriesPrefix: prefix, priceUnit, deductions };

  try {
    await templatesRef.set({ templates: currentTemplates });
    showToast(`✅ Template "${name}" saved!`, "success");
    closeTemplateModal();
    renderTemplateList();
  } catch (e) {
    showToast("Could not save template.", "error");
  }
}

async function deleteTemplate(id) {
  const t = currentTemplates[id];
  if (!t) return;
  const result = await Swal.fire({
    icon: "warning",
    title: `Delete "${t.name}"?`,
    text: "This cannot be undone.",
    showCancelButton: true,
    confirmButtonColor: "#dc3545",
    cancelButtonColor: "#6c757d",
    confirmButtonText: "Yes, Delete",
  });
  if (!result.isConfirmed) return;
  delete currentTemplates[id];
  try {
    await templatesRef.set({ templates: currentTemplates });
    renderTemplateList();
    showToast("🗑️ Template deleted.", "success");
  } catch (e) {
    showToast("Could not delete template.", "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function setVal(name, val) {
  const el = document.querySelector(`input[name="${name}"]`);
  if (el) el.value = val ?? "";
}

function getVal(name) {
  return document.querySelector(`input[name="${name}"]`)?.value ?? "";
}

function showToast(msg, type = "success") {
  Swal.fire({
    toast: true,
    position: "top-end",
    icon: type,
    title: msg,
    showConfirmButton: false,
    timer: 2500,
    timerProgressBar: true,
  });
}
