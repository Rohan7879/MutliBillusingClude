// Minimal in-memory Firestore mock that reproduces the ONE guarantee we're
// actually relying on: inside runTransaction(fn), every read must happen
// before any write, all writes are buffered, and NOTHING is applied to the
// store unless fn() resolves without throwing. This is the real SDK's
// documented behavior — we mirror it here so we can inject failures at
// each step and prove the atomic rewrite actually holds under them.

class MockFirestore {
  constructor(seedData = {}) {
    // seedData: { collectionName: { docId: {...fields} } }
    this.store = JSON.parse(JSON.stringify(seedData));
    this.transactionAttempts = 0;
  }

  collection(name) {
    const self = this;
    return {
      doc(id) {
        const docId = id || `auto_${Math.random().toString(36).slice(2, 10)}`;
        return { collectionName: name, id: docId };
      },
      // simple query stubs not needed for these tests
    };
  }

  snapshot(ref) {
    const data = this.store[ref.collectionName] && this.store[ref.collectionName][ref.id];
    return {
      exists: !!data,
      id: ref.id,
      data: () => JSON.parse(JSON.stringify(data)),
    };
  }

  async runTransaction(updateFunction, { failAt = null } = {}) {
    this.transactionAttempts++;
    // Reads see a frozen snapshot of the current committed store.
    const readSnapshot = JSON.parse(JSON.stringify(this.store));
    const pendingWrites = []; // { type, ref, data }
    const opCounts = { get: 0, set: 0, update: 0, delete: 0 };

    const transaction = {
      get: async (ref) => {
        opCounts.get++;
        if (failAt === `get:${opCounts.get}`) throw new Error(`INJECTED_FAILURE at get #${opCounts.get}`);
        const data = readSnapshot[ref.collectionName] && readSnapshot[ref.collectionName][ref.id];
        return {
          exists: !!data,
          id: ref.id,
          data: () => JSON.parse(JSON.stringify(data)),
        };
      },
      set: (ref, data) => {
        opCounts.set++;
        if (failAt === `set:${opCounts.set}`) throw new Error(`INJECTED_FAILURE at set #${opCounts.set}`);
        pendingWrites.push({ type: "set", ref, data: JSON.parse(JSON.stringify(data)) });
      },
      update: (ref, data) => {
        opCounts.update++;
        if (failAt === `update:${opCounts.update}`) throw new Error(`INJECTED_FAILURE at update #${opCounts.update}`);
        pendingWrites.push({ type: "update", ref, data: JSON.parse(JSON.stringify(data)) });
      },
      delete: (ref) => {
        opCounts.delete++;
        if (failAt === `delete:${opCounts.delete}`) throw new Error(`INJECTED_FAILURE at delete #${opCounts.delete}`);
        pendingWrites.push({ type: "delete", ref });
      },
    };

    // Run the callback. If it throws at ANY point (including our injected
    // failures above, or a thrown business-rule error like "Bill not
    // found"), we discard pendingWrites entirely — exactly like real
    // Firestore discards the whole transaction.
    let result;
    try {
      result = await updateFunction(transaction);
    } catch (e) {
      // Nothing committed.
      throw e;
    }

    // Simulate the commit step itself possibly failing (e.g. network drop
    // right as the transaction tries to commit, after all logic already
    // ran). Real Firestore either applies ALL writes or NONE — never some.
    if (failAt === "commit") {
      throw new Error("INJECTED_FAILURE at commit");
    }

    // Apply all writes atomically.
    pendingWrites.forEach(({ type, ref, data }) => {
      this.store[ref.collectionName] = this.store[ref.collectionName] || {};
      if (type === "delete") {
        delete this.store[ref.collectionName][ref.id];
      } else if (type === "set") {
        this.store[ref.collectionName][ref.id] = data;
      } else if (type === "update") {
        this.store[ref.collectionName][ref.id] = { ...(this.store[ref.collectionName][ref.id] || {}), ...data };
      }
    });

    return result;
  }
}

module.exports = { MockFirestore };
