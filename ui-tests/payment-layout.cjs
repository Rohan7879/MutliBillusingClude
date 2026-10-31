const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
 const page=await browser.newPage({ignoreHTTPSErrors:true});
 await page.setContent(read('bills.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
 await page.addScriptTag({url:'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js'});
 await page.addScriptTag({content:read('js/core/payment-ui.js')});
 await page.evaluate(()=>{
   window.hasRole=()=>true;
   window.db={collection:name=>({doc:id=>({id:id||'test',get:async()=>({id,exists:true,data:()=>({customerId:'p','Customer Name':'TEST SUPPLIER','Serial No':id,Date:'2026-10-17','Final Total':5000,amountPaid:0,workflowStatus:'approved'})})})}),runTransaction:()=>{throw new Error('Saving is forbidden in layout tests');}};
   window.openLayout=()=>{window.layoutPromise=MandiPaymentUI.paySelected(['a','b','c','d','e']);};
 });
 for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.evaluate(()=>openLayout());
   await page.locator('.mb-allocation-popup').waitFor();
   await page.waitForTimeout(300);
   const bounds=await page.evaluate(()=>{
     const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
     const body=document.querySelector('.swal2-html-container');
     return {popup:rect('.mb-allocation-popup'),save:rect('.swal2-confirm'),cancel:rect('.swal2-cancel'),scrolls:body.scrollHeight>body.clientHeight};
   });
   for(const r of [bounds.popup,bounds.save,bounds.cancel]){assert(r.top>=0);assert(r.bottom<=viewport.height+1);assert(r.left>=0);assert(r.right<=viewport.width+1);}
   assert(bounds.scrolls);
   const card=page.locator('.mb-allocation-card').first();
   await card.locator('input[type=number]').first().fill('13');
   await page.locator('.swal2-title').click();
   assert.match(await card.locator('.mb-allocation-remaining').innerText(),/4987.00/);
   assert.equal(await card.locator('.mb-allocation-reason').isVisible(),false);
   await card.locator('input[type=number]').nth(1).fill('2');
   assert.equal(await card.locator('.mb-allocation-reason').isVisible(),true);
   assert.match(await page.locator('.swal2-actions .mb-allocation-summary').innerText(),/settlement ₹15.00/);
   await page.screenshot({path:`/tmp/payment-layout-${viewport.width}.png`});
   await page.locator('.swal2-cancel').click();await page.evaluate(()=>layoutPromise);
   console.log(`PASS actual SweetAlert layout ${viewport.width}x${viewport.height}: bounded popup, internal scroll, visible actions, live totals and deduction reason`);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
