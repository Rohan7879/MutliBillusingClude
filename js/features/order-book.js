/**
 * @file order-book.js
 * @description Order Book management - create, view, update orders
 * Multi supplier + product per order, Khadi/Man tracking
 * @project MandiBook
 */

const ordersCollection = db.collection("orders");
let allOrders = [];
let currentFilter = "All";
let editingOrderId = null;
let supplierCount = 0;
let orderDraft = null;
let orderSaveRef = null;
let orderEditVersion = null;
let orderEditBaseline = null;

function setOrderSyncStatus(message, isError = false) {
  const target = document.getElementById("orderSyncStatus");
  if (!target) return;
  target.textContent = message;
  target.style.color = isError ? "#fee2e2" : "";
  target.style.borderColor = isError ? "rgba(252,165,165,.55)" : "";
}

function setActiveOrderFilter(status) {
  document.querySelectorAll(".order-tabs button").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("onclick")?.includes(`'${status}'`));
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
// 🚀 Real-time Live Listener - Jab bhi bills ya orders badlenge, yeh khud-b-khud update kar dega
document.addEventListener("DOMContentLoaded", () => {
  setDefaultDate();
  loadMasterProducts();
  loadVarieties();
  setupPartyMasterDatalists();

  // Real-time synchronization shuru karo
  initRealtimeDataSync();
});

function initRealtimeDataSync() {
  showLoading();

  // 1. Bills par live listener lagao
  db.collection("bills").onSnapshot(
    (billsSnap) => {
      window.allBills = billsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      console.log("⚡ Live Bills Synced:", window.allBills.length);

      // Agar orders loaded hain toh turant re-render karo
      if (typeof renderOrders === "function" && window.allOrders) {
        renderOrders();
      }
    },
    (err) => {
      console.error("Bills live sync error:", err);
    }
  );

  // 2. Orders par live listener lagao
  ordersCollection.orderBy("createdAt", "desc").onSnapshot(
    (snap) => {
      allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      window.allOrders = allOrders;
      console.log("⚡ Live Orders Synced:", window.allOrders.length);

      hideLoading();
      setOrderSyncStatus(`Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      if (typeof renderOrders === "function") {
        renderOrders();
      }
    },
    (err) => {
      console.error("Orders live sync error:", err);
      hideLoading();
      setOrderSyncStatus("Could not refresh orders", true);
    }
  );
}

function setDefaultDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const el = document.getElementById("order-date");
  if (el) el.value = `${yyyy}-${mm}-${dd}`;
}

// Khali array, jo database se bharega
let masterProducts = [];

// Page load hote hi Firebase se products fetch karna
// Page load hote hi Firebase se products fetch karna
async function loadMasterProducts() {
  try {
    const snap = await db.collection("products").orderBy("createdAt", "asc").get();

    // Purana data clear karo
    masterProducts = [];

    snap.docs.forEach((doc) => {
      const data = doc.data();
      // Sirf wahi product dikhao jiska isActive false NAHI hai (Soft delete logic)
      if (data.isActive !== false) {
        masterProducts.push({
          id: doc.id,
          name: data.name,
          label: data.label,
        });
      }
    });
  } catch (e) {
    console.error("Error loading products:", e);
  }
}

// Existing DOMContentLoaded mein isko call kar lo:
// Dropdown banane wala function (Yeh wahi hai jo pehle bataya tha)
function generateProductOptions(selectedId) {
  let optionsHTML = `<option value="" data-name="" disabled ${!selectedId ? "selected" : ""}>Select Product</option>`;
  masterProducts.forEach((product) => {
    const isSelected = selectedId === product.id ? "selected" : "";
    optionsHTML += `<option value="${product.id}" data-name="${product.name}" ${isSelected}>${product.label}</option>`;
  });
  return optionsHTML;
}

// ── LOAD ORDERS ───────────────────────────────────────────────────────────────
async function loadOrders() {
  showLoading();
  try {
    const snap = await ordersCollection.orderBy("createdAt", "desc").get();
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Yahan se extra kachra list nikalne wala code hata diya gaya hai
    renderOrders();
  } catch (e) {
    console.error("Error loading orders:", e);
  } finally {
    hideLoading();
  }
}
// ── FILTER ────────────────────────────────────────────────────────────────────
function filterOrders(status) {
  currentFilter = status;
  setActiveOrderFilter(status);
  renderOrders();
}
// 4. Main Render Orders Function
function renderOrders() {
  const container = document.getElementById("order-list");
  if (!container) return;

  const filtered = getFilteredOrders();
  updateOrderSummary(filtered);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#6c757d;padding:30px;font-size:15px;">
      📭 No orders found.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((order) => {
      const statusClass =
        {
          Pending: "status-pending",
          Partial: "status-partial",
          Completed: "status-completed",
          Cancelled: "status-cancelled",
          Deleted: "status-cancelled",
        }[order.status] || "status-pending";

      const statusEmoji =
        {
          Pending: "⏳",
          Partial: "🔄",
          Completed: "✅",
          Cancelled: "❌",
          Deleted: "🗑️",
        }[order.status] || "⏳";
      const manualCloseBadge = order.deliveryClosedManually === true
        ? `<span class="status-badge" style="background:#fff3cd;color:#7a5200;border:1px solid #f5cf74;margin-left:4px;" title="This order was manually closed. It is not proof that all bags were billed or delivered.">✋ Manually closed</span>`
        : "";

      // 1️⃣ PEHLE Supplier Name yahan nikal lo (Taki error na aaye)
      let mainSupplierName = order.supplier || order.supplierName || order.partyName || order.party || "";
      if (!mainSupplierName && order.suppliers && Array.isArray(order.suppliers)) {
        let orderSuppliersList = [];
        order.suppliers.forEach((s) => {
          const sName = s.supplierName || s.supplier || s.partyName || s.party || s.name || "";
          if (sName && !orderSuppliersList.includes(sName)) {
            orderSuppliersList.push(sName);
          }
        });
        if (orderSuppliersList.length > 0) {
          mainSupplierName = orderSuppliersList.join(", ");
        }
      }

      // 2️⃣ PHIR Payment Badge banao (Ab ye mainSupplierName ko araam se use kar lega)
      // 🚀 Dynamic Payment Status Check (Linked Bills ke aadhar par)
      // 1️⃣ Sabse pehle function call karke container variable banayein
      const paymentBadgeContainer =
        typeof getOrderPaymentStatus === "function"
          ? getOrderPaymentStatus(order, mainSupplierName)
          : `<span style="background: #28a745; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px;">Paid -> Ledger</span>`;

      // 2️⃣ Ab is variable ko apne HTML card template ke andar aaram se use karein
      // 🚀 Dynamic Payment Status & Ledger Link (Ek hi baar mein sab ban jayega)
      const paymentBadgeHtml =
        typeof getOrderPaymentStatus === "function"
          ? getOrderPaymentStatus(order, mainSupplierName)
          : `<span onclick="openCustomerLedger('${mainSupplierName}')" style="background: #28a745; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;">Paid -> Ledger</span>`;
      // Item rows
      const suppliers = (order.suppliers || [])
        .map((s) => {
          const qty = Number(s.quantity) || 0;
          const del = Number(s.delivered) || 0;

          let percent = 0;
          let barWidth = 0;

          if (qty > 0) {
            percent = Math.round((del / qty) * 100);
            barWidth = percent > 100 ? 100 : percent;
          }

          let barColor = "#005a9e"; // Partial (Blue)
          let statusText = `${del} / ${qty} <span style="font-size:11px;">(${percent}%)</span>`;

          if (percent === 100) {
            barColor = "#28a745"; // Complete (Green)
          } else if (percent > 100) {
            barColor = "#dc3545"; // Over delivered (Red Alert)
            statusText = `<span style="color:#dc3545;">${del} / ${qty} <span style="font-size:11px;">(${percent}% - Over)</span></span>`;
          }

          return `
<div style="margin-bottom: 8px; border-bottom: 1px dashed #eee; padding-bottom: 8px;">
 <div class="supplier-row" style="border: none; margin-bottom: 2px; padding-bottom: 0; align-items: flex-start;">
   <div><strong>${s.variety || "-"}</strong></div>
   <div>${s.product || "-"}</div>
   <div>${qty} ${s.unit || "Man"}</div>
   <div>₹${s.price || 0}/${s.priceUnit || "20kg"}</div>
   <span style="color:#6c757d; font-weight:600; text-align:right;">
     ${statusText}
   </span>
 </div>
 
 <div style="width: 100%; background: #e9ecef; border-radius: 4px; height: 6px; overflow: hidden; margin-top: 4px;">
   <div style="width: ${barWidth}%; background: ${barColor}; height: 100%; transition: width 0.3s ease;"></div>
 </div>
</div>`;
        })
        .join("");

      // Linked Bills Badges
      let billBadgesHtml = "";
      if (order.linkedBillNos && order.linkedBillNos.length > 0) {
        billBadgesHtml = order.linkedBillNos
          .map(
            (bNo) => `
          <span class="badge linked-bill" onclick="openLinkedBill('${bNo.trim()}')" style="display:inline-block; margin-top:4px; margin-left:4px; background: #e0f7fa; color: #00796b; padding: 4px 8px; font-size: 11px; border-radius: 4px; font-weight:bold; cursor:pointer; border: 1px dashed #00796b;" title="Click to view bill ${bNo}">
            🔗 ${bNo}
          </span>
        `
          )
          .join("");
      } else if (order.linkedBillNo) {
        billBadgesHtml = `
          <span class="badge linked-bill" onclick="openLinkedBill('${order.linkedBillNo.trim()}')" style="display:inline-block; margin-top:4px; background: #e0f7fa; color: #00796b; padding: 4px 8px; font-size: 11px; border-radius: 4px; font-weight:bold; cursor:pointer; border: 1px dashed #00796b;" title="Click to view bill">
            🔗 Billed in: ${order.linkedBillNo}
          </span>
        `;
      }

      // Supplier Name in Header

      if (!mainSupplierName && order.suppliers && Array.isArray(order.suppliers)) {
        let orderSuppliersList = [];
        order.suppliers.forEach((s) => {
          const sName = s.supplierName || s.supplier || s.partyName || s.party || s.name || "";
          if (sName && !orderSuppliersList.includes(sName)) {
            orderSuppliersList.push(sName);
          }
        });
        if (orderSuppliersList.length > 0) {
          mainSupplierName = orderSuppliersList.join(", ");
        }
      }

      const headerSupplierHtml = mainSupplierName
        ? ` &nbsp;|&nbsp; 🏭 <span style="color:#d35400; font-weight:700;">${mainSupplierName}</span>`
        : "";

      const isLocked = order.status === "Completed" || order.status === "Partial";

      return `
      <div class="order-card">
        <div class="order-card-header" style="display: flex; justify-content: space-between; align-items: center;">
          
          <!-- Left Side: Order No & Date -->
          <div>
            <div class="order-no">#${order.orderNo}</div>
            <div class="order-date">📅 ${order.date}</div>
          </div>
    
        <!-- Center: Supplier (Top) & Broker (Bottom) - Bada Size -->
      <div style="text-align: center; flex: 1; padding: 0 15px;">
        ${
          mainSupplierName
            ? `<div style="font-size: 15px; font-weight: 800; color: #d35400;">🏭 ${mainSupplierName}</div>`
            : ""
        }
        ${
          order.broker
            ? `<div style="font-size: 13px; font-weight: 700; color: #343a40; margin-top: 3px;">🤝 ${order.broker}</div>`
            : ""
        }
      </div>
          
          <!-- Right Side: Status Badges & Bills -->
          <div style="text-align: right;">
            <span class="status-badge ${statusClass}">${statusEmoji} ${order.status}</span>
            ${manualCloseBadge}
            ${paymentBadgeHtml}
            ${billBadgesHtml ? `<br>${billBadgesHtml}` : ""}
          </div>
        </div>
    
        <div class="supplier-row supplier-row-header" style="margin-bottom:4px;">
          <span>Variety</span><span>Product</span><span>Qty (Ordered)</span>
          <span>Rate</span><span>Delivered</span>
        </div>
        
        ${suppliers}
    
        ${order.notes ? `<div style="margin-top:8px;font-size:12px;color:#6c757d;">📝 ${order.notes}</div>` : ""}
        ${
          order.cancelReason
            ? `<div style="margin-top:8px;font-size:12px;color:#dc3545;background:#ffe5e5;padding:6px;border-radius:4px;border:1px solid #ffcccc;">⚠️ <strong>Reason:</strong> ${order.cancelReason}</div>`
            : ""
        }
    
        ${
          order.status === "Cancelled" || order.status === "Deleted"
            ? ""
            : `
          <div class="order-actions">
            <button class="btn-primary" style="padding:7px 14px;font-size:12px;" onclick="editOrder('${
              order.id
            }')">✏️ Edit</button>
            ${order.deliveryClosedManually === true
              ? `<button style="padding:7px 14px;font-size:12px;background:#f59e0b;color:#1f2937;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="reopenOrder('${order.id}')">↩ Reopen</button>`
              : `<button style="padding:7px 14px;font-size:12px;background:#28a745;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${order.id}','Completed')">✅ Complete</button>`}
            <button style="padding:7px 14px;font-size:12px;background:#17a2b8;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${
              order.id
            }','Partial')">🔄 Partial</button>
            <button style="padding:7px 14px;font-size:12px;background:#25D366;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="shareOrderOnWhatsApp('${
              order.id
            }')">📱 WhatsApp</button>
            
            ${
              !isLocked
                ? `
              <button style="padding:7px 14px;font-size:12px;background:#6c757d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${order.id}','Cancelled')">❌ Cancel</button>
              <button style="padding:7px 14px;font-size:12px;background:#dc3545;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="deleteOrder('${order.id}')">🗑️</button>
            `
                : ""
            }
          </div>
          `
        }
      </div>`;
    })
    .join("");
}

