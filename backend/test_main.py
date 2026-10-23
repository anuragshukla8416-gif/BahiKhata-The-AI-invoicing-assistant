import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

_NOW = datetime.now(timezone.utc)
T0 = (_NOW + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
T1 = (_NOW + timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ')

os.environ.update(
    OPENAI_API_KEY="x",
    SUPABASE_URL="http://x",
    SUPABASE_SERVICE_KEY="x",
    PAYPAL_CLIENT_ID="id",
    PAYPAL_SECRET="secret",
    PAYPAL_WEBHOOK_ID="WH-ID",
    CRON_SECRET="cron-pass",
    SENDER_NAME="Yash",
    FRONTEND_ORIGIN="https://bahikhata.example/",
)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json

import openai
import supabase

STORE = {}


class Query:
    def __init__(self, name):
        self.name = name
        self.rows = STORE.setdefault(name, [])
        self.filters = []
        self.op = "select"

    def select(self, cols="*"):
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def delete(self):
        self.op = "delete"
        return self

    def upsert(self, row, on_conflict=None, ignore_duplicates=False):
        self.op, self.payload, self.key = "upsert", row, on_conflict
        return self

    def eq(self, k, v):
        if k == "id":
            uuid.UUID(str(v))  # Postgres rejects a malformed uuid with an error, it does not return no rows
        self.filters.append(lambda r: r.get(k) == v)
        return self

    def in_(self, k, vs):
        self.filters.append(lambda r: r.get(k) in vs)
        return self

    def order(self, k, desc=False):
        self.order_by = (k, desc)
        return self

    def limit(self, n):
        self.max = n
        return self

    def match(self):
        return [r for r in self.rows if all(f(r) for f in self.filters)]

    def execute(self):
        if self.op == "select":
            out = [dict(r) for r in self.match()]
            if hasattr(self, "order_by"):
                out.sort(key=lambda r: r[self.order_by[0]], reverse=self.order_by[1])
            return SimpleNamespace(data=out[: getattr(self, "max", None)])
        if self.op in ("insert", "upsert"):
            row = dict(self.payload)
            if self.op == "upsert" and any(r[self.key] == row[self.key] for r in self.rows):
                return SimpleNamespace(data=[])
            if self.name == "invoices":
                row.setdefault("id", str(uuid.uuid4()))
                row.setdefault("status", "DRAFT")
                row.setdefault("reminders_sent", 0)
                row.setdefault("last_reminder_at", None)
                row.setdefault("paid_at", None)
                row.setdefault("status_updated_at", None)
                row.setdefault("notes", "")
                row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            self.rows.append(row)
            return SimpleNamespace(data=[dict(row)])
        if self.op == "update":
            hit = self.match()
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in hit])
        if self.op == "delete":
            for r in self.match():
                self.rows.remove(r)
            return SimpleNamespace(data=[])


class FakeDB:
    def table(self, name):
        return Query(name)


supabase.create_client = lambda *a, **k: FakeDB()

CHAT_CALLS = []
CHAT = {"override": None}


class FakeChat:
    def create(self, **kw):
        CHAT_CALLS.append(kw)
        if CHAT["override"]:
            return CHAT["override"](kw)
        system = kw["messages"][0]["content"]
        if "extract invoice" in system:
            out = {
                "client_name": "Sara Khan",
                "client_email": "sara@acme.com",
                "currency": "USD",
                "items": [{"name": "Landing page", "quantity": 12, "unit_price": 60}],
                "due_date": "2026-11-01",
                "notes": "",
            }
        else:
            out = {"subject": "Invoice follow-up", "body": "Hi Sara, a quick nudge. Yash"}
        msg = SimpleNamespace(content=json.dumps(out))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


class FakeOpenAI:
    def __init__(self, *a, **k):
        self.chat = SimpleNamespace(completions=FakeChat())


openai.OpenAI = FakeOpenAI

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import json as _json  # noqa: E402

PP_CALLS = []
PP_RAW = []
PP = {"verify": "SUCCESS", "fail_remind_for": set(), "n": 0, "amount": None, "auth_fail": False, "timeout": False, "fail_send": False, "reject_create": False}


