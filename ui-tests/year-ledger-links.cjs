const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:read('broker-detail.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):route.abort());
  await page.goto('http://fixture.test/broker-detail.html?partyId=b&fy=2025-2026');
  await page.addScriptTag({content:read('js/core/financial-year.js')});
  await page.evaluate(()=>{
   const rows={parties:[{id:'b',name:'QA BROKER',type:'Broker',opBal:10,opBalType:'CR'}],brokers:[],bills:[
    {id:'prior',Date:'31/03/2025',Broker:'QA BROKER',brokerId:'QA_BROKER',BrokerCommission:50},
    {id:'selected',Date:'01/04/2025',Broker:'QA BROKER',brokerId:'b',BrokerCommission:80},
    {id:'future',Date:'01/04/2026',Broker:'QA BROKER',brokerId:'b',BrokerCommission:90}],broker_payments:[{id:'pay',date:'02/04/2025',brokerName:'QA BROKER',amount:20}]};
   window.db={collection:name=>({get:async()=>({docs:(rows[name]||[]).map(row=>({id:row.id,data:()=>row}))})})};
   window.billsCollection=db.collection('bills');window.hasRole=()=>false;
   window.escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;');
   window.WorkspaceUI={state:(target,options)=>{target.textContent=options.message;}};
  });
  await page.addScriptTag({content:read('js/features/broker-detail.js')});
  await page.evaluate(()=>loadBrokerDetail());
  assert.equal(await page.locator('#broker-fy').inputValue(),'2025-2026');
  assert.deepEqual(await page.evaluate(()=>[brokerStatement.openingCents,brokerStatement.closingCents,brokerStatement.rows.length]),[6000,12000,2]);
  assert.equal(await page.locator('#broker-detail-content a').getAttribute('href'),'final.html?id=selected');
  assert.match(await page.locator('#broker-detail-content').innerText(),/FY 2025-2026/);
  await page.evaluate(()=>{document.dispatchEvent(new Event('DOMContentLoaded'));});
  await page.locator('#broker-fy').selectOption('2026-2027');
  await page.waitForFunction(()=>brokerStatement.closingCents===21000);
  assert.match(page.url(),/fy=2026-2027/);
  assert.equal(await page.locator('#broker-detail-content a').getAttribute('href'),'final.html?id=future');
  console.log('PASS broker FY deep link, legacy identity, opening carry-forward, selected transactions, bill links and year switch');
  const ledger=await browser.newPage();
  await ledger.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:read('ledger.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')}):route.abort());
  await ledger.goto('http://fixture.test/ledger.html?partyId=buyer&fy=2025-2026');
  await ledger.addScriptTag({content:read('js/core/financial-year.js')});
  await ledger.evaluate(()=>{
   const rows={parties:[{id:'buyer',name:'Same name',type:'Buyer'},{id:'other',name:'Same name',type:'Farmer'}]};
   window.db={collection:name=>({get:async()=>({docs:(rows[name]||[]).map(row=>({id:row.id,data:()=>row}))})})};
   window.billsCollection=db.collection('bills');window.hideLoading=()=>{};
   window.escapeHtml=value=>String(value);window.alert=message=>{throw new Error(message);};
  });
  await ledger.addScriptTag({content:read('js/features/ledger.js')});
  await ledger.evaluate(async()=>{showCustomerLedger=async party=>{window.selectedTestParty=party;};await fetchUniqueCustomers();});
  assert.equal(await ledger.evaluate(()=>selectedTestParty.customerId),'buyer');
  assert.equal(await ledger.evaluate(()=>selectedFinancialYear),'2025-2026');
  assert.equal(await ledger.evaluate(()=>allUniqueCustomers.length),2);
  console.log('PASS customer FY deep link includes Buyers and distinguishes same-name Party Master identities');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
