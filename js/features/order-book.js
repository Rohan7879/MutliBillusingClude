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
  loadOrders();
});

function setDefaultDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth()+1).padStart(2,"0");
  const dd   = String(d.getDate()).padStart(2,"0");
  const el   = document.getElementById("order-date");
  if (el) el.value = `${yyyy}-${mm}-${dd}`;
}

// ── LOAD ORDERS ───────────────────────────────────────────────────────────────
async function loadOrders() {
  showLoading();
  try {
    const snap = await ordersCollection.orderBy("createdAt","desc").get();
    allOrders  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders();
  } catch(e) {
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

// ── RENDER ORDERS ─────────────────────────────────────────────────────────────
function renderOrders() {
  const container = document.getElementById("order-list");
  if (!container) return;

  const filtered = currentFilter === "All"
    ? allOrders
    : allOrders.filter(o => o.status === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#6c757d;padding:30px;font-size:15px;">
      📭 No ${currentFilter === "All" ? "" : currentFilter} orders found.</div>`;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const statusClass = {
      Pending: "status-pending", Partial: "status-partial",
      Completed: "status-completed", Cancelled: "status-cancelled"
    }[order.status] || "status-pending";

    const statusEmoji = {
      Pending:"⏳", Partial:"🔄", Completed:"✅", Cancelled:"❌"
    }[order.status] || "⏳";

    const suppliers = (order.suppliers || []).map(s => `
      <div class="supplier-row">
        <span><strong>${s.supplierName}</strong></span>
        <span>${s.product}</span>
        <span>${s.quantity} ${s.unit}</span>
        <span>₹${s.price}/${s.priceUnit}</span>
        <span style="color:#6c757d;">${s.delivered || 0} ${s.unit} delivered</span>
      </div>`).join("");

    return `
      <div class="order-card">
        <div class="order-card-header">
          <div>
            <div class="order-no">#${order.orderNo}</div>
            <div class="order-date">📅 ${order.date}${order.broker ? ` &nbsp;|&nbsp; 🤝 ${order.broker}` : ""}</div>
          </div>
          <span class="status-badge ${statusClass}">${statusEmoji} ${order.status}</span>
        </div>

        <div class="supplier-row supplier-row-header" style="margin-bottom:4px;">
          <span>Supplier</span><span>Product</span><span>Qty (Ordered)</span>
          <span>Rate</span><span>Delivered</span>
        </div>
        ${suppliers}

        ${order.notes ? `<div style="margin-top:8px;font-size:12px;color:#6c757d;">📝 ${order.notes}</div>` : ""}

        <div class="order-actions">
          <button class="btn-primary" style="padding:7px 14px;font-size:12px;" onclick="editOrder('${order.id}')">✏️ Edit</button>
          <button style="padding:7px 14px;font-size:12px;background:#28a745;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${order.id}','Completed')">✅ Complete</button>
          <button style="padding:7px 14px;font-size:12px;background:#17a2b8;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${order.id}','Partial')">🔄 Partial</button>
          <button style="padding:7px 14px;font-size:12px;background:#6c757d;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="updateOrderStatus('${order.id}','Cancelled')">❌ Cancel</button>
          <button style="padding:7px 14px;font-size:12px;background:#dc3545;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="deleteOrder('${order.id}')">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openNewOrderModal() {
  editingOrderId = null;
  document.getElementById("order-modal-title").textContent = "➕ New Order";
  document.getElementById("order-broker").value = "";
  document.getElementById("order-notes").value  = "";
  setDefaultDate();
  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  addSupplierEntry();
  document.getElementById("order-modal").classList.add("open");
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
    <div class="supplier-entry-header">
      <strong style="color:#005a9e;">Supplier ${idx}</strong>
      <button class="remove-supplier-btn" onclick="document.getElementById('supplier-${idx}').remove()">✕ Remove</button>
    </div>
    <div class="supplier-grid">
      <div class="ff" style="margin:0;">
        <label>Supplier Name *</label>
        <input type="text" name="s-name-${idx}" placeholder="Name" value="${data.supplierName||""}" oninput="this.value=this.value.toUpperCase()"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Product *</label>
        <input type="text" name="s-product-${idx}" placeholder="e.g. ઘઉં" value="${data.product||""}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Quantity</label>
        <input type="number" name="s-qty-${idx}" placeholder="0" value="${data.quantity||""}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Unit</label>
        <select name="s-unit-${idx}">
          <option value="Man" ${data.unit==="Man"?"selected":""}>Man (20kg)</option>
          <option value="Khadi" ${data.unit==="Khadi"?"selected":""}>Khadi (400kg)</option>
          <option value="Bag" ${data.unit==="Bag"?"selected":""}>Bag</option>
          <option value="Quintal" ${data.unit==="Quintal"?"selected":""}>Quintal (100kg)</option>
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Rate (Price)</label>
        <input type="number" name="s-price-${idx}" placeholder="0" step="any" value="${data.price||""}"/>
      </div>
      <div class="ff" style="margin:0;">
        <label>Price Per</label>
        <select name="s-priceunit-${idx}">
          <option value="20kg" ${data.priceUnit==="20kg"?"selected":""}>Per 20kg</option>
          <option value="100kg" ${data.priceUnit==="100kg"?"selected":""}>Per 100kg</option>
        </select>
      </div>
      <div class="ff" style="margin:0;">
        <label>Delivered So Far</label>
        <input type="number" name="s-delivered-${idx}" placeholder="0" value="${data.delivered||0}"/>
      </div>
    </div>`;
  document.getElementById("supplier-entries").appendChild(div);
}

// ── SAVE ORDER ────────────────────────────────────────────────────────────────
async function saveOrder() {
  const date   = document.getElementById("order-date").value;
  const broker = document.getElementById("order-broker").value.trim();
  const notes  = document.getElementById("order-notes").value.trim();

  if (!date) { Swal.fire({icon:"error",title:"Date required!",toast:true,position:"top-end",showConfirmButton:false,timer:2000}); return; }

  // Collect suppliers
  const entries  = document.querySelectorAll(".supplier-entry");
  const suppliers = [];
  let valid = true;

  entries.forEach(entry => {
    const idx  = entry.id.split("-")[1];
    const name = document.querySelector(`[name="s-name-${idx}"]`)?.value?.trim();
    const prod = document.querySelector(`[name="s-product-${idx}"]`)?.value?.trim();
    if (!name || !prod) { valid = false; return; }
    suppliers.push({
      supplierName: name,
      product:      prod,
      quantity:     Number(document.querySelector(`[name="s-qty-${idx}"]`)?.value) || 0,
      unit:         document.querySelector(`[name="s-unit-${idx}"]`)?.value || "Man",
      price:        Number(document.querySelector(`[name="s-price-${idx}"]`)?.value) || 0,
      priceUnit:    document.querySelector(`[name="s-priceunit-${idx}"]`)?.value || "20kg",
      delivered:    Number(document.querySelector(`[name="s-delivered-${idx}"]`)?.value) || 0,
    });
  });

  if (!valid || suppliers.length === 0) {
    Swal.fire({icon:"error",title:"Fill all required fields!",toast:true,position:"top-end",showConfirmButton:false,timer:2500});
    return;
  }

  showLoading();
  try {
    const [dd,mm,yyyy] = [date.slice(8,10), date.slice(5,7), date.slice(0,4)];
    const formattedDate = `${dd}/${mm}/${yyyy}`;

    if (editingOrderId) {
      await ordersCollection.doc(editingOrderId).update({ date:formattedDate, broker, notes, suppliers, updatedAt: Date.now() });
    } else {
      // Auto order number
      const snap = await ordersCollection.orderBy("createdAt","desc").limit(1).get();
      const lastNo = snap.empty ? 0 : (snap.docs[0].data().orderNoInt || 0);
      const newNo  = lastNo + 1;
      const orderNo = `ORD-${String(yyyy).slice(-2)}${mm}-${String(newNo).padStart(4,"0")}`;
      await ordersCollection.add({
        orderNo, date: formattedDate, broker, notes, suppliers,
        status: "Pending", orderNoInt: newNo, createdAt: Date.now()
      });
    }
    Swal.fire({icon:"success",title:"✅ Order Saved!",toast:true,position:"top-end",showConfirmButton:false,timer:2000});
    closeOrderModal();
    await loadOrders();
  } catch(e) {
    console.error(e);
    Swal.fire({icon:"error",title:"Could not save order.",toast:true,position:"top-end",showConfirmButton:false,timer:2500});
  } finally {
    hideLoading();
  }
}

// ── EDIT ORDER ────────────────────────────────────────────────────────────────
function editOrder(id) {
  const order = allOrders.find(o => o.id === id);
  if (!order) return;
  editingOrderId = id;
  document.getElementById("order-modal-title").textContent = `✏️ Edit Order #${order.orderNo}`;

  const [dd,mm,yyyy] = order.date.split("/");
  document.getElementById("order-date").value   = `${yyyy}-${mm}-${dd}`;
  document.getElementById("order-broker").value = order.broker || "";
  document.getElementById("order-notes").value  = order.notes  || "";

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  (order.suppliers || []).forEach(s => addSupplierEntry(s));

  document.getElementById("order-modal").classList.add("open");
}

// ── UPDATE STATUS ─────────────────────────────────────────────────────────────
async function updateOrderStatus(id, status) {
  try {
    await ordersCollection.doc(id).update({ status, updatedAt: Date.now() });
    await loadOrders();
  } catch(e) {
    console.error(e);
  }
}

// ── DELETE ORDER ──────────────────────────────────────────────────────────────
async function deleteOrder(id) {
  const result = await Swal.fire({
    icon:"warning", title:"Delete Order?", text:"This cannot be undone.",
    showCancelButton:true, confirmButtonColor:"#dc3545", cancelButtonColor:"#6c757d",
    confirmButtonText:"Yes, Delete"
  });
  if (!result.isConfirmed) return;
  await ordersCollection.doc(id).delete();
  await loadOrders();
}

// Close modal on outside click
document.getElementById("order-modal").addEventListener("click", function(e) {
  if (e.target === this) closeOrderModal();
});