class Resp:
    def __init__(self, status=200, data=None):
        self.status_code = status
        self._data = data
        self.content = b"x" if data is not None else b""
        self.text = json.dumps(data)

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("bad", request=httpx.Request("POST", "http://x"), response=httpx.Response(self.status_code))


def fake_post(url, **kw):
    if PP["auth_fail"]:
        return Resp(401, {"error": "invalid_client"})
    return Resp(200, {"access_token": "tok", "expires_in": 3600})


def fake_request(method, url, headers=None, json=None, content=None, **kw):
    path = url.replace(main.PAYPAL, "")
    if PP["timeout"]:
        import httpx

        raise httpx.ConnectTimeout("slow")
    if content is not None:
        PP_RAW.append(content)
        assert headers["Content-Type"] == "application/json"
        json = _json.loads(content)
    PP_CALLS.append((method, path, json))
    assert headers["Authorization"] == "Bearer tok"
    if path.endswith("generate-next-invoice-number"):
        PP["n"] += 1
        return Resp(200, {"invoice_number": f"{PP['n']:04d}"})
    if method == "GET" and path.startswith("/v2/invoicing/invoices/"):
        if PP["amount"] is None:
            return Resp(404, {"name": "NOT_FOUND"})
        return Resp(200, {"amount": {"currency_code": "USD", "value": PP["amount"]}})
    if method == "DELETE":
        return Resp(204, None)
    if path == "/v2/invoicing/invoices" and PP["reject_create"]:
        return Resp(422, {"name": "UNPROCESSABLE_ENTITY", "message": "Business validation error", "details": [{"issue": "INVALID_DATE", "description": "Due date must be on or after the invoice date"}]})
    if path == "/v2/invoicing/invoices":
        return Resp(201, {"rel": "self", "href": f"{main.PAYPAL}/v2/invoicing/invoices/INV2-{PP['n']}", "method": "GET"})
    if path.endswith("/send"):
        return Resp(500, {"name": "INTERNAL"}) if PP["fail_send"] else Resp(202, {})
    if path.endswith("/remind"):
        if any(x in path for x in PP["fail_remind_for"]):
            return Resp(500, {"name": "INTERNAL"})
        return Resp(204, None)
    if path.endswith("verify-webhook-signature"):
        return Resp(200, {"verification_status": PP["verify"]})
    return Resp(404, {"name": "NOT_FOUND"})


main.httpx.post = fake_post
main.httpx.request = fake_request
client = TestClient(main.app)


@pytest.fixture(autouse=True)
def reset():
    STORE.clear()
    PP_CALLS.clear()
    PP_RAW.clear()
    CHAT_CALLS.clear()
    PP.update(verify="SUCCESS", fail_remind_for=set(), n=0, amount=None, auth_fail=False, timeout=False, fail_send=False, reject_create=False)
    CHAT["override"] = None
    main._token.update(value=None, expires=0.0)


def body(**over):
    data = {
        "client_name": "Sara Khan",
        "client_email": "sara@acme.com",
        "currency": "USD",
        "items": [{"name": "Landing page", "quantity": 12, "unit_price": 60}, {"name": "Hosting", "quantity": 1, "unit_price": 150}],
        "due_date": (main.today() + timedelta(days=14)).isoformat(),
        "notes": "Thanks!",
    }
    data.update(over)
    return data


def sent_invoice(days_late=0, **over):
    due = (main.today() - timedelta(days=days_late)).isoformat()
    inv = client.post("/api/invoices", json=body(due_date=due, **over)).json()
    return client.post(f"/api/invoices/{inv['id']}/send", json={}).json()


def event(eid, etype, pp_id, status=None, when=T1):
    inv = {"id": pp_id}
    if status:
        inv["status"] = status
    return {"id": eid, "event_type": etype, "create_time": when, "resource": {"invoice": inv}}


