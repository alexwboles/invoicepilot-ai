#!/bin/bash
# invoicepilot-ai smoke tests
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# 1. required files exist
for f in README.md server.js lib/logic.js lib/forecast.js public/index.html public/css/style.css public/js/app.js package.json; do
  [ -f "$D/$f" ] && ok "file $f" || bad "file $f missing"
done

# 2. JS syntax valid
for f in server.js lib/logic.js lib/forecast.js public/js/app.js; do
  node --check "$D/$f" 2>/dev/null && ok "syntax $f" || bad "syntax $f"
done

# 3. server boots + health
PORT=4181 node "$D/server.js" & SRV=$!
sleep 1.2
curl -sf "http://localhost:4181/api/health" | grep -q '"ok":true' && ok "health endpoint" || bad "health endpoint"
# 4. index served
curl -sf "http://localhost:4181/" | grep -q "InvoicePilot" && ok "index.html served" || bad "index.html served"
# 5. shared logic served
curl -sf "http://localhost:4181/lib/logic.js" | grep -q "dunningDraft" && ok "/lib/logic.js served" || bad "/lib/logic.js served"
# 5b. forecast engine served
curl -sf "http://localhost:4181/lib/forecast.js" | grep -q "invoicesToCashIn" && ok "/lib/forecast.js served" || bad "/lib/forecast.js served"
# 6. polish without key falls back gracefully
curl -sf -X POST "http://localhost:4181/api/polish" -H 'Content-Type: application/json' \
  -d '{"text":"hi"}' | grep -q '"enhanced":false' && ok "polish fallback (no key)" || bad "polish fallback (no key)"
# 7. 404 handling
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4181/nope)" = "404" ] && ok "404 handling" || bad "404 handling"
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

# 8. invoice math
node -e "
const L=require('$D/lib/logic.js');
const t=L.totals({items:[{qty:2,rate:50},{qty:1,rate:25.5}],discountPct:10,taxPct:8});
if(Math.abs(t.subtotal-125.5)>0.001) throw new Error('subtotal '+t.subtotal);
if(Math.abs(t.discount-12.55)>0.01) throw new Error('discount '+t.discount);
if(Math.abs(t.total-122.0)>0.05) throw new Error('total '+t.total);
" && ok "invoice math (discount+tax)" || bad "invoice math"

# 9. dunning drafts: 3 tones, personalized, escalating
node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0007',clientName:'Jane Doe',dueDate:'2020-01-01',items:[{qty:1,rate:500}],businessName:'ACME'};
const tones=L.TONES.map(t=>L.dunningDraft(inv,null,t));
if(tones.length!==3) throw new Error('want 3 tones');
tones.forEach(d=>{ if(!d.body.includes('INV-0007')||!d.body.includes('\$500.00')) throw new Error('missing facts in '+d.tone); });
if(!tones[0].body.toLowerCase().includes('friendly')) throw new Error('gentle not friendly');
if(!tones[2].body.toLowerCase().includes('final notice')) throw new Error('final not final');
if(tones[0].body===tones[1].body) throw new Error('tones identical');
" && ok "dunning drafts (3 tones, escalating)" || bad "dunning drafts"

# 10. overdue/aging/dashboard
node -e "
const L=require('$D/lib/logic.js');
const mk=(n,days,status)=>({number:n,clientName:'C',issueDate:'2020-01-01',dueDate:new Date(Date.now()-days*864e5).toISOString().slice(0,10),items:[{qty:1,rate:100}],status});
const invs=[mk('A',40,'unpaid'),mk('B',-5,'unpaid'),mk('C',70,'unpaid'),mk('D',10,'paid')];
if(L.statusOf(invs[0])!=='overdue') throw new Error('A should be overdue');
if(L.statusOf(invs[1])!=='outstanding') throw new Error('B should be outstanding');
if(L.agingBucket(invs[0])!=='31-60 days') throw new Error('aging A');
if(L.agingBucket(invs[2])!=='60+ days') throw new Error('aging C');
const d=L.dashboard(invs);
if(d.overdue!==200||d.outstanding!==100||d.paid!==100) throw new Error('dashboard sums '+JSON.stringify(d));
if(L.nextNumber(invs)!=='INV-0001') throw new Error('nextNumber');
const bad=L.validate({items:[]});
if(bad.length<3) throw new Error('validate too lax');
" && ok "aging/dashboard/validate" || bad "aging/dashboard/validate"

