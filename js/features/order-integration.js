/**
 * @file order-integration.js
 * @description Links Order Book to Bill Creation
 * Auto-fills form from order, updates delivered qty after bill save
 */

let selectedOrderId = null;
let selectedSupplierId = null;
let selectedSupplierIds = [];

// ── LOAD ORDERS INTO DROPDOWN ─────────────────────────────────────────────────
async function loadPendingOrdersIntoDropdown() {
  const select = document.getElementById("order-select");
  if (!select) return;
  try {
    const snap = await db
      .collection("orders")
      .where("status", "in", ["Pending", "Partial"])
      .orderBy("createdAt", "desc")
      .get();

    const previous = select.value;
    while (select.options.length > 1) select.remove(1);
    snap.forEach((doc) => {
      const o = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `#${o.orderNo} — ${o.date}${o.supplierName ? " | " + o.supplierName : ""} (${o.status})`;
      select.appendChild(opt);
    });
    select.value = previous;
  } catch (e) {
    console.warn("Could not load orders:", e);
  }
}

// ── AUTO-FILL FORM FROM ORDER ─────────────────────────────────────────────────
let orderImportRequest = 0;
const orderText = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
async function loadOrderIntoForm() {
  const select = document.getElementById("order-select");
  const orderId = select?.value;
  if (!orderId) return;
  const form = document.getElementById("estimateForm");
  if (form.dataset.editId) {
    await Swal.fire("Existing linked bill", "An edit keeps its original order link. Create a new bill for another order.", "info");
    return;
  }
  const request = ++orderImportRequest;
  const current = () => request === orderImportRequest && select.value === orderId;
  try {
    const doc = await db.collection("orders").doc(orderId).get();
    if (!current()) return;
    if (!doc.exists) throw new Error("This order no longer exists. Refresh the order list.");
    const order = doc.data();
    if (!["Pending", "Partial"].includes(order.status)) throw new Error("Only Pending or Partial orders can be imported.");
    if (!order.suppliers?.length) throw new Error("This order has no items.");
    let indices = [0];
    if (order.suppliers.length > 1) {
      const options = order.suppliers.map((s, i) =>
        `<label style="display:flex;gap:10px;align-items:center;text-align:left;padding:9px;border-bottom:1px solid #edf2f7;">
          <input type="checkbox" class="swal-supplier-check" value="${i}" ${i === 0 ? "checked" : ""}>
          <span><strong>${orderText(s.variety || s.supplierName || "Item")}</strong> — ${orderText(s.product || "-")}<br>
          <small>${orderText(s.quantity)} ${orderText(s.unit)} @ ₹${orderText(s.price)}/${orderText(s.priceUnit)}</small></span></label>`
      ).join("");
      const result = await Swal.fire({
        title: "Select varieties for this truck",
        html: `<p>Select up to 5 varieties of the same product. Enter actual truck bags/weight after import.</p><div style="max-height:300px;overflow:auto;">${options}</div>`,
        showCancelButton: true, confirmButtonText: "Auto-Fill", confirmButtonColor: "#005a9e",
        preConfirm: () => {
          const values = Array.from(document.querySelectorAll(".swal-supplier-check:checked"), input => Number(input.value));
          if (!values.length || values.length > 5) { Swal.showValidationMessage("Select 1 to 5 varieties."); return false; }
          return values;
        },
      });
      if (!current() || !result.isConfirmed) return;
      indices = result.value;
    }
    if (!Array.isArray(indices) || !indices.length || indices.length > 5 ||
        indices.some(i => !Number.isInteger(i) || !order.suppliers[i]) || new Set(indices).size !== indices.length) {
      throw new Error("Select 1 to 5 different order items.");
    }
    const items = indices.map(i => order.suppliers[i]);
    const products = new Set(items.map(s => String(s.product || "").trim().toLowerCase()));
    if (products.size > 1) throw new Error("A bill has one product template. Import different products into separate bills.");
    const rates = items.map(item => {
      const rate = Number(item.price);
      if (!Number.isFinite(rate) || rate <= 0 || !["20kg", "100kg"].includes(item.priceUnit || "20kg")) {
        throw new Error("Review the order's rate and price unit first.");
      }
      return item.priceUnit === "100kg" ? Number((rate / 5).toFixed(6)) : rate;
    });
    const rawName = String(order.supplierName || items[0].supplierName || "");
    // Orders created from the Party Master are displayed as "Party (Village)".
    // Parse that display label back into the real party name before matching it;
    // otherwise the imported bill looks like free text and cannot lock/select the
    // existing Party Master record.
    const match = /^(.*?)\s*\((.*?)\)\s*$/.exec(rawName);
    const customerName = (match ? match[1] : rawName).trim();
    const party = (window.partiesMasterList || []).find(p =>
      p.deleted !== true && String(p.name || "").trim().toLowerCase() === customerName.toLowerCase());
    let village = order.village || (match && match[2]) || party?.village || party?.address || "";
    if (!village && customerName) {
      const customers = await db.collection("customers").where("name", "==", customerName.toUpperCase()).get();
      if (!customers.empty) village = customers.docs[0].data().village || "";
    }
    if (!current()) return;
    // No form/link/template mutation until every asynchronous step and selection
    // is complete. Cancel, Clear or a later import cannot leave half an old link.
    const templateSelected = typeof window.selectProductTemplateForBill === "function" &&
      window.selectProductTemplateForBill({ id: items[0].productTemplateId || "", name: items[0].product || "" });
    if (!templateSelected) {
      const template = document.getElementById("product-template-select");
      if (template) { template.value = ""; template.dispatchEvent(new Event("change", { bubbles: true })); }
      window.activeTemplate = null;
    }
    if (typeof unlockCustomerSelection === "function") unlockCustomerSelection();
    const set = (name, value) => { const field = form.querySelector(`[name="${name}"]`); if (field) field.value = value; };
    set("customer_id", "");
    set("customer_name", customerName.toUpperCase());
    set("village", String(village).toUpperCase());
    if (party && typeof lockSelectedCustomer === "function") lockSelectedCustomer(party);
    set("broker_name", String(order.broker || "").toUpperCase());
    set("broker_commission_per_bag", "0");
    const commission = document.getElementById("broker-commission-toggle");
    if (commission) { commission.checked = false; commission.dispatchEvent(new Event("change", { bubbles: true })); }
    // Replacing an import must not retain bags/rates/moisture from unused rows.
    for (let row = 1; row <= 5; row++) {
      set(`vakal_${row}_variety`, items[row - 1]?.variety || "");
      set(`vakal_${row}_bhav`, rates[row - 1] ?? "");
      set(`vakal_${row}_katta`, "");
      set(`vakal_${row}_moisture`, "0");
    }
    set("loose_price", items.length === 1 ? rates[0] : "");
    if (items.length > 1 || items.some(s => s.unit === "Bag")) {
      const loose = form.querySelector('[name="is_loose_supply"]');
      if (loose) { loose.checked = false; loose.dispatchEvent(new Event("change", { bubbles: true })); }
    }
    selectedOrderId = orderId;
    selectedSupplierIds = indices;
    selectedSupplierId = indices[0];
    const fields = [
      ["linked-order-id", "linked_order_id", orderId],
      ["linked-supplier-idx", "linked_supplier_idx", indices[0]],
      ["linked-order-supplier-links", "linked_order_supplier_links", JSON.stringify(indices.map((supplierIdx, i) => ({ supplierIdx, vakalIndex: i + 1 })))],
    ];
    for (const [id, name, value] of fields) {
      let field = document.getElementById(id);
      if (!field) { field = document.createElement("input"); field.type = "hidden"; field.id = id; field.name = name; form.appendChild(field); }
      field.value = value;
    }
    const refContainer = document.getElementById("print_ref_order_container");
    const refText = document.getElementById("print_ref_order_no");
    if (refContainer && refText) { refText.textContent = order.orderNo || ""; refContainer.style.display = "block"; }
    const info = document.getElementById("order-link-info");
    if (info) {
      info.style.display = "block";
      info.innerHTML = `📦 <strong>Order #${orderText(order.orderNo)}</strong> · ${items.map(s => orderText(s.variety || s.product || "Item")).join(", ")}
        <br><small>${templateSelected ? "✓ Product template and prefix selected." : "⚠ Choose a matching product template / bill prefix manually."}
        Rates imported. Enter actual bags/weight; review deductions and broker commission. Keep Close this Order OFF for automatic delivery tracking.</small>`;
    }
    const closeWrap = document.getElementById("close-order-wrap");
    if (closeWrap) closeWrap.style.display = "flex";
    const close = document.getElementById("close_order_checkbox");
    if (close) close.checked = false;
    form.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof billDraft !== "undefined") billDraft?.touch();
    await Swal.fire({ icon: "success", title: "Order linked — review truck quantities", toast: true, position: "top-end", showConfirmButton: false, timer: 2000 });
  } catch (error) {
    if (!current()) return;
    console.error("Order import failed:", error);
    await Swal.fire("Could not import order", error.message || "Please retry after checking your connection.", "error");
  }
}

