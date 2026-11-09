import pytest
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)

def test_multitenant_scenario_isolation_and_flow():
    # 1. Simulate Tenant A
    user_a = {
        "id": "tenant-a-uuid-1111",
        "email": "owner_a@acmetech.com",
        "user_metadata": {
            "name": "Alice Adams",
            "business": "Acme Tech Services",
        }
    }
    token_a = "token-tenant-a"
    main.TEST_USERS[token_a] = user_a
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 2. Simulate Tenant B
    user_b = {
        "id": "tenant-b-uuid-2222",
        "email": "owner_b@globexcorp.com",
        "user_metadata": {
            "name": "Bob Builder",
            "business": "Globex Solutions",
        }
    }
    token_b = "token-tenant-b"
    main.TEST_USERS[token_b] = user_b
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Verify both tenants can fetch their initial profile
    res_a = client.get("/api/business/profile", headers=headers_a)
    assert res_a.status_code == 200, res_a.text
    prof_a = res_a.json()
    assert prof_a["business_name"] == "Acme Tech Services"

    res_b = client.get("/api/business/profile", headers=headers_b)
    assert res_b.status_code == 200, res_b.text
    prof_b = res_b.json()
    assert prof_b["business_name"] == "Globex Solutions"

    # Business IDs must be distinct
    assert prof_a["id"] != prof_b["id"]
    bid_a = prof_a["id"]
    bid_b = prof_b["id"]

    # 3. Tenant A updates business profile with valid GSTIN
    update_a = {
        "business_name": "Acme Tech Services Private Limited",
        "business_type": "Private Limited",
        "business_email": "billing@acmetech.com",
        "business_phone": "+91 98765 11111",
        "business_address": "Tech Park 4",
        "city": "Bengaluru",
        "state": "Karnataka",
        "postal_code": "560100",
        "gst_registered": True,
        "gstin": "29ABCDE1234F1Z5",
        "pan": "ABCDE1234F",
        "website": "https://acmetech.com",
    }
    put_a = client.put("/api/business/profile", json=update_a, headers=headers_a)
    assert put_a.status_code == 200, put_a.text
    assert put_a.json()["business_name"] == "Acme Tech Services Private Limited"
    assert put_a.json()["gstin"] == "29ABCDE1234F1Z5"

    # 4. GSTIN validation check: Invalid GSTIN must be rejected with 422
    bad_gst_update = {
        **update_a,
        "gst_registered": True,
        "gstin": "INVALID_GST_123",
    }
    bad_res = client.put("/api/business/profile", json=bad_gst_update, headers=headers_a)
    assert bad_res.status_code == 422
    assert "Invalid GSTIN" in bad_res.json()["detail"]

    # 5. Non-registered business should have gstin: null
    update_b = {
        "business_name": "Globex Solutions",
        "business_type": "Freelancer",
        "business_email": "bob@globexcorp.com",
        "business_phone": "+91 98765 22222",
        "business_address": "Home Office",
        "city": "Mumbai",
        "state": "Maharashtra",
        "postal_code": "400001",
        "gst_registered": False,
        "gstin": None,
    }
    put_b = client.put("/api/business/profile", json=update_b, headers=headers_b)
    assert put_b.status_code == 200, put_b.text
    assert put_b.json()["gst_registered"] is False
    assert put_b.json()["gstin"] is None

    # 6. Tenant B starts with clean workspace: 0 invoices
    invs_b = client.get("/api/invoices", headers=headers_b).json()
    assert len(invs_b) == 0, f"Tenant B should have 0 invoices, got {len(invs_b)}"

    # 7. Tenant A creates an invoice
    inv_payload_a = {
        "client_name": "MegaCorp",
        "client_email": "ap@megacorp.com",
        "currency": "USD",
        "items": [{"name": "Consulting", "quantity": 10, "unit_price": 50, "tax_rate": 18}],
        "due_date": "2026-11-20",
        "notes": "Thank you for partnering with Acme Tech",
    }
    create_res = client.post("/api/invoices", json=inv_payload_a, headers=headers_a)
    assert create_res.status_code == 201, create_res.text
    inv_a = create_res.json()
    inv_id_a = inv_a["id"]
    assert inv_a["business_id"] == bid_a

    # 8. Data Isolation check:
    # Tenant A sees 1 invoice
    invs_a = client.get("/api/invoices", headers=headers_a).json()
    assert any(i["id"] == inv_id_a for i in invs_a)

    # Tenant B STILL sees 0 invoices (strict isolation)
    invs_b_after = client.get("/api/invoices", headers=headers_b).json()
    assert len(invs_b_after) == 0
    assert not any(i["id"] == inv_id_a for i in invs_b_after)

    # Tenant B tries to directly fetch Tenant A's invoice: MUST BE REJECTED with 403 or 404
    cross_get = client.get(f"/api/invoices/{inv_id_a}", headers=headers_b)
    assert cross_get.status_code in (403, 404), f"Expected 403 or 404, got {cross_get.status_code}"

    # Tenant B tries to delete Tenant A's invoice: MUST BE REJECTED with 403 or 404
    cross_delete = client.delete(f"/api/invoices/{inv_id_a}", headers=headers_b)
    assert cross_delete.status_code in (403, 404), f"Expected 403 or 404, got {cross_delete.status_code}"

    # Tenant B tries to send reminder for Tenant A's invoice: MUST BE REJECTED with 403 or 404
    cross_followup = client.post(f"/api/invoices/{inv_id_a}/followup", json={}, headers=headers_b)
    assert cross_followup.status_code in (403, 404), f"Expected 403 or 404, got {cross_followup.status_code}"

    # 9. Tenant A creates customers
    cust_res = client.post("/api/customers", json={"name": "Client Alpha", "email": "alpha@example.com"}, headers=headers_a)
    assert cust_res.status_code in (200, 201), cust_res.text
    cust_a = cust_res.json()
    assert cust_a["business_id"] == bid_a

    # Tenant B fetches customers: sees only their own (0 customers)
    custs_b = client.get("/api/customers", headers=headers_b).json()
    assert len(custs_b) == 0

    print("All multi-tenant data isolation and onboarding tests passed successfully!")
