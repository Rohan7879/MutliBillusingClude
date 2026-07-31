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

    // 2. Database se un saare bills ka data fetch karo aur Total Net Weight calculate karo
    let totalNetWeightKg = 0;
    if (billSerials.length > 0) {
      for (let i = 0; i < billSerials.length; i += 10) {
        const chunk = billSerials.slice(i, i + 10);
        const snap = await db.collection("bills").where("Serial No", "in", chunk).get();
        snap.forEach((doc) => {
          const bData = doc.data();
          if (bData.deleted !== true) {
            // Net weight kg ya Man/Quintal me ho sakta hai, apne bill structure ke mutabiq uthayein
            const netWt = Number(bData["Net Weight"] || bData.netWeight || 0);
            totalNetWeightKg += netWt;
          }
        });
      }
    }

    // 3. Suppliers array ko update karo
    const suppliers = [...(order.suppliers || [])];
    const supplierIdx = Number(billData["LinkedSupplierIdx"]) || 0;
    if (suppliers[supplierIdx]) {
      const unit = suppliers[supplierIdx].unit || "Man";

      // Agar unit Man hai toh kg ko Man me convert karein (20kg = 1 Man, ya jo bhi aapka standard ho)
      // Yahan hum direct bill ka weight unit ke hisaab se calculate karenge:
      let totalDeliveredCalculated = 0;
      if (billSerials.length > 0) {
        for (let i = 0; i < billSerials.length; i += 10) {
          const chunk = billSerials.slice(i, i + 10);
          const snap = await db.collection("bills").where("Serial No", "in", chunk).get();
          snap.forEach((doc) => {
            const bData = doc.data();
            if (bData.deleted !== true) {
              const netWt = Number(bData["Net Weight"] || 0);
              const bUnit = suppliers[supplierIdx].unit || "Man";
              const wtInUnit = bUnit === "Khadi" ? netWt / 400 : netWt / 20; // 20kg per Man standard
              totalDeliveredCalculated += wtInUnit;
            }
          });
        }
      }

      suppliers[supplierIdx].delivered = Math.round(totalDeliveredCalculated * 100) / 100;

      const totalOrdered = suppliers[supplierIdx].quantity || 0;
      const totalDelivered = suppliers[supplierIdx].delivered;

      let newStatus;
      if (closeOrderOverride) {
        newStatus = "Completed";
      } else if (totalDelivered >= totalOrdered) {
        newStatus = "Completed";
      } else if (totalDelivered > 0) {
        newStatus = "Partial";
      } else {
        newStatus = order.status;
      }

      // Update payload prepare karein
      let updatePayload = {
        suppliers,
        status: newStatus,
        linkedBillNos: billSerials,
        updatedAt: Date.now(),
      };

      await orderRef.update(updatePayload);
      console.log(`Order ${orderId} delivered quantity successfully synced: ${totalDelivered}`);
    }
  } catch (e) {
    console.error("Could not update order delivered qty:", e);
  }
}
window.loadOrderIntoForm = loadOrderIntoForm;
window.clearOrderLink = clearOrderLink;
window.updateOrderDeliveredQty = updateOrderDeliveredQty;

// Load orders on page load
document.addEventListener("DOMContentLoaded", loadPendingOrdersIntoDropdown);