// ── CLEAR ORDER LINK ──────────────────────────────────────────────────────────
function clearOrderLink() {
  orderImportRequest++;
  selectedOrderId = null;
  selectedSupplierId = null;
  selectedSupplierIds = [];
  const select = document.getElementById("order-select");
  if (select) select.value = "";
  const info = document.getElementById("order-link-info");
  if (info) info.style.display = "none";
  const h1 = document.getElementById("linked-order-id");
  const h2 = document.getElementById("linked-supplier-idx");
  const h3 = document.getElementById("linked-order-supplier-links");
  if (h1) h1.value = "";
  if (h2) h2.value = "";
  if (h3) h3.value = "";
  // Phase 4 (item #17): hide + reset the manual close-order checkbox too
  const closeOrderWrap = document.getElementById("close-order-wrap");
  const closeOrderCheckbox = document.getElementById("close_order_checkbox");
  if (closeOrderWrap) closeOrderWrap.style.display = "none";
  if (closeOrderCheckbox) closeOrderCheckbox.checked = false;
  const ref = document.getElementById("print_ref_order_container");
  const refText = document.getElementById("print_ref_order_no");
  if (ref) ref.style.display = "none";
  if (refText) refText.textContent = "";
  if (typeof billDraft !== "undefined") billDraft?.touch();
}

// ── UPDATE ORDER AFTER BILL SAVED ─────────────────────────────────────────────
// Called from bill-form.js after successful bill save
/**
 * @param {Object} billData
 * @param {boolean} closeOrderOverride - Phase 4 (item #17): if true, force
 *   the order status to "Completed" regardless of the delivered/ordered
 *   math (user manually checked "Close this Order" on the bill form).
 */
async function updateOrderDeliveredQty(billData, closeOrderOverride = false) {
  if (!billData.LinkedOrderId) return;
  if (!window.MandiOrderSync) throw new Error("Order sync module is unavailable. Reload before retrying.");
  return MandiOrderSync.sync(billData.LinkedOrderId, {
    delivery: true,
    extraSerial: billData["Serial No"] || billData.billNo || "",
    closeOrder: closeOrderOverride,
  });
}
window.loadOrderIntoForm = loadOrderIntoForm;
window.clearOrderLink = clearOrderLink;
window.updateOrderDeliveredQty = updateOrderDeliveredQty;

// Load orders on page load
document.addEventListener("DOMContentLoaded", loadPendingOrdersIntoDropdown);
