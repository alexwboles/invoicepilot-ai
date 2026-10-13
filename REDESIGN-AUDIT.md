# REDESIGN-AUDIT — invoicepilot-ai (2026-10-13)

Competitors referenced: **QuickBooks Online** (invoice list with status pills + due dates, invoice document view with letterhead/totals, dashboard "unpaid invoices" hero), **FreshBooks** (left-nav billing workflow, branded invoice documents with logo/colors, one-click estimate→invoice, client statements), **Xero** (aged receivables, invoice status pipeline).

## Visual gaps vs competitors
- The live invoice document (`#preview`) is a basic stack: h2 business name, plain table, inline-styled totals. QuickBooks/FreshBooks render a true invoice sheet — letterhead masthead, INVOICE stamp + number block, bill-to, ruled line-item table, totals ledger, "Balance due" hero, terms footer.
- Due dates in the invoice list are raw dates (`2026-11-02`) with no urgency language. QuickBooks shows "due in 5 days" / "12 days overdue".
- The dashboard answers "who owes you money" but an overdue balance doesn't raise a visual alarm — no callout directing the user to Reminders.
- Status pills exist; the list is otherwise a dense 8-column table on mobile.

## Functional gaps vs competitors
1. **No due-date urgency text** on invoice rows (days until due / days overdue).
2. **Preview lacks an "Amount due" hero** — the single number the client cares about.
3. No per-invoice payment history visibility on the list (record-payment exists; the balance column suffices — out of scope).

## What this redesign does (bounded)
- **Invoice sheet restyle**: letterhead masthead (business name in Fraunces serif + INVOICE/ESTIMATE stamp + number/dates block), bill-to card, ruled line-item table with tabular figures, totals ledger ending in an "Amount due" hero, late-fee + notes terms footer. Print CSS already targets `#preview` — the sheet prints clean.
- **Due urgency chips**: "due in Nd" (navy), "due today" (amber), "Nd overdue" (red) in the Due column via the existing `L.statusOf` + date math.
- **Overdue callout banner** on the dashboard when overdue > 0: "$X overdue across N invoices — draft reminders" linking to the Reminders tab.
- **Mobile**: invoice table scrolls in `.tablewrap` (already); urgency chips keep meaning at small widths.
- Identity stays "the modern bookkeeper's ledger" — deep navy, Fraunces serif display, Inter body, status color language (green paid / amber outstanding / red overdue).
- All existing features preserved: estimates + convert, recurring series, late fees, payer reliability, tax summary, client statements, reminders (3 tones + AI polish), CSV export, print/PDF.
