document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id") || urlParams.get("billId");
  if (billId) {
    fetchBillAndDisplay(billId);
  }

  // Payment modal logic from previous updates
  const recordPaymentBtn = document.getElementById("record_payment_btn");
  const paymentModal = document.getElementById("payment-modal");
  const closePaymentModalBtn = document.getElementById("close-payment-modal-btn");
  const savePaymentBtn = document.getElementById("save-payment-btn");
  if (recordPaymentBtn) {
    recordPaymentBtn.addEventListener("click", () => {
      if (paymentModal) paymentModal.style.display = "flex";
    });
  }
  if (closePaymentModalBtn) {
    closePaymentModalBtn.addEventListener("click", () => {
      if (paymentModal) paymentModal.style.display = "none";
    });
  }
  if (savePaymentBtn) {
    savePaymentBtn.addEventListener("click", async () => {
      const paymentInput = document.getElementById("payment-amount-input"); // ya jo bhi aapke input ka ID ho
      const cashAmount = Number(paymentInput ? paymentInput.value : 0) || 0;

      if (cashAmount <= 0) {
        alert("Please enter a valid amount.");
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);
      const billId = urlParams.get("id") || urlParams.get("billId");
      if (!billId) {
        alert("Bill ID not found.");
        return;
      }

      try {
        showLoading("Saving payment...");
        const billRef = billsCollection.doc(billId);
        const billDoc = await billRef.get();

        if (!billDoc.exists) {
          alert("Bill not found.");
          hideLoading();
          return;
        }

        const billData = billDoc.data();
        const currentAmountPaid = billData.amountPaid || 0;
        const finalTotal = billData["Final Total"] || 0;
        const newAmountPaid = currentAmountPaid + cashAmount;
        const newAmountDue = finalTotal - newAmountPaid;
        const newStatus = newAmountDue <= 0.01 ? "Paid" : "Partially Paid";

        // 1. Bill update karo
        await billRef.update({
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          paymentStatus: newStatus,
        });

        // 2. Payments collection mein entry daalo
        await db.collection("payments").add({
          customerName: billData["Customer Name"] || billData.customerName,
          customerVillage: billData["Village"] || billData.customerVillage || "N/A",
          customerId: billData.customerId || null,
          cashAmount: cashAmount,
          deductionAmount: 0,
          totalCredit: cashAmount,
          paymentDate: firebase.firestore.Timestamp.fromDate(new Date()),
          appliedToBills: [billId],
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        // 3. Party Master ka balance update karo
        if (billData.customerId) {
          const masterRef = db.collection("parties").doc(billData.customerId);
          const masterDoc = await masterRef.get();
          if (masterDoc.exists) {
            const prevBalance = masterDoc.data().currentBalance || 0;
            await masterRef.update({
              currentBalance: prevBalance - cashAmount,
              lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
          }
        }

        hideLoading();
        alert("Payment saved successfully!");
        if (paymentModal) paymentModal.style.display = "none";
        fetchBillAndDisplay(billId); // Page refresh / reload data
      } catch (error) {
        console.error("Error saving payment from bill view:", error);
        hideLoading();
        alert("Could not save the payment.");
      }
    });
  }
});

async function fetchBillAndDisplay(billId) {
  try {
    showLoading("Loading bill details...");
    await fetchSettings();

    const doc = await billsCollection.doc(billId).get();
    if (doc.exists) {
      const billData = { ...doc.data(), id: doc.id };
      localStorage.setItem("currentBill", JSON.stringify(billData));
      displayData(billData);
      await applyBoxOrder();
    } else {
      alert("Error: Bill not found in database.");
    }
  } catch (error) {
    console.error("Error fetching and displaying bill:", error);
    alert("Could not load bill details.");
  } finally {
    hideLoading();
  }
}

/**
 * Reorders the weight-side detail boxes (Kasar, Bardan, Moisture, Template
 * Deductions) inside .details-grid per the admin's saved preference from
 * Settings. વેબ્રીજ (Weighbridge) always stays first and નેટ વજન (Net
 * Weight) always stays last — only the deduction boxes in between move.
 * If no preference is saved yet, the default DOM order (from the HTML) is
 * left untouched.
 */
async function applyBoxOrder() {
  try {
    const doc = await db.collection("settings").doc("printLayout").get();
    if (!doc.exists) return; // no preference saved — leave default order
    const order = doc.data().weightBoxOrder;
    if (!order || !Array.isArray(order) || order.length === 0) return;

    const detailsGrid = document.querySelector(".details-grid");
    if (!detailsGrid) return;
    const netWeightBox = detailsGrid.querySelector(".summary-item");
    if (!netWeightBox) return;

    const slotElements = {
      kasar: [document.getElementById("kasar_box")].filter(Boolean),
      bardan: [document.getElementById("kantan_box"), document.getElementById("plastic_box")].filter(Boolean),
      moisture: [document.getElementById("wb_moisture_box")].filter(Boolean),
      templateDeductions: Array.from(detailsGrid.querySelectorAll(".tda-weight-item")),
    };

    order.forEach((slotKey) => {
      (slotElements[slotKey] || []).forEach((el) => {
        detailsGrid.insertBefore(el, netWeightBox);
      });
    });
  } catch (e) {
    console.warn("applyBoxOrder: could not load/apply layout order (non-critical):", e);
  }
}

function displayData(data) {
  // Helper to safely set a value with number formatting
  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = formatNumber(value);
    }
  }

  // Helper to safely set simple text content
  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  const supplyTypeElement = document.getElementById("display_supply_type");
  if (supplyTypeElement) {
    let displayText = "";

    // Phase 1: Use the selected product's name (saved on the bill as
    // data["ProductTemplate"]) instead of a hardcoded "ઘઉં" (wheat) label.
    // Falls back to a generic "કટ્ટા" label for bills with no product selected
    // (e.g. older bills, or a manual bill with no template).
    const productLabel = data["ProductTemplate"] ? `${data["ProductTemplate"]}ના કટ્ટા` : "કટ્ટા";

    // Case 1: A true "Loose Supply" bill
    if (data["Bill Type"] === "Loose") {
      displayText = "લૂઝ";
    }
    // Case 2: A "Kantan Pack" bag bill
    else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "કંતાન પેક") {
      const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
      displayText = `${productLabel} - ${totalBharela} કંતાન પેક`;
    }
    // Case 3: A "Loose" description for a "Bag" bill
    else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "લૂઝ") {
      const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
      displayText = `${productLabel} - ${totalBharela} લૂઝ`;
    }

    supplyTypeElement.textContent = displayText;
    supplyTypeElement.style.display = displayText ? "block" : "none";
  }
  // Set main display values
  setText("display_serial_no", data["Serial No"]);
  setText("display_date", data["Date"]);
  setText("display_customer_name", data["Customer Name"]);
  setText("display_vehicle_no", data["Vehicle No"]);
  setText("display_village", data["Village"]);
  setText("display_broker", data["Broker"]);

  setValue("display_weighbridge_weight", data["Weighbridge Weight"]);
  setValue("display_net_weight", data["Net Weight"]);
  setValue("display_total_amount", data["Total Amount"]);
  setValue("display_final_total", data["Final Total"]);

  // Handle negative display values
  setText("display_kasar", "-" + formatNumber(data["Kasar"] || 0));
  setText("display_utrai", "-" + formatNumber(data["Utrāī"] || 0));

  // Moisture display
  const wbMoistureBox = document.getElementById("wb_moisture_box");
  const wbMoistureKg = data["Weighbridge Moisture Kg"] || 0;
  const wbMoisturePct = data["Weighbridge Moisture %"] || 0;
  if (wbMoistureBox) {
    if (wbMoistureKg > 0) {
      wbMoistureBox.style.display = "block";
      setText("display_wb_moisture", `-${formatNumber(wbMoistureKg)} (${wbMoisturePct}%)`);
    } else {
      wbMoistureBox.style.display = "none";
    }
  }

  // Logic for Kantan/Plastic/Bardan boxes
  const kantanBox = document.getElementById("kantan_box");
  const plasticBox = document.getElementById("plastic_box");

  if (data["Bill Type"] === "Loose") {
    if (kantanBox) kantanBox.style.display = "block";
    if (plasticBox) plasticBox.style.display = "block";
    setText("display_kantan_weight", "-" + formatNumber(data["Kantan Weight"] || 0));
    setText("display_plastic_weight", "-" + formatNumber(data["Plastic Weight"] || 0));
  } else if (data["Kantan Weight"] !== undefined) {
    if (kantanBox) kantanBox.style.display = "block";
    if (plasticBox) plasticBox.style.display = "block";
    setText("display_kantan_weight", "-" + formatNumber(data["Kantan Weight"] || 0));
    setText("display_plastic_weight", "-" + formatNumber(data["Plastic Weight"] || 0));
  } else {
    // Fallback for old bills
    if (kantanBox) kantanBox.style.display = "none";
    if (plasticBox) {
      plasticBox.style.display = "block";
      setText("plastic_label", "બારદાન વજન");
      setText("display_plastic_weight", "-" + formatNumber(data["Bardan Weight"] || 0));
    }
  }

  const totalBagsContainer = document.getElementById("total-bags-final-view");
  if (data["Bill Type"] === "Bag" && totalBagsContainer) {
    const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
    const totalKhali = (data["Khali 600"] || 0) + (data["Khali 200"] || 0);
    const grandTotal = totalBharela + totalKhali;

    if (grandTotal > 0) {
      totalBagsContainer.innerHTML = `${totalBharela} (ભરેલા) + ${totalKhali} (ખાલી) = ${grandTotal} (કુલ)`;
      totalBagsContainer.style.display = "block";
    } else {
      totalBagsContainer.style.display = "none";
    }
  } else if (totalBagsContainer) {
    totalBagsContainer.style.display = "none";
  }

  // --- CORRECTED VAKAL ROW LOGIC ---
  for (let i = 1; i <= 5; i++) {
    const katta = data[`Vakal ${i} Katta`];
    const kilo = data[`Vakal ${i} Kilo`];
    const vakalRow = document.getElementById(`vakal_row_${i}`);

    if (vakalRow) {
      let showRow = true; // Default to showing the row

      if (data["Bill Type"] === "Loose") {
        // For loose bills, only show the first row (i=1)
        if (i > 1) {
          showRow = false;
        }
      } else {
        // For "Bag" bills, hide empty rows after the first one
        if ((!katta || katta === 0) && (!kilo || kilo === 0) && i > 1) {
          showRow = false;
        }
      }
      // --- MODIFIED: LOGIC TO ADD/REMOVE CSS CLASS FOR SPACING ---
      const billMeta = document.querySelector(".bill-meta");
      const headerBagCount = document.getElementById("header-bag-count");

      if (data["Bill Type"] === "Bag" && headerBagCount && billMeta) {
        const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
        const totalKhali = (data["Khali 600"] || 0) + (data["Khali 200"] || 0);
        const grandTotal = totalBharela + totalKhali;

        if (grandTotal > 0) {
          setText("display_bharela_header", `${totalBharela} (ભરેલા)`);
          setText("display_khali_header", `${totalKhali} (ખાલી)`);
          setText("display_grand_total_header", `${grandTotal} (કુલ)`);
          headerBagCount.style.display = "block";
          billMeta.classList.add("has-bag-counts"); // Add class for larger spacing
        } else {
          headerBagCount.style.display = "none";
          billMeta.classList.remove("has-bag-counts"); // Remove class for smaller spacing
        }
      } else if (headerBagCount && billMeta) {
        headerBagCount.style.display = "none";
        billMeta.classList.remove("has-bag-counts"); // Remove class for smaller spacing
      }

      // Now, apply visibility and set data for the row
      if (showRow) {
        vakalRow.style.display = "table-row";
        setValue(`display_vakal_${i}_katta`, katta);

        const moisturePct = data[`Vakal ${i} Moisture %`] || 0;
        const moistureKg = data[`Vakal ${i} Moisture Kg`] || 0;

        // kilo stored is already AFTER moisture deduction
        const kiloAfterMoisture = kilo; // final net kilo
        // raw kilo before moisture = kilo + moistureKg
        const rawKilo = kiloAfterMoisture + moistureKg;

        const moistureTd = document.getElementById(`vakal_${i}_moisture_td`);
        const netKiloTd = document.getElementById(`vakal_${i}_net_kilo_td`);
        const kiloEl = document.getElementById(`display_vakal_${i}_kilo`);

        if (moisturePct > 0 && moistureKg > 0) {
          // Show raw kilo in kilo column
          if (kiloEl) kiloEl.innerHTML = formatNumber(rawKilo);
          // Show moisture column
          if (moistureTd) {
            moistureTd.style.display = "table-cell";
            moistureTd.innerHTML = `-${formatNumber(
              moistureKg
            )}<br><small style="font-size:11px;">(${moisturePct}%)</small>`;
          }
          // Show net kilo column
          if (netKiloTd) {
            netKiloTd.style.display = "table-cell";
            netKiloTd.innerHTML = `<strong>${formatNumber(kiloAfterMoisture)}</strong>`;
          }
        } else {
          // No moisture — show net kilo directly
          if (kiloEl) kiloEl.innerHTML = formatNumber(kiloAfterMoisture);
          if (moistureTd) moistureTd.style.display = "none";
          if (netKiloTd) netKiloTd.style.display = "none";
        }

        setValue(`display_vakal_${i}_bhav`, data[`Vakal ${i} Bhav`]);
        setValue(`display_vakal_${i}_amount`, data[`Vakal ${i} Amount`]);
      } else {
        vakalRow.style.display = "none";
      }
    }
  }

  // Show/hide moisture header columns based on data
  const anyVakalMoisture = [1, 2, 3, 4, 5].some((i) => (data[`Vakal ${i} Moisture %`] || 0) > 0);
  const thMoisture = document.getElementById("th_moisture");
  const thNetKilo = document.getElementById("th_net_kilo");
  if (thMoisture) thMoisture.style.display = anyVakalMoisture ? "table-cell" : "none";
  if (thNetKilo) thNetKilo.style.display = anyVakalMoisture ? "table-cell" : "none";

  // Moisture total summary box
  let existingMoistureBox = document.getElementById("moisture_total_box");
  if (anyVakalMoisture) {
    const totalMoistureKg = [1, 2, 3, 4, 5].reduce((sum, i) => sum + (data[`Vakal ${i} Moisture Kg`] || 0), 0);
    if (!existingMoistureBox) {
      const box = document.createElement("div");
      box.id = "moisture_total_box";
      box.className = "detail-item";
      box.style.cssText =
        "background:#fff8e7; border:2px solid #ffe08a; border-radius:10px; padding:12px; text-align:center; margin-top:10px;";
      box.innerHTML = `
        <span class="detail-label" style="color:#7a5700; font-weight:700;">💧 કુલ મોઇ. કપાત (Total Moisture Cut)</span>
        <span class="detail-value" style="color:#e67e00; font-size:1.8em; font-weight:800; display:block; margin-top:4px;">-${Number(
          totalMoistureKg
        ).toLocaleString("en-IN")} kg</span>
      `;
      const finalBillTable = document.querySelector(".final-bill-table");
      if (finalBillTable && finalBillTable.parentNode) {
        finalBillTable.parentNode.insertBefore(box, finalBillTable.nextSibling);
      }
    }
  } else if (existingMoistureBox) {
    existingMoistureBox.remove();
  }

  renderExpenses(data);
  renderRemarks(data);
  renderTemplateDeductionsForPrint(data);

  // Truck Freight box — must be created BEFORE applyPrintLayoutOrder() runs,
  // otherwise the reorder logic can't find/place it (it didn't exist yet).
  const existingFreightBox = document.getElementById("freight_item");
  if (data["Truck Freight"] && data["Truck Freight"] > 0) {
    const totalsGrid = document.querySelector(".totals-grid");
    const finalTotalBox = document.querySelector(".final-total-box-container");
    if (totalsGrid && finalTotalBox && !existingFreightBox) {
      const freightItem = document.createElement("div");
      freightItem.id = "freight_item";
      freightItem.classList.add("detail-item");
      freightItem.innerHTML = `<span class="detail-label">ટ્રક ભાડું (Freight)</span><span class="detail-value" style="color: #28a745;">+${Number(
        data["Truck Freight"]
      ).toLocaleString("en-IN")}</span>`;
      totalsGrid.insertBefore(freightItem, finalTotalBox);
    }
  } else if (existingFreightBox) {
    existingFreightBox.remove();
  }

  const existingBrokerBox = document.getElementById("broker_box");
  if (data["Broker"] && data["Broker"].trim() !== "") {
    const totalsGrid = document.querySelector(".totals-grid");
    const finalTotalBox = document.querySelector(".final-total-box-container");
    if (totalsGrid && finalTotalBox && !existingBrokerBox) {
      const brokerItem = document.createElement("div");
      brokerItem.id = "broker_box";
      brokerItem.classList.add("detail-item");
      brokerItem.innerHTML = `
        <span class="detail-label">દલાલ</span>
        <span class="detail-value" style="color: #005a9e;">-${Number(data["BrokerCommission"] || 0).toLocaleString(
          "en-IN"
        )}</span>
      `;
      totalsGrid.insertBefore(brokerItem, finalTotalBox);
    }
  } else if (existingBrokerBox) {
    existingBrokerBox.remove();
  }

  if (typeof applyPrintLayoutOrder === "function") applyPrintLayoutOrder();
  renderCompanyHeader(data);

  hideLoading();
}

