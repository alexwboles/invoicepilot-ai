/* invoicepilot-ai frontend */
(function () {
  'use strict';
  var L = window.InvoicePilot;
  var KEY = 'ip6';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || blank(); }
    catch (e) { return blank(); }
  }
  function blank() { return { clients: [], invoices: [], remLog: [], biz: '' }; }
  function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
  var S = load();

  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function plusDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

  /* ---- tabs ---- */
  function goTab(name) {
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
    var b = document.querySelector('#tabs button[data-tab="' + name + '"]');
    if (b) b.classList.add('active');
    $('tab-' + name).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { goTab(b.dataset.tab); });
  });

  /* ---- clients ---- */
  function renderClients() {
    var sel = $('fClient'); sel.innerHTML = '';
    if (!S.clients.length) sel.innerHTML = '<option value="">— add a client first —</option>';
    S.clients.forEach(function (c) {
      var o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    var ct = L.clientTotals(S.invoices);
    var html = '<table><tr><th>Name</th><th>Email</th><th>Invoices</th><th>Unpaid</th><th>Overdue</th><th>Reliability</th><th></th></tr>';
    S.clients.forEach(function (c) {
      var invs = S.invoices.filter(function (i) { return i.clientId === c.id; });
      var g = ct[c.id] || { unpaid: 0, overdue: 0 };
      var prof = L.payerProfile(S.invoices, c.id);
      var badge = prof.invoices === 0 ? '<span class="muted">—</span>'
        : '<span class="pill pay-' + prof.rating + '" title="' + prof.paid + ' paid · avg ' + prof.avgDaysLate +
          ' days late' + (prof.overdueCount ? ' · ' + prof.overdueCount + ' overdue now' : '') + '">' +
          (prof.rating === 'on-time' ? 'On time' : prof.rating === 'usually-late' ? 'Usually late' : 'Slow payer') + '</span>';
      html += '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email || '—') + '</td><td>' + invs.length +
        '</td><td>' + L.money(g.unpaid) + '</td><td>' + (g.overdue > 0 ? '<strong>' + L.money(g.overdue) + '</strong>' : L.money(0)) +
        '</td><td>' + badge + '</td><td><button class="ghost" data-statement="' + c.id + '">Statement</button> ' +
        '<button class="ghost" data-delclient="' + c.id + '">Delete</button></td></tr>';
    });
    $('clientList').innerHTML = html + '</table>';
    document.querySelectorAll('[data-statement]').forEach(function (b) {
      b.addEventListener('click', function () { renderStatement(b.dataset.statement); });
    });
    document.querySelectorAll('[data-delclient]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this client? Invoices stay.')) return;
        S.clients = S.clients.filter(function (c) { return c.id !== b.dataset.delclient; });
        save(); renderClients(); renderDashboard();
      });
    });
    $('sBiz').value = S.biz || '';
  }
  $('addClient').addEventListener('click', function () {
    var name = $('cName').value.trim();
    if (!name) { toast('Client name required'); return; }
    S.clients.push({ id: 'c' + Date.now(), name: name, email: $('cEmail').value.trim() });
    $('cName').value = ''; $('cEmail').value = '';
    save(); renderClients(); renderDashboard(); toast('Client added');
  });
  $('saveBiz').addEventListener('click', function () {
    S.biz = $('sBiz').value.trim(); save(); toast('Business name saved');
  });

  /* ---- client statement of account ---- */
  function renderStatement(clientId) {
    var c = S.clients.find(function (x) { return x.id === clientId; });
    var s = L.clientStatement(S.invoices, clientId);
    var rows = s.lines.map(function (l) {
      return '<tr><td>' + esc(l.number) + '</td><td>' + esc(l.issueDate) + '</td><td>' + esc(l.dueDate) +
        '</td><td>' + L.money(l.total) + '</td><td>' + L.money(l.paid) + '</td><td>' + L.money(l.balance) +
        '</td><td><span class="pill ' + l.status + '">' + l.status + '</span></td></tr>';
    }).join('');
    var p = $('stmtPanel');
    p.style.display = '';
    p.innerHTML =
      '<div class="invhead"><div><h2>' + esc(S.biz || 'Your Business') + '</h2><div class="muted">STATEMENT OF ACCOUNT</div></div>' +
      '<div style="text-align:right"><div><strong>' + esc(c ? c.name : s.name) + '</strong></div>' +
      '<div class="muted">As of ' + esc(todayStr()) + '</div></div></div>' +
      (rows ? '<table><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr>' + rows + '</table>'
        : '<p class="muted">No invoices for this client yet.</p>') +
      '<div style="text-align:right;margin-top:10px">' +
      '<div>Total billed: ' + L.money(s.totalBilled) + '</div>' +
      '<div>Total paid: ' + L.money(s.totalPaid) + '</div>' +
      (s.overdueBalance > 0 ? '<div>Overdue: <strong>' + L.money(s.overdueBalance) + '</strong></div>' : '') +
      '<div style="font-size:1.3rem;font-weight:800">Balance due: ' + L.money(s.balance) + '</div></div>' +
      '<div class="row" style="margin-top:10px"><button id="printStmt" class="ghost">Print statement</button> ' +
      '<button id="closeStmt" class="ghost">Close</button></div>';
    $('printStmt').addEventListener('click', function () { window.print(); });
    $('closeStmt').addEventListener('click', function () { p.style.display = 'none'; p.innerHTML = ''; });
    p.scrollIntoView();
  }

  /* ---- new invoice form ---- */
  var items = [];
  function renderItems() {
    var w = $('items'); w.innerHTML = '';
    items.forEach(function (it, i) {
      var r = document.createElement('div'); r.className = 'itemrow';
      r.innerHTML = '<input placeholder="Description" data-k="desc" value="' + esc(it.desc) + '">' +
        '<input type="number" placeholder="Qty" data-k="qty" value="' + esc(it.qty) + '" min="0" step="0.5">' +
        '<input type="number" placeholder="Rate" data-k="rate" value="' + esc(it.rate) + '" min="0" step="0.01">' +
        '<span class="muted">' + esc(L.money(L.lineTotal(it))) + '</span>' +
        '<button class="del" title="Remove">✕</button>';
      r.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          it[inp.dataset.k] = inp.dataset.k === 'desc' ? inp.value : Number(inp.value);
          renderPreview();
          r.querySelector('span').textContent = L.money(L.lineTotal(it));
        });
      });
      r.querySelector('.del').addEventListener('click', function () { items.splice(i, 1); renderItems(); renderPreview(); });
      w.appendChild(r);
    });
  }
  function blankItem() { return { desc: '', qty: 1, rate: 0 }; }
  $('addItem').addEventListener('click', function () { items.push(blankItem()); renderItems(); renderPreview(); });

  function currentDraft() {
    var c = S.clients.find(function (x) { return x.id === $('fClient').value; });
    var est = $('fEstimate').checked;
    return {
      kind: est ? 'estimate' : 'invoice',
      number: $('invNumberLabel').dataset.num,
      clientId: c ? c.id : '',
      clientName: c ? c.name : '',
      businessName: S.biz || 'Your Business',
      issueDate: $('fIssue').value, dueDate: $('fDue').value,
      items: items.map(function (it) { return { desc: it.desc, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 }; }),
      discountPct: Number($('fDisc').value) || 0,
      taxPct: Number($('fTax').value) || 0,
      lateFeePct: Math.min(100, Math.max(0, Number($('fLate').value) || 0)),
      notes: $('fNotes').value, status: est ? 'estimate' : 'unpaid'
    };
  }
  function renderPreview() {
    var inv = currentDraft(), t = L.totals(inv);
    var isEst = L.isEstimate(inv);
    var rows = inv.items.map(function (it) {
      return '<tr><td>' + esc(it.desc || '—') + '</td><td class="r">' + it.qty + '</td><td class="r">' + L.money(it.rate) +
        '</td><td class="r">' + L.money(L.lineTotal(it)) + '</td></tr>';
    }).join('');
    $('preview').innerHTML =
      '<div class="sheet">' +
      '<div class="sheet-mast"><div><div class="sheet-biz">' + esc(inv.businessName) + '</div>' +
      '<div class="sheet-tag">Thank you for your business</div></div>' +
      '<div class="sheet-stamp' + (isEst ? ' est' : '') + '">' + (isEst ? 'ESTIMATE' : 'INVOICE') +
      '<span>' + esc(inv.number) + '</span></div></div>' +
      '<div class="sheet-meta"><div class="sheet-billto"><span class="sheet-cap">Bill to</span><strong>' +
      esc(inv.clientName || '—') + '</strong></div>' +
      '<div class="sheet-dates"><div><span class="sheet-cap">Issued</span><b>' + esc(inv.issueDate || '—') +
      '</b></div><div><span class="sheet-cap">Due</span><b>' + esc(inv.dueDate || '—') + '</b></div></div></div>' +
      '<table class="sheet-items"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="sheet-totals">' +
      '<div class="trow"><span>Subtotal</span><b>' + L.money(t.subtotal) + '</b></div>' +
      (t.discount ? '<div class="trow"><span>Discount (' + t.discountPct + '%)</span><b>−' + L.money(t.discount) + '</b></div>' : '') +
      (t.tax ? '<div class="trow"><span>Tax (' + t.taxPct + '%)</span><b>' + L.money(t.tax) + '</b></div>' : '') +
      '<div class="due-hero"><span>' + (isEst ? 'Estimated total' : 'Amount due') + '</span><strong>' + L.money(t.total) + '</strong></div>' +
      '</div>' +
      '<div class="sheet-foot">' +
      (inv.lateFeePct > 0 ? '<p>Late fee: ' + inv.lateFeePct + '% per month on overdue balances.</p>' : '') +
      (inv.notes ? '<p>' + esc(inv.notes) + '</p>' : '') +
      '</div></div>';
  }
  ['fClient', 'fIssue', 'fDue', 'fDisc', 'fTax', 'fLate', 'fNotes', 'fEstimate'].forEach(function (id) {
    $(id).addEventListener('input', renderPreview);
  });
  $('fEstimate').addEventListener('change', renderPreview);

  function resetForm() {
    $('invNumberLabel').dataset.num = L.nextNumber(S.invoices);
    $('invNumberLabel').textContent = $('invNumberLabel').dataset.num;
    $('fIssue').value = todayStr(); $('fDue').value = plusDays(14);
    $('fDisc').value = 0; $('fTax').value = 0; $('fLate').value = 0; $('fNotes').value = '';
    $('fEstimate').checked = false;
    items = [blankItem()]; renderItems(); renderPreview(); $('formErr').textContent = '';
  }

  $('saveInv').addEventListener('click', function () {
    var inv = currentDraft();
    var errs = L.validate(inv);
    if (errs.length) { $('formErr').textContent = errs.join(' '); return; }
    inv.id = 'i' + Date.now();
    inv.payments = [];
    S.invoices.push(inv); save();
    resetForm(); renderDashboard(); renderInvoices(); renderReminders();
    toast((L.isEstimate(inv) ? 'Estimate ' : 'Invoice ') + inv.number + ' saved');
  });
  $('printInv').addEventListener('click', function () { renderPreview(); window.print(); });

  /* ---- dashboard ---- */
  var AGING_COLORS = { 'current': '#2f6f4f', '1-30 days': '#d97706', '31-60 days': '#c2410c', '60+ days': '#b91c1c' };
  function renderDashboard() {
    var d = L.dashboard(S.invoices);
    var billable = S.invoices.filter(function (i) { return !L.isEstimate(i); });
    var unpaid = billable.filter(function (i) { return L.statusOf(i) !== 'paid'; });
    $('heroOutstanding').textContent = L.money(d.outstanding + d.overdue);
    $('heroSub').textContent = unpaid.length + ' unpaid invoice' + (unpaid.length === 1 ? '' : 's') +
      ' · ' + L.money(d.overdue) + ' overdue';
    var odCount = billable.filter(function (i) { return L.statusOf(i) === 'overdue'; }).length;
    $('overdueCallout').innerHTML = d.overdue > 0
      ? '<div class="callout"><strong>' + L.money(d.overdue) + ' overdue</strong> across ' + odCount +
        ' invoice' + (odCount === 1 ? '' : 's') +
        ' — <a href="#" id="goRemind">draft reminders</a> and get paid.</div>'
      : '';
    var go = $('goRemind');
    if (go) go.addEventListener('click', function (e) { e.preventDefault(); goTab('remind'); });
    var keys = ['current', '1-30 days', '31-60 days', '60+ days'];
    var tot = keys.reduce(function (s, k) { return s + (d.buckets[k] || 0); }, 0);
    $('agingBar').innerHTML = keys.map(function (k) {
      var v = d.buckets[k] || 0;
      if (!v || !tot) return '';
      var w = Math.max(4, Math.round(v / tot * 100));
      return '<span style="width:' + w + '%;background:' + AGING_COLORS[k] + '" title="' + k + ': ' + L.money(v) + '"></span>';
    }).join('');
    $('agingLegend').innerHTML = keys.map(function (k) {
      return '<span><span class="dot" style="background:' + AGING_COLORS[k] + '"></span>' + k + ' · <strong>' + L.money(d.buckets[k] || 0) + '</strong></span>';
    }).join('');
    var fees = L.lateFeesTotal(S.invoices);
    $('dashCards').innerHTML =
      stat(L.money(d.outstanding), 'Outstanding', '') +
      stat(L.money(d.overdue), 'Overdue', d.overdue > 0 ? 'bad' : '') +
      stat(L.money(fees), 'Late fees accrued', fees > 0 ? 'bad' : '') +
      stat(L.money(d.paid), 'Collected', 'good') +
      stat(d.count, 'Invoices', '');
    var rows = billable
      .filter(function (i) { return L.statusOf(i) !== 'paid'; })
      .sort(function (a, b) { return L.daysOverdue(b) - L.daysOverdue(a); })
      .map(function (i) {
        var st = L.statusOf(i);
        return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.clientName) + '</td><td>' + L.money(L.totals(i).total) +
          '</td><td>' + esc(L.agingBucket(i)) + '</td><td><span class="pill ' + st + '">' + st + '</span></td></tr>';
      }).join('');
    $('agingList').innerHTML = rows ? '<table><tr><th>#</th><th>Client</th><th>Total</th><th>Aging</th><th>Status</th></tr>' + rows + '</table>'
      : '<p class="muted">Nothing unpaid.</p>';
    renderTax();
  }

  /* ---- tax summary: quarterly billed vs collected tax ---- */
  function renderTax() {
    var yr = Number($('taxYear').value);
    if (!(yr >= 2000 && yr <= 2100)) yr = new Date().getFullYear();
    $('taxYear').value = yr;
    var s = L.taxSummary(S.invoices, yr);
    var rows = s.quarters.map(function (q) {
      return '<tr><td>Q' + q.quarter + '</td><td>' + L.money(q.invoiced) + '</td><td>' + L.money(q.taxBilled) +
        '</td><td>' + L.money(q.collected) + '</td><td>' + L.money(q.taxCollected) + '</td></tr>';
    }).join('');
    var t = s.total;
    rows += '<tr class="totalrow"><td><strong>Total</strong></td><td><strong>' + L.money(t.invoiced) + '</strong></td><td><strong>' +
      L.money(t.taxBilled) + '</strong></td><td><strong>' + L.money(t.collected) + '</strong></td><td><strong>' +
      L.money(t.taxCollected) + '</strong></td></tr>';
    $('taxTable').innerHTML = '<table><tr><th>Quarter</th><th>Invoiced</th><th>Tax billed</th><th>Collected</th><th>Tax collected*</th></tr>' +
      rows + '</table><p class="muted small">*Tax collected is pro-rata on the paid fraction of each invoice — an estimate for your books, not tax advice.</p>';
  }
  function stat(v, l, cls) { return '<div class="stat ' + cls + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  /* ---- invoices list ---- */
  function dueUrgency(inv) {
    var st = L.statusOf(inv);
    if (st === 'paid' || L.isEstimate(inv)) return '';
    var od = L.daysOverdue(inv);
    if (od > 0) return '<span class="duechip late">' + od + 'd overdue</span>';
    var due = new Date(inv.dueDate + 'T23:59:59').getTime();
    if (isNaN(due)) return '';
    var days = Math.ceil((due - Date.now()) / 86400000);
    if (days <= 0) return '<span class="duechip today">due today</span>';
    if (days <= 7) return '<span class="duechip soon">due in ' + days + 'd</span>';
    return '<span class="duechip">due in ' + days + 'd</span>';
  }

  function renderInvoices() {
    var f = $('invFilter').value;
    var q = ($('invSearch').value || '').trim().toLowerCase();
    var rows = S.invoices.slice().reverse()
      .filter(function (i) {
        if (f === 'all') return true;
        if (f === 'estimate') return L.isEstimate(i);
        return L.statusOf(i) === f;
      })
      .filter(function (i) {
        if (!q) return true;
        return ((i.number || '') + ' ' + (i.clientName || '')).toLowerCase().indexOf(q) !== -1;
      })
      .map(function (i) {
        var st = L.statusOf(i), t = L.totals(i).total, bal = L.balanceDue(i), fee = L.lateFee(i);
        var isEst = L.isEstimate(i);
        var pillLabel = st === 'estimate' ? 'Estimate' : st === 'converted' ? 'Converted' : st;
        var actions;
        if (st === 'estimate') {
          actions = '<button class="ghost" data-convert="' + i.id + '">Convert to invoice</button> ' +
            '<button class="ghost" data-dupe="' + i.id + '">Duplicate</button> ' +
            '<button class="ghost" data-delinv="' + i.id + '">Delete</button>';
        } else {
          actions = (st === 'paid' ? '' : '<button class="ghost" data-pay="' + i.id + '">Record payment</button> ' +
            '<button class="ghost" data-paid="' + i.id + '">Mark paid</button> ') +
            '<button class="ghost" data-dupe="' + i.id + '">Duplicate</button> ' +
            (isEst ? '' : '<button class="ghost" data-recur="' + i.id + '" title="Create the next invoice in a recurring series">Recur</button> ') +
            '<button class="ghost" data-delinv="' + i.id + '">Delete</button>';
        }
        return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.clientName) + '</td><td>' + esc(i.dueDate) +
          (dueUrgency(i) ? '<br>' + dueUrgency(i) : '') +
          '</td><td>' + L.money(t) + '</td><td>' + (st === 'paid' || isEst ? '—' : L.money(bal)) +
          '</td><td>' + (fee > 0 && !isEst ? L.money(fee) : '—') +
          '</td><td><span class="pill ' + st + '">' + pillLabel + '</span>' +
          (i.recurring ? ' <span class="pill recur" title="Recurs ' + esc(i.recurring) + '">↻ ' + esc(i.recurring) + '</span>' : '') +
          '</td><td>' + actions + '</td></tr>';
      }).join('');
    $('invList').innerHTML = rows ? '<table><tr><th>#</th><th>Client</th><th>Due</th><th>Total</th><th>Balance</th><th>Late fee</th><th>Status</th><th></th></tr>' + rows + '</table>'
      : '<p class="muted">No invoices here yet.</p>';
    document.querySelectorAll('[data-paid]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.paid; });
        if (inv) { inv.status = 'paid'; save(); renderDashboard(); renderInvoices(); renderReminders(); renderClients(); toast('Marked paid'); }
      });
    });
    document.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.pay; });
        if (!inv) return;
        var raw = prompt('Record payment for ' + inv.number + ' (' + inv.clientName + ')\nBalance due: ' + L.money(L.balanceDue(inv)), L.balanceDue(inv).toFixed(2));
        if (raw === null) return;
        var r = L.addPayment(inv, raw);
        if (!r.ok) { toast(r.error); return; }
        save(); renderDashboard(); renderInvoices(); renderReminders(); renderClients();
        toast('Payment recorded — balance ' + L.money(r.balance));
      });
    });
    document.querySelectorAll('[data-dupe]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.dupe; });
        if (!inv) return;
        var copy = L.cloneInvoice(inv, L.nextNumber(S.invoices));
        S.invoices.push(copy); save();
        renderDashboard(); renderInvoices(); renderReminders();
        toast('Duplicated as ' + copy.number);
      });
    });
    document.querySelectorAll('[data-recur]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.recur; });
        if (!inv) return;
        var cad = (prompt('Recurring cadence for ' + inv.number + ' (monthly / quarterly / yearly):', inv.recurring || 'monthly') || '').trim().toLowerCase();
        if (!cad) return;
        if (!L.CADENCES[cad]) { toast('Cadence must be monthly, quarterly, or yearly'); return; }
        var copy = L.recurringClone(inv, cad, L.nextNumber(S.invoices));
        S.invoices.push(copy); save();
        renderDashboard(); renderInvoices(); renderReminders(); renderClients();
        toast('Recurring invoice ' + copy.number + ' created (' + cad + ')');
      });
    });
    document.querySelectorAll('[data-convert]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.convert; });
        if (!inv || !L.isEstimate(inv)) return;
        var copy = L.convertEstimate(inv, L.nextNumber(S.invoices), todayStr());
        inv.status = 'converted'; // retire the quote; it stays as the paper trail
        S.invoices.push(copy); save();
        renderDashboard(); renderInvoices(); renderReminders(); renderClients();
        toast('Estimate ' + inv.number + ' converted to invoice ' + copy.number);
      });
    });
    document.querySelectorAll('[data-delinv]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this invoice?')) return;
        S.invoices = S.invoices.filter(function (x) { return x.id !== b.dataset.delinv; });
        save(); renderDashboard(); renderInvoices(); renderReminders();
      });
    });
  }
  $('invFilter').addEventListener('change', renderInvoices);
  $('invSearch').addEventListener('input', renderInvoices);
  $('exportInvCsv').addEventListener('click', function () {
    var blob = new Blob([L.invoicesToCSV(S.invoices)], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'invoicepilot-invoices.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('Invoices exported');
  });

  /* ---- reminders ---- */
  var curTone = 'gentle';
  function overdueInvs() { return S.invoices.filter(function (i) { return L.statusOf(i) === 'overdue'; }); }
  function renderReminders() {
    var sel = $('rInv'); sel.innerHTML = '';
    var od = overdueInvs();
    if (!od.length) { sel.innerHTML = '<option value="">— no overdue invoices —</option>'; $('rSubject').textContent = ''; $('rBody').textContent = ''; return; }
    od.forEach(function (i) {
      var o = document.createElement('option'); o.value = i.id;
      o.textContent = i.number + ' · ' + i.clientName + ' · ' + L.money(L.totals(i).total) + ' · ' + L.daysOverdue(i) + 'd late';
      sel.appendChild(o);
    });
    renderDraft();
    var log = S.remLog.slice().reverse().slice(0, 10).map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.number) + '</td><td>' + esc(r.tone) + '</td><td>' + esc(r.client) + '</td></tr>';
    }).join('');
    $('remLog').innerHTML = log ? '<table><tr><th>Date</th><th>Invoice</th><th>Tone</th><th>Client</th></tr>' + log + '</table>'
      : '<p class="muted">No reminders sent yet.</p>';
  }
  function renderDraft() {
    var inv = S.invoices.find(function (x) { return x.id === $('rInv').value; });
    if (!inv) return;
    var client = S.clients.find(function (c) { return c.id === inv.clientId; });
    var d = L.dunningDraft(inv, client, curTone);
    $('rSubject').textContent = 'Subject: ' + d.subject;
    $('rBody').textContent = d.body;
    $('rBody').dataset.tone = curTone; $('rBody').dataset.invid = inv.id;
  }
  document.querySelectorAll('.tone').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tone').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active'); curTone = b.dataset.tone; renderDraft();
    });
  });
  $('rInv').addEventListener('change', renderDraft);
  $('copyDraft').addEventListener('click', function () {
    var txt = $('rSubject').textContent + '\n\n' + $('rBody').textContent;
    navigator.clipboard.writeText(txt).then(function () {
      var inv = S.invoices.find(function (x) { return x.id === $('rBody').dataset.invid; });
      if (inv) S.remLog.push({ date: todayStr(), number: inv.number, tone: $('rBody').dataset.tone, client: inv.clientName });
      save(); renderReminders(); toast('Draft copied — paste into your email');
    }, function () { toast('Copy failed — select the text manually'); });
  });
  $('polishDraft').addEventListener('click', function () {
    $('polishNote').textContent = 'Polishing…';
    fetch('/api/polish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('rBody').textContent })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.enhanced) { $('rBody').textContent = j.text; $('polishNote').textContent = 'AI-polished'; }
      else $('polishNote').textContent = 'Local draft (no AI key set)';
      setTimeout(function () { $('polishNote').textContent = ''; }, 3000);
    }).catch(function () { $('polishNote').textContent = 'Local draft (offline)'; });
  });

  /* ---- init ---- */
  $('taxGo').addEventListener('click', renderTax);
  if (!S.clients.length && !S.invoices.length) {
    // seed one demo client so the app isn't empty on first run
    S.clients.push({ id: 'c-demo', name: 'Demo Client', email: '' }); save();
  }
  renderClients(); resetForm(); renderDashboard(); renderInvoices(); renderReminders();
})();
