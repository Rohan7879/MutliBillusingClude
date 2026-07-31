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

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setDefaultDate();
  loadMasterProducts();
  loadVarieties();
  loadOrders();
  loadCustomersAndBrokers();
});

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
document.addEventListener("DOMContentLoaded", () => {
  setDefaultDate();
  loadMasterProducts(); // 👈 NAYA CALL YAHAN ADD KIYA
  loadOrders();
});

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
  renderOrders();
}
function togglePaymentStatus(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  // Cycle: Unpaid -> Partial -> Paid -> Unpaid
  if (!order.paymentStatus || order.paymentStatus === "Unpaid") {
    order.paymentStatus = "Partial";
  } else if (order.paymentStatus === "Partial") {
    order.paymentStatus = "Paid";
  } else {
    order.paymentStatus = "Unpaid";
  }

  // Firebase ya Local Database mein save karne ka function yahan call karein
  updateOrderInDatabase(order);
  renderOrders();
}

// 1. DD/MM/YYYY Date ko JS Date object me convert karne ka safe function
function parseCustomDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.toString().trim().split(/[/|-]/);
  if (parts.length === 3) {
    if (parts[0].length === 2 && parts[2].length === 4) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  return new Date(dateStr);
}

// 2. Combined Filter Function (Status + Date + Smart Search)
function getFilteredOrders() {
  let list =
    currentFilter === "All"
      ? allOrders.filter((o) => o.status !== "Deleted")
      : allOrders.filter((o) => o.status === currentFilter);

  // Date Filter
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

  // Smart Search Filter
  if (typeof currentSearchQuery !== "undefined" && currentSearchQuery !== "") {
    const query = currentSearchQuery.toLowerCase().trim();
    list = list.filter((order) => {
      const orderNo = (order.orderNo || "").toLowerCase();
      const broker = (order.broker || "").toLowerCase();
      const notes = (order.notes || "").toLowerCase();

      const supplierMatch = (order.suppliers || []).some(
        (s) =>
          (s.variety || "").toLowerCase().includes(query) ||
          (s.supplierName || "").toLowerCase().includes(query) ||
          (s.supplier || "").toLowerCase().includes(query) ||
          (s.product || "").toLowerCase().includes(query)
      );

      const mainSupMatch = (order.supplier || order.supplierName || "").toLowerCase().includes(query);

      const billsMatch =
        (order.linkedBillNos || []).some((b) => (b.billNo || b).toString().toLowerCase().includes(query)) ||
        (order.linkedBillNo || "").toString().toLowerCase().includes(query);

      return (
        orderNo.includes(query) ||
        broker.includes(query) ||
        notes.includes(query) ||
        supplierMatch ||
        mainSupMatch ||
        billsMatch
      );
    });
  }

  return list;
}

