#!/bin/bash
# invoicepilot-ai e2e tests — 12 flows (node logic + live HTTP)
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

PORT=4182 node "$D/server.js" & SRV=$!
sleep 1.2
BASE="http://localhost:4182"

# Flow 1: full invoice lifecycle in logic (create -> totals -> validate -> mark paid)
node -e "
const L=require('$D/lib/logic.js');
let invoices=[];
const inv={number:L.nextNumber(invoices),clientName:'Bob Builder',issueDate:'2026-09-01',dueDate:'2026-09-15',
  items:[{desc:'Fix leak',qty:2,rate:85},{desc:'Parts',qty:1,rate:42.5}],discountPct:0,taxPct:6,status:'unpaid'};
const errs=L.validate(inv); if(errs.length) throw new Error('unexpected: '+errs.join(';'));
const t=L.totals(inv);
if(Math.abs(t.total-225.25)>0.02) throw new Error('total '+t.total);
invoices.push(inv);
if(L.nextNumber(invoices)!=='INV-0002') throw new Error('numbering');
inv.status='paid';
if(L.dashboard(invoices).paid!==t.total) throw new Error('paid sum');
" && ok "flow1: invoice lifecycle (create->total->paid)" || bad "flow1: invoice lifecycle"

# Flow 2: late-payer journey (overdue -> gentle -> firm -> final)
node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0003',clientName:'Slow Payer',issueDate:'2026-06-01',dueDate:'2026-06-15',
  items:[{desc:'Work',qty:1,rate:1200}],status:'unpaid'};
const days=L.daysOverdue(inv); if(days<60) throw new Error('should be 60+ days late, got '+days);
const seq=['gentle','firm','final'].map(t=>L.dunningDraft(inv,{name:'Slow Payer'},t));
if(!seq[2].body.includes('collection')) throw new Error('final lacks teeth');
if(seq.some(d=>!d.subject.includes('INV-0003'))) throw new Error('subject missing number');
" && ok "flow2: late-payer escalation (gentle->firm->final)" || bad "flow2: late-payer escalation"

# Flow 3: validation catches bad invoices
node -e "
const L=require('$D/lib/logic.js');
const e1=L.validate({number:'INV-1',clientName:'',issueDate:'2026-09-01',dueDate:'2026-08-01',items:[{desc:'',qty:0,rate:-5}]});
if(e1.length<4) throw new Error('expected >=4 errors, got '+e1.length);
const e2=L.validate({number:'INV-1',clientName:'C',issueDate:'2026-09-01',dueDate:'2026-09-10',items:[{desc:'x',qty:1,rate:10}]});
if(e2.length) throw new Error('good invoice flagged: '+e2.join(';'));
" && ok "flow3: validation rejects bad, accepts good" || bad "flow3: validation"

# Flow 4: HTTP API contract
curl -sf "$BASE/api/health" | grep -q '"ok":true' || { bad "flow4: health"; FLOW4=1; }
curl -s -X POST "$BASE/api/polish" -H 'Content-Type: application/json' -d '{}' | grep -q '"error"' || { bad "flow4: polish 400 on empty"; FLOW4=1; }
curl -s -X POST "$BASE/api/polish" -H 'Content-Type: application/json' -d 'not-json' | grep -q '"error"' || { bad "flow4: polish malformed"; FLOW4=1; }
[ -z "${FLOW4:-}" ] && ok "flow4: HTTP API contract (health/polish)" || true

# Flow 5: frontend serves all routes + print CSS present
for p in "/" "/css/style.css" "/js/app.js" "/lib/logic.js"; do
  curl -sf -o /dev/null "$BASE$p" || { bad "flow5: route $p"; F5=1; }
done
curl -sf "$BASE/css/style.css" | grep -q "@media print" || { bad "flow5: print stylesheet"; F5=1; }
curl -sf "$BASE/" | grep -q 'id="rBody"' || { bad "flow5: reminders UI"; F5=1; }
[ -z "${F5:-}" ] && ok "flow5: frontend routes + print/PDF support" || true

# Flow 6: money formatting + edge totals
node -e "
const L=require('$D/lib/logic.js');
if(L.money(1234567.891)!=='\$1,234,567.89') throw new Error('money fmt: '+L.money(1234567.891));
const t=L.totals({items:[{qty:0.5,rate:19.99}],discountPct:100,taxPct:20});
if(t.total!==0) throw new Error('100% discount should be 0, got '+t.total);
if(L.daysOverdue({dueDate:'not-a-date'})!==0) throw new Error('bad date');
if(L.statusOf({dueDate:'2099-01-01',status:'unpaid'})!=='outstanding') throw new Error('future due');
" && ok "flow6: money/edge totals" || bad "flow6: money/edge totals"

