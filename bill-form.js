let uniqueCustomers = []; // To hold our customer list
async function setupAutocomplete() {
  // 1. Get the customer list directly from the Firestore 'customers' collection
  try {
    const snapshot = await db.collection("customers").get();
    uniqueCustomers = snapshot.docs.map((doc) => doc.data());
  } catch (error) {
    console.error("Could not fetch customer list for autocomplete:", error);
  }

  // 2. Get references to the input fields (no change here)
  const nameInput = document.querySelector('input[name="customer_name"]');
  const villageInput = document.querySelector('input[name="village"]');
  const suggestionsBox = document.getElementById("autocomplete-container");

  // 3. The rest of the function stays the same
  nameInput.addEventListener("input", () => {
    const value = nameInput.value.toLowerCase();
    suggestionsBox.innerHTML = "";

    if (!value) return;

    const filteredCustomers = uniqueCustomers.filter((customer) => customer.name.toLowerCase().includes(value));

    const suggestionsList = document.createElement("div");
    suggestionsList.classList.add("autocomplete-items");
    filteredCustomers.forEach((customer) => {
      const item = document.createElement("div");
      item.innerHTML = `<strong>${customer.name}</strong> (${customer.village})`;
      item.addEventListener("click", () => {
        nameInput.value = customer.name;
        villageInput.value = customer.village;
        suggestionsBox.innerHTML = "";
      });
      suggestionsList.appendChild(item);
    });
    suggestionsBox.appendChild(suggestionsList);
  });
}
function initializeIndexPage() {
  addExpense();
  // Call the new autocomplete setup function
  setupAutocomplete();
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

  // Attach a real-time listener to all bags inputs
  const bagInputs = document.querySelectorAll('#vakal_section input[name$="_katta"]');
  bagInputs.forEach((input) => {
    input.addEventListener("input", updateTotalBags);
  });

  // Update the total immediately when the page loads
  updateTotalBags();
}
function populateFormForEdit(data) {
  const form = document.getElementById("estimateForm");
  form.dataset.editId = data.id;

  // Safer way to set values, provides a fallback for missing data
  document.querySelector('input[name="customer_name"]').value = (data["Customer Name"] || "").toUpperCase();
  document.querySelector('input[name="vehicle_no"]').value = (data["Vehicle No"] || "").toUpperCase();
  document.querySelector('input[name="village"]').value = (data["Village"] || "").toUpperCase();
  document.querySelector('input[name="broker"]').value = (data["Broker"] || "").toUpperCase();
  document.querySelector('input[name="weighbridge_weight"]').value = data["Weighbridge Weight"] || 0;
  document.querySelector('input[name="truck_freight"]').value = data["Truck Freight"] || 0;

  if (data["Bill Type"] === "Loose") {
    document.getElementById("loose_supply_toggle").checked = true;
    document.getElementById("loose_supply_toggle").dispatchEvent(new Event("change"));
    document.querySelector('input[name="loose_price"]').value = data["Vakal 1 Bhav"] || 0;
  } else {
    // Populate Vakal fields for Bag bills
    for (let i = 1; i <= 5; i++) {
      document.querySelector(`input[name="vakal_${i}_katta"]`).value = data[`Vakal ${i} Katta`] || "";
      document.querySelector(`input[name="vakal_${i}_bhav"]`).value = data[`Vakal ${i} Bhav`] || "";
    }
  }

  // Populate expenses
  if (data["Expenses"]) {
    try {
      const expenses = JSON.parse(data["Expenses"]);
      const expenseList = document.getElementById("expense_list");
      expenseList.innerHTML = ""; // Clear existing empty expense row
      if (expenses.length > 0) {
        expenses.forEach((exp) => addExpense(exp.name, exp.amount));
      }
      addExpense(); // Add a final empty row
    } catch (e) {
      console.error("Could not parse expenses for editing.");
    }
  }

  document.querySelector('button[type="submit"]').textContent = "Update Bill";
}
function updateTotalBags() {
  let total = 0;
  const bagInputs = document.querySelectorAll('#vakal_section input[name$="_katta"]');
  bagInputs.forEach((input) => {
    total += Number(input.value) || 0;
  });
  document.getElementById("total-bags-count").textContent = total;
}
function updateExpensesSubtotal() {
  let total = 0;
  const expenseAmountInputs = document.querySelectorAll('input[name="expense_amount"]');
  expenseAmountInputs.forEach((input) => {
    total += Number(input.value) || 0;
  });
  document.getElementById("expenses-subtotal").textContent = `₹${total.toLocaleString("en-IN")}`;
}
function addExpense(name = "", amount = "") {
  const expenseList = document.getElementById("expense_list");
  if (!expenseList) return;
  const newRow = document.createElement("div");
  newRow.classList.add("expense-row");
  newRow.innerHTML = `
        <input type="text" name="expense_name" placeholder="ખર્ચનું નામ (Expense Name)" value="${name}">
        <input type="number" name="expense_amount" placeholder="રકમ (Amount)" value="${amount}">
        <button type="button" class="remove-expense-btn" onclick="this.parentElement.remove(); updateExpensesSubtotal();">Remove</button>
    `;
  expenseList.appendChild(newRow);

  // Add a real-time listener to the new amount input
  const newAmountInput = newRow.querySelector('input[name="expense_amount"]');
  newAmountInput.addEventListener("input", updateExpensesSubtotal);

  // Update the total immediately
  updateExpensesSubtotal();
}
function calculateBillData(formData) {
  let data = {}; // This object will hold all our results

  // --- Get Form Values ---
  const isLooseSupply = formData.get("is_loose_supply") !== null;
  const deductKasar = formData.get("deduct_kasar") !== null;
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

  let net_vajan = 0;
  let total = 0;
  let finalutrai = 0;

  // --- Perform Calculations ---
  if (isLooseSupply) {
    data["Bill Type"] = "Loose";
    const weight = Number(formData.get("weighbridge_weight")) || 0;
    const price = Number(formData.get("loose_price")) || 0;
    const katta_kasar = deductKasar ? customRound(weight * globalSettings.kasarPercentage) : 0;
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
    const weighbridge_weight = Number(formData.get("weighbridge_weight")) || 0;
    const bharela_600 = Number(formData.get("bharela_600")) || 0;
    const khali_600 = Number(formData.get("khali_600")) || 0;
    const bharela_200 = Number(formData.get("bharela_200")) || 0;
    const khali_200 = Number(formData.get("khali_200")) || 0;

    const bardanWeightKantan = deductKantan ? customRound((bharela_600 + khali_600) * globalSettings.kantanWeight) : 0;
    const bardanWeightPlastic = deductPlastic
      ? customRound((bharela_200 + khali_200) * globalSettings.plasticWeight)
      : 0;
    const Bardan = bardanWeightKantan + bardanWeightPlastic;
    const katta_kasar = deductKasar ? customRound(weighbridge_weight * globalSettings.kasarPercentage) : 0;
    net_vajan = customRound(weighbridge_weight - katta_kasar - Bardan);

    data["Weighbridge Weight"] = weighbridge_weight;
    data["Kasar"] = katta_kasar;
    data["Bardan Weight"] = Bardan;

    const vakals = [
      { katta: Number(formData.get("vakal_1_katta")) || 0, bhav: Number(formData.get("vakal_1_bhav")) || 0 },
      { katta: Number(formData.get("vakal_2_katta")) || 0, bhav: Number(formData.get("vakal_2_bhav")) || 0 },
      { katta: Number(formData.get("vakal_3_katta")) || 0, bhav: Number(formData.get("vakal_3_bhav")) || 0 },
      { katta: Number(formData.get("vakal_4_katta")) || 0, bhav: Number(formData.get("vakal_4_bhav")) || 0 },
      { katta: Number(formData.get("vakal_5_katta")) || 0, bhav: Number(formData.get("vakal_5_bhav")) || 0 },
    ];

    let totalVakalBags = vakals.reduce((sum, v) => sum + v.katta, 0);
    let perUnitWeight = totalVakalBags ? net_vajan / totalVakalBags : 0;
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

  // 1. Get the new truck freight value
  const truckFreight = Number(formData.get("truck_freight")) || 0;

  // 2. Add it to the final total calculation
  const finaltotal = total - finalutrai - totalExpenses + truckFreight;

  // --- Populate the rest of the data object ---
  data["Customer Name"] = formData.get("customer_name");
  data["Vehicle No"] = formData.get("vehicle_no");
  data["Village"] = formData.get("village");
  data["Broker"] = formData.get("broker");
  data["Net Weight"] = net_vajan;
  data["Total Amount"] = total;
  data["Utrāī"] = finalutrai;
  // 3. Save the Truck Freight value to the data object
  data["Truck Freight"] = truckFreight;
  data["Final Total"] = finaltotal;
  data["DeductionSettings"] = {
    kasarPercentage: globalSettings.kasarPercentage,
    kantanWeight: globalSettings.kantanWeight,
    plasticWeight: globalSettings.plasticWeight,
    utraiPercentage: globalSettings.utraiPercentage,
  };

  // --- Return the final calculated data ---
  return data;
}
async function collectData() {
  showLoading();
  const form = document.getElementById("estimateForm");
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    // 1. Determine the current financial year
    const now = new Date();
    let year = now.getFullYear();
    const month = now.getMonth(); // 0 = January, 3 = April

    if (month < 3) {
      // If the month is Jan, Feb, or Mar...
      year = year - 1; // ...it's part of the previous financial year
    }
    const shortYear = year.toString().slice(-2);
    const nextShortYear = (year + 1).toString().slice(-2);
    const financialYearId = `FY${shortYear}${nextShortYear}`; // e.g., "FY2526"

    // 2. Set the correct counter document reference
    const counterRef = db.collection("counters").doc(`billCounter_${financialYearId}`);

    const formData = new FormData(form);
    let data = calculateBillData(formData);

    // Save or update the customer in the 'customers' collection
    const customerName = data["Customer Name"];
    const customerVillage = data["Village"];
    if (customerName) {
      const customerId = customerName.toLowerCase().replace(/\s+/g, "");
      const customerRef = db.collection("customers").doc(customerId);
      await customerRef.set(
        {
          name: customerName,
          village: customerVillage,
        },
        { merge: true }
      );
    }
    // --- END OF NEW CODE BLOCK ---

    // --- UPDATED TRANSACTION LOGIC ---
    const newSerialNo = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);

      if (!counterDoc.exists) {
        // If the counter for the new year doesn't exist, create it and start at 1
        transaction.set(counterRef, { currentNumber: 1 });
        return 1;
      } else {
        // If the counter already exists, just increment it
        const newCounterValue = counterDoc.data().currentNumber + 1;
        transaction.update(counterRef, { currentNumber: newCounterValue });
        return newCounterValue;
      }
    });

    // Format the new bill number (e.g., "26-00001")
    const paddedSerialNo = String(newSerialNo).padStart(5, "0");
    const formattedBillNo = `${shortYear}-${paddedSerialNo}`;

    data["Serial No"] = formattedBillNo;
    data["Date"] = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}/${now.getFullYear()}`;

    const docRef = await billsCollection.add(data);

    window.location.href = `final.html?id=${docRef.id}`;
  } catch (error) {
    console.error("Transaction failed or error adding document: ", error);
    alert("Could not save the bill. Please try again.");
  } finally {
    submitButton.disabled = false;
    hideLoading();
  }
}
async function updateData(docId) {
  showLoading("Updating bill...");
  const form = document.getElementById("estimateForm");
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  const billRef = billsCollection.doc(docId);
  try {
    const originalBillDoc = await billRef.get();
    if (!originalBillDoc.exists) throw "Original bill not found!";
    const originalData = originalBillDoc.data();

    const formData = new FormData(form);
    let newData = calculateBillData(formData);

    newData["Serial No"] = originalData["Serial No"];
    newData["Date"] = originalData["Date"];

    await billRef.update(newData);

    // Calculate bags in the original bill
    let bagsInOriginalBill = 0;
    if (originalData["Bill Type"] === "Bag") {
      for (let i = 1; i <= 5; i++) {
        bagsInOriginalBill += originalData[`Vakal ${i} Katta`] || 0;
      }
    }

    window.location.href = `final.html?id=${docId}`;
  } catch (error) {
    console.error("Error updating document: ", error);
    alert("Could not update the bill. Please try again.");
  } finally {
    submitButton.disabled = false;
    hideLoading();
  }
}
// At the bottom of bill-form.js

document.addEventListener("DOMContentLoaded", async () => {
  await fetchSettings(); // 1. Wait for the settings to load
  initializeIndexPage(); // 2. Then, set up the rest of the page
});