def test_parse():
    r = client.post("/api/parse", json={"text": "Built landing page for Sara"})
    assert r.status_code == 200 and r.json()["client_email"] == "sara@acme.com"
    assert CHAT_CALLS[0]["response_format"] == {"type": "json_object"}
    assert client.post("/api/parse", json={"text": "hi"}).status_code == 422


def test_create_invoice():
    r = client.post("/api/invoices", json=body())
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["total"] == 870.0 and row["status"] == "DRAFT" and row["invoice_number"] == "0001"
    assert row["paypal_invoice_id"] == "INV2-1"
    sent = [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices"][0][2]
    assert sent["detail"]["payment_term"]["term_type"] == "DUE_ON_DATE_SPECIFIED"
    assert sent["detail"]["note"] == "Thanks!"
    billing = sent["primary_recipients"][0]["billing_info"]
    assert billing["name"] == {"given_name": "Sara", "surname": "Khan"} and billing["email_address"] == "sara@acme.com"
    assert sent["items"][0] == {"name": "Landing page", "quantity": "12", "unit_amount": {"currency_code": "USD", "value": "60.00"}}


def test_create_single_word_client_and_no_note():
    client.post("/api/invoices", json=body(client_name="Acme", notes=""))
    sent = [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices"][0][2]
    assert sent["primary_recipients"][0]["billing_info"]["business_name"] == "Acme"
    assert "note" not in sent["detail"]


def test_create_validation():
    for bad in (body(client_email=None), body(client_email="nope"), body(items=[]), body(currency="usd"), body(due_date=None)):
        assert client.post("/api/invoices", json=bad).status_code == 422
    assert not [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices"]


def test_fractional_totals():
    row = client.post("/api/invoices", json=body(items=[{"name": "x", "quantity": 1.5, "unit_price": 19.99}])).json()
    assert row["total"] == 29.99


def test_send_once():
    row = sent_invoice()
    assert row["status"] == "SENT"
    assert client.post(f"/api/invoices/{row['id']}/send", json={}).status_code == 409
    assert client.post("/api/invoices/missing/send", json={}).status_code == 404


def test_list_overdue_days():
    late = sent_invoice(days_late=5)
    fresh = sent_invoice(days_late=-3)
    rows = {r["id"]: r for r in client.get("/api/invoices").json()}
    assert rows[late["id"]]["days_overdue"] == 5
    assert rows[fresh["id"]]["days_overdue"] == 0


def test_webhook_paid_and_dedupe():
    inv = sent_invoice(days_late=2)
    ev = event("WH-1", "INVOICING.INVOICE.PAID", inv["paypal_invoice_id"], "PAID")
    assert client.post("/webhooks/paypal", json=ev).json() == {"ok": True}
    row = client.get("/api/invoices").json()[0]
    assert row["status"] == "PAID" and row["paid_at"] == T1 and row["days_overdue"] == 0
    assert client.post("/webhooks/paypal", json=ev).json() == {"ok": True, "duplicate": True}
    verify = [c for c in PP_CALLS if c[1].endswith("verify-webhook-signature")][0][2]
    assert verify["webhook_id"] == "WH-ID" and verify["webhook_event"]["id"] == "WH-1"


def test_webhook_bad_signature():
    inv = sent_invoice()
    PP["verify"] = "FAILURE"
    r = client.post("/webhooks/paypal", json=event("WH-2", "INVOICING.INVOICE.PAID", inv["paypal_invoice_id"], "PAID"))
    assert r.status_code == 400
    assert client.get("/api/invoices").json()[0]["status"] == "SENT"
    assert not STORE.get("webhook_events")


def test_webhook_status_from_event_type_and_unknown_invoice():
    inv = sent_invoice()
    client.post("/webhooks/paypal", json=event("WH-3", "INVOICING.INVOICE.CANCELLED", inv["paypal_invoice_id"]))
    assert client.get("/api/invoices").json()[0]["status"] == "CANCELLED"
    r = client.post("/webhooks/paypal", json=event("WH-4", "INVOICING.INVOICE.PAID", "INV2-UNKNOWN", "PAID"))
    assert r.status_code == 200


def test_webhook_out_of_order_ignored():
    inv = sent_invoice()
    pid = inv["paypal_invoice_id"]
    client.post("/webhooks/paypal", json=event("WH-5", "INVOICING.INVOICE.PAID", pid, "PAID", T1))
    client.post("/webhooks/paypal", json=event("WH-6", "INVOICING.INVOICE.UPDATED", pid, "SENT", T0))
    assert client.get("/api/invoices").json()[0]["status"] == "PAID"


def test_webhook_raw_body_forwarded_untouched():
    inv = sent_invoice()
    raw = (
        '{"id":"WH-11",  "event_type":"INVOICING.INVOICE.PAID","create_time":"' + T1 + '",'
        '"summary":"Paid by Zoë","resource":{"invoice":{"id":"%s","status":"PAID"}}}' % inv["paypal_invoice_id"]
    )
    r = client.post("/webhooks/paypal", content=raw.encode(), headers={"content-type": "application/json"})
    assert r.json() == {"ok": True}
    assert raw in PP_RAW[-1] and PP_RAW[-1].endswith("}}")
    assert client.get("/api/invoices").json()[0]["status"] == "PAID"


def test_webhook_failure_allows_retry(monkeypatch):
    inv = sent_invoice()
    pid = inv["paypal_invoice_id"]
    client.post("/webhooks/paypal", json=event("WH-7", "INVOICING.INVOICE.UPDATED", pid, "SENT", T0))
    # a stored timestamp now exists, so the next event goes through parse_ts
    real = main.parse_ts
    monkeypatch.setattr(main, "parse_ts", lambda v: (_ for _ in ()).throw(RuntimeError("boom")))
    quiet = TestClient(main.app, raise_server_exceptions=False)
    ev = event("WH-8", "INVOICING.INVOICE.PAID", pid, "PAID", T1)
    assert quiet.post("/webhooks/paypal", json=ev).status_code == 500
    assert [e["event_id"] for e in STORE["webhook_events"]] == ["WH-7"]
    monkeypatch.setattr(main, "parse_ts", real)
    assert client.post("/webhooks/paypal", json=ev).json() == {"ok": True}
    assert client.get("/api/invoices").json()[0]["status"] == "PAID"


def test_followup_rules():
    fresh = sent_invoice(days_late=-2)
    assert client.post(f"/api/invoices/{fresh['id']}/followup", json={}).status_code == 409
    draft = client.post("/api/invoices", json=body()).json()
    assert client.post(f"/api/invoices/{draft['id']}/followup", json={}).status_code == 409


@pytest.mark.parametrize("days,tone", [(3, 0), (10, 1), (30, 2)])
def test_followup_tone_by_days(days, tone):
    inv = sent_invoice(days_late=days)
    r = client.post(f"/api/invoices/{inv['id']}/followup", json={})
    assert r.status_code == 200 and r.json()["tone"] == tone
    assert r.json()["subject"] and r.json()["body"]
    system = CHAT_CALLS[-1]["messages"][0]["content"]
    assert main.TONES[tone] in system and "Yash" in system
    facts = json.loads(CHAT_CALLS[-1]["messages"][1]["content"])
    assert facts["days_overdue"] == days and facts["amount"] == "870.00 USD"


def test_followup_escalates_with_reminders_sent():
    inv = sent_invoice(days_late=2)
    main.db.table("invoices").update({"reminders_sent": 2}).eq("id", inv["id"]).execute()
    assert client.post(f"/api/invoices/{inv['id']}/followup", json={}).json()["tone"] == 2


def test_remind_flow_and_cap():
    inv = sent_invoice(days_late=4)
    r = client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "Hi", "body": "Pay up"})
    assert r.status_code == 200 and r.json()["reminders_sent"] == 1 and r.json()["last_reminder_at"]
    call = [c for c in PP_CALLS if c[1].endswith("/remind")][0]
    assert call[2] == {"subject": "Hi", "note": "Pay up", "send_to_invoicer": False}
    assert len(STORE["reminders"]) == 1 and STORE["reminders"][0]["invoice_id"] == inv["id"]
    main.db.table("invoices").update({"reminders_sent": 5}).eq("id", inv["id"]).execute()
    assert client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "Hi", "body": "x"}).status_code == 409
    assert client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "", "body": "x"}).status_code == 422