# Flow 7: partial-payment journey — pay in chunks, dashboard + dunning follow the balance
node -e "
const L=require('$D/lib/logic.js');
let invoices=[];
const inv={number:L.nextNumber(invoices),clientId:'c1',clientName:'Slow Payer',
  issueDate:'2026-06-01',dueDate:'2026-06-15',items:[{desc:'Work',qty:1,rate:500}],status:'unpaid'};
invoices.push(inv);
let r=L.addPayment(inv,200,'2026-07-01');
if(!r.ok) throw new Error('payment 1');
let d=L.dashboard(invoices);
if(d.overdue!==300) throw new Error('dashboard overdue should be 300, got '+d.overdue);
const draft=L.dunningDraft(inv,{name:'Slow Payer'},'firm');
if(!draft.body.includes('\$300.00')) throw new Error('dunning should reference \$300 balance, not \$500');
r=L.addPayment(inv,300,'2026-07-02');
if(!r.ok||L.statusOf(inv)!=='paid') throw new Error('final payment should mark paid');
d=L.dashboard(invoices);
if(d.paid!==500||d.overdue!==0) throw new Error('dashboard after pay '+JSON.stringify(d));
" && ok "flow7: partial payments (dashboard + dunning track balance)" || bad "flow7: partial payments"

# Flow 8: duplicate + CSV + client totals round trip
node -e "
const L=require('$D/lib/logic.js');
let invoices=[
  {number:'INV-0001',clientId:'c1',clientName:'Repeat Client',issueDate:'2026-09-01',dueDate:'2026-09-15',
   items:[{desc:'Lawn care',qty:4,rate:75}],discountPct:0,taxPct:0,status:'unpaid'},
];
const copy=L.cloneInvoice(invoices[0],L.nextNumber(invoices));
invoices.push(copy);
if(copy.number!=='INV-0002') throw new Error('numbering');
L.addPayment(copy,100);
const csv=L.invoicesToCSV(invoices);
if(csv.split('\n').length!==3) throw new Error('csv rows');
const ct=L.clientTotals(invoices);
if(ct.c1.unpaid!==500||ct.c1.count!==2) throw new Error('client totals '+JSON.stringify(ct.c1));
" && ok "flow8: duplicate -> partial pay -> CSV -> client totals" || bad "flow8: duplicate flow"

# Flow 9: dunning for partially-paid invoice mentions remaining balance in subject
node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0009',clientName:'Jane',issueDate:'2026-06-01',dueDate:'2026-06-15',
  items:[{qty:1,rate:1000}],status:'unpaid'};
L.addPayment(inv,750);
const g=L.dunningDraft(inv,{name:'Jane'},'gentle');
if(!g.subject.includes('\$250.00')||!g.body.includes('\$250.00')) throw new Error('should nudge for \$250');
const f=L.dunningDraft(inv,{name:'Jane'},'final');
if(!f.body.includes('250')) throw new Error('final missing balance');
" && ok "flow9: dunning references remaining balance" || bad "flow9: dunning balance"

# flow10: late-fee journey — overdue invoice accrues, draft bills it
node -e "
const L=require('$D/lib/logic.js');
const now=new Date('2026-10-12T12:00:00').getTime();
const inv={number:'INV-0010',clientName:'Late Larry',issueDate:'2026-06-01',dueDate:'2026-06-15',
  items:[{qty:1,rate:2000}],lateFeePct:2,status:'unpaid',payments:[]};
const fee=L.lateFee(inv,null,now);
if(!(fee>0)) throw new Error('fee should accrue');
const d=L.dunningDraft(inv,{name:'Late Larry'},'firm');
if(!/late fee/i.test(d.body)) throw new Error('draft must bill the fee');
L.addPayment(inv,500);
const fee2=L.lateFee(inv,null,now);
if(!(fee2<fee)) throw new Error('partial payment should shrink the fee base');
" && ok "flow10: late fee accrues on overdue, draft bills it, partial payment shrinks it" || bad "flow10: late fee journey"

# flow11: payer-profile journey — history reveals the slow payer
node -e "
const L=require('$D/lib/logic.js');
const now=new Date('2026-10-12T12:00:00').getTime();
const mk=(n,cid,due,pay,status)=>({number:n,clientId:cid,clientName:'C-'+cid,
  issueDate:'2026-01-01',dueDate:due,items:[{qty:1,rate:100}],status,
  payments:pay?[{amount:100,date:pay}]:[]});
