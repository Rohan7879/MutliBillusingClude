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
  process.exit(fail > 0 ? 1 : 0);
}

main();