// 3. Summary Bar with Variety-wise breakdown
function updateOrderSummary(filteredList) {
  const summaryBar = document.getElementById("orderSummaryBar");
  if (!summaryBar) return;

  let totalOrders = filteredList.length;
  let totalOrderedQty = 0;
  let totalDeliveredQty = 0;
  let varietyMap = {};

  filteredList.forEach((order) => {
    if (order.suppliers && Array.isArray(order.suppliers)) {
      order.suppliers.forEach((s) => {
        const qty = Number(s.quantity) || 0;
        const del = Number(s.delivered) || 0;
        totalOrderedQty += qty;
        totalDeliveredQty += del;

        const vName = (s.variety || "OTHER").trim().toUpperCase();
        const unitName = s.unit || "Man";

        if (!varietyMap[vName]) {
          varietyMap[vName] = { ordered: 0, delivered: 0, unit: unitName };
        }
        varietyMap[vName].ordered += qty;
        varietyMap[vName].delivered += del;
      });
    }
  });

  let varietyHtml = Object.keys(varietyMap)
    .map((v) => {
      const data = varietyMap[v];
      return `<span style="background:#fff; padding:3px 8px; border-radius:4px; border:1px solid #cbd5e1; font-size:11px; display:inline-block; margin:2px 0;">
      🌾 <b>${v}</b>: <span style="color:#d35400;">${data.ordered} ${data.unit}</span> (Done: <span style="color:#27ae60;">${data.delivered}</span>)
    </span>`;
    })
    .join(" ");

  summaryBar.innerHTML = `
    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; flex-wrap: wrap; gap: 10px;">
      <div>
        📦 Orders: <strong style="color:#005a9e;">${totalOrders}</strong> &nbsp;|&nbsp; 
        Total: <strong style="color:#d35400;">${totalOrderedQty}</strong> &nbsp;|&nbsp; 
        Done: <strong style="color:#27ae60;">${totalDeliveredQty}</strong>
      </div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${varietyHtml || '<span style="color:#777;">No items</span>'}
      </div>
    </div>
  `;
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

      // Payment Status Badge
      const payStatus = order.paymentStatus || "Unpaid";
      let payBgColor = "#dc3545"; // Red for Unpaid
      if (payStatus === "Paid") payBgColor = "#28a745"; // Green
      if (payStatus === "Partial") payBgColor = "#ffc107"; // Yellow/Orange

      const paymentBadgeHtml = `
        <span onclick="togglePaymentStatus('${order.id}')" 
              style="background: ${payBgColor}; color: #fff; padding: 3px 8px; font-size: 11px; border-radius: 4px; font-weight: bold; cursor: pointer; margin-left: 5px;" 
              title="Click to change payment status">
          💳 ${payStatus}
        </span>
      `;

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
            <button style="padding:7px 14px;font-size:12px;background:#28a745;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${
              order.id
            }','Completed')">✅ Complete</button>
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

// 5. Payment status toggle function
function togglePaymentStatus(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  if (!order.paymentStatus || order.paymentStatus === "Unpaid") {
    order.paymentStatus = "Partial";
  } else if (order.paymentStatus === "Partial") {
    order.paymentStatus = "Paid";
  } else {
    order.paymentStatus = "Unpaid";
  }

  if (typeof saveOrderToFirebase === "function") {
    saveOrderToFirebase(order);
  }
  renderOrders();
}

// 6. Search trigger input function
function applySearchFilter() {
  const input = document.getElementById("orderSearchInput");
  currentSearchQuery = input ? input.value : "";
  renderOrders();
}

// 7. Date filter trigger dropdown function
function applyDateFilter() {
  const select = document.getElementById("dateFilter");
  currentDateFilter = select ? select.value : "this_week";
  renderOrders();
}
// Helper function jo status aur date dono se filter karega
function filteredByDateAndStatus() {
  let list =
    currentFilter === "All"
      ? allOrders.filter((o) => o.status !== "Deleted")
      : allOrders.filter((o) => o.status === currentFilter);

  // Agar aapne date filter select kiya hai
  if (typeof currentDateFilter !== "undefined" && currentDateFilter !== "all") {
    list = list.filter((order) => {
      if (!order.date) return false;
      const orderDate = new Date(order.date);
      const today = new Date();

      if (currentDateFilter === "today") {
        return orderDate.toDateString() === today.toDateString();
      } else if (currentDateFilter === "this_month") {
        return orderDate.getMonth() === today.getMonth() && orderDate.getFullYear() === today.getFullYear();
      } else if (currentDateFilter === "last_month") {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return orderDate.getMonth() === lastMonth.getMonth() && orderDate.getFullYear() === lastMonth.getFullYear();
      }
      return true;
    });
  }
  return list;
}