# 11. partial payments: balance shrinks, overpay rejected, full pay marks paid
node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0100',clientName:'C',issueDate:'2026-09-01',dueDate:'2026-10-01',
  items:[{qty:1,rate:500}],status:'unpaid'};
if(L.balanceDue(inv)!==500) throw new Error('balance start');
let r=L.addPayment(inv,200,'2026-09-10');
if(!r.ok||L.balanceDue(inv)!==300) throw new Error('partial pay');
if(L.statusOf(inv)==='paid') throw new Error('should not be paid yet');
const over=L.addPayment(inv,400);
if(over.ok) throw new Error('overpayment should be rejected: '+JSON.stringify(over));
const zero=L.addPayment(inv,0);
if(zero.ok) throw new Error('zero payment should be rejected');
r=L.addPayment(inv,300);
if(!r.ok||L.statusOf(inv)!=='paid'||L.balanceDue(inv)!==0) throw new Error('final pay');
if(inv.payments.length!==2) throw new Error('payment log');
" && ok "partial payments (balance, overpay/zero rejected, auto-paid)" || bad "partial payments"

# 12. duplicate invoice: new number, fresh dates/status, same line items
node -e "
const L=require('$D/lib/logic.js');
const src={id:'i1',number:'INV-0005',clientId:'c1',clientName:'C',businessName:'B',
  issueDate:'2026-08-01',dueDate:'2026-08-15',items:[{desc:'Mow',qty:2,rate:50}],
  discountPct:10,taxPct:0,notes:'Monthly',status:'paid',payments:[{amount:90,date:'2026-08-10'}]};
const c=L.cloneInvoice(src,'INV-0006');
if(c.number!=='INV-0006'||c.id===src.id) throw new Error('number/id');
if(c.status!=='unpaid'||c.payments.length) throw new Error('must be fresh unpaid');
if(c.items.length!==1||c.items[0].desc!=='Mow'||c.items[0].qty!==2) throw new Error('items');
if(c.discountPct!==10||c.notes!=='Monthly') throw new Error('carried fields');
if(L.totals(c).total!==90) throw new Error('total '+L.totals(c).total);
" && ok "duplicate invoice (fresh, items carried over)" || bad "duplicate invoice"

# 13. CSV export: header + paid/balance columns, quoting
node -e "
const L=require('$D/lib/logic.js');
const invs=[{number:'INV-1',clientName:'Acme, Inc',issueDate:'2026-09-01',dueDate:'2026-09-15',
  items:[{qty:1,rate:200}],status:'unpaid',payments:[{amount:50,date:'2026-09-02'}]}];