/**
 * Renders bill remarks/notes if present (Phase 1 addition).
 * Creates the remarks box dynamically if it doesn't already exist in the HTML.
 * @param {Object} data - Bill data object
 */
/**
 * Renders template deductions (Admixture, GST etc.) in a dedicated
 * print-visible section below the vakal table.
 * Hidden on screen by default — only shows in @media print.
 * @param {Object} data - Bill data object
 */
function renderTemplateDeductionsForPrint(data) {
  // Remove any previously-injected deduction items (old single-box style +
  // the new split-into-two-grids style) before re-rendering.
  const oldBox = document.getElementById("template-deductions-applied");
  if (oldBox) oldBox.remove();
  document.querySelectorAll(".tda-weight-item, .tda-amount-item").forEach((el) => el.remove());

  const applied = data["TemplateDeductionsApplied"];
  if (!applied || applied.length === 0) return;

  const weightDeds = applied.filter((d) => d.stage === "weight");
  const amountDeds = applied.filter((d) => d.stage !== "weight");

  // Weight-stage deductions (e.g. Admixture, in kg) -> upper details-grid
  // box, alongside વેબ્રીજ / કાં.ક. / કંતાન / પ્લાસ્ટિક — inserted BEFORE
  // નેટ વજન (the .summary-item box) since these deductions are what PRODUCE
  // the net weight, so they should read before the result, not after it.
  const detailsGrid = document.querySelector(".details-grid");
  const netWeightBox = detailsGrid ? detailsGrid.querySelector(".summary-item") : null;
  if (detailsGrid) {
    weightDeds.forEach((d) => {
      const sign = d.applyAs === "add" ? "+" : "-";
      const item = document.createElement("div");
      item.className = "detail-item tda-weight-item";
      item.innerHTML = `<span class="detail-label">${d.name}</span><span class="detail-value">${sign}${Number(
        d.impact
      ).toLocaleString("en-IN")}</span>`;
      if (netWeightBox) {
        detailsGrid.insertBefore(item, netWeightBox);
      } else {
        detailsGrid.appendChild(item);
      }
    });
  }

  // Amount-stage deductions (e.g. GST, in ₹) -> lower totals-grid box,
  // alongside ટોટલ રૂપિયા / ઉતરાઈ — inserted BEFORE the Final Total box so
  // Final Total visually stays last.
  const totalsGrid = document.querySelector(".totals-grid");
  const finalTotalBox = document.getElementById("final_total_box_container");
  if (totalsGrid) {
    amountDeds.forEach((d) => {
      const sign = d.applyAs === "add" ? "+" : "-";
      const item = document.createElement("div");
      item.className = "detail-item tda-amount-item";
      item.innerHTML = `<span class="detail-label">${d.name}</span><span class="detail-value">${sign}₹${Number(
        d.impact
      ).toLocaleString("en-IN")}</span>`;
      if (finalTotalBox) {
        totalsGrid.insertBefore(item, finalTotalBox);
      } else {
        totalsGrid.appendChild(item);
      }
    });
  }
}

