/* Order summaries are derived from saved bills, never incremented on retries.
 * No listeners, background jobs or paid services. Loaded by bill and ledger pages.
 */
(function (global) {
  "use strict";
  const number = (value, label) => {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result) || result < 0) throw new Error(`Order sync: invalid ${label}.`);
    return result;
  };
  function serials(order, extra = "") {
    const values = [...(Array.isArray(order.linkedBillNos) ? order.linkedBillNos : []),
      ...String(order.linkedBillNo || "").split(","), extra];
    return [...new Set(values.map(value => String(value?.billNo ?? value ?? "").trim()).filter(Boolean))].sort();
  }
  function paymentStatus(bills) {
    let total = 0, paid = 0;
    for (const bill of bills) {
      total += Math.round(number(bill["Final Total"], "bill amount") * 100);
      paid += Math.round(number(bill.amountPaid, "credited amount") * 100);
    }
    return paid > 0 ? (paid >= total ? "Paid" : "Partial") : "Unpaid";
  }
  function deliveredSuppliers(order, bills) {
    const suppliers = (order.suppliers || []).map(s => ({ ...s, delivered: 0 }));
    if (!suppliers.length) throw new Error("Order sync: order has no items.");
    for (const bill of bills) {
      const links = Array.isArray(bill.OrderSupplierLinks) ? bill.OrderSupplierLinks : [];
      const rows = links.length ? links : [{ supplierIdx: bill.LinkedSupplierIdx, vakalIndex: null }];
      const seen = new Set();
      for (const link of rows) {
        const index = Number(link.supplierIdx);
        if (link.supplierIdx == null || link.supplierIdx === "" || !Number.isInteger(index) || !suppliers[index]) {
          throw new Error("Order sync: a linked bill has an invalid order-item mapping.");
        }
        const row = link.vakalIndex == null ? null : Number(link.vakalIndex);
        if (links.length && (!Number.isInteger(row) || row < 1 || row > 5 || seen.has(row))) {
          throw new Error("Order sync: a linked bill has an invalid/duplicate Vakal row.");
        }
        seen.add(row);
        const supplier = suppliers[index];
        const unit = supplier.unit || "Man";
        const loose = bill["Bill Type"] === "Loose";
        if (loose && rows.length > 1) throw new Error("Order sync: a loose bill cannot split weight across multiple order items.");
        let quantity;
        if (unit === "Bag") {
          if (loose) throw new Error("Order sync: a Bag order needs actual bag counts, not a loose bill.");
          quantity = row == null
            ? [1, 2, 3, 4, 5].reduce((sum, n) => sum + number(bill[`Vakal ${n} Katta`], "bag count"), 0)
            : number(bill[`Vakal ${row} Katta`], "bag count");
          if (!Number.isInteger(quantity)) throw new Error("Order sync: bag counts must be whole numbers.");
        } else {
          const divisor = { Man: 20, Khadi: 400, Quintal: 100 }[unit];
          if (!divisor) throw new Error(`Order sync: unsupported order unit ${unit}.`);
          const kg = number(row == null || loose ? bill["Net Weight"] : bill[`Vakal ${row} Kilo`], "delivered weight");
          quantity = kg / divisor;
        }
        supplier.delivered += quantity;
      }
    }
    // Round only after summing all trucks, so each small delivery retains precision.
    return suppliers.map(s => ({ ...s, delivered: Math.round((s.delivered + Number.EPSILON) * 100) / 100 }));
  }
  async function sync(orderId, { delivery = false, extraSerial = "", closeOrder = false } = {}) {
    if (!orderId) return;
    const orderRef = db.collection("orders").doc(orderId);
    // Queries discover document IDs outside the transaction. Inside it, re-read
    // BOTH the order and every bill before any write. If another bill was linked,
    // rediscover IDs; never overwrite the newly linked bill with a stale list.
    for (let attempt = 0; attempt < 3; attempt++) {
      const initial = await orderRef.get();
      if (!initial.exists) throw new Error("Order sync: linked order no longer exists.");
      const expected = serials(initial.data(), extraSerial);
      const refs = new Map();
      for (let i = 0; i < expected.length; i += 10) {
        const result = await db.collection("bills").where("Serial No", "in", expected.slice(i, i + 10)).get();
        result.forEach(doc => refs.set(doc.id, db.collection("bills").doc(doc.id)));
      }
      try {
        return await db.runTransaction(async transaction => {
          const freshOrder = await transaction.get(orderRef);
          if (!freshOrder.exists) throw new Error("Order sync: linked order no longer exists.");
          const order = freshOrder.data();
          if (JSON.stringify(serials(order, extraSerial)) !== JSON.stringify(expected)) {
            throw Object.assign(new Error("Order links changed during sync."), { code: "order-links-changed" });
          }
          const documents = [];
          for (const ref of refs.values()) documents.push(await transaction.get(ref));
          const bySerial = new Map();
          for (const doc of documents) {
            if (!doc.exists) throw new Error("Order sync: a linked bill is missing. Review its link before retrying.");
            const bill = doc.data(), serial = String(bill["Serial No"] || "").trim();
            if (!expected.includes(serial) || bySerial.has(serial)) throw new Error("Order sync: missing or duplicate bill number.");
            if (bill.LinkedOrderId && bill.LinkedOrderId !== orderId) throw new Error("Order sync: bill belongs to a different order.");
            bySerial.set(serial, bill);
          }
          if (bySerial.size !== expected.length) throw new Error("Order sync: some linked bills could not be read. No summary was changed.");
          const activeEntries = [...bySerial.entries()].filter(([, bill]) => bill.deleted !== true);
          const bills = activeEntries.map(([, bill]) => bill);
          const patch = { paymentStatus: paymentStatus(bills), updatedAt: Date.now() };
          if (delivery) {
            const suppliers = deliveredSuppliers(order, bills);
            const closed = closeOrder || order.deliveryClosedManually === true;
            const complete = suppliers.every(s => s.delivered >= number(s.quantity, "ordered quantity"));
            patch.suppliers = suppliers;
            patch.status = ["Deleted", "Cancelled"].includes(order.status) ? order.status :
              closed || complete ? "Completed" : suppliers.some(s => s.delivered > 0) ? "Partial" : "Pending";
            // Archived bills remain recoverable, but are not active delivery
            // evidence and must not stay visible as an active order badge.
            patch.linkedBillNos = activeEntries.map(([serial]) => serial).sort();
            if (closeOrder) patch.deliveryClosedManually = true;
          }
          transaction.update(orderRef, patch);
          return patch;
        });
      } catch (error) {
        if (error.code !== "order-links-changed" || attempt === 2) throw error;
      }
    }
  }
  global.MandiOrderSync = Object.freeze({ sync, serials, deliveredSuppliers });
})(window);