const csv=L.invoicesToCSV(invs);
const lines=csv.split('\n');
if(!/^Number,Kind,Client,Issue date/.test(lines[0])) throw new Error('header: '+lines[0]);
if(!/Paid,Balance,Late fee$/.test(lines[0])) throw new Error('paid/balance/latefee cols');
if(!/\"Acme, Inc\"/.test(csv)) throw new Error('quoting');
if(!/,200\.00,50\.00,150\.00,0\.00$/.test(lines[1])) throw new Error('paid/balance/latefee values: '+lines[1]);
if(L.invoicesToCSV([]).split('\n').length!==1) throw new Error('empty');
" && ok "invoicesToCSV (header, paid/balance, quoting)" || bad "invoicesToCSV"

# 14. per-client totals aggregate unpaid + overdue by client
node -e "
const L=require('$D/lib/logic.js');
const mk=(n,cid,days,status)=>({number:n,clientId:cid,clientName:'N-'+cid,
  issueDate:'2020-01-01',dueDate:new Date(Date.now()-days*864e5).toISOString().slice(0,10),
  items:[{qty:1,rate:100}],status});
const invs=[mk('A','c1',40,'unpaid'),mk('B','c1',-5,'unpaid'),mk('C','c2',70,'unpaid'),mk('D','c2',10,'paid')];
const ct=L.clientTotals(invs);
if(ct.c1.unpaid!==200||ct.c1.overdue!==100||ct.c1.count!==2) throw new Error('c1 '+JSON.stringify(ct.c1));
if(ct.c2.unpaid!==100||ct.c2.overdue!==100) throw new Error('c2 '+JSON.stringify(ct.c2));
if(ct.c2.count!==1) throw new Error('paid invoice must not count');
" && ok "clientTotals (unpaid/overdue per client)" || bad "clientTotals"

# 15. new UI wired: search box, export CSV, payment/duplicate buttons
grep -q 'id="invSearch"' "$D/public/index.html" && grep -q 'id="exportInvCsv"' "$D/public/index.html" \
  && ok "index.html has invSearch + exportInvCsv" || bad "index.html missing new controls"
grep -q 'data-pay' "$D/public/js/app.js" && grep -q 'data-dupe' "$D/public/js/app.js" \
  && grep -q 'invSearch' "$D/public/js/app.js" && grep -q 'invoicesToCSV' "$D/public/js/app.js" \
  && ok "app.js wires payments/duplicate/search/CSV" || bad "app.js missing wiring"

# late fees: 1.5%/mo on a $1000 balance, ~2 months overdue
node -e "
const L=require('$D/lib/logic.js');
const now = new Date('2026-10-12T12:00:00').getTime();
const inv = { number: 'INV-1', clientName: 'Acme', issueDate: '2026-07-01', dueDate: '2026-08-13',
  items: [{ desc: 'Work', qty: 1, rate: 1000 }], lateFeePct: 1.5, status: 'unpaid', payments: [] };
const days = L.daysOverdue(inv, now);
const fee = L.lateFee(inv, null, now);
const expect = Math.round(1000 * 0.015 * (days / 30) * 100) / 100;
if (fee !== expect || !(fee > 0)) throw new Error('fee=' + fee + ' expect=' + expect);
if (L.totalWithLateFee(inv, null, now) !== Math.round((1000 + expect) * 100) / 100) throw new Error('total with fee');
if (L.lateFee(inv, 0, now) !== 0) throw new Error('zero rate should be 0');
const noFee = { number: 'INV-2', clientName: 'Acme', issueDate: '2026-10-01', dueDate: '2026-10-20',
  items: [{ desc: 'Work', qty: 1, rate: 500 }], status: 'unpaid', payments: [] };
if (L.lateFee(noFee, null, now) !== 0) throw new Error('not-overdue should be 0');
if (L.lateFeesTotal([inv, noFee], now) !== fee) throw new Error('lateFeesTotal');
['gentle', 'firm', 'final'].forEach(function (tone) {
  const d = L.dunningDraft(inv, { name: 'Acme Co' }, tone);
  if (!/late fee/i.test(d.body)) throw new Error(tone + ' draft missing late fee');
});
" && ok "lateFee: 1.5%/mo accrues, all 3 draft tones name it" || bad "lateFee"

# payer reliability profiles
node -e "
const L=require('$D/lib/logic.js');
const now = new Date('2026-10-12T12:00:00').getTime();
const invs = [
  { number: 'A1', clientId: 'c1', clientName: 'Good', issueDate: '2026-01-01', dueDate: '2026-01-15',
    items: [{ desc: 'x', qty: 1, rate: 100 }], status: 'paid',
    payments: [{ amount: 100, date: '2026-01-14' }] },
  { number: 'A2', clientId: 'c1', clientName: 'Good', issueDate: '2026-02-01', dueDate: '2026-02-15',
    items: [{ desc: 'x', qty: 1, rate: 200 }], status: 'paid',
    payments: [{ amount: 200, date: '2026-02-20' }] },
  { number: 'B1', clientId: 'c2', clientName: 'Slow', issueDate: '2026-01-01', dueDate: '2026-02-01',
    items: [{ desc: 'x', qty: 1, rate: 500 }], status: 'unpaid', payments: [] }
];
const good = L.payerProfile(invs, 'c1', now);
if (good.rating !== 'usually-late' || good.avgDaysLate !== 2.5 || good.paid !== 2) throw new Error('good: ' + JSON.stringify(good));
const slow = L.payerProfile(invs, 'c2', now);
if (slow.rating !== 'slow' || slow.overdueCount !== 1 || slow.overdueBalance !== 500) throw new Error('slow: ' + JSON.stringify(slow));
const none = L.payerProfile(invs, 'c9', now);
if (none.invoices !== 0 || none.rating !== 'on-time') throw new Error('empty profile');
" && ok "payerProfile: usually-late avg 2.5d, slow payer flagged" || bad "payerProfile"

# recurring invoice cloning advances dates by cadence
node -e "
const L=require('$D/lib/logic.js');
const inv = { number: 'INV-1', clientId: 'c1', clientName: 'Acme', businessName: 'Biz',
  issueDate: '2026-10-01', dueDate: '2026-10-15', items: [{ desc: 'Retainer', qty: 1, rate: 500 }],
  discountPct: 0, taxPct: 0, lateFeePct: 2, notes: '', status: 'paid', payments: [{ amount: 500, date: '2026-10-10' }] };
const m = L.recurringClone(inv, 'monthly', 'INV-2');
if (m.issueDate !== '2026-11-01' || m.dueDate !== '2026-11-15') throw new Error('monthly: ' + m.issueDate + '/' + m.dueDate);
if (m.recurring !== 'monthly' || m.status !== 'unpaid' || m.payments.length !== 0) throw new Error('fresh state');
if (m.lateFeePct !== 2 || m.items[0].rate !== 500) throw new Error('terms carried over');
const q = L.recurringClone(inv, 'quarterly', 'INV-3');
if (q.issueDate !== '2027-01-01') throw new Error('quarterly: ' + q.issueDate);
const y = L.recurringClone(inv, 'yearly', 'INV-4');
if (y.dueDate !== '2027-10-15') throw new Error('yearly: ' + y.dueDate);
" && ok "recurringClone: monthly/quarterly/yearly advance dates, fresh state" || bad "recurringClone"

grep -q 'fLate' "$D/public/index.html" \
  && grep -q 'data-recur' "$D/public/js/app.js" && grep -q 'payerProfile' "$D/public/js/app.js" \
  && grep -q 'lateFeesTotal' "$D/public/js/app.js" \
  && ok "UI wires late-fee field, recur button, reliability badges" || bad "UI missing new wiring"

node -e "
const L=require('$D/lib/logic.js');
['isEstimate','convertEstimate','taxSummary','clientStatement','quarterOf'].forEach(function(f){
  if(typeof L[f]!=='function') throw new Error('missing '+f);
});
const est={kind:'estimate',status:'estimate',number:'EST-1',clientName:'Ann',clientId:'c1',
  issueDate:'2026-09-01',dueDate:'2026-09-15',items:[{desc:'Work',qty:1,rate:100}],taxPct:10,discountPct:0};
if(!L.isEstimate(est)) throw new Error('isEstimate');
if(L.statusOf(est)!=='estimate') throw new Error('estimate status');
if(L.dashboard([est]).count!==0) throw new Error('estimates excluded from dashboard');
const cv=L.convertEstimate(est,'INV-0001','2026-10-01');
if(cv.kind!=='invoice'||cv.status!=='unpaid'||cv.issueDate!=='2026-10-01') throw new Error('convert kind/date');
if(cv.dueDate!=='2026-10-15') throw new Error('convert due '+cv.dueDate);
if(cv.fromEstimate!=='EST-1') throw new Error('fromEstimate');
const inv={number:'INV-2',clientName:'Ann',clientId:'c1',issueDate:'2026-02-10',dueDate:'2026-02-24',
  items:[{desc:'Work',qty:1,rate:100}],taxPct:10,discountPct:0,status:'unpaid'};
L.addPayment(inv,55,'2026-02-12');
const ts=L.taxSummary([inv,est],2026);
const q1=ts.quarters[0];
if(q1.invoiced!==110||q1.taxBilled!==10) throw new Error('tax billed '+JSON.stringify(q1));
if(q1.collected!==55||Math.abs(q1.taxCollected-5)>0.01) throw new Error('tax collected '+JSON.stringify(q1));
if(ts.quarters[1].invoiced!==0) throw new Error('q2 should be empty');
const st=L.clientStatement([inv,est],'c1');
if(st.lines.length!==1||st.totalBilled!==110||st.totalPaid!==55||st.balance!==55) throw new Error('statement '+JSON.stringify(st));
const csv=L.invoicesToCSV([inv,est]);
if(csv.split('\n')[0].indexOf('Kind')===-1) throw new Error('csv kind column');
console.log('est/tax/statement ok');
" && ok "estimates convert, taxSummary, clientStatement, CSV kind" || bad "new logic exports"

grep -q 'id="fEstimate"' "$D/public/index.html" \
  && grep -q 'id="taxTable"' "$D/public/index.html" \
  && grep -q 'id="stmtPanel"' "$D/public/index.html" \
  && grep -q 'data-convert' "$D/public/js/app.js" \
  && grep -q 'renderTax' "$D/public/js/app.js" \
  && grep -q 'renderStatement' "$D/public/js/app.js" \
  && ok "UI wires estimate checkbox, tax panel, statement panel" || bad "UI missing new wiring"
grep -q 'sheet-stamp' "$D/public/js/app.js" \
  && grep -q 'due-hero' "$D/public/js/app.js" \
  && grep -q 'dueUrgency' "$D/public/js/app.js" \
  && grep -q 'overdueCallout' "$D/public/index.html" \
  && grep -q 'goTab' "$D/public/js/app.js" \
  && grep -q 'sheet-mast' "$D/public/css/style.css" \
  && grep -q 'duechip' "$D/public/css/style.css" \
  && grep -q 'callout' "$D/public/css/style.css" \
  && ok "UI wires invoice sheet, due urgency, overdue callout" || bad "UI missing redesign wiring"

# forecast engine: auto-feed, week placement, recurring bills, shortfalls, what-if
node -e "
const L=require('$D/lib/logic.js'), F=require('$D/lib/forecast.js');
if(typeof F.invoicesToCashIn!=='function') throw new Error('missing invoicesToCashIn');
function isoPlus(d){var x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);}
const invs=[
 {id:'i1',number:'INV-0001',clientName:'Acme',clientId:'c1',issueDate:'2026-09-01',dueDate:isoPlus(10),items:[{qty:1,rate:1000}],status:'unpaid',payments:[]},
 {id:'i2',number:'INV-0002',clientName:'Slow',clientId:'c2',issueDate:'2026-06-01',dueDate:isoPlus(-40),items:[{qty:1,rate:500}],status:'unpaid',payments:[{amount:100,date:isoPlus(-30)}]},
 {id:'i3',number:'INV-0003',clientName:'Done',clientId:'c3',issueDate:'2026-06-01',dueDate:isoPlus(-40),items:[{qty:1,rate:500}],status:'paid',payments:[{amount:500,date:'2026-06-02'}]},
 {id:'e1',number:'EST-1',kind:'estimate',status:'estimate',clientName:'Quote',clientId:'c4',issueDate:'2026-10-01',dueDate:isoPlus(10),items:[{qty:1,rate:900}],payments:[]}
];
const fed=F.invoicesToCashIn(invs,L);
if(fed.length!==2) throw new Error('want 2 fed items, got '+fed.length);
if(!fed.every(function(i){return i.auto&&i.kind==='in';})) throw new Error('auto/kind flags');
const p2=fed.filter(function(i){return i.invoiceId==='i2';})[0];
if(!p2||p2.amount!==400) throw new Error('partial payment must shrink fed amount');
const bills=[{id:'b1',kind:'out',desc:'Rent',date:isoPlus(5),amount:1200,recurring:'monthly'}];
const fc=F.forecast(fed.concat(bills),5000,13,{});
if(fc.length!==13) throw new Error('13 weeks');
if(fc[0].inflow!==400) throw new Error('overdue invoice should land in week 0, got '+fc[0].inflow);
const outWeeks=fc.filter(function(w){return w.outflow>0;}).length;
if(outWeeks<2) throw new Error('monthly bill should recur, weeks='+outWeeks);
var bal=5000, okChain=true;
fc.forEach(function(w){ if(Math.abs(w.balance-(bal+w.inflow-w.outflow))>0.01) okChain=false; bal=w.balance; });
if(!okChain) throw new Error('balance chaining');
var id=fed.filter(function(i){return i.invoiceId==='i1';})[0].id;
var sm={}; sm[id]=3;
const sh=F.forecast(fed,5000,13,sm);
const base=F.forecast(fed,5000,13,{});
const baseWk=base.map(function(w,i){return w.inflow>0?i:-1;}).filter(function(i){return i>=0;});
const shWk=sh.map(function(w,i){return w.inflow>0?i:-1;}).filter(function(i){return i>=0;});
if(JSON.stringify(baseWk)===JSON.stringify(shWk)) throw new Error('what-if shift did nothing');
const d=F.scenarioDiff(base,sh);
if(d.newShortfalls!==d.scnShortfalls-d.baseShortfalls||typeof d.minDelta!=='number') throw new Error('scenarioDiff');
if(F.money(-1234.5)!=='-\$1,234.50') throw new Error('money negative');
const csv=F.forecastToCSV(fc).split('\r\n');
if(csv.length!==14||csv[0].indexOf('Balance')===-1) throw new Error('forecastToCSV');
" && ok "forecast: auto-feed, week0 overdue, recurring bills, what-if, scenarioDiff" || bad "forecast engine"

