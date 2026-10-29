/* Local emulator only. Never accepts a production host/project. */
const assert = require('node:assert/strict');
const host = 'http://127.0.0.1:8189', project = 'demo-mandibook-fy';
const database = `projects/${project}/databases/(default)`, base = `${host}/v1/${database}/documents`;
const jwt = uid => {
 const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
 const now = Math.floor(Date.now()/1000);
 return `${enc({alg:'none',typ:'JWT'})}.${enc({aud:project,iss:`https://securetoken.google.com/${project}`,sub:uid,user_id:uid,iat:now,exp:now+3600,email:uid+'@example.test',firebase:{sign_in_provider:'custom',identities:{}}})}.`;
};
function encode(v) {
 if(v === null) return {nullValue:null};
 if(v instanceof Date) return {timestampValue:v.toISOString()};
 if(Array.isArray(v)) return {arrayValue:{values:v.map(encode)}};
 if(typeof v==='object') return {mapValue:{fields:fields(v)}};
 if(typeof v==='boolean') return {booleanValue:v};
 if(typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
 return {stringValue:v};
}
const fields = obj => Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,encode(v)]));
const write = (path,data,mask=null,times=[]) => ({update:{name:`${database}/documents/${path}`,fields:fields(data)},...(mask?{updateMask:{fieldPaths:mask}}:{}),...(times.length?{updateTransforms:times.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})});
async function commit(writes, uid='admin', expected=true) {
 const response = await fetch(`${base}:commit`,{method:'POST',headers:{Authorization:`Bearer ${uid==='owner'?'owner':jwt(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
 const result = await response.json();
 assert.equal(response.ok,expected,JSON.stringify(result)); return result;
}
async function get(path) { const r=await fetch(`${base}/${path}`,{headers:{Authorization:'Bearer owner'}}); return r.json(); }
const decode = v => v.timestampValue ? new Date(v.timestampValue) : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,v])=>[k,decode(v)])) : v.arrayValue ? (v.arrayValue.values||[]).map(decode) : v.stringValue ?? null;
const dataOf = d => Object.fromEntries(Object.entries(d.fields).map(([k,v])=>[k,decode(v)]));
(async()=>{
 await fetch(`${host}/emulator/v1/${database}/documents`,{method:'DELETE'});
 const bill={Date:'17/10/2026','Serial No':'W-2627-1','Final Total':5000,workflowStatus:'approved',locked:false,amountPaid:0,amountDue:5000,paymentStatus:'Unpaid'};
 await commit([write('users/admin',{role:'admin',status:'active'}),write('users/biller',{role:'biller',status:'active'}),write('bills/b',bill),write('parties/p',{name:'Party',type:'Farmer',opBal:0,currentBalance:5000})],'owner');
 await commit([write('bills/b',{Date:'18/10/2026'},['Date'])],'admin',false);
 await commit([write('bills/b',{workflowStatus:'draft'},['workflowStatus'])],'admin',false);
 const revision={workflowStatus:'draft',revisionPending:true,revisionNumber:1,revisionSnapshotId:'b_r1',revisionReason:'Correct mistaken bill date',revisionRequestedBy:'admin'};
 const revisionWrites=[write('billRevisions/b_r1',{billId:'b',revisionNumber:1,snapshot:bill,reason:revision.revisionReason,createdBy:'admin'},null,['createdAt']),write('bills/b',revision,Object.keys(revision),['revisionRequestedAt','lastUpdatedAt'])];
 await commit(revisionWrites,'biller',false); await commit(revisionWrites);
 await commit([write('bills/b',{Date:'18/10/2026'},['Date'])]);
 await commit([write('bills/b',{deleted:true},['deleted'])],'admin',false);
 await commit([write('bills/b',{'Final Total':5100,amountDue:5100},['`Final Total`','amountDue'])]);
 await commit([write('bills/b',{'Final Total':5000,amountDue:5000},['`Final Total`','amountDue'])]);
 await commit([write('bills/b',{Date:'18/10/2025'},['Date'])],'admin',false);
 await commit([write('bills/b',{amountPaid:100,amountDue:4900,paymentStatus:'Partial'},['amountPaid','amountDue','paymentStatus'])],'admin',false);
 await commit([write('billRevisions/b_r1',{reason:'Changed evidence'},['reason'])],'admin',false);
 let current=dataOf(await get('bills/b'));
 await commit([write('bills/b',{workflowStatus:'approved',revisionPending:false,approvedBy:'admin'},['workflowStatus','revisionPending','approvedBy'],['approvedAt','lastUpdatedAt'])],'admin',false);
 await commit([write('billRevisionApprovals/b_r1',{billId:'b',revisionNumber:1,snapshot:current,approvedBy:'admin'},null,['approvedAt']),write('bills/b',{workflowStatus:'approved',revisionPending:false,approvedBy:'admin'},['workflowStatus','revisionPending','approvedBy'],['approvedAt','lastUpdatedAt'])]);
 console.log('PASS rules: direct approved edits denied, atomic revision, immutable history, pending payment block, cross-FY edit block, re-approval evidence');
 // Paid revision can correct metadata but never its money or party.
 await commit([write('bills/paid',{...bill,workflowStatus:'draft',revisionPending:true,amountPaid:100,paymentStatus:'Partial',amountDue:4900})],'owner');
 await commit([write('bills/paid',{Date:'18/10/2026',Remarks:'Corrected date'},['Date','Remarks'])]);
 await commit([write('bills/paid',{'Final Total':6000,amountDue:5900},['`Final Total`','amountDue'])],'admin',false);
 // Gate freezes financial writes, including writes batched with gate acquisition.
 const gate={closedThrough:0,maintenance:true,maintenanceToken:'event1',maintenanceOwner:'admin'};
 const acquire=write('settings/accountingControl',gate,null,['maintenanceStartedAt']);
 await commit([acquire,write('parties/p',{currentBalance:0},['currentBalance'])],'admin',false);
 await commit([acquire]);
 await commit([write('bills/new',{...bill,workflowStatus:'draft'})],'admin',false);
 await commit([write('parties/p',{currentBalance:0},['currentBalance'])],'admin',false);
 const release={closedThrough:20260331,maintenance:false,reason:'Reviewed complete financial year',updatedBy:'admin',eventId:'event1'};
 await commit([write('settings/accountingControl',release,null,['updatedAt'])],'admin',false);
 await commit([write('settings/accountingControl',release,null,['updatedAt']),write('yearCloseEvents/event1',{closedThrough:20260331,previousClosedThrough:0,reason:release.reason,actorId:'admin'},null,['createdAt'])]);
 await commit([write('bills/old',{...bill,Date:'31/03/2026',workflowStatus:'draft'})],'admin',false);
 await commit([write('bills/new',{...bill,Date:'01/04/2026',workflowStatus:'draft'})]);
 await commit([write('bills/invalidDate',{...bill,Date:'31/02/2026',workflowStatus:'draft'})],'admin',false);
 await commit([write('parties/p',{opBal:100},['opBal'])],'admin',false);
 const payment={cashAmount:100,deductionAmount:0,totalCredit:100,paymentDate:new Date('2026-03-31T12:00:00+05:30')};
 await commit([write('payments/old',payment)],'admin',false);
 await commit([write('bills/historic',{...bill,Date:'31/03/2026'})],'owner');
 await commit([write('payments/current',{...payment,paymentDate:new Date('2026-04-01T12:00:00+05:30')}),write('bills/historic',{amountPaid:100,amountDue:4900,paymentStatus:'Partial'},['amountPaid','amountDue','paymentStatus'])]);
 await commit([write('settings/accountingControl',{closedThrough:0},['closedThrough'])],'admin',false);
 await commit([{delete:`${database}/documents/yearCloseEvents/event1`}],'admin',false);
 await commit([{delete:`${database}/documents/bills/b`}],'admin',false);
 const reopenGate={...release,maintenance:true,maintenanceToken:'event2',maintenanceOwner:'admin'};
 await commit([write('settings/accountingControl',reopenGate,['maintenance','maintenanceToken','maintenanceOwner'],['maintenanceStartedAt'])]);
 const reopened={...release,closedThrough:20250331,eventId:'event2',reason:'Reopen for reviewed correction'};
 await commit([write('settings/accountingControl',reopened,null,['updatedAt']),write('yearCloseEvents/event2',{closedThrough:20250331,previousClosedThrough:20260331,reason:reopened.reason,actorId:'admin'},null,['createdAt'])]);
 await commit([write('bills/reopened',{...bill,Date:'31/03/2026',workflowStatus:'draft'})]);
 await commit([write('bills/stillClosed',{...bill,Date:'31/03/2025',workflowStatus:'draft'})],'admin',false);
 console.log('PASS rules: gate atomicity, dated cutoff, prior-year outstanding payment, opening protection, immutable close events, no hard bill deletion');
 console.log('PASS rules: audited reopen permits target year while earlier year stays locked');
})().catch(e=>{console.error(e);process.exitCode=1});