def test_no_chasing_after_paid():
    inv = sent_invoice(days_late=4)
    client.post("/webhooks/paypal", json=event("WH-9", "INVOICING.INVOICE.PAID", inv["paypal_invoice_id"], "PAID"))
    assert client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "s", "body": "b"}).status_code == 409


def test_paypal_failure_leaves_state_untouched():
    inv = sent_invoice(days_late=4)
    PP["fail_remind_for"] = {inv["paypal_invoice_id"]}
    r = client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "s", "body": "b"})
    assert r.status_code == 502
    assert not STORE.get("reminders") and client.get("/api/invoices").json()[0]["reminders_sent"] == 0


def test_chase_overdue_auth():
    assert client.post("/api/chase-overdue").status_code == 401
    assert client.post("/api/chase-overdue", headers={"x-cron-secret": "wrong"}).status_code == 401
    os.environ["CRON_SECRET"] = ""
    try:
        assert client.post("/api/chase-overdue", headers={"x-cron-secret": ""}).status_code == 401
    finally:
        os.environ["CRON_SECRET"] = "cron-pass"


def test_chase_overdue_end_to_end():
    late = sent_invoice(days_late=6)
    later = sent_invoice(days_late=20)
    fresh = sent_invoice(days_late=-5)
    draft = client.post("/api/invoices", json=body(due_date="2020-01-01")).json()
    paid = sent_invoice(days_late=9)
    client.post("/webhooks/paypal", json=event("WH-10", "INVOICING.INVOICE.PAID", paid["paypal_invoice_id"], "PAID"))
    capped = sent_invoice(days_late=9)
    main.db.table("invoices").update({"reminders_sent": 5}).eq("id", capped["id"]).execute()
    PP["fail_remind_for"] = {later["paypal_invoice_id"]}

    h = {"x-cron-secret": "cron-pass"}
    out = client.post("/api/chase-overdue", headers=h).json()
    by = {r["invoice"]: r for r in out["results"]}
    assert out["chased"] == 1
    assert by[late["invoice_number"]]["sent"] is True
    assert by[later["invoice_number"]]["sent"] is False and "502" in by[later["invoice_number"]]["error"]
    assert len(out["results"]) == 2
    rows = {r["id"]: r for r in client.get("/api/invoices").json()}
    assert rows[late["id"]]["reminders_sent"] == 1
    for untouched in (fresh, draft, paid):
        assert rows[untouched["id"]]["reminders_sent"] == 0

    PP["fail_remind_for"] = set()
    again = client.post("/api/chase-overdue", headers=h).json()
    assert [r["invoice"] for r in again["results"]] == [later["invoice_number"]]

    old = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    main.db.table("invoices").update({"last_reminder_at": old}).eq("id", late["id"]).execute()
    third = client.post("/api/chase-overdue", headers=h).json()
    assert [r["invoice"] for r in third["results"]] == [late["invoice_number"]]


