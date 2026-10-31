const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
 try{
 const page=await browser.newPage();await page.setContent('<html><head></head><body></body></html>');
 await page.addScriptTag({content:read('js/core/payment-ui.js')});
 await page.evaluate(()=>{
 window.runCase=async(config={})=>{
   const bill=(id,party='p')=>({id,customerId:party,'Customer Name':party,Date:'2026-10-17','Serial No':id,'Final Total':100,amountPaid:0,workflowStatus:'approved'});
   const store={bills:{a:bill('a'),b:bill('b',config.mixed?'q':'p')},parties:{p:{currentBalance:200}},payments:{}};
   if(config.paid)store.bills.b.amountPaid=100;
   if(config.draft)store.bills.b.workflowStatus='draft';
   let counter=0,commits=0,validation='',dialogs=0;
   const ref=(collection,id)=>({collection,id,get:async()=>({id,exists:!!store[collection]?.[id],data:()=>structuredClone(store[collection]?.[id])})});
   window.db={collection:name=>({doc:id=>ref(name,id||`payment${++counter}`)}),runTransaction:async fn=>{
     if(config.stale)store.bills.b.amountPaid=10;
     const writes=[];await fn({get:r=>r.get(),set:(r,v)=>writes.push([r,v,false]),update:(r,v)=>writes.push([r,v,true])});
     if(config.fail)throw new Error('Simulated commit failure');
     for(const [r,v,merge]of writes)store[r.collection][r.id]=merge?{...store[r.collection][r.id],...v}:v;
     commits++;if(config.lostResponse&&commits===1)throw new Error('Response lost after commit');
   }};
   window.firebase={firestore:{FieldValue:{serverTimestamp:()=>123},Timestamp:{fromDate:d=>d.toISOString()}}};
   window.MandiFinancialYear={assertPostingOpen:async()=>{},parseDate:v=>v?new Date(v):null,dateKey:v=>String(v).slice(0,10)};
   window.hasRole=()=>true;window.MandiOrderSync={sync:async()=>{}};
   window.Swal={isLoading:()=>false,showValidationMessage:m=>validation=m,fire:async options=>{
     if(typeof options!=='object'||!options.preConfirm){return {isConfirmed:false};}
     dialogs++;document.body.replaceChildren(options.html);
     const cards=[...document.querySelectorAll('fieldset')];
     cards.forEach((card,i)=>{const controls=card.querySelectorAll('input');controls[0].value=String((config.cash||[13,0])[i]||0);controls[1].value=String((config.deductions||[0,0])[i]||0);controls[2].value=config.missingReason?'':'Quality adjustment';});
     document.querySelector('#bulk-payment-reason').value='TEST PAYMENT';document.querySelector('#bulk-payment-date').value='2026-10-30';
     let ok=await options.preConfirm();if(config.lostResponse)ok=await options.preConfirm();return {isConfirmed:!!ok};
   }};
   const saved=await MandiPaymentUI.paySelected(['a','b']);return {store,saved,commits,validation,dialogs};
 };
 });
 let r=await page.evaluate(()=>runCase({mixed:true}));assert.equal(r.dialogs,0);assert.equal(r.commits,0);
 r=await page.evaluate(()=>runCase({draft:true}));assert.equal(r.commits,0);
 r=await page.evaluate(()=>runCase());assert.equal(r.saved,true);assert.equal(r.store.bills.a.amountPaid,13);assert.equal(r.store.bills.b.amountPaid,0);assert.equal(Object.keys(r.store.payments).length,1);
 r=await page.evaluate(()=>runCase({cash:[0,13],deductions:[2,0]}));assert.equal(r.store.bills.a.amountPaid,2);assert.equal(r.store.bills.b.amountPaid,13);assert.equal(r.store.parties.p.currentBalance,185);assert.deepEqual(Object.values(r.store.payments).map(p=>p.appliedToBills),[['a'],['b']]);assert.equal(r.store.payments.payment1.deductionAmount,2);assert.equal(r.store.payments.payment2.cashAmount,13);
 for(const config of [{cash:[101,0]},{deductions:[1,0],missingReason:true},{cash:[0,0]},{cash:[1.001,0]},{stale:true},{fail:true}]){
   r=await page.evaluate(c=>runCase(c),config);assert.equal(r.saved,false,JSON.stringify(config));assert.equal(Object.keys(r.store.payments).length,0);assert.equal(r.store.parties.p.currentBalance,200);assert(r.validation);
 }
 r=await page.evaluate(()=>runCase({paid:true}));assert.equal(Object.keys(r.store.payments).length,1);assert.equal(r.store.bills.b.amountPaid,100);
 r=await page.evaluate(()=>runCase({lostResponse:true}));assert.equal(r.saved,true);assert.equal(Object.keys(r.store.payments).length,1);assert.equal(r.store.bills.a.amountPaid,13);
 console.log('PASS allocation: mixed parties/drafts blocked, exact ₹13 target, per-bill deductions, paid skip, overpay/precision/reason checks, stale data and atomic failure, retry without duplicates');
 const list=read('js/features/bill-list.js');
 await page.addScriptTag({content:list.slice(list.indexOf('async function markSelectedBillsAsPaid()'),list.indexOf('// REMOVED: showBillCreationForm'))});
 await page.evaluate(async()=>{
   document.body.innerHTML='<div id="bill_list_view"><input type="checkbox" class="bill-checkbox" value="a" checked><input type="checkbox" class="bill-checkbox" value="b" checked></div>';
   window.MandiPaymentUI.paySelected=async(ids,party)=>{window.called={ids,party};return true;};window.showBillListView=()=>{};
   await markSelectedBillsAsPaid();
 });
 assert.deepEqual(await page.evaluate(()=>called.ids),['a','b']);
 const ledger=read('js/features/ledger.js');
 await page.addScriptTag({content:ledger.slice(ledger.indexOf('async function openPaymentModal()'),ledger.indexOf('let paymentAttemptRef'))});
 await page.evaluate(async()=>{
   document.body.innerHTML='<input type="checkbox" class="bill-checkbox-ledger" value="a" checked><input type="checkbox" class="bill-checkbox-ledger" value="b" checked>';
   window.currentCustomer={customerId:'p'};window.showCustomerLedger=async()=>{};await openPaymentModal();
 });
 assert.deepEqual(await page.evaluate(()=>called),{ids:['a','b'],party:'p'});
 console.log('PASS Bills and Ledger selected-payment buttons use the same allocator, with ledger party identity check');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
