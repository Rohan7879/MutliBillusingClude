async function fetchSettings() {
  try {
    const settingsDoc = await db.collection("settings").doc("deductions").get();
    if (settingsDoc.exists) {
      globalSettings = settingsDoc.data();
    } else {
      console.error("Settings document not found. Using default values.");
      globalSettings = {
        kasarPercentage: 0.003,
        kantanWeight: 0.6,
        plasticWeight: 0.2,
        utraiPercentage: 7,
      };
    }
  } catch (error) {
    console.error("Error fetching settings:", error);
  }
}
function displayData(data) {
  showLoading("Loading bill details...");

  // Use a fallback for old bills that don't have DeductionSettings
  const deductionSettings = data.DeductionSettings || {
    kasarPercentage: 0.003,
    kantanWeight: 0.6,
    plasticWeight: 0.2,
    utraiPercentage: 7,
  };

  // This is a helper function inside displayData
  function setValue(id, value) {
    let element = document.getElementById(id);
    if (element) {
      element.innerHTML = formatNumber(value);
    }
  }

  // Find the label for Kasar and update it
  const kasarLabel = document.querySelector("#kasar_box .detail-label");
  if (kasarLabel) {
    const percentage = (deductionSettings.kasarPercentage * 100).toFixed(1);
    kasarLabel.textContent = `કાંટા કસર (${percentage}%)`;
  }

  // Find the label for Bardan and update it
  const bardanLabel = document.querySelector("#bardan_box .detail-label");
  if (bardanLabel) {
    bardanLabel.textContent = `બારદાન વજન(${deductionSettings.kantanWeight}+${deductionSettings.plasticWeight})`;
  }

  // Add the label update for Utrai
  const utraiLabel = document.querySelector("#utrai_box .detail-label");
  if (utraiLabel) {
    utraiLabel.textContent = `ઉતરાઈ (${deductionSettings.utraiPercentage}₹/100kg)`;
  }

  const serialNoElement = document.getElementById("display_serial_no");
  if (serialNoElement) {
    serialNoElement.textContent = data["Serial No"];
  }

  const customerDetailsMapping = {
    display_customer_name: data["Customer Name"],
    display_vehicle_no: data["Vehicle No"],
    display_village: data["Village"],
    display_broker: data["Broker"],
  };
  Object.entries(customerDetailsMapping).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const fieldMapping = {
    display_date: "Date",
    display_weighbridge_weight: "Weighbridge Weight",
    display_kasar: "Kasar",
    display_net_weight: "Net Weight",
    display_total_amount: "Total Amount",
    display_utrai: "Utrāī",
    display_final_total: "Final Total",
  };
  Object.entries(fieldMapping).forEach(([id, key]) => setValue(id, data[key] !== undefined ? data[key] : ""));

  // Handle negative sign formatting
  let kasarValue = data["Kasar"] || 0;
  document.getElementById("display_kasar").textContent = "-" + formatNumber(kasarValue);

  let utraiValue = data["Utrāī"] || 0;
  document.getElementById("display_utrai").textContent = "-" + formatNumber(utraiValue);

  for (let i = 1; i <= 5; i++) {
    setValue(`display_vakal_${i}_katta`, data[`Vakal ${i} Katta`]);
    setValue(`display_vakal_${i}_kilo`, data[`Vakal ${i} Kilo`]);
    setValue(`display_vakal_${i}_bhav`, data[`Vakal ${i} Bhav`]);
    setValue(`display_vakal_${i}_amount`, data[`Vakal ${i} Amount`]);
  }

  const bardanValueElement = document.getElementById("display_bardan_weight");
  if (bardanValueElement) {
    let bardanValue = data["Bardan Weight"] || 0;
    bardanValueElement.textContent = "-" + formatNumber(bardanValue);
  }

  renderExpenses(data);

  // Hide unnecessary rows
  if (data["Bill Type"] === "Loose") {
    document.getElementById("bardan_box").style.display = "none";
    document.querySelectorAll(".optional-vakal").forEach((row) => (row.style.display = "none"));
  } else {
    for (let i = 1; i <= 5; i++) {
      const kattaValue = data[`Vakal ${i} Katta`] || 0;
      const bhavValue = data[`Vakal ${i} Bhav`] || 0;
      const vakalRow = document.getElementById(`vakal_row_${i}`);
      if (vakalRow && kattaValue === 0 && bhavValue === 0) {
        vakalRow.style.display = "none";
      }
    }
  }

  // Setup for printing two copies

  // const originalContainer = document.getElementById("container-original"),
  //   copyContainer = document.getElementById("container-copy");
  // if (originalContainer && copyContainer) {
  //   const contentToCopy = originalContainer.cloneNode(true);
  //   contentToCopy.querySelector(".button-container").remove();
  //   copyContainer.innerHTML = contentToCopy.innerHTML;
  // }

  // If truck freight exists, create and insert a new display box for it
  if (data["Truck Freight"] && data["Truck Freight"] > 0) {
    const totalsGrid = document.querySelector(".totals-grid");
    const finalTotalBox = document.querySelector(".final-total-box-container");

    const freightItem = document.createElement("div");
    freightItem.classList.add("detail-item");
    freightItem.innerHTML = `
      <span class="detail-label">ટ્રક ભાડું (Freight)</span>
      <span class="detail-value" style="color: #28a745;">+${Number(data["Truck Freight"]).toLocaleString(
        "en-IN"
      )}</span>
    `;

    // Insert the new freight box right before the final total box
    if (totalsGrid && finalTotalBox) {
      totalsGrid.insertBefore(freightItem, finalTotalBox);
    }
  }

  hideLoading();
}
function renderExpenses(data) {
  const expensesContainer = document.getElementById("expenses_container");
  if (!expensesContainer) {
    console.error("Expenses container not found.");
    return;
  }
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
      console.error("Error parsing expenses:", e);
      expensesContainer.style.display = "none";
    }
  } else {
    expensesContainer.style.display = "none";
  }
}
function sendBillViaWhatsApp() {
  // --- The Fix Starts Here ---
  // 1. Get the correct Bill ID directly from the URL.
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id") || urlParams.get("billId");
  // 2. Get the rest of the data from localStorage (which was just updated when the page loaded).
  let storedData = localStorage.getItem("currentBill");
  // --- The Fix Ends Here ---

  if (!storedData || !billId) {
    alert("Bill data not found. Cannot create share link.");
    return;
  }
  let data = JSON.parse(storedData);

  const customerName = data["Customer Name"];
  const finalTotal = Number(data["Final Total"]).toLocaleString("en-IN");
  const netWeight = Number(data["Net Weight"]).toLocaleString("en-IN");

  let vakalDetails = "";
  // ... (the rest of your message-building logic is perfect and doesn't need to change) ...
  if (data["Bill Type"] === "Loose") {
    vakalDetails = `\n- Kilo: ${data["Vakal 1 Kilo"]} kg\n- Price: ₹${data["Vakal 1 Bhav"]}\n- Amount: ₹${Number(
      data["Vakal 1 Amount"]
    ).toLocaleString("en-IN")}`;
  } else {
    for (let i = 1; i <= 5; i++) {
      const kattaValue = data[`Vakal ${i} Katta`];
      if (kattaValue > 0) {
        vakalDetails +=
          `\n*વકલ ${i}:*\n` +
          `  - Bags: ${kattaValue}\n` +
          `  - Kilos: ${data[`Vakal ${i} Kilo`]} kg\n` +
          `  - Price: ₹${data[`Vakal ${i} Bhav`]}\n` +
          `  - Amount: ₹${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}`;
      }
    }
  }

  // Use the 'correctBillId' from the URL to build the link
  const downloadLink = `https://ganeshagribilling.web.app/d1j3h2k?billId=${billId}`;

  const message =
    `Bill No : ${data["Serial No"]}\n` +
    `નામ (Name) : ${customerName}\n` +
    `ફાઇનલ ટોટલ : ₹${finalTotal}\n` +
    `નેટ વજન : ${netWeight} kg\n\n` +
    `*--- Details ---*${vakalDetails}\n\n` +
    `*Click here to download your bill:*` +
    `\n${downloadLink}`;

  const encodedMessage = encodeURIComponent(message);
  const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;

  window.open(whatsappUrl, "_blank");
}
async function fetchBillAndDownload(docId) {
  showLoading("Fetching bill details...");
  try {
    const doc = await billsCollection.doc(docId).get();
    if (doc.exists) {
      localStorage.setItem("currentBill", JSON.stringify({ ...doc.data(), id: doc.id }));
      downloadBillAsPDF();
    } else {
      alert("Could not find this bill.");
      hideLoading();
    }
  } catch (error) {
    console.error("Error fetching bill for download:", error);
    alert("Could not load the bill. Please try again.");
    hideLoading();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const billId = urlParams.get("id") || urlParams.get("billId");

  if (billId) {
    fetchBillAndDisplay(billId); // Call a single function to handle everything
  }
});
async function fetchBillAndDisplay(billId) {
  try {
    showLoading("Loading bill details...");
    await fetchSettings(); // Fetch the latest settings

    const doc = await billsCollection.doc(billId).get();
    if (doc.exists) {
      const billData = { ...doc.data(), id: doc.id };
      localStorage.setItem("currentBill", JSON.stringify(billData)); // Still needed for Share/Download buttons
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
function downloadBillAsPDF() {
  showLoading("Generating PDF...");
  const billContainer = document.getElementById("container-original");
  const billData = JSON.parse(localStorage.getItem("currentBill"));

  if (!billData || !billContainer) {
    alert("No bill data or container found to download.");
    hideLoading();
    return;
  }
  const billNo = billData["Serial No"];
  const billName = billData["Customer Name"];

  document.body.classList.add("print-mode");

  const printDetails = billContainer.querySelectorAll(".print-only-details");
  printDetails.forEach((el) => (el.style.display = "block"));
  const buttonContainer = billContainer.querySelector(".button-container");
  if (buttonContainer) {
    buttonContainer.style.display = "none";
  }

  setTimeout(() => {
    html2canvas(billContainer, { scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL("image/jpeg", 0.8);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const canvasAspectRatio = canvas.width / canvas.height;

      let finalWidth = pdfWidth;
      let finalHeight = pdfWidth / canvasAspectRatio;
      if (finalHeight > pdfHeight) {
        finalHeight = pdfHeight;
        finalWidth = pdfHeight * canvasAspectRatio;
      }
      const x = (pdfWidth - finalWidth) / 2;
      const y = (pdfHeight - finalHeight) / 2;

      pdf.addImage(imgData, "JPEG", x, y, finalWidth, finalHeight);
      pdf.save(`Bill No-${billNo}-${billName}.pdf`);

      document.body.classList.remove("print-mode");
      printDetails.forEach((el) => (el.style.display = "none"));
      if (buttonContainer) {
        buttonContainer.style.display = "flex";
      }
      hideLoading();
    });
  }, 100);
}
// In bill-view.js, add this at the bottom

// --- PAYMENT LOGIC ---
document.addEventListener("DOMContentLoaded", () => {
  // This logic needs to be inside the DOMContentLoaded listener
  const recordPaymentBtn = document.getElementById("record_payment_btn");
  const paymentModal = document.getElementById("payment-modal");
  const closePaymentModalBtn = document.getElementById("close-payment-modal-btn");
  const savePaymentBtn = document.getElementById("save-payment-btn");

  if (recordPaymentBtn) {
    recordPaymentBtn.addEventListener("click", () => {
      paymentModal.style.display = "flex";
    });
  }

  if (closePaymentModalBtn) {
    closePaymentModalBtn.addEventListener("click", () => {
      paymentModal.style.display = "none";
    });
  }

  if (savePaymentBtn) {
    savePaymentBtn.addEventListener("click", async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const billId = urlParams.get("id") || urlParams.get("billId");
      const paymentAmount = Number(document.getElementById("payment-amount-input").value);

      if (!billId || isNaN(paymentAmount) || paymentAmount <= 0) {
        Swal.fire("Invalid Input", "Please enter a valid payment amount.", "error");
        return;
      }

      try {
        showLoading("Saving payment...");
        const billRef = billsCollection.doc(billId);
        const doc = await billRef.get();
        if (!doc.exists) throw new Error("Bill not found");

        const billData = doc.data();
        const newAmountPaid = (billData.amountPaid || 0) + paymentAmount;
        const finalTotal = billData["Final Total"];
        let newAmountDue = finalTotal - newAmountPaid;
        let newStatus = "Partially Paid";

        if (newAmountDue <= 0) {
          newAmountDue = 0;
          newStatus = "Paid";
        }

        await billRef.update({
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          paymentStatus: newStatus,
        });

        paymentModal.style.display = "none";
        Swal.fire("Success!", "Payment has been recorded.", "success").then(() => {
          window.location.reload(); // Reload page to show updated status
        });
      } catch (error) {
        console.error("Error saving payment:", error);
        Swal.fire("Error", "Could not save the payment.", "error");
      } finally {
        hideLoading();
      }
    });
  }
});

function prepareAndPrint() {
  const originalContainer = document.getElementById("container-original");
  const copyContainer = document.getElementById("container-copy");

  if (originalContainer && copyContainer) {
    // Copy the content from the original to the duplicate
    copyContainer.innerHTML = originalContainer.innerHTML;
  }

  // Give the browser a moment to render the new content
  setTimeout(() => {
    window.print();
  }, 10);
}
