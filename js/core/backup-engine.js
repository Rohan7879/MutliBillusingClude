/* Lossless, read-only recovery exports. Also used by the offline verifier. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MandiBackup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const COLLECTIONS = Object.freeze(["bills", "payments", "parties", "orders", "settings", "brokers", "broker_payments", "products", "varieties", "customers", "counters", "users", "mobileDirectory", "auditLogs", "sharedBills"]);
  const FORMAT = "mandibook-firestore-backup";
  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Unencoded value in backup.");
    return JSON.stringify(value);
  }
  function requireCrypto() {
    const crypto = globalThis.crypto;
    if (!crypto?.subtle) throw new Error("Secure verification is unavailable. Open the app over HTTPS or localhost; an unchecked backup will not be created.");
    return crypto;
  }
  async function hash(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await requireCrypto().subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function toBase64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function fromBase64(text) {
    if (typeof text !== "string" || text.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error("Invalid binary encoding.");
    return typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(text, "base64")) : Uint8Array.from(atob(text), char => char.charCodeAt(0));
  }
  function encode(value, sdk = {}, depth = 0) {
    if (depth > 100) throw new Error("Data nesting is too deep to safely export.");
    const is = type => typeof sdk[type] === "function" && value instanceof sdk[type];
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("A large numeric value needs an owner-managed server export to avoid JavaScript precision loss.");
      return Number.isFinite(value) && !Object.is(value, -0) ? value : { type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    }
    if (is("Timestamp")) return { type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
    if (is("GeoPoint")) return { type: "geopoint", latitude: value.latitude, longitude: value.longitude };
    if (is("DocumentReference")) return { type: "reference", path: value.path, projectId: value.firestore?.app?.options?.projectId || null };
    if (is("Blob")) return { type: "bytes", base64: value.toBase64() };
    if (value instanceof Uint8Array) return { type: "bytes", base64: toBase64(value) };
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new Error("Invalid date cannot be exported.");
      return { type: "date", value: value.toISOString() };
    }
    if (Array.isArray(value)) return { type: "array", items: value.map(item => encode(item, sdk, depth + 1)) };
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return { type: "map", entries: Object.keys(value).sort(compare).map(key => [key, encode(value[key], sdk, depth + 1)]) };
    throw new Error("Unsupported data type. Export stopped instead of silently dropping a value.");
  }
  function decode(value, sdk = {}, db = null, depth = 0) {
    if (depth > 100) throw new Error("Backup nesting exceeds the safety limit.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("Unsafe numeric precision in backup.");
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid encoded backup value.");
    switch (value.type) {
      case "map": {
        if (!Array.isArray(value.entries)) throw new Error("Invalid map.");
        const keys = new Set();
        return Object.fromEntries(value.entries.map(entry => {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0])) throw new Error("Invalid or duplicate map field.");
          keys.add(entry[0]); return [entry[0], decode(entry[1], sdk, db, depth + 1)];
        }));
      }
      case "array":
        if (!Array.isArray(value.items)) throw new Error("Invalid array.");
        return value.items.map(item => decode(item, sdk, db, depth + 1));
      case "timestamp":
        if (!Number.isInteger(value.seconds) || value.seconds < -62135596800 || value.seconds > 253402300799 || !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds >= 1e9) throw new Error("Invalid timestamp.");
        return sdk.Timestamp ? new sdk.Timestamp(value.seconds, value.nanoseconds) : value;
      case "geopoint":
        if (!Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) throw new Error("Invalid location value.");
        return sdk.GeoPoint ? new sdk.GeoPoint(value.latitude, value.longitude) : value;
      case "reference":
        if (!validDocumentPath(value.path) || (value.projectId !== null && typeof value.projectId !== "string")) throw new Error("Invalid document reference.");
        return db ? db.doc(value.path) : value;
      case "bytes": { const bytes = fromBase64(value.base64); return sdk.Blob?.fromUint8Array ? sdk.Blob.fromUint8Array(bytes) : bytes; }
      case "date":
        if (typeof value.value !== "string" || new Date(value.value).toISOString() !== value.value) throw new Error("Invalid date.");
        return new Date(value.value);
      case "number":
        if (!["NaN", "Infinity", "-Infinity", "-0"].includes(value.value)) throw new Error("Invalid special number.");
        return value.value === "-0" ? -0 : Number(value.value);
      default: throw new Error("Unknown backup value type.");
    }
  }
  function validDocumentPath(path) {
    return typeof path === "string" && path.split("/").length % 2 === 0 && path.split("/").every(part => part && part !== "." && part !== "..");
  }
  async function timed(promise, message, milliseconds = 45000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  function createReadBudget(limit = 10000) {
    if (!Number.isInteger(limit) || limit < 30 || limit > 20000) throw new Error("Choose a backup read allowance between 30 and 20,000.");
    return { limit, used: 0 };
  }
  async function readCollection(db, sdk, collection, { pageSize = 500, guard = () => {}, onProgress = () => {}, pass = 1, timeoutMs = 45000, budget = null } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Invalid backup page size.");
    let cursor = null;
    const rows = [], seen = new Set();
    for (;;) {
      guard();
      const remaining = budget ? budget.limit - budget.used : pageSize;
      if (remaining < 1) throw new Error("Backup read allowance reached. No partial copy was created. Check Firebase usage before increasing the allowance; do not repeatedly retry.");
      const requestSize = Math.min(pageSize, remaining);
      let query = db.collection(collection).orderBy(sdk.FieldPath.documentId()).limit(requestSize);
      if (cursor) query = query.startAfter(cursor);
      let snapshot;
      try { snapshot = await timed(query.get({ source: "server" }), `Server read timed out for ${collection}. No partial backup was created.`, timeoutMs); }
      catch (error) { throw new Error(`${collection}: ${error.message || "server read failed"}`); }
      if (budget) budget.used += Math.max(1, snapshot.docs.length);
      if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error(`${collection}: unconfirmed/cache data detected. Backup stopped.`);
      for (const doc of snapshot.docs) {
        if (seen.has(doc.id) || typeof doc.id !== "string" || !doc.id || doc.id.includes("/")) throw new Error(`${collection}: invalid or repeated document ID.`);
        seen.add(doc.id);
        rows.push({ id: doc.id, data: encode(doc.data(), sdk) });
      }
      onProgress({ collection, pass, documents: rows.length, documentReads: budget?.used, readLimit: budget?.limit });
      if (snapshot.docs.length < requestSize) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    return rows.sort((a, b) => compare(a.id, b.id));
  }
  async function capture({ db, sdk, projectId, exportedBy, guard = () => {}, onProgress = () => {}, pageSize = 500, timeoutMs = 45000, readLimit = 10000 }) {
    requireCrypto(); guard();
    const budget = createReadBudget(readLimit);
    if (!projectId) throw new Error("Source project could not be identified.");
    if (db.waitForPendingWrites) await timed(db.waitForPendingWrites(), "Local changes have not synced. Wait for sync before backing up.", timeoutMs);
    const backup = { format: FORMAT, version: 3, projectId, databaseId: "(default)", backupId: requireCrypto().randomUUID(), startedAt: new Date().toISOString(), exportedBy, collections: [...COLLECTIONS],
      scope: { firestore: "known-app-root-collections", archivedIncluded: true, authAccountsIncluded: false, storageFilesIncluded: false, subcollectionsIncluded: false },
      consistency: { method: "two-pass-content-comparison", atomicSnapshot: false, writesMustBePaused: true }, data: {}, manifest: {}, totalDocuments: 0 };
    for (let i = 0; i < COLLECTIONS.length; i++) {
      const collection = COLLECTIONS[i];
      onProgress({ collection, pass: 1, index: i, total: COLLECTIONS.length });
      const rows = await readCollection(db, sdk, collection, { pageSize, guard, onProgress, timeoutMs, budget });
      backup.data[collection] = rows;
      backup.manifest[collection] = { documents: rows.length, sha256: await hash(canonical(rows)) };
      backup.totalDocuments += rows.length;
    }
    // Not an atomic snapshot: operators must pause writes during the entire
    // export. A second pass detects observed changes instead of masking them.
    for (let i = 0; i < COLLECTIONS.length; i++) {
      const collection = COLLECTIONS[i];
      onProgress({ collection, pass: 2, index: i, total: COLLECTIONS.length });
      const rows = await readCollection(db, sdk, collection, { pageSize, guard, onProgress, pass: 2, timeoutMs, budget });
      if (await hash(canonical(rows)) !== backup.manifest[collection].sha256) throw new Error(`${collection} changed during backup. Pause staff activity and prepare a new backup.`);
    }
    guard(); backup.exportedAt = new Date().toISOString();
    backup.readUsage = { documentReads: budget.used, allowance: budget.limit, excludesRulesAndOtherAppUsage: true };
    backup.integrity = { algorithm: "SHA-256", payloadHash: await hash(canonical(backup)) };
    await verify(backup, projectId);
    return backup;
  }
  async function verify(input, expectedProject = null) {
    const backup = typeof input === "string" ? JSON.parse(input) : input;
    if (!backup || backup.format !== FORMAT || ![2, 3].includes(backup.version)) throw new Error("This is not a supported MandiBook recovery backup. Excel reports cannot restore full records.");
    const { integrity, ...payload } = backup;
    if (integrity?.algorithm !== "SHA-256" || !/^[a-f0-9]{64}$/.test(integrity.payloadHash || "")) throw new Error("Backup has no valid checksum. Treat it as an unverified legacy copy.");
    const calculated = await hash(backup.version === 3 ? canonical(payload) : JSON.stringify(payload, null, 2));
    if (calculated !== integrity.payloadHash) throw new Error("Backup checksum does not match. File may be incomplete or changed; do not restore it.");
    if (!Array.isArray(backup.collections) || new Set(backup.collections).size !== backup.collections.length) throw new Error("Invalid collection manifest.");
    if (backup.version === 3 && (typeof backup.projectId !== "string" || backup.databaseId !== "(default)" || COLLECTIONS.some(collection => !backup.collections.includes(collection)))) throw new Error("Recovery backup is missing required app collections or source information.");
    if (backup.version === 3 && (![backup.startedAt, backup.exportedAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date))) || Date.parse(backup.exportedAt) < Date.parse(backup.startedAt) || typeof backup.backupId !== "string" || !backup.backupId || backup.scope?.firestore !== "known-app-root-collections" || backup.scope?.archivedIncluded !== true || backup.consistency?.method !== "two-pass-content-comparison")) throw new Error("Invalid recovery metadata or coverage information.");
    let totalDocuments = 0;
    const counts = {};
    for (const collection of backup.collections) {
      if (typeof collection !== "string" || collection.includes("/") || !collection || ["__proto__", "constructor", "prototype"].includes(collection)) throw new Error("Invalid collection name.");
      const rows = backup.version === 3 ? backup.data?.[collection] : backup[collection];
      if (!Array.isArray(rows)) throw new Error(`Collection ${collection} is missing.`);
      const ids = new Set();
      for (const doc of rows) {
        if (!doc || typeof doc.id !== "string" || !doc.id || doc.id.includes("/") || [".", ".."].includes(doc.id) || ids.has(doc.id) || !own(doc, "data")) throw new Error(`Invalid/duplicate document in ${collection}.`);
        ids.add(doc.id);
        if (backup.version === 3) { if (doc.data?.type !== "map") throw new Error("Document root must be a map."); decode(doc.data); }
      }
      if (backup.version === 3 && (backup.manifest?.[collection]?.documents !== rows.length || backup.manifest[collection].sha256 !== await hash(canonical(rows)))) throw new Error(`Count/checksum mismatch in ${collection}.`);
      counts[collection] = rows.length; totalDocuments += rows.length;
    }
    if (backup.version === 3 && backup.totalDocuments !== totalDocuments) throw new Error("Total document count does not match the manifest.");
    if (backup.version === 3 && (Object.keys(backup.data).some(collection => !backup.collections.includes(collection)) || Object.keys(backup.manifest).some(collection => !backup.collections.includes(collection)))) throw new Error("Undeclared collection in backup data.");
    return { backup, counts, totalDocuments, legacy: backup.version === 2, projectMatches: !expectedProject || backup.projectId === expectedProject, missingCollections: COLLECTIONS.filter(collection => !backup.collections.includes(collection)) };
  }
  async function passwordKey(password, salt, usage) {
    if (typeof password !== "string" || password.length < 12) throw new Error("Use a backup password of at least 12 characters.");
    const crypto = requireCrypto();
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  async function encrypt(text, password) {
    const crypto = requireCrypto(), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await passwordKey(password, salt, "encrypt");
    const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    return { format: "mandibook-encrypted-backup", version: 1, algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA256", iterations: 250000, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(bytes)) };
  }
  async function decrypt(envelope, password) {
    if (envelope?.format !== "mandibook-encrypted-backup" || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM" || envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations !== 250000) throw new Error("Unsupported encrypted backup.");
    const salt = fromBase64(envelope.salt), iv = fromBase64(envelope.iv), ciphertext = fromBase64(envelope.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error("Invalid encrypted backup metadata.");
    const key = await passwordKey(password, salt, "decrypt");
    try { const bytes = await requireCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext); return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Incorrect password or damaged encrypted backup. Nothing was restored."); }
  }
  function reviewRecords(backup) {
    if (backup.version !== 3) return [{ code: "legacy-scope", message: "Legacy copy: prepare a current full app backup before reviewing record links." }];
    const rows = name => backup.data[name].map(doc => ({ id: doc.id, data: decode(doc.data) }));
    const bills = rows("bills"), parties = rows("parties"), payments = rows("payments");
    const billIds = new Set(bills.map(doc => doc.id)), partyIds = new Set(parties.map(doc => doc.id));
    const warnings = [];
    const add = (code, collection, id, message) => warnings.push({ code, collection, id, message });
    for (const { id, data } of bills) {
      const total = Number(data["Final Total"]), paid = Number(data.amountPaid ?? 0);
      if (!Number.isFinite(total) || total < 0 || !Number.isFinite(paid) || paid < 0 || paid > total + .01) add("bill-amount", "bills", id, "Invalid/overpaid bill amount; owner review needed.");
      else if (own(data, "amountDue") && (!Number.isFinite(Number(data.amountDue)) || Math.abs(Number(data.amountDue) - Math.max(0, total - paid)) > .01)) add("bill-due", "bills", id, "Stored due differs from total minus recorded paid amount.");
      if (data.customerId && !partyIds.has(data.customerId)) add("missing-party", "bills", id, "Linked party is absent from this copy.");
      if (!data.customerId && data.deleted !== true) add("legacy-party-link", "bills", id, "No party ID stored; name-only legacy links require manual review.");
    }
    for (const { id, data } of payments) {
      if (data.deleted === true) continue;
      if (own(data, "cashAmount") && own(data, "totalCredit")) {
        const cash = Number(data.cashAmount), deduction = Number(data.deductionAmount ?? 0), credit = Number(data.totalCredit);
        if (![cash, deduction, credit].every(Number.isFinite) || Math.abs(cash + deduction - credit) > .01) add("payment-total", "payments", id, "Payment total differs from cash plus deduction.");
      }
      if (data.customerId && !partyIds.has(data.customerId)) add("missing-party", "payments", id, "Payment's party is absent from this copy.");
      if (own(data, "appliedToBills") && !Array.isArray(data.appliedToBills)) add("invalid-bill-links", "payments", id, "Payment bill links are not a list.");
      else for (const billId of data.appliedToBills || []) if (!billIds.has(billId)) add("missing-bill", "payments", id, "A linked bill is absent from this copy.");
    }
    return warnings;
  }
  async function compareBackups(before, after, expectedProject) {
    const previous = await verify(before, expectedProject), current = await verify(after, expectedProject);
    if (previous.legacy || current.legacy || !previous.projectMatches || !current.projectMatches || previous.backup.projectId !== current.backup.projectId) throw new Error("Compare two current-format backups from the same app project.");
    if (Date.parse(previous.backup.exportedAt) > Date.parse(current.backup.exportedAt)) throw new Error("The earlier copy is newer. Swap the two selected files.");
    const collections = {}, totals = { added: 0, changed: 0, removed: 0, unchanged: 0 };
    for (const name of current.backup.collections) {
      const old = new Map(previous.backup.data[name].map(doc => [doc.id, doc.data]));
      const counts = { added: 0, changed: 0, removed: 0, unchanged: 0 };
      for (const doc of current.backup.data[name]) {
        if (!old.has(doc.id)) counts.added++;
        else { counts[canonical(old.get(doc.id)) === canonical(doc.data) ? "unchanged" : "changed"]++; old.delete(doc.id); }
      }
      counts.removed = old.size;
      collections[name] = counts;
      Object.keys(totals).forEach(key => { totals[key] += counts[key]; });
    }
    return { projectId: current.backup.projectId, earlier: previous.backup.exportedAt, later: current.backup.exportedAt, identicalFile: previous.backup.integrity.payloadHash === current.backup.integrity.payloadHash, collections, totals };
  }
  return { COLLECTIONS, FORMAT, MAX_FILE_BYTES, canonical, encode, decode, hash, capture, verify, readCollection, createReadBudget, compareBackups, encrypt, decrypt, reviewRecords };
});
