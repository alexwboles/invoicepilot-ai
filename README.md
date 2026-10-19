# InvoicePilot AI 🧾

**Invoices that get paid.** An AI invoicing + smart payment-reminder app for freelancers and tradespeople — build a professional invoice in a minute, and when a client pays late, get the perfect nudge drafted in three tones.

## The problem

Freelancers lose thousands to late payments. Not because clients won't pay — because following up feels awkward, so it never happens. Meanwhile invoices get built in Word docs that look amateur.

## The solution

- **Invoice builder** — client, line items, discount, tax, **payment terms presets** (Due on receipt / Net 7 / 14 / 30 / 60) that set the due date automatically → live professional preview → Print / Save-as-PDF straight from the browser.
- **Follow-up queue (smart reminders)** — friendly **pre-due heads-ups** for invoices due in the next 14 days (FreshBooks-style), then a suggested escalation cadence per overdue invoice — gentle (≤7d late), firm (≤30d), final notice (>30d). Open a draft, copy it, or log it as sent; drafts reference the *remaining balance* after partial payments.
- **AI dunning drafts** — every queue row drafts the nudge in the suggested tone; override with the Gentle / Firm / Final buttons. Set `OPENAI_API_KEY` and "✨ Polish with AI" upgrades drafts with GPT — fully optional, never required.
- **Partial payments** — record payments against an invoice; the balance, dashboard, aging, and reminders all follow what's still owed. Paying in full marks it paid automatically.
- **Duplicate invoice** — one click re-bills a repeat client with a fresh number and today's date.
- **Dashboard** — outstanding / overdue / collected totals, **average days to get paid**, plus an aging list (current, 1–30, 31–60, 60+ days) with **one-click aged-receivables CSV export**.
- **13-week cash forecast** — money in is **auto-fed from your outstanding invoices** (due dates → expected receipts; overdue invoices land in week 0, amounts follow partial payments). Add your bills (rent, payroll, suppliers — with weekly/monthly/quarterly/yearly repeat) plus a starting balance, and get a week-by-week chart, shortfall alerts, and an Xero-style headline strip: **starting balance, 30-day projection, cash runway, and cash buffer** (weeks until cash runs out if no new money arrives) — plus a what-if **scenario desk**: shift any invoice or bill a few weeks and compare the balance line against the base. Export the forecast to CSV. *(Merged in from cashflow-ai, 2026-10-19 — no more re-typing invoices into a separate forecaster.)*
- **Ledger** — search invoices by number or client, filter by status, expand any row for **payment history, late fees, notes, and terms** (secondary actions — duplicate, recur, delete — tuck into the detail row), one-click CSV export of the full ledger (totals, paid, balance).
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
- `lib/forecast.js` — 13-week forecast engine + invoice→money-in auto-feed (Node + browser)
- `public/` — dashboard, invoice builder, reminders, forecast, clients UI

## Tests

```bash
bash test/smoke.sh   # 46 checks
bash test/e2e.sh     # 29 flows
```

## Merge note

cashflow-ai was merged into this repo on 2026-10-19 (13-week forecasting engine, shortfall alerts, what-if scenarios, recurring bills, forecast CSV). It is archived with a pointer here.
