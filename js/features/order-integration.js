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

    snap.forEach((doc) => {
      const o = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `#${o.orderNo} — ${o.date}${o.supplierName ? " | " + o.supplierName : ""} (${o.status})`;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn("Could not load orders:", e);
  }
}

// ── AUTO-FILL FORM FROM ORDER ─────────────────────────────────────────────────
async function loadOrderIntoForm() {
  const select = document.getElementById("order-select");
  const orderId = select?.value;
  if (!orderId) return;

  try {
    const doc = await db.collection("orders").doc(orderId).get();
    if (!doc.exists) return;

    // Yahan order pehli baar define ho raha hai
    const order = doc.data();
    selectedOrderId = orderId;

    // ✅ FIX: Print layout mein Order Number set karna (Ab order variable define ho chuka hai)
    const refContainer = document.getElementById("print_ref_order_container");
    const refText = document.getElementById("print_ref_order_no");

    if (refContainer && refText) {
      refText.innerText = order.orderNo || "";
      refContainer.style.display = "block";
    }
    // -------------------------------------------------------------

    // One truck can carry several varieties. Let the biller select up to the
    // five Vakal rows available on the bill instead of forcing one supplier.
    if (order.suppliers && order.suppliers.length > 1) {
      const options = order.suppliers
        .map(
          (s, i) =>
            `<label style="display:flex;gap:10px;align-items:center;text-align:left;padding:9px;border-bottom:1px solid #edf2f7;cursor:pointer;">
              <input type="checkbox" class="swal-supplier-check" value="${i}" ${i === 0 ? "checked" : ""}>
              <span><strong>${s.variety || s.supplierName || "Item"}</strong> — ${s.product || "-"}<br><small>${s.quantity} ${s.unit} @ ₹${s.price}/${s.priceUnit}</small></span>
            </label>`
        )
        .join("");

      const { value: selected } = await Swal.fire({
        title: "Select varieties for this truck",
        html: `<p style="font-size:13px;color:#64748b;margin-top:0;">Select up to 5 varieties. Their variety and rate will fill separate Vakal rows.</p><div style="max-height:300px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;">${options}</div>`,
        confirmButtonText: "Auto-Fill",
        confirmButtonColor: "#005a9e",
        preConfirm: () => {
          const values = Array.from(document.querySelectorAll(".swal-supplier-check:checked")).map((input) => Number(input.value));
          if (!values.length) Swal.showValidationMessage("Select at least one variety.");
          if (values.length > 5) Swal.showValidationMessage("A bill has only 5 Vakal rows. Select up to 5 varieties.");
          return values;
        },
      });
      if (!selected) return;
      selectedSupplierIds = selected;
    } else {
      selectedSupplierIds = [0];
    }

    selectedSupplierId = selectedSupplierIds[0]; // compatibility with older linked bills
    const selectedSuppliers = selectedSupplierIds.map((index) => ({ ...order.suppliers[index], index }));
    const supplier = selectedSuppliers[0] || {};
    const distinctProducts = [...new Set(selectedSuppliers.map((item) => String(item.product || "").trim().toLowerCase()).filter(Boolean))];
    const templateWasSelected =
      distinctProducts.length === 1 &&
      typeof window.selectProductTemplateForBill === "function" &&
      window.selectProductTemplateForBill({ id: supplier.productTemplateId || "", name: supplier.product || "" });
    const rawCustomerText = order.supplierName || supplier.supplierName || order.broker || "";

    let customerName = rawCustomerText;
    let villageName = "";

    // 1. Agar order ke naam mein hi bracket (Village) hai toh tod do
    if (rawCustomerText.includes("(") && rawCustomerText.includes(")")) {
      const parts = rawCustomerText.split("(");
      customerName = parts[0].trim();
      villageName = parts[1].replace(")", "").trim();
    } else {
      // 2. Agar order mein sirf naam hai (jaise MANSUKH), toh Firestore ki 'customers' collection se village dhoond lo!
      try {
        const custSnap = await db.collection("customers").where("name", "==", customerName.toUpperCase()).get();
        if (!custSnap.empty) {
          const custData = custSnap.docs[0].data();
          if (custData.village) {
            villageName = custData.village;
          }
        }
      } catch (err) {
        console.warn("Village fetch error:", err);
      }
    }

    // Fill Customer Name box
    const nameInput = document.querySelector('input[name="customer_name"]');
    if (nameInput) {
      nameInput.value = customerName.toUpperCase();
      const party = (window.partiesMasterList || []).find(
        (item) => (item.name || "").trim().toLowerCase() === customerName.trim().toLowerCase() && item.deleted !== true
      );
      if (party && typeof lockSelectedCustomer === "function") lockSelectedCustomer(party);
    }

    // Fill Village box
    const villageInput =
      document.querySelector('input[name="village"]') || document.querySelector('input[placeholder*="Village"]');
    if (villageInput) {
      villageInput.value = villageName ? villageName.toUpperCase() : "";
      villageInput.dispatchEvent(new Event("input"));
    } // Fill broker
    if (order.broker) {
      const brokerInput = document.querySelector('input[name="broker_name"], input[name="broker"]');
      if (brokerInput) brokerInput.value = order.broker.toUpperCase();
    }

    // Each selected order variety gets its own Vakal row. Quantity is NOT
    // copied because an order's Man/Khadi quantity is not necessarily bag count.
    selectedSuppliers.forEach((item, rowIndex) => {
      const rowNo = rowIndex + 1;
      const varietyInput = document.querySelector(`input[name="vakal_${rowNo}_variety"]`);
      const rateInput = document.querySelector(`input[name="vakal_${rowNo}_bhav"]`);
      if (varietyInput) varietyInput.value = item.variety || "";
      if (rateInput) rateInput.value = item.priceUnit === "100kg" ? Math.round(Number(item.price || 0) / 5) : Number(item.price || 0);
    });

    // Show info banner
    const info = document.getElementById("order-link-info");
    if (info) {
      info.style.display = "block";
      info.innerHTML = `📦 <strong>Order #${order.orderNo}</strong> linked &nbsp;|&nbsp;
        🌾 ${selectedSuppliers.map((item) => item.variety || item.product || "Item").join(", ")} &nbsp;|&nbsp;
        👤 Broker: <strong>${order.broker || "—"}</strong>
        ${templateWasSelected ? `<br><small style="color:#198754;font-weight:700;">✓ Product template and bill prefix selected automatically</small>` : `<br><small style="color:#8a5a00;">⚠ No matching product template — choose the bill prefix manually</small>`}
        <br><small style="color:#6c757d;">Selected varieties ke rate alag Vakal rows me fill ho gaye hain; bags actual truck ke hisaab se bharo.</small>`;
    }

    // Phase 4 (item #17): show the manual "Close this Order" override checkbox
    const closeOrderWrap = document.getElementById("close-order-wrap");
    if (closeOrderWrap) closeOrderWrap.style.display = "flex";

    // Store order link in hidden field
    let hiddenOrder = document.getElementById("linked-order-id");
    if (!hiddenOrder) {
      hiddenOrder = document.createElement("input");
      hiddenOrder.type = "hidden";
      hiddenOrder.id = "linked-order-id";
      hiddenOrder.name = "linked_order_id";
      document.getElementById("estimateForm").appendChild(hiddenOrder);
    }
    hiddenOrder.value = orderId;

    let hiddenSupplier = document.getElementById("linked-supplier-idx");
    if (!hiddenSupplier) {
      hiddenSupplier = document.createElement("input");
      hiddenSupplier.type = "hidden";
      hiddenSupplier.id = "linked-supplier-idx";
      hiddenSupplier.name = "linked_supplier_idx";
      document.getElementById("estimateForm").appendChild(hiddenSupplier);
    }
    hiddenSupplier.value = selectedSupplierId;

    let hiddenLinks = document.getElementById("linked-order-supplier-links");
    if (!hiddenLinks) {
      hiddenLinks = document.createElement("input");
      hiddenLinks.type = "hidden";
      hiddenLinks.id = "linked-order-supplier-links";
      hiddenLinks.name = "linked_order_supplier_links";
      document.getElementById("estimateForm").appendChild(hiddenLinks);
    }
    hiddenLinks.value = JSON.stringify(selectedSupplierIds.map((supplierIdx, index) => ({ supplierIdx, vakalIndex: index + 1 })));

    Swal.fire({
      icon: "success",
      title: "✅ Order linked!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 1500,
    });
  } catch (e) {
    console.error(e);
    Swal.fire({
      icon: "error",
      title: "Could not load order.",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
  }
}

// ── CLEAR ORDER LINK ──────────────────────────────────────────────────────────
function clearOrderLink() {
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
  const orderId = billData["LinkedOrderId"];
  if (!orderId) return;

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return;
    const order = orderDoc.data();

    // 1. Is order ke saare linked bill numbers nikal lo
    let billSerials = [];
    if (order.linkedBillNos && Array.isArray(order.linkedBillNos)) {
      billSerials = order.linkedBillNos.map((b) => (b.billNo || b).toString().trim());
    } else if (order.linkedBillNo) {
      billSerials = order.linkedBillNo.split(",").map((s) => s.trim());
    }

    // Naya bill bhi add kar lo agar current bill serial me nahi hai
    const currentBillSerial = billData["Serial No"] || billData["billNo"] || "";
    if (currentBillSerial && !billSerials.includes(currentBillSerial)) {
      billSerials.push(currentBillSerial);
    }

    // Read linked bills once. New multi-variety bills keep a Vakal-row →
    // supplier mapping; older single-variety bills retain LinkedSupplierIdx.
    const linkedBills = [];
    if (billSerials.length > 0) {
      for (let i = 0; i < billSerials.length; i += 10) {
        const chunk = billSerials.slice(i, i + 10);
        const snap = await db.collection("bills").where("Serial No", "in", chunk).get();
        snap.forEach((doc) => {
          const bData = doc.data();
          if (bData.deleted !== true) linkedBills.push(bData);
        });
      }
    }

    // Recalculate delivery independently for EVERY supplier/variety in the
    // order. This prevents a multi-variety truck from being counted entirely
    // against only the first selected variety.
    const suppliers = [...(order.suppliers || [])];
    suppliers.forEach((supplier, supplierIdx) => {
      let deliveredKg = 0;
      linkedBills.forEach((linkedBill) => {
        const links = Array.isArray(linkedBill.OrderSupplierLinks) ? linkedBill.OrderSupplierLinks : [];
        if (links.length) {
          links.filter((link) => Number(link.supplierIdx) === supplierIdx).forEach((link) => {
            deliveredKg += Number(linkedBill[`Vakal ${Number(link.vakalIndex)} Kilo`] || 0);
          });
        } else if (Number(linkedBill["LinkedSupplierIdx"]) === supplierIdx) {
          deliveredKg += Number(linkedBill["Net Weight"] || 0);
        }
      });
      const divisor = supplier.unit === "Khadi" ? 400 : 20;
      supplier.delivered = Math.round((deliveredKg / divisor) * 100) / 100;
    });

    const hasDelivery = suppliers.some((supplier) => Number(supplier.delivered || 0) > 0);
    const allDelivered = suppliers.length > 0 && suppliers.every((supplier) => Number(supplier.delivered || 0) >= Number(supplier.quantity || 0));
    const newStatus = closeOrderOverride || allDelivered ? "Completed" : hasDelivery ? "Partial" : order.status;
    await orderRef.update({ suppliers, status: newStatus, linkedBillNos: billSerials, updatedAt: Date.now() });
    console.log(`Order ${orderId} delivery successfully synced for ${suppliers.length} varieties.`);
  } catch (e) {
    console.error("Could not update order delivered qty:", e);
  }
}
window.loadOrderIntoForm = loadOrderIntoForm;
window.clearOrderLink = clearOrderLink;
window.updateOrderDeliveredQty = updateOrderDeliveredQty;

// Load orders on page load
document.addEventListener("DOMContentLoaded", loadPendingOrdersIntoDropdown);
