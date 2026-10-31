// One presentation for bill, selected-bill and customer-ledger payments.
// Callers retain their existing atomic save/allocation logic.
(function () {
  const ids = {
    cash: 'payment-amount-input', method: 'payment-method-input', date: 'payment-date-input',
    deduction: 'payment-deduction-amount', deductionReason: 'payment-deduction-reason', reason: 'payment-reason-input',
  };
  const bulkIds = { cash: 'bulk-payment-cash', method: 'bulk-payment-method', date: 'bulk-payment-date',
    deduction: 'bulk-payment-deduction', deductionReason: 'bulk-payment-deduction-reason', reason: 'bulk-payment-reason' };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function fields(bulk = false) {
    const names = bulk ? bulkIds : ids;
    const field = (key, label, control) => `<label for="${names[key]}">${label}</label>${control}`;
    return `<div class="mb-payment-fields">
      ${field('cash', 'Payment amount (₹)', `<input id="${names.cash}" type="number" min="0" step="any" placeholder="e.g. 2500" />`)}
      ${field('method', 'Payment method', `<select id="${names.method}">${['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'].map(v => `<option>${v}</option>`).join('')}</select>`)}
      ${field('date', 'Payment date', `<input id="${names.date}" type="date" value="${today()}" required />`)}
      ${field('deduction', 'Settlement deduction (₹)', `<input id="${names.deduction}" type="number" min="0" step="any" value="0" />`)}
      ${field('deductionReason', 'Deduction reason', `<input id="${names.deductionReason}" placeholder="Required when a deduction is entered" />`)}
      ${field('reason', 'Reference', `<input id="${names.reason}" placeholder="Cash note, UPI / bank reference or cheque number" required />`)}
    </div>`;
  }
  function mount() {
    const modal = document.getElementById('payment-modal');
    if (!modal) return;
    modal.classList.add('mb-payment-overlay');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');
    modal.innerHTML = `<div class="mb-payment-dialog"><header><h2 id="modal-title">Record payment</h2><p id="modal-description">Review the party, bill allocation and payment details before saving.</p><span id="modal-customer-name"></span></header>${fields()}<div class="mb-payment-actions"><button type="button" id="save-payment-btn">Save payment</button><button type="button" id="close-payment-modal-btn">Cancel</button></div></div>`;
  }
  const style = document.createElement('style');
  style.textContent = `
    .mb-payment-overlay {position:fixed!important;inset:0!important;z-index:10000!important;background:rgba(15,30,45,.48)!important;align-items:center;justify-content:center;padding:16px!important;box-sizing:border-box}
    .mb-payment-dialog,.mb-payment-popup {width:min(540px,100%)!important;max-height:90vh!important;overflow:auto!important;border-radius:18px!important;background:white!important;padding:24px!important;box-sizing:border-box;text-align:left!important}
    .mb-payment-dialog header h2,.mb-payment-popup .swal2-title {font-size:23px!important;color:#075a9c!important;margin:0 0 10px!important;padding:0!important}
    .mb-payment-dialog header p {font-size:14px;color:#60758a;margin:0 0 16px}
    .mb-payment-fields {display:grid;gap:7px;text-align:left}
    .mb-payment-fields label {font-size:13px!important;font-weight:700!important;color:#405b70!important;margin:8px 0 0!important}
    .mb-payment-fields input,.mb-payment-fields select {display:block!important;width:100%!important;min-height:44px!important;margin:0!important;padding:10px 12px!important;border:1px solid #cbdbe8!important;border-radius:9px!important;background:#f8fbff!important;color:#24394b!important;font:inherit!important;box-sizing:border-box!important}
    .mb-payment-actions {display:flex;gap:12px;margin-top:22px}
    .mb-payment-actions button {flex:1;border:0;border-radius:9px;padding:13px;font-weight:700;cursor:pointer}
    .mb-payment-actions button:first-child {background:#15803d;color:white}
    .mb-payment-actions button:last-child {background:#e9edf2;color:#26384b}
    .mb-payment-popup .swal2-html-container {margin:12px 0 0!important}
    .swal2-popup.mb-allocation-popup {display:flex!important;flex-direction:column;width:min(760px,calc(100vw - 24px))!important;max-height:calc(100dvh - 32px);padding:20px 20px 0!important;border-radius:16px!important;overflow:hidden;box-sizing:border-box}
    .mb-allocation-popup .swal2-title {flex:none;padding:0 0 12px!important;font-size:22px!important;color:#075a9c}
    .mb-allocation-popup .swal2-html-container {flex:1;min-height:0;overflow:auto!important;margin:0!important;padding:0 4px!important;text-align:left;font-size:14px}
    .mb-allocation-popup .swal2-actions {flex:none;width:100%;box-sizing:border-box;margin:0!important;padding:12px 0!important;background:white;border-top:1px solid #d8e3ef;gap:8px}
    .mb-allocation-popup .swal2-actions button {margin:0!important;border-radius:8px!important;font-size:14px!important;padding:11px 16px!important}
    .mb-allocation-popup .swal2-confirm {background:#15803d!important}
    .mb-allocation-popup .swal2-cancel {background:#64748b!important}
    .mb-allocation-summary {width:100%;margin:0 0 4px;font-size:13px;color:#075a9c;font-weight:700;text-align:center;overflow-wrap:anywhere}
    .mb-allocation-card {min-width:0;margin:10px 0;padding:12px;border:1px solid #cbdbe8;border-radius:10px;background:#f8fbff}
    .mb-allocation-card legend {font-size:13px;font-weight:700;color:#075a9c;max-width:100%;overflow-wrap:anywhere}
    .mb-allocation-fields,.mb-allocation-common {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .mb-allocation-fields label,.mb-allocation-common label {display:block;font-size:13px;font-weight:600;color:#405b70}
    .mb-allocation-fields input {display:block;width:100%;box-sizing:border-box;min-height:40px;padding:8px 10px;margin:5px 0 0;border:1px solid #cbdbe8;border-radius:8px;background:white;font:inherit}
    .mb-allocation-reason,.mb-allocation-reference {grid-column:1/-1}
    .mb-allocation-reason[hidden] {display:none!important}
    .mb-allocation-remaining {margin:10px 0 0;font-size:13px;font-weight:600;color:#405b70}
    .mb-allocation-common {margin:14px 0}
    .mb-allocation-popup .swal2-validation-message {flex:none;margin:8px 0!important;font-size:13px;max-height:70px;overflow:auto}
    @media(max-width:440px){.swal2-popup.mb-allocation-popup{padding:14px 12px 0!important}.mb-allocation-popup .swal2-title{font-size:18px!important}.mb-allocation-fields,.mb-allocation-common{gap:8px}.mb-allocation-popup .swal2-actions button{padding:10px!important;font-size:13px!important}}
  `;
  document.head.appendChild(style);
  const cents = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100)) || Math.abs(number * 100 - Math.round(number * 100)) > 0.00001) throw new Error('Enter non-negative amounts with at most 2 decimal places.');
    return Math.round(number * 100);
  };
  function validateSelection(bills) {
    if (!bills.length) throw new Error('Select bills first.');
    if (bills.length > 5) throw new Error('Select at most 5 bills per payment.');
    const partyId = bills[0].customerId;
    if (!partyId || bills.some(b => !b.customerId || b.customerId !== partyId)) throw new Error('Ek payment mein sirf ek party ke bills select karo. Different parties ya missing Party Master link wale bills ko saath pay nahi kar sakte. No payment saved.');
    if (bills.some(b => b.deleted || b.revisionPending || !['approved','locked'].includes(b.workflowStatus))) throw new Error('Selected bill is archived, Draft or awaiting revision approval. Review it first.');
    return bills.filter(b => cents(b['Final Total']) > cents(b.amountPaid || 0));
  }
  function validatePlan(bills, plan) {
    if (plan.length !== bills.length || new Set(plan.map(p => p.id)).size !== plan.length) throw new Error('Bill selection changed. Reopen payment.');
    let total = 0;
    for (const b of bills) {
      const p = plan.find(p => p.id === b.id);
      if (!p) throw new Error('Missing bill allocation.');
      const cash = cents(p.cashAmount), deduction = cents(p.deductionAmount);
      if (deduction && !p.deductionReason.trim()) throw new Error('Enter a deduction reason for each affected bill.');
      if (cash + deduction > cents(b['Final Total']) - cents(b.amountPaid || 0)) throw new Error(`Payment + deduction exceeds pending amount for ${b['Serial No'] || b.id}.`);
      total += cash + deduction;
    }
    if (!total) throw new Error('Enter a payment or deduction against at least one bill.');
    return total;
  }
  let selectedPaymentBusy = false;
  async function paySelected(ids, expectedPartyId) {
    if (selectedPaymentBusy) return false;
    if (!hasRole('admin','accountant')) { await Swal.fire('Not allowed','Only Admin or Accountant can record payments.','warning'); return false; }
    selectedPaymentBusy = true;
    let saved = false;
    let savedPlan = null;
    try {
      if (!ids.length || ids.length > 5 || new Set(ids).size !== ids.length) throw new Error('Select 1–5 distinct bills per payment.');
      const docs = await Promise.all(ids.map(id => db.collection('bills').doc(id).get({source:'server'})));
      if (docs.some(d => !d.exists)) throw new Error('A selected bill no longer exists. Refresh the list.');
      const all = docs.map(d => ({...d.data(),id:d.id}));
      const bills = validateSelection(all);
      if (expectedPartyId && all[0].customerId !== expectedPartyId) throw new Error('Selected bills do not belong to this ledger.');
      if (!bills.length) throw new Error('All selected bills are already paid. No payment needed.');
      const partyId = bills[0].customerId;
      const paymentRefs = bills.map(() => db.collection('payments').doc());
      const box = document.createElement('div');
      const note = document.createElement('p'); note.textContent = `${bills[0]['Customer Name'] || 'Supplier'} — har bill ka payment alag bharo.${all.length>bills.length ? ` ${all.length-bills.length} fully paid bill(s) excluded.` : ''}`; box.append(note);
      const inputs = bills.map(b => {
        const card = document.createElement('fieldset'); card.className='mb-allocation-card';
        const legend=document.createElement('legend'); legend.textContent=`${b['Serial No'] || b.id} · Pending ₹${((cents(b['Final Total'])-cents(b.amountPaid||0))/100).toFixed(2)}`; card.append(legend);
        const grid=document.createElement('div');grid.className='mb-allocation-fields';card.append(grid);
        const controls={};
        for (const [key,title] of [['cashAmount','Payment to supplier (₹)'],['deductionAmount','Deduction (₹)'],['deductionReason','Deduction reason']]) {
          const label=document.createElement('label'),input=document.createElement('input'); label.textContent=title; input.type=key==='deductionReason'?'text':'number'; input.value='';
          if(input.type==='number'){input.min='0';input.step='0.01';input.placeholder='0';input.inputMode='decimal';input.addEventListener('focus',()=>input.select());input.addEventListener('blur',()=>{if(input.value&&!input.validity.badInput&&Number.isFinite(Number(input.value)))input.value=String(Number(input.value));});}
          else {label.className='mb-allocation-reason';input.placeholder='Reason for this bill deduction';}
          label.append(input);grid.append(label);controls[key]=input;
        }
        const remaining=document.createElement('p');remaining.className='mb-allocation-remaining';card.append(remaining);box.append(card);
        return {b,controls,remaining};
      });
      const common=document.createElement('div'); common.innerHTML=fields(true);box.append(common);
      for (const key of ['cash','deduction','deductionReason']) {common.querySelector('#'+bulkIds[key]).remove();common.querySelector(`label[for="${bulkIds[key]}"]`).remove();}
      const commonGrid=common.querySelector('.mb-payment-fields');commonGrid.classList.add('mb-allocation-common');
      for(const key of ['method','date','reason']){const group=document.createElement('div');if(key==='reason')group.className='mb-allocation-reference';group.append(common.querySelector(`label[for="${bulkIds[key]}"]`),common.querySelector('#'+bulkIds[key]));commonGrid.append(group);}
      const summary=document.createElement('p');summary.className='mb-allocation-summary';box.append(summary);
      const plan=()=>inputs.map(({b,controls})=>({id:b.id,cashAmount:Number(controls.cashAmount.value),deductionAmount:Number(controls.deductionAmount.value),deductionReason:controls.deductionReason.value.trim()}));
      const update=()=>{
        let cash=0,deduction=0;
        inputs.forEach(({b,controls,remaining})=>{const c=Number(controls.cashAmount.value),d=Number(controls.deductionAmount.value);cash+=c;deduction+=d;controls.deductionReason.parentElement.hidden=!(d>0);remaining.textContent=`Remaining after payment: ₹${(Number(b['Final Total'])-Number(b.amountPaid||0)-c-d).toFixed(2)}`;});
        summary.textContent=`Total payment ₹${cash.toFixed(2)} + deduction ₹${deduction.toFixed(2)} = settlement ₹${(cash+deduction).toFixed(2)}`;
      };box.addEventListener('input',update);update();
      const result=await Swal.fire({title:'Review bill-wise payment',html:box,customClass:{popup:'mb-allocation-popup'},didOpen:()=>{Swal.getActions().prepend(summary);},showCancelButton:true,confirmButtonText:'Confirm & save payment',showLoaderOnConfirm:true,allowOutsideClick:()=>!Swal.isLoading(),allowEscapeKey:()=>!Swal.isLoading(),preConfirm:async()=>{
        try {
          const allocation=plan(); validatePlan(bills,allocation);
          if(inputs.some(({controls})=>controls.cashAmount.validity.badInput||controls.deductionAmount.validity.badInput)) throw new Error('Enter valid amounts.');
          const paymentDate=common.querySelector('#'+bulkIds.date).value, paymentMethod=common.querySelector('#'+bulkIds.method).value, reason=common.querySelector('#'+bulkIds.reason).value.trim();
          if(!reason) throw new Error('Enter a payment reference.');
          const date=MandiFinancialYear.parseDate(paymentDate); if(!date) throw new Error('Choose a valid date.');
          if(bills.some(b=>MandiFinancialYear.dateKey(b.Date)>MandiFinancialYear.dateKey(paymentDate))) throw new Error('Payment date cannot be before the bill date.');
          await db.runTransaction(async tx=>{
            await MandiFinancialYear.assertPostingOpen(db,tx,[paymentDate]);
            const existing=await Promise.all(paymentRefs.map(ref=>tx.get(ref)));
            if(existing.some(d=>d.exists)) {
              const same = existing.every((d,i)=>{
                const p=allocation[i];
                if(!d.exists)return !p.cashAmount&&!p.deductionAmount;
                const saved=d.data();
                return saved.cashAmount===p.cashAmount&&saved.deductionAmount===p.deductionAmount&&saved.deductionReason===p.deductionReason&&saved.reason===reason&&saved.paymentMethod===paymentMethod&&MandiFinancialYear.dateKey(saved.paymentDate)===MandiFinancialYear.dateKey(paymentDate);
              });
              if(same)return;
              throw new Error('This attempt has already saved payment entries. Cancel and refresh to review them; do not submit changed amounts.');
            }
            const fresh=await Promise.all(bills.map(b=>tx.get(db.collection('bills').doc(b.id))));
            const partyRef=db.collection('parties').doc(partyId),party=await tx.get(partyRef);
            if(!party.exists||party.data().deleted) throw new Error('Party is missing or archived.');
            if(fresh.some(d=>!d.exists)) throw new Error('A bill is missing.');
            const values=fresh.map(d=>({...d.data(),id:d.id}));validateSelection(values);
            if(values.some((b,i)=>b.customerId!==partyId||b.Date!==bills[i].Date||cents(b.amountPaid||0)!==cents(bills[i].amountPaid||0)||cents(b['Final Total'])!==cents(bills[i]['Final Total']))) throw new Error('Bill or pending amount changed. Cancel and reopen payment.');
            const total=validatePlan(values,allocation);
            const balance=Number(party.data().currentBalance||0);if(!Number.isFinite(balance)) throw new Error('Party balance needs review.');
            allocation.forEach((p,i)=>{
              const credit=cents(p.cashAmount)+cents(p.deductionAmount);if(!credit)return;
              const b=values[i],paid=cents(b.amountPaid||0)+credit,due=cents(b['Final Total'])-paid;
              tx.update(db.collection('bills').doc(b.id),{amountPaid:paid/100,amountDue:due/100,paymentStatus:due===0?'Paid':'Partial',lastUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
              tx.set(paymentRefs[i],{customerId:partyId,customerName:b['Customer Name']||'',customerVillage:b.Village||'N/A',cashAmount:p.cashAmount,deductionAmount:p.deductionAmount,deductionReason:p.deductionReason,paymentMethod,totalCredit:credit/100,paymentDate:firebase.firestore.Timestamp.fromDate(date),appliedToBills:[b.id],reason,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
            });
            tx.update(partyRef,{currentBalance:(Math.round(balance*100)-total)/100,lastUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
          });
          saved=true;savedPlan=allocation;return true;
        } catch(error){Swal.showValidationMessage(error.message);return false;}
      }});
      if(result.isConfirmed&&saved){
        let syncFailed=false, auditFailed=false;
        const orderIds=new Set(bills.map(b=>b.LinkedOrderId).filter(Boolean));
        for(const b of bills.filter(b=>!b.LinkedOrderId&&b['Serial No'])) {
          try {
            const matches=await Promise.all([db.collection('orders').where('linkedBillNo','==',b['Serial No']).get(),db.collection('orders').where('linkedBillNos','array-contains',b['Serial No']).get()]);
            matches.forEach(snapshot=>snapshot.docs.forEach(doc=>orderIds.add(doc.id)));
          }catch(error){syncFailed=true;}
        }
        for(const id of orderIds) {try{await MandiOrderSync.sync(id);}catch(error){syncFailed=true;}}
        if(typeof recordAudit==='function') for(let i=0;i<savedPlan.length;i++) {
          const p=savedPlan[i];if(!p.cashAmount&&!p.deductionAmount)continue;
          try {await recordAudit('payment.created','payment',paymentRefs[i].id,{before:{billId:p.id,amountPaid:bills[i].amountPaid||0},after:{billId:p.id,cashAmount:p.cashAmount,deductionAmount:p.deductionAmount},reason:common.querySelector('#'+bulkIds.reason).value.trim()});}catch(error){auditFailed=true;}
        }
        await Swal.fire('Payment saved',syncFailed||auditFailed?`Payment is saved; do not pay again. ${syncFailed?'Linked order status needs refresh/review. ':''}${auditFailed?'Audit logging needs review.':''}`:'Bill-wise payment and deductions saved. Each entry can be reversed separately.',syncFailed||auditFailed?'warning':'success');
      }
      return saved;
    } catch(error){await Swal.fire('Payment blocked',error.message,'warning');return false;}
    finally {selectedPaymentBusy=false;}
  }
  window.MandiPaymentUI = { mount, fields, today, paySelected, validateSelection, validatePlan };
})();
