/* invoicepilot-ai shared logic — works in Node and the browser (no deps) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoicePilot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function lineTotal(item) {
    return round2((Number(item.qty) || 0) * (Number(item.rate) || 0));
  }

  function totals(inv) {
    var subtotal = round2((inv.items || []).reduce(function (s, it) { return s + lineTotal(it); }, 0));
    var discountPct = Math.min(100, Math.max(0, Number(inv.discountPct) || 0));
    var discount = round2(subtotal * discountPct / 100);
    var taxable = round2(subtotal - discount);
    var taxPct = Math.min(100, Math.max(0, Number(inv.taxPct) || 0));
    var tax = round2(taxable * taxPct / 100);
    var total = round2(taxable + tax);
    return { subtotal: subtotal, discountPct: discountPct, discount: discount, taxPct: taxPct, tax: tax, total: total };
  }

  function money(n) {
    return '$' + round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function daysOverdue(inv, nowMs) {
    var now = nowMs || Date.now();
    var due = new Date(inv.dueDate + 'T23:59:59').getTime();
    if (isNaN(due)) return 0;
    return Math.max(0, Math.floor((now - due) / 86400000));
  }

  function statusOf(inv, nowMs) {
    if (inv.status === 'paid') return 'paid';
    // Estimates are quotes, not bills: never outstanding/overdue.
    if (isEstimate(inv)) return inv.status === 'converted' ? 'converted' : 'estimate';
    return daysOverdue(inv, nowMs) > 0 ? 'overdue' : 'outstanding';
  }

  function agingBucket(inv, nowMs) {
    var d = daysOverdue(inv, nowMs);
    if (d <= 0) return 'current';
    if (d <= 30) return '1-30 days';
    if (d <= 60) return '31-60 days';
    return '60+ days';
  }

  function dashboard(invoices, nowMs) {
    var d = { outstanding: 0, overdue: 0, paid: 0, count: 0,
              buckets: { 'current': 0, '1-30 days': 0, '31-60 days': 0, '60+ days': 0 } };
    invoices.forEach(function (inv) {
      if (isEstimate(inv)) return; // quotes don't count as receivables
      d.count++;
      var t = totals(inv).total;
      var bal = balanceDue(inv); // partial payments reduce what's still owed
      var s = statusOf(inv, nowMs);
      if (s === 'paid') d.paid = round2(d.paid + t);
      else if (s === 'overdue') { d.overdue = round2(d.overdue + bal); d.buckets[agingBucket(inv, nowMs)] = round2(d.buckets[agingBucket(inv, nowMs)] + bal); }
      else { d.outstanding = round2(d.outstanding + bal); d.buckets.current = round2(d.buckets.current + bal); }
    });
    return d;
  }

  function nextNumber(invoices) {
    var max = 0;
    (invoices || []).forEach(function (inv) {
      var m = /(\d+)/.exec(inv.number || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'INV-' + String(max + 1).padStart(4, '0');
  }

  /* ---- AI dunning drafts: 3 tones, all local ---- */
  var TONES = ['gentle', 'firm', 'final'];

  function dunningDraft(inv, client, tone) {
    var t = balanceDue(inv); // nudge about what is still owed after partial payments
    var days = daysOverdue(inv);
    var fee = lateFee(inv);
    var name = (client && client.name) || inv.clientName || 'there';
    var biz = inv.businessName || 'us';
    var first = String(name).split(' ')[0];
    var feeNote = fee > 0
      ? ' A late fee of ' + (Number(inv.lateFeePct) || 0) + '% per month applies — ' +
        money(fee) + ' has accrued so far, for a total of ' + money(round2(t + fee)) + '.'
      : '';
    var subject = '';
    var body = '';
    if (tone === 'gentle') {
      subject = 'Friendly reminder: Invoice ' + inv.number + ' (' + money(t) + ')';
      body = 'Hi ' + first + ',\n\nJust a friendly nudge — invoice ' + inv.number +
        ' for ' + money(t) + ' was due on ' + inv.dueDate +
        (days > 0 ? ' (' + days + (days === 1 ? ' day' : ' days') + ' ago)' : '') +
        '.' + feeNote + ' If you already sent payment, thank you — please ignore this note.\n\n' +
        'Otherwise, you can pay at your earliest convenience. Let me know if anything looks off and I\'ll fix it right away.\n\n' +
        'Thanks so much,\n' + biz;
    } else if (tone === 'firm') {
      subject = 'Payment overdue: Invoice ' + inv.number + ' — ' + money(t);
      body = 'Hi ' + first + ',\n\nI\'m following up on invoice ' + inv.number +
        ' for ' + money(t) + ', which was due ' + inv.dueDate +
        ' (' + days + (days === 1 ? ' day' : ' days') + ' overdue).' + feeNote + '\n\n' +
        'Please arrange payment this week. If there\'s a problem with the invoice or you need a few more days, reply and tell me — I\'d rather sort it out than chase it.\n\n' +
        'Regards,\n' + biz;
    } else { // final
      subject = 'Final notice: Invoice ' + inv.number + ' — ' + money(t) + ' overdue';
      body = 'Hi ' + first + ',\n\nThis is a final notice for invoice ' + inv.number +
        ' for ' + money(t) + ', now ' + days + (days === 1 ? ' day' : ' days') +
        ' past due (due ' + inv.dueDate + ').' + feeNote + '\n\n' +
        'If payment isn\'t received within 7 days, I\'ll have to pause any ongoing work and may refer the balance for collection, which I\'d hate to do.\n\n' +
        'Please pay today or contact me immediately to make an arrangement.\n\n' + biz;
    }
    return { tone: tone, subject: subject, body: body };
  }

  function validate(inv) {
    var errs = [];
    if (!inv.clientName || !String(inv.clientName).trim()) errs.push('Client is required.');
    if (!inv.number || !String(inv.number).trim()) errs.push('Invoice number is required.');
    if (!inv.issueDate) errs.push('Issue date is required.');
    if (!inv.dueDate) errs.push('Due date is required.');
    if (inv.issueDate && inv.dueDate && inv.dueDate < inv.issueDate) errs.push('Due date cannot be before issue date.');
    var items = inv.items || [];
    if (!items.length) errs.push('Add at least one line item.');
    items.forEach(function (it, i) {
      if (!it.desc || !String(it.desc).trim()) errs.push('Line ' + (i + 1) + ': description required.');
      if (!(Number(it.qty) > 0)) errs.push('Line ' + (i + 1) + ': quantity must be > 0.');
      if (!(Number(it.rate) >= 0)) errs.push('Line ' + (i + 1) + ': rate must be >= 0.');
    });
    return errs;
  }

  /* ---- late fees: simple interest on the unpaid balance per 30-day month ---- */
  // pctPerMonth defaults to the invoice's own lateFeePct (0 = no late fees).
  function lateFee(inv, pctPerMonth, nowMs) {
    var pct = pctPerMonth != null ? Number(pctPerMonth) : Number(inv.lateFeePct || 0);
    if (!(pct > 0)) return 0;
    var days = daysOverdue(inv, nowMs);
    if (days <= 0) return 0;
    var bal = balanceDue(inv);
    if (bal <= 0) return 0;
    return round2(bal * (pct / 100) * (days / 30));
  }

  function totalWithLateFee(inv, pctPerMonth, nowMs) {
    return round2(balanceDue(inv) + lateFee(inv, pctPerMonth, nowMs));
  }

  // Sum of late fees across a set of invoices (for the dashboard).
  function lateFeesTotal(invoices, nowMs) {
    return round2((invoices || []).reduce(function (s, inv) { return s + lateFee(inv, null, nowMs); }, 0));
  }

  /* ---- payer reliability: how fast does this client actually pay? ---- */
  // rating: 'on-time' | 'usually-late' | 'slow'
  function payerProfile(invoices, key, nowMs) {
    var invs = (invoices || []).filter(function (inv) {
      if (isEstimate(inv)) return false;
      return (inv.clientId || inv.clientName || 'unknown') === key;
    });
    var paid = 0, lateSum = 0, lateCount = 0, overdueCount = 0, overdueBal = 0;
    invs.forEach(function (inv) {
      if (isEstimate(inv)) return;
      var st = statusOf(inv, nowMs);
      if (st === 'paid') {
        paid++;
        var lastPay = null;
        (inv.payments || []).forEach(function (p) { if (!lastPay || p.date > lastPay) lastPay = p.date; });
        var ref = lastPay || inv.issueDate;
        var late = 0;
        if (ref && inv.dueDate && inv.dueDate <= ref) {
          late = Math.max(0, Math.round(
            (new Date(ref + 'T12:00:00') - new Date(inv.dueDate + 'T12:00:00')) / 86400000));
        }
        lateSum += late;
        if (late > 0) lateCount++;
      } else if (st === 'overdue') {
        overdueCount++;
        overdueBal = round2(overdueBal + balanceDue(inv));
      }
    });
    var avgLate = paid ? round2(lateSum / paid) : 0;
    var rating = 'on-time';
    if (overdueCount > 0 || avgLate > 14) rating = 'slow';
    else if (lateCount > 0 || avgLate > 3) rating = 'usually-late';
    return {
      invoices: invs.length, paid: paid, avgDaysLate: avgLate, lateCount: lateCount,
      overdueCount: overdueCount, overdueBalance: overdueBal, rating: rating
    };
  }

  /* ---- recurring invoices: clone with dates advanced by cadence ---- */
  var CADENCES = { monthly: 1, quarterly: 3, yearly: 12 };

  function advanceMonths(dateStr, months) {
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    d.setMonth(d.getMonth() + months);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // Next invoice in a recurring series: same lines, dates pushed forward.
  function recurringClone(inv, cadence, number) {
    var months = CADENCES[cadence] || 1;
    var copy = cloneInvoice(inv, number);
    if (inv.issueDate) copy.issueDate = advanceMonths(inv.issueDate, months);
    if (inv.dueDate) copy.dueDate = advanceMonths(inv.dueDate, months);
    copy.recurring = cadence;
    copy.lateFeePct = inv.lateFeePct || 0;
    return copy;
  }

  /* ---- estimates: quote first, convert to invoice on approval ---- */
  function isEstimate(inv) { return !!(inv && inv.kind === 'estimate'); }

  // Convert an estimate into a real invoice: fresh number/id, issued today,
  // due date keeps the original issue->due gap. The estimate is retired
  // (status 'converted') but stays in the ledger as the quote record.
  function convertEstimate(inv, number, todayStr) {
    var today = todayStr || new Date().toISOString().slice(0, 10);
    var gap = 14;
    if (inv.issueDate && inv.dueDate) {
      gap = Math.max(0, Math.round(
        (new Date(inv.dueDate + 'T12:00:00') - new Date(inv.issueDate + 'T12:00:00')) / 86400000));
    }
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() + gap);
    var copy = cloneInvoice(inv, number);
    copy.kind = 'invoice';
    copy.status = 'unpaid';
    copy.issueDate = today;
    copy.dueDate = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    copy.fromEstimate = inv.number || inv.id;
    return copy;
  }

  /* ---- tax summary: quarterly billed vs collected tax for filing ---- */
  function quarterOf(dateStr) {
    var d = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 };
  }

  // Per-quarter by issue date: invoiced, tax billed, collected, tax collected.
  // Tax collected is pro-rata on the paid fraction — an honest estimate.
  function taxSummary(invoices, year) {
    var out = {};
    for (var q = 1; q <= 4; q++) out[q] = { quarter: q, invoiced: 0, taxBilled: 0, collected: 0, taxCollected: 0 };
    (invoices || []).forEach(function (inv) {
      if (isEstimate(inv)) return;
      var qq = quarterOf(inv.issueDate);
      if (!qq || qq.year !== year) return;
      var t = totals(inv);
      var paid = paidTotal(inv);
      var frac = t.total > 0 ? paid / t.total : 0;
      var g = out[qq.q];
      g.invoiced = round2(g.invoiced + t.total);
      g.taxBilled = round2(g.taxBilled + t.tax);
      g.collected = round2(g.collected + paid);
      g.taxCollected = round2(g.taxCollected + round2(t.tax * frac));
    });
    var total = { invoiced: 0, taxBilled: 0, collected: 0, taxCollected: 0 };
    for (var q2 = 1; q2 <= 4; q2++) {
      total.invoiced = round2(total.invoiced + out[q2].invoiced);
      total.taxBilled = round2(total.taxBilled + out[q2].taxBilled);
      total.collected = round2(total.collected + out[q2].collected);
      total.taxCollected = round2(total.taxCollected + out[q2].taxCollected);
    }
    return { year: year, quarters: [out[1], out[2], out[3], out[4]], total: total };
  }

  /* ---- client statement: full account history for one client ---- */
  function clientStatement(invoices, clientKey, nowMs) {
    var lines = [];
    var totalBilled = 0, totalPaid = 0, overdueBalance = 0, name = '—';
    (invoices || []).forEach(function (inv) {
      if (isEstimate(inv)) return;
      if ((inv.clientId || inv.clientName || 'unknown') !== clientKey) return;
      name = inv.clientName || name;
      var t = totals(inv), paid = paidTotal(inv), bal = round2(t.total - paid);
      var st = statusOf(inv, nowMs);
      totalBilled = round2(totalBilled + t.total);
      totalPaid = round2(totalPaid + paid);
      if (st === 'overdue') overdueBalance = round2(overdueBalance + bal);
      lines.push({ number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate,
                   total: t.total, paid: paid, balance: bal, status: st,
                   daysOverdue: daysOverdue(inv, nowMs) });
    });
    lines.sort(function (a, b) { return String(a.issueDate).localeCompare(String(b.issueDate)); });
    return { name: name, lines: lines, totalBilled: totalBilled, totalPaid: totalPaid,
             balance: round2(totalBilled - totalPaid), overdueBalance: overdueBalance };
  }

  /* ---- payments (partial payments + balance) ---- */
  function paidTotal(inv) {
    return round2((inv.payments || []).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0));
  }

  function balanceDue(inv) {
    return round2(totals(inv).total - paidTotal(inv));
  }

  // Records a payment against an invoice. Marks it paid when the balance clears.
  // Returns {ok:true, payment, balance} or {ok:false, error}.
  function addPayment(inv, amount, dateStr) {
    var amt = Number(amount);
    if (!(amt > 0)) return { ok: false, error: 'Payment must be greater than 0.' };
    var bal = balanceDue(inv);
    if (amt - bal > 0.005) return { ok: false, error: 'Payment exceeds the balance of ' + money(bal) + '.' };
    var p = { amount: round2(amt), date: dateStr || new Date().toISOString().slice(0, 10) };
    inv.payments = inv.payments || [];
    inv.payments.push(p);
    if (balanceDue(inv) <= 0.005) inv.status = 'paid';
    return { ok: true, payment: p, balance: balanceDue(inv) };
  }

  /* ---- duplicate invoice (re-bill a repeat client) ---- */
  function cloneInvoice(inv, number) {
    var items = (inv.items || []).map(function (it) {
      return { desc: it.desc, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 };
    });
    return {
      id: 'i' + Date.now(),
      number: number,
      kind: inv.kind || 'invoice',
      clientId: inv.clientId, clientName: inv.clientName,
      businessName: inv.businessName,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: inv.dueDate,
      items: items,
      discountPct: inv.discountPct || 0, taxPct: inv.taxPct || 0,
      notes: inv.notes || '', status: inv.kind === 'estimate' ? 'estimate' : 'unpaid', payments: []
    };
  }

  /* ---- CSV export of the invoice ledger ---- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function invoicesToCSV(invoices) {
    var rows = [['Number', 'Kind', 'Client', 'Issue date', 'Due date', 'Status',
                 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Late fee']];
    (invoices || []).forEach(function (inv) {
      var t = totals(inv);
      rows.push([
        inv.number || '', isEstimate(inv) ? 'estimate' : 'invoice', inv.clientName || '', inv.issueDate || '', inv.dueDate || '',
        statusOf(inv), t.subtotal.toFixed(2), t.discount.toFixed(2), t.tax.toFixed(2),
        t.total.toFixed(2), paidTotal(inv).toFixed(2), balanceDue(inv).toFixed(2),
        isEstimate(inv) ? '0.00' : lateFee(inv).toFixed(2)
      ]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ---- per-client outstanding/overdue totals ---- */
  function clientTotals(invoices, nowMs) {
    var out = {};
    (invoices || []).forEach(function (inv) {
      if (isEstimate(inv)) return;
      var key = inv.clientId || inv.clientName || 'unknown';
      var g = out[key] || (out[key] = { name: inv.clientName || '—', unpaid: 0, overdue: 0, count: 0 });
      var st = statusOf(inv, nowMs);
      if (st === 'paid') return;
      var bal = balanceDue(inv);
      g.unpaid = round2(g.unpaid + bal);
      g.count += 1;
      if (st === 'overdue') g.overdue = round2(g.overdue + bal);
    });
    return out;
  }

  return {
    round2: round2, lineTotal: lineTotal, totals: totals, money: money,
    daysOverdue: daysOverdue, statusOf: statusOf, agingBucket: agingBucket,
    dashboard: dashboard, nextNumber: nextNumber,
    TONES: TONES, dunningDraft: dunningDraft, validate: validate,
    paidTotal: paidTotal, balanceDue: balanceDue, addPayment: addPayment,
    cloneInvoice: cloneInvoice, invoicesToCSV: invoicesToCSV, clientTotals: clientTotals,
    lateFee: lateFee, totalWithLateFee: totalWithLateFee, lateFeesTotal: lateFeesTotal,
    payerProfile: payerProfile, recurringClone: recurringClone, advanceMonths: advanceMonths,
    CADENCES: CADENCES,
    isEstimate: isEstimate, convertEstimate: convertEstimate,
    taxSummary: taxSummary, quarterOf: quarterOf, clientStatement: clientStatement
  };
});
