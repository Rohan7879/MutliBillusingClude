const { MockFirestore } = require("./mock-firestore");

let pass = 0,
  fail = 0;
function check(name, condition) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// This mirrors the transaction body actually written into savePayment()
// in js/features/ledger.js: read bill(s) + party, compute new amounts,
// then write payment doc + bill update(s) + party balance — all inside
// db.runTransaction().
async function runSavePaymentTransaction(db, { billId, customerId, cashAmount, failAt }) {
  return db.runTransaction(
    async (transaction) => {
      const billRef = db.collection("bills").doc(billId);
      const partyRef = db.collection("parties").doc(customerId);
      const paymentRef = db.collection("payments").doc();

      const billDoc = await transaction.get(billRef);
      const partyDoc = await transaction.get(partyRef);

      const billData = billDoc.data();
      const currentAmountPaid = Number(billData.amountPaid || 0);
      const finalTotal = Number(billData["Final Total"] || 0);
      const newAmountPaid = currentAmountPaid + cashAmount;
      const newAmountDue = finalTotal - newAmountPaid;
      const newStatus = newAmountDue <= 0.01 ? "Paid" : "Partial";

      transaction.set(paymentRef, { customerId, cashAmount, totalCredit: cashAmount, appliedToBills: [billId] });
      transaction.update(billRef, { amountPaid: newAmountPaid, amountDue: newAmountDue, paymentStatus: newStatus });

      const currentBalance = Number(partyDoc.data().currentBalance || 0);
      transaction.update(partyRef, { currentBalance: currentBalance - cashAmount });
    },
    { failAt }
  );
}

