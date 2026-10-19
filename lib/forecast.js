/* invoicepilot-ai 13-week cash forecast engine — works in Node and the browser (no deps).
   Adapted from cashflow-ai's forecast engine for the merge: outstanding invoices
   auto-feed the "money in" side via invoicesToCashIn(). Money out is bills the
   owner enters (with recurring support); what-if scenarios shift payments. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoiceForecast = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseAmount(s) {
    if (s == null) return null;
    var t = String(s).trim().replace(/[$,\s]/g, '');
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t.charAt(0) === '-') { neg = true; t = t.slice(1); }
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var v = parseFloat(t);
    return neg ? -v : v;
  }

  function parseDate(s) {
    if (s == null) return null;
    var t = String(s).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) {
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      return (d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (m) {
      var d2 = new Date(+m[3], +m[1] - 1, +m[2]);
      return (d2.getFullYear() === +m[3] && d2.getMonth() === +m[1] - 1 && d2.getDate() === +m[2]) ? d2 : null;
    }
    return null;
  }

  function toISODate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function weekStartOf(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
    return x;
  }

  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function addMonths(d, n) {
    var y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  }

  /* ---- auto-feed: outstanding invoices -> forecast "money in" ----
     invoices: InvoicePilot invoice records; L: the shared invoice logic module.
     Each unpaid, non-estimate invoice becomes one money-in item dated on its
     due date for its remaining balance (partial payments already deducted).
     Past-due (overdue) invoices are left dated in the past — forecast() folds
     them into week 0, the "money expected any day now" bucket. */
  function invoicesToCashIn(invoices, L) {
    if (!L || typeof L.statusOf !== 'function') throw new Error('invoicesToCashIn needs the InvoicePilot logic module');
    var out = [];
    (invoices || []).forEach(function (inv) {
      if (L.isEstimate(inv)) return;                 // quotes are not receivables
      if (L.statusOf(inv) === 'paid') return;        // already collected
      var bal = L.balanceDue(inv);
      if (!(bal > 0)) return;                        // nothing left to collect
      var dt = parseDate(inv.dueDate);
      if (!dt) return;                               // can't place it on the timeline
      out.push({
        id: 'inv-' + (inv.id || inv.number || out.length),
        kind: 'in',
        desc: (inv.number || 'Invoice') + ' · ' + (inv.clientName || 'client'),
        date: toISODate(dt),
        amount: bal,
        auto: true,                                  // fed from the ledger; edit the invoice, not this row
        invoiceId: inv.id || null,
        clientName: inv.clientName || ''
      });
    });
    return out;
  }

  // Recurring bills (recurring: 'weekly' | 'monthly' | 'quarterly' | 'yearly')
  // are projected forward across the horizon. Past occurrences are NOT
  // resurrected: projection starts at the later of (item date, current week).
  // Each occurrence carries baseId (the original item id) and an occurrence index.
  function expandRecurring(items, weeks) {
    weeks = weeks || 13;
    var today = new Date();
    var w0 = weekStartOf(today);
    var horizonEnd = addDays(w0, weeks * 7 - 1);
    var out = [];
    (items || []).forEach(function (it) {
      var rec = it.recurring === 'weekly' ? 'weekly'
        : it.recurring === 'monthly' ? 'monthly'
        : it.recurring === 'quarterly' ? 'quarterly'
        : it.recurring === 'yearly' ? 'yearly' : '';
      var d0 = parseDate(it.date);
      if (!rec || !d0) { out.push(it); return; }
      var start = d0 < w0 ? new Date(w0.getTime()) : d0;
      var d = new Date(start.getTime());
      var k = 0;
      while (d <= horizonEnd && k <= weeks) {
        var occ = {}, key;
        for (key in it) occ[key] = it[key];
        occ.date = toISODate(d);
        occ.baseId = it.id;
        occ.id = it.id + '#' + k;
        occ.occurrence = k;
        out.push(occ);
        d = rec === 'weekly' ? addDays(d, 7)
          : rec === 'monthly' ? addMonths(d, 1)
          : rec === 'quarterly' ? addMonths(d, 3)
          : addMonths(d, 12);
        k++;
      }
    });
    return out;
  }

  // shiftMap: { itemId: weeksShift } — delays 'in' items (what-if late payment)
  // and shifts 'out' items (what-if delayed bill). Negative values move an
  // item earlier. Shifting a recurring base id shifts every occurrence.
  function forecast(items, startBalance, weeks, shiftMap) {
    weeks = weeks || 13;
    shiftMap = shiftMap || {};
    var today = new Date();
    var w0 = weekStartOf(today);
    var fc = [];
    for (var w = 0; w < weeks; w++) {
      var ws = addDays(w0, w * 7), we = addDays(w0, w * 7 + 6);
      fc.push({ index: w, start: toISODate(ws), end: toISODate(we), inflow: 0, outflow: 0, net: 0, balance: 0, items: [] });
    }
    expandRecurring(items, weeks).forEach(function (it) {
      var dt = parseDate(it.date);
      if (!dt) return;
      var shift = Math.max(-12, Math.min(12, parseInt(shiftMap[it.baseId || it.id] || 0, 10) || 0));
      if (shift) dt = addDays(dt, shift * 7);
      var wi = Math.floor((weekStartOf(dt) - w0) / (7 * 86400000));
      if (wi < 0) wi = 0;               // overdue / past items land in week 0
      if (wi >= weeks) return;          // beyond the horizon
      if (it.kind === 'in') fc[wi].inflow += it.amount; else fc[wi].outflow += it.amount;
      fc[wi].items.push(it);
    });
    var bal = +startBalance || 0;
    fc.forEach(function (wk) {
      wk.net = wk.inflow - wk.outflow;
      bal += wk.net;
      wk.balance = Math.round(bal * 100) / 100;
      wk.inflow = Math.round(wk.inflow * 100) / 100;
      wk.outflow = Math.round(wk.outflow * 100) / 100;
      wk.net = Math.round(wk.net * 100) / 100;
    });
    return fc;
  }

  function shortfalls(fc, warnAt) {
    warnAt = (warnAt == null) ? 1000 : warnAt;
    var crit = [], watch = [];
    (fc || []).forEach(function (wk) {
      if (wk.balance < 0) crit.push(wk);
      else if (wk.balance < warnAt) watch.push(wk);
    });
    return { critical: crit, watch: watch };
  }

  function totals(fc) {
    var t = { totalIn: 0, totalOut: 0, minBalance: Infinity, endBalance: 0 };
    (fc || []).forEach(function (wk) {
      t.totalIn += wk.inflow; t.totalOut += wk.outflow;
      if (wk.balance < t.minBalance) t.minBalance = wk.balance;
    });
    if (fc && fc.length) t.endBalance = fc[fc.length - 1].balance;
    if (t.minBalance === Infinity) t.minBalance = 0;
    t.totalIn = Math.round(t.totalIn * 100) / 100;
    t.totalOut = Math.round(t.totalOut * 100) / 100;
    return t;
  }

  // Weeks of cash remaining before the balance goes negative.
  function runwayWeeks(fc) {
    for (var i = 0; i < (fc || []).length; i++) if (fc[i].balance < 0) return i;
    return Infinity;
  }

  // Scenario comparison vs a base forecast.
  function scenarioDiff(fcBase, fcScn, warnAt) {
    var tB = totals(fcBase), tS = totals(fcScn);
    var bCrit = shortfalls(fcBase, warnAt).critical.length;
    var sCrit = shortfalls(fcScn, warnAt).critical.length;
    return {
      endDelta: Math.round((tS.endBalance - tB.endBalance) * 100) / 100,
      minDelta: Math.round((tS.minBalance - tB.minBalance) * 100) / 100,
      baseShortfalls: bCrit,
      scnShortfalls: sCrit,
      newShortfalls: sCrit - bCrit,
      baseEnd: tB.endBalance, scnEnd: tS.endBalance,
      baseMin: tB.minBalance, scnMin: tS.minBalance,
      warnAt: warnAt
    };
  }

  function money(n) {
    var neg = n < 0, v = Math.abs(Math.round(n * 100) / 100);
    var s = v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s;
  }

  function fmtWeek(wk) {
    function short(iso) { var p = iso.split('-'); return p[1] + '/' + p[2]; }
    return short(wk.start) + '–' + short(wk.end);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Week-by-week forecast export: one row per week + the items behind the numbers.
  function forecastToCSV(fc) {
    var rows = [['Week', 'Start', 'End', 'Money in', 'Money out', 'Net', 'Balance', 'Items']];
    (fc || []).forEach(function (w, i) {
      var items = w.items.map(function (it) {
        return (it.kind === 'in' ? '+' : '-') + it.desc + ' (' + money(it.amount) +
          (it.occurrence > 0 ? ', recurring' : '') + ')';
      }).join('; ');
      rows.push(['Wk ' + (i + 1), w.start, w.end,
        w.inflow.toFixed(2), w.outflow.toFixed(2), w.net.toFixed(2), w.balance.toFixed(2), items]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function recurringLabel(it) {
    return it.recurring === 'weekly' ? 'weekly'
      : it.recurring === 'monthly' ? 'monthly'
      : it.recurring === 'quarterly' ? 'quarterly'
      : it.recurring === 'yearly' ? 'yearly' : '';
  }

  var _seq = 1;
  function newId(prefix) { return (prefix || 'it') + '-' + Date.now().toString(36) + '-' + (_seq++); }

  // Cash buffer (Xero-style): weeks until the balance goes negative if NO more
  // money comes in — only outflows drain the starting balance.
  function bufferWeeks(items, startBalance, weeks) {
    var outs = (items || []).filter(function (it) { return it.kind !== 'in'; });
    var fc = forecast(outs, startBalance, weeks, {});
    for (var i = 0; i < fc.length; i++) if (fc[i].balance < 0) return i;
    return Infinity;
  }

  return {
    parseAmount: parseAmount, parseDate: parseDate, toISODate: toISODate,
    weekStartOf: weekStartOf, addDays: addDays, addMonths: addMonths,
    invoicesToCashIn: invoicesToCashIn,
    expandRecurring: expandRecurring, recurringLabel: recurringLabel,
    forecast: forecast, shortfalls: shortfalls, totals: totals,
    runwayWeeks: runwayWeeks, bufferWeeks: bufferWeeks, scenarioDiff: scenarioDiff,
    money: money, fmtWeek: fmtWeek, forecastToCSV: forecastToCSV, newId: newId
  };
});
