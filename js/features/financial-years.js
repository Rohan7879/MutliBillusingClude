(function () {
  "use strict";
  const FY = window.MandiFinancialYear, Close = window.MandiYearClose;
  const $ = id => document.getElementById(id);
  let data = null, control = {}, prepared = null, busy = false, started = false;
  const money = cents => ((cents || 0) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });
  const cutoffLabel = value => value ? `31 March ${String(value).slice(0, 4)}` : "No cutoff";
  const admin = () => window.currentUserProfile?.status === "active" && window.currentUserProfile?.role === "admin";
  function message(text, error = false) { $("fy-message").textContent = text; $("fy-message").dataset.error = String(error); }
  function api() {
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) throw new Error("Sign in again before changing accounting locks.");
    return Close.client({ db, uid, timestamp: () => firebase.firestore.FieldValue.serverTimestamp(), removeField: () => firebase.firestore.FieldValue.delete() });
  }
  function buttons() {
    const ready = !!prepared && !busy && !control.maintenance;
    $("fy-select").disabled = busy || !data;
    $("fy-refresh").disabled = busy;
    $("fy-export").disabled = busy || !prepared;
    $("fy-reason").disabled = busy;
    $("fy-admin").hidden = !admin();
    $("fy-close").disabled = !admin() || !ready || !prepared.canClose || prepared.cutoff <= Close.cutoff(control);
    $("fy-reopen").disabled = !admin() || !ready || Close.target(prepared.fyId, "reopen") >= Close.cutoff(control);
    $("fy-release").hidden = !admin() || !control.maintenance || control.maintenanceOwner !== firebase.auth().currentUser?.uid;
    $("fy-release").disabled = busy;
  }
  function rows(id, values) {
    const body = $(id); body.replaceChildren();
    if (!values.length) {
      const cell = document.createElement("td"), tr = document.createElement("tr"); cell.colSpan = 5; cell.textContent = "No matching Party Master records."; tr.append(cell); body.append(tr); return;
    }
    values.sort((a, b) => a.name.localeCompare(b.name)).forEach(row => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td"), link = document.createElement("a");
      link.textContent = row.name;
      link.href = `${id === "fy-brokers" ? "broker-detail.html" : "ledger.html"}?partyId=${encodeURIComponent(row.id)}&fy=${encodeURIComponent(prepared.fyId)}`;
      link.title = `Open ${row.name} ledger · FY ${prepared.fyId}`;
      nameCell.append(link); tr.append(nameCell);
      ["openingCents", "debitCents", "creditCents", "closingCents"].map(field => money(row[field])).forEach(value => {
        const td = document.createElement("td"); td.textContent = value; tr.append(td);
      }); body.append(tr);
    });
  }
  function render() {
    if (!data) { buttons(); return; }
    prepared = Close.preview(data, $("fy-select").value);
    const cutoff = Close.cutoff(control), locked = prepared.cutoff <= cutoff;
    $("fy-lock").textContent = `${locked ? "Selected year: LOCKED" : "Selected year: OPEN"} · ${cutoff ? `All entries through ${cutoffLabel(cutoff)} are locked.` : "No financial years have been locked."}${control.maintenance ? " Maintenance is ACTIVE—financial writes are paused." : ""}`;
    $("fy-last-reason").textContent = control.reason ? `Last cutoff reason: ${control.reason}` : "";
    rows("fy-parties", prepared.parties); rows("fy-brokers", prepared.brokers);
    const totals = $("fy-totals"); totals.replaceChildren();
    [["Financial year", prepared.fyId], ["Party closing (net)", money(prepared.parties.reduce((n, p) => n + p.closingCents, 0))], ["Broker closing payable (net)", money(prepared.brokers.reduce((n, p) => n + p.closingCents, 0))]].forEach(([label, value]) => {
      const div = document.createElement("div"); div.className = "broker-overview-card";
      const span = document.createElement("span"), strong = document.createElement("strong"); span.textContent = label; strong.textContent = value; div.append(span, strong); totals.append(div);
    });
    $("fy-validation-title").textContent = prepared.issues.length ? `${prepared.issues.length} issue(s) block close · preview may be incomplete` : "Validation: no record issues found";
    $("fy-issues").replaceChildren();
    const issues = prepared.issues.length ? prepared.issues.map(issue => `${issue.collection}/${issue.id}: ${issue.message}`) : [prepared.canClose ? "Ready for gated server validation. This preview itself does not lock any records." : "The selected financial year has not ended. Closing is unavailable."];
    issues.forEach((text, index) => {
      const li = document.createElement("li"), issue = prepared.issues[index];
      if (issue?.collection === "bills") {
        const bill = data.bills.find(b => b.id === issue.id), link = document.createElement("a");
        link.href = `final.html?id=${encodeURIComponent(issue.id)}`; link.textContent = bill?.["Serial No"] || issue.id;
        li.append(link, document.createTextNode(`: ${issue.message}`));
      } else li.textContent = text;
      $("fy-issues").append(li);
    });
    buttons();
  }
  async function refresh() {
    if (busy) return;
    busy = true; buttons(); $("fy-sync").textContent = "Reading full history from server…";
    try {
      const [records, snapshot, events] = await Promise.all([Close.readRecords(db), db.collection("settings").doc("accountingControl").get({ source: "server" }), db.collection("yearCloseEvents").get({ source: "server" })]);
      $("fy-history").replaceChildren();
      events.docs.map(doc => doc.data()).sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).forEach(event => {
        const li = document.createElement("li");
        li.textContent = `${event.closedThrough > event.previousClosedThrough ? "Closed" : "Reopened"} · cutoff ${cutoffLabel(event.previousClosedThrough)} → ${cutoffLabel(event.closedThrough)} · ${event.createdAt?.toDate?.().toLocaleString("en-IN") || ""} · ${event.actorId}: ${event.reason}`;
        $("fy-history").append(li);
      });
      if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error("Server-confirmed accounting controls are required.");
      control = snapshot.exists ? snapshot.data() : {}; Close.cutoff(control); data = records;
      const selected = $("fy-select").value, current = FY.financialYearId(new Date());
      const years = Close.preview(data, current).years;
      if (control.closedThrough) {
        const end = Number(String(control.closedThrough).slice(0, 4));
        const id = `${end - 1}-${end}`; if (id <= current && !years.includes(id)) years.push(id);
      }
      $("fy-select").replaceChildren(...years.sort().reverse().map(id => { const option = document.createElement("option"); option.value = id; option.textContent = `FY ${id}`; return option; }));
      if (years.includes(selected)) $("fy-select").value = selected;
      $("fy-sync").textContent = `Server checked ${new Date().toLocaleString("en-IN")}`;
      render();
    } catch (error) { data = null; prepared = null; message(error.message, true); $("fy-sync").textContent = "Refresh failed—actions unavailable"; }
    finally { busy = false; buttons(); }
  }
  async function change(action) {
    if (busy || !prepared || !admin()) return;
    const reason = $("fy-reason").value.trim();
    if (reason.length < 10) { message("Enter an audit reason of at least 10 characters.", true); $("fy-reason").focus(); return; }
    let next;
    try { next = Close.target(prepared.fyId, action); } catch (error) { message(error.message, true); return; }
    const warning = action === "close" ? `Lock ALL entries through ${cutoffLabel(next)}, not just FY ${prepared.fyId}? Financial writes pause while the server is checked.` : `WARNING: Reopen FY ${prepared.fyId} AND every later locked year? The cutoff moves BACK from ${cutoffLabel(Close.cutoff(control))} to ${cutoffLabel(next)}.`;
    const confirm = await Swal.fire({ title: action === "close" ? "Close financial year?" : "Reopen financial year?", text: `${warning} Reason: ${reason}`, icon: "warning", showCancelButton: true, confirmButtonText: action === "close" ? "Prepare and close" : "Reopen with audit", confirmButtonColor: "#005a9e" });
    if (!confirm.isConfirmed) return;
    busy = true; buttons(); message("Preparing under maintenance. Keep this page open until completion…");
    try {
      const result = await api().change({ fyId: prepared.fyId, action, reason, expectedCutoff: Close.cutoff(control) });
      message(`Accounting cutoff updated to ${cutoffLabel(result.closedThrough)}. Audit event: ${result.eventId}. No balances were written.`);
      $("fy-reason").value = "";
    } catch (error) { message(error.message, true); }
    finally { busy = false; await refresh(); }
  }
  function start() {
    if (!window.currentUserProfile || !$("fy-select")) return;
    if (started) { buttons(); return; } started = true;
    $("fy-select").addEventListener("change", render);
    $("fy-refresh").addEventListener("click", refresh);
    $("fy-close").addEventListener("click", () => change("close"));
    $("fy-reopen").addEventListener("click", () => change("reopen"));
    $("fy-release").addEventListener("click", async () => {
      if (busy) return;
      const confirm = await Swal.fire({ title: "Release interrupted preparation?", text: "No cutoff or balances will change. Do not release while preparation is running in another tab.", icon: "warning", showCancelButton: true, confirmButtonText: "Release preparation" });
      if (!confirm.isConfirmed || busy) return;
      busy = true; buttons();
      try { const released = await api().release(control.maintenanceToken); message(released ? "Preparation released. Cutoff unchanged." : "Preparation changed; refresh and review."); }
      catch (error) { message(error.message, true); }
      finally { busy = false; await refresh(); }
    });
    $("fy-export").addEventListener("click", () => {
      if (!prepared) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...prepared, expectedCutoff: Close.cutoff(control), generatedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `financial-year-${prepared.fyId}-preview.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    refresh();
  }
  document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("mandibook:access-ready", start);
})();
