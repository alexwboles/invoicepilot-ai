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
    var d = { outstanding: 0, overdue: 0, paid: 0, count: invoices.length,
              buckets: { 'current': 0, '1-30 days': 0, '31-60 days': 0, '60+ days': 0 } };
    invoices.forEach(function (inv) {
      var t = totals(inv).total;
      var s = statusOf(inv, nowMs);
      if (s === 'paid') d.paid = round2(d.paid + t);
      else if (s === 'overdue') { d.overdue = round2(d.overdue + t); d.buckets[agingBucket(inv, nowMs)] = round2(d.buckets[agingBucket(inv, nowMs)] + t); }
      else { d.outstanding = round2(d.outstanding + t); d.buckets.current = round2(d.buckets.current + t); }
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
    var t = totals(inv).total;
    var days = daysOverdue(inv);
    var name = (client && client.name) || inv.clientName || 'there';
    var biz = inv.businessName || 'us';
    var first = String(name).split(' ')[0];
    var subject = '';
    var body = '';
    if (tone === 'gentle') {
      subject = 'Friendly reminder: Invoice ' + inv.number + ' (' + money(t) + ')';
      body = 'Hi ' + first + ',\n\nJust a friendly nudge — invoice ' + inv.number +
        ' for ' + money(t) + ' was due on ' + inv.dueDate +
        (days > 0 ? ' (' + days + (days === 1 ? ' day' : ' days') + ' ago)' : '') +
        '. If you already sent payment, thank you — please ignore this note.\n\n' +
        'Otherwise, you can pay at your earliest convenience. Let me know if anything looks off and I\'ll fix it right away.\n\n' +
        'Thanks so much,\n' + biz;
    } else if (tone === 'firm') {
      subject = 'Payment overdue: Invoice ' + inv.number + ' — ' + money(t);
      body = 'Hi ' + first + ',\n\nI\'m following up on invoice ' + inv.number +
        ' for ' + money(t) + ', which was due ' + inv.dueDate +
        ' (' + days + (days === 1 ? ' day' : ' days') + ' overdue).\n\n' +
        'Please arrange payment this week. If there\'s a problem with the invoice or you need a few more days, reply and tell me — I\'d rather sort it out than chase it.\n\n' +
        'Regards,\n' + biz;
    } else { // final
      subject = 'Final notice: Invoice ' + inv.number + ' — ' + money(t) + ' overdue';
      body = 'Hi ' + first + ',\n\nThis is a final notice for invoice ' + inv.number +
        ' for ' + money(t) + ', now ' + days + (days === 1 ? ' day' : ' days') +
        ' past due (due ' + inv.dueDate + ').\n\n' +
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

  return {
    round2: round2, lineTotal: lineTotal, totals: totals, money: money,
    daysOverdue: daysOverdue, statusOf: statusOf, agingBucket: agingBucket,
    dashboard: dashboard, nextNumber: nextNumber,
    TONES: TONES, dunningDraft: dunningDraft, validate: validate
  };
});