# forecast UI wiring: tab, panel ids, app.js render, chart CSS
grep -q 'data-tab="forecast"' "$D/public/index.html" \
  && grep -q 'id="fcChart"' "$D/public/index.html" \
  && grep -q 'id="fcBillAdd"' "$D/public/index.html" \
  && grep -q 'id="tab-forecast"' "$D/public/index.html" \
  && grep -q '/lib/forecast.js' "$D/public/index.html" \
  && ok "index.html has Forecast tab + forecast engine script" || bad "index.html missing forecast wiring"
grep -q 'function renderForecast' "$D/public/js/app.js" \
  && grep -q 'invoicesToCashIn' "$D/public/js/app.js" \
  && grep -q 'fcChartSVG' "$D/public/js/app.js" \
  && grep -q "fcScnNew" "$D/public/js/app.js" \
  && grep -q 'renderForecast()' "$D/public/js/app.js" \
  && ok "app.js renders forecast tab (auto-feed, chart, scenario desk)" || bad "app.js missing forecast wiring"
grep -q 'dangerzone' "$D/public/css/style.css" \
  && grep -q 'scn-chip' "$D/public/css/style.css" \
  && grep -q 'autofed' "$D/public/css/style.css" \
  && ok "style.css has forecast chart + scenario styles" || bad "style.css missing forecast styles"

