# Devpost submission

## Title
BahiKhata: the AI invoicing assistant for PayPal

## Tagline
Turn client notes into PayPal invoices, and let AI write the follow-up when payment runs late.

## Inspiration
A bahi-khata is the red cloth-bound ledger Indian shopkeepers have kept their accounts in for generations. Freelancers and small businesses still lose hours to the same two jobs: typing invoices out of scattered notes, and finding the right words to chase a client who has not paid. Both are about money, both are repetitive, and both suit PayPal plus AI.

## What it does
- **Notes to invoice.** Paste notes the way you would say them. GPT-4o (JSON mode) pulls out the client, email, line items, currency, GST or IGST rate and due date. Anything it cannot find is left blank and called out.
- **A live invoice beside the form.** The studio shows the invoice as the client will see it, filling in as you type, with GST worked out per line.
- **Real PayPal invoices.** The backend creates a draft through the PayPal Invoicing API, stores PayPal's own total, and sends it when you approve.
- **Live payment tracking.** PayPal webhooks update the ledger. Signatures are verified, duplicates are ignored, and a late event cannot overwrite a newer status.
- **AI follow-ups.** For overdue invoices GPT-4o writes a reminder whose tone moves from friendly to firm to final notice, based on days overdue and reminders already sent. It goes out through PayPal's reminder API, and you can edit it first.
- **Daily autopilot.** An optional daily job chases every overdue invoice with guardrails: it stops once paid, caps reminders at five, spaces them three days apart, and cannot double-send even if two runs overlap.

## How PayPal and AI work together
AI does the language work: reading notes and writing reminders. PayPal does the money work: creating and delivering invoices, taking payment, sending reminders, and reporting payment events. The AI output becomes real PayPal invoices, and PayPal's payment events decide what the AI does next.

## How it was built
React (Vite) and AG Grid on the front. FastAPI in a single file on the back. Supabase Postgres for storage. OpenAI GPT-4o for reading and writing. PayPal Invoicing REST API and webhooks. Deployed on Render. 61 backend tests and 17 interface tests.

## Challenges
- PayPal's webhook signature check fails if the event body is re-serialized, so the raw body is forwarded untouched.
- Webhooks can be retried, delayed or arrive out of order. Events are deduplicated by ID, stale events are ignored, and a failed event is released so PayPal's retry works.
- Sending and reminding must happen exactly once. Each is claimed in the database before PayPal is called, and rolled back if PayPal fails.
- Keeping the AI honest: unknown fields stay blank instead of guessed, every value is validated on the server, and the user reviews each invoice and reminder before it goes out.

## What's next
User accounts with per-user data, a payment-likelihood score per client, pausing the chase when a client replies with a dispute, and live-mode PayPal.

## Built with
React, Vite, AG Grid, FastAPI, Python, OpenAI GPT-4o, Supabase, PostgreSQL, PayPal Invoicing API, PayPal Webhooks, Render

---

# Demo video script (about 3 minutes)

**0:00 Problem (15s).** "Freelancers spend hours turning notes into invoices and then chasing late payments. BahiKhata does both on PayPal."

**0:15 Notes to invoice (45s).** Open the studio. Paste messy notes. Click Read my notes. Point at the invoice filling in on the right, the GST line, and the one thing it left blank. Fix it. Click Create draft, then show the draft in the PayPal sandbox.

**1:00 Send and get paid (40s).** Click Send to client. Open the sandbox buyer's invoice and pay it. Open the ledger and show the status change to Paid. Mention the webhook: signature verified, deduplicated, stored in Supabase.

**1:40 Chasing (55s).** Show an invoice that is 10 days overdue (backdated in Supabase for the demo). Click Chase. Read the AI email aloud, note the tone, edit a sentence, send it through PayPal. Show the reminder count go to 1.

**2:35 Autopilot (25s).** Show the daily job and its guardrails: stops when paid, five-reminder cap, minimum gap, secret-protected endpoint, no double sends.

**3:00 Close (10s).** "Notes in, paid invoices out. BahiKhata, built on PayPal Invoicing and GPT-4o."
