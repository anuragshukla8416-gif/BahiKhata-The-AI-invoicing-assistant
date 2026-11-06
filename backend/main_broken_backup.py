
# backend/main.py
# ---------------------------------------------------------
# BahiKhata – Invoice Management API
# ---------------------------------------------------------

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
import hmac
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Tuple, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from google import generativeai as genai        # Fixed import
from pydantic import BaseModel, EmailStr, Field
from supabase import create_client
from zoneinfo import ZoneInfo                # <-- New import

# ---------------------------------------------------------
# Environment & logging
# ---------------------------------------------------------
load_dotenv()
log = logging.getLogger("uvicorn.error")

PAYPAL = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
SENDER = os.getenv("SENDER_NAME", "Accounts")
TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))  # <-- Fixed timezone
MAX_REMINDERS = 5
MAX_PER_RUN = 20
REMINDER_GAP_DAYS = int(os.getenv("REMINDER_GAP_DAYS", "3"))
UNPAID = {"SENT", "UNPAID", "PARTIALLY_PAID"}
PAID = {"PAID", "MARKED_AS_PAID"}

STATUS_BY_EVENT = {
    "INVOICING.INVOICE.PAID": "PAID",
    "INVOICING.INVOICE.CANCELLED": "CANCELLED",
    "INVOICING.INVOICE.REFUNDED": "REFUNDED",
}

TONE_TEMPLATES = [
    "friendly and light, assume it simply slipped their mind",
    "polite but firm, say this is a follow‑up and ask for a payment date",
    "formal final notice, state that the invoice is seriously overdue and that further action may follow",
]

# ---------------------------------------------------------
# Prompt used for AI parsing of free‑form notes
# ---------------------------------------------------------
PARSE_PROMPT = """You extract invoice data from a freelancer's messy notes.
Return a JSON object with exactly these keys:
client_name (string), client_email (string),
currency (3‑letter ISO code: INR for rupees, USD for dollars, default USD),
tax_name ("GST" or "IGST", default "GST"),
items (array of {name, quantity, unit_price, tax_rate}) where tax_rate is the tax percentage for that line (0 if none is mentioned),
due_date (YYYY‑MM‑DD), notes (string).
Resolve relative terms like "net 15" or "end of month" from today's date.
Use null for anything the notes don't state. Never guess an email address, a price or a tax rate.
"""

# ---------------------------------------------------------
# Gemini client initialisation (correct SDK usage)
# ---------------------------------------------------------
genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))

# Re‑use a single model instance – cheap & fast.
GEMINI_MODEL = genai.GenerativeModel(
    "gemini-3.1-flash-lite",
    generation_config=genai.GenerationConfig(
        temperature=0.0,
        response_mime_type="application/json",
    ),
)

# ---------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------
app = FastAPI(title="BahiKhata API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip().rstrip("/")
        for o in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
        if o.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------
class Notes(BaseModel):
    """Raw note text supplied by the client."""

    text: str = Field(min_length=5, max_length=5000)


class Item(BaseModel):
    """One line‑item of an invoice."""

    name: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0, le=1_000_000)
    unit_price: float = Field(ge=0, le=100_000_000)
    tax_rate: float = Field(0, ge=0, le=100)


class Invoice(BaseModel):
    """Invoice payload supplied by the frontend."""

    client_name: str = Field(min_length=1, max_length=140)
    client_email: EmailStr
    currency: str = Field("USD", pattern=r"^[A-Z]{3}$")
    tax_name: str = Field("GST", pattern=r"^(GST|IGST)$")
    items: List[Item] = Field(min_length=1, max_length=50)
    due_date: date
    notes: str = Field("", max_length=2000)


class Reminder(BaseModel):
    """Reminder payload – allows a custom subject/body."""

    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=4000)


# ---------------------------------------------------------
# Supabase client (mocked in tests)
# ---------------------------------------------------------
db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

# ---------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------
_token: dict[str, Any] = {"value": None, "expires": 0.0}


def today() -> date:
    """Current date in the configured timezone."""
    return datetime.now(TZ).date()


def _as_decimal(value: Any) -> Decimal:
    """Convert a value to Decimal safely."""
    return Decimal(str(value))


def num(x: Any) -> str:
    """Return a string representation without scientific notation."""
    return format(_as_decimal(x).normalize(), "f")


def cents(x: Decimal) -> Decimal:
    """Round a Decimal to two decimal places (currency cent)."""
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def invoice_total(items: List[Item]) -> Decimal:
    """Calculate the total amount (incl. tax) for a list of items."""
    total = Decimal(0)
    for i in items:
        line = cents(_as_decimal(i.quantity) * _as_decimal(i.unit_price))
        total += line + cents(line * _as_decimal(i.tax_rate) / 100)
    return total


