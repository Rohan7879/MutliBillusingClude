// Real DOM + actual feature functions, with a strictly local in-memory datastore.
// No Firebase SDK/credentials/network. Optional PLAYWRIGHT_MODULE/CHROME_EXECUTABLE.
"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const origin = "http://mandibook-forms.test";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const core = read("js/core/core-engine.js");
const navbar = core.slice(core.indexOf("const NAV_ITEMS ="), core.indexOf("function enforceCurrentPageRole("));
let checks = 0;
function check(name, value) { assert(value, name); checks++; console.log("PASS", name); }

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const errors = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(root, "." + url.pathname);
    // HTTP 204 keeps the tested form document open after its real save handler
    // navigates to final.html, so assertions can inspect its fixture store.
    if (url.pathname === "/final.html") return route.fulfill({ status: 204 });
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    if (file.endsWith(".html")) return route.fulfill({ contentType: "text/html", body: read(url.pathname.slice(1)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") });
    if (/\.(css|jpg|png)$/.test(file)) return route.fulfill({ path: file });
    return route.abort();
  });
  async function load(file, scripts, page = null) {
    page ||= await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto(origin + "/" + file);
    await page.evaluate(() => {
      window.uid = "fixture-admin";
      window.currentUserProfile = { role: "admin", displayName: "Fixture" };
      window.store = { parties: { p1: { name: "QA FARMER", type: "farmer", address: "QA VILLAGE", currentBalance: 0 } } };
      window.calls = 0; window.directWrites = 0; window.failCommit = false; window.holdSave = false;
      window.alerts = [];
      window.Swal = { fire: async (...args) => { alerts.push(args); return { isConfirmed: true }; } };
      window.showLoading = window.hideLoading = window.showToast = () => {};
      window.escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      window.roundCurrency = value => Math.round(value * 100) / 100;
      window.customRound = value => value - Math.floor(value) > .5 ? Math.ceil(value) : Math.floor(value);
      window.globalSettings = { kasarPercentage: .003, kantanWeight: .6, plasticWeight: .6, utraiPercentage: 7 };
      const snapshot = (name, id) => ({ id, exists: !!store[name]?.[id], data: () => structuredClone(store[name]?.[id]) });
      let autoId = 0;
      const ref = (name, id) => ({ name, id,
        get: async () => snapshot(name, id),
        set: async data => { directWrites++; if (holdSave) await new Promise(resolve => { window.releaseSave = resolve; }); if (failCommit) throw Object.assign(new Error("Fixture permission error"), { code: "permission-denied" }); (store[name] ||= {})[id] = structuredClone(data); },
        update: async data => { directWrites++; Object.assign(store[name][id], data); },
      });
      window.db = { collection: name => {
        const c = { doc: id => ref(name, id || "f" + String(++autoId).padStart(19, "0")),
          get: async () => { const docs = Object.keys(store[name] || {}).map(id => snapshot(name, id)); return { docs, empty: !docs.length, forEach: fn => docs.forEach(fn) }; },
          orderBy: () => c, where: () => c,
        }; return c;
      }, runTransaction: async fn => {
        calls++;
        if (holdSave) await new Promise(resolve => { window.releaseSave = resolve; });
        const writes = [];
        const result = await fn({ get: async r => { if (writes.length) throw new Error("Read after write"); return snapshot(r.name, r.id); },
          set: (r, data, options) => writes.push([r, data, options?.merge]), update: (r, data) => writes.push([r, data, true]) });
        if (failCommit) throw Object.assign(new Error("Fixture permission error"), { code: "permission-denied" });
        writes.forEach(([r, data, merge]) => { const collection = store[r.name] ||= {}; collection[r.id] = { ...(merge ? collection[r.id] : {}), ...structuredClone(data) }; });
        return result;
      } };
      const firestore = () => db;
      firestore.FieldValue = { serverTimestamp: () => 12345, arrayUnion: (...items) => items };
      firestore.Timestamp = { fromDate: date => date.toISOString() };
      window.firebase = { auth: () => ({ currentUser: { uid } }), app: () => ({ options: { projectId: "demo-fixture" } }), firestore };
      window.billsCollection = db.collection("bills");
      window.recordAudit = async () => {}; window.billAuditSnapshot = value => value;
      window.fetchSettings = async () => {};
      // Shorten ONLY the ten-second slow-save UI timer, not storage debounces.
      const nativeTimeout = window.setTimeout;
      window.setTimeout = (fn, delay, ...args) => nativeTimeout(fn, delay === 10000 ? 25 : delay, ...args);
    });
    await page.addScriptTag({ content: navbar + "\nrenderNavbar();" });
    await page.addScriptTag({ content: core.slice(core.indexOf("const DEFAULT_DETAILS_GRID_ORDER ="), core.indexOf("/**", core.indexOf("const PRINT_LAYOUT_LABELS ="))) });
    await page.addScriptTag({ content: read("js/core/form-safety.js") });
    for (const script of scripts) await page.addScriptTag({ content: read(script) });
    return page;
  }
  async function orderInput(page) {
    await page.evaluate(() => {
      masterProducts = [{ id: "wheat", name: "WHEAT", label: "Wheat" }];
      window.validPartyNames = ["QA FARMER"];
      openNewOrderModal();
      document.getElementById("order-date").value = "2026-10-16";
      document.getElementById("order-supplier").value = "QA FARMER";
      document.getElementById("order-village").value = "QA VILLAGE";
      document.querySelector('[name="s-product-1"]').value = "wheat";
      document.querySelector('[name="s-variety-1"]').value = "STANDARD";
      document.querySelector('[name="s-qty-1"]').value = "10";
      document.querySelector('[name="s-price-1"]').value = "500.50";
      document.querySelector('[name="s-unit-1"]').value = "Bag";
      orderDraft.touch(); orderDraft.flush();
    });
  }
  try {
    const order = await load("order-book.html", ["js/features/order-book.js"]);
    await orderInput(order);
    for (const [name, value] of [["qty", "0"], ["qty", "-1"], ["qty", "1.5"], ["price", "-1"], ["price", ""], ["delivered", "-1"], ["delivered", "11"]]) {
      const result = await order.evaluate(async ({ name, value }) => {
        const field = document.querySelector('[name="s-' + name + '-1"]'), old = field.value;
        field.value = value; await saveOrder(); field.value = old;
        return { calls, writes: directWrites, alert: alerts.at(-1)[1] };
      }, { name, value });
      check("Invalid order " + name + "=" + value + " rejects before any write", result.calls === 0 && result.writes === 0 && !!result.alert);
    }
    await order.evaluate(() => { holdSave = true; window.pendingSave = saveOrder(); saveOrder(); });
    await order.waitForFunction(() => document.querySelector(".form-operation-status").textContent.includes("taking longer"));
    check("Double order submission starts only one transaction", await order.evaluate(() => calls === 1 && document.getElementById("save-order-btn").disabled));
    check("Busy order cannot close or lose inputs", await order.evaluate(() => { closeOrderModal(); return document.getElementById("order-modal").classList.contains("open") && document.getElementById("order-supplier").inert; }));
    await order.evaluate(async () => { holdSave = false; releaseSave(); await pendingSave; });
    check("Order, counter and variety commit together once", await order.evaluate(() => Object.keys(store.orders).length === 1 && Object.values(store.counters)[0].currentNumber === 1 && Object.keys(store.varieties).length === 1));
    check("Successful order clears its local draft", await order.evaluate(() => !Object.keys(localStorage).some(key => key.startsWith("mandibook:form-draft:"))));
    await orderInput(order);
    await order.evaluate(async () => { failCommit = true; await saveOrder(); });
    check("Rejected order leaves counter and records unchanged", await order.evaluate(() => Object.keys(store.orders).length === 1 && Object.values(store.counters)[0].currentNumber === 1));
    check("Failed save keeps inputs and unlocks button", await order.evaluate(() => document.getElementById("order-supplier").value === "QA FARMER" && !document.getElementById("save-order-btn").disabled));
    const retryId = await order.evaluate(() => orderSaveRef.id);
    await order.evaluate(async () => { failCommit = false; await saveOrder(); });
    check("Order retry reuses its document ID", await order.evaluate(id => !!store.orders[id] && Object.keys(store.orders).length === 2, retryId));

    // Local drafts: zero Firebase writes, explicit restore, separate UID/tab keys.
    await orderInput(order);
    await order.fill("#order-notes", "DRAFT TO RECOVER");
    await order.evaluate(() => { addSupplierEntry({ productId: "wheat", variety: 'SAFE " <b>TEXT</b>', quantity: 3, price: 510, unit: "Bag" }); orderDraft.touch(); orderDraft.flush(); closeOrderModal(); });
    await order.evaluate(() => openNewOrderModal());
    check("Reopening offers restore without auto-filling", await order.evaluate(() => !document.querySelector(".form-draft-status button").hidden && document.getElementById("order-notes").value === ""));
    await order.getByRole("button", { name: "Restore draft", exact: true }).click();
    check("Draft restores all order rows and safely escapes text", await order.evaluate(() => document.getElementById("order-notes").value === "DRAFT TO RECOVER" && document.querySelectorAll(".supplier-entry").length === 2 && document.querySelector('[name="s-variety-2"]').value === 'SAFE " <B>TEXT</B>' && !document.querySelector(".supplier-entry b")));
    check("Unsaved navigation is guarded", await order.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }));
    const savedDrafts = await order.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mandibook:form-draft:")).length);
    await order.evaluate(() => { uid = "another-user"; orderDraft.touch(); orderDraft.flush(); });
    check("Account switch cannot overwrite another user's draft", await order.evaluate(count => Object.keys(localStorage).filter(key => key.startsWith("mandibook:form-draft:")).length === count, savedDrafts));
    check("Account switch blocks saving the previous account's form", await order.evaluate(() => MandiFormSafety.begin("order", { container: document.getElementById("order-editor") }) === null));
    await order.evaluate(() => { closeOrderModal(); openNewOrderModal(); });
    check("Other account cannot see previous account draft", await order.evaluate(() => document.querySelector(".form-draft-status button").hidden));
    await order.evaluate(() => { uid = "fixture-admin"; orderDraft.dispose(); orderDraft = null; initializeOrderDraft(); });
    await orderInput(order);
    const callsBeforeOffline = await order.evaluate(() => calls);
    await context.setOffline(true);
    await order.evaluate(() => saveOrder());
    check("Offline save sends no request", await order.evaluate(count => calls === count && document.querySelector(".form-operation-status").textContent.includes("offline"), callsBeforeOffline));
    await context.setOffline(false);
    await order.evaluate(() => { const original = Storage.prototype.setItem; window.restoreStorage = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = () => { throw Error("full"); }; document.getElementById("order-notes").value = "UNSAVED"; orderDraft.touch(); orderDraft.flush(); });
    check("Full browser storage never claims a draft is saved", await order.evaluate(() => document.querySelector(".form-draft-status").textContent.includes("NOT saved")));
    await order.evaluate(() => { restoreStorage(); orderDraft.flush(); });

    const draftCount = await order.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mandibook:form-draft:")).length);
    const secondTab = await load("order-book.html", ["js/features/order-book.js"]);
    await orderInput(secondTab);
    await secondTab.fill("#order-notes", "SECOND TAB DRAFT");
    await secondTab.evaluate(() => { orderDraft.touch(); orderDraft.flush(); });
    check("Two tabs keep separate drafts without overwriting", await secondTab.evaluate(count => Object.keys(localStorage).filter(key => key.startsWith("mandibook:form-draft:")).length === count + 1 && Object.values(localStorage).some(raw => raw.includes("UNSAVED")), draftCount));
    await secondTab.close();
    await order.evaluate(() => {
      closeOrderModal(); allOrders = Object.entries(store.orders).map(([id, data]) => ({ id, ...data }));
      window.editedOrderId = allOrders[0].id; editOrder(editedOrderId);
      document.getElementById("order-notes").value = "STALE DRAFT"; orderDraft.touch(); orderDraft.flush(); closeOrderModal();
      store.orders[editedOrderId].updatedAt += 100;
      allOrders = Object.entries(store.orders).map(([id, data]) => ({ id, ...data })); editOrder(editedOrderId);
    });
    await order.getByRole("button", { name: "Restore draft", exact: true }).click();
    check("Stale order draft cannot overwrite newer record", await order.evaluate(() => document.querySelector(".form-draft-status").textContent.includes("changed since") && document.getElementById("order-notes").value !== "STALE DRAFT"));
    await order.evaluate(async () => { store.orders[editedOrderId].updatedAt += 100; await saveOrder(); });
    check("Order concurrent edit rejected at transaction time", await order.evaluate(() => alerts.at(-1)[1].includes("changed on another screen") && !MandiFormSafety.isBusy("order")));

    const bill = await load("bill-create.html", ["js/features/bill-form.js", "js/features/product-templates.js"]);
    await bill.evaluate(() => {
      initializeIndexPage(); initializeBillWorkspace(); billTemplatesReady = true; initializeBillDraft();
      document.querySelector('[name="customer_name"]').value = "QA FARMER";
      document.querySelector('[name="weighbridge_weight"]').value = "200";
      document.getElementById("loose_supply_toggle").checked = true;
      document.getElementById("loose_supply_toggle").dispatchEvent(new Event("change"));
      document.querySelector('[name="loose_price"]').value = "500";
      document.querySelectorAll('[name^="deduct_"]').forEach(field => { field.checked = false; });
      document.getElementById("expense_list").replaceChildren(); addExpense('SAFE " VALUE', 150); addExpense("FREIGHT", 75);
      document.querySelector('[name="bill_remarks"]').value = "BILL DRAFT";
      billDraft.touch(); billDraft.flush(); billDraft.dispose(); billDraft = null;
      document.getElementById("estimateForm").reset(); initializeBillDraft();
    });
    await bill.getByRole("button", { name: "Restore draft", exact: true }).click();
    check("Bill draft restores loose toggle, numbers, expenses and remarks", await bill.evaluate(() => document.getElementById("loose_supply_toggle").checked && document.querySelector('[name="loose_price"]').value === "500" && document.querySelectorAll(".expense-row").length === 2 && document.querySelector('[name="expense_name"]').value === 'SAFE " VALUE' && document.querySelector('[name="bill_remarks"]').value === "BILL DRAFT"));
    check("Restore does not turn deductions back ON", await bill.evaluate(() => [...document.querySelectorAll('[name^="deduct_"]')].every(field => !field.checked)));
    check("Bill draft restores without submitting any record", await bill.evaluate(() => calls === 0 && directWrites === 0));

    await bill.evaluate(async () => { failCommit = true; await collectData(); });
    check("Failed bill keeps inputs, draft and retry ID", await bill.evaluate(() => !store.bills && billSaveRef?.id && billDraft.dirty && document.querySelector('[name="bill_remarks"]').value === "BILL DRAFT" && !MandiFormSafety.isBusy("bill")));
    await bill.evaluate(() => {
      failCommit = false; holdSave = true;
      window.expectedBill = calculateBillData(new FormData(document.getElementById("estimateForm")));
      window.savedBillId = billSaveRef.id;
      recordAudit = async () => { throw Error("Fixture follow-up failure"); };
      window.billSave = collectData(); collectData();
    });
    check("Bill duplicate click guarded and FormData retained while inert", await bill.evaluate(() => calls === 2 && new FormData(document.getElementById("estimateForm")).get("customer_name") === "QA FARMER"));
    await bill.evaluate(async () => { holdSave = false; releaseSave(); await billSave; });
    check("Bill confirms counter, amounts and party balance exactly once", await bill.evaluate(() => Object.keys(store.bills).length === 1 && store.bills[savedBillId]["Final Total"] === expectedBill["Final Total"] && Object.values(store.counters)[0].currentNumber === 1 && store.parties.p1.currentBalance === expectedBill["Final Total"]));
    check("Post-commit failure says saved, not failed, and clears draft", await bill.evaluate(() => alerts.at(-1)[0] === "Bill saved — follow-up needs review" && !billDraft.dirty && document.querySelector(".form-operation-status").dataset.state === "warning"));
    await bill.evaluate(async () => { billCommittedId = null; await collectData(); });
    check("Replaying persisted bill ID cannot create a second bill or debit", await bill.evaluate(() => Object.keys(store.bills).length === 1 && Object.values(store.counters)[0].currentNumber === 1 && store.parties.p1.currentBalance === expectedBill["Final Total"]));
    await bill.evaluate(() => {
      billDraft.dispose(); billDraft = null;
      document.getElementById("estimateForm").dataset.editId = savedBillId;
      editModeLastUpdatedAt = { seconds: 1 }; initializeBillDraft();
      document.querySelector('[name="bill_remarks"]').value = "STALE BILL"; billDraft.touch(); billDraft.flush(); billDraft.dispose(); billDraft = null;
      editModeLastUpdatedAt = { seconds: 2 }; document.querySelector('[name="bill_remarks"]').value = "CURRENT BILL"; initializeBillDraft();
    });
    await bill.getByRole("button", { name: "Restore draft", exact: true }).click();
    check("Stale bill draft refuses to overwrite newer edit", await bill.evaluate(() => document.querySelector(".form-draft-status").textContent.includes("changed since") && document.querySelector('[name="bill_remarks"]').value === "CURRENT BILL"));
    await bill.evaluate(() => {
      billDraft.dispose(); billDraft = null; delete document.getElementById("estimateForm").dataset.editId;
      activeTemplate = { id: "fixture-template", name: "Fixture", deductions: [] }; initializeBillDraft();
      document.querySelector('[name="bill_remarks"]').value = "OLD TEMPLATE DRAFT"; billDraft.touch(); billDraft.flush(); billDraft.dispose(); billDraft = null;
      getBillTemplateSnapshot = () => ({ id: "fixture-template", name: "Changed", deductions: [] });
      document.querySelector('[name="bill_remarks"]').value = "KEEP CURRENT"; initializeBillDraft();
    });
    await bill.getByRole("button", { name: "Restore draft", exact: true }).click();
    check("Changed product template blocks automatic old draft restoration", await bill.evaluate(() => document.querySelector(".form-draft-status").textContent.includes("template changed") && document.querySelector('[name="bill_remarks"]').value === "KEEP CURRENT"));

    const ledger = await load("ledger.html", ["js/features/ledger.js"]);
    await ledger.evaluate(() => {
      fetchUniqueCustomers = async () => {}; showCustomerLedger = async () => {};
      initializeLedgerPage(); currentCustomer = { name: "QA FARMER", village: "QA VILLAGE", customerId: "p1" };
      openPaymentModal(); amountInput.value = "100"; dateInput.value = "2026-10-16";
      holdSave = true; window.paymentSave = savePayment(); savePayment();
    });
    check("Payment duplicate click guarded", await ledger.evaluate(() => calls === 1 && saveBtn.disabled));
    check("Payment cancel event cannot close pending save", await ledger.evaluate(() => { closePaymentModal(new Event("click")); return paymentModal.style.display === "flex"; }));
    await ledger.evaluate(async () => { holdSave = false; releaseSave(); await paymentSave; });
    check("Payment confirms once with matching party balance", await ledger.evaluate(() => Object.keys(store.payments).length === 1 && store.parties.p1.currentBalance === -100));
    await ledger.evaluate(async () => { openPaymentModal(); amountInput.value = "-50"; deductionAmountInput.value = "100"; await savePayment(); });
    check("Negative payment cannot create a misleading settlement", await ledger.evaluate(() => Object.keys(store.payments).length === 1));

    const settings = await load("core_settings.html", ["js/features/settings.js"]);
    await settings.evaluate(() => { openNewTemplateModal(); document.getElementById("modal-template-name").value = "QA TEMPLATE"; document.getElementById("modal-series-prefix").value = "QA"; holdSave = true; window.templateSave = saveTemplate(); saveTemplate(); });
    check("Template duplicate click guarded", await settings.evaluate(() => directWrites === 1 && MandiFormSafety.isBusy("template")));
    await settings.evaluate(async () => { holdSave = false; releaseSave(); await templateSave; });
    check("Settings template confirms then closes", await settings.evaluate(() => Object.keys(store.settings.productTemplates.templates).length === 1 && document.getElementById("template-modal").style.display === "none"));
    await settings.evaluate(async () => { await loadBillWorkflowSettings(); holdSave = true; window.policySave = saveBillWorkflowSettings(); saveBillWorkflowSettings(); });
    check("Both print-policy buttons share one save lock", await settings.evaluate(() => directWrites === 2 && MandiFormSafety.isBusy("print-policy")));
    await settings.evaluate(async () => { holdSave = false; releaseSave(); await policySave; failCommit = true; await savePrintLayoutSettings(); });
    check("Print-layout failure is visible and unlocks its form", await settings.evaluate(() => !MandiFormSafety.isBusy("print-layout") && document.getElementById("print-layout-details-list").closest(".section-card").querySelector(".form-operation-status").dataset.state === "error"));
    await settings.evaluate(async () => { failCommit = false; await savePrintLayoutSettings(); });
    check("Print-layout retry confirms save", await settings.evaluate(() => !!store.settings.printLayout));

    // Geometry uses actual HTML/CSS/row renderers, with no live app bootstrap.
    await order.evaluate(() => { closeOrderModal(); openNewOrderModal(); addSupplierEntry(); });
    await ledger.evaluate(() => { openPaymentModal(); });
    await settings.evaluate(() => { openNewTemplateModal(); addDeductionRow({ name: "Quality", type: "pct_weight", value: 2 }); addDeductionRow({ name: "Handling", type: "custom", customFormula: "bags * 2", customStage: "amount" }); });
    for (const [name, page, modal, panel, button] of [
      ["Orders", order, "#order-modal", ".modal-box", "#save-order-btn"],
      ["Payment", ledger, "#payment-modal", ".modal-content", "#save-payment-btn"],
      ["Settings", settings, "#template-modal", ".tmodal-content", ".tmodal-footer .btn-save"],
    ]) {
      for (const [width, height] of [[320, 740], [344, 882], [390, 844], [700, 900], [820, 900], [1280, 900], [844, 390], [390, 420]]) {
        await page.setViewportSize({ width, height });
        await page.locator(button).scrollIntoViewIfNeeded();
        const result = await page.evaluate(({ modal, panel, button }) => {
          const p = document.querySelector(modal + " " + panel), b = document.querySelector(button), rect = b.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return { fits: p.scrollWidth <= p.clientWidth + 1, visible: rect.top >= 0 && rect.bottom <= innerHeight && (hit === b || b.contains(hit)),
            pageFits: document.documentElement.scrollWidth <= innerWidth + 1 };
        }, { modal, panel, button });
        check(name + " modal fits " + width + "x" + height, result.fits && result.visible);
        // Verify each input can be scrolled above sticky actions, including short keyboard-like viewports.
        const fields = page.locator(modal + ' input:not([type="hidden"]), ' + modal + " select");
        for (let i = 0; i < await fields.count(); i++) {
          if (!await fields.nth(i).isVisible()) continue;
          await fields.nth(i).scrollIntoViewIfNeeded();
          const reachable = await fields.nth(i).evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); });
          assert(reachable, name + " covered field " + i + " at " + width);
        }
      }
      if (process.env.LAYOUT_SCREENSHOTS) {
        fs.mkdirSync(process.env.LAYOUT_SCREENSHOTS, { recursive: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator(modal + " " + panel).evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(process.env.LAYOUT_SCREENSHOTS, name.toLowerCase() + "-mobile.png") });
      }
    }
    assert.deepEqual(errors, [], "Unexpected browser errors");
    check("No unexpected browser errors", errors.length === 0);
    console.log("\n" + checks + " checks passed. Local fixture writes only; no Firebase SDK loaded or database accessed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