// Payment status change karne ka click function
function togglePaymentStatus(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  if (!order.paymentStatus || order.paymentStatus === "Unpaid") {
    order.paymentStatus = "Partial";
  } else if (order.paymentStatus === "Partial") {
    order.paymentStatus = "Paid";
  } else {
    order.paymentStatus = "Unpaid";
  }

  // Agar database update function hai toh yahan call hoga, warna seedha render
  if (typeof saveOrderToFirebase === "function") {
    saveOrderToFirebase(order);
  }
  renderOrders();
}
function closeOrderModal() {
  document.getElementById("order-modal").classList.remove("open");
  editingOrderId = null;
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
      <button class="remove-supplier-btn" onclick="document.getElementById('supplier-${idx}').remove()">✕ Remove</button>
    </div>

    <!-- Variety Dropdown -->
  <div style="margin-bottom: 10px;">
      <label style="font-size: 12px; font-weight: 600; color: #495057; display: block; margin-bottom: 2px;">Variety *</label>
      <input type="text" name="s-variety-${idx}" list="variety-options-list" placeholder="Type or select variety..." value="${
    data.variety || ""
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
        <input type="number" name="s-qty-${idx}" placeholder="0" value="${data.quantity || ""}"/>
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
        <input type="number" name="s-price-${idx}" placeholder="0" step="any" value="${data.price || ""}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Price Per</label>
        <select name="s-priceunit-${idx}">
          <option value="20kg" ${data.priceUnit === "20kg" ? "selected" : ""}>Per 20kg</option>
          <option value="100kg" ${data.priceUnit === "100kg" ? "selected" : ""}>Per 100kg</option>
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Delivered So Far</label>
        <input type="number" name="s-delivered-${idx}" placeholder="0" value="${data.delivered || 0}"/>
      </div>
    </div>`;
  document.getElementById("supplier-entries").appendChild(div);
}

// =====================================================================
// Naya Sequential Order Number Generator
// =====================================================================
// =====================================================================
// Order Number Generator (Matched with your 'counters' DB collection)
// =====================================================================
async function getNextOrderNumber() {
  // 1. Financial Year nikalne ka logic
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let fy = "";
  if (currentMonth < 3) {
    fy = String(currentYear - 1).slice(-2) + String(currentYear).slice(-2);
  } else {
    fy = String(currentYear).slice(-2) + String(currentYear + 1).slice(-2);
  }

  // 2. Naya Path: "counters" collection aur document ka naam "orderCounter_FY2627"
  const counterRef = db.collection("counters").doc("orderCounter_FY" + fy);

  try {
    return await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(counterRef);
      let nextNum = 1;

      // Aapke DB ke hisaab se 'currentNumber' check kar rahe hain
      if (doc.exists && doc.data().currentNumber) {
        nextNum = doc.data().currentNumber + 1;
      }

      // Naya number 'currentNumber' field mein hi save karenge
      transaction.set(counterRef, { currentNumber: nextNum }, { merge: true });

      // Zero lagakar format karo (0001, 0002)
      const formattedNum = String(nextNum).padStart(4, "0");

      // Output: ORD-2627-0001
      return "ORD-" + fy + "-" + formattedNum;
    });
  } catch (error) {
    console.error("Order Number generate karne mein error:", error);
    return "ORD-" + fy + "-" + Date.now().toString().slice(-4);
  }
}

// =====================================================================
// Aapka Updated saveOrder Function (Strict Validation Ke Sath)
// =====================================================================
async function saveOrder() {
  const rawDate = document.getElementById("order-date")?.value || "";
  let formattedDate = rawDate;
  if (rawDate.includes("-")) {
    const parts = rawDate.split("-");
    if (parts.length === 3) {
      formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  const brokerName = document.getElementById("order-broker")?.value || "";
  const notes = document.getElementById("order-notes")?.value || "";

  const baseName = document.getElementById("order-supplier")?.value?.trim().toUpperCase() || "";
  const villageVal = document.getElementById("order-village")?.value?.trim().toUpperCase() || "";

  if (!baseName) {
    Swal.fire("Error", "Please enter Supplier / Customer name.", "error");
    return;
  }

  // 🚨 STRICT VALIDATION: Agar Party Master mein naam nahi hai toh error dekar rok do
  if (!window.validPartyNames || !window.validPartyNames.includes(baseName)) {
    Swal.fire({
      icon: "error",
      title: "Party Not Found! 🛑",
      text: `"${baseName}" Party Master mein nahi hai. Pehle Party Master mein khata banayein, tabhi order book hoga.`,
      confirmButtonColor: "#d33",
    });
    return; // Code yahin ruk jayega, order save nahi hoga
  }

  const supplierName = villageVal ? `${baseName} (${villageVal})` : baseName;

  // Purana 'customers' collection auto-sync yahan se hata diya gaya hai
  // kyunki ab hum sirf Party Master par depend kar rahe hain.

  const prodDropdowns = document.querySelectorAll('select[name^="s-product-"]');
  if (prodDropdowns.length === 0) {
    Swal.fire("Error", "Please add at least one Vakal item.", "error");
    return;
  }

  let suppliers = [];
  let valid = true;

  prodDropdowns.forEach((prodDropdown) => {
    const nameAttr = prodDropdown.getAttribute("name") || "";
    const idx = nameAttr.split("-")[2] || "1";

    const vakalTitle = document.querySelector(`[name="s-title-${idx}"]`)?.value?.trim() || `Vakal ${idx}`;
    const prodId = prodDropdown.value || "";
    const varietyVal = (document.querySelector(`[name="s-variety-${idx}"]`)?.value || "").trim().toUpperCase();

    if (!prodId) {
      valid = false;
      return;
    }

    const prodName =
      prodDropdown.options[prodDropdown.selectedIndex]?.getAttribute("data-name") ||
      prodDropdown.options[prodDropdown.selectedIndex]?.text ||
      "";

    suppliers.push({
      variety: varietyVal,
      vakalTitle: vakalTitle,
      productId: prodId,
      product: prodName,
      quantity: Number(document.querySelector(`[name="s-qty-${idx}"]`)?.value) || 0,
      unit: document.querySelector(`[name="s-unit-${idx}"]`)?.value || "Man",
      price: Number(document.querySelector(`[name="s-price-${idx}"]`)?.value) || 0,
      priceUnit: document.querySelector(`[name="s-priceunit-${idx}"]`)?.value || "20kg",
      delivered: Number(document.querySelector(`[name="s-delivered-${idx}"]`)?.value) || 0,
    });

    if (varietyVal) {
      const varietyId = varietyVal.toLowerCase().replace(/\s+/g, "_");
      db.collection("varieties")
        .doc(varietyId)
        .set({ name: varietyVal }, { merge: true })
        .catch(() => {});
    }
  });

  if (!valid) {
    Swal.fire({
      icon: "error",
      title: "Fill all required fields!",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 2000,
    });
    return;
  }

  try {
    const orderData = {
      date: formattedDate,
      broker: brokerName,
      supplierName: supplierName,
      notes: notes,
      suppliers: suppliers,
      updatedAt: Date.now(),
    };

    if (typeof editingOrderId !== "undefined" && editingOrderId) {
      await db.collection("orders").doc(editingOrderId).update(orderData);
      Swal.fire({
        icon: "success",
        title: "Order Updated Successfully!",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
      });
    } else {
      orderData.status = "Pending";
      orderData.createdAt = Date.now();

      let manualOrderNo = document.getElementById("orderNo")?.value;
      if (!manualOrderNo || manualOrderNo.trim() === "") {
        orderData.orderNo = await getNextOrderNumber();
      } else {
        orderData.orderNo = manualOrderNo;
      }

      await db.collection("orders").add(orderData);
      Swal.fire({
        icon: "success",
        title: "Order Saved Successfully!",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 2000,
      });
    }

    if (typeof closeOrderModal === "function") closeOrderModal();
    if (typeof loadOrders === "function") await loadOrders();
    if (typeof renderOrders === "function") renderOrders();
  } catch (e) {
    console.error("Error saving order:", e);
    Swal.fire("Error", "Could not save order.", "error");
  }
}
// ── EDIT ORDER ────────────────────────────────────────────────────────────────
function editOrder(id) {
  const order = allOrders.find((o) => o.id === id);
  if (!order) return;
  editingOrderId = id;
  document.getElementById("order-modal-title").textContent = `✏️ Edit Order #${order.orderNo}`;

  const [dd, mm, yyyy] = order.date.split("/");
  document.getElementById("order-date").value = `${yyyy}-${mm}-${dd}`;
  document.getElementById("order-broker").value = order.broker || "";
  document.getElementById("order-notes").value = order.notes || "";
  document.getElementById("order-supplier").value = order.suppliers[0]?.supplierName || "";

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  (order.suppliers || []).forEach((s) => addSupplierEntry(s));

  document.getElementById("order-modal").classList.add("open");
}