/**
 * Renders company header on bill if enabled in profile settings
 */
function renderCompanyHeader() {
  const p = window.companyProfile || {};
  const s = p.showOnBill || {};
  const el = document.getElementById("company-header-box");
  if (!el) return;
  const lines = [];
  if (s.name && p.name) lines.push(`<strong style="font-size:1.2em;">${p.name}</strong>`);
  if (s.ownerName && p.ownerName) lines.push(p.ownerName);
  if (s.address && p.address) lines.push(p.address);
  if (s.phone && p.phone) lines.push(`📞 ${p.phone}`);
  if (s.gst && p.gst) lines.push(`GST: ${p.gst}`);
  if (lines.length > 0) {
    el.style.display = "block";
    el.innerHTML = lines.join("<br>");
  } else {
    el.style.display = "none";
  }
}

function renderRemarks(data) {
  const box = document.getElementById("bill_remarks_box");
  if (!box) return; // Agar HTML mein box nahi mila toh yahin ruk jao

  const remarks = data && data["Remarks"] ? data["Remarks"].trim() : "";

  if (!remarks) {
    box.style.display = "none";
    box.innerHTML = "";
  } else {
    box.style.display = "block";
    box.innerHTML = `<strong>📝 Remarks:</strong> ${remarks}`;
  }
}
function renderExpenses(data) {
  const expensesContainer = document.getElementById("expenses_container");
  if (!expensesContainer) return;
  expensesContainer.innerHTML = "";
  if (data["Expenses"]) {
    try {
      const expenses = JSON.parse(data["Expenses"]);
      if (expenses.length > 0) {
        expenses.forEach((exp) => {
          const expenseBox = document.createElement("div");
          expenseBox.classList.add("detail-item");
          expenseBox.innerHTML = `<span class="detail-label">${exp.name}</span><span class="detail-value">-${exp.amount}</span>`;
          expensesContainer.appendChild(expenseBox);
        });
        expensesContainer.style.display = "contents";
      } else {
        expensesContainer.style.display = "none";
      }
    } catch (e) {
      expensesContainer.style.display = "none";
    }
  } else {
    expensesContainer.style.display = "none";
  }
}