def fake_gpt(content=None, exc=None):
    def make(kw):
        if exc:
            raise exc
        msg = SimpleNamespace(content=content)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    return make


def test_tax_goes_to_paypal_and_total_fallback_includes_it():
    items = [
        {"name": "Landing page", "quantity": 12, "unit_price": 60, "tax_rate": 18},
        {"name": "Hosting", "quantity": 1, "unit_price": 150, "tax_rate": 18},
    ]
    row = client.post("/api/invoices", json=body(items=items, tax_name="IGST")).json()
    sent = [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices" and c[0] == "POST"][0][2]
    assert sent["items"][0]["tax"] == {"name": "IGST", "percent": "18"}
    assert row["total"] == 1026.6
    assert row["items"][0]["tax_rate"] == 18


def test_no_tax_object_when_rate_is_zero():
    client.post("/api/invoices", json=body())
    sent = [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices" and c[0] == "POST"][0][2]
    assert all("tax" not in i for i in sent["items"])


def test_total_comes_from_paypal_when_available():
    PP["amount"] = "1026.61"
    row = client.post("/api/invoices", json=body(items=[{"name": "x", "quantity": 1, "unit_price": 870, "tax_rate": 18}])).json()
    assert row["total"] == 1026.61


def test_tax_rate_and_name_validated():
    assert client.post("/api/invoices", json=body(tax_name="VAT")).status_code == 422
    bad = [{"name": "x", "quantity": 1, "unit_price": 1, "tax_rate": 120}]
    assert client.post("/api/invoices", json=body(items=bad)).status_code == 422


def test_large_quantity_not_in_scientific_notation():
    big = [{"name": "bulk", "quantity": 1000000, "unit_price": 1.5}]
    client.post("/api/invoices", json=body(items=big))
    sent = [c for c in PP_CALLS if c[1] == "/v2/invoicing/invoices" and c[0] == "POST"][0][2]
    assert sent["items"][0]["quantity"] == "1000000"
    assert sent["items"][0]["unit_amount"]["value"] == "1.50"


def test_orphan_paypal_draft_removed_when_db_insert_fails(monkeypatch):
    real = Query.execute

    def broken(self):
        if self.name == "invoices" and self.op == "insert":
            raise RuntimeError("db down")
        return real(self)

    monkeypatch.setattr(Query, "execute", broken)
    quiet = TestClient(main.app, raise_server_exceptions=False)
    assert quiet.post("/api/invoices", json=body()).status_code == 500
    assert ("DELETE", "/v2/invoicing/invoices/INV2-1", None) in PP_CALLS


def test_parse_normalizes_model_output():
    CHAT["override"] = fake_gpt(json.dumps({
        "client_name": "Meera", "client_email": None, "currency": "inr", "tax_name": "igst",
        "items": [{"name": "Logo", "quantity": 3, "unit_price": 8000}, "junk"], "due_date": None, "notes": None,
    }))
    out = client.post("/api/parse", json={"text": "logo for Meera"}).json()
    assert out["currency"] == "INR" and out["tax_name"] == "IGST" and out["notes"] == ""
    assert out["items"] == [{"name": "Logo", "quantity": 3, "unit_price": 8000, "tax_rate": 0}]
    assert out["client_email"] is None and out["due_date"] is None


def test_parse_defaults_when_model_omits_fields():
    CHAT["override"] = fake_gpt("{}")
    out = client.post("/api/parse", json={"text": "something vague"}).json()
    assert out["currency"] == "USD" and out["tax_name"] == "GST" and out["items"] == []


@pytest.mark.parametrize("override", [
    fake_gpt("not json"),
    fake_gpt(None),
    fake_gpt("[1, 2]"),
    fake_gpt(exc=__import__("openai").OpenAIError("quota")),
])
def test_ai_failures_become_502_not_500(override):
    CHAT["override"] = override
    r = client.post("/api/parse", json={"text": "some notes here"})
    assert r.status_code == 502 and "AI" in r.json()["detail"]
    assert "quota" not in r.text


def test_followup_ai_failure_and_empty_email():
    inv = sent_invoice(days_late=3)
    CHAT["override"] = fake_gpt(json.dumps({"subject": "", "body": "x"}))
    assert client.post(f"/api/invoices/{inv['id']}/followup", json={}).status_code == 502
    CHAT["override"] = fake_gpt(exc=__import__("openai").OpenAIError("boom"))
    assert client.post(f"/api/invoices/{inv['id']}/followup", json={}).status_code == 502


def test_overlong_ai_email_is_trimmed_to_fit_reminder_limits():
    inv = sent_invoice(days_late=3)
    CHAT["override"] = fake_gpt(json.dumps({"subject": "s" * 400, "body": "b" * 9000}))
    out = client.post(f"/api/invoices/{inv['id']}/followup", json={}).json()
    assert len(out["subject"]) == 255 and len(out["body"]) == 4000


def test_paypal_auth_failure_is_a_clear_502():
    PP["auth_fail"] = True
    r = client.post("/api/invoices", json=body())
    assert r.status_code == 502 and "sign in to PayPal" in r.json()["detail"]


def test_paypal_timeout_is_a_clear_502():
    PP["timeout"] = True
    main._token.update(value="tok", expires=9e12)
    r = client.post("/api/invoices", json=body())
    assert r.status_code == 502 and "did not respond" in r.json()["detail"]


def test_marked_as_paid_sets_paid_at_and_stops_chasing():
    inv = sent_invoice(days_late=3)
    client.post("/webhooks/paypal", json=event("WH-20", "INVOICING.INVOICE.UPDATED", inv["paypal_invoice_id"], "MARKED_AS_PAID"))
    row = client.get("/api/invoices").json()[0]
    assert row["status"] == "MARKED_AS_PAID" and row["paid_at"] == T1 and row["days_overdue"] == 0


@pytest.mark.parametrize("raw", ["not json", "{}", '{"id": "x"}', "[]", "null"])
def test_malformed_webhook_is_400(raw):
    r = client.post("/webhooks/paypal", content=raw.encode(), headers={"content-type": "application/json"})
    assert r.status_code == 400
    assert not [c for c in PP_CALLS if c[1].endswith("verify-webhook-signature")]


def test_non_utf8_webhook_is_400():
    r = client.post("/webhooks/paypal", content=b"\xff\xfe", headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_non_ascii_cron_secret_is_401_not_500():
    r = client.post("/api/chase-overdue", headers={"x-cron-secret": "pässword".encode("latin-1")})
    assert r.status_code == 401


def test_overdue_uses_app_timezone_date(monkeypatch):
    inv = client.post("/api/invoices", json=body(due_date="2026-10-15")).json()
    client.post(f"/api/invoices/{inv['id']}/send", json={})
    monkeypatch.setattr(main, "today", lambda: date(2026, 10, 20))
    assert client.get("/api/invoices").json()[0]["days_overdue"] == 5


def test_today_follows_india_not_utc(monkeypatch):
    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(main, "datetime", Frozen)
    assert main.today() == date(2026, 10, 18)


def test_bad_invoice_id_is_404_not_500():
    for action in ("send", "followup"):
        assert client.post(f"/api/invoices/not-a-uuid/{action}", json={}).status_code == 404
    assert client.post("/api/invoices/not-a-uuid/remind", json={"subject": "s", "body": "b"}).status_code == 404
    assert client.post("/api/invoices/12345/send", json={}).status_code == 404


def test_late_draft_event_cannot_revert_a_sent_invoice():
    inv = sent_invoice()
    earlier = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client.post("/webhooks/paypal", json=event("WH-30", "INVOICING.INVOICE.CREATED", inv["paypal_invoice_id"], "DRAFT", earlier))
    assert client.get("/api/invoices").json()[0]["status"] == "SENT"


def test_failed_send_returns_to_draft_and_can_be_retried():
    inv = client.post("/api/invoices", json=body()).json()
    PP["fail_send"] = True
    assert client.post(f"/api/invoices/{inv['id']}/send", json={}).status_code == 502
    row = client.get("/api/invoices").json()[0]
    assert row["status"] == "DRAFT"
    PP["fail_send"] = False
    assert client.post(f"/api/invoices/{inv['id']}/send", json={}).json()["status"] == "SENT"


def test_second_sender_loses_the_claim_and_paypal_is_not_called_twice(monkeypatch):
    inv = sent_invoice()
    monkeypatch.setattr(main, "get_row", lambda _id: dict(inv, status="DRAFT"))
    PP_CALLS.clear()
    r = client.post(f"/api/invoices/{inv['id']}/send", json={})
    assert r.status_code == 409
    assert not [c for c in PP_CALLS if c[1].endswith("/send")]


def test_second_reminder_loses_the_claim_and_client_is_emailed_once():
    inv = sent_invoice(days_late=4)
    snapshot = main.get_row(inv["id"])
    main.deliver_reminder(dict(snapshot), "first", "body")
    PP_CALLS.clear()
    with pytest.raises(main.HTTPException) as e:
        main.deliver_reminder(dict(snapshot), "second", "body")
    assert e.value.status_code == 409
    assert not [c for c in PP_CALLS if c[1].endswith("/remind")]
    row = client.get("/api/invoices").json()[0]
    assert row["reminders_sent"] == 1 and len(STORE["reminders"]) == 1


def test_failed_reminder_restores_count_and_timestamp():
    inv = sent_invoice(days_late=4)
    PP["fail_remind_for"] = {inv["paypal_invoice_id"]}
    assert client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "s", "body": "b"}).status_code == 502
    row = client.get("/api/invoices").json()[0]
    assert row["reminders_sent"] == 0 and row["last_reminder_at"] is None
    PP["fail_remind_for"] = set()
    assert client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "s", "body": "b"}).json()["reminders_sent"] == 1