// Payment status change karne ka click function
async function togglePaymentStatus(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  const previousStatus = order.paymentStatus;
  let newStatus;
  if (!previousStatus || previousStatus === "Unpaid") {
    newStatus = "Partial";
  } else if (previousStatus === "Partial") {
    newStatus = "Paid";
  } else {
    newStatus = "Unpaid";
  }

  // Optimistic UI update — turant dikha do, phir Firestore mein save karo
  order.paymentStatus = newStatus;
  renderOrders();

  try {
    await ordersCollection.doc(orderId).update({
      paymentStatus: newStatus,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.error("Could not save payment status:", e);
    // Save fail hui to screen par bhi purana status wapas dikha do,
    // warna UI aur database mismatch dikhega
    order.paymentStatus = previousStatus;
    renderOrders();
    if (typeof Swal !== "undefined") {
      Swal.fire("Error", "Payment status save nahi ho paya. Dobara try karein.", "error");
    }
  }
}
async function closeOrderModal(saved = false) {
  if (saved !== true && window.MandiFormSafety?.isBusy("order")) return;
  if (saved !== true && orderDraft?.dirty) {
    orderDraft.flush();
    const result = await Swal.fire({
      icon: "question",
      title: "Discard unsaved order changes?",
      text: "Your changes are saved only as a local browser draft. Firebase order data will not change.",
      showCancelButton: true,
      confirmButtonColor: "#dc3545",
      cancelButtonColor: "#0b6fb3",
      confirmButtonText: "Discard changes",
      cancelButtonText: "Keep editing",
    });
    if (!result.isConfirmed) return;
  }
  if (saved === true) orderDraft?.saved();
  orderDraft?.dispose();
  orderDraft = null;
  document.getElementById("order-modal").classList.remove("open");
  editingOrderId = null;
  orderSaveRef = null;
  orderEditBaseline = null;
}
function addSupplierEntry(data = {}) {
  supplierCount++;
  const idx = supplierCount;
  const div = document.createElement("div");
  div.className = "supplier-entry";
  div.id = `supplier-${idx}`;

  div.innerHTML = `
    <div class="supplier-entry-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-weight: bold; color: #005a9e; font-size: 15px;">Vakal ${idx}</span>
      <button type="button" class="remove-supplier-btn" onclick="document.getElementById('supplier-${idx}').remove(); orderDraft?.touch()">✕ Remove</button>
    </div>

    <!-- Variety Dropdown -->
  <div style="margin-bottom: 10px;">
      <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 2px;">Variety *</label>
      <input type="text" name="s-variety-${idx}" list="variety-options-list" placeholder="Type or select variety..." value="${
    escapeHtml(data.variety || "")
  }" oninput="this.value = this.value.toUpperCase()" style="width: 100%; padding: 10px 13px; border: 1.5px solid #dee2e6; border-radius: 8px; font-size: 14px; outline: none; text-transform: uppercase;"/>
      
      <datalist id="variety-options-list">
        ${generateVarietyDatalistOptions()}
      </datalist>
    </div>
    <div class="supplier-grid">
      <div class="ff" style="margin:0;">
        <label>Product *</label>
        <select name="s-product-${idx}" style="width: 100%; padding: 10px 13px; border: 1.5px solid #dee2e6; border-radius: 8px; font-size: 14px;">
          ${generateProductOptions(data.productId)}
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Quantity</label>
        <input type="number" name="s-qty-${idx}" min="0" step="any" placeholder="0" value="${escapeHtml(data.quantity ?? "")}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Unit</label>
        <select name="s-unit-${idx}">
          <option value="Man" ${data.unit === "Man" ? "selected" : ""}>Man (20kg)</option>
          <option value="Khadi" ${data.unit === "Khadi" ? "selected" : ""}>Khadi (400kg)</option>
          <option value="Bag" ${data.unit === "Bag" ? "selected" : ""}>Bag</option>
          <option value="Quintal" ${data.unit === "Quintal" ? "selected" : ""}>Quintal (100kg)</option>
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Rate (Price)</label>
        <input type="number" name="s-price-${idx}" min="0" placeholder="0" step="any" value="${escapeHtml(data.price ?? "")}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Price Per</label>
        <select name="s-priceunit-${idx}">
          <option value="20kg" ${data.priceUnit === "20kg" ? "selected" : ""}>Per 20kg</option>
          <option value="100kg" ${data.priceUnit === "100kg" ? "selected" : ""}>Per 100kg</option>
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Delivered So Far <small style="color:#64748b;">(from bills)</small></label>
        <input type="number" name="s-delivered-${idx}" min="0" step="any" readonly title="Delivery is calculated from linked bills" placeholder="0" value="${escapeHtml(data.delivered ?? 0)}"/>
      </div>
    </div>`;
  document.getElementById("supplier-entries").appendChild(div);
  orderDraft?.touch();
}

// =====================================================================
// Naya Sequential Order Number Generator
// =====================================================================
// =====================================================================
// Order Number Generator (Matched with your 'counters' DB collection)
// =====================================================================
function orderNumberSeries(now = new Date()) {
  const year = now.getFullYear() - (now.getMonth() < 3 ? 1 : 0);
  return String(year).slice(-2) + String(year + 1).slice(-2);
}

function readOrderItems() {
  return [...document.querySelectorAll('#supplier-entries .supplier-entry')].map(row => {
    const select = row.querySelector('[name^="s-product-"]');
    const value = part => row.querySelector('[name^="s-' + part + '-"]')?.value ?? "";
    return {
      variety: value("variety").trim().toUpperCase(), vakalTitle: value("title"),
      productId: value("product"),
      product: select?.selectedOptions[0]?.dataset.name || select?.selectedOptions[0]?.textContent || "",
      quantity: value("qty"), unit: value("unit"), price: value("price"),
      priceUnit: value("priceunit"), delivered: value("delivered"),
    };
  });
}

function collectValidatedOrder() {
  const date = document.getElementById("order-date").value;
  const parsed = new Date(date + "T12:00:00");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) ||
      parsed.getFullYear() !== Number(date.slice(0, 4)) ||
      parsed.getMonth() + 1 !== Number(date.slice(5, 7)) || parsed.getDate() !== Number(date.slice(8, 10))) {
    throw new Error("Choose a valid order date.");
  }
  const name = document.getElementById("order-supplier").value.trim().toUpperCase();
  const village = document.getElementById("order-village").value.trim().toUpperCase();
  if (!name || !window.validPartyNames?.includes(name)) throw new Error("Select an existing Party Master supplier. Wait for the party list to load if needed.");
  const items = readOrderItems();
  if (!items.length || items.length > 100) throw new Error("Add between 1 and 100 Vakal items.");
  const suppliers = items.map((item, i) => {
    const fail = message => { throw new Error("Vakal " + (i + 1) + ": " + message); };
    if (!masterProducts.some(product => product.id === item.productId)) fail("Select an available product.");
    if (!item.variety) fail("Enter a variety.");
    for (const key of ["quantity", "price", "delivered"]) {
      const raw = String(item[key]).trim();
      if ((key !== "delivered" && !raw) || !Number.isFinite(Number(raw)) || Number(raw) < 0) fail("Enter a valid, non-negative " + key + ".");
      item[key] = Number(raw);
    }
    if (item.quantity <= 0 || item.price <= 0) fail("Quantity and rate must be greater than zero.");
    if (!["Man", "Khadi", "Bag", "Quintal"].includes(item.unit) || !["20kg", "100kg"].includes(item.priceUnit)) fail("Select a valid unit.");
    if (item.unit === "Bag" && (!Number.isInteger(item.quantity) || !Number.isInteger(item.delivered))) fail("Bag quantities must be whole numbers.");
    if (item.delivered > item.quantity) {
      fail(`Already delivered: ${item.delivered} ${item.unit}. Ordered quantity cannot be lower than delivered quantity. Correct/archive the linked bill first, then reopen this order.`);
    }
    return { ...item, vakalTitle: item.vakalTitle || "Vakal " + (i + 1) };
  });
  const [yyyy, mm, dd] = date.split("-");
  return { date: dd + "/" + mm + "/" + yyyy, supplierName: village ? name + " (" + village + ")" : name,
    broker: document.getElementById("order-broker").value.trim(),
    notes: document.getElementById("order-notes").value.trim(), suppliers, updatedAt: Date.now() };
}

