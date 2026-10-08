#!/bin/bash
# invoicepilot-ai smoke tests — 10 checks
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# 1. required files exist
for f in README.md server.js lib/logic.js public/index.html public/css/style.css public/js/app.js package.json; do
  [ -f "$D/$f" ] && ok "file $f" || bad "file $f missing"
done

# 2. JS syntax valid
for f in server.js lib/logic.js public/js/app.js; do
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
if(!/^Number,Client,Issue date/.test(lines[0])) throw new Error('header: '+lines[0]);
if(!/Paid,Balance$/.test(lines[0])) throw new Error('paid/balance cols');
if(!/\"Acme, Inc\"/.test(csv)) throw new Error('quoting');
if(!/,200\.00,50\.00,150\.00$/.test(lines[1])) throw new Error('paid/balance values: '+lines[1]);
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

echo "--- smoke: $PASS passed, $FAIL failed ---"
exit $((FAIL>0))
