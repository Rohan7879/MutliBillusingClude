"use strict";
// Browser test for the real Order → Bill importer, with a local mock only.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const origin = "http://mandibook-import.test";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
let checks = 0;
const check = (name, value) => { assert(value, name); checks++; console.log("PASS", name); };

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(root, "." + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    if (file.endsWith(".html")) return route.fulfill({ contentType: "text/html", body: read(url.pathname.slice(1)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "") });
    return route.abort();
  });
  try {
    await page.goto(origin + "/bill-create.html");
    await page.evaluate(() => {
      const orders = {
        o1: { orderNo: "ORD-TEST-01", status: "Pending", supplierName: "QA FARMER (QA ORDER VILLAGE)", broker: "OLD BROKER", suppliers: [
          { product: "WHEAT", variety: "STANDARD", quantity: 12, unit: "Bag", price: 501.25, priceUnit: "100kg" },
          { product: "WHEAT", variety: "PREMIUM", quantity: 8, unit: "Bag", price: 600, priceUnit: "20kg" },
        ] },
        o2: { orderNo: "ORD-TEST-02", status: "Pending", supplierName: "QA FARMER", broker: "", suppliers: [
          { product: "WHEAT", variety: "FRESH", quantity: 3, unit: "Bag", price: 500, priceUnit: "20kg" },
        ] },
      };
      const docs = value => ({ docs: Object.entries(value).map(([id, data]) => ({ id, data: () => structuredClone(data) })), empty: !Object.keys(value).length });
      window.db = { collection: collection => ({
        doc: id => ({ get: async () => ({ exists: !!orders[id], data: () => structuredClone(orders[id]) }) }),
        where: () => ({ get: async () => docs({}) }), orderBy: () => ({ get: async () => docs({}) }),
      }) };
      window.Swal = { fire: async config => config.showCancelButton ? { isConfirmed: true, value: [0, 1] } : { isConfirmed: true } };
      window.partiesMasterList = [{ id: "p1", name: "QA FARMER", village: "QA VILLAGE" }];
      window.lockSelectedCustomer = party => { document.querySelector('[name="customer_name"]').value = party.name; document.querySelector('[name="village"]').value = party.village; document.getElementById("selected_customer_id").value = party.id; };
      window.unlockCustomerSelection = () => {};
      window.selectProductTemplateForBill = () => true;
      window.billDraft = { touch() {} };
      window.activeTemplate = {};
    });
    await page.addScriptTag({ content: read("js/features/order-integration.js") });
    await page.evaluate(() => {
      const select = document.getElementById("order-select");
      select.innerHTML = '<option value="">Direct Bill</option><option value="o1">Order one</option><option value="o2">Order two</option>';
      select.value = "o1";
    });
    await page.evaluate(() => loadOrderIntoForm());
    const imported = await page.evaluate(() => ({
      customer: document.querySelector('[name="customer_name"]').value,
      village: document.querySelector('[name="village"]').value,
      links: JSON.parse(document.querySelector('[name="linked_order_supplier_links"]').value),
      rate1: document.querySelector('[name="vakal_1_bhav"]').value,
      rate2: document.querySelector('[name="vakal_2_bhav"]').value,
      bags: [1,2,3,4,5].map(n => document.querySelector(`[name="vakal_${n}_katta"]`).value),
      loose: document.querySelector('[name="is_loose_supply"]').checked,
    }));
    check("Import parses Party (Village) labels and locks the matching Party Master record", imported.customer === "QA FARMER" && imported.village === "QA VILLAGE");
    check("Multi-variety import maps separate Vakal rows", JSON.stringify(imported.links) === JSON.stringify([{ supplierIdx: 0, vakalIndex: 1 }, { supplierIdx: 1, vakalIndex: 2 }]));
    check("100kg rate retains decimal precision", imported.rate1 === "100.25" && imported.rate2 === "600");
    check("Import never invents actual truck bag counts", imported.bags.every(value => value === "") && !imported.loose);
    await page.evaluate(() => {
      document.querySelector('[name="vakal_2_katta"]').value = "99";
      document.getElementById("order-select").value = "o2";
      loadOrderIntoForm();
    });
    await page.waitForFunction(() => document.querySelector('[name="linked_order_id"]').value === "o2");
    check("Switching order clears unused variety/bag inputs", await page.evaluate(() =>
      document.querySelector('[name="vakal_1_variety"]').value === "FRESH" &&
      document.querySelector('[name="vakal_2_variety"]').value === "" &&
      document.querySelector('[name="vakal_2_katta"]').value === ""));
    await page.evaluate(() => {
      const old = JSON.stringify({ link: document.querySelector('[name="linked_order_id"]').value, customer: document.querySelector('[name="customer_name"]').value });
      window.Swal.fire = async () => ({ isConfirmed: false });
      document.getElementById("order-select").value = "o1";
      window.cancelSnapshot = old; loadOrderIntoForm();
    });
    await page.waitForTimeout(30);
    check("Cancelling selection leaves existing import untouched", await page.evaluate(() => JSON.stringify({ link: document.querySelector('[name="linked_order_id"]').value, customer: document.querySelector('[name="customer_name"]').value }) === cancelSnapshot));
    await page.evaluate(() => clearOrderLink());
    check("Clear removes link, print reference and manual-close state", await page.evaluate(() => !document.querySelector('[name="linked_order_id"]').value && document.getElementById("close_order_checkbox").checked === false));
    check("No unexpected browser errors", errors.length === 0);
    console.log(`PASS ${checks} order-import checks; local mock only, no Firebase/network writes.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
