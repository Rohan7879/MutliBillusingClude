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
  const originalContainer = document.getElementById("container-original"),
    copyContainer = document.getElementById("container-copy");
  if (originalContainer && copyContainer) {
    const contentToCopy = originalContainer.cloneNode(true);
    contentToCopy.querySelector(".button-container").remove();
    copyContainer.innerHTML = contentToCopy.innerHTML;
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

  const idFromParameter_id = urlParams.get("id");

  const idFromParameter_billId = urlParams.get("billId");

  const finalBillId = urlParams.get("id") || urlParams.get("billId");

  if (finalBillId) {
    showLoading("Loading bill details...");
    billsCollection
      .doc(finalBillId)
      .get()
      .then((doc) => {
        if (doc.exists) {
          const billData = { ...doc.data(), id: doc.id };
          localStorage.setItem("currentBill", JSON.stringify(billData));
          displayData(billData);
        } else {
          alert("Error: Bill not found in database.");
          hideLoading();
        }
      });
  } else {
  }
});
function downloadBillAsPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF(); // Create a new PDF document
  const billData = JSON.parse(localStorage.getItem("currentBill"));

  if (!billData) {
    alert("Bill data not found. Please refresh the page.");
    return;
  }

  // --- Add Content to the PDF ---

  // 1. Title
  doc.setFontSize(20);
  doc.text("Final Bill", 105, 20, { align: "center" });

  // 2. Bill Meta Info (Bill No. and Date)
  doc.setFontSize(12);
  doc.text(`Bill No: ${billData["Serial No"]}`, 20, 35);
  doc.text(`Date: ${billData["Date"]}`, 190, 35, { align: "right" });

  // 3. Customer Details
  doc.text(`Name: ${billData["Customer Name"]}`, 20, 45);
  doc.text(`Village: ${billData["Village"]}`, 20, 52);
  doc.text(`Vehicle No: ${billData["Vehicle No"]}`, 190, 45, { align: "right" });
  doc.text(`Broker: ${billData["Broker"]}`, 190, 52, { align: "right" });

  // 4. Prepare the data for the main table
  const tableHead = [["Item", "Bags", "Kilos", "Price", "Amount"]];
  const tableBody = [];

  // Loop through the Vakal items and add them to the table body
  for (let i = 1; i <= 5; i++) {
    if (billData[`Vakal ${i} Katta`] > 0 || billData[`Vakal ${i} Kilo`] > 0) {
      tableBody.push([
        `Vakal ${i}`,
        billData[`Vakal ${i} Katta`],
        billData[`Vakal ${i} Kilo`],
        `₹${billData[`Vakal ${i} Bhav`]}`,
        `₹${Number(billData[`Vakal ${i} Amount`]).toLocaleString("en-IN")}`,
      ]);
    }
  }

  // 5. Add the table to the PDF using the AutoTable plugin
  doc.autoTable({
    head: tableHead,
    body: tableBody,
    startY: 60, // The Y position on the page to start the table
    theme: "grid",
  });

  // Get the Y position of where the table ended
  const finalY = doc.lastAutoTable.finalY;

  // 6. Add the Totals Section below the table
  doc.setFontSize(14);
  doc.text(`Total Amount: ₹${Number(billData["Total Amount"]).toLocaleString("en-IN")}`, 190, finalY + 15, {
    align: "right",
  });
  doc.text(`Unloading (ઉતરાઈ): - ₹${Number(billData["Utrāī"]).toLocaleString("en-IN")}`, 190, finalY + 22, {
    align: "right",
  });

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(`Final Total: ₹${Number(billData["Final Total"]).toLocaleString("en-IN")}`, 190, finalY + 32, {
    align: "right",
  });

  // 7. Save the PDF
  doc.save(`Bill No-${billData["Serial No"]}-${billData["Customer Name"]}.pdf`);
}
