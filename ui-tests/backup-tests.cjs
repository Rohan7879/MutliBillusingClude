// Exercises real export/verification/archive code with fixtures. No live writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../js/core/backup-engine.js');
const health = require('../js/core/backup-health.js');
const { MockFirestore } = require('../payment-tests/test/mock-firestore.js');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
class Timestamp { constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; } }
class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
class DocumentReference { constructor(docPath) { this.path = docPath; this.firestore = { app: { options: { projectId: 'fixture-project' } } }; } }
class Bytes { constructor(bytes) { this.bytes = bytes; } toBase64() { return Buffer.from(this.bytes).toString('base64'); } static fromUint8Array(bytes) { return new Bytes(bytes); } }
const sdk = { Timestamp, GeoPoint, DocumentReference, Blob: Bytes, FieldPath: { documentId: () => '__name__' } };
function fixtureDB(seed = {}, options = {}) {
  const calls = [], metadataWrites = [];
  let metadata = {};
  const db = { calls, metadataWrites, waitForPendingWrites: async () => {},
    runTransaction: async action => action({ get: async () => ({ exists: true, data: () => metadata }), set: (ref, data) => { metadataWrites.push(data); metadata = { ...metadata, ...data }; } }),
    doc: docPath => new DocumentReference(docPath),
    collection(name) {
      let cursor = '', limit = 500;
      const query = { orderBy(field) { assert.equal(field, '__name__'); return query; }, limit(size) { limit = size; return query; }, startAfter(doc) { cursor = doc.id; return query; },
        doc() { return { set:async data=>{metadataWrites.push(data); metadata={...metadata,...data}}, get:async()=>({exists:true,data:()=>metadata}) }; },
        async get(source) {
          assert.deepEqual(source, {source:'server'}); calls.push({name,cursor,limit});
          if (options.fail === name) throw Error('Permission/network failure');
          const rows = options.mutate ? options.mutate(name, calls.filter(call=>call.name===name).length, seed[name] || []) : seed[name] || [];
          const docs = rows.filter(doc=>doc.id>cursor).sort((a,b)=>a.id<b.id?-1:1).slice(0,limit).map(doc=>({id:doc.id,data:()=>doc.data}));
          return {docs,metadata:{fromCache:options.cached===name,hasPendingWrites:options.pending===name}};
        } };
      return query;
    } };
  return db;
}
const capture = (db, extra={}) => engine.capture({db,sdk,projectId:'fixture-project',exportedBy:'admin@example.test',...extra});
const clone = value => JSON.parse(JSON.stringify(value));
async function resign(backup) { const {integrity,...payload}=backup; backup.integrity={algorithm:'SHA-256',payloadHash:await engine.hash(engine.canonical(payload))}; return backup; }
function uiElement() {
  return { value:'',checked:false,hidden:false,disabled:false,dataset:{},children:[],listeners:{}, textContent:'',
    addEventListener(type,fn){this.listeners[type]=fn},append(...values){this.children.push(...values)},appendChild(value){this.children.push(value)},replaceChildren(...values){this.children=values},remove(){},click(){this.clicked=true} };
}
function centerContext(db) {
  const elements=new Map(), ctx={console,Blob,Date,JSON,MandiBackup:engine,MandiBackupHealth:{...health,accept(){},refresh:async()=>{}},db,setTimeout:()=>0,clearTimeout(){},
    URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},
    currentUserProfile:{role:'admin'}, addEventListener(){},
    document:{ getElementById(id){if(!elements.has(id))elements.set(id,uiElement());return elements.get(id)},querySelectorAll:()=>[],createElement:uiElement,body:uiElement(),addEventListener(){}},
    firebase:{auth:()=>({currentUser:{uid:'admin',email:'admin@example.test'}}),app:()=>({options:{projectId:'fixture-project'}}),firestore:{...sdk,FieldValue:{serverTimestamp:()=>123}}},
    Swal:{fire:async()=>({isConfirmed:false})} };
  ctx.window=ctx;ctx.elements=elements;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/features/backup-center.js'),'utf8'),ctx);return ctx;
}
function reminderContext({role='admin',get=async()=>({exists:false})}={}) {
 const elements=new Map([['last-backup-reminder',uiElement()],['backup-reminder-frequency',uiElement()]]);
 const store=()=>{const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
 let reads=0;const user={uid:'one'};
 const ctx={console,Date,JSON,setTimeout:()=>0,clearTimeout(){},localStorage:store(),sessionStorage:store(),currentUserProfile:{role},
   document:{readyState:'loading',getElementById:id=>elements.get(id)||null,addEventListener(){}},addEventListener(){},
   firebase:{app:()=>({options:{projectId:'fixture-project'}}),auth:()=>({currentUser:user})},
   db:{collection:()=>({doc:()=>({get:async source=>{reads++;return get(source)}})})}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/core/backup-health.js'),'utf8'),ctx);
 return{ctx,elements,user,reads:()=>reads};
}
async function main() {
 const types={text:'ગુજરાતી 🌾\ntext',stamp:new Timestamp(1720000000,999999999),point:new GeoPoint(23.1,72.5),ref:new DocumentReference('parties/p1'),bytes:new Bytes(new Uint8Array([0,255,1])),nested:[null,true,{type:'timestamp',seconds:'user field',__mandiBookType:'timestamp'}],nan:NaN,infinity:Infinity,negativeInfinity:-Infinity,negativeZero:-0};
 const restored=engine.decode(engine.encode(types,sdk),sdk,{doc:p=>new DocumentReference(p)});
 await test('Gujarati and nested values round-trip',()=>assert.equal(restored.text,types.text));
 await test('Timestamp nanoseconds survive',()=>assert.equal(restored.stamp.nanoseconds,999999999));
 await test('GeoPoint survives',()=>assert.equal(restored.point.longitude,72.5));
 await test('Reference path survives',()=>assert.equal(restored.ref.path,'parties/p1'));
 await test('Binary values survive',()=>assert.deepEqual([...restored.bytes.bytes],[0,255,1]));
 await test('Special numeric values survive',()=>{assert(Number.isNaN(restored.nan));assert.equal(restored.infinity,Infinity);assert.equal(restored.negativeInfinity,-Infinity);assert(Object.is(restored.negativeZero,-0));});
 await test('User fields cannot collide with type tags',()=>assert.equal(restored.nested[2].type,'timestamp'));
 await test('Unsafe integer precision blocks browser export',()=>assert.throws(()=>engine.encode(Number.MAX_SAFE_INTEGER+1,sdk),/precision loss/));
 for (const value of [undefined,()=>{},Symbol('x'),new Map(),new Date('invalid')]) await test('Unsupported value stops export '+String(value),()=>assert.throws(()=>engine.encode(value,sdk)));
 await test('Prototype-named fields remain data',()=>{const raw=Object.fromEntries([['__proto__',{polluted:true}]]),out=engine.decode(engine.encode(raw,sdk));assert.equal(Object.getPrototypeOf(out),Object.prototype);assert.equal(out.__proto__.polluted,true);assert.equal({}.polluted,undefined);});
 const seed={bills:[{id:'archived',data:{deleted:true,'Final Total':100}},{id:'missing-date',data:{'Final Total':0}}],brokers:[{id:'b',data:{name:'Sample'}}],broker_payments:[{id:'p',data:{amount:25}}],auditLogs:[{id:'a',data:{action:'bill.created'}}],users:[{id:'u',data:{role:'viewer'}}],counters:[{id:'serial',data:{value:15}}]};
 const db=fixtureDB(seed), backup=await capture(db);
 await test('All 18 app collections covered, including empty revision/year histories',()=>{assert.equal(backup.collections.length,18);['billRevisions','billRevisionApprovals','yearCloseEvents'].forEach(name=>assert(Array.isArray(backup.data[name])))});
 await test('Archived and missing-date bills included',()=>assert.equal(backup.data.bills.length,2));
 await test('Previously missing collections included',()=>['brokers','broker_payments','users','mobileDirectory','auditLogs','counters'].forEach(name=>assert(Array.isArray(backup.data[name]))));
 await test('Server-only capture makes no writes',()=>assert.equal(db.metadataWrites.length,0));
 await test('Counts and file hashes verify',async()=>assert.equal((await engine.verify(JSON.stringify(backup),'fixture-project')).totalDocuments,7));
 await test('Wrong project identified',async()=>assert.equal((await engine.verify(backup,'different-project')).projectMatches,false));
 await test('Record review preserves data and separates accounting warnings',()=>{const before=JSON.stringify(backup);assert(engine.reviewRecords(backup).some(item=>item.code==='legacy-party-link'));assert.equal(JSON.stringify(backup),before)});
 const bigDB=fixtureDB({bills:Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),data:{n:i}}))});const big=await capture(bigDB);
 await test('Pagination does not silently cap records',()=>assert.equal(big.data.bills.length,1001));
 await test('Both passes page every record',()=>assert.equal(bigDB.calls.filter(c=>c.name==='bills').length,6));
 await test('Read allowance covers both passes and empty queries',async()=>{const minimum=engine.COLLECTIONS.length*2;const empty=await capture(fixtureDB(),{readLimit:minimum});assert.equal(empty.readUsage.documentReads,minimum);assert.equal(empty.totalDocuments,0)});
 await test('Invalid allowance fails before any server read',async()=>{const source=fixtureDB();await assert.rejects(()=>capture(source,{readLimit:20001}),/allowance/);assert.equal(source.calls.length,0)});
 await test('Allowance stops before excess reads without partial copy',async()=>{const source=fixtureDB({bills:Array.from({length:60},(_,i)=>({id:String(i).padStart(3,'0'),data:{n:i}}))});await assert.rejects(()=>capture(source,{readLimit:30}),/allowance reached/);assert.equal(source.calls.length,1);assert.equal(source.calls[0].limit,30);assert.equal(source.metadataWrites.length,0)});
 await test('Allowance can fail on second pass without marking backup saved',async()=>{const source=fixtureDB(seed);await assert.rejects(()=>capture(source,{readLimit:30}),/allowance reached/);assert.equal(source.metadataWrites.length,0)});
 const newerSeed={...seed,bills:[{id:'archived',data:{deleted:true,'Final Total':110}},{id:'new-bill',data:{'Final Total':20}}]};
 const newer=await capture(fixtureDB(newerSeed));
 await test('Local comparison counts added, removed and changed IDs',async()=>{const result=await engine.compareBackups(backup,newer,'fixture-project');assert.deepEqual(result.collections.bills,{added:1,removed:1,changed:1,unchanged:0})});
 await test('Comparison of same file is explicit',async()=>{const result=await engine.compareBackups(backup,backup,'fixture-project');assert.equal(result.identicalFile,true);assert.equal(result.totals.unchanged,7)});
 await test('Comparison rejects reversed chronological order',async()=>{const older=clone(backup);older.startedAt='2020-01-01T00:00:00.000Z';older.exportedAt='2020-01-01T00:00:00.000Z';await resign(older);await assert.rejects(()=>engine.compareBackups(backup,older,'fixture-project'),/Swap/)});
 await test('Comparison rejects other projects',()=>assert.rejects(()=>engine.compareBackups(backup,newer,'another-project'),/same app project/));
 await test('Comparison rejects corrupted second copy',async()=>{const bad=clone(newer);bad.data.bills=[];await assert.rejects(()=>engine.compareBackups(backup,bad,'fixture-project'),/checksum/)});
 const oldEntry={projectId:'fixture-project',hash:'a'.repeat(64),exportedAt:'2020-01-01T00:00:00.000Z',documents:5,collections:18,filename:'old.json'},newEntry={...oldEntry,hash:'b'.repeat(64),exportedAt:'2020-02-01T00:00:00.000Z',filename:'new.json'};
 await test('Older 15-collection backup retained but requires fresh copy',()=>{const info=health.mergeVerified({}, {...oldEntry,collections:15});const result=health.health(info,'fixture-project',1,Date.parse(oldEntry.exportedAt));assert.equal(result.due,true);assert.equal(result.copies.length,1)});
 const history=health.mergeVerified(health.mergeVerified({},newEntry),oldEntry);
 await test('Verifying an old file never rolls back latest backup date',()=>{assert.equal(history.lastVerifiedExportedAt,newEntry.exportedAt);assert.equal(history.verifiedCopies.length,2)});
 await test('Re-verification does not invent another retained version',()=>assert.equal(health.mergeVerified(history,newEntry).verifiedCopies.length,2));
 await test('History keeps latest twelve distinct versions',()=>{let data={};for(let n=1;n<=15;n++)data=health.mergeVerified(data,{...oldEntry,hash:String(n).padStart(64,'0'),exportedAt:`2020-03-${String(n).padStart(2,'0')}T00:00:00.000Z`});assert.equal(data.verifiedCopies.length,12);assert.equal(data.verifiedCopies[0].exportedAt,'2020-03-15T00:00:00.000Z')});
 await test('Reminder uses export time, never today verification time',()=>assert.equal(health.health({...history,lastVerifiedAt:Date.now()},'fixture-project',1).due,true));
 await test('Daily reminder is not due before its exact deadline',()=>assert.equal(health.health(history,'fixture-project',1,Date.parse(newEntry.exportedAt)+3600000).due,false));
 await test('Daily reminder is due at deadline',()=>assert.equal(health.health(history,'fixture-project',1,Date.parse(newEntry.exportedAt)+86400000).due,true));
 await test('Other project metadata cannot show a healthy backup',()=>assert.equal(health.health(history,'wrong-project').copies.length,0));
 await test('Future-dated file cannot become healthy history',()=>assert.throws(()=>health.mergeVerified(history,{...newEntry,exportedAt:'2999-01-01T00:00:00.000Z'}),/future/));
 await test('Non-Admin reminder makes no metadata reads',async()=>{const reminder=reminderContext({role:'viewer'});await reminder.ctx.MandiBackupHealth.refresh();assert.equal(reminder.reads(),0)});
 await test('Reminder caches metadata instead of reading on every focus',async()=>{const reminder=reminderContext();await reminder.ctx.MandiBackupHealth.refresh();await reminder.ctx.MandiBackupHealth.refresh();assert.equal(reminder.reads(),1)});
 await test('Reminder cache is isolated by signed-in account',async()=>{const reminder=reminderContext();await reminder.ctx.MandiBackupHealth.refresh();reminder.user.uid='two';await reminder.ctx.MandiBackupHealth.refresh();assert.equal(reminder.reads(),2)});
 await test('Missing history shows due warning',async()=>{const reminder=reminderContext();await reminder.ctx.MandiBackupHealth.refresh();assert.equal(reminder.elements.get('last-backup-reminder').dataset.kind,'warning')});
 await test('Offline metadata failure never pretends backup is healthy',async()=>{const reminder=reminderContext({get:async()=>{throw Error('offline')}});await reminder.ctx.MandiBackupHealth.refresh();assert.match(reminder.elements.get('last-backup-reminder').textContent,/unavailable/)});
 await test('Late old history response cannot overwrite newly verified copy',async()=>{let resolve;const reminder=reminderContext({get:()=>new Promise(r=>{resolve=r})});const wait=reminder.ctx.MandiBackupHealth.refresh();const fresh=health.mergeVerified({}, {...newEntry,exportedAt:new Date().toISOString()});reminder.ctx.MandiBackupHealth.accept(fresh);resolve({exists:false});await wait;assert.equal(reminder.elements.get('last-backup-reminder').dataset.kind,'verified')});
 for(const options of [{fail:'broker_payments'},{cached:'bills'},{pending:'bills'}])await test('Incomplete/cache/pending reads blocked '+JSON.stringify(options),()=>assert.rejects(()=>capture(fixtureDB(seed,options))));
 await test('Changed content blocks copy, even with same count',()=>assert.rejects(()=>capture(fixtureDB({bills:[{id:'b',data:{amount:1}}]},{mutate:(name,call,rows)=>name==='bills'&&call>1?[{id:'b',data:{amount:2}}]:rows})),/changed during backup/));
 await test('Cancelled export has no partial success',()=>assert.rejects(()=>capture(fixtureDB(seed),{guard:()=>{throw Error('cancelled')}}),/cancelled/));
 await test('Pagination rejects invalid sizes',()=>assert.rejects(()=>engine.readCollection(fixtureDB(),sdk,'bills',{pageSize:0}),/page size/));
 await test('Server timeout stops export',()=>assert.rejects(()=>engine.readCollection({collection:()=>({orderBy(){return this},limit(){return this},get:()=>new Promise(()=>{})})},sdk,'bills',{timeoutMs:5}),/timed out/));
 await test('Duplicate IDs block verification',async()=>{const bad=clone(backup);bad.data.bills.push(bad.data.bills[0]);await resign(bad);await assert.rejects(()=>engine.verify(bad),/duplicate/)});
 await test('Corrupted file rejected',async()=>{const bad=clone(backup);bad.data.bills[0].id='corrupt';await assert.rejects(()=>engine.verify(bad),/checksum/)});
 await test('Removed collection rejected',async()=>{const bad=clone(backup);bad.collections=bad.collections.filter(c=>c!=='auditLogs');await resign(bad);await assert.rejects(()=>engine.verify(bad),/missing required/)});
 await test('Manifest count mismatch rejected',async()=>{const bad=clone(backup);bad.manifest.bills.documents=999;await resign(bad);await assert.rejects(()=>engine.verify(bad),/Count/)});
 await test('Malformed timestamp rejected even with recomputed checksum',async()=>{const bad=clone(backup);bad.data.bills[0].data.entries.push(['bad',{type:'timestamp',seconds:0,nanoseconds:1e9}]);bad.manifest.bills.sha256=await engine.hash(engine.canonical(bad.data.bills));await resign(bad);await assert.rejects(()=>engine.verify(bad),/timestamp/)});
 await test('No unverified hash fallback',async()=>{const bad=clone(backup);bad.integrity.payloadHash='unavailable';await assert.rejects(()=>engine.verify(bad),/checksum/)});
 const legacy={format:engine.FORMAT,version:2,exportedAt:new Date().toISOString(),collections:['bills','payments','parties','orders','settings'],bills:[],payments:[],parties:[],orders:[],settings:[]};legacy.integrity={algorithm:'SHA-256',payloadHash:await engine.hash(JSON.stringify(legacy,null,2))};
 await test('Old v2 copy validated but marked incomplete',async()=>{const result=await engine.verify(legacy);assert.equal(result.legacy,true);assert.equal(result.missingCollections.length,13)});
 const password='sample-test-password-only', encrypted=await engine.encrypt(JSON.stringify(backup),password);
 await test('Encrypted copy decrypts and verifies',async()=>assert.equal((await engine.verify(await engine.decrypt(encrypted,password))).totalDocuments,7));
 await test('Fresh encryption uses fresh salt and IV',async()=>{const other=await engine.encrypt(JSON.stringify(backup),password);assert.notEqual(other.iv,encrypted.iv);assert.notEqual(other.salt,encrypted.salt)});
 await test('Wrong password rejected',()=>assert.rejects(()=>engine.decrypt(encrypted,'wrong-password-test'),/Incorrect password/));
 await test('Damaged ciphertext rejected',()=>{const damaged=Buffer.from(encrypted.ciphertext,'base64');damaged[0]^=1;return assert.rejects(()=>engine.decrypt({...encrypted,ciphertext:damaged.toString('base64')},password))});
 await test('Weak password blocked',()=>assert.rejects(()=>engine.encrypt('text','short'),/12 characters/));
 const centerDB=fixtureDB(seed), ui=centerContext(centerDB);
 ui.document.getElementById('backup-quiescent').checked=true;
 await ui.MandiBackupCenter.build();
 await test('Prepared backup is not recorded as saved',()=>assert.equal(centerDB.metadataWrites.length,0));
 await test('Ready UI enables explicit save step',()=>assert.equal(ui.document.getElementById('backup-save').disabled,false));
 await ui.MandiBackupCenter.save();
 await test('Fallback download never marks verified success',()=>{assert.equal(ui.document.getElementById('backup-status').dataset.kind,'warning');assert.equal(centerDB.metadataWrites.length,1);assert.equal(centerDB.metadataWrites[0].lastVerifiedHash,undefined)});
 const selected=await capture(fixtureDB(seed));await ui.MandiBackupCenter.verifyFile({size:1000,name:'selected.json',text:async()=>JSON.stringify(selected)});
 await test('Selected local file verification records real export date',()=>{const meta=centerDB.metadataWrites.at(-1);assert.equal(meta.lastVerifiedExportedAt,selected.exportedAt);assert.equal(meta.lastVerifiedHash,selected.integrity.payloadHash)});
 const beforeCompare=centerDB.metadataWrites.length, beforeReads=centerDB.calls.length;
 await ui.MandiBackupCenter.compareFile({size:1000,name:'earlier.json',text:async()=>JSON.stringify(backup)});
 await test('Comparison does not read or write live database',()=>{assert.equal(centerDB.metadataWrites.length,beforeCompare);assert.equal(centerDB.calls.length,beforeReads)});
 const failedHistory=fixtureDB(seed);failedHistory.runTransaction=async()=>{throw Error('offline')};const failedUI=centerContext(failedHistory);await failedUI.MandiBackupCenter.verifyFile({size:1000,name:'local.json',text:async()=>JSON.stringify(selected)});
 await test('Valid local file remains verified when metadata cannot sync',()=>{assert.equal(failedUI.document.getElementById('backup-status').dataset.kind,'verified');assert.match(failedUI.document.getElementById('backup-status').textContent,/history could not update/)});
 const beforeMeta=centerDB.metadataWrites.length;await ui.MandiBackupCenter.verifyFile({size:10,name:'broken.json',text:async()=>'{broken'});
 await test('Invalid selected file never updates verified history',()=>assert.equal(centerDB.metadataWrites.length,beforeMeta));
 const nativeDB=fixtureDB(seed), native=centerContext(nativeDB);native.document.getElementById('backup-quiescent').checked=true;await native.MandiBackupCenter.build();
 let savedText='',readBack=false;native.showSaveFilePicker=async()=>({createWritable:async()=>({write:async blob=>{savedText=await blob.text()},close:async()=>{}}),getFile:async()=>{readBack=true;return{name:'native.json',text:async()=>savedText}}});
 await native.MandiBackupCenter.save();await test('Native save verifies actual readback before recording success',()=>{assert(readBack);assert.equal(nativeDB.metadataWrites[0].lastVerificationMethod,'file-picker-readback');assert.equal(native.document.getElementById('backup-status').dataset.kind,'verified')});
 const previous=nativeDB.metadataWrites.length;native.showSaveFilePicker=async()=>({createWritable:async()=>({write:async()=>{throw Error('disk full')},close:async()=>{throw Error('should not close')},abort:async()=>{}})});await native.MandiBackupCenter.save();
 await test('Failed disk write cannot mark saved or fall back silently',()=>{assert.equal(nativeDB.metadataWrites.length,previous);assert.equal(native.document.getElementById('backup-status').dataset.kind,'error')});
 native.showSaveFilePicker=async()=>({createWritable:async()=>({write:async blob=>{savedText=await blob.text()},close:async()=>{}}),getFile:async()=>({name:'changed.json',text:async()=>{const changed=JSON.parse(savedText);changed.exportedBy='different@example.test';await resign(changed);return JSON.stringify(changed)}})});await native.MandiBackupCenter.save();
 await test('Readback must match prepared hash, not just backup ID',()=>{assert.equal(nativeDB.metadataWrites.length,previous);assert.equal(native.document.getElementById('backup-status').dataset.kind,'error')});
 native.showSaveFilePicker=async()=>{const error=Error('cancel');error.name='AbortError';throw error};await native.MandiBackupCenter.save();
 await test('Save cancellation does not update verified history',()=>assert.equal(nativeDB.metadataWrites.length,previous));
 const archiveSource=fs.readFileSync(path.join(__dirname,'../js/features/backup.js'),'utf8');
 const archiveSeed={bills:{b:{'Final Total':100,amountPaid:0,paymentStatus:'Unpaid',customerId:'p'}},parties:{p:{currentBalance:100}},auditLogs:{}};
 function archiveContext(failure=null,seed=archiveSeed){const store=new MockFirestore(seed),run=store.runTransaction.bind(store);store.runTransaction=fn=>run(fn,{failAt:failure});const ctx={db:store,billsCollection:store.collection('bills'),window:{currentUserProfile:{role:'admin'}},firebase:{auth:()=>({currentUser:{uid:'u'}}),firestore:{FieldValue:{serverTimestamp:()=>123}}},hasRole:()=>true,billAuditSnapshot:x=>x,roundCurrency:x=>Math.round(x*100)/100,Swal:{fire(){}},document:{},console};vm.createContext(ctx);vm.runInContext(archiveSource,ctx);return{ctx,store}}
 const archived=archiveContext();assert.equal((await archived.ctx.changeBillArchive('b',false)).changed,true);assert.equal((await archived.ctx.changeBillArchive('b',false)).changed,false);
 await test('Archive retries adjust balance only once',()=>{assert.equal(archived.store.store.parties.p.currentBalance,0);assert.equal(Object.keys(archived.store.store.auditLogs).length,1)});
 assert.equal((await archived.ctx.changeBillArchive('b',true)).changed,true);assert.equal((await archived.ctx.changeBillArchive('b',true)).changed,false);
 await test('Restore retries adjust balance only once',()=>assert.equal(archived.store.store.parties.p.currentBalance,100));
 for(const failure of ['get:1','get:2','update:1','update:2','set:1','commit'])await test('Atomic archive failure '+failure,async()=>{const fixture=archiveContext(failure);await assert.rejects(()=>fixture.ctx.changeBillArchive('b',false));assert.deepEqual(fixture.store.store,archiveSeed)});
 await test('Paid bill cannot archive',async()=>{const seed=clone(archiveSeed);seed.bills.b.amountPaid=25;const fixture=archiveContext(null,seed);await assert.rejects(()=>fixture.ctx.changeBillArchive('b',false),/payment evidence/);assert.deepEqual(fixture.store.store,seed)});
 await test('Locked bill cannot archive',async()=>{const seed=clone(archiveSeed);seed.bills.b.locked=true;await assert.rejects(()=>archiveContext(null,seed).ctx.changeBillArchive('b',false),/Approved bills cannot be archived/)});
 await test('Missing linked party blocks archive without writes',async()=>{const seed=clone(archiveSeed);seed.parties={};const fixture=archiveContext(null,seed);await assert.rejects(()=>fixture.ctx.changeBillArchive('b',false),/party is missing/);assert.deepEqual(fixture.store.store,seed)});
 if(process.env.MANDIBOOK_TEST_OUTPUT) fs.writeFileSync(process.env.MANDIBOOK_TEST_OUTPUT,JSON.stringify(backup,null,2));
 console.log(`\n${passed} backup checks passed; no live data changed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
