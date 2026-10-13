// Run with: node ui-tests/workspace-tests.cjs. Uses fixtures; no live Firebase.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS', name); }
function element() {
  return { value:'', hidden:false, textContent:'', innerHTML:'', dataset:{}, style:{}, children:[], listeners:{}, attrs:{},
    addEventListener(type,fn){this.listeners[type]=fn}, setAttribute(key,value){this.attrs[key]=value},
    append(...items){this.children.push(...items)}, replaceChildren(...items){this.children=items},
    querySelectorAll(){return []}, focus(){this.focused=true} };
}
function context() {
  const elements = new Map(), callbacks = {};
  const ctx = { console, Date, URL, URLSearchParams, Set, Map, Number, String, Math, JSON,
    location:{search:'',pathname:'/reports.html'}, addEventListener(){}, showLoading(){},hideLoading(){},
    escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    document:{addEventListener(type,fn){callbacks[type]=fn},querySelectorAll(){return []},querySelector(){return null},
      getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element},
    db:{collection(){return {get:async()=>({docs:[]})}}}, hasRole:()=>true,
  };
  ctx.window=ctx;ctx.elements=elements;ctx.callbacks=callbacks;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'js/core/workspace-ui.js'),'utf8'),ctx);
  return ctx;
}
function script(file,ctx){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file})}
function inline(file,ctx) {
 const source=fs.readFileSync(path.join(root,file),'utf8');
 for(const match of source.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))vm.runInContext(match[1],ctx,{filename:file});
}
(async()=>{
 const reports=context();script('js/features/reports.js',reports);
 for(const [preset,date,start,end] of [
  ['today',new Date(2026,9,13),'2026-10-13','2026-10-13'],
  ['yesterday',new Date(2026,0,1),'2025-12-31','2025-12-31'],
  ['yesterday',new Date(2024,2,1),'2024-02-29','2024-02-29'],
  ['month',new Date(2026,9,13),'2026-10-01','2026-10-13'],
  ['financial',new Date(2026,2,31),'2025-04-01','2026-03-31'],
  ['financial',new Date(2026,3,1),'2026-04-01','2026-04-01'],
 ])check('date preset '+preset+' '+start,()=>assert.deepEqual(JSON.parse(JSON.stringify(reports.reportDateRange(preset,date))),{start,end}));
 check('Indian single-digit date',()=>assert.equal(reports.reportBillDate('3/2/2026'),'2026-02-03'));
 check('Firestore timestamp date',()=>assert.equal(reports.reportBillDate({toDate:()=>new Date(2026,9,13)}),'2026-10-13'));
 reports.document.getElementById('report-start').value='2026-10-01'; reports.document.getElementById('report-end').value='2026-10-13';
 for(const [label,status] of [['❌ Unpaid','due'],['🔄 Partial','partial'],['✅ Paid','paid'],['Total Due','outstanding']])check('summary link '+label,()=>{const p=new URL(reports.reportSummaryHref(label),'https://fixture.test').searchParams;assert.equal(p.get('status'),status);assert.equal(p.get('from'),'2026-10-01')});
 check('report customer name is escaped, never HTML',()=>{reports.showTable('Test',['Name'],[['<span onclick="bad()">unsafe</span>']]);assert.match(reports.document.getElementById('report-tbody').innerHTML,/&lt;span/)});
 const pendingReads=[];reports.billsCollection={get:()=>new Promise(resolve=>pendingReads.push(resolve))};
 const firstReport=reports.generateReport(), secondReport=reports.generateReport();
 pendingReads[1]({docs:[{id:'latest',data:()=>({Date:'13/10/2026','Final Total':200})}]});await secondReport;
 pendingReads[0]({docs:[{id:'stale',data:()=>({Date:'13/10/2026','Final Total':100})}]});await firstReport;
 check('slower stale report cannot overwrite latest export data',()=>assert.equal(vm.runInContext('allBillsCache[0].id',reports),'latest'));
 const bills=context();script('js/features/bill-list.js',bills);
 bills.document.getElementById('bill_status_filter').value='all';
 bills.fixtureBills=[['a','1/10/2026','Unpaid',0],['b','13/10/2026','Partial',25],['c','13/10/2026','Paid',100],['d','14/10/2026','Unpaid',0]].map(([id,Date,paymentStatus,amountPaid])=>({id,data:()=>({Date,paymentStatus,amountPaid,'Final Total':100})}));
 vm.runInContext("allBillsForList=fixtureBills;billReportFrom='2026-10-01';billReportTo='2026-10-13'",bills);
 const ids=()=>Array.from(bills.getFilteredBills(),d=>d.id).join(',');
 check('bill date range inclusive',()=>assert.equal(ids(),'a,b,c'));
 bills.document.getElementById('bill_status_filter').value='outstanding';check('outstanding combines unpaid and partial',()=>assert.equal(ids(),'a,b'));
 bills.document.getElementById('bill_status_filter').value='received';check('received includes partial and paid',()=>assert.equal(ids(),'b,c'));
 bills.document.getElementById('bill_status_filter').value='partial';check('partial only',()=>assert.equal(ids(),'b'));
 check('bill date parser single digits',()=>assert.equal(bills.toInputDate('1/2/2026'),'2026-02-01'));
 const staff=context();inline('staff-access.html',staff);
 const team=[{id:'pending',data:{email:'pending@example.test',role:'viewer',status:'pending'}},{id:'active',data:{email:'active@example.test',role:'accountant',status:'active'}}];
 staff.renderStaff(team);
 check('pending separated from active list',()=>{assert.equal(staff.document.getElementById('staff-pending-panel').hidden,false);assert.match(staff.document.getElementById('staff-pending-list').innerHTML,/Name missing/);assert.match(staff.document.getElementById('staff-pending-list').innerHTML,/Mobile missing/);assert.doesNotMatch(staff.document.getElementById('staff-list').innerHTML,/role-pending/)});
 staff.document.getElementById('staff-filter-status').value='active';staff.renderStaff(team);
 check('active filter hides approval panel',()=>assert.equal(staff.document.getElementById('staff-pending-panel').hidden,true));
 staff.document.getElementById('staff-search').value='not-found';staff.renderStaff(team);
 check('staff empty state has action',()=>assert.equal(staff.document.getElementById('staff-list').children[0].children[2].textContent,'Clear filters'));
 const settings=context();const sections=['billing','printing','backup'].map(category=>({...element(),dataset:{settingsCategory:category},textContent:{billing:'Kasar bag rate',printing:'WhatsApp print approval',backup:'Download backup'}[category]}));
 const buttons=['billing','printing','backup','all'].map(view=>({...element(),dataset:{settingsView:view}}));
 settings.document.querySelector=()=>({querySelectorAll:()=>buttons}); settings.document.querySelectorAll=()=>sections;
 script('js/features/settings-workspace.js',settings);settings.callbacks.DOMContentLoaded();
 const input=settings.document.getElementById('settings-search');
 check('settings default category',()=>assert.equal(sections.filter(s=>!s.hidden).length,1));
 input.value='whatsapp';input.listeners.input();check('settings searches other categories',()=>assert.equal(sections.filter(s=>!s.hidden)[0].dataset.settingsCategory,'printing'));
 input.value='not-found';input.listeners.input();check('settings no-match state',()=>assert.equal(settings.document.getElementById('settings-search-empty').hidden,false));
 settings.document.getElementById('settings-search-clear').listeners.click();check('clearing search restores category without replacing form',()=>{assert.equal(sections.filter(s=>!s.hidden)[0],sections[0]);assert.equal(input.value,'')});
 const audit=context();inline('audit-log.html',audit);
 check('audit changed fields exclude unchanged',()=>assert.equal(Array.from(audit.changedFields({before:{amount:1,status:'paid'},after:{amount:2,status:'paid'}})).join(','),'amount'));
 const target=element();await audit.showRelatedBills({entityType:'payment',after:{billId:'id/with?chars',serialNo:'QA'}},target,0);
 check('audit related bill URL encoded',()=>assert.equal(target.children[0].href,'final.html?id=id%2Fwith%3Fchars'));
 const broker=context();broker.location.search='?name=Sample';
 const docs=(rows)=>rows.map((data,i)=>({id:'doc-'+i,data:()=>data}));
 const brokerData={bills:docs([{Broker:'Sample',BrokerCommission:200,'Serial No':'A',Date:'13/10/2026'},{Broker:'Sample',BrokerCommission:900,deleted:true}]),brokers:docs([{name:'Sample'}]),parties:[],broker_payments:docs([{brokerName:'SAMPLE',amount:75,date:'13/10/2026'},{brokerName:'SAMPLE',amount:800,deleted:true}])};
 broker.db.collection=(name)=>({get:async()=>({docs:brokerData[name]||[]})});broker.billsCollection=broker.db.collection('bills');
 script('js/features/broker-detail.js',broker);await broker.loadBrokerDetail();
 check('broker totals exclude archived bills and payouts',()=>assert.match(broker.document.getElementById('broker-detail-summary').innerHTML,/₹125/));
 check('broker bill detail link',()=>assert.match(broker.document.getElementById('broker-detail-content').innerHTML,/final.html\?id=doc-0/));
 broker.hasRole=()=>false;await broker.loadBrokerDetail();check('manager cannot see payout entry button',()=>assert.equal(broker.document.getElementById('broker-detail-pay').hidden,true));
 broker.location.search='?name=Missing';await broker.loadBrokerDetail();check('unknown broker has directory next action',()=>assert.equal(broker.document.getElementById('broker-detail-content').children[0].children[2].href,'broker-ledger.html'));
 broker.location.search='?name=Sample';broker.billsCollection={get:async()=>{throw Error('Sample network failure')}};await broker.loadBrokerDetail();
 check('broker network failure exposes retry action',()=>assert.equal(broker.document.getElementById('broker-detail-content').children[0].children[2].textContent,'Retry'));
 broker.billsCollection=broker.db.collection('bills');await broker.document.getElementById('broker-detail-content').children[0].children[2].listeners.click();
 check('retry recovers broker bill list',()=>assert.match(broker.document.getElementById('broker-detail-content').innerHTML,/final.html\?id=doc-0/));
 console.log(`\n${passed} workspace checks passed; zero production writes.`);
})().catch(error=>{console.error(error);process.exitCode=1});