const invs=[
  mk('P1','c1','2026-02-01','2026-02-01','paid'),
  mk('P2','c1','2026-03-01','2026-03-01','paid'),
  mk('Q1','c2','2026-02-01','2026-04-15','paid'),
  mk('Q2','c2','2026-05-01',null,'unpaid')
];
const p1=L.payerProfile(invs,'c1',now);
const p2=L.payerProfile(invs,'c2',now);
if(p1.rating!=='on-time'||p1.avgDaysLate!==0) throw new Error('c1 should be on-time');
if(p2.rating!=='slow'||p2.overdueCount!==1) throw new Error('c2 should be slow');
" && ok "flow11: on-time vs slow payer profiles" || bad "flow11: payer profiles"

# flow12: recurring journey — monthly retainer rolls forward
node -e "
const L=require('$D/lib/logic.js');
const inv={number:'INV-0100',clientId:'c1',clientName:'Retainer Co',businessName:'Freelancer',
  issueDate:'2026-09-01',dueDate:'2026-09-15',items:[{desc:'Retainer',qty:1,rate:800}],
  discountPct:0,taxPct:0,lateFeePct:1,notes:'',status:'paid',payments:[{amount:800,date:'2026-09-10'}]};
const next=L.recurringClone(inv,'monthly',L.nextNumber([inv]));
if(next.number!=='INV-0101') throw new Error('numbering');
if(next.issueDate!=='2026-10-01'||next.dueDate!=='2026-10-15') throw new Error('dates');
if(next.status!=='unpaid'||L.balanceDue(next)!==800) throw new Error('fresh balance');
if(next.recurring!=='monthly') throw new Error('cadence tag');
" && ok "flow12: monthly retainer clones forward with fresh balance" || bad "flow12: recurring"

# Flow 13: estimate lifecycle — quote, convert, retire, dashboard ignores quotes
node -e "
const L=require('$D/lib/logic.js');
const est={id:'e1',kind:'estimate',status:'estimate',number:'EST-0042',clientName:'Ann',clientId:'c1',
  businessName:'Biz',issueDate:'2026-10-01',dueDate:'2026-10-31',
  items:[{desc:'Deck rebuild',qty:1,rate:1200}],discountPct:0,taxPct:8,lateFeePct:0,notes:'',payments:[]};
if(L.validate(est).length) throw new Error('valid estimate rejected');
if(L.statusOf(est)!=='estimate') throw new Error('status');
const invoices=[est];
if(L.dashboard(invoices).count!==0) throw new Error('quote counted in dashboard');
const inv=L.convertEstimate(est,'INV-0043','2026-10-13');
est.status='converted';
invoices.push(inv);
if(L.statusOf(est)!=='converted') throw new Error('retire');
if(inv.number!=='INV-0043'||inv.dueDate!=='2026-11-12') throw new Error('convert dates '+inv.dueDate);
if(L.totals(inv).total!==1296) throw new Error('total');
const d=L.dashboard(invoices);
if(d.count!==1||d.outstanding!==1296) throw new Error('dashboard '+JSON.stringify(d));
" && ok "flow13: estimate converts to invoice, quote retired from receivables" || bad "flow13: estimates"

# Flow 14: tax summary + client statement across quarters
node -e "
const L=require('$D/lib/logic.js');
function inv(n,client,issue,tax,pay){var i={number:n,kind:'invoice',status:'unpaid',clientName:client,clientId:client,
  issueDate:issue,dueDate:issue,items:[{desc:'Work',qty:1,rate:1000}],discountPct:0,taxPct:tax,payments:[]};
  if(pay) L.addPayment(i,pay,issue); return i;}
const invs=[inv('INV-1','Ann','2026-01-15',10,1100),inv('INV-2','Ann','2026-04-20',10,0),inv('INV-3','Bob','2026-07-05',0,1000)];
const ts=L.taxSummary(invs,2026);
if(ts.quarters[0].taxBilled!==100||Math.abs(ts.quarters[0].taxCollected-100)>0.01) throw new Error('q1 tax');
if(ts.quarters[1].invoiced!==1100||ts.quarters[1].taxCollected!==0) throw new Error('q2 unpaid');
if(ts.quarters[2].taxBilled!==0) throw new Error('q3 no tax');
if(ts.total.invoiced!==3200||ts.total.collected!==2100) throw new Error('totals');
const st=L.clientStatement(invs,'Ann');
if(st.lines.length!==2||st.totalBilled!==2200||st.totalPaid!==1100||st.balance!==1100) throw new Error('statement');
if(st.lines[0].number!=='INV-1') throw new Error('sorted by issue date');
" && ok "flow14: quarterly tax summary + client statement totals" || bad "flow14: tax/statement"

