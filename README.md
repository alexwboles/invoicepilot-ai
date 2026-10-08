# InvoicePilot AI 🧾

**Invoices that get paid.** An AI invoicing + smart payment-reminder app for freelancers and tradespeople — build a professional invoice in a minute, and when a client pays late, get the perfect nudge drafted in three tones.

## The problem

Freelancers lose thousands to late payments. Not because clients won't pay — because following up feels awkward, so it never happens. Meanwhile invoices get built in Word docs that look amateur.

## The solution

- **Invoice builder** — client, line items, discount, tax → live professional preview → Print / Save-as-PDF straight from the browser.
- **AI dunning drafts** — pick an overdue invoice, get a reminder drafted in 3 tones: 😊 Gentle, 😐 Firm, ⚠️ Final notice. Copy, paste, get paid. Drafts reference the *remaining balance* after partial payments.
- **Partial payments** — record payments against an invoice; the balance, dashboard, aging, and reminders all follow what's still owed. Paying in full marks it paid automatically.
- **Duplicate invoice** — one click re-bills a repeat client with a fresh number and today's date.
- **Dashboard** — outstanding / overdue / collected totals plus an aging list (current, 1–30, 31–60, 60+ days).
- **Ledger** — search invoices by number or client, filter by status, one-click CSV export of the full ledger (totals, paid, balance).
- **Clients + history** — everything stored locally. Per-client unpaid/overdue totals at a glance. Reminder log shows what you sent and when.

All local-first: your client list and invoices never leave the browser (localStorage). Set `OPENAI_API_KEY` and the "✨ Polish with AI" button upgrades drafts with GPT — fully optional, never required.

## Run it

```bash
node server.js
# → http://localhost:4176
```

Or serve `public/` with any static server. No dependencies, no build step.

Optional AI polish:

```bash
OPENAI_API_KEY=sk-... node server.js
```

## Pricing vision

| Plan | Price | For |
|------|-------|-----|
| Free | $0 | 5 invoices/mo |
| Pro | $19/mo | Unlimited invoices, reminder automation |
| Team | $49/mo | Multi-user, branding |

## Tech

- `server.js` — zero-dependency static server + optional `/api/polish` endpoint
- `lib/logic.js` — shared invoice math, aging, dunning templates (Node + browser)
- `public/` — dashboard, invoice builder, reminders, clients UI

## Tests

```bash
bash test/smoke.sh   # 10 checks
bash test/e2e.sh     # 6 flows
```