# v2: payment terms presets, pre-due drafts, aging CSV, payment stats, cash buffer
node -e "
const L=require('$D/lib/logic.js');
if(typeof L.dueDateForTerms!=='function') throw new Error('missing dueDateForTerms');
if(typeof L.predueDraft!=='function') throw new Error('missing predueDraft');
if(typeof L.agingToCSV!=='function') throw new Error('missing agingToCSV');
if(typeof L.paymentStats!=='function') throw new Error('missing paymentStats');
['receipt','net7','net14','net30','net60'].forEach(function(k){ if(!(L.TERMS[k]>=0)) throw new Error('TERM '+k); });
if(L.dueDateForTerms('2026-10-19','net14')!=='2026-11-02') throw new Error('net14 math');
if(L.dueDateForTerms('2026-10-19','net30')!=='2026-11-18') throw new Error('net30 math');
if(L.dueDateForTerms('2026-10-19','receipt')!=='2026-10-19') throw new Error('receipt');
if(L.dueDateForTerms('2026-01-31','net7')!=='2026-02-07') throw new Error('month rollover');
if(L.dueDateForTerms('nope','net14')!=='') throw new Error('bad date must be empty');
if(L.dueDateForTerms('2026-10-19','bogus')!=='') throw new Error('bad terms must be empty');
if(!L.TERM_LABELS.net14) throw new Error('TERM_LABELS');
const c=L.cloneInvoice({number:'INV-1',clientName:'C',businessName:'B',issueDate:'2026-10-01',dueDate:'2026-10-15',
  items:[{desc:'x',qty:1,rate:10}],terms:'net30',status:'unpaid'},'INV-2');