# Flow 15: new UI surfaces over HTTP
curl -sf "$BASE/" | grep -q 'id="fEstimate"' && ok "flow15: estimate checkbox served" || bad "flow15: estimate checkbox"
curl -sf "$BASE/" | grep -q 'id="taxTable"' && ok "flow15b: tax panel served" || bad "flow15b: tax panel"
curl -sf "$BASE/" | grep -q 'id="stmtPanel"' && ok "flow15c: statement panel served" || bad "flow15c: statement panel"

# Flow 16: forecast auto-feed journey — unpaid invoice feeds money in, partial payment shrinks it, overdue lands week 0, mark-paid removes it
node -e "
const L=require('$D/lib/logic.js'), F=require('$D/lib/forecast.js');
function isoPlus(d){var x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);}
let invoices=[];
const inv={id:'i1',number:L.nextNumber(invoices),clientName:'Forecast Co',clientId:'c1',
  issueDate:'2026-09-01',dueDate:isoPlus(14),items:[{desc:'Retainer',qty:1,rate:2000}],status:'unpaid',payments:[]};
invoices.push(inv);
let fed=F.invoicesToCashIn(invoices,L);
if(fed.length!==1||fed[0].amount!==2000) throw new Error('auto-feed on save');
let fc=F.forecast(fed,0,13,{});
if(fc[2].inflow!==2000) throw new Error('due in 14 days -> week 2, got '+JSON.stringify(fc.map(w=>w.inflow)));
L.addPayment(inv,500,'2026-10-01');
fed=F.invoicesToCashIn(invoices,L);
if(fed[0].amount!==1500) throw new Error('fed amount must follow balance: '+fed[0].amount);
inv.dueDate=isoPlus(-20); // now overdue
fed=F.invoicesToCashIn(invoices,L);
fc=F.forecast(fed,0,13,{});
if(fc[0].inflow!==1500) throw new Error('overdue should land in week 0');
inv.status='paid';
if(F.invoicesToCashIn(invoices,L).length!==0) throw new Error('paid invoice must not feed the forecast');
" && ok "flow16: forecast auto-feed (save -> week 2, partial pay -> 1500, overdue -> week 0, paid -> gone)" || bad "flow16: forecast auto-feed"

# Flow 17: shortfall alert + recurring bill + what-if scenario shift end to end
node -e "
const F=require('$D/lib/forecast.js');
function isoPlus(d){var x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);}
const items=[
  {id:'inv-1',kind:'in',desc:'INV-0001',date:isoPlus(10),amount:1000},
  {id:'bill-1',kind:'out',desc:'Payroll',date:isoPlus(5),amount:2500,recurring:'monthly'}
];
const fc=F.forecast(items,1000,13,{});
const sf=F.shortfalls(fc,500);
if(!sf.critical.length) throw new Error('expect a shortfall: balance 1000, payroll 2500 hits week 1');
if(!sf.critical.some(w=>w.balance<0)) throw new Error('critical weeks must be negative');
const t=F.totals(fc);
if(t.totalOut<2500) throw new Error('recurring payroll must total >2500, got '+t.totalOut);
var sm={'inv-1':2};
const scn=F.forecast(items,1000,13,sm);
const d=F.scenarioDiff(fc,scn,500);
if(d.scnShortfalls<d.baseShortfalls) throw new Error('shifting income later cannot reduce shortfalls');
const rw=F.runwayWeeks(fc);
if(!(rw>=0&&rw<=13)) throw new Error('runway '+rw);
" && ok "flow17: shortfall alert, recurring bill, late-payer scenario, runway" || bad "flow17: shortfall/what-if"

# Flow 18: forecast UI served over HTTP
curl -sf "$BASE/" | grep -q 'data-tab="forecast"' && ok "flow18: forecast tab served" || bad "flow18: forecast tab"
curl -sf "$BASE/" | grep -q 'id="fcChart"' && ok "flow18b: forecast chart panel served" || bad "flow18b: forecast chart"
curl -sf "$BASE/" | grep -q 'id="fcBillAdd"' && ok "flow18c: bill form served" || bad "flow18c: bill form"
curl -sf "$BASE/lib/forecast.js" | grep -q "invoicesToCashIn" && ok "flow18d: forecast engine served" || bad "flow18d: engine"

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
echo "--- e2e: $PASS passed, $FAIL failed ---"
exit $((FAIL>0))
