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
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      $('tab-' + b.dataset.tab).classList.add('active');
    });
  });

  /* ---- clients ---- */
  function renderClients() {
    var sel = $('fClient'); sel.innerHTML = '';
    if (!S.clients.length) sel.innerHTML = '<option value="">— add a client first —</option>';
    S.clients.forEach(function (c) {
      var o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    var html = '<table><tr><th>Name</th><th>Email</th><th>Invoices</th><th></th></tr>';
    S.clients.forEach(function (c) {
      var n = S.invoices.filter(function (i) { return i.clientId === c.id; }).length;
      html += '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email || '—') + '</td><td>' + n +
        '</td><td><button class="ghost" data-delclient="' + c.id + '">Delete</button></td></tr>';
    });
    $('clientList').innerHTML = html + '</table>';
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
    return {
      number: $('invNumberLabel').dataset.num,
      clientId: c ? c.id : '',
      clientName: c ? c.name : '',
      businessName: S.biz || 'Your Business',
      issueDate: $('fIssue').value, dueDate: $('fDue').value,
      items: items.map(function (it) { return { desc: it.desc, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 }; }),
      discountPct: Number($('fDisc').value) || 0,
      taxPct: Number($('fTax').value) || 0,
      notes: $('fNotes').value, status: 'unpaid'
    };
  }
  function renderPreview() {
    var inv = currentDraft(), t = L.totals(inv);
    var rows = inv.items.map(function (it) {
      return '<tr><td>' + esc(it.desc || '—') + '</td><td>' + it.qty + '</td><td>' + L.money(it.rate) +
        '</td><td>' + L.money(L.lineTotal(it)) + '</td></tr>';
    }).join('');
    $('preview').innerHTML =
      '<div class="invhead"><div><h2>' + esc(inv.businessName) + '</h2><div class="muted">INVOICE ' + esc(inv.number) + '</div></div>' +
      '<div style="text-align:right"><div><strong>Bill to:</strong> ' + esc(inv.clientName || '—') + '</div>' +
      '<div class="muted">Issued ' + esc(inv.issueDate || '—') + ' · Due ' + esc(inv.dueDate || '—') + '</div></div></div>' +
      '<table><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>' + rows + '</table>' +
      '<div style="text-align:right;margin-top:10px">' +
      '<div>Subtotal: ' + L.money(t.subtotal) + '</div>' +
      (t.discount ? '<div>Discount (' + t.discountPct + '%): −' + L.money(t.discount) + '</div>' : '') +
      (t.tax ? '<div>Tax (' + t.taxPct + '%): ' + L.money(t.tax) + '</div>' : '') +
      '<div style="font-size:1.3rem;font-weight:800">Total: ' + L.money(t.total) + '</div></div>' +
      (inv.notes ? '<p class="muted">' + esc(inv.notes) + '</p>' : '');
  }
  ['fClient', 'fIssue', 'fDue', 'fDisc', 'fTax', 'fNotes'].forEach(function (id) {
    $(id).addEventListener('input', renderPreview);
  });

  function resetForm() {
    $('invNumberLabel').dataset.num = L.nextNumber(S.invoices);
    $('invNumberLabel').textContent = $('invNumberLabel').dataset.num;
    $('fIssue').value = todayStr(); $('fDue').value = plusDays(14);
    $('fDisc').value = 0; $('fTax').value = 0; $('fNotes').value = '';
    items = [blankItem()]; renderItems(); renderPreview(); $('formErr').textContent = '';
  }

  $('saveInv').addEventListener('click', function () {
    var inv = currentDraft();
    var errs = L.validate(inv);
    if (errs.length) { $('formErr').textContent = errs.join(' '); return; }
    inv.id = 'i' + Date.now();
    S.invoices.push(inv); save();
    resetForm(); renderDashboard(); renderInvoices(); renderReminders();
    toast('Invoice ' + inv.number + ' saved');
  });
  $('printInv').addEventListener('click', function () { renderPreview(); window.print(); });

  /* ---- dashboard ---- */
  function renderDashboard() {
    var d = L.dashboard(S.invoices);
    $('dashCards').innerHTML =
      stat(L.money(d.outstanding), 'Outstanding', '') +
      stat(L.money(d.overdue), 'Overdue', d.overdue > 0 ? 'bad' : '') +
      stat(L.money(d.paid), 'Collected', 'good') +
      stat(d.count, 'Invoices', '');
    var rows = S.invoices
      .filter(function (i) { return L.statusOf(i) !== 'paid'; })
      .sort(function (a, b) { return L.daysOverdue(b) - L.daysOverdue(a); })
      .map(function (i) {
        var st = L.statusOf(i);
        return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.clientName) + '</td><td>' + L.money(L.totals(i).total) +
          '</td><td>' + esc(L.agingBucket(i)) + '</td><td><span class="pill ' + st + '">' + st + '</span></td></tr>';
      }).join('');
    $('agingList').innerHTML = rows ? '<table><tr><th>#</th><th>Client</th><th>Total</th><th>Aging</th><th>Status</th></tr>' + rows + '</table>'
      : '<p class="muted">Nothing unpaid. 🎉</p>';
  }
  function stat(v, l, cls) { return '<div class="stat ' + cls + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }

  /* ---- invoices list ---- */
  function renderInvoices() {
    var f = $('invFilter').value;
    var rows = S.invoices.slice().reverse()
      .filter(function (i) { return f === 'all' || L.statusOf(i) === f; })
      .map(function (i) {
        var st = L.statusOf(i), t = L.totals(i).total;
        return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.clientName) + '</td><td>' + esc(i.dueDate) +
          '</td><td>' + L.money(t) + '</td><td><span class="pill ' + st + '">' + st + '</span></td><td>' +
          (st === 'paid' ? '' : '<button class="ghost" data-paid="' + i.id + '">Mark paid</button> ') +
          '<button class="ghost" data-delinv="' + i.id + '">Delete</button></td></tr>';
      }).join('');
    $('invList').innerHTML = rows ? '<table><tr><th>#</th><th>Client</th><th>Due</th><th>Total</th><th>Status</th><th></th></tr>' + rows + '</table>'
      : '<p class="muted">No invoices here yet.</p>';
    document.querySelectorAll('[data-paid]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inv = S.invoices.find(function (x) { return x.id === b.dataset.paid; });
        if (inv) { inv.status = 'paid'; save(); renderDashboard(); renderInvoices(); renderReminders(); toast('Marked paid 💰'); }
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

  /* ---- reminders ---- */
  var curTone = 'gentle';
  function overdueInvs() { return S.invoices.filter(function (i) { return L.statusOf(i) === 'overdue'; }); }
  function renderReminders() {
    var sel = $('rInv'); sel.innerHTML = '';
    var od = overdueInvs();
    if (!od.length) { sel.innerHTML = '<option value="">— no overdue invoices 🎉 —</option>'; $('rSubject').textContent = ''; $('rBody').textContent = ''; return; }
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
      if (j.enhanced) { $('rBody').textContent = j.text; $('polishNote').textContent = '✨ AI-polished'; }
      else $('polishNote').textContent = 'Local draft (no AI key set)';
      setTimeout(function () { $('polishNote').textContent = ''; }, 3000);
    }).catch(function () { $('polishNote').textContent = 'Local draft (offline)'; });
  });

  /* ---- init ---- */
  if (!S.clients.length && !S.invoices.length) {
    // seed one demo client so the app isn't empty on first run
    S.clients.push({ id: 'c-demo', name: 'Demo Client', email: '' }); save();
  }
  renderClients(); resetForm(); renderDashboard(); renderInvoices(); renderReminders();
})();
