/**
 * @file order-integration.js
 * @description Links Order Book to Bill Creation
 * Auto-fills form from order, updates delivered qty after bill save
 */

let selectedOrderId = null;
let selectedSupplierId = null;

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
  // Print layout mein Order Number set karna
  const refContainer = document.getElementById("print_ref_order_container");
  const refText = document.getElementById("print_ref_order_no");

  if (refContainer && refText) {
    refText.innerText = order.orderNo;
    refContainer.style.display = "block"; // Hide se hata kar show kar do
  }
  const select = document.getElementById("order-select");
  const orderId = select?.value;
  if (!orderId) return;

  try {
    const doc = await db.collection("orders").doc(orderId).get();
    if (!doc.exists) return;
    const order = doc.data();
    selectedOrderId = orderId;

    // If multiple suppliers — let user pick which one
    if (order.suppliers && order.suppliers.length > 1) {
      const options = order.suppliers
        .map(
          (s, i) =>
            `<option value="${i}">${s.supplierName || s.variety || "Item"} — ${s.product} (${s.quantity} ${s.unit} @ ₹${
              s.price
            }/${s.priceUnit})</option>`
        )
        .join("");

      const { value: idx } = await Swal.fire({
        title: "Select Supplier",
        html: `<select id="swal-supplier-select" class="swal2-select" style="width:100%;">${options}</select>`,
        confirmButtonText: "Auto-Fill",
        confirmButtonColor: "#005a9e",
        preConfirm: () => document.getElementById("swal-supplier-select").value,
      });
      if (idx === undefined) return;
      selectedSupplierId = Number(idx);
    } else {
      selectedSupplierId = 0;
    }

    const supplier = order.suppliers[selectedSupplierId] || {};
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
    }

    // Fill Village box
    const villageInput =
      document.querySelector('input[name="village"]') || document.querySelector('input[placeholder*="Village"]');
    if (villageInput) {
      villageInput.value = villageName ? villageName.toUpperCase() : "";
      villageInput.dispatchEvent(new Event("input"));
    } // Fill broker
    if (order.broker) {
      const brokerInput = document.querySelector('input[name="broker"]');
      if (brokerInput) brokerInput.value = order.broker.toUpperCase();
    }

    // Show info banner
    const info = document.getElementById("order-link-info");
    if (info) {
      info.style.display = "block";
      info.innerHTML = `📦 <strong>Order #${order.orderNo}</strong> linked &nbsp;|&nbsp;
        🌾 ${supplier.product} &nbsp;|&nbsp;
        📦 ${supplier.quantity} ${supplier.unit} &nbsp;|&nbsp;
        💰 ₹${supplier.price}/${supplier.priceUnit}
        <br><small style="color:#6c757d;">Vakal mein price manually fill karo: ₹${
          supplier.priceUnit === "100kg" ? Math.round(supplier.price / 5) : supplier.price
        } per 20kg</small>`;
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
  const select = document.getElementById("order-select");
  if (select) select.value = "";
  const info = document.getElementById("order-link-info");
  if (info) info.style.display = "none";
  const h1 = document.getElementById("linked-order-id");
  const h2 = document.getElementById("linked-supplier-idx");
  if (h1) h1.value = "";
  if (h2) h2.value = "";
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
  const supplierIdx = billData["LinkedSupplierIdx"];
  if (!orderId) return;

  // Phase 4 (item #16): wrapped in a Transaction so two bills saved against
  // the same order at nearly the same time (e.g. two people billing off the
  // same order) can't silently overwrite each other's delivered-quantity
  // update — each transaction re-reads the latest order state before writing.
  try {
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(orderRef);
      if (!doc.exists) return;
      const order = doc.data();
      const suppliers = [...(order.suppliers || [])];
      const idx = Number(supplierIdx) || 0;
      if (!suppliers[idx]) return;

      // Add net weight as delivered (in Khadi/Man based on unit)
      const netWeight = billData["Net Weight"] || 0;
      const unit = suppliers[idx].unit || "Man";
      const delivered = unit === "Khadi" ? netWeight / 400 : netWeight / 20;
      suppliers[idx].delivered = Math.round(((suppliers[idx].delivered || 0) + delivered) * 100) / 100;

      const totalOrdered = suppliers[idx].quantity || 0;
      const totalDelivered = suppliers[idx].delivered;
      let newStatus;
      if (closeOrderOverride) {
        // Manual override: force Completed regardless of the math
        newStatus = "Completed";
      } else if (totalDelivered >= totalOrdered) {
        newStatus = "Completed";
      } else if (totalDelivered > 0) {
        newStatus = "Partial";
      } else {
        newStatus = order.status;
      }

      // 👇 YAHAN NAYA LINKING LOGIC ADD HUA HAI 👇
      // Bill data me se bill number nikalna (jo bhi key tum save karte ho)
      const currentBillNo = billData["Bill No"] || billData["billNo"] || billData["display_serial_no"] || "";

      let updatePayload = {
        suppliers,
        status: newStatus,
        updatedAt: Date.now(),
      };

      if (currentBillNo) {
        // Agar pehle se koi bill linked hai, toh comma lagakar naya add kar do (Partial case ke liye)
        let existingBills = order.linkedBillNo ? order.linkedBillNo : "";
        if (!existingBills.includes(currentBillNo)) {
          updatePayload.linkedBillNo = existingBills ? `${existingBills}, ${currentBillNo}` : currentBillNo;
        }
      }
      // 👆 LINKING LOGIC END 👆

      transaction.update(orderRef, updatePayload);
    });

    console.log(`Order ${orderId} updated (supplier ${supplierIdx})${closeOrderOverride ? " — manually closed" : ""}`);
  } catch (e) {
    console.warn("Could not update order delivered qty:", e);
  }
}
window.loadOrderIntoForm = loadOrderIntoForm;
window.clearOrderLink = clearOrderLink;
window.updateOrderDeliveredQty = updateOrderDeliveredQty;

// Load orders on page load
document.addEventListener("DOMContentLoaded", loadPendingOrdersIntoDropdown);
