"""
BahiKhata Backend Configuration & Environment Variables
Initializes global settings, timezone, limits, and third-party API clients.
"""

import logging
import os
import uuid
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from google import genai
import supabase

# Load environment file without overriding existing environment (preserves test mocks)
env_file = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(env_file, override=False) if os.path.exists(env_file) else load_dotenv(override=False)

log = logging.getLogger("uvicorn.error")

# Core Constants
PAYPAL = os.getenv("PAYPAL_BASE_URL", "https://api-m.sandbox.paypal.com")
SENDER = os.getenv("SENDER_NAME", "Accounts")
TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))

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

TONES = [
    "friendly and light, assume it simply slipped their mind",
    "polite but firm, say this is a follow-up and ask for a payment date",
    "formal final notice, state that the invoice is seriously overdue and that further action may follow",
]

PARSE_PROMPT = """You extract invoice data from a freelancer's messy notes.
Return a JSON object with exactly these keys:
client_name (string), client_email (string),
currency (3-letter ISO code: INR for rupees, USD for dollars, default USD),
tax_name ("GST" or "IGST", default "GST"),
items (array of {name, quantity, unit_price, tax_rate}) where tax_rate is the tax percentage for that line (0 if none is mentioned),
due_date (YYYY-MM-DD), notes (string).
Resolve relative terms like "net 15" or "end of month" from today's date.
Use null for anything the notes don't state. Never guess an email address, a price or a tax rate."""

# API Clients
ai = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", "dummy_key"))
db = supabase.create_client(
    os.environ.get("SUPABASE_URL", "http://localhost:54321"),
    os.environ.get("SUPABASE_SERVICE_KEY", "dummy_key")
)

DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"
DEMO_BUSINESS_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"bahikhata.business.{DEMO_USER_ID}"))

_SCHEMA_CACHE = {
    "has_businesses_table": True,
    "has_invoices_bid": True,
    "businesses_checked_at": 0.0,
    "invoices_bid_checked_at": 0.0,
}
_INSIGHTS_CACHE = {}