async function sendBillViaWhatsApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id") || urlParams.get("billId");
  if (!billId) {
    alert("Bill ID not found.");
    return;
  }

  // Load latest bill data from Firestore
  let data;
  try {
    const doc = await billsCollection.doc(billId).get();
    if (!doc.exists) {
      alert("Bill not found.");
      return;
    }
    data = doc.data();
  } catch (e) {
    alert("Could not load bill data.");
    return;
  }

  // Load company profile for URL + settings
  const profile = window.companyProfile || {};
  const wp = profile.whatsapp || {};

  // Secure download link
  const downloadLink = window.generateSecureDownloadUrl
    ? window.generateSecureDownloadUrl(billId)
    : `${profile.appUrl || "https://ganesh-agri-new.web.app"}/download.html?id=${billId}`;

  // Build message
  const lines = [];
  lines.push(`🧾 *Bill No:* ${data["Serial No"]}`);
  lines.push(`📅 *Date:* ${data["Date"]}`);
  lines.push(`👤 *Name:* ${data["Customer Name"]}`);
  if (data["Village"]) lines.push(`🏘️ *Village:* ${data["Village"]}`);
  if (wp.showBroker !== false && data["Broker"]) lines.push(`🤝 *Broker:* ${data["Broker"]}`);
  if (wp.showProduct !== false && data["ProductTemplate"]) lines.push(`🌾 *Product:* ${data["ProductTemplate"]}`);
  if (wp.showNetWeight !== false)
    lines.push(`⚖️ *Net Weight:* ${Number(data["Net Weight"]).toLocaleString("en-IN")} kg`);

  // Vakal details
  if (wp.showVakalDetails !== false) {
    lines.push("\n📦 *Vakal Details:*");
    if (data["Bill Type"] === "Loose") {
      lines.push(
        `  • ${data["Vakal 1 Kilo"]} kg @ ₹${data["Vakal 1 Bhav"]} = ₹${Number(data["Vakal 1 Amount"]).toLocaleString(
          "en-IN"
        )}`
      );
    } else {
      for (let i = 1; i <= 5; i++) {
        if ((data[`Vakal ${i} Katta`] || 0) > 0) {
          lines.push(
            `  • વકલ ${i}: ${data[`Vakal ${i} Katta`]} bags, ${data[`Vakal ${i} Kilo`]} kg @ ₹${
              data[`Vakal ${i} Bhav`]
            } = ₹${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}`
          );
        }
      }
    }
  }

  lines.push(`\n💰 *Total:* ₹${Number(data["Total Amount"]).toLocaleString("en-IN")}`);
  lines.push(`📉 *Utrai:* -₹${Number(data["Utrāī"]).toLocaleString("en-IN")}`);
  if ((data["Truck Freight"] || 0) > 0)
    lines.push(`🚛 *Freight:* +₹${Number(data["Truck Freight"]).toLocaleString("en-IN")}`);
  lines.push(`\n✅ *Final Total: ₹${Number(data["Final Total"]).toLocaleString("en-IN")}*`);
  if (wp.showRemarks !== false && data["Remarks"]) lines.push(`\n📝 *Remarks:* ${data["Remarks"]}`);

  // Company name if set
  if (profile.name) lines.push(`\n🏢 ${profile.name}`);
  if (profile.phone) lines.push(`📞 ${profile.phone}`);

  lines.push(`\n🔗 *Bill Download:*\n${downloadLink}`);

  const message = lines.join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
}

// ═══════════════════════════════════════════════════════════════════════════
// NATIVE PDF GENERATOR — replaces the old html2canvas "screenshot" PDF.
// All bill data (customer name, numbers, dates, amounts) is drawn as REAL
// vector text: crisp at any zoom, selectable/copyable, and a much smaller
// file. jsPDF cannot correctly shape Indic scripts on its own (conjuncts
// and vowel signs come out wrong), so the ~30 FIXED Gujarati captions
// (વેબ્રીજ, કટ્ટા, etc.) use small pre-rendered images from
// js/core/bill-pdf-labels.js instead (rendered once, correctly shaped).
// Any USER-TYPED field that happens to contain Gujarati (customer name,
// remarks, expense names, template-deduction names, product template
// name) is auto-detected and rendered as a small isolated snippet image
// instead — only that one field, never the whole bill.
// ═══════════════════════════════════════════════════════════════════════════

