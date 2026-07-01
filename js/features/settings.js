/**
 * @file settings.js
 * @description MandiBook Settings — Core deductions + Product Templates manager.
 * @project MandiBook — Agricultural Purchase Billing System
 * @version 1.1.0
 */

// ─── App Version ───────────────────────────────────────────────────────────────
const APP_VERSION = {
  number: "1.1.0",
  phase:  "Phase 1",
  label:  "Product Templates + Flexible Deductions",
  date:   "28 June 2026",
};

// ─── Deduction Types ───────────────────────────────────────────────────────────
const DEDUCTION_TYPES = [
  { value: "pct_weight", label: "% of Weight → kg katega",         stage: "weight" },
  { value: "fixed_bag",  label: "Fixed per Bag → bag × rate",      stage: "weight" },
  { value: "fixed_kg",   label: "Fixed per Kg → kg × rate",        stage: "weight" },
  { value: "pct_amount", label: "% of Amount → ₹ katega/badhega",  stage: "amount" },
  { value: "fixed_amt",  label: "Fixed Amount → seedha value",     stage: "amount" },
  { value: "custom",     label: "Custom (apna formula)",           stage: "custom" },
];

// ─── Firestore Refs ────────────────────────────────────────────────────────────
const deductionsRef = db.collection("settings").doc("deductions");
const templatesRef  = db.collection("settings").doc("productTemplates");
const versionRef    = db.collection("settings").doc("appVersion");