if(c.terms!=='net30') throw new Error('cloneInvoice must carry terms');
" && ok "terms: dueDateForTerms math, TERMS table, cloneInvoice carries terms" || bad "terms"

node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0007',clientName:'Jane Doe',dueDate:'2026-11-02',
  items:[{qty:1,rate:500}],businessName:'ACME',status:'unpaid'};
const d=L.predueDraft(inv,{name:'Jane Doe'});
if(d.tone!=='predue') throw new Error('tone');
if(!d.subject.includes('INV-0007')||!d.subject.includes('2026-11-02')) throw new Error('subject facts');
if(!d.body.includes('$' + '500.00')||!/heads-up/i.test(d.body)) throw new Error('body');
if(/overdue/i.test(d.body)) throw new Error('pre-due draft must not say overdue');
" && ok "predueDraft: friendly heads-up before the due date" || bad "predueDraft"

node -e "
const L=require('$D/lib/logic.js');
function isoPlus(d){var x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);}
const invs=[
 {number:'INV-1',clientName:'Acme',issueDate:'2026-09-01',dueDate:isoPlus(-40),items:[{qty:1,rate:1000}],status:'unpaid',payments:[{amount:250,date:isoPlus(-30)}]},
 {number:'INV-2',clientName:'Beta',issueDate:'2026-09-01',dueDate:isoPlus(5),items:[{qty:1,rate:400}],status:'unpaid',payments:[]},
 {number:'INV-3',clientName:'Paid Co',issueDate:'2026-09-01',dueDate:isoPlus(-40),items:[{qty:1,rate:300}],status:'paid',payments:[{amount:300,date:isoPlus(-30)}]},
 {number:'EST-1',kind:'estimate',status:'estimate',clientName:'Q',issueDate:'2026-09-01',dueDate:isoPlus(5),items:[{qty:1,rate:900}],payments:[]}
];
const csv=L.agingToCSV(invs);
const lines=csv.split('\n');
if(lines.length!==3) throw new Error('want header + 2 unpaid rows, got '+lines.length);
if(!/^Number,Client,Due date,Aging,Total,Paid,Balance$/.test(lines[0])) throw new Error('header: '+lines[0]);
if(!/,31-60 days,1000\.00,250\.00,750\.00$/.test(lines[1])) throw new Error('aging row: '+lines[1]);
if(!/,current,400\.00,0\.00,400\.00$/.test(lines[2])) throw new Error('current row: '+lines[2]);
if(/Paid Co|EST-1/.test(csv)) throw new Error('paid + estimates must be excluded');
" && ok "agingToCSV: header, buckets, balances, paid/estimates excluded" || bad "agingToCSV"

