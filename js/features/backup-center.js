/* Backup preparation and local-file verification. Never restores live data. */
(function () {
  "use strict";
  const state = { busy: false, ready: null, cancelled: false, verified: null };
  const el = id => document.getElementById(id);
  function adminGuard() {
    if (!window.currentUserProfile || window.currentUserProfile.role !== "admin" || !firebase.auth().currentUser) throw new Error("An approved Admin must be signed in to prepare or verify recovery backups.");
    if (state.cancelled) throw new Error("Backup cancelled. No partial backup was downloaded.");
  }
  const projectId = () => firebase.app().options.projectId;
  async function optionalMetadata(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Backup history update timed out.")), 10000); })]); }
    finally { clearTimeout(timer); }
  }
  const filename = backup => `MandiBook_FullBackup_${backup.projectId}_${backup.exportedAt.replace(/[:.]/g, "-")}_${backup.backupId.slice(0, 8)}.json`;
  function status(message, kind = "info") {
    const target = el("backup-status");
    if (target) { target.textContent = message; target.dataset.kind = kind; }
  }
  function setBusy(value, allowCancel = false) {
    state.busy = value;
    ["backup-build", "backup-save", "backup-verify-file", "backup-compare-file", "backup-read-limit", "backup-encrypt", "backup-password", "backup-password-confirm", "backup-quiescent"].forEach(id => { if (el(id)) el(id).disabled = value || (id === "backup-save" && !state.ready); });
    if (el("backup-cancel")) el("backup-cancel").hidden = !value || !allowCancel;
    document.querySelectorAll(".backup-secondary button").forEach(button => { button.disabled = value; });
  }
  function progress(info) {
    const percentage = Math.round(((info.pass - 1) * MandiBackup.COLLECTIONS.length + MandiBackup.COLLECTIONS.indexOf(info.collection)) / (MandiBackup.COLLECTIONS.length * 2) * 95);
    if (el("backup-progress")) { el("backup-progress").hidden = false; el("backup-progress").value = percentage; }
    status(`${info.pass === 1 ? "Reading from server" : "Checking for changes"}: ${info.collection}${info.documents !== undefined ? ` · ${info.documents} records` : ""}. Keep this page open.`);
    if (el("backup-read-usage") && info.documentReads !== undefined) el("backup-read-usage").textContent = `${info.documentReads.toLocaleString("en-IN")} / ${info.readLimit.toLocaleString("en-IN")} document reads used in this preparation. Rules checks and other app use are additional.`;
  }
  function showManifest(result) {
    const target = el("backup-manifest");
    if (target) {
      target.replaceChildren();
      Object.entries(result.counts).forEach(([name, count]) => {
        const row = document.createElement("div"), label = document.createElement("span"), value = document.createElement("strong");
        row.className = "backup-collection"; label.textContent = name; value.textContent = count.toLocaleString("en-IN"); row.append(label, value); target.append(row);
      });
    }
    if (el("backup-document-count")) el("backup-document-count").textContent = result.totalDocuments.toLocaleString("en-IN");
    if (el("backup-collection-count")) el("backup-collection-count").textContent = Object.keys(result.counts).length;
    if (el("backup-source")) el("backup-source").textContent = result.backup.projectId || "Legacy / unknown source";
    if (el("backup-exported-at")) el("backup-exported-at").textContent = new Date(result.backup.exportedAt).toLocaleString("en-IN");
    const review = el("backup-review");
    if (review) {
      const warnings = MandiBackup.reviewRecords(result.backup);
      review.replaceChildren();
      const heading = document.createElement("p");
      heading.textContent = warnings.length ? `${warnings.length} accounting/link warnings. Records are preserved unchanged; review before recovery. File integrity and accounting correctness are separate checks.` : "No amount/link warnings found by these checks. This is not a full ledger reconciliation.";
      review.append(heading);
      warnings.slice(0, 100).forEach(item => { const detail = document.createElement("p"); detail.textContent = `${item.collection || "Backup"}${item.id ? ` / ${item.id}` : ""}: ${item.message}`; review.append(detail); });
      if (warnings.length > 100) { const note = document.createElement("p"); note.textContent = "Showing the first 100 warnings. The offline verification tool reports the full warning count."; review.append(note); }
    }
  }
  async function build() {
    if (state.busy) return;
    state.cancelled = false;
    try {
      adminGuard();
      if (el("backup-quiescent") && !el("backup-quiescent").checked) throw new Error("Pause billing, payments and staff changes, then tick the confirmation before preparing a backup.");
      const uid = firebase.auth().currentUser.uid;
      setBusy(true, true); state.ready = null; state.verified = null;
      if (el("backup-comparison")) el("backup-comparison").textContent = "Verify the new saved file before comparing it with an earlier copy.";
      if (el("backup-save")) el("backup-save").disabled = true;
      const guard = () => { adminGuard(); if (firebase.auth().currentUser.uid !== uid) throw new Error("Signed-in account changed. Prepare a new backup."); };
      const backup = await MandiBackup.capture({ db, sdk: firebase.firestore, projectId: projectId(), exportedBy: firebase.auth().currentUser.email || uid, guard, onProgress: progress, readLimit: Number(el("backup-read-limit")?.value || 10000) });
      const text = JSON.stringify(backup, null, 2);
      if (new Blob([text]).size > MandiBackup.MAX_FILE_BYTES) throw new Error("This backup exceeds the browser's safe 200 MB limit. Use an owner-managed server export; no truncated copy was created.");
      state.ready = { backup, text, filename: filename(backup) };
      showManifest(await MandiBackup.verify(text, projectId()));
      if (el("backup-progress")) el("backup-progress").value = 100;
      status(`${backup.totalDocuments.toLocaleString("en-IN")} records prepared and checksummed across ${backup.collections.length} collections. Now save the recovery file; preparation alone is not a saved backup.`, "ready");
      if (!el("backup-save")) {
        const choice = await Swal.fire({ icon: "info", title: "Recovery copy prepared", text: "Save the JSON file, then verify the saved copy in Settings. This includes app Firestore records, not Firebase Auth passwords or uploaded files.", showCancelButton: true, confirmButtonText: "Save recovery copy" });
        if (choice.isConfirmed) { setBusy(false); await save(); }
      }
    } catch (error) {
      state.ready = null;
      status(error.message, state.cancelled ? "info" : "error");
      if (!el("backup-status")) Swal.fire({ icon: "error", title: "Backup was not created", text: error.message });
    } finally { setBusy(false); if (el("backup-cancel")) el("backup-cancel").hidden = true; }
  }
  async function save() {
    if (state.busy || !state.ready) return;
    state.cancelled = false;
    let writable, password = "", handle = null;
    try {
      adminGuard();
      const ready = state.ready;
      const encrypted = el("backup-encrypt")?.checked === true;
      if (encrypted) {
        password = el("backup-password").value;
        if (password.length < 12 || password !== el("backup-password-confirm").value) throw new Error("Enter matching backup passwords of at least 12 characters. A lost password cannot be recovered.");
      }
      const name = encrypted ? ready.filename.replace(/\.json$/, ".encrypted.json") : ready.filename;
      setBusy(true);
      // The picker is invoked directly from the Save click, before any await
      // that could consume transient browser user activation.
      if (window.showSaveFilePicker) {
        try { handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "MandiBook recovery backup", accept: { "application/json": [".json"] } }] }); }
        catch (error) {
          if (error.name === "AbortError") { status("Save cancelled. The prepared copy is still available; no saved backup was recorded."); return; }
          if (!["SecurityError", "NotSupportedError"].includes(error.name)) throw error;
        }
      }
      status(encrypted ? "Encrypting recovery file locally… Keep this page open." : "Preparing saved recovery file…");
      const text = encrypted ? JSON.stringify(await MandiBackup.encrypt(ready.text, password), null, 2) : ready.text;
      const blob = new Blob([text], { type: "application/json" });
      if (blob.size > MandiBackup.MAX_FILE_BYTES) throw new Error("Encrypted file exceeds the browser verification size limit. Use an owner-managed export for this data size.");
      if (handle) {
        status("Writing recovery file, then reading it back for verification…");
        writable = await handle.createWritable(); await writable.write(blob); await writable.close(); writable = null;
        const savedFile = await handle.getFile();
        const result = await inspectText(await savedFile.text(), password);
        if (!result.projectMatches || result.backup.backupId !== ready.backup.backupId || result.backup.integrity.payloadHash !== ready.backup.integrity.payloadHash) throw new Error("Saved file does not exactly match the prepared recovery copy.");
        state.verified = result;
        const tracked = await recordVerified(result, savedFile.name || name, "file-picker-readback");
        status(`Saved file read back and verified: ${savedFile.name || name} · ${result.totalDocuments} records.${tracked ? "" : " File is verified, but the app could not update backup history."}`, "verified");
      } else {
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        status(`Download requested: ${name}. Your browser cannot confirm disk saving. Select the downloaded file below to verify it before treating it as a recovery copy.`, "warning");
        try { await optionalMetadata(db.collection("settings").doc("backupInfo").set({ lastDownloadRequestedAt: firebase.firestore.FieldValue.serverTimestamp(), lastDownloadFilename: name }, { merge: true })); } catch { /* Never turn a download request into a verified success. */ }
      }
    } catch (error) {
      if (writable?.abort) { try { await writable.abort(); } catch {} }
      status(`Backup save was not confirmed: ${error.message} Retry Save; keep any earlier verified backup.`, "error");
      if (!el("backup-status")) Swal.fire({ icon: "error", title: "Save not confirmed", text: error.message });
    } finally {
      password = "";
      if (el("backup-password")) el("backup-password").value = "";
      if (el("backup-password-confirm")) el("backup-password-confirm").value = "";
      setBusy(false);
    }
  }
  async function inspectText(text, password = "") {
    if (new Blob([text]).size > MandiBackup.MAX_FILE_BYTES) throw new Error("Backup is too large to verify safely in this browser. Use the offline verifier.");
    let input = JSON.parse(text);
    if (input?.format === "mandibook-encrypted-backup") input = JSON.parse(await MandiBackup.decrypt(input, password));
    return MandiBackup.verify(input, projectId());
  }
  async function verifyFile(file) {
    if (state.busy || !file) return;
    state.cancelled = false;
    let password = "";
    try {
      adminGuard(); setBusy(true); state.verified = null;
      if (el("backup-comparison")) el("backup-comparison").textContent = "Choose an earlier file after this verification completes.";
      status("Reading and verifying your local file. File contents stay on this device.");
      if (file.size > MandiBackup.MAX_FILE_BYTES) throw new Error("File exceeds the safe browser verification limit.");
      const text = await file.text();
      if (JSON.parse(text)?.format === "mandibook-encrypted-backup") {
        const choice = await Swal.fire({ title: "Backup password", input: "password", inputAttributes: { autocomplete: "off" }, text: "Used only to decrypt this file locally. It is not sent to Firebase.", showCancelButton: true });
        if (!choice.isConfirmed) { status("Verification cancelled. No recovery status was changed."); return; }
        password = choice.value;
      }
      const result = await inspectText(text, password);
      showManifest(result);
      if (result.legacy || result.missingCollections.length) { status(`Older backup checksum passed, but ${result.missingCollections.join(", ")} are not included${result.legacy ? " and its source project is unverified" : ""}. Keep it; prepare a new full app backup.`, "warning"); return; }
      if (!result.projectMatches) { status(`Checksum passed for project ${result.backup.projectId}, not ${projectId()}. This is not a recovery copy for the current app.`, "warning"); return; }
      state.verified = result;
      const tracked = await recordVerified(result, file.name, "selected-local-file");
      const hours = Math.max(0, (Date.now() - new Date(result.backup.exportedAt).getTime()) / 3600000);
      status(`${file.name}: checksum, collection counts and data types verified. ${result.totalDocuments} records from ${new Date(result.backup.exportedAt).toLocaleString("en-IN")}. ${hours > 24 ? "This is an older copy; prepare a fresh backup for recent changes. " : ""}Nothing was restored.${tracked ? "" : " Backup history could not update."}`, "verified");
    } catch (error) { status(`File was not verified: ${error.message} Keep earlier copies; do not restore this file.`, "error"); }
    finally { password = ""; setBusy(false); if (el("backup-verify-file")) el("backup-verify-file").value = ""; }
  }
  async function recordVerified(result, name, method) {
    try {
      adminGuard();
      const health = window.MandiBackupHealth;
      if (!health) throw new Error("Backup history module unavailable. Reload this page.");
      const uid = firebase.auth().currentUser.uid;
      const entry = { projectId: result.backup.projectId, hash: result.backup.integrity.payloadHash, exportedAt: result.backup.exportedAt, filename: name, documents: result.totalDocuments, collections: result.backup.collections.length, method };
      const ref = db.collection("settings").doc("backupInfo");
      const info = await optionalMetadata(db.runTransaction(async transaction => {
        adminGuard();
        if (firebase.auth().currentUser.uid !== uid) throw new Error("Account changed during verification.");
        const snapshot = await transaction.get(ref);
        const patch = health.mergeVerified(snapshot.exists ? snapshot.data() : {}, entry);
        transaction.set(ref, { ...patch, lastVerifiedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return patch;
      }));
      health.accept(info); return true;
    } catch { return false; }
  }
  async function compareFile(file) {
    if (state.busy || !file) return;
    state.cancelled = false;
    const target = el("backup-comparison");
    try {
      adminGuard();
      if (!state.verified) throw new Error("First verify the newer saved file in step 03, then select an earlier copy here.");
      if (file.size > 20 * 1024 * 1024 || new Blob([JSON.stringify(state.verified.backup)]).size > 20 * 1024 * 1024) throw new Error("Local comparison is limited to 20 MB per copy to keep phones responsive. Your full backup remains valid; use the offline verifier for larger files.");
      setBusy(true);
      target.textContent = "Comparing saved copies locally… No database reads or restore writes.";
      const text = await file.text();
      let password = "";
      if (JSON.parse(text)?.format === "mandibook-encrypted-backup") {
        const choice = await Swal.fire({ title: "Earlier copy's password", input: "password", inputAttributes: { autocomplete: "off" }, showCancelButton: true });
        if (!choice.isConfirmed) { target.textContent = "Comparison cancelled."; return; }
        password = choice.value;
      }
      const previous = await inspectText(text, password); password = "";
      const result = await MandiBackup.compareBackups(previous.backup, state.verified.backup, projectId());
      target.replaceChildren();
      const headline = document.createElement("p"), note = document.createElement("p");
      headline.textContent = result.identicalFile ? "These are the same backup version." : `${result.totals.added} added · ${result.totals.changed} changed · ${result.totals.removed} absent from the newer copy · ${result.totals.unchanged} unchanged.`;
      note.textContent = `${new Date(result.earlier).toLocaleString("en-IN")} → ${new Date(result.later).toLocaleString("en-IN")}. Missing records need review; archived bills normally remain present. Settings metadata changes can also appear. Nothing was restored.`;
      target.append(headline, note);
      Object.entries(result.collections).forEach(([name, counts]) => {
        const row = document.createElement("p"); row.textContent = `${name}: +${counts.added} added · ${counts.changed} changed · −${counts.removed} missing · ${counts.unchanged} unchanged`; target.append(row);
      });
    } catch (error) { if (target) target.textContent = `Comparison unavailable: ${error.message}`; }
    finally { setBusy(false); if (el("backup-compare-file")) el("backup-compare-file").value = ""; }
  }
  async function refreshReminder() {
    if (window.MandiBackupHealth) await MandiBackupHealth.refresh();
  }
  function bind() {
    el("backup-save")?.addEventListener("click", save);
    el("backup-cancel")?.addEventListener("click", () => { state.cancelled = true; status("Cancelling after the current read; no partial file will be offered."); });
    el("backup-verify-file")?.addEventListener("change", event => verifyFile(event.target.files[0]));
    el("backup-compare-file")?.addEventListener("change", event => compareFile(event.target.files[0]));
    el("backup-encrypt")?.addEventListener("change", event => { el("backup-password-fields").hidden = !event.target.checked; });
    refreshReminder();
  }
  document.addEventListener("DOMContentLoaded", bind);
  window.addEventListener("mandibook:access-ready", refreshReminder);
  window.MandiBackupCenter = { build, save, verifyFile, compareFile, inspectText, refreshReminder, isBusy: () => state.busy };
})();
