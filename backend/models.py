"""
BahiKhata Pydantic Data Models
Validates incoming request payloads and outgoing response schemas.
"""

from datetime import date
from pydantic import BaseModel, EmailStr, Field


class Notes(BaseModel):
    """Raw natural language text entered by the user."""
    text: str = Field(min_length=5, max_length=5000)


class Item(BaseModel):
    """Individual line item within an invoice."""
    name: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0, le=1_000_000)
    unit_price: float = Field(ge=0, le=100_000_000)
    tax_rate: float = Field(0, ge=0, le=100)


class Invoice(BaseModel):
    """Full invoice payload for drafting and PayPal generation."""
    client_name: str = Field(min_length=1, max_length=140)
    client_email: EmailStr
    currency: str = Field("USD", pattern=r"^[A-Z]{3}$")
    tax_name: str = Field("GST", pattern=r"^(GST|IGST)$")
    items: list[Item] = Field(min_length=1, max_length=50)
    due_date: date
    notes: str = Field("", max_length=2000)


class Reminder(BaseModel):
    """Subject and body for overdue payment follow-ups."""
    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=4000)


class BusinessProfileUpdate(BaseModel):
    """Business entity profile for multi-tenant workspace."""
    business_name: str = Field(min_length=1, max_length=150)
    business_type: str = Field(default="Freelancer / Service Provider", max_length=100)
    business_email: EmailStr
    business_phone: str = Field(default="", max_length=50)
    business_address: str = Field(default="", max_length=300)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    postal_code: str = Field(default="", max_length=20)
    country: str = Field(default="India", max_length=100)
    gst_registered: bool = False
    gstin: str | None = None
    pan: str = Field(default="", max_length=20)
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")
    tax_name: str = Field(default="GST", pattern=r"^(GST|IGST)$")
    tax_rate: float = Field(default=18.0, ge=0, le=100)


class CustomerCreate(BaseModel):
    """Customer record belonging to a business."""
    name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    phone: str = Field(default="", max_length=50)
    address: str = Field(default="", max_length=300)


class RegisterRequest(BaseModel):
    """New tenant registration payload."""
    email: EmailStr
    password: str = Field(min_length=4)
    name: str = Field(min_length=1)
    business: str = Field(default="")
