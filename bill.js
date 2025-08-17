// --- FIREBASE SETUP ---
// This should be your actual Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCjYTkXGs8_xVyi9ij7H5AS4Zk1oh1VxzU",
  authDomain: "ganeshagribilling.firebaseapp.com",
  projectId: "ganeshagribilling",
  storageBucket: "ganeshagribilling.firebasestorage.app",
  messagingSenderId: "99624726079",
  appId: "1:99624726079:web:4c5aa1f7341ff40e8cd28a",
  measurementId: "G-3XXY4BCZPL",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const billsCollection = db.collection("bills");

// --- FINAL AND CORRECT LOADING BAR FUNCTIONS ---
function showLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("hidden");
    setTimeout(() => {
      loadingBar.classList.add("active");
    }, 10);
  }
}

function hideLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("active");
    setTimeout(() => {
      loadingBar.classList.add("hidden");
    }, 1500);
  }
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

function generateBillHtmlForView(data) {
  let vakalRows = "";
  if (data["Bill Type"] === "Loose") {
    vakalRows = `<tr><td>Loose Supply</td><td>-</td><td>${data["Vakal 1 Kilo"]}</td><td>${
      data["Vakal 1 Bhav"]
    }</td><td style="font-weight:bolder;">${Number(data["Vakal 1 Amount"]).toLocaleString("en-IN")}</td></tr>`;
  } else {
    for (let i = 1; i <= 5; i++) {
      if (data[`Vakal ${i} Katta`] > 0) {
        vakalRows += `<tr><td>વકલ ${i}</td><td>${data[`Vakal ${i} Katta`]}</td><td>${data[`Vakal ${i} Kilo`]}</td><td>${
          data[`Vakal ${i} Bhav`]
        }</td><td style="font-weight:bolder;">${Number(data[`Vakal ${i} Amount`]).toLocaleString("en-IN")}</td></tr>`;
      }
    }
  }
  const customerDetailsHtml = `<div class="detail-line"><span class="detail-label-enter">નામ :</span><span class="detail-value-line">${data["Customer Name"]}</span><span class="detail-label-enter">ગાડી નં :</span><span class="detail-value-line">${data["Vehicle No"]}</span></div><div class="detail-line"><span class="detail-label-enter">ગામ :</span><span class="detail-value-line">${data["Village"]}</span><span class="detail-label-enter">દલાલ :</span><span class="detail-value-line">${data["Broker"]}</span></div>`;
  return `<div class="container" style="margin:0;box-shadow:none;border:none;"><div class="header"><h1>Final Bill</h1></div><div class="bill-meta"><div class="meta-item"><span>Bill No:</span> <span>${
    data["Serial No"]
  }</span></div><div class="meta-item"><span>Date:</span> <span>${
    data["Date"]
  }</span></div></div><div class="print-only-details" style="display:block;">${customerDetailsHtml}</div><div class="details-grid"><div class="detail-item"><span class="detail-label">વેબ્રીજ વજન</span><span class="detail-value">${
    data["Weighbridge Weight"]
  }</span></div><div class="detail-item"><span class="detail-label">કાંટા કસર</span><span class="detail-value">${
    data["Kasar"]
  }</span></div><div class="detail-item"><span class="detail-label">બારદાન વજન</span><span class="detail-value">${
    data["Bardan Weight"]
  }</span></div><div class="detail-item summary-item"><span class="detail-label">નેટ વજન</span><span class="detail-value" style="font-weight:bolder;">${
    data["Net Weight"]
  }</span></div></div><table class="final-bill-table"><thead><tr><th>વકલ</th><th>કટ્ટા</th><th>કિલો</th><th>ભાવ</th><th>રૂપિયા</th></tr></thead><tbody>${vakalRows}</tbody></table><div class="totals-grid"><div class="detail-item"><span class="detail-label">ટોટલ રૂપિયા</span><span class="detail-value">${Number(
    data["Total Amount"]
  ).toLocaleString(
    "en-IN"
  )}</span></div><div class="detail-item"><span class="detail-label">ઉતરાઈ</span><span class="detail-value">${Number(
    data["Utrāī"]
  ).toLocaleString(
    "en-IN"
  )}</span></div><div class="detail-item final-total-box"><span class="detail-label">ફાઇનલ ટોટલ</span><span class="detail-value" style="font-weight:bolder;">${Number(
    data["Final Total"]
  ).toLocaleString("en-IN")}</span></div></div></div>`;
}
// Replace your existing sendBillViaWhatsApp function with this code
function sendBillViaWhatsApp() {
  let storedData = localStorage.getItem("currentBill");
  if (!storedData) {
    alert("Bill data not found in local storage.");
    return;
  }
  let data = JSON.parse(storedData);

  const customerName = data["Customer Name"];
  const billNo = data["Serial No"];
  const finalTotal = Number(data["Final Total"]).toLocaleString("en-IN");
  const netWeight = Number(data["Net Weight"]).toLocaleString("en-IN");
  const billId = data.id; // Get the unique bill ID from the data

  let vakalDetails = "";
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

  // The link now points to the new download page with the bill's ID
  const downloadLink = `https://ganeshagribilling.web.app/download.html?billId=${billId}`;

  const message =
    `Bill No : ${billNo}\n` +
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
// Add this new function to bill.js
async function fetchBillAndDownload(docId) {
  showLoading("Fetching bill details...");
  try {
    const doc = await billsCollection.doc(docId).get();
    if (doc.exists) {
      // Save the fetched data to local storage so the download function can use it
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
// Enable offline persistence
db.enablePersistence().catch((err) => {
  if (err.code == "failed-precondition") {
    // Multiple tabs open, persistence can only be enabled in one.
  } else if (err.code == "unimplemented") {
    // The current browser does not support all of the features required to enable persistence
  }
});

// --- GLOBAL SCRIPT LOGIC ---
let globalSettings = {};

/**
 * Fetches the configurable settings (deduction percentages) from Firebase
 * and populates the globalSettings object.
 */
async function fetchSettings() {
  try {
    const settingsDoc = await db.collection("settings").doc("deductions").get();
    if (settingsDoc.exists) {
      globalSettings = settingsDoc.data();
    } else {
      console.error("Settings document not found. Using default values.");
      // Fallback to default values if the document doesn't exist
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

document.addEventListener("DOMContentLoaded", async function () {
  await fetchSettings(); // Wait for settings to be fetched

  // Now that settings are loaded, proceed with the rest of the logic.
  if (document.getElementById("estimateForm")) {
    initializeIndexPage();
  } else if (document.getElementById("container-original")) {
    displayData();
  }
});

function formatNumber(num) {
  if (isNaN(num) || num === "") {
    return num;
  }
  return Number(num).toLocaleString("en-IN");
}

// --- INDEX.HTML PAGE FUNCTIONS ---

function initializeIndexPage() {
  addExpense();
  const toggle = document.getElementById("loose_supply_toggle");
  if (toggle) {
    toggle.addEventListener("change", function (event) {
      const isLoose = event.target.checked;
      document.getElementById("loose_supply_section").style.display = isLoose ? "table-row-group" : "none";
      document.getElementById("bag_supply_section").style.display = isLoose ? "none" : "table-row-group";
      document.getElementById("vakal_section").style.display = isLoose ? "none" : "table-row-group";
      document.getElementById("loose_price_input").required = isLoose;
    });
  }

  const form = document.getElementById("estimateForm");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const isEditMode = form.dataset.editId;
    if (isEditMode) {
      updateData(isEditMode);
    } else {
      collectData();
    }
  });

  // Check for edit data on page load
  const editData = localStorage.getItem("editBillData");
  if (editData) {
    populateFormForEdit(JSON.parse(editData));
    localStorage.removeItem("editBillData");
  }
}

function populateFormForEdit(data) {
  const form = document.getElementById("estimateForm");
  form.dataset.editId = data.id;

  document.querySelector('input[name="customer_name"]').value = data["Customer Name"];
  document.querySelector('input[name="vehicle_no"]').value = data["Vehicle No"];
  document.querySelector('input[name="village"]').value = data["Village"];
  document.querySelector('input[name="broker"]').value = data["Broker"];
  document.querySelector('input[name="weighbridge_weight"]').value = data["Weighbridge Weight"];

  if (data["Bill Type"] === "Loose") {
    document.getElementById("loose_supply_toggle").checked = true;
    document.getElementById("loose_supply_toggle").dispatchEvent(new Event("change"));
    document.querySelector('input[name="loose_price"]').value = data["Vakal 1 Bhav"];
  } else {
    document.getElementById("loose_supply_toggle").checked = false;
    document.getElementById("loose_supply_toggle").dispatchEvent(new Event("change"));

    // This part requires mapping from the stored data to the form fields
    // This is a simplified example, you might need to adjust it
    // document.querySelector('input[name="bharela_600"]').value = ...;
    // document.querySelector('input[name="khali_600"]').value = ...;
    // ...
  }

  // Expenses logic
  const expenses = JSON.parse(data["Expenses"]);
  const expenseList = document.getElementById("expense_list");
  expenseList.innerHTML = ""; // Clear existing expense rows
  expenses.forEach((exp) => {
    addExpense(exp.name, exp.amount);
  });

  document.querySelector('button[type="submit"]').textContent = "Update Bill";
}

function addExpense(name = "", amount = "") {
  const expenseList = document.getElementById("expense_list");
  if (!expenseList) return;
  const newRow = document.createElement("div");
  newRow.classList.add("expense-row");
  newRow.innerHTML = `
        <input type="text" name="expense_name" placeholder="ખર્ચનું નામ (Expense Name)" value="${name}">
        <input type="number" name="expense_amount" placeholder="રકમ (Amount)" value="${amount}">
        <button type="button" class="remove-expense-btn" onclick="this.parentElement.remove()">Remove</button>
    `;
  expenseList.appendChild(newRow);
}

function customRound(num) {
  let decimal = num - Math.floor(num);
  return decimal > 0.5 ? Math.ceil(num) : Math.floor(num);
}

// --- DATA HANDLING (FIREBASE) ---

// Replace your existing collectData function with this code
async function collectData() {
  showLoading();
  const form = document.getElementById("estimateForm");
  const formData = new FormData(form);
  let data = {};

  const counterRef = db.collection("counters").doc("billCounter");

  try {
    const newSerialNo = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      if (!counterDoc.exists) {
        throw "Document does not exist!";
      }

      const newCounterValue = counterDoc.data().currentNumber + 1;
      transaction.update(counterRef, { currentNumber: newCounterValue });
      return newCounterValue;
    });

    data["Serial No"] = newSerialNo;
    data["Customer Name"] = formData.get("customer_name");
    data["Vehicle No"] = formData.get("vehicle_no");
    data["Village"] = formData.get("village");
    data["Broker"] = formData.get("broker");

    // --- (rest of the data collection logic remains the same) ---
    const isLooseSupply = formData.get("is_loose_supply") !== null;
    const deductKantan = formData.get("deduct_kantan") !== null;
    const deductPlastic = formData.get("deduct_plastic") !== null;
    const deductUtrai = formData.get("deduct_utrai") !== null;

    let expenses = [];
    const expenseRows = document.querySelectorAll(".expense-row");
    expenseRows.forEach((row) => {
      const name = row.querySelector(`input[name^="expense_name"]`).value;
      const amount = Number(row.querySelector(`input[name^="expense_amount"]`).value);
      if (name && amount > 0) {
        expenses.push({ name, amount });
      }
    });
    data["Expenses"] = JSON.stringify(expenses);

    let net_vajan = 0,
      total = 0,
      finalutrai = 0;

    if (isLooseSupply) {
      data["Bill Type"] = "Loose";
      const weight = Number(formData.get("weighbridge_weight")) || 0;
      const price = Number(formData.get("loose_price")) || 0;
      const katta_kasar = customRound(weight * globalSettings.kasarPercentage);
      net_vajan = customRound(weight - katta_kasar);
      total = customRound((net_vajan / 20) * price);

      data["Weighbridge Weight"] = weight;
      data["Kasar"] = katta_kasar;
      data["Bardan Weight"] = 0;
      data["Vakal 1 Katta"] = "-";
      data["Vakal 1 Kilo"] = net_vajan;
      data["Vakal 1 Bhav"] = price;
      data["Vakal 1 Amount"] = total;
      for (let i = 2; i <= 5; i++) {
        data[`Vakal ${i} Katta`] = 0;
        data[`Vakal ${i} Kilo`] = 0;
        data[`Vakal ${i} Bhav`] = 0;
        data[`Vakal ${i} Amount`] = 0;
      }
    } else {
      data["Bill Type"] = "Bag";
      let formValues = {};
      formData.forEach((value, key) => {
        formValues[key] = value;
      });

      let {
        weighbridge_weight,
        bharela_600,
        khali_600,
        bharela_200,
        khali_200,
        vakal_1_katta,
        vakal_1_bhav,
        vakal_2_katta,
        vakal_2_bhav,
        vakal_3_katta,
        vakal_3_bhav,
        vakal_4_katta,
        vakal_4_bhav,
        vakal_5_katta,
        vakal_5_bhav,
      } = formValues;

      weighbridge_weight = Number(weighbridge_weight) || 0;
      bharela_600 = Number(bharela_600) || 0;
      khali_600 = Number(khali_600) || 0;
      bharela_200 = Number(bharela_200) || 0;
      khali_200 = Number(khali_200) || 0;

      let bharela = bharela_600 + bharela_200;
      let bardanWeightKantan = deductKantan ? customRound((bharela_600 + khali_600) * globalSettings.kantanWeight) : 0;
      let bardanWeightPlastic = deductPlastic
        ? customRound((bharela_200 + khali_200) * globalSettings.plasticWeight)
        : 0;
      let Bardan = bardanWeightKantan + bardanWeightPlastic;
      let katta_kasar = customRound(weighbridge_weight * globalSettings.kasarPercentage);
      net_vajan = customRound(weighbridge_weight - katta_kasar - Bardan);

      data["Weighbridge Weight"] = weighbridge_weight;
      data["Kasar"] = katta_kasar;
      data["Bardan Weight"] = Bardan;

      const vakals = [
        { katta: Number(vakal_1_katta) || 0, bhav: Number(vakal_1_bhav) || 0 },
        { katta: Number(vakal_2_katta) || 0, bhav: Number(vakal_2_bhav) || 0 },
        { katta: Number(vakal_3_katta) || 0, bhav: Number(vakal_3_bhav) || 0 },
        { katta: Number(vakal_4_katta) || 0, bhav: Number(vakal_4_bhav) || 0 },
        { katta: Number(vakal_5_katta) || 0, bhav: Number(vakal_5_bhav) || 0 },
      ];

      let perUnitWeight = bharela ? net_vajan / bharela : 0;
      let calculatedKilosSum = 0;
      let lastActiveVakalIndex = vakals.map((v) => v.katta > 0).lastIndexOf(true);

      for (let i = 0; i < vakals.length; i++) {
        let kilo = 0;
        if (vakals[i].katta > 0) {
          if (i === lastActiveVakalIndex) {
            kilo = net_vajan - calculatedKilosSum;
          } else {
            kilo = customRound(perUnitWeight * vakals[i].katta);
            calculatedKilosSum += kilo;
          }
        }
        data[`Vakal ${i + 1} Katta`] = vakals[i].katta;
        data[`Vakal ${i + 1} Kilo`] = kilo;
        data[`Vakal ${i + 1} Bhav`] = vakals[i].bhav;
        const amount = customRound((kilo / 20) * vakals[i].bhav);
        data[`Vakal ${i + 1} Amount`] = amount;
        total += amount;
      }
    }

    if (deductUtrai) {
      let utrai_base = customRound((net_vajan / 100) * globalSettings.utraiPercentage);
      let diff = (total % 10) - (utrai_base % 10);
      if (diff > 5) finalutrai = utrai_base + diff - 10;
      else if (diff < -5) finalutrai = utrai_base + diff + 10;
      else if (diff === 5 || diff === -5) finalutrai = utrai_base - 5;
      else finalutrai = utrai_base + diff;
    }

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const finaltotal = total - finalutrai - totalExpenses;

    const now = new Date();
    data["Date"] = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}/${now.getFullYear()}`;
    data["Net Weight"] = net_vajan;
    data["Total Amount"] = total;
    data["Utrāī"] = finalutrai;
    data["Final Total"] = finaltotal;
    // --- Store the deduction settings with the bill ---
    data["DeductionSettings"] = {
      kasarPercentage: globalSettings.kasarPercentage,
      kantanWeight: globalSettings.kantanWeight,
      plasticWeight: globalSettings.plasticWeight,
      utraiPercentage: globalSettings.utraiPercentage,
    };
    // --- END OF NEW CODE ---

    // NEW: Capture the ID of the new document and add it to the data
    const docRef = await billsCollection.add(data);
    localStorage.setItem("currentBill", JSON.stringify({ ...data, id: docRef.id }));
    window.location.href = "final.html";
  } catch (error) {
    console.error("Transaction failed or error adding document: ", error);
    alert("Could not save the bill. Please try again.");
  } finally {
    hideLoading();
  }
}
// NEW: Function to update an existing bill
async function updateData(docId) {
  showLoading("Updating bill...");
  const form = document.getElementById("estimateForm");
  const formData = new FormData(form);
  let data = {};

  const billRef = billsCollection.doc(docId);
  try {
    const existingBill = await billRef.get();
    if (!existingBill.exists) {
      alert("Bill not found.");
      return;
    }
    const existingData = existingBill.data();

    data["Customer Name"] = formData.get("customer_name");
    data["Vehicle No"] = formData.get("vehicle_no");
    data["Village"] = formData.get("village");
    data["Broker"] = formData.get("broker");

    const isLooseSupply = formData.get("is_loose_supply") !== null;
    const deductKantan = formData.get("deduct_kantan") !== null;
    const deductPlastic = formData.get("deduct_plastic") !== null;
    const deductUtrai = formData.get("deduct_utrai") !== null;

    let expenses = [];
    const expenseRows = document.querySelectorAll(".expense-row");
    expenseRows.forEach((row) => {
      // The typo is corrected here
      const name = row.querySelector(`input[name^="expense_name"]`).value;
      const amount = Number(row.querySelector(`input[name^="expense_amount"]`).value);
      if (name && amount > 0) {
        expenses.push({ name, amount });
      }
    });
    data["Expenses"] = JSON.stringify(expenses);

    let net_vajan = 0,
      total = 0,
      finalutrai = 0;

    if (isLooseSupply) {
      data["Bill Type"] = "Loose";
      const weight = Number(formData.get("weighbridge_weight")) || 0;
      const price = Number(formData.get("loose_price")) || 0;
      const katta_kasar = customRound(weight * globalSettings.kasarPercentage);
      net_vajan = customRound(weight - katta_kasar);
      total = customRound((net_vajan / 20) * price);

      data["Weighbridge Weight"] = weight;
      data["Kasar"] = katta_kasar;
      data["Bardan Weight"] = 0;
      data["Vakal 1 Katta"] = "-";
      data["Vakal 1 Kilo"] = net_vajan;
      data["Vakal 1 Bhav"] = price;
      data["Vakal 1 Amount"] = total;
      for (let i = 2; i <= 5; i++) {
        data[`Vakal ${i} Katta`] = 0;
        data[`Vakal ${i} Kilo`] = 0;
        data[`Vakal ${i} Bhav`] = 0;
        data[`Vakal ${i} Amount`] = 0;
      }
    } else {
      data["Bill Type"] = "Bag";
      let formValues = {};
      formData.forEach((value, key) => {
        formValues[key] = value;
      });

      let {
        weighbridge_weight,
        bharela_600,
        khali_600,
        bharela_200,
        khali_200,
        vakal_1_katta,
        vakal_1_bhav,
        vakal_2_katta,
        vakal_2_bhav,
        vakal_3_katta,
        vakal_3_bhav,
        vakal_4_katta,
        vakal_4_bhav,
        vakal_5_katta,
        vakal_5_bhav,
      } = formValues;

      weighbridge_weight = Number(weighbridge_weight) || 0;
      bharela_600 = Number(bharela_600) || 0;
      khali_600 = Number(khali_600) || 0;
      bharela_200 = Number(bharela_200) || 0;
      khali_200 = Number(khali_200) || 0;

      let bharela = bharela_600 + bharela_200;
      let bardanWeightKantan = deductKantan ? customRound((bharela_600 + khali_600) * globalSettings.kantanWeight) : 0;
      let bardanWeightPlastic = deductPlastic
        ? customRound((bharela_200 + khali_200) * globalSettings.plasticWeight)
        : 0;
      let Bardan = bardanWeightKantan + bardanWeightPlastic;
      let katta_kasar = customRound(weighbridge_weight * globalSettings.kasarPercentage);
      net_vajan = customRound(weighbridge_weight - katta_kasar - Bardan);

      data["Weighbridge Weight"] = weighbridge_weight;
      data["Kasar"] = katta_kasar;
      data["Bardan Weight"] = Bardan;

      const vakals = [
        { katta: Number(vakal_1_katta) || 0, bhav: Number(vakal_1_bhav) || 0 },
        { katta: Number(vakal_2_katta) || 0, bhav: Number(vakal_2_bhav) || 0 },
        { katta: Number(vakal_3_katta) || 0, bhav: Number(vakal_3_bhav) || 0 },
        { katta: Number(vakal_4_katta) || 0, bhav: Number(vakal_4_bhav) || 0 },
        { katta: Number(vakal_5_katta) || 0, bhav: Number(vakal_5_bhav) || 0 },
      ];

      let perUnitWeight = bharela ? net_vajan / bharela : 0;
      let calculatedKilosSum = 0;
      let lastActiveVakalIndex = vakals.map((v) => v.katta > 0).lastIndexOf(true);

      for (let i = 0; i < vakals.length; i++) {
        let kilo = 0;
        if (vakals[i].katta > 0) {
          if (i === lastActiveVakalIndex) {
            kilo = net_vajan - calculatedKilosSum;
          } else {
            kilo = customRound(perUnitWeight * vakals[i].katta);
            calculatedKilosSum += kilo;
          }
        }
        data[`Vakal ${i + 1} Katta`] = vakals[i].katta;
        data[`Vakal ${i + 1} Kilo`] = kilo;
        data[`Vakal ${i + 1} Bhav`] = vakals[i].bhav;
        const amount = customRound((kilo / 20) * vakals[i].bhav);
        data[`Vakal ${i + 1} Amount`] = amount;
        total += amount;
      }
    }

    if (deductUtrai) {
      let utrai_base = customRound((net_vajan / 100) * globalSettings.utraiPercentage);
      let diff = (total % 10) - (utrai_base % 10);
      if (diff > 5) finalutrai = utrai_base + diff - 10;
      else if (diff < -5) finalutrai = utrai_base + diff + 10;
      else if (diff === 5 || diff === -5) finalutrai = utrai_base - 5;
      else finalutrai = utrai_base + diff;
    }

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const finaltotal = total - finalutrai - totalExpenses;

    data["Serial No"] = existingData["Serial No"];
    data["Date"] = existingData["Date"];
    data["Net Weight"] = net_vajan;
    data["Total Amount"] = total;
    data["Utrāī"] = finalutrai;
    data["Final Total"] = finaltotal;
    // --- Store the deduction settings with the bill ---
    data["DeductionSettings"] = {
      kasarPercentage: globalSettings.kasarPercentage,
      kantanWeight: globalSettings.kantanWeight,
      plasticWeight: globalSettings.plasticWeight,
      utraiPercentage: globalSettings.utraiPercentage,
    };
    // --- END OF NEW CODE ---

    await billRef.update(data);
    localStorage.setItem("currentBill", JSON.stringify({ ...data, id: docId }));
    window.location.href = "final.html";
  } catch (error) {
    console.error("Error updating document: ", error);
    alert("Could not update the bill. Please try again.");
  } finally {
    hideLoading();
  }
}

// --- UI TOGGLING AND RENDERING ---

function showBillListView() {
  document.getElementById("bill_creation_form").style.display = "none";
  document.getElementById("view_all_bills_btn").style.display = "none";
  document.getElementById("bill_list_view").style.display = "block";
  showLoading();

  billsCollection.orderBy("Serial No", "desc").onSnapshot((snapshot) => {
    const syncStatus = document.getElementById("sync_status");
    if (snapshot.metadata.hasPendingWrites) {
      syncStatus.textContent = "Offline. Changes will sync when online.";
      syncStatus.style.color = "orange";
    } else {
      const now = new Date();
      const formattedTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
      syncStatus.textContent = `All data synced. (Last sync: ${formattedTime})`;
      syncStatus.style.color = "green";
    }

    const serverBills = snapshot.docs.map((doc) => doc.data());
    const lastServerNo = serverBills.reduce((max, bill) => Math.max(max, bill["Serial No"]), 0);
    if (lastServerNo > 0) {
      localStorage.setItem("lastSerialNo", lastServerNo);
    }

    renderBillList(snapshot.docs);
    hideLoading();
  });
}

function showBillCreationForm() {
  document.getElementById("bill_list_view").style.display = "none";
  document.getElementById("bill_creation_form").style.display = "block";
  document.getElementById("view_all_bills_btn").style.display = "block";
}

function renderBillList(docs) {
  const tableBody = document.getElementById("bill_list_body");
  tableBody.innerHTML = "";
  if (docs.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No bills saved yet.</td></tr>';
    return;
  }

  docs.forEach((doc) => {
    const bill = doc.data();
    const row = document.createElement("tr");
    row.innerHTML = `
            <td><input type="checkbox" class="bill-checkbox" value="${doc.id}"></td>
            <td>${bill["Serial No"]}</td>
            <td>${bill["Date"]}</td>
            <td>${bill["Customer Name"]}</td>
            <td>${bill["Bill Type"]}</td>
            <td>${formatNumber(bill["Final Total"])}</td>
            <td class="action-buttons">
                <button class="view-btn" onclick="viewBill('${doc.id}')">View</button>
                <button class="edit-btn" onclick="editBill('${doc.id}')">Edit</button>
                <button class="delete-btn" onclick="deleteBill('${doc.id}', ${bill["Serial No"]})">Delete</button>
            </td>
        `;
    tableBody.appendChild(row);
  });
}

function viewBill(docId) {
  showLoading("Fetching bill details...");
  billsCollection
    .doc(docId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        localStorage.setItem("currentBill", JSON.stringify({ ...doc.data(), id: doc.id }));
        window.location.href = "final.html";
      } else {
        alert("Could not find this bill. It might not be synced yet.");
      }
    })
    .catch((error) => {
      console.error("Error fetching bill for view:", error);
      alert("Could not load the bill. Please try again.");
    })
    .finally(() => {
      hideLoading();
    });
}

// NEW: Function to handle editing a bill
function editBill(docId) {
  showLoading("Fetching bill for editing...");
  billsCollection
    .doc(docId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        localStorage.setItem("editBillData", JSON.stringify({ ...doc.data(), id: doc.id }));
        window.location.href = "index.html";
      } else {
        alert("Could not find this bill. It might not be synced yet.");
      }
    })
    .catch((error) => {
      console.error("Error fetching bill for edit:", error);
      alert("Could not load the bill. Please try again.");
    })
    .finally(() => {
      hideLoading();
    });
}

function deleteBill(docId, serialNo) {
  if (confirm(`Are you sure you want to delete Bill No. ${serialNo}? This cannot be undone.`)) {
    showLoading("Deleting bill...");
    billsCollection
      .doc(docId)
      .delete()
      .catch((error) => {
        console.error("Error removing document: ", error);
        alert("Could not delete the bill. Please try again when online.");
      })
      .finally(() => {
        hideLoading();
      });
  }
}

// --- EXPORT FUNCTIONS ---

function toggleSelectAll(source) {
  const checkboxes = document.querySelectorAll(".bill-checkbox");
  for (let i = 0; i < checkboxes.length; i++) {
    checkboxes[i].checked = source.checked;
  }
}

async function exportSelectedBills() {
  showLoading("Preparing download...");
  const format = document.getElementById("export_format").value;
  const selectedCheckboxes = document.querySelectorAll(".bill-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one bill to download.");
    hideLoading();
    return;
  }

  const selectedIds = Array.from(selectedCheckboxes).map((cb) => cb.value);

  const billPromises = selectedIds.map((id) => billsCollection.doc(id).get());
  const billDocs = await Promise.all(billPromises);
  const billsData = billDocs.map((doc) => doc.data());

  if (format === "excel") {
    downloadAsExcel(billsData);
  } else if (format === "pdf") {
    downloadAsPDF(billsData);
  }

  hideLoading();
}

function downloadAsExcel(billsData) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(billsData);
  XLSX.utils.book_append_sheet(wb, ws, "Bills");
  XLSX.writeFile(wb, "GaneshAgri_Bills.xlsx");
}

function downloadAsPDF(billsData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const tableColumns = ["Bill No.", "Date", "Customer Name", "Bill Type", "Final Total"];
  const tableRows = [];

  billsData.forEach((bill) => {
    const billData = [
      bill["Serial No"],
      bill["Date"],
      bill["Customer Name"],
      bill["Bill Type"],
      formatNumber(bill["Final Total"]),
    ];
    tableRows.push(billData);
  });

  doc.autoTable({
    head: [tableColumns],
    body: tableRows,
    startY: 20,
  });

  doc.text("Ganesh Agri Industries - Bill Report", 14, 15);
  doc.save("GaneshAgri_Bills.pdf");
}

// --- FINAL.HTML PAGE FUNCTIONS ---

function displayData() {
  showLoading("Loading bill details...");
  let storedData = localStorage.getItem("currentBill");
  if (!storedData) {
    hideLoading();
    return;
  }
  let data = JSON.parse(storedData);

  // Use a fallback for old bills that don't have DeductionSettings
  const deductionSettings = data.DeductionSettings || {
    kasarPercentage: 0.003,
    kantanWeight: 0.6,
    plasticWeight: 0.2,
    utraiPercentage: 7,
  };

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

  for (let i = 1; i <= 5; i++) {
    setValue(`display_vakal_${i}_katta`, data[`Vakal ${i} Katta`]);
    setValue(`display_vakal_${i}_kilo`, data[`Vakal ${i} Kilo`]);
    setValue(`display_vakal_${i}_bhav`, data[`Vakal ${i} Bhav`]);
    setValue(`display_vakal_${i}_amount`, data[`Vakal ${i} Amount`]);
  }

  const bardanValueElement = document.getElementById("display_bardan_weight");
  if (bardanValueElement) {
    bardanValueElement.textContent = data["Bardan Weight"];
  }

  // It should be placed after all the other details are displayed.
  const expensesContainer = document.getElementById("expenses_container");
  if (expensesContainer && data["Expenses"]) {
    let expenses = JSON.parse(data["Expenses"]);
    if (expenses.length > 0) {
      expensesContainer.style.display = "inherit"; // Make container visible
      expenses.forEach((exp) => {
        const expenseBox = document.createElement("div");
        expenseBox.classList.add("detail-item");
        expenseBox.innerHTML = `<span class="detail-label">${exp.name}</span><span class="detail-value">${exp.amount}</span>`;
        expensesContainer.appendChild(expenseBox);
      });
    } else {
      expensesContainer.style.display = "none"; // Hide container if empty
    }
  }

  // const finalTotalBoxContainer = document.getElementById("final_total_box_container");
  // if (finalTotalBoxContainer && data["Expenses"]) {
  //   let expenses = JSON.parse(data["Expenses"]);
  //   if (expenses.length > 0) {
  //     expenses.forEach((exp) => {
  //       const expenseBox = document.createElement("div");
  //       expenseBox.classList.add("detail-item");
  //       expenseBox.innerHTML = `<span class="detail-label">${exp.name}</span><span class="detail-value">${exp.amount}</span>`;
  //       finalTotalBoxContainer.before(expenseBox);
  //     });
  //   }
  // }

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

  const originalContainer = document.getElementById("container-original"),
    copyContainer = document.getElementById("container-copy");
  if (originalContainer && copyContainer) {
    const contentToCopy = originalContainer.cloneNode(true);
    contentToCopy.querySelector(".button-container").remove();
    copyContainer.innerHTML = contentToCopy.innerHTML;
  }
  hideLoading();
}

// --- NEW: Download single bill as PDF ---
// Replace your existing downloadBillAsPDF function with this code
function downloadBillAsPDF() {
  showLoading("Generating PDF...");
  // Get the container that holds the bill content
  const billContainer = document.getElementById("container-original");
  const billData = JSON.parse(localStorage.getItem("currentBill"));

  if (!billData || !billContainer) {
    alert("No bill data or container found to download.");
    hideLoading();
    return;
  }
  const billNo = billData["Serial No"];
  const billName = billData["Customer Name"];

  // Add a temporary class to the body to activate print styles
  document.body.classList.add("print-mode");

  // Make the print-only details visible and hide the buttons
  const printDetails = billContainer.querySelectorAll(".print-only-details");
  printDetails.forEach((el) => (el.style.display = "block"));
  const buttonContainer = billContainer.querySelector(".button-container");
  if (buttonContainer) {
    buttonContainer.style.display = "none";
  }

  setTimeout(() => {
    html2canvas(billContainer, { scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
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

      pdf.addImage(imgData, "PNG", x, y, finalWidth, finalHeight);

      pdf.save(`Bill No-${billNo}-${billName}.pdf`);

      // Clean up: revert changes and show buttons again
      document.body.classList.remove("print-mode");
      printDetails.forEach((el) => (el.style.display = "none"));
      if (buttonContainer) {
        buttonContainer.style.display = "flex";
      }
      hideLoading();
    });
  }, 100);
}
// Replace the existing formatNumber function with this code
function formatNumber(num) {
  if (isNaN(num) || num === "") {
    return num;
  }
  const numString = Number(num).toLocaleString("en-IN");

  if (numString.length > 10) {
    // Return a smaller font size for large numbers
    return `<span style="font-size: 0.7em;">${numString}</span>`;
  }
  return numString;
}
function checkFirebaseConnection() {
  showLoading("Checking connection...");
  const connectionStatus = document.getElementById("connection_status");
  // Force the get() call to check the server directly
  billsCollection
    .limit(1)
    .get({ source: "server" })
    .then(() => {
      connectionStatus.textContent = "Connected!";
      connectionStatus.className = "connected"; // Set a class for green color
    })
    .catch(() => {
      connectionStatus.textContent = "Disconnected.";
      connectionStatus.className = "disconnected"; // Set a class for red color
    })
    .finally(() => {
      hideLoading();
    });
}

// --- NEW: UPLOAD FUNCTIONALITY ---

// Function to handle the file upload
function uploadBills() {
  const fileInput = document.getElementById("upload_file_input");
  const file = fileInput.files[0];
  const uploadStatus = document.getElementById("upload_status");

  if (!file) {
    uploadStatus.textContent = "Please select a file to upload.";
    uploadStatus.style.color = "red";
    return;
  }

  showLoading("Uploading bills...");
  uploadStatus.textContent = "Uploading...";
  uploadStatus.style.color = "orange";

  const reader = new FileReader();
  reader.onload = function (event) {
    const data = new Uint8Array(event.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonBills = XLSX.utils.sheet_to_json(worksheet);

    if (jsonBills.length === 0) {
      uploadStatus.textContent = "The selected file is empty or not in the correct format.";
      uploadStatus.style.color = "red";
      hideLoading();
      return;
    }

    processUploadedBills(jsonBills, uploadStatus);
  };
  reader.readAsArrayBuffer(file);
}

// Function to process and save each bill from the uploaded file
async function processUploadedBills(bills, statusElement) {
  let successCount = 0;
  let errorCount = 0;
  const lastSerialNo = Number(localStorage.getItem("lastSerialNo")) || 0;
  let currentSerialNo = lastSerialNo;

  for (const bill of bills) {
    currentSerialNo++;

    // Remap data from the Excel file columns to the database schema
    const billData = {
      "Serial No": currentSerialNo,
      "Customer Name": bill["Customer Name"] || "",
      "Vehicle No": bill["Vehicle No"] || "",
      Village: bill["Village"] || "",
      Broker: bill["Broker"] || "",
      "Bill Type": bill["Bill Type"] || "Bag",
      "Weighbridge Weight": bill["Weighbridge Weight"] || 0,
      Kasar: bill["Kasar"] || 0,
      "Bardan Weight": bill["Bardan Weight"] || 0,
      "Net Weight": bill["Net Weight"] || 0,
      "Vakal 1 Katta": bill["Vakal 1 Katta"] || 0,
      "Vakal 1 Kilo": bill["Vakal 1 Kilo"] || 0,
      "Vakal 1 Bhav": bill["Vakal 1 Bhav"] || 0,
      "Vakal 1 Amount": bill["Vakal 1 Amount"] || 0,
      // ... include all other vakals and fields from your schema
      "Total Amount": bill["Total Amount"] || 0,
      Utrāī: bill["Utrāī"] || 0,
      "Final Total": bill["Final Total"] || 0,
      Expenses: JSON.stringify(bill["Expenses"] || []),
      Date: bill["Date"] || new Date().toLocaleDateString("en-IN"),
    };

    try {
      await billsCollection.add(billData);
      successCount++;
    } catch (error) {
      console.error("Error adding uploaded bill:", bill, error);
      errorCount++;
    }
  }

  // Update last serial number
  localStorage.setItem("lastSerialNo", currentSerialNo);

  statusElement.textContent = `Upload complete: ${successCount} bills added, ${errorCount} bills failed.`;
  statusElement.style.color = errorCount === 0 ? "green" : "red";

  hideLoading();
  // Reload the bill list to show new data
  showBillListView();
}
