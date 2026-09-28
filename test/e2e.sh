#!/bin/bash
# invoicepilot-ai e2e tests — 6 flows (node logic + live HTTP)
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

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
echo "--- e2e: $PASS passed, $FAIL failed ---"
exit $((FAIL>0))
