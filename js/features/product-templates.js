/**
 * @file product-templates.js
 * @description Connects Product Templates (created in Settings) to the Bill
 *              creation form. Handles: template dropdown, dynamic deduction
 *              rendering, live preview, and exposes selected template data
 *              to bill-form.js for calculation.
 * @project MandiBook — Agricultural Purchase Billing System
 * @version 1.0.0
 */

// ─── Global state read by bill-form.js during calculation ─────────────────────
// `window.activeTemplate` holds the currently selected product template object
// (or null if no template selected i.e. plain/manual bill).
window.activeTemplate = null;

let allProductTemplates = {}; // Loaded from Firestore: { id: templateData }

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  await loadProductTemplatesForBillForm();
  renderProductDropdown();
  attachProductChangeListener();
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetches all product templates from Firestore for use in the bill form.
 */
async function loadProductTemplatesForBillForm() {
  try {
    const doc = await db.collection("settings").doc("productTemplates").get();
    allProductTemplates = doc.exists ? (doc.data().templates || {}) : {};
  } catch (error) {
    console.error("Could not load product templates:", error);
    allProductTemplates = {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renders the product selection dropdown above the bill form
 * using the loaded templates.
 */
function renderProductDropdown() {
  const container = document.getElementById("product-template-selector");
  if (!container) return;

  const ids = Object.keys(allProductTemplates);

  if (ids.length === 0) {
    container.innerHTML = `
      <div class="no-template-banner">
        ℹ️ No product templates yet.
        <a href="core_settings.html">Create one in Settings →</a>
      </div>`;
    return;
  }

  const options = ids.map((id) =>
    `<option value="${id}">${allProductTemplates[id].name}</option>`
  ).join("");

  container.innerHTML = `
    <div class="product-select-row">
      <label>🌾 Product</label>
      <select id="product-template-select">
        <option value="">— Manual Bill (no template) —</option>
        ${options}
      </select>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT CHANGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Attaches the change listener to the product dropdown.
 * Loads the selected template into window.activeTemplate and
 * renders its deductions inline in the bill form.
 */
function attachProductChangeListener() {
  document.addEventListener("change", (e) => {
    if (e.target?.id !== "product-template-select") return;

    const selectedId = e.target.value;
    window.activeTemplate = selectedId ? allProductTemplates[selectedId] : null;

    renderTemplateDeductionsInForm();
    updateSeriesPreview();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER TEMPLATE DEDUCTIONS INTO THE BILL FORM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renders the active template's deductions as toggle-able fields
 * inside the bill form, just below the product selector.
 */
function renderTemplateDeductionsInForm() {
  // Remove old preview containers
  ["tpl-weight-preview", "tpl-amount-preview"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (!window.activeTemplate || !window.activeTemplate.deductions?.length) return;

  const weightDeds = window.activeTemplate.deductions.filter((d) => d.stage !== "amount");
  const amountDeds = window.activeTemplate.deductions.filter((d) => d.stage === "amount");

  // ── Weight deductions → insert AFTER bardan section (bag_supply_section) ──
  if (weightDeds.length > 0) {
    const bardanCard = document.getElementById("bag_supply_section")?.closest(".sc");
    if (bardanCard) {
      const box = document.createElement("div");
      box.id = "tpl-weight-preview";
      box.className = "sc";
      box.innerHTML = `
        <div class="sc-title" style="font-size:.8em;">⚖️ WEIGHT DEDUCTIONS (bardan ke baad katenge)</div>
        ${weightDeds.map((d, i) => renderDeductionField(d, i)).join("")}`;
      bardanCard.insertAdjacentElement("afterend", box);
    }
  }

  // ── Amount deductions → insert AFTER vakal section ──
  if (amountDeds.length > 0) {
    const vakalCard = document.getElementById("vakal_section")?.closest(".sc");
    if (vakalCard) {
      const box = document.createElement("div");
      box.id = "tpl-amount-preview";
      box.className = "sc";
      box.innerHTML = `
        <div class="sc-title" style="font-size:.8em;">💰 AMOUNT DEDUCTIONS (vakal amount ke baad katenge)</div>
        ${amountDeds.map((d, i) => renderDeductionField(d, i)).join("")}`;
      vakalCard.insertAdjacentElement("afterend", box);
    }
  }
}

/**
 * Renders a single deduction's input field, with optional toggle.
 * @param {Object} d   - Deduction definition from the template
 * @param {number} idx - Index for unique field naming
 * @returns {string} HTML
 */
function renderDeductionField(d, idx) {
  const fieldName  = `tpl_ded_${d.name.replace(/\s+/g, "_")}`;
  const valueLabel = d.type === "pct_weight" || d.type === "pct_amount" ? "%"
    : d.type === "fixed_bag" ? "₹/bag"
    : d.type === "fixed_kg"  ? "₹/kg"
    : d.type === "custom"    ? (d.customFormula || "custom")
    : "₹";

  const applyIcon  = d.applyAs === "add" ? "➕" : "➖";
  const applyColor = d.applyAs === "add" ? "#28a745" : "#dc3545";

  if (d.optional) {
    return `
      <div class="tpl-ded-field optional" data-ded-name="${d.name}">
        <label class="tpl-ded-toggle-label">
          <input type="checkbox" class="tpl-ded-toggle" data-field="${fieldName}" checked/>
          <span style="color:${applyColor};">${applyIcon} ${d.name}</span>
        </label>
        <input type="number" name="${fieldName}" step="any" min="0"
          placeholder="${d.value || 'Enter value'}" value="${d.type === 'custom' ? '' : d.value}"
          class="tpl-ded-value-input"/>
        <span class="tpl-ded-unit">${valueLabel}</span>
      </div>`;
  }

  // Non-optional — always applied, shown as read-only info
  return `
    <div class="tpl-ded-field fixed" data-ded-name="${d.name}">
      <span style="color:${applyColor};">${applyIcon} ${d.name}</span>
      <input type="number" name="${fieldName}" step="any" min="0"
        value="${d.type === 'custom' ? '' : d.value}" class="tpl-ded-value-input"/>
      <span class="tpl-ded-unit">${valueLabel}</span>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERIES PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shows a preview of what the bill series number will look like
 * based on the selected template's series prefix.
 */
function updateSeriesPreview() {
  const el = document.getElementById("series-preview");
  if (!el) return;

  const prefix = window.activeTemplate?.seriesPrefix || "";
  const now    = new Date();
  const fy     = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const fyShort = `${String(fy).slice(-2)}${String(fy + 1).slice(-2)}`;

  el.textContent = prefix
    ? `Preview: ${prefix}-${fyShort}-00001`
    : `Preview: ${String(now.getFullYear()).slice(-2)}/${String(now.getMonth()+1).padStart(2,"0")}-00001`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPOSE: Get active template deduction values from the form
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads the current values of all template deduction inputs from the form.
 * Used by bill-form.js calculation engine.
 * Skips deductions whose optional toggle is unchecked.
 * @returns {Array} List of { name, type, value, applyAs, stage, customFormula }
 */
function getActiveTemplateDeductionValues() {
  if (!window.activeTemplate?.deductions?.length) return [];

  return window.activeTemplate.deductions
    .map((d) => {
      const fieldName   = `tpl_ded_${d.name.replace(/\s+/g, "_")}`;
      const toggle      = document.querySelector(`.tpl-ded-toggle[data-field="${fieldName}"]`);
      const isActive    = d.optional ? (toggle ? toggle.checked : false) : true;
      if (!isActive) return null;

      const valueInput  = document.querySelector(`input[name="${fieldName}"]`);
      const value       = Number(valueInput?.value) || d.value || 0;

      return {
        name:          d.name,
        type:          d.type,
        value:         value,
        applyAs:       d.applyAs,
        stage:         d.stage || "weight",
        customFormula: d.customFormula || "",
      };
    })
    .filter(Boolean);
}

// Expose globally for bill-form.js
window.getActiveTemplateDeductionValues = getActiveTemplateDeductionValues;
