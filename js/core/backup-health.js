/* Small backup metadata only. No automatic database exports or file uploads. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (!root.MandiBackupHealth) { root.MandiBackupHealth = factory(); root.MandiBackupHealth.start(); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DAY = 86400000, CACHE_TTL = 15 * 60000;
  let memory = null, pending = null, revision = 0;
  function validEntry(entry, project, now = Date.now()) {
    return entry && typeof project === "string" && project.length > 0 && entry.projectId === project && /^[a-f0-9]{64}$/.test(entry.hash || "") &&
      Number.isFinite(Date.parse(entry.exportedAt)) && Date.parse(entry.exportedAt) <= now + 300000 &&
      Number.isSafeInteger(entry.documents) && entry.documents >= 0 && [15, 18].includes(entry.collections);
  }
  function entries(info, project) {
    const legacy = { projectId: info?.lastVerifiedProjectId, hash: info?.lastVerifiedHash,
      exportedAt: info?.lastVerifiedExportedAt, documents: info?.lastVerifiedDocumentCount,
      collections: info?.lastVerifiedCollectionCount, filename: info?.lastVerifiedFilename || "Verified recovery copy" };
    const found = new Map();
    for (const item of [legacy, ...(Array.isArray(info?.verifiedCopies) ? info.verifiedCopies : [])]) {
      if (validEntry(item, project)) found.set(item.hash, item);
    }
    return [...found.values()].sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt)).slice(0, 12);
  }
  function mergeVerified(info, entry) {
    if (!validEntry(entry, entry.projectId)) throw new Error("Invalid verification history metadata or future export date.");
    const verifiedCopies = entries({ ...info, verifiedCopies: [...entries(info, entry.projectId), entry] }, entry.projectId);
    const newest = verifiedCopies[0];
    return { verifiedCopies, lastVerifiedExportedAt: newest.exportedAt, lastVerifiedFilename: newest.filename,
      lastVerifiedHash: newest.hash, lastVerifiedDocumentCount: newest.documents,
      lastVerifiedCollectionCount: newest.collections, lastVerifiedProjectId: newest.projectId,
      lastVerificationMethod: newest.method || "selected-local-file" };
  }
  function health(info, project, intervalDays = 1, now = Date.now()) {
    const copies = entries(info, project), newest = copies[0];
    const days = [1, 3, 7].includes(Number(intervalDays)) ? Number(intervalDays) : 1;
    if (!newest) return { due: true, copies, message: "No verified recovery copy recorded. Prepare, save and verify a backup." };
    if (newest.collections !== 18) return { due: true, copies, message: "Your older backup does not include revision and year-close history. Keep it and prepare a new full recovery copy." };
    const dueAt = Date.parse(newest.exportedAt) + days * DAY;
    const when = new Date(newest.exportedAt).toLocaleString("en-IN");
    return { due: now >= dueAt, dueAt, copies, message: now >= dueAt ? `Backup due · latest verified data: ${when}.` : `Latest verified backup data: ${when}. Next reminder: ${new Date(dueAt).toLocaleString("en-IN")}.` };
  }
  function identity() {
    if (window.currentUserProfile?.role !== "admin" || !window.firebase?.auth().currentUser) return null;
    return `${firebase.app().options.projectId}:${firebase.auth().currentUser.uid}`;
  }
  function storageRead(store, key) { try { return JSON.parse(store.getItem(key)); } catch { return null; } }
  function preference() {
    const key = identity();
    let value;
    try { value = storageRead(localStorage, `mandibook:backup-interval:${key}`); } catch {}
    return [1, 3, 7].includes(value) ? value : 1;
  }
  function cache(info, key) {
    const value = { info, key, at: Date.now() }; memory = value;
    try { sessionStorage.setItem(`mandibook:backup-health:${key}`, JSON.stringify(value)); } catch {}
  }
  function render(info, unknown = false) {
    const key = identity();
    let banner = document.getElementById("backup-health-banner");
    if (!key) { banner?.remove(); return; }
    const project = firebase.app().options.projectId, result = health(info, project, preference());
    const target = document.getElementById("last-backup-reminder");
    const message = unknown ? "Backup history unavailable. Verify a local file to check your recovery copy." : result.message;
    if (target) { target.textContent = `${message} File availability is not monitored.`; target.dataset.kind = unknown || result.due ? "warning" : "verified"; }
    if (!banner && document.getElementById("navbar-root") && !target) {
      banner = document.createElement("aside"); banner.id = "backup-health-banner"; banner.className = "backup-health-banner";
      banner.setAttribute("aria-label", "Backup reminder");
      const text = document.createElement("span"), link = document.createElement("a");
      link.href = "core_settings.html#backup"; link.textContent = "Open backup centre →";
      banner.append(text, link); document.getElementById("navbar-root").after(banner);
    }
    if (banner) { banner.hidden = !unknown && !result.due; banner.querySelector("span").textContent = message; }
    const select = document.getElementById("backup-reminder-frequency"); if (select) select.value = String(preference());
    const history = document.getElementById("backup-copy-history");
    if (history) {
      history.replaceChildren();
      if (!result.copies.length) { const p = document.createElement("p"); p.textContent = "Verified file details will appear here. This list stores metadata, not recoverable files."; history.append(p); }
      result.copies.forEach(entry => {
        const row = document.createElement("div"), date = document.createElement("strong"), detail = document.createElement("span");
        row.className = "backup-history-row"; date.textContent = new Date(entry.exportedAt).toLocaleString("en-IN");
        detail.textContent = `${entry.documents.toLocaleString("en-IN")} records · ${entry.filename}`;
        row.append(date, detail); history.append(row);
      });
    }
    const retention = document.getElementById("backup-retention-note");
    if (retention) retention.textContent = `${result.copies.length} distinct verified versions recorded (latest 12 shown). Keep at least 3 dated files and an independent protected copy. No files are automatically deleted or stored by this history.`;
  }
  async function refresh(force = false) {
    const key = identity();
    if (!key) { document.getElementById("backup-health-banner")?.remove(); return; }
    if (pending?.key === key) return pending.promise;
    let stored = memory?.key === key ? memory : null;
    try { stored ||= storageRead(sessionStorage, `mandibook:backup-health:${key}`); } catch {}
    if (!force && stored?.key === key && Date.now() >= stored.at && Date.now() - stored.at < CACHE_TTL) { memory = stored; render(stored.info); return; }
    let timer;
    const startedAtRevision = revision;
    const operation = (async () => {
      try {
        const doc = await Promise.race([db.collection("settings").doc("backupInfo").get({ source: "server" }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("History timeout")), 10000); })]);
        if (identity() !== key || startedAtRevision !== revision) return;
        const info = doc.exists ? doc.data() : {}; cache(info, key); render(info);
      } catch { if (identity() === key && startedAtRevision === revision) render(stored?.info || {}, true); }
      finally { clearTimeout(timer); if (pending?.key === key) pending = null; }
    })();
    pending = { key, promise: operation }; return operation;
  }
  function accept(info) { const key = identity(); if (key) { revision++; cache(info, key); render(info); } }
  function start() {
    const bind = () => {
      document.getElementById("backup-reminder-frequency")?.addEventListener("change", event => {
        try { localStorage.setItem(`mandibook:backup-interval:${identity()}`, JSON.stringify(Number(event.target.value))); }
        catch { event.target.value = "1"; }
        refresh();
      });
      refresh();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
    window.addEventListener("mandibook:access-ready", () => refresh());
    // Only metadata is checked when the app regains focus; no continuous reads.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }
  return { entries, mergeVerified, health, refresh, accept, start };
});