function pdfHasGujarati(str) {
  return /[\u0A80-\u0AFF]/.test(str || "");
}

// Fallback for free-typed fields that contain Gujarati: renders just that
// short string via a hidden DOM node + html2canvas (NOT the whole bill).
async function renderGujaratiSnippet(str) {
  const tmp = document.createElement("div");
  tmp.style.cssText =
    "position:fixed; left:-9999px; top:0; white-space:nowrap; font-family:Arial,'Noto Sans Gujarati',sans-serif; background:#fff; color:#111; padding:3px 5px; font-size:44pt;";
  tmp.textContent = str;
  document.body.appendChild(tmp);
  const canvas = await html2canvas(tmp, { scale: 2, backgroundColor: "#ffffff" });
  document.body.removeChild(tmp);
  return { dataUrl: canvas.toDataURL("image/png"), ratio: canvas.width / canvas.height };
}

async function buildBillPDFNative(billData) {
  const { jsPDF } = window.jspdf;
  const L = window.BILL_PDF_LABELS || {};
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mx = 14;
  const bottomLimit = pageH - 16;
  let y = 18;

  doc.setTextColor(20, 20, 20);

  function ensureSpace(needed) {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 18;
    }
  }

  // Draws a pre-shaped Gujarati label image at a given target height (mm),
  // top-left positioned at (x, yTop). Returns the width it used.
  function img(key, x, yTop, hMM) {
    const l = L[key];
    if (!l) return 0;
    const w = hMM * l.ratio;
    doc.addImage(l.img, "PNG", x, yTop, w, hMM);
    return w;
  }
  // Same, but positioned so it visually sits on a text baseline at yBaseline.
  function imgOnBaseline(key, x, yBaseline, hMM) {
    return img(key, x, yBaseline - hMM * 0.8, hMM);
  }

  // Draws any data value as real text — UNLESS it contains Gujarati
  // characters (e.g. a customer name typed in Gujarati), in which case it
  // falls back to a small rendered snippet so it still displays correctly.
  async function valueText(str, x, yBaseline, fontSize, opts) {
    opts = opts || {};
    str = str === undefined || str === null ? "" : String(str);
    if (str && pdfHasGujarati(str)) {
      try {
        const snip = await renderGujaratiSnippet(str);
        const hMM = fontSize * 0.42;
        const w = hMM * snip.ratio;
        let drawX = x;
        if (opts.align === "right") drawX = x - w;
        else if (opts.align === "center") drawX = x - w / 2;
        doc.addImage(snip.dataUrl, "PNG", drawX, yBaseline - hMM * 0.78, w, hMM);
        return;
      } catch (e) {
        console.warn("Gujarati snippet render failed, falling back to plain text:", e);
      }
    }
    doc.setFontSize(fontSize);
    doc.text(str, x, yBaseline, opts);
  }

  const inr = (n) => Number(n || 0).toLocaleString("en-IN");

  // ---------- Load print layout order (same source the on-screen bill uses,
  // so the PDF always matches whatever order was set in Settings) ----------
  let detailsOrder = typeof DEFAULT_DETAILS_GRID_ORDER !== "undefined" ? DEFAULT_DETAILS_GRID_ORDER.slice() : [];
  let totalsOrder = typeof DEFAULT_TOTALS_GRID_ORDER !== "undefined" ? DEFAULT_TOTALS_GRID_ORDER.slice() : [];
  try {
    const layoutDoc = await db.collection("settings").doc("printLayout").get();
    if (layoutDoc.exists) {
      const ld = layoutDoc.data();
      if (ld.detailsGridOrder) detailsOrder = ld.detailsGridOrder;
      if (ld.totalsGridOrder) totalsOrder = ld.totalsGridOrder;
    }
  } catch (e) {
    console.warn("PDF: could not load print layout order, using default", e);
  }

  // ---------- Header ----------
  const profile = window.companyProfile || {};
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  await valueText(profile.name || "MandiBook", mx, y, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const headerRight = [];
  if (profile.address) headerRight.push(profile.address);
  if (profile.phone) headerRight.push("Ph: " + profile.phone);
  if (profile.gst) headerRight.push("GST: " + profile.gst);
  headerRight.forEach((line, i) => doc.text(line, pageW - mx, y - 5 + i * 4, { align: "right" }));
  y += 5;
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.4);
  doc.line(mx, y, pageW - mx, y);
  y += 8;

  // ---------- Serial No / Date ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(String(billData["Serial No"] || ""), mx, y);
  doc.text(String(billData["Date"] || ""), pageW - mx, y, { align: "right" });
  y += 9;

  // ---------- Customer detail lines ----------
  doc.setFont("helvetica", "normal");
  const detailRows = [
    ["naam", billData["Customer Name"]],
    ["gaam", billData["Village"]],
    ["gaadi_no", billData["Vehicle No"]],
    ["dalaal", billData["Broker"]],
  ];
  for (const [key, val] of detailRows) {
    if (!val) continue;
    ensureSpace(7);
    const lw = imgOnBaseline(key, mx, y, 4.3);
    await valueText(val, mx + lw + 2.5, y, 11);
    y += 6.5;
  }
  y += 3;

  // ---------- Weight / deductions section (a clean label-left, value-right
  // list, in the order saved under Settings → Print Layout Order) ----------
  function weightRow(labelKey, valueStr, opts) {
    opts = opts || {};
    ensureSpace(opts.big ? 10 : 7.5);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.big ? 15 : 11);
    imgOnBaseline(labelKey, mx, y, opts.big ? 5.2 : 4.2);
    doc.text(valueStr, pageW - mx, y, { align: "right" });
    y += opts.big ? 9.5 : 7;
  }

  const wbMoistureKg = billData["Weighbridge Moisture Kg"] || 0;
  const hasWbMoisture = wbMoistureKg > 0;
  const weightDeds = (billData["TemplateDeductionsApplied"] || []).filter((d) => d.stage === "weight");

  ensureSpace(10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setDrawColor(210, 210, 210);
  doc.text("Weight / Deductions", mx, y);
  y += 6;

  for (const key of detailsOrder) {
    if (key === "weighbridge_box") {
      weightRow("weighbridge", inr(billData["Weighbridge Weight"]));
    } else if (key === "kasar_box" && (billData["Kasar"] || 0) > 0) {
      weightRow("kasar", "-" + inr(billData["Kasar"]));
    } else if (key === "wb_moisture_box" && hasWbMoisture) {
      weightRow("moisture", `-${inr(wbMoistureKg)} (${billData["Weighbridge Moisture %"] || 0}%)`);
    } else if (key === "kantan_box" && (billData["Kantan Weight"] || 0) > 0) {
      weightRow("kantan", "-" + inr(billData["Kantan Weight"]));
    } else if (key === "plastic_box" && (billData["Plastic Weight"] || 0) > 0) {
      const isOldBardan = !(billData["Kantan Weight"] > 0) && (billData["Bardan Weight"] || 0) > 0;
      weightRow(isOldBardan ? "bardan" : "plastic", "-" + inr(billData["Plastic Weight"] || billData["Bardan Weight"]));
    } else if (key === "template_deductions_weight") {
      for (const d of weightDeds) {
        ensureSpace(7.5);
        const sign = d.applyAs === "add" ? "+" : "-";
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        await valueText(d.name, mx, y, 11);
        doc.text(`${sign}${inr(d.impact)}`, pageW - mx, y, { align: "right" });
        y += 7;
      }
    } else if (key === "netweight_box") {
      y += 1.5;
      ensureSpace(11);
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.3);
      doc.line(mx, y - 4.5, pageW - mx, y - 4.5);
      weightRow("netweight", inr(billData["Net Weight"]) + " kg", { big: true, bold: true });
    }
  }

  // Total moisture cut summary (Loose-supply vakal moisture)
  const anyVakalMoisture = [1, 2, 3, 4, 5].some((i) => (billData[`Vakal ${i} Moisture %`] || 0) > 0);
  if (anyVakalMoisture) {
    const totalMoistureKg = [1, 2, 3, 4, 5].reduce((s, i) => s + (billData[`Vakal ${i} Moisture Kg`] || 0), 0);
    ensureSpace(8);
    doc.setTextColor(180, 100, 0);
    weightRow("total_moisture_cut", "-" + inr(totalMoistureKg) + " kg");
    doc.setTextColor(20, 20, 20);
  }
  y += 4;

  // ---------- Vakal items table ----------
  const activeVakals = [];
  for (let i = 1; i <= 5; i++) {
    const katta = billData[`Vakal ${i} Katta`];
    const kilo = billData[`Vakal ${i} Kilo`];
    if (billData["Bill Type"] === "Loose") {
      if (i === 1) activeVakals.push(i);
    } else if ((katta && katta !== 0) || (kilo && kilo !== 0) || i === 1) {
      activeVakals.push(i);
    }
  }

  const headerKeys = anyVakalMoisture
    ? ["vakal_header", "katta_header", "kilo_header", "moisture", "net_kilo_header", "bhav_header", "rupiya_header"]
    : ["vakal_header", "katta_header", "kilo_header", "bhav_header", "rupiya_header"];
  const vakalLabelKeys = { 1: "vakal_1", 2: "vakal_2", 3: "vakal_3", 4: "vakal_4", 5: "vakal_5" };

  const head = [headerKeys.map(() => "")];
  const body = activeVakals.map((i) => {
    const moisturePct = billData[`Vakal ${i} Moisture %`] || 0;
    const moistureKg = billData[`Vakal ${i} Moisture Kg`] || 0;
    const kiloAfter = billData[`Vakal ${i} Kilo`] || 0;
    const rawKilo = kiloAfter + moistureKg;
    const row = [
      "",
      billData[`Vakal ${i} Katta`] === "-" ? "-" : inr(billData[`Vakal ${i} Katta`]),
      anyVakalMoisture ? inr(rawKilo) : inr(kiloAfter),
    ];
    if (anyVakalMoisture) {
      row.push(moistureKg > 0 ? `-${inr(moistureKg)} (${moisturePct}%)` : "-");
      row.push(inr(kiloAfter));
    }
    row.push(inr(billData[`Vakal ${i} Bhav`]));
    row.push(inr(billData[`Vakal ${i} Amount`]));
    return row;
  });

  ensureSpace(20);
  doc.autoTable({
    startY: y,
    head,
    body,
    margin: { left: mx, right: mx },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 2.2, valign: "middle", lineColor: [180, 180, 180] },
    headStyles: { fillColor: [235, 240, 245], minCellHeight: 9 },
    columnStyles: { 0: { cellWidth: 22 } },
    didParseCell: (data) => {
      if (data.section === "head") data.cell.text = [""];
      if (data.section === "body" && data.column.index === 0) data.cell.text = [""];
    },
    didDrawCell: (data) => {
      const cx = data.cell.x + data.cell.width / 2;
      const cy = data.cell.y + data.cell.height / 2;
      const hMM = Math.min(data.cell.height - 3, 4.2);
      if (data.section === "head") {
        const key = headerKeys[data.column.index];
        const l = L[key];
        if (l) {
          const w = hMM * l.ratio;
          doc.addImage(l.img, "PNG", cx - w / 2, cy - hMM / 2, w, hMM);
        }
      } else if (data.section === "body" && data.column.index === 0) {
        const rowIdx = activeVakals[data.row.index];
        const key = vakalLabelKeys[rowIdx];
        const l = L[key];
        if (l) {
          const w = hMM * l.ratio;
          doc.addImage(l.img, "PNG", cx - w / 2, cy - hMM / 2, w, hMM);
        }
      }
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ---------- Supply type banner ----------
  ensureSpace(12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  if (billData["Bill Type"] === "Loose") {
    const w = 6 * (L.loose ? L.loose.ratio : 1);
    img("loose", pageW / 2 - w / 2, y - 5, 6);
  } else {
    const productName = billData["ProductTemplate"] || "";
    const suffixKey = productName ? "na_katta_suffix" : "katta_header";
    if (productName) {
      doc.setFontSize(15);
      const nameWidth = doc.getTextWidth(productName);
      const suffixW = 5 * (L[suffixKey] ? L[suffixKey].ratio : 1);
      const totalW = nameWidth + 2 + suffixW;
      let sx = pageW / 2 - totalW / 2;
      await valueText(productName, sx, y, 15);
      sx += nameWidth + 2;
      img(suffixKey, sx, y - 4, 5);
    } else {
      const w = 5 * (L.katta_header ? L.katta_header.ratio : 1);
      img("katta_header", pageW / 2 - w / 2, y - 4, 5);
    }
  }
  y += 10;

  // ---------- Bag count summary (Bag-type bills only) ----------
  if (billData["Bill Type"] === "Bag") {
    const totalBharela = (billData["Bharela 600"] || 0) + (billData["Bharela 200"] || 0);
    const totalKhali = (billData["Khali 600"] || 0) + (billData["Khali 200"] || 0);
    const grandTotal = totalBharela + totalKhali;
    if (grandTotal > 0) {
      ensureSpace(8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      let x = mx;
      doc.text(String(totalBharela) + " (", x, y);
      x += doc.getTextWidth(String(totalBharela) + " (");
      x += img("bharela_word", x, y - 3.5, 4);
      doc.text(") + " + String(totalKhali) + " (", x, y);
      x += doc.getTextWidth(") + " + String(totalKhali) + " (");
      x += img("khali_word", x, y - 3.5, 4);
      doc.text(") = " + String(grandTotal) + " (", x, y);
      x += doc.getTextWidth(") = " + String(grandTotal) + " (");
      x += img("kul_word", x, y - 3.5, 4);
      doc.text(")", x, y);
      y += 8;
    }
  }
  y += 2;

  // ---------- Totals / deductions section ----------
  function totalsRow(labelKey, valueStr, opts) {
    opts = opts || {};
    ensureSpace(opts.big ? 12 : 8);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.big ? 16 : 11.5);
    if (opts.big) {
      doc.setFillColor(240, 244, 248);
      doc.rect(mx, y - 6.5, pageW - mx * 2, 10, "F");
    }
    imgOnBaseline(labelKey, mx + (opts.big ? 3 : 0), y, opts.big ? 5.6 : 4.4);
    doc.text(valueStr, pageW - mx - (opts.big ? 3 : 0), y, { align: "right" });
    y += opts.big ? 10 : 7.5;
  }

  ensureSpace(10);
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.4);
  doc.line(mx, y, pageW - mx, y);
  y += 8;

  const amountDeds = (billData["TemplateDeductionsApplied"] || []).filter((d) => d.stage !== "weight");
  const expenses = (() => {
    try {
      return JSON.parse(billData["Expenses"] || "[]");
    } catch (e) {
      return [];
    }
  })();

  for (const key of totalsOrder) {
    if (key === "total_amount_box") {
      totalsRow("total_rupiya", "Rs " + inr(billData["Total Amount"]));
    } else if (key === "utrai_box" && (billData["Utrāī"] || 0) > 0) {
      totalsRow("utrai", "-Rs " + inr(billData["Utrāī"]));
    } else if (key === "expenses_container") {
      for (const exp of expenses) {
        ensureSpace(8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11.5);
        await valueText(exp.name, mx, y, 11.5);
        doc.text("-Rs " + inr(exp.amount), pageW - mx, y, { align: "right" });
        y += 7.5;
      }
    } else if (key === "template_deductions_amount") {
      for (const d of amountDeds) {
        ensureSpace(8);
        const sign = d.applyAs === "add" ? "+" : "-";
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11.5);
        await valueText(d.name, mx, y, 11.5);
        doc.text(`${sign}Rs ${inr(d.impact)}`, pageW - mx, y, { align: "right" });
        y += 7.5;
      }
    } else if (key === "freight_item" && (billData["Truck Freight"] || 0) > 0) {
      totalsRow("freight", "+Rs " + inr(billData["Truck Freight"]));
    } else if (key === "final_total_box_container") {
      y += 2;
      totalsRow("final_total", "Rs " + inr(billData["Final Total"]), { big: true, bold: true });
    } else if (key === "broker_box" && billData["Broker"]) {
      y += 6;
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.text(
        `Broker: ${billData["Broker"]} - Commission: Rs ${Number(billData["BrokerCommission"] || 0).toLocaleString(
          "en-IN"
        )}`,
        mx,
        y
      );
      y += 6;
    }
  }
  y += 4;

  // ---------- Amount in words ----------
  if (typeof numberToWords === "function") {
    ensureSpace(9);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("Amount in words: " + numberToWords(billData["Final Total"]), mx, y);
    y += 8;
  }

  // ---------- Remarks ----------
  if (billData["Remarks"] && billData["Remarks"].trim() !== "") {
    ensureSpace(14);
    doc.setDrawColor(200, 180, 100);
    doc.setLineWidth(0.3);
    doc.rect(mx, y - 5, pageW - mx * 2, 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Remarks:", mx + 3, y);
    doc.setFont("helvetica", "normal");
    await valueText(billData["Remarks"], mx + 22, y, 10);
    y += 12;
  }

  // ---------- Footer ----------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("Computer generated bill — MandiBook", mx, pageH - 8);

  return doc;
}

function downloadBillAsPDF() {
  const billData = JSON.parse(localStorage.getItem("currentBill"));
  if (!billData) {
    alert("No bill data found to download.");
    return;
  }
  const billNo = billData["Serial No"];
  const billName = billData["Customer Name"];
  showLoading("Preparing PDF...");

  buildBillPDFNative(billData)
    .then((doc) => {
      doc.save(`Bill No ${billNo}_${billName}.pdf`);
      hideLoading();
    })
    .catch((err) => {
      console.error("Native PDF generation failed, falling back to screenshot PDF:", err);
      downloadBillAsPDF_screenshotFallback(billData);
    });
}

// Kept as a safety-net fallback only — used automatically if the native
// generator above throws for any reason, so downloads never fully break.
function downloadBillAsPDF_screenshotFallback(billData) {
  const billContainer = document.getElementById("finalcontainer");
  if (!billContainer) {
    alert("Could not generate PDF.");
    hideLoading();
    return;
  }
  const billNo = billData["Serial No"];
  const billName = billData["Customer Name"];

  document.body.classList.add("print-mode");
  if (window.getSelection) window.getSelection().removeAllRanges();
  const buttonContainer = billContainer.querySelector(".button-container");
  if (buttonContainer) buttonContainer.style.display = "none";

  setTimeout(() => {
    html2canvas(billContainer, { scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL("image/jpeg", 0.8);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(imgData);
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Bill No ${billNo}_${billName}.pdf`);
      document.body.classList.remove("print-mode");
      if (buttonContainer) buttonContainer.style.display = "flex";
      hideLoading();
    });
  }, 100);
}

/**
 * PHASE 1 — Universal Print Engine (checklist items #2 and #6).
 * The single-bill print flow (final.html / download.html) prints the live
 * DOM directly via window.print() + print.css — it does NOT go through
 * generateBillHtmlForView()/generateUniversalBillHTML() (those are only used
 * for the multi-bill print modal and WhatsApp prep). So for THIS print path,
 * we inject the same two things directly into the live page right before
 * printing:
 *   1. A dynamic @page size override (A4 if >8 rows, else A5 — matches
 *      print.css's default A5 unless overridden here)
 *   2. An "Amount in words" line at the bottom of the bill (legal requirement)
 */
function applyUniversalPrintSettings(container) {
  let billData = {};
  try {
    billData = JSON.parse(localStorage.getItem("currentBill")) || {};
  } catch (e) {
    console.warn("applyUniversalPrintSettings: could not read currentBill from localStorage", e);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Content-weight count for page-size decision. BUG FIX: this used to only
  // count vakal rows + expenses, completely ignoring Template Deductions
  // (Admixture/GST/etc.), Weighbridge Moisture, and Remarks — all of which
  // take real vertical space on the printed bill. A bill with only 4-5 vakal
  // rows but 3 template deductions + moisture + remarks was being forced
  // onto A5 and overflowing to a 2nd page. Now every content block that
  // takes up its own line/box is counted, with heavier blocks weighted more.
  // ═══════════════════════════════════════════════════════════════════════
  let vakalRowCount = 0;
  if (billData["Bill Type"] === "Loose") {
    vakalRowCount = 1;
  } else {
    for (let i = 1; i <= 5; i++) {
      if ((billData[`Vakal ${i} Katta`] || 0) > 0 || (billData[`Vakal ${i} Kilo`] || 0) > 0) vakalRowCount++;
    }
  }
  let expenseRowCount = 0;
  if (billData["Expenses"]) {
    try {
      expenseRowCount = (JSON.parse(billData["Expenses"]) || []).length;
    } catch (e) {
      expenseRowCount = 0;
    }
  }
  // Template deductions (Admixture, GST, marji, etc.) — each is its own
  // bordered box, so weighted heavier (1.5) than a plain table row.
  const templateDeductionCount = (billData["TemplateDeductionsApplied"] || []).length;
  // Weighbridge Moisture box — only present/relevant if it was actually deducted
  const hasWeighbridgeMoisture = (billData["Weighbridge Moisture Kg"] || 0) > 0 ? 1 : 0;
  // Remarks — unpredictable length, weighted heavier (2) as a safety margin
  const hasRemarks = billData["Remarks"] && billData["Remarks"].trim() !== "" ? 2 : 0;

  const totalWeight =
    vakalRowCount + expenseRowCount + templateDeductionCount * 1.5 + hasWeighbridgeMoisture + hasRemarks;

  const pageSize = totalWeight > 6 ? "A4" : "A5";

  // Inject/update the dynamic @page size — this <style> tag is added AFTER
  // print.css in the DOM, so its @page size wins the cascade over print.css's
  // hardcoded "size: A5 portrait".
  let sizeStyle = document.getElementById("dynamic-print-size");
  if (!sizeStyle) {
    sizeStyle = document.createElement("style");
    sizeStyle.id = "dynamic-print-size";
    document.head.appendChild(sizeStyle);
  }
  sizeStyle.textContent = `@media print {
    @page { size: ${pageSize} portrait; margin: ${pageSize === "A4" ? "10mm" : "0.5cm"}; }
    tr { page-break-inside: avoid; break-inside: avoid; }
  }`;

  // Inject/update the amount-in-words footer inside the bill container
  if (container) {
    let wordsEl = container.querySelector(".amount-in-words");
    if (!wordsEl) {
      wordsEl = document.createElement("div");
      wordsEl.className = "amount-in-words";
      wordsEl.style.cssText =
        "font-size:7.5pt;font-style:italic;color:#333;border-top:1px dashed #aaa;padding-top:3px;margin-top:3px;";
      container.appendChild(wordsEl);
    }
    const amountInWords = typeof numberToWords === "function" ? numberToWords(billData["Final Total"]) : "";
    wordsEl.textContent = amountInWords ? `Amount in words: ${amountInWords}` : "";
  }
}

/**
 * Toggles the print options dropdown menu (Original / Duplicate / Both).
 */
function togglePrintMenu() {
  const menu = document.getElementById("print-menu");
  if (!menu) {
    prepareAndPrint("both");
    return;
  } // fallback for older pages
  menu.style.display = menu.style.display === "block" ? "none" : "block";
}

// Close the print menu if user clicks elsewhere
document.addEventListener("click", (e) => {
  const wrap = document.querySelector(".print-dropdown-wrap");
  const menu = document.getElementById("print-menu");
  if (wrap && menu && !wrap.contains(e.target)) menu.style.display = "none";
});

/**
 * Prepares the bill container for printing and triggers window.print().
 * Phase 2: Supports choosing which copy to print (Original / Duplicate / Both).
 * Since the page only contains one bill container, a second "Duplicate"
 * copy is cloned dynamically right before printing, then removed after.
 * @param {string} copyType - "original" | "duplicate" | "both" (default)
 */
function prepareAndPrint(copyType = "both") {
  const menu = document.getElementById("print-menu");
  if (menu) menu.style.display = "none";

  const original = document.getElementById("finalcontainer");
  if (!original) {
    window.print();
    return;
  }

  // Universal Print Engine: dynamic A4/A5 sizing + amount-in-words footer.
  // Must run BEFORE the clone below so the "both copies" clone inherits it too.
  applyUniversalPrintSettings(original);

  // Clean up any leftover clone from a previous print
  const existingClone = document.getElementById("finalcontainer-duplicate");
  if (existingClone) existingClone.remove();

  if (copyType === "duplicate") {
    // Single copy printed, but labeled "Duplicate"
    original.id = "container-copy";
  } else {
    original.id = "container-original";
  }

  if (copyType === "both") {
    // Clone the bill as the "Duplicate" copy and insert it right after
    const clone = original.cloneNode(true);
    clone.id = "container-copy";
    original.insertAdjacentElement("afterend", clone);
  }

  setTimeout(() => {
    window.print();
    // Cleanup the cloned duplicate after the print dialog closes
    setTimeout(() => {
      const clone = document.getElementById("container-copy");
      if (clone && copyType === "both") clone.remove();
      original.id = "finalcontainer";
    }, 500);
  }, 10);
}

// MOVED to core-engine.js — fetchSettings() is a shared utility, now loaded
// on this page via core-engine.js.
// Check karo ki page modal ke andar iframe mein khula hai ya nahi
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("embed") === "true") {
  window.addEventListener("DOMContentLoaded", () => {
    const btnContainer = document.querySelector(".button-container");
    if (btnContainer) {
      Array.from(btnContainer.children).forEach((btn) => {
        const text = btn.innerText.toLowerCase();

        // Check karo ki button PDF, Print ya WhatsApp ka hai ya nahi
        const isPdf = text.includes("pdf");
        const isPrint = text.includes("print") || text.includes("પ્રિન્ટ");
        const isWhatsapp = text.includes("whatsapp") || text.includes("whp");

        // Agar in teeno mein se kuch bhi nahi hai, tabhi hide karo
        if (!isPdf && !isPrint && !isWhatsapp) {
          btn.style.display = "none";
        }
      });
    }
  });
}
