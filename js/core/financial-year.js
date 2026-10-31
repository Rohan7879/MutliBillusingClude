/* Read-only April–March accounting helpers. Amounts returned are integer cents.
 * Initial opening is a baseline before the transaction history, never a yearly entry.
 * Positive balance = payable by customer; negative = customer advance (credit).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MandiFinancialYear = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Date objects are accepted for adapters; strings must be exact calendar dates.
  function parseDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : parseDate(
        `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
      );
    }
    if (typeof value !== "string") return null;
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    let year, month, day;
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
      if (!match) return null;
      [, day, month, year] = match.map(Number);
    }
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function dateKey(value) {
    const date = parseDate(value);
    if (!date) throw new RangeError("Invalid calendar date");
    return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function financialYearId(value) {
    const date = parseDate(value);
    if (!date) throw new RangeError("Invalid calendar date");
    const year = date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
    if (year < 1 || year >= 9999) throw new RangeError("Financial year out of range");
    return `${String(year).padStart(4, "0")}-${String(year + 1).padStart(4, "0")}`;
  }

  function boundaries(id) {
    const match = /^(\d{4})-(\d{4})$/.exec(id);
    if (!match || +match[1] < 1 || +match[2] !== +match[1] + 1) throw new RangeError("Invalid FY ID; use YYYY-YYYY");
    return { start: `${match[1]}-04-01`, end: `${match[2]}-03-31` };
  }

  function toCents(value) {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new TypeError("Invalid monetary amount");
    const [coefficient, exponent = "0"] = String(Math.abs(amount)).split("e");
    const cents = Math.sign(amount) * Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
    if (!Number.isSafeInteger(cents)) throw new RangeError("Amount exceeds safe integer cents");
    return cents || 0;
  }

  function partyOpeningCents(party = {}) {
    // Party Master defaults missing opBalType to Cr (Jama), not Dr.
    const type = String(party.opBalType || "Cr").trim().toUpperCase();
    if (type !== "DR" && type !== "CR") throw new TypeError("Invalid opening balance type");
    return (toCents(party.opBal) * (type === "DR" ? 1 : -1)) || 0;
  }

  function availableYears(transactions, currentDate) {
    const years = new Set([financialYearId(currentDate)]);
    transactions.forEach(tx => { if (parseDate(tx.date)) years.add(financialYearId(tx.date)); });
    return Array.from(years).sort().reverse();
  }

  function summarize(transactions, { fyId = null, start = null, end = null, initialOpeningCents = 0 } = {}) {
    if (!Number.isSafeInteger(initialOpeningCents)) throw new TypeError("Opening must be integer cents");
    let from = start ? dateKey(start) : null;
    let to = end ? dateKey(end) : null;
    if (fyId) {
      const fy = boundaries(fyId);
      from = from && from > fy.start ? from : fy.start;
      to = to && to < fy.end ? to : fy.end;
    }
    if (from && to && from > to) throw new RangeError("Date range is empty or outside the selected financial year");
    let openingCents = initialOpeningCents, debitCents = 0, creditCents = 0, invalidDateCount = 0;
    const rows = [];
    transactions.forEach((transaction, index) => {
      const date = parseDate(transaction.date);
      if (!date) { invalidDateCount++; return; }
      const key = dateKey(date);
      const debit = toCents(transaction.debit), credit = toCents(transaction.credit);
      if (from && key < from) openingCents += debit - credit;
      else if (!to || key <= to) {
        debitCents += debit;
        creditCents += credit;
        rows.push({ transaction, key, index, debitCents: debit, creditCents: credit });
      }
    });
    rows.sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);
    let closingCents = openingCents;
    rows.forEach(row => { closingCents += row.debitCents - row.creditCents; row.balanceCents = closingCents; });
    if (![openingCents, debitCents, creditCents, closingCents, ...rows.map(row => row.balanceCents)].every(Number.isSafeInteger)) {
      throw new RangeError("Totals exceed safe integer cents");
    }
    return { start: from, end: to, openingCents, debitCents, creditCents, closingCents, rows, invalidDateCount };
  }

  async function assertPostingOpen(db, transaction, dates) {
    const ref = db.collection("settings").doc("accountingControl");
    const snapshot = transaction ? await transaction.get(ref) : await ref.get({ source: "server" });
    const control = snapshot.exists ? snapshot.data() : {};
    if (control.maintenance) throw new Error("Financial-year preparation is running. Accounting changes are temporarily paused; retry after the administrator finishes it.");
    const cutoff = control.closedThrough || 0;
    for (const value of dates) {
      const key = Number(dateKey(value).replaceAll("-", ""));
      if (key <= cutoff) throw new Error(`This date is in a closed financial year (locked through 31 March ${String(cutoff).slice(0,4)}). Ask an administrator to review/reopen the year; no entry was saved.`);
    }
  }
  function resolveBroker(parties, id, name) {
    const norm = value => String(value || "").trim().toUpperCase();
    const brokers = parties.filter(p => p.deleted !== true && norm(p.type) === "BROKER");
    if (id) {
      const exact = brokers.find(p => p.id === id);
      if (exact) return exact;
      // Older bills used a name-derived ID, not the Party Master document ID.
      // Only that known legacy shape may fall back to an unambiguous name.
      if (id !== norm(name).replace(/\s+/g, "_")) return null;
    }
    const matches = brokers.filter(p => norm(name) && norm(p.name) === norm(name));
    return matches.length === 1 ? matches[0] : null;
  }
  return Object.freeze({ parseDate, dateKey, financialYearId, boundaries, toCents, partyOpeningCents, availableYears, summarize, assertPostingOpen, resolveBroker });
});
