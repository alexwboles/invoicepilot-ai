# REDESIGN-AUDIT — invoicepilot-ai v2 (2026-10-19)

Supersedes the 2026-10-13 audit. That pass landed the invoice sheet, due-urgency chips,
and the overdue callout; this pass takes the whole product to premium and closes the
remaining functional gaps. The 2026-10-19 consolidation (lib/forecast.js, 13-week
auto-fed forecast, scenario desk, SVG chart, CSV export, recurring bills,
re-render-on-mutation) is preserved in full — see below.

## Competitors studied

**Wave** (signnow.com management template walkthrough; saasworthy.com 2026 reviews;
aitools4beginners.blogspot.com automation guide)
- Invoices dashboard: totals due across customers, upcoming payout, **average time to
  get paid**, overdue summary — a money-in command center, not just a list.
- Payment Terms dropdown (Net 15/Net 30) sets the due date automatically on the form.
- Automated reminders for late clients; recurring invoices send on a schedule;
  manual "record payment" coexists with marking invoices paid.
- Professional branded invoices with logo/brand colors; visually segmented
  workflow, paper-like invoice representation.

**FreshBooks** (velan-bookkeeping.com smart-billing guide; duedropin.com reminder
breakdowns; business.com review)
- **Up to 3 automatic reminder emails per client, timed before AND after the due
  date** with custom wording — pre-due reminders are a deliberate cash-flow lever.
- Recurring invoices with auto-send; **late fees auto-applied** as % or flat;
  estimate → invoice in one click; client payment links for one-click payment.
- "You can email invoices and get updates when your clients view and pay them" —
  status visibility is a first-class feature.

**Xero** (central.xero.com short-term cash flow docs; xero.com cash-flow guide;
cfotech.news/noah-news.com cash-flow-manager coverage)
- Short-term cash flow projection: bank balance + amounts owing on invoices/bills +
  manually added upcoming money in/out; graph + **table + calendar views**; hover
  for daily breakdown of money in/out/projected balance.
- Headline indicators at the foot of the overview: **today's balance, 30-day
  projected balance, cash runway, cash buffer** (buffer = days until zero with no
  further cash received). Frames the forecast in operational terms.
- Forecast items are editable inline without touching the underlying ledger
  records; export to PDF/Excel or share via email/WhatsApp/Slack/Teams.

## 6 concrete patterns worth borrowing

1. **Invoice-section command center** (Wave): money owed, overdue, average time to
   get paid in one glance — not just a table of invoices.
2. **Payment terms presets** (Wave/FreshBooks): Net 7/14/30/60 + Due on receipt
   that auto-set the due date from the issue date on the invoice form.
3. **Pre-due + staged follow-up queue** (FreshBooks): reminders start BEFORE the
   due date; a suggested escalation cadence per invoice (gentle → firm → final)
   instead of one free-floating draft picker.
4. **Operational forecast headline strip** (Xero): today's balance, 30-day
   projection, cash runway, **cash buffer** above the chart.
5. **Aging export** (Xero/QuickBooks reports): the aged-receivables view exports
   to CSV like every other report.
6. **Per-invoice activity/detail** (FreshBooks/QuickBooks): expandable row showing
   payment history, late fees, notes — plus secondary actions tucked away so the
   row itself stays scannable (cf. uxatwork.com invoicing case study: primary
   actions first, secondary under an expander, status spelled out not just colored).

## Top 4 functional gaps closed by this redesign

1. **No payment terms presets** — invoice form required hand-picking a due date.
   → New: Terms select (Due on receipt / Net 7 / Net 14 / Net 30 / Net 60) that
   auto-sets the due date; stored on the invoice (`terms`); carried by
   duplicate/recur.
2. **Reminders were overdue-only** — no pre-due nudges (a FreshBooks signature),
   and the draft had no suggested escalation. → New: follow-up queue with
   **due-soon heads-ups** (pre-due gentle drafts, next 14 days) and per-overdue-
   invoice **suggested tone + suggested send date**; "Mark sent" logs without
   needing the clipboard API.
3. **No aging report export** — dashboard aging was view-only. → New: Aged
   receivables CSV export (Number, Client, Due date, Aging, Total, Paid, Balance).
4. **No per-invoice payment history in the list** (was out of scope in v1) —
   → New: expandable detail rows showing payments, late fee, notes, terms, and
   the secondary actions (Duplicate/Recur/Convert/Delete) so the main row keeps
   only primary actions (Record payment / Mark paid).

Also added, cheap and competitor-grounded: **average days to get paid** stat on
the dashboard (Wave's invoice dashboard headline) and **cash buffer weeks** on
the forecast (Xero's cash buffer).

## Visual design direction — "the modern bookkeeper's ledger", sharpened

Deep ink-navy on paper white, brass for caution, red only for alarm. Fraunces
serif for money figures and headings, Inter for everything else, tabular figures
everywhere money appears. Hairline rules, letterpress-style INVOICE stamp on the
sheet, layered cards with varied geometry (navy topbar band, oversized hero
figure beside a refined aging panel, stat cards with ink side-bars). Absolutely:
no rounded edges, no purple/blue gradients, no emoji chrome, restrained motion
(one fade/slide on tab switch, reduced-motion respected).

## What this redesign does (bounded)

- Topbar: dark navy band, white brand, tabs as text with active underline;
  mobile tabs scroll horizontally instead of wrapping into a mess.
- Dashboard: hero split (big serif figure + aging panel), stat grid gains
  "Avg time to get paid", aging gets Export CSV, styled empty states.
- Invoice list: fixed filter/search toolbar; **detail expander rows** (payment
  history, late fee, notes, terms, secondary actions); primary actions only on
  the row.
- New Invoice: Terms preset select auto-setting due date; fixed item-row widths.
- Reminders: **follow-up queue** — overdue group with suggested tone/send-date +
  due-soon group with pre-due drafts; per-row Draft + Mark sent; draft card +
  reminder log preserved.
- Forecast: Xero-style headline strip (starting/today balance, 30-day
  projection, runway, buffer) above a refined chart; weekly breakdown,
  scenario desk, auto-fed in/out, bills, CSV export all preserved.
- Everything already in the repo (estimates, recurring series, late fees, payer
  reliability, tax summary, statements, AI polish, forecast auto-feed, scenarios)
  is preserved: same IDs, same localStorage key (`ip6`), same schemas. The new
  `terms` field on invoices defaults to '' on old records — no migration needed.

## Preservation contract (2026-10-19 consolidation, untouched)

lib/forecast.js (UMD, zero-dep) · 13-week forecast tab auto-fed from
outstanding/overdue invoices (invoicesToCashIn; remaining balance after partial
payments) · scenario desk (3 named scenarios) · SVG chart · CSV export ·
recurring bills · re-render on invoice mutations · localStorage keys/schemas
unchanged (`ip6`, S.forecast bills/scenarios).
