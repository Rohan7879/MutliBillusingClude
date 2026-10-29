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
  `;
  document.head.appendChild(style);
  window.MandiPaymentUI = { mount, fields, today };
})();