def test_reminder_is_still_counted_if_only_the_log_write_fails(monkeypatch):
    inv = sent_invoice(days_late=4)
    real = main.db.table

    def table(name):
        if name == "reminders":
            raise RuntimeError("db down")
        return real(name)

    monkeypatch.setattr(main.db, "table", table)
    r = client.post(f"/api/invoices/{inv['id']}/remind", json={"subject": "s", "body": "b"})
    assert r.status_code == 200 and r.json()["reminders_sent"] == 1


def test_parse_cleans_percent_signs_thousands_and_bad_dates():
    CHAT["override"] = fake_gpt(json.dumps({
        "client_name": "Meera", "client_email": "m@x.in", "currency": "INR",
        "items": [{"name": "Logo", "quantity": "3", "unit_price": "1,200.50", "tax_rate": "18%"},
                  {"name": "Print", "quantity": True, "unit_price": "free", "tax_rate": None}],
        "due_date": "next friday", "notes": "",
    }))
    out = client.post("/api/parse", json={"text": "logo for Meera"}).json()
    assert out["items"][0] == {"name": "Logo", "quantity": 3.0, "unit_price": 1200.5, "tax_rate": 18.0}
    assert out["items"][1] == {"name": "Print", "quantity": None, "unit_price": None, "tax_rate": 0}
    assert out["due_date"] is None


