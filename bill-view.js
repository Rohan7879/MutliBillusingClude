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
    savePaymentBtn.addEventListener("click", () => {
      // The primary payment system is now in the ledger.
      // This button can be re-enabled with logic similar to the ledger's savePayment if needed.
      alert("Please use the Customer Ledger to record payments.");
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

    // Case 1: A true "Loose Supply" bill
    if (data["Bill Type"] === "Loose") {
      displayText = "લૂઝ";
    }
    // Case 2: A "Kantan Pack" bag bill
    else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "કંતાન પેક") {
      const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
      displayText = `ઘઉંના કટ્ટા - ${totalBharela} કંતાન પેક`;
    }
    // Case 3: A "Loose" description for a "Bag" bill
    else if (data["Bill Type"] === "Bag" && data["Supply Type"] === "લૂઝ") {
      const totalBharela = (data["Bharela 600"] || 0) + (data["Bharela 200"] || 0);
      displayText = `ઘઉંના કટ્ટા - ${totalBharela} લૂઝ`;
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

  if (data["Truck Freight"] && data["Truck Freight"] > 0) {
    const totalsGrid = document.querySelector(".totals-grid");
    const finalTotalBox = document.querySelector(".final-total-box-container");
    if (totalsGrid && finalTotalBox && !document.getElementById("freight_item")) {
      const freightItem = document.createElement("div");
      freightItem.id = "freight_item";
      freightItem.classList.add("detail-item");
      freightItem.innerHTML = `<span class="detail-label">ટ્રક ભાડું (Freight)</span><span class="detail-value" style="color: #28a745;">+${Number(
        data["Truck Freight"]
      ).toLocaleString("en-IN")}</span>`;
      totalsGrid.insertBefore(freightItem, finalTotalBox);
    }
  }

  hideLoading();
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

function sendBillViaWhatsApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id") || urlParams.get("billId");
  let storedData = localStorage.getItem("currentBill");
  if (!storedData || !billId) {
    alert("Bill data not found. Cannot create share link.");
    return;
  }
  let data = JSON.parse(storedData);
  const customerName = data["Customer Name"];
  const finalTotal = Number(data["Final Total"]).toLocaleString("en-IN");
  const netWeight = Number(data["Net Weight"]).toLocaleString("en-IN");
  let vakalDetails = "";
  if (data["Bill Type"] === "Loose") {
    vakalDetails = `\n- Kilo: ${data["Vakal 1 Kilo"]} kg\n- Price: ₹${data["Vakal 1 Bhav"]}\n- Amount: ₹${Number(
      data["Vakal 1 Amount"]
    ).toLocaleString("en-IN")}`;
  } else {
    for (let i = 1; i <= 5; i++) {
      const kattaValue = data[`Vakal ${i} Katta`];
      if (kattaValue > 0) {
        vakalDetails += `\n*વકલ ${i}:*\n  - Bags: ${kattaValue}\n  - Kilos: ${
          data[`Vakal ${i} Kilo`]
        } kg\n  - Price: ₹${data[`Vakal ${i} Bhav`]}\n  - Amount: ₹${Number(data[`Vakal ${i} Amount`]).toLocaleString(
          "en-IN"
        )}`;
      }
    }
  }
  const downloadLink = `https://ganeshagribilling.web.app/download.html?id=${billId}`; // Assuming this is your deployed app URL
  const message = `Bill No : ${data["Serial No"]}\nનામ (Name) : ${customerName}\nફાઇનલ ટોટલ : ₹${finalTotal}\nનેટ વજન : ${netWeight} kg\n\n*--- Details ---*${vakalDetails}\n\n*Click here to download your bill:*\n${downloadLink}`;
  const encodedMessage = encodeURIComponent(message);
  const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;
  window.open(whatsappUrl, "_blank");
}

function downloadBillAsPDF() {
  const billContainer = document.getElementById("finalcontainer");
  const billData = JSON.parse(localStorage.getItem("currentBill"));
  if (!billData || !billContainer) {
    alert("No bill data or container found to download.");
    return;
  }
  const billNo = billData["Serial No"];
  const billName = billData["Customer Name"];

  document.body.classList.add("print-mode");

  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

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

function prepareAndPrint() {
  setTimeout(() => {
    window.print();
  }, 10);
}

async function fetchSettings() {
  try {
    const settingsDoc = await db.collection("settings").doc("deductions").get();
    if (settingsDoc.exists) {
      globalSettings = settingsDoc.data();
    } else {
      globalSettings = { kasarPercentage: 0.003, kantanWeight: 0.6, plasticWeight: 0.2, utraiPercentage: 7 };
    }
  } catch (error) {
    console.error("Error fetching settings:", error);
  }
}
