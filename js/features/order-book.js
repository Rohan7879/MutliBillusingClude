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
    extractBrokersAndSuppliers(); // 👈 Yahan call kar do taaki list update rahe
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

// ── RENDER ORDERS ─────────────────────────────────────────────────────────────
function renderOrders() {
  const container = document.getElementById("order-list");
  if (!container) return;

  const filtered =
    currentFilter === "All"
      ? allOrders.filter((o) => o.status !== "Deleted")
      : allOrders.filter((o) => o.status === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:#6c757d;padding:30px;font-size:15px;">
      📭 No ${currentFilter === "All" ? "" : currentFilter} orders found.</div>`;
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

      // Item rows (Supplier ki jagah Variety dikhayega)
      const suppliers = (order.suppliers || [])
        .map(
          (s) => `
      <div class="supplier-row">
        <span><strong>${s.variety || s.supplierName || "-"}</strong></span>
        <span>${s.product}</span>
        <span>${s.quantity} ${s.unit}</span>
        <span>₹${s.price}/${s.priceUnit}</span>
        <span style="color:#6c757d;">${s.delivered || 0} ${s.unit} delivered</span>
      </div>`
        )
        .join("");

      // Har bill ke liye alag clickable badge banane ka loop
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

      // Check karo ki kya status Completed ya Partial hai
      const isLocked = order.status === "Completed" || order.status === "Partial";

      return `
  <div class="order-card">
    <div class="order-card-header">
      <div>
        <div class="order-no">#${order.orderNo}</div>
        <div class="order-date">📅 ${order.date}${order.broker ? ` &nbsp;|&nbsp; 🤝 ${order.broker}` : ""}</div>
      </div>
      
      <div style="text-align: right;">
        <span class="status-badge ${statusClass}">${statusEmoji} ${order.status}</span>
        ${billBadgesHtml ? `<br>${billBadgesHtml}` : ""}
      </div>
    </div>

    <!-- SUPPLIER ki jagah VARIETY -->
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

    <!-- 👇 Yahan check lagaya hai ki agar Cancelled ya Deleted hai, toh buttons DONT SHOW 👇 -->
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
// Aapka Updated saveOrder Function
// =====================================================================
async function saveOrder() {
  // 1. Correct IDs se values fetch karna
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

  // Name aur Village alag-alag lena
  const baseName = document.getElementById("order-supplier")?.value?.trim().toUpperCase() || "";
  const villageVal = document.getElementById("order-village")?.value?.trim().toUpperCase() || "";

  // Validation: Supplier/Customer name zaroori hai
  if (!baseName) {
    Swal.fire("Error", "Please enter Supplier / Customer name.", "error");
    return;
  }

  // Combine karke final supplierName banana
  const supplierName = villageVal ? `${baseName} (${villageVal})` : baseName;

  // 🔗 2. Automatic Customer Master Sync
  try {
    const custId = baseName.toLowerCase().replace(/\s+/g, "_");
    const custRef = db.collection("customers").doc(custId);
    const custDoc = await custRef.get();

    if (!custDoc.exists) {
      await custRef.set(
        {
          name: baseName,
          village: villageVal,
          createdAt: Date.now(),
        },
        { merge: true }
      );
      if (typeof loadCustomersForOrder === "function") loadCustomersForOrder();
    } else {
      if (villageVal && !custDoc.data().village) {
        await custRef.update({ village: villageVal });
      }
    }
  } catch (err) {
    console.warn("Customer master auto-sync warning:", err);
  }

  // 3. Direct product dropdowns check karna
  const prodDropdowns = document.querySelectorAll('select[name^="s-product-"]');
  if (prodDropdowns.length === 0) {
    Swal.fire("Error", "Please add at least one Vakal item.", "error");
    return;
  }

  let suppliers = [];
  let valid = true;

  // 4. Dropdown wise loop chalakar data extract karna
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

  // 5. Validation check
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

  // 6. Database mein save karne ka logic
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

      // 👇 Naya Number Generator Yahan Set Hai 👇
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
async function updateOrderStatus(id, status) {
  try {
    await ordersCollection.doc(id).update({ status, updatedAt: Date.now() });
    await loadOrders();
  } catch (e) {
    console.error(e);
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

// Firestore se Customers aur Brokers load karne ke liye
async function loadCustomersAndBrokers() {
  try {
    // 1. Customers fetch karo (Firestore ki 'customers' collection se)
    const custSnap = await db.collection("customers").get();
    allCustomersList = custSnap.docs.map((doc) => {
      const data = doc.data();
      return data.name ? (data.village ? `${data.name} (${data.village})` : data.name) : doc.id;
    });

    // 2. Brokers fetch karo (Firestore ki 'brokers' collection ya orders se)
    const brokerSnap = await db.collection("brokers").get();
    if (!brokerSnap.empty) {
      allBrokersList = brokerSnap.docs.map((doc) => doc.data().name || doc.id);
    } else {
      // Fallback: Agar brokers collection nahi hai toh orders se nikal lo
      const bSet = new Set();
      allOrders.forEach((o) => {
        if (o.broker) bSet.add(o.broker.toUpperCase());
      });
      allBrokersList = Array.from(bSet);
    }

    updateOrderBookDatalists();
  } catch (e) {
    console.error("Error loading customers/brokers:", e);
  }
}

// Datalists ko HTML mein inject karne ka function
function updateOrderBookDatalists() {
  // Customer/Supplier Datalist
  let custDatalist = document.getElementById("order-supplier-list");
  if (!custDatalist) {
    custDatalist = document.createElement("datalist");
    custDatalist.id = "order-supplier-list";
    document.body.appendChild(custDatalist);
  }
  custDatalist.innerHTML = allCustomersList.map((c) => `<option value="${c}">`).join("");

  // Broker Datalist
  let brokerDatalist = document.getElementById("order-broker-list");
  if (!brokerDatalist) {
    brokerDatalist = document.createElement("datalist");
    brokerDatalist.id = "order-broker-list";
    document.body.appendChild(brokerDatalist);
  }
  brokerDatalist.innerHTML = allBrokersList.map((b) => `<option value="${b}">`).join("");

  // Input fields par list attribute set karna
  const supplierInput = document.getElementById("order-supplier");
  if (supplierInput) {
    supplierInput.setAttribute("list", "order-supplier-list");
    supplierInput.oninput = function () {
      this.value = this.value.toUpperCase();
    };
  }

  const brokerInput = document.getElementById("order-broker");
  if (brokerInput) {
    brokerInput.setAttribute("list", "order-broker-list");
    brokerInput.oninput = function () {
      this.value = this.value.toUpperCase();
    };
  }
}
function openNewOrderModal() {
  editingOrderId = null;
  document.getElementById("order-modal-title").textContent = "➕ New Order";
  document.getElementById("order-broker").value = "";
  document.getElementById("order-notes").value = "";
  document.getElementById("order-supplier").value = "";
  setDefaultDate();

  updateOrderBookDatalists(); // 👈 Yahan bhi call kar do

  document.getElementById("supplier-entries").innerHTML = "";
  supplierCount = 0;
  addSupplierEntry();
  document.getElementById("order-modal").classList.add("open");
}
function extractBrokersAndSuppliers() {
  const brokersSet = new Set();
  const suppliersSet = new Set();

  allOrders.forEach((order) => {
    if (order.broker) brokersSet.add(order.broker.trim().toUpperCase());
    if (order.supplierName) suppliersSet.add(order.supplierName.trim().toUpperCase());
    if (order.suppliers) {
      order.suppliers.forEach((s) => {
        if (s.supplierName) suppliersSet.add(s.supplierName.trim().toUpperCase());
      });
    }
  });

  allBrokersList = Array.from(brokersSet).sort();
  allSuppliersList = Array.from(suppliersSet).sort();
}
// ── LOAD CUSTOMERS INTO ORDER MODAL DATALIST (FINAL FIX) ───────────────────
async function loadCustomersForOrder() {
  let datalist = document.getElementById("order-customer-datalist");
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = "order-customer-datalist";
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = "";

  window.customerVillageMap = {};

  try {
    const snap = await db.collection("customers").orderBy("name").get();

    snap.forEach((doc) => {
      const c = doc.data();
      let rawName = (c.name || "").trim().toUpperCase();
      let village = (c.village || "").trim().toUpperCase();

      if (rawName.includes("(") && rawName.includes(")")) {
        const parts = rawName.split("(");
        rawName = parts[0].trim();
        if (!village) {
          village = parts[1].replace(")", "").trim();
        }
      }

      if (rawName) {
        window.customerVillageMap[rawName] = village;
        const opt = document.createElement("option");
        // Datalist mein name + village dono dikhenge taaki search karne mein asani ho
        opt.value = village ? `${rawName} (${village})` : rawName;
        datalist.appendChild(opt);
      }
    });

    const supplierInput = document.getElementById("order-supplier");
    const villageInput = document.getElementById("order-village");
    if (villageInput) {
      villageInput.addEventListener("input", function () {
        this.value = this.value.toUpperCase();
      });
    }

    if (supplierInput) {
      supplierInput.setAttribute("list", "order-customer-datalist");

      const handleSelection = () => {
        let fullText = supplierInput.value.trim().toUpperCase();
        let cleanName = fullText;
        let village = "";

        // Agar user ne bracket wala option select kiya hai
        if (fullText.includes("(") && fullText.includes(")")) {
          const parts = fullText.split("(");
          cleanName = parts[0].trim();
          village = parts[1].replace(")", "").trim();

          // Supplier name box mein se bracket hata kar sirf clean name set karo
          supplierInput.value = cleanName;
        } else if (window.customerVillageMap[fullText]) {
          // Agar sirf naam type kiya hai toh map se village utha lo
          village = window.customerVillageMap[fullText];
        }

        // Village box mein automatic gaon daal do
        if (villageInput && village) {
          villageInput.value = village.toUpperCase();
        }
      };

      supplierInput.addEventListener("input", handleSelection);
      supplierInput.addEventListener("change", handleSelection);
    }
  } catch (e) {
    console.error("Error loading customers datalist:", e);
  }
}
// Page load hone par yeh function apne aap chal jayega
document.addEventListener("DOMContentLoaded", () => {
  loadCustomersForOrder();
});