// ── UPDATE STATUS ─────────────────────────────────────────────────────────────
// ── UPDATE ORDER STATUS (With Safeguard Checkpoint) ─────────────────────
async function updateOrderStatus(id, newStatus) {
  // 1. Ek check point (SweetAlert) lagayenge
  const result = await Swal.fire({
    title: "Change Status?",
    text: `Kya aap sach mein is order ko '${newStatus}' status par set karna chahte hain?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#3085d6",
    cancelButtonColor: "#6c757d",
    confirmButtonText: `Yes, Make it ${newStatus}`,
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
      updatedAt: Date.now(),
    });

    await loadOrders(); // List ko refresh karega

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
    await loadOrders(); // List ko refresh karega

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
  editingOrderId = null;
  document.getElementById("order-modal-title").textContent = "➕ New Order";
  document.getElementById("order-broker").value = "";
  document.getElementById("order-notes").value = "";
  document.getElementById("order-supplier").value = "";
  setDefaultDate();

  // 🚀 NAYA: Har baar modal khulne par Party Master se fresh list layega
  setupPartyMasterDatalists();

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  addSupplierEntry();
  document.getElementById("order-modal").classList.add("open");
}

// Page load hone par yeh function apne aap chal jayega
document.addEventListener("DOMContentLoaded", () => {
  loadCustomersForOrder();
});
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

// 2. Updated Filter Function
function filteredByDateAndStatus() {
  let list =
    currentFilter === "All"
      ? allOrders.filter((o) => o.status !== "Deleted")
      : allOrders.filter((o) => o.status === currentFilter);

  if (typeof currentDateFilter !== "undefined" && currentDateFilter !== "all") {
    list = list.filter((order) => {
      if (!order.date) return false;

      const orderDate = parseCustomDate(order.date);
      // Agar Date Invalid hai toh skip mat karo, dikha do
      if (!orderDate || isNaN(orderDate.getTime())) return true;

      const today = new Date();

      if (currentDateFilter === "today") {
        return orderDate.toDateString() === today.toDateString();
      } else if (currentDateFilter === "this_week") {
        // Iss hafte ki shuruwat (Sunday) se lekar hafte ke aakhri din (Saturday) tak
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
  return list;
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
  let groupMap = {};

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

        const vName = (s.variety || "OTHER").trim().toUpperCase();
        const pName = (s.product || "").trim();
        const groupKey = pName ? `${vName} (${pName})` : vName;

        if (!groupMap[groupKey]) {
          groupMap[groupKey] = { orderedKg: 0, deliveredKg: 0 };
        }
        groupMap[groupKey].orderedKg += itemKg;
        groupMap[groupKey].deliveredKg += itemDelKg;
      });
    }
  });

  // Total Tons mein convert karna (1 Ton = 1000 kg)
  let totalTonsAll = (totalKgAll / 1000).toFixed(2);
  let totalDelTonsAll = (totalDeliveredKgAll / 1000).toFixed(2);

  // Variety & Product wise badges (Tons mein)
  let groupHtml = Object.keys(groupMap)
    .map((key) => {
      const data = groupMap[key];
      const ordTons = (data.orderedKg / 1000).toFixed(2);
      const delTons = (data.deliveredKg / 1000).toFixed(2);
      const safeKey = key.replace(/'/g, "\\'");

      return `<span onclick="filterBySummaryGroup('${safeKey}')" style="background:#fff; padding:4px 10px; border-radius:6px; border:1px solid #cbd5e1; font-size:11px; display:inline-block; margin:2px 0; cursor:pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: all 0.2s;" title="Click to filter orders for ${key}" onmouseover="this.style.borderColor='#005a9e'" onmouseout="this.style.borderColor='#cbd5e1'">
      🌾 <b>${key}</b>: <span style="color:#d35400;">${ordTons} Ton</span> (Done: <span style="color:#27ae60;">${delTons} Ton</span>)
    </span>`;
    })
    .join(" ");

  summaryBar.innerHTML = `
    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; flex-wrap: wrap; gap: 10px;">
      <div>
        📦 Orders: <strong style="color:#005a9e;">${totalOrders}</strong> &nbsp;|&nbsp; 
        Total: <strong style="color:#d35400;">${totalTonsAll} Ton</strong> &nbsp;|&nbsp; 
        Done: <strong style="color:#27ae60;">${totalDelTonsAll} Ton</strong>
      </div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        ${groupHtml || '<span style="color:#777;">No items</span>'}
      </div>
    </div>
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