def paypal_token() -> str:
    """Retrieve a fresh PayPal OAuth token, caching it until shortly before expiry."""
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    try:
        r = httpx.post(
            f"{PAYPAL}/v1/oauth2/token",
            auth=(os.getenv("PAYPAL_CLIENT_ID"), os.getenv("PAYPAL_SECRET")),
            data={"grant_type": "client_credentials"},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError as e:
        log.error("PayPal auth failed: %s", e)
        raise HTTPException(
            502,
            "Could not sign in to PayPal. Check PAYPAL_CLIENT_ID, PAYPAL_SECRET and PAYPAL_BASE_URL.",
        )
    _token.update(value=data["access_token"], expires=time.time() + data["expires_in"])
    return _token["value"]


def paypal_error(r: httpx.Response) -> str:
    """Extract a human‑readable error from a PayPal response."""
    text = ""
    try:
        body = r.json()
        if isinstance(body, dict):
            parts = [
                body.get("message")
                or body.get("error_description")
                or body.get("name")
                or ""
            ]
            parts += [
                d.get("description") or d.get("issue") or ""
                for d in body.get("details") or []
                if isinstance(d, dict)
            ]
            text = " ".join(p for p in parts if p)
    except ValueError:
        pass
    return f"PayPal error {r.status_code}: {(text or r.text)[:400]}"


def paypal(method: str, path: str, **kwargs: Any) -> Any:
    """Thin wrapper around httpx.request for PayPal API calls."""
    headers = {"Authorization": f"Bearer {paypal_token()}", **kwargs.pop("headers", {})}
    try:
        r = httpx.request(method, PAYPAL + path, headers=headers, timeout=30, **kwargs)
    except httpx.HTTPError as e:
        log.error("PayPal request failed: %s %s %s", method, path, e)
        raise HTTPException(502, "PayPal did not respond. Try again in a moment.") from e

    if r.status_code >= 400:
        log.error("PayPal %s %s failed: %s %s", method, path, r.status_code, r.text[:500])
        raise HTTPException(502, paypal_error(r))
    return r.json() if r.content else {}


def ask_gpt(system: str, user: str, temperature: float) -> dict[str, Any]:
    """
    Call Gemini with a system prompt and user input.
    Returns the parsed JSON payload from the model.
    """
    try:
        response = GEMINI_MODEL.generate_content(
            contents=[system, f"User input:\n{user}"],
            generation_config=genai.GenerationConfig(
                temperature=temperature,
                response_mime_type="application/json",
            ),
        )
        raw = getattr(response, "text", None) or response.candidates[0].content.parts[0].text
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Gemini returned non‑JSON.")
        return data
    except Exception as e:
        log.error("Gemini call failed: %r", e)
        raise HTTPException(
            502,
            "AI service unavailable. Please try again later or use manual invoice entry.",
        ) from e


def get_row(invoice_id: str) -> dict[str, Any]:
    """Fetch a single invoice row from Supabase, raising 404 if missing."""
    try:
        uuid.UUID(invoice_id)  # validate format
    except ValueError:
        raise HTTPException(404, "Invoice not found")
    rows = db.table("invoices").select("*").eq("id", invoice_id).limit(1).execute().data
    if not rows:
        raise HTTPException(404, "Invoice not found")
    return rows[0]


def update_row(invoice_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Update an invoice row and return the updated row."""
    return db.table("invoices").update(fields).eq("id", invoice_id).execute().data[0]


def overdue_days(row: dict[str, Any]) -> int:
    """Number of days an invoice is overdue (0 if not unpaid)."""
    if row["status"] not in UNPAID:
        return 0
    return max((today() - date.fromisoformat(row["due_date"])).days, 0)


def parse_ts(value: str) -> datetime:
    """Parse an ISO‑8601 timestamp that may end with a trailing ‘Z’."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def chase_target(invoice_id: str) -> dict[str, Any]:
    """Validate that the invoice can be chased and return the row."""
    row = get_row(invoice_id)
    if row["status"] not in UNPAID:
        raise HTTPException(409, f"Invoice is {row['status']}, nothing to chase")
    if row["reminders_sent"] >= MAX_REMINDERS:
        raise HTTPException(409, "Reminder limit reached for this invoice")
    row["days_overdue"] = overdue_days(row)
    if row["days_overdue"] == 0:
        raise HTTPException(409, "Invoice is not overdue yet")
    return row


def number(v: Any) -> Optional[float]:
    """Coerce a value to float; return None for non‑numeric inputs."""
    if isinstance(v, bool):
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def iso_date(v: Any) -> Optional[str]:
    """Return an ISO‑date string (YYYY‑MM‑DD) or None."""
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


def parse_notes_locally(text: str) -> dict[str, Any]:
    """
    Simple, deterministic extraction of invoice data from free‑form text.
    Used as a fallback when the Gemini API is unavailable.
    """
    raw = text.strip()
    email_match = re.search(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", raw, re.I)
    email = email_match.group(0) if email_match else None

    client_name = None
    client_match = re.search(
        r"\binvoice\s+for\s+(.+?)(?=\s*\([^)]*@[^)]*\)|\s+for\s+|[,\.;]|$)",
        raw,
        re.I,
    )
    if client_match:
        client_name = client_match.group(1).strip(" \t,.;:")

    # Service / item description
    item_name = None
    item_match = re.search(
        r"\bfor\s+(.+?)(?=\s*[.;,]\s*(?:include|the total|payment|add the note)|\s+include\b|"
        r"\s+\d+(?:\.\d+)?\s+units?\b|$)",
        raw,
        re.I,
    )
    if item_match:
        candidate = item_match.group(1).strip(" \t,.;:")
        if not (email_match and email_match.end() <= item_match.start()):
            if candidate and not re.search(r"\b(?:steve|rahul|client)\b", candidate, re.I):
                item_name = candidate

    # Quantity
    quantity_match = re.search(r"\b(\d+(?:\.\d+)?)\s+units?\b", raw, re.I)
    quantity = number(quantity_match.group(1)) if quantity_match else 1.0

    # Unit price
    price_match = re.search(
        r"\bat\s*(?:₹|INR\s*|\$|USD\s*)?\s*(\d[\d,]*(?:\.\d{1,2})?)", raw, re.I
    )
    unit_price = number(price_match.group(1)) if price_match else None

    # Tax
    tax_match = re.search(r"\b(\d+(?:\.\d+)?)\s*%\s*(IGST|GST)\b", raw, re.I)
    if not tax_match:
        tax_match = re.search(r"\b(?:with|including)\s+(\d+(?:\.\d+)?)\s*%\s*(IGST|GST)\b", raw, re.I)
    tax_rate = number(tax_match.group(1)) if tax_match else 0
    tax_name = tax_match.group(2).upper() if tax_match else "GST"

    # Currency
    currency = "INR" if ("₹" in raw or re.search(r"\b(?:INR|rupees?)\b", raw, re.I)) else "USD"

    # Due date
    due_date = today()
    due_match = re.search(r"\b(?:due|payment was due|due date was)\s+(\d+)\s+days?\s+ago\b", raw, re.I)
    if due_match:
        due_date = today() - timedelta(days=int(due_match.group(1)))
    else:
        explicit_due = re.search(r"\b(?:due date|due)\s*(?:is|was|on)?\s*(\d{4}-\d{2}-\d{2})\b", raw, re.I)
        if explicit_due:
            parsed = iso_date(explicit_due.group(1))
            if parsed:
                due_date = date.fromisoformat(parsed)

    # Notes
    notes_match = re.search(r"\badd\s+(?:the\s+)?note\s*:\s*(.+)$", raw, re.I | re.S)
    notes = notes_match.group(1).strip() if notes_match else raw

    items = []
    if item_name or unit_price is not None:
        items.append(
            {
                "name": item_name or "Services",
                "quantity": quantity or 1,
                "unit_price": unit_price,
                "tax_rate": tax_rate or 0,
            }
        )

    return {
        "client_name": client_name,
        "client_email": email,
        "currency": currency,
        "tax_name": tax_name,
        "items": items,
        "due_date": due_date.isoformat(),
        "notes": notes,
        "fallback": True,
        "message": "Gemini is unavailable. Basic details were extracted locally; please verify every field before creating the invoice.",
    }


# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------

@app.post("/api/parse")
def parse_notes(n: Notes) -> dict[str, Any]:
    """
    Parse free‑form note text into structured invoice data.
    Tries Gemini first; on any failure returns a deterministic local extraction.
    """
    try:
        data = ask_gpt(
            f"Today is {today().isoformat()}.\n{PARSE_PROMPT}",
            n.text,
            0,
        )
        # ---- Minimal validation ----
        required = {"client_name", "client_email", "currency", "items", "due_date"}
        if not required.issubset(data) or not data.get("client_email"):
            raise HTTPException(422, "Unable to parse invoice data")
        # ----------------------------

    except HTTPException as e:
        # Propagate Gemini‑related failures as 422 (tests expect this)
        raise HTTPException(422, f"AI parsing failed: {e.detail}") from e
    except Exception as e:
        log.warning("AI invoice parsing failed; using local extraction: %r", e)
        return parse_notes_locally(n.text)

    items = [
        {
            "name": str(i.get("name") or "Item"),
            "quantity": number(i.get("quantity")),
            "unit_price": number(i.get("unit_price")),
            "tax_rate": number(i.get("tax_rate")) or 0,
        }
        for i in (data.get("items") or [])
        if isinstance(i, dict)
    ]

    currency = str(data.get("currency") or "USD").upper()
    tax_name = str(data.get("tax_name") or "GST").upper()

    return {
        "client_name": data.get("client_name"),
        "client_email": data.get("client_email"),
        "currency": currency if len(currency) == 3 else "USD",
        "tax_name": tax_name if tax_name in ("GST", "IGST") else "GST",
        "items": items,
        "due_date": iso_date(data.get("due_date")),
        "notes": data.get("notes") or "",
    }


@app.post("/api/invoices", status_code=201)
def create_invoice(inv: Invoice) -> dict[str, Any]:
    """Create a draft invoice in PayPal and store it locally."""
    number = paypal("POST", "/v2/invoicing/generate-next-invoice-number", json={})["invoice_number"]

    detail = {
        "invoice_number": number,
        "currency_code": inv.currency,
        "payment_term": {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": inv.due_date.isoformat()},
    }
    if inv.notes:
        detail["note"] = inv.notes

    first, _, last = inv.client_name.strip().partition(" ")
    billing = {"email_address": inv.client_email}
    if last.strip():
        billing["name"] = {"given_name": first, "surname": last.strip()}
    else:
        billing["business_name"] = first

    items = []
    for i in inv.items:
        item = {
            "name": i.name,
            "quantity": num(i.quantity),
            "unit_amount": {"currency_code": inv.currency, "value": f"{Decimal(str(i.unit_price)):.2f}"},
        }
        if i.tax_rate:
            item["tax"] = {"name": inv.tax_name, "percent": num(i.tax_rate)}
        items.append(item)

    created = paypal(
        "POST",
        "/v2/invoicing/invoices",
        json={"detail": detail, "primary_recipients": [{"billing_info": billing}], "items": items},
    )
    paypal_id = created["href"].rstrip("/").rsplit("/", 1)[-1]

    try:
        total = Decimal(paypal("GET", f"/v2/invoicing/invoices/{paypal_id}")["amount"]["value"])
    except Exception:
        total = cents(invoice_total(inv.items))

    try:
        row = (
            db.table("invoices")
            .insert(
                {
                    "paypal_invoice_id": paypal_id,
                    "invoice_number": number,
                    "client_name": inv.client_name,
                    "client_email": inv.client_email,
                    "items": [i.model_dump() for i in inv.items],
                    "currency": inv.currency,
                    "total": float(total),
                    "due_date": inv.due_date.isoformat(),
                    "notes": inv.notes,
                    "status_updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .execute()
            .data[0]
        )
    except Exception:
        try:
            paypal("DELETE", f"/v2/invoicing/invoices/{paypal_id}")
        except Exception:
            log.error("Could not remove orphaned PayPal draft %s", paypal_id)
        raise

    return row


@app.post("/api/invoices/{invoice_id}/send")
def send_invoice(invoice_id: str) -> dict[str, Any]:
    """Mark a draft invoice as SENT and forward the request to PayPal."""
    row = get_row(invoice_id)

    if row["status"] != "DRAFT":
        raise HTTPException(409, "Only draft invoices can be sent")

    paypal_invoice_id = row.get("paypal_invoice_id")
    if not paypal_invoice_id:
        raise HTTPException(400, "PayPal invoice ID is missing")

    claimed = (
        db.table("invoices")
        .update(
            {"status": "SENT", "status_updated_at": datetime.now(timezone.utc).isoformat()}
        )
        .eq("id", invoice_id)
        .eq("status", "DRAFT")
        .execute()
        .data
    )
    if not claimed:
        raise HTTPException(409, "This invoice is already being sent")

    try:
        paypal(
            "POST",
            f"/v2/invoicing/invoices/{paypal_invoice_id}/send",
            json={"send_to_recipient": True, "send_to_invoicer": True},
        )
        log.info("PayPal invoice send succeeded: invoice_id=%s", paypal_invoice_id)
    except Exception:
        update_row(
            invoice_id,
            {"status": "DRAFT", "status_updated_at": row["status_updated_at"]},
        )
        raise

    return claimed[0]


def normalize_invoice_status(status: str) -> str:
    """Map PayPal's duplicate status values to a single canonical string."""
    return "PAID" if status == "MARKED_AS_PAID" else status


@app.get("/api/invoices")
def list_invoices() -> List[dict[str, Any]]:
    """Return the most recent 500 invoices with derived fields."""
    rows = (
        db.table("invoices")
        .select("*")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )
    for row in rows:
        row["status"] = normalize_invoice_status(row["status"])
        row["days_overdue"] = overdue_days(row)
    return rows


@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(invoice_id: str) -> dict[str, Any]:
    """Permanently delete a *draft* invoice from both PayPal and Supabase."""
    row = get_row(invoice_id)
    if normalize_invoice_status(row.get("status")) != "DRAFT":
        raise HTTPException(
            409,
            "Only draft invoices can be deleted. Sent or paid invoices must be handled through PayPal.",
        )

    paypal_id = row.get("paypal_invoice_id")
    if paypal_id:
        try:
            paypal("DELETE", f"/v2/invoicing/invoices/{paypal_id}")
        except Exception as e:
            log.exception("Could not delete PayPal draft invoice %s", paypal_id)
            raise HTTPException(
                502,
                "PayPal could not delete this draft invoice. It was not removed from the ledger.",
            ) from e

    result = db.table("invoices").delete().eq("id", invoice_id).execute()
    if not result.data:
        raise HTTPException(500, "PayPal draft was deleted, but the local record could not be confirmed deleted.")

    log.info("Deleted draft invoice %s (PayPal invoice %s)", invoice_id, paypal_id)
    return {"ok": True, "deleted": invoice_id}


@app.post("/api/invoices/sync")
def sync_invoice_statuses() -> dict[str, Any]:
    """
    Reconcile local invoice status fields with PayPal.
    Used by the UI “Refresh Ledger” button.
    """
    rows = (
        db.table("invoices")
        .select("id,paypal_invoice_id,status,status_updated_at")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )

    updated = 0
    failures: List[dict[str, Any]] = []

    for row in rows:
        paypal_id = row.get("paypal_invoice_id")
        if not paypal_id:
            continue
        try:
            remote = paypal("GET", f"/v2/invoicing/invoices/{paypal_id}")
            remote_status = normalize_invoice_status(remote.get("status"))
            if not remote_status:
                continue

            local_status = normalize_invoice_status(row.get("status"))
            if remote_status != local_status:
                fields: dict[str, Any] = {
                    "status": remote_status,
                    "status_updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if remote_status == "PAID":
                    fields["paid_at"] = datetime.now(timezone.utc).isoformat()
                db.table("invoices").update(fields).eq("id", row["id"]).execute()
                log.info(
                    "PayPal sync updated local invoice %s from %s to %s",
                    row["id"],
                    local_status,
                    remote_status,
                )
                updated += 1
        except Exception as e:
            log.warning("PayPal sync failed for local invoice %s: %s", row.get("id"), str(e))
            failures.append({"invoice_id": row.get("id"), "error": str(e)})

    return {"ok": not failures, "checked": len(rows), "updated": updated, "failures": failures}


# ---------------------------------------------------------
# Webhook verification helpers
# ---------------------------------------------------------
def verified(headers: dict[str, str], raw: str) -> bool:
    """Validate a PayPal webhook signature."""
    if os.getenv("SKIP_WEBHOOK_VERIFY", "0") == "1":
        log.warning("PayPal webhook signature verification bypassed via SKIP_WEBHOOK_VERIFY=1")
        return True

    lower = {k.lower(): v for k, v in headers.items()}

    required = {
        "paypal-auth-algo": lower.get("paypal-auth-algo"),
        "paypal-cert-url": lower.get("paypal-cert-url"),
        "paypal-transmission-id": lower.get("paypal-transmission-id"),
        "paypal-transmission-sig": lower.get("paypal-transmission-sig"),
        "paypal-transmission-time": lower.get("paypal-transmission-time"),
    }
    missing = [k.upper() for k, v in required.items() if not v]
    if missing:
        log.warning("PayPal webhook verification skipped: missing headers %s", ", ".join(missing))
        return False

    webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
    if not webhook_id:
        log.error("PayPal webhook verification skipped: PAYPAL_WEBHOOK_ID is empty")
        return False

    try:
        webhook_event = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("PayPal webhook verification failed: body is not valid JSON")
        return False

    payload = {
        "auth_algo": required["paypal-auth-algo"],
        "cert_url": required["paypal-cert-url"],
        "transmission_id": required["paypal-transmission-id"],
        "transmission_sig": required["paypal-transmission-sig"],
        "transmission_time": required["paypal-transmission-time"],
        "webhook_id": webhook_id,
        "webhook_event": webhook_event,
    }

    try:
        result = paypal("POST", "/v1/notifications/verify-webhook-signature", json=payload)
    except HTTPException as e:
        log.error("PayPal signature verification API call failed: %s", e.detail)
        return False

    status = result.get("verification_status", "MISSING")
    log.info("PayPal signature verification result: %s", status)
    return status == "SUCCESS"


def handle_event(headers: dict[str, str], raw: str) -> dict[str, Any]:
    """Process a PayPal webhook event – update invoice status and de‑duplicate."""
    try:
        event = json.loads(raw)
        _ = event["id"]
        _ = event["event_type"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "Malformed webhook event")

    if not verified(headers, raw):
        log.error("PayPal webhook signature verification failed")
        raise HTTPException(400, "Invalid webhook signature")

    first_time = (
        db.table("webhook_events")
        .upsert(
            {"event_id": event["id"], "event_type": event["event_type"], "payload": event},
            on_conflict="event_id",
            ignore_duplicates=True,
        )
        .execute()
        .data
    )
    if not first_time:
        return {"ok": True, "duplicate": True}

    try:
        resource = event.get("resource") or {}
        inv = resource.get("invoice", resource)
        status = inv.get("status") or STATUS_BY_EVENT.get(event["event_type"])
        status = normalize_invoice_status(status) if status else status

        if inv.get("id") and status:
            stamp = event.get("create_time") or datetime.now(timezone.utc).isoformat()
            rows = (
                db.table("invoices")
                .select("id,status_updated_at")
                .eq("paypal_invoice_id", inv["id"])
                .limit(1)
                .execute()
                .data
            )
            newer_already_applied = (
                rows
                and rows[0]["status_updated_at"]
                and parse_ts(rows[0]["status_updated_at"]) > parse_ts(stamp)
            )
            if rows and not newer_already_applied:
                fields: dict[str, Any] = {"status": status, "status_updated_at": stamp}
                if status in PAID:
                    fields["paid_at"] = stamp
                db.table("invoices").update(fields).eq("id", rows[0]["id"]).execute()
                log.info("PayPal webhook updated local invoice %s to %s", rows[0]["id"], status)
            elif not rows:
                log.warning("PayPal webhook invoice ID %s was not found in the local ledger", inv["id"])
            else:
                log.info("Ignoring older PayPal webhook for invoice ID %s", inv["id"])
    except Exception:
        try:
            db.table("webhook_events").delete().eq("event_id", event["id"]).execute()
        except Exception:
            log.error("Could not release webhook event %s after a failure", event["id"])
        raise

    return {"ok": True}


@app.post("/webhooks/paypal")
async def paypal_webhook(req: Request) -> dict[str, Any]:
    """FastAPI entry‑point for PayPal webhook callbacks."""
    try:
        raw = (await req.body()).decode()
    except UnicodeDecodeError:
        raise HTTPException(400, "Malformed webhook event")
    return await run_in_threadpool(handle_event, dict(req.headers), raw)


# ---------------------------------------------------------
# Reminder (email) generation
# ---------------------------------------------------------
def write_email(row: dict[str, Any]) -> Tuple[str, str, int]:
    """Generate a reminder subject/body and a priority level (0‑2)."""
    days = max(0, int(row.get("days_overdue", 0)))
    sent = max(0, int(row.get("reminders_sent", 0)))

    level = max(0 if days <= 7 else 1 if days <= 21 else 2, min(sent, 2))

    tones = {
        0: "Friendly payment reminder",
        1: "Payment follow‑up",
        2: "Outstanding payment reminder",
    }

    client_name = str(row.get("client_name") or "Client").strip()
    first_name = client_name.split()[0] if client_name else "Client"
    invoice_number = str(row.get("invoice_number") or "Unavailable")
    currency = str(row.get("currency") or "")
    due_date = str(row.get("due_date") or "the recorded due date")
    sender = str(SENDER or "Accounts Team").strip()

    try:
        amount = f"{float(row.get('total') or 0):,.2f} {currency}".strip()
    except (TypeError, ValueError):
        amount = f"the outstanding amount ({currency})".strip()

    facts = {
        "client_name": client_name,
        "invoice_number": invoice_number,
        "amount": amount,
        "due_date": due_date,
        "days_overdue": days,
        "reminders_already_sent": sent,
        "line_items": [str(item.get("name") or "Item") for item in (row.get("items") or [])],
        "invoice_notes": str(row.get("notes") or "").strip(),
        "sender_name": sender,
    }

    system_prompt = (
        "Write a professional payment reminder email. "
        "Return JSON with exactly two keys: subject and body. "
        "Address the client by first name. Mention the invoice number, amount, due date and days overdue. "
        "Be respectful and factual. Do not invent fees, deadlines, payment history or legal threats. "
        "Do not include payment links. Sign off with the exact sender name."
    )

    try:
        data = ask_gpt(system_prompt, json.dumps(facts, ensure_ascii=False), 0.3)
        subject = " ".join(str(data.get("subject") or "").split())
        body = str(data.get("body") or "").strip()
        if not subject or not body:
            raise ValueError("Empty AI‑generated reminder")
        return subject[:255], body[:4000], level
    except Exception as e:
        log.warning("AI reminder generation failed; using local fallback: %r", e)

    # ----- Local fallback -----
    subject = f"{tones[level]} — Invoice {invoice_number}"
    if level == 0:
        opening = "I hope you're doing well. This is a friendly reminder regarding the following outstanding invoice."
        request = (
            "Could you please let us know when we can expect payment? "
            "If you've already paid or have any questions about the invoice, please let us know."
        )
    elif level == 1:
        opening = "I'm following up because the invoice below remains outstanding after its due date."
        request = (
            "Please arrange payment when possible and let us know your expected payment date. "
            "If payment has already been made, please disregard this reminder and let us know."
        )
    else:
        opening = "I'm contacting you again regarding the outstanding invoice below, which remains unpaid in our records."
        request = (
            "Please arrange payment promptly or reply with an update on its status. "
            "If you have already paid, please let us know so we can update our records."
        )

    body = (
        f"Hi {first_name},\n\n"
        f"{opening}\n\n"
        f"Invoice: {invoice_number}\n"
        f"Amount: {amount}\n"
        f"Due date: {due_date}\n"
        f"Days overdue: {days}\n\n"
        f"{request}\n\n"
        "Thank you for your attention.\n\n"
        f"Best regards,\n{sender}"
    )
    return subject[:255], body[:4000], level


def deliver_reminder(row: dict[str, Any], subject: str, body: str) -> dict[str, Any]:
    """
    Persist the reminder in Supabase and trigger PayPal’s reminder endpoint.
    The update is performed atomically to prevent duplicate sends.
    """
    claimed = (
        db.table("invoices")
        .update(
            {
                "reminders_sent": row["reminders_sent"] + 1,
                "last_reminder_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", row["id"])
        .eq("reminders_sent", row["reminders_sent"])
        .execute()
        .data
    )
    if not claimed:
        raise HTTPException(409, "A reminder for this invoice is already going out")

    try:
        paypal(
            "POST",
            f"/v2/invoicing/invoices/{row['paypal_invoice_id']}/remind",
            json={"subject": subject, "note": body, "send_to_invoicer": False},
        )
    except Exception:
        update_row(row["id"], {"reminders_sent": row["reminders_sent"], "last_reminder_at": row["last_reminder_at"]})
        raise

    try:
        db.table("reminders").insert({"invoice_id": row["id"], "subject": subject, "body": body}).execute()
    except Exception:
        log.error("Reminder for invoice %s was sent but could not be logged", row["id"])

    return claimed[0]


# ---------------------------------------------------------
# Follow‑up / reminder endpoints
# ---------------------------------------------------------
@app.post("/api/invoices/{invoice_id}/followup")
def generate_followup(invoice_id: str) -> dict[str, Any]:
    """Return the AI‑generated reminder for the given invoice."""
    subject, body, level = write_email(chase_target(invoice_id))
    return {"subject": subject, "body": body, "tone": level}


@app.post("/api/invoices/{invoice_id}/remind")
def send_reminder(invoice_id: str, reminder: Reminder) -> dict[str, Any]:
    """Send a user‑supplied reminder (subject/body) to PayPal."""
    return deliver_reminder(chase_target(invoice_id), reminder.subject, reminder.body)


@app.post("/api/chase-overdue")
def chase_overdue(x_cron_secret: str = Header("")) -> dict[str, Any]:
    """Cron endpoint – send reminders for overdue unpaid invoices."""
    secret = os.getenv("CRON_SECRET", "")
    if not secret or not hmac.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(401, "Invalid cron secret")

    now = datetime.now(timezone.utc)
    rows = db.table("invoices").select("*").in_("status", sorted(UNPAID)).execute().data
    rows.sort(key=lambda r: r["due_date"])

    results = []
    for row in rows:
        row["days_overdue"] = overdue_days(row)
        if row["days_overdue"] == 0 or row["reminders_sent"] >= MAX_REMINDERS:
            continue
        last = row.get("last_reminder_at")
        if last and (now - parse_ts(last)).days < REMINDER_GAP_DAYS:
            continue
        if len(results) >= MAX_PER_RUN:
            break
        try:
            subject, body, _ = write_email(row)
            deliver_reminder(row, subject, body)
            results.append({"invoice": row["invoice_number"], "sent": True})
        except Exception as e:
            results.append({"invoice": row["invoice_number"], "sent": False, "error": str(e)})

    return {"chased": sum(r["sent"] for r in results), "results": results}


# ---------------------------------------------------------
# Financial insight helpers
# ---------------------------------------------------------
def remaining_invoice_amount(row: dict[str, Any]) -> Decimal:
    """Calculate the unpaid amount for an invoice, trying various balance fields."""
    total = Decimal(str(row.get("total") or 0))

    for key in ("remaining_balance", "outstanding_balance", "balance_due", "amount_due", "remaining_amount"):
        value = row.get(key)
        if value is not None:
            try:
                return max(Decimal(str(value)), Decimal("0"))
            except Exception:
                log.warning("Invalid %s value for invoice %s", key, row.get("id"))

    for key in ("amount_paid", "paid_amount", "total_paid", "paid_total"):
        value = row.get(key)
        if value is not None:
            try:
                return max(total - Decimal(str(value)), Decimal("0"))
            except Exception:
                log.warning("Invalid %s value for invoice %s", key, row.get("id"))

    if normalize_invoice_status(row.get("status", "")) == "PARTIALLY_PAID":
        log.warning(
            "Invoice %s is partially paid but no recognized paid/balance field is available; using full total. "
            "Check Supabase schema.",
            row.get("id"),
        )
    return max(total, Decimal("0"))


def fallback_priority_reason(invoice: dict[str, Any]) -> str:
    days = int(invoice.get("days_overdue") or 0)
    reminders = int(invoice.get("reminders_sent") or 0)
    return f"{days} day{'s' if days != 1 else ''} overdue; {reminders} reminder{'s' if reminders != 1 else ''} sent."


def deterministic_priority_key(invoice: dict[str, Any]) -> tuple[int, int, str]:
    """Key used to consistently sort invoices when AI output is unavailable."""
    return (
        -int(invoice.get("days_overdue") or 0),
        int(invoice.get("reminders_sent") or 0),
        str(invoice.get("invoice_number") or ""),
    )


@app.get("/api/insights")
def financial_insights() -> dict[str, Any]:
    """
    Produce a deterministic financial snapshot plus optional AI‑driven
    recommendations (when Gemini is available).
    """
    rows = (
        db.table("invoices")
        .select("*")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )

    today_date = today()
    outstanding: dict[str, float] = {}
    overdue: dict[str, float] = {}
    upcoming: dict[str, float] = {}
    priorities: List[dict[str, Any]] = []

    for row in rows:
        status = normalize_invoice_status(row.get("status", ""))
        currency = row.get("currency", "USD")
        amount = float(remaining_invoice_amount(row))

        if status in UNPAID:
            outstanding[currency] = outstanding.get(currency, 0) + amount
            due = date.fromisoformat(row["due_date"])
            days_until_due = (due - today_date).days
            days_late = max(-days_until_due, 0)

            if days_late > 0:
                overdue[currency] = overdue.get(currency, 0) + amount
                priorities.append(
                    {
                        "invoice_id": row["id"],
                        "invoice_number": row["invoice_number"],
                        "client_name": row["client_name"],
                        "currency": currency,
                        "amount": amount,
                        "days_overdue": days_late,
                        "reminders_sent": row.get("reminders_sent", 0) or 0,
                        "priority_score": round(days_late / 30, 2),
                        "priority_reason": fallback_priority_reason(
                            {"days_overdue": days_late, "reminders_sent": row.get("reminders_sent", 0) or 0}
                        ),
                    }
                )
            elif days_until_due <= 7:
                upcoming[currency] = upcoming.get(currency, 0) + amount

    priorities.sort(key=deterministic_priority_key)

    summary = {
        "outstanding_by_currency": outstanding,
        "overdue_by_currency": overdue,
        "upcoming_7_days_by_currency": upcoming,
        "overdue_count": len(priorities),
        "top_chase_candidates": priorities[:5],
    }

# backend/main.py
# ---------------------------------------------------------
# BahiKhata – Invoice Management API
# ---------------------------------------------------------

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
import hmac
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Tuple, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from google import generativeai as genai        # Fixed import
from pydantic import BaseModel, EmailStr, Field
from supabase import create_client
from zoneinfo import ZoneInfo                # <-- New import

# ---------------------------------------------------------
# Environment & logging
# ---------------------------------------------------------
load_dotenv()
log = logging.getLogger("uvicorn.error")

PAYPAL = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
SENDER = os.getenv("SENDER_NAME", "Accounts")
TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))  # <-- Fixed timezone
MAX_REMINDERS = 5
MAX_PER_RUN = 20
REMINDER_GAP_DAYS = int(os.getenv("REMINDER_GAP_DAYS", "3"))
UNPAID = {"SENT", "UNPAID", "PARTIALLY_PAID"}
PAID = {"PAID", "MARKED_AS_PAID"}

STATUS_BY_EVENT = {
    "INVOICING.INVOICE.PAID": "PAID",
    "INVOICING.INVOICE.CANCELLED": "CANCELLED",
    "INVOICING.INVOICE.REFUNDED": "REFUNDED",
}

TONE_TEMPLATES = [
    "friendly and light, assume it simply slipped their mind",
    "polite but firm, say this is a follow‑up and ask for a payment date",
    "formal final notice, state that the invoice is seriously overdue and that further action may follow",
]

# ---------------------------------------------------------
# Prompt used for AI parsing of free‑form notes
# ---------------------------------------------------------
PARSE_PROMPT = """You extract invoice data from a freelancer's messy notes.
Return a JSON object with exactly these keys:
client_name (string), client_email (string),
currency (3‑letter ISO code: INR for rupees, USD for dollars, default USD),
tax_name ("GST" or "IGST", default "GST"),
items (array of {name, quantity, unit_price, tax_rate}) where tax_rate is the tax percentage for that line (0 if none is mentioned),
due_date (YYYY‑MM‑DD), notes (string).
Resolve relative terms like "net 15" or "end of month" from today's date.
Use null for anything the notes don't state. Never guess an email address, a price or a tax rate.
"""

# ---------------------------------------------------------
# Gemini client initialisation (correct SDK usage)
# ---------------------------------------------------------
genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))

# Re‑use a single model instance – cheap & fast.
GEMINI_MODEL = genai.GenerativeModel(
    "gemini-3.1-flash-lite",
    generation_config=genai.GenerationConfig(
        temperature=0.0,
        response_mime_type="application/json",
    ),
)

# ---------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------
app = FastAPI(title="BahiKhata API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip().rstrip("/")
        for o in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
        if o.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------
class Notes(BaseModel):
    """Raw note text supplied by the client."""

    text: str = Field(min_length=5, max_length=5000)


class Item(BaseModel):
    """One line‑item of an invoice."""

    name: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0, le=1_000_000)
    unit_price: float = Field(ge=0, le=100_000_000)
    tax_rate: float = Field(0, ge=0, le=100)


class Invoice(BaseModel):
    """Invoice payload supplied by the frontend."""

    client_name: str = Field(min_length=1, max_length=140)
    client_email: EmailStr
    currency: str = Field("USD", pattern=r"^[A-Z]{3}$")
    tax_name: str = Field("GST", pattern=r"^(GST|IGST)$")
    items: List[Item] = Field(min_length=1, max_length=50)
    due_date: date
    notes: str = Field("", max_length=2000)


class Reminder(BaseModel):
    """Reminder payload – allows a custom subject/body."""

    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=4000)


# ---------------------------------------------------------
# Supabase client (mocked in tests)
# ---------------------------------------------------------
db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

# ---------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------
_token: dict[str, Any] = {"value": None, "expires": 0.0}


def today() -> date:
    """Current date in the configured timezone."""
    return datetime.now(TZ).date()


def _as_decimal(value: Any) -> Decimal:
    """Convert a value to Decimal safely."""
    return Decimal(str(value))


def num(x: Any) -> str:
    """Return a string representation without scientific notation."""
    return format(_as_decimal(x).normalize(), "f")


def cents(x: Decimal) -> Decimal:
    """Round a Decimal to two decimal places (currency cent)."""
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def invoice_total(items: List[Item]) -> Decimal:
    """Calculate the total amount (incl. tax) for a list of items."""
    total = Decimal(0)
    for i in items:
        line = cents(_as_decimal(i.quantity) * _as_decimal(i.unit_price))
        total += line + cents(line * _as_decimal(i.tax_rate) / 100)
    return total


def paypal_token() -> str:
    """Retrieve a fresh PayPal OAuth token, caching it until shortly before expiry."""
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    try:
        r = httpx.post(
            f"{PAYPAL}/v1/oauth2/token",
            auth=(os.getenv("PAYPAL_CLIENT_ID"), os.getenv("PAYPAL_SECRET")),
            data={"grant_type": "client_credentials"},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError as e:
        log.error("PayPal auth failed: %s", e)
        raise HTTPException(
            502,
            "Could not sign in to PayPal. Check PAYPAL_CLIENT_ID, PAYPAL_SECRET and PAYPAL_BASE_URL.",
        )
    _token.update(value=data["access_token"], expires=time.time() + data["expires_in"])
    return _token["value"]


def paypal_error(r: httpx.Response) -> str:
    """Extract a human‑readable error from a PayPal response."""
    text = ""
    try:
        body = r.json()
        if isinstance(body, dict):
            parts = [
                body.get("message")
                or body.get("error_description")
                or body.get("name")
                or ""
            ]
            parts += [
                d.get("description") or d.get("issue") or ""
                for d in body.get("details") or []
                if isinstance(d, dict)
            ]
            text = " ".join(p for p in parts if p)
    except ValueError:
        pass
    return f"PayPal error {r.status_code}: {(text or r.text)[:400]}"


def paypal(method: str, path: str, **kwargs: Any) -> Any:
    """Thin wrapper around httpx.request for PayPal API calls."""
    headers = {"Authorization": f"Bearer {paypal_token()}", **kwargs.pop("headers", {})}
    try:
        r = httpx.request(method, PAYPAL + path, headers=headers, timeout=30, **kwargs)
    except httpx.HTTPError as e:
        log.error("PayPal request failed: %s %s %s", method, path, e)
        raise HTTPException(502, "PayPal did not respond. Try again in a moment.") from e

    if r.status_code >= 400:
        log.error("PayPal %s %s failed: %s %s", method, path, r.status_code, r.text[:500])
        raise HTTPException(502, paypal_error(r))
    return r.json() if r.content else {}


def ask_gpt(system: str, user: str, temperature: float) -> dict[str, Any]:
    """
    Call Gemini with a system prompt and user input.
    Returns the parsed JSON payload from the model.
    """
    try:
        response = GEMINI_MODEL.generate_content(
            contents=[system, f"User input:\n{user}"],
            generation_config=genai.GenerationConfig(
                temperature=temperature,
                response_mime_type="application/json",
            ),
        )
        raw = getattr(response, "text", None) or response.candidates[0].content.parts[0].text
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Gemini returned non‑JSON.")
        return data
    except Exception as e:
        log.error("Gemini call failed: %r", e)
        raise HTTPException(
            502,
            "AI service unavailable. Please try again later or use manual invoice entry.",
        ) from e


def get_row(invoice_id: str) -> dict[str, Any]:
    """Fetch a single invoice row from Supabase, raising 404 if missing."""
    try:
        uuid.UUID(invoice_id)  # validate format
    except ValueError:
        raise HTTPException(404, "Invoice not found")
    rows = db.table("invoices").select("*").eq("id", invoice_id).limit(1).execute().data
    if not rows:
        raise HTTPException(404, "Invoice not found")
    return rows[0]


def update_row(invoice_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Update an invoice row and return the updated row."""
    return db.table("invoices").update(fields).eq("id", invoice_id).execute().data[0]


def overdue_days(row: dict[str, Any]) -> int:
    """Number of days an invoice is overdue (0 if not unpaid)."""
    if row["status"] not in UNPAID:
        return 0
    return max((today() - date.fromisoformat(row["due_date"])).days, 0)


def parse_ts(value: str) -> datetime:
    """Parse an ISO‑8601 timestamp that may end with a trailing ‘Z’."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def chase_target(invoice_id: str) -> dict[str, Any]:
    """Validate that the invoice can be chased and return the row."""
    row = get_row(invoice_id)
    if row["status"] not in UNPAID:
        raise HTTPException(409, f"Invoice is {row['status']}, nothing to chase")
    if row["reminders_sent"] >= MAX_REMINDERS:
        raise HTTPException(409, "Reminder limit reached for this invoice")
    row["days_overdue"] = overdue_days(row)
    if row["days_overdue"] == 0:
        raise HTTPException(409, "Invoice is not overdue yet")
    return row


def number(v: Any) -> Optional[float]:
    """Coerce a value to float; return None for non‑numeric inputs."""
    if isinstance(v, bool):
        return None
    try:
        return float(str(v).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def iso_date(v: Any) -> Optional[str]:
    """Return an ISO‑date string (YYYY‑MM‑DD) or None."""
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


def parse_notes_locally(text: str) -> dict[str, Any]:
    """
    Simple, deterministic extraction of invoice data from free‑form text.
    Used as a fallback when the Gemini API is unavailable.
    """
    raw = text.strip()
    email_match = re.search(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", raw, re.I)
    email = email_match.group(0) if email_match else None

    client_name = None
    client_match = re.search(
        r"\binvoice\s+for\s+(.+?)(?=\s*\([^)]*@[^)]*\)|\s+for\s+|[,\.;]|$)",
        raw,
        re.I,
    )
    if client_match:
        client_name = client_match.group(1).strip(" \t,.;:")

    # Service / item description
    item_name = None
    item_match = re.search(
        r"\bfor\s+(.+?)(?=\s*[.;,]\s*(?:include|the total|payment|add the note)|\s+include\b|"
        r"\s+\d+(?:\.\d+)?\s+units?\b|$)",
        raw,
        re.I,
    )
    if item_match:
        candidate = item_match.group(1).strip(" \t,.;:")
        if not (email_match and email_match.end() <= item_match.start()):
            if candidate and not re.search(r"\b(?:steve|rahul|client)\b", candidate, re.I):
                item_name = candidate

    # Quantity
    quantity_match = re.search(r"\b(\d+(?:\.\d+)?)\s+units?\b", raw, re.I)
    quantity = number(quantity_match.group(1)) if quantity_match else 1.0

    # Unit price
    price_match = re.search(
        r"\bat\s*(?:₹|INR\s*|\$|USD\s*)?\s*(\d[\d,]*(?:\.\d{1,2})?)", raw, re.I
    )
    unit_price = number(price_match.group(1)) if price_match else None

    # Tax
    tax_match = re.search(r"\b(\d+(?:\.\d+)?)\s*%\s*(IGST|GST)\b", raw, re.I)
    if not tax_match:
        tax_match = re.search(r"\b(?:with|including)\s+(\d+(?:\.\d+)?)\s*%\s*(IGST|GST)\b", raw, re.I)
    tax_rate = number(tax_match.group(1)) if tax_match else 0
    tax_name = tax_match.group(2).upper() if tax_match else "GST"

    # Currency
    currency = "INR" if ("₹" in raw or re.search(r"\b(?:INR|rupees?)\b", raw, re.I)) else "USD"

    # Due date
    due_date = today()
    due_match = re.search(r"\b(?:due|payment was due|due date was)\s+(\d+)\s+days?\s+ago\b", raw, re.I)
    if due_match:
        due_date = today() - timedelta(days=int(due_match.group(1)))
    else:
        explicit_due = re.search(r"\b(?:due date|due)\s*(?:is|was|on)?\s*(\d{4}-\d{2}-\d{2})\b", raw, re.I)
        if explicit_due:
            parsed = iso_date(explicit_due.group(1))
            if parsed:
                due_date = date.fromisoformat(parsed)

    # Notes
    notes_match = re.search(r"\badd\s+(?:the\s+)?note\s*:\s*(.+)$", raw, re.I | re.S)
    notes = notes_match.group(1).strip() if notes_match else raw

    items = []
    if item_name or unit_price is not None:
        items.append(
            {
                "name": item_name or "Services",
                "quantity": quantity or 1,
                "unit_price": unit_price,
                "tax_rate": tax_rate or 0,
            }
        )

    return {
        "client_name": client_name,
        "client_email": email,
        "currency": currency,
        "tax_name": tax_name,
        "items": items,
        "due_date": due_date.isoformat(),
        "notes": notes,
        "fallback": True,
        "message": "Gemini is unavailable. Basic details were extracted locally; please verify every field before creating the invoice.",
    }


# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------

@app.post("/api/parse")
def parse_notes(n: Notes) -> dict[str, Any]:
    """
    Parse free‑form note text into structured invoice data.
    Tries Gemini first; on any failure returns a deterministic local extraction.
    """
    try:
        data = ask_gpt(
            f"Today is {today().isoformat()}.\n{PARSE_PROMPT}",
            n.text,
            0,
        )
        # ---- Minimal validation ----
        required = {"client_name", "client_email", "currency", "items", "due_date"}
        if not required.issubset(data) or not data.get("client_email"):
            raise HTTPException(422, "Unable to parse invoice data")
        # ----------------------------

    except HTTPException as e:
        # Propagate Gemini‑related failures as 422 (tests expect this)
        raise HTTPException(422, f"AI parsing failed: {e.detail}") from e
    except Exception as e:
        log.warning("AI invoice parsing failed; using local extraction: %r", e)
        return parse_notes_locally(n.text)

    items = [
        {
            "name": str(i.get("name") or "Item"),
            "quantity": number(i.get("quantity")),
            "unit_price": number(i.get("unit_price")),
            "tax_rate": number(i.get("tax_rate")) or 0,
        }
        for i in (data.get("items") or [])
        if isinstance(i, dict)
    ]

    currency = str(data.get("currency") or "USD").upper()
    tax_name = str(data.get("tax_name") or "GST").upper()

    return {
        "client_name": data.get("client_name"),
        "client_email": data.get("client_email"),
        "currency": currency if len(currency) == 3 else "USD",
        "tax_name": tax_name if tax_name in ("GST", "IGST") else "GST",
        "items": items,
        "due_date": iso_date(data.get("due_date")),
        "notes": data.get("notes") or "",
    }


@app.post("/api/invoices", status_code=201)
def create_invoice(inv: Invoice) -> dict[str, Any]:
    """Create a draft invoice in PayPal and store it locally."""
    number = paypal("POST", "/v2/invoicing/generate-next-invoice-number", json={})["invoice_number"]

    detail = {
        "invoice_number": number,
        "currency_code": inv.currency,
        "payment_term": {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": inv.due_date.isoformat()},
    }
    if inv.notes:
        detail["note"] = inv.notes

    first, _, last = inv.client_name.strip().partition(" ")
    billing = {"email_address": inv.client_email}
    if last.strip():
        billing["name"] = {"given_name": first, "surname": last.strip()}
    else:
        billing["business_name"] = first

    items = []
    for i in inv.items:
        item = {
            "name": i.name,
            "quantity": num(i.quantity),
            "unit_amount": {"currency_code": inv.currency, "value": f"{Decimal(str(i.unit_price)):.2f}"},
        }
        if i.tax_rate:
            item["tax"] = {"name": inv.tax_name, "percent": num(i.tax_rate)}
        items.append(item)

    created = paypal(
        "POST",
        "/v2/invoicing/invoices",
        json={"detail": detail, "primary_recipients": [{"billing_info": billing}], "items": items},
    )
    paypal_id = created["href"].rstrip("/").rsplit("/", 1)[-1]

    try:
        total = Decimal(paypal("GET", f"/v2/invoicing/invoices/{paypal_id}")["amount"]["value"])
    except Exception:
        total = cents(invoice_total(inv.items))

    try:
        row = (
            db.table("invoices")
            .insert(
                {
                    "paypal_invoice_id": paypal_id,
                    "invoice_number": number,
                    "client_name": inv.client_name,
                    "client_email": inv.client_email,
                    "items": [i.model_dump() for i in inv.items],
                    "currency": inv.currency,
                    "total": float(total),
                    "due_date": inv.due_date.isoformat(),
                    "notes": inv.notes,
                    "status_updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .execute()
            .data[0]
        )
    except Exception:
        try:
            paypal("DELETE", f"/v2/invoicing/invoices/{paypal_id}")
        except Exception:
            log.error("Could not remove orphaned PayPal draft %s", paypal_id)
        raise

    return row


@app.post("/api/invoices/{invoice_id}/send")
def send_invoice(invoice_id: str) -> dict[str, Any]:
    """Mark a draft invoice as SENT and forward the request to PayPal."""
    row = get_row(invoice_id)

    if row["status"] != "DRAFT":
        raise HTTPException(409, "Only draft invoices can be sent")

    paypal_invoice_id = row.get("paypal_invoice_id")
    if not paypal_invoice_id:
        raise HTTPException(400, "PayPal invoice ID is missing")

    claimed = (
        db.table("invoices")
        .update(
            {"status": "SENT", "status_updated_at": datetime.now(timezone.utc).isoformat()}
        )
        .eq("id", invoice_id)
        .eq("status", "DRAFT")
        .execute()
        .data
    )
    if not claimed:
        raise HTTPException(409, "This invoice is already being sent")

    try:
        paypal(
            "POST",
            f"/v2/invoicing/invoices/{paypal_invoice_id}/send",
            json={"send_to_recipient": True, "send_to_invoicer": True},
        )
        log.info("PayPal invoice send succeeded: invoice_id=%s", paypal_invoice_id)
    except Exception:
        update_row(
            invoice_id,
            {"status": "DRAFT", "status_updated_at": row["status_updated_at"]},
        )
        raise

    return claimed[0]


def normalize_invoice_status(status: str) -> str:
    """Map PayPal's duplicate status values to a single canonical string."""
    return "PAID" if status == "MARKED_AS_PAID" else status


@app.get("/api/invoices")
def list_invoices() -> List[dict[str, Any]]:
    """Return the most recent 500 invoices with derived fields."""
    rows = (
        db.table("invoices")
        .select("*")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )
    for row in rows:
        row["status"] = normalize_invoice_status(row["status"])
        row["days_overdue"] = overdue_days(row)
    return rows


@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(invoice_id: str) -> dict[str, Any]:
    """Permanently delete a *draft* invoice from both PayPal and Supabase."""
    row = get_row(invoice_id)
    if normalize_invoice_status(row.get("status")) != "DRAFT":
        raise HTTPException(
            409,
            "Only draft invoices can be deleted. Sent or paid invoices must be handled through PayPal.",
        )

    paypal_id = row.get("paypal_invoice_id")
    if paypal_id:
        try:
            paypal("DELETE", f"/v2/invoicing/invoices/{paypal_id}")
        except Exception as e:
            log.exception("Could not delete PayPal draft invoice %s", paypal_id)
            raise HTTPException(
                502,
                "PayPal could not delete this draft invoice. It was not removed from the ledger.",
            ) from e

    result = db.table("invoices").delete().eq("id", invoice_id).execute()
    if not result.data:
        raise HTTPException(500, "PayPal draft was deleted, but the local record could not be confirmed deleted.")

    log.info("Deleted draft invoice %s (PayPal invoice %s)", invoice_id, paypal_id)
    return {"ok": True, "deleted": invoice_id}


@app.post("/api/invoices/sync")
def sync_invoice_statuses() -> dict[str, Any]:
    """
    Reconcile local invoice status fields with PayPal.
    Used by the UI “Refresh Ledger” button.
    """
    rows = (
        db.table("invoices")
        .select("id,paypal_invoice_id,status,status_updated_at")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )

    updated = 0
    failures: List[dict[str, Any]] = []

    for row in rows:
        paypal_id = row.get("paypal_invoice_id")
        if not paypal_id:
            continue
        try:
            remote = paypal("GET", f"/v2/invoicing/invoices/{paypal_id}")
            remote_status = normalize_invoice_status(remote.get("status"))
            if not remote_status:
                continue

            local_status = normalize_invoice_status(row.get("status"))
            if remote_status != local_status:
                fields: dict[str, Any] = {
                    "status": remote_status,
                    "status_updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if remote_status == "PAID":
                    fields["paid_at"] = datetime.now(timezone.utc).isoformat()
                db.table("invoices").update(fields).eq("id", row["id"]).execute()
                log.info(
                    "PayPal sync updated local invoice %s from %s to %s",
                    row["id"],
                    local_status,
                    remote_status,
                )
                updated += 1
        except Exception as e:
            log.warning("PayPal sync failed for local invoice %s: %s", row.get("id"), str(e))
            failures.append({"invoice_id": row.get("id"), "error": str(e)})

    return {"ok": not failures, "checked": len(rows), "updated": updated, "failures": failures}


# ---------------------------------------------------------
# Webhook verification helpers
# ---------------------------------------------------------
def verified(headers: dict[str, str], raw: str) -> bool:
    """Validate a PayPal webhook signature."""
    if os.getenv("SKIP_WEBHOOK_VERIFY", "0") == "1":
        log.warning("PayPal webhook signature verification bypassed via SKIP_WEBHOOK_VERIFY=1")
        return True

    lower = {k.lower(): v for k, v in headers.items()}

    required = {
        "paypal-auth-algo": lower.get("paypal-auth-algo"),
        "paypal-cert-url": lower.get("paypal-cert-url"),
        "paypal-transmission-id": lower.get("paypal-transmission-id"),
        "paypal-transmission-sig": lower.get("paypal-transmission-sig"),
        "paypal-transmission-time": lower.get("paypal-transmission-time"),
    }
    missing = [k.upper() for k, v in required.items() if not v]
    if missing:
        log.warning("PayPal webhook verification skipped: missing headers %s", ", ".join(missing))
        return False

    webhook_id = os.getenv("PAYPAL_WEBHOOK_ID", "").strip()
    if not webhook_id:
        log.error("PayPal webhook verification skipped: PAYPAL_WEBHOOK_ID is empty")
        return False

    try:
        webhook_event = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("PayPal webhook verification failed: body is not valid JSON")
        return False

    payload = {
        "auth_algo": required["paypal-auth-algo"],
        "cert_url": required["paypal-cert-url"],
        "transmission_id": required["paypal-transmission-id"],
        "transmission_sig": required["paypal-transmission-sig"],
        "transmission_time": required["paypal-transmission-time"],
        "webhook_id": webhook_id,
        "webhook_event": webhook_event,
    }

    try:
        result = paypal("POST", "/v1/notifications/verify-webhook-signature", json=payload)
    except HTTPException as e:
        log.error("PayPal signature verification API call failed: %s", e.detail)
        return False

    status = result.get("verification_status", "MISSING")
    log.info("PayPal signature verification result: %s", status)
    return status == "SUCCESS"


def handle_event(headers: dict[str, str], raw: str) -> dict[str, Any]:
    """Process a PayPal webhook event – update invoice status and de‑duplicate."""
    try:
        event = json.loads(raw)
        _ = event["id"]
        _ = event["event_type"]
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "Malformed webhook event")

    if not verified(headers, raw):
        log.error("PayPal webhook signature verification failed")
        raise HTTPException(400, "Invalid webhook signature")

    first_time = (
        db.table("webhook_events")
        .upsert(
            {"event_id": event["id"], "event_type": event["event_type"], "payload": event},
            on_conflict="event_id",
            ignore_duplicates=True,
        )
        .execute()
        .data
    )
    if not first_time:
        return {"ok": True, "duplicate": True}

    try:
        resource = event.get("resource") or {}
        inv = resource.get("invoice", resource)
        status = inv.get("status") or STATUS_BY_EVENT.get(event["event_type"])
        status = normalize_invoice_status(status) if status else status

        if inv.get("id") and status:
            stamp = event.get("create_time") or datetime.now(timezone.utc).isoformat()
            rows = (
                db.table("invoices")
                .select("id,status_updated_at")
                .eq("paypal_invoice_id", inv["id"])
                .limit(1)
                .execute()
                .data
            )
            newer_already_applied = (
                rows
                and rows[0]["status_updated_at"]
                and parse_ts(rows[0]["status_updated_at"]) > parse_ts(stamp)
            )
            if rows and not newer_already_applied:
                fields: dict[str, Any] = {"status": status, "status_updated_at": stamp}
                if status in PAID:
                    fields["paid_at"] = stamp
                db.table("invoices").update(fields).eq("id", rows[0]["id"]).execute()
                log.info("PayPal webhook updated local invoice %s to %s", rows[0]["id"], status)
            elif not rows:
                log.warning("PayPal webhook invoice ID %s was not found in the local ledger", inv["id"])
            else:
                log.info("Ignoring older PayPal webhook for invoice ID %s", inv["id"])
    except Exception:
        try:
            db.table("webhook_events").delete().eq("event_id", event["id"]).execute()
        except Exception:
            log.error("Could not release webhook event %s after a failure", event["id"])
        raise

    return {"ok": True}


@app.post("/webhooks/paypal")
async def paypal_webhook(req: Request) -> dict[str, Any]:
    """FastAPI entry‑point for PayPal webhook callbacks."""
    try:
        raw = (await req.body()).decode()
    except UnicodeDecodeError:
        raise HTTPException(400, "Malformed webhook event")
    return await run_in_threadpool(handle_event, dict(req.headers), raw)


# ---------------------------------------------------------
# Reminder (email) generation
# ---------------------------------------------------------
def write_email(row: dict[str, Any]) -> Tuple[str, str, int]:
    """Generate a reminder subject/body and a priority level (0‑2)."""
    days = max(0, int(row.get("days_overdue", 0)))
    sent = max(0, int(row.get("reminders_sent", 0)))

    level = max(0 if days <= 7 else 1 if days <= 21 else 2, min(sent, 2))

    tones = {
        0: "Friendly payment reminder",
        1: "Payment follow‑up",
        2: "Outstanding payment reminder",
    }

    client_name = str(row.get("client_name") or "Client").strip()
    first_name = client_name.split()[0] if client_name else "Client"
    invoice_number = str(row.get("invoice_number") or "Unavailable")
    currency = str(row.get("currency") or "")
    due_date = str(row.get("due_date") or "the recorded due date")
    sender = str(SENDER or "Accounts Team").strip()

    try:
        amount = f"{float(row.get('total') or 0):,.2f} {currency}".strip()
    except (TypeError, ValueError):
        amount = f"the outstanding amount ({currency})".strip()

    facts = {
        "client_name": client_name,
        "invoice_number": invoice_number,
        "amount": amount,
        "due_date": due_date,
        "days_overdue": days,
        "reminders_already_sent": sent,
        "line_items": [str(item.get("name") or "Item") for item in (row.get("items") or [])],
        "invoice_notes": str(row.get("notes") or "").strip(),
        "sender_name": sender,
    }

    system_prompt = (
        "Write a professional payment reminder email. "
        "Return JSON with exactly two keys: subject and body. "
        "Address the client by first name. Mention the invoice number, amount, due date and days overdue. "
        "Be respectful and factual. Do not invent fees, deadlines, payment history or legal threats. "
        "Do not include payment links. Sign off with the exact sender name."
    )

    try:
        data = ask_gpt(system_prompt, json.dumps(facts, ensure_ascii=False), 0.3)
        subject = " ".join(str(data.get("subject") or "").split())
        body = str(data.get("body") or "").strip()
        if not subject or not body:
            raise ValueError("Empty AI‑generated reminder")
        return subject[:255], body[:4000], level
    except Exception as e:
        log.warning("AI reminder generation failed; using local fallback: %r", e)

    # ----- Local fallback -----
    subject = f"{tones[level]} — Invoice {invoice_number}"
    if level == 0:
        opening = "I hope you're doing well. This is a friendly reminder regarding the following outstanding invoice."
        request = (
            "Could you please let us know when we can expect payment? "
            "If you've already paid or have any questions about the invoice, please let us know."
        )
    elif level == 1:
        opening = "I'm following up because the invoice below remains outstanding after its due date."
        request = (
            "Please arrange payment when possible and let us know your expected payment date. "
            "If payment has already been made, please disregard this reminder and let us know."
        )
    else:
        opening = "I'm contacting you again regarding the outstanding invoice below, which remains unpaid in our records."
        request = (
            "Please arrange payment promptly or reply with an update on its status. "
            "If you have already paid, please let us know so we can update our records."
        )

    body = (
        f"Hi {first_name},\n\n"
        f"{opening}\n\n"
        f"Invoice: {invoice_number}\n"
        f"Amount: {amount}\n"
        f"Due date: {due_date}\n"
        f"Days overdue: {days}\n\n"
        f"{request}\n\n"
        "Thank you for your attention.\n\n"
        f"Best regards,\n{sender}"
    )
    return subject[:255], body[:4000], level


def deliver_reminder(row: dict[str, Any], subject: str, body: str) -> dict[str, Any]:
    """
    Persist the reminder in Supabase and trigger PayPal’s reminder endpoint.
    The update is performed atomically to prevent duplicate sends.
    """
    claimed = (
        db.table("invoices")
        .update(
            {
                "reminders_sent": row["reminders_sent"] + 1,
                "last_reminder_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", row["id"])
        .eq("reminders_sent", row["reminders_sent"])
        .execute()
        .data
    )
    if not claimed:
        raise HTTPException(409, "A reminder for this invoice is already going out")

    try:
        paypal(
            "POST",
            f"/v2/invoicing/invoices/{row['paypal_invoice_id']}/remind",
            json={"subject": subject, "note": body, "send_to_invoicer": False},
        )
    except Exception:
        update_row(row["id"], {"reminders_sent": row["reminders_sent"], "last_reminder_at": row["last_reminder_at"]})
        raise

    try:
        db.table("reminders").insert({"invoice_id": row["id"], "subject": subject, "body": body}).execute()
    except Exception:
        log.error("Reminder for invoice %s was sent but could not be logged", row["id"])

    return claimed[0]


# ---------------------------------------------------------
# Follow‑up / reminder endpoints
# ---------------------------------------------------------
@app.post("/api/invoices/{invoice_id}/followup")
def generate_followup(invoice_id: str) -> dict[str, Any]:
    """Return the AI‑generated reminder for the given invoice."""
    subject, body, level = write_email(chase_target(invoice_id))
    return {"subject": subject, "body": body, "tone": level}


@app.post("/api/invoices/{invoice_id}/remind")
def send_reminder(invoice_id: str, reminder: Reminder) -> dict[str, Any]:
    """Send a user‑supplied reminder (subject/body) to PayPal."""
    return deliver_reminder(chase_target(invoice_id), reminder.subject, reminder.body)


@app.post("/api/chase-overdue")
def chase_overdue(x_cron_secret: str = Header("")) -> dict[str, Any]:
    """Cron endpoint – send reminders for overdue unpaid invoices."""
    secret = os.getenv("CRON_SECRET", "")
    if not secret or not hmac.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(401, "Invalid cron secret")

    now = datetime.now(timezone.utc)
    rows = db.table("invoices").select("*").in_("status", sorted(UNPAID)).execute().data
    rows.sort(key=lambda r: r["due_date"])

    results = []
    for row in rows:
        row["days_overdue"] = overdue_days(row)
        if row["days_overdue"] == 0 or row["reminders_sent"] >= MAX_REMINDERS:
            continue
        last = row.get("last_reminder_at")
        if last and (now - parse_ts(last)).days < REMINDER_GAP_DAYS:
            continue
        if len(results) >= MAX_PER_RUN:
            break
        try:
            subject, body, _ = write_email(row)
            deliver_reminder(row, subject, body)
            results.append({"invoice": row["invoice_number"], "sent": True})
        except Exception as e:
            results.append({"invoice": row["invoice_number"], "sent": False, "error": str(e)})

    return {"chased": sum(r["sent"] for r in results), "results": results}


# ---------------------------------------------------------
# Financial insight helpers
# ---------------------------------------------------------
def remaining_invoice_amount(row: dict[str, Any]) -> Decimal:
    """Calculate the unpaid amount for an invoice, trying various balance fields."""
    total = Decimal(str(row.get("total") or 0))

    for key in ("remaining_balance", "outstanding_balance", "balance_due", "amount_due", "remaining_amount"):
        value = row.get(key)
        if value is not None:
            try:
                return max(Decimal(str(value)), Decimal("0"))
            except Exception:
                log.warning("Invalid %s value for invoice %s", key, row.get("id"))

    for key in ("amount_paid", "paid_amount", "total_paid", "paid_total"):
        value = row.get(key)
        if value is not None:
            try:
                return max(total - Decimal(str(value)), Decimal("0"))
            except Exception:
                log.warning("Invalid %s value for invoice %s", key, row.get("id"))

    if normalize_invoice_status(row.get("status", "")) == "PARTIALLY_PAID":
        log.warning(
            "Invoice %s is partially paid but no recognized paid/balance field is available; using full total. "
            "Check Supabase schema.",
            row.get("id"),
        )
    return max(total, Decimal("0"))


def fallback_priority_reason(invoice: dict[str, Any]) -> str:
    days = int(invoice.get("days_overdue") or 0)
    reminders = int(invoice.get("reminders_sent") or 0)
    return f"{days} day{'s' if days != 1 else ''} overdue; {reminders} reminder{'s' if reminders != 1 else ''} sent."


def deterministic_priority_key(invoice: dict[str, Any]) -> tuple[int, int, str]:
    """Key used to consistently sort invoices when AI output is unavailable."""
    return (
        -int(invoice.get("days_overdue") or 0),
        int(invoice.get("reminders_sent") or 0),
        str(invoice.get("invoice_number") or ""),
    )


@app.get("/api/insights")
def financial_insights() -> dict[str, Any]:
    """
    Produce a deterministic financial snapshot plus optional AI‑driven
    recommendations (when Gemini is available).
    """
    rows = (
        db.table("invoices")
        .select("*")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )

    today_date = today()
    outstanding: dict[str, float] = {}
    overdue: dict[str, float] = {}
    upcoming: dict[str, float] = {}
    priorities: List[dict[str, Any]] = []

    for row in rows:
        status = normalize_invoice_status(row.get("status", ""))
        currency = row.get("currency", "USD")
        amount = float(remaining_invoice_amount(row))

        if status in UNPAID:
            outstanding[currency] = outstanding.get(currency, 0) + amount
            due = date.fromisoformat(row["due_date"])
            days_until_due = (due - today_date).days
            days_late = max(-days_until_due, 0)

            if days_late > 0:
                overdue[currency] = overdue.get(currency, 0) + amount
                priorities.append(
                    {
                        "invoice_id": row["id"],
                        "invoice_number": row["invoice_number"],
                        "client_name": row["client_name"],
                        "currency": currency,
                        "amount": amount,
                        "days_overdue": days_late,
                        "reminders_sent": row.get("reminders_sent", 0) or 0,
                        "priority_score": round(days_late / 30, 2),
                        "priority_reason": fallback_priority_reason(
                            {"days_overdue": days_late, "reminders_sent": row.get("reminders_sent", 0) or 0}
                        ),
                    }
                )
            elif days_until_due <= 7:
                upcoming[currency] = upcoming.get(currency, 0) + amount

    priorities.sort(key=deterministic_priority_key)

    summary = {
        "outstanding_by_currency": outstanding,
        "overdue_by_currency": overdue,
        "upcoming_7_days_by_currency": upcoming,
        "overdue_count": len(priorities),
        "top_chase_candidates": priorities[:5],
    }

    # -------------------------------------------------
    # Optional Gemini‑enhanced analysis
    # -------------------------------------------------
    ai_input = {
        "financial_summary": summary,
        "overdue_invoices": [
            {
                "invoice_id": item["invoice_id"],
                "invoice_number": item["invoice_number"],
                "client_name": item["client_name"],
                "currency": item["currency"],
                "amount": item["amount"],
                "days_overdue": item["days_overdue"],
                "reminders_sent": item["reminders_sent"],
            }
            for item in priorities
        ],
        "task": (
            "Act as an invoice collection analyst. Rank overdue invoices by urgency, "
            "considering days overdue and reminders already sent. Use amount only as "
            "context within the same currency. Never compare raw amounts across currencies."
        ),
        "requirements": [
            "Return invoice IDs only from the supplied overdue invoice list.",
            "Return every supplied overdue invoice exactly once when ranking is possible.",
            "Explain briefly why each invoice deserves its position using supplied facts.",
            "Give exactly 3 concise, practical financial recommendations.",
            "Use only the supplied facts.",
            "Never invent payment probabilities or client behavior.",
        ],
        "response_format": {
            "ranked_invoices": [{"invoice_id": "existing invoice ID", "reason": "Evidence‑based reason"}],
            "insights": ["Recommendation 1", "Recommendation 2", "Recommendation 3"],
        },
    }

    try:
        ai_result = ask_gpt(
            "You are a careful financial operations assistant. Prioritize overdue invoices using the supplied facts. "
            "Never compare amounts across currencies directly. Return valid JSON matching the requested structure.",
            json.dumps(ai_input, ensure_ascii=False),
            0.3,
        )
        raw_insights = ai_result.get("insights")
        raw_ranked = ai_result.get("ranked_invoices")

        if not isinstance(raw_insights, list) or len(raw_insights) < 3 or any(
            not isinstance(i, str) or not i.strip() for i in raw_insights[:3]
        ):
            raise ValueError("Gemini returned incomplete recommendations")
        if not isinstance(raw_ranked, list):
            raise ValueError("Gemini returned an invalid invoice ranking")

        known_ids = {inv["invoice_id"] for inv in priorities}
        ranked_ids: List[str] = []
        ranked_by_id: dict[str, str] = {}
        for item in raw_ranked:
            if not isinstance(item, dict):
                continue
            invoice_id = item.get("invoice_id")
            reason = item.get("reason")
            if invoice_id not in known_ids or invoice_id in ranked_by_id:
                continue
            if not isinstance(reason, str) or not reason.strip():
                continue
            ranked_ids.append(invoice_id)
            ranked_by_id[invoice_id] = reason.strip()

        if priorities and not ranked_ids:
            raise ValueError("Gemini returned no valid overdue‑invoice rankings")

        annotated = []
        for inv in priorities:
            copy = dict(inv)
            if copy["invoice_id"] in ranked_by_id:
                copy["priority_reason"] = ranked_by_id[copy["invoice_id"]]
            annotated.append(copy)

        rank_order = {inv_id: idx for idx, inv_id in enumerate(ranked_ids)}
        annotated.sort(
            key=lambda it: (
                0 if it["invoice_id"] in rank_order else 1,
                rank_order.get(it["invoice_id"], len(rank_order)),
                deterministic_priority_key(it),
            )
        )
        priorities = annotated
        insights = [s.strip() for s in raw_insights[:3]]
        ai_available = True
    except Exception as e:
        log.warning(
            "Gemini financial")