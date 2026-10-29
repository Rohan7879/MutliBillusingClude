const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const file of ['final.html', 'ledger.html']) {
      await page.setContent(read(file).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
      await page.addScriptTag({ content: read('js/core/payment-ui.js') });
      await page.evaluate(() => { MandiPaymentUI.mount(); document.getElementById('payment-modal').style.display = 'flex'; });
      for (const id of ['payment-amount-input', 'payment-method-input', 'payment-date-input', 'payment-deduction-amount', 'payment-deduction-reason', 'payment-reason-input']) {
        assert.equal(await page.locator('#' + id).count(), 1, file + ' unique ' + id);
        assert(await page.locator('#' + id).isVisible());
      }
      await page.locator('#payment-reason-input').fill('TEST REF');
      await page.setViewportSize({ width: 390, height: 844 });
      const widths = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth, modal: document.querySelector('.mb-payment-dialog').getBoundingClientRect().width }));
      assert(widths.modal <= widths.viewport, file + ' mobile dialog fits');
      await page.locator('#save-payment-btn').scrollIntoViewIfNeeded();
      assert(await page.locator('#save-payment-btn').isVisible());
      console.log('PASS shared payment modal fields and mobile layout:', file);
    }
    const source = read('js/features/bill-list.js');
    const fn = source.slice(source.indexOf('function editBill('), source.indexOf('async function deleteBill('));
    await page.evaluate(() => { window.allBillsForList = [{ id: 'approved', data: () => ({ workflowStatus: 'approved' }) }]; window.Swal = { fire: title => { window.lastNotice = title; } }; });
    await page.addScriptTag({ content: fn });
    await page.evaluate(() => editBill('approved'));
    assert.equal(await page.evaluate(() => window.lastNotice), 'Approved bill protected');
    console.log('PASS approved edit is blocked before navigation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