node -e "
const L=require('$D/lib/logic.js');
if(L.paymentStats([]).avgDaysToPay!==null) throw new Error('empty must be null');
const invs=[
 {number:'A',clientName:'C',issueDate:'2026-01-01',dueDate:'2026-01-15',items:[{qty:1,rate:100}],status:'paid',payments:[{amount:100,date:'2026-01-11'}]},
 {number:'B',clientName:'C',issueDate:'2026-02-01',dueDate:'2026-02-15',items:[{qty:1,rate:200}],status:'paid',payments:[{amount:200,date:'2026-02-25'}]},
 {number:'C',clientName:'C',issueDate:'2026-03-01',dueDate:'2026-03-15',items:[{qty:1,rate:300}],status:'unpaid',payments:[]},
 {number:'E',kind:'estimate',status:'estimate',clientName:'C',issueDate:'2026-03-01',dueDate:'2026-03-15',items:[{qty:1,rate:300}],payments:[]}
];
const ps=L.paymentStats(invs);
if(ps.paidCount!==2) throw new Error('paidCount '+ps.paidCount);
if(ps.collected!==300) throw new Error('collected '+ps.collected);
if(ps.avgDaysToPay!==17) throw new Error('avg should be (10+24)/2=17, got '+ps.avgDaysToPay);
" && ok "paymentStats: avg days to pay across paid invoices" || bad "paymentStats"