function initializeOrderDraft() {
  const editor = document.getElementById("order-editor");
  if (!editor || !document.getElementById("order-modal").classList.contains("open") || orderDraft) return;
  orderDraft = window.MandiFormSafety?.createDraft({
    container: editor, kind: "order:" + (editingOrderId || "new"),
    capture: () => ({
      fields: MandiFormSafety.fields(editor).filter(field => field.key.startsWith("id:")),
      suppliers: readOrderItems(), version: orderEditVersion, requestId: orderSaveRef?.id || "",
    }),
    restore: async data => {
      if (!Array.isArray(data.suppliers) || !data.suppliers.length || data.suppliers.length > 100) throw new Error("Invalid draft items. Saved copy retained.");
      if (editingOrderId && data.version !== orderEditVersion) throw new Error("This order changed since the draft was made. Review the current order; the old draft has not been applied.");
      if (data.suppliers.some(item => !masterProducts.some(product => product.id === item.productId))) throw new Error("A draft product is unavailable or still loading. Retry after the product list loads.");
      MandiFormSafety.restoreFields(editor, data.fields);
      document.getElementById("supplier-entries").replaceChildren();
      supplierCount = 0;
      data.suppliers.forEach(addSupplierEntry);
      if (!editingOrderId && /^[A-Za-z0-9]{20}$/.test(data.requestId || "")) orderSaveRef = ordersCollection.doc(data.requestId);
    },
  });
}
window.addEventListener("mandibook:access-ready", initializeOrderDraft);