def test_parse_keeps_valid_dates_and_trims_timestamps():
    CHAT["override"] = fake_gpt(json.dumps({"due_date": "2026-11-05T00:00:00Z", "items": []}))
    assert client.post("/api/parse", json={"text": "something here"}).json()["due_date"] == "2026-11-05"


def test_paypal_rejection_reads_like_a_sentence():
    PP["reject_create"] = True
    r = client.post("/api/invoices", json=body())
    assert r.status_code == 502
    text = r.json()["detail"]
    assert "Business validation error" in text and "Due date must be on or after the invoice date" in text
    assert "{" not in text


def test_each_run_chases_at_most_max_per_run_oldest_first(monkeypatch):
    monkeypatch.setattr(main, "MAX_PER_RUN", 2)
    newest = sent_invoice(days_late=3)
    oldest = sent_invoice(days_late=30)
    middle = sent_invoice(days_late=10)
    out = client.post("/api/chase-overdue", headers={"x-cron-secret": "cron-pass"}).json()
    assert [r["invoice"] for r in out["results"]] == [oldest["invoice_number"], middle["invoice_number"]]
    rows = {r["id"]: r for r in client.get("/api/invoices").json()}
    assert rows[newest["id"]]["reminders_sent"] == 0
    again = client.post("/api/chase-overdue", headers={"x-cron-secret": "cron-pass"}).json()
    assert [r["invoice"] for r in again["results"]] == [newest["invoice_number"]]


def test_frontend_origin_with_trailing_slash_still_passes_cors():
    r = client.options(
        "/api/invoices",
        headers={"Origin": "https://bahikhata.example", "Access-Control-Request-Method": "POST"},
    )
    assert r.headers.get("access-control-allow-origin") == "https://bahikhata.example"
    other = client.options("/api/invoices", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in other.headers