node -e "
const F=require('$D/lib/forecast.js');
if(typeof F.bufferWeeks!=='function') throw new Error('missing bufferWeeks');
function isoPlus(d){var x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);}
const items=[
 {id:'b1',kind:'out',desc:'Payroll',date:isoPlus(2),amount:1000,recurring:'monthly'},
 {id:'inv-1',kind:'in',desc:'INV-0001',date:isoPlus(10),amount:5000}
];
const buf=F.bufferWeeks(items,1500,13);
if(!(buf>=0&&buf<=13)) throw new Error('buffer should drain in horizon, got '+buf);
if(F.bufferWeeks([],5000,13)!==Infinity) throw new Error('no outflows -> Infinity');
const onlyIn=[{id:'i1',kind:'in',desc:'x',date:isoPlus(10),amount:100}];
if(F.bufferWeeks(onlyIn,100,13)!==Infinity) throw new Error('inflows must not count');
" && ok "bufferWeeks: drains on outflows only, Infinity when safe" || bad "bufferWeeks"

# v2 UI wiring: terms select, queue, expanders, headline, export buttons
grep -q 'id="fTerms"' "$D/public/index.html" \
  && grep -q 'id="qOverdue"' "$D/public/index.html" \
  && grep -q 'id="qDueSoon"' "$D/public/index.html" \
  && grep -q 'id="markSent"' "$D/public/index.html" \
  && grep -q 'id="exportAgingCsv"' "$D/public/index.html" \
  && grep -q 'id="fcHeadline"' "$D/public/index.html" \
  && ok "index.html has terms select, follow-up queue, headline strip, aging export" || bad "index.html missing v2 controls"
grep -q 'data-expand' "$D/public/js/app.js" \
  && grep -q 'invDetail' "$D/public/js/app.js" \
  && grep -q 'predueDraft' "$D/public/js/app.js" \
  && grep -q 'dueSoonInvs' "$D/public/js/app.js" \
  && grep -q 'suggestedTone' "$D/public/js/app.js" \
  && grep -q 'agingToCSV' "$D/public/js/app.js" \
  && grep -q 'paymentStats' "$D/public/js/app.js" \
  && grep -q 'bufferWeeks' "$D/public/js/app.js" \
  && grep -q 'dueDateForTerms' "$D/public/js/app.js" \
  && grep -q 'applyTerms' "$D/public/js/app.js" \
  && ok "app.js wires v2 features (terms, queue, expanders, headline, aging CSV)" || bad "app.js missing v2 wiring"
grep -q '\.expander' "$D/public/css/style.css" \
  && grep -q '\.detailrow' "$D/public/css/style.css" \
  && grep -q '\.headline' "$D/public/css/style.css" \
  && grep -q '\.empty' "$D/public/css/style.css" \
  && grep -q '\.bal-area' "$D/public/css/style.css" \
  && grep -q 'border-radius' "$D/public/css/style.css" \
  && bad "style.css must have no border-radius" || ok "style.css has v2 styles, zero border-radius"

echo \"--- smoke: $PASS passed, $FAIL failed ---\"
exit $((FAIL>0))