// ─── State ─────────────────────────────────────────────────────────────────────
let currentTemplates = {};
let activeTemplateId = null;
let dragSrcIndex     = null;

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  showVersionInfo();
  await loadDeductionSettings();
  await loadTemplates();
  setupDeductionForm();
  saveVersionToFirestore();
});

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
  try { await versionRef.set(APP_VERSION, { merge: true }); }
  catch (e) { console.warn("Version save failed:", e); }
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
    setVal("kantanWeight",    d.kantanWeight);
    setVal("plasticWeight",   d.plasticWeight);
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
        kantanWeight:    Number(getVal("kantanWeight")),
        plasticWeight:   Number(getVal("plasticWeight")),
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
    currentTemplates = doc.exists ? (doc.data().templates || {}) : {};
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

  container.innerHTML = ids.map((id) => {
    const t        = currentTemplates[id];
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
          ${(t.deductions || []).map((d) => `
            <span class="ded-pill ${d.applyAs === 'add' ? 'pill-add' : 'pill-minus'}">
              <span class="pill-stage stage-${d.stage || 'weight'}">${d.stage === 'amount' ? '💰' : '⚖️'}</span>
              ${d.applyAs === 'add' ? '➕' : '➖'} ${d.name}
              ${d.type === 'custom' ? `(${d.customFormula || 'custom'})` : (d.value ? `(${d.value})` : '')}
              ${d.optional ? '<em>(optional)</em>' : ''}
            </span>`).join("")}
        </div>
      </div>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATES — MODAL OPEN/CLOSE
// ═══════════════════════════════════════════════════════════════════════════════

function openNewTemplateModal() {
  activeTemplateId = null;
  document.getElementById("modal-template-name").value  = "";
  document.getElementById("modal-series-prefix").value  = "";
  document.getElementById("modal-price-unit").value     = "20kg";
  document.getElementById("modal-title").textContent    = "➕ New Product Template";
  document.getElementById("ded-list").innerHTML         = "";
  document.getElementById("template-modal").style.display = "flex";
}

function editTemplate(id) {
  const t = currentTemplates[id];
  if (!t) return;
  activeTemplateId = id;
  document.getElementById("modal-template-name").value  = t.name         || "";
  document.getElementById("modal-series-prefix").value  = t.seriesPrefix  || "";
  document.getElementById("modal-price-unit").value     = t.priceUnit     || "20kg";
  document.getElementById("modal-title").textContent    = "✏️ Edit — " + t.name;
  document.getElementById("ded-list").innerHTML         = "";
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
  const idx  = list.children.length;
  const row  = document.createElement("div");
  row.className   = "ded-row";
  row.draggable   = true;
  row.dataset.idx = idx;

  const typeOpts = DEDUCTION_TYPES.map((t) =>
    `<option value="${t.value}" ${data.type === t.value ? "selected" : ""}>${t.label}</option>`
  ).join("");

  const isCustom = data.type === "custom";
  const stage    = DEDUCTION_TYPES.find((t) => t.value === data.type)?.stage || "weight";

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
      <input type="text" class="ded-custom-formula" placeholder="e.g. ₹50 per Quintal"
        value="${data.customFormula || ""}" style="${isCustom ? "" : "display:none;"}"/>
      <select class="ded-custom-stage" style="${isCustom ? "" : "display:none;"}">
        <option value="weight" ${data.customStage === "weight" ? "selected" : ""}>⚖️ Cuts from Weight</option>
        <option value="amount" ${data.customStage !== "weight" ? "selected" : ""}>💰 Cuts from Amount</option>
      </select>
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
  const typeSelect    = row.querySelector(".ded-type");
  const valueInput    = row.querySelector(".ded-value");
  const customInput   = row.querySelector(".ded-custom-formula");
  const customStage   = row.querySelector(".ded-custom-stage");
  const stageBadge    = row.querySelector('[data-role="stage-badge"]');

  function refreshStageBadge() {
    const selected = typeSelect.value;
    if (selected === "custom") {
      const s = customStage.value;
      stageBadge.className   = `ded-stage-badge stage-${s}`;
      stageBadge.textContent = s === "weight" ? "⚖️ WEIGHT" : "💰 AMOUNT";
    } else {
      const s = DEDUCTION_TYPES.find((t) => t.value === selected)?.stage || "weight";
      stageBadge.className   = `ded-stage-badge stage-${s}`;
      stageBadge.textContent = s === "weight" ? "⚖️ WEIGHT" : "💰 AMOUNT";
    }
  }

  typeSelect.addEventListener("change", () => {
    const custom = typeSelect.value === "custom";
    valueInput.style.display    = custom ? "none" : "";
    customInput.style.display   = custom ? "" : "none";
    customStage.style.display   = custom ? "" : "none";
    refreshStageBadge();
  });
  customStage.addEventListener("change", refreshStageBadge);

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
    name:           row.querySelector(".ded-name").value,
    type:           row.querySelector(".ded-type").value,
    value:          row.querySelector(".ded-value").value,
    customFormula:  row.querySelector(".ded-custom-formula").value,
    customStage:    row.querySelector(".ded-custom-stage").value,
    applyAs:        row.querySelector(".ded-apply").value,
    optional:       row.querySelector(".ded-optional").checked,
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
  const name      = document.getElementById("modal-template-name").value.trim();
  const prefix    = document.getElementById("modal-series-prefix").value.trim().toUpperCase();
  const priceUnit = document.getElementById("modal-price-unit").value;

  if (!name) { showToast("Template name is required!", "error"); return; }

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
      name:          dedName,
      type:          type,
      value:         type === "custom" ? 0 : (Number(row.querySelector(".ded-value").value) || 0),
      customFormula: type === "custom" ? row.querySelector(".ded-custom-formula").value.trim() : "",
      customStage:   type === "custom" ? row.querySelector(".ded-custom-stage").value : "",
      applyAs:       row.querySelector(".ded-apply").value,
      optional:      row.querySelector(".ded-optional").checked,
      // stage tells the calculation engine WHERE to cut this from:
      // "weight" = cuts from Net Weight (before vakal amount is calculated)
      // "amount" = cuts from Final Total (after vakal amount is calculated)
      stage: type === "custom"
        ? row.querySelector(".ded-custom-stage").value
        : (DEDUCTION_TYPES.find((t) => t.value === type)?.stage || "weight"),
    };
    if (ded.name) deductions.push(ded);
  });

  if (hasReservedNameConflict) {
    Swal.fire({
      icon:  "error",
      title: "⚠️ Reserved Deduction Name",
      html:  `<strong>Kasar, Kantan, Plastic, Bardan, Utrai,</strong> and <strong>Moisture</strong>
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
    icon: "warning", title: `Delete "${t.name}"?`,
    text: "This cannot be undone.",
    showCancelButton: true,
    confirmButtonColor: "#dc3545", cancelButtonColor: "#6c757d",
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
    toast: true, position: "top-end",
    icon: type, title: msg,
    showConfirmButton: false,
    timer: 2500, timerProgressBar: true,
  });
}
