// Offline browser geometry check. No Firebase SDK, app startup, or live data.
// Requires Playwright; optional PLAYWRIGHT_MODULE / CHROME_EXECUTABLE overrides.
// Run: node ui-tests/bill-mobile-layout.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'bill-create.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const core = fs.readFileSync(path.join(root, 'js/core/core-engine.js'), 'utf8');
const navStart = core.indexOf('const NAV_ITEMS =');
const navEnd = core.indexOf('function enforceCurrentPageRole(', navStart);
assert(navStart >= 0 && navEnd > navStart, 'Navbar source boundaries');
const navbar = core.slice(navStart, navEnd);
const billScript = fs.readFileSync(path.join(root, 'js/features/bill-form.js'), 'utf8');
const actionStart = billScript.indexOf('function initializeBillActionLayout()');
const actionEnd = billScript.indexOf('function initializeBillWorkspace()', actionStart);
assert(actionStart >= 0 && actionEnd > actionStart, 'Action layout source boundaries');
const actionLayout = billScript.slice(actionStart, actionEnd);
const origin = 'http://mandibook-layout.test';
const sizes = [[344, 882], [390, 844], [640, 900], [700, 900], [701, 900],
  [768, 1024], [820, 900], [900, 900], [901, 900], [1280, 900], [844, 390]];

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Fulfill only local document/styles/images. Block every other resource,
  // including Google fonts and Firebase. No local dev server is needed.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/bill-create.html') return route.fulfill({ contentType: 'text/html', body: html });
    if (!/\.(css|jpg|png)$/.test(url.pathname)) return route.abort();
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
    return route.fulfill({ path: file });
  });
  let checks = 0;
  const screenshotDir = process.env.LAYOUT_SCREENSHOTS;
  try {
    await page.goto(origin + '/bill-create.html');
    await page.evaluate(() => {
      window.currentUserProfile = { role: 'manager', displayName: 'Layout fixture' };
      window.escapeHtml = value => String(value || '').replace(/[&<>"']/g, '');
      document.querySelector('form').addEventListener('submit', event => event.preventDefault());
    });
    // Exercise the actual navbar renderer, without any auth/data initialization.
    await page.addScriptTag({ content: navbar + '\nrenderNavbar();' });
    await page.addScriptTag({ content: actionLayout + '\ninitializeBillActionLayout();' });
    for (const layout of ['professional', 'classic']) {
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        // Simulate home-indicator safe-area clearance as well as a plain screen.
        for (const inset of [9, 34]) {
          await page.evaluate(({ layout, inset }) => {
            document.querySelector('.bill-workspace').dataset.layout = layout;
            document.body.dataset.billLayout = layout;
            document.documentElement.style.setProperty('--mobile-nav-bottom', inset + 'px');
          }, { layout, inset });
          for (const scroll of layout === 'classic' ? [1] : [0, 0.45, 1]) {
            await page.evaluate(fraction => {
              window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction);
            }, scroll);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const geometry = await page.evaluate(() => {
              const nav = document.querySelector('.mobile-bottom-nav');
              const bar = document.querySelector('.form-submit-area');
              const button = bar.querySelector('.gen-btn');
              const a = bar.getBoundingClientRect(), b = nav.getBoundingClientRect(), c = button.getBoundingClientRect();
              const remarks = document.querySelector('[name="bill_remarks"]').getBoundingClientRect();
              const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
              return { navVisible: getComputedStyle(nav).display !== 'none', navTop: b.top,
                barTop: a.top, barBottom: a.bottom, remarksBottom: remarks.bottom,
                buttonTop: c.top, buttonBottom: c.bottom,
                buttonVisible: hit === button || button.contains(hit),
                position: getComputedStyle(bar).position, bottom: getComputedStyle(bar).bottom };
            });
            const label = `${layout} ${width}x${height} inset=${inset} scroll=${scroll}`;
            assert.equal(geometry.position, layout === 'classic' ? 'static' : width <= 900 ? 'fixed' : 'sticky', label + ' position');
            assert.equal(geometry.navVisible, width <= 900, label + ' nav breakpoint');
            if (width <= 900) {
              assert(geometry.barBottom <= geometry.navTop - 10, label + ' bar overlaps dock: ' + JSON.stringify(geometry));
            } else if (layout === 'professional') {
              assert.equal(geometry.bottom, '13px', label + ' desktop offset changed');
            }
            assert(geometry.buttonTop >= 0 && geometry.buttonBottom <= height, label + ' clipped button');
            assert(geometry.buttonVisible, label + ' button obstructed');
            if (scroll === 1) assert(geometry.remarksBottom <= geometry.barTop - 10, label + ' last field covered');
            checks++;
          }
        }
      }
    }
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      for (const width of [390, 820]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => {
          document.querySelector('.bill-workspace').dataset.layout = 'professional';
          document.body.dataset.billLayout = 'professional';
          document.documentElement.style.removeProperty('--mobile-nav-bottom');
          const target = document.querySelector('input[name="weighbridge_weight"]');
          window.scrollTo(0, target.getBoundingClientRect().top + scrollY - 300);
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: path.join(screenshotDir, 'bill-mobile-' + width + '.png') });
      }
    }
    assert.deepEqual(errors, [], 'Page JavaScript errors');
    console.log(`PASS ${checks} layout states: phones, tablet breakpoint, desktop, landscape, safe-area offsets and Classic layout. No Firebase loaded; no records created.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