// Validate everything before any write. Counter + order + variety names commit
// together. Keep a stable document ID when retrying an uncertain request.
async function saveOrder() {
  if (window.MandiFormSafety.isBusy("order")) return;
  let data;
  try { data = collectValidatedOrder(); }
  catch (error) { await Swal.fire("Check order details", error.message, "warning"); return; }
  if (editingOrderId && orderEditBaseline) {
    const changes = data.suppliers.map((item, index) => {
      const before = orderEditBaseline.suppliers?.[index] || {};
      const oldValue = `${before.quantity ?? 0} ${before.unit || ""}`.trim();
      const newValue = `${item.quantity} ${item.unit}`;
      return oldValue !== newValue ? `Vakal ${index + 1}: ${oldValue} → ${newValue}` : "";
    }).filter(Boolean);
    if (changes.length) {
      const confirmation = await Swal.fire({
        icon: "warning",
        title: "Confirm order quantity change",
        html: `<p style="margin:0 0 10px">Delivery will be recalculated from active linked bills after save.</p><div style="text-align:left;background:#f8fafc;border:1px solid #dbeafe;border-radius:10px;padding:12px;font-weight:700">${changes.map(change => `<div>${escapeHtml(change)}</div>`).join("")}</div>`,
        showCancelButton: true,
        confirmButtonColor: "#005a9e",
        confirmButtonText: "Save corrected order",
        cancelButtonText: "Keep editing",
      });
      if (!confirmation.isConfirmed) return;
    }
  }
  const operation = MandiFormSafety.begin("order", {
    container: document.getElementById("order-editor"), button: document.getElementById("save-order-btn"), label: "Saving order",
  });
  if (!operation) return;
  const editId = editingOrderId;
  const version = orderEditVersion;
  const ref = editId ? ordersCollection.doc(editId) : (orderSaveRef ||= ordersCollection.doc());
  orderDraft?.touch(); orderDraft?.flush();
  const fy = orderNumberSeries();
  const counter = db.collection("counters").doc("orderCounter_FY" + fy);
  try {
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (editId) {
        if (!existing.exists) throw new Error("Order no longer exists. Your inputs have been kept.");
        if (JSON.stringify(existing.data().updatedAt ?? null) !== version) throw new Error("Order changed on another screen. Close and reopen it before editing; your draft is kept.");
        if (["Deleted", "Cancelled"].includes(existing.data().status)) throw new Error("This order is deleted/cancelled. Reopen its current details first.");
      } else if (existing.exists) {
        return; // This same request already committed. Never create another order.
      } else {
        const counterDoc = await transaction.get(counter);
        const previous = counterDoc.exists ? Number(counterDoc.data().currentNumber || 0) : 0;
        if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new Error("Order counter is invalid. Ask the owner to review it.");
        data = { ...data, orderNo: "ORD-" + fy + "-" + String(previous + 1).padStart(4, "0"), status: "Pending", createdAt: Date.now() };
        transaction.set(counter, { currentNumber: previous + 1 }, { merge: true });
      }
      if (editId) transaction.update(ref, data);
      else transaction.set(ref, data);
      const varieties = new Map(data.suppliers.map(item => [item.variety.toLowerCase().replace(/\s+/g, "_").replace(/\//g, "_"), item.variety]));
      varieties.forEach((name, id) => transaction.set(db.collection("varieties").doc(id), { name }, { merge: true }));
    });
    orderDraft?.saved();
    orderEditBaseline = null;
    operation.finish("Order saved and confirmed by the server.");
    closeOrderModal(true);
    Swal.fire({ icon: "success", title: editId ? "Order updated" : "Order saved", text: "Server confirmed. The order list will refresh automatically." });
  } catch (error) {
    console.error("Order save failed:", error);
    operation.fail(error);
    await Swal.fire("Order not confirmed", error.code ? MandiFormSafety.errorMessage(error) : error.message, "error");
  } finally {
    // finish() is idempotent; errors have already supplied the useful message.
    if (MandiFormSafety.isBusy("order")) operation.finish("Save finished. Review the order list.", "warning");
  }
}
// ── EDIT ORDER ────────────────────────────────────────────────────────────────
async function editOrder(id) {
  if (MandiFormSafety.isBusy("order")) return;
  document.querySelector("#order-editor .form-operation-status")?.remove();
  orderDraft?.dispose(); orderDraft = null; orderSaveRef = null;
  let order = allOrders.find((o) => o.id === id);
  if (!order) return;
  // Reconcile before editing. This prevents the editor from using stale
  // delivery values after a linked bill was archived/restored.
  try {
    if (!window.MandiOrderSync) throw new Error("Order reconciliation module is unavailable. Reload this page.");
    await window.MandiOrderSync.sync(id, { delivery: true });
    const fresh = await ordersCollection.doc(id).get();
    if (!fresh.exists) throw new Error("Order no longer exists.");
    order = { id: fresh.id, ...fresh.data() };
    const index = allOrders.findIndex(item => item.id === id);
    if (index >= 0) allOrders[index] = order;
  } catch (error) {
    await Swal.fire({
      icon: "error",
      title: "Order needs reconciliation",
      text: error.message || "The latest linked-bill delivery could not be checked. Nothing was changed.",
      confirmButtonColor: "#005a9e",
    });
    return;
  }
  orderEditBaseline = structuredClone(order);
  editingOrderId = id;
  orderEditVersion = JSON.stringify(order.updatedAt ?? null);
  document.getElementById("order-modal-title").textContent = `✏️ Edit Order #${order.orderNo}`;

  const [dd, mm, yyyy] = order.date.split("/");
  document.getElementById("order-date").value = `${yyyy}-${mm}-${dd}`;
  document.getElementById("order-broker").value = order.broker || "";
  document.getElementById("order-notes").value = order.notes || "";
  // Supplier is stored on the order root. Older records can include the
  // village in brackets, so restore both fields cleanly for editing.
  const savedSupplier = String(order.supplierName || order.supplier || order.partyName || "").trim();
  const supplierMatch = savedSupplier.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  document.getElementById("order-supplier").value = supplierMatch ? supplierMatch[1].trim() : savedSupplier;
  document.getElementById("order-village").value = supplierMatch
    ? supplierMatch[2].trim()
    : String(order.village || order.supplierVillage || "").trim();

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  (order.suppliers || []).forEach((s) => addSupplierEntry(s));

  document.getElementById("order-modal").classList.add("open");
  initializeOrderDraft();
}

// ── UPDATE STATUS ─────────────────────────────────────────────────────────────
// ── UPDATE ORDER STATUS (With Safeguard Checkpoint) ─────────────────────
async function updateOrderStatus(id, newStatus) {
  const isManualClose = newStatus === "Completed";
  // 1. Ek check point (SweetAlert) lagayenge
  const result = await Swal.fire({
    title: isManualClose ? "Manually close this order?" : "Change Status?",
    text: isManualClose
      ? "This marks the order Completed even if delivery is still pending. Use only when you intentionally want to close it; Reopen is available later."
      : `Kya aap sach mein is order ko '${newStatus}' status par set karna chahte hain?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#3085d6",
    cancelButtonColor: "#6c757d",
    confirmButtonText: isManualClose ? "Yes, close manually" : `Yes, Make it ${newStatus}`,
    cancelButtonText: "No, Cancel",
  });

  // Agar user ne galti se click kiya tha aur 'No' daba diya, toh order safe rahega
  if (!result.isConfirmed) {
    return;
  }

  // 2. Agar 'Yes' dabaya, tabhi aage database mein change hoga
  try {
    await ordersCollection.doc(id).update({
      status: newStatus,
      deliveryClosedManually: newStatus === "Completed",
      updatedAt: Date.now(),
    });

    // The active snapshot refreshes the list. Do not run a second collection
    // read here, otherwise a quick status change feels slow on mobile data.

    // Chhota sa success notification
    Swal.fire({
      icon: "success",
      title: `Order marked as ${newStatus}`,
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
  } catch (e) {
    console.error("Error updating status:", e);
    Swal.fire("Error", "Status update fail ho gaya.", "error");
  }
}

async function reopenOrder(id) {
  const result = await Swal.fire({
    icon: "question",
    title: "Reopen this order?",
    text: "The manual close will be removed. Status and delivered quantity will be recalculated only from active linked bills.",
    showCancelButton: true,
    confirmButtonText: "Reopen order",
    cancelButtonText: "Keep closed",
    confirmButtonColor: "#0b6cb8",
  });
  if (!result.isConfirmed) return;
  showLoading();
  try {
    await ordersCollection.doc(id).update({ deliveryClosedManually: false, updatedAt: Date.now() });
    if (!window.MandiOrderSync) throw new Error("Order sync is unavailable. Reload this page and try again.");
    await window.MandiOrderSync.sync(id, { delivery: true });
    Swal.fire({ icon: "success", title: "Order reopened", text: "Its status now reflects only active linked bills and delivered quantities.", timer: 2200, showConfirmButton: false });
  } catch (error) {
    console.error("Could not reopen order:", error);
    Swal.fire({ icon: "error", title: "Order was not reopened", text: error.message || "Please reload and try again." });
  } finally {
    hideLoading();
  }
}
window.reopenOrder = reopenOrder;
// ── DELETE ORDER ──────────────────────────────────────────────────────────────
// ── CANCEL / SOFT DELETE ORDER (Naya Safe Tarika) ────────────────────────────
async function deleteOrder(id) {
  const result = await Swal.fire({
    icon: "warning",
    title: "Cancel Order?",
    text: "Yeh order delete hone ke bajaye Cancelled list mein chala jayega, taaki sequence na toote.",
    input: "text",
    inputPlaceholder: "Cancel karne ka karan (reason) likhein...",
    showCancelButton: true,
    confirmButtonColor: "#dc3545",
    cancelButtonColor: "#6c757d",
    confirmButtonText: "Yes, Cancel it",
    preConfirm: (reason) => {
      // Reason likhna zaroori kiya hai, bina reason ke cancel nahi hoga
      if (!reason || reason.trim() === "") {
        Swal.showValidationMessage("Karan (reason) likhna zaroori hai!");
      }
      return reason;
    },
  });

  if (!result.isConfirmed) return;

  const cancelReason = result.value;

  try {
    // Database se udane ke bajaye, status 'Cancelled' kar rahe hain
    await ordersCollection.doc(id).update({
      status: "Deleted", // <--- Yahan change kiya hai
      cancelReason: cancelReason,
      updatedAt: Date.now(),
    });
    // The real-time listener updates the Trash view without another full read.

    Swal.fire({
      icon: "success",
      title: "Order Cancelled",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
  } catch (e) {
    console.error("Error cancelling order:", e);
    Swal.fire("Error", "Order cancel nahi ho paya.", "error");
  }
}

// Close modal on outside click
document.getElementById("order-modal").addEventListener("click", function (e) {
  if (e.target === this) closeOrderModal();
});

// Naya Product Firebase mein save karne ka function (With Auto Label Generation)
async function addNewProduct() {
  const { value: formValues } = await Swal.fire({
    title: "➕ Add New Product",
    html:
      '<div style="text-align:left; font-size:12px; color:#0b5b99; margin-bottom:5px; font-weight:bold;">1. Type in English & press Space (e.g. ghau -> ઘઉં)</div>' +
      '<input id="swal-prod-guj" class="swal2-input" placeholder="Gujarati Name...">' +
      '<div id="guj-typing-status" style="text-align:left; font-size:11px; color:#c0392b; min-height:14px; margin-top:2px;"></div>' +
      '<div style="text-align:left; font-size:12px; color:#0b5b99; margin-top:15px; margin-bottom:5px; font-weight:bold;">2. Type English Meaning</div>' +
      '<input id="swal-prod-eng" class="swal2-input" placeholder="English Name (e.g. Wheat)">',
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Save to Database",
    didOpen: () => {
      // Gujarati typing sirf pehle box (swal-prod-guj) par chalegi
      if (typeof setupGujaratiTyping === "function") {
        setupGujaratiTyping("swal-prod-guj");
      }
    },
    preConfirm: () => {
      const gujName = document.getElementById("swal-prod-guj").value.trim();
      const engName = document.getElementById("swal-prod-eng").value.trim();

      if (!gujName) {
        Swal.showValidationMessage("Gujarati name is required!");
        return false;
      }

      // 👇 JADOO YAHAN HAI: Label apne aap Gujarati (English) format le lega 👇
      const autoLabel = engName ? `${gujName} (${engName})` : gujName;

      return {
        name: gujName,
        label: autoLabel,
      };
    },
  });

  if (formValues && formValues.name) {
    const newName = formValues.name;
    const newLabel = formValues.label; // Ye ab automatically "ઘઉં (Wheat)" ban chuka hai

    try {
      // Firebase mein save karo
      const docRef = await db.collection("products").add({
        name: newName,
        label: newLabel,
        isActive: true,
        createdAt: Date.now(),
      });

      // Local array mein update karo
      masterProducts.push({
        id: docRef.id,
        name: newName,
        label: newLabel,
      });

      refreshAllProductDropdowns();

      Swal.fire({
        icon: "success",
        title: "Product Added!",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
      });
    } catch (e) {
      console.error(e);
      Swal.fire("Error", "Could not add product.", "error");
    }
  }
}
// Khule hue form ke sabhi dropdowns mein naya product instantly dikhane ke liye
function refreshAllProductDropdowns() {
  const selects = document.querySelectorAll('select[name^="s-product-"]');
  selects.forEach((select) => {
    const currentValue = select.value; // Purani selected value yaad rakho
    select.innerHTML = generateProductOptions(currentValue); // Nayi list daal do
  });
}
// Google API se English to Gujarati convert karne ka jadoo
// Fallback: agar ye unofficial Google endpoint kabhi fail/block ho jaye,
// user ko silently kuch na hone ke bajaye ek chhota sa message dikhta hai
// taaki wo samajh jaaye ki seedha Gujarati type/paste karna hai.
async function setupGujaratiTyping(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const statusEl = document.getElementById("guj-typing-status");
  let hasWarned = false;

  // Jab bhi user type karke 'Space' dabayega
  input.addEventListener("keyup", async (e) => {
    if (e.key === " " || e.keyCode === 32) {
      const words = input.value.split(" ");
      const lastWordIndex = words.length - 2; // Space se theek pehle wala word
      const wordToConvert = words[lastWordIndex];

      // Agar word empty nahi hai aur pehle se Gujarati mein nahi hai
      if (wordToConvert && !/[\u0A80-\u0AFF]/.test(wordToConvert)) {
        try {
          const url = `https://inputtools.google.com/request?text=${encodeURIComponent(
            wordToConvert
          )}&itc=gu-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;
          const res = await fetch(url);
          const data = await res.json();

          if (data[0] === "SUCCESS" && data[1][0][1][0]) {
            // English word ko Gujarati word se replace kar do
            words[lastWordIndex] = data[1][0][1][0];
            input.value = words.join(" ");
            if (statusEl) statusEl.textContent = ""; // pehle ka warning hata do, ye kaam kar raha hai
          } else if (statusEl && !hasWarned) {
            hasWarned = true;
            statusEl.textContent = "⚠️ Auto-convert abhi kaam nahi kar raha — seedha Gujarati type ya paste karo.";
          }
        } catch (err) {
          console.error("Transliteration error:", err);
          if (statusEl && !hasWarned) {
            hasWarned = true;
            statusEl.textContent = "⚠️ Auto-convert abhi available nahi hai — seedha Gujarati type ya paste karo.";
          }
        }
      }
    }
  });
}
// Galti se add hue product ko remove (hide) karne ka function
// Master Product Department (Add + Remove ek hi jagah)
async function manageProducts() {
  // Pura layout set kar rahe hain
  let listHtml = `
    <!-- Top mein Add New ka button -->
    <div style="text-align:right; margin-bottom: 15px;">
      <button onclick="Swal.close(); setTimeout(addNewProduct, 300);" style="background:#005a9e; color:white; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-size:14px; font-weight:bold;">
        ➕ Add New Product
      </button>
    </div>
    <!-- Niche purane products ki list -->
    <div style="text-align:left; max-height:300px; overflow-y:auto; border: 1.5px solid #eee; border-radius: 8px; padding: 10px; background:#fafafa;">
  `;

  if (masterProducts.length === 0) {
    listHtml += `<div style="text-align:center; padding: 20px; color: #888; font-size:14px;">No products found. Start by adding a new one!</div>`;
  } else {
    masterProducts.forEach((prod) => {
      listHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 5px; border-bottom:1px solid #eaeaea;">
          <span style="font-size:15px; color:#333; font-weight:bold;">${prod.label}</span>
          <button onclick="removeProduct('${prod.id}')" style="background:#fff0f0; color:#dc3545; border:1px solid #ffcaca; border-radius:6px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:bold;">✕ Remove</button>
        </div>
      `;
    });
  }
  listHtml += "</div>";

  // Popup open karo
  Swal.fire({
    title: "⚙️ Product Master",
    html: listHtml,
    showConfirmButton: false,
    showCloseButton: true,
    width: "500px",
  });
}

// Product ko Soft-Delete karne ka logic
// Product ko Remove karne ka logic (With Safety Check)
async function removeProduct(productId) {
  // 🛡️ SAFETY CHECK: Pehle check karo ki yeh product kisi order mein use toh nahi hua?
  // allOrders array humare paas order-book.js mein pehle se hai
  const isProductUsed = allOrders.some(
    (order) => order.suppliers && order.suppliers.some((s) => s.productId === productId)
  );

  // Agar product kisi bhi order (Pending ya Completed) mein use hua hai, toh block kar do
  if (isProductUsed) {
    Swal.fire({
      icon: "error",
      title: "Action Blocked! 🛑",
      text: "Yeh product pehle se kisi order mein use ho chuka hai. Aap isko delete nahi kar sakte kyu ki isse purane records kharab ho jayenge.",
      confirmButtonColor: "#d33",
    });
    return; // Function yahin rok do, aage mat badho
  }

  // Agar use nahi hua (matlab galti se add hua tha), toh user se confirm karo
  const result = await Swal.fire({
    title: "Are you sure?",
    text: "Yeh product kisi order mein use nahi hua hai, isliye aap isko remove kar sakte hain.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Yes, remove it!",
    confirmButtonColor: "#dc3545",
  });

  if (result.isConfirmed) {
    try {
      // Database mein isActive ko false kar do
      await db.collection("products").doc(productId).update({
        isActive: false,
        updatedAt: Date.now(),
      });

      Swal.fire({
        icon: "success",
        title: "Removed!",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 1500,
      });

      // List ko wapas load karke dropdowns refresh kar do
      await loadMasterProducts();
      refreshAllProductDropdowns();

      // Manage popup ko band kar do taaki refresh ho jaye
      Swal.close();
    } catch (e) {
      console.error(e);
      Swal.fire("Error", "Could not remove product.", "error");
    }
  }
}

// Yeh lo openLinkedBill function ko seedha order-book.js mein daal do
async function openLinkedBill(billNo) {
  try {
    const snapshot = await db.collection("bills").where("Serial No", "==", billNo.trim()).get();

    if (!snapshot.empty) {
      const billId = snapshot.docs[0].id;
      window.location.href = `final.html?id=${billId}`;
    } else {
      Swal.fire({
        icon: "error",
        title: "Bill not found",
        text: `Could not find bill details for ${billNo}`,
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
      });
    }
  } catch (e) {
    console.error("Error opening linked bill:", e);
  }
}
let allVarietiesList = []; // Global cache

// Firestore se varieties load karne ke liye
async function loadVarieties() {
  try {
    const snapshot = await db.collection("varieties").get();
    allVarietiesList = snapshot.docs.map((doc) => doc.data().name);
  } catch (e) {
    console.error("Error loading varieties:", e);
  }
}

function generateVarietyOptions(selectedVariety) {
  return allVarietiesList
    .map((v) => `<option value="${v}" ${v === selectedVariety ? "selected" : ""}>${v}</option>`)
    .join("");
}

// Helper function for variety datalist options
function generateVarietyDatalistOptions() {
  return allVarietiesList.map((v) => `<option value="${v}">`).join("");
}

let allCustomersList = [];
let allBrokersList = [];

function openNewOrderModal() {
  if (MandiFormSafety.isBusy("order")) return;
  document.querySelector("#order-editor .form-operation-status")?.remove();
  orderDraft?.dispose(); orderDraft = null; orderSaveRef = null; orderEditVersion = null; orderEditBaseline = null;
  editingOrderId = null;
  document.getElementById("order-modal-title").textContent = "➕ New Order";
  document.getElementById("order-broker").value = "";
  document.getElementById("order-notes").value = "";
  document.getElementById("order-supplier").value = "";
  document.getElementById("order-village").value = "";
  setDefaultDate();

  // 🚀 NAYA: Har baar modal khulne par Party Master se fresh list layega
  setupPartyMasterDatalists();

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  addSupplierEntry();
  document.getElementById("order-modal").classList.add("open");
  initializeOrderDraft();
}

// ── SHARE ORDER ON WHATSAPP (CLEAN & WORKING VERSION) ──────────────────────
function shareOrderOnWhatsApp(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  const orderNo = order.orderNo || order.orderNumber || "N/A";
  const orderDate = order.date || "N/A";
  const brokerName = order.broker || "-";

  let msg = `*GANESH AGRI INDUSTRY*\n`;
  msg += `_Order Status Report_\n`;
  msg += `=======================\n`;
  msg += `*Order No :* ${orderNo}\n`;
  msg += `*Date     :* ${orderDate}\n`;
  msg += `*Broker   :* ${brokerName}\n`;

  // Linked Bills as clean text
  if (order.linkedBillNos && order.linkedBillNos.length > 0) {
    const billsList = order.linkedBillNos.map((b) => (b.billNo || b).toString().trim()).join(", ");
    msg += `*Bills    :* ${billsList}\n`;
  } else if (order.linkedBillNo) {
    msg += `*Bill     :* ${order.linkedBillNo.toString().trim()}\n`;
  }

  msg += `=======================\n\n`;

  if (order.suppliers && order.suppliers.length > 0) {
    order.suppliers.forEach((s) => {
      const qty = Number(s.quantity) || 0;
      const del = Number(s.delivered) || 0;
      let pending = qty - del;

      msg += `*Item:* ${s.variety || s.supplierName || "-"} (${s.product || "-"})\n`;
      msg += `*Rate:* ₹${s.price || 0} / ${s.priceUnit || "20kg"}\n\n`;

      msg += `_Delivery Status:_\n`;
      msg += `- Ordered   : ${qty} ${s.unit || "Man"}\n`;
      msg += `- Delivered : ${del} ${s.unit || "Man"}\n`;

      if (del > qty) {
        msg += `- Over      : +${Math.abs(del - qty).toFixed(2)} ${s.unit || "Man"}\n`;
      } else {
        msg += `- Pending   : ${pending.toFixed(2)} ${s.unit || "Man"}\n`;
      }

      msg += `-----------------------\n\n`;
    });
  }

  msg += `_Thank You_`;

  const encodedMsg = encodeURIComponent(msg);
  const whatsappUrl = `https://wa.me/?text=${encodedMsg}`;
  window.open(whatsappUrl, "_blank");
}
let currentDateFilter = "this_week"; // Yeh ab by default this_week rahega

function applyDateFilter() {
  currentDateFilter = document.getElementById("dateFilter").value;
  renderOrders(); // Yeh function saare filters ke sath orders ko dobara draw karega
}

// 1. DD/MM/YYYY Date ko JS Date object me convert karne ka safe function
function parseCustomDate(dateStr) {
  if (!dateStr) return null;

  // Agar date string DD/MM/YYYY format me hai (jaise 29/07/2026)
  const parts = dateStr.toString().trim().split(/[/|-]/);
  if (parts.length === 3) {
    if (parts[0].length === 2 && parts[2].length === 4) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // JS me months 0 se start hote hain (0 = Jan)
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  return new Date(dateStr);
}

let currentSearchQuery = "";

// Jab user search box me kuch type karega
function applySearchFilter() {
  const input = document.getElementById("orderSearchInput");
  currentSearchQuery = input ? input.value.toLowerCase().trim() : "";
  renderOrders();
}

// 2. Ultra Smart Search Filter (Fixed & Complete)
function getFilteredOrders() {
  let list =
    currentFilter === "All"
      ? allOrders.filter((o) => o.status !== "Deleted")
      : allOrders.filter((o) => o.status === currentFilter);

  // Date Filter Dropdown check
  if (typeof currentDateFilter !== "undefined" && currentDateFilter !== "all") {
    list = list.filter((order) => {
      if (!order.date) return false;
      const orderDate = parseCustomDate(order.date);
      if (!orderDate || isNaN(orderDate.getTime())) return true;

      const today = new Date();

      if (currentDateFilter === "today") {
        return orderDate.toDateString() === today.toDateString();
      } else if (currentDateFilter === "this_week") {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return orderDate >= startOfWeek && orderDate <= endOfWeek;
      } else if (currentDateFilter === "this_month") {
        return orderDate.getMonth() === today.getMonth() && orderDate.getFullYear() === today.getFullYear();
      } else if (currentDateFilter === "last_month") {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return orderDate.getMonth() === lastMonth.getMonth() && orderDate.getFullYear() === lastMonth.getFullYear();
      }
      return true;
    });
  }

  // 🔍 All-in-One Super Search Filter
  if (typeof currentSearchQuery !== "undefined" && currentSearchQuery !== "") {
    const query = currentSearchQuery.toLowerCase().trim();
    list = list.filter((order) => {
      const orderNo = (order.orderNo || "").toLowerCase();
      const broker = (order.broker || "").toLowerCase();
      const notes = (order.notes || "").toLowerCase();
      const dateStr = (order.date || "").toLowerCase();
      const status = (order.status || "").toLowerCase();
      const payStatus = (order.paymentStatus || "").toLowerCase();
      const mainSupplier = (order.supplier || order.supplierName || order.partyName || "").toLowerCase();
      const mainVillage = (order.village || order.supplierVillage || "").toLowerCase();
      const vehicleOrder = (order.vehicleNo || order.vehicle || "").toLowerCase();
      const phoneOrder = (order.phone || order.mobile || "").toLowerCase();
      const transportOrder = (order.transport || "").toLowerCase();

      // Check inside each item/supplier row of the order
      const supplierMatch = (order.suppliers || []).some((s) => {
        const variety = (s.variety || "").toLowerCase();
        const product = (s.product || "").toLowerCase();
        const suppName = (s.supplierName || s.supplier || s.partyName || "").toLowerCase();
        const village = (s.village || s.supplierVillage || "").toLowerCase();
        const price = (s.price || "").toString().toLowerCase();
        const qty = (s.quantity || "").toString().toLowerCase();
        const vehicle = (s.vehicleNo || s.vehicle || "").toLowerCase();
        const transport = (s.transport || "").toLowerCase();

        return (
          variety.includes(query) ||
          product.includes(query) ||
          suppName.includes(query) ||
          village.includes(query) ||
          price.includes(query) ||
          qty.includes(query) ||
          vehicle.includes(query) ||
          transport.includes(query)
        );
      });

      // Linked Bills check (Yahi define hona zaroori tha)
      const billsMatch =
        (order.linkedBillNos || []).some((b) => (b.billNo || b).toString().toLowerCase().includes(query)) ||
        (order.linkedBillNo || "").toString().toLowerCase().includes(query);

      return (
        orderNo.includes(query) ||
        broker.includes(query) ||
        notes.includes(query) ||
        dateStr.includes(query) ||
        status.includes(query) ||
        payStatus.includes(query) ||
        mainSupplier.includes(query) ||
        mainVillage.includes(query) ||
        vehicleOrder.includes(query) ||
        phoneOrder.includes(query) ||
        transportOrder.includes(query) ||
        supplierMatch ||
        billsMatch
      );
    });
  }

  return list;
}
// 3. Summary Bar with Unit Conversion (Sabhi units ko Tons mein convert karke total dikhayega)
function updateOrderSummary(filteredList) {
  const summaryBar = document.getElementById("orderSummaryBar");
  if (!summaryBar) return;

  let totalOrders = filteredList.length;
  let totalKgAll = 0;
  let totalDeliveredKgAll = 0;

  filteredList.forEach((order) => {
    if (order.suppliers && Array.isArray(order.suppliers)) {
      order.suppliers.forEach((s) => {
        const qty = Number(s.quantity) || 0;
        const del = Number(s.delivered) || 0;
        const unit = (s.unit || "Man").trim().toLowerCase();

        // Standard Weight Multiplier (KG mein convert karne ke liye)
        let kgMultiplier = 20; // Default Man = 20kg
        if (unit.includes("quintal") || unit.includes("q")) {
          kgMultiplier = 100; // 1 Quintal = 100kg
        } else if (unit.includes("bag") || unit.includes("bora")) {
          kgMultiplier = 50; // Standard grain bag = 50kg
        } else if (unit.includes("kg")) {
          kgMultiplier = 1; // 1 KG = 1kg
        } else if (unit.includes("man") || unit.includes("m")) {
          kgMultiplier = 20; // 1 Man = 20kg
        }

        const itemKg = qty * kgMultiplier;
        const itemDelKg = del * kgMultiplier;

        totalKgAll += itemKg;
        totalDeliveredKgAll += itemDelKg;

      });
    }
  });

  // Total Tons mein convert karna (1 Ton = 1000 kg)
  let totalTonsAll = (totalKgAll / 1000).toFixed(2);
  let totalDelTonsAll = (totalDeliveredKgAll / 1000).toFixed(2);

  summaryBar.innerHTML = `
    <div style="background:rgba(255,255,255,.94); border:1px solid #dbeafe; border-radius:12px; padding:12px 14px; color:#0f172a;"><div style="font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b;">Visible orders</div><div style="margin-top:3px; font-size:21px; font-weight:800; color:#075a9c;">${totalOrders}</div></div>
    <div style="background:rgba(255,255,255,.94); border:1px solid #dbeafe; border-radius:12px; padding:12px 14px; color:#0f172a;"><div style="font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b;">Booked quantity</div><div style="margin-top:3px; font-size:21px; font-weight:800; color:#b45309;">${totalTonsAll} <span style="font-size:12px;">Ton</span></div></div>
    <div style="background:rgba(255,255,255,.94); border:1px solid #dbeafe; border-radius:12px; padding:12px 14px; color:#0f172a;"><div style="font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#64748b;">Delivered quantity</div><div style="margin-top:3px; font-size:21px; font-weight:800; color:#15803d;">${totalDelTonsAll} <span style="font-size:12px;">Ton</span></div></div>
  `;
}
// Badge click karne par auto search/filter karne ka function
function filterBySummaryGroup(groupKey) {
  // Agar bracket hai (jaise LOKVAN (गेहूं)), toh sirf variety name nikal lete hain ya poora key daal dete hain
  const searchTerm = groupKey.split("(")[0].trim();

  const searchInput = document.getElementById("orderSearchInput");
  if (searchInput) {
    searchInput.value = searchTerm;
    currentSearchQuery = searchTerm.toLowerCase();
    renderOrders();
  }
}
// ── 🚀 NAYA ALL-IN-ONE PARTY MASTER DATALIST FUNCTION ──
window.validPartyNames = [];
window.customerVillageMap = {};

async function setupPartyMasterDatalists() {
  try {
    // 🚨 FIX: Yahan se .where() hata diya hai taaki saara purana data bhi aa sake
    const snap = await db.collection("parties").get();

    let suppliersHTML = "";
    let brokersHTML = "";

    window.validPartyNames = [];
    window.customerVillageMap = {};

    snap.forEach((doc) => {
      const p = doc.data();

      // 🚨 FIX: Agar deleted true hai tabhi roko, warna aane do
      if (p.deleted === true) return;

      const name = (p.name || "").trim().toUpperCase();
      const village = (p.address || p.village || "").trim().toUpperCase();
      const type = p.type || "Farmer";

      if (name) {
        window.validPartyNames.push(name);

        if (type === "Broker") {
          brokersHTML += `<option value="${name}">`;
        } else {
          window.customerVillageMap[name] = village;
          const displayVal = village ? `${name} (${village})` : name;
          suppliersHTML += `<option value="${displayVal}">`;
        }
      }
    });

    // Supplier Datalist create/update karein
    let suppList = document.getElementById("order-supplier-list");
    if (!suppList) {
      suppList = document.createElement("datalist");
      suppList.id = "order-supplier-list";
      document.body.appendChild(suppList);
    }
    suppList.innerHTML = suppliersHTML;

    // Broker Datalist create/update karein
    let brokerList = document.getElementById("order-broker-list");
    if (!brokerList) {
      brokerList = document.createElement("datalist");
      brokerList.id = "order-broker-list";
      document.body.appendChild(brokerList);
    }
    brokerList.innerHTML = brokersHTML;

    // Input fields ko link karein aur Chrome history OFF karein
    const supplierInput = document.getElementById("order-supplier");
    const brokerInput = document.getElementById("order-broker");
    const villageInput = document.getElementById("order-village");

    if (supplierInput) {
      supplierInput.setAttribute("list", "order-supplier-list");
      supplierInput.setAttribute("autocomplete", "off"); // 🚫 Chrome History Block

      supplierInput.oninput = function () {
        let val = this.value.toUpperCase();
        let cleanName = val;
        let village = "";

        if (val.includes("(") && val.includes(")")) {
          const parts = val.split("(");
          cleanName = parts[0].trim();
          village = parts[1].replace(")", "").trim();
          this.value = cleanName;
        } else if (window.customerVillageMap[val]) {
          village = window.customerVillageMap[val];
        }

        if (villageInput && village) {
          villageInput.value = village;
        }
      };
    }

    if (brokerInput) {
      brokerInput.setAttribute("list", "order-broker-list");
      brokerInput.setAttribute("autocomplete", "off"); // 🚫 Chrome History Block
      brokerInput.oninput = function () {
        this.value = this.value.toUpperCase();
      };
    }

    if (villageInput) {
      villageInput.oninput = function () {
        this.value = this.value.toUpperCase();
      };
    }
  } catch (e) {
    console.error("Error setting up datalists:", e);
  }
}
// 🔗 Order Book se Customer Ledger open karne ka function
function openCustomerLedger(rawName) {
  if (!rawName) {
    Swal.fire("Error", "Is order mein customer ka naam nahi mila.", "warning");
    return;
  }
  let name = rawName;
  let village = "N/A";
  if (rawName.includes("(") && rawName.includes(")")) {
    const parts = rawName.split("(");
    name = parts[0].trim();
    village = parts[1].replace(")", "").trim();
  }
  const rawData = `${name}|${village}`;
  const secureToken = btoa(
    encodeURIComponent(rawData).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode("0x" + p1))
  );
  window.location.href = `ledger.html?token=${secureToken}`;
}
function getOrderPaymentStatus(orderData, supplierName) {
  const billNos = orderData.linkedBillNos || orderData.linkedBills || [];

  if (billNos.length === 0) {
    const safeName = (supplierName || "").replace(/'/g, "\\'");
    return `<span onclick="openCustomerLedger('${safeName}')" style="background: #6c757d; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;" title="No bill has been linked to this order yet">🧾 No Bill Yet → Ledger</span>`;
  }

  const globalBills = window.allBills || [];

  let totalOrderAmount = 0;
  let totalOrderPaid = 0;

  billNos.forEach((bId) => {
    const bill = globalBills.find((b) => b.id === bId || b["Serial No"] === bId || b.serialNo === bId);

    if (bill) {
      // 1. Total amount pakadne ke sabhi possible fields (taaki koi galti na ho)
      const billTotal = Number(
        bill["Final Total"] ||
          bill.total ||
          bill.amount ||
          Number(bill.amountDue || 0) + Number(bill.amountPaid || 0) ||
          0
      );

      // 2. Paid amount pakadne ke sabhi possible fields
      const billPaid = Number(bill.paidAmount || bill.amountPaid || bill.paid || 0);

      totalOrderAmount += billTotal;
      totalOrderPaid += billPaid;
    }
  });

  // 🔍 DEBUGGING: F12 (Console) mein check karne ke liye ki code kya read kar raha hai
  console.log(`🎯 Order: ${orderData.orderNo} | Total Bill: ₹${totalOrderAmount} | Total Paid: ₹${totalOrderPaid}`);

  const safeName = (supplierName || "").replace(/'/g, "\\'");

  // 🎯 Final Logic Check
  if (totalOrderAmount > 0 && totalOrderPaid === 0) {
    // Ek bhi rupya nahi aaya -> Unpaid
    return `<span onclick="openCustomerLedger('${safeName}')" style="background: #dc3545; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;" title="Amount: ₹${totalOrderAmount} | Paid: ₹0">⏳ Unpaid</span>`;
  } else if (totalOrderAmount > 0 && totalOrderPaid > 0 && totalOrderPaid < totalOrderAmount) {
    // 👇 Thoda paisa aaya hai, par poora nahi -> PARTIAL (Aapki requirement)
    return `<span onclick="openCustomerLedger('${safeName}')" style="background: #f0ad4e; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;" title="Amount: ₹${totalOrderAmount} | Paid: ₹${totalOrderPaid}">⚠️ Partial</span>`;
  } else if (totalOrderAmount > 0 && totalOrderPaid >= totalOrderAmount) {
    // Poora paisa aa gaya -> Paid
    return `<span onclick="openCustomerLedger('${safeName}')" style="background: #28a745; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;" title="All Bills Paid">Paid -> Ledger</span>`;
  } else {
    // Agar amount catch nahi hua
    return `<span onclick="openCustomerLedger('${safeName}')" style="background: #6c757d; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; cursor: pointer;">Status Unknown</span>`;
  }
}