async function main() {
  console.log("\n=== 5. Atomicity: savePayment() transaction under injected failures ===\n");

  const seed = {
    bills: { bill1: { "Final Total": 1000, amountPaid: 0, amountDue: 1000, paymentStatus: "Unpaid" } },
    parties: { party1: { name: "Ramesh", currentBalance: 1000 } },
    payments: {},
  };

  // Baseline: no failure — everything should commit together.
  {
    const db = new MockFirestore(seed);
    await runSavePaymentTransaction(db, { billId: "bill1", customerId: "party1", cashAmount: 400 });
    check(
      "LEGIT: no failure → bill, party balance, AND payment doc all updated together",
      db.store.bills.bill1.amountPaid === 400 &&
        db.store.parties.party1.currentBalance === 600 &&
        Object.keys(db.store.payments).length === 1
    );
  }

  // Failure injected at each possible point — nothing should ever partially land.
  const failurePoints = ["get:1", "get:2", "set:1", "update:1", "update:2", "commit"];
  for (const point of failurePoints) {
    const db = new MockFirestore(seed);
    let threw = false;
    try {
      await runSavePaymentTransaction(db, { billId: "bill1", customerId: "party1", cashAmount: 400, failAt: point });
    } catch (e) {
      threw = true;
    }
    const untouched =
      deepEqual(db.store.bills, seed.bills) &&
      deepEqual(db.store.parties, seed.parties) &&
      Object.keys(db.store.payments).length === 0;
    check(`ATOMICITY: failure injected at "${point}" → threw=${threw}, store completely unchanged`, threw && untouched);
  }

  // Sanity check: run again after a genuine failure, confirm a clean retry
  // still works normally (nothing left in a broken state from the failed try).
  {
    const db = new MockFirestore(seed);
    try {
      await runSavePaymentTransaction(db, {
        billId: "bill1",
        customerId: "party1",
        cashAmount: 400,
        failAt: "update:2",
      });
    } catch (e) {
      /* expected */
    }
    await runSavePaymentTransaction(db, { billId: "bill1", customerId: "party1", cashAmount: 400 });
    check(
      "RECOVERY: after a failed attempt, a clean retry succeeds normally",
      db.store.bills.bill1.amountPaid === 400 && db.store.parties.party1.currentBalance === 600
    );
  }

  // Multi-bill payment: partial application across bills should also be
  // all-or-nothing at the transaction level (not "bill A updated, bill B not").
  async function runMultiBillTransaction(db, { billIds, customerId, totalCredit, failAt }) {
    return db.runTransaction(
      async (transaction) => {
        const billRefs = billIds.map((id) => db.collection("bills").doc(id));
        const partyRef = db.collection("parties").doc(customerId);
        const paymentRef = db.collection("payments").doc();

        const billDocs = [];
        for (const ref of billRefs) billDocs.push(await transaction.get(ref));
        const partyDoc = await transaction.get(partyRef);

        let remaining = totalCredit;
        transaction.set(paymentRef, { customerId, totalCredit, appliedToBills: billIds });
        billDocs.forEach((billDoc, i) => {
          const billData = billDoc.data();
          const currentPaid = Number(billData.amountPaid || 0);
          const finalTotal = Number(billData["Final Total"] || 0);
          const owed = finalTotal - currentPaid;
          const pay = Math.max(0, Math.min(remaining, owed));
          const newPaid = currentPaid + pay;
          transaction.update(billRefs[i], {
            amountPaid: newPaid,
            amountDue: finalTotal - newPaid,
            paymentStatus: finalTotal - newPaid <= 0.01 ? "Paid" : "Partial",
          });
          remaining -= pay;
        });

        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, { currentBalance: currentBalance - totalCredit });
      },
      { failAt }
    );
  }

  const multiSeed = {
    bills: {
      billA: { "Final Total": 500, amountPaid: 0, amountDue: 500, paymentStatus: "Unpaid" },
      billB: { "Final Total": 500, amountPaid: 0, amountDue: 500, paymentStatus: "Unpaid" },
    },
    parties: { party1: { name: "Ramesh", currentBalance: 1000 } },
    payments: {},
  };

  {
    const db = new MockFirestore(multiSeed);
    await runMultiBillTransaction(db, { billIds: ["billA", "billB"], customerId: "party1", totalCredit: 700 });
    check(
      "LEGIT: multi-bill payment splits correctly across both bills in one shot",
      db.store.bills.billA.amountPaid === 500 &&
        db.store.bills.billB.amountPaid === 200 &&
        db.store.parties.party1.currentBalance === 300
    );
  }
  {
    // Fail AFTER billA's update was queued but before billB's / party's —
    // this is exactly the scenario that produced the original bug (order
    // sync / balance desync). Prove it can no longer happen.
    const db = new MockFirestore(multiSeed);
    let threw = false;
    try {
      await runMultiBillTransaction(db, {
        billIds: ["billA", "billB"],
        customerId: "party1",
        totalCredit: 700,
        failAt: "update:2", // right after billA's update is queued, before billB's
      });
    } catch (e) {
      threw = true;
    }
    check(
      "ATOMICITY: failure between billA and billB writes → NEITHER bill nor balance changes (this is the exact bug class from before)",
      threw && deepEqual(db.store.bills, multiSeed.bills) && deepEqual(db.store.parties, multiSeed.parties)
    );
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (out of ${pass + fail}) ===\n`);
  if (fail > 0) process.exitCode = 1;
}

// ── 6. Bill creation: counter + bill doc + party balance, one transaction
// (mirrors the new code in bill-form.js's create-bill flow) ──
async function runCreateBillTransaction(db, { counterId, customerId, finalTotal, failAt }) {
  return db.runTransaction(
    async (transaction) => {
      const counterRef = db.collection("counters").doc(counterId);
      const partyRef = db.collection("parties").doc(customerId);
      const billRef = db.collection("bills").doc();

      const counterDoc = await transaction.get(counterRef);
      const partyDoc = await transaction.get(partyRef);

      const newCounterValue = counterDoc.exists ? counterDoc.data().currentNumber + 1 : 1;

      transaction.set(counterRef, { currentNumber: newCounterValue });
      transaction.set(billRef, { "Final Total": finalTotal, "Serial No": `S-${newCounterValue}`, customerId });

      if (partyDoc.exists) {
        const currentBalance = Number(partyDoc.data().currentBalance || 0);
        transaction.update(partyRef, { currentBalance: currentBalance + finalTotal });
      }
    },
    { failAt }
  );
}

// ── 7. Bill edit with customer switch: bill update + old-party debit +
// new-party credit, one transaction (mirrors bill-form.js's edit flow —
// this is the exact "money vanishes between two parties" scenario) ──
async function runEditBillCustomerSwitchTransaction(
  db,
  { billId, oldCustomerId, newCustomerId, oldTotal, newTotal, failAt }
) {
  return db.runTransaction(
    async (transaction) => {
      const billRef = db.collection("bills").doc(billId);
      const oldPartyRef = db.collection("parties").doc(oldCustomerId);
      const newPartyRef = db.collection("parties").doc(newCustomerId);

      const billDoc = await transaction.get(billRef);
      const oldPartyDoc = await transaction.get(oldPartyRef);
      const newPartyDoc = await transaction.get(newPartyRef);
      if (!billDoc.exists) throw new Error("Bill not found");

      transaction.update(billRef, { "Final Total": newTotal, customerId: newCustomerId });

      if (oldPartyDoc.exists) {
        const bal = Number(oldPartyDoc.data().currentBalance || 0);
        transaction.update(oldPartyRef, { currentBalance: bal - oldTotal });
      }
      if (newPartyDoc.exists) {
        const bal = Number(newPartyDoc.data().currentBalance || 0);
        transaction.update(newPartyRef, { currentBalance: bal + newTotal });
      }
    },
    { failAt }
  );
}

async function main2() {
  let pass2 = 0,
    fail2 = 0;
  function check2(name, condition) {
    if (condition) {
      pass2++;
      console.log(`  ✅ ${name}`);
    } else {
      fail2++;
      console.log(`  ❌ ${name}`);
    }
  }

  console.log("\n=== 6. Atomicity: bill CREATION (counter + bill + balance) ===\n");

  const createSeed = {
    counters: { fy2627: { currentNumber: 5 } },
    parties: { party1: { name: "Ramesh", currentBalance: 1000 } },
    bills: {},
  };

  {
    const db = new MockFirestore(createSeed);
    await runCreateBillTransaction(db, { counterId: "fy2627", customerId: "party1", finalTotal: 2000 });
    check2(
      "LEGIT: no failure → counter incremented, bill created, AND balance updated together",
      db.store.counters.fy2627.currentNumber === 6 &&
        Object.keys(db.store.bills).length === 1 &&
        db.store.parties.party1.currentBalance === 3000
    );
  }

  const createFailurePoints = ["get:1", "get:2", "set:1", "set:2", "update:1", "commit"];
  for (const point of createFailurePoints) {
    const db = new MockFirestore(createSeed);
    let threw = false;
    try {
      await runCreateBillTransaction(db, {
        counterId: "fy2627",
        customerId: "party1",
        finalTotal: 2000,
        failAt: point,
      });
    } catch (e) {
      threw = true;
    }
    const untouched =
      deepEqual(db.store.counters, createSeed.counters) &&
      deepEqual(db.store.parties, createSeed.parties) &&
      Object.keys(db.store.bills).length === 0;
    check2(
      `ATOMICITY: failure at "${point}" during bill creation → threw=${threw}, nothing partially created (no orphan serial number, no bill without balance update)`,
      threw && untouched
    );
  }

  console.log("\n=== 7. Atomicity: bill EDIT with customer switch (the riskiest case) ===\n");

  const editSeed = {
    bills: { bill1: { "Final Total": 500, customerId: "partyA" } },
    parties: {
      partyA: { name: "Old Customer", currentBalance: 500 },
      partyB: { name: "New Customer", currentBalance: 0 },
    },
  };

  {
    const db = new MockFirestore(editSeed);
    await runEditBillCustomerSwitchTransaction(db, {
      billId: "bill1",
      oldCustomerId: "partyA",
      newCustomerId: "partyB",
      oldTotal: 500,
      newTotal: 700,
    });
    check2(
      "LEGIT: customer switched on edit → old party debited, new party credited, bill updated, all together",
      db.store.parties.partyA.currentBalance === 0 &&
        db.store.parties.partyB.currentBalance === 700 &&
        db.store.bills.bill1["Final Total"] === 700
    );
  }

  const editFailurePoints = ["get:1", "get:2", "get:3", "update:1", "update:2", "update:3", "commit"];
  for (const point of editFailurePoints) {
    const db = new MockFirestore(editSeed);
    let threw = false;
    try {
      await runEditBillCustomerSwitchTransaction(db, {
        billId: "bill1",
        oldCustomerId: "partyA",
        newCustomerId: "partyB",
        oldTotal: 500,
        newTotal: 700,
        failAt: point,
      });
    } catch (e) {
      threw = true;
    }
    const untouched = deepEqual(db.store.bills, editSeed.bills) && deepEqual(db.store.parties, editSeed.parties);
    check2(
      `ATOMICITY (the exact "money vanishes" bug class): failure at "${point}" during customer-switch edit → threw=${threw}, NEITHER party's balance changed, bill unchanged`,
      threw && untouched
    );
  }

  console.log(`\n=== RESULT: ${pass2} passed, ${fail2} failed (out of ${pass2 + fail2}) ===\n`);
  if (fail2 > 0) process.exitCode = 1;
}

(async () => {
  await main();
  await main2();
})();
